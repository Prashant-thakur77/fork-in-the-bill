"""PNG charts for the README and results page, drawn from numbers.json and the task Parquet.

Charts: cost distribution per arm, solve-rate posteriors, cost per solved task with
intervals, and solve rate by difficulty tertile.
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
from matplotlib.ticker import PercentFormatter
from scipy import stats

from analysis.analyse import CONTROL
from analysis.render_docs import level_order

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e4e3df"
SERIES = ("#2a78d6", "#eb6834")  # control, treatment


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
