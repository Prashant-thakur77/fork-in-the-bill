"""`forkbill` command line: init, demo, report."""

from __future__ import annotations

import importlib
import importlib.util
import json
import math
import os
import subprocess
import sys
from pathlib import Path
from typing import Annotated, Any, cast

import typer

from forkbill.client import MODES, Mode, make_client
from forkbill.demo import run_demo, summarise
from forkbill.experiment import Ids, default_body, empty_ids, include_all_variants, load_policy_json, render
from forkbill.flagsmith_cli import (
    FlagsmithCli,
    FlagsmithCliError,
    extract_hypothesis,
    literals_used,
)
from forkbill.policy import RoutingPolicy

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Routed-lane experiments on Flagsmith.")


def _fail(message: str) -> typer.Exit:
    typer.echo(message, err=True)
    return typer.Exit(1)


@app.command()
def init(
    control: Annotated[Path, typer.Option(help="Control policy JSON (the flag's own value).")],
    variant: Annotated[list[str], typer.Option(help="KEY=PATH of a variant policy JSON; repeatable.")],
    metrics: Annotated[Path, typer.Option(help="metrics.json (name, event, aggregation, ...).")],
    flag: str = "agent_routing",
    kill_flag: str = "routing_kill",
    hypothesis_file: Annotated[Path | None, typer.Option(help="Pre-registration file; creates the experiment.")] = None,
    experiment_template: Annotated[
        Path | None, typer.Option(help="Experiment body template with @ placeholders.")
    ] = None,
    experiment_name: str = "forkbill experiment",
    start: Annotated[bool, typer.Option(help="Start the experiment after creating it.")] = False,
    ids_out: Annotated[Path | None, typer.Option(help="Write created ids here as JSON.")] = None,
    config_path: Annotated[str | None, typer.Option(help="flagsmith.json to use (else the CLI's lookup).")] = None,
    api_url: Annotated[str | None, typer.Option(help="Flagsmith API base URL.")] = None,
) -> None:
    """Create the flag, variants, kill switch, metrics (and optionally the experiment).

    Shells out to the Flagsmith CLI v2, so it uses the CLI's login or master key. Idempotent:
    existing objects with the same definition are reused, different ones stop the run.
    """
    try:
        cli = FlagsmithCli(config_path=config_path, api_url=api_url)
        env_key = cli.environment_key()
        control_json = load_policy_json(control.parent, control.stem)
        variants: dict[str, str] = {}
        for item in variant:
            key, _, path = item.partition("=")
            if not key or not path:
                raise _fail(f"--variant expects KEY=PATH, got {item!r}")
            p = Path(path)
            variants[key] = load_policy_json(p.parent, p.stem)
        metric_specs: list[dict[str, Any]] = json.loads(metrics.read_text())["metrics"]
        cli.check_literals(env_key, literals_used(metric_specs))

        ids: Ids = empty_ids()
        ids["features"][flag] = cli.ensure_feature(
            flag, control_json, enabled=True, description="Routing policy (JSON) for agent lanes"
        )
        ids["variants"][flag] = {k: cli.ensure_variant(flag, k, v) for k, v in variants.items()}
        if kill_flag:
            ids["features"][kill_flag] = cli.ensure_feature(
                kill_flag, None, enabled=False, description="On: every task runs the control policy"
            )
        ids["metrics"] = cli.ensure_metrics(env_key, metric_specs)
        result: dict[str, Any] = {"ids": ids}

        if hypothesis_file is not None:
            hypothesis = extract_hypothesis(hypothesis_file.read_text())
            if experiment_template is not None:
                body = render(json.loads(experiment_template.read_text()), ids, control.parent, hypothesis)
            else:
                body = default_body(
                    flag=flag,
                    name=experiment_name,
                    hypothesis=hypothesis,
                    control_json=control_json,
                    variant_ids=ids["variants"][flag],
                    metrics=metric_specs,
                    metric_ids=ids["metrics"],
                    feature_id=ids["features"][flag],
                )
            added = include_all_variants(body, cli.variant_ids(flag))
            if added:
                typer.echo(f"variants not in the split, added at 0%: {', '.join(added)}", err=True)
            created = cli.create_experiment(env_key, body)
            result["experiment"] = {"id": created["id"], "status": created.get("status")}
            if start:
                started = cli.start_experiment(env_key, int(created["id"]))
                result["experiment"]["status"] = (started or {}).get("status", "running")
    except FlagsmithCliError as exc:
        raise _fail(f"Flagsmith error:\n{exc}") from None
    except (ValueError, KeyError, FileNotFoundError) as exc:
        raise _fail(f"error: {exc}") from None

    text = json.dumps(result, indent=2)
    if ids_out is not None:
        ids_out.write_text(text + "\n")
    typer.echo(text)


@app.command()
def demo(
    n: int = 12,
    prefix: str = "kitdemo",
    flag: str = "agent_routing",
    kill_flag: str = "routing_kill",
    api_url: Annotated[str | None, typer.Option(help="SDK API URL, e.g. http://localhost:8000/api/v1/.")] = None,
    events_api_url: Annotated[str | None, typer.Option(help="Events URL, e.g. http://localhost:8000/api/.")] = None,
    mode: Annotated[str, typer.Option(help=f"Evaluation mode: {', '.join(MODES)}.")] = "remote",
    edge_url: Annotated[
        str | None, typer.Option(help="Edge Proxy SDK URL, e.g. http://localhost:8001/api/v1/.")
    ] = None,
    offline: Annotated[bool, typer.Option(help="Use an in-memory fake client (CI).")] = False,
    control: Annotated[Path | None, typer.Option(help="Control policy JSON for offline.")] = None,
    variant: Annotated[list[str] | None, typer.Option(help="KEY=PATH variant policy for offline; repeatable.")] = None,
    out: Annotated[Path | None, typer.Option(help="Write tasks.jsonl and events.jsonl here.")] = None,
) -> None:
    """Run the deterministic fake agent loop (no model calls) through RoutedLanes.

    Online, the environment key is read from FLAGSMITH_SERVER_KEY or FLAGSMITH_ENVIRONMENT_KEY.
    `--mode local` and `--mode edge-local` evaluate from the environment document and need a
    server-side key; `--mode edge` and `--mode edge-local` read flags from the Edge Proxy at
    `--edge-url`. Events always go to `--events-api-url`, the core API.
    """
    control_policy: RoutingPolicy | None = None
    if control is not None:
        control_policy = RoutingPolicy.model_validate_json(control.read_text())
    if offline:
        from forkbill.testing import FakeFlagsmith

        if control is None:
            raise _fail("--offline needs --control")
        variants: dict[str, str] = {}
        for item in variant or []:
            key, _, path = item.partition("=")
            variants[key] = Path(path).read_text()
        client: Any = FakeFlagsmith(flag=flag, control=control.read_text(), variants=variants)
    else:
        # max_buffer_items is the buffer's capacity in SDK 6.7: a value of 1 drops events tracked
        # back to back. Keep the default capacity; RoutedLanes.finish flushes explicitly.
        client = _online_client(mode, api_url=api_url, events_api_url=events_api_url, edge_url=edge_url)
    try:
        results = run_demo(
            client,
            n=n,
            prefix=prefix,
            flag=flag,
            kill_flag=kill_flag or None,
            control=control_policy,
            out_dir=out,
        )
    finally:
        if hasattr(client, "close"):
            client.close(10.0)
    typer.echo("deterministic fake agent loop (no model calls, illustrative prices)")
    summary = {"mode": "offline" if offline else mode, "identities": n, "by_variant": summarise(results)}
    typer.echo(json.dumps(summary, indent=2))


def _online_client(mode: str, *, api_url: str | None, events_api_url: str | None, edge_url: str | None) -> Any:
    key = os.environ.get("FLAGSMITH_SERVER_KEY") or os.environ.get("FLAGSMITH_ENVIRONMENT_KEY")
    if not key:
        raise _fail("set FLAGSMITH_SERVER_KEY (or FLAGSMITH_ENVIRONMENT_KEY)")
    if mode not in MODES:
        raise _fail(f"--mode must be one of {', '.join(MODES)}, not {mode!r}")
    try:
        return make_client(
            cast(Mode, mode), environment_key=key, api_url=api_url, events_api_url=events_api_url, edge_url=edge_url
        )
    except ValueError as exc:
        raise _fail(f"error: {exc}") from None


@app.command()
def compare(
    mode: Annotated[list[str], typer.Option(help=f"Modes to compare, first is the baseline: {', '.join(MODES)}.")],
    n: int = 200,
    prefix: str = "kitdemo-compare",
    flag: str = "agent_routing",
    api_url: Annotated[str | None, typer.Option(help="SDK API URL, e.g. http://localhost:8000/api/v1/.")] = None,
    events_api_url: Annotated[str | None, typer.Option(help="Events URL, e.g. http://localhost:8000/api/.")] = None,
    edge_url: Annotated[
        str | None, typer.Option(help="Edge Proxy SDK URL, e.g. http://localhost:8001/api/v1/.")
    ] = None,
    fail_on_disagreement: Annotated[bool, typer.Option(help="Exit 1 unless every mode agrees.")] = True,
) -> None:
    """Read the routing flag for the same N identities in each mode and report agreement.

    Reads use `get_identity_flags`: no exposure is recorded and no event is sent.
    """
    from forkbill.modes import compare_modes

    identities = [f"{prefix}:{i:04d}" for i in range(n)]
    clients = {m: _online_client(m, api_url=api_url, events_api_url=events_api_url, edge_url=edge_url) for m in mode}
    try:
        report = compare_modes(clients, identities, flag)
    finally:
        for c in clients.values():
            c.close(5.0)
    typer.echo(json.dumps(report, indent=2))
    if fail_on_disagreement and not report["all_agree"]:
        raise typer.Exit(1)


def _fallback_report(run_dir: Path) -> dict[str, Any]:
    tasks = run_dir / "tasks.jsonl"
    if not tasks.exists():
        raise FileNotFoundError(f"{tasks} not found")
    by: dict[str, list[dict[str, Any]]] = {}
    for line in tasks.read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            by.setdefault(str(row.get("variant") or "(none)"), []).append(row)
    out: dict[str, Any] = {}
    for key, rows in sorted(by.items()):
        n = len(rows)
        cost = sum(float(r["usd"]) for r in rows) / n
        rate = sum(1 for r in rows if r.get("solved")) / n
        out[key] = {
            "n": n,
            "cost_mean": round(cost, 4),
            "solve_rate": round(rate, 4),
            "cost_per_solve": round(cost / rate, 4) if rate else math.nan,
        }
    return {"run_dir": str(run_dir), "by_variant": out}


@app.command()
def report(
    run_dir: Path,
    full: Annotated[
        bool,
        typer.Option(help="Also run the project's analysis.analyse over the runs directory holding run_dir."),
    ] = False,
    out: Annotated[Path, typer.Option(help="Output directory for --full.")] = Path("analysis/out"),
) -> None:
    """Per-variant summary of a run directory (tasks.jsonl): n, mean cost, solve rate, cost/solve.

    With --full, hands the runs directory to `python -m analysis.analyse` (Bayesian and bootstrap
    analysis, numbers.json) when that package is importable.
    """
    try:
        typer.echo(json.dumps(_fallback_report(run_dir), indent=2))
    except FileNotFoundError as exc:
        raise _fail(str(exc)) from None
    if not full:
        return
    if importlib.util.find_spec("analysis.analyse") is None:
        raise _fail("--full needs the analysis package (run from the repository root)")
    cmd = [sys.executable, "-m", "analysis.analyse", "--runs", str(run_dir.parent),
           "--out", str(out), "--no-docs"]  # fmt: skip
    raise typer.Exit(subprocess.run(cmd, check=False).returncode)


if __name__ == "__main__":
    app()
