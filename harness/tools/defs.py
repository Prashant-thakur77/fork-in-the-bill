"""Tool schemas and handlers. Both arms get exactly these definitions, in this order."""

from __future__ import annotations

import posixpath
import shlex

from harness.tools.sandbox import Sandbox, truncate_middle

OUTPUT_LIMIT_BYTES = 16_000  # delegate lane
MAIN_OUTPUT_LIMIT_BYTES = 2_000  # main lane: long output is the delegate's job
DEFAULT_TIMEOUT = 180
MAX_TIMEOUT = 900

BASH = {
    "name": "bash",
    "description": (
        "Run a shell command in the repository container (cwd is the repository root). "
        "Output is truncated to the first and last 8 KB. Non-interactive only."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "cmd": {"type": "string", "description": "Command to run with bash -lc."},
            "timeout": {"type": "integer", "description": "Seconds, default 180, max 900."},
        },
        "required": ["cmd"],
        "additionalProperties": False,
    },
}

BASH_MAIN = {
    "name": "bash",
    "description": (
        "Run a shell command in the repository container (cwd is the repository root). "
        "Output is cut to the first and last 1 KB, so use it for short, targeted checks; "
        "hand long reads, searches and test runs to `delegate`. Non-interactive only."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "cmd": {"type": "string", "description": "Command to run with bash -lc."},
            "timeout": {"type": "integer", "description": "Seconds, default 180, max 900."},
        },
        "required": ["cmd"],
        "additionalProperties": False,
    },
}

VIEW_FILE = {
    "name": "view_file",
    "description": (
        "Show lines of one file with line numbers, at most 150 lines per call. Use it to read the code "
        "you are about to change. To find code, search or run anything, use `delegate`."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "start_line": {"type": "integer", "description": "1-based, default 1"},
            "end_line": {"type": "integer", "description": "inclusive; at most start_line + 149"},
        },
        "required": ["path"],
        "additionalProperties": False,
    },
}

VIEW_MAX_LINES = 150

EDIT_FILE = {
    "name": "edit_file",
    "description": (
        "Replace an exact substring in a file. `old` must occur exactly once. "
        "Use old='' with a path that does not exist to create a new file with `new` as its content."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "old": {"type": "string"},
            "new": {"type": "string"},
        },
        "required": ["path", "old", "new"],
        "additionalProperties": False,
    },
}

DELEGATE = {
    "name": "delegate",
    "description": (
        "Hand a self-contained chunk of grunt work to an assistant that has its own shell in the same "
        "container: exploring the codebase, locating definitions and call sites, reading long files, "
        "running tests or builds and summarising the failures. It cannot see this conversation, so the "
        "instruction must say everything it needs. Returns JSON {summary, findings[], confidence}."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "instruction": {"type": "string"},
            "paths": {"type": "array", "items": {"type": "string"}, "description": "Files to preload, may be empty."},
            "max_output_tokens": {
                "type": "integer",
                "description": "Upper bound for its reply, at most the lane limit.",
            },
        },
        "required": ["instruction", "paths"],
        "additionalProperties": False,
    },
}

SUBMIT = {
    "name": "submit",
    "description": "Finish the task. The current state of the repository is graded by the hidden tests.",
    "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
}

MAIN_TOOLS = [VIEW_FILE, EDIT_FILE, DELEGATE, SUBMIT]
DELEGATE_TOOLS_READONLY = [BASH]
DELEGATE_TOOLS_DRAFT = [BASH, EDIT_FILE]


class ToolInputError(ValueError):
    """The model sent arguments that do not fit the tool's schema; reported back as a tool error."""


def as_int(value: object, name: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ToolInputError(f"{name} must be an integer, got {value!r}")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    raise ToolInputError(f"{name} must be an integer, got {str(value)[:80]!r}")


def _resolve(workdir: str, path: str) -> str:
    return path if path.startswith("/") else posixpath.join(workdir, path)


async def run_bash(sb: Sandbox, cmd: str, timeout: object, limit: int = OUTPUT_LIMIT_BYTES) -> tuple[str, bool]:
    t = min(max(as_int(timeout, "timeout") or DEFAULT_TIMEOUT, 1), MAX_TIMEOUT)
    res = await sb.exec(f"cd {shlex.quote(sb.workdir)} && {cmd}", timeout=t)
    body = truncate_middle(res.output, limit)
    status = "timed out" if res.timed_out else f"exit {res.exit_code}"
    return f"[{status}]\n{body}", res.exit_code != 0 or res.timed_out


async def run_view(sb: Sandbox, path: str, start: object, end: object) -> tuple[str, bool]:
    first = max(as_int(start, "start_line") or 1, 1)
    last = min(as_int(end, "end_line") or first + VIEW_MAX_LINES - 1, first + VIEW_MAX_LINES - 1)
    if last < first:
        return "error: end_line is before start_line", True
    full = _resolve(sb.workdir, path)
    q = shlex.quote(full)
    res = await sb.exec(
        f"test -f {q} || {{ echo 'no such file'; exit 2; }}; "
        f"awk -v a={first} -v b={last} 'NR>=a && NR<=b {{ printf \"%6d  %s\\n\", NR, $0 }} NR>b {{ exit }}' {q}; "
        f'echo "[lines {first}-{last} of $(wc -l < {q})]"',
        timeout=30,
    )
    if res.exit_code != 0:
        return f"error: {path}: {res.output.strip()[:200]}", True
    return truncate_middle(res.output, OUTPUT_LIMIT_BYTES), False


async def run_edit(sb: Sandbox, path: str, old: str, new: str) -> tuple[str, bool]:
    full = _resolve(sb.workdir, path)
    exists = (await sb.exec(f"test -f {shlex.quote(full)}", timeout=10)).exit_code == 0
    if not exists:
        if old != "":
            return f"error: {path} does not exist", True
        await sb.write_file(full, new)
        return f"created {path}", False
    text = await sb.read_file(full)
    if old == "":
        return "error: old must be non-empty when the file exists", True
    count = text.count(old)
    if count == 0:
        return "error: old text not found", True
    if count > 1:
        return f"error: old text occurs {count} times; include more context so it is unique", True
    await sb.write_file(full, text.replace(old, new, 1))
    return f"edited {path}", False


async def read_for_context(sb: Sandbox, paths: list[str], char_budget: int) -> str:
    """Preload files for the delegate, splitting the character budget evenly between them."""
    if not paths:
        return ""
    per = max(char_budget // len(paths), 2_000)
    parts: list[str] = []
    for p in paths[:20]:
        full = _resolve(sb.workdir, p)
        res = await sb.exec(f"cat {shlex.quote(full)}", timeout=30)
        body = res.output if res.exit_code == 0 else f"(could not read: exit {res.exit_code})"
        if len(body) > per:
            body = body[: per // 2] + "\n[... truncated ...]\n" + body[-per // 2 :]
        parts.append(f"=== {p} ===\n{body}")
    return "\n\n".join(parts)
