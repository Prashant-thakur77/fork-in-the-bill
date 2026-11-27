import { useRef, type ReactNode } from "react";
import { Kinetic, PageHead, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { ROUTES, routeFor } from "../site/routes";
import { ghFile, repo } from "../site/data";
import { format } from "../data/format";
import { Led } from "../led/Led";
import { batchOf } from "../site/batches";

// How big the project is. Every figure is counted from the repository when the site is built
// (scripts/scale-data.mjs) or read from analysis/out/numbers.json. Each one says what it counts
// and links to the files it was counted from.

const S = repo.scale;
const T = S.totals;
const N = repo.numbers;
const n = (v: number) => v.toLocaleString("en-US");
const roots = N?.integrity ? Object.keys(N.integrity.by_experiment).length : 0;
const ciJobs = S.ci.reduce((k, w) => k + w.jobs.length, 0);
const testFns = S.tests.python + S.tests.typescript;

export interface Figure {
  /** The count's name; when numbers.json supplied it, the source link points there. */
  field?: string;
  value: string;
  label: string;
  counts: ReactNode;
  src: string;
  srcLabel?: string;
}

/** The figures the home page strip shows; the same values as on this page. */
export const HEADLINE: Figure[] = [
  { field: "tests", value: n(T.tests), label: "test results read by the grader", counts: "Every test the grader ran in a fresh container after an agent stopped, summed over all task attempts.", src: "runs" },
  { field: "attempts", value: n(T.attempts), label: "task attempts on real bug fixes", counts: "One line in a run's tasks.jsonl is one attempt at one real issue.", src: "runs" },
  { field: "calls", value: n(T.calls), label: "model calls, each one priced", counts: "One line in a run's calls.jsonl is one call, with its tokens and its cost.", src: "runs" },
  { value: n(S.code.lines), label: "lines of code and docs", counts: "Lines in the files git tracks, leaving out data, generated output and lock files.", src: "board/web/scripts/scale-data.mjs" },
];

function Fig({ f, big = false }: { f: Figure; big?: boolean }) {
  return (
    <li className={`sc-fig ${big ? "is-big" : ""}`}>
      <span className="sc-v" data-count="">
        {f.value}
      </span>
      <span className="sc-l">{f.label}</span>
      <span className="sc-c">{f.counts}</span>
      {f.field && S.fromNumbers.includes(f.field) ? (
        <a className="sc-src" href={ghFile("analysis/out/numbers.json")}>
          analysis/out/numbers.json <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <a className="sc-src" href={ghFile(f.src)}>
          {f.srcLabel ?? f.src} <span aria-hidden="true">↗</span>
        </a>
      )}
    </li>
  );
}

const RUN_FIGS: Figure[] = [
  { field: "tasks", value: n(T.tasks), label: "tasks run", counts: "Tasks per run, added up over the runs; a dry run can repeat a task from an earlier one.", src: "tasks/pools" },
  { field: "repos", value: n(T.repos), label: "repositories", counts: "Open-source repositories the issues come from.", src: "tasks/pools/manifest.json" },
  { field: "languages", value: n(T.languageCount), label: "languages", counts: T.languages.length ? T.languages.join(", ") : "Programming languages of the issues' repositories.", src: "tasks/pools/manifest.json" },
  { value: n(T.solved), label: "attempts graded as solved", counts: "Every target test passes and no passing test broke, in a fresh container.", src: "runner/grading.py" },
  { field: "tokens", value: n(T.tokens), label: "tokens through the models", counts: "Input, cached and output tokens over every recorded call.", src: "harness/pricing.json", srcLabel: "priced with harness/pricing.json" },
  { field: "events", value: n(T.events), label: "events sent to Flagsmith", counts: "Cost, turns, seconds and solves, each with the identity that was exposed.", src: "harness/events.py" },
];

const PROOF_FIGS: Figure[] = [
  { field: "ledger", value: n(T.ledger), label: "ledger records", counts: "Hash-chained lines across every run's ledger.jsonl. Change one and every later hash breaks.", src: "integrity/ledger.py" },
  { value: n(roots), label: "Merkle roots published", counts: "One per run, over its finished tasks, in the analysis output.", src: "analysis/out/numbers.json" },
  { field: "envSnapshots", value: n(T.envSnapshots), label: "environment snapshots", counts: "Flagsmith's full flag configuration, saved at the start, every 15 minutes and at the end of a run.", src: "integrity/snapshot_env.py" },
  { field: "transcripts", value: n(T.transcripts), label: "task transcripts published", counts: "The planner's transcript and the graded patch of each attempt.", src: "runs/exp1/transcripts" },
  { field: "preregCount", value: n(S.preregCount), label: "registrations tagged", counts: S.tags.prereg.join(", ") || "pre-registration files hashed before their runs", src: "prereg/HASHES.txt" },
  ...(N?.integrity?.by_experiment.exp1?.assignment
    ? [
        {
          value: `${n(N.integrity.by_experiment.exp1.assignment.matched)} of ${n(N.integrity.by_experiment.exp1.assignment.checked)}`,
          label: "arms re-derived offline",
          counts: "Experiment 1's recorded arms, recomputed with Flagsmith's flag-engine from the saved environment.",
          src: "integrity/verify_assignment.py",
        },
      ]
    : []),
];

const BUILD_FIGS: Figure[] = [
  { value: n(testFns), label: "test functions", counts: `${n(S.tests.python)} in Python and ${n(S.tests.typescript)} in TypeScript, counted by name in the test files.`, src: "tests" },
  { value: n(ciJobs), label: "CI jobs", counts: S.ci.flatMap((w) => w.jobs).join(", "), src: ".github/workflows" },
  { field: "exampleCount", value: n(S.exampleCount), label: "runnable examples", counts: "Each with a script and its captured output.", src: "examples" },
  { field: "packageCount", value: n(S.packageCount), label: "npm packages", counts: S.packages.map((p) => `${p.name} ${p.version}`).join(", "), src: "kit" },
  { value: n(S.tags.releases.length), label: "releases", counts: S.tags.releases.join(", "), src: "CHANGELOG.md" },
  { value: n(ROUTES.length), label: "pages on this site", counts: "Each prerendered to its own file, so it reads without JavaScript.", src: "board/web/src/site/routes.ts" },
];

export default function Scale() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  const maxLines = Math.max(...S.code.byLang.map((l) => l.lines), 1);
  const spend = N?.spend?.total_usd;
  return (
    <div className="page-wrap scale-page" ref={root}>
      <PageHead
        route={routeFor("/scale")}
        lead={
          <>
            Two arms and one flag, and behind them {n(T.attempts)} task attempts, {n(T.tests)} test results and {n(T.calls)} priced model calls. Every figure here is counted
            from the repository when the site is built.
          </>
        }
      />

      <section className="sc-wall" aria-label="The four largest figures">
        <ul>
          {HEADLINE.map((f) => (
            <Fig key={f.label} f={f} big />
          ))}
        </ul>
      </section>

      <section className="sc-sec" aria-labelledby="sc-runs">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">The runs</p>
          <Kinetic id="sc-runs" text="Every batch, from the first dry run" />
          <p>A batch is a run directory. Its files are the only source: one line per attempt, per model call and per ledger record.</p>
        </div>
        <div className="sc-sign" data-reveal="hang">
          <span className="ph-tab">Batches</span>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Counts per batch">
            <table>
              <caption className="sr-only">Counts per batch, from the files in runs/</caption>
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Solved</th>
                  <th scope="col">Tests read</th>
                  <th scope="col">Model calls</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Ledger records</th>
                </tr>
              </thead>
              <tbody>
                {S.groups.map((g) => (
                  <tr key={g.key}>
                    <th scope="row">
                      {g.label}
                      {g.runs.length > 1 && <small> {g.runs.length} runs</small>}
                    </th>
                    <td>{n(g.attempts)}</td>
                    <td>{n(g.solved)}</td>
                    <td>{n(g.tests)}</td>
                    <td>{n(g.calls)}</td>
                    <td>{n(g.tokens)}</td>
                    <td>{n(g.ledger)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">All {T.runs} runs</th>
                  <td>{n(T.attempts)}</td>
                  <td>{n(T.solved)}</td>
                  <td>{n(T.tests)}</td>
                  <td>{n(T.calls)}</td>
                  <td>{n(T.tokens)}</td>
                  <td>{n(T.ledger)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!S.groups.some((g) => g.key === "exp2") && batchOf("exp2")?.state === "open" && (
            <p className="sc-sign-note">
              Experiment 2 is running and its records are not committed yet, so it is not in these counts. <Link to="/live">Its running totals are on the live board</Link>.
            </p>
          )}
        </div>
        <ul className="sc-grid">
          {RUN_FIGS.map((f) => (
            <Fig key={f.label} f={f} />
          ))}
        </ul>
      </section>

      {spend !== undefined && (
        <section className="sc-sec sc-bill live-sec" aria-labelledby="sc-bill">
          <div className="sc-bill-inner">
            <div className="hsec-copy">
              <p className="eyebrow-sign is-dark">The bill</p>
              <Kinetic id="sc-bill" text="What all of that cost in model calls" />
              <p>
                The sum of every priced call across every run, failed attempts included. Each task is capped, so a pool has a known worst case before it starts.{" "}
                <a href={ghFile("analysis/out/numbers.json")}>analysis/out/numbers.json</a>
              </p>
            </div>
            <div className="sc-bill-led">
              <div className="led-housing">
                <span className="led-caption">Total model spend, all runs</span>
                <Led text={format(spend, "usd2")} cols={44} align="center" label={`${format(spend, "usd2")} total model spend`} />
              </div>
              <dl>
                {Object.entries(N!.spend!.by_experiment)
                  .filter(([k]) => ["exp1", "rollout"].includes(k))
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k === "exp1" ? "Experiment 1" : "Rollout batch"}</dt>
                      <dd>{format(v, "usd2")}</dd>
                    </div>
                  ))}
                <div>
                  <dt>Per attempt, on average</dt>
                  <dd>{format(spend / Math.max(1, T.attempts), "usd4")}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      )}

      <section className="sc-sec" aria-labelledby="sc-proof">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">The evidence</p>
          <Kinetic id="sc-proof" text="What was kept so it can be checked" />
        </div>
        <ul className="sc-grid">
          {PROOF_FIGS.map((f) => (
            <Fig key={f.label} f={f} />
          ))}
        </ul>
        <p className="doc-next">
          <Link to="/verify" className="text-link">
            Check a ledger and one task's proof in your browser <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>

      <section className="sc-sec" aria-labelledby="sc-code">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">The build</p>
          <Kinetic id="sc-code" text={`${n(S.code.lines)} lines in ${n(S.code.files)} files`} />
          <p>
            Lines in the files git tracks, by language. Run records, analysis output, task pools, rendered transcripts and lock files are left out, because they are data,
            not code.
          </p>
        </div>
        <ol className="sc-lanes" aria-label="Lines by language">
          {S.code.byLang.map((l) => (
            <li key={l.lang}>
              <span className="sc-lane-name">{l.lang}</span>
              <span className="sc-lane-road" aria-hidden="true">
                <i style={{ width: `${Math.max(2, (l.lines / maxLines) * 100).toFixed(1)}%` }} />
              </span>
              <span className="sc-lane-n">
                <b>{n(l.lines)}</b> lines · {n(l.files)} files
              </span>
            </li>
          ))}
        </ol>
        <ul className="sc-grid">
          {BUILD_FIGS.map((f) => (
            <Fig key={f.label} f={f} />
          ))}
        </ul>
        <p className="prose small">
          The counter is <a href={ghFile("board/web/scripts/scale-data.mjs")}>board/web/scripts/scale-data.mjs</a>. It runs on every build, so these figures move when the
          repository does.
        </p>
      </section>
    </div>
  );
}
