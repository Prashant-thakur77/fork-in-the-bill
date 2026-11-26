"""Turn a test log into ``{test_name: status}`` using an instance's log parser.

SWE-bench-Live ships each instance's parser as Python source defining ``parser(log) -> dict``.
That source is dataset content, so it never runs in this process: it runs in a separate
``python -I`` interpreter with a timeout, CPU and memory limits, an empty environment and a
scratch working directory. The one exception is the ``"pytest"`` marker, which selects the
standard SWE-bench pytest parser implemented here.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import resource
import subprocess
import sys
import tempfile
from collections.abc import Callable
from typing import Any

PYTEST_PARSER = "pytest"
DEFAULT_TIMEOUT = 120.0
MEMORY_LIMIT_BYTES = 4 << 30

# Matches the official harness's cleanup of terminal output before parsing.
ANSI_ESCAPE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")


class LogParseError(RuntimeError):
    pass


def clean_terminal_output(text: str) -> str:
    return ANSI_ESCAPE.sub("", text).replace("\r", "")


# --- built-in pytest parser (SWE-bench semantics) ------------------------------------------

_PYTEST_STATUSES = ("FAILED", "PASSED", "SKIPPED", "ERROR", "XFAIL", "XPASS")


def _pytest_node_id(rest: str) -> str:
    rest = rest.strip()
    depth = 0
    for i, ch in enumerate(rest):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth = max(depth - 1, 0)
        elif ch.isspace() and depth == 0:
            return rest[:i]
    if depth == 0:
        return rest
    tokens = rest.split()
    return tokens[0] if tokens else ""


def parse_log_pytest(log: str) -> dict[str, str]:
    """Raw ``-rA`` short-summary statuses, e.g. ``{"tests/a.py::t": "PASSED"}``."""
    statuses: dict[str, str] = {}
    for line in log.split("\n"):
        if not line.startswith(_PYTEST_STATUSES):
            continue
        status, _, rest = line.partition(" ")
        test_id = _pytest_node_id(rest)
        if not test_id:
            continue
        if status == "SKIPPED" and re.fullmatch(r"\[\d+\]", test_id):
            continue
        statuses[test_id] = status
    return statuses


def default_pytest_parser(log: str) -> dict[str, str]:
    """pytest statuses collapsed to pass/fail/skip; XFAIL counts as pass, as in SWE-bench."""
    out: dict[str, str] = {}
    for test, status in parse_log_pytest(log).items():
        s = status.lower()
        if status.upper() == "XFAIL" or "pass" in s:
            out[test] = "pass"
        elif "skip" in s:
            out[test] = "skip"
        else:
            out[test] = "fail"
    return out


# --- sandboxed execution of dataset parsers -------------------------------------------------

_CHILD = r"""
import json, sys
payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
ns = {"__name__": "dataset_log_parser"}
exec(compile(payload["source"], "<log_parser>", "exec"), ns)
fn = ns.get("parser")
if not callable(fn):
    raise NotImplementedError("log parser source must define a callable named 'parser'")
result = fn(payload["log"])
if result is None:
    result = {}
if not isinstance(result, dict):
    raise TypeError(f"parser returned {type(result).__name__}, expected dict")
out = {str(k): str(v) for k, v in result.items()}
sys.stdout.write("\x00RESULT\x00" + json.dumps(out))
"""

_RESULT_MARK = "\x00RESULT\x00"


def _limits(memory_bytes: int, cpu_seconds: int) -> Callable[[], None]:
    def apply() -> None:
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 5))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.setsid()

    return apply


def _decode_result(returncode: int | None, stdout: bytes, stderr: bytes) -> dict[str, str]:
    text = stdout.decode("utf-8", errors="replace")
    idx = text.rfind(_RESULT_MARK)
    if returncode != 0 or idx < 0:
        tail = stderr.decode("utf-8", errors="replace")[-2000:]
        raise LogParseError(f"log parser failed (exit {returncode}): {tail.strip()}")
    data: Any = json.loads(text[idx + len(_RESULT_MARK) :])
    if not isinstance(data, dict):
        raise LogParseError("log parser output is not an object")
    return {str(k): str(v) for k, v in data.items()}


def _child_argv() -> list[str]:
    return [sys.executable, "-I", "-c", _CHILD]


def _child_env() -> dict[str, str]:
    return {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "PYTHONIOENCODING": "utf-8"}


def parse_log(
    parser_source: str,
    log: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    memory_bytes: int = MEMORY_LIMIT_BYTES,
) -> dict[str, str]:
    """Run ``parser_source`` on ``log`` in a sandboxed subprocess (sync)."""
    if parser_source.strip().lower() == PYTEST_PARSER:
        return default_pytest_parser(log)
    payload = json.dumps({"source": parser_source, "log": log}).encode("utf-8")
    with tempfile.TemporaryDirectory(prefix="fib-parse-") as cwd:
        try:
            proc = subprocess.run(
                _child_argv(),
                input=payload,
                capture_output=True,
                timeout=timeout,
                cwd=cwd,
                env=_child_env(),
                preexec_fn=_limits(memory_bytes, int(timeout) + 1),
                check=False,
            )
        except subprocess.TimeoutExpired as e:
            raise LogParseError(f"log parser timed out after {timeout:.0f}s") from e
    return _decode_result(proc.returncode, proc.stdout, proc.stderr)


async def parse_log_async(
    parser_source: str,
    log: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    memory_bytes: int = MEMORY_LIMIT_BYTES,
) -> dict[str, str]:
    """Async variant of :func:`parse_log`."""
    if parser_source.strip().lower() == PYTEST_PARSER:
        return default_pytest_parser(log)
    payload = json.dumps({"source": parser_source, "log": log}).encode("utf-8")
    with tempfile.TemporaryDirectory(prefix="fib-parse-") as cwd:
        proc = await asyncio.create_subprocess_exec(
            *_child_argv(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=_child_env(),
            preexec_fn=_limits(memory_bytes, int(timeout) + 1),
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(payload), timeout)
        except TimeoutError as e:
            proc.kill()
            await proc.wait()
            raise LogParseError(f"log parser timed out after {timeout:.0f}s") from e
    return _decode_result(proc.returncode, stdout, stderr)
