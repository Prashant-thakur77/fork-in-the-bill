# Decisions

Choices that differ from, or sharpen, the original design. Each one records why.

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

In the original design the delegate answered from preloaded files. Grunt work that's worth delegating (finding call sites, running a test suite, reading a build log) needs a shell, so the delegate gets read-only use of `bash` in the same container, up to 12 turns, and still returns the `{summary, findings[], confidence}` JSON. The main lane never sees the delegate's transcript. The setup is identical in both arms.

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
