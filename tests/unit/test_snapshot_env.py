from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from integrity import snapshot_env
from integrity.verify_ledger import verify


def doc() -> dict[str, Any]:
    return {
        "api_key": "public-client-key",
        "updated_at": "2026-11-27T00:00:00Z",
        "project": {"id": 1, "name": "secret project", "organisation": {"id": 2, "name": "someone"}, "segments": []},
        "feature_states": [
            {
                "enabled": True,
                "feature": {"id": 9, "name": "agent_routing", "type": "MULTIVARIATE"},
                "feature_state_value": '{"policy":"control"}',
                "metadata": {"experiment": {"id": 822, "name": "exp1"}},
                "multivariate_feature_state_values": [
                    {"multivariate_feature_option": {"id": 5, "key": "lanes_v1"}, "percentage_allocation": 50}
                ],
            },
            {"enabled": False, "feature": {"id": 10, "name": "unrelated"}, "feature_state_value": None},
        ],
    }


def test_redact_and_summary() -> None:
    d = snapshot_env.redact(doc())
    assert d["project"]["name"] == "[redacted]" and d["project"]["organisation"]["name"] == "[redacted]"
    s = snapshot_env.flag_summary(d)
    assert list(s) == ["agent_routing"]
    assert s["agent_routing"]["variants"] == [("lanes_v1", 50)]
    assert s["agent_routing"]["experiment"] == {"id": 822, "name": "exp1"}


def test_snapshot_appends_to_ledger(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(snapshot_env, "fetch_document", lambda bin_="flagsmith": doc())
    a = snapshot_env.snapshot(tmp_path, "start")
    b = snapshot_env.snapshot(tmp_path, "end")
    assert a["sha256"] == b["sha256"]
    assert sorted(p.name for p in (tmp_path / "env").iterdir()) == ["000-start.json", "001-end.json"]
    saved = json.loads((tmp_path / "env" / "000-start.json").read_text())
    assert "someone" not in json.dumps(saved)
    verify(tmp_path / "ledger.jsonl")


def test_flagsmith_error_is_shown(monkeypatch: pytest.MonkeyPatch) -> None:
    class P:
        returncode = 1
        stdout = ""
        stderr = "Error: 401 Unauthorized"

    monkeypatch.setattr(snapshot_env.subprocess, "run", lambda *a, **k: P())
    with pytest.raises(snapshot_env.FlagsmithError, match="401 Unauthorized"):
        snapshot_env.fetch_document()
