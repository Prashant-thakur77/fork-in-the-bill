"""mSPRT always-valid p-values on synthetic data with known behaviour."""

from __future__ import annotations

import itertools
import math

import numpy as np
import pytest
from scipy import integrate, stats

from analysis.always_valid import (
    ALPHA,
    MIN_PER_ARM,
    analyse,
    interval_half_width,
    log_mixture_lr,
    sequence,
    tau_from_pilot,
)


def test_closed_form_matches_the_mixture_integral() -> None:
    # eq. 7 with a normal statistic: integral of N(est; theta, v) / N(est; 0, v) against N(0, tau^2)
    est, v, tau = 0.03, 0.0004, 0.05

    def integrand(theta: float) -> float:
        ratio = stats.norm.pdf(est, theta, math.sqrt(v)) / stats.norm.pdf(est, 0.0, math.sqrt(v))
        return float(ratio * stats.norm.pdf(theta, 0.0, tau))

    numeric, _ = integrate.quad(integrand, -1, 1, points=[0.0, est], limit=200)
    assert math.exp(log_mixture_lr(est, v, tau**2)) == pytest.approx(numeric, rel=1e-6)


def test_paired_form_from_the_paper() -> None:
    # n pairs with common variance sigma^2: V_n = 2 sigma^2 / n
    n, sigma2, tau2, diff = 40, 0.01, 0.002, 0.02
    paper = 0.5 * math.log(2 * sigma2 / (2 * sigma2 + n * tau2)) + n**2 * tau2 * diff**2 / (
        4 * sigma2 * (2 * sigma2 + n * tau2)
    )
    assert log_mixture_lr(diff, 2 * sigma2 / n, tau2) == pytest.approx(paper)


def test_interval_edge_is_where_the_test_rejects() -> None:
    est, v, tau2 = 0.01, 0.0001, 0.0009
    half = interval_half_width(v, tau2)
    for theta0 in (est - half, est + half):
        assert log_mixture_lr(est, v, tau2, theta0) == pytest.approx(math.log(1 / ALPHA))


def _stream(rng: np.random.Generator, n: int, effect: float, kind: str) -> list[tuple[bool, float, str]]:
    arm = rng.integers(0, 2, n).astype(bool)
    if kind == "mean":
        base = rng.lognormal(math.log(0.05), 0.8, n)
        values = np.where(arm, base * (1 + effect), base)
    else:
        values = (rng.random(n) < np.where(arm, 0.45 + effect, 0.45)).astype(float)
    return [(bool(a), float(x), f"t{k:05d}") for k, (a, x) in enumerate(zip(arm, values, strict=True))]


@pytest.mark.parametrize(("kind", "tau"), [("mean", 0.04), ("proportion", 0.11)])
def test_null_data_rarely_crosses(kind: str, tau: float) -> None:
    rng = np.random.default_rng(20261127)
    sims = 400
    crossed = sum(sequence(_stream(rng, 150, 0.0, kind), tau, kind)[-1].p <= ALPHA for _ in range(sims))
    assert crossed / sims <= ALPHA


def test_large_cost_effect_crosses_early() -> None:
    # Treatment costs 60% less. Most streams cross, and well before the end.
    rng = np.random.default_rng(7)
    firsts: list[float] = []
    for _ in range(100):
        steps = sequence(_stream(rng, 150, -0.6, "mean"), 0.04, "mean")
        first = next((s.k for s in steps if s.p_step <= ALPHA), None)
        firsts.append(math.inf if first is None else first)
        if first is not None:
            estimate = steps[first - 1].estimate
            assert estimate is not None and estimate < 0
    assert sum(math.isfinite(f) for f in firsts) >= 90
    assert float(np.median(firsts)) < 60


def test_p_is_monotone_and_waits_for_both_arms() -> None:
    rng = np.random.default_rng(3)
    steps = sequence(_stream(rng, 120, -0.3, "mean"), 0.04, "mean")
    ps = [s.p for s in steps]
    assert all(b <= a for a, b in itertools.pairwise(ps))
    for s in steps:
        if min(s.n_control, s.n_treatment) < MIN_PER_ARM:
            assert s.log_lambda is None and s.p == 1.0
    lo = [s.lo for s in steps if s.lo is not None]
    hi = [s.hi for s in steps if s.hi is not None]
    assert all(b >= a for a, b in itertools.pairwise(lo))
    assert all(b <= a for a, b in itertools.pairwise(hi))


def _rows(costs: list[float], solved: list[bool], variant: str, start: int = 0) -> list[dict[str, object]]:
    return [
        {
            "identity": f"swelive:fixture__{variant}-{i}",
            "variant": variant,
            "usd": c,
            "solved": s,
            "finished_at": f"2026-11-27T{(start + 2 * i) // 60:02d}:{(start + 2 * i) % 60:02d}:00+00:00",
        }
        for i, (c, s) in enumerate(zip(costs, solved, strict=True))
    ]


def test_tau_rule_reads_the_pilot_difference() -> None:
    pilot = _rows([0.10, 0.20], [True, False], "control") + _rows([0.05, 0.05], [False, False], "lanes_v1")
    taus = tau_from_pilot(pilot)
    assert taus is not None
    assert taus["tau_cost"] == pytest.approx(0.10)
    assert taus["tau_solve"] == pytest.approx(0.5)
    same = _rows([0.1, 0.3], [True, False], "control") + _rows([0.2, 0.2], [True, False], "lanes_v1")
    fallback = tau_from_pilot(same)
    assert fallback is not None and fallback["tau_cost"] > 0 and fallback["tau_solve"] > 0
    assert tau_from_pilot(_rows([0.1], [True], "control")) is None


def test_analyse_reports_a_harmful_solve_crossing() -> None:
    rng = np.random.default_rng(11)
    n = 80
    rows = _rows(list(rng.lognormal(math.log(0.08), 0.5, n)), [True] * n, "control") + _rows(
        list(rng.lognormal(math.log(0.03), 0.5, n)), [bool(rng.random() < 0.15) for _ in range(n)], "lanes_v1", 1
    )
    pilot = _rows([0.12, 0.10], [True, False], "control") + _rows([0.07, 0.07], [True, False], "lanes_v1")
    out = analyse(rows, pilot, "lanes_v1")
    assert out["n_tasks"] == 2 * n
    assert out["first_evaluated_at"] >= 2 * MIN_PER_ARM - 1
    assert out["cost"]["crossed"] and out["cost"]["estimate"] < 0
    assert out["cost"]["ci_final"][1] < 0
    assert out["solve"]["crossed_harmful"] and out["solve"]["first_harmful_cross_at"] is not None
    assert out["solve"]["estimate_pp"] < 0


def test_analyse_without_pilot_says_so() -> None:
    out = analyse(_rows([0.1] * 3, [True] * 3, "control"), [], "lanes_v1")
    assert "note" in out and "cost" not in out
