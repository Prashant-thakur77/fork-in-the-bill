from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from forkbill.cli import app
from forkbill.demo import run_demo
from forkbill.experiment import empty_ids, include_all_variants, render
from forkbill.flagsmith_cli import API_LITERALS, extract_hypothesis, literals_used
from forkbill.testing import FakeFlagsmith

ROOT = Path(__file__).resolve().parents[2]
POLICIES = ROOT / "flagsmith" / "policies"


def test_offline_demo_is_deterministic(tmp_path: Path) -> None:
    args = [
        "demo",
        "--offline",
        "--n",
        "20",
        "--control",
        str(POLICIES / "control.json"),
        "--variant",
        f"lanes_v1={POLICIES / 'lanes_v1.json'}",
    ]
    runner = CliRunner()
    first = runner.invoke(app, [*args, "--out", str(tmp_path / "a")])
    second = runner.invoke(app, [*args, "--out", str(tmp_path / "b")])
    assert first.exit_code == 0, first.output
    assert first.output == second.output
    assert (tmp_path / "a" / "tasks.jsonl").read_text() == (tmp_path / "b" / "tasks.jsonl").read_text()
    report = runner.invoke(app, ["report", str(tmp_path / "a")])
    assert report.exit_code == 0, report.output


def test_demo_events_match_exposures() -> None:
    client = FakeFlagsmith(
        control=(POLICIES / "control.json").read_text(), variants={"lanes_v1": (POLICIES / "lanes_v1.json").read_text()}
    )
    results = run_demo(client, n=30)
    exposed = {i for _, i, _ in client.exposures}
    assert len(exposed) == 30
    assert {i for e, i, _ in client.delivered if e == "task_cost"} == exposed
    assert {r.variant for r in results} == {"control", "lanes_v1"}
    for r in results:
        assert r.usd <= r.policy.caps.usd_per_task * 1.5


def test_metrics_json_literals_are_known() -> None:
    spec = json.loads((ROOT / "flagsmith" / "metrics.json").read_text())
    used = literals_used(spec["metrics"])
    assert {m["name"] for m in spec["metrics"]} == {"task_cost", "task_solved", "task_turns", "task_seconds"}
    for field, values in spec["api_literals"].items():
        if field.startswith("$"):
            continue
        assert tuple(values) == API_LITERALS[field]
    assert used["aggregation"] <= set(API_LITERALS["aggregation"])


def test_literals_used_rejects_unknown() -> None:
    with pytest.raises(ValueError):
        literals_used([{"aggregation": "ratio"}])


@pytest.mark.parametrize("name", ["experiment-1.json", "experiment-2.json"])
def test_experiment_templates_render(name: str) -> None:
    ids = empty_ids()
    ids["features"] = {"agent_routing": 11}
    ids["variants"] = {"agent_routing": {"lanes_v1": 21, "lanes_v2": 22}}
    ids["metrics"] = {"task_cost": 1, "task_solved": 2, "task_turns": 3, "task_seconds": 4}
    body = render(json.loads((ROOT / "flagsmith" / name).read_text()), ids, POLICIES, "H1 text")
    assert body["feature"] == 11 and body["hypothesis"] == "H1 text"
    assert not any(k.startswith("$") for k in body)
    rollout = body["experiment_rollout"]
    assert rollout["feature_state_value"]["type"] == "string"
    json.loads(rollout["feature_state_value"]["value"])
    assert sum(v["percentage_allocation"] for v in rollout["multivariate_feature_state_values"]) == 50
    assert all(m["expected_direction"] in API_LITERALS["expected_direction"] for m in body["metrics"])


def test_render_unknown_placeholder() -> None:
    with pytest.raises(ValueError):
        render({"x": "@metric_id:nope"}, empty_ids(), POLICIES, None)


def test_extract_hypothesis() -> None:
    text = "# T\n<!-- hypothesis:start -->\n H1: cheaper. \n<!-- hypothesis:end -->\nrest"
    assert extract_hypothesis(text) == "H1: cheaper."
    with pytest.raises(ValueError):
        extract_hypothesis("<!-- hypothesis:start --> <!-- hypothesis:end -->")


def test_include_all_variants_adds_missing_at_zero() -> None:
    body = {
        "experiment_rollout": {
            "multivariate_feature_state_values": [{"multivariate_feature_option": 21, "percentage_allocation": 50}]
        }
    }
    assert include_all_variants(body, {"lanes_v1": 21, "lanes_v2": 22}) == ["lanes_v2"]
    assert body["experiment_rollout"]["multivariate_feature_state_values"][1] == {
        "multivariate_feature_option": 22,
        "percentage_allocation": 0,
    }
