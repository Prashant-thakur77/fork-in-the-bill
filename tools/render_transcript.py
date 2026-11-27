"""Render one raw agent transcript (runs/<exp>/transcripts/*.json) as Markdown.

    uv run python -m tools.render_transcript runs/exp1/transcripts/<file>.json --out examples/transcripts/

The header comes from the task's record in runs/<exp>/tasks.jsonl. Long tool output is cut to
`--limit` characters; the JSON file keeps all of it. The delegate's own tool loop is not in the
transcript: the planner sees only the delegate's JSON answer, and so does the reader.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import typer


def _cut(text: str, limit: int) -> str:
    text = text.rstrip()
    return (
        text
        if len(text) <= limit
        else f"{text[:limit].rstrip()}\n… [{len(text) - limit} more characters in the JSON file]"
    )


def _fence(text: str, lang: str = "") -> str:
    ticks = "````" if "```" in text else "```"
    return f"{ticks}{lang}\n{text}\n{ticks}"


def task_record(transcript_path: Path, identity: str) -> dict[str, Any]:
    tasks = transcript_path.parent.parent / "tasks.jsonl"
    rows = [json.loads(line) for line in tasks.read_text(encoding="utf-8").split("\n") if line]
    matches = [r for r in rows if r.get("identity") == identity]
    if not matches:
        raise typer.BadParameter(f"{identity} not found in {tasks}")
    attempt = int(transcript_path.stem.rsplit("__a", 1)[-1])
    return next((r for r in matches if r.get("attempt") == attempt), matches[-1])


def render(raw: dict[str, Any], task: dict[str, Any], source: str, limit: int) -> str:
    out = [
        f"# {task['instance_id']} ({raw['variant']})",
        "",
        f"Source: `{source}`. Rendered by `tools/render_transcript.py`; nothing here is edited by hand.",
        "",
        "| | |",
        "|---|---|",
        f"| Arm (served by Flagsmith) | `{task['variant']}` |",
        f"| Outcome | {'solved' if task['solved'] else 'unsolved'} (`{task['outcome']}`) |",
        f"| Cost | ${task['usd']:.4f} (planner ${task['usd_main']:.4f}, worker ${task['usd_delegate']:.4f}) |",
        f"| Planner turns, worker jobs | {task['turns']}, {task['delegate_calls']} |",
        f"| Language | {task.get('traits', {}).get('language', 'unknown')} |",
    ]
    if task.get("error"):
        out.append(f"| Grading note | `{task['error']}` |")
    out.append("")
    step = 0
    for message in raw["transcript"]:
        content = message["content"]
        if isinstance(content, str):
            out += ["## The task given to the planner", "", _fence(_cut(content, limit * 2)), ""]
            continue
        for block in content:
            kind = block.get("type")
            if kind == "thinking":
                continue
            if kind == "text" and block.get("text", "").strip():
                out += ["**Planner:**", "", _cut(block["text"], limit), ""]
            elif kind == "tool_use":
                step += 1
                title = "worker job" if block["name"] == "delegate" else block["name"]
                out += [
                    f"### Step {step}: {title}",
                    "",
                    _fence(_cut(json.dumps(block["input"], indent=2, ensure_ascii=False), limit), "json"),
                    "",
                ]
            elif kind == "tool_result":
                label = "Worker's answer" if _is_json(block.get("content", "")) else "Result"
                flag = " (error)" if block.get("is_error") else ""
                out += [f"{label}{flag}:", "", _fence(_cut(str(block.get("content", "")), limit)), ""]
    out += ["## The patch that was graded", "", _fence(_cut(raw.get("diff") or "(empty)", limit * 3), "diff"), ""]
    return "\n".join(out)


def _is_json(text: str) -> bool:
    return text.lstrip().startswith("{")


app = typer.Typer(add_completion=False)


@app.command()
def main(
    transcript: Annotated[Path, typer.Argument(help="runs/<exp>/transcripts/<file>.json")],
    out: Annotated[Path | None, typer.Option(help="directory to write <name>.md into; stdout if omitted")] = None,
    limit: Annotated[int, typer.Option(help="characters kept per tool input or result")] = 1500,
) -> None:
    raw = json.loads(transcript.read_text(encoding="utf-8"))
    text = render(raw, task_record(transcript, raw["identity"]), transcript.as_posix(), limit)
    if out is None:
        typer.echo(text)
        return
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{transcript.parent.parent.name}-{raw['variant']}-{transcript.stem}.md"
    target.write_text(text, encoding="utf-8")
    typer.echo(str(target))


if __name__ == "__main__":
    app()
