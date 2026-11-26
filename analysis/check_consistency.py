"""Fail if any figure in the docs, board seed or captions differs from numbers.json.

Re-renders every marker without writing, then exits 1 on a stale marker, a missing key, a
bad format, or a bare number inside a `<!--results:start-->`/`<!--results:end-->` section.
Missing target files are skipped with a notice. Without numbers.json, any marker fails.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from analysis.render_docs import Problem, load_numbers, process


def check(root: Path, numbers_path: Path) -> tuple[list[Problem], list[str]]:
    # Before any run there is no numbers.json; checking against an empty one still fails on
    # any marker or bare results figure, so the gate passes only when nothing cites a number.
    nums = load_numbers(numbers_path) if numbers_path.exists() else {}
    problems: list[Problem] = []
    skipped: list[str] = []
    for res in process(root, nums, write=False, regenerate=False):
        if res.skipped:
            skipped.append(res.path)
        problems.extend(res.problems)
    return problems, skipped


app = typer.Typer(add_completion=False)


@app.command()
def main(
    root: Annotated[Path, typer.Option(help="repository root")] = Path("."),
    numbers: Annotated[Path, typer.Option()] = Path("analysis/out/numbers.json"),
) -> None:
    path = numbers if numbers.is_absolute() else root / numbers
    if not path.exists():
        typer.echo(f"notice: {path} not found; checking that no document cites a number")
    problems, skipped = check(root, path)
    for s in skipped:
        typer.echo(f"notice: {s} not found, skipped")
    for p in problems:
        typer.echo(str(p), err=True)
    typer.echo("consistent" if not problems else f"{len(problems)} problem(s)")
    raise typer.Exit(1 if problems else 0)


if __name__ == "__main__":
    app()
