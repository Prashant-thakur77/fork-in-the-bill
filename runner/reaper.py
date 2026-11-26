"""Re-queue tasks whose worker stopped heartbeating."""

from __future__ import annotations

import logging
from typing import Any

from runner.queue import GROUP, MAX_DELIVERIES, TaskQueue, attempts_key, lease_key

log = logging.getLogger(__name__)


def reap(q: TaskQueue, min_idle_ms: int = 150_000) -> list[str]:
    """Claim expired leases. Under the retry limit they go back on the stream; over it they are
    returned so the caller records an exclusion (infra failure after one retry)."""
    exhausted: list[str] = []
    entries: Any = q.r.xpending_range(q.stream, GROUP, min="-", max="+", count=500)
    for e in entries:
        msg_id = e["message_id"].decode() if isinstance(e["message_id"], bytes) else e["message_id"]
        if e["time_since_delivered"] < min_idle_ms or q.r.exists(lease_key(q.exp, msg_id)):
            continue
        claimed = q.r.xclaim(q.stream, GROUP, q.consumer, min_idle_ms, [msg_id])
        if not claimed:
            continue
        _, fields = claimed[0]
        iid = fields.get(b"instance_id") or fields.get("instance_id")
        iid = iid.decode() if isinstance(iid, bytes) else str(iid)
        q.r.xack(q.stream, GROUP, msg_id)
        attempts = int(q.r.get(attempts_key(q.exp, iid)) or 0)
        if attempts >= MAX_DELIVERIES:
            log.warning("lease for %s expired after %d attempts; excluding", iid, attempts)
            exhausted.append(iid)
        else:
            log.warning("lease for %s expired; re-queueing", iid)
            q.r.xadd(q.stream, {"instance_id": iid})
    return exhausted
