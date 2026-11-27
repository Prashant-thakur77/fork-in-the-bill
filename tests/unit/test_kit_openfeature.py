from __future__ import annotations

from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("openfeature_flagsmith")

from openfeature import api
from openfeature.evaluation_context import EvaluationContext

from forkbill import Lane, RoutedLanes, TablePricing, Usage
from forkbill.demo import run_demo
from forkbill.openfeature import OpenFeatureFlagsmith
from forkbill.testing import ProviderFakeFlagsmith

POLICIES = Path(__file__).resolve().parents[2] / "flagsmith" / "policies"
CONTROL = (POLICIES / "control.json").read_text()
LANES_V1 = (POLICIES / "lanes_v1.json").read_text()
PRICING = TablePricing.from_dict(
    {"models": {"claude-sonnet-5-5": {"input": 3, "output": 15}, "claude-haiku-5-5": {"input": 1, "output": 5}}}
)


@pytest.fixture(autouse=True)
def _clean_openfeature() -> Iterator[None]:
    yield
    api.shutdown()


def _fake(**kw: object) -> ProviderFakeFlagsmith:
    return ProviderFakeFlagsmith(control=CONTROL, variants={"lanes_v1": LANES_V1}, **kw)  # type: ignore[arg-type]


def _identity_for(client: ProviderFakeFlagsmith, variant: str) -> str:
    return next(f"t:{i}" for i in range(1000) if client.assign(f"t:{i}") == variant)


def test_policy_exposure_and_events_share_the_identity() -> None:
    fake = _fake()
    of = OpenFeatureFlagsmith.from_flagsmith(fake)
    ident = _identity_for(fake, "lanes_v1")
    lanes = RoutedLanes(flagsmith=of, identity=ident, pricing=PRICING)
    assert lanes.flag_source == "experiment" and lanes.exposed and lanes.variant == "lanes_v1"
    assert lanes.delegate_model == "claude-haiku-5-5"
    # exposure recorded by the provider's FlagsmithExposureHook, not by get_experiment_flag
    assert fake.exposures == [("agent_routing", ident, "lanes_v1")]
    assert not any(c.startswith("get_experiment_flag") for c in fake.calls)

    lanes.record_call(Lane.main, Usage(input_tokens=1_000_000))
    result = lanes.finish(solved=True, turns=3, seconds=4.5)
    assert result.usd == 3.0
    # events went through OpenFeature's track() with the same identifier as the exposure
    assert fake.delivered == [
        ("task_cost", ident, 3.0),
        ("task_solved", ident, 1.0),
        ("task_turns", ident, 3.0),
        ("task_seconds", ident, 4.5),
    ]
    assert fake.buffered == [] and fake.flushes == 5


def test_global_targeting_key_does_not_change_the_identity() -> None:
    fake = _fake()
    api.set_evaluation_context(EvaluationContext(targeting_key="someone-else", attributes={"region": "eu"}))
    of = OpenFeatureFlagsmith.from_flagsmith(fake)
    ident = _identity_for(fake, "control")
    lanes = RoutedLanes(flagsmith=of, identity=ident, pricing=PRICING)
    lanes.finish(solved=False, turns=1, seconds=1)
    assert {i for _, i, _ in fake.exposures} == {ident}
    assert {i for _, i, _ in fake.delivered} == {ident}
    assert all("someone-else" not in c for c in fake.calls)


def test_kill_switch_reads_without_exposure() -> None:
    fake = _fake(killed={"*"})
    lanes = RoutedLanes(flagsmith=OpenFeatureFlagsmith.from_flagsmith(fake), identity="t:1", pricing=PRICING)
    assert lanes.flag_source == "kill_switch" and lanes.policy.policy == "control"
    assert fake.exposures == []
    lanes.finish(solved=True, turns=1, seconds=1)
    assert fake.delivered == []


def test_no_variant_means_no_exposure() -> None:
    fake = _fake(experiment_running=False)
    lanes = RoutedLanes(flagsmith=OpenFeatureFlagsmith.from_flagsmith(fake), identity="t:1", pricing=PRICING)
    assert lanes.flag_source == "flag" and not lanes.exposed and fake.exposures == []


def test_disabled_and_missing_flags_fail_closed() -> None:
    disabled = _fake(flag_enabled=False)
    lanes = RoutedLanes(
        flagsmith=OpenFeatureFlagsmith.from_flagsmith(disabled), identity="t:1", pricing=PRICING, control=CONTROL
    )
    assert lanes.flag_source == "fail_closed" and lanes.fail_reason and "disabled" in lanes.fail_reason
    assert disabled.exposures == []

    missing = _fake()
    lanes = RoutedLanes(
        flagsmith=OpenFeatureFlagsmith.from_flagsmith(missing, domain="other"),
        identity="t:1",
        pricing=PRICING,
        flag="no_such_flag",
        control=CONTROL,
    )
    assert lanes.flag_source == "fail_closed" and "does not exist" in (lanes.fail_reason or "")


def test_control_policy_comes_from_environment_flags() -> None:
    fake = ProviderFakeFlagsmith(control=CONTROL, variants={"lanes_v1": '{"policy": "broken"'})
    ident = _identity_for(fake, "lanes_v1")
    lanes = RoutedLanes(flagsmith=OpenFeatureFlagsmith.from_flagsmith(fake), identity=ident, pricing=PRICING)
    assert lanes.flag_source == "fail_closed" and lanes.policy.policy == "control"
    assert "get_environment_flags" in fake.calls


def test_openfeature_demo_matches_the_native_client() -> None:
    native = _fake()
    native_results = run_demo(native, n=40)
    fake = _fake()
    of_results = run_demo(OpenFeatureFlagsmith.from_flagsmith(fake), n=40)
    assert [(r.identity, r.variant, r.usd, r.solved) for r in of_results] == [
        (r.identity, r.variant, r.usd, r.solved) for r in native_results
    ]
    assert sorted(fake.exposures) == sorted(native.exposures)
    assert [(e, i, float(v)) for e, i, v in fake.delivered] == [(e, i, float(v)) for e, i, v in native.delivered]


def test_track_event_needs_an_identity() -> None:
    of = OpenFeatureFlagsmith.from_flagsmith(_fake())
    with pytest.raises(ValueError):
        of.track_event("task_cost", identifier=None, value=1.0)


def test_offline_cli_openfeature_matches_native(tmp_path: Path) -> None:
    import json

    from typer.testing import CliRunner

    from forkbill.cli import app

    args = ["demo", "--offline", "--n", "16", "--control", str(POLICIES / "control.json"),
            "--variant", f"lanes_v1={POLICIES / 'lanes_v1.json'}"]  # fmt: skip
    runner = CliRunner()
    native = runner.invoke(app, [*args, "--out", str(tmp_path / "a")])
    of = runner.invoke(app, [*args, "--openfeature", "--out", str(tmp_path / "b")])
    assert native.exit_code == 0 and of.exit_code == 0, of.output

    def summary(out: str) -> dict[str, object]:
        return json.loads(out[out.index("{") :])

    assert summary(of.output)["client"] == "openfeature (variant exposure)"
    assert summary(of.output)["by_variant"] == summary(native.output)["by_variant"]
    assert (tmp_path / "a" / "events.jsonl").read_text() == (tmp_path / "b" / "events.jsonl").read_text()


def test_provider_hook_never_exposes_the_control_arm() -> None:
    # The engine resolves control with reason TARGETING_MATCH (the rollout segment), and the
    # provider's FlagsmithExposureHook only fires on SPLIT, so only treatment would be exposed.
    fake = _fake()
    of = OpenFeatureFlagsmith.from_flagsmith(fake, exposure="hook")
    results = run_demo(of, n=30)
    by_arm = {v: [r for r in results if r.variant == v] for v in ("control", "lanes_v1")}
    assert by_arm["control"] and by_arm["lanes_v1"]
    assert not any(r.exposed for r in by_arm["control"]) and all(r.exposed for r in by_arm["lanes_v1"])
    assert {v for _, _, v in fake.exposures} == {"lanes_v1"}
    assert {i for _, i, _ in fake.delivered} == {r.identity for r in by_arm["lanes_v1"]}


class _RecordingFake(ProviderFakeFlagsmith):
    def __init__(self) -> None:
        super().__init__(control=CONTROL, variants={"lanes_v1": LANES_V1})
        self.exposure_metadata: list[dict[str, Any] | None] = []

    def track_exposure_event(
        self,
        feature_name: str,
        identifier: str | None = None,
        value: str | int | float | bool | None = None,
        traits: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.exposure_metadata.append(metadata)
        super().track_exposure_event(feature_name, identifier, value, traits, metadata)


def test_variant_exposure_covers_both_arms_and_carries_experiment_id() -> None:
    fake = _RecordingFake()
    results = run_demo(OpenFeatureFlagsmith.from_flagsmith(fake, experiment_id=7), n=30)
    assert all(r.exposed for r in results)
    assert {v for _, _, v in fake.exposures} == {"control", "lanes_v1"}
    assert len(fake.exposure_metadata) == 30
    assert all(m == {"experiment_id": 7} for m in fake.exposure_metadata)


def test_unknown_exposure_mode_is_refused() -> None:
    with pytest.raises(ValueError):
        OpenFeatureFlagsmith.from_flagsmith(_fake(), exposure="always")  # type: ignore[arg-type]
