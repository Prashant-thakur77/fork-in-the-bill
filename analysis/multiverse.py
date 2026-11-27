"""Specification curve over reasonable analysis choices (secondary, added after exp1 ended).

Gelman and Loken, "The garden of forking paths" (2013): a result can depend on choices an analyst
would have made differently had the data come out differently, even with no fishing. The registered
analysis fixed its choices in advance; this module recomputes the two quantities the decision rests
on for every combination of five choices that someone could defend:

- task set: all tasks, the fresh tier only (created on or after 2026-07), the pre-cutoff tier only;
- the attempt kept for an identity that ran twice: the last (registered) or the first;
- the cost statistic: mean (registered), median, 10% trimmed mean;
- the solve-rate prior: Beta(1,1) (registered) or Beta(0.5,0.5);
- cost outliers: as recorded (registered) or winsorised at the 99th percentile of both arms pooled.

For each specification:

- cost per solved task is the cost statistic divided by the solve rate, per arm, and its change is
  treatment over control minus one, in percent, with a percentile bootstrap interval (tasks
  resampled within each arm; the same resamples for every cost statistic on the same tasks);
- the guardrail posterior is P(p_treatment - p_control > -m) under independent Beta posteriors,
  computed by numerical integration, with m the registered margin.

The registered rule's condition 2 holds when that posterior is at least 0.90; the cost direction
holds when cost per solved task is lower under the treatment. Condition 1 is Flagsmith's own
verdict on mean cost and cannot be recomputed per specification. None of this changes the decision
(DECISIONS.md, D29).
"""

from __future__ import annotations

import itertools
from typing import Any

import numpy as np
from scipy import integrate, stats

N_BOOT = 10_000
GUARDRAIL_BAR = 0.90
FRESH_FROM_MONTH = "2026-07"  # prereg/experiment-1.md: the fresh tier starts in July 2026
TASK_SETS = ("all", "fresh", "pre_cutoff")
ATTEMPTS = ("last", "first")
COST_STATS = ("mean", "median", "trimmed10")
PRIORS = {"beta11": 1.0, "beta0505": 0.5}
OUTLIERS = ("as_is", "winsorised")
REGISTERED = {"task_set": "all", "attempt": "last", "cost_stat": "mean", "prior": "beta11", "outliers": "as_is"}
LABELS = {
    "all": "all tasks",
    "fresh": "fresh tier",
    "pre_cutoff": "pre-cutoff tier",
    "last": "last attempt",
    "first": "first attempt",
    "mean": "mean",
    "median": "median",
    "trimmed10": "10% trimmed mean",
    "beta11": "Beta(1,1)",
    "beta0505": "Beta(0.5,0.5)",
    "as_is": "as recorded",
    "winsorised": "winsorised at p99",
}


def guardrail_posterior(s_c: int, n_c: int, s_t: int, n_t: int, m: float, a: float) -> float:
    """P(p_t - p_c > -m) with p ~ Beta(a + s, a + n - s), independent arms."""
    a_c, b_c = a + s_c, a + n_c - s_c
    a_t, b_t = a + s_t, a + n_t - s_t

    def integrand(x: float) -> float:
        return float(stats.beta.pdf(x, a_c, b_c) * stats.beta.sf(x - m, a_t, b_t))

    value, _ = integrate.quad(integrand, 0.0, 1.0, points=[m], limit=200)
    return float(min(1.0, max(0.0, value)))


def _stat(x: np.ndarray, how: str, axis: int | None = None) -> Any:
    if how == "mean":
        return np.mean(x, axis=axis)
    if how == "median":
        return np.median(x, axis=axis)
    return stats.trim_mean(x, 0.1, axis=0 if axis is None else axis)


def _in_set(row: dict[str, Any], task_set: str) -> bool:
    if task_set == "all":
        return True
    fresh = str(row.get("trait_created_month") or "") >= FRESH_FROM_MONTH
    return fresh if task_set == "fresh" else not fresh


def _arrays(rows: list[dict[str, Any]], variant: str) -> tuple[np.ndarray, np.ndarray]:
    sel = [r for r in rows if r["variant"] == variant]
    cost = np.array([float(r["usd"]) for r in sel], dtype=np.float64)
    solved = np.array([1.0 if r["solved"] else 0.0 for r in sel], dtype=np.float64)
    return cost, solved


def _cps_change(cost_c: Any, rate_c: Any, cost_t: Any, rate_t: Any) -> Any:
    with np.errstate(divide="ignore", invalid="ignore"):
        return (np.asarray(cost_t) / np.asarray(rate_t)) / (np.asarray(cost_c) / np.asarray(rate_c)) * 100 - 100


def specifications(
    rows_by_attempt: dict[str, list[dict[str, Any]]],
    control: str,
    treatment: str,
    m: float,
    seed: int,
    b: int = N_BOOT,
) -> list[dict[str, Any]]:
    """Every specification with enough data in both arms, registered one first."""
    out: list[dict[str, Any]] = []
    for (ti, task_set), (ai, attempt) in itertools.product(enumerate(TASK_SETS), enumerate(ATTEMPTS)):
        rows = [r for r in rows_by_attempt.get(attempt, []) if _in_set(r, task_set)]
        cost_c, solved_c = _arrays(rows, control)
        cost_t, solved_t = _arrays(rows, treatment)
        if cost_c.size < 2 or cost_t.size < 2:
            continue
        s_c, s_t = int(solved_c.sum()), int(solved_t.sum())
        rate_c, rate_t = s_c / cost_c.size, s_t / cost_t.size
        idx_c = np.random.default_rng([seed, 400 + 10 * ti + ai, 0]).integers(0, cost_c.size, (b, cost_c.size))
        idx_t = np.random.default_rng([seed, 400 + 10 * ti + ai, 1]).integers(0, cost_t.size, (b, cost_t.size))
        boot_rate_c, boot_rate_t = solved_c[idx_c].mean(axis=1), solved_t[idx_t].mean(axis=1)
        cap = float(np.percentile(np.concatenate([cost_c, cost_t]), 99))
        posteriors = {p: guardrail_posterior(s_c, cost_c.size, s_t, cost_t.size, m, a) for p, a in PRIORS.items()}
        for outliers, cost_stat in itertools.product(OUTLIERS, COST_STATS):
            xc = np.minimum(cost_c, cap) if outliers == "winsorised" else cost_c
            xt = np.minimum(cost_t, cap) if outliers == "winsorised" else cost_t
            stat_c, stat_t = float(_stat(xc, cost_stat)), float(_stat(xt, cost_stat))
            change = float(_cps_change(stat_c, rate_c, stat_t, rate_t)) if rate_c and rate_t else None
            boot = _cps_change(_stat(xc[idx_c], cost_stat, 1), boot_rate_c, _stat(xt[idx_t], cost_stat, 1), boot_rate_t)
            finite = boot[np.isfinite(boot)]
            ci = [float(v) for v in np.percentile(finite, [2.5, 97.5])] if finite.size else [None, None]
            for prior in PRIORS:
                spec = {
                    "task_set": task_set,
                    "attempt": attempt,
                    "cost_stat": cost_stat,
                    "prior": prior,
                    "outliers": outliers,
                }
                post = posteriors[prior]
                out.append(
                    spec
                    | {
                        "registered": spec == REGISTERED,
                        "n_control": int(cost_c.size),
                        "n_treatment": int(cost_t.size),
                        "cps_change_pct": change,
                        "cps_change_pct_ci": ci,
                        "guardrail_posterior": post,
                        "guardrail_pass": post >= GUARDRAIL_BAR,
                        "cost_direction": change is not None and change < 0,
                        "cps_ci_below_zero": ci[1] is not None and ci[1] < 0,
                    }
                )
    out.sort(key=lambda s: not s["registered"])
    return out


def summarise(specs: list[dict[str, Any]], m: float) -> dict[str, Any]:
    """Counts, shares and ranges for numbers.json: `<exp>.secondary.multiverse`."""
    n = len(specs)
    out: dict[str, Any] = {
        "label": "secondary",
        "added_after_exp1": True,
        "choices": {
            "task_set": list(TASK_SETS),
            "attempt": list(ATTEMPTS),
            "cost_stat": list(COST_STATS),
            "prior": list(PRIORS),
            "outliers": list(OUTLIERS),
        },
        "m": m,
        "guardrail_bar": GUARDRAIL_BAR,
        "bootstrap_resamples": N_BOOT,
        "n_specs": n,
    }
    if not n:
        out["note"] = "no specification has two or more tasks in both arms"
        return out

    def count(key: str) -> int:
        return sum(1 for s in specs if s[key])

    both = sum(1 for s in specs if s["guardrail_pass"] and s["cost_direction"])
    changes = [s["cps_change_pct"] for s in specs if s["cps_change_pct"] is not None]
    posts = [s["guardrail_posterior"] for s in specs]
    failing = [s for s in specs if not s["guardrail_pass"]]
    fail_sets = sorted({s["task_set"] for s in failing}, key=TASK_SETS.index)
    fresh = [s for s in specs if s["task_set"] == "fresh"]
    registered = next((s for s in specs if s["registered"]), None)
    out.update(
        guardrail_pass=count("guardrail_pass"),
        guardrail_pass_share=count("guardrail_pass") / n,
        guardrail_fail=len(failing),
        cost_direction=count("cost_direction"),
        cost_direction_share=count("cost_direction") / n,
        cps_ci_below_zero=count("cps_ci_below_zero"),
        cps_ci_below_zero_share=count("cps_ci_below_zero") / n,
        both=both,
        both_share=both / n,
        cps_change_pct_range=[min(changes), max(changes)] if changes else [None, None],
        guardrail_posterior_range=[min(posts), max(posts)],
        guardrail_fail_task_sets=", ".join(LABELS[t] for t in fail_sets) if fail_sets else "none",
        guardrail_fail_only_fresh=bool(failing) and fail_sets == ["fresh"],
        fresh_specs=len(fresh),
        fresh_specs_failing=sum(1 for s in fresh if not s["guardrail_pass"]),
        non_fresh_specs_failing=sum(1 for s in failing if s["task_set"] != "fresh"),
        registered={
            "cps_change_pct": registered["cps_change_pct"],
            "guardrail_posterior": registered["guardrail_posterior"],
        }
        if registered
        else None,
        specs=specs,
    )
    return out
