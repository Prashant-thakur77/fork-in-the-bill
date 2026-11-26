# Experiment 1, amendment 1: more tasks so Flagsmith can give a verdict

Status: registered. Hashed in `prereg/HASHES.txt` and tagged `prereg-exp1-amend1` before any task from the new pool runs. `prereg/experiment-1.md` is unchanged; where the two differ, this file wins.

## Why

Decision rule 1 uses the chance to beat control that Flagsmith reports for `task_cost`. Flagsmith shows no inference for a metric until each variant has at least 50 identities (`RESULTS_MIN_IDENTITIES_PER_VARIANT = 50` in `api/experimentation/constants.py` of the Flagsmith repository). It checks sample-ratio mismatch only from 100 identities in total. The registered pool was expected to give about 43 valid tasks per arm. At that size Flagsmith would show "collecting data" to the end, and rule 1 could never pass. The original registration missed this.

## What was known when this was written

The experiment had started at 23:02:34Z. Three tasks had finished. Before writing this, the author had seen only:
- the Flagsmith results endpoint at 23:04Z, showing 3 exposures and no events;
- a pipeline health check: 3 tasks, all assigned by the experiment, no infra errors, and 9 events (3 each of task_cost, task_turns and task_seconds).

The event counts imply that none of the three finished tasks had been solved. No result per arm, and no cost, was seen.

## Change

1. **Pool.** The experiment also runs `tasks/pools/exp1b.jsonl.gz`: the next 80 pre-cutoff tasks (created 2026-03-01 to 2026-06-30, same stratum). They are drawn in the same seeded order (seed 20261127) after the pilot, rollout and exp2 pools, which are unchanged. `tasks/select_tasks.py --exp1b 80` reproduces them, and `tasks/pools/manifest.json` records it. The same validation rule applies, and validated tasks are enqueued the same way. Expected total: about 135 valid tasks, about 68 per arm.
2. **Units.** Units are now SWE-bench-Live MultiLang tasks of both tiers, one Flagsmith identity per task. Pre-cutoff tasks may have been seen in training. That raises solve rates in both arms alike, since assignment is random, but it means the tier is a trait to report. The Flagsmith experiment's hypothesis field, which mentions only fresh tasks, is left as created so that nothing on the running experiment is edited. This amendment is the record of the change.
3. **Analyses.** Primary, unchanged: decision rules 1-3 on all exposed tasks of both pools. New secondary analysis: the same estimates for the fresh tier alone and for the pre-cutoff tier alone. These are reported, but they don't enter the decision.
4. **Unchanged:** the arms, flag values, caps, metrics, the margin m = 20 points, the decision rule, the exclusions and the stopping rule. The run ends when every task in both pools is done, excluded or invalid.

## Power at the new size

From the same `analysis/power.py` run as the registration (`analysis/out/power.json`), at 70 tasks per arm:
- a 25% cost cut is detected with 80% power, and the pilot's 37% cut with 99% power;
- a solve-rate drop of 20 points is detected with 80% power;
- if lanes_v1 truly solves as many tasks as control, rule 2 passes 87% of the time.

Small solve-rate losses still cannot be ruled out.
