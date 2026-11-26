from __future__ import annotations

import json
from pathlib import Path

from runner.worker import validation_status


def write(path: Path, entries: dict[str, dict[str, object]]) -> Path:
    path.write_text(json.dumps(entries))
    return path


def test_validation_status_merges_reports(tmp_path: Path) -> None:
    a = write(
        tmp_path / "a.json",
        {
            "t1": {"valid": True, "validated_at": "2026-11-27T01:00:00Z"},
            "t2": {"valid": False, "reason": "gold:p2p_broken:1fail/0missing", "validated_at": "2026-11-27T01:00:00Z"},
            "t3": {"valid": False, "reason": "f2p_pass_before_gold:1", "validated_at": "2026-11-27T01:00:00Z"},
            "other": {"valid": True, "validated_at": "2026-11-27T01:00:00Z"},
        },
    )
    b = write(
        tmp_path / "b.json",
        {
            "t2": {"valid": True, "validated_at": "2026-11-27T02:00:00Z"},
            "t1": {"valid": False, "reason": "instance_timeout:3600s", "validated_at": "2026-11-26T00:00:00Z"},
        },
    )
    valid, decided = validation_status([a, b, tmp_path / "missing.json"], {"t1", "t2", "t3", "t4"})
    assert valid == {"t1", "t2", "t3"}  # newest verdict wins; a non-blocking reason is still valid
    assert decided == {"t1", "t2", "t3"}
