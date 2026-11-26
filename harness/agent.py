"""The agent loop: one main-lane conversation that can hand grunt work to the delegate lane.

The loop is identical in every arm. The routing policy supplies the model ids, token
limits and caps; nothing else about a run depends on the arm.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import anthropic
from pydantic import BaseModel, Field, ValidationError

from harness.budget import BudgetExceeded
from harness.lanes import LaneCaller, TaskCapReached, prompt, system_block
from harness.schema import Lane, Outcome, RoutingPolicy
from harness.tools import defs
from harness.tools.sandbox import Sandbox

log = logging.getLogger(__name__)

DELEGATE_MAX_TURNS = 12
NUDGE = "Continue working on the issue. Call `submit` when the fix is in place."


class DelegateAnswer(BaseModel):
    summary: str
    findings: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)


@dataclass
class AgentResult:
    outcome: Outcome | None  # None means submitted or stopped normally; grading decides solved/unsolved
    turns: int
    delegate_calls: int
    seconds: float
    error: str | None = None
    transcript: list[dict[str, Any]] = field(default_factory=list)


def _dump(content: Any) -> list[dict[str, Any]]:
    return [b.model_dump(exclude_none=True) if hasattr(b, "model_dump") else b for b in content]


def _text_of(content: Any) -> str:
    return "\n".join(getattr(b, "text", "") for b in content if getattr(b, "type", "") == "text").strip()


def parse_delegate_json(text: str) -> DelegateAnswer | None:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return DelegateAnswer.model_validate(json.loads(text[start : end + 1]))
    except (json.JSONDecodeError, ValidationError):
        return None


class Agent:
    def __init__(self, policy: RoutingPolicy, caller: LaneCaller, sandbox: Sandbox) -> None:
        self.policy = policy
        self.caller = caller
        self.sb = sandbox
        draft = policy.prompt_variant == "draft_review_v1"
        self.main_system = system_block(
            prompt("main_system_draft_review" if draft else "main_system"), policy.main.cache
        )
        self.delegate_system_name = "delegate_system_draft" if draft else "delegate_system"
        self.delegate_tools = defs.DELEGATE_TOOLS_DRAFT if draft else defs.DELEGATE_TOOLS_READONLY
        self.turn = 0
        self.delegate_calls = 0

    async def run(self, problem_statement: str) -> AgentResult:
        caps = self.policy.caps
        t0 = time.monotonic()
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": f"<issue>\n{problem_statement}\n</issue>\n\nThe repository is at {self.sb.workdir}.",
            }
        ]

        def result(outcome: Outcome | None, error: str | None = None) -> AgentResult:
            return AgentResult(outcome, self.turn, self.delegate_calls, time.monotonic() - t0, error, messages)

        while True:
            if self.turn >= caps.turns:
                return result(Outcome.capped_turns)
            if time.monotonic() - t0 >= caps.seconds:
                return result(Outcome.capped_seconds)
            self.turn += 1
            try:
                resp = await self.caller.call(
                    lane=Lane.main,
                    turn=self.turn,
                    model=self.policy.main.model,
                    max_tokens=self.policy.main.max_tokens,
                    effort=self.policy.main.effort.value,
                    system=self.main_system,
                    tools=defs.MAIN_TOOLS,
                    messages=messages,
                    cache=self.policy.main.cache,
                )
            except TaskCapReached:
                return result(Outcome.capped_usd)
            except BudgetExceeded:
                raise
            except (anthropic.APIConnectionError, anthropic.InternalServerError, anthropic.RateLimitError) as exc:
                return result(Outcome.infra_error, f"main lane: {type(exc).__name__}: {exc}")
            except anthropic.APIStatusError as exc:
                if exc.status_code >= 500:
                    return result(Outcome.infra_error, f"main lane: HTTP {exc.status_code}: {exc.message}")
                return result(Outcome.agent_error, f"main lane: HTTP {exc.status_code}: {exc.message}")

            messages.append({"role": "assistant", "content": _dump(resp.content)})
            if resp.stop_reason == "refusal":
                return result(Outcome.agent_error, "main lane: refusal")
            tool_uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
            if not tool_uses:
                messages.append({"role": "user", "content": NUDGE})
                continue

            results: list[dict[str, Any]] = []
            submitted = False
            for tu in tool_uses:
                try:
                    text, is_error = await self._dispatch(tu.name, dict(tu.input), t0)
                except TaskCapReached:
                    return result(Outcome.capped_usd)
                if tu.name == "submit":
                    submitted = True
                results.append({"type": "tool_result", "tool_use_id": tu.id, "content": text, "is_error": is_error})
            messages.append({"role": "user", "content": results})
            if submitted:
                return result(None)

    async def _dispatch(self, name: str, args: dict[str, Any], t0: float) -> tuple[str, bool]:
        if name == "bash":
            return await defs.run_bash(self.sb, str(args.get("cmd", "")), args.get("timeout"))
        if name == "edit_file":
            return await defs.run_edit(
                self.sb, str(args.get("path", "")), str(args.get("old", "")), str(args.get("new", ""))
            )
        if name == "delegate":
            return await self._delegate(args)
        if name == "submit":
            return "submitted", False
        return f"error: unknown tool {name}", True

    async def _delegate(self, args: dict[str, Any]) -> tuple[str, bool]:
        """A fresh delegate-lane conversation with its own tool loop; returns validated JSON."""
        self.delegate_calls += 1
        lane = self.policy.delegate
        max_out = min(int(args.get("max_output_tokens") or lane.max_tokens), lane.max_tokens)
        paths = [str(p) for p in args.get("paths") or []]
        context = await defs.read_for_context(self.sb, paths, lane.max_context_tokens * 3)
        user = f"Job:\n{args.get('instruction', '')}"
        if context:
            user += f"\n\nPreloaded files:\n{context}"
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        system = system_block(prompt(self.delegate_system_name), True)
        last_text = ""
        repaired = False
        for dturn in range(1, DELEGATE_MAX_TURNS + 2):
            try:
                resp = await self.caller.call(
                    lane=Lane.delegate,
                    turn=self.turn * 100 + dturn,
                    model=lane.model,
                    max_tokens=max_out,
                    effort=lane.effort.value,
                    system=system,
                    tools=self.delegate_tools,
                    messages=messages,
                    cache=True,
                )
            except (anthropic.APIConnectionError, anthropic.APIStatusError) as exc:
                return f"delegate failed: {type(exc).__name__}", True
            messages.append({"role": "assistant", "content": _dump(resp.content)})
            if resp.stop_reason == "refusal":
                return "delegate declined the job", True
            tool_uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
            if tool_uses and dturn <= DELEGATE_MAX_TURNS:
                results = []
                for tu in tool_uses:
                    a = dict(tu.input)
                    if tu.name == "bash":
                        text, err = await defs.run_bash(self.sb, str(a.get("cmd", "")), a.get("timeout"))
                    elif tu.name == "edit_file" and defs.EDIT_FILE in self.delegate_tools:
                        text, err = await defs.run_edit(
                            self.sb, str(a.get("path", "")), str(a.get("old", "")), str(a.get("new", ""))
                        )
                    else:
                        text, err = f"error: tool {tu.name} not available", True
                    results.append({"type": "tool_result", "tool_use_id": tu.id, "content": text, "is_error": err})
                messages.append({"role": "user", "content": results})
                continue
            last_text = _text_of(resp.content)
            parsed = parse_delegate_json(last_text)
            if parsed is not None:
                return parsed.model_dump_json(), False
            if repaired or dturn > DELEGATE_MAX_TURNS:
                break
            repaired = True
            if tool_uses:
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": tu.id,
                                "content": "tool budget used up",
                                "is_error": True,
                            }
                            for tu in tool_uses
                        ],
                    }
                )
            messages.append(
                {"role": "user", "content": "Reply now with only the JSON object described in your instructions."}
            )
        return json.dumps({"summary": "unstructured reply", "raw": last_text[:8000]}), False
