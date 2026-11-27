"""Always-valid p-values for a test that was watched while it ran (secondary, added after exp1 ended).

The live board showed each arm's running totals during experiment 1 (DECISIONS.md, D24). A
fixed-horizon p-value read at a moment chosen by looking at the data is not valid, so this module
replays the run in the order tasks finished and computes a p-value that stays valid however often
it is looked at: the mixture sequential probability ratio test (mSPRT) of Johari, Koomen, Pekelis
and Walsh, "Peeking at A/B Tests: Why it matters, and what to do about it" (KDD 2017). Equation
numbers below are those of the extended version, Johari, Pekelis and Walsh, "Always Valid
Inference: Continuous Monitoring of A/B Tests" (arXiv:1512.04922v3).

It is a robustness reading, labelled secondary, and it does not change the registered decision
(DECISIONS.md, D29).

Formulas
--------
Mixture likelihood ratio of the effect theta against the null theta0, mixing distribution H (eq. 7):

    Lambda_n = integral over theta of (f_theta(s_n) / f_theta0(s_n))^n dH(theta)

The test rejects the first time Lambda_n >= 1/alpha (eq. 8). The always-valid p-value is the running
minimum of 1/Lambda (Theorem 1, part 1; it is non-increasing in n):

    p_0 = 1,    p_n = min(p_{n-1}, 1 / Lambda_n)

For the two-stream case the paper takes the difference of the arms' means as a normal statistic
with known variance (section 6.1, f_theta(w) ~ phi((y - x - theta) / sqrt(2 sigma^2)) for pairs w),
and for binary outcomes it plugs the sample means into the variance p0(1 - p0) + p1(1 - p1). With
a normal mixing distribution H = N(theta0, tau^2) the integral has a closed form. Writing theta_n
for the treatment mean minus the control mean and V_n for its variance,

    Lambda_n = sqrt(V_n / (V_n + tau^2)) * exp( tau^2 (theta_n - theta0)^2 / (2 V_n (V_n + tau^2)) )

which for n pairs with V_n = 2 sigma^2 / n is the paper's
sqrt(2 sigma^2 / (2 sigma^2 + n tau^2)) * exp(n^2 tau^2 (Ybar - Xbar - theta0)^2 / (4 sigma^2 (2 sigma^2 + n tau^2))).
Tasks here arrive one at a time and the arms are not paired, so V_n = s_c^2 / n_c + s_t^2 / n_t,
the variance of a difference of independent means. Inverting Lambda_n < 1/alpha gives the
always-valid interval at step n,

    theta_n +/- sqrt( V_n (V_n + tau^2) / tau^2 * (2 log(1/alpha) + log((V_n + tau^2) / V_n)) )

and the reported interval is the running intersection of these, as the paper defines it.

Choices fixed before the exp1 trajectory was computed
-----------------------------------------------------
- Order: the analysed tasks (last attempt per identity, exclusions dropped, as in the main readout)
  sorted by `finished_at`, ties broken by identity. The statistic is evaluated after every task.
- Mixing variance tau^2, from the pilot runs only (runs/pilot-*): tau is the absolute difference
  between the pilot arms, lanes_v1 minus control, in mean cost per task (cost test) and in solve
  rate (solve test). The paper's run-time-optimal tau roughly matches the spread of the effects one
  expects (section 5.4, eq. 12), and the pilot is the only pre-experiment estimate of that effect.
  If a pilot difference is exactly zero, tau falls back to the pilot's standard error of that
  difference. Experiment 2 uses the same pilot tau. Any tau fixed in advance keeps the test valid;
  tau only moves how soon a real effect is detected.
- Variance: the running sample variance of each arm for cost, and p(1 - p) from each arm's running
  solve rate for solve rate, as in the paper's binary case. Plugging in an estimated variance makes
  the guarantee approximate, more so for skewed costs at small n, so nothing is evaluated until each
  arm has MIN_PER_ARM tasks. On simulated null data with log-normal costs the false-crossing rate
  stays under alpha from that point (tests/unit/test_always_valid.py).
- alpha = 0.05. Both tests are two-sided. A solve-rate crossing is called harmful when the step
  that crosses has lanes_v1 solving less than control.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

ALPHA = 0.05
MIN_PER_ARM = 10
CONTROL = "control"
# DECISIONS.md, D24: the live board went public at 05:55Z on 2026-11-27, while exp1 was running.
BOARD_LIVE_AT = "2026-11-27T05:55:00+00:00"
TAU_RULE = (
    "tau = |pilot lanes_v1 - pilot control| for mean cost and for solve rate, from runs/pilot-* only; "
    "the pilot's standard error of that difference if the difference is zero"
)


@dataclass
class Step:
    """The state after the k-th analysed task finished (k counts tasks in both arms)."""

    k: int
    finished_at: str
    n_control: int
    n_treatment: int
    estimate: float | None  # treatment minus control
    variance: float | None  # V_n
    log_lambda: float | None  # None before both arms reach MIN_PER_ARM or while V_n is zero
    p_step: float  # min(1, 1 / Lambda_n)
    p: float  # running minimum: the always-valid p-value
    lo: float | None  # running intersection of the always-valid interval
    hi: float | None


def log_mixture_lr(theta_hat: float, v: float, tau2: float, theta0: float = 0.0) -> float:
    """log Lambda_n for a normal statistic with variance v and mixing distribution N(theta0, tau2)."""
    if v <= 0 or tau2 <= 0:
        raise ValueError("variance and tau^2 must be positive")
    return 0.5 * math.log(v / (v + tau2)) + tau2 * (theta_hat - theta0) ** 2 / (2 * v * (v + tau2))


def interval_half_width(v: float, tau2: float, alpha: float = ALPHA) -> float:
    """Half-width of {theta0 : Lambda_n(theta0) < 1/alpha} around the estimate."""
    return math.sqrt(v * (v + tau2) / tau2 * (2 * math.log(1 / alpha) + math.log((v + tau2) / v)))


class _Running:
    """Count, sum and sum of squares, so each step is O(1)."""

    def __init__(self) -> None:
        self.n = 0
        self.s = 0.0
        self.ss = 0.0

    def add(self, x: float) -> None:
        self.n += 1
        self.s += x
        self.ss += x * x

    @property
    def mean(self) -> float:
        return self.s / self.n

    def var_of_mean(self, kind: str) -> float:
        if kind == "proportion":
            p = self.mean
            return p * (1 - p) / self.n
        sample_var = max(self.ss - self.n * self.mean**2, 0.0) / (self.n - 1)
        return sample_var / self.n


def sequence(
    stream: Iterable[tuple[bool, float, str]],
    tau: float,
    kind: str = "mean",
    alpha: float = ALPHA,
    min_per_arm: int = MIN_PER_ARM,
) -> list[Step]:
    """Replay (is_treatment, value, finished_at) in order and return one Step per observation.

    `kind` is "mean" (plug-in sample variances) or "proportion" (plug-in p(1 - p)).
    """
    if kind not in ("mean", "proportion"):
        raise ValueError(f"unknown kind {kind!r}")
    if tau <= 0:
        raise ValueError("tau must be positive")
    tau2 = tau * tau
    arms = {False: _Running(), True: _Running()}
    p_run, lo_run, hi_run = 1.0, -math.inf, math.inf
    steps: list[Step] = []
    for k, (is_treatment, value, finished_at) in enumerate(stream, start=1):
        arms[is_treatment].add(float(value))
        c, t = arms[False], arms[True]
        estimate = variance = log_lam = None
        p_step = 1.0
        if c.n and t.n:
            estimate = t.mean - c.mean
        if c.n >= min_per_arm and t.n >= min_per_arm and estimate is not None:
            variance = c.var_of_mean(kind) + t.var_of_mean(kind)
            if variance > 0:
                log_lam = log_mixture_lr(estimate, variance, tau2)
                p_step = min(1.0, math.exp(-log_lam)) if log_lam > -700 else 1.0
                half = interval_half_width(variance, tau2, alpha)
                lo_run, hi_run = max(lo_run, estimate - half), min(hi_run, estimate + half)
        p_run = min(p_run, p_step)
        steps.append(
            Step(
                k=k,
                finished_at=finished_at,
                n_control=c.n,
                n_treatment=t.n,
                estimate=estimate,
                variance=variance,
                log_lambda=log_lam,
                p_step=p_step,
                p=p_run,
                lo=lo_run if math.isfinite(lo_run) else None,
                hi=hi_run if math.isfinite(hi_run) else None,
            )
        )
    return steps


# --------------------------------------------------------------------------------------
# Inputs from the run tables


def finish_order(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Analysed rows in the order the tasks finished."""
    return sorted(rows, key=lambda r: (str(r["finished_at"]), str(r["identity"])))


def _arm_values(rows: list[dict[str, Any]], variant: str) -> tuple[list[float], list[float]]:
    sel = [r for r in rows if r["variant"] == variant]
    return [float(r["usd"]) for r in sel], [1.0 if r["solved"] else 0.0 for r in sel]


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def _se_diff(a: list[float], b: list[float]) -> float:
    def var(xs: list[float]) -> float:
        m = _mean(xs)
        return sum((x - m) ** 2 for x in xs) / (len(xs) - 1) if len(xs) > 1 else 0.0

    return math.sqrt(var(a) / len(a) + var(b) / len(b))


def tau_from_pilot(pilot_rows: list[dict[str, Any]], control: str = CONTROL) -> dict[str, Any] | None:
    """The mixing scales for cost and solve rate from the pilot's two arms (rule in TAU_RULE)."""
    variants = sorted({str(r["variant"]) for r in pilot_rows})
    others = [v for v in variants if v != control]
    if control not in variants or not others:
        return None
    treatment = others[0]
    cost_c, solve_c = _arm_values(pilot_rows, control)
    cost_t, solve_t = _arm_values(pilot_rows, treatment)
    d_cost = _mean(cost_t) - _mean(cost_c)
    d_solve = _mean(solve_t) - _mean(solve_c)
    tau_cost = abs(d_cost) or _se_diff(cost_t, cost_c)
    tau_solve = abs(d_solve) or _se_diff(solve_t, solve_c)
    if tau_cost <= 0 or tau_solve <= 0:
        return None
    return {
        "pilot_treatment": treatment,
        "pilot_n_control": len(cost_c),
        "pilot_n_treatment": len(cost_t),
        "pilot_delta_cost": d_cost,
        "pilot_delta_solve": d_solve,
        "tau_cost": tau_cost,
        "tau_solve": tau_solve,
    }


def trajectories(
    rows: list[dict[str, Any]], treatment: str, taus: dict[str, Any], alpha: float = ALPHA
) -> dict[str, list[Step]]:
    ordered = finish_order(rows)
    cost = [(r["variant"] == treatment, float(r["usd"]), str(r["finished_at"])) for r in ordered]
    solve = [(r["variant"] == treatment, 1.0 if r["solved"] else 0.0, str(r["finished_at"])) for r in ordered]
    return {
        "cost": sequence(cost, taus["tau_cost"], "mean", alpha),
        "solve": sequence(solve, taus["tau_solve"], "proportion", alpha),
    }


def _pp(x: float | None) -> float | None:
    return None if x is None else x * 100


def _p_at(steps: list[Step], before: str) -> float | None:
    seen = [s for s in steps if s.finished_at < before]
    return seen[-1].p if seen else None


def analyse(
    rows: list[dict[str, Any]],
    pilot_rows: list[dict[str, Any]],
    treatment: str,
    alpha: float = ALPHA,
) -> dict[str, Any]:
    """Summary for numbers.json: `<exp>.secondary.always_valid`."""
    out: dict[str, Any] = {
        "label": "secondary",
        "added_after_exp1": True,
        "method": "mSPRT, normal mixing distribution N(0, tau^2), plug-in variance",
        "alpha": alpha,
        "min_per_arm": MIN_PER_ARM,
        "order": "finished_at",
        "tau_rule": TAU_RULE,
        "n_tasks": len(rows),
    }
    taus = tau_from_pilot(pilot_rows)
    if taus is None or not rows:
        out["note"] = "no pilot with both arms, or no analysed tasks"
        return out
    traj = trajectories(rows, treatment, taus, alpha)
    cost, solve = traj["cost"], traj["solve"]
    evaluated = [s.k for s in cost if s.log_lambda is not None]
    out.update(
        pilot={k: v for k, v in taus.items() if k.startswith("pilot_")},
        first_evaluated_at=evaluated[0] if evaluated else None,
        board_live_after_tasks=sum(1 for s in cost if s.finished_at < BOARD_LIVE_AT),
    )

    first_cost = next((s for s in cost if s.p_step <= alpha), None)
    last_c = cost[-1]
    out["cost"] = {
        "tau": taus["tau_cost"],
        "estimate": last_c.estimate,
        "p_final": last_c.p,
        "ci_final": [last_c.lo, last_c.hi],
        "crossed": first_cost is not None,
        "first_cross_at": first_cost.k if first_cost else None,
        "first_cross_finished_at": first_cost.finished_at if first_cost else None,
        "first_cross_estimate": first_cost.estimate if first_cost else None,
        "p_at_board_live": _p_at(cost, BOARD_LIVE_AT),
    }

    harmful = [s for s in solve if s.p_step <= alpha and s.estimate is not None and s.estimate < 0]
    last_s = solve[-1]
    out["solve"] = {
        "tau_pp": taus["tau_solve"] * 100,
        "estimate_pp": _pp(last_s.estimate),
        "p_final": last_s.p,
        "ci_final_pp": [_pp(last_s.lo), _pp(last_s.hi)],
        "crossed": any(s.p_step <= alpha for s in solve),
        "crossed_harmful": bool(harmful),
        "first_harmful_cross_at": harmful[0].k if harmful else None,
        "p_at_board_live": _p_at(solve, BOARD_LIVE_AT),
    }
    return out
