"""Infra-only health of the agent_routing flag, reported to Flagsmith Feature health (Webhook provider).

    python -m runner.health runs/exp1
    python -m runner.health runs/exp1 --window 20 --max-infra-rate 0.25 --budget-warn 0.9

The flag is unhealthy when too many of the last N finished tasks ended in `infra_error`, or when the
global budget (harness/budget.py: spent plus reserved against BUDGET_USD_TOTAL) is nearly used up.

Only the `outcome == "infra_error"` test and total spend are read. Solve rates, costs per arm and any
other outcome metric are never looked at: health must not become a way to peek at the experiment.

A report is sent only when the status differs from the last one sent, and only when
FLAGSMITH_HEALTH_WEBHOOK_URL is set; otherwise it is a dry run that prints the payload. The URL carries
the provider's secret token, so it is never printed or logged, not even in errors.
"""

from __future__ import annotations

import fcntl
import json
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
import typer

from harness.budget import RESERVED_KEY, SPENT_KEY
from harness.schema import Outcome

URL_ENV = "FLAGSMITH_HEALTH_WEBHOOK_URL"
FEATURE = "agent_routing"
STATE_FILE = "health_state.json"

Status = Literal["healthy", "unhealthy"]
Payload = dict[str, Any]
# Posts JSON to the webhook URL and returns the HTTP status code.
Poster = Callable[[str, Payload], int]

app = typer.Typer(add_completion=False)


class HealthPostError(RuntimeError):
    """The webhook call failed. The message never contains the URL."""


@dataclass(frozen=True)
class RunView:
    """What health may see of a run: each finished task's infra flag, in order, and total spend."""

    infra_errors: list[bool]
    total_usd: float


@dataclass(frozen=True)
class Spend:
    usd: float
    source: str  # "budget ledger" or "task records"


@dataclass(frozen=True)
class Thresholds:
    window: int = 20
    min_tasks: int = 5
    max_infra_rate: float = 0.25
    budget_warn: float = 0.9


@dataclass(frozen=True)
class Health:
    status: Status
    text_blocks: list[dict[str, str]] = field(default_factory=list)


def read_run(run_dir: Path) -> RunView:
    """Reads tasks.jsonl keeping only `outcome == infra_error` and `usd`; a torn last line is skipped."""
    path = run_dir / "tasks.jsonl"
    infra: list[bool] = []
    total = 0.0
    if not path.exists():
        return RunView([], 0.0)
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(rec, dict):
            continue
        infra.append(rec.get("outcome") == Outcome.infra_error.value)
        usd = rec.get("usd")
        if isinstance(usd, int | float):
            total += float(usd)
    return RunView(infra, total)


def ledger_spend(env: dict[str, str] | None = None) -> float | None:
    """Spent plus reserved from the global budget ledger, read-only; None if there is no ledger to read."""
    env = dict(os.environ) if env is None else env
    url = env.get("REDIS_URL")
    if url:
        import redis

        r = redis.Redis.from_url(url)
        return float(r.get(SPENT_KEY) or 0.0) + float(r.get(RESERVED_KEY) or 0.0)  # type: ignore[arg-type]
    path = Path(env.get("BUDGET_DIR", "runs")) / "budget.json"
    if not path.exists():
        return None
    with open(path) as fh:
        fcntl.flock(fh, fcntl.LOCK_SH)
        state = json.loads(fh.read() or "{}")
    reservations = state.get("reservations") or {}
    return float(state.get("spent", 0.0)) + sum(float(v) for v in reservations.values())


def assess(run: RunView, spend: Spend, cap_usd: float | None, th: Thresholds) -> Health:
    recent = run.infra_errors[-th.window :] if th.window > 0 else []
    n, k = len(recent), sum(recent)
    rate = k / n if n else 0.0
    infra_bad = n >= th.min_tasks and rate > th.max_infra_rate
    infra_text = (
        f"{k} of the last {n} finished tasks ended in infra_error ({rate:.0%}; "
        f"unhealthy above {th.max_infra_rate:.0%}, checked from {th.min_tasks} tasks)."
    )

    budget_bad = False
    if cap_usd and cap_usd > 0:
        frac = spend.usd / cap_usd
        budget_bad = frac >= th.budget_warn
        budget_text = (
            f"${spend.usd:.2f} of the ${cap_usd:.2f} cap used ({frac:.0%}, from the {spend.source}; "
            f"unhealthy from {th.budget_warn:.0%})."
        )
    else:
        budget_text = "No budget cap set; budget not checked."

    blocks = [{"title": "Infra errors", "text": infra_text}, {"title": "Budget", "text": budget_text}]
    return Health("unhealthy" if infra_bad or budget_bad else "healthy", blocks)


def payload_for(health: Health, feature: str, environment: str) -> Payload:
    return {
        "feature": feature,
        "environment": environment,
        "status": health.status,
        "reason": {"text_blocks": health.text_blocks},
    }


def httpx_poster(url: str, payload: Payload) -> int:
    try:
        return httpx.post(url, json=payload, timeout=10.0).status_code
    except httpx.HTTPError as exc:
        # httpx messages can include the URL; report only the error type.
        raise HealthPostError(f"health webhook request failed ({type(exc).__name__})") from None


def last_sent(state_path: Path) -> Status | None:
    try:
        status = json.loads(state_path.read_text()).get("status")
    except (OSError, json.JSONDecodeError, AttributeError):
        return None
    return status if status in ("healthy", "unhealthy") else None


Result = Literal["unchanged", "sent", "dry_run"]


def report(
    payload: Payload,
    state_path: Path,
    url: str | None,
    poster: Poster,
    echo: Callable[[str], None] = print,
) -> Result:
    """Sends the payload if its status differs from the last one sent. Without a URL, prints it instead."""
    status: Status = payload["status"]
    if last_sent(state_path) == status:
        echo(f"status {status}, unchanged since the last report; nothing sent")
        return "unchanged"
    if not url:
        echo(f"dry run ({URL_ENV} not set); would send:")
        echo(json.dumps(payload, indent=2))
        return "dry_run"
    code = poster(url, payload)
    if not 200 <= code < 300:
        raise HealthPostError(f"health webhook answered HTTP {code}")
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"status": status, "sent_at": datetime.now(UTC).isoformat(timespec="seconds")}))
    echo(f"sent status {status} to the Flagsmith health webhook")
    return "sent"


def _poster() -> Poster:
    return httpx_poster


@app.command()
def main(
    run_dir: Annotated[Path, typer.Argument(help="runs/<exp> directory holding tasks.jsonl")],
    window: Annotated[int, typer.Option(help="look at the last N finished tasks")] = Thresholds.window,
    min_tasks: Annotated[int, typer.Option(help="no infra verdict below this many tasks")] = Thresholds.min_tasks,
    max_infra_rate: Annotated[float, typer.Option(help="unhealthy above this infra_error rate")] = (
        Thresholds.max_infra_rate
    ),
    budget_warn: Annotated[float, typer.Option(help="unhealthy from this fraction of the cap")] = (
        Thresholds.budget_warn
    ),
    cap_usd: Annotated[float | None, typer.Option(help="budget cap; default BUDGET_USD_TOTAL")] = None,
    feature: Annotated[str, typer.Option()] = FEATURE,
    environment: Annotated[str, typer.Option(help="Flagsmith environment name")] = "Production",
    state_file: Annotated[Path | None, typer.Option(help=f"last sent status; default <run_dir>/{STATE_FILE}")] = None,
) -> None:
    """Compute infra-only health for a run and report it to Flagsmith when it changes."""
    run = read_run(run_dir)
    ledger = ledger_spend()
    spend = Spend(ledger, "budget ledger") if ledger is not None else Spend(run.total_usd, "task records")
    if cap_usd is None and os.environ.get("BUDGET_USD_TOTAL"):
        cap_usd = float(os.environ["BUDGET_USD_TOTAL"])
    health = assess(run, spend, cap_usd, Thresholds(window, min_tasks, max_infra_rate, budget_warn))
    try:
        report(
            payload_for(health, feature, environment),
            state_file or run_dir / STATE_FILE,
            os.environ.get(URL_ENV) or None,
            _poster(),
            typer.echo,
        )
    except HealthPostError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(1) from None


if __name__ == "__main__":
    app()
