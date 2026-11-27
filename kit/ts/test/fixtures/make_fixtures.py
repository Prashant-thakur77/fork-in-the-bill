"""Write the fixtures the TypeScript kit and the MCP server check their offline bucketing against.

    uv run python kit/ts/test/fixtures/make_fixtures.py

`environment.json` is a made-up environment document shaped like the ones Flagsmith serves: the
routing flag with two variants and an experiment rollout segment that takes 60% of identities and
splits them 30 / 30 / 40. `vectors.json` holds what the Python implementation says about it:
`hashed_percentage` for a few id lists, and for each identity the variant from
`integrity.verify_assignment.independent_variant` and from Flagsmith's own engine. Nothing here is
typed in by hand, so the TypeScript port is compared with Python, not with itself.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from harness.schema import FLAG_KILL, FLAG_ROUTING
from integrity.verify_assignment import EngineEvaluator, hashed_percentage, identity_key, independent_variant

HERE = Path(__file__).resolve().parent
POLICIES = HERE.parents[3] / "flagsmith" / "policies"
API_KEY = "FIXTUREKEY"
SEGMENT_ID = 7001
ROLLOUT_PERCENT = 60.0
N_IDENTITIES = 60

HASH_INPUTS: list[list[str]] = [
    ["x"],
    ["demo", "floci-io__floci-1837"],
    ["12345", "env_abc_task-1"],
    [str(SEGMENT_ID), f"{API_KEY}_task:0001"],
    ["9002", f"{API_KEY}_task:0001"],
    ["a", "b", "c"],
    ["naïve", "タスク"],
    [""],
]


def policy(name: str) -> str:
    return (POLICIES / f"{name}.json").read_text(encoding="utf-8").strip()


def routing_state(django_id: int, uuid: str, allocations: dict[str, float], *, in_experiment: bool) -> dict[str, Any]:
    return {
        "django_id": django_id,
        "enabled": True,
        "feature": {"id": 501, "name": FLAG_ROUTING, "type": "MULTIVARIATE"},
        "feature_segment": {"priority": 0} if in_experiment else None,
        "feature_state_value": policy("control"),
        "featurestate_uuid": uuid,
        "metadata": {"experiment": {"id": 1, "in_experiment": in_experiment, "name": "fixture experiment"}},
        "multivariate_feature_state_values": [
            {
                "id": django_id * 10 + i,
                "multivariate_feature_option": {"id": 600 + i, "key": key, "value": policy(key)},
                "mv_fs_value_uuid": f"00000000-0000-4000-8000-{django_id * 10 + i:012d}",
                "percentage_allocation": pct,
            }
            for i, (key, pct) in enumerate(allocations.items(), start=1)
        ],
    }


def environment() -> dict[str, Any]:
    return {
        "allow_client_traits": True,
        "api_key": API_KEY,
        "feature_states": [
            routing_state(
                9001, "11111111-1111-4111-8111-111111111111", {"lanes_v1": 0, "lanes_v2": 0}, in_experiment=False
            ),
            {
                "django_id": 9003,
                "enabled": False,
                "feature": {"id": 502, "name": FLAG_KILL, "type": "STANDARD"},
                "feature_segment": None,
                "feature_state_value": None,
                "featurestate_uuid": "33333333-3333-4333-8333-333333333333",
                "multivariate_feature_state_values": [],
            },
        ],
        "hide_disabled_flags": None,
        "hide_sensitive_data": False,
        "id": 1,
        "identity_overrides": [],
        "name": "Fixture",
        "project": {
            "enable_realtime_updates": False,
            "hide_disabled_flags": False,
            "id": 1,
            "name": "fixture",
            "organisation": {
                "feature_analytics": False,
                "id": 1,
                "name": "fixture",
                "persist_trait_data": True,
                "stop_serving_flags": False,
            },
            "segments": [
                {
                    "feature_states": [
                        routing_state(
                            9002,
                            "22222222-2222-4222-8222-222222222222",
                            {"lanes_v1": 30, "lanes_v2": 30},
                            in_experiment=True,
                        )
                    ],
                    "id": SEGMENT_ID,
                    "name": "experiment-1-rollout",
                    "rules": [
                        {
                            "conditions": [
                                {
                                    "operator": "PERCENTAGE_SPLIT",
                                    "property_": "$.identity.key",
                                    "value": str(ROLLOUT_PERCENT),
                                }
                            ],
                            "rules": [],
                            "type": "ALL",
                        }
                    ],
                }
            ],
            "server_key_only_feature_ids": [],
        },
        "updated_at": "2026-11-27T00:00:00.000000+00:00",
        "use_identity_composite_key_for_hashing": True,
        "use_identity_overrides_in_local_eval": True,
    }


def main() -> None:
    doc = environment()
    engine = EngineEvaluator(doc)
    assignments = []
    for i in range(1, N_IDENTITIES + 1):
        identity = f"task:{i:04d}"
        key = identity_key(doc, identity)
        segment_pct = hashed_percentage([str(SEGMENT_ID), key])
        in_rollout = segment_pct <= ROLLOUT_PERCENT
        got = engine.evaluate(identity, {})
        assignments.append(
            {
                "identity": identity,
                "segment_percentage": segment_pct,
                "in_rollout": in_rollout,
                "split_percentage": hashed_percentage(["9002" if in_rollout else "9001", key]),
                "independent_variant": independent_variant(doc, identity),
                "engine_variant": got.variant,
                "engine_in_experiment": got.in_experiment,
            }
        )
    vectors = {
        "generated_by": "kit/ts/test/fixtures/make_fixtures.py",
        "hashed_percentage": [{"ids": ids, "value": hashed_percentage(ids)} for ids in HASH_INPUTS],
        "assignments": assignments,
    }
    (HERE / "environment.json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    (HERE / "vectors.json").write_text(json.dumps(vectors, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    by_variant: dict[str, int] = {}
    for a in assignments:
        by_variant[str(a["independent_variant"])] = by_variant.get(str(a["independent_variant"]), 0) + 1
    print(f"{len(assignments)} identities, {sum(a['in_rollout'] for a in assignments)} in the rollout: {by_variant}")


if __name__ == "__main__":
    main()
