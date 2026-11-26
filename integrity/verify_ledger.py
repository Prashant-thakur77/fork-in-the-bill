"""Recompute a run ledger's hash chain and its Merkle root over `task_done` records.

Usage: python -m integrity.verify_ledger runs/exp1   (or a path to ledger.jsonl)
Exits 1 on any chain mismatch, 0 otherwise, and prints the Merkle root.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError

from harness.schema import LedgerKind, LedgerRecord
from integrity.canonical import GENESIS, record_hash
from integrity.merkle import merkle_root_hex


@dataclass
class LedgerReport:
    path: str
    records: int = 0
    task_done_records: int = 0
    env_snapshot_records: int = 0
    merkle_root: str = ""
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _ledger_path(path: Path) -> Path:
    return path / "ledger.jsonl" if path.is_dir() else path


def verify(path: Path) -> LedgerReport:
    ledger = _ledger_path(path)
    report = LedgerReport(path=str(ledger))
    if not ledger.exists():
        report.errors.append(f"{ledger}: not found")
        return report

    prev = GENESIS
    expected_seq: int | None = None
    task_hashes: list[str] = []
    for lineno, raw in enumerate(ledger.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            rec = LedgerRecord.model_validate(json.loads(raw))
        except (json.JSONDecodeError, ValidationError) as exc:
            report.errors.append(f"line {lineno}: unreadable record ({type(exc).__name__})")
            continue
        report.records += 1
        if expected_seq is not None and rec.seq != expected_seq:
            report.errors.append(f"line {lineno}: seq {rec.seq}, expected {expected_seq}")
        expected_seq = rec.seq + 1
        if rec.prev_hash != prev:
            report.errors.append(f"line {lineno}: prev_hash does not match previous hash")
        recomputed = record_hash(rec.prev_hash, rec.payload)
        if recomputed != rec.hash:
            report.errors.append(f"line {lineno}: hash mismatch (seq {rec.seq})")
        prev = rec.hash
        if rec.kind == LedgerKind.task_done:
            task_hashes.append(rec.hash)
        elif rec.kind == LedgerKind.env_snapshot:
            report.env_snapshot_records += 1

    report.task_done_records = len(task_hashes)
    report.merkle_root = merkle_root_hex(task_hashes)
    return report


app = typer.Typer(add_completion=False)


@app.command()
def main(
    path: Annotated[Path, typer.Argument(help="runs/<exp> directory or a ledger.jsonl file")],
    as_json: Annotated[bool, typer.Option("--json", help="print the report as JSON")] = False,
) -> None:
    report = verify(path)
    if as_json:
        typer.echo(
            json.dumps(
                {
                    "path": report.path,
                    "ok": report.ok,
                    "records": report.records,
                    "task_done_records": report.task_done_records,
                    "env_snapshot_records": report.env_snapshot_records,
                    "merkle_root": report.merkle_root,
                    "errors": report.errors,
                },
                indent=2,
            )
        )
    else:
        for err in report.errors:
            typer.echo(f"MISMATCH {err}", err=True)
        typer.echo(f"records={report.records} task_done={report.task_done_records}")
        typer.echo(f"merkle_root={report.merkle_root}")
    raise typer.Exit(0 if report.ok else 1)


if __name__ == "__main__":
    app()
