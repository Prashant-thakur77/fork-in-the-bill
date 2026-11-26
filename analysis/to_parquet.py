"""Convert runs/<exp>/*.jsonl into analysis/out/parquet/<exp>/*.parquet.

Tasks are validated against `harness.schema.TaskRecord` and flattened: the routing policy
becomes `policy_name`, `main_model` and `delegate_model`, every trait becomes a `trait_<name>`
column, and `tests` is kept as a JSON string.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import pyarrow as pa
import pyarrow.parquet as pq
import typer

from harness.schema import CallRecord, TaskRecord

TASK_TRAITS = ("repo", "language", "created_month", "gold_files", "gold_lines", "pilot_pred_cost")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out


def flatten_task(rec: TaskRecord) -> dict[str, Any]:
    row: dict[str, Any] = rec.model_dump(mode="json", exclude={"policy", "traits", "tests"})
    row["policy_name"] = rec.policy.policy
    row["main_model"] = rec.policy.main.model
    row["delegate_model"] = rec.policy.delegate.model
    row["prompt_variant"] = rec.policy.prompt_variant
    row["tests_json"] = json.dumps(rec.tests, sort_keys=True)
    row["tokens_total"] = rec.tokens_main + rec.tokens_delegate
    for name in TASK_TRAITS:
        row[f"trait_{name}"] = None
    for name, value in rec.traits.items():
        row[f"trait_{name}"] = value
    return row


def _normalise_trait_columns(rows: list[dict[str, Any]]) -> None:
    """Give every trait column one Arrow type: numeric if all values are numeric, else string."""
    cols = sorted({k for r in rows for k in r if k.startswith("trait_")})
    for col in cols:
        values = [r.get(col) for r in rows]
        numeric = all(v is None or isinstance(v, int | float) for v in values)
        for r in rows:
            v = r.get(col)
            if v is None:
                r[col] = None
            elif numeric:
                r[col] = float(v)
            else:
                r[col] = str(v)


def _write(rows: list[dict[str, Any]], path: Path, schema: pa.Schema | None = None) -> None:
    if rows:
        table = pa.Table.from_pylist(rows)
    elif schema is not None:
        table = schema.empty_table()
    else:
        return
    pq.write_table(table, path)


_EMPTY_EXCLUSIONS = pa.schema([("identity", pa.string()), ("reason", pa.string()), ("attempts", pa.int64())])


def convert(run_dir: Path, out_dir: Path) -> dict[str, int]:
    """Convert one run directory. Returns row counts per table."""
    out_dir.mkdir(parents=True, exist_ok=True)
    tasks = [flatten_task(TaskRecord.model_validate(r)) for r in read_jsonl(run_dir / "tasks.jsonl")]
    _normalise_trait_columns(tasks)
    calls = [CallRecord.model_validate(r).model_dump(mode="json") for r in read_jsonl(run_dir / "calls.jsonl")]
    events = read_jsonl(run_dir / "events.jsonl")
    for e in events:
        e["value"] = None if e.get("value") is None else float(e["value"])
    exclusions = [
        {
            "identity": str(r["identity"]),
            "reason": str(r.get("reason", "")),
            "attempts": int(r.get("attempts", 0)),
        }
        for r in read_jsonl(run_dir / "exclusions.jsonl")
    ]
    _write(tasks, out_dir / "tasks.parquet")
    _write(calls, out_dir / "calls.parquet")
    _write(events, out_dir / "events.parquet")
    _write(exclusions, out_dir / "exclusions.parquet", _EMPTY_EXCLUSIONS)
    return {
        "tasks": len(tasks),
        "calls": len(calls),
        "events": len(events),
        "exclusions": len(exclusions),
    }


def convert_all(runs: Path, out: Path) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    if not runs.exists():
        return result
    for run_dir in sorted(p for p in runs.iterdir() if p.is_dir()):
        if (run_dir / "tasks.jsonl").exists():
            result[run_dir.name] = convert(run_dir, out / "parquet" / run_dir.name)
    return result


app = typer.Typer(add_completion=False)


@app.command()
def main(
    runs: Annotated[Path, typer.Option(help="runs directory")] = Path("runs"),
    out: Annotated[Path, typer.Option(help="analysis output directory")] = Path("analysis/out"),
) -> None:
    typer.echo(json.dumps(convert_all(runs, out), indent=2))


if __name__ == "__main__":
    app()
