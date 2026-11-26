"""Run tasks from the queue: assign through Flagsmith, run the agent in the task container,
grade in a fresh container, then record, send events and acknowledge.

    python -m runner.worker enqueue --exp exp1 --pool tasks/pools/exp1.jsonl
    python -m runner.worker run --exp exp1 --pool tasks/pools/exp1.jsonl --concurrency 6
    python -m runner.worker run --exp dryrun --pool ... --force-policy control --limit 2

`--force-policy` runs outside any experiment: no exposure, no events (dry runs and the pilot).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import signal
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import anthropic
import httpx
import typer

from harness import budget as budget_mod
from harness.agent import Agent, AgentResult
from harness.budget import BudgetExceeded, Ledgerish, TaskBudget
from harness.events import emit_task_events
from harness.lanes import LaneCaller
from harness.policy import Assignment, FlagsmithLike, assign, load_policy_file, make_client
from harness.schema import CallRecord, Lane, LedgerKind, Outcome, TaskRecord, identity_for
from harness.tools.sandbox import ExecResult as SbExec
from integrity.ledger import Ledger
from runner.containers import Docker, Limits, TaskContainer
from runner.flagsmith_gate import SerialFlagsmith
from runner.grading import GradeConfig, grade
from runner.queue import MAX_DELIVERIES, Lease, TaskQueue
from runner.reaper import reap
from tasks.model import TaskInstance
from tasks.sources import read_pool

log = logging.getLogger("worker")
app = typer.Typer(add_completion=False)

RAW = Path("runs/raw")


class ContainerSandbox:
    """Adapts runner.containers.TaskContainer to the agent's Sandbox protocol."""

    def __init__(self, tc: TaskContainer, workdir: str) -> None:
        self.tc = tc
        self.workdir = workdir

    async def exec(self, cmd: str, timeout: int) -> SbExec:
        r = await self.tc.exec(cmd, timeout=float(timeout))
        return SbExec(exit_code=124 if r.exit_code is None else r.exit_code, output=r.output, timed_out=r.timed_out)

    async def read_file(self, path: str) -> str:
        return (await self.tc.read_file(path)).decode("utf-8", errors="replace")

    async def write_file(self, path: str, content: str) -> None:
        await self.tc.write_file(path, content)


def traits_for(inst: TaskInstance) -> dict[str, str | int | float]:
    return {
        "repo": inst.repo,
        "language": inst.language,
        "created_month": inst.created_month,
        "gold_files": inst.gold_files,
        "gold_lines": inst.gold_lines,
    }


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def append_jsonl(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line.rstrip("\n") + "\n")


@dataclass
class RunCtx:
    exp: str
    run_dir: Path
    pool: dict[str, TaskInstance]
    docker: Docker
    flagsmith: FlagsmithLike | None
    force_policy: str | None
    budget: Ledgerish
    ledger: Ledger
    limits: Limits
    model: anthropic.AsyncAnthropic
    board_url: str | None = None
    board_secret: str | None = None
    prune_images: bool = False
    stop: asyncio.Event = field(default_factory=asyncio.Event)


async def run_one(ctx: RunCtx, inst: TaskInstance, attempt: int) -> TaskRecord:
    identity = identity_for(inst.instance_id)
    traits = traits_for(inst)
    control = load_policy_file("control")
    if ctx.force_policy:
        pol = load_policy_file(ctx.force_policy)
        a = Assignment(pol.policy, pol, "dry_run")
    else:
        assert ctx.flagsmith is not None
        fs = ctx.flagsmith
        a = await asyncio.to_thread(assign, fs, identity, dict(traits), control)
    if a.source == "kill_switch":
        ctx.ledger.append(LedgerKind.kill_switch, {"identity": identity, "ts": now()})

    started = now()
    t0 = time.monotonic()
    calls_path = ctx.run_dir / "calls.jsonl"

    def on_call(rec: CallRecord) -> None:
        append_jsonl(calls_path, rec.model_dump_json())

    caller = LaneCaller(
        client=ctx.model,
        identity=identity,
        global_budget=ctx.budget,
        task_budget=TaskBudget(a.policy.caps.usd_per_task),
        on_call=on_call,
    )
    result: AgentResult | None = None
    outcome: Outcome = Outcome.infra_error
    error: str | None = None
    solved = False
    tests: dict[str, str] = {}
    try:
        await ctx.docker.pull(inst.docker_image)
        tc = await ctx.docker.create(
            inst.docker_image,
            limits=ctx.limits,
            network=False,
            workdir=inst.workdir,
            labels={"fib.exp": ctx.exp, "fib.identity": identity},
        )
    except Exception as exc:  # image pull or container start: infrastructure, not the agent
        outcome, error = Outcome.infra_error, f"container: {type(exc).__name__}: {exc}"
        tc = None
    if tc is not None:
        try:
            agent = Agent(a.policy, caller, ContainerSandbox(tc, inst.workdir))
            result = await agent.run(inst.problem_statement)
            diff = await tc.git_diff()
        finally:
            await tc.remove()
        RAW.mkdir(parents=True, exist_ok=True)
        raw = {"identity": identity, "variant": a.variant, "transcript": result.transcript, "diff": diff}
        (RAW / f"{ctx.exp}__{inst.instance_id}__a{attempt}.json").write_text(json.dumps(raw, default=str))
        if result.outcome is not None and result.outcome in (Outcome.infra_error, Outcome.agent_error):
            outcome, error = result.outcome, result.error
        else:
            g = await grade(ctx.docker, inst, diff, GradeConfig(limits=ctx.limits, log_dir=RAW / "grading" / ctx.exp))
            solved = g.resolved
            tests = dict(g.run.statuses) if g.run else {}
            outcome = result.outcome or (Outcome.solved if solved else Outcome.unsolved)
            if result.outcome is not None and solved:
                outcome = Outcome.solved  # a capped run whose partial patch still passes counts as solved
            error = None if solved else g.reason
    if ctx.prune_images:
        await ctx.docker.remove_image(inst.docker_image)

    tot = caller.totals
    rec = TaskRecord(
        experiment=ctx.exp,
        identity=identity,
        instance_id=inst.instance_id,
        variant=a.variant,
        policy=a.policy,
        flag_source=a.source,
        outcome=outcome,
        solved=solved,
        usd=round(tot[Lane.main].usd + tot[Lane.delegate].usd, 8),
        usd_main=round(tot[Lane.main].usd, 8),
        usd_delegate=round(tot[Lane.delegate].usd, 8),
        tokens_main=tot[Lane.main].tokens,
        tokens_delegate=tot[Lane.delegate].tokens,
        turns=result.turns if result else 0,
        delegate_calls=result.delegate_calls if result else 0,
        seconds=round(time.monotonic() - t0, 3),
        started_at=started,
        finished_at=now(),
        trace_id="",
        traits=traits,
        tests=tests,
        error=error,
        attempt=attempt,
    )
    return rec


def finish(ctx: RunCtx, rec: TaskRecord, *, final: bool) -> None:
    """Record a task. Events go to Flagsmith once per exposed identity, on its final attempt."""
    append_jsonl(ctx.run_dir / "tasks.jsonl", rec.model_dump_json())
    ctx.ledger.append(LedgerKind.task_done, json.loads(rec.model_dump_json()))
    exposed = rec.flag_source in ("experiment", "fail_closed")
    if final and exposed and ctx.flagsmith is not None:
        emit_task_events(ctx.flagsmith, rec, ctx.run_dir / "events.jsonl", ctx.ledger)
    if final and rec.outcome == Outcome.infra_error:
        line = {"identity": rec.identity, "reason": rec.error, "attempts": rec.attempt}
        append_jsonl(ctx.run_dir / "exclusions.jsonl", json.dumps(line))
        ctx.ledger.append(LedgerKind.exclusion, line)
    post_board(ctx)


def board_snapshot(run_dir: Path, exp: str) -> dict[str, Any]:
    arms: dict[str, dict[str, Any]] = {}
    last: dict[str, Any] | None = None
    latest: dict[str, dict[str, Any]] = {}
    p = run_dir / "tasks.jsonl"
    if p.exists():
        for line in p.read_text().splitlines():
            r = json.loads(line)
            latest[r["identity"]] = r
            last = r
    for r in latest.values():
        a = arms.setdefault(r["variant"], {"done": 0, "solved": 0, "usd": 0.0, "running": 0})
        a["done"] += 1
        a["solved"] += int(r["solved"])
        a["usd"] = round(a["usd"] + r["usd"], 6)
    snap: dict[str, Any] = {
        "experiment": exp,
        "ts": int(time.time()),
        "status": "running",
        "flagsmith_experiment_url": os.environ.get("FLAGSMITH_EXPERIMENT_URL", ""),
        "arms": arms,
    }
    if last:
        snap["last_task"] = {
            "variant": last["variant"],
            "usd": last["usd"],
            "solved": last["solved"],
            "language": last["traits"].get("language", ""),
        }
    return snap


def post_board(ctx: RunCtx) -> None:
    if not (ctx.board_url and ctx.board_secret):
        return
    body = json.dumps(board_snapshot(ctx.run_dir, ctx.exp), separators=(",", ":"))
    ts = str(int(time.time()))
    sig = hmac.new(ctx.board_secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    try:
        httpx.post(
            f"{ctx.board_url.rstrip('/')}/ingest",
            content=body,
            timeout=10,
            headers={"content-type": "application/json", "X-FB-Timestamp": ts, "X-FB-Signature": sig},
        )
    except httpx.HTTPError as exc:  # the board is a view; a failed post never affects a run
        log.warning("board post failed: %s", exc)


async def worker_loop(ctx: RunCtx, q: TaskQueue, wid: int, limit: list[int]) -> None:
    while not ctx.stop.is_set():
        if limit[0] == 0:
            return
        lease: Lease | None = await asyncio.to_thread(q.lease, 2_000)
        if lease is None:
            if await asyncio.to_thread(q.remaining) == 0:
                return
            continue
        limit[0] -= 1
        identity = identity_for(lease.instance_id)
        if q.is_done(identity):
            q.complete(lease, identity)
            continue
        hb = asyncio.create_task(_heartbeat(q, lease))
        try:
            rec = await run_one(ctx, ctx.pool[lease.instance_id], lease.attempt)
        except BudgetExceeded as exc:
            log.error("worker %d: %s; stopping all workers", wid, exc)
            ctx.stop.set()
            q.requeue(lease)
            return
        finally:
            hb.cancel()
        retry = rec.outcome == Outcome.infra_error and lease.attempt < MAX_DELIVERIES
        finish(ctx, rec, final=not retry)
        if retry:
            log.warning("infra error on %s (attempt %d): %s; retrying once", identity, lease.attempt, rec.error)
            q.requeue(lease)
        else:
            q.complete(lease, identity)
        log.info("%s %s %s $%.4f turns=%d", identity, rec.variant, rec.outcome.value, rec.usd, rec.turns)


async def _heartbeat(q: TaskQueue, lease: Lease) -> None:
    while True:
        await asyncio.sleep(30)
        await asyncio.to_thread(q.heartbeat, lease.msg_id)


def _redis() -> Any:
    import redis

    return redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))


@app.command()
def enqueue(exp: Annotated[str, typer.Option()], pool: Annotated[Path, typer.Option()]) -> None:
    ids = [i.instance_id for i in read_pool(pool)]
    n = TaskQueue(_redis(), exp).enqueue(ids)
    typer.echo(f"enqueued {n} new of {len(ids)} for {exp}")


@app.command()
def run(
    exp: Annotated[str, typer.Option()],
    pool: Annotated[Path, typer.Option()],
    concurrency: Annotated[int, typer.Option()] = 4,
    force_policy: Annotated[str | None, typer.Option(help="run outside the experiment with this policy")] = None,
    limit: Annotated[int, typer.Option(help="stop after this many leases (-1: no limit)")] = -1,
    cpus: Annotated[float, typer.Option()] = 2.0,
    mem: Annotated[str, typer.Option()] = "6g",
    prune_images: Annotated[bool, typer.Option()] = False,
    phase_budget: Annotated[str | None, typer.Option(help="per-phase cap name, reads BUDGET_USD_<NAME>")] = None,
) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    run_dir = Path("runs") / exp
    run_dir.mkdir(parents=True, exist_ok=True)
    instances = {i.instance_id: i for i in read_pool(pool)}
    q = TaskQueue(_redis(), exp)
    q.enqueue(list(instances))
    fs: FlagsmithLike | None = None if force_policy else SerialFlagsmith(make_client())
    ledger = Ledger(run_dir / "ledger.jsonl")
    pool_sha = hashlib.sha256(pool.read_bytes()).hexdigest()
    meta_path = run_dir / "meta.json"
    if not meta_path.exists():
        meta_path.write_text(
            json.dumps(
                {
                    "experiment": exp,
                    "pool_file": str(pool),
                    "pool_sha256": pool_sha,
                    "force_policy": force_policy,
                    "started_at": now(),
                    "flagsmith_experiment_id": os.environ.get("FLAGSMITH_EXPERIMENT_ID"),
                },
                indent=1,
            )
        )
    ledger.append(
        LedgerKind.config,
        {
            "event": "worker_start",
            "exp": exp,
            "pool_sha256": pool_sha,
            "force_policy": force_policy,
            "concurrency": concurrency,
            "ts": now(),
        },
    )
    ctx = RunCtx(
        exp=exp,
        run_dir=run_dir,
        pool=instances,
        docker=Docker(),
        flagsmith=fs,
        force_policy=force_policy,
        budget=budget_mod.from_env(phase_budget or exp),
        ledger=ledger,
        limits=Limits(cpus=cpus, mem=mem),
        model=anthropic.AsyncAnthropic(max_retries=4, timeout=600.0),
        board_url=os.environ.get("BOARD_INGEST_URL") or None,
        board_secret=os.environ.get("BOARD_INGEST_SECRET") or None,
        prune_images=prune_images,
    )

    async def main() -> None:
        loop = asyncio.get_running_loop()
        loop.add_signal_handler(signal.SIGTERM, ctx.stop.set)
        for iid in reap(q, min_idle_ms=150_000):
            ctx.ledger.append(LedgerKind.exclusion, {"identity": identity_for(iid), "reason": "lease expired twice"})
        budget_left = [limit]
        await asyncio.gather(*(worker_loop(ctx, q, i, budget_left) for i in range(concurrency)))

    try:
        asyncio.run(main())
    finally:
        if fs is not None:
            fs.close()
        ctx.docker.close()
    typer.echo(f"done; spent so far ${ctx.budget.spent():.4f}")


if __name__ == "__main__":
    app()
