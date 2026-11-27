# Decisions

Design choices made while building and running the experiments. Each one records what was chosen and why.

## D1. Task pools: fresh tier for experiment 1, newest pre-cutoff tier for the rest

All three candidate models (Claude Opus 5.5, Sonnet 5.5, Haiku 5.5) have a June 2026 training-data cutoff ([models overview](https://platform.claude.com/docs/en/about-claude/models/overview), checked 2026-11-27). Counted on 2026-11-27 from the Hugging Face parquet exports:

| Source | Created ≥ 2026-07-01 | Created 2026-03-01 to 2026-06-30 |
|---|---|---|
| SWE-bench-Live/MultiLang (c, cpp, go, js, rust, java, ts, cs) | 231 | 423 |
| SWE-bench-Live/SWE-bench-Live (Python, `full`) | 0 (latest is 2025-04) | 0 |
| nebius/SWE-rebench-leaderboard `2026_03` | 0 | 110 |
| nebius/SWE-rebench-V2 | 0 (latest is 2025-10) | 0 |

The fresh tier can't fill three disjoint pools of several hundred tasks each. So:

- **Experiment 1** (the headline) uses every task in the fresh tier that passes validation. Every task in the headline result was created after every model's training cutoff.
- **Pilot, experiment 2 and the rollout batch** draw from the newest pre-cutoff tier. This is disclosed in the README limits section, and `created_month` is recorded as a trait.
- N per arm comes from `analysis/power.py` on pilot data, bounded by the fresh pool size. If that falls below the original target of 250 per arm, the prereg states the smallest solve-rate drop the experiment can detect, rather than claiming more than it can.

Contamination doesn't bias the arm comparison much, since both arms use the same main-lane model, but it does inflate absolute solve rates. That's why the fresh tier carries the headline.

## D2. No `temperature`; arms share effort and thinking settings instead

The Messages API rejects `temperature`, `top_p` and `top_k` on every model, and Opus 5.5 can't turn thinking off. The clean-A/B control is therefore: identical `output_config.effort` per lane, adaptive thinking (the model default, never configured differently per arm), identical prompts, tools, tool order, caps and harness code. `RoutingPolicy.clean_ab_diff` checks that the two flag values differ only in `delegate.model`, and `flagsmith/setup.sh` refuses to create a variant that differs in anything else.

## D3. No server-side refusal fallback

The API offers a fallback that re-runs a refused request on another model inside the same call. That would silently change which model did the work in one arm, so it's off. A refusal ends the task as `agent_error`. Agent errors are never excluded, so refusals count against the arm that produced them.

## D4. The delegate has its own short tool loop

At first the delegate answered only from files preloaded into its prompt. Grunt work that's worth delegating (finding call sites, running a test suite, reading a build log) needs a shell, so the delegate gets read-only use of `bash` in the same container, up to 12 turns, and still returns the `{summary, findings[], confidence}` JSON. The main lane never sees the delegate's transcript. The setup is identical in both arms.

## D5. Kill switch tasks carry no exposure

`routing_kill` is read with `get_identity_flags` (no exposure). When it's on, a task runs the control policy, sends no exposure and no events, and is logged to the ledger as `kill_switch`. That keeps the experiment's data free of tasks the runner forced into one arm.

## D6. Global spend cap by reservation

`harness/budget.py` reserves each call's worst-case cost before the call, using an atomic Lua script in Redis or a file lock locally, and settles it to the real cost afterwards. A reservation that would exceed the cap is refused, so a crash or bug can only make the cap stricter, never looser.

## D7. Per-task cap checked before each call

The per-task dollar cap is checked before every model call in both lanes. A task can therefore end slightly above the cap by at most one call's cost, and the same rule applies in both arms. The full real spend is reported as `task_cost`.

## D8. $100 total model budget: Sonnet 5.5 as the frontier model, smaller and easier pools

The whole study has a hard $100 cap on model spend (`BUDGET_USD_TOTAL=100`), with per-phase allowances (`BUDGET_USD_PILOT`, `BUDGET_USD_EXP1`, ...) enforced inside it by `harness/budget.py`. Opus 5.5 everywhere would cost too much per task to clear Flagsmith's floor of 50 identities per arm in two experiments. So:

- **Model pair:** Claude Sonnet 5.5 ($2 in / $10 out per MTok) as the frontier lane, Claude Haiku 5.5 ($0.10 / $0.50) as the small lane, a 20x price gap. Still a frontier-vs-small comparison, at a price that fits.
- **Caps:** 40 turns, $0.60 and 20 minutes per task, identical in both arms.
- **Difficulty stratum:** pools are restricted, before any run, to tasks whose gold patch touches one or two files and at most 40 changed lines. This raises the solve rate a mid-tier model can reach under a tight cap, which the original plan called for as the fallback if solve rates were near zero. The filter is recorded in `tasks/pools/manifest.json` and in the prereg, and the README states the result applies to this stratum.
- **Power:** with roughly 70 tasks per arm, a guardrail margin of 5 points can't be verified. The analysis fixtures suggest that needs about 800 per arm. The prereg sets m from the pilot and power simulation, and states the detectable drop plainly.

## D9. Flush after every exposure and event

Flagsmith's docs recommend `EventProcessorConfig(max_buffer_items=1)` for short-lived processes. In the Python SDK 6.7, a full buffer drops its *oldest* event when another is tracked before the first has been sent. The smoke test on 2026-11-27 logged "Event buffer was full: dropped the 2 oldest events" when an exposure and a conversion were tracked back to back. The runner keeps `max_buffer_items=1` and calls `flush_events()` after the exposure and after each conversion event. A rerun with eight identities had no drops and served both variants. The worker calls `close()` on exit.

## D10. Final difficulty stratum: at most 3 files and 60 changed lines, C++ included

With the first stratum (at most 2 files, 40 lines, no C++), only 92 fresh tasks qualified, which is 46 per arm and below Flagsmith's floor of 50 identities per arm before validation drops any. The final stratum allows the gold patch to touch at most 3 files and 60 changed lines, keeps problem statements under 12,000 characters, and includes C++ (the runner VM has 64 GB of RAM). Selected with seed 20261127 from the pinned dataset revision recorded in `tasks/pools/manifest.json`:

| Pool | Tasks | Tier |
|---|---|---|
| pilot | 12 | created 2026-03-01 to 2026-06-30 |
| exp1 | 140 | created on or after 2026-07-01 (every fresh task in the stratum) |
| rollout | 20 | created 2026-03-01 to 2026-06-30 |
| exp2 | 100 | created 2026-03-01 to 2026-06-30 |
| reserve | 74 | SWE-rebench 2026_03, Python |

Pool files are stored as gzip with a fixed timestamp, so the same seed produces byte-identical files.

## D11. Grading runs with network access; the agent's container does not

The agent works in a container with networking disabled. Grading happens afterwards, in a fresh container built from the same image, with networking on, as the official SWE-bench-Live harness does: many rebuild steps download dependencies, and some PASS_TO_PASS tests (for example c-ares' DNS tests) make live lookups. Because grading starts from a clean container after the agent has finished, network access during grading can't help the agent.

## D12. How Flagsmith computes the verdict, and how our replication differs

Read from Flagsmith's open-source `api/experimentation/stats.py` and `results_query.py`, then checked against a Cloud response. For each metric and variant the warehouse returns `n`, `sum` and `sum_squares` over exposed identities. It counts only events at or after an identity's first exposure. Inference is a normal approximation to the relative lift (delta method). `chance_to_win` is the normal probability that the lift is above zero, flipped for metrics whose direction is `down`. The 95% interval is lift ± 1.96 standard errors. The SRM p-value is a chi-square test.

Our replication deliberately uses different methods: a percentile bootstrap for mean cost, and Beta(1,1) posteriors for solve rate. Agreement between the two is therefore evidence that the result isn't an artefact of one statistical method. `analysis/pull_results.py` parses the documented shape, and `numbers.json` reports both results side by side.

## D13. Runner VM: on-demand r7i.2xlarge

The first runner was a spot m7i.4xlarge. AWS reclaimed it about 15 minutes into validation and the in-progress work was lost. An on-demand 16-vCPU replacement exceeded the account's 16-vCPU on-demand quota, half of which other instances already use. The runner is now an on-demand r7i.2xlarge (8 vCPU, 64 GB, about $0.53 an hour in us-east-1, estimated) with a 1.5 TB gp3 volume, so validated images stay cached for the runs. Results are copied off the VM every 5 minutes.

## D14. New files the agent creates are part of its patch

The SWE-bench-Live README collects a prediction with `git diff HEAD`, which leaves out untracked files. A fix that adds a source file would then be graded without it. The runner runs `git add -N .` first, which marks new files without staging their content and respects `.gitignore`, so they appear in the diff. This applies identically to both arms. Validation uses the dataset's gold patches and is unaffected.

## D15. The agent's patch is measured from the container's starting state

The SWE-bench-Live images ship with a dirty work tree: test reports and other files left by the image build, and sometimes edited tracked files. Collecting the agent's patch with `git diff HEAD` swept these in. In the dry run that produced a 27 MB patch that failed to apply at grading. When a task container starts, the runner commits its state as a local baseline and records which files were untracked build output. The agent's patch is its diff against that baseline, including files it created. Build-output files are left out even when the agent's test runs rewrite them. Grading starts a fresh container from the same image, which is in the same starting state, so the patch applies cleanly. Covered by `tests/integration/test_baseline_diff.py`.

## D16. Delegation is the expected way to do grunt work

In the dry run the main lane never called `delegate` in four tasks. The two arms differ only in the delegate lane's model, so without delegation they would be identical. The shared main-lane prompt now states that the main lane's context is the expensive resource. It tells the agent to delegate surveys, long reads and test runs, starting with a survey of the code the issue touches, and to use `bash` itself only for small, targeted checks. Both arms get the same prompt. The pilot measures the delegate share of tokens and cost before the prereg is fixed.

## D17. The main lane sees short tool output; long output goes through the delegate

The stronger prompt (D16) still produced no delegation: the main lane read files and ran builds with its own `bash`. The harness now enforces the two-lane design in both arms. The main lane's `bash` returns only the first and last 1 KB of output, and its tool description says so. The delegate's `bash` returns up to 16 KB. Short checks still work in the main lane. Reading long files, searching widely and digesting test or build output are delegated, which is the grunt work the experiment routes to a cheaper model.

## D18. Planner and worker: the main lane has no shell

Even with its shell output cut to 1 KB (D17), the main lane still delegated nothing. It switched to tighter `sed -n` and `grep | head` commands. Two identical arms would measure nothing. The harness now uses the orchestrator/worker split that many coding agents use, identically in both arms:

- **Main lane (planner).** Tools are `view_file` (up to 150 numbered lines of one file), `edit_file`, `delegate` and `submit`. It decides what to change and writes the change.
- **Delegate lane (worker).** Has `bash` (16 KB of output) in the same container. All searching, surveying, building and test running goes through it, and it returns JSON findings.

The experiment's question is unchanged: whether the worker can be a small model without the planner solving fewer tasks. D17's main-lane `bash` cap no longer applies, because the main lane has no `bash`.

## D19. The guardrail margin is 20 points, because the fresh pool is small

N was meant to come from the power analysis, but it is capped by supply: every task in the fresh tier (created after the models' cutoff, inside the stratum) is already in the exp1 pool, and about 62% of them validate. That gives about 43 tasks per arm. With those numbers, `analysis/power.py` on the pilot shows:

- the cost question is well powered: 95% power at the pilot's 37% cut;
- the solve-rate guardrail is not: only a drop of about 25 points is detectable.

A 5-point margin would fail almost every time, even for an arm that is truly as good as control, so the experiment would decide nothing. The prereg uses m = 20 points, which an equal arm passes 77% of the time at this N. It also states plainly that smaller solve-rate losses cannot be ruled out. Adding older tasks would raise N but bring back the contamination risk that D1 avoids.

## D20. Tasks are enqueued as they pass validation

Validating a task means building it and running its tests with the gold patch. That takes from one minute to an hour, and a full pool takes many hours across two machines. The runner's `--valid-report` mode enqueues each task once any validation report marks it valid, and it keeps polling until every pool task has a verdict. This is sound because validation never involves a model or an arm, so the order in which tasks enter the queue tells us nothing about either arm. Every enqueue batch is written to the ledger.

## D21. Environment snapshots

`integrity/snapshot_env.py` saves the Flagsmith environment document at the start of the run, every 15 minutes during it, and at the end. It removes the organisation and project names first, and it writes each snapshot's SHA-256 and a summary of the routing flags to the run's ledger. If the flag or the split changed mid-run, the snapshots would show it.

## D22. Experiment 1 grows by amendment to clear Flagsmith's 50-per-variant floor

Flagsmith reports no inference for a metric until each variant has 50 identities (`RESULTS_MIN_IDENTITIES_PER_VARIANT` in the Flagsmith API source). The fresh pool would give about 43 per arm, so the decision rule's Flagsmith condition could never pass. `prereg/experiment-1-amendment-1.md` adds the next 80 pre-cutoff tasks from the same seeded order. It was written after three tasks had finished, and before any result per arm had been seen. The fresh tier is still reported on its own. Experiment 2 is sized from the start to clear the floor.

## D23. Flags as code are read-only during an experiment

`infra/flagsmith/` describes the flags, the lanes_v1 variant, the environment defaults and the experiment's segment override as Terraform, but it is only ever planned, never applied. An apply in the middle of a run would publish new feature-state versions on the flag the experiment is splitting, and could reset parts the provider cannot express (the variant key and the per-segment weights) that the CLI scripts set. So the scripts in `flagsmith/` stay the only writers, and `make flags-drift` runs a read-only plan that must report no changes. Each check can be appended to the run's ledger as a `config` record with the plan's hash, so the ledger shows that the flag configuration matched the committed code during the run.

## D24. The live board shows running totals per arm

The board at https://forkbill.prashantthakur.dev went live at 05:55Z on 2026-11-27, with exp1 89 tasks in. From then on it shows each arm's tasks, solves and spend as the run goes, so the operator sees interim figures too. This can't move the result: the decision rule, the margin, the pools and the stopping rule (every task in both pools done, excluded or invalid) are fixed in the registration, and there is no early stop. The verdict section stays empty until the analysis script runs at the end.

## D25. Ending experiment 1 and making the winner the flag's own value

Experiment 822 was ended through the API at 12:05Z on 2026-11-27 with `rollout_decision=variant` and `rollout_variant` set to the `lanes_v1` option (`POST .../experiments/822/complete/`). Flagsmith applies that by setting the variant's weight to 100% on the environment default and removing the experiment's segment override, so the flag served the `lanes_v1` policy to every identity through a variant weight. The rollout batch ran in that state.

Before experiment 2 was created, the environment value of `agent_routing` was set to the `lanes_v1` policy itself and both variant weights to 0 (`flagsmith flag update agent_routing --value ... --weight lanes_v1=0,lanes_v2=0`). Every identity got the same policy before and after; the change makes the rolled-out winner the flag's own value, which is what experiment 2's control arm is. No experiment was running at the time. `flagsmith/create_experiment.sh` now checks the template's control value against the environment value instead of the project default, because after a rollout the two differ.

## D26. Experiment 2's pool reaches back before March 2026

The 100-task `exp2` pool would have given about 30 valid tasks per arm, below the 50 identities per variant Flagsmith needs before it shows a verdict (D22). `exp2b` adds 110 tasks: the 58 pre-cutoff tasks left after `exp1b`, then 52 tasks created before 2026-03-01, drawn in a separately seeded order from the same stratum. Older tasks are more likely to have been seen in training. Assignment is random, so that affects both arms alike, and `created_month` is reported per arm. The pool was fixed in `prereg/experiment-2.md` before the first task ran.

## D27. A three-task dry run of `lanes_v2` before registration

The draft-review path had never run end to end, so `lanes_v2` ran on 3 pilot tasks outside any experiment (`runs/dryrun-lanes_v2`) before experiment 2 was registered. All three ran to grading and none was solved. The registration was written with that known; the tasks are in no experiment pool and enter no analysis.

## D28. Environment snapshots keep the client-side environment key

Each snapshot under `runs/<exp>/env/` is the Flagsmith environment document, and it contains the environment's client-side key in `api_key`. Flagsmith treats that key as public: it is the one a browser uses to evaluate flags. It is also an input to the bucketing hash, so `integrity/verify_assignment.py` cannot re-derive an arm without it. It therefore stays in the published snapshots, and `.gitleaks.toml` allows exactly that field in exactly those files. Server-side keys (prefix `ser.`), the admin API key and every other credential stay in `.env` and CI secrets only.

Anyone holding a client-side key can send identities and events to the environment, as with any public web app. If that happened during a run, Flagsmith's exposure counts and means would stop matching our own ledger; the agreement check in `analysis/results.md` (our mean cost against Flagsmith's, per arm) is there to show it.

## D29. Secondary analyses added after experiment 1 ended

Four analyses were added on 2026-11-27, after experiment 1 had ended, been decided and been rolled out. None of them is in a registration. They are secondary robustness readings: the registered decision for experiment 1 was made by the rule in `prereg/experiment-1.md` and stands whatever they show, and the same holds for experiment 2, which was registered before they were written. Each runs for `exp2` too once `runs/exp2` is committed. Their figures go into `analysis/out/numbers.json` under `<exp>.secondary`, `frontier` and `integrity.proofs`, and from there into the documents through markers.

When they were written, experiment 1's final readout was already public, by-tier figures included. The running totals had also been on the board during the run, so the order in which results came in was not unknown to the project; that is why the always-valid test takes its only tuning constant from the pilot and not from experiment 1. One count disagrees with an earlier entry: D24 says the board went public at 05:55Z with 89 tasks in, but the exp1 ledger has 94 `task_done` records before 05:55Z. The always-valid analysis takes the time from D24 and the count from the ledger.

1. Always-valid p-values (`analysis/always_valid.py`). The board showed running totals while experiment 1 ran (D24), so the question is what someone watching it could have concluded at any point. The mixture sequential probability ratio test of Johari et al. (2017), with a normal mixing distribution, is replayed in the order tasks finished, for the difference in mean cost per task and for the difference in solve rate. The mixing scale tau was fixed from the pilot runs alone, in code and in this entry, before the experiment 1 trajectory was computed: tau is the absolute difference between the pilot's two arms (lanes_v1 minus control) in mean cost and in solve rate. Nothing is evaluated until each arm has 10 analysed tasks, because the test plugs in a running variance estimate; on simulated null data with skewed costs, starting at two tasks per arm crossed the 0.05 line well over 5% of the time, and starting at ten keeps it under 5% (`tests/unit/test_always_valid.py` checks this). Experiment 2 uses the same pilot tau.
2. Cost against solve rate for every arm (`analysis/frontier.py`), following Kapoor et al. (2024): the pilot arms, both arms of experiment 1, the rollout batch and the experiment 2 arms when they exist, each with bootstrap intervals, and the arms no other arm beats on both axes marked. Dry runs are left out: they have two or three tasks each and ran on a harness that changed between them (D16 to D18). The batches use different task pools, so a comparison across batches describes them and tests nothing.
3. Merkle inclusion proofs (`integrity/merkle.py`, `integrity/prove.py`). Any one `task_done` record can be shown to be under the published root with a short audit path, as in Certificate Transparency. The tree rule is the one already published (raw leaves, an odd node paired with itself), which is not RFC 6962's rule; the root does not change.
4. A specification curve (`analysis/multiverse.py`), after Gelman and Loken (2013). The two decision quantities, the change in cost per solved task and the guardrail posterior P(Δsolve > −m), are recomputed for every combination of five choices an analyst could reasonably have made differently: task set (all, fresh tier, pre-cutoff tier), which attempt of a repeated identity is kept (last, first), the cost statistic (mean, median, 10% trimmed mean), the solve-rate prior (Beta(1,1), Beta(0.5,0.5)) and cost outliers (as recorded, winsorised at the pooled 99th percentile). The by-tier section had already shown that the guardrail falls below its bar on the fresh tier alone, so the curve was expected to fail there, and it is reported either way.
