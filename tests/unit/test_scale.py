"""Scale counters, list prices and the per-1,000 projection, on a tiny made-up repository."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from analysis.analyse import projection_block
from analysis.scale import build_pricing, build_scale

ROOT = Path(__file__).resolve().parents[2]


def _jsonl(path: Path, rows: Sequence[Mapping[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


def _task(instance: str, attempt: int, tests: dict[str, str], repo: str, language: str) -> dict[str, object]:
    return {"instance_id": instance, "attempt": attempt, "tests": tests, "traits": {"repo": repo, "language": language}}


def _call(**tokens: int) -> dict[str, object]:
    return {f"{k}_tokens": v for k, v in tokens.items()}


@pytest.fixture
def tiny(tmp_path: Path) -> Path:
    exp = tmp_path / "runs" / "exp1"
    _jsonl(
        exp / "tasks.jsonl",
        [
            _task("foo", 2, {"a": "pass", "b": "fail"}, "o/foo", "go"),
            _task("bar", 1, {"c": "skip"}, "o/bar", "go"),
            _task("baz", 1, {}, "o/foo", "rust"),
        ],
    )
    _jsonl(exp / "ledger.jsonl", [{"kind": "task_done"}] * 3 + [{"kind": "config"}, {"kind": "event_sent"}])
    _jsonl(exp / "events.jsonl", [{"event": "task_cost"}] * 4)
    _jsonl(exp / "calls.jsonl", [_call(input=1, output=2, cache_read=10), _call(input=3, cache_write_5m=4)])
    (exp / "env").mkdir()
    for name in ("000-start.json", "001-run.json"):
        (exp / "env" / name).write_text("{}")
    (exp / "transcripts").mkdir()
    for name in ("foo__a1.json", "foo__a2.json", "bar__a1.json", "baz__a1.json"):
        (exp / "transcripts" / name).write_text("{}")
    pilot = tmp_path / "runs" / "pilot-control"
    _jsonl(pilot / "tasks.jsonl", [_task("qux", 1, {"d": "pass"}, "o/qux", "c")])
    _jsonl(pilot / "ledger.jsonl", [{"kind": "task_done"}])
    (tmp_path / "runs" / "empty").mkdir()

    for rel, private in (("kit/package.json", True), ("kit/ts/package.json", False), ("kit/mcp/package.json", False)):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(json.dumps({"name": rel, **({"private": True} if private else {})}))
    (tmp_path / "kit/node_modules/x").mkdir(parents=True)
    (tmp_path / "kit/node_modules/x/package.json").write_text("{}")
    for d in ("01-first", "02-second", "output", "screenshots"):
        (tmp_path / "examples" / d).mkdir(parents=True)
    (tmp_path / "tests" / "unit").mkdir(parents=True)
    (tmp_path / "tests" / "unit" / "test_x.py").write_text(
        "def test_a():\n    pass\n\nasync def test_b():\n    pass\n\n"
        "class TestC:\n    def test_c(self):\n        pass\n\ndef helper():\n    pass\n"
    )
    (tmp_path / "board/web/test").mkdir(parents=True)
    (tmp_path / "board/web/test/a.test.ts").write_text(
        'describe("x", () => {\n  it("one", () => {});\n  test("two", () => {});\n  obj.it("no");\n});\n'
    )
    (tmp_path / "kit/ts/test").mkdir(parents=True)
    (tmp_path / "kit/ts/test/b.test.ts").write_text('it("three", () => {});\n')
    (tmp_path / "prereg").mkdir()
    (tmp_path / "prereg" / "HASHES.txt").write_text(
        "aa  prereg/experiment-1.md\nbb  prereg/pilot-report.md\ncc  prereg/experiment-1-amendment-1.md\n"
    )
    return tmp_path


def test_counters_on_a_tiny_repository(tiny: Path) -> None:
    s = build_scale(tiny / "runs", tiny)
    assert s["tasks_run"] == 4 and s["tasks_by_batch"] == {"exp1": 3, "pilot-control": 1}
    assert s["task_attempts"] == 5  # foo's first attempt left a transcript and no task record
    assert s["task_attempts_by_batch"]["exp1"] == 4
    assert s["tests_executed"] == 4 and s["tests_executed_by_batch"] == {"exp1": 3, "pilot-control": 1}
    assert s["tests_by_result"] == {"fail": 1, "pass": 2, "skip": 1}
    assert s["model_calls"] == 2
    assert s["tokens"] == 20
    assert s["tokens_by_kind"] == {"input": 4, "output": 2, "cache_write_5m": 4, "cache_write_1h": 0, "cache_read": 10}
    assert s["ledger_records"] == 6
    assert s["events_sent"] == 4
    assert s["env_snapshots"] == 2 and s["transcripts"] == 4
    assert s["repos"] == 2 and s["languages"] == 2
    assert s["npm_packages"] == 2
    assert s["examples"] == 2
    assert (s["unit_tests_python"], s["unit_tests_ts"], s["unit_tests"]) == (3, 3, 6)
    assert s["prereg_tags"] == 2


def test_pricing_reads_the_table_for_the_arms_models() -> None:
    p = build_pricing(ROOT, "claude-sonnet-5-5", "claude-haiku-5-5")
    assert p is not None
    assert p["frontier_input_per_mtok"] == 2.0 and p["small_input_per_mtok"] == 0.1
    assert p["frontier_output_per_mtok"] == 10.0 and p["small_output_per_mtok"] == 0.5
    assert p["frontier_to_small_ratio"] == pytest.approx(20.0)
    assert build_pricing(ROOT, "claude-sonnet-5-5", "no-such-model") is None
    assert build_pricing(ROOT, None, "claude-haiku-5-5") is None


def test_projection_is_arithmetic_on_cost_per_solve() -> None:
    exp = {
        "arms": {"control": {"cost_per_solve": 0.2}, "lanes_v1": {"cost_per_solve": 0.05}},
        "delta": {"treatment": "lanes_v1"},
    }
    out = projection_block(exp)["per_1000_solved"]
    assert out == pytest.approx({"control": 200.0, "lanes_v1": 50.0, "saved": 150.0})
    exp["arms"]["lanes_v1"]["cost_per_solve"] = None
    assert projection_block(exp)["per_1000_solved"]["saved"] is None
