import type { Snapshot } from "./payload";

export interface StoredSnapshot {
  snapshot: Snapshot;
  version: number;
  updatedAt: number;
}

export interface Store {
  /** Records a signature; returns false if it was already seen (a replay). */
  claimSignature(signature: string, ts: number, nowSeconds: number): Promise<boolean>;
  putSnapshot(snapshot: Snapshot, nowSeconds: number): Promise<number>;
  /** Latest snapshot, for one experiment or the most recently updated one. */
  latest(experiment?: string): Promise<StoredSnapshot | null>;
  version(): Promise<number>;
}

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
}

/** In-memory store with the same semantics, used by the tests. */
export class MemoryStore implements Store {
  private seen = new Map<string, number>();
  private snaps = new Map<string, StoredSnapshot>();
  private v = 0;

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
}
