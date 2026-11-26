"""Experiment bodies for the Admin API, built from a template with `@` placeholders.

Placeholders are whole JSON strings:

- `@feature_id:<flag>`            numeric id of a feature
- `@variant_id:<flag>:<key>`      numeric id of a variant (multivariate option) by key
- `@metric_id:<name>`             numeric id of a metric
- `@policy:<name>`                the policy JSON from `<policies_dir>/<name>.json`, as a string
- `@hypothesis`                   the hypothesis text from the pre-registration file

`flagsmith/create_experiment.sh` applies the same rules with jq.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, TypedDict

from forkbill.policy import RoutingPolicy


class Ids(TypedDict):
    features: dict[str, int]
    variants: dict[str, dict[str, int]]
    metrics: dict[str, int]


def empty_ids() -> Ids:
    return {"features": {}, "variants": {}, "metrics": {}}


def load_policy_json(policies_dir: Path, name: str) -> str:
    """Validated, compact JSON for a policy file (the exact string stored on the flag)."""
    raw = (policies_dir / f"{name}.json").read_text()
    RoutingPolicy.model_validate_json(raw)
    return json.dumps(json.loads(raw), separators=(",", ":"))


def render(template: Any, ids: Ids, policies_dir: Path, hypothesis: str | None) -> Any:
    def resolve(s: str) -> Any:
        if not s.startswith("@"):
            return s
        kind, _, arg = s[1:].partition(":")
        try:
            if kind == "feature_id":
                return ids["features"][arg]
            if kind == "variant_id":
                flag, _, key = arg.partition(":")
                return ids["variants"][flag][key]
            if kind == "metric_id":
                return ids["metrics"][arg]
            if kind == "policy":
                return load_policy_json(policies_dir, arg)
            if kind == "hypothesis":
                if hypothesis is None:
                    raise ValueError("template needs @hypothesis but no hypothesis was given")
                return hypothesis
        except KeyError as exc:
            raise ValueError(f"placeholder {s!r}: unknown id {exc}") from None
        raise ValueError(f"unknown placeholder {s!r}")

    def walk(node: Any) -> Any:
        if isinstance(node, str):
            return resolve(node)
        if isinstance(node, list):
            return [walk(x) for x in node]
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items() if not k.startswith("$")}
        return node

    return walk(template)


def include_all_variants(body: dict[str, Any], all_variant_ids: Mapping[str, int]) -> list[str]:
    """Add every variant missing from the rollout at 0%; Flagsmith rejects a rollout that leaves
    one out ("Must include all feature's variants."). Returns the keys added."""
    rows = body["experiment_rollout"]["multivariate_feature_state_values"]
    present = {r["multivariate_feature_option"] for r in rows}
    added = [k for k, vid in all_variant_ids.items() if vid not in present]
    rows.extend({"multivariate_feature_option": all_variant_ids[k], "percentage_allocation": 0} for k in added)
    return added


def default_body(
    *,
    flag: str,
    name: str,
    hypothesis: str,
    control_json: str,
    variant_ids: Mapping[str, int],
    metrics: Sequence[Mapping[str, Any]],
    metric_ids: Mapping[str, int],
    feature_id: int,
) -> dict[str, Any]:
    """An even split between control and every variant, 100% rollout."""
    share = round(100 / (len(variant_ids) + 1), 4)
    return {
        "feature": feature_id,
        "name": name,
        "hypothesis": hypothesis,
        "metrics": [
            {"metric": metric_ids[str(m["name"])], "expected_direction": m["expected_direction"]} for m in metrics
        ],
        "experiment_rollout": {
            "enabled": True,
            "rollout_percentage": 100,
            "feature_state_value": {"type": "string", "value": control_json},
            "multivariate_feature_state_values": [
                {"multivariate_feature_option": vid, "percentage_allocation": share} for vid in variant_ids.values()
            ],
        },
    }
