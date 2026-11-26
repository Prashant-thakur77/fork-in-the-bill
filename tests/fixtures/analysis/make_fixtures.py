"""Generate SYNTHETIC TEST FIXTURES for the analysis and integrity tests.

Nothing written by this script is real experiment data. Every run directory carries
`"fixture": true` in meta.json and every instance id starts with `fixture__`.

    python tests/fixtures/analysis/make_fixtures.py

Output (deterministic for a given seed):
    tests/fixtures/analysis/balanced/   pilot + exp1 runs, pool, prereg, Flagsmith results
    tests/fixtures/analysis/srm/        exp1 with a deliberately imbalanced split
"""

from __future__ import annotations

import hashlib
import json
import random
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from harness.schema import (
    CallRecord,
    Lane,
    LedgerKind,
    LedgerRecord,
    Outcome,
    RoutingPolicy,
    TaskRecord,
    identity_for,
)
from integrity.canonical import GENESIS, record_hash
from tasks.model import TaskInstance

HERE = Path(__file__).resolve().parent
SEED = 7
BASE_TS = datetime(2026, 11, 1, tzinfo=UTC)
LANGUAGES = ("python", "rust", "go", "typescript")
MONTHS = ("2026-08", "2026-09", "2026-10")
M = 0.05

FRONTIER = "fixture-frontier"
SMALL = "fixture-small"


def policy(name: str) -> RoutingPolicy:
    return RoutingPolicy.model_validate(
        {
            "policy": name,
            "schema": 1,
            "main": {"model": FRONTIER, "max_tokens": 4096, "cache": True},
            "delegate": {
                "model": SMALL if name != "control" else FRONTIER,
                "max_tokens": 1024,
                "max_context_tokens": 24000,
            },
            "caps": {"turns": 60, "usd_per_task": 3.0, "seconds": 1500},
        }
    )


def make_instance(rng: random.Random, pool: str, i: int) -> TaskInstance:
    files = rng.randint(1, 4)
    lines_per_file = rng.randint(2, 40)
    patch_lines: list[str] = []
    for f in range(files):
        patch_lines += [f"diff --git a/src/f{f}.x b/src/f{f}.x", f"--- a/src/f{f}.x", f"+++ b/src/f{f}.x"]
        patch_lines += [("+" if k % 2 else "-") + f"line {k}" for k in range(lines_per_file)]
    month = rng.choice(MONTHS)
    return TaskInstance(
        instance_id=f"fixture__{pool}-{i:04d}",
        source="fixture",
        language=rng.choice(LANGUAGES),
        repo=f"fixture/repo{rng.randint(1, 6)}",
        base_commit=hashlib.sha1(f"{pool}{i}".encode()).hexdigest(),
        created_at=f"{month}-{rng.randint(1, 28):02d}T00:00:00Z",
        problem_statement="x" * rng.randint(100, 1500),
        patch="\n".join(patch_lines),
        test_patch="",
        fail_to_pass=["test_a"],
        pass_to_pass=["test_b"],
        docker_image="fixture/image:latest",
        rebuild_cmds=[],
        test_cmds=["true"],
        log_parser="fixture",
    )


class Ledger:
    def __init__(self) -> None:
        self.records: list[LedgerRecord] = []

    def add(self, kind: LedgerKind, payload: dict[str, object], ts: datetime) -> None:
        prev = self.records[-1].hash if self.records else GENESIS
        self.records.append(
            LedgerRecord(
                seq=len(self.records),
                ts=ts.isoformat(),
                kind=kind,
                payload=payload,
                prev_hash=prev,
                hash=record_hash(prev, payload),
            )
        )


def _dump_jsonl(path: Path, rows: list[Any]) -> None:
    path.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in rows), encoding="utf-8")


def write_run(
    root: Path,
    exp: str,
    instances: list[TaskInstance],
    rng: random.Random,
    treatment_share: float,
    pool_rel: str,
    n_excluded: int = 2,
    n_retried: int = 2,
) -> None:
    run = root / "runs" / exp
    run.mkdir(parents=True)
    tasks: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    exclusions: list[dict[str, Any]] = []
    ledger = Ledger()
    ledger.add(LedgerKind.config, {"experiment": exp, "fixture": True}, BASE_TS)

    for i, inst in enumerate(instances):
        variant = "lanes_v1" if rng.random() < treatment_share else "control"
        pol = policy(variant)
        ident = identity_for(inst.instance_id)
        start = BASE_TS + timedelta(minutes=5 * i)
        traits: dict[str, str | int | float] = {
            "repo": inst.repo,
            "language": inst.language,
            "created_month": inst.created_month,
            "gold_files": inst.gold_files,
            "gold_lines": inst.gold_lines,
        }
        base = 0.35 + 0.006 * inst.gold_lines + 0.00008 * len(inst.problem_statement)
        mult = 1.0 if variant == "control" else 0.7
        usd = round(base * mult * rng.lognormvariate(0, 0.35), 6)
        p_solve = max(0.05, 0.62 - 0.004 * inst.gold_lines - (0.02 if variant != "control" else 0))
        solved = rng.random() < p_solve
        share = 0.35 if variant == "control" else 0.15
        usd_del = round(usd * share, 6)
        usd_main = round(usd - usd_del, 6)
        tok_main = int(usd_main * 200_000)
        tok_del = int(tok_main * (0.4 if variant == "control" else 0.6))

        attempts = 1
        excluded = i < n_excluded
        if excluded or n_excluded <= i < n_excluded + n_retried:
            # First attempt hit an infrastructure failure.
            tasks.append(
                _task(
                    exp,
                    ident,
                    inst,
                    variant,
                    pol,
                    Outcome.infra_error,
                    False,
                    0.0,
                    0.0,
                    0.0,
                    0,
                    0,
                    start,
                    traits,
                    attempt=1,
                )
            )
            attempts = 2
        if excluded:
            tasks.append(
                _task(
                    exp,
                    ident,
                    inst,
                    variant,
                    pol,
                    Outcome.infra_error,
                    False,
                    0.0,
                    0.0,
                    0.0,
                    0,
                    0,
                    start + timedelta(minutes=1),
                    traits,
                    attempt=2,
                )
            )
            exclusions.append({"identity": ident, "reason": "infra_error", "attempts": 2})
            ledger.add(LedgerKind.exclusion, exclusions[-1], start + timedelta(minutes=2))
            continue

        outcome = Outcome.solved if solved else Outcome.unsolved
        rec = _task(
            exp,
            ident,
            inst,
            variant,
            pol,
            outcome,
            solved,
            usd,
            usd_main,
            usd_del,
            tok_main,
            tok_del,
            start + timedelta(minutes=attempts - 1),
            traits,
            attempt=attempts,
        )
        tasks.append(rec)
        for lane, model, cost, tokens in (
            (Lane.main, FRONTIER, usd_main, tok_main),
            (Lane.delegate, pol.delegate.model, usd_del, tok_del),
        ):
            calls.append(
                CallRecord(
                    task_identity=ident,
                    lane=lane,
                    model=model,
                    turn=1,
                    input_tokens=tokens,
                    cache_write_5m_tokens=0,
                    cache_write_1h_tokens=0,
                    cache_read_tokens=0,
                    output_tokens=0,
                    usd=cost,
                    latency_s=1.0,
                    stop_reason="end_turn",
                ).model_dump(mode="json")
            )
        done = start + timedelta(minutes=4)
        ledger.add(LedgerKind.task_done, {"identity": ident, "variant": variant, "usd": usd, "solved": solved}, done)
        for name, value in (("task_cost", usd), ("task_turns", rec["turns"]), ("task_seconds", rec["seconds"])):
            events.append({"ts": done.isoformat(), "identity": ident, "event": name, "value": value})
        if solved:
            events.append({"ts": done.isoformat(), "identity": ident, "event": "task_solved", "value": 1})
        if i % 50 == 0:
            ledger.add(LedgerKind.env_snapshot, {"sha256": "f" * 64}, done)

    _dump_jsonl(run / "tasks.jsonl", tasks)
    _dump_jsonl(run / "calls.jsonl", calls)
    _dump_jsonl(run / "events.jsonl", events)
    _dump_jsonl(run / "exclusions.jsonl", exclusions)
    _dump_jsonl(run / "ledger.jsonl", [r.model_dump(mode="json") for r in ledger.records])
    snaps = run / "env_snapshots"
    snaps.mkdir()
    for k in range(3):
        (snaps / f"2026-11-01T0{k}0000Z.json").write_text('{"fixture": true}\n', encoding="utf-8")
    (run / "meta.json").write_text(
        json.dumps(
            {
                "experiment": exp,
                "fixture": True,
                "pool_file": pool_rel,
                "pool_sha256": "0" * 64,
                "prereg_tag": f"prereg-{exp}",
                "flagsmith_experiment_id": 1,
                "started_at": BASE_TS.isoformat(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _task(
    exp: str,
    ident: str,
    inst: TaskInstance,
    variant: str,
    pol: RoutingPolicy,
    outcome: Outcome,
    solved: bool,
    usd: float,
    usd_main: float,
    usd_del: float,
    tok_main: int,
    tok_del: int,
    start: datetime,
    traits: dict[str, str | int | float],
    attempt: int,
) -> dict[str, Any]:
    turns = 0 if outcome == Outcome.infra_error else 10 + inst.gold_lines // 4
    seconds = 0.0 if outcome == Outcome.infra_error else 120.0 + 3.0 * inst.gold_lines
    return TaskRecord(
        experiment=exp,
        identity=ident,
        instance_id=inst.instance_id,
        variant=variant,
        policy=pol,
        flag_source="experiment",
        outcome=outcome,
        solved=solved,
        usd=usd,
        usd_main=usd_main,
        usd_delegate=usd_del,
        tokens_main=tok_main,
        tokens_delegate=tok_del,
        turns=turns,
        delegate_calls=3,
        seconds=seconds,
        started_at=start.isoformat(),
        finished_at=(start + timedelta(seconds=seconds)).isoformat(),
        trace_id=f"{attempt:032x}",
        traits=traits,
        error="image pull failed" if outcome == Outcome.infra_error else None,
        attempt=attempt,
    ).model_dump(mode="json", by_alias=True)


FLAGSMITH_RESULTS = {
    "_fixture": "synthetic Flagsmith results response used by the analysis tests",
    "metrics": [
        {
            "metric": {"name": "task_cost"},
            "variations": [
                {"key": "control", "mean": 0.84},
                {
                    "key": "lanes_v1",
                    "mean": 0.60,
                    "chance_to_beat_control": 99.1,
                    "lift": -0.28,
                    "credible_interval": [-0.36, -0.20],
                },
            ],
        },
        {
            "metric": {"name": "task_solved"},
            "variations": [
                {"key": "control", "rate": 0.42},
                {"key": "lanes_v1", "rate": 0.41, "status": "inconclusive"},
            ],
        },
    ],
}


def build(root: Path, seed: int, n_pilot: int, n_exp: int, treatment_share: float, with_pilot: bool) -> None:
    if root.exists():
        shutil.rmtree(root)
    rng = random.Random(seed)
    pools = root / "tasks" / "pools"
    pools.mkdir(parents=True)
    exp_pool = [make_instance(rng, "exp1", i) for i in range(n_exp)]
    _dump_jsonl(pools / "exp1.jsonl", [i.model_dump() for i in exp_pool])
    if with_pilot:
        pilot_pool = [make_instance(rng, "pilot", i) for i in range(n_pilot)]
        _dump_jsonl(pools / "pilot.jsonl", [i.model_dump() for i in pilot_pool])
        write_run(root, "pilot", pilot_pool, rng, 0.5, "tasks/pools/pilot.jsonl", 0, 0)
    write_run(root, "exp1", exp_pool, rng, treatment_share, "tasks/pools/exp1.jsonl")
    prereg = root / "prereg"
    prereg.mkdir()
    (prereg / "experiment-1.md").write_text(
        "# Fixture pre-registration (synthetic test data)\n\nGuardrail margin: m = 0.05\n",
        encoding="utf-8",
    )
    fs = root / "analysis" / "flagsmith" / "exp1"
    fs.mkdir(parents=True)
    (fs / "results-20261102T000000Z.json").write_text(
        json.dumps(FLAGSMITH_RESULTS, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main() -> None:
    build(HERE / "balanced", SEED, n_pilot=60, n_exp=240, treatment_share=0.5, with_pilot=True)
    build(HERE / "srm", SEED + 1, n_pilot=0, n_exp=240, treatment_share=0.75, with_pilot=False)
    print(f"fixtures written under {HERE}")


if __name__ == "__main__":
    main()
