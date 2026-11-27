"""Merkle root over ledger `task_done` hashes, and inclusion proofs (rule in docs/interfaces.md).

Leaves are raw 32-byte digests, a parent is `sha256(left + right)`, and the last node of an
odd-sized level is paired with itself. A single leaf is its own root. An empty tree has the
root `sha256(b"")`.

Inclusion proofs follow the audit paths of Certificate Transparency (RFC 6962, section 2.1.1) and
the tree-based logs of Crosby and Wallach (2009): to show that one leaf is in a tree of `size`
leaves, give the sibling hash at each level on the way up, and let the checker rebuild the root.
The tree rule here is this project's own, not RFC 6962's. RFC 6962 hashes a leaf as
`sha256(0x00 + data)` and a node as `sha256(0x01 + left + right)`, and splits a tree at the largest
power of two below its size, so an odd node is carried up unchanged. Here a leaf is used as it is
(it is already a ledger record hash), there is no prefix, and an odd node is paired with itself.
The proofs therefore verify against the roots this project already published.

Consequences of that rule. An audit path has no entry for a level where the node is the last of
an odd level, because its sibling is itself; the checker knows those levels from `index` and
`size`. A tree whose last leaf is repeated (A, B, C and A, B, C, C) has the same root, and without
a leaf prefix an inner node could pass as the leaf of a smaller tree. Both are why
`verify_inclusion` takes the tree size, and why the size is published next to the root: a proof
checked against the published size cannot use either.
"""

from __future__ import annotations

import hashlib


def _h(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def _check_leaves(leaves: list[bytes]) -> None:
    for leaf in leaves:
        if len(leaf) != 32:
            raise ValueError(f"leaf must be a 32-byte digest, got {len(leaf)} bytes")


def _parent_level(level: list[bytes]) -> list[bytes]:
    if len(level) % 2 == 1:
        level = [*level, level[-1]]
    return [_h(level[i] + level[i + 1]) for i in range(0, len(level), 2)]


def merkle_root(leaves: list[bytes]) -> str:
    if not leaves:
        return hashlib.sha256(b"").hexdigest()
    _check_leaves(leaves)
    level = list(leaves)
    while len(level) > 1:
        level = _parent_level(level)
    return level[0].hex()


def merkle_root_hex(hex_leaves: list[str]) -> str:
    return merkle_root([bytes.fromhex(h) for h in hex_leaves])


def inclusion_proof(leaves: list[bytes], index: int) -> list[str]:
    """Sibling hashes, leaf level first, that lead from `leaves[index]` to the root.

    Levels where the node is the last of an odd level contribute nothing: its sibling is itself.
    """
    if not 0 <= index < len(leaves):
        raise IndexError(f"index {index} outside a tree of {len(leaves)} leaves")
    _check_leaves(leaves)
    path: list[str] = []
    level = list(leaves)
    i = index
    while len(level) > 1:
        sibling = i ^ 1
        if sibling < len(level):
            path.append(level[sibling].hex())
        level = _parent_level(level)
        i //= 2
    return path


def _digest(value: str | bytes) -> bytes | None:
    if isinstance(value, bytes):
        return value if len(value) == 32 else None
    try:
        raw = bytes.fromhex(value)
    except ValueError:
        return None
    return raw if len(raw) == 32 else None


def root_from_path(leaf_hash: str | bytes, index: int, size: int, proof: list[str]) -> str | None:
    """The root that `proof` leads to from `leaf_hash` at `index`, or None if the path is malformed."""
    node = _digest(leaf_hash)
    if node is None or size < 1 or not 0 <= index < size:
        return None
    steps = iter(proof)
    i, n = index, size
    while n > 1:
        if i % 2 == 1 or i + 1 < n:
            sibling = _digest(next(steps, ""))
            if sibling is None:
                return None  # truncated path or a sibling that is not a digest
            node = _h(sibling + node) if i % 2 == 1 else _h(node + sibling)
        else:
            node = _h(node + node)  # last node of an odd level
        i //= 2
        n = (n + 1) // 2
    if next(steps, None) is not None:
        return None  # path longer than the tree is tall
    return node.hex()


def verify_inclusion(leaf_hash: str | bytes, index: int, size: int, proof: list[str], root: str | bytes) -> bool:
    """True if `proof` shows `leaf_hash` as leaf `index` of a `size`-leaf tree with this `root`."""
    want = _digest(root)
    got = root_from_path(leaf_hash, index, size, proof)
    return want is not None and got is not None and got == want.hex()
