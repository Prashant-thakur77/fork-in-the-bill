"""Validate pool instances in their Docker images, and drop invalid ones on request.

    python -m tasks.validate --pool pilot --pool exp1 --concurrency 2 --prune-images
    python -m tasks.validate --pool pilot --ids a__b-1 c__d-2
    python -m tasks.validate --apply            # rewrite pools without invalid instances

For each instance: pull the image (recording its digest), run the tests with only the test
patch applied (every FAIL_TO_PASS test must not pass), then grade the gold patch exactly as an
agent patch is graded (every FAIL_TO_PASS and PASS_TO_PASS test must pass). Results are merged
into ``tasks/validation_report.json`` keyed by instance id, after every instance.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import fcntl
import hashlib
import json
import os
import sys
import tempfile
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from runner.containers import Docker, Limits, PullError
from runner.grading import GradeConfig, NetworkMode, decide, failure_reason, run_tests
from tasks.model import TaskInstance
from tasks.select_tasks import POOLS_DIR, sha256_file
from tasks.sources import POOL_SUFFIX, pool_name, pool_path, read_pool, write_pool

REPORT = Path("tasks/validation_report.json")
DROPPED_LOG = POOLS_DIR / "dropped.jsonl"
LOG_ROOT = Path("work/validation")


def load_report(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_report(path: Path, report: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(dict(sorted(report.items())), indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def merge_entry(path: Path, instance_id: str, entry: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Re-read the report under an exclusive lock and merge one entry, so concurrent
    validation processes never overwrite each other's results."""
    path.parent.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:16]
    with (Path(tempfile.gettempdir()) / f"fib-report-{key}.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        report = load_report(path)
        report[instance_id] = entry
        save_report(path, report)
    return report


async def validate_instance(
    docker: Docker,
    inst: TaskInstance,
    cfg: GradeConfig,
    *,
    timeout: float,
    prune_image: bool,
) -> dict[str, Any]:
    started = time.monotonic()
    deadline = started + timeout
    entry: dict[str, Any] = {
        "valid": False,
        "reason": None,
        "f2p_before": None,
        "f2p_after": None,
        "p2p_after": None,
        "f2p_total": len(inst.fail_to_pass),
        "p2p_total": len(inst.pass_to_pass),
        "seconds": None,
        "image": inst.docker_image,
        "image_digest": None,
        "image_size_bytes": None,
        "network": cfg.network,
        "validated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    pulled = False
    try:
        try:
            pr = await docker.pull(inst.docker_image)
        except PullError as e:
            entry["reason"] = f"image_pull_failed: {e}"[:500]
            return entry
        pulled = pr.pulled
        entry["image_digest"] = pr.digest
        entry["image_size_bytes"] = pr.size_bytes

        async with asyncio.timeout(max(1.0, deadline - time.monotonic())):
            base = await run_tests(docker, inst, None, cfg, label="base", deadline=deadline)
            before = decide(inst.fail_to_pass, inst.pass_to_pass, base.statuses)
            entry["f2p_before"] = len(before.f2p_success)
            entry["base"] = base.summary()

            gold = await run_tests(docker, inst, inst.patch, cfg, label="gold", deadline=deadline)
            after = decide(inst.fail_to_pass, inst.pass_to_pass, gold.statuses)
            entry["f2p_after"] = len(after.f2p_success)
            entry["p2p_after"] = len(after.p2p_success)
            entry["gold"] = gold.summary()

        reasons: list[str] = []
        if not base.test_patch_applied:
            reasons.append("test_patch_apply_failed")
        if base.parse_error:
            reasons.append("base_parse_error")
        if before.f2p_success:
            reasons.append(f"f2p_pass_before_gold:{len(before.f2p_success)}")
        gold_reason = failure_reason(after, gold)
        if gold_reason:
            reasons.append(f"gold:{gold_reason}")
        entry["valid"] = not reasons
        entry["reason"] = ";".join(reasons) or None
        if after.f2p_failure or after.p2p_failure:
            entry["failing_after_gold"] = (after.f2p_failure + after.p2p_failure)[:20]
        if after.f2p_missing or after.p2p_missing:
            entry["missing_after_gold"] = (after.f2p_missing + after.p2p_missing)[:20]
    except TimeoutError:
        entry["reason"] = f"instance_timeout:{timeout:.0f}s"
    except Exception as e:
        entry["reason"] = f"error:{type(e).__name__}: {e}"[:500]
    finally:
        entry["seconds"] = round(time.monotonic() - started, 1)
        if prune_image and pulled:
            with contextlib.suppress(Exception):
                await docker.remove_image(inst.docker_image)
    return entry


async def run_validation(
    instances: Sequence[TaskInstance],
    *,
    report_path: Path,
    cfg: GradeConfig,
    concurrency: int,
    timeout: float,
    prune_images: bool,
) -> dict[str, dict[str, Any]]:
    docker = Docker()
    if not await docker.ping():
        raise SystemExit("docker daemon is not reachable")
    report = load_report(report_path)
    lock = asyncio.Lock()
    sem = asyncio.Semaphore(concurrency)
    done = 0

    async def one(inst: TaskInstance) -> None:
        nonlocal done
        async with sem:
            inst_cfg = GradeConfig(
                limits=cfg.limits,
                network=cfg.network,
                command_timeout=cfg.command_timeout,
                parse_timeout=cfg.parse_timeout,
                log_dir=(cfg.log_dir / inst.instance_id) if cfg.log_dir else None,
            )
            entry = await validate_instance(docker, inst, inst_cfg, timeout=timeout, prune_image=prune_images)
        async with lock:
            report[inst.instance_id] = entry
            merge_entry(report_path, inst.instance_id, entry)
            done += 1
            status = "VALID  " if entry["valid"] else "INVALID"
            print(
                f"[{done}/{len(instances)}] {status} {inst.instance_id} "
                f"f2p_before={entry['f2p_before']}/{entry['f2p_total']} "
                f"f2p_after={entry['f2p_after']}/{entry['f2p_total']} "
                f"p2p_after={entry['p2p_after']}/{entry['p2p_total']} "
                f"{entry['seconds']}s {entry['reason'] or ''}",
                flush=True,
            )

    try:
        await asyncio.gather(*(one(i) for i in instances))
    finally:
        print(f"docker pulls: {docker.pull_stats.as_dict()}", flush=True)
        docker.close()
    return report


def apply_report(pools: Sequence[str], report_path: Path, pools_dir: Path) -> int:
    """Rewrite pool files without instances marked invalid; log what was dropped and why."""
    report = load_report(report_path)
    manifest_path = pools_dir / "manifest.json"
    manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    dropped_total = 0
    with (pools_dir / DROPPED_LOG.name).open("a", encoding="utf-8") as log:
        for name in pools:
            jsonl = pool_path(pools_dir, name)
            insts = read_pool(jsonl)
            keep: list[TaskInstance] = []
            unvalidated = 0
            for inst in insts:
                entry = report.get(inst.instance_id)
                if entry is None:
                    unvalidated += 1
                    keep.append(inst)
                elif entry.get("valid"):
                    keep.append(inst)
                else:
                    dropped_total += 1
                    rec = {
                        "ts": now,
                        "pool": name,
                        "instance_id": inst.instance_id,
                        "reason": entry.get("reason"),
                    }
                    log.write(json.dumps(rec) + "\n")
                    print(f"drop {name} {inst.instance_id}: {entry.get('reason')}")
            write_pool(jsonl, keep)
            txt = pools_dir / f"{name}.txt"
            txt.write_text("".join(f"{i.instance_id}\n" for i in keep), encoding="utf-8")
            print(f"{name}: {len(insts)} -> {len(keep)} ({unvalidated} not yet validated)")
            pool_meta = manifest.setdefault("pools", {}).setdefault(name, {})
            pool_meta.update(
                {
                    "count": len(keep),
                    "jsonl_sha256": sha256_file(jsonl),
                    "txt_sha256": sha256_file(txt),
                    "dropped_invalid": pool_meta.get("dropped_invalid", 0) + (len(insts) - len(keep)),
                    "unvalidated": unvalidated,
                }
            )
    if manifest:
        manifest["validation_applied_at"] = now
        manifest["validation_report_sha256"] = sha256_file(report_path) if report_path.exists() else None
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"dropped {dropped_total} invalid instance(s)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--pool", action="append", default=[], help="pool name (repeatable)")
    p.add_argument("--pools-dir", type=Path, default=POOLS_DIR)
    p.add_argument("--ids", nargs="+", default=None, help="only these instance ids")
    p.add_argument("--limit", type=int, default=None, help="validate at most N instances")
    p.add_argument("--force", action="store_true", help="re-validate instances already reported")
    p.add_argument("--concurrency", type=int, default=2)
    p.add_argument("--timeout", type=float, default=3600, help="per-instance seconds")
    p.add_argument("--command-timeout", type=float, default=150 * 60)
    p.add_argument("--cpus", type=float, default=4.0)
    p.add_argument("--mem", default="12g")
    p.add_argument(
        "--network",
        choices=["none", "rebuild", "all"],
        default="all",
        help="grading container network: always (default, as upstream), rebuild only, or never",
    )
    p.add_argument("--prune-images", action="store_true", help="remove images pulled here")
    p.add_argument("--report", type=Path, default=REPORT)
    p.add_argument("--log-dir", type=Path, default=LOG_ROOT)
    p.add_argument("--apply", action="store_true", help="drop invalid instances from pools")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    pools: list[str] = args.pool or sorted(pool_name(p) for p in args.pools_dir.glob(f"*{POOL_SUFFIX}"))
    if args.apply:
        return apply_report(pools, args.report, args.pools_dir)

    seen: set[str] = set()
    instances: list[TaskInstance] = []
    for name in pools:
        for inst in read_pool(pool_path(args.pools_dir, name)):
            if inst.instance_id not in seen:
                seen.add(inst.instance_id)
                instances.append(inst)
    if args.ids:
        wanted = set(args.ids)
        instances = [i for i in instances if i.instance_id in wanted]
        missing = wanted - {i.instance_id for i in instances}
        if missing:
            print(f"not found in pools {pools}: {sorted(missing)}", file=sys.stderr)
            return 2
    if not args.force:
        report = load_report(args.report)
        instances = [i for i in instances if i.instance_id not in report]
    if args.limit is not None:
        instances = instances[: args.limit]
    print(f"validating {len(instances)} instance(s) from pools {pools}", flush=True)
    if not instances:
        return 0

    network: NetworkMode = args.network
    cfg = GradeConfig(
        limits=Limits(cpus=args.cpus, mem=args.mem),
        network=network,
        command_timeout=args.command_timeout,
        log_dir=args.log_dir,
    )
    report = asyncio.run(
        run_validation(
            instances,
            report_path=args.report,
            cfg=cfg,
            concurrency=args.concurrency,
            timeout=args.timeout,
            prune_images=args.prune_images,
        )
    )
    ids = {i.instance_id for i in instances}
    valid = sum(1 for k, v in report.items() if k in ids and v.get("valid"))
    print(f"valid {valid}/{len(ids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
