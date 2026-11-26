-- ClickHouse schema for Fork in the Bill.
--
-- Two sources feed ClickHouse:
--   1. Live spans. The OTel Collector's clickhouse exporter creates and fills
--      otel.otel_traces itself (create_schema: true in otel/collector.yaml), so it
--      is not defined here. Span attributes land in the SpanAttributes map as strings:
--        model call spans: gen_ai.request.model, gen_ai.response.model,
--          gen_ai.usage.input_tokens, gen_ai.usage.output_tokens, fib.cache_read_tokens,
--          fib.cache_write_tokens, fib.usd, fib.lane, fib.policy, fib.variant, fib.task_identity
--        task spans (SpanName = 'fib.task'): fib.identity, fib.experiment, fib.variant,
--          fib.policy, fib.outcome, fib.solved, fib.usd, fib.usd_main, fib.usd_delegate, fib.turns
--      The Grafana dashboard reads these live.
--   2. Run logs. runs/<exp>/{calls,tasks,ledger}.jsonl load into the fib.* tables below,
--      whose columns match CallRecord, TaskRecord and LedgerRecord in harness/schema.py
--      one for one, plus an `experiment` column where the record does not carry it:
--        S="--date_time_input_format=best_effort --input_format_json_read_objects_as_strings=1"
--        clickhouse-client $S --query "INSERT INTO fib.calls SELECT 'exp1', *, now64(3)
--          FROM input('task_identity String, lane String, model String, turn UInt32,
--          input_tokens UInt64, cache_write_5m_tokens UInt64, cache_write_1h_tokens UInt64,
--          cache_read_tokens UInt64, output_tokens UInt64, usd Float64, latency_s Float64,
--          stop_reason Nullable(String), request_id Nullable(String)') FORMAT JSONEachRow"
--          < runs/exp1/calls.jsonl
--        clickhouse-client $S --query "INSERT INTO fib.tasks FORMAT JSONEachRow" < runs/exp1/tasks.jsonl
--      Nested objects (TaskRecord.policy, traits, tests; LedgerRecord.payload) are stored
--      as JSON text, which input_format_json_read_objects_as_strings=1 allows, so the
--      column set stays stable when those shapes change.

CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS fib;

-- One row per model call (CallRecord).
CREATE TABLE IF NOT EXISTS fib.calls
(
    experiment            LowCardinality(String) DEFAULT '',
    task_identity         String,
    lane                  Enum8('main' = 1, 'delegate' = 2),
    model                 LowCardinality(String),
    turn                  UInt32,
    input_tokens          UInt64,
    cache_write_5m_tokens UInt64,
    cache_write_1h_tokens UInt64,
    cache_read_tokens     UInt64,
    output_tokens         UInt64,
    usd                   Float64,
    latency_s             Float64,
    stop_reason           Nullable(String),
    request_id            Nullable(String),
    ingested_at           DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (experiment, task_identity, turn, lane);

-- One row per finished task (TaskRecord). ReplacingMergeTree keeps the latest attempt
-- when a retried task is loaded again.
CREATE TABLE IF NOT EXISTS fib.tasks
(
    experiment     LowCardinality(String),
    identity       String,
    instance_id    String,
    variant        LowCardinality(String),
    policy         String, -- RoutingPolicy as JSON
    flag_source    Enum8('experiment' = 1, 'kill_switch' = 2, 'fail_closed' = 3, 'dry_run' = 4),
    outcome        Enum8('solved' = 1, 'unsolved' = 2, 'capped_usd' = 3, 'capped_turns' = 4,
                         'capped_seconds' = 5, 'agent_error' = 6, 'infra_error' = 7),
    solved         Bool,
    usd            Float64,
    usd_main       Float64,
    usd_delegate   Float64,
    tokens_main    UInt64,
    tokens_delegate UInt64,
    turns          UInt32,
    delegate_calls UInt32,
    seconds        Float64,
    started_at     DateTime64(6, 'UTC'),
    finished_at    DateTime64(6, 'UTC'),
    trace_id       String,
    traits         String, -- JSON object
    tests          String DEFAULT '{}', -- JSON object: test name -> status
    error          Nullable(String),
    attempt        UInt8 DEFAULT 1,
    ingested_at    DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(attempt)
ORDER BY (experiment, identity);

-- Hash-chained run ledger (LedgerRecord). Append-only; verify with integrity/verify_ledger.py.
CREATE TABLE IF NOT EXISTS fib.ledger
(
    experiment  LowCardinality(String) DEFAULT '',
    seq         UInt64,
    ts          DateTime64(6, 'UTC'),
    kind        Enum8('task_done' = 1, 'event_sent' = 2, 'env_snapshot' = 3,
                      'exclusion' = 4, 'config' = 5, 'kill_switch' = 6),
    payload     String, -- JSON object, canonical form not guaranteed; hash from the JSONL file
    prev_hash   FixedString(64),
    hash        FixedString(64),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (experiment, seq);
