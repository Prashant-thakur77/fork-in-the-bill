"""Snapshot the Flagsmith environment document into a run's ledger.

Each snapshot fetches the document with `flagsmith environment document`, drops the
organisation and project names, saves it under `runs/<exp>/env/<seq>.json`, and appends an
`env_snapshot` ledger record with its SHA-256 and a summary of the routing flags. A snapshot at
the start, one every interval during the run and one at the end show the flag was not touched
mid-experiment. A Flagsmith error stops the command with the CLI's own message.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import typer

from harness.schema import FLAG_KILL, FLAG_ROUTING, LedgerKind
from integrity.canonical import canonical_json
from integrity.ledger import Ledger

REDACT = (("project", "name"), ("project", "organisation", "name"))


class FlagsmithError(RuntimeError):
    pass


def fetch_document(bin_: str = "flagsmith") -> dict[str, Any]:
    proc = subprocess.run(
        [bin_, "environment", "document", "--no-input"],
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ, "FLAGSMITH_NO_INPUT": "1"},
        check=False,
    )
    if proc.returncode != 0:
        raise FlagsmithError(f"flagsmith environment document exited {proc.returncode}:\n{proc.stderr.strip()}")
    return json.loads(proc.stdout)


def redact(doc: dict[str, Any]) -> dict[str, Any]:
    out = json.loads(json.dumps(doc))
    for path in REDACT:
        node: Any = out
        for key in path[:-1]:
            node = node.get(key) if isinstance(node, dict) else None
        if isinstance(node, dict) and path[-1] in node:
            node[path[-1]] = "[redacted]"
    return out


def flag_summary(doc: dict[str, Any]) -> dict[str, Any]:
    """Environment-level state of the routing and kill flags, plus segment overrides of them."""
    summary: dict[str, Any] = {}

    def state(fs: dict[str, Any]) -> dict[str, Any]:
        value = fs.get("feature_state_value")
        return {
            "enabled": fs.get("enabled"),
            "value_sha256": hashlib.sha256(canonical_json(value)).hexdigest(),
            "variants": sorted(
                (
                    str(mv["multivariate_feature_option"].get("key") or mv["multivariate_feature_option"]["id"]),
                    mv["percentage_allocation"],
                )
                for mv in fs.get("multivariate_feature_state_values") or []
            ),
            "experiment": (fs.get("metadata") or {}).get("experiment"),
        }

    for fs in doc.get("feature_states") or []:
        name = fs["feature"]["name"]
        if name in (FLAG_ROUTING, FLAG_KILL):
            summary[name] = state(fs)
    for seg in (doc.get("project") or {}).get("segments") or []:
        for fs in seg.get("feature_states") or []:
            name = fs["feature"]["name"]
            if name in (FLAG_ROUTING, FLAG_KILL):
                summary[f"{name}@segment:{seg['id']}"] = state(fs)
    return summary


def snapshot(run_dir: Path, label: str, bin_: str = "flagsmith") -> dict[str, Any]:
    doc = redact(fetch_document(bin_))
    digest = hashlib.sha256(canonical_json(doc)).hexdigest()
    env_dir = run_dir / "env"
    env_dir.mkdir(parents=True, exist_ok=True)
    n = len(list(env_dir.glob("*.json")))
    name = f"{n:03d}-{label}.json"
    (env_dir / name).write_bytes(canonical_json(doc) + b"\n")
    payload: dict[str, object] = {
        "label": label,
        "file": f"env/{name}",
        "sha256": digest,
        "updated_at": doc.get("updated_at"),
        "flags": flag_summary(doc),
        "taken_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    Ledger(run_dir / "ledger.jsonl").append(LedgerKind.env_snapshot, payload)
    return payload


app = typer.Typer(add_completion=False)


@app.command()
def main(
    exp: Annotated[str, typer.Option(help="run directory name under runs/")],
    label: Annotated[str, typer.Option(help="start, periodic or end")] = "periodic",
    every: Annotated[int, typer.Option(help="seconds between snapshots; 0 takes one and exits")] = 0,
    until_file: Annotated[Path | None, typer.Option(help="with --every, stop once this file exists")] = None,
    runs: Annotated[Path, typer.Option()] = Path("runs"),
) -> None:
    run_dir = runs / exp
    while True:
        try:
            p = snapshot(run_dir, label)
        except FlagsmithError as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(2) from exc
        typer.echo(json.dumps({k: p[k] for k in ("label", "file", "sha256", "updated_at")}))
        if every <= 0 or (until_file is not None and until_file.exists()):
            return
        time.sleep(every)


if __name__ == "__main__":
    app()
