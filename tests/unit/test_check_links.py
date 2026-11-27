from __future__ import annotations

from pathlib import Path

import pytest

from tools.check_links import anchors, link_targets, main, slug


def test_slug_matches_the_anchors_github_gives_this_repository_headings() -> None:
    assert slug("Experiment `exp1`: `lanes_v1` against `control`") == "experiment-exp1-lanes_v1-against-control"
    assert slug("Power, and what was chosen after seeing data") == "power-and-what-was-chosen-after-seeing-data"
    assert slug("D28. Environment snapshots keep the client-side environment key") == (
        "d28-environment-snapshots-keep-the-client-side-environment-key"
    )
    assert slug("By tier (secondary, not part of the decision)") == "by-tier-secondary-not-part-of-the-decision"
    assert slug("See [the paper](docs/paper.md) <!--note-->") == "see-the-paper"


def test_anchors_number_duplicates_and_ignore_headings_in_code() -> None:
    text = '# Setup\n\n## Setup\n\n```sh\n# not a heading\n```\n\n<a id="Custom"></a>\n'
    assert anchors(text) == {"setup", "setup-1", "custom"}


def test_link_targets_skip_code_and_read_every_link_form() -> None:
    text = (
        '[a](one.md) and ![img](two.png "title") and `[code](skipped.md)`\n'
        "```\n[fenced](skipped-too.md)\n```\n"
        "[ref]: three.md\n"
        '<img src="four.png"> [b](<five six.md>)\n'
    )
    assert link_targets(text) == [(1, "one.md"), (1, "two.png"), (5, "three.md"), (6, "five six.md"), (6, "four.png")]


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "guide.md").write_text("# Guide\n\n## First step\n\n[up](../README.md#results)\n")
    (tmp_path / "docs" / "chart.png").write_bytes(b"png")
    (tmp_path / "README.md").write_text(
        "# Title\n\n## Results\n\n"
        "[guide](docs/guide.md#first-step) [same file](#results) ![c](docs/chart.png)\n"
        "[site](https://example.test/missing) [phone](tel:0000) [root](/docs/guide.md)\n"
    )
    return tmp_path


def test_a_tree_with_only_good_links_passes(repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--root", str(repo)]) == 0
    assert "5 relative links in 2 files resolve" in capsys.readouterr().out


def test_missing_files_and_missing_anchors_fail_with_file_and_line(
    repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    readme = repo / "README.md"
    readme.write_text(readme.read_text() + "[gone](docs/nope.md)\n[bad anchor](docs/guide.md#second-step)\n")
    assert main(["--root", str(repo)]) == 1
    captured = capsys.readouterr()
    assert "README.md:7: docs/nope.md: no such file" in captured.err
    assert "README.md:8: docs/guide.md#second-step: no heading with that anchor in guide.md" in captured.err
    assert "2 broken of 7 relative links in 2 files" in captured.out
