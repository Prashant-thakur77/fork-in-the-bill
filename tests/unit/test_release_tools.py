from __future__ import annotations

from typing import Any

from analysis.render_docs import fmt_value
from tools.compare_numbers import compare, flatten
from tools.release_notes import build, changelog_section, parse_checksums

NUMBERS: dict[str, Any] = {
    "generated_at": "2026-11-27T00:00:00+00:00",
    "source_commit": "0123456789abcdef0123456789abcdef01234567",
    "exp1": {
        "arms": {
            "lanes_v1": {
                "n_analysed": 69,
                "solves": 28,
                "solve_rate": 0.4058,
                "cost_mean": 0.034,
                "cost_per_solve": 0.0837,
            },
            "control": {
                "n_analysed": 76,
                "solves": 34,
                "solve_rate": 0.4474,
                "cost_mean": 0.0784,
                "cost_per_solve": 0.1753,
            },
        },
        "delta": {
            "treatment": "lanes_v1",
            "cost_per_solve_pct": -52.22,
            "cost_mean_pct": -56.66,
            "solve_rate_pp": -4.157,
            "solve_rate_ci": [-19.77, 11.84],
            "p_solve_drop_within_m": 0.9767,
        },
        "prereg": {"m": 0.2, "tag": "prereg-exp1"},
        "decision": {"ship": "lanes_v1"},
    },
    "spend": {"total_usd": 11.8675},
}


def test_flatten_uses_marker_key_form() -> None:
    flat = flatten({"a": {"b": [1, {"c": 2}]}, "d": []})
    assert flat == {"a.b.0": 1, "a.b.1.c": 2, "d": []}


def test_compare_ignores_the_two_volatile_fields_and_float_noise() -> None:
    new = {**NUMBERS, "generated_at": "later", "source_commit": "f" * 40, "spend": {"total_usd": 11.8675 * (1 + 1e-13)}}
    count, problems = compare(NUMBERS, new)
    assert problems == []
    assert count == len(flatten(NUMBERS)) - 2


def test_compare_reports_changed_missing_and_retyped_values() -> None:
    new = {"exp1": {**NUMBERS["exp1"], "decision": {"ship": "control"}}, "spend": {"total_usd": "11.8675"}, "extra": 1}
    new["exp1"]["prereg"] = {"m": 0.2}
    _, problems = compare(NUMBERS, new)
    text = "\n".join(problems)
    assert "exp1.decision.ship: committed 'lanes_v1', re-derived 'control'" in text
    assert "exp1.prereg.tag: only in the committed file" in text
    assert "extra: only in the re-derived file" in text
    assert "spend.total_usd" in text


def test_changelog_section_stops_at_the_next_version_and_at_link_references() -> None:
    text = (
        "# Changelog\n\n## [Unreleased]\n\n- new\n\n## [0.2.0] - 2026-11-27\n\n### Added\n\n- thing\n\n"
        "## [0.1.0]\n\n- first\n\n[0.1.0]: https://example.test\n"
    )
    assert changelog_section(text, "0.2.0") == "### Added\n\n- thing"
    assert changelog_section(text, "0.1.0") == "- first"
    assert changelog_section(text, "9.9.9") == ""


def test_parse_checksums_reads_text_and_binary_mode_lines() -> None:
    rows = parse_checksums("aa11  numbers.json\nbb22 *run-data-parquet.zip\n\n")
    assert rows == [("numbers.json", "aa11"), ("run-data-parquet.zip", "bb22")]


def test_notes_take_every_figure_from_the_project_formatter() -> None:
    notes = build("v9.9.9", NUMBERS, [("numbers.json", "aa11")], "### Added\n\n- thing", "owner/name")
    arms = NUMBERS["exp1"]["arms"]
    assert "| | `control` | `lanes_v1` |" in notes
    for arm in ("control", "lanes_v1"):
        assert fmt_value(arms[arm]["cost_per_solve"], "usd4") in notes
        assert fmt_value(arms[arm]["solve_rate"], "prob1") in notes
    assert f"cost per solved task {fmt_value(-52.22, 'pct1')}" in notes
    assert f"Total model spend: {fmt_value(11.8675, 'usd2')}" in notes
    assert "from commit `0123456789ab`" in notes
    assert "## Changes\n\n### Added\n\n- thing" in notes
    assert "| `numbers.json` | `aa11` |" in notes
    assert "gh attestation verify numbers.json --repo owner/name" in notes
    assert "git clone --branch v9.9.9 https://github.com/owner/name\ncd name" in notes


def test_notes_print_missing_keys_as_not_available_and_skip_absent_sections() -> None:
    notes = build("v9.9.9", {"spend": {}}, [], "", "owner/name")
    assert "Total model spend: n/a" in notes
    assert "### Experiment" not in notes
    assert "## Assets" not in notes
    assert "## Changes" not in notes
