from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from harness.budget import FileBudget
from runner import health
from runner.health import (
    HealthPostError,
    RunView,
    Spend,
    Thresholds,
    assess,
    ledger_spend,
    payload_for,
    read_run,
    report,
)

SECRET_URL = "https://api.flagsmith.example/api/v1/feature-health/webhook/s3cr3t-token/"


class FakePoster:
    def __init__(self, code: int = 200) -> None:
        self.code = code
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, url: str, payload: dict[str, Any]) -> int:
        self.calls.append((url, payload))
        return self.code


def write_tasks(run_dir: Path, rows: list[dict[str, Any]]) -> Path:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "tasks.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    return run_dir


def task(outcome: str, variant: str = "control", usd: float = 0.5, solved: bool = False) -> dict[str, Any]:
    return {"outcome": outcome, "variant": variant, "usd": usd, "solved": solved, "instance_id": "x"}


def view(n_ok: int, n_infra: int) -> RunView:
    return RunView([False] * n_ok + [True] * n_infra, 0.0)


TH = Thresholds(window=10, min_tasks=5, max_infra_rate=0.25, budget_warn=0.9)
NO_SPEND = Spend(0.0, "budget ledger")


def test_healthy_when_infra_errors_and_spend_are_low() -> None:
    h = assess(view(9, 1), Spend(10.0, "budget ledger"), 100.0, TH)
    assert h.status == "healthy"
    assert [b["title"] for b in h.text_blocks] == ["Infra errors", "Budget"]


def test_unhealthy_when_infra_rate_over_threshold_in_window() -> None:
    h = assess(view(7, 3), NO_SPEND, None, TH)
    assert h.status == "unhealthy"
    assert "3 of the last 10" in h.text_blocks[0]["text"]


def test_window_only_counts_the_last_n_tasks() -> None:
    # Ten early infra errors, then ten clean tasks: the window of 10 sees none.
    run = RunView([True] * 10 + [False] * 10, 0.0)
    assert assess(run, NO_SPEND, None, TH).status == "healthy"
    run = RunView([False] * 10 + [True] * 3 + [False] * 7, 0.0)
    assert assess(run, NO_SPEND, None, TH).status == "unhealthy"


def test_no_infra_verdict_below_min_tasks() -> None:
    assert assess(view(1, 3), NO_SPEND, None, TH).status == "healthy"


def test_unhealthy_when_budget_nearly_used() -> None:
    assert assess(view(10, 0), Spend(89.0, "budget ledger"), 100.0, TH).status == "healthy"
    h = assess(view(10, 0), Spend(90.0, "budget ledger"), 100.0, TH)
    assert h.status == "unhealthy"
    assert "90%" in h.text_blocks[1]["text"]


def test_payload_shape() -> None:
    p = payload_for(assess(view(10, 0), NO_SPEND, None, TH), "agent_routing", "Production")
    assert set(p) == {"feature", "environment", "status", "reason"}
    assert p["feature"] == "agent_routing"
    assert p["status"] == "healthy"
    assert all(set(b) == {"title", "text"} for b in p["reason"]["text_blocks"])


def test_never_reads_solve_outcomes_or_arms(tmp_path: Path) -> None:
    """Swapping solved/unsolved and arms must not change anything health computes or sends."""
    a = write_tasks(
        tmp_path / "a",
        [task("solved", "lanes_v1", solved=True), task("unsolved"), task("infra_error"), task("capped_usd")],
    )
    b = write_tasks(
        tmp_path / "b",
        [
            task("unsolved", "control"),
            task("solved", "lanes_v1", solved=True),
            task("infra_error"),
            task("agent_error"),
        ],
    )
    pa = payload_for(assess(read_run(a), NO_SPEND, None, Thresholds(min_tasks=1)), "agent_routing", "Production")
    pb = payload_for(assess(read_run(b), NO_SPEND, None, Thresholds(min_tasks=1)), "agent_routing", "Production")
    assert pa == pb
    text = json.dumps(pa)
    for word in ("solve", "lanes_v1", "control", "capped"):
        assert word not in text


def test_read_run_skips_a_torn_last_line(tmp_path: Path) -> None:
    run_dir = write_tasks(tmp_path / "r", [task("infra_error", usd=1.0), task("unsolved", usd=2.0)])
    with (run_dir / "tasks.jsonl").open("a") as fh:
        fh.write('{"outcome": "infra_e')
    v = read_run(run_dir)
    assert v.infra_errors == [True, False]
    assert v.total_usd == pytest.approx(3.0)
    assert read_run(tmp_path / "missing") == RunView([], 0.0)


def test_ledger_spend_reads_file_budget_with_reservations(tmp_path: Path) -> None:
    b = FileBudget(tmp_path / "budget.json", 10.0)
    b.settle(b.reserve(1.0), 0.75)
    b.reserve(0.5)  # still in flight
    assert ledger_spend({"BUDGET_DIR": str(tmp_path)}) == pytest.approx(1.25)
    assert ledger_spend({"BUDGET_DIR": str(tmp_path / "none")}) is None


def payload(status: str) -> dict[str, Any]:
    return {"feature": "agent_routing", "environment": "Production", "status": status, "reason": {"text_blocks": []}}


def test_dry_run_prints_payload_and_sends_nothing(tmp_path: Path) -> None:
    poster, out = FakePoster(), []
    assert report(payload("unhealthy"), tmp_path / "s.json", None, poster, out.append) == "dry_run"
    assert poster.calls == []
    assert json.loads(out[-1])["status"] == "unhealthy"
    assert not (tmp_path / "s.json").exists()


def test_posts_only_when_status_changes(tmp_path: Path) -> None:
    poster, out = FakePoster(), []
    state = tmp_path / "s.json"
    assert report(payload("healthy"), state, SECRET_URL, poster, out.append) == "sent"
    assert report(payload("healthy"), state, SECRET_URL, poster, out.append) == "unchanged"
    assert report(payload("unhealthy"), state, SECRET_URL, poster, out.append) == "sent"
    assert report(payload("unhealthy"), state, SECRET_URL, poster, out.append) == "unchanged"
    assert [p["status"] for _, p in poster.calls] == ["healthy", "unhealthy"]
    assert all(url == SECRET_URL for url, _ in poster.calls)
    assert not any("s3cr3t" in line for line in out)


def test_failed_post_keeps_state_and_hides_url(tmp_path: Path) -> None:
    state = tmp_path / "s.json"
    with pytest.raises(HealthPostError) as err:
        report(payload("unhealthy"), state, SECRET_URL, FakePoster(503), lambda _: None)
    assert "503" in str(err.value)
    assert "s3cr3t" not in str(err.value)
    assert not state.exists()
    # The next run tries again.
    assert report(payload("unhealthy"), state, SECRET_URL, FakePoster(), lambda _: None) == "sent"


def test_httpx_poster_error_does_not_leak_url(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    def boom(url: str, **_: Any) -> Any:
        raise httpx.ConnectError(f"cannot reach {url}")

    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(HealthPostError) as err:
        health.httpx_poster(SECRET_URL, payload("healthy"))
    assert "s3cr3t" not in str(err.value)
    assert err.value.__cause__ is None
    assert err.value.__suppress_context__


def test_cli_dry_run_and_send(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    run_dir = write_tasks(tmp_path / "exp1", [task("infra_error")] * 3 + [task("unsolved")] * 2)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("BUDGET_DIR", str(tmp_path / "nobudget"))
    monkeypatch.setenv("BUDGET_USD_TOTAL", "100")
    monkeypatch.delenv(health.URL_ENV, raising=False)
    runner = CliRunner()

    dry = runner.invoke(health.app, [str(run_dir)])
    assert dry.exit_code == 0, dry.output
    assert '"status": "unhealthy"' in dry.output
    assert "task records" in dry.output

    poster = FakePoster()
    monkeypatch.setattr(health, "_poster", lambda: poster)
    monkeypatch.setenv(health.URL_ENV, SECRET_URL)
    sent = runner.invoke(health.app, [str(run_dir)])
    assert sent.exit_code == 0, sent.output
    assert len(poster.calls) == 1
    assert "s3cr3t" not in sent.output
    again = runner.invoke(health.app, [str(run_dir)])
    assert "unchanged" in again.output
    assert len(poster.calls) == 1

    monkeypatch.setattr(health, "_poster", lambda: FakePoster(500))
    failed = runner.invoke(health.app, [str(run_dir), "--max-infra-rate", "0.9"])
    assert failed.exit_code == 1
    assert "s3cr3t" not in failed.output
