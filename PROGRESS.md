# Progress

A phase is done only when its gate passes. Evidence is command output, file paths or screenshot paths.

| # | Phase | Status | Gate evidence |
|---|---|---|---|
| 1 | Access: Flagsmith project + CLI login, LLM key, budget cap, VM approval, GitHub repo | waiting on owner | |
| 2 | Flagsmith smoke test | blocked on 1 | |
| 3 | Task pools selected and validated | in progress | |
| 4 | Harness, runner, telemetry, ledger, cost; unit and replay tests; dry run 2 tasks per arm | in progress | harness core committed in a19a0a3; 24 unit tests pass |
| 5 | Pilot | blocked on 1, 3, 4 | |
| 6 | Prereg exp1, create and start experiment | blocked on 5 | |
| 7 | Main run | blocked on 6 | |
| 8 | Decision, End Experiment, same-flag rollout, fresh batch | blocked on 7 | |
| 9 | Exp2 prereg and run | blocked on 8 | |
| 10 | Analysis, Merkle root, consistency gate | in progress (code) | |
| 11 | Self-hosted portability demo, kit, board polish | in progress | |
| 12 | README, video, compliance check, competitor re-scan, submit | not started | |

## Log

- 2026-11-27: Read Flagsmith experimentation, CLI, statistics and self-hosting docs; Python SDK 6.7 source checked for `get_experiment_flag`, `track_event`, `flush_events`, `close`, `EventProcessorConfig`. Model ids, prices and cutoffs pinned in `harness/pricing.json` (pricing page checked 2026-11-27). Dataset dates counted (see DECISIONS.md D1).
