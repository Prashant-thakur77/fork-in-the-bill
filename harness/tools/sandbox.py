"""What the agent's tools need from a task container. runner/containers.py provides the real one."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ExecResult:
    exit_code: int
    output: str
    timed_out: bool = False


class Sandbox(Protocol):
    workdir: str

    async def exec(self, cmd: str, timeout: int) -> ExecResult: ...
    async def read_file(self, path: str) -> str: ...
    async def write_file(self, path: str, content: str) -> None: ...


def truncate_middle(text: str, limit_bytes: int) -> str:
    """Keep the head and tail of long output so both the command echo and the final error survive."""
    raw = text.encode("utf-8", errors="replace")
    if len(raw) <= limit_bytes:
        return text
    half = limit_bytes // 2
    head = raw[:half].decode("utf-8", errors="ignore")
    tail = raw[-half:].decode("utf-8", errors="ignore")
    return f"{head}\n\n[... {len(raw) - 2 * half} bytes omitted ...]\n\n{tail}"
