from __future__ import annotations

import pytest

from forkbill.litellm_adapter import usage_from_litellm
from forkbill.pricing import TablePricing, UnknownModelError, Usage


def test_table_pricing_all_buckets() -> None:
    p = TablePricing.from_dict(
        {"models": {"m": {"input": 3, "output": 15, "cache_write_5m": 3.75, "cache_write_1h": 6, "cache_read": 0.3}}}
    )
    u = Usage(
        input_tokens=1000,
        output_tokens=2000,
        cache_write_5m_tokens=4000,
        cache_write_1h_tokens=500,
        cache_read_tokens=10000,
    )
    expected = (1000 * 3 + 2000 * 15 + 4000 * 3.75 + 500 * 6 + 10000 * 0.3) / 1e6
    assert p.cost("m", u) == pytest.approx(expected)
    with pytest.raises(UnknownModelError):
        p.cost("other", u)


def test_usage_from_anthropic_dict_and_object() -> None:
    d = {
        "input_tokens": 10,
        "output_tokens": 20,
        "cache_read_input_tokens": 30,
        "cache_creation": {"ephemeral_5m_input_tokens": 40, "ephemeral_1h_input_tokens": 50},
    }
    assert Usage.from_anthropic(d) == Usage(10, 20, 40, 50, 30)

    class Obj:
        input_tokens = 1
        output_tokens = 2
        cache_read_input_tokens = None
        cache_creation_input_tokens = 7
        cache_creation = None

    assert Usage.from_anthropic(Obj()) == Usage(1, 2, 7, 0, 0)


def test_usage_from_litellm_openai_shape() -> None:
    u = usage_from_litellm(
        {"prompt_tokens": 1000, "completion_tokens": 50, "prompt_tokens_details": {"cached_tokens": 600}}
    )
    assert u == Usage(input_tokens=400, output_tokens=50, cache_read_tokens=600)


def test_usage_from_litellm_anthropic_passthrough() -> None:
    u = usage_from_litellm(
        {
            "prompt_tokens": 1000,
            "completion_tokens": 5,
            "cache_read_input_tokens": 300,
            "cache_creation_input_tokens": 200,
        }
    )
    assert u == Usage(input_tokens=500, output_tokens=5, cache_write_5m_tokens=200, cache_read_tokens=300)


def test_usage_from_litellm_missing() -> None:
    assert usage_from_litellm(None) == Usage()
