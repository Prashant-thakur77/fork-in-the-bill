"""Quick per-task, per-lane summary of a run directory while it is in progress.

python -m runner.summary runs/pilot-control
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path


def summarize(run_dir: Path) -> str:
    out: list[str] = []
    calls_path = run_dir / "calls.jsonl"
    if calls_path.exists():
        agg: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0, 0.0, 0, 0, 0, 0])
        stops: dict[str, int] = defaultdict(int)
        for line in calls_path.read_text().split("\n"):
            if not line.strip():
                continue
            r = json.loads(line)
            a = agg[(r["task_identity"].removeprefix("swelive:"), r["lane"])]
            a[0] += 1
            a[1] += r["usd"]
            a[2] += r["cache_read_tokens"]
            a[3] += r["cache_write_5m_tokens"] + r["cache_write_1h_tokens"]
            a[4] += r["input_tokens"]
            a[5] += r["output_tokens"]
            stops[str(r["stop_reason"])] += 1
        out.append("task / lane: calls usd cache_read cache_write uncached_in out")
        for (task, lane), v in sorted(agg.items()):
            out.append(f"  {task} {lane}: {int(v[0])} ${v[1]:.4f} {int(v[2])} {int(v[3])} {int(v[4])} {int(v[5])}")
        out.append(f"stop reasons: {dict(stops)}")
    tasks_path = run_dir / "tasks.jsonl"
    if tasks_path.exists():
        out.append("finished tasks:")
        for line in tasks_path.read_text().split("\n"):
            if not line.strip():
                continue
            r = json.loads(line)
            out.append(
                f"  {r['instance_id']} {r['variant']} {r['outcome']} ${r['usd']:.4f} "
                f"(delegate ${r['usd_delegate']:.4f}) turns={r['turns']} delegates={r['delegate_calls']} "
                f"{r['seconds']:.0f}s {r.get('error') or ''}"
            )
    return "\n".join(out) or "nothing yet"


if __name__ == "__main__":
    for d in sys.argv[1:]:
        print(f"== {d}")
        print(summarize(Path(d)))
