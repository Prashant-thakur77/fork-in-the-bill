-- Flag changes reported by Flagsmith webhooks (environment and audit-log), reduced to what the board shows.
-- Never stored: who made the change (changed_by, author), identity identifiers, audit log text, raw values.
CREATE TABLE IF NOT EXISTS flag_changes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe              TEXT    NOT NULL UNIQUE, -- sha256 of the stored record; rejects replays
  at                  INTEGER NOT NULL,        -- unix seconds of the change (payload timestamp)
  received_at         INTEGER NOT NULL,        -- server unix seconds
  source              TEXT    NOT NULL,        -- "flag" (environment webhook) or "audit"
  event_type          TEXT    NOT NULL,        -- FLAG_UPDATED, FLAG_DELETED, AUDIT_<related_object_type>
  feature             TEXT,
  environment         TEXT,
  scope               TEXT,                    -- environment | segment | identity
  segment             TEXT,                    -- segment name for a segment override
  enabled_before      INTEGER,                 -- 0/1, NULL when unknown
  enabled_after       INTEGER,
  weights_before      TEXT,                    -- JSON [{option_id, pct}]
  weights_after       TEXT,
  value_sha256_before TEXT,                    -- sha256 of the flag value, never the value
  value_sha256_after  TEXT
);
CREATE INDEX IF NOT EXISTS flag_changes_feature_at ON flag_changes (feature, at);
CREATE INDEX IF NOT EXISTS flag_changes_at ON flag_changes (at);
