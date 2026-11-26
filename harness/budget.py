"""Hard spend caps.

The global cap is enforced by reserving each call's worst-case cost before the call
is made and settling it to the real cost afterwards. A reservation that would push
spent + reserved past the cap is refused, so a bug elsewhere cannot overspend:
the worst a crash can do is leave a reservation unsettled, which only makes the cap
stricter.
"""

from __future__ import annotations

import fcntl
import json
import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

SPENT_KEY = "budget:spent_usd"
RESERVED_KEY = "budget:reserved_usd"
RES_HASH = "budget:reservations"


class BudgetExceeded(RuntimeError):
    """Raised when a reservation would exceed the global cap. Workers stop on it."""


class Ledgerish(Protocol):
    def reserve(self, amount: float) -> str: ...
    def settle(self, reservation_id: str, actual: float) -> None: ...
    def spent(self) -> float: ...


_RESERVE_LUA = """
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
local reserved = tonumber(redis.call('GET', KEYS[2]) or '0')
local amount = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
if spent + reserved + amount > cap then
  return 0
end
redis.call('INCRBYFLOAT', KEYS[2], ARGV[1])
redis.call('HSET', KEYS[3], ARGV[3], ARGV[1])
return 1
"""

_SETTLE_LUA = """
local held = redis.call('HGET', KEYS[3], ARGV[1])
if not held then
  return 0
end
redis.call('HDEL', KEYS[3], ARGV[1])
redis.call('INCRBYFLOAT', KEYS[2], '-' .. held)
redis.call('INCRBYFLOAT', KEYS[1], ARGV[2])
return 1
"""


class RedisBudget:
    def __init__(self, client: object, cap_usd: float, namespace: str = "budget") -> None:
        if cap_usd <= 0:
            raise ValueError("budget cap must be positive")
        self._keys = [f"{namespace}:spent_usd", f"{namespace}:reserved_usd", f"{namespace}:reservations"]
        self._r = client
        self.cap = cap_usd
        self._reserve = client.register_script(_RESERVE_LUA)  # type: ignore[attr-defined]
        self._settle = client.register_script(_SETTLE_LUA)  # type: ignore[attr-defined]

    def reserve(self, amount: float) -> str:
        rid = uuid.uuid4().hex
        ok = self._reserve(keys=self._keys, args=[f"{amount:.8f}", f"{self.cap:.8f}", rid])
        if int(ok) != 1:
            raise BudgetExceeded(f"global cap ${self.cap:.2f} reached (spent ${self.spent():.4f})")
        return rid

    def settle(self, reservation_id: str, actual: float) -> None:
        self._settle(keys=self._keys, args=[reservation_id, f"{actual:.8f}"])

    def spent(self) -> float:
        return float(self._r.get(self._keys[0]) or 0.0)  # type: ignore[attr-defined]


class FileBudget:
    """Single-host fallback with the same semantics, guarded by an exclusive file lock."""

    def __init__(self, path: Path, cap_usd: float) -> None:
        if cap_usd <= 0:
            raise ValueError("budget cap must be positive")
        self.path = path
        self.cap = cap_usd
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_text(json.dumps({"spent": 0.0, "reservations": {}}))

    @contextmanager
    def _locked(self) -> Iterator[dict[str, object]]:
        with open(self.path, "r+") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            state = json.loads(fh.read() or '{"spent": 0.0, "reservations": {}}')
            yield state
            fh.seek(0)
            fh.truncate()
            fh.write(json.dumps(state))
            fh.flush()
            os.fsync(fh.fileno())

    def reserve(self, amount: float) -> str:
        rid = uuid.uuid4().hex
        with self._locked() as st:
            res: dict[str, float] = st["reservations"]  # type: ignore[assignment]
            spent = float(st["spent"])  # type: ignore[arg-type]
            if spent + sum(res.values()) + amount > self.cap:
                raise BudgetExceeded(f"global cap ${self.cap:.2f} reached (spent ${spent:.4f})")
            res[rid] = amount
        return rid

    def settle(self, reservation_id: str, actual: float) -> None:
        with self._locked() as st:
            res: dict[str, float] = st["reservations"]  # type: ignore[assignment]
            if res.pop(reservation_id, None) is not None:
                st["spent"] = float(st["spent"]) + actual  # type: ignore[arg-type]

    def spent(self) -> float:
        with self._locked() as st:
            return float(st["spent"])  # type: ignore[arg-type]


class CompositeBudget:
    """Reserve against several caps at once (global total and the current phase's allowance)."""

    def __init__(self, parts: list[Ledgerish]) -> None:
        self.parts = parts

    def reserve(self, amount: float) -> str:
        ids: list[str] = []
        try:
            for p in self.parts:
                ids.append(p.reserve(amount))
        except BudgetExceeded:
            for p, rid in zip(self.parts, ids, strict=False):
                p.settle(rid, 0.0)
            raise
        return "|".join(ids)

    def settle(self, reservation_id: str, actual: float) -> None:
        for p, rid in zip(self.parts, reservation_id.split("|"), strict=True):
            p.settle(rid, actual)

    def spent(self) -> float:
        return self.parts[0].spent()


def from_env(phase: str | None = None) -> Ledgerish:
    """Global cap from BUDGET_USD_TOTAL; optional per-phase cap from BUDGET_USD_<PHASE> (e.g. BUDGET_USD_PILOT)."""
    cap_raw = os.environ.get("BUDGET_USD_TOTAL")
    if not cap_raw:
        raise RuntimeError("BUDGET_USD_TOTAL is not set; refusing to make paid calls without a cap")
    caps: list[tuple[str, float]] = [("budget", float(cap_raw))]
    if phase:
        phase_raw = os.environ.get(f"BUDGET_USD_{phase.upper()}")
        if phase_raw:
            caps.append((f"budget:{phase}", float(phase_raw)))
    url = os.environ.get("REDIS_URL")
    parts: list[Ledgerish] = []
    for ns, cap in caps:
        if url:
            import redis

            parts.append(RedisBudget(redis.Redis.from_url(url), cap, ns))
        else:
            name = ns.replace(":", "_")
            parts.append(FileBudget(Path(os.environ.get("BUDGET_DIR", "runs")) / f"{name}.json", cap))
    return parts[0] if len(parts) == 1 else CompositeBudget(parts)


@dataclass
class TaskBudget:
    """Per-task cap, identical in both arms. The loop checks it before every call."""

    cap_usd: float
    spent: float = 0.0

    def add(self, usd: float) -> None:
        self.spent += usd

    @property
    def exhausted(self) -> bool:
        return self.spent >= self.cap_usd
