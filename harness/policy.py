"""Arm assignment. Flagsmith decides; this module only reads and validates what it serves."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from pydantic import ValidationError

from harness.schema import FLAG_KILL, FLAG_ROUTING, RoutingPolicy

log = logging.getLogger(__name__)

POLICY_DIR = Path(__file__).resolve().parent.parent / "flagsmith" / "policies"


class FlagLike(Protocol):
    enabled: bool
    value: object
    variant: str | None


class FlagsLike(Protocol):
    def get_flag(self, feature_name: str) -> FlagLike: ...


class FlagsmithLike(Protocol):
    def get_experiment_flag(
        self, feature_name: str, identifier: str, traits: dict[str, object] | None = None
    ) -> FlagLike: ...
    def get_identity_flags(self, identifier: str, traits: dict[str, object] | None = None) -> FlagsLike: ...
    def track_event(
        self, event: str, identifier: str | None = None, value: float | int | str | bool | None = None, **kw: object
    ) -> None: ...
    def flush_events(self) -> None: ...
    def close(self, timeout_seconds: float = ...) -> None: ...


@dataclass(frozen=True)
class Assignment:
    variant: str
    policy: RoutingPolicy
    source: Literal["experiment", "kill_switch", "fail_closed", "dry_run"]


def load_policy_file(name: str) -> RoutingPolicy:
    return RoutingPolicy.model_validate_json((POLICY_DIR / f"{name}.json").read_text())


def parse_policy(raw: object) -> RoutingPolicy:
    data = json.loads(raw) if isinstance(raw, str) else raw
    return RoutingPolicy.model_validate(data)


def make_client() -> FlagsmithLike:
    """Flagsmith client for short-lived workers: every event is sent as it is tracked."""
    from flagsmith import EventProcessorConfig, Flagsmith

    kwargs: dict[str, object] = {}
    api_url = os.environ.get("FLAGSMITH_API_URL_SDK")
    events_url = os.environ.get("FLAGSMITH_EVENTS_API_URL")
    epc = EventProcessorConfig(max_buffer_items=1)
    if events_url:
        epc = EventProcessorConfig(events_api_url=events_url, max_buffer_items=1)
    if api_url:
        kwargs["api_url"] = api_url
    return Flagsmith(  # type: ignore[return-value]
        environment_key=os.environ["FLAGSMITH_ENVIRONMENT_KEY"],
        enable_events=True,
        event_processor_config=epc,
        **kwargs,  # type: ignore[arg-type]
    )


def assign(client: FlagsmithLike, identity: str, traits: dict[str, object], control: RoutingPolicy) -> Assignment:
    """Called once per task, at the point where the routing policy is applied.

    The kill switch is read without recording an exposure. When it is on, the task runs the
    control policy and is logged as such; it is not counted in the experiment because no
    exposure was sent.
    """
    kill = client.get_identity_flags(identity, traits).get_flag(FLAG_KILL)
    if kill.enabled:
        log.warning("routing_kill is on: %s runs control without exposure", identity)
        return Assignment("control", control, "kill_switch")

    flag = client.get_experiment_flag(FLAG_ROUTING, identifier=identity, traits=traits)
    # With max_buffer_items=1 the SDK drops the oldest buffered event when a second is tracked
    # before the first is sent, so the exposure is flushed before anything else is tracked.
    client.flush_events()
    variant = flag.variant or "control"
    try:
        policy = parse_policy(flag.value)
    except (ValidationError, json.JSONDecodeError, TypeError) as exc:
        log.error(
            "invalid %s value for %s (variant %s): %s; failing closed to control", FLAG_ROUTING, identity, variant, exc
        )
        return Assignment(variant, control, "fail_closed")
    return Assignment(variant, policy, "experiment")
