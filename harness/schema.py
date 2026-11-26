"""Shared data contracts for the harness, runner, integrity and analysis layers.

Every module that reads or writes run data imports its types from here, so a
field rename shows up as a type error instead of a silently missing column.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Flagsmith names. The flag value of each variation is a RoutingPolicy as JSON.
FLAG_ROUTING = "agent_routing"
FLAG_KILL = "routing_kill"

# Event names sent to Flagsmith; metric definitions in flagsmith/metrics.json match these exactly.
EVENT_COST = "task_cost"
EVENT_SOLVED = "task_solved"
EVENT_TURNS = "task_turns"
EVENT_SECONDS = "task_seconds"

IDENTITY_PREFIX = "swelive:"


def identity_for(instance_id: str) -> str:
    """One task is one Flagsmith identity; exposures and events share this identifier."""
    return f"{IDENTITY_PREFIX}{instance_id}"


class Effort(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    xhigh = "xhigh"
    max = "max"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MainLane(_Strict):
    model: str
    max_tokens: int = Field(gt=0, le=128_000)
    cache: bool = True
    effort: Effort = Effort.medium


class DelegateLane(_Strict):
    model: str
    max_tokens: int = Field(gt=0, le=128_000)
    max_context_tokens: int = Field(gt=0)
    effort: Effort = Effort.low


class Caps(_Strict):
    turns: int = Field(gt=0)
    usd_per_task: float = Field(gt=0)
    seconds: int = Field(gt=0)


class RoutingPolicy(_Strict):
    """The JSON value stored on each variation of the `agent_routing` flag.

    Arms of one experiment must differ only in `delegate.model` (and `policy`, the label).
    `prompt_variant` exists so experiment 2 can pre-register a different delegate role;
    it is part of the flag value, so it is visible and locked in Flagsmith while running.
    """

    policy: str
    schema_: Literal[1] = Field(alias="schema")
    main: MainLane
    delegate: DelegateLane
    caps: Caps
    prompt_variant: Literal["delegate_v1", "draft_review_v1"] = "delegate_v1"

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    def clean_ab_diff(self, other: RoutingPolicy) -> set[str]:
        """Fields that differ between two policies, ignoring the label."""
        a = self.model_dump(by_alias=True, exclude={"policy"})
        b = other.model_dump(by_alias=True, exclude={"policy"})
        return _diff_paths(a, b)


def _diff_paths(a: object, b: object, prefix: str = "") -> set[str]:
    if isinstance(a, dict) and isinstance(b, dict):
        out: set[str] = set()
        for k in set(a) | set(b):
            out |= _diff_paths(a.get(k), b.get(k), f"{prefix}{k}.")
        return out
    return set() if a == b else {prefix.rstrip(".")}


class Lane(StrEnum):
    main = "main"
    delegate = "delegate"


class CallRecord(_Strict):
    """One model call, priced from the provider usage object and pricing.json."""

    task_identity: str
    lane: Lane
    model: str
    turn: int
    input_tokens: int
    cache_write_5m_tokens: int
    cache_write_1h_tokens: int
    cache_read_tokens: int
    output_tokens: int
    usd: float
    latency_s: float
    stop_reason: str | None
    request_id: str | None = None


class Outcome(StrEnum):
    solved = "solved"
    unsolved = "unsolved"  # submitted or stopped, target tests not all passing
    capped_usd = "capped_usd"
    capped_turns = "capped_turns"
    capped_seconds = "capped_seconds"
    agent_error = "agent_error"  # refusal, malformed loop, etc. Never excluded.
    infra_error = "infra_error"  # image pull, provider 5xx after retries. Retried once, then excluded.


class TaskRecord(_Strict):
    """One line of runs/<exp>/tasks.jsonl, written once per finished task."""

    experiment: str
    identity: str
    instance_id: str
    variant: str  # Flagsmith variant key as served (`control`, `lanes_v1`, ...)
    policy: RoutingPolicy
    flag_source: Literal["experiment", "kill_switch", "fail_closed", "dry_run"]
    outcome: Outcome
    solved: bool
    usd: float
    usd_main: float
    usd_delegate: float
    tokens_main: int
    tokens_delegate: int
    turns: int
    delegate_calls: int
    seconds: float
    started_at: str
    finished_at: str
    trace_id: str
    traits: dict[str, str | int | float]
    tests: dict[str, str] = Field(default_factory=dict)  # test name -> PASSED/FAILED/...
    error: str | None = None
    attempt: int = 1


class LedgerKind(StrEnum):
    task_done = "task_done"
    event_sent = "event_sent"
    env_snapshot = "env_snapshot"
    exclusion = "exclusion"
    config = "config"
    kill_switch = "kill_switch"


class LedgerRecord(_Strict):
    seq: int
    ts: str
    kind: LedgerKind
    payload: dict[str, object]
    prev_hash: str
    hash: str
