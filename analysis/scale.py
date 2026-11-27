"""Counts of how much work the study did, and the list prices it ran at, for numbers.json.

`scale` counts what is committed: every run directory under runs/ (experiment 2 included once
runs/exp2 is committed), plus a few repository counts. Definitions are in docs/interfaces.md.
These are counts, not results, and nothing here enters a decision.

`pricing` reads harness/pricing.json for the two models the experiment 1 arms used: the frontier
model is the control arm's worker model and the small model is the treatment arm's.
"""

from __future__ import annotations

import ast
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from analysis.to_parquet import read_jsonl

TOKEN_KINDS = ("input", "output", "cache_write_5m", "cache_write_1h", "cache_read")
TS_TEST_DIRS = ("board/web", "board/worker", "kit/ts", "kit/mcp")
TS_TEST_CALL = re.compile(r"(?<![\w.$])(?:it|test)\(")
TRANSCRIPT_NAME = re.compile(r"^(?P<instance>.+)__a(?P<attempt>\d+)\.json$")
EXAMPLE_DIR = re.compile(r"^\d\d-")


def _run_dirs(runs: Path) -> list[Path]:
    return sorted(p for p in runs.iterdir() if p.is_dir()) if runs.exists() else []


def _attempts(run: Path, tasks: list[dict[str, Any]]) -> set[tuple[str, int]]:
    """(instance_id, attempt) for every attempt that left a task record or a transcript.

    One transcript is written per attempt, before grading. An attempt whose worker was stopped
    after the agent finished but before the task record was written leaves a transcript and no
    record; its lease was re-queued and the next attempt wrote the record. In runs/exp1 four
    identities have such a first attempt (codegraph-1313, floci-1837, floci-1932, hugo-14741), so
    the 146 task_done records come from 150 attempts, one transcript each. Runs before exp1 kept no
    transcripts, so their attempts are their task records.
    """
    seen = {(str(t["instance_id"]), int(t.get("attempt", 1))) for t in tasks}
    tdir = run / "transcripts"
    if tdir.is_dir():
        for f in tdir.iterdir():
            m = TRANSCRIPT_NAME.match(f.name)
            if m:
                seen.add((m.group("instance"), int(m.group("attempt"))))
    return seen


def python_test_functions(tests: Path) -> int:
    """Functions named test_* under tests/, counted in the source (a parametrized test counts once)."""
    total = 0
    for path in sorted(tests.rglob("*.py")) if tests.exists() else []:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        total += sum(
            1
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name.startswith("test_")
        )
    return total


def ts_test_cases(root: Path) -> int:
    """`test(` and `it(` calls in *.test.ts(x) files of the TypeScript packages (a call in a loop counts once)."""
    total = 0
    for rel in TS_TEST_DIRS:
        base = root / rel
        if not base.exists():
            continue
        for path in sorted(base.rglob("*.test.ts*")):
            if "node_modules" in path.parts:
                continue
            total += len(TS_TEST_CALL.findall(path.read_text(encoding="utf-8")))
    return total


def npm_packages(root: Path) -> int:
    """package.json files under kit/ that are not marked private."""
    count = 0
    kit = root / "kit"
    for path in sorted(kit.rglob("package.json")) if kit.exists() else []:
        if "node_modules" in path.parts:
            continue
        if not json.loads(path.read_text(encoding="utf-8")).get("private", False):
            count += 1
    return count


def prereg_registrations(root: Path) -> int:
    """Registration files (prereg/experiment-*.md, amendments included) listed in prereg/HASHES.txt.

    Each has its own prereg-* git tag. HASHES.txt also lists prereg/pilot-report.md, which is hashed
    but not tagged, so it is not counted.
    """
    hashes = root / "prereg" / "HASHES.txt"
    if not hashes.exists():
        return 0
    names = {line.split()[-1] for line in hashes.read_text(encoding="utf-8").split("\n") if line.strip()}
    return sum(1 for n in names if re.fullmatch(r"prereg/experiment-[\w-]+\.md", n))


def build_scale(runs: Path, root: Path, primary: str = "exp1") -> dict[str, Any]:
    tasks_by: dict[str, int] = {}
    attempts_by: dict[str, int] = {}
    tests_by: dict[str, int] = {}
    test_results: Counter[str] = Counter()
    tokens: Counter[str] = Counter()
    calls = ledger_records = events = snapshots = transcripts = 0
    for run in _run_dirs(runs):
        tasks = read_jsonl(run / "tasks.jsonl")
        ledger = read_jsonl(run / "ledger.jsonl")
        if not tasks and not ledger:
            continue
        tasks_by[run.name] = sum(1 for r in ledger if r.get("kind") == "task_done")
        attempts_by[run.name] = len(_attempts(run, tasks))
        tests_by[run.name] = sum(len(t.get("tests") or {}) for t in tasks)
        test_results.update(str(v) for t in tasks for v in (t.get("tests") or {}).values())
        for c in read_jsonl(run / "calls.jsonl"):
            calls += 1
            tokens.update({k: int(c.get(f"{k}_tokens", 0)) for k in TOKEN_KINDS})
        ledger_records += len(ledger)
        events += len(read_jsonl(run / "events.jsonl"))
        snapshots += len(list((run / "env").glob("*.json"))) if (run / "env").is_dir() else 0
        transcripts += (
            sum(1 for p in (run / "transcripts").iterdir() if p.is_file()) if (run / "transcripts").is_dir() else 0
        )
    primary_tasks = read_jsonl(runs / primary / "tasks.jsonl")
    py, ts = python_test_functions(root / "tests"), ts_test_cases(root)
    examples = root / "examples"
    return {
        "tasks_run": sum(tasks_by.values()),
        "tasks_by_batch": tasks_by,
        "task_attempts": sum(attempts_by.values()),
        "task_attempts_by_batch": attempts_by,
        "tests_executed": sum(tests_by.values()),
        "tests_executed_by_batch": tests_by,
        "tests_by_result": dict(sorted(test_results.items())),
        "model_calls": calls,
        "tokens": sum(tokens.values()),
        "tokens_by_kind": {k: tokens[k] for k in TOKEN_KINDS},
        "ledger_records": ledger_records,
        "events_sent": events,
        "env_snapshots": snapshots,
        "transcripts": transcripts,
        "repos": len({str((t.get("traits") or {}).get("repo")) for t in primary_tasks}),
        "languages": len({str((t.get("traits") or {}).get("language")) for t in primary_tasks}),
        "npm_packages": npm_packages(root),
        "examples": sum(1 for p in examples.iterdir() if p.is_dir() and EXAMPLE_DIR.match(p.name))
        if examples.exists()
        else 0,
        "unit_tests": py + ts,
        "unit_tests_python": py,
        "unit_tests_ts": ts,
        "prereg_tags": prereg_registrations(root),
    }


def build_pricing(root: Path, frontier_model: str | None, small_model: str | None) -> dict[str, Any] | None:
    path = root / "harness" / "pricing.json"
    if not path.exists() or not frontier_model or not small_model:
        return None
    models = json.loads(path.read_text(encoding="utf-8"))["models"]
    if frontier_model not in models or small_model not in models:
        return None
    big, small = models[frontier_model], models[small_model]
    return {
        "frontier_model": frontier_model,
        "small_model": small_model,
        "frontier_input_per_mtok": float(big["input"]),
        "frontier_output_per_mtok": float(big["output"]),
        "small_input_per_mtok": float(small["input"]),
        "small_output_per_mtok": float(small["output"]),
        "frontier_to_small_ratio": float(big["input"]) / float(small["input"]),
    }
