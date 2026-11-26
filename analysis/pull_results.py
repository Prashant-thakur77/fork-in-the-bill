"""Refresh and download Flagsmith experiment results through the `flagsmith` CLI v2.

Raw responses are saved unchanged to analysis/flagsmith/<exp>/results-<UTC ts>.json.
The results response schema is not documented, so every field we use is read by
`extract_summary`, the one function to adjust once a real response has been seen.

Credentials are whatever the CLI is logged in with; this module never reads, prints or
stores keys, and redacts FLAGSMITH_* environment values from any CLI error output.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import typer

COST_METRIC = "task_cost"
SOLVED_METRIC = "task_solved"


# --------------------------------------------------------------------------------------
# CLI invocation


def results_path(environment: str, experiment_id: str | int) -> str:
    return f"api/v1/environments/{environment}/experiments/{experiment_id}/results/"


def refresh_path(environment: str, experiment_id: str | int) -> str:
    return f"api/v1/environments/{environment}/experiments/{experiment_id}/results/refresh/"


def build_api_command(path: str, method: str = "GET") -> list[str]:
    """argv for one `flagsmith api` call.

    TODO: the CLI was not installed where this was written. Confirm with
    `flagsmith api --help` that the HTTP method flag is spelled `--method` (it may be `-X`
    or `--request`) and that the default is GET; then adjust only this function.
    """
    argv = ["flagsmith", "api", path]
    if method.upper() != "GET":
        argv += ["--method", method.upper()]
    return argv


def _redact(text: str) -> str:
    for name, value in os.environ.items():
        if value and len(value) >= 8 and ("FLAGSMITH" in name or "KEY" in name or "TOKEN" in name):
            text = text.replace(value, "[redacted]")
    return re.sub(r"(ser\.|Api-Key\s+|Token\s+)[A-Za-z0-9_\-\.]{8,}", r"\1[redacted]", text)


class FlagsmithCliError(RuntimeError):
    pass


def call_api(path: str, method: str = "GET", timeout: float = 120.0) -> Any:
    if shutil.which("flagsmith") is None:
        raise FlagsmithCliError("the `flagsmith` CLI is not on PATH")
    proc = subprocess.run(
        build_api_command(path, method),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        raise FlagsmithCliError(
            f"flagsmith api {method} {path} exited {proc.returncode}: {_redact(proc.stderr)[:2000]}"
        )
    out = proc.stdout.strip()
    return json.loads(out) if out else None


# --------------------------------------------------------------------------------------
# Defensive parsing


@dataclass
class FlagsmithSummary:
    """What the analysis needs from a Flagsmith results response. None means not found."""

    chance_to_beat_control_cost: float | None = None
    lift_cost: float | None = None
    ci_cost: list[float] | None = None
    cost_mean_by_variant: dict[str, float] = field(default_factory=dict)
    solve_rate_by_variant: dict[str, float] = field(default_factory=dict)
    solve_rate_status: str = "unknown"
    guardrail_loss: bool | None = None
    srm_flag: bool | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_VARIANT_KEYS = ("key", "variation_key", "variant", "variation", "name")
_METRIC_KEYS = ("metric_name", "name", "metric", "event", "key")


def _as_float(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _label(d: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str):
            return v
        if isinstance(v, dict):
            inner = _label(v, keys)
            if inner:
                return inner
    return None


def _walk(obj: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(obj, dict):
        found.append(obj)
        for v in obj.values():
            found.extend(_walk(v))
    elif isinstance(obj, list):
        for v in obj:
            found.extend(_walk(v))
    return found


def _find_number(d: dict[str, Any], *needles: str) -> float | None:
    for k, v in d.items():
        lk = k.lower()
        if all(n in lk for n in needles):
            f = _as_float(v)
            if f is not None:
                return f
    return None


def _first(*values: float | None) -> float | None:
    for v in values:
        if v is not None:
            return v
    return None


def _find_interval(d: dict[str, Any]) -> list[float] | None:
    for k, v in d.items():
        lk = k.lower()
        if "interval" in lk or lk in {"ci", "credible", "hdi"}:
            if isinstance(v, list) and len(v) == 2:
                lo, hi = _as_float(v[0]), _as_float(v[1])
                if lo is not None and hi is not None:
                    return [lo, hi]
            if isinstance(v, dict):
                lo = _first(_find_number(v, "low"), _find_number(v, "lower"))
                hi = _first(_find_number(v, "high"), _find_number(v, "upper"))
                if lo is not None and hi is not None:
                    return [lo, hi]
    return None


def _metric_blocks(raw: Any, metric: str) -> list[dict[str, Any]]:
    return [d for d in _walk(raw) if _label(d, _METRIC_KEYS) == metric]


def _variant_entries(block: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for d in _walk(block):
        if d is block:
            continue
        name = _label(d, _VARIANT_KEYS)
        if name and name not in out and any(_as_float(v) is not None for v in d.values()):
            out[name] = d
    return out


def extract_summary(raw: Any, control: str = "control", treatment: str = "lanes_v1") -> FlagsmithSummary:
    """Pull the fields the decision rule needs out of a Flagsmith results response.

    Assumed (unconfirmed) shape: somewhere in the response a block names the metric
    (`task_cost`, `task_solved`) and nests one entry per variation key, each with a mean
    or value, a chance-to-beat-control probability, a lift and a credible interval.
    Probabilities given in percent (> 1) are scaled to 0-1.
    """
    s = FlagsmithSummary()

    for block in _metric_blocks(raw, COST_METRIC):
        for name, entry in _variant_entries(block).items():
            mean = _first(_find_number(entry, "mean"), _find_number(entry, "value"))
            if mean is not None:
                s.cost_mean_by_variant.setdefault(name, mean)
            if name == treatment:
                p = _first(_find_number(entry, "chance"), _find_number(entry, "probability"))
                if p is not None and s.chance_to_beat_control_cost is None:
                    s.chance_to_beat_control_cost = p / 100 if p > 1 else p
                lift = _find_number(entry, "lift")
                if lift is not None and s.lift_cost is None:
                    s.lift_cost = lift
                ci = _find_interval(entry)
                if ci is not None and s.ci_cost is None:
                    s.ci_cost = ci

    for block in _metric_blocks(raw, SOLVED_METRIC):
        for name, entry in _variant_entries(block).items():
            rate = _first(_find_number(entry, "rate"), _find_number(entry, "mean"))
            if rate is not None:
                s.solve_rate_by_variant.setdefault(name, rate)
            if name == treatment:
                status = None
                for k, v in entry.items():
                    if "status" in k.lower() and isinstance(v, str):
                        status = v
                        break
                p = _first(_find_number(entry, "chance"), _find_number(entry, "probability"))
                if status is not None:
                    s.solve_rate_status = status
                    s.guardrail_loss = any(w in status.lower() for w in ("los", "worse", "fail"))
                elif p is not None:
                    p = p / 100 if p > 1 else p
                    # Solve rate should not decrease: a loss is a confident decrease.
                    s.guardrail_loss = p <= 0.05
                    s.solve_rate_status = "loss" if s.guardrail_loss else "no_loss"

    for d in _walk(raw):
        for k, v in d.items():
            if "srm" in k.lower() and isinstance(v, bool):
                s.srm_flag = v
    return s


def latest_results(flagsmith_dir: Path, exp: str) -> tuple[Path, Any] | None:
    files = sorted((flagsmith_dir / exp).glob("results-*.json"))
    if not files:
        return None
    return files[-1], json.loads(files[-1].read_text(encoding="utf-8"))


def pulled_at(path: Path) -> str:
    m = re.match(r"results-(.+)\.json$", path.name)
    return m.group(1) if m else ""


# --------------------------------------------------------------------------------------
# CLI


def _experiment_id(runs: Path, exp: str) -> str:
    meta = runs / exp / "meta.json"
    if meta.exists():
        value = json.loads(meta.read_text(encoding="utf-8")).get("flagsmith_experiment_id")
        if value is not None:
            return str(value)
    raise typer.BadParameter(f"no flagsmith_experiment_id in {meta}; pass --experiment-id")


app = typer.Typer(add_completion=False)


@app.command()
def main(
    exp: Annotated[str, typer.Option(help="experiment name, e.g. exp1")] = "exp1",
    environment: Annotated[
        str | None, typer.Option(help="environment id/key; default $FLAGSMITH_ENVIRONMENT_ID")
    ] = None,
    experiment_id: Annotated[str | None, typer.Option(help="default from runs/<exp>/meta.json")] = None,
    runs: Annotated[Path, typer.Option()] = Path("runs"),
    out: Annotated[Path, typer.Option()] = Path("analysis/flagsmith"),
    refresh: Annotated[bool, typer.Option(help="POST results/refresh/ first")] = True,
) -> None:
    env = environment or os.environ.get("FLAGSMITH_ENVIRONMENT_ID")
    if not env:
        raise typer.BadParameter("pass --environment or set FLAGSMITH_ENVIRONMENT_ID")
    exp_id = experiment_id or _experiment_id(runs, exp)
    if refresh:
        call_api(refresh_path(env, exp_id), method="POST")
    raw = call_api(results_path(env, exp_id))
    ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    dest = out / exp / f"results-{ts}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(raw, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    typer.echo(f"saved {dest}")
    typer.echo(json.dumps(extract_summary(raw).to_dict(), indent=2))


if __name__ == "__main__":
    app()
