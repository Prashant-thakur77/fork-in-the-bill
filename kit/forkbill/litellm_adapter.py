"""LiteLLM adapter: use any LiteLLM-supported provider as a lane.

`litellm` is optional (`pip install fork-in-the-bill[litellm]`). The usage mapping works on plain
dicts and objects, so it can be tested and used without importing litellm.
"""

from __future__ import annotations

import importlib
from typing import Any

from forkbill.lanes import Lane, RoutedLanes
from forkbill.pricing import Usage


def _get(obj: Any, name: str) -> Any:
    if obj is None:
        return None
    return obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)


def usage_from_litellm(usage: Any) -> Usage:
    """Map a LiteLLM (OpenAI-shaped) `usage` to the kit's Usage.

    `prompt_tokens` includes cached tokens in the OpenAI shape, so cache reads are subtracted from
    the uncached input. Anthropic-shaped fields, which LiteLLM passes through for Claude models,
    are used when present.
    """
    prompt = int(_get(usage, "prompt_tokens") or 0)
    completion = int(_get(usage, "completion_tokens") or 0)
    details = _get(usage, "prompt_tokens_details")
    cached = int(_get(details, "cached_tokens") or 0)
    cache_read = int(_get(usage, "cache_read_input_tokens") or 0) or cached
    cache_write = int(_get(usage, "cache_creation_input_tokens") or 0)
    uncached = max(prompt - cache_read - cache_write, 0)
    return Usage(
        input_tokens=uncached,
        output_tokens=completion,
        cache_write_5m_tokens=cache_write,
        cache_read_tokens=cache_read,
    )


def completion(lanes: RoutedLanes, lane: Lane | str, **kwargs: Any) -> Any:
    """Call `litellm.completion` with the lane's model and record the call's usage."""
    try:
        litellm = importlib.import_module("litellm")
    except ImportError as exc:  # pragma: no cover - depends on the optional extra
        raise ImportError("install the 'litellm' extra to use forkbill.litellm_adapter") from exc
    lane = Lane(lane)
    model = kwargs.pop("model", None) or lanes.model_for(lane)
    response = litellm.completion(model=model, **kwargs)
    lanes.record_call(lane, usage_from_litellm(_get(response, "usage")), model=model)
    return response
