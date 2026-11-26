"""Per-call dollar cost from the provider usage object and the pinned price table."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Protocol

PRICING_PATH = Path(__file__).with_name("pricing.json")
_MTOK = 1_000_000


class UsageLike(Protocol):
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int | None
    cache_creation_input_tokens: int | None


@dataclass(frozen=True)
class TokenCounts:
    input: int
    cache_write_5m: int
    cache_write_1h: int
    cache_read: int
    output: int

    @property
    def prompt_total(self) -> int:
        return self.input + self.cache_write_5m + self.cache_write_1h + self.cache_read

    @property
    def total(self) -> int:
        return self.prompt_total + self.output


@dataclass(frozen=True)
class Rates:
    input: float
    cache_write_5m: float
    cache_write_1h: float
    cache_read: float
    output: float


@cache
def load_pricing(path: str = str(PRICING_PATH)) -> dict[str, dict[str, object]]:
    data = json.loads(Path(path).read_text())
    return data["models"]


def counts_from_usage(usage: UsageLike) -> TokenCounts:
    """Split cache writes by TTL when the API reports it; otherwise treat them as 5-minute writes."""
    cache_read = usage.cache_read_input_tokens or 0
    cache_write_total = usage.cache_creation_input_tokens or 0
    w5, w1h = cache_write_total, 0
    detail = getattr(usage, "cache_creation", None)
    if detail is not None:
        w5 = int(getattr(detail, "ephemeral_5m_input_tokens", 0) or 0)
        w1h = int(getattr(detail, "ephemeral_1h_input_tokens", 0) or 0)
    return TokenCounts(
        input=usage.input_tokens,
        cache_write_5m=w5,
        cache_write_1h=w1h,
        cache_read=cache_read,
        output=usage.output_tokens,
    )


def rates_for(model: str, prompt_tokens: int, pricing: dict[str, dict[str, object]]) -> Rates:
    if model not in pricing:
        raise KeyError(f"no price pinned for model {model!r}; add it to harness/pricing.json")
    row = pricing[model]
    long = row.get("long_prompt")
    src: dict[str, object] = row
    if isinstance(long, dict) and prompt_tokens > int(long["threshold_tokens"]):  # type: ignore[arg-type]
        src = long  # type: ignore[assignment]
    return Rates(
        input=float(src["input"]),  # type: ignore[arg-type]
        cache_write_5m=float(src["cache_write_5m"]),  # type: ignore[arg-type]
        cache_write_1h=float(src["cache_write_1h"]),  # type: ignore[arg-type]
        cache_read=float(src["cache_read"]),  # type: ignore[arg-type]
        output=float(src["output"]),  # type: ignore[arg-type]
    )


def usd(model: str, counts: TokenCounts, pricing: dict[str, dict[str, object]] | None = None) -> float:
    """usd = in*P_in + cw5*P_cw5 + cw1h*P_cw1h + cache_read*P_cr + out*P_out."""
    pricing = pricing or load_pricing()
    r = rates_for(model, counts.prompt_total, pricing)
    return (
        counts.input * r.input
        + counts.cache_write_5m * r.cache_write_5m
        + counts.cache_write_1h * r.cache_write_1h
        + counts.cache_read * r.cache_read
        + counts.output * r.output
    ) / _MTOK


def worst_case_usd(
    model: str, prompt_tokens: int, max_output_tokens: int, pricing: dict[str, dict[str, object]] | None = None
) -> float:
    """Upper bound used to reserve budget before a call: whole prompt as a 5m cache write, full output."""
    pricing = pricing or load_pricing()
    r = rates_for(model, prompt_tokens, pricing)
    top_in = max(r.input, r.cache_write_5m, r.cache_write_1h)
    return (prompt_tokens * top_in + max_output_tokens * r.output) / _MTOK
