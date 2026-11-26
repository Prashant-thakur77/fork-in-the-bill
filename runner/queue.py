"""Redis Streams task queue with leases, heartbeats and exactly-once completion."""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from typing import Any

GROUP = "workers"
LEASE_TTL_S = 120
MAX_DELIVERIES = 2  # first attempt + one retry for infra failures


def stream_key(exp: str) -> str:
    return f"tasks:{exp}"


def done_key(exp: str, identity: str) -> str:
    return f"done:{exp}:{identity}"


def lease_key(exp: str, msg_id: str) -> str:
    return f"lease:{exp}:{msg_id}"


def attempts_key(exp: str, identity: str) -> str:
    return f"attempts:{exp}:{identity}"


@dataclass(frozen=True)
class Lease:
    msg_id: str
    instance_id: str
    attempt: int


class TaskQueue:
    def __init__(self, redis_client: Any, exp: str, consumer: str | None = None) -> None:
        self.r = redis_client
        self.exp = exp
        self.stream = stream_key(exp)
        self.consumer = consumer or f"{socket.gethostname()}-{os.getpid()}"
        try:
            self.r.xgroup_create(self.stream, GROUP, id="0", mkstream=True)
        except Exception as exc:  # BUSYGROUP means it already exists
            if "BUSYGROUP" not in str(exc):
                raise

    def enqueue(self, instance_ids: list[str]) -> int:
        """Idempotent: an id already queued for this experiment is skipped."""
        added = 0
        for iid in instance_ids:
            if self.r.sadd(f"queued:{self.exp}", iid):
                self.r.xadd(self.stream, {"instance_id": iid})
                added += 1
        return added

    def lease(self, block_ms: int = 5_000) -> Lease | None:
        resp = self.r.xreadgroup(GROUP, self.consumer, {self.stream: ">"}, count=1, block=block_ms)
        if not resp:
            return None
        _, entries = resp[0]
        msg_id, fields = entries[0]
        msg_id = msg_id.decode() if isinstance(msg_id, bytes) else msg_id
        iid = fields.get(b"instance_id") or fields.get("instance_id")
        iid = iid.decode() if isinstance(iid, bytes) else str(iid)
        attempt = int(self.r.incr(attempts_key(self.exp, iid)))
        self.heartbeat(msg_id)
        return Lease(msg_id, iid, attempt)

    def heartbeat(self, msg_id: str) -> None:
        self.r.set(lease_key(self.exp, msg_id), self.consumer, ex=LEASE_TTL_S)

    def complete(self, lease: Lease, identity: str) -> bool:
        """Mark done once (SET NX) and acknowledge. Returns False if it was already done."""
        first = bool(self.r.set(done_key(self.exp, identity), lease.msg_id, nx=True))
        self.r.xack(self.stream, GROUP, lease.msg_id)
        self.r.delete(lease_key(self.exp, lease.msg_id))
        return first

    def is_done(self, identity: str) -> bool:
        return bool(self.r.exists(done_key(self.exp, identity)))

    def requeue(self, lease: Lease) -> None:
        """Give a lease back for a retry (infra failure). The attempt counter keeps growing."""
        self.r.xack(self.stream, GROUP, lease.msg_id)
        self.r.delete(lease_key(self.exp, lease.msg_id))
        self.r.xadd(self.stream, {"instance_id": lease.instance_id})

    def pending_count(self) -> int:
        info = self.r.xpending(self.stream, GROUP)
        return int(info["pending"] if isinstance(info, dict) else info[0])

    def remaining(self) -> int:
        """Entries not yet delivered plus delivered-but-unacknowledged ones."""
        groups = self.r.xinfo_groups(self.stream)
        for g in groups:
            name = g.get("name") or g.get(b"name")
            name = name.decode() if isinstance(name, bytes) else name
            if name == GROUP:
                lag = g.get("lag") or g.get(b"lag") or 0
                pending = g.get("pending") or g.get(b"pending") or 0
                return int(lag) + int(pending)
        return 0
