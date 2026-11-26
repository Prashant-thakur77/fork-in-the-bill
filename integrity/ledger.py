"""Append-only, hash-chained run ledger (rule in docs/interfaces.md)."""

from __future__ import annotations

import fcntl
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from harness.schema import LedgerKind, LedgerRecord

GENESIS = "0" * 64


def canonical_json(obj: object) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def record_hash(prev_hash: str, payload: dict[str, object]) -> str:
    return hashlib.sha256(prev_hash.encode() + canonical_json(payload)).hexdigest()


class Ledger:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)

    def append(self, kind: LedgerKind, payload: dict[str, object]) -> LedgerRecord:
        with open(self.path, "r+") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            lines = fh.read().splitlines()
            if lines:
                last = json.loads(lines[-1])
                seq, prev = int(last["seq"]) + 1, str(last["hash"])
            else:
                seq, prev = 0, GENESIS
            rec = LedgerRecord(
                seq=seq,
                ts=datetime.now(UTC).isoformat(timespec="milliseconds"),
                kind=kind,
                payload=payload,
                prev_hash=prev,
                hash=record_hash(prev, payload),
            )
            fh.seek(0, 2)
            fh.write(rec.model_dump_json() + "\n")
            fh.flush()
        return rec
