"""Bootstrap determinism, Beta posterior math and SRM detection."""

from __future__ import annotations

import numpy as np
import pytest
from scipy import integrate, stats

from analysis.analyse import (
    ArmData,
    beta_interval,
    beta_posterior,
    bootstrap_arm,
    percentile_ci,
    posterior_delta_draws,
    srm_test,
)


def _arm(seed: int, n: int = 150) -> ArmData:
    rng = np.random.default_rng(seed)
    cost = rng.lognormal(-0.5, 0.4, n)
    solved = (rng.random(n) < 0.4).astype(np.float64)
    return ArmData("control", cost, solved, [{} for _ in range(n)])


def test_bootstrap_is_deterministic_for_a_seed() -> None:
    arm = _arm(1)
    a = bootstrap_arm(arm, np.random.default_rng([42, 1]))
    b = bootstrap_arm(arm, np.random.default_rng([42, 1]))
    assert np.array_equal(a.mean, b.mean)
    assert np.array_equal(a.cost_per_solve, b.cost_per_solve)
    assert a.mean.size == 10_000
    c = bootstrap_arm(arm, np.random.default_rng([43, 1]))
    assert not np.array_equal(a.mean, c.mean)


def test_bootstrap_ci_brackets_the_mean() -> None:
    arm = _arm(2)
    boot = bootstrap_arm(arm, np.random.default_rng(0))
    lo, hi = percentile_ci(boot.mean)
    assert lo < arm.cost.mean() < hi
    se = arm.cost.std(ddof=1) / np.sqrt(arm.n)
    assert hi - lo == pytest.approx(2 * 1.96 * se, rel=0.1)


def test_beta_posterior_parameters_and_interval() -> None:
    assert beta_posterior(30, 100) == (31.0, 71.0)
    lo, hi = beta_interval(30, 100)
    assert lo == pytest.approx(stats.beta.ppf(0.025, 31, 71))
    assert hi == pytest.approx(stats.beta.ppf(0.975, 31, 71))
    assert beta_interval(0, 0) == pytest.approx([0.025, 0.975])


def test_probability_drop_within_margin_matches_numerical_integral() -> None:
    s_c, n_c, s_t, n_t, m = 50, 120, 45, 118, 0.05
    draws = posterior_delta_draws(s_c, n_c, s_t, n_t, np.random.default_rng(5))
    mc = float(np.mean(draws > -m))
    a_c, b_c = beta_posterior(s_c, n_c)
    a_t, b_t = beta_posterior(s_t, n_t)

    # P(p_t - p_c > -m) = integral over p_c of f_c(p_c) * P(p_t > p_c - m)
    def integrand(pc: float) -> float:
        return float(stats.beta.pdf(pc, a_c, b_c) * stats.beta.sf(pc - m, a_t, b_t))

    exact, _ = integrate.quad(integrand, 0, 1, limit=200)
    assert mc == pytest.approx(exact, abs=0.005)


def test_srm_balanced_not_flagged() -> None:
    res = srm_test(120, 118)
    assert res["flag"] is False
    assert res["p"] > 0.5


def test_srm_imbalanced_flagged() -> None:
    res = srm_test(160, 80)
    assert res["flag"] is True
    assert res["chi2"] == pytest.approx((40**2 / 120) * 2)
    assert res["p"] < 0.001
