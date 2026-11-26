# Progress

A phase is done only when its gate passes. Evidence is command output, file paths or screenshot paths.

| # | Phase | Status | Gate evidence |
|---|---|---|---|
| 1 | Access: Flagsmith project + CLI login, LLM key, budget cap, VM approval, GitHub repo | done | Flagsmith project `fork-in-the-bill` (id 56673, free plan) reachable through the Admin API; Haiku call succeeded ($0.000004, through `harness/budget.py`); `BUDGET_USD_TOTAL=100` in `.env`; AWS VM approved; public repo created. CLI v2 needs a master API key or `flagsmith login` (rejects legacy user tokens) |
| 2 | Flagsmith smoke test | done | Managed warehouse enabled on Production, first event received 2026-11-26T18:52Z. Smoke flag `fib_smoke` (306164) with keyed variant `treat`, metric 720 (occurrence), experiment 713 started (`running`). 11 identities exposed, both variants served, conversions sent. Results API returned exposures and conversions per variant at 19:59Z (treat 4, control 4; saved in `analysis/flagsmith/smoke/`). The 3 identities tracked before the flush fix have no exposure, which confirms DECISIONS.md D9 |
| 3 | Task pools selected and validated | in progress | pilot validated (9/12, `tasks/pools/dropped.jsonl`); exp1, rollout and exp2 validating on two VMs |
| 4 | Harness, runner, telemetry, ledger, cost; unit and replay tests; dry run 2 tasks per arm | done | CI green; dry run `runs/dryrun5-*` (2 tasks per arm, forced policies, identical caps): control $0.147 + $0.083, both solved; lanes_v1 $0.053 solved + $0.033 unsolved; ledgers verify. Earlier dry runs found the dirty-work-tree patch bug (D15) and that the agent never delegated (D16-D18) |
| 5 | Pilot | done | `runs/pilot-*`, 9 tasks per arm, forced policies: control 5/9 solved at $0.114 mean, lanes_v1 4/9 at $0.072; ledgers verify (Merkle 4ab5f604…, d1f87905…). Report `prereg/pilot-report.md`, power `analysis/out/power.json`. One harness bug found and fixed (malformed tool arguments crashed the task) |
| 6 | Prereg exp1, create and start experiment | done | `prereg/experiment-1.md` sha256 44d715bd… in `prereg/HASHES.txt`, tag `prereg-exp1` (annotated; signing key not available). Flagsmith experiment 822 created with the prereg hypothesis verbatim, started 2026-11-26T23:02:34Z; env snapshot 000-start shows the experiment segment at lanes_v1 50% (`runs/exp1/env/`) |
| 7 | Main run | running | started 23:02Z on the main VM, fed by validation (D20) |
| 8 | Decision, End Experiment, same-flag rollout, fresh batch | blocked on 7 | |
| 9 | Exp2 prereg and run | blocked on 8 | |
| 10 | Analysis, Merkle root, consistency gate | in progress (code) | |
| 11 | Self-hosted portability demo, kit, board polish | in progress | |
| 12 | README, video, rules check, submit | not started | |

## Log

- 2026-11-27: Read Flagsmith experimentation, CLI, statistics and self-hosting docs; Python SDK 6.7 source checked for `get_experiment_flag`, `track_event`, `flush_events`, `close`, `EventProcessorConfig`. Model ids, prices and cutoffs pinned in `harness/pricing.json` (pricing page checked 2026-11-27). Dataset dates counted (see DECISIONS.md D1).
- 2026-11-27: Smoke test found that SDK 6.7 drops the oldest buffered event with max_buffer_items=1; the runner now flushes after every event (DECISIONS.md D9). Metric enums confirmed from the API: aggregation count/sum/mean/occurrence, direction up/down/informational.
- 2026-11-27: Flagsmith CLI v2 authenticated with a master API key; `flagsmith project list` shows `fork-in-the-bill` (phase 1 gate). `flagsmith/setup.sh lanes_v1` created `agent_routing` (306193, value = control policy) with keyed variant `lanes_v1` (37431), `routing_kill` (306194, off), and metrics task_cost 737, task_solved 738, task_turns 739, task_seconds 740. The SDK serves the control policy, it parses, and lanes_v1 differs from it only in `delegate.model`.
- 2026-11-27: Kit verified on self-hosted Flagsmith 2.295.2 (selfhost/README.md, "Verified run"): 120 identities, 538 events stored with none lost, results returned. Accepted literals: expected_direction increase/decrease/not_increase/not_decrease; rollouts must list every variant.
- 2026-11-27: Pools reselected with the final stratum (DECISIONS.md D10): pilot 12, exp1 140, rollout 20, exp2 100. Runner VM up (spot m7i.4xlarge, 1.5 TB gp3, AWS budget alarm $60); Docker Hub allows 100 anonymous pulls per hour from it. Validation running on the VM.
- 2026-11-27: Pilot pool validation finished: 9 of 12 valid once a target test passing before the gold patch no longer disqualifies a task (upstream rule).
- 2026-11-27: Pilot done; m = 20 points and N = the whole valid fresh pool (DECISIONS.md D19). Experiment 1 registered, created (822) and started; main run started with environment snapshots every 15 minutes (D21).
