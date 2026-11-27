"""Mean cost per task against solve rate for every arm the project ran (secondary, added after exp1).

Kapoor, Stroebl, Siegel, Nadgir and Narayanan, "AI Agents That Matter" (2024), argue that an agent
should be reported as a point on a cost-accuracy plane, with the Pareto frontier drawn, rather
than by accuracy alone. This module puts every arm on that plane: the pilot's two forced arms, both
arms of experiment 1, the rollout batch, and the experiment 2 arms once `runs/exp2` exists. Dry runs
are left out (two or three tasks each, on a harness that changed between them).

Each arm gets percentile bootstrap intervals on both axes (tasks resampled within the arm). An arm
is on the frontier when no other arm costs no more and solves no less, and is strictly better on
one of the two. The batches use different task pools, so the plane describes them side by side;
only the two arms of one experiment are a controlled comparison. This does not enter any decision
(DECISIONS.md, D29).
"""

from __future__ import annotations

from typing import Any

import numpy as np

BATCHES = ("pilot", "exp1", "rollout", "exp2")
N_BOOT = 10_000
NOTE = (
    "Batches ran on different task pools (pilot, exp1, rollout, exp2), "
    "so comparisons across batches are descriptive; only arms within one experiment were randomised."
)


def batch_of(run_name: str) -> str | None:
    """The batch a run directory belongs to; the pilot ran as pilot-<arm> directories."""
    if run_name == "pilot" or run_name.startswith("pilot-"):
        return "pilot"
    return run_name if run_name in BATCHES else None


def _interval(samples: np.ndarray) -> list[float]:
    lo, hi = np.percentile(samples, [2.5, 97.5])
    return [float(lo), float(hi)]


def pareto(points: dict[str, tuple[float, float]]) -> set[str]:
    """Keys whose (cost, solve rate) no other point dominates (lower cost and higher solve rate are better)."""
    out: set[str] = set()
    for key, (cost, solve) in points.items():
        dominated = any(
            c <= cost and s >= solve and (c < cost or s > solve) for k, (c, s) in points.items() if k != key
        )
        if not dominated:
            out.add(key)
    return out


def build(runs: dict[str, list[dict[str, Any]]], seed: int, b: int = N_BOOT) -> dict[str, Any]:
    """`runs` maps run directory names to their analysed rows (last attempt, exclusions dropped)."""
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for name in sorted(runs):
        batch = batch_of(name)
        if batch is None:
            continue
        for r in runs[name]:
            grouped.setdefault((batch, str(r["variant"])), []).append(r)
    keys = sorted(grouped, key=lambda bv: (BATCHES.index(bv[0]), bv[1] != "control", bv[1]))

    arms: dict[str, Any] = {}
    for j, (batch, variant) in enumerate(keys):
        rows = grouped[(batch, variant)]
        cost = np.array([float(r["usd"]) for r in rows], dtype=np.float64)
        solved = np.array([1.0 if r["solved"] else 0.0 for r in rows], dtype=np.float64)
        idx = np.random.default_rng([seed, 300 + j]).integers(0, len(rows), size=(b, len(rows)))
        policies = sorted({str(r.get("policy_name") or variant) for r in rows})
        policy = policies[0] if len(policies) == 1 else "mixed"
        label = f"{batch} {variant}" + (f" ({policy} policy)" if policy != variant else "")
        arms[f"{batch}_{variant}"] = {
            "batch": batch,
            "variant": variant,
            "policy": policy,
            "label": label,
            "n": len(rows),
            "cost_mean": float(cost.mean()),
            "cost_mean_ci": _interval(cost[idx].mean(axis=1)),
            "solve_rate": float(solved.mean()),
            "solve_rate_ci": _interval(solved[idx].mean(axis=1)),
        }

    front = pareto({k: (a["cost_mean"], a["solve_rate"]) for k, a in arms.items()})
    for k, a in arms.items():
        a["on_frontier"] = k in front
    on = sorted(front, key=lambda k: arms[k]["cost_mean"])
    return {
        "label": "secondary",
        "added_after_exp1": True,
        "note": NOTE,
        "batches": [bt for bt in BATCHES if any(a["batch"] == bt for a in arms.values())],
        "arms": arms,
        "order": list(arms),
        "n_arms": len(arms),
        "n_on_frontier": len(on),
        "on_frontier": ", ".join(arms[k]["label"] for k in on),
        "bootstrap_resamples": b,
        "seed": seed,
    }
