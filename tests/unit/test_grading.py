from __future__ import annotations

import pytest

from runner.containers import _HeadTail, split_image_ref
from runner.grading import TestRun, decide, failure_reason, grade, resolve_test_case
from runner.logparse import (
    LogParseError,
    clean_terminal_output,
    default_pytest_parser,
    parse_log,
    parse_log_async,
)
from tasks.model import TaskInstance

# --- resolution ------------------------------------------------------------------------------


def test_resolved_when_everything_passes() -> None:
    v = decide(["a"], ["b", "c"], {"a": "pass", "b": "pass", "c": "pass", "x": "fail"})
    assert v.resolved
    assert v.f2p_success == ["a"]


def test_f2p_failure_or_missing_is_unresolved() -> None:
    assert not decide(["a"], [], {"a": "fail"}).resolved
    v = decide(["a"], [], {})
    assert not v.resolved
    assert v.f2p_missing == ["a"]


def test_f2p_skip_is_unresolved() -> None:
    assert not decide(["a"], [], {"a": "skip"}).resolved


def test_p2p_missing_is_unresolved_but_skip_is_fine() -> None:
    assert not decide(["a"], ["b"], {"a": "pass"}).resolved
    assert decide(["a"], ["b"], {"a": "pass", "b": "skip"}).resolved
    assert not decide(["a"], ["b"], {"a": "pass", "b": "fail"}).resolved


def test_status_matching_is_case_insensitive_substring() -> None:
    assert decide(["a"], ["b"], {"a": "PASSED", "b": "Pass"}).resolved
    assert not decide(["a"], ["b"], {"a": "PASSED", "b": "FAILED"}).resolved


def test_truncated_parametrized_ids() -> None:
    statuses = {"t.py::f[a b]": "pass", "t.py::g[x y]": "pass", "t.py::g[x z]": "fail"}
    assert resolve_test_case("t.py::f[a", statuses) == "t.py::f[a b]"
    # ambiguous prefix with conflicting results: no match
    assert resolve_test_case("t.py::g[x", statuses) is None
    assert resolve_test_case("nope", statuses) is None


def test_duplicate_expected_ids_count_once() -> None:
    assert decide(["a", "a"], [], {"a": "pass"}).resolved


def test_failure_reason() -> None:
    run = TestRun(test_patch_applied=True, patch_applied=False, timed_out=True)
    v = decide(["a"], ["b"], {"b": "fail"})
    reason = failure_reason(v, run)
    assert reason is not None
    assert "patch_apply_failed" in reason
    assert "timeout" in reason
    assert "f2p_not_passing:0fail/1missing" in reason
    assert "p2p_broken:1fail/0missing" in reason
    assert failure_reason(decide(["a"], [], {"a": "pass"}), run) is None


async def test_empty_patch_is_unresolved_without_docker() -> None:
    inst = TaskInstance(
        instance_id="o__r-1",
        source="s",
        language="rust",
        repo="o/r",
        base_commit="a",
        created_at="2026-07-01T00:00:00Z",
        problem_statement="p",
        patch="g",
        test_patch="t",
        fail_to_pass=["a"],
        pass_to_pass=[],
        docker_image="img",
        rebuild_cmds=[],
        test_cmds=[],
        log_parser="pytest",
    )
    res = await grade(None, inst, "  \n")  # type: ignore[arg-type]
    assert not res.resolved
    assert res.reason == "empty_patch"


# --- parsers -------------------------------------------------------------------------------

PYTEST_LOG = """\
PASSED tests/test_a.py::test_one
FAILED tests/test_a.py::test_two - AssertionError: boom
PASSED tests/test_a.py::test_p[a - b-c d]
SKIPPED [2] tests/test_a.py:10: unconditional skip
SKIPPED tests/test_a.py::test_s
XFAIL tests/test_a.py::test_x - reason
XPASS tests/test_a.py::test_xp unexpected
ERROR tests/test_a.py::test_e - fixture
"""


def test_default_pytest_parser() -> None:
    s = default_pytest_parser(PYTEST_LOG)
    assert s == {
        "tests/test_a.py::test_one": "pass",
        "tests/test_a.py::test_two": "fail",
        "tests/test_a.py::test_p[a - b-c d]": "pass",
        "tests/test_a.py::test_s": "skip",
        "tests/test_a.py::test_x": "pass",
        "tests/test_a.py::test_xp": "pass",
        "tests/test_a.py::test_e": "fail",
    }
    assert parse_log("pytest", PYTEST_LOG) == s


PARSER = """\
import re

def parser(log: str) -> dict[str, str]:
    out = {}
    for m in re.finditer(r"^test (\\S+) \\.\\.\\. (ok|FAILED|ignored)$", log, re.M):
        out[m.group(1)] = {"ok": "pass", "FAILED": "fail", "ignored": "skip"}[m.group(2)]
    return out
"""

CARGO_LOG = "test a::b ... ok\ntest a::c ... FAILED\ntest a::d ... ignored\n"


def test_dataset_parser_runs_in_subprocess() -> None:
    assert parse_log(PARSER, CARGO_LOG) == {"a::b": "pass", "a::c": "fail", "a::d": "skip"}


async def test_dataset_parser_async() -> None:
    assert await parse_log_async(PARSER, CARGO_LOG) == {
        "a::b": "pass",
        "a::c": "fail",
        "a::d": "skip",
    }


def test_parser_is_isolated_from_this_process() -> None:
    src = (
        "import sys, os\n"
        "def parser(log):\n"
        "    print('noise on stdout')\n"
        "    return {'isolated': str(sys.flags.isolated), 'pid': str(os.getpid()),\n"
        "            'env': ','.join(sorted(os.environ))}\n"
    )
    import os

    out = parse_log(src, "")
    assert out["isolated"] == "1"
    assert out["pid"] != str(os.getpid())
    assert "HOME" not in out["env"].split(",")


@pytest.mark.parametrize(
    ("src", "match"),
    [
        ("def parser(log):\n    raise ValueError('bad log')\n", "bad log"),
        ("def parse(log):\n    return {}\n", "parser"),
        ("def parser(log):\n    return ['x']\n", "expected dict"),
        ("syntax error here(\n", "SyntaxError"),
    ],
)
def test_parser_failures_raise(src: str, match: str) -> None:
    with pytest.raises(LogParseError, match=match):
        parse_log(src, "log")


def test_parser_timeout() -> None:
    src = "def parser(log):\n    while True:\n        pass\n"
    with pytest.raises(LogParseError, match="timed out"):
        parse_log(src, "", timeout=1.5)


async def test_parser_timeout_async() -> None:
    src = "import time\ndef parser(log):\n    time.sleep(30)\n"
    with pytest.raises(LogParseError, match="timed out"):
        await parse_log_async(src, "", timeout=1.0)


def test_clean_terminal_output() -> None:
    assert clean_terminal_output("\x1b[32mok\x1b[0m\r\n") == "ok\n"


# --- container helpers ---------------------------------------------------------------------


def test_head_tail_truncation() -> None:
    buf = _HeadTail(10)
    for chunk in (b"0123", b"456789", b"abcdefghij"):
        buf.add(chunk)
    assert buf.truncated
    assert buf.total == 20
    text = buf.text()
    assert text.startswith("01234")
    assert text.endswith("fghij")
    assert "10 bytes truncated" in text
    full = _HeadTail(None)
    full.add(b"x" * 100)
    assert not full.truncated
    assert full.text() == "x" * 100


def test_split_image_ref() -> None:
    assert split_image_ref("starryzhang/sweb.eval.x86_64.a_1776_b-1") == (
        "starryzhang/sweb.eval.x86_64.a_1776_b-1",
        "latest",
    )
    assert split_image_ref("swerebench/x:latest") == ("swerebench/x", "latest")
    assert split_image_ref("localhost:5000/x") == ("localhost:5000/x", "latest")
    assert split_image_ref("r/x@sha256:abc") == ("r/x", "sha256:abc")
