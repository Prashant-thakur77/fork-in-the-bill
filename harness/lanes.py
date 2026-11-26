"""Model calls for the two lanes, with budget reservation and per-call pricing.

Both lanes go through `LaneCaller.call`, so every request in either arm is priced,
capped and logged the same way. The delegate lane runs its own conversations and
never writes into the main transcript; only its JSON answer does.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anthropic

from harness import cost
from harness.budget import Ledgerish, TaskBudget
from harness.schema import CallRecord, Lane

PROMPTS = Path(__file__).with_name("prompts")


def prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text().strip()


class TaskCapReached(RuntimeError):
    pass


@dataclass
class LaneTotals:
    usd: float = 0.0
    tokens: int = 0
    calls: int = 0


@dataclass
class LaneCaller:
    client: anthropic.AsyncAnthropic
    identity: str
    global_budget: Ledgerish
    task_budget: TaskBudget
    on_call: Callable[[CallRecord], None]
    totals: dict[Lane, LaneTotals] = field(
        default_factory=lambda: {Lane.main: LaneTotals(), Lane.delegate: LaneTotals()}
    )

    async def call(
        self,
        *,
        lane: Lane,
        turn: int,
        model: str,
        max_tokens: int,
        effort: str,
        system: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        cache: bool,
    ) -> Any:
        if self.task_budget.exhausted:
            raise TaskCapReached(f"per-task cap ${self.task_budget.cap_usd:.2f} reached")
        est_prompt = _estimate_prompt_tokens(system, tools, messages)
        reservation = self.global_budget.reserve(cost.worst_case_usd(model, est_prompt, max_tokens))
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "tools": tools,
            "messages": messages,
            "output_config": {"effort": effort},
        }
        if cache:
            kwargs["cache_control"] = {"type": "ephemeral"}
        t0 = time.monotonic()
        actual = 0.0
        try:
            resp = await self.client.messages.create(**kwargs)
            counts = cost.counts_from_usage(resp.usage)
            actual = cost.usd(model, counts)
        finally:
            self.global_budget.settle(reservation, actual)
        latency = time.monotonic() - t0
        self.task_budget.add(actual)
        tot = self.totals[lane]
        tot.usd += actual
        tot.tokens += counts.total
        tot.calls += 1
        self.on_call(
            CallRecord(
                task_identity=self.identity,
                lane=lane,
                model=model,
                turn=turn,
                input_tokens=counts.input,
                cache_write_5m_tokens=counts.cache_write_5m,
                cache_write_1h_tokens=counts.cache_write_1h,
                cache_read_tokens=counts.cache_read,
                output_tokens=counts.output,
                usd=round(actual, 8),
                latency_s=round(latency, 3),
                stop_reason=resp.stop_reason,
                request_id=getattr(resp, "_request_id", None),
            )
        )
        return resp


def _estimate_prompt_tokens(
    system: list[dict[str, Any]], tools: list[dict[str, Any]], messages: list[dict[str, Any]]
) -> int:
    """Conservative size estimate (about 3 characters per token) for the budget reservation."""
    size = (
        len(json.dumps(system, default=str))
        + len(json.dumps(tools))
        + len(json.dumps(messages, default=_block_default))
    )
    return size // 3 + 1_000


def _block_default(obj: object) -> object:
    dump = getattr(obj, "model_dump", None)
    return dump() if callable(dump) else str(obj)


def system_block(text: str, cache: bool) -> list[dict[str, Any]]:
    block: dict[str, Any] = {"type": "text", "text": text}
    if cache:
        block["cache_control"] = {"type": "ephemeral"}
    return [block]


def tools_with_cache(tools: list[dict[str, Any]], cache: bool) -> list[dict[str, Any]]:
    out = [dict(t) for t in tools]
    if cache and out:
        out[-1]["cache_control"] = {"type": "ephemeral"}
    return out
