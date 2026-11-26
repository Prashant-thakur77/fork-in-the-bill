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
    def __init__(self, client: object, cap_usd: float) -> None:
        if cap_usd <= 0:
            raise ValueError("budget cap must be positive")
        self._r = client
        self.cap = cap_usd
        self._reserve = client.register_script(_RESERVE_LUA)  # type: ignore[attr-defined]
        self._settle = client.register_script(_SETTLE_LUA)  # type: ignore[attr-defined]

    def reserve(self, amount: float) -> str:
        rid = uuid.uuid4().hex
        ok = self._reserve(keys=[SPENT_KEY, RESERVED_KEY, RES_HASH], args=[f"{amount:.8f}", f"{self.cap:.8f}", rid])
        if int(ok) != 1:
            raise BudgetExceeded(f"global cap ${self.cap:.2f} reached (spent ${self.spent():.4f})")
        return rid

    def settle(self, reservation_id: str, actual: float) -> None:
        self._settle(keys=[SPENT_KEY, RESERVED_KEY, RES_HASH], args=[reservation_id, f"{actual:.8f}"])

    def spent(self) -> float:
        return float(self._r.get(SPENT_KEY) or 0.0)  # type: ignore[attr-defined]


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


def from_env() -> Ledgerish:
    cap_raw = os.environ.get("BUDGET_USD_TOTAL")
    if not cap_raw:
        raise RuntimeError("BUDGET_USD_TOTAL is not set; refusing to make paid calls without a cap")
    cap = float(cap_raw)
    url = os.environ.get("REDIS_URL")
    if url:
        import redis

        return RedisBudget(redis.Redis.from_url(url), cap)
    return FileBudget(Path(os.environ.get("BUDGET_FILE", "runs/budget.json")), cap)


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
