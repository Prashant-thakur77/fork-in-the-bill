import { useEffect, useMemo, useState } from "react";
import { repo } from "./data";
import { batchOf } from "./batches";
import { climb, inclusionPath, proofOf, type PathStep } from "./ledger";
import { format } from "../data/format";

// Prove one task is under the published root. The page fetches the leaves of a run's Merkle tree
// (the hash of every finished task, in order), builds the audit path of the task the reader picks,
// climbs it to a root and compares that with the root in the analysis output. A switch changes one
// character of the task's hash, and the climb ends somewhere else.

interface Leaf {
  i: number;
  seq: number;
  ts: string;
  identity: string;
  variant: string;
  solved: boolean;
  usd: number | null;
  language: string | null;
  leaf: string;
  /** The path the analysis exported for this task, when it has. */
  published?: string[];
}
interface ProofData {
  run: string;
  root: string | null;
  exported: boolean;
  leaves: Leaf[];
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const runLabel = (r: string) => batchOf(r)?.label ?? r;

/** One character of a hash changed: the first hex digit stepped by one. */
function nudge(h: string): string {
  const d = (parseInt(h[0]!, 16) + 1) % 16;
  return d.toString(16) + h.slice(1);
}

export function ProofLab() {
  const runs = repo.proofRuns;
  const [run, setRun] = useState(runs.includes("exp1") ? "exp1" : (runs[0] ?? ""));
  const [data, setData] = useState<Record<string, ProofData | "loading" | "failed">>({});
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<number | null>(null);
  const [tampered, setTampered] = useState(false);
  const [path, setPath] = useState<PathStep[] | null>(null);
  const [nodes, setNodes] = useState<string[] | null>(null);
  const [truth, setTruth] = useState<string[] | null>(null);

  useEffect(() => {
    if (!run || data[run]) return;
    setData((d) => ({ ...d, [run]: "loading" }));
    fetch(`/data/proofs-${run}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ProofData>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => setData((d) => ({ ...d, [run]: j })))
      .catch(() => setData((d) => ({ ...d, [run]: "failed" })));
  }, [run, data]);

  const cur = data[run];
  const set = cur && typeof cur === "object" ? cur : null;
  const shown = useMemo(() => {
    if (!set) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return set.leaves.filter((l) => words.every((w) => `${l.identity} ${l.variant} ${l.language ?? ""} ${l.solved ? "solved" : "unsolved"}`.toLowerCase().includes(w)));
  }, [set, q]);
  const leaf = set && pick !== null ? (set.leaves[pick] ?? null) : null;

  // Build the path for the picked task and climb it, with the real hash and with the changed one.
  useEffect(() => {
    let off = false;
    setPath(null);
    setNodes(null);
    setTruth(null);
    if (!set || !leaf) return;
    void (async () => {
      const p = await inclusionPath(
        set.leaves.map((l) => l.leaf),
        leaf.i,
      );
      const proof = proofOf(p);
      const size = set.leaves.length;
      const real = await climb(leaf.leaf, leaf.i, size, proof);
      const now = tampered ? await climb(nudge(leaf.leaf), leaf.i, size, proof) : real;
      if (off || !real || !now) return;
      setPath(p);
      setTruth(real);
      setNodes(now);
    })();
    return () => {
      off = true;
    };
  }, [set, leaf, tampered]);

  if (!runs.length) return null;
  const rebuilt = nodes ? nodes[nodes.length - 1]! : null;
  const ok = !!rebuilt && !!set?.root && rebuilt === set.root;
  const sameAsExported = leaf?.published && path ? leaf.published.join() === proofOf(path).join() : null;
  const hashed = path ? proofOf(path).length : 0;

  return (
    <section className="vf-sec pf" id="proof" aria-labelledby="pf-h">
      <div className="x2-copy wide">
        <p className="eyebrow-sign">One task</p>
        <h2 id="pf-h" className="kinetic">
          Prove a single task is under the root
        </h2>
        <p>
          The root is one hash over every finished task. To show that one task is part of it you do not need the others: you need its hash and one neighbour per level of
          the tree. Pick a task, and this page climbs from its hash to the root in your browser.
        </p>
      </div>

      <div className="pf-grid">
        <div className="pf-pick">
          <div className="pf-runs" role="group" aria-label="Which run">
            {runs.map((r) => {
              const d = data[r];
              return (
                <button
                  key={r}
                  type="button"
                  className={`rb-btn ${run === r ? "is-on" : ""}`}
                  aria-pressed={run === r}
                  onClick={() => {
                    setRun(r);
                    setPick(null);
                    setTampered(false);
                  }}
                >
                  {runLabel(r)}
                  {d && typeof d === "object" ? ` · ${d.leaves.length} tasks` : ""}
                </button>
              );
            })}
          </div>
          <div className="dec-find">
            <label htmlFor="pf-q">Find a task</label>
            <input id="pf-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="repo name, rust, solved, lanes_v1…" autoComplete="off" spellCheck={false} />
            <p role="status">
              {cur === "loading" || !cur ? "Fetching the leaves…" : cur === "failed" ? "The leaves could not be fetched. The command below does the same check." : `${shown.length} of ${set!.leaves.length} tasks`}
            </p>
          </div>
          <ol className="pf-list" aria-label="Tasks" tabIndex={0} data-own-scroll="">
            {shown.map((l) => (
              <li key={l.i}>
                <button
                  type="button"
                  className={pick === l.i ? "is-on" : ""}
                  aria-pressed={pick === l.i}
                  data-cursor="pick"
                  onClick={() => {
                    setPick(l.i);
                    setTampered(false);
                  }}
                >
                  <span className="pf-id">{l.identity.replace(/^swelive:/, "")}</span>
                  <span className="pf-meta">
                    {l.variant} · {l.solved ? "solved" : "not solved"}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="pf-view" aria-live="polite">
          {!leaf && <p className="pf-empty">Pick a task on the left. Its record, its hash and its path to the root appear here.</p>}
          {leaf && (
            <>
              <dl className="pf-record">
                <div>
                  <dt>Task</dt>
                  <dd>{leaf.identity}</dd>
                </div>
                <div>
                  <dt>Arm</dt>
                  <dd>{leaf.variant}</dd>
                </div>
                <div>
                  <dt>Graded</dt>
                  <dd>{leaf.solved ? "solved" : "not solved"}</dd>
                </div>
                <div>
                  <dt>Cost</dt>
                  <dd>{leaf.usd !== null ? format(leaf.usd, "usd4") : "—"}</dd>
                </div>
                <div>
                  <dt>Ledger record</dt>
                  <dd>
                    seq {leaf.seq}, leaf {leaf.i + 1} of {set!.leaves.length}
                  </dd>
                </div>
              </dl>
              <label className="pf-tamper">
                <input type="checkbox" checked={tampered} onChange={(e) => setTampered(e.target.checked)} />
                <span>Change one character of this task's hash</span>
              </label>

              {path && nodes && truth && (
                <ol className={`pf-ladder ${ok ? "is-ok" : "is-bad"}`} aria-label="The path from the task's hash up to the root">
                  <li className={`pf-step is-root ${ok ? "is-ok" : "is-bad"}`} style={{ ["--i" as string]: path.length + 1 }}>
                    <div className="pf-node">
                      <span className="pf-k">{ok ? "Root rebuilt here: it is the published root" : "Root rebuilt here: not the published root"}</span>
                      <code>{rebuilt}</code>
                      <span className="pf-k">Published in the analysis output</span>
                      <code>{set!.root ?? "not published in this build"}</code>
                    </div>
                  </li>
                  {[...path].reverse().map((s, r) => {
                    const level = path.length - 1 - r;
                    const changed = nodes[level] !== truth[level];
                    return (
                      <li className={`pf-step is-${s.side} ${changed ? "is-changed" : ""}`} key={level} style={{ ["--i" as string]: level + 1 }}>
                        <div className="pf-node">
                          <span className="pf-k">{level === 0 ? "This task's hash" : `Level ${level}`}</span>
                          <code>{short(nodes[level]!)}</code>
                        </div>
                        <div className="pf-sib">
                          <span className="pf-k">{s.self ? "paired with itself" : `neighbour, on the ${s.side}`}</span>
                          <code>{short(s.sibling)}</code>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {path && rebuilt && (
                <p className={`pf-verdict ${ok ? "is-ok" : "is-bad"}`} role="status">
                  {ok
                    ? `${hashed} neighbour hashes took this task to the root that covers all ${set!.leaves.length}. The task is in the published result, unchanged.`
                    : tampered
                      ? "With one character changed, every hash above the task changes and the climb ends at a different root. An edited record cannot be passed off as part of the result."
                      : "The climb does not end at the published root."}
                  {sameAsExported !== null && !tampered ? (sameAsExported ? " It is the same proof the repository's own tool exports for this task (python -m integrity.prove)." : " It differs from the proof the repository's own tool exports for this task.") : ""}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
