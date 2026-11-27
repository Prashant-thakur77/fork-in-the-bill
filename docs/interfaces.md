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
    "by_trait": {"difficulty": {}, "language": {}, "created_month": {}}
  },
  "rollout": {"n": 0, "cost_mean": 0, "solve_rate": 0},
  "exp2": {"...": "same shape as exp1"},
  "integrity": {"merkle_root": "...", "task_done_records": 0, "env_snapshots": 0, "env_snapshot_distinct_hashes": 0}
}
```

where

```
ARM = {"n_exposed", "n_excluded", "n_analysed", "cost_mean", "cost_mean_ci", "cost_median",
       "solve_rate", "solve_rate_ci", "solves", "cost_per_solve", "cost_per_solve_ci",
       "delegate_share_cost", "delegate_share_tokens", "turns_mean", "seconds_mean"}
```

### Number markers

In README.md, analysis/results.md, docs/paper.md and docs/build/deck.html, every figure taken from numbers.json is wrapped as `<!--n:exp1.arms.control.cost_mean:usd2-->$1.23<!--/n-->`. `analysis/render_docs.py` fills the markers, and `analysis/check_consistency.py` re-renders them and fails if any marker is stale. It also fails if a results section contains a bare number with no marker. Formats: `usd2`, `usd4`, `pct1`, `pp1`, `int`, `f3`, `prob1` (probability rendered as a percent), `hash12`.

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
