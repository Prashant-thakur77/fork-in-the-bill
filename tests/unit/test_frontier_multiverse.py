"""Cost-accuracy frontier and the specification curve, on small synthetic runs."""

from __future__ import annotations

import numpy as np
import pytest

from analysis.frontier import batch_of, build, pareto
from analysis.multiverse import guardrail_posterior, specifications, summarise


def _rows(variant: str, costs: list[float], solved: list[bool], month: str = "2026-07", policy: str | None = None):
    return [
        {
            "identity": f"swelive:fixture__{variant}-{month}-{i}",
            "variant": variant,
            "policy_name": policy or variant,
            "usd": c,
            "solved": s,
            "trait_created_month": month,
        }
        for i, (c, s) in enumerate(zip(costs, solved, strict=True))
    ]


def test_pareto_marks_undominated_points() -> None:
    pts = {"a": (1.0, 0.5), "b": (2.0, 0.6), "c": (2.0, 0.4), "d": (1.0, 0.5), "e": (3.0, 0.6)}
    assert pareto(pts) == {"a", "b", "d"}  # equal points do not dominate each other; e is beaten by b


def test_batches() -> None:
    assert [batch_of(n) for n in ("pilot-control", "pilot", "exp1", "rollout", "exp2", "dryrun-control")] == [
        "pilot",
        "pilot",
        "exp1",
        "rollout",
        "exp2",
        None,
    ]


def test_frontier_build() -> None:
    runs = {
        "pilot-control": _rows("control", [0.10, 0.12, 0.11], [True, False, True]),
        "pilot-lanes_v1": _rows("lanes_v1", [0.05, 0.06, 0.07], [True, False, False]),
        "exp1": _rows("control", [0.08] * 4, [True, True, False, False])
        + _rows("lanes_v1", [0.03] * 4, [True, False, False, False]),
        "rollout": _rows("lanes_v1", [0.04, 0.035], [True, True]),
        "exp2": _rows("control", [0.04, 0.05], [True, False], policy="lanes_v1")
        + _rows("lanes_v2", [0.06, 0.07], [True, True]),
        "dryrun-control": _rows("control", [9.0], [True]),
    }
    out = build(runs, seed=1, b=500)
    assert out["order"] == [
        "pilot_control",
        "pilot_lanes_v1",
        "exp1_control",
        "exp1_lanes_v1",
        "rollout_lanes_v1",
        "exp2_control",
        "exp2_lanes_v2",
    ]
    assert out["arms"]["exp2_control"]["label"] == "exp2 control (lanes_v1 policy)"
    for arm in out["arms"].values():
        lo, hi = arm["cost_mean_ci"]
        assert lo <= arm["cost_mean"] <= hi
        lo, hi = arm["solve_rate_ci"]
        assert lo <= arm["solve_rate"] <= hi
    on = {k for k, a in out["arms"].items() if a["on_frontier"]}
    assert on == {"exp1_lanes_v1", "rollout_lanes_v1"}
    assert out["on_frontier"] == "exp1 lanes_v1, rollout lanes_v1"
    assert build(runs, seed=1, b=500) == out


@pytest.mark.parametrize(("counts", "a"), [((34, 76, 28, 69), 1.0), ((5, 9, 1, 9), 0.5), ((0, 10, 0, 12), 0.5)])
def test_guardrail_posterior_matches_simulation(counts: tuple[int, int, int, int], a: float) -> None:
    s_c, n_c, s_t, n_t = counts
    rng = np.random.default_rng(5)
    draws = rng.beta(a + s_t, a + n_t - s_t, 400_000) - rng.beta(a + s_c, a + n_c - s_c, 400_000)
    assert guardrail_posterior(s_c, n_c, s_t, n_t, 0.2, a) == pytest.approx(float(np.mean(draws > -0.2)), abs=3e-3)


def _two_tier_rows(attempt_cost: float) -> list[dict[str, object]]:
    rng = np.random.default_rng(9)
    fresh = _rows("control", list(rng.uniform(0.05, 0.1, 30)), [i % 2 == 0 for i in range(30)]) + _rows(
        "lanes_v1", list(rng.uniform(0.02, 0.04, 30)), [i % 5 < 2 for i in range(30)]
    )
    pre = _rows("control", list(rng.uniform(0.05, 0.1, 30)), [i % 2 == 0 for i in range(30)], "2026-04") + _rows(
        "lanes_v1", list(rng.uniform(0.02, 0.04, 30)), [i % 2 == 0 for i in range(30)], "2026-04"
    )
    rows = fresh + pre
    rows[-1] = {**rows[-1], "usd": attempt_cost, "solved": False}
    return rows


def test_specifications_cover_every_choice_and_registered_comes_first() -> None:
    by_attempt = {"last": _two_tier_rows(0.02), "first": _two_tier_rows(0.5)}
    specs = specifications(by_attempt, "control", "lanes_v1", m=0.2, seed=3, b=400)
    assert len(specs) == 3 * 2 * 3 * 2 * 2
    assert specs[0]["registered"] and sum(s["registered"] for s in specs) == 1
    reg = specs[0]
    rows = by_attempt["last"]
    c = [r for r in rows if r["variant"] == "control"]
    t = [r for r in rows if r["variant"] == "lanes_v1"]

    def cps(sel: list[dict[str, object]]) -> float:
        return float(np.mean([float(r["usd"]) for r in sel])) / float(np.mean([bool(r["solved"]) for r in sel]))  # type: ignore[arg-type]

    assert reg["cps_change_pct"] == pytest.approx((cps(t) / cps(c) - 1) * 100)
    lo, hi = reg["cps_change_pct_ci"]
    assert lo <= reg["cps_change_pct"] <= hi
    # The attempt choice moves only the cost side here: same solves, one cost differs.
    pick = {(s["task_set"], s["attempt"], s["cost_stat"], s["prior"], s["outliers"]): s for s in specs}
    last = pick[("all", "last", "mean", "beta11", "as_is")]
    first = pick[("all", "first", "mean", "beta11", "as_is")]
    assert last["guardrail_posterior"] == first["guardrail_posterior"]
    assert last["cps_change_pct"] != first["cps_change_pct"]
    # Winsorising pulls the outlying first-attempt cost in.
    wins = pick[("all", "first", "mean", "beta11", "winsorised")]
    assert wins["cps_change_pct"] < first["cps_change_pct"]


def test_summary_finds_the_failures_in_the_fresh_tier() -> None:
    by_attempt = {"last": _two_tier_rows(0.02), "first": _two_tier_rows(0.02)}
    specs = specifications(by_attempt, "control", "lanes_v1", m=0.2, seed=3, b=400)
    out = summarise(specs, 0.2)
    assert out["n_specs"] == 72
    assert out["guardrail_fail"] == out["fresh_specs"] == out["fresh_specs_failing"] == 24
    assert out["guardrail_fail_only_fresh"] and out["guardrail_fail_task_sets"] == "fresh tier"
    assert out["non_fresh_specs_failing"] == 0
    assert out["cost_direction"] == 72 and out["both"] == 48
    lo, hi = out["guardrail_posterior_range"]
    assert lo < 0.9 <= hi


def test_empty_tier_is_skipped() -> None:
    rows = _rows("control", [0.1, 0.2, 0.3], [True, False, True], "2026-02") + _rows(
        "lanes_v2", [0.1, 0.2, 0.1], [True, True, False], "2026-02"
    )
    specs = specifications({"last": rows, "first": rows}, "control", "lanes_v2", m=0.15, seed=1, b=200)
    assert {s["task_set"] for s in specs} == {"all", "pre_cutoff"}
    assert summarise(specs, 0.15)["n_specs"] == 48
    assert summarise([], 0.15)["n_specs"] == 0
