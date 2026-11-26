"""The routing policy stored as the JSON value of each variation of the routing flag.

This is a standalone copy of `harness.schema.RoutingPolicy` so the kit installs and runs on its
own. Both models produce the same JSON schema and accept and reject the same documents; a unit
test (tests/unit/test_kit_policy.py) holds them together.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
    """Main lane, delegate lane and caps for one task. Arms differ only in `delegate.model`."""

    policy: str
    schema_: Literal[1] = Field(alias="schema")
    main: MainLane
    delegate: DelegateLane
    caps: Caps
    prompt_variant: Literal["delegate_v1", "draft_review_v1"] = "delegate_v1"

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    def to_json(self) -> str:
        return self.model_dump_json(by_alias=True)
