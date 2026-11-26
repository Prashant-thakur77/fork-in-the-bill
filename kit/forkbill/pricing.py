"""Token usage and pluggable pricing.

A lane call reports a `Usage`; a `Pricing` turns it into dollars. `TablePricing` reads per-million
token prices from a dict or JSON file; any object with a matching `cost` method can replace it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_5m_tokens: int = 0
    cache_write_1h_tokens: int = 0
    cache_read_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_write_5m_tokens
            + self.cache_write_1h_tokens
            + self.cache_read_tokens
        )

    @classmethod
    def from_anthropic(cls, usage: Any) -> Usage:
        """Map an Anthropic Messages API `usage` object (or dict) to a Usage."""

        def get(obj: Any, name: str) -> Any:
            return obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)

        creation = get(usage, "cache_creation")
        w5 = int(get(creation, "ephemeral_5m_input_tokens") or 0) if creation is not None else 0
        w1 = int(get(creation, "ephemeral_1h_input_tokens") or 0) if creation is not None else 0
        if creation is None:
            # Older responses only report the combined figure, billed at the 5-minute rate.
            w5 = int(get(usage, "cache_creation_input_tokens") or 0)
        return cls(
            input_tokens=int(get(usage, "input_tokens") or 0),
            output_tokens=int(get(usage, "output_tokens") or 0),
            cache_write_5m_tokens=w5,
            cache_write_1h_tokens=w1,
            cache_read_tokens=int(get(usage, "cache_read_input_tokens") or 0),
        )


class Pricing(Protocol):
    def cost(self, model: str, usage: Usage) -> float:
        """US dollars for one call of `model` with `usage`."""
        ...


@dataclass(frozen=True)
class ModelPrice:
    """US dollars per million tokens."""

    input: float
    output: float
    cache_write_5m: float = 0.0
    cache_write_1h: float = 0.0
    cache_read: float = 0.0


class UnknownModelError(KeyError):
    pass


class TablePricing:
    """Prices from a table: `{"models": {"<id>": {"input": .., "output": .., ...}}}` per MTok."""

    def __init__(self, prices: dict[str, ModelPrice]) -> None:
        self._prices = dict(prices)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TablePricing:
        models = data.get("models", data)
        if not isinstance(models, dict):
            raise ValueError("pricing table needs a 'models' object")
        prices: dict[str, ModelPrice] = {}
        for model, row in models.items():
            if not isinstance(row, dict):
                raise ValueError(f"pricing row for {model!r} must be an object")
            prices[str(model)] = ModelPrice(
                input=float(row["input"]),
                output=float(row["output"]),
                cache_write_5m=float(row.get("cache_write_5m", 0.0)),
                cache_write_1h=float(row.get("cache_write_1h", 0.0)),
                cache_read=float(row.get("cache_read", 0.0)),
            )
        return cls(prices)

    @classmethod
    def from_json(cls, path: str | Path) -> TablePricing:
        return cls.from_dict(json.loads(Path(path).read_text()))

    def cost(self, model: str, usage: Usage) -> float:
        try:
            p = self._prices[model]
        except KeyError:
            raise UnknownModelError(f"no price for model {model!r}") from None
        return (
            usage.input_tokens * p.input
            + usage.output_tokens * p.output
            + usage.cache_write_5m_tokens * p.cache_write_5m
            + usage.cache_write_1h_tokens * p.cache_write_1h
            + usage.cache_read_tokens * p.cache_read
        ) / 1_000_000
