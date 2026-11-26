"""RoutedLanes: turn any agent loop into a two-lane loop driven by a Flagsmith experiment flag.

One task is one Flagsmith identity. On construction the policy is read once:

1. the kill switch flag is read with `get_identity_flags` (no exposure); when it is on, the task
   runs the control policy and no exposure is recorded;
2. otherwise the routing flag is read with `get_experiment_flag`, which records the exposure
   (value = variant key) when the identity is in a running experiment;
3. the flag value is validated as a `RoutingPolicy`. An invalid or missing value fails closed to
   the control policy and is logged.

The loop then asks for `main_model` / `delegate_model`, reports each model call with
`record_call(lane, usage)`, and ends with `finish(solved, turns, seconds)`, which sends
`task_cost`, `task_solved` (only when solved), `task_turns` and `task_seconds` with the same
identifier as the exposure and flushes the event buffer.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, Protocol

from pydantic import ValidationError

from forkbill.policy import RoutingPolicy
from forkbill.pricing import Pricing, Usage

logger = logging.getLogger("forkbill")

EVENT_COST = "task_cost"
EVENT_SOLVED = "task_solved"
EVENT_TURNS = "task_turns"
EVENT_SECONDS = "task_seconds"

FlagSource = Literal["experiment", "flag", "kill_switch", "fail_closed"]


class Lane(StrEnum):
    main = "main"
    delegate = "delegate"


class FlagsLike(Protocol):
    def get_flag(self, feature_name: str) -> Any: ...


class FlagsmithLike(Protocol):
    """The subset of `flagsmith.Flagsmith` (Python SDK 6.7) the kit uses."""

    def get_experiment_flag(
        self, feature_name: str, identifier: str, traits: Mapping[str, Any] | None = None
    ) -> Any: ...

    def get_identity_flags(self, identifier: str, traits: Mapping[str, Any] | None = None) -> FlagsLike: ...

    def get_environment_flags(self) -> FlagsLike: ...

    def track_event(
        self,
        event: str,
        identifier: str | None = None,
        value: str | int | float | bool | None = None,
        traits: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None: ...

    def flush_events(self) -> None: ...


class PolicyError(RuntimeError):
    """No valid policy is available, not even the control policy."""


EventSink = Callable[[str, str, float], None]
"""Called as `sink(identity, event, value)` after each event is queued."""


@dataclass
class LaneTotals:
    calls: int = 0
    usd: float = 0.0
    tokens: int = 0


@dataclass(frozen=True)
class TaskResult:
    identity: str
    variant: str | None
    policy: RoutingPolicy
    flag_source: FlagSource
    exposed: bool
    solved: bool
    usd: float
    usd_main: float
    usd_delegate: float
    tokens_main: int
    tokens_delegate: int
    delegate_calls: int
    turns: int
    seconds: float
    events: list[tuple[str, float]] = field(default_factory=list[tuple[str, float]])
    fail_reason: str | None = None


def parse_policy(value: object) -> RoutingPolicy:
    """Validate a flag value (JSON string or mapping) as a RoutingPolicy."""
    if isinstance(value, RoutingPolicy):
        return value
    if isinstance(value, str):
        return RoutingPolicy.model_validate_json(value)
    if isinstance(value, Mapping):
        return RoutingPolicy.model_validate(dict(value))
    raise ValueError(f"flag value has type {type(value).__name__}, expected JSON")


def _flag_attr(flag: Any, name: str) -> Any:
    return getattr(flag, name, None)


def _is_exposed(flag: Any) -> bool:
    """Mirror the SDK rule for recording an exposure in `get_experiment_flag`."""
    if flag is None or _flag_attr(flag, "is_default") is True:
        return False
    experiment = _flag_attr(flag, "experiment")
    return bool(
        _flag_attr(flag, "enabled")
        and experiment is not None
        and getattr(experiment, "in_experiment", False)
        and _flag_attr(flag, "variant") is not None
    )


class RoutedLanes:
    def __init__(
        self,
        *,
        flagsmith: FlagsmithLike,
        identity: str,
        pricing: Pricing,
        flag: str = "agent_routing",
        kill_flag: str | None = "routing_kill",
        control: RoutingPolicy | Mapping[str, Any] | str | None = None,
        traits: Mapping[str, Any] | None = None,
        emit_unexposed: bool = False,
        on_event: EventSink | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Fetch and validate the policy for `identity` once.

        `control` is the policy used when the kill switch is on or the flag value is invalid.
        When it is None the environment's own value of `flag` is used (in Flagsmith, the control
        variation is the flag's own value), read without recording an exposure.
        """
        if not identity:
            raise ValueError("identity must be a non-empty identifier")
        self.identity = identity
        self.flag = flag
        self._client = flagsmith
        self._pricing = pricing
        self._traits = traits
        self._emit_unexposed = emit_unexposed
        self._on_event = on_event
        self._clock = clock
        self._control_arg = control
        self._started = clock()
        self._totals = {Lane.main: LaneTotals(), Lane.delegate: LaneTotals()}
        self._finished: TaskResult | None = None

        self.variant: str | None = None
        self.exposed = False
        self.fail_reason: str | None = None
        resolved = self._resolve(kill_flag)
        self.policy: RoutingPolicy = resolved[0]
        self.flag_source: FlagSource = resolved[1]

    # ----------------------------------------------------------------- policy resolution

    def _control(self) -> RoutingPolicy:
        if self._control_arg is not None:
            return parse_policy(self._control_arg)
        try:
            env_flag = self._client.get_environment_flags().get_flag(self.flag)
            return parse_policy(_flag_attr(env_flag, "value"))
        except (ValidationError, ValueError) as exc:
            raise PolicyError(f"control policy for {self.flag!r} is not a valid RoutingPolicy: {exc}") from exc

    def _fail_closed(self, reason: str) -> tuple[RoutingPolicy, FlagSource]:
        self.fail_reason = reason
        logger.error("forkbill: identity %s fails closed to the control policy: %s", self.identity, reason)
        return self._control(), "fail_closed"

    def _resolve(self, kill_flag: str | None) -> tuple[RoutingPolicy, FlagSource]:
        if kill_flag:
            try:
                kill = self._client.get_identity_flags(self.identity, self._traits).get_flag(kill_flag)
            except Exception as exc:  # the SDK raises its own error types on API failures
                return self._fail_closed(f"kill switch {kill_flag!r} unreadable: {exc}")
            if _flag_attr(kill, "enabled") and _flag_attr(kill, "is_default") is not True:
                logger.warning("forkbill: kill switch %r is on for %s", kill_flag, self.identity)
                return self._control(), "kill_switch"

        try:
            served = self._client.get_experiment_flag(self.flag, self.identity, self._traits)
        except Exception as exc:
            return self._fail_closed(f"flag {self.flag!r} unreadable: {exc}")

        self.exposed = _is_exposed(served)
        if self.exposed:
            # Send the exposure now: with a small `max_buffer_items` the SDK drops the oldest
            # buffered event when the next one is tracked before a send.
            self._client.flush_events()
        variant = _flag_attr(served, "variant")
        self.variant = str(variant) if variant is not None else None

        if served is None or _flag_attr(served, "is_default") is True:
            return self._fail_closed(f"flag {self.flag!r} does not exist in this environment")
        if not _flag_attr(served, "enabled"):
            return self._fail_closed(f"flag {self.flag!r} is disabled")
        try:
            policy = parse_policy(_flag_attr(served, "value"))
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            return self._fail_closed(f"flag {self.flag!r} value is not a valid policy: {exc}")
        return policy, ("experiment" if self.exposed else "flag")

    # ----------------------------------------------------------------- loop API

    @property
    def main_model(self) -> str:
        return self.policy.main.model

    @property
    def delegate_model(self) -> str:
        return self.policy.delegate.model

    def model_for(self, lane: Lane | str) -> str:
        return self.main_model if Lane(lane) is Lane.main else self.delegate_model

    @property
    def usd(self) -> float:
        return sum(t.usd for t in self._totals.values())

    def lane_totals(self, lane: Lane | str) -> LaneTotals:
        return self._totals[Lane(lane)]

    @property
    def over_budget(self) -> bool:
        """True once spend reaches the policy's per-task dollar cap."""
        return self.usd >= self.policy.caps.usd_per_task

    def record_call(self, lane: Lane | str, usage: Usage, model: str | None = None) -> float:
        """Price one model call on `lane` and add it to the task's totals. Returns dollars."""
        if self._finished is not None:
            raise RuntimeError("record_call after finish")
        lane = Lane(lane)
        usd = self._pricing.cost(model or self.model_for(lane), usage)
        totals = self._totals[lane]
        totals.calls += 1
        totals.usd += usd
        totals.tokens += usage.total_tokens
        return usd

    def _emit(self, event: str, value: float) -> None:
        self._client.track_event(event, identifier=self.identity, value=value)
        self._client.flush_events()  # one event per send, whatever the buffer size
        if self._on_event is not None:
            self._on_event(self.identity, event, value)

    def finish(self, solved: bool, turns: int, seconds: float | None = None) -> TaskResult:
        """Send the task's events with the exposure's identifier, then flush."""
        if self._finished is not None:
            raise RuntimeError("finish called twice")
        if seconds is None:
            seconds = self._clock() - self._started
        usd = round(self.usd, 6)
        events: list[tuple[str, float]] = []
        if self.exposed or self._emit_unexposed:
            events.append((EVENT_COST, usd))
            if solved:
                events.append((EVENT_SOLVED, 1))
            events.append((EVENT_TURNS, turns))
            events.append((EVENT_SECONDS, round(float(seconds), 3)))
            for name, value in events:
                self._emit(name, value)
        else:
            logger.info(
                "forkbill: %s was not exposed (source=%s); no events sent",
                self.identity,
                self.flag_source,
            )
        main, delegate = self._totals[Lane.main], self._totals[Lane.delegate]
        self._finished = TaskResult(
            identity=self.identity,
            variant=self.variant,
            policy=self.policy,
            flag_source=self.flag_source,
            exposed=self.exposed,
            solved=solved,
            usd=usd,
            usd_main=main.usd,
            usd_delegate=delegate.usd,
            tokens_main=main.tokens,
            tokens_delegate=delegate.tokens,
            delegate_calls=delegate.calls,
            turns=turns,
            seconds=float(seconds),
            events=events,
            fail_reason=self.fail_reason,
        )
        return self._finished
