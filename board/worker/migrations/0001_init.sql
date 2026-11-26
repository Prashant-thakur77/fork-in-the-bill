-- Latest aggregate snapshot per experiment, as sent by the runner.
CREATE TABLE IF NOT EXISTS snapshots (
  experiment TEXT PRIMARY KEY,
  body       TEXT    NOT NULL,          -- JSON of the ingest payload
  sent_ts    INTEGER NOT NULL,          -- payload "ts"
  updated_at INTEGER NOT NULL,          -- server unix seconds
  version    INTEGER NOT NULL           -- global change counter at write time
);

-- Monotonic change counter; /stream polls this to detect new data.
CREATE TABLE IF NOT EXISTS meta (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (id, version) VALUES (1, 0);

-- Signatures already accepted inside the replay window.
CREATE TABLE IF NOT EXISTS seen_signatures (
  signature TEXT PRIMARY KEY,
  ts        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS seen_signatures_ts ON seen_signatures (ts);
