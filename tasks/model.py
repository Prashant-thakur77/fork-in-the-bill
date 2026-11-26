"""Task instance contract shared by selection, validation, the runner and the harness."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TaskInstance(BaseModel):
    """A normalised SWE-bench-Live / SWE-rebench instance.

    `test_patch`, `FAIL_TO_PASS` and `PASS_TO_PASS` are only used by the grader;
    the agent sees `problem_statement` and the container, nothing else.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    instance_id: str
    source: str  # e.g. "SWE-bench-Live/MultiLang:rust" or "nebius/SWE-rebench-leaderboard:2026_03"
    language: str
    repo: str
    base_commit: str
    created_at: str  # ISO 8601
    problem_statement: str
    patch: str  # gold patch, grader-only
    test_patch: str  # grader-only
    fail_to_pass: list[str]
    pass_to_pass: list[str]
    docker_image: str
    rebuild_cmds: list[str]
    test_cmds: list[str]
    print_cmds: list[str] = []  # empty: test output is captured from test_cmds (pytest-style sources)
    log_parser: str  # Python source defining `parser(log: str) -> dict[str, str]`, or "pytest"
    workdir: str = "/testbed"

    @property
    def created_month(self) -> str:
        return self.created_at[:7]

    @property
    def gold_files(self) -> int:
        return sum(1 for line in self.patch.splitlines() if line.startswith("diff --git "))

    @property
    def gold_lines(self) -> int:
        return sum(
            1
            for line in self.patch.splitlines()
            if (line.startswith("+") or line.startswith("-")) and not line.startswith(("+++", "---"))
        )
