import { useRef, useState } from "react";
import { Code, Kinetic, PageHead, RepoCode, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { routeFor } from "../site/routes";
import { ghFile, repo } from "../site/data";
import { ProofLab } from "../site/ProofLab";
import { tamper, verifyLedger, type LedgerReport, type RecordCheck } from "../site/ledger";

// A real check, run in the reader's browser: fetch the rollout batch's committed ledger, walk its
// hash chain record by record and rebuild the Merkle root, with the same rule as
// integrity/verify_ledger.py. Then the reader can change one record and run it again.

const RUN = "rollout";
const expected = repo.numbers?.integrity?.by_experiment[RUN] ?? null;
const LEDGER_URL = `/data/${RUN}-ledger.jsonl.gz`;

type Phase = "idle" | "fetching" | "checking" | "done" | "failed";

async function fetchLedger(onBytes: (n: number) => void): Promise<string> {
  const res = await fetch(LEDGER_URL);
  if (!res.ok || !res.body) throw new Error(`could not fetch the ledger (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  onBytes(buf.length);
  // The file is stored gzipped. Some servers also unwrap it in transit; the magic bytes tell.
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  if (!gz) return new TextDecoder().decode(buf);
  if (typeof DecompressionStream === "undefined") throw new Error("this browser cannot unpack gzip; use the command below instead");
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export default function Verify() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<RecordCheck[]>([]);
  const [report, setReport] = useState<LedgerReport | null>(null);
  const [note, setNote] = useState("");
  const [edited, setEdited] = useState<{ seq: number; what: string } | null>(null);
  const text = useRef<string>("");
  const tape = useRef<HTMLOListElement>(null);

  async function run(source: string, wasEdited: { seq: number; what: string } | null) {
    setPhase("checking");
    setRows([]);
    setReport(null);
    setEdited(wasEdited);
    const seen: RecordCheck[] = [];
    const started = performance.now();
    const rep = await verifyLedger(source, async (r) => {
      seen.push(r);
      setRows([...seen]);
      // Let the page paint each line as it is checked, like a receipt printing.
      await new Promise((ok) => requestAnimationFrame(() => ok(null)));
      const t = tape.current;
      if (t) t.scrollTop = t.scrollHeight;
    });
    setReport(rep);
    // Bring the first record that failed into view; otherwise the tape rests at its end.
    requestAnimationFrame(() => {
      const t = tape.current;
      const bad = t?.querySelector<HTMLElement>(".is-bad");
      if (t && bad) t.scrollTop = Math.max(0, bad.offsetTop - t.offsetTop - 60);
    });
    setNote(`${rep.records} records checked in ${((performance.now() - started) / 1000).toFixed(1)} s, in this browser.`);
    setPhase("done");
  }

  async function start() {
    try {
      setPhase("fetching");
      setNote("Fetching the ledger…");
      if (!text.current) text.current = await fetchLedger((n) => setNote(`Fetched ${(n / 1024).toFixed(0)} KB. Unpacking…`));
      await run(text.current, null);
    } catch (e) {
      setPhase("failed");
      setNote(e instanceof Error ? e.message : "The check could not run here.");
    }
  }

  async function breakIt() {
    const target = rows.find((r) => r.kind === "task_done");
    if (!target || !text.current) return;
    const t = tamper(text.current, target.seq);
    if (!t) return;
    await run(t.text, { seq: target.seq, what: t.changed });
  }

  const match = report && expected ? report.merkleRoot === expected.merkle_root : null;
  const busy = phase === "fetching" || phase === "checking";

  return (
    <div className="page-wrap verify-page" ref={root}>
      <PageHead
        route={routeFor("/verify")}
        lead={<>Do not take this site's word for it. This page fetches a real run ledger and checks it on your machine, with the same rule the project's own verifier uses.</>}
      />

      <section className="vf-sec vf-rule" aria-labelledby="vf-how">
        <div className="x2-copy">
          <p className="eyebrow-sign">The rule</p>
          <Kinetic id="vf-how" text="Each record carries the hash of the one before" />
          <p>
            A run writes one line per event: a task finished, an event sent, a flag snapshot. Each line's hash is made from the previous line's hash and its own
            content. Change or remove any line and every hash after it stops matching.
          </p>
          <p>
            The Merkle root is one number built from the hashes of every finished task. It is published with the results, so anyone holding the ledger can rebuild it
            and compare.
          </p>
        </div>
        <div className="vf-chain" aria-hidden="true" data-reveal="draw">
          <svg viewBox="0 0 520 250">
            {[0, 1, 2].map((i) => (
              <g key={i} transform={`translate(${20 + i * 170} 30)`}>
                <rect width="140" height="84" rx="8" className="vf-rec" />
                <text x="12" y="24" className="vf-t">{`seq ${i}`}</text>
                <text x="12" y="46" className="vf-s">prev_hash</text>
                <text x="12" y="66" className="vf-s">payload</text>
                <rect x="84" y="34" width="44" height="14" rx="3" className="vf-prev" />
                <rect x="20" y="96" width="100" height="22" rx="4" className="vf-hash" />
                <text x="70" y="112" textAnchor="middle" className="vf-ht">hash</text>
                {i < 2 && <path d="M120 107 H150 V41 H254" className="vf-link" data-draw="" pathLength="1" strokeDasharray="1" />}
              </g>
            ))}
            <path d="M90 148 V190 H260 M260 148 V190 M430 148 V190 H260 V214" className="vf-tree" data-draw="" pathLength="1" strokeDasharray="1" />
            <rect x="190" y="212" width="140" height="30" rx="6" className="vf-root" />
            <text x="260" y="232" textAnchor="middle" className="vf-rt">Merkle root</text>
          </svg>
        </div>
      </section>

      <section className="vf-sec vf-run" aria-labelledby="vf-run-h">
        <div className="vf-console">
          <div className="vf-head">
            <div>
              <h2 id="vf-run-h">Check the rollout ledger</h2>
              <p>
                <code>runs/{RUN}/ledger.jsonl</code>, as committed{expected ? `: ${expected.task_done_records} finished tasks` : ""}.
                {repo.verifyLedger ? ` About ${Math.round(repo.verifyLedger.gzBytes / 1024)} KB to fetch.` : ""} Nothing is sent anywhere.
              </p>
            </div>
            <div className="vf-btns">
              <button type="button" className="btn btn-dark" onClick={start} disabled={busy} data-cursor="run">
                {phase === "idle" ? "Fetch and check" : busy ? "Checking…" : "Check again"} <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="btn btn-line" onClick={breakIt} disabled={busy || !report || !!edited} data-cursor="break">
                Change one record
              </button>
            </div>
          </div>

          <p className="vf-note" role="status">
            {phase === "idle" ? "Nothing has run yet. Press the button." : note}
          </p>

          <div className="vf-printer">
            <div className="printer-slot" aria-hidden="true" />
            <ol className="vf-tape" ref={tape} aria-label="Records checked" tabIndex={0}>
              {rows.length === 0 && <li className="vf-empty">seq · kind · hash stored in the ledger · hash recomputed here</li>}
              {rows.map((r) => (
                <li key={r.line} className={r.ok ? "is-ok" : "is-bad"}>
                  <span className="vf-seq">{String(r.seq).padStart(2, "0")}</span>
                  <span className="vf-kind">{r.kind}</span>
                  <span className="vf-what">{r.note}</span>
                  <code className="vf-h">{short(r.stored)}</code>
                  <code className="vf-h">{short(r.recomputed)}</code>
                  <span className="vf-mark">{r.ok ? "match" : r.error}</span>
                </li>
              ))}
            </ol>
          </div>

          {report && (
            <div className={`vf-verdict ${report.ok && match !== false ? "is-ok" : "is-bad"}`} role="status" data-reveal-now="">
              <p className="vf-verdict-k">{report.ok ? (match === false ? "Chain intact, root differs" : "Chain intact") : "Chain broken"}</p>
              <dl>
                <div>
                  <dt>Merkle root rebuilt here</dt>
                  <dd>
                    <code>{report.merkleRoot}</code>
                  </dd>
                </div>
                {expected && (
                  <div>
                    <dt>Merkle root in the analysis output</dt>
                    <dd>
                      <code>{expected.merkle_root}</code>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Records, finished tasks</dt>
                  <dd>
                    {report.records}, {report.taskDone}
                  </dd>
                </div>
              </dl>
              <p className="vf-verdict-t">
                {edited
                  ? `You changed record ${edited.seq} (${edited.what}). Its stored hash no longer matches its content, so the check fails at that line: ${report.errors[0] ?? ""}. The root above is built from the stored hashes, so it is unchanged; the broken chain is what gives the edit away. Press "Check again" to go back to the real file.`
                  : report.ok && match
                    ? "Every record's hash matches its content and the one before it, and the root you rebuilt is the root published with the results."
                    : report.ok
                      ? "The chain holds, but the root is not the one in this build's analysis output."
                      : report.errors.slice(0, 3).join("; ")}
              </p>
            </div>
          )}
        </div>
      </section>

      <ProofLab />

      <section className="vf-sec vf-full" aria-labelledby="vf-full-h">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">The full check</p>
          <Kinetic id="vf-full-h" text="The same thing, from a clone" />
          <p>
            The browser check covers one small ledger. The repository's commands cover every run, and a second command recomputes every arm with Flagsmith's own
            flag-engine.
          </p>
        </div>
        <div className="vf-cmds">
          <Code
            code={`git clone ${repo.site.repo}.git && cd fork-in-the-bill && uv sync\n\n# hash chain and Merkle root of one run\nuv run python -m integrity.verify_ledger runs/${RUN}\nuv run python -m integrity.verify_ledger runs/exp1\n\n# every recorded arm, recomputed offline from the saved environment\nuv run python -m integrity.verify_assignment --run runs/exp1`}
            lang="sh"
            caption="shell"
          />
          <div>
            <RepoCode s={repo.snippets.recordHash!} />
            <p className="prose small">
              The browser code is <a href={ghFile("board/web/src/site/ledger.ts")}>board/web/src/site/ledger.ts</a>. A test runs it against the Python verifier's output on
              this ledger. Numbers are re-printed the way Python prints them, so the bytes that are hashed are the same.
            </p>
          </div>
        </div>
        <p className="doc-next">
          <Link to="/proof" className="text-link">
            The run receipt and every other check <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>
    </div>
  );
}
