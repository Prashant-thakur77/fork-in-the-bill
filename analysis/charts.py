"""PNG charts for the README and results page, drawn from numbers.json and the task Parquet.

Charts: cost distribution per arm, solve-rate posteriors, cost per solved task with
intervals, and solve rate by difficulty tertile. Secondary charts added after exp1 ended
(DECISIONS.md, D29): the always-valid p-value as each experiment ran, the specification curve,
and every arm on one cost-accuracy plane.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import duckdb
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import typer
from matplotlib.axes import Axes
from matplotlib.lines import Line2D
from matplotlib.ticker import PercentFormatter
from scipy import stats

from analysis import always_valid
from analysis.analyse import CONTROL, Run
from analysis.multiverse import LABELS, TASK_SETS
from analysis.render_docs import level_order

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e4e3df"
SERIES = ("#2a78d6", "#eb6834")  # control, treatment
MUTED = "#a9a7a0"


def _style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": SURFACE,
            "axes.facecolor": SURFACE,
            "axes.edgecolor": GRID,
            "axes.labelcolor": INK_2,
            "axes.titlecolor": INK,
            "axes.titlesize": 12,
            "axes.titleweight": "bold",
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "axes.axisbelow": True,
            "grid.color": GRID,
            "grid.linewidth": 0.8,
            "xtick.color": INK_2,
            "ytick.color": INK_2,
            "font.size": 10,
            "legend.frameon": False,
            "savefig.dpi": 160,
            "savefig.bbox": "tight",
        }
    )


def _arms(exp: dict[str, Any]) -> list[str]:
    return sorted(exp["arms"], key=lambda a: (a != CONTROL, a))


def _costs(parquet_dir: Path, variant: str) -> np.ndarray:
    con = duckdb.connect()
    rows = con.execute(
        "WITH t AS (SELECT * FROM read_parquet(?) QUALIFY row_number() OVER "
        "(PARTITION BY identity ORDER BY attempt DESC, finished_at DESC) = 1), "
        "ex AS (SELECT DISTINCT identity FROM read_parquet(?)) "
        "SELECT usd FROM t WHERE variant = ? AND outcome <> 'infra_error' "
        "AND identity NOT IN (SELECT identity FROM ex)",
        [str(parquet_dir / "tasks.parquet"), str(parquet_dir / "exclusions.parquet"), variant],
    ).fetchall()
    return np.array([float(r[0]) for r in rows], dtype=np.float64)


def _save(fig: Any, path: Path) -> Path:
    fig.savefig(path)
    plt.close(fig)
    return path


def cost_distribution(exp: dict[str, Any], parquet_dir: Path, path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(7, 3.6))
    arms = _arms(exp)
    data = [_costs(parquet_dir, a) for a in arms]
    upper = max((float(np.percentile(d, 99)) for d in data if d.size), default=1.0)
    bins = [float(b) for b in np.linspace(0, upper, 30)]
    for arm, d, color in zip(arms, data, SERIES, strict=False):
        if d.size:
            ax.hist(d, bins=bins, color=color, alpha=0.18, histtype="stepfilled")
            ax.hist(d, bins=bins, color=color, histtype="step", linewidth=2, label=arm)
            ax.axvline(float(d.mean()), color=color, linewidth=2)
    ax.set_xlabel("cost per task (USD); vertical line = arm mean")
    ax.set_ylabel("tasks")
    ax.set_title("Cost per task by arm")
    ax.legend()
    return _save(fig, path)


def solve_posteriors(exp: dict[str, Any], path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(7, 3.6))
    x = np.linspace(0, 1, 801)
    for arm, color in zip(_arms(exp), SERIES, strict=False):
        a = exp["arms"][arm]
        n, s = a["n_analysed"], a["solves"]
        y = stats.beta.pdf(x, 1 + s, 1 + n - s)
        ax.plot(x, y, color=color, linewidth=2, label=f"{arm} ({s}/{n})")
        ax.fill_between(x, y, color=color, alpha=0.12)
    ax.set_xlabel("solve rate")
    ax.set_ylabel("posterior density")
    ax.set_title("Solve-rate posteriors, Beta(1,1) prior")
    ax.xaxis.set_major_formatter(PercentFormatter(1.0))
    ax.legend()
    return _save(fig, path)


def _interval_bars(ax: Axes, labels: list[str], values: list[float], cis: list[list[Any]]) -> None:
    for i, (v, ci, color) in enumerate(zip(values, cis, SERIES, strict=False)):
        ax.bar(i, v, color=color, width=0.55)
        if ci[0] is not None and ci[1] is not None:
            ax.errorbar(i, v, yerr=[[v - ci[0]], [ci[1] - v]], color=INK, capsize=6, linewidth=1.5)
        ax.annotate(f"${v:.3f}", (i, v), xytext=(10, 4), textcoords="offset points", color=INK)
    ax.set_xticks(range(len(labels)), labels)


def cost_per_solve(exp: dict[str, Any], path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(5, 3.6))
    arms = [a for a in _arms(exp) if exp["arms"][a]["cost_per_solve"] is not None]
    _interval_bars(
        ax,
        arms,
        [exp["arms"][a]["cost_per_solve"] for a in arms],
        [exp["arms"][a]["cost_per_solve_ci"] for a in arms],
    )
    ax.set_ylabel("USD per solved task")
    ax.set_title("Cost per solved task (95% bootstrap interval)")
    ax.grid(axis="x", visible=False)
    return _save(fig, path)


def trait_bars(exp: dict[str, Any], trait: str, path: Path) -> Path | None:
    levels: dict[str, Any] = exp.get("by_trait", {}).get(trait, {})
    if not levels:
        return None
    arms = _arms(exp)
    names = level_order(trait, levels)
    width = 0.8 / len(arms)
    fig, ax = plt.subplots(figsize=(max(5.0, 1.2 * len(names) + 2), 3.6))
    for j, (arm, color) in enumerate(zip(arms, SERIES, strict=False)):
        rates = [levels[lv][arm]["solve_rate"] or 0.0 for lv in names]
        xs = np.arange(len(names)) + (j - (len(arms) - 1) / 2) * width
        ax.bar(xs, rates, width=width * 0.92, color=color, label=arm)
    ax.set_xticks(range(len(names)), names)
    ax.yaxis.set_major_formatter(PercentFormatter(1.0))
    ax.set_ylabel("solve rate")
    ax.set_title(f"Solve rate by {trait.replace('_', ' ')}")
    ax.grid(axis="x", visible=False)
    ax.legend()
    return _save(fig, path)


def always_valid_chart(name: str, exp: dict[str, Any], parquet_root: Path, path: Path) -> Path | None:
    """Running always-valid p-value for cost and solve rate against tasks finished (log scale)."""
    av = (exp.get("secondary") or {}).get("always_valid") or {}
    if "cost" not in av:
        return None
    pilot = [
        r for d in sorted(parquet_root.glob("pilot*")) if (d / "tasks.parquet").exists() for r in Run(d).analysed_rows()
    ]
    taus = always_valid.tau_from_pilot(pilot)
    if taus is None:
        return None
    rows = Run(parquet_root / name).analysed_rows()
    traj = always_valid.trajectories(rows, exp["delta"]["treatment"], taus, av["alpha"])
    fig, ax = plt.subplots(figsize=(7.4, 3.9))
    for key, label, color in (("cost", "mean cost per task", SERIES[1]), ("solve", "solve rate", SERIES[0])):
        steps = traj[key]
        ax.step([s.k for s in steps], [s.p for s in steps], where="post", color=color, linewidth=2, label=label)
    ax.axhline(av["alpha"], color=INK, linewidth=1, linestyle="--")
    ax.annotate(f"alpha = {av['alpha']:g}", (1, av["alpha"]), xytext=(4, 4), textcoords="offset points", color=INK_2)
    if av.get("first_evaluated_at"):
        ax.axvspan(0, av["first_evaluated_at"] - 0.5, color=GRID, alpha=0.6, linewidth=0)
        ax.annotate(
            f"fewer than {av['min_per_arm']} per arm",
            (1, 1.0),
            xytext=(4, -14),
            textcoords="offset points",
            color=INK_2,
        )
    live = av.get("board_live_after_tasks")
    if live and live < av["n_tasks"]:
        ax.axvline(live + 0.5, color=MUTED, linewidth=1.2)
        ax.annotate("live board public", (live + 0.5, 1.0), xytext=(4, -28), textcoords="offset points", color=INK_2)
    first = av["cost"].get("first_cross_at")
    if first:
        ax.plot([first], [traj["cost"][first - 1].p], marker="o", color=SERIES[1])
        ax.annotate(
            f"cost crosses at task {first}",
            (first, traj["cost"][first - 1].p),
            xytext=(-8, -16),
            textcoords="offset points",
            ha="right",
            color=SERIES[1],
        )
    ax.set_yscale("log")
    ax.set_ylim(top=1.5)
    ax.set_xlim(0, av["n_tasks"] + 1)
    ax.set_xlabel("tasks finished, in the order they finished")
    ax.set_ylabel("always-valid p-value")
    ax.set_title(f"{name}: always-valid p-values as the run went (secondary)")
    ax.legend(loc="lower left")
    return _save(fig, path)


def specification_curve(name: str, exp: dict[str, Any], path: Path) -> Path | None:
    mv = (exp.get("secondary") or {}).get("multiverse") or {}
    specs = mv.get("specs") or []
    if not specs:
        return None
    order = sorted(range(len(specs)), key=lambda i: (specs[i]["cps_change_pct"] is None, specs[i]["cps_change_pct"]))
    xs = np.arange(len(order))
    choices = [
        ("task_set", list(TASK_SETS)),
        ("attempt", ["last", "first"]),
        ("cost_stat", ["mean", "median", "trimmed10"]),
        ("prior", ["beta11", "beta0505"]),
        ("outliers", ["as_is", "winsorised"]),
    ]
    rows = [(field, v) for field, vals in choices for v in vals if any(s[field] == v for s in specs)]
    fig, (top, mid, bottom) = plt.subplots(
        3, 1, figsize=(9, 7.2), sharex=True, gridspec_kw={"height_ratios": [3, 1.6, 0.32 * len(rows)]}
    )
    for x, i in zip(xs, order, strict=True):
        s = specs[i]
        color = SERIES[0] if s["guardrail_pass"] else SERIES[1]
        lo, hi = s["cps_change_pct_ci"]
        if s["cps_change_pct"] is not None and lo is not None and hi is not None:
            top.plot([x, x], [lo, hi], color=color, alpha=0.35, linewidth=1.4)
            top.plot(
                [x],
                [s["cps_change_pct"]],
                marker="D" if s["registered"] else "o",
                color=color,
                markersize=7 if s["registered"] else 3.5,
            )
        mid.plot(
            [x],
            [s["guardrail_posterior"]],
            marker="D" if s["registered"] else "o",
            color=color,
            markersize=7 if s["registered"] else 3.5,
        )
    top.axhline(0, color=INK, linewidth=1)
    top.set_ylabel("change in cost per\nsolved task (%)")
    top.set_title(f"{name}: specification curve, {len(specs)} specifications (secondary)")
    mid.axhline(mv["guardrail_bar"], color=INK, linewidth=1, linestyle="--")
    mid.set_ylabel("P(Δsolve > -m)")
    mid.yaxis.set_major_formatter(PercentFormatter(1.0))
    for y, (field, v) in enumerate(rows):
        on = [x for x, i in zip(xs, order, strict=True) if specs[i][field] == v]
        bottom.plot(on, [y] * len(on), "|", color=INK, markersize=6)
    bottom.set_yticks(range(len(rows)), [LABELS[v] for _, v in rows])
    bottom.invert_yaxis()
    bottom.grid(axis="y", visible=False)
    bottom.set_xlabel("specifications, sorted by the change in cost per solved task (diamond: registered analysis)")
    handles = [
        Line2D([], [], color=SERIES[0], marker="o", linestyle="", label="guardrail at or above the bar"),
        Line2D([], [], color=SERIES[1], marker="o", linestyle="", label="guardrail below the bar"),
    ]
    top.legend(handles=handles, loc="upper left")
    return _save(fig, path)


def frontier_chart(numbers: dict[str, Any], path: Path) -> Path | None:
    fr = numbers.get("frontier") or {}
    arms = fr.get("arms") or {}
    if not arms:
        return None
    fig, ax = plt.subplots(figsize=(7.6, 4.8))
    colors = {"pilot": MUTED, "exp1": SERIES[1], "rollout": "#2f9e6e", "exp2": SERIES[0]}
    span = max(a["cost_mean"] for a in arms.values()) - min(a["cost_mean"] for a in arms.values()) or 1.0
    placed: list[tuple[float, float]] = []
    for key in sorted(fr["order"], key=lambda k: (-arms[k]["solve_rate"], arms[k]["cost_mean"])):
        a = arms[key]
        x, y = a["cost_mean"], a["solve_rate"]
        (xl, xh), (yl, yh) = a["cost_mean_ci"], a["solve_rate_ci"]
        color = colors.get(a["batch"], INK_2)
        ax.errorbar(
            x,
            y,
            xerr=[[x - xl], [xh - x]],
            yerr=[[y - yl], [yh - y]],
            color=color,
            alpha=0.45,
            linewidth=1.2,
            capsize=3,
        )
        ax.plot(
            [x],
            [y],
            marker="o",
            markersize=9,
            color=color,
            markerfacecolor=color if a["on_frontier"] else SURFACE,
            markeredgewidth=2,
        )
        # A label goes below its point when a point already labelled sits close by.
        crowded = any(abs(x - px) < 0.15 * span and abs(y - py) < 0.06 for px, py in placed)
        placed.append((x, y))
        ax.annotate(
            f"{a['label']} (n={a['n']})",
            (x, y),
            xytext=(8, -14) if crowded else (8, 6),
            textcoords="offset points",
            color=INK,
            fontsize=9,
        )
    front = sorted((arms[k] for k in fr["order"] if arms[k]["on_frontier"]), key=lambda a: a["cost_mean"])
    ax.plot(
        [a["cost_mean"] for a in front],
        [a["solve_rate"] for a in front],
        color=INK,
        linewidth=1,
        linestyle=":",
        label="Pareto frontier (filled points)",
    )
    ax.yaxis.set_major_formatter(PercentFormatter(1.0))
    ax.set_xlabel("mean cost per task (USD), 95% bootstrap interval")
    ax.set_ylabel("solve rate, 95% bootstrap interval")
    ax.set_title("Every arm on one cost-accuracy plane (secondary)")
    ax.legend(loc="lower right")
    fig.text(0.01, -0.04, fr.get("note", ""), color=INK_2, fontsize=8.5, wrap=True)
    return _save(fig, path)


def draw_all(numbers: dict[str, Any], parquet_root: Path, out: Path) -> list[Path]:
    _style()
    out.mkdir(parents=True, exist_ok=True)
    made: list[Path] = []
    for name in ("exp1", "exp2"):
        exp = numbers.get(name)
        if not isinstance(exp, dict) or not exp.get("arms"):
            continue
        made.append(cost_distribution(exp, parquet_root / name, out / f"{name}-cost-distribution.png"))
        made.append(solve_posteriors(exp, out / f"{name}-solve-posteriors.png"))
        made.append(cost_per_solve(exp, out / f"{name}-cost-per-solve.png"))
        for trait in ("difficulty", "language", "created_month"):
            p = trait_bars(exp, trait, out / f"{name}-by-{trait.replace('_', '-')}.png")
            if p is not None:
                made.append(p)
        for p in (
            always_valid_chart(name, exp, parquet_root, out / f"{name}-always-valid.png"),
            specification_curve(name, exp, out / f"{name}-specification-curve.png"),
        ):
            if p is not None:
                made.append(p)
    p = frontier_chart(numbers, out / "frontier.png")
    if p is not None:
        made.append(p)
    return made


app = typer.Typer(add_completion=False)


@app.command()
def main(
    numbers: Annotated[Path, typer.Option()] = Path("analysis/out/numbers.json"),
    parquet: Annotated[Path, typer.Option()] = Path("analysis/out/parquet"),
    out: Annotated[Path, typer.Option()] = Path("analysis/charts"),
) -> None:
    nums = json.loads(numbers.read_text(encoding="utf-8"))
    for p in draw_all(nums, parquet, out):
        typer.echo(f"wrote {p}")


if __name__ == "__main__":
    app()
