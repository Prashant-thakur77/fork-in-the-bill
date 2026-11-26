from types import SimpleNamespace
from typing import Any

import pytest

from harness import cost


def usage(i=0, o=0, cr=0, cw=0, w5=None, w1=None) -> Any:
    detail = None if w5 is None else SimpleNamespace(ephemeral_5m_input_tokens=w5, ephemeral_1h_input_tokens=w1 or 0)
    return SimpleNamespace(
        input_tokens=i,
        output_tokens=o,
        cache_read_input_tokens=cr,
        cache_creation_input_tokens=cw,
        cache_creation=detail,
    )


def test_opus_formula_matches_hand_arithmetic():
    c = cost.counts_from_usage(usage(i=10_000, o=2_000, cr=50_000, cw=8_000, w5=8_000))
    # 10k*4 + 8k*5 + 50k*0.2 + 2k*20 = 40000+40000+10000+40000 per MTok
    assert cost.usd("claude-opus-5-5", c) == pytest.approx(0.13)


def test_cache_write_split_by_ttl():
    c = cost.counts_from_usage(usage(i=0, o=0, cw=3_000, w5=1_000, w1=2_000))
    assert (c.cache_write_5m, c.cache_write_1h) == (1_000, 2_000)
    assert cost.usd("claude-opus-5-5", c) == pytest.approx((1_000 * 5 + 2_000 * 8) / 1e6)


def test_missing_ttl_detail_counts_as_5m():
    c = cost.counts_from_usage(usage(i=1, o=1, cw=500))
    assert c.cache_write_5m == 500 and c.cache_write_1h == 0


def test_haiku_long_prompt_tier():
    short = cost.TokenCounts(input=100_000, cache_write_5m=0, cache_write_1h=0, cache_read=0, output=1_000)
    long = cost.TokenCounts(input=100_001, cache_write_5m=0, cache_write_1h=0, cache_read=0, output=1_000)
    assert cost.usd("claude-haiku-5-5", short) == pytest.approx((100_000 * 0.1 + 1_000 * 0.5) / 1e6)
    assert cost.usd("claude-haiku-5-5", long) == pytest.approx((100_001 * 0.5 + 1_000 * 2.5) / 1e6)


def test_unknown_model_is_an_error():
    with pytest.raises(KeyError):
        cost.usd("not-a-model", cost.TokenCounts(1, 0, 0, 0, 1))


def test_worst_case_bounds_actual():
    c = cost.TokenCounts(input=20_000, cache_write_5m=5_000, cache_write_1h=0, cache_read=10_000, output=4_000)
    assert cost.worst_case_usd("claude-opus-5-5", c.prompt_total, 4_000) >= cost.usd("claude-opus-5-5", c)
