"""Merkle known-answer vectors and ledger chain verification."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from integrity.canonical import GENESIS, canonical_json, record_hash
from integrity.merkle import merkle_root, merkle_root_hex
from integrity.verify_ledger import verify

FIXTURE_RUN = Path(__file__).resolve().parents[1] / "fixtures" / "analysis" / "balanced" / "runs" / "exp1"


def h(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


A, B, C = h(b"a"), h(b"b"), h(b"c")


def test_single_leaf_is_root() -> None:
    assert merkle_root([A]) == A.hex()


def test_two_leaves() -> None:
    assert merkle_root([A, B]) == h(A + B).hex()


def test_odd_leaf_paired_with_itself() -> None:
    assert merkle_root([A, B, C]) == h(h(A + B) + h(C + C)).hex()


def test_known_answer_vectors() -> None:
    assert merkle_root([A, B]) == "e5a01fee14e0ed5c48714f22180f25ad8365b53f9779f79dc4a3d7e93963f94a"
    assert merkle_root([A, B, C]) == "d31a37ef6ac14a2db1470c4316beb5592e6afd4465022339adafda76a18ffabe"


def test_empty_tree() -> None:
    assert merkle_root([]) == hashlib.sha256(b"").hexdigest()


def test_rejects_non_digest_leaf() -> None:
    with pytest.raises(ValueError):
        merkle_root([b"short"])


def test_hex_helper_matches() -> None:
    assert merkle_root_hex([A.hex(), B.hex()]) == merkle_root([A, B])


def test_canonical_json_and_record_hash() -> None:
    payload = {"b": 1, "a": "é"}
    assert canonical_json(payload) == '{"a":"é","b":1}'.encode()
    expected = hashlib.sha256(GENESIS.encode() + '{"a":"é","b":1}'.encode()).hexdigest()
    assert record_hash(GENESIS, payload) == expected


def test_fixture_ledger_verifies() -> None:
    rep = verify(FIXTURE_RUN)
    assert rep.ok, rep.errors
    assert rep.task_done_records > 0
    assert len(rep.merkle_root) == 64


def _copy_ledger(tmp_path: Path) -> list[dict[str, object]]:
    shutil.copy(FIXTURE_RUN / "ledger.jsonl", tmp_path / "ledger.jsonl")
    return [json.loads(x) for x in (tmp_path / "ledger.jsonl").read_text().splitlines()]


def _write(tmp_path: Path, records: list[dict[str, object]]) -> None:
    (tmp_path / "ledger.jsonl").write_text("".join(json.dumps(r) + "\n" for r in records))


def test_tampered_payload_detected(tmp_path: Path) -> None:
    records = _copy_ledger(tmp_path)
    original_root = verify(tmp_path).merkle_root
    target = next(r for r in records if r["kind"] == "task_done")
    payload = target["payload"]
    assert isinstance(payload, dict)
    payload["usd"] = 0.0001
    _write(tmp_path, records)
    rep = verify(tmp_path)
    assert not rep.ok
    assert any("hash mismatch" in e for e in rep.errors)
    assert rep.merkle_root == original_root  # stored hashes unchanged, chain check catches it


def test_rehashed_record_breaks_chain(tmp_path: Path) -> None:
    records = _copy_ledger(tmp_path)
    original_root = verify(tmp_path).merkle_root
    i = next(k for k, r in enumerate(records) if r["kind"] == "task_done")
    payload = records[i]["payload"]
    assert isinstance(payload, dict)
    payload["solved"] = not payload["solved"]
    records[i]["hash"] = record_hash(str(records[i]["prev_hash"]), payload)
    _write(tmp_path, records)
    rep = verify(tmp_path)
    assert not rep.ok
    assert any("prev_hash" in e for e in rep.errors)
    assert rep.merkle_root != original_root


def test_deleted_record_detected(tmp_path: Path) -> None:
    records = _copy_ledger(tmp_path)
    del records[5]
    _write(tmp_path, records)
    rep = verify(tmp_path)
    assert not rep.ok
    assert any("seq" in e for e in rep.errors)
