from __future__ import annotations

from pathlib import Path

import pytest

from forkbill import RoutedLanes, TablePricing
from forkbill.client import MODES, client_kwargs, make_client
from forkbill.modes import compare_modes
from forkbill.testing import FakeFlagsmith

POLICIES = Path(__file__).resolve().parents[2] / "flagsmith" / "policies"
CONTROL = (POLICIES / "control.json").read_text()
LANES_V1 = (POLICIES / "lanes_v1.json").read_text()
PRICING = TablePricing.from_dict({"models": {"claude-sonnet-5-5": {"input": 3, "output": 15}}})
CORE = "http://localhost:8000/api/v1/"
EVENTS = "http://localhost:8000/api/"
EDGE = "http://localhost:8001/api/v1"


def _fake(**kw: object) -> FakeFlagsmith:
    return FakeFlagsmith(control=CONTROL, variants={"lanes_v1": LANES_V1}, **kw)  # type: ignore[arg-type]


def test_modes_route_flags_and_events() -> None:
    remote = client_kwargs("remote", environment_key="abc", api_url=CORE, events_api_url=EVENTS)
    assert remote["api_url"] == CORE and remote["enable_local_evaluation"] is False
    local = client_kwargs("local", environment_key="ser.x", api_url=CORE, events_api_url=EVENTS)
    assert local["api_url"] == CORE and local["enable_local_evaluation"] is True
    for mode in ("edge", "edge-local"):
        kw = client_kwargs(mode, environment_key="ser.x", api_url=CORE, events_api_url=EVENTS, edge_url=EDGE)
        assert kw["api_url"] == EDGE + "/"
        # events and analytics go to the core API, never to the proxy
        assert kw["event_processor"] == {"events_api_url": EVENTS}
        assert kw["analytics_url"] == CORE + "analytics/flags/"
    assert client_kwargs("edge-local", environment_key="ser.x", edge_url=EDGE, events_api_url=EVENTS)[
        "enable_local_evaluation"
    ]


@pytest.mark.parametrize(
    ("mode", "kw", "message"),
    [
        ("local", {"environment_key": "client-key"}, "server-side key"),
        ("edge-local", {"environment_key": "client-key", "edge_url": EDGE, "events_api_url": EVENTS}, "server-side"),
        ("edge", {"environment_key": "k", "events_api_url": EVENTS}, "edge_url"),
        ("edge", {"environment_key": "k", "edge_url": EDGE}, "events_api_url"),
        ("nearby", {"environment_key": "k"}, "unknown mode"),
    ],
)
def test_mode_misconfiguration_is_refused(mode: str, kw: dict[str, str], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        client_kwargs(mode, **kw)  # type: ignore[arg-type]


def test_make_client_edge_sends_events_to_core() -> None:
    client = make_client("edge", environment_key="abc", api_url=CORE, events_api_url=EVENTS, edge_url=EDGE)
    try:
        assert client.api_url == EDGE + "/"
        assert client.identities_url == EDGE + "/identities/"
        assert client._event_processor is not None
        assert client._event_processor._batch_endpoint == EVENTS + "v1/events"
    finally:
        client.close(0.1)


def test_modes_are_the_documented_four() -> None:
    assert MODES == ("remote", "local", "edge", "edge-local")


def test_edge_style_flags_serve_the_value_without_exposure() -> None:
    client = _fake(serve_metadata=False)
    ident = next(f"t:{i}" for i in range(100) if client.assign(f"t:{i}") == "lanes_v1")
    lanes = RoutedLanes(flagsmith=client, identity=ident, pricing=PRICING)
    assert lanes.policy.policy == "lanes_v1"  # same policy as the other modes
    assert lanes.variant is None and not lanes.exposed and lanes.flag_source == "flag"
    lanes.finish(solved=True, turns=1, seconds=1)
    assert client.exposures == [] and client.delivered == []


def test_compare_modes_agree_on_policy_and_variant() -> None:
    identities = [f"c:{i}" for i in range(50)]
    report = compare_modes({"remote": _fake(), "local": _fake(), "edge": _fake(serve_metadata=False)}, identities)
    assert report["all_agree"] and report["first_disagreements"] == []
    assert report["modes"]["local"]["same_variant_as_baseline"] == 50
    edge = report["modes"]["edge"]
    assert edge["same_policy_as_baseline"] == 50 and edge["variant_compared"] == 0
    assert edge["by_variant"] == {"(no variant)": 50} and edge["in_experiment"] == 0
    assert sum(report["modes"]["remote"]["by_variant"].values()) == 50


def test_compare_modes_reports_disagreement_and_errors() -> None:
    other = FakeFlagsmith(control=LANES_V1, variants={"lanes_v1": CONTROL})  # every arm's policy swapped
    broken = _fake(fail_on={"get_identity_flags"})
    report = compare_modes({"remote": _fake(), "swapped": other, "down": broken}, ["a", "b", "c", "d"])
    assert not report["all_agree"]
    assert report["modes"]["swapped"]["same_policy_as_baseline"] == 0
    assert report["modes"]["down"]["errors"] == 4
    assert report["first_disagreements"]
