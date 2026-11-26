"""End-to-end readout on the synthetic fixtures: numbers.json shape, determinism, SRM, docs."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest

from analysis.analyse import build_numbers
from analysis.check_consistency import check
from analysis.pull_results import extract_summary
from analysis.render_docs import bare_numbers, fmt_value, process, render_markdown

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "analysis"

ARM_KEYS = {
    "n_exposed",
    "n_excluded",
    "n_analysed",
    "cost_mean",
    "cost_mean_ci",
    "cost_median",
    "solve_rate",
    "solve_rate_ci",
    "solves",
    "cost_per_solve",
    "cost_per_solve_ci",
    "delegate_share_cost",
    "delegate_share_tokens",
    "turns_mean",
    "seconds_mean",
}
DELTA_KEYS = {
    "cost_mean",
    "cost_mean_pct",
    "cost_mean_ci",
    "solve_rate_pp",
    "solve_rate_ci",
    "p_solve_drop_within_m",
    "cost_per_solve_pct",
}


def _run(name: str, tmp: Path) -> tuple[Path, dict[str, Any]]:
    root = tmp / name
    shutil.copytree(FIXTURES / name, root)
    numbers = build_numbers(
        runs=root / "runs",
        out=root / "analysis" / "out",
        m=None,
        flagsmith_dir=root / "analysis" / "flagsmith",
        prereg_dir=root / "prereg",
        root=root,
    )
    (root / "analysis" / "out" / "numbers.json").write_text(json.dumps(numbers, indent=2))
    return root, numbers


@pytest.fixture(scope="module")
def balanced(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, dict[str, Any]]:
    return _run("balanced", tmp_path_factory.mktemp("bal"))


def test_numbers_shape(balanced: tuple[Path, dict[str, Any]]) -> None:
    _, n = balanced
    for key in ("generated_at", "source_commit", "spend", "pilot", "exp1", "integrity"):
        assert key in n
    exp = n["exp1"]
    for key in ("prereg", "arms", "delta", "srm", "flagsmith", "agreement", "decision", "power", "cuped", "by_trait"):
        assert key in exp
    assert set(exp["arms"]) == {"control", "lanes_v1"}
    for arm in exp["arms"].values():
        assert set(arm) >= ARM_KEYS
        assert arm["n_exposed"] == arm["n_excluded"] + arm["n_analysed"]
    assert set(exp["delta"]) >= DELTA_KEYS
    assert set(exp["by_trait"]) == {"difficulty", "language", "created_month"}
    assert set(exp["decision"]["rule_met"]) == {"flagsmith_95", "guardrail_90", "no_guardrail_loss"}
    assert exp["prereg"]["m"] == 0.05
    assert set(n["integrity"]) >= {"merkle_root", "task_done_records", "env_snapshots", "env_snapshot_distinct_hashes"}


def test_fixture_effects_recovered(balanced: tuple[Path, dict[str, Any]]) -> None:
    exp = balanced[1]["exp1"]
    assert exp["delta"]["cost_mean"] < 0
    assert exp["delta"]["cost_mean_ci"][1] < 0
    assert exp["arms"]["control"]["n_excluded"] >= 1
    assert exp["srm"]["flag"] is False
    assert exp["flagsmith"]["chance_to_beat_control_cost"] == pytest.approx(0.991)
    assert exp["cuped"]["variance_reduction_pct"] > 0
    ship = exp["decision"]["ship"]
    assert (ship == "lanes_v1") == all(exp["decision"]["rule_met"].values())


def test_readout_is_deterministic(tmp_path: Path, balanced: tuple[Path, dict[str, Any]]) -> None:
    _, again = _run("balanced", tmp_path)
    first = dict(balanced[1])
    for d in (first, again):
        d.pop("generated_at")
    assert json.dumps(first, sort_keys=True) == json.dumps(again, sort_keys=True)


def test_srm_fixture_flagged(tmp_path: Path) -> None:
    _, n = _run("srm", tmp_path)
    assert n["exp1"]["srm"]["flag"] is True
    assert n["exp1"]["srm"]["p"] < 0.001
    assert n["exp1"]["cuped"]["variance_reduction_pct"] is None  # no pilot in this fixture


def test_formats() -> None:
    assert fmt_value(1.234, "usd2") == "$1.23"
    assert fmt_value(-0.24097, "usd4") == "-$0.2410"
    assert fmt_value(-28.62, "pct1") == "-28.6%"
    assert fmt_value(-0.79, "pp1") == "-0.8 pp"
    assert fmt_value(1234, "int") == "1,234"
    assert fmt_value(0.12345, "f3") == "0.123"
    assert fmt_value(0.7479, "prob1") == "74.8%"
    assert fmt_value("abcdef0123456789", "hash12") == "abcdef012345"
    assert fmt_value(None, "usd2") == "n/a"


def test_marker_rendering() -> None:
    nums = {"exp1": {"arms": {"control": {"cost_mean": 1.234}}, "delta": {"ci": [-1.0, 2.0]}}}
    text = "a <!--n:exp1.arms.control.cost_mean:usd2-->$0.00<!--/n--> <!--n:exp1.delta.ci.1:f3-->x<!--/n-->"
    new, count, problems = render_markdown(text, nums, "t.md")
    assert count == 2
    assert "<!--n:exp1.arms.control.cost_mean:usd2-->$1.23<!--/n-->" in new
    assert "<!--n:exp1.delta.ci.1:f3-->2.000<!--/n-->" in new
    assert {p.kind for p in problems} == {"stale"}
    _, _, problems = render_markdown(new, nums, "t.md")
    assert problems == []
    _, _, problems = render_markdown("<!--n:exp1.nope:usd2-->$1<!--/n-->", nums, "t.md")
    assert [p.kind for p in problems] == ["missing_key"]


def test_bare_numbers_detection() -> None:
    text = (
        "Intro 42 is outside.\n<!--results:start-->\n"
        "Cost <!--n:a:usd2-->$1.00<!--/n--> for `exp1` and lanes_v1 at <!--lit-->95%<!--/lit-->.\n"
        "1. listed\nBut 3.5% slipped in and $2 too.\n<!--results:end-->\n"
    )
    assert bare_numbers(text) == ["3.5%", "$2"]


def _docs_root(balanced: tuple[Path, dict[str, Any]], tmp_path: Path) -> tuple[Path, dict[str, Any]]:
    src, numbers = balanced
    root = tmp_path / "docs"
    (root / "analysis" / "out").mkdir(parents=True)
    shutil.copy(src / "analysis" / "out" / "numbers.json", root / "analysis" / "out" / "numbers.json")
    (root / "README.md").write_text(
        "# Fixture README\n\n<!--results:start-->\n"
        "Mean cost per task fell by <!--n:exp1.delta.cost_mean_pct:pct1-->?<!--/n--> "
        "(control <!--n:exp1.arms.control.cost_mean:usd2-->?<!--/n-->).\n"
        "Merkle root <!--n:integrity.merkle_root:hash12-->?<!--/n-->.\n"
        "<!--results:end-->\n"
    )
    seed = root / "board" / "web" / "src"
    seed.mkdir(parents=True)
    (seed / "seed.json").write_text(
        json.dumps(
            {
                "headline": [
                    {"key": "exp1.delta.cost_mean_pct", "fmt": "pct1", "text": ""},
                    {
                        "key": "exp1.arms.lanes_v1.solve_rate",  # gitleaks:allow
                        "fmt": "prob1",
                        "text": "",
                        "template": "solve rate {value}",
                    },
                ]
            }
        )
    )
    process(root, numbers, write=True, regenerate=True)
    return root, numbers


def test_render_then_check_passes(balanced: tuple[Path, dict[str, Any]], tmp_path: Path) -> None:
    root, numbers = _docs_root(balanced, tmp_path)
    readme = (root / "README.md").read_text()
    assert fmt_value(numbers["exp1"]["delta"]["cost_mean_pct"], "pct1") in readme
    seed = json.loads((root / "board" / "web" / "src" / "seed.json").read_text())
    assert seed["headline"][1]["text"].startswith("solve rate ")
    assert (root / "analysis" / "results.md").exists()
    problems, skipped = check(root, root / "analysis" / "out" / "numbers.json")
    assert problems == [], [str(p) for p in problems]
    assert skipped == ["video/captions.json"]


def test_check_fails_on_tampered_readme(balanced: tuple[Path, dict[str, Any]], tmp_path: Path) -> None:
    root, numbers = _docs_root(balanced, tmp_path)
    readme = root / "README.md"
    good = fmt_value(numbers["exp1"]["arms"]["control"]["cost_mean"], "usd2")
    readme.write_text(readme.read_text().replace(f"-->{good}<!--", "-->$9.99<!--"))
    problems, _ = check(root, root / "analysis" / "out" / "numbers.json")
    assert [p.kind for p in problems] == ["stale"]
    assert problems[0].file == "README.md"


def test_check_fails_on_bare_number_and_tampered_seed(balanced: tuple[Path, dict[str, Any]], tmp_path: Path) -> None:
    root, _ = _docs_root(balanced, tmp_path)
    readme = root / "README.md"
    readme.write_text(readme.read_text().replace("Merkle root", "Saved 31.5% overall. Merkle root"))
    seed_path = root / "board" / "web" / "src" / "seed.json"
    seed = json.loads(seed_path.read_text())
    seed["headline"][0]["text"] = "-99.0%"
    seed_path.write_text(json.dumps(seed))
    problems, _ = check(root, root / "analysis" / "out" / "numbers.json")
    kinds = sorted((p.file, p.kind) for p in problems)
    assert kinds == [("README.md", "bare_number"), ("board/web/src/seed.json", "stale")]


def test_extract_summary_handles_unknown_shapes() -> None:
    s = extract_summary({"unexpected": [1, 2, {"nothing": "here"}]})
    assert s.chance_to_beat_control_cost is None
    assert s.solve_rate_status == "unknown"
    s = extract_summary({"results": {"task_cost": {}}, "metric_name": "x"})
    assert s.cost_mean_by_variant == {}
