"""An in-memory stand-in for the Flagsmith client, for tests and the offline demo.

It mimics the Python SDK's experiment behaviour: deterministic bucketing by identifier, an
exposure recorded by `get_experiment_flag` only for enrolled identities, and buffered events
that `flush_events` moves to `delivered`.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class FakeExperiment:
    id: int
    name: str
    in_experiment: bool


@dataclass
class FakeFlag:
    enabled: bool
    value: str | int | float | bool | None
    feature_name: str = ""
    variant: str | None = None
    experiment: FakeExperiment | None = None
    is_default: bool = False


@dataclass
class FakeFlags:
    flags: dict[str, FakeFlag]

    def get_flag(self, feature_name: str) -> FakeFlag:
        return self.flags.get(feature_name) or FakeFlag(
            enabled=False, value=None, feature_name=feature_name, is_default=True
        )


@dataclass
class FakeFlagsmith:
    """`variants` maps variant key -> value; `control` is the flag's own value."""

    flag: str = "agent_routing"
    control: str | None = None
    variants: dict[str, str] = field(default_factory=dict[str, str])
    experiment_running: bool = True
    flag_enabled: bool = True
    killed: set[str] = field(default_factory=set[str])
    kill_flag: str = "routing_kill"
    exposures: list[tuple[str, str, str]] = field(default_factory=list[tuple[str, str, str]])
    buffered: list[tuple[str, str | None, Any]] = field(default_factory=list[tuple[str, str | None, Any]])
    delivered: list[tuple[str, str | None, Any]] = field(default_factory=list[tuple[str, str | None, Any]])
    calls: list[str] = field(default_factory=list[str])
    flushes: int = 0
    fail_on: set[str] = field(default_factory=set[str])

    def assign(self, identifier: str) -> str:
        keys = ["control", *sorted(self.variants)]
        bucket = int(hashlib.sha256(identifier.encode()).hexdigest(), 16) % len(keys)
        return keys[bucket]

    def _routing_flag(self, identifier: str) -> FakeFlag:
        if self.control is None:
            return FakeFlag(enabled=False, value=None, feature_name=self.flag, is_default=True)
        if not self.experiment_running:
            return FakeFlag(enabled=self.flag_enabled, value=self.control, feature_name=self.flag)
        key = self.assign(identifier)
        value = self.control if key == "control" else self.variants[key]
        return FakeFlag(
            enabled=self.flag_enabled,
            value=value,
            feature_name=self.flag,
            variant=key,
            experiment=FakeExperiment(id=1, name="fake", in_experiment=True),
        )

    def get_identity_flags(self, identifier: str, traits: Mapping[str, Any] | None = None) -> FakeFlags:
        self.calls.append(f"get_identity_flags:{identifier}")
        if "get_identity_flags" in self.fail_on:
            raise ConnectionError("fake API unavailable")
        kill = FakeFlag(
            enabled=identifier in self.killed or "*" in self.killed,
            value=None,
            feature_name=self.kill_flag,
        )
        return FakeFlags({self.flag: self._routing_flag(identifier), self.kill_flag: kill})

    def get_environment_flags(self) -> FakeFlags:
        self.calls.append("get_environment_flags")
        return FakeFlags({self.flag: FakeFlag(enabled=self.flag_enabled, value=self.control, feature_name=self.flag)})

    def get_experiment_flag(
        self, feature_name: str, identifier: str, traits: Mapping[str, Any] | None = None
    ) -> FakeFlag:
        self.calls.append(f"get_experiment_flag:{identifier}")
        if "get_experiment_flag" in self.fail_on:
            raise ConnectionError("fake API unavailable")
        flag = self._routing_flag(identifier)
        if feature_name != self.flag:
            flag = FakeFlag(enabled=False, value=None, feature_name=feature_name, is_default=True)
        if flag.enabled and flag.experiment and flag.experiment.in_experiment and flag.variant:
            self.exposures.append((feature_name, identifier, flag.variant))
        return flag

    def track_event(
        self,
        event: str,
        identifier: str | None = None,
        value: str | int | float | bool | None = None,
        traits: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.buffered.append((event, identifier, value))

    def flush_events(self) -> None:
        self.flushes += 1
        self.delivered.extend(self.buffered)
        self.buffered.clear()

    def close(self, timeout_seconds: float = 0) -> None:
        self.flush_events()
