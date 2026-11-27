import { DocPage } from "../site/DocPage";
import { Code, RepoCode, Section } from "../site/ui";
import { DecisionText } from "../site/DecisionText";
import { ghFile, repo } from "../site/data";

const f = repo.figures;
const V = repo.versions;

const TOC = [
  { id: "receipt", label: "The receipt" },
  { id: "verify", label: "Verify it yourself" },
  { id: "proves", label: "What each check proves" },
  { id: "rules", label: "The hashing rules" },
];

const CHECKS: { name: string; cmd: string; proves: string; limit: string }[] = [
  {
    name: "Pre-registration hashes",
    cmd: "sha256sum -c prereg/HASHES.txt",
    proves: "The registered files are byte for byte what was hashed and tagged before the run.",
    limit: "Shows the files were not changed after the tag, not that the tag came first. The git tag dates show that.",
  },
  {
    name: "Ledger hash chain",
    cmd: "uv run python -m integrity.verify_ledger runs/exp1",
    proves: "No finished task was edited, dropped or reordered after it was written.",
    limit: "A ledger rewritten from scratch would chain too. The published Merkle root pins the version you compare against.",
  },
  {
    name: "Merkle root",
    cmd: "uv run python -m integrity.verify_ledger runs/exp1   # prints the root",
    proves: "One hash stands for every task_done record. If it matches the receipt, you have the same tasks.",
    limit: "Covers finished tasks, not the raw transcripts, which are published as a release asset.",
  },
  {
    name: "Every arm, recomputed",
    cmd: "uv run python -m integrity.verify_assignment --run runs/exp1",
    proves: "Each task ran the arm Flagsmith's own engine gives for its identity. The runner did not pick.",
    limit: "Needs the saved environment document, which the run commits under runs/exp1/env/.",
  },
  {
    name: "Flag snapshots",
    cmd: "ls runs/exp1/env/   # one distinct sha256 across the run",
    proves: "The flag and the split stayed the same from the first snapshot to the last.",
    limit: "Snapshots are taken at intervals. A change and revert between two would still show in the signed webhook history.",
  },
  {
    name: "Terraform drift",
    cmd: "make flags-drift",
    proves: "The live flags match the code in infra/flagsmith/ exactly.",
    limit: "Needs a Flagsmith key for the project, so only the owner can run it live. The result is written to the ledger.",
  },
];

export default function Proof() {
  const prereg = repo.hashes;
  return (
    <DocPage
      path="/proof"
      toc={TOC}
      lead={
        <>
          The run leaves a receipt: hashes that would change if anything were edited afterwards. Every check below is a command you can run on a fresh clone.
        </>
      }
    >
      <Section id="receipt" title="The receipt" kicker="Filled from the repo when this site was built. Experiment 1 lines fill in when its run is committed.">
        <div className="printer proof-printer">
          <div className="printer-slot" aria-hidden="true" />
          <div className="receipt" data-reveal="print">
            <div className="receipt-head">
              <span>Fork in the Bill</span>
              <span>Run receipt</span>
            </div>
            {prereg.map((h) => (
              <div className="receipt-line" key={h.file}>
                <span>{h.file.replace("prereg/", "")}</span>
                <span>{h.sha256}</span>
              </div>
            ))}
            <div className="receipt-cut" aria-hidden="true" />
            {repo.ledgers.map((l) => (
              <div className="receipt-line" key={l.run}>
                <span>
                  {l.run} · {l.taskDone} tasks
                </span>
                <span>{l.merkleRoot}</span>
              </div>
            ))}
            <div className="receipt-line">
              <span>exp1 Merkle root</span>
              <span>{f["integrity.merkle_root"] ? `${f["integrity.merkle_root"]}…` : "pending"}</span>
            </div>
            <div className="receipt-line">
              <span>exp1 task records</span>
              <span>{f["integrity.task_done_records"] ?? "pending"}</span>
            </div>
            <div className="receipt-line">
              <span>Flag snapshots / distinct</span>
              <span>{f["integrity.env_snapshots"] ? `${f["integrity.env_snapshots"]} / ${f["integrity.env_snapshot_distinct_hashes"] ?? "?"}` : "pending"}</span>
            </div>
            {V.flagEngine && (
              <div className="receipt-line">
                <span>flag-engine</span>
                <span>{V.flagEngine}</span>
              </div>
            )}
            <div className="receipt-cut" aria-hidden="true" />
            <p className="receipt-foot">
              Pilot roots recomputed from <code>runs/pilot-*/ledger.jsonl</code> at build time, with the same rule as <code>integrity/merkle.py</code>.
            </p>
          </div>
        </div>
      </Section>

      <Section id="verify" title="Verify it yourself" kicker="From a fresh clone, with Python and uv installed.">
        <Code
          code={`git clone ${repo.site.repo}.git\ncd fork-in-the-bill\nuv sync\n\nsha256sum -c prereg/HASHES.txt\nuv run python -m integrity.verify_ledger runs/pilot-control\nuv run python -m integrity.verify_ledger runs/pilot-lanes_v1\nmake verify          # every committed run: ledgers, roots, assignments`}
          lang="sh"
          caption="shell"
        />
        <p className="prose">
          <code>verify_ledger</code> prints the Merkle root. For the pilot runs it must match the receipt above. <code>make verify</code> runs the same checks
          over every committed run, and CI runs them on every push:
        </p>
        <RepoCode s={repo.snippets.ciVerify!} lang="sh" />
      </Section>

      <Section id="proves" title="What each check proves" kicker="And what it does not.">
        <div className="checks" data-reveal="row">
          {CHECKS.map((c) => (
            <article className="check" key={c.name}>
              <h3>{c.name}</h3>
              <pre className="check-cmd" tabIndex={0}>
                <code>{c.cmd}</code>
              </pre>
              <p>
                <strong>Proves:</strong> {c.proves}
              </p>
              <p className="check-limit">
                <strong>Does not prove:</strong> {c.limit}
              </p>
            </article>
          ))}
        </div>
        <DecisionText id="D21" />
        <DecisionText id="D23" />
      </Section>

      <Section id="rules" title="The hashing rules" kicker="Short enough to re-implement. This site does, to print the pilot roots.">
        <RepoCode s={repo.snippets.ledgerRule!} />
        <RepoCode s={repo.snippets.merkle!} />
        <p className="prose small">
          Full rule in <a href={ghFile("docs/interfaces.md")}>docs/interfaces.md</a>.
        </p>
      </Section>
    </DocPage>
  );
}
