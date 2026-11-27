// The leaves of a run's Merkle tree, for the page that proves one task is under the published root.
// Read from the run's ledger: every task_done record, in order, with its hash and the few fields
// a reader needs to recognise the task. The records' large payloads are not shipped.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function taskLeaves(root, run) {
  const p = join(root, `runs/${run}/ledger.jsonl`);
  if (!existsSync(p)) return null;
  const leaves = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line || !line.includes('"kind":"task_done"')) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.kind !== "task_done") continue;
    const pl = r.payload ?? {};
    leaves.push({
      i: leaves.length,
      seq: r.seq,
      ts: r.ts,
      identity: String(pl.identity ?? pl.instance_id ?? ""),
      variant: String(pl.variant ?? ""),
      solved: pl.solved === true,
      usd: typeof pl.usd === "number" ? pl.usd : null,
      language: pl.traits?.language ?? null,
      leaf: r.hash,
    });
  }
  return leaves;
}

/** Hex siblings of an exported proof path, whatever shape its steps have. */
export function pathHashes(path) {
  if (!Array.isArray(path)) return null;
  const out = path.map((s) => (typeof s === "string" ? s : Array.isArray(s) ? s.find((x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x)) : s && typeof s === "object" ? (s.hash ?? s.sibling ?? s.node) : null));
  return out.every((h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h)) ? out : null;
}

/**
 * What the page fetches for one run. When the analysis has exported its own proofs
 * (analysis/out/proofs/<run>.json), each leaf also carries that proof's path, so the page can
 * say whether the path it computes is the path that was published.
 */
export function proofFile(root, run, publishedRoot) {
  const leaves = taskLeaves(root, run);
  if (!leaves || !leaves.length) return null;
  const exportedPath = join(root, `analysis/out/proofs/${run}.json`);
  let exported = null;
  if (existsSync(exportedPath)) {
    try {
      const j = JSON.parse(readFileSync(exportedPath, "utf8"));
      exported = Array.isArray(j) ? j : Array.isArray(j.proofs) ? j.proofs : null;
    } catch {
      exported = null;
    }
  }
  if (exported) {
    const byId = new Map(exported.map((e) => [String(e.identity), e]));
    for (const l of leaves) {
      const e = byId.get(l.identity);
      const hashes = e ? pathHashes(e.path) : null;
      if (hashes) l.published = hashes;
    }
  }
  return { run, root: publishedRoot ?? null, exported: !!exported, leaves };
}
