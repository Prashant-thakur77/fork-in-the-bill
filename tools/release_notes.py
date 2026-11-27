"""Write the notes of a GitHub release from numbers.json.

Every figure is looked up in analysis/out/numbers.json and formatted by
`analysis.render_docs.fmt_value`, the same formatter that fills the README, the paper and
the deck, so the notes cannot disagree with them. A key that is absent prints as `n/a`.
The notes also carry the changelog section of the released version, when CHANGELOG.md has
one, and the SHA-256 of every asset as listed in the checksum file.

Usage: python -m tools.release_notes --tag v0.3.0 --checksums dist/SHA256SUMS \
           --repo owner/name > release-notes.md
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

from analysis.render_docs import MISSING, MissingKeyError, fmt_value, load_numbers, lookup

EXPERIMENTS = ("exp1", "exp2")
ARM_ROWS = (
    ("Tasks analysed", "n_analysed", "int"),
    ("Solves", "solves", "int"),
    ("Solve rate", "solve_rate", "prob1"),
    ("Mean cost per task", "cost_mean", "usd4"),
    ("Cost per solved task", "cost_per_solve", "usd4"),
)


def n(numbers: Any, key: str, fmt: str) -> str:
    try:
        return fmt_value(lookup(numbers, key), fmt)
    except MissingKeyError:
        return MISSING


def arm_names(exp: dict[str, Any]) -> list[str]:
    return sorted(exp.get("arms", {}), key=lambda a: (a != "control", a))


def experiment_block(name: str, numbers: Any) -> list[str]:
    exp = numbers[name]
    arms = arm_names(exp)
    lines = [
        f"### Experiment `{name}`",
        "",
        "| | " + " | ".join(f"`{a}`" for a in arms) + " |",
        "|---" * (len(arms) + 1) + "|",
    ]
    for label, field, fmt in ARM_ROWS:
        cells = [n(numbers, f"{name}.arms.{a}.{field}", fmt) for a in arms]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    d = f"{name}.delta"
    lines += [
        "",
        f"Differences, `{n(numbers, d + '.treatment', 'str')}` minus `control`: "
        f"cost per solved task {n(numbers, d + '.cost_per_solve_pct', 'pct1')}, "
        f"mean cost per task {n(numbers, d + '.cost_mean_pct', 'pct1')}, "
        f"solve rate {n(numbers, d + '.solve_rate_pp', 'pp1')} "
        f"(posterior interval {n(numbers, d + '.solve_rate_ci.0', 'pp1')} "
        f"to {n(numbers, d + '.solve_rate_ci.1', 'pp1')}).",
        "",
        f"Posterior probability that the solve-rate drop is within "
        f"m = {n(numbers, name + '.prereg.m', 'prob1')}: "
        f"{n(numbers, d + '.p_solve_drop_within_m', 'prob1')}. "
        f"Flagsmith's chance to beat control on `task_cost`: "
        f"{n(numbers, name + '.flagsmith.chance_to_beat_control_cost', 'prob1')}. "
        f"Decision by the pre-registered rule (tag `{n(numbers, name + '.prereg.tag', 'str')}`): "
        f"ship `{n(numbers, name + '.decision.ship', 'str')}`.",
        "",
    ]
    return lines


def numbers_section(numbers: Any) -> list[str]:
    lines = [
        "## Numbers at this tag",
        "",
        "Every figure here is read from the attached `numbers.json` by `tools/release_notes.py` "
        "and formatted by `analysis/render_docs.py`, the formatter the README and the paper use.",
        "",
    ]
    for name in EXPERIMENTS:
        if isinstance(numbers.get(name), dict) and numbers[name].get("arms"):
            lines += experiment_block(name, numbers)
    if isinstance(numbers.get("rollout"), dict):
        lines += [
            "### Rollout on the same flag",
            "",
            f"{n(numbers, 'rollout.n', 'int')} tasks at a mean cost of "
            f"{n(numbers, 'rollout.cost_mean', 'usd4')} and a solve rate of "
            f"{n(numbers, 'rollout.solve_rate', 'prob1')}.",
            "",
        ]
    if isinstance(numbers.get("integrity"), dict):
        lines += [
            "### Integrity",
            "",
            f"Merkle root over {n(numbers, 'integrity.task_done_records', 'int')} `task_done` records of "
            f"`{n(numbers, 'integrity.experiment', 'str')}`: `{n(numbers, 'integrity.merkle_root', 'str')}`. "
            f"{n(numbers, 'integrity.assignment.matched', 'int')} of "
            f"{n(numbers, 'integrity.assignment.checked', 'int')} recorded arms match Flagsmith's engine "
            f"offline. {n(numbers, 'integrity.env_snapshots', 'int')} environment snapshots, "
            f"{n(numbers, 'integrity.env_snapshot_distinct_hashes', 'int')} distinct.",
            "",
        ]
    lines += [
        f"Total model spend: {n(numbers, 'spend.total_usd', 'usd2')}. "
        f"`numbers.json` was generated at {n(numbers, 'generated_at', 'str')} "
        f"from commit `{n(numbers, 'source_commit', 'hash12')}`.",
        "",
    ]
    return lines


def changelog_section(text: str, version: str) -> str:
    """The body under `## [version]` in a Keep a Changelog file, or an empty string."""
    match = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|^\[[^\]]+\]: |\Z)", text, re.S | re.M)
    return match.group(1).strip() if match else ""


def parse_checksums(text: str) -> list[tuple[str, str]]:
    """(file name, digest) pairs from `sha256sum` output."""
    rows: list[tuple[str, str]] = []
    for line in text.splitlines():
        digest, _, name = line.strip().partition(" ")
        if digest and name:
            rows.append((name.strip().lstrip("*"), digest))
    return rows


def build(tag: str, numbers: Any, checksums: list[tuple[str, str]], changes: str, repo: str) -> str:
    lines = numbers_section(numbers)
    if changes:
        lines += ["## Changes", "", changes, ""]
    if checksums:
        lines += ["## Assets", "", "| File | SHA-256 |", "|---|---|"]
        lines += [f"| `{name}` | `{digest}` |" for name, digest in checksums]
        lines += [
            "",
            "`SHA256SUMS` lists the same digests. Each asset also has a build provenance "
            "attestation signed by the release workflow. With the assets downloaded into one directory:",
            "",
            "```sh",
            "sha256sum -c SHA256SUMS",
        ]
        lines += [f"gh attestation verify {name} --repo {repo}" for name, _ in checksums]
        lines += ["```", ""]
    lines += [
        "## Check it yourself",
        "",
        "```sh",
        f"git clone --branch {tag} https://github.com/{repo}",
        f"cd {repo.rpartition('/')[2]}",
        "uv sync --locked",
        "make verify      # hash chains, Merkle roots, every arm recomputed with Flagsmith's engine",
        "make analyse     # numbers.json rebuilt from the committed run logs, then the consistency gate",
        "```",
        "",
        "`docs/reproduce.md` has the expected output of each command.",
    ]
    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--tag", required=True, help="release tag, for example v0.3.0")
    parser.add_argument("--numbers", type=Path, default=Path("analysis/out/numbers.json"))
    parser.add_argument("--checksums", type=Path, help="sha256sum output listing the assets")
    parser.add_argument("--changelog", type=Path, default=Path("CHANGELOG.md"))
    parser.add_argument("--repo", default="Prashant-thakur77/fork-in-the-bill", help="owner/name on GitHub")
    args = parser.parse_args(argv)

    numbers = load_numbers(args.numbers)
    checksums = parse_checksums(args.checksums.read_text(encoding="utf-8")) if args.checksums else []
    changes = ""
    if args.changelog.exists():
        changes = changelog_section(args.changelog.read_text(encoding="utf-8"), args.tag.removeprefix("v"))
    sys.stdout.write(build(args.tag, numbers, checksums, changes, args.repo))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
