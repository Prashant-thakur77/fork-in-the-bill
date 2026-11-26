"""Monte Carlo power analysis from pilot data, used to fix N per arm before the main run.

Solve rate: both arms draw Binomial(N, p) and Binomial(N, p - d) with p the pilot solve rate.
A drop counts as detected when the Beta(1,1) posteriors give P(delta < 0) >= 0.95 (normal
approximation to the posterior difference). The minimum detectable drop is the smallest d
detected in at least `power` of simulations.

Guardrail: with no true drop, the probability that P(delta > -m) >= 0.90, which is how often
an arm that really is as good as control passes the pre-registered guardrail.

Cost: per-task pilot control costs are resampled for both arms and the treatment arm's
costs are scaled by (1 - r). A reduction counts as detected when a one-sided test on the
mean difference clears 0.95. When the pilot ran both arms, the power at the observed pilot
cost effect is also reported per N (`power_at_pilot_cost_effect`).

N per arm is the smallest grid value at or above `--min-n` where the guardrail pass rate
reaches `power` (when m is known), else `--min-n`; `guardrail_target_met` is false when no
grid value reaches it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import numpy as np
import typer
from numpy.typing import NDArray
from scipy import stats

from analysis.analyse import Run
from analysis.to_parquet import convert

SEED = 20_260_202
Z95 = float(stats.norm.ppf(0.95))
Z90 = float(stats.norm.ppf(0.90))


def _posterior_moments(s: NDArray[np.int64], n: int) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    a = 1.0 + s
    b = 1.0 + n - s
    mean = a / (a + b)
    var = a * b / ((a + b) ** 2 * (a + b + 1))
    return mean, var


def solve_drop_power(p: float, n: int, drop: float, sims: int, rng: np.random.Generator) -> float:
    s_c = rng.binomial(n, p, sims)
    s_t = rng.binomial(n, max(p - drop, 0.0), sims)
    mc, vc = _posterior_moments(s_c, n)
    mt, vt = _posterior_moments(s_t, n)
    z = (mt - mc) / np.sqrt(vc + vt)
    return float(np.mean(z < -Z95))


def guardrail_pass_rate(p: float, n: int, m: float, sims: int, rng: np.random.Generator) -> float:
    s_c = rng.binomial(n, p, sims)
    s_t = rng.binomial(n, p, sims)
    mc, vc = _posterior_moments(s_c, n)
    mt, vt = _posterior_moments(s_t, n)
    z = (mt - mc + m) / np.sqrt(vc + vt)
    return float(np.mean(z > Z90))


def cost_reduction_power(
    control: NDArray[np.float64],
    treatment: NDArray[np.float64],
    n: int,
    reductions: NDArray[np.float64],
    sims: int,
    rng: np.random.Generator,
) -> NDArray[np.float64]:
    c = control[rng.integers(0, control.size, (sims, n))]
    t = treatment[rng.integers(0, treatment.size, (sims, n))]
    mc, vc = c.mean(axis=1), c.var(axis=1, ddof=1)
    mt, vt = t.mean(axis=1), t.var(axis=1, ddof=1)
    out = np.empty(reductions.size)
    for i, r in enumerate(reductions):
        k = 1.0 - r
        z = (mt * k - mc) / np.sqrt((vt * k * k + vc) / n)
        out[i] = np.mean(z < -Z95)
    return out


def run_power(
    costs_control: NDArray[np.float64],
    costs_treatment: NDArray[np.float64] | None,
    p: float,
    m: float | None,
    target: float = 0.8,
    sims: int = 2000,
    seed: int = SEED,
    grid: list[int] | None = None,
    min_n: int = 250,
) -> dict[str, Any]:
    grid = grid or [*range(25, 100, 5), *range(100, 1000, 25), *range(1000, 2001, 100)]
    drops = np.round(np.arange(0.005, 0.505, 0.005), 3)
    reductions = np.round(np.arange(0.01, 0.91, 0.01), 2)
    rows: list[dict[str, Any]] = []
    for n in grid:
        rng = np.random.default_rng([seed, n])
        mde_solve = next((float(d) for d in drops if solve_drop_power(p, n, float(d), sims, rng) >= target), None)
        cost_power = cost_reduction_power(costs_control, costs_control, n, reductions, sims, rng)
        hit = np.nonzero(cost_power >= target)[0]
        row: dict[str, Any] = {
            "n_per_arm": n,
            "mde_solve_pp": mde_solve * 100 if mde_solve is not None else None,
            "mde_cost_pct": float(reductions[hit[0]]) * 100 if hit.size else None,
            "guardrail_pass_rate": guardrail_pass_rate(p, n, m, sims, rng) if m is not None else None,
        }
        if costs_treatment is not None and costs_treatment.size:
            row["power_at_pilot_cost_effect"] = float(
                cost_reduction_power(costs_control, costs_treatment, n, np.array([0.0]), sims, rng)[0]
            )
        rows.append(row)

    eligible = [r for r in rows if r["n_per_arm"] >= min_n]
    met: dict[str, Any] | None = None
    chosen = eligible[0] if eligible else rows[-1]
    if m is not None:
        met = next((r for r in eligible if (r["guardrail_pass_rate"] or 0) >= target), None)
        chosen = met or chosen
    guardrail_target_met = None if m is None else met is not None
    return {
        "pilot": {
            "n": int(costs_control.size + (costs_treatment.size if costs_treatment is not None else 0)),
            "solve_rate": p,
            "cost_mean_control": float(costs_control.mean()),
            "cost_mean_treatment": float(costs_treatment.mean())
            if costs_treatment is not None and costs_treatment.size
            else None,
        },
        "m": m,
        "power": target,
        "sims": sims,
        "seed": seed,
        "n_per_arm": chosen["n_per_arm"],
        "mde_solve_pp": chosen["mde_solve_pp"],
        "mde_cost_pct": chosen["mde_cost_pct"],
        "guardrail_pass_rate": chosen["guardrail_pass_rate"],
        "guardrail_target_met": guardrail_target_met,
        "grid": rows,
    }


def pilot_inputs(run_dirs: list[Path], out: Path) -> tuple[NDArray[np.float64], NDArray[np.float64] | None, float]:
    rows: list[dict[str, Any]] = []
    for run_dir in run_dirs:
        parquet = out / "parquet" / run_dir.name
        convert(run_dir, parquet)
        rows += [r for r in Run(parquet).all_rows() if not r["excluded"]]
    if not rows:
        raise typer.BadParameter(f"no analysable pilot tasks in {', '.join(map(str, run_dirs))}")
    control = [float(r["usd"]) for r in rows if r["variant"] == "control"]
    treatment = [float(r["usd"]) for r in rows if r["variant"] != "control"]
    if not control:
        control, treatment = treatment, []
    p = sum(1 for r in rows if r["solved"]) / len(rows)
    return (
        np.array(control, dtype=np.float64),
        np.array(treatment, dtype=np.float64) if treatment else None,
        p,
    )


app = typer.Typer(add_completion=False)


@app.command()
def main(
    runs: Annotated[Path, typer.Option()] = Path("runs"),
    pilot: Annotated[list[str] | None, typer.Option(help="pilot run directory; repeat for one per arm")] = None,
    out: Annotated[Path, typer.Option()] = Path("analysis/out"),
    m: Annotated[float | None, typer.Option(help="guardrail margin, solve-rate fraction")] = None,
    power: Annotated[float, typer.Option()] = 0.8,
    sims: Annotated[int, typer.Option()] = 2000,
    seed: Annotated[int, typer.Option()] = SEED,
    min_n: Annotated[int, typer.Option()] = 250,
    write: Annotated[bool, typer.Option(help="also write <out>/power.json")] = True,
) -> None:
    control, treatment, p = pilot_inputs([runs / d for d in pilot or ["pilot"]], out)
    result = run_power(control, treatment, p, m, power, sims, seed, min_n=min_n)
    text = json.dumps(result, indent=2)
    if write:
        out.mkdir(parents=True, exist_ok=True)
        (out / "power.json").write_text(text + "\n", encoding="utf-8")
    typer.echo(text)


if __name__ == "__main__":
    app()
