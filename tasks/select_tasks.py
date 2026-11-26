"""Build the disjoint task pools deterministically from a seed.

    python -m tasks.select_tasks --seed 20261127 [--dry-run]

Tiers (by the instance's ``created_at``, UTC date):

* fresh: on or after ``--fresh-from`` (default 2026-07-01, after every model's training cutoff)
  -> ``exp1``.
* pre-cutoff: ``--pre-from`` <= date < ``--fresh-from`` -> ``pilot``, ``rollout``, ``exp2``,
  carved in that order from one seeded shuffle.
* reserve: SWE-rebench leaderboard split (Python), written as ``reserve`` unless ``--no-reserve``.

Before tiering, a pre-registered difficulty stratum keeps only instances whose gold patch
touches 1-2 files and at most ``--max-gold-lines`` changed lines, and whose problem statement
is at most ``--max-problem-chars`` characters. The filter values are recorded in the manifest.

Every tier is sorted by ``instance_id`` before a seeded shuffle, so the result depends only on
the seed, the arguments and the source files (whose commit and sha256 go into the manifest).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from tasks.model import TaskInstance
from tasks.sources import (
    DEFAULT_CACHE,
    MULTILANG,
    MULTILANG_SPLITS,
    REBENCH,
    REBENCH_SPLIT,
    ParquetFile,
    fetch_parquet,
    load_multilang,
    load_rebench,
    pool_path,
    write_pool,
)

POOLS_DIR = Path("tasks/pools")

# The SWE-bench-Live evaluation README notes that some C++ repositories need far more than
# 16 GB of RAM to build and test, so C++ is excluded unless --include-cpp is given.
HEAVY_LANGUAGES = frozenset({"cpp"})


@dataclass(frozen=True)
class PoolSizes:
    pilot: int = 12
    rollout: int = 20
    exp2: int = 100
    exp1: int | None = 140  # None: every fresh instance
    exp1b: int = 0  # pre-cutoff extension of exp1, carved after exp2 (amendment 1)


@dataclass(frozen=True)
class Stratum:
    """Pre-registered difficulty stratum, measured on the gold patch and the issue text."""

    min_gold_files: int = 1
    max_gold_files: int = 2
    max_gold_lines: int = 40
    max_problem_chars: int = 12_000

    def reject_reason(self, inst: TaskInstance) -> str | None:
        if not self.min_gold_files <= inst.gold_files <= self.max_gold_files:
            return "stratum:gold_files"
        if inst.gold_lines > self.max_gold_lines:
            return "stratum:gold_lines"
        if len(inst.problem_statement) > self.max_problem_chars:
            return "stratum:problem_chars"
        return None

    def to_json(self) -> dict[str, int]:
        return {
            "min_gold_files": self.min_gold_files,
            "max_gold_files": self.max_gold_files,
            "max_gold_lines": self.max_gold_lines,
            "max_problem_chars": self.max_problem_chars,
        }


@dataclass
class Selection:
    pools: dict[str, list[TaskInstance]]
    tiers: dict[str, int]
    excluded: dict[str, int] = field(default_factory=dict)


def _date(inst: TaskInstance) -> str:
    return inst.created_at[:10]


def _seeded_order(items: Sequence[TaskInstance], seed: int, salt: str) -> list[TaskInstance]:
    ordered = sorted(items, key=lambda i: i.instance_id)
    rng = random.Random(f"{seed}:{salt}")
    rng.shuffle(ordered)
    return ordered


def select_pools(
    instances: Sequence[TaskInstance],
    *,
    seed: int,
    sizes: PoolSizes = PoolSizes(),
    languages: frozenset[str] | None = None,
    fresh_from: str = "2026-07-01",
    pre_from: str = "2026-03-01",
    reserve: Sequence[TaskInstance] = (),
    stratum: Stratum | None = Stratum(),
) -> Selection:
    """Split ``instances`` into pilot/rollout/exp2 (pre-cutoff) and exp1 (fresh) pools."""
    ids = [i.instance_id for i in [*instances, *reserve]]
    dupes = [k for k, n in Counter(ids).items() if n > 1]
    if dupes:
        raise ValueError(f"duplicate instance ids across sources: {dupes[:5]}")

    excluded: Counter[str] = Counter()
    kept: list[TaskInstance] = []
    for inst in instances:
        if languages is not None and inst.language not in languages:
            excluded[f"language:{inst.language}"] += 1
            continue
        reason = stratum.reject_reason(inst) if stratum else None
        if reason:
            excluded[reason] += 1
            continue
        kept.append(inst)
    kept_reserve: list[TaskInstance] = []
    for inst in reserve:
        reason = stratum.reject_reason(inst) if stratum else None
        if reason:
            excluded[f"reserve_{reason}"] += 1
        else:
            kept_reserve.append(inst)
    reserve = kept_reserve

    fresh = [i for i in kept if _date(i) >= fresh_from]
    pre = [i for i in kept if pre_from <= _date(i) < fresh_from]
    excluded["older_than_pre_tier"] += len(kept) - len(fresh) - len(pre)

    pre_order = _seeded_order(pre, seed, "pre")
    pilot = pre_order[: sizes.pilot]
    rollout = pre_order[sizes.pilot : sizes.pilot + sizes.rollout]
    exp2 = pre_order[sizes.pilot + sizes.rollout :][: sizes.exp2]
    exp1b = pre_order[sizes.pilot + sizes.rollout + sizes.exp2 :][: sizes.exp1b]
    exp1 = _seeded_order(fresh, seed, "fresh")
    if sizes.exp1 is not None:
        exp1 = exp1[: sizes.exp1]

    pools: dict[str, list[TaskInstance]] = {
        "pilot": pilot,
        "exp1": exp1,
        "rollout": rollout,
        "exp2": exp2,
    }
    if sizes.exp1b:
        pools["exp1b"] = exp1b
    if reserve:
        pools["reserve"] = _seeded_order(reserve, seed, "reserve")
    return Selection(
        pools=pools,
        tiers={"fresh": len(fresh), "pre_cutoff": len(pre), "reserve": len(reserve)},
        excluded=dict(excluded),
    )


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pool_summary(insts: Sequence[TaskInstance]) -> dict[str, Any]:
    months = Counter(i.created_month for i in insts)
    return {
        "count": len(insts),
        "by_language": dict(sorted(Counter(i.language for i in insts).items())),
        "by_month": dict(sorted(months.items())),
    }


def write_pools(selection: Selection, out_dir: Path) -> dict[str, dict[str, Any]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    summary: dict[str, dict[str, Any]] = {}
    for name, insts in selection.pools.items():
        jsonl = pool_path(out_dir, name)
        txt = out_dir / f"{name}.txt"
        write_pool(jsonl, insts)
        txt.write_text("".join(f"{i.instance_id}\n" for i in insts), encoding="utf-8")
        summary[name] = {
            **pool_summary(insts),
            "jsonl": jsonl.as_posix(),
            "jsonl_sha256": sha256_file(jsonl),
            "txt": txt.as_posix(),
            "txt_sha256": sha256_file(txt),
        }
    return summary


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--seed", type=int, required=True)
    p.add_argument("--pilot", type=int, default=PoolSizes.pilot, help="pilot pool size")
    p.add_argument("--rollout", type=int, default=PoolSizes.rollout, help="rollout pool size")
    p.add_argument("--exp2", type=int, default=PoolSizes.exp2, help="exp2 cap (takes the rest)")
    p.add_argument("--exp1b", type=int, default=0, help="pre-cutoff extension of exp1, carved after exp2")
    p.add_argument("--exp1", type=int, default=PoolSizes.exp1, help="exp1 cap (0: no cap)")
    p.add_argument("--min-gold-files", type=int, default=Stratum.min_gold_files)
    p.add_argument("--max-gold-files", type=int, default=Stratum.max_gold_files)
    p.add_argument("--max-gold-lines", type=int, default=Stratum.max_gold_lines)
    p.add_argument("--max-problem-chars", type=int, default=Stratum.max_problem_chars)
    p.add_argument("--no-stratum", action="store_true", help="disable the difficulty stratum")
    p.add_argument("--fresh-from", default="2026-07-01", help="first date of the fresh tier")
    p.add_argument("--pre-from", default="2026-03-01", help="first date of the pre-cutoff tier")
    p.add_argument(
        "--languages",
        default=",".join(MULTILANG_SPLITS),
        help="comma-separated MultiLang splits to consider",
    )
    p.add_argument(
        "--include-cpp",
        action="store_true",
        help="keep C++ tasks (builds can need well over 16 GB RAM)",
    )
    p.add_argument("--no-reserve", action="store_true", help="skip the SWE-rebench reserve pool")
    p.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    p.add_argument("--out-dir", type=Path, default=POOLS_DIR)
    p.add_argument("--refresh", action="store_true", help="re-download the parquet files")
    p.add_argument("--dry-run", action="store_true", help="print counts, write nothing")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    langs = {s.strip() for s in args.languages.split(",") if s.strip()}
    unknown = langs - set(MULTILANG_SPLITS)
    if unknown:
        print(f"unknown languages: {sorted(unknown)}", file=sys.stderr)
        return 2
    if not args.include_cpp:
        langs -= HEAVY_LANGUAGES

    files: list[ParquetFile] = []
    instances: list[TaskInstance] = []
    for split in sorted(langs):
        pf = fetch_parquet(MULTILANG, split, args.cache_dir, refresh=args.refresh)
        files.append(pf)
        instances.extend(load_multilang(pf.path, split))

    reserve: list[TaskInstance] = []
    reserve_skipped: list[tuple[str, str]] = []
    if not args.no_reserve:
        pf = fetch_parquet(REBENCH, REBENCH_SPLIT, args.cache_dir, refresh=args.refresh)
        files.append(pf)
        reserve, reserve_skipped = load_rebench(pf.path, REBENCH_SPLIT)

    exp1_cap = args.exp1 if args.exp1 else None
    sizes = PoolSizes(pilot=args.pilot, rollout=args.rollout, exp2=args.exp2, exp1=exp1_cap, exp1b=args.exp1b)
    stratum = None
    if not args.no_stratum:
        stratum = Stratum(
            min_gold_files=args.min_gold_files,
            max_gold_files=args.max_gold_files,
            max_gold_lines=args.max_gold_lines,
            max_problem_chars=args.max_problem_chars,
        )
    selection = select_pools(
        instances,
        seed=args.seed,
        sizes=sizes,
        languages=frozenset(langs),
        fresh_from=args.fresh_from,
        pre_from=args.pre_from,
        reserve=reserve,
        stratum=stratum,
    )

    print(f"seed={args.seed} languages={','.join(sorted(langs))}")
    print(f"stratum: {stratum.to_json() if stratum else None}")
    print(f"tiers: {selection.tiers}  excluded: {selection.excluded}")
    if reserve_skipped:
        print(f"reserve rows skipped: {len(reserve_skipped)}")
    for name, insts in selection.pools.items():
        s = pool_summary(insts)
        print(f"  {name:8s} {s['count']:4d}  {s['by_language']}")

    if args.dry_run:
        return 0

    pools = write_pools(selection, args.out_dir)
    rows = Counter(i.source for i in [*instances, *reserve])
    sources = [
        {k: v for k, v in f.to_json().items() if k != "path"} | {"rows_loaded": rows.get(f"{f.dataset}:{f.split}", 0)}
        for f in files
    ]
    manifest = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seed": args.seed,
        "params": {
            "languages": sorted(langs),
            "fresh_from": args.fresh_from,
            "pre_from": args.pre_from,
            "sizes": {
                "pilot": args.pilot,
                "rollout": args.rollout,
                "exp2": args.exp2,
                "exp1": exp1_cap,
                **({"exp1b": args.exp1b} if args.exp1b else {}),
            },
            "reserve": not args.no_reserve,
            "stratum": stratum.to_json() if stratum else None,
        },
        "sources": sources,
        "tiers": selection.tiers,
        "excluded": selection.excluded,
        "reserve_skipped": [{"instance_id": i, "reason": r} for i, r in reserve_skipped],
        "pools": pools,
    }
    path = args.out_dir / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(pools)} pools and {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
