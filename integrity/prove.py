"""Show that one task's `task_done` record is under a run's published Merkle root.

Usage: python -m integrity.prove --run runs/exp1 --task swelive:<instance_id>

Prints the record (its per-test results summarised unless --full), checks that the record's hash
follows from its payload and the previous record, prints the leaf hash and the audit path, and
checks the path against the root published in analysis/out/numbers.json (or --root, or failing
both, the root recomputed from the ledger). An identity that ran twice has two records; both are
proved. Exits 1 if the identity is missing or any check fails.

`export` writes the proof of every leaf of a run as compact JSON (format in docs/interfaces.md) so
the site can check a proof in the browser.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

import typer

from harness.schema import LedgerKind, LedgerRecord
from integrity.canonical import record_hash
from integrity.merkle import inclusion_proof, merkle_root, verify_inclusion

RULE = (
    "leaves: the hash of every task_done ledger record in seq order, as raw 32-byte digests; "
    "parent = sha256(left + right); the last node of an odd level is paired with itself; "
    "path: sibling hashes from the leaf level up, with no entry for a level where the node is paired with itself"
)


@dataclass
class Leaf:
    index: int
    record: LedgerRecord

    @property
    def identity(self) -> str:
        return str(self.record.payload.get("identity", ""))


def load_leaves(run: Path) -> list[Leaf]:
    ledger = run / "ledger.jsonl" if run.is_dir() else run
    leaves: list[Leaf] = []
    for raw in ledger.read_text(encoding="utf-8").split("\n"):
        if raw.strip():
            rec = LedgerRecord.model_validate(json.loads(raw))
            if rec.kind == LedgerKind.task_done:
                leaves.append(Leaf(len(leaves), rec))
    return leaves


def published_root(run: Path, numbers: Path) -> str | None:
    if not numbers.exists():
        return None
    data = json.loads(numbers.read_text(encoding="utf-8"))
    entry = (data.get("integrity") or {}).get("by_experiment", {}).get(run.name) or {}
    root = entry.get("merkle_root")
    return str(root) if root else None


def proofs(leaves: list[Leaf]) -> list[dict[str, Any]]:
    digests = [bytes.fromhex(leaf.record.hash) for leaf in leaves]
    return [
        {
            "identity": leaf.identity,
            "seq": leaf.record.seq,
            "index": leaf.index,
            "leaf": leaf.record.hash,
            "path": inclusion_proof(digests, leaf.index),
        }
        for leaf in leaves
    ]


def export(run: Path, dest: Path) -> dict[str, Any]:
    """Write every leaf's proof to `dest` and return a summary for numbers.json."""
    leaves = load_leaves(run)
    root = merkle_root([bytes.fromhex(leaf.record.hash) for leaf in leaves])
    entries = proofs(leaves)
    verified = sum(verify_inclusion(e["leaf"], e["index"], len(entries), e["path"], root) for e in entries)
    head = {"run": run.name, "size": len(entries), "root": root, "rule": RULE}
    compact = {"separators": (",", ":"), "ensure_ascii": False}
    body = ",\n".join(json.dumps(e, **compact) for e in entries)
    text = json.dumps(head, **compact)[:-1] + ',"leaves":[\n' + body + "\n]}\n"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")
    return {
        "leaves": len(entries),
        "verified": verified,
        "root": root,
        "path_length_max": max((len(e["path"]) for e in entries), default=0),
        "bytes": len(text.encode("utf-8")),
    }


def _summary(payload: dict[str, object], full: bool) -> dict[str, object]:
    if full:
        return payload
    tests = payload.get("tests")
    if not isinstance(tests, dict) or not tests:
        return payload
    counts = Counter(str(v) for v in tests.values())
    detail = ", ".join(f"{n} {k}" for k, n in sorted(counts.items()))
    return {**payload, "tests": f"{len(tests)} results ({detail}); --full prints them"}


app = typer.Typer(add_completion=False)


@app.command()
def main(
    run: Annotated[Path, typer.Option(help="run directory, e.g. runs/exp1")],
    task: Annotated[str, typer.Option(help="identity, e.g. swelive:<instance_id>")],
    root: Annotated[str | None, typer.Option(help="root to check against (default: the published one)")] = None,
    numbers: Annotated[Path, typer.Option(help="numbers.json holding the published roots")] = Path(
        "analysis/out/numbers.json"
    ),
    full: Annotated[bool, typer.Option(help="print the per-test results too")] = False,
) -> None:
    leaves = load_leaves(run)
    if not task.startswith("swelive:") and not any(leaf.identity == task for leaf in leaves):
        task = f"swelive:{task}"
    mine = [leaf for leaf in leaves if leaf.identity == task]
    if not mine:
        typer.echo(f"{task}: no task_done record in {run}", err=True)
        raise typer.Exit(1)
    digests = [bytes.fromhex(leaf.record.hash) for leaf in leaves]
    recomputed = merkle_root(digests)
    if root:
        target, source = root, "the root given"
    elif (pub := published_root(run, numbers)) is not None:
        target, source = pub, "the published root"
    else:
        target, source = recomputed, "the root recomputed from the ledger"
    ok = True
    for leaf in mine:
        rec = leaf.record
        typer.echo(f"task_done record: ledger seq {rec.seq}, leaf {leaf.index} of {len(leaves)}")
        typer.echo(json.dumps(_summary(rec.payload, full), indent=2, sort_keys=True, ensure_ascii=False))
        chained = record_hash(rec.prev_hash, rec.payload) == rec.hash
        ok &= chained
        typer.echo(f"leaf hash  {rec.hash}")
        verdict = "matches" if chained else "DOES NOT match"
        typer.echo(f"           {verdict} sha256(prev_hash + canonical_json(payload))")
        path = inclusion_proof(digests, leaf.index)
        typer.echo(f"audit path ({len(path)} hashes, leaf level first)")
        i, n, steps = leaf.index, len(leaves), iter(path)
        level = 0
        while n > 1:
            if i % 2 == 1:
                typer.echo(f"  level {level}: sibling on the left   {next(steps)}")
            elif i + 1 < n:
                typer.echo(f"  level {level}: sibling on the right  {next(steps)}")
            else:
                typer.echo(f"  level {level}: last node of an odd level, paired with itself")
            i, n, level = i // 2, (n + 1) // 2, level + 1
        good = verify_inclusion(rec.hash, leaf.index, len(leaves), path, target)
        ok &= good
        typer.echo(f"{'verified' if good else 'NOT verified'} against {source} {target}")
        typer.echo("")
    if target != recomputed:
        typer.echo(f"note: the ledger's own root is {recomputed}", err=True)
    raise typer.Exit(0 if ok else 1)


if __name__ == "__main__":
    app()
