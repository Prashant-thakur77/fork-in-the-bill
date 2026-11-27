# Interfaces

Contracts between the components. Types live in `harness/schema.py` and `tasks/model.py`; this page covers the files and wire formats around them.

## Run directory

```
runs/<exp>/                 exp is one of: dryrun, pilot, exp1, rollout, exp2
  tasks.jsonl               one TaskRecord per finished task (harness/schema.py)
  calls.jsonl               one CallRecord per model call
  events.jsonl              one line per Flagsmith event sent: {ts, identity, event, value}
  ledger.jsonl              hash-chained LedgerRecord lines (integrity/ledger.py)
  exclusions.jsonl          {identity, reason, attempts}
  env/                      <nnn>-<label>.json from `flagsmith environment document --json` (000-start.json, ...)
  meta.json                 {experiment, pool_file, pool_sha256, force_policy, flagsmith_experiment_id, started_at}
runs/raw/                   working copies of transcripts and test logs (gitignored)
runs/<exp>/transcripts/     the raw planner transcript and graded patch of every task attempt, published for exp1 and rollout
```

`runs/<exp>/*.jsonl` are committed after a run. `analysis/to_parquet.py` turns them into `analysis/out/parquet/<exp>/*.parquet`.

## Task pools

`tasks/pools/<pool>.jsonl` holds one `TaskInstance` per line, and `tasks/pools/<pool>.txt` holds the instance ids. `tasks/validation_report.json` maps `instance_id -> {valid: bool, reason, f2p_before, f2p_after, p2p_after, seconds}`.

## Ledger

`hash = sha256(prev_hash_hex + canonical_json(payload))`. Here `canonical_json` means `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` encoded as UTF-8. The first record uses `prev_hash = "0" * 64`. The Merkle root is computed over the `hash` of every `task_done` record in `seq` order: leaves are the raw 32-byte digests, a node is `sha256(left + right)`, and an odd node is paired with itself.

## Inclusion proofs

`uv run python -m integrity.prove --run runs/<exp> --task <identity>` prints a `task_done` record, its leaf hash and its audit path, and checks the path against the root published in `numbers.json`. `analysis.analyse` writes every leaf's proof for `exp1`, `rollout` and `exp2` (when committed) to `analysis/out/proofs/<run>.json`:

```json
{"run": "exp1", "size": 146, "root": "...", "rule": "...",
 "leaves": [{"identity": "swelive:...", "seq": 3, "index": 0, "leaf": "...", "path": ["...", "..."]}]}
```

`seq` is the record's sequence number in `ledger.jsonl`, `index` its position among the `task_done` records, and `leaf` its `hash`. `path` holds the sibling hashes from the leaf level up. To check a proof, start from the leaf with `i = index` and `n = size`, and while `n > 1`: if `i` is odd, hash the next path entry followed by the node; if `i` is even and `i + 1 < n`, hash the node followed by the next path entry; otherwise (the last node of an odd level) hash the node with itself, using no path entry. Then `i = i // 2` and `n = (n + 1) // 2`. The path must be used up exactly and the result must equal `root`. This is the tree rule of the [Ledger](#ledger) section; it differs from RFC 6962, which prefixes leaves and nodes and does not pair an odd node with itself.

## Flagsmith events

These are sent per task by `harness/events.py`, using the same identifier as the exposure (`swelive:<instance_id>`).

| event | value | when |
|---|---|---|
| `task_cost` | USD, float | every exposed task, including capped and failed ones |
| `task_solved` | 1 | only when every FAIL_TO_PASS and PASS_TO_PASS test passes |
| `task_turns` | int | every exposed task |
| `task_seconds` | float | every exposed task |

## numbers.json

`analysis/out/numbers.json` is the only source for figures in README.md, analysis/results.md, docs/paper.md, the deck source docs/build/deck.html, the board seed and the video captions. Shape:

```json
{
  "generated_at": "...", "source_commit": "...",
  "spend": {"total_usd": 0, "by_experiment": {"pilot": 0, "exp1": 0}},
  "pilot": {"n": 0, "solve_rate": 0, "cost_mean": 0, "m": 0, "n_per_arm": 0},
  "exp1": {
    "prereg": {"tag": "prereg-exp1", "sha256": "...", "m": 0},
    "arms": {"control": ARM, "lanes_v1": ARM},
    "delta": {"cost_mean": 0, "cost_mean_pct": 0, "cost_mean_ci": [0, 0], "solve_rate_pp": 0,
              "solve_rate_ci": [0, 0], "p_solve_drop_within_m": 0, "cost_per_solve_pct": 0},
    "srm": {"chi2": 0, "p": 0, "flag": false},
    "flagsmith": {"chance_to_beat_control_cost": 0, "lift_cost": 0, "ci_cost": [0, 0],
                  "solve_rate_status": "...", "pulled_at": "..."},
    "agreement": {"cost_mean_abs_diff": {"control": 0, "lanes_v1": 0}},
    "decision": {"ship": "lanes_v1|control", "rule_met": {"flagsmith_95": true, "guardrail_90": true, "no_guardrail_loss": true}},
    "power": {"n_per_arm": 0, "mde_solve_pp": 0, "mde_cost_pct": 0, "guardrail_pass_rate": 0, "power": 0.8},
    "by_tier": {"fresh": {"<arm>": {"n": 0, "solve_rate": 0, "cost_mean": 0, "cost_per_solve": 0}, "delta": {"solve_rate_pp": 0, "p_solve_drop_within_m": 0}}, "pre_cutoff": {}},
    "cuped": {"variance_reduction_pct": 0},
    "by_trait": {"difficulty": {}, "language": {}, "created_month": {}},
    "secondary": {"always_valid": ALWAYS_VALID, "multiverse": MULTIVERSE}
  },
  "rollout": {"n": 0, "cost_mean": 0, "solve_rate": 0},
  "exp2": {"...": "same shape as exp1"},
  "frontier": FRONTIER,
  "projection": {"label": "...", "basis": "...", "per_1000_solved": {"control": 0, "lanes_v1": 0, "saved": 0}},
  "pricing": {"frontier_model": "...", "small_model": "...", "frontier_input_per_mtok": 0, "frontier_output_per_mtok": 0,
              "small_input_per_mtok": 0, "small_output_per_mtok": 0, "frontier_to_small_ratio": 0},
  "scale": SCALE,
  "integrity": {"merkle_root": "...", "task_done_records": 0, "env_snapshots": 0, "env_snapshot_distinct_hashes": 0,
                "by_experiment": {"<run>": {"merkle_root": "...", "task_done_records": 0, "...": "..."}},
                "proofs": {"exp1": {"file": "proofs/exp1.json", "leaves": 0, "verified": 0, "root": "...",
                                    "path_length_max": 0, "bytes": 0}, "rollout": {}}}
}
```

where

```
ARM = {"n_exposed", "n_excluded", "n_analysed", "cost_mean", "cost_mean_ci", "cost_median",
       "solve_rate", "solve_rate_ci", "solves", "cost_per_solve", "cost_per_solve_ci",
       "delegate_share_cost", "delegate_share_tokens", "delegate_cost_mean", "main_cost_mean",
       "turns_mean", "seconds_mean"}
```

`delegate_cost_mean` and `main_cost_mean` are the mean worker-lane and planner-lane dollars per analysed task; they add up to `cost_mean`.

### Secondary analyses added after experiment 1 ended

These four blocks were added after experiment 1 was decided (DECISIONS.md, D29). They are robustness readings, labelled `"label": "secondary"`, and none of them changes a registered decision. Each runs for `exp2` too once `runs/exp2` is committed.

`<exp>.secondary.always_valid` (`analysis/always_valid.py`): the mixture sequential probability ratio test replayed in the order tasks finished.

```
ALWAYS_VALID = {"label", "added_after_exp1", "method", "alpha", "min_per_arm", "order", "tau_rule",
  "n_tasks", "first_evaluated_at", "board_live_after_tasks",
  "pilot": {"pilot_treatment", "pilot_n_control", "pilot_n_treatment", "pilot_delta_cost", "pilot_delta_solve"},
  "cost":  {"tau" (USD), "estimate" (USD), "p_final", "ci_final" (USD), "crossed", "first_cross_at",
            "first_cross_finished_at", "first_cross_estimate", "p_at_board_live"},
  "solve": {"tau" (fraction), "estimate_pp", "p_final", "ci_final_pp", "crossed", "crossed_harmful",
            "first_harmful_cross_at", "p_at_board_live"}}
```

`first_cross_at`, `first_harmful_cross_at`, `first_evaluated_at` and `board_live_after_tasks` count analysed tasks in finishing order. `p_final` is the always-valid p-value after the last task (the running minimum of 1/Λ), and `ci_final` the running intersection of the always-valid intervals. `board_live_after_tasks` is the number of tasks that had finished when the live board went public (D24). `p_at_board_live` is the p-value at that point.

`<exp>.secondary.multiverse` (`analysis/multiverse.py`): the specification curve.

```
MULTIVERSE = {"label", "added_after_exp1", "choices", "m", "guardrail_bar", "bootstrap_resamples", "n_specs",
  "guardrail_pass", "guardrail_pass_share", "guardrail_fail", "cost_direction", "cost_direction_share",
  "cps_ci_below_zero", "cps_ci_below_zero_share", "both", "both_share",
  "cps_change_pct_range", "guardrail_posterior_range", "guardrail_fail_task_sets", "guardrail_fail_only_fresh",
  "fresh_specs", "fresh_specs_failing", "non_fresh_specs_failing",
  "registered": {"cps_change_pct", "guardrail_posterior"},
  "specs": [{"task_set", "attempt", "cost_stat", "prior", "outliers", "registered", "n_control", "n_treatment",
             "cps_change_pct", "cps_change_pct_ci", "guardrail_posterior", "guardrail_pass", "cost_direction",
             "cps_ci_below_zero"}]}
```

Choices: `task_set` is `all`, `fresh` or `pre_cutoff`; `attempt` is `last` or `first`; `cost_stat` is `mean`, `median` or `trimmed10`; `prior` is `beta11` or `beta0505`; `outliers` is `as_is` or `winsorised` (pooled 99th percentile). `cost_direction` means cost per solved task is lower under the treatment; `both` counts specifications where that and the guardrail both hold. The registered specification is first in `specs`.

`frontier` (`analysis/frontier.py`): every arm on one cost-accuracy plane.

```
FRONTIER = {"label", "added_after_exp1", "note", "batches", "order", "n_arms", "n_on_frontier",
  "on_frontier" (labels, cheapest first), "bootstrap_resamples", "seed",
  "arms": {"<batch>_<variant>": {"batch", "variant", "policy", "label", "n", "cost_mean", "cost_mean_ci",
                                 "solve_rate", "solve_rate_ci", "on_frontier"}}}
```

Batches are `pilot` (the `runs/pilot-*` directories pooled by arm), `exp1`, `rollout` and `exp2`; dry runs are left out. The batches used different task pools, so comparisons across them are descriptive.

`integrity.proofs` lists the proof files `analysis.analyse` writes (paths relative to `analysis/out/`), with the leaf count, how many verified against the root, the longest audit path and the file size. The file format is under [Inclusion proofs](#inclusion-proofs).

### Projection, pricing and scale

`projection` is arithmetic on measured figures, not a measurement: `per_1000_solved.<arm>` is 1,000 times `exp1.arms.<arm>.cost_per_solve` in USD, and `saved` is control minus the treatment.

`pricing` is copied from `harness/pricing.json` (USD per million tokens) for the models the experiment 1 arms used: `frontier_model` is the control arm's worker model and `small_model` the treatment arm's. `frontier_to_small_ratio` is the ratio of their input prices.

`scale` counts what is committed, over every run directory under `runs/` (experiment 2 included once committed) unless a key says otherwise. All values are integers.

| Key | Definition |
|---|---|
| `tasks_run`, `tasks_by_batch.<run>` | `task_done` records in the run ledgers |
| `task_attempts`, `task_attempts_by_batch.<run>` | distinct (task, attempt) pairs with a task record or a transcript. One transcript is written per attempt. In `runs/exp1`, four first attempts were cut off by a stopped worker after the agent finished and before the task record was written; their leases were re-queued and the second attempt wrote the record, so 150 transcripts stand behind 146 records |
| `tests_executed`, `tests_executed_by_batch.<run>`, `tests_by_result.<result>` | per-test results the grader recorded (`tests` in each task record: the FAIL_TO_PASS and PASS_TO_PASS entries), summed over task records; `tests_by_result` splits them into pass, fail and skip |
| `model_calls` | lines in `calls.jsonl` |
| `tokens`, `tokens_by_kind.<kind>` | input, output, 5-minute and 1-hour cache-write and cache-read tokens over all calls |
| `ledger_records` | lines in the run ledgers |
| `events_sent` | lines in `events.jsonl`, one per event sent to Flagsmith. The ledger's `event_sent` records group a task's events and miss the three events of the first attempt of `swelive:gui-cs__Terminal.Gui-4860`, so the file is the fuller count |
| `env_snapshots` | files under `runs/*/env/` |
| `transcripts` | files under `runs/*/transcripts/` |
| `repos`, `languages` | distinct `repo` and `language` traits among experiment 1's task records |
| `npm_packages` | `package.json` files under `kit/` without `"private": true` |
| `examples` | directories `examples/NN-*` |
| `unit_tests_python` | functions named `test_*` under `tests/`, counted in the source (a parametrized test counts once) |
| `unit_tests_ts` | `test(` and `it(` calls in the `*.test.ts` files of `board/web`, `board/worker`, `kit/ts` and `kit/mcp` (a call inside a loop counts once) |
| `unit_tests` | `unit_tests_python` plus `unit_tests_ts` |
| `prereg_tags` | registration files (`prereg/experiment-*.md`, amendments included) listed in `prereg/HASHES.txt`, each of which has a `prereg-*` tag; `prereg/pilot-report.md` is hashed there too but has no tag and is not counted |

### Number markers

In README.md, analysis/results.md, docs/paper.md and docs/build/deck.html, every figure taken from numbers.json is wrapped as `<!--n:exp1.arms.control.cost_mean:usd2-->$1.23<!--/n-->`. `analysis/render_docs.py` fills the markers, and `analysis/check_consistency.py` re-renders them and fails if any marker is stale. It also fails if a results section contains a bare number with no marker. Formats: `usd2`, `usd4`, `pct1`, `pp1`, `int`, `f3`, `prob1` (probability rendered as a percent), `hash12`, `p3` (a p-value to three decimals, or `<0.001` below that), and `str` for labels.

The board seed (`board/web/src/seed.json`) and the captions file (`video/captions.json`) store `{"key": "exp1.delta.cost_mean_pct", "fmt": "pct1", "text": "..."}` entries, which are checked the same way.

## Board ingest

`POST https://<board>/ingest` carries the headers `X-FB-Timestamp: <unix seconds>` and `X-FB-Signature: hex(hmac_sha256(BOARD_INGEST_SECRET, ts + "." + raw_body))`. Requests outside a 60-second window are rejected, as are replays of the same signature. Body:

```json
{"experiment": "exp1", "ts": 0, "status": "running|ended|rolled_out",
 "flagsmith_experiment_url": "...",
 "arms": {"control": {"done": 0, "solved": 0, "usd": 0.0, "running": 0},
          "lanes_v1": {"done": 0, "solved": 0, "usd": 0.0, "running": 0}},
 "last_task": {"variant": "lanes_v1", "usd": 0.0, "solved": true, "language": "rust"}}
```

`GET /stream` is SSE, emitting one `snapshot` event with the same aggregate shape on connect and after each ingest. `GET /state` returns the latest snapshot.

## Flag history (Flagsmith webhooks)

`POST https://<board>/flagsmith/webhook` takes Flagsmith's environment webhook (`{"event_type": "FLAG_UPDATED", "data": {...}}`) and its audit-log webhook (`{created_date, log, author, environment, project, related_object_*}`). The header `X-Flagsmith-Signature` must be `hex(hmac_sha256(FLAGSMITH_WEBHOOK_SECRET, raw_body))`; a bad or missing signature gets 401, a body over 64 KiB gets 413. Each delivery is reduced to one row of `flag_changes` (migration `0002`):

```json
{"id": 1, "at": 0, "received_at": 0, "source": "flag|audit", "event_type": "FLAG_UPDATED",
 "feature": "agent_routing", "environment": "Production", "scope": "environment|segment|identity",
 "segment": null, "enabled_before": true, "enabled_after": true,
 "weights_before": [{"option_id": 37431, "pct": 50}], "weights_after": [{"option_id": 37431, "pct": 100}],
 "value_sha256_before": "...", "value_sha256_after": "..."}
```

Never stored: `changed_by`, `author`, identity identifiers, the audit `log` text and raw flag values (they hold policies). A value is kept as the sha256 of the string itself, or of `JSON.stringify(value)` for non-strings. A repeated delivery is stored once. `GET /flags/history?feature=agent_routing[&limit=N]` returns `{"changes": [...]}`, oldest first (at most 100), and `/stream?feature=agent_routing` sends the same body as a `flags` event on connect and after each new change.

## Feature health

`python -m runner.health runs/<exp>` posts `{"feature": "agent_routing", "environment": "Production", "status": "healthy|unhealthy", "reason": {"text_blocks": [{"title", "text"}]}}` to the Flagsmith Feature health webhook in `FLAGSMITH_HEALTH_WEBHOOK_URL` (the URL token is the secret and is never printed). It reads only whether each task ended in `infra_error` and total spend: unhealthy when the `infra_error` rate over the last N tasks is above the threshold, or when spent plus reserved reaches the warning fraction of `BUDGET_USD_TOTAL`. It posts only when the status changes (last sent status in `runs/<exp>/health_state.json`); without the URL it prints the payload as a dry run.

## Budget

`BUDGET_USD_TOTAL` is the hard global cap. It is a Redis key `budget:spent_usd`, incremented with INCRBYFLOAT before each call's committed cost is recorded. Before each model call the worker reserves the call's worst-case cost (max input estimate plus max_tokens output at list price) with a Lua script that refuses the reservation if `spent + reserved + worst_case > cap`. When the call returns, the reservation is settled at actual cost. With no Redis (unit tests, dry runs), a file-locked JSON counter in `runs/budget.json` does the same job.
