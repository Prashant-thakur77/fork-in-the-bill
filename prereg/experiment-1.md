# Pre-registration: experiment 1

Status: registered. This file is hashed in `prereg/HASHES.txt` and tagged `prereg-exp1` before the first task of the main run. It is never edited after the tag; any change goes in `prereg/experiment-1-amendment-<n>.md`. The numbers below come from the pilot ([pilot-report.md](pilot-report.md)).

## Question

When a coding agent hands its grunt work (exploring the repository, reading long files, running and summarising tests) to a small model instead of the frontier model, does the cost per task go down without the agent solving fewer tasks?

## Hypothesis

<!-- hypothesis:start -->
Routing the agent's delegate lane to Claude Haiku 5.5 instead of Claude Sonnet 5.5 (variation lanes_v1) lowers the mean dollar cost per task (task_cost), while the solve rate (task_solved) drops by no more than 20 percentage points. Units are real SWE-bench-Live tasks created after the models' training cutoff, one Flagsmith identity per task.
<!-- hypothesis:end -->

## Arms

Served by the Flagsmith flag `agent_routing` from experiment-level bucketing (50/50, 100% rollout). The runner never picks an arm.

| Variation key | Main lane | Delegate lane |
|---|---|---|
| `control` (flag value) | claude-sonnet-5-5 | claude-sonnet-5-5 |
| `lanes_v1` | claude-sonnet-5-5 | claude-haiku-5-5 |

The flag values are `flagsmith/policies/control.json` and `flagsmith/policies/lanes_v1.json`. They differ only in `delegate.model`, which `RoutingPolicy.clean_ab_diff` checks. Everything else is identical: prompts (`harness/prompts/`), tools and their order, effort per lane, token limits, and the caps of 40 main-lane turns, $0.60 and 1200 seconds of agent time per task. The pilot's most expensive task cost $0.27 and the longest used 17 turns, so the caps should rarely bind.

## Units and pool

- Pool: `tasks/pools/exp1.jsonl.gz`, every SWE-bench-Live MultiLang task created on or after 2026-07-01 in the stratum of at most 3 files and 60 changed lines, minus the instances that failed validation (`tasks/validation_report.json`). Seed 20261127, with the dataset revision in `tasks/pools/manifest.json`.
- Identity: `swelive:<instance_id>`. Traits: repo, language, created_month, gold_files, gold_lines.
- N: every valid task in the pool. 140 tasks were drawn; about 62% of those validated so far pass, so we expect around 85 valid tasks, about 43 per arm. Flagsmith's bucketing decides the split, so the arms will not be exactly equal.
- Order: validation (gold patch, run without any model) is arm-blind, so a task is enqueued as soon as it passes. Validation never sees an arm and the agent never sees validation output beyond the task itself.

## Metrics (Flagsmith)

| Metric | Aggregation | Direction | Role |
|---|---|---|---|
| task_cost | mean | down (lower is better) | primary |
| task_solved | occurrence | up, expected not to decrease | guardrail |
| task_turns | mean | informational | secondary |
| task_seconds | mean | informational | secondary |

`task_cost` is sent for every exposed task, including capped, failed and excluded ones. `task_solved` is sent only when every FAIL_TO_PASS and PASS_TO_PASS test passes in a fresh grading container.

## Decision rule

Ship `lanes_v1` (set it as the flag's value after ending the experiment) only if all three hold:

1. Flagsmith reports a chance to beat control of at least 95% on `task_cost`.
2. Our Beta(1,1) posterior gives P(Δsolve > −m) ≥ 0.90, where m = 20 percentage points and Δsolve is the lanes_v1 solve rate minus the control solve rate.
3. Flagsmith does not report `task_solved` as losing (chance to beat control below 5%).

Otherwise keep `control` and publish the reason.

## Power

From `analysis/power.py` on the 18 pilot tasks (solve rate 50%, mean cost $0.114 for control and $0.072 for lanes_v1), 2000 simulations, seed 20260202. At 45 tasks per arm:

- Cost: a 29% cut in mean cost is detected with 80% power. The pilot's observed cut (37%) is detected with 95% power.
- Solve rate: only a drop of about 25 percentage points is detected with 80% power.
- Guardrail: if lanes_v1 truly solves as many tasks as control, rule 2 passes 77% of the time.

So this experiment can answer the cost question, but it can only rule out large drops in solve rate. A small solve-rate loss of, say, 5 points would go undetected; ruling that out would need roughly 800 tasks per arm, more than the fresh pool holds. The results will say so next to the numbers.

The margin of 20 points was chosen after the pilot and before any experiment task ran. It was set so that a lanes_v1 that is truly as good as control passes the guardrail more often than not at this N.

## Exclusions

Infrastructure failures (image pull, container start, git trouble in the container, provider errors after retries) are retried once, then excluded and listed in `runs/exp1/exclusions.jsonl`. Events are sent only for a task's final attempt, so a retried task's metrics reflect that attempt; the spend of the failed attempt is still counted in the budget and the ledger. Agent failures (refusals, caps, malformed loops) are never excluded. An SRM p-value below 0.001 means the results aren't acted on until the cause is found.

## Stopping

The run continues until every task in the pool is done or excluded. There is no early stopping on a good result. The flag is not touched while the experiment runs. Only `routing_kill` may be used, for safety, and any use is logged.

## Seconds

`task_seconds` is wall time from assignment to the end of grading, so it includes pulling the image and building and running the tests. The 1200-second cap applies only to the agent loop. Image builds dominate this metric, which is why it is informational.

## After the decision

The experiment is ended in Flagsmith, the winning variation's value becomes the flag's value, and a fresh batch (`tasks/pools/rollout.jsonl.gz`, disjoint from this pool) runs on the same flag with no code change. Experiment 2 is registered separately.
