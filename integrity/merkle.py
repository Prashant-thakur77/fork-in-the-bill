"""Merkle root over ledger `task_done` hashes (rule in docs/interfaces.md).

Leaves are raw 32-byte digests, a parent is `sha256(left + right)`, and the last node of an
odd-sized level is paired with itself. A single leaf is its own root. An empty tree has the
root `sha256(b"")`.
"""

from __future__ import annotations

import hashlib


def _h(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def merkle_root(leaves: list[bytes]) -> str:
    if not leaves:
        return hashlib.sha256(b"").hexdigest()
    for leaf in leaves:
        if len(leaf) != 32:
            raise ValueError(f"leaf must be a 32-byte digest, got {len(leaf)} bytes")
    level = list(leaves)
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        level = [_h(level[i] + level[i + 1]) for i in range(0, len(level), 2)]
    return level[0].hex()


def merkle_root_hex(hex_leaves: list[str]) -> str:
    return merkle_root([bytes.fromhex(h) for h in hex_leaves])
