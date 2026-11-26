"""Experiment readout: per-arm statistics, deltas, SRM, CUPED, traits, Flagsmith agreement.

Reads runs/<exp>/*.jsonl (converted to Parquet first), queries them with DuckDB, and writes
analysis/out/numbers.json in the shape fixed by docs/interfaces.md, then refreshes the
generated block of analysis/results.md and every number marker.

All randomness comes from `numpy.random.default_rng` seeded from `--seed`, so two runs on
the same data give identical numbers.

Conventions: costs in USD; rates, shares and probabilities as 0-1 fractions; `*_pct` in
percent; `*_pp` in percentage points; the guardrail margin m as a 0-1 solve-rate fraction.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import duckdb
import numpy as np
import typer
from numpy.typing import NDArray
from scipy import stats

from analysis import pull_results
from analysis.render_docs import process as render_process
from analysis.to_parquet import convert_all, read_jsonl
from integrity.verify_ledger import verify as verify_ledger
from tasks.model import TaskInstance

SEED = 20_260_201
N_BOOT = 10_000
N_POSTERIOR = 200_000
CONTROL = "control"
SRM_ALPHA = 0.001
FLAGSMITH_BAR = 0.95
GUARDRAIL_BAR = 0.90
RIDGE_ALPHA = 1.0

FloatArray = NDArray[np.float64]


# --------------------------------------------------------------------------------------
# Loading


@dataclass
class ArmData:
    variant: str
    cost: FloatArray
    solved: FloatArray  # 0/1
    rows: list[dict[str, Any]]

    @property
    def n(self) -> int:
        return len(self.rows)


_TASKS_SQL = """
WITH t AS (SELECT * FROM read_parquet(?)),
last AS (
  SELECT * FROM t
  QUALIFY row_number() OVER (PARTITION BY identity ORDER BY attempt DESC, finished_at DESC) = 1
),
ex AS (SELECT DISTINCT identity FROM read_parquet(?))
SELECT last.*, (ex.identity IS NOT NULL OR last.outcome = 'infra_error') AS excluded
FROM last LEFT JOIN ex ON last.identity = ex.identity
ORDER BY last.variant, last.identity
"""

_ARM_SQL = """
SELECT
  variant,
  count(*) AS n_exposed,
  count(*) FILTER (WHERE excluded) AS n_excluded,
  count(*) FILTER (WHERE NOT excluded) AS n_analysed,
  avg(usd) FILTER (WHERE NOT excluded) AS cost_mean,
  median(usd) FILTER (WHERE NOT excluded) AS cost_median,
  count(*) FILTER (WHERE NOT excluded AND solved) AS solves,
  sum(usd_delegate) FILTER (WHERE NOT excluded)
    / nullif(sum(usd) FILTER (WHERE NOT excluded), 0) AS delegate_share_cost,
  sum(tokens_delegate) FILTER (WHERE NOT excluded)
    / nullif(sum(tokens_main + tokens_delegate) FILTER (WHERE NOT excluded), 0)
    AS delegate_share_tokens,
  avg(turns) FILTER (WHERE NOT excluded) AS turns_mean,
  avg(seconds) FILTER (WHERE NOT excluded) AS seconds_mean
FROM tasks GROUP BY variant ORDER BY variant
"""


class Run:
    """One experiment's Parquet tables, held in an in-memory DuckDB connection."""

    def __init__(self, parquet_dir: Path) -> None:
        self.con = duckdb.connect()
        self.con.execute(
            "CREATE TABLE tasks AS " + _TASKS_SQL,
            [str(parquet_dir / "tasks.parquet"), str(parquet_dir / "exclusions.parquet")],
        )
        self.exclusions = self._rows("SELECT * FROM read_parquet(?)", [str(parquet_dir / "exclusions.parquet")])

    def _rows(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        rel = self.con.execute(sql, params or [])
        cols = [d[0] for d in rel.description or []]
        return [dict(zip(cols, r, strict=True)) for r in rel.fetchall()]

    def all_rows(self) -> list[dict[str, Any]]:
        return self._rows("SELECT * FROM tasks")

    def arm_summary(self) -> dict[str, dict[str, Any]]:
        return {r["variant"]: r for r in self._rows(_ARM_SQL)}

    def arm(self, variant: str) -> ArmData:
        rows = self._rows("SELECT * FROM tasks WHERE variant = ? AND NOT excluded ORDER BY identity", [variant])
        return ArmData(
            variant=variant,
            cost=np.array([float(r["usd"]) for r in rows], dtype=np.float64),
            solved=np.array([1.0 if r["solved"] else 0.0 for r in rows], dtype=np.float64),
            rows=rows,
        )

    def unassigned_exclusions(self) -> int:
        """Excluded identities with no task record, so no known arm."""
        known = {r["identity"] for r in self._rows("SELECT identity FROM tasks")}
        return len({e["identity"] for e in self.exclusions} - known)


# --------------------------------------------------------------------------------------
# Statistics


def percentile_ci(samples: FloatArray, level: float = 0.95) -> list[float]:
    finite = samples[np.isfinite(samples)]
    if finite.size == 0:
        return [math.nan, math.nan]
    lo, hi = np.percentile(finite, [(1 - level) / 2 * 100, (1 + level) / 2 * 100])
    return [float(lo), float(hi)]


def bootstrap_indices(n: int, rng: np.random.Generator, b: int = N_BOOT) -> NDArray[np.int64]:
    return rng.integers(0, n, size=(b, n))


@dataclass
class ArmBoot:
    mean: FloatArray
    median: FloatArray
    cost_per_solve: FloatArray


def bootstrap_arm(arm: ArmData, rng: np.random.Generator, b: int = N_BOOT) -> ArmBoot:
    if arm.n == 0:
        nan = np.full(b, math.nan)
        return ArmBoot(nan, nan, nan)
    idx = bootstrap_indices(arm.n, rng, b)
    cost = arm.cost[idx]
    mean = cost.mean(axis=1)
    rate = arm.solved[idx].mean(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        cps = np.where(rate > 0, mean / rate, math.inf)
    return ArmBoot(mean=mean, median=np.median(cost, axis=1), cost_per_solve=cps)


def beta_posterior(solves: int, n: int) -> tuple[float, float]:
    """Beta(1,1) prior with a binomial likelihood gives Beta(1 + s, 1 + n - s)."""
    return 1.0 + solves, 1.0 + n - solves


def beta_interval(solves: int, n: int, level: float = 0.95) -> list[float]:
    a, b = beta_posterior(solves, n)
    q = np.asarray(stats.beta.ppf([(1 - level) / 2, (1 + level) / 2], a, b), dtype=np.float64)
    return [float(q[0]), float(q[1])]


def posterior_delta_draws(
    s_c: int, n_c: int, s_t: int, n_t: int, rng: np.random.Generator, draws: int = N_POSTERIOR
) -> FloatArray:
    """Draws of p_treatment - p_control from the two independent Beta posteriors."""
    a_c, b_c = beta_posterior(s_c, n_c)
    a_t, b_t = beta_posterior(s_t, n_t)
    return rng.beta(a_t, b_t, draws) - rng.beta(a_c, b_c, draws)


def srm_test(n_control: int, n_treatment: int, alpha: float = SRM_ALPHA) -> dict[str, Any]:
    total = n_control + n_treatment
    if total == 0:
        return {"chi2": None, "p": None, "flag": False, "expected_split": [0.5, 0.5]}
    res = stats.chisquare([n_control, n_treatment], [total / 2, total / 2])
    chi2, p = float(res.statistic), float(res.pvalue)
    return {"chi2": chi2, "p": p, "flag": p < alpha, "expected_split": [0.5, 0.5]}


def ratio_or_none(num: float, den: float) -> float | None:
    return num / den if den else None


# --------------------------------------------------------------------------------------
# CUPED covariate: ridge regression trained on pilot tasks only, pre-task features only


@dataclass
class RidgeModel:
    languages: list[str]
    mean: FloatArray
    scale: FloatArray
    coef: FloatArray
    intercept: float

    def predict(self, x: FloatArray) -> FloatArray:
        return ((x - self.mean) / self.scale) @ self.coef + self.intercept


def load_pool_lengths(run_dir: Path, repo_root: Path) -> dict[str, int]:
    """instance_id -> len(problem_statement), from the pool named in meta.json."""
    meta_path = run_dir / "meta.json"
    if not meta_path.exists():
        return {}
    pool = json.loads(meta_path.read_text(encoding="utf-8")).get("pool_file")
    if not pool:
        return {}
    pool_path = Path(pool)
    candidates = [pool_path] if pool_path.is_absolute() else [repo_root / pool_path, run_dir / pool_path]
    for cand in candidates:
        if cand.exists() and cand.suffix == ".jsonl":
            out: dict[str, int] = {}
            for rec in read_jsonl(cand):
                inst = TaskInstance.model_validate(rec)
                out[inst.instance_id] = len(inst.problem_statement)
            return out
    return {}


def _num(v: Any) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return f if math.isfinite(f) else 0.0


def feature_matrix(rows: list[dict[str, Any]], languages: list[str], ps_len: dict[str, int]) -> FloatArray:
    out = np.zeros((len(rows), 3 + len(languages)), dtype=np.float64)
    for i, r in enumerate(rows):
        out[i, 0] = _num(r.get("trait_gold_files"))
        out[i, 1] = _num(r.get("trait_gold_lines"))
        out[i, 2] = float(ps_len.get(r["instance_id"], _num(r.get("trait_problem_statement_len"))))
        lang = r.get("trait_language")
        if lang in languages:
            out[i, 3 + languages.index(str(lang))] = 1.0
    return out


def fit_ridge(rows: list[dict[str, Any]], ps_len: dict[str, int], alpha: float = RIDGE_ALPHA) -> RidgeModel:
    languages = sorted({str(r["trait_language"]) for r in rows if r.get("trait_language") is not None})
    x = feature_matrix(rows, languages, ps_len)
    y = np.array([float(r["usd"]) for r in rows], dtype=np.float64)
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale == 0] = 1.0
    z = (x - mean) / scale
    coef = np.linalg.solve(z.T @ z + alpha * np.eye(z.shape[1]), z.T @ (y - y.mean()))
    return RidgeModel(languages, mean, scale, coef, float(y.mean()))


def cuped(control: ArmData, treatment: ArmData, model: RidgeModel | None, ps_len: dict[str, int]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "label": "secondary",
        "covariate": "pilot_pred_cost",
        "variance_reduction_pct": None,
        "theta": None,
        "delta_cost_mean": None,
        "delta_cost_mean_ci": [None, None],
        "ci_method": "normal approximation",
    }
    if model is None or control.n < 2 or treatment.n < 2:
        out["note"] = "no pilot data or too few analysed tasks"
        return out
    xc = model.predict(feature_matrix(control.rows, model.languages, ps_len))
    xt = model.predict(feature_matrix(treatment.rows, model.languages, ps_len))
    x_all = np.concatenate([xc, xt])
    y_all = np.concatenate([control.cost, treatment.cost])
    var_x = float(np.var(x_all, ddof=1))
    if var_x == 0:
        out["note"] = "covariate has zero variance"
        return out
    theta = float(np.cov(y_all, x_all, ddof=1)[0, 1] / var_x)
    mx = float(x_all.mean())
    yc = control.cost - theta * (xc - mx)
    yt = treatment.cost - theta * (xt - mx)
    raw_var = float(np.var(control.cost, ddof=1) + np.var(treatment.cost, ddof=1))
    adj_var = float(np.var(yc, ddof=1) + np.var(yt, ddof=1))
    delta = float(yt.mean() - yc.mean())
    se = math.sqrt(float(np.var(yt, ddof=1)) / treatment.n + float(np.var(yc, ddof=1)) / control.n)
    out.update(
        variance_reduction_pct=(1 - adj_var / raw_var) * 100 if raw_var else None,
        theta=theta,
        delta_cost_mean=delta,
        delta_cost_mean_ci=[delta - 1.96 * se, delta + 1.96 * se],
    )
    return out


# --------------------------------------------------------------------------------------
# Per-trait readout


def _trait_level_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(rows)
    solves = sum(1 for r in rows if r["solved"])
    cost = [float(r["usd"]) for r in rows]
    return {
        "n": n,
        "solves": solves,
        "solve_rate": solves / n if n else None,
        "cost_mean": float(np.mean(cost)) if n else None,
    }


def by_trait(control: ArmData, treatment: ArmData) -> tuple[dict[str, Any], dict[str, Any]]:
    rows = control.rows + treatment.rows
    gold = np.array([_num(r.get("trait_gold_lines")) for r in rows], dtype=np.float64)
    cuts = [float(c) for c in np.quantile(gold, [1 / 3, 2 / 3])] if gold.size else [0.0, 0.0]

    def difficulty(r: dict[str, Any]) -> str:
        g = _num(r.get("trait_gold_lines"))
        return "low" if g <= cuts[0] else "mid" if g <= cuts[1] else "high"

    keyers = {
        "difficulty": difficulty,
        "language": lambda r: str(r.get("trait_language") or "unknown"),
        "created_month": lambda r: str(r.get("trait_created_month") or "unknown"),
    }
    out: dict[str, Any] = {}
    for trait, keyer in keyers.items():
        levels: dict[str, Any] = {}
        names = {keyer(r) for r in rows}
        order = ["low", "mid", "high"] if trait == "difficulty" else sorted(names)
        for level in [lv for lv in order if lv in names]:
            entry: dict[str, Any] = {}
            for arm in (control, treatment):
                entry[arm.variant] = _trait_level_stats([r for r in arm.rows if keyer(r) == level])
            c, t = entry[control.variant], entry[treatment.variant]
            if c["n"] and t["n"]:
                entry["delta_solve_pp"] = (t["solve_rate"] - c["solve_rate"]) * 100
                entry["delta_cost_pct"] = (t["cost_mean"] / c["cost_mean"] - 1) * 100 if c["cost_mean"] else None
            else:
                entry["delta_solve_pp"] = None
                entry["delta_cost_pct"] = None
            levels[level] = entry
        out[trait] = levels
    return out, {"difficulty_gold_lines_cutoffs": cuts}


# --------------------------------------------------------------------------------------
# Pre-registration and power


_M_RE = re.compile(r"(?<![A-Za-z_])m\s*(?:=|:)\s*`?([0-9]*\.?[0-9]+)\s*(pp|%)?", re.I)


def prereg_info(prereg_dir: Path, exp: str) -> dict[str, Any]:
    num = exp.removeprefix("exp")
    path = prereg_dir / f"experiment-{num}.md"
    info: dict[str, Any] = {"tag": f"prereg-{exp}", "sha256": None, "m": None, "file": str(path)}
    if path.exists():
        data = path.read_bytes()
        info["sha256"] = hashlib.sha256(data).hexdigest()
        m = _M_RE.search(data.decode("utf-8", errors="replace"))
        if m:
            value = float(m.group(1))
            info["m"] = value / 100 if m.group(2) or value >= 1 else value
    return info


def load_power(path: Path) -> dict[str, Any]:
    if path.exists():
        p = json.loads(path.read_text(encoding="utf-8"))
        return {
            "n_per_arm": p.get("n_per_arm"),
            "mde_solve_pp": p.get("mde_solve_pp"),
            "mde_cost_pct": p.get("mde_cost_pct"),
            "power": p.get("power", 0.8),
        }
    return {"n_per_arm": None, "mde_solve_pp": None, "mde_cost_pct": None, "power": 0.8}


# --------------------------------------------------------------------------------------
# Experiment readout


def arm_block(summary: dict[str, Any] | None, arm: ArmData, boot: ArmBoot) -> dict[str, Any]:
    s = summary or {}
    n = arm.n
    solves = int(arm.solved.sum())
    rate = solves / n if n else None
    mean = float(arm.cost.mean()) if n else None
    return {
        "n_exposed": int(s.get("n_exposed") or 0),
        "n_excluded": int(s.get("n_excluded") or 0),
        "n_analysed": n,
        "cost_mean": mean,
        "cost_mean_ci": percentile_ci(boot.mean),
        "cost_median": float(np.median(arm.cost)) if n else None,
        "cost_median_ci": percentile_ci(boot.median),
        "solve_rate": rate,
        "solve_rate_ci": beta_interval(solves, n),
        "solve_rate_posterior_mean": (1 + solves) / (2 + n),
        "solves": solves,
        "cost_per_solve": ratio_or_none(mean, rate) if mean is not None and rate else None,
        "cost_per_solve_ci": percentile_ci(boot.cost_per_solve),
        "delegate_share_cost": s.get("delegate_share_cost"),
        "delegate_share_tokens": s.get("delegate_share_tokens"),
        "turns_mean": s.get("turns_mean"),
        "seconds_mean": s.get("seconds_mean"),
    }


def flagsmith_block(
    flagsmith_dir: Path, exp: str, control: str, treatment: str
) -> tuple[dict[str, Any], pull_results.FlagsmithSummary | None]:
    found = pull_results.latest_results(flagsmith_dir, exp)
    if found is None:
        return (
            {
                "chance_to_beat_control_cost": None,
                "lift_cost": None,
                "ci_cost": [None, None],
                "solve_rate_status": "not pulled",
                "pulled_at": None,
                "guardrail_loss": None,
                "source_file": None,
            },
            None,
        )
    path, raw = found
    s = pull_results.extract_summary(raw, control=control, treatment=treatment)
    return (
        {
            "chance_to_beat_control_cost": s.chance_to_beat_control_cost,
            "lift_cost": s.lift_cost,
            "ci_cost": s.ci_cost or [None, None],
            "solve_rate_status": s.solve_rate_status,
            "pulled_at": pull_results.pulled_at(path),
            "guardrail_loss": s.guardrail_loss,
            "cost_mean_by_variant": s.cost_mean_by_variant,
            "solve_rate_by_variant": s.solve_rate_by_variant,
            "srm_flag": s.srm_flag,
            "source_file": f"{exp}/{path.name}",
        },
        s,
    )


def analyse_experiment(
    run: Run,
    exp: str,
    m: float,
    seed: int,
    flagsmith_dir: Path,
    prereg: dict[str, Any],
    power: dict[str, Any],
    ridge: RidgeModel | None,
    ps_len: dict[str, int],
) -> dict[str, Any]:
    summary = run.arm_summary()
    variants = sorted(summary)
    if CONTROL not in variants:
        raise ValueError(f"{exp}: no `{CONTROL}` arm in tasks (found {variants})")
    others = [v for v in variants if v != CONTROL]
    if not others:
        raise ValueError(f"{exp}: no treatment arm in tasks")
    treatment = others[0]

    control_arm, treat_arm = run.arm(CONTROL), run.arm(treatment)
    boot_c = bootstrap_arm(control_arm, np.random.default_rng([seed, 1]))
    boot_t = bootstrap_arm(treat_arm, np.random.default_rng([seed, 2]))
    arms = {
        CONTROL: arm_block(summary.get(CONTROL), control_arm, boot_c),
        treatment: arm_block(summary.get(treatment), treat_arm, boot_t),
    }
    ac, at = arms[CONTROL], arms[treatment]

    # Cost deltas from independent per-arm bootstrap distributions.
    diff = boot_t.mean - boot_c.mean
    with np.errstate(divide="ignore", invalid="ignore"):
        diff_pct = diff / boot_c.mean * 100
    d_cost = at["cost_mean"] - ac["cost_mean"] if at["cost_mean"] is not None and ac["cost_mean"] is not None else None

    # Solve-rate delta from the Beta posteriors.
    draws = posterior_delta_draws(
        ac["solves"], control_arm.n, at["solves"], treat_arm.n, np.random.default_rng([seed, 3])
    )
    p_within = float(np.mean(draws > -m))
    cps_c, cps_t = ac["cost_per_solve"], at["cost_per_solve"]

    delta = {
        "cost_mean": d_cost,
        "cost_mean_pct": d_cost / ac["cost_mean"] * 100 if d_cost is not None and ac["cost_mean"] else None,
        "cost_mean_ci": percentile_ci(diff),
        "cost_mean_pct_ci": percentile_ci(diff_pct),
        "solve_rate_pp": (at["solve_rate"] - ac["solve_rate"]) * 100
        if at["solve_rate"] is not None and ac["solve_rate"] is not None
        else None,
        "solve_rate_ci": [v * 100 for v in percentile_ci(draws)],
        "p_solve_drop_within_m": p_within,
        "p_solve_worse": float(np.mean(draws < 0)),
        "cost_per_solve_pct": (cps_t / cps_c - 1) * 100 if cps_c and cps_t else None,
        "cost_per_solve_pct_ci": percentile_ci((boot_t.cost_per_solve / boot_c.cost_per_solve - 1) * 100),
        "treatment": treatment,
    }

    fs, fs_summary = flagsmith_block(flagsmith_dir, exp, CONTROL, treatment)
    agreement: dict[str, Any] = {"cost_mean_abs_diff": {}, "solve_rate_abs_diff": {}}
    for variant, block in arms.items():
        ours = block["cost_mean"]
        theirs = fs_summary.cost_mean_by_variant.get(variant) if fs_summary else None
        agreement["cost_mean_abs_diff"][variant] = (
            abs(ours - theirs) if ours is not None and theirs is not None else None
        )
        ours_r = block["solve_rate"]
        theirs_r = fs_summary.solve_rate_by_variant.get(variant) if fs_summary else None
        agreement["solve_rate_abs_diff"][variant] = (
            abs(ours_r - theirs_r) if ours_r is not None and theirs_r is not None else None
        )

    chance = fs["chance_to_beat_control_cost"]
    rule_met = {
        "flagsmith_95": chance is not None and chance >= FLAGSMITH_BAR,
        "guardrail_90": p_within >= GUARDRAIL_BAR,
        "no_guardrail_loss": fs["guardrail_loss"] is False,
    }
    decision = {
        "ship": treatment if all(rule_met.values()) else CONTROL,
        "rule_met": rule_met,
        "bars": {"flagsmith_chance": FLAGSMITH_BAR, "guardrail_posterior": GUARDRAIL_BAR, "m": m},
    }

    traits, trait_meta = by_trait(control_arm, treat_arm)
    return {
        "prereg": {"tag": prereg["tag"], "sha256": prereg["sha256"], "m": m},
        "arms": arms,
        "delta": delta,
        "srm": srm_test(ac["n_exposed"], at["n_exposed"]),
        "flagsmith": fs,
        "agreement": agreement,
        "decision": decision,
        "power": power,
        "cuped": cuped(control_arm, treat_arm, ridge, ps_len),
        "by_trait": traits,
        "by_trait_meta": trait_meta,
        "unassigned_exclusions": run.unassigned_exclusions(),
        "seed": seed,
        "bootstrap_resamples": N_BOOT,
        "posterior_draws": N_POSTERIOR,
    }


def simple_block(run: Run) -> dict[str, Any]:
    rows = [r for r in run.all_rows() if not r["excluded"]]
    n = len(rows)
    return {
        "n": n,
        "cost_mean": float(np.mean([float(r["usd"]) for r in rows])) if n else None,
        "solve_rate": sum(1 for r in rows if r["solved"]) / n if n else None,
    }


def spend(runs: Path) -> dict[str, Any]:
    """Real spend: every model call (calls.jsonl), falling back to every task attempt."""
    by_exp: dict[str, float] = {}
    for run_dir in sorted(p for p in runs.iterdir() if p.is_dir()) if runs.exists() else []:
        calls = read_jsonl(run_dir / "calls.jsonl")
        if calls:
            by_exp[run_dir.name] = float(sum(float(c["usd"]) for c in calls))
        else:
            tasks = read_jsonl(run_dir / "tasks.jsonl")
            if tasks:
                by_exp[run_dir.name] = float(sum(float(t["usd"]) for t in tasks))
    return {"total_usd": float(sum(by_exp.values())), "by_experiment": by_exp}


def integrity_block(runs: Path, primary: str) -> dict[str, Any]:
    by_exp: dict[str, Any] = {}
    for run_dir in sorted(p for p in runs.iterdir() if p.is_dir()) if runs.exists() else []:
        if not (run_dir / "ledger.jsonl").exists():
            continue
        rep = verify_ledger(run_dir)
        snaps = sorted((run_dir / "env_snapshots").glob("*.json"))
        digests = {hashlib.sha256(p.read_bytes()).hexdigest() for p in snaps}
        by_exp[run_dir.name] = {
            "merkle_root": rep.merkle_root,
            "task_done_records": rep.task_done_records,
            "env_snapshots": len(snaps),
            "env_snapshot_distinct_hashes": len(digests),
            "ledger_ok": rep.ok,
            "ledger_errors": rep.errors[:20],
        }
    main = by_exp.get(primary) or {}
    return {
        "experiment": primary if main else None,
        "merkle_root": main.get("merkle_root"),
        "task_done_records": main.get("task_done_records", 0),
        "env_snapshots": main.get("env_snapshots", 0),
        "env_snapshot_distinct_hashes": main.get("env_snapshot_distinct_hashes", 0),
        "by_experiment": by_exp,
    }


def source_commit(root: Path) -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=False)
    except OSError:
        return "unknown"
    return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else "unknown"


def clean(obj: Any) -> Any:
    """JSON-safe copy: NaN and infinities become null, numpy scalars become Python numbers."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [clean(v) for v in obj]
    if isinstance(obj, np.generic):
        obj = obj.item()
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    return obj


def build_numbers(
    runs: Path,
    out: Path,
    m: float | None,
    seed: int = SEED,
    flagsmith_dir: Path = Path("analysis/flagsmith"),
    prereg_dir: Path = Path("prereg"),
    root: Path = Path("."),
    pilot_exp: str = "pilot",
) -> dict[str, Any]:
    convert_all(runs, out)
    parquet = out / "parquet"
    available = {p.name for p in parquet.iterdir() if (p / "tasks.parquet").exists()} if parquet.exists() else set()

    power = load_power(out / "power.json")
    numbers: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source_commit": source_commit(root),
        "spend": spend(runs),
    }

    ridge: RidgeModel | None = None
    ps_len: dict[str, int] = {}
    for name in sorted(available):
        ps_len.update(load_pool_lengths(runs / name, root))
    if pilot_exp in available:
        pilot = Run(parquet / pilot_exp)
        pilot_rows = [r for r in pilot.all_rows() if not r["excluded"]]
        if len(pilot_rows) >= 3:
            ridge = fit_ridge(pilot_rows, ps_len)
        pb = simple_block(pilot)
        exp1_m = m if m is not None else prereg_info(prereg_dir, "exp1")["m"]
        numbers["pilot"] = {**pb, "m": exp1_m, "n_per_arm": power["n_per_arm"]}

    for exp in ("exp1", "exp2"):
        if exp not in available:
            continue
        prereg = prereg_info(prereg_dir, exp)
        m_exp = m if m is not None else prereg["m"]
        if m_exp is None:
            raise typer.BadParameter(f"no --m given and no `m = <value>` found in {prereg['file']}")
        if not 0 < m_exp < 1:
            raise typer.BadParameter(f"m must be a solve-rate fraction in (0, 1), got {m_exp}")
        numbers[exp] = analyse_experiment(
            Run(parquet / exp), exp, m_exp, seed, flagsmith_dir, prereg, power, ridge, ps_len
        )

    if "rollout" in available:
        numbers["rollout"] = simple_block(Run(parquet / "rollout"))

    primary = "exp1" if "exp1" in available else (sorted(available)[0] if available else "exp1")
    numbers["integrity"] = integrity_block(runs, primary)
    return clean(numbers)


app = typer.Typer(add_completion=False)


@app.command()
def main(
    runs: Annotated[Path, typer.Option(help="runs directory")] = Path("runs"),
    out: Annotated[Path, typer.Option(help="output directory")] = Path("analysis/out"),
    m: Annotated[
        float | None, typer.Option(help="guardrail margin as a solve-rate fraction; default from prereg")
    ] = None,
    seed: Annotated[int, typer.Option()] = SEED,
    flagsmith_dir: Annotated[Path, typer.Option()] = Path("analysis/flagsmith"),
    prereg_dir: Annotated[Path, typer.Option()] = Path("prereg"),
    root: Annotated[Path, typer.Option(help="repository root for docs")] = Path("."),
    docs: Annotated[bool, typer.Option(help="refresh results.md and number markers")] = True,
) -> None:
    numbers = build_numbers(runs, out, m, seed, flagsmith_dir, prereg_dir, root)
    out.mkdir(parents=True, exist_ok=True)
    dest = out / "numbers.json"
    dest.write_text(json.dumps(numbers, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    typer.echo(f"wrote {dest}")
    if docs:
        for res in render_process(root, numbers, write=True, regenerate=True):
            if res.skipped:
                typer.echo(f"skip {res.path} (not found)")
            else:
                typer.echo(f"{'wrote' if res.changed else 'ok   '} {res.path} ({res.markers} markers)")
                for p in res.problems:
                    if p.kind != "stale":
                        typer.echo(f"  {p}", err=True)


if __name__ == "__main__":
    app()
