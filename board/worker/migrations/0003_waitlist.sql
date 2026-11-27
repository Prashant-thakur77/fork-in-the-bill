-- The updates list: one row per address, with only what the form asks. Nothing else about a
-- person is stored.
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,       -- trimmed and lower-cased
  wants      TEXT    NOT NULL DEFAULT '',   -- what to send: writeup | kit | both
  stack      TEXT    NOT NULL DEFAULT '',   -- optional: what they run their agent on, at most 200 characters
  created_at INTEGER NOT NULL,              -- server unix seconds
  source     TEXT    NOT NULL DEFAULT ''    -- the site path the form was on, e.g. /updates
);

-- Sign-up attempts, for rate limiting only. ip_hash is sha256(secret salt, UTC day, address), so it
-- cannot be turned back into an address. Rows older than one hour are deleted on the next request.
CREATE TABLE IF NOT EXISTS waitlist_attempts (
  ip_hash TEXT    NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS waitlist_attempts_key_at ON waitlist_attempts (ip_hash, at);
CREATE INDEX IF NOT EXISTS waitlist_attempts_at ON waitlist_attempts (at);
