"""Merkle inclusion proofs: real ledgers, tampering, and every tree size from 1 to 300."""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

import pytest
from typer.testing import CliRunner

from integrity.merkle import inclusion_proof, merkle_root, root_from_path, verify_inclusion
from integrity.prove import app, export, load_leaves
from integrity.verify_ledger import verify

ROOT = Path(__file__).resolve().parents[2]


def h(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


A, B, C = h(b"a"), h(b"b"), h(b"c")


def test_small_trees_by_hand() -> None:
    assert inclusion_proof([A], 0) == []
    assert inclusion_proof([A, B], 0) == [B.hex()]
    assert inclusion_proof([A, B, C], 1) == [A.hex(), h(C + C).hex()]
    assert inclusion_proof([A, B, C], 2) == [h(A + B).hex()]  # C pairs with itself: no entry
    assert verify_inclusion(C, 2, 3, [h(A + B).hex()], merkle_root([A, B, C]))
    with pytest.raises(IndexError):
        inclusion_proof([A, B], 2)


@pytest.mark.parametrize("run", ["exp1", "rollout"])
def test_every_leaf_of_a_real_run_verifies(run: str) -> None:
    rep = verify(ROOT / "runs" / run)
    assert rep.ok
    leaves = load_leaves(ROOT / "runs" / run)
    digests = [bytes.fromhex(leaf.record.hash) for leaf in leaves]
    assert len(leaves) == rep.task_done_records
    for leaf in leaves:
        path = inclusion_proof(digests, leaf.index)
        assert verify_inclusion(leaf.record.hash, leaf.index, len(leaves), path, rep.merkle_root)


def test_tampering_fails() -> None:
    leaves = load_leaves(ROOT / "runs" / "exp1")
    digests = [bytes.fromhex(leaf.record.hash) for leaf in leaves]
    root, size = merkle_root(digests), len(digests)
    i = 37
    path = inclusion_proof(digests, i)
    leaf = leaves[i].record.hash
    assert verify_inclusion(leaf, i, size, path, root)
    changed = ("0" if leaf[0] != "0" else "1") + leaf[1:]
    assert not verify_inclusion(changed, i, size, path, root)
    assert not verify_inclusion(leaf, i + 1, size, path, root)
    assert not verify_inclusion(leaf, i, size, path[:-1], root)
    assert not verify_inclusion(leaf, i, size, [*path, path[0]], root)
    last = inclusion_proof(digests, size - 1)
    assert verify_inclusion(digests[-1], size - 1, size, last, root)
    assert not verify_inclusion(digests[-1], size - 1, size - 1, last, root)  # index outside the stated size
    assert not verify_inclusion(leaf, i, size, [path[0][:-2], *path[1:]], root)
    assert not verify_inclusion(leaf, size, size, path, root)
    assert not verify_inclusion("not hex", i, size, path, root)


def test_every_tree_size_up_to_300_against_brute_force() -> None:
    rng = random.Random(20261127)
    for size in range(1, 301):
        leaves = [h(rng.randbytes(8)) for _ in range(size)]
        root = merkle_root(leaves)
        indices = range(size) if size <= 64 else sorted({0, size - 1, *rng.sample(range(size), 14)})
        for i in indices:
            path = inclusion_proof(leaves, i)
            assert len(path) <= (size - 1).bit_length()
            assert verify_inclusion(leaves[i], i, size, path, root), (size, i)
            assert not verify_inclusion(leaves[i], i, size, path[:-1], root) or not path
        # The path does not depend on the leaf itself: any value at position i gives the root a
        # full recomputation of the changed tree gives.
        for i in {0, size - 1, rng.randrange(size)}:
            other = h(rng.randbytes(8))
            rebuilt = merkle_root([*leaves[:i], other, *leaves[i + 1 :]])
            assert root_from_path(other, i, size, inclusion_proof(leaves, i)) == rebuilt
            assert rebuilt != root


def test_export_is_compact_deterministic_and_checks(tmp_path: Path) -> None:
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    summary = export(ROOT / "runs" / "rollout", a)
    export(ROOT / "runs" / "rollout", b)
    assert a.read_bytes() == b.read_bytes()
    data = json.loads(a.read_text())
    assert data["size"] == summary["leaves"] == summary["verified"] == len(data["leaves"])
    assert data["root"] == verify(ROOT / "runs" / "rollout").merkle_root
    first = data["leaves"][0]
    assert set(first) == {"identity", "seq", "index", "leaf", "path"}
    for e in data["leaves"]:
        assert verify_inclusion(e["leaf"], e["index"], data["size"], e["path"], data["root"])
    assert summary["bytes"] == len(a.read_bytes())


def test_cli_proves_a_task_against_the_published_root() -> None:
    leaves = load_leaves(ROOT / "runs" / "rollout")
    identity = leaves[3].identity
    root = verify(ROOT / "runs" / "rollout").merkle_root
    res = CliRunner().invoke(app, ["--run", str(ROOT / "runs" / "rollout"), "--task", identity, "--root", root])
    assert res.exit_code == 0, res.output
    assert f"verified against the root given {root}" in res.output
    assert "matches sha256(prev_hash + canonical_json(payload))" in res.output
    bad = CliRunner().invoke(app, ["--run", str(ROOT / "runs" / "rollout"), "--task", identity, "--root", "00" * 32])
    assert bad.exit_code == 1
    missing = CliRunner().invoke(app, ["--run", str(ROOT / "runs" / "rollout"), "--task", "swelive:nope"])
    assert missing.exit_code == 1
