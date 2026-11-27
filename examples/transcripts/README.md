# What a task looks like

Four real tasks from experiment 1, one solved and one unsolved in each arm, rendered from the raw transcripts by [`tools/render_transcript.py`](../../tools/render_transcript.py). Nothing in them is edited by hand.

| Arm | Outcome | Task | Rendered |
|---|---|---|---|
| `control` (worker on Sonnet) | solved | `apache__parquet-java-3645` | [transcript](exp1-control-apache__parquet-java-3645__a1.md) |
| `control` (worker on Sonnet) | unsolved | `colbymchenry__codegraph-804` | [transcript](exp1-control-colbymchenry__codegraph-804__a1.md) |
| `lanes_v1` (worker on Haiku) | solved | `floci-io__floci-1837` | [transcript](exp1-lanes_v1-floci-io__floci-1837__a1.md) |
| `lanes_v1` (worker on Haiku) | unsolved | `kubernetes__kube-state-metrics-2926` | [transcript](exp1-lanes_v1-kubernetes__kube-state-metrics-2926__a1.md) |

They were picked mechanically: among tasks with three to seven planner turns and at least one worker job, the one a third of the way up when sorted by transcript size, for each arm and outcome.

Each file shows the issue text the planner received, every planner step (a worker job, a file view, an edit or the submit), what came back, and the patch that was graded. The worker's own tool loop is not in a transcript: the planner sees only the worker's JSON answer, and so does the reader.

The raw transcript and patch of every task attempt are in the run folders: [`runs/exp1/transcripts/`](../../runs/exp1/transcripts/) and [`runs/rollout/transcripts/`](../../runs/rollout/transcripts/). To render any of them:

```sh
uv run python -m tools.render_transcript runs/exp1/transcripts/<task>__a1.json
```
