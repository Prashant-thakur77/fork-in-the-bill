"""Grade a patch against a TaskInstance, following the SWE-bench-Live evaluation procedure.

Per instance, in a fresh container started from the instance image:

1. ``git apply --reject --whitespace=nowarn`` the ``test_patch`` in ``/testbed``, then the
   candidate patch (a failed apply is recorded but does not stop the run, as upstream).
2. Run ``rebuild_cmds`` then ``test_cmds`` (each list joined with ``" ; "``) in one logical shell
   session, then ``print_cmds``; the print output is the test log. Sources without print
   commands get the upstream fallback: tests run via ``run_test.sh`` into ``testlog.out``,
   which is then printed.
3. Parse the log with the instance's parser and resolve: every FAIL_TO_PASS test passes and
   every PASS_TO_PASS test is present and not failing (upstream ``run_instance`` rules,
   including its handling of truncated parametrised test ids).

An empty candidate patch is unresolved without running anything, as upstream.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from runner.containers import STATE_DIR, Docker, ExecResult, Limits, TaskContainer
from runner.logparse import LogParseError, parse_log_async
from tasks.model import TaskInstance

NetworkMode = Literal["none", "rebuild", "all"]

OOM_EXIT_CODE = 137


@dataclass(frozen=True)
class GradeConfig:
    limits: Limits = field(default_factory=Limits)
    # Grading runs in its own container after the agent has finished, so network access here
    # cannot help the agent. "all" (default) matches the upstream harness; some suites have
    # live-network tests in PASS_TO_PASS. "rebuild": network only while rebuild_cmds run.
    # "none": fully offline.
    network: NetworkMode = "all"
    command_timeout: float = 150 * 60  # upstream per-command timeout
    parse_timeout: float = 120.0
    log_dir: Path | None = None


@dataclass(frozen=True)
class Verdict:
    resolved: bool
    f2p_success: list[str]
    f2p_failure: list[str]
    f2p_missing: list[str]
    p2p_success: list[str]
    p2p_failure: list[str]
    p2p_missing: list[str]


@dataclass
class TestRun:
    __test__ = False  # not a pytest test class

    log: str = ""
    statuses: dict[str, str] = field(default_factory=dict)
    test_patch_applied: bool = False
    patch_applied: bool | None = None  # None: no candidate patch in this run
    exit_codes: dict[str, int | None] = field(default_factory=dict)
    timed_out: bool = False
    oom: bool = False
    parse_error: str | None = None
    seconds: float = 0.0

    def summary(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("log")
        d.pop("statuses")
        d["n_statuses"] = len(self.statuses)
        return d


@dataclass(frozen=True)
class GradeResult:
    instance_id: str
    resolved: bool
    reason: str | None
    verdict: Verdict | None
    run: TestRun | None

    def to_json(self) -> dict[str, Any]:
        return {
            "instance_id": self.instance_id,
            "resolved": self.resolved,
            "reason": self.reason,
            "verdict": asdict(self.verdict) if self.verdict else None,
            "run": self.run.summary() if self.run else None,
        }


# --- resolution rules ------------------------------------------------------------------------


def resolve_test_case(case: str, statuses: dict[str, str]) -> str | None:
    """Key in ``statuses`` for expected test ``case``, or None (upstream semantics)."""
    if case in statuses:
        return case
    if case.count("[") > case.count("]"):
        matches = [k for k in statuses if k.split(maxsplit=1)[0] == case]
        if matches and len({statuses[k] for k in matches}) == 1:
            return matches[0]
    return None


def decide(fail_to_pass: Iterable[str], pass_to_pass: Iterable[str], statuses: dict[str, str]) -> Verdict:
    f2p = list(dict.fromkeys(fail_to_pass))
    p2p = list(dict.fromkeys(pass_to_pass))
    keys = {t: resolve_test_case(t, statuses) for t in [*f2p, *p2p]}

    def with_status(tests: list[str], word: str) -> list[str]:
        out: list[str] = []
        for t in tests:
            k = keys[t]
            if k is not None and word in statuses[k].lower():
                out.append(t)
        return out

    f2p_success = with_status(f2p, "pass")
    f2p_failure = with_status(f2p, "fail")
    p2p_success = with_status(p2p, "pass")
    p2p_failure = with_status(p2p, "fail")
    f2p_ok = set(f2p).issubset(f2p_success) or len(f2p_success) == len(f2p)
    p2p_present = all(keys[t] is not None for t in p2p)
    resolved = p2p_present and not p2p_failure and not f2p_failure and f2p_ok
    return Verdict(
        resolved=resolved,
        f2p_success=f2p_success,
        f2p_failure=f2p_failure,
        f2p_missing=[t for t in f2p if keys[t] is None],
        p2p_success=p2p_success,
        p2p_failure=p2p_failure,
        p2p_missing=[t for t in p2p if keys[t] is None],
    )


def failure_reason(verdict: Verdict, run: TestRun) -> str | None:
    if verdict.resolved:
        return None
    parts: list[str] = []
    if not run.test_patch_applied:
        parts.append("test_patch_apply_failed")
    if run.patch_applied is False:
        parts.append("patch_apply_failed")
    if run.timed_out:
        parts.append("timeout")
    if run.oom:
        parts.append("oom_killed")
    if run.parse_error:
        parts.append("parse_error")
    if verdict.f2p_failure or verdict.f2p_missing:
        parts.append(f"f2p_not_passing:{len(verdict.f2p_failure)}fail/{len(verdict.f2p_missing)}missing")
    if verdict.p2p_failure or verdict.p2p_missing:
        parts.append(f"p2p_broken:{len(verdict.p2p_failure)}fail/{len(verdict.p2p_missing)}missing")
    return ";".join(parts) or "unresolved"


# --- container procedure ---------------------------------------------------------------------


class _Clock:
    def __init__(self, command_timeout: float, deadline: float | None) -> None:
        self.command_timeout = command_timeout
        self.deadline = deadline

    def budget(self) -> float:
        if self.deadline is None:
            return self.command_timeout
        return max(1.0, min(self.command_timeout, self.deadline - time.monotonic()))


async def _apply_patch(tc: TaskContainer, patch: str, cwd: str, clock: _Clock) -> bool:
    path = f"{STATE_DIR}/{uuid.uuid4().hex}.diff"
    await tc.write_file(path, patch)
    res = await tc.exec(
        f"git apply --reject --whitespace=nowarn {path}; rc=$?; rm -f {path}; exit $rc",
        timeout=min(600.0, clock.budget()),
        workdir=cwd,
    )
    return res.ok


def _record(run: TestRun, phase: str, res: ExecResult) -> None:
    run.exit_codes[phase] = res.exit_code
    run.timed_out = run.timed_out or res.timed_out
    run.oom = run.oom or res.exit_code == OOM_EXIT_CODE


def _write_log(cfg: GradeConfig, name: str, text: str) -> None:
    if cfg.log_dir is None:
        return
    cfg.log_dir.mkdir(parents=True, exist_ok=True)
    (cfg.log_dir / name).write_text(text, encoding="utf-8")


async def run_tests(
    docker: Docker,
    inst: TaskInstance,
    patch: str | None,
    cfg: GradeConfig = GradeConfig(),
    *,
    label: str = "eval",
    deadline: float | None = None,
) -> TestRun:
    """Apply ``test_patch`` (+ ``patch`` if given), rebuild, run tests, parse the log."""
    started = time.monotonic()
    clock = _Clock(cfg.command_timeout, deadline)
    run = TestRun()
    tc = await docker.create(
        inst.docker_image,
        name=f"{inst.instance_id}-{label}",
        limits=cfg.limits,
        network=cfg.network == "all",
        workdir=inst.workdir,
        labels={"fib.instance": inst.instance_id, "fib.phase": label},
    )
    try:
        run.test_patch_applied = await _apply_patch(tc, inst.test_patch, inst.workdir, clock)
        if patch is not None:
            run.patch_applied = await _apply_patch(tc, patch, await tc.repo_root(), clock)

        rebuild = " ; ".join(inst.rebuild_cmds)
        test = " ; ".join(inst.test_cmds)
        show = " ; ".join(inst.print_cmds)
        transcript: list[str] = []

        if rebuild.strip():
            if cfg.network == "rebuild":
                await tc.set_network(True)
            res = await tc.exec(rebuild, timeout=clock.budget(), keep_state=True)
            _record(run, "rebuild", res)
            transcript.append(f"$ {rebuild}\n{res.output}")
            if cfg.network == "rebuild":
                await tc.set_network(False)

        if not show.strip():
            await tc.exec(
                f"cat > run_test.sh <<'CC_PROMPT'\n{test}\nCC_PROMPT\n",
                timeout=60,
                keep_state=True,
            )
            test = "bash run_test.sh > testlog.out 2>&1"
            show = "cat testlog.out"

        res = await tc.exec(test, timeout=clock.budget(), keep_state=True)
        _record(run, "test", res)
        transcript.append(f"$ {test}\n{res.output}")

        res = await tc.exec(show, timeout=min(600.0, clock.budget()), keep_state=True, max_output=None)
        _record(run, "print", res)
        run.log = res.output
        _write_log(cfg, f"{label}.commands.log", "\n".join(transcript))
        _write_log(cfg, f"{label}.test.log", run.log)
    finally:
        await tc.remove()

    try:
        run.statuses = await parse_log_async(inst.log_parser, run.log, timeout=cfg.parse_timeout)
    except LogParseError as e:
        run.parse_error = str(e)[:2000]
    run.seconds = time.monotonic() - started
    return run


async def grade(
    docker: Docker,
    inst: TaskInstance,
    patch: str,
    cfg: GradeConfig = GradeConfig(),
    *,
    label: str = "eval",
    deadline: float | None = None,
) -> GradeResult:
    """Resolve ``patch`` against ``inst``. ``resolved`` is the experiment's ``task_solved``."""
    if not patch.strip():
        return GradeResult(inst.instance_id, False, "empty_patch", None, None)
    run = await run_tests(docker, inst, patch, cfg, label=label, deadline=deadline)
    verdict = decide(inst.fail_to_pass, inst.pass_to_pass, run.statuses)
    return GradeResult(inst.instance_id, verdict.resolved, failure_reason(verdict, run), verdict, run)
