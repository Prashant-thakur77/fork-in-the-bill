"""The kit's standalone RoutingPolicy must match harness.schema.RoutingPolicy exactly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from forkbill.policy import RoutingPolicy as KitPolicy
from harness.schema import RoutingPolicy as HarnessPolicy

POLICIES = Path(__file__).resolve().parents[2] / "flagsmith" / "policies"


def _base() -> dict[str, Any]:
    return json.loads((POLICIES / "control.json").read_text())


def _with(path: str, value: object) -> dict[str, Any]:
    doc = _base()
    node: Any = doc
    *parents, leaf = path.split(".")
    for p in parents:
        node = node[p]
    if value is _DELETE:
        del node[leaf]
    else:
        node[leaf] = value
    return doc


_DELETE = object()

ACCEPT = [
    _base(),
    json.loads((POLICIES / "lanes_v1.json").read_text()),
    json.loads((POLICIES / "lanes_v2.json").read_text()),
    _with("main.effort", "max"),
    _with("prompt_variant", _DELETE),
    _with("main.cache", _DELETE),
]

REJECT = [
    _with("schema", 2),
    _with("schema", _DELETE),
    _with("extra", 1),
    _with("main.max_tokens", 0),
    _with("main.max_tokens", 128_001),
    _with("delegate.max_context_tokens", 0),
    _with("delegate.effort", "turbo"),
    _with("caps.usd_per_task", 0),
    _with("caps.turns", -1),
    _with("prompt_variant", "other"),
    _with("delegate", _DELETE),
    _with("main.model", 5),
]


def _strip_docs(node: Any) -> Any:
    if isinstance(node, dict):
        return {k: _strip_docs(v) for k, v in node.items() if k != "description"}
    if isinstance(node, list):
        return [_strip_docs(v) for v in node]
    return node


def test_json_schemas_identical() -> None:
    """Same schema apart from docstrings."""
    kit = _strip_docs(KitPolicy.model_json_schema(by_alias=True))
    harness = _strip_docs(HarnessPolicy.model_json_schema(by_alias=True))
    assert kit == harness


@pytest.mark.parametrize("doc", ACCEPT)
def test_both_accept(doc: dict[str, Any]) -> None:
    raw = json.dumps(doc)
    kit = KitPolicy.model_validate_json(raw)
    harness = HarnessPolicy.model_validate_json(raw)
    assert kit.model_dump(by_alias=True, mode="json") == harness.model_dump(by_alias=True, mode="json")


@pytest.mark.parametrize("doc", REJECT)
def test_both_reject(doc: dict[str, Any]) -> None:
    raw = json.dumps(doc)
    with pytest.raises(ValidationError):
        KitPolicy.model_validate_json(raw)
    with pytest.raises(ValidationError):
        HarnessPolicy.model_validate_json(raw)


def test_policy_files_are_clean_ab() -> None:
    load = {
        n: HarnessPolicy.model_validate_json((POLICIES / f"{n}.json").read_text())
        for n in ("control", "lanes_v1", "lanes_v2")
    }
    assert load["control"].clean_ab_diff(load["lanes_v1"]) == {"delegate.model"}
    assert load["lanes_v1"].clean_ab_diff(load["lanes_v2"]) == {"prompt_variant"}
    c = load["control"]
    assert (c.main.model, c.delegate.model, c.caps.turns, c.caps.usd_per_task, c.caps.seconds) == (
        "claude-sonnet-5-5",
        "claude-sonnet-5-5",
        40,
        0.60,
        1200,
    )
    assert load["lanes_v1"].delegate.model == "claude-haiku-5-5"
