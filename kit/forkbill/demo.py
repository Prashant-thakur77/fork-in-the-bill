"""A deterministic fake agent loop for portability demos and CI.

No model is called and no money is spent. Each identity's turns, token counts and outcome come
from a random generator seeded by the identity string, so a rerun produces the same numbers.
The prices below are illustrative round figures for the demo only, not provider list prices.
"""

from __future__ import annotations

import hashlib
import json
import random
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

from forkbill.lanes import FlagsmithLike, Lane, RoutedLanes, TaskResult
from forkbill.policy import RoutingPolicy
from forkbill.pricing import TablePricing, Usage

DEMO_PRICING = TablePricing.from_dict(
    {
        "models": {
            "claude-opus-5-5": {"input": 5, "output": 25, "cache_write_5m": 6.25, "cache_read": 0.5},
            "claude-sonnet-5-5": {"input": 3, "output": 15, "cache_write_5m": 3.75, "cache_read": 0.3},
            "claude-haiku-5-5": {"input": 1, "output": 5, "cache_write_5m": 1.25, "cache_read": 0.1},
        }
    }
)


def _rng(identity: str) -> random.Random:
    return random.Random(int(hashlib.sha256(identity.encode()).hexdigest()[:16], 16))


def fake_task(lanes: RoutedLanes) -> TaskResult:
    """One task of the fake loop: main-lane turns with occasional delegate calls."""
    rng = _rng(lanes.identity)
    caps = lanes.policy.caps
    planned_turns = rng.randint(6, min(24, caps.turns))
    seconds = 0.0
    turns = 0
    for turn in range(planned_turns):
        turns = turn + 1
        lanes.record_call(
            Lane.main,
            Usage(
                input_tokens=rng.randint(400, 1500),
                output_tokens=rng.randint(150, 700),
                cache_write_5m_tokens=4000 if turn == 0 else rng.randint(0, 600),
                cache_read_tokens=0 if turn == 0 else 4000 + 900 * turn,
            ),
        )
        seconds += rng.uniform(4, 12)
        if rng.random() < 0.45:
            lanes.record_call(
                Lane.delegate,
                Usage(
                    input_tokens=rng.randint(6000, min(20000, lanes.policy.delegate.max_context_tokens)),
                    output_tokens=rng.randint(200, lanes.policy.delegate.max_tokens),
                ),
            )
            seconds += rng.uniform(2, 6)
        if lanes.over_budget or seconds >= caps.seconds:
            break
    solved = (not lanes.over_budget) and rng.random() < 0.6
    return lanes.finish(solved=solved, turns=turns, seconds=round(seconds, 3))


def run_demo(
    client: FlagsmithLike,
    *,
    n: int,
    prefix: str = "kitdemo",
    flag: str = "agent_routing",
    kill_flag: str | None = "routing_kill",
    control: RoutingPolicy | None = None,
    out_dir: Path | None = None,
    progress: Callable[[TaskResult], None] | None = None,
) -> list[TaskResult]:
    results: list[TaskResult] = []
    events_log = None
    if out_dir is not None:
        out_dir.mkdir(parents=True, exist_ok=True)
        events_log = (out_dir / "events.jsonl").open("w")

    def sink(identity: str, event: str, value: float) -> None:
        if events_log is not None:
            events_log.write(json.dumps({"identity": identity, "event": event, "value": value}) + "\n")

    try:
        for i in range(n):
            lanes = RoutedLanes(
                flagsmith=client,
                identity=f"{prefix}:{i:04d}",
                pricing=DEMO_PRICING,
                flag=flag,
                kill_flag=kill_flag,
                control=control,
                on_event=sink,
            )
            result = fake_task(lanes)
            results.append(result)
            if progress is not None:
                progress(result)
    finally:
        if events_log is not None:
            events_log.close()

    if out_dir is not None:
        with (out_dir / "tasks.jsonl").open("w") as fh:
            for r in results:
                row = asdict(r)
                row["policy"] = r.policy.model_dump(by_alias=True, mode="json")
                fh.write(json.dumps(row) + "\n")
    return results


def summarise(results: list[TaskResult]) -> dict[str, dict[str, float]]:
    """Per-variant n, mean cost, solve rate and cost per solve (plain arithmetic)."""
    by: dict[str, list[TaskResult]] = {}
    for r in results:
        by.setdefault(r.variant or f"({r.flag_source})", []).append(r)
    out: dict[str, dict[str, float]] = {}
    for key, rows in sorted(by.items()):
        n = len(rows)
        cost = sum(r.usd for r in rows) / n
        solves = sum(1 for r in rows if r.solved)
        out[key] = {
            "n": n,
            "exposed": sum(1 for r in rows if r.exposed),
            "cost_mean": round(cost, 4),
            "solve_rate": round(solves / n, 4),
            "cost_per_solve": round(cost / (solves / n), 4) if solves else float("nan"),
            "delegate_share_cost": round(sum(r.usd_delegate for r in rows) / max(sum(r.usd for r in rows), 1e-12), 4),
        }
    return out
