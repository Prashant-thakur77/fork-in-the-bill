"""Compare a re-derived numbers.json with the committed one.

`make analyse` rewrites analysis/out/numbers.json from the run logs. Two fields change on
every run (`generated_at` and `source_commit`); every other value should come out the same.
This script reads the committed file from git, reads the file in the working tree, and
compares them leaf by leaf. Floats are compared with a relative tolerance so that a different
CPU or thread count, which can change the last bits of a sum, does not count as a difference.

Usage: python -m tools.compare_numbers [--ref HEAD] [--path analysis/out/numbers.json]
Exits 0 when every value matches, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

VOLATILE = ("generated_at", "source_commit")


def flatten(node: Any, prefix: str = "") -> dict[str, Any]:
    """Map every leaf to its dotted key, the same key form the number markers use."""
    if isinstance(node, dict):
        items = [(str(k), v) for k, v in node.items()]
    elif isinstance(node, list):
        items = [(str(i), v) for i, v in enumerate(node)]
    else:
        return {prefix: node}
    out: dict[str, Any] = {}
    for key, value in items:
        out.update(flatten(value, f"{prefix}.{key}" if prefix else key))
    if not items:
        out[prefix] = node
    return out


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def compare(old: Any, new: Any, rel_tol: float = 1e-9, ignore: tuple[str, ...] = VOLATILE) -> tuple[int, list[str]]:
    """Return the number of leaves compared and one line per difference."""
    a = {k: v for k, v in flatten(old).items() if k not in ignore}
    b = {k: v for k, v in flatten(new).items() if k not in ignore}
    problems = [f"{k}: only in the committed file" for k in sorted(a.keys() - b.keys())]
    problems += [f"{k}: only in the re-derived file" for k in sorted(b.keys() - a.keys())]
    shared = sorted(a.keys() & b.keys())
    for key in shared:
        x, y = a[key], b[key]
        if _is_number(x) and _is_number(y):
            same = math.isclose(x, y, rel_tol=rel_tol, abs_tol=1e-12)
        else:
            same = type(x) is type(y) and x == y
        if not same:
            problems.append(f"{key}: committed {x!r}, re-derived {y!r}")
    return len(shared), problems


def committed(ref: str, path: str) -> Any:
    shown = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True, check=False)
    if shown.returncode != 0:
        raise SystemExit(f"cannot read {path} at {ref}: {shown.stderr.strip()}")
    return json.loads(shown.stdout)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--ref", default="HEAD", help="git revision holding the committed file")
    parser.add_argument("--path", default="analysis/out/numbers.json", help="path relative to the repository root")
    parser.add_argument("--rel-tol", type=float, default=1e-9, help="relative tolerance for floats")
    args = parser.parse_args(argv)

    old = committed(args.ref, args.path)
    new = json.loads(Path(args.path).read_text(encoding="utf-8"))
    count, problems = compare(old, new, args.rel_tol)
    for line in problems:
        print(line, file=sys.stderr)
    ignored = ", ".join(VOLATILE)
    if problems:
        print(f"{len(problems)} of {count} values differ from {args.ref} (ignored: {ignored})")
        return 1
    print(f"{count} values match {args.ref} (ignored: {ignored})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
