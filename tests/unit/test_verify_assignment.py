from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from flag_engine.utils.hashing import get_hashed_percentage_for_object_ids
from typer.testing import CliRunner

from integrity import verify_assignment as va

CONTROL = '{"policy":"control"}'
LANES = '{"policy":"lanes_v1"}'


def routing_state(django_id: int, mv_id: int, pct: float, priority: int | None, in_experiment: bool) -> dict[str, Any]:
    return {
        "django_id": django_id,
        "enabled": True,
        "feature": {"id": 9, "name": "agent_routing", "type": "MULTIVARIATE"},
        "feature_segment": None if priority is None else {"priority": priority},
        "feature_state_value": CONTROL,
        "featurestate_uuid": f"00000000-0000-0000-0000-{django_id:012d}",
        "metadata": {"experiment": {"id": 822, "in_experiment": in_experiment, "name": "exp1"}},
        "multivariate_feature_state_values": [
            {
                "id": mv_id,
                "multivariate_feature_option": {"id": 5, "key": "lanes_v1", "value": LANES},
                "mv_fs_value_uuid": f"00000000-0000-0000-0001-{mv_id:012d}",
                "percentage_allocation": pct,
            }
        ],
    }


def env_doc(trait_segment: bool = False) -> dict[str, Any]:
    segments: list[dict[str, Any]] = [
        {
            "id": 100,
            "name": "experiment-822-rollout",
            "rules": [
                {
                    "type": "ALL",
                    "rules": [],
                    "conditions": [{"operator": "PERCENTAGE_SPLIT", "property_": "$.identity.key", "value": "100.0"}],
                }
            ],
            "feature_states": [routing_state(2, 21, 50, 1, True)],
        }
    ]
    if trait_segment:
        segments.append(
            {
                "id": 101,
                "name": "go-only",
                "rules": [
                    {
                        "type": "ALL",
                        "rules": [],
                        "conditions": [{"operator": "EQUAL", "property_": "language", "value": "go"}],
                    }
                ],
                "feature_states": [routing_state(3, 31, 100, 0, True)],
            }
        )
    return {
        "api_key": "testEnvKey",
        "name": "Test",
        "updated_at": "2026-11-27T00:00:00+00:00",
        "use_identity_composite_key_for_hashing": True,
        "identity_overrides": [],
        "project": {"id": 1, "name": "[redacted]", "segments": segments},
        "feature_states": [
            routing_state(1, 11, 0, None, False),
            {
                "django_id": 4,
                "enabled": False,
                "feature": {"id": 10, "name": "routing_kill", "type": "STANDARD"},
                "feature_segment": None,
                "feature_state_value": None,
                "featurestate_uuid": "00000000-0000-0000-0000-000000000004",
                "multivariate_feature_state_values": [],
            },
        ],
    }


TRAITS: dict[str, Any] = {"repo": "o/r", "language": "c", "created_month": "2026-07", "gold_files": 1, "gold_lines": 3}


def ids(n: int) -> list[str]:
    return [f"swelive:o__r-{i}" for i in range(n)]


def write_run(tmp_path: Path, doc: dict[str, Any], records: list[dict[str, Any]]) -> Path:
    run = tmp_path / "run"
    (run / "env").mkdir(parents=True)
    (run / "env" / "000-start.json").write_text(json.dumps(doc))
    (run / "env" / "001-periodic.json").write_text("not json, never read by default")
    (run / "tasks.jsonl").write_text("".join(json.dumps(r) + "\n" for r in records))
    return run


def record(
    identity: str, variant: str, source: str = "experiment", traits: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {"identity": identity, "variant": variant, "flag_source": source, "attempt": 1, "traits": traits or TRAITS}


def test_hash_matches_engine() -> None:
    for i in range(500):
        object_ids = [str(i), f"key_{i * 7}"]
        assert va.hashed_percentage(object_ids) == get_hashed_percentage_for_object_ids(object_ids)


def test_engine_and_independent_agree_and_split_is_even() -> None:
    doc = env_doc()
    ev = va.EngineEvaluator(doc)
    variants = []
    for ident in ids(400):
        got = ev.evaluate(ident, TRAITS)
        assert got.in_experiment is True
        assert va.independent_variant(doc, ident) == got.variant
        variants.append(got.variant)
    assert set(variants) == {"control", "lanes_v1"}
    assert 160 <= variants.count("lanes_v1") <= 240


def test_outside_the_rollout_segment_the_environment_default_applies() -> None:
    doc = env_doc()
    doc["project"]["segments"][0]["rules"][0]["conditions"][0]["value"] = "0"
    for ident in ids(50):
        assert va.EngineEvaluator(doc).evaluate(ident, TRAITS).in_experiment is False
        assert va.independent_variant(doc, ident) == "control"  # env default allocates 0% to lanes_v1


def test_verify_matches_and_skips_kill_switch(tmp_path: Path) -> None:
    doc = env_doc()
    ev = va.EngineEvaluator(doc)
    recs = [record(i, ev.evaluate(i, TRAITS).variant or "control") for i in ids(30)]
    recs.append(record("swelive:o__r-killed", "control", source="kill_switch"))
    report = va.verify(write_run(tmp_path, doc, recs))
    out = report.to_json()
    assert report.ok and out["matched"] == out["checked"] == 30 and out["match_rate"] == 1.0
    assert out["skipped"] == [{"identity": "swelive:o__r-killed", "flag_source": "kill_switch", "attempt": 1}]
    assert out["recorded_counts"] == out["expected_counts"]
    assert sum(out["expected_counts"].values()) == 30
    assert out["independent_check"]["agree"] == 30
    assert out["flag_engine_version"] and len(out["env_sha256"]) == 64


def test_mismatch_is_reported_and_exits_1(tmp_path: Path) -> None:
    doc = env_doc()
    ev = va.EngineEvaluator(doc)
    first, *rest = ids(10)
    served = ev.evaluate(first, TRAITS).variant
    wrong = "lanes_v1" if served == "control" else "control"
    recs = [record(first, wrong)] + [record(i, ev.evaluate(i, TRAITS).variant or "control") for i in rest]
    run = write_run(tmp_path, doc, recs)
    out_file = tmp_path / "out" / "a.json"
    res = CliRunner().invoke(va.app, ["--run", str(run), "--out", str(out_file)])
    assert res.exit_code == 1
    rep = json.loads(out_file.read_text())
    assert rep["matched"] == 9 and not rep["ok"]
    miss = rep["mismatched"][0]
    assert (miss["identity"], miss["recorded"], miss["expected"]) == (first, wrong, served)


def test_trait_segment_uses_engine_and_flags_independent_as_unsupported(tmp_path: Path) -> None:
    doc = env_doc(trait_segment=True)
    go = TRAITS | {"language": "go"}
    ev = va.EngineEvaluator(doc)
    assert all(ev.evaluate(i, go).variant == "lanes_v1" for i in ids(20))
    with pytest.raises(va.Unsupported):
        va.independent_variant(doc, ids(1)[0])
    report = va.verify(write_run(tmp_path, doc, [record(i, "lanes_v1", traits=go) for i in ids(5)]))
    assert report.ok and report.independent_agree == 0 and len(report.independent_unsupported) == 5


def test_refuses_database_id_hashing() -> None:
    doc = env_doc() | {"use_identity_composite_key_for_hashing": False}
    with pytest.raises(ValueError, match="database ids"):
        va.EngineEvaluator(doc)
