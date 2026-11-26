"""Conversion events for one finished task, sent with the exposure's identifier."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from harness.policy import FlagsmithLike
from harness.schema import EVENT_COST, EVENT_SECONDS, EVENT_SOLVED, EVENT_TURNS, LedgerKind, TaskRecord
from integrity.ledger import Ledger


def emit_task_events(
    client: FlagsmithLike, rec: TaskRecord, events_log: Path, ledger: Ledger
) -> list[dict[str, object]]:
    """task_cost, task_turns and task_seconds go out for every exposed task; task_solved only on a solve.

    Events are flushed before returning so the caller can acknowledge the task knowing
    nothing is left in the buffer.
    """
    sent: list[tuple[str, float | int]] = [
        (EVENT_COST, round(rec.usd, 6)),
        (EVENT_TURNS, rec.turns),
        (EVENT_SECONDS, round(rec.seconds, 3)),
    ]
    if rec.solved:
        sent.append((EVENT_SOLVED, 1))
    lines: list[dict[str, object]] = []
    for name, value in sent:
        client.track_event(name, identifier=rec.identity, value=value)
        client.flush_events()  # one event in flight at a time; see harness/policy.py
        lines.append(
            {
                "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
                "identity": rec.identity,
                "event": name,
                "value": value,
            }
        )
    client.flush_events()
    events_log.parent.mkdir(parents=True, exist_ok=True)
    with events_log.open("a") as fh:
        for line in lines:
            fh.write(json.dumps(line, sort_keys=True) + "\n")
    ledger.append(LedgerKind.event_sent, {"identity": rec.identity, "events": lines})
    return lines
