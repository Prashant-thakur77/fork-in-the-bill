import type { FlagChange, StoredFlagChange } from "./flags";
import type { Snapshot } from "./payload";

export interface StoredSnapshot {
  snapshot: Snapshot;
  version: number;
  updatedAt: number;
}

/** Everything stored about one sign-up, besides when it happened. */
export interface WaitlistEntry {
  email: string;
  /** "writeup", "kit", "both" or empty. */
  wants: string;
  /** What they run their agent on, if they said: at most 200 characters. */
  stack: string;
  /** The site path the form was on. */
  source: string;
}

export interface Store {
  /** Records a signature; returns false if it was already seen (a replay). */
  claimSignature(signature: string, ts: number, nowSeconds: number): Promise<boolean>;
  putSnapshot(snapshot: Snapshot, nowSeconds: number): Promise<number>;
  /** Latest snapshot, for one experiment or the most recently updated one. */
  latest(experiment?: string): Promise<StoredSnapshot | null>;
  version(): Promise<number>;
  /** Records a flag change; returns false if the same change was already stored (a replay). */
  addFlagChange(change: FlagChange, dedupe: string, nowSeconds: number): Promise<boolean>;
  /** The most recent flag changes, oldest first, optionally for one feature. */
  flagHistory(opts?: { feature?: string; limit?: number }): Promise<StoredFlagChange[]>;
  /** Adds an address to the updates list; returns false if it was already there. */
  joinWaitlist(entry: WaitlistEntry, nowSeconds: number): Promise<boolean>;
  /** How many addresses are on the updates list. Addresses themselves are never read back. */
  waitlistCount(): Promise<number>;
  /**
   * Records one sign-up attempt for a hashed address key and returns how many that key has made
   * since `sinceSeconds`, this one included. Records older than `pruneBeforeSeconds` are deleted.
   */
  waitlistAttempt(key: string, nowSeconds: number, sinceSeconds: number, pruneBeforeSeconds: number): Promise<number>;
}

export const HISTORY_LIMIT = 100;

interface FlagRow {
  id: number;
  at: number;
  received_at: number;
  source: string;
  event_type: string;
  feature: string | null;
  environment: string | null;
  scope: string | null;
  segment: string | null;
  enabled_before: number | null;
  enabled_after: number | null;
  weights_before: string | null;
  weights_after: string | null;
  value_sha256_before: string | null;
  value_sha256_after: string | null;
}

const bool = (v: number | null) => (v === null ? null : v === 1);
const fromBool = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

function rowToChange(r: FlagRow): StoredFlagChange {
  return {
    id: r.id,
    at: r.at,
    received_at: r.received_at,
    source: r.source as StoredFlagChange["source"],
    event_type: r.event_type,
    feature: r.feature,
    environment: r.environment,
    scope: r.scope as StoredFlagChange["scope"],
    segment: r.segment,
    enabled_before: bool(r.enabled_before),
    enabled_after: bool(r.enabled_after),
    weights_before: r.weights_before ? JSON.parse(r.weights_before) : null,
    weights_after: r.weights_after ? JSON.parse(r.weights_after) : null,
    value_sha256_before: r.value_sha256_before,
    value_sha256_after: r.value_sha256_after,
  };
}

const clampLimit = (n?: number) => Math.max(1, Math.min(HISTORY_LIMIT, n ?? HISTORY_LIMIT));

// Signatures older than this are pruned; the 60 s timestamp window already rejects them.
const KEEP_SIGNATURES_SECONDS = 300;

interface SnapshotRow {
  body: string;
  version: number;
  updated_at: number;
}

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async claimSignature(signature: string, ts: number, nowSeconds: number): Promise<boolean> {
    const [, insert] = await this.db.batch([
      this.db.prepare("DELETE FROM seen_signatures WHERE ts < ?").bind(nowSeconds - KEEP_SIGNATURES_SECONDS),
      this.db
        .prepare("INSERT INTO seen_signatures (signature, ts) VALUES (?, ?) ON CONFLICT (signature) DO NOTHING")
        .bind(signature, ts),
    ]);
    return (insert?.meta.changes ?? 0) === 1;
  }

  async putSnapshot(snapshot: Snapshot, nowSeconds: number): Promise<number> {
    const results = await this.db.batch<{ version: number }>([
      this.db.prepare("UPDATE meta SET version = version + 1 WHERE id = 1"),
      this.db
        .prepare(
          `INSERT INTO snapshots (experiment, body, sent_ts, updated_at, version)
           VALUES (?1, ?2, ?3, ?4, (SELECT version FROM meta WHERE id = 1))
           ON CONFLICT (experiment) DO UPDATE SET
             body = excluded.body, sent_ts = excluded.sent_ts,
             updated_at = excluded.updated_at, version = excluded.version
           WHERE excluded.sent_ts >= snapshots.sent_ts`,
        )
        .bind(snapshot.experiment, JSON.stringify(snapshot), snapshot.ts, nowSeconds),
      this.db.prepare("SELECT version FROM meta WHERE id = 1"),
    ]);
    return results[2]?.results[0]?.version ?? 0;
  }

  async latest(experiment?: string): Promise<StoredSnapshot | null> {
    const row = experiment
      ? await this.db
          .prepare("SELECT body, version, updated_at FROM snapshots WHERE experiment = ?")
          .bind(experiment)
          .first<SnapshotRow>()
      : await this.db
          .prepare("SELECT body, version, updated_at FROM snapshots ORDER BY version DESC LIMIT 1")
          .first<SnapshotRow>();
    if (!row) return null;
    return { snapshot: JSON.parse(row.body) as Snapshot, version: row.version, updatedAt: row.updated_at };
  }

  async version(): Promise<number> {
    const row = await this.db.prepare("SELECT version FROM meta WHERE id = 1").first<{ version: number }>();
    return row?.version ?? 0;
  }

  async addFlagChange(c: FlagChange, dedupe: string, nowSeconds: number): Promise<boolean> {
    const insert = await this.db
        .prepare(
          `INSERT INTO flag_changes (dedupe, at, received_at, source, event_type, feature, environment, scope, segment,
             enabled_before, enabled_after, weights_before, weights_after, value_sha256_before, value_sha256_after)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
           ON CONFLICT (dedupe) DO NOTHING`,
        )
        .bind(
          dedupe,
          c.at,
          nowSeconds,
          c.source,
          c.event_type,
          c.feature,
          c.environment,
          c.scope,
          c.segment,
          fromBool(c.enabled_before),
          fromBool(c.enabled_after),
          c.weights_before ? JSON.stringify(c.weights_before) : null,
          c.weights_after ? JSON.stringify(c.weights_after) : null,
          c.value_sha256_before,
          c.value_sha256_after,
        )
        .run();
    if ((insert.meta.changes ?? 0) !== 1) return false;
    // Bump the change counter so /stream notices the new row.
    await this.db.prepare("UPDATE meta SET version = version + 1 WHERE id = 1").run();
    return true;
  }

  async flagHistory(opts: { feature?: string; limit?: number } = {}): Promise<StoredFlagChange[]> {
    const limit = clampLimit(opts.limit);
    const cols = `id, at, received_at, source, event_type, feature, environment, scope, segment, enabled_before,
      enabled_after, weights_before, weights_after, value_sha256_before, value_sha256_after`;
    const stmt = opts.feature
      ? this.db
          .prepare(`SELECT ${cols} FROM flag_changes WHERE feature = ? ORDER BY at DESC, id DESC LIMIT ?`)
          .bind(opts.feature, limit)
      : this.db.prepare(`SELECT ${cols} FROM flag_changes ORDER BY at DESC, id DESC LIMIT ?`).bind(limit);
    const { results } = await stmt.all<FlagRow>();
    return results.map(rowToChange).reverse();
  }

  async joinWaitlist(e: WaitlistEntry, nowSeconds: number): Promise<boolean> {
    const insert = await this.db
      .prepare("INSERT INTO waitlist (email, wants, stack, created_at, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING")
      .bind(e.email, e.wants, e.stack, nowSeconds, e.source)
      .run();
    return (insert.meta.changes ?? 0) === 1;
  }

  async waitlistCount(): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM waitlist").first<{ n: number }>();
    return row?.n ?? 0;
  }

  async waitlistAttempt(key: string, nowSeconds: number, sinceSeconds: number, pruneBeforeSeconds: number): Promise<number> {
    const results = await this.db.batch<{ n: number }>([
      this.db.prepare("DELETE FROM waitlist_attempts WHERE at < ?").bind(pruneBeforeSeconds),
      this.db.prepare("INSERT INTO waitlist_attempts (ip_hash, at) VALUES (?, ?)").bind(key, nowSeconds),
      this.db.prepare("SELECT COUNT(*) AS n FROM waitlist_attempts WHERE ip_hash = ? AND at >= ?").bind(key, sinceSeconds),
    ]);
    return results[2]?.results[0]?.n ?? 1;
  }
}

/** In-memory store with the same semantics, used by the tests. */
export class MemoryStore implements Store {
  private seen = new Map<string, number>();
  private snaps = new Map<string, StoredSnapshot>();
  private v = 0;
  private flags: StoredFlagChange[] = [];
  private dedupes = new Set<string>();
  /** The updates list, exposed to tests only so they can check what was stored. */
  readonly waitlist: (WaitlistEntry & { created_at: number })[] = [];
  readonly attempts: { key: string; at: number }[] = [];

  async claimSignature(signature: string, ts: number, nowSeconds: number): Promise<boolean> {
    for (const [s, t] of this.seen) if (t < nowSeconds - KEEP_SIGNATURES_SECONDS) this.seen.delete(s);
    if (this.seen.has(signature)) return false;
    this.seen.set(signature, ts);
    return true;
  }

  async putSnapshot(snapshot: Snapshot, nowSeconds: number): Promise<number> {
    this.v += 1;
    const prev = this.snaps.get(snapshot.experiment);
    if (!prev || snapshot.ts >= prev.snapshot.ts) {
      this.snaps.set(snapshot.experiment, { snapshot, version: this.v, updatedAt: nowSeconds });
    }
    return this.v;
  }

  async latest(experiment?: string): Promise<StoredSnapshot | null> {
    if (experiment) return this.snaps.get(experiment) ?? null;
    let best: StoredSnapshot | null = null;
    for (const s of this.snaps.values()) if (!best || s.version > best.version) best = s;
    return best;
  }

  async version(): Promise<number> {
    return this.v;
  }

  async addFlagChange(change: FlagChange, dedupe: string, nowSeconds: number): Promise<boolean> {
    if (this.dedupes.has(dedupe)) return false;
    this.dedupes.add(dedupe);
    this.flags.push({ ...structuredClone(change), id: this.flags.length + 1, received_at: nowSeconds });
    this.v += 1;
    return true;
  }

  async flagHistory(opts: { feature?: string; limit?: number } = {}): Promise<StoredFlagChange[]> {
    const rows = this.flags
      .filter((c) => !opts.feature || c.feature === opts.feature)
      .sort((a, b) => a.at - b.at || a.id - b.id);
    return rows.slice(-clampLimit(opts.limit));
  }

  async joinWaitlist(e: WaitlistEntry, nowSeconds: number): Promise<boolean> {
    if (this.waitlist.some((r) => r.email === e.email)) return false;
    this.waitlist.push({ ...e, created_at: nowSeconds });
    return true;
  }

  async waitlistCount(): Promise<number> {
    return this.waitlist.length;
  }

  async waitlistAttempt(key: string, nowSeconds: number, sinceSeconds: number, pruneBeforeSeconds: number): Promise<number> {
    for (let i = this.attempts.length - 1; i >= 0; i--) if (this.attempts[i]!.at < pruneBeforeSeconds) this.attempts.splice(i, 1);
    this.attempts.push({ key, at: nowSeconds });
    return this.attempts.filter((a) => a.key === key && a.at >= sinceSeconds).length;
  }
}
