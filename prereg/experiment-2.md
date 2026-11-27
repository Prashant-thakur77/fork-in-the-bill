# Pre-registration: experiment 2

Status: registered. This file is hashed in `prereg/HASHES.txt` and tagged `prereg-exp2` before the first task of the run. It is never edited after the tag; any change goes in `prereg/experiment-2-amendment-<n>.md`.

## Where this starts

Experiment 1 shipped `lanes_v1` by its pre-registered rule (`analysis/results.md`). Flagsmith experiment 822 was ended with `lanes_v1` as the rollout decision, so `lanes_v1` is now the value every identity gets from `agent_routing`. That rolled-out value is the control here.

## Question

In `lanes_v1` the small model only reads: it explores the repository, reads files and runs tests, then reports back, and the frontier model writes every edit. If the small model also writes a first draft of the fix and the frontier model reviews and corrects it, does the cost per task drop further without the agent solving fewer tasks?

## Hypothesis

<!-- hypothesis:start -->
Letting the delegate lane (Claude Haiku 5.5) draft the patch and having the main lane (Claude Sonnet 5.5) review and correct it (variation lanes_v2) lowers the mean dollar cost per task (task_cost) compared with the rolled-out lanes_v1, while the solve rate (task_solved) drops by no more than 20 percentage points. Units are real SWE-bench-Live tasks, one Flagsmith identity per task.
<!-- hypothesis:end -->

## Arms

Served by the Flagsmith flag `agent_routing` from experiment-level bucketing (50% to `lanes_v2`, 100% rollout). The runner never picks an arm. `lanes_v1` stays a variant at 0%, so it gets no traffic of its own; the control arm is the flag's own value, which is the `lanes_v1` policy.

| Variation | Main lane | Delegate lane | `prompt_variant` |
|---|---|---|---|
| control (flag value: `lanes_v1` policy) | claude-sonnet-5-5 | claude-haiku-5-5 | `delegate_v1` |
| `lanes_v2` | claude-sonnet-5-5 | claude-haiku-5-5 | `draft_review_v1` |

The flag values are `flagsmith/policies/lanes_v1.json` and `flagsmith/policies/lanes_v2.json`. Apart from the label they differ only in `prompt_variant`, which `RoutingPolicy.clean_ab_diff` checks. Models, effort per lane, token limits and the caps (40 main-lane turns, $0.60 and 1200 seconds of agent time per task) are identical.

`prompt_variant` is one switch that changes the division of work, and so three things move together under it (`harness/agent.py`):

- the main lane's system prompt: `harness/prompts/main_system.md` becomes `main_system_draft_review.md`, which tells it to delegate a candidate fix first, then review and correct it;
- the delegate's system prompt: `delegate_system.md` becomes `delegate_system_draft.md`;
- the delegate's tools: the read-only set (`DELEGATE_TOOLS_READONLY`) becomes one that can also edit files (`DELEGATE_TOOLS_DRAFT`).

This is the treatment as one unit. The experiment cannot say which of the three matters.

## Units and pool

- Pool: `tasks/pools/exp2.jsonl.gz` (100 tasks created 2026-03-01 to 2026-06-30) and `tasks/pools/exp2b.jsonl.gz` (110 tasks: the 58 pre-cutoff tasks left after `exp1b` in the same seeded order, then 52 tasks created before 2026-03-01 in a separately seeded order). Same stratum as experiment 1 (at most 3 files and 60 changed lines), seed 20261127; `tasks/select_tasks.py --exp2b 110` reproduces it and `tasks/pools/manifest.json` records it. Every task is disjoint from the pilot, experiment 1 and the rollout batch.
- Validation is the same arm-blind rule as experiment 1: the gold patch is applied and graded without any model, and only tasks that pass are enqueued.
- Identity: `swelive:<instance_id>`. Traits: repo, language, created_month, gold_files, gold_lines.
- N: every valid task in both files. About 66% of experiment 1's pool validated, so we expect around 135 valid tasks, about 68 per arm. Flagsmith's bucketing decides the split.
- All tasks here were created before the models' June 2026 training cutoff, so the models may have seen some of the fixes. Assignment is random, so this affects both arms alike; created_month is reported per arm.

## Metrics (Flagsmith)

The same four metrics as experiment 1, attached to the new experiment:

| Metric | Aggregation | Direction | Role |
|---|---|---|---|
| task_cost | mean | down (lower is better) | primary |
| task_solved | occurrence | up, expected not to decrease | guardrail |
| task_turns | mean | informational | secondary |
| task_seconds | mean | informational | secondary |

`task_cost` is sent for every exposed task, including capped, failed and excluded ones. `task_solved` is sent only when every FAIL_TO_PASS and PASS_TO_PASS test passes in a fresh grading container.

## Decision rule

Ship `lanes_v2` (set it as the flag's value after ending the experiment) only if all three hold:

1. Flagsmith reports a chance to beat control of at least 95% on `task_cost`.
2. Our Beta(1,1) posterior gives P(Δsolve > −m) ≥ 0.90, where m = 20 percentage points and Δsolve is the lanes_v2 solve rate minus the control solve rate.
3. Flagsmith does not report `task_solved` as losing (chance to beat control below 5%).

Otherwise keep `lanes_v1` and publish the reason. A result that keeps `lanes_v1` is published in full, with the per-trait tables, the same way a win would be.

## Power

From `analysis/power.py` seeded with experiment 1's data (145 tasks, solve rate 42.8%), 2000 simulations, seed 20260202, saved as `analysis/out/power-exp2/power.json`. At 65 tasks per arm:

- Cost: a 34% cut in mean cost is detected with 80% power.
- Solve rate: a drop of about 20.5 percentage points is detected with 80% power.
- Guardrail: if lanes_v2 truly solves as many tasks as control, rule 2 passes 87% of the time.

A smaller cost cut than about a third may go undetected, and only large solve-rate drops can be ruled out. The margin m = 20 points is the same as experiment 1's and was fixed before any experiment 2 task ran.

## Exclusions

As in experiment 1: infrastructure failures (image pull, container start, git trouble in the container, provider errors after retries) are retried once, then excluded and listed. Events are sent only for a task's final attempt; the spend of a failed attempt still counts in the budget and the ledger. Agent failures (refusals, caps, malformed loops, a draft that breaks the build) are never excluded. An SRM p-value below 0.001 means the results aren't acted on until the cause is found.

## Stopping

The run continues until every task in both pool files is done, excluded or invalid. There is no early stopping on a good or bad result. The flag is not touched while the experiment runs. Only `routing_kill` may be used, for safety, and any use is logged.

## Before the run

Before this file was written, `lanes_v2` ran on 3 pilot tasks outside any experiment (`runs/dryrun-lanes_v2`) to check that the draft-review path works end to end. Those tasks are not in this pool and their results do not enter any analysis.
