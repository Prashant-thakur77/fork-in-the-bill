import json

from harness.schema import LedgerKind
from integrity.ledger import GENESIS, Ledger, record_hash


def test_chain(tmp_path):
    led = Ledger(tmp_path / "l.jsonl")
    a = led.append(LedgerKind.config, {"x": 1})
    b = led.append(LedgerKind.task_done, {"identity": "swelive:a", "usd": 0.5})
    assert a.seq == 0 and a.prev_hash == GENESIS
    assert b.seq == 1 and b.prev_hash == a.hash
    assert b.hash == record_hash(a.hash, {"identity": "swelive:a", "usd": 0.5})
    lines = [json.loads(x) for x in (tmp_path / "l.jsonl").read_text().splitlines()]
    assert [r["seq"] for r in lines] == [0, 1]


def test_hash_ignores_key_order():
    assert record_hash(GENESIS, {"a": 1, "b": 2}) == record_hash(GENESIS, {"b": 2, "a": 1})
