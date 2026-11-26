from __future__ import annotations

from typing import Any, cast

import pytest
from anthropic.types import Message, TextBlock, ToolUseBlock, Usage

from harness.agent import Agent, parse_delegate_json
from harness.budget import FileBudget, TaskBudget
from harness.lanes import LaneCaller
from harness.schema import CallRecord, Lane, Outcome, RoutingPolicy
from harness.tools.sandbox import ExecResult


def policy(delegate_model: str = "claude-haiku-5-5", turns: int = 10, usd: float = 3.0) -> RoutingPolicy:
    return RoutingPolicy.model_validate(
        {
            "policy": "lanes_v1",
            "schema": 1,
            "main": {"model": "claude-opus-5-5", "max_tokens": 4096, "cache": True},
            "delegate": {"model": delegate_model, "max_tokens": 1024, "max_context_tokens": 24000},
            "caps": {"turns": turns, "usd_per_task": usd, "seconds": 600},
        }
    )


def msg(content: list[Any], stop: str, out: int = 100) -> Message:
    return Message(
        id="m",
        type="message",
        role="assistant",
        model="x",
        content=content,
        stop_reason=stop,  # type: ignore[arg-type]
        stop_sequence=None,
        usage=Usage(input_tokens=1000, output_tokens=out),
    )


class FakeMessages:
    def __init__(self, script: dict[str, list[Message]]) -> None:
        self.script = script
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kw: Any) -> Message:
        self.calls.append(kw)
        return self.script[kw["model"]].pop(0)


class FakeClient:
    def __init__(self, script: dict[str, list[Message]]) -> None:
        self.messages = FakeMessages(script)


class FakeSandbox:
    workdir = "/testbed"

    def __init__(self) -> None:
        self.files = {"/testbed/a.py": "x = 1\n"}
        self.cmds: list[str] = []

    async def exec(self, cmd: str, timeout: int) -> ExecResult:
        self.cmds.append(cmd)
        if cmd.startswith("test -f "):
            return ExecResult(0 if cmd.split()[-1].strip("'") in self.files else 1, "")
        return ExecResult(0, "ok")

    async def read_file(self, path: str) -> str:
        return self.files[path]

    async def write_file(self, path: str, content: str) -> None:
        self.files[path] = content


def run(tmp_path, script, pol):
    records: list[CallRecord] = []
    client = FakeClient(script)
    caller = LaneCaller(
        client=cast(Any, client),
        identity="swelive:x",
        global_budget=FileBudget(tmp_path / "b.json", 100.0),  # type: ignore[arg-type]
        task_budget=TaskBudget(pol.caps.usd_per_task),
        on_call=records.append,
    )
    sb = FakeSandbox()
    agent = Agent(pol, caller, sb)
    return agent, sb, client, records


@pytest.mark.asyncio
async def test_delegate_edit_submit(tmp_path):
    script = {
        "claude-opus-5-5": [
            msg(
                [
                    ToolUseBlock(
                        type="tool_use", id="t1", name="delegate", input={"instruction": "find x", "paths": ["a.py"]}
                    )
                ],
                "tool_use",
            ),
            msg(
                [
                    ToolUseBlock(
                        type="tool_use",
                        id="t2",
                        name="edit_file",
                        input={"path": "a.py", "old": "x = 1", "new": "x = 2"},
                    )
                ],
                "tool_use",
            ),
            msg([ToolUseBlock(type="tool_use", id="t3", name="submit", input={})], "tool_use"),
        ],
        "claude-haiku-5-5": [
            msg([ToolUseBlock(type="tool_use", id="d1", name="bash", input={"cmd": "grep -n x a.py"})], "tool_use"),
            msg(
                [TextBlock(type="text", text='{"summary":"x in a.py","findings":["a.py:1"],"confidence":0.9}')],
                "end_turn",
            ),
        ],
    }
    agent, sb, client, records = run(tmp_path, script, policy())
    res = await agent.run("make x two")
    assert res.outcome is None and res.turns == 3 and res.delegate_calls == 1
    assert sb.files["/testbed/a.py"] == "x = 2\n"
    assert [r.lane for r in records] == [Lane.main, Lane.delegate, Lane.delegate, Lane.main, Lane.main]
    # the delegate answer reaches the main lane as a tool result, its transcript does not
    tool_result = res.transcript[2]["content"][0]
    assert tool_result["tool_use_id"] == "t1"
    assert '"summary":"x in a.py"' in tool_result["content"]
    assert all(
        c["output_config"] == {"effort": "low"} for c in client.messages.calls if c["model"] == "claude-haiku-5-5"
    )
    assert all("temperature" not in c for c in client.messages.calls)


@pytest.mark.asyncio
async def test_turn_cap(tmp_path):
    script = {"claude-opus-5-5": [msg([TextBlock(type="text", text="thinking")], "end_turn") for _ in range(3)]}
    agent, *_ = run(tmp_path, script, policy(turns=2))
    res = await agent.run("x")
    assert res.outcome == Outcome.capped_turns and res.turns == 2


@pytest.mark.asyncio
async def test_usd_cap(tmp_path):
    big = [msg([TextBlock(type="text", text="..")], "end_turn", out=200_000) for _ in range(5)]
    agent, *_ = run(tmp_path, {"claude-opus-5-5": big}, policy(usd=5.0))
    res = await agent.run("x")
    assert res.outcome == Outcome.capped_usd


@pytest.mark.asyncio
async def test_refusal_is_agent_error(tmp_path):
    agent, *_ = run(tmp_path, {"claude-opus-5-5": [msg([], "refusal")]}, policy())
    res = await agent.run("x")
    assert res.outcome == Outcome.agent_error


def test_arms_differ_only_in_delegate_model():
    a, b = policy("claude-opus-5-5"), policy("claude-haiku-5-5")
    assert a.clean_ab_diff(b) == {"delegate.model"}


def test_parse_delegate_json():
    assert parse_delegate_json('sure: {"summary":"s","findings":[],"confidence":1}') is not None
    assert parse_delegate_json("no json") is None
    assert parse_delegate_json('{"summary":"s","confidence":3}') is None


@pytest.mark.asyncio
async def test_main_lane_bash_output_is_short_delegate_is_long() -> None:
    from harness.tools import defs

    class Big(FakeSandbox):
        async def exec(self, cmd: str, timeout: int) -> ExecResult:
            return ExecResult(0, "x" * 50_000)

    sb = Big()
    main, _ = await defs.run_bash(sb, "cat big", None, defs.MAIN_OUTPUT_LIMIT_BYTES)
    deleg, _ = await defs.run_bash(sb, "cat big", None)
    assert len(main.encode()) < 2_200 < 15_000 < len(deleg.encode()) < 16_200
    assert [t["name"] for t in defs.MAIN_TOOLS] == ["view_file", "edit_file", "delegate", "submit"]
    assert [t["name"] for t in defs.DELEGATE_TOOLS_READONLY] == ["bash"]
