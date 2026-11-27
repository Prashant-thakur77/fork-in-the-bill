"""Check that relative links in Markdown files point at something that exists.

For every `[text](target)`, `![alt](target)`, `[ref]: target` and `href`/`src` attribute
outside code, a target without a URL scheme must be a file or directory in the repository.
If the target is a Markdown file and the link has a `#fragment`, the fragment must be the
anchor GitHub gives one of that file's headings (or an explicit `id`/`name` attribute).
Links to other sites are not fetched, so the check needs no network.

Usage: python tools/check_links.py [PATH ...]     (default: README.md docs)
A directory is searched for *.md files. Exits 1 if any link is broken.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import unquote

DEFAULT_PATHS = ("README.md", "docs")
SKIP_DIRS = {"node_modules", ".venv", ".git"}

FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
CODE_SPAN_RE = re.compile(r"`+[^`\n]*`+")
INLINE_RE = re.compile(r"\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)")
REFERENCE_RE = re.compile(r"^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)")
ATTR_RE = re.compile(r"""\b(?:href|src)\s*=\s*["']([^"'\n]+)["']""", re.I)
SCHEME_RE = re.compile(r"^(?:[a-z][a-z0-9+.\-]*:|//)", re.I)
HEADING_RE = re.compile(r"^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$")
ID_RE = re.compile(r"""\b(?:id|name)\s*=\s*["']([^"'\s]+)["']""", re.I)


def lines_outside_fences(text: str) -> list[tuple[int, str]]:
    """(line number, line) for every line that is not inside a fenced code block."""
    out: list[tuple[int, str]] = []
    fence: str | None = None
    for number, line in enumerate(text.split("\n"), start=1):
        match = FENCE_RE.match(line)
        if fence is None and match:
            fence = match.group(1)
        elif fence is not None and match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence):
            fence = None
        elif fence is None:
            out.append((number, line))
    return out


def slug(heading: str) -> str:
    """The anchor GitHub derives from a heading's text, before duplicate numbering."""
    text = re.sub(r"<!--.*?-->", "", heading)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = text.replace("`", "").strip().lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def anchors(text: str) -> set[str]:
    found: set[str] = set()
    seen: dict[str, int] = {}
    for _, line in lines_outside_fences(text):
        found.update(m.group(1).lower() for m in ID_RE.finditer(line))
        match = HEADING_RE.match(line)
        if not match:
            continue
        base = slug(match.group(1))
        count = seen.get(base, 0)
        seen[base] = count + 1
        found.add(base if count == 0 else f"{base}-{count}")
    return found


def link_targets(text: str) -> list[tuple[int, str]]:
    """(line number, target) for every link outside fenced code and code spans."""
    found: list[tuple[int, str]] = []
    for number, line in lines_outside_fences(text):
        reference = REFERENCE_RE.match(line)
        line = CODE_SPAN_RE.sub("", line)
        targets = [m.group(1) for m in INLINE_RE.finditer(line)] + [m.group(1) for m in ATTR_RE.finditer(line)]
        if reference:
            targets.append(reference.group(1))
        found.extend((number, t.strip("<>")) for t in targets)
    return found


def check_file(path: Path, root: Path, cache: dict[Path, set[str]]) -> tuple[int, list[str]]:
    """Return the number of relative links checked in one file and a message per broken one."""
    problems: list[str] = []
    checked = 0
    text = path.read_text(encoding="utf-8")
    for number, target in link_targets(text):
        if not target or SCHEME_RE.match(target):
            continue
        checked += 1
        raw_path, _, fragment = target.partition("#")
        raw_path = unquote(raw_path.partition("?")[0])
        if not raw_path:
            dest = path
        elif raw_path.startswith("/"):
            dest = root / raw_path.lstrip("/")
        else:
            dest = path.parent / raw_path
        where = f"{path.relative_to(root)}:{number}"
        if not dest.exists():
            problems.append(f"{where}: {target}: no such file")
            continue
        if fragment and dest.is_file() and dest.suffix.lower() == ".md":
            resolved = dest.resolve()
            if resolved not in cache:
                cache[resolved] = anchors(dest.read_text(encoding="utf-8"))
            if unquote(fragment).lower() not in cache[resolved]:
                problems.append(f"{where}: {target}: no heading with that anchor in {dest.name}")
    return checked, problems


def markdown_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            files += sorted(p for p in path.rglob("*.md") if not SKIP_DIRS.intersection(p.parts))
        else:
            files.append(path)
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("paths", nargs="*", type=Path, help="Markdown files or directories (default: README.md docs)")
    parser.add_argument("--root", type=Path, default=Path("."), help="repository root, for links that start with /")
    args = parser.parse_args(argv)

    root = args.root.resolve()
    files = markdown_files([root / p for p in (args.paths or [Path(p) for p in DEFAULT_PATHS])])
    missing = [f for f in files if not f.exists()]
    for f in missing:
        print(f"{f}: no such file", file=sys.stderr)
    cache: dict[Path, set[str]] = {}
    total = 0
    problems: list[str] = []
    for f in files:
        if f.exists():
            checked, found = check_file(f.resolve(), root, cache)
            total += checked
            problems += found
    for line in problems:
        print(line, file=sys.stderr)
    if problems or missing:
        print(f"{len(problems) + len(missing)} broken of {total} relative links in {len(files)} files")
        return 1
    print(f"{total} relative links in {len(files)} files resolve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
