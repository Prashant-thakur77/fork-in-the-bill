"""Canonical JSON and ledger record hashing shared by the ledger writer and verifier."""

from __future__ import annotations

import hashlib
import json

GENESIS = "0" * 64


def canonical_json(obj: object) -> bytes:
    """`json.dumps(sort_keys, compact separators, ensure_ascii=False)` encoded as UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def record_hash(prev_hash: str, payload: object) -> str:
    """`sha256(prev_hash_hex + canonical_json(payload))` as lowercase hex."""
    return hashlib.sha256(prev_hash.encode("ascii") + canonical_json(payload)).hexdigest()
