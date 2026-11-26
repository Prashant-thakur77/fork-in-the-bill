from __future__ import annotations

import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from forkbill import Lane, PolicyError, RoutedLanes, TablePricing, Usage
from forkbill.testing import FakeFlagsmith

POLICIES = Path(__file__).resolve().parents[2] / "flagsmith" / "policies"
CONTROL = (POLICIES / "control.json").read_text()
LANES_V1 = (POLICIES / "lanes_v1.json").read_text()
PRICING = TablePricing.from_dict(
    {
        "models": {
            "claude-sonnet-5-5": {"input": 3, "output": 15, "cache_write_5m": 3.75, "cache_read": 0.3},
            "claude-haiku-5-5": {"input": 1, "output": 5},
        }
    }
)


def _client(**kw: object) -> FakeFlagsmith:
    return FakeFlagsmith(control=CONTROL, variants={"lanes_v1": LANES_V1}, **kw)  # type: ignore[arg-type]


def _identity_for(client: FakeFlagsmith, variant: str) -> str:
    return next(f"t:{i}" for i in range(1000) if client.assign(f"t:{i}") == variant)


def test_exposed_variant_policy_and_events() -> None:
    client = _client()
    ident = _identity_for(client, "lanes_v1")
    lanes = RoutedLanes(flagsmith=client, identity=ident, pricing=PRICING)
    assert lanes.flag_source == "experiment" and lanes.exposed and lanes.variant == "lanes_v1"
    assert (lanes.main_model, lanes.delegate_model) == ("claude-sonnet-5-5", "claude-haiku-5-5")
    assert client.exposures == [("agent_routing", ident, "lanes_v1")]
    # kill switch read first, without exposure; experiment flag read exactly once
    assert client.calls == [f"get_identity_flags:{ident}", f"get_experiment_flag:{ident}"]

    usd_main = lanes.record_call(Lane.main, Usage(input_tokens=1_000_000))
    usd_del = lanes.record_call("delegate", Usage(output_tokens=1_000_000))
    assert (usd_main, usd_del) == (3.0, 5.0)
    result = lanes.finish(solved=True, turns=7, seconds=12.5)
    assert result.usd == 8.0 and result.delegate_calls == 1
    assert client.delivered == [
        ("task_cost", ident, 8.0),
        ("task_solved", ident, 1),
        ("task_turns", ident, 7),
        ("task_seconds", ident, 12.5),
    ]
    assert client.buffered == []
    # flushed after the exposure and after each of the four events, so a one-item SDK buffer
    # (EventProcessorConfig(max_buffer_items=1)) never drops one
    assert client.flushes == 5


def test_each_event_is_flushed_before_the_next() -> None:
    class OneSlot(FakeFlagsmith):
        def track_event(
            self,
            event: str,
            identifier: str | None = None,
            value: str | int | float | bool | None = None,
            traits: Mapping[str, Any] | None = None,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            assert self.buffered == [], "previous event still buffered: a 1-item SDK buffer would drop it"
            super().track_event(event, identifier, value, traits, metadata)

    client = OneSlot(control=CONTROL, variants={"lanes_v1": LANES_V1})
    lanes = RoutedLanes(flagsmith=client, identity="t:9", pricing=PRICING)
    lanes.finish(solved=True, turns=2, seconds=2)
    assert len(client.delivered) == 4


def test_unsolved_sends_no_solved_event() -> None:
    client = _client()
    lanes = RoutedLanes(flagsmith=client, identity=_identity_for(client, "control"), pricing=PRICING)
    assert lanes.delegate_model == "claude-sonnet-5-5"
    lanes.finish(solved=False, turns=3, seconds=1)
    assert [e for e, _, _ in client.delivered] == ["task_cost", "task_turns", "task_seconds"]


def test_kill_switch_uses_control_without_exposure() -> None:
    client = _client(killed={"*"})
    ident = _identity_for(client, "lanes_v1")
    lanes = RoutedLanes(flagsmith=client, identity=ident, pricing=PRICING)
    assert lanes.flag_source == "kill_switch" and not lanes.exposed
    assert lanes.policy.policy == "control"
    assert client.exposures == []
    assert not any(c.startswith("get_experiment_flag") for c in client.calls)
    lanes.finish(solved=True, turns=1, seconds=1)
    assert client.delivered == []  # unexposed tasks send no events by default


def test_invalid_json_fails_closed_and_logs(caplog: pytest.LogCaptureFixture) -> None:
    client = FakeFlagsmith(control=CONTROL, variants={"lanes_v1": '{"policy": "broken"'})
    ident = _identity_for(client, "lanes_v1")
    with caplog.at_level(logging.ERROR, logger="forkbill"):
        lanes = RoutedLanes(flagsmith=client, identity=ident, pricing=PRICING)
    assert lanes.flag_source == "fail_closed" and lanes.policy.policy == "control"
    assert lanes.exposed  # the exposure was recorded, so the outcome is still reported
    assert "fails closed" in caplog.text
    assert lanes.fail_reason and "not a valid policy" in lanes.fail_reason


def test_schema_violation_fails_closed_to_explicit_control() -> None:
    client = FakeFlagsmith(control=CONTROL, variants={"lanes_v1": LANES_V1.replace('"schema":1', '"schema":9')})
    ident = _identity_for(client, "lanes_v1")
    lanes = RoutedLanes(flagsmith=client, identity=ident, pricing=PRICING, control=LANES_V1)
    assert lanes.flag_source == "fail_closed" and lanes.policy.policy == "lanes_v1"
    assert "get_environment_flags" not in client.calls


def test_api_failure_fails_closed() -> None:
    client = _client(fail_on={"get_experiment_flag"})
    lanes = RoutedLanes(flagsmith=client, identity="t:x", pricing=PRICING)
    assert lanes.flag_source == "fail_closed" and not lanes.exposed


def test_missing_flag_and_invalid_control_raise() -> None:
    client = FakeFlagsmith(control=None)
    with pytest.raises(PolicyError):
        RoutedLanes(flagsmith=client, identity="t:1", pricing=PRICING)


def test_no_running_experiment_serves_flag_without_events() -> None:
    client = _client(experiment_running=False)
    lanes = RoutedLanes(flagsmith=client, identity="t:1", pricing=PRICING)
    assert lanes.flag_source == "flag" and not lanes.exposed and lanes.variant is None
    lanes.finish(solved=True, turns=1, seconds=1)
    assert client.delivered == []


def test_emit_unexposed_and_event_sink() -> None:
    client = _client(experiment_running=False)
    seen: list[tuple[str, str, float]] = []
    lanes = RoutedLanes(
        flagsmith=client,
        identity="t:1",
        pricing=PRICING,
        emit_unexposed=True,
        on_event=lambda i, e, v: seen.append((i, e, v)),
    )
    lanes.finish(solved=False, turns=2, seconds=3)
    assert [e for _, e, _ in seen] == ["task_cost", "task_turns", "task_seconds"]


def test_budget_and_double_finish() -> None:
    client = _client()
    lanes = RoutedLanes(flagsmith=client, identity="t:1", pricing=PRICING)
    lanes.record_call(Lane.main, Usage(output_tokens=40_000))  # $0.60 at $15/MTok
    assert lanes.over_budget
    lanes.finish(solved=False, turns=1, seconds=1)
    with pytest.raises(RuntimeError):
        lanes.finish(solved=False, turns=1, seconds=1)
    with pytest.raises(RuntimeError):
        lanes.record_call(Lane.main, Usage())


def test_empty_identity_rejected() -> None:
    with pytest.raises(ValueError):
        RoutedLanes(flagsmith=_client(), identity="", pricing=PRICING)
