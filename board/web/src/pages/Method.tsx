import { DocPage } from "../site/DocPage";
import { Blocks, Section } from "../site/ui";
import { DecisionText } from "../site/DecisionText";
import { ghFile, pct, repo, type Block } from "../site/data";

const P = repo.prereg;
const A = repo.amendment;
const power = repo.power;
const man = repo.manifest;

/** "At 45 tasks per arm" in the prereg, "at 70 tasks per arm" in the amendment. */
function perArm(blocks: Block[]): number | null {
  for (const b of blocks) {
    const t = b.type === "p" ? b.text : b.type === "list" ? b.items.join(" ") : "";
    const m = /at (\d+) tasks per arm/i.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}
const registeredN = perArm(P.power);
const amendedN = perArm(A.power);
const pilotTable = repo.pilotReport.filter((b) => b.type === "table");

const TOC = [
  { id: "registration", label: "The registration" },
  { id: "rule", label: "Decision rule" },
  { id: "margin", label: "The margin m" },
  { id: "power", label: "Power" },
  { id: "pools", label: "Task pools" },
  { id: "validation", label: "Validation and order" },
  { id: "exclusions", label: "Exclusions and stopping" },
  { id: "pilot", label: "After the pilot" },
  { id: "amendment", label: "The amendment" },
  { id: "after", label: "After the decision" },
];

export default function Method() {
  return (
    <DocPage
      path="/method"
      toc={TOC}
      lead={
        <>
          Everything that decides the verdict was written down, hashed and tagged before the first task of the main run. This page quotes those files.
          Where the amendment and the original differ, the amendment wins.
        </>
      }
    >
      <Section id="registration" title="The registration" kicker="Two files, hashed in prereg/HASHES.txt and tagged in git before they applied.">
        <ul className="hash-list" data-reveal="row">
          {repo.hashes.map((h) => (
            <li key={h.file}>
              <a href={ghFile(h.file)} rel="noopener" className="hash-file">
                {h.file}
              </a>
              <code className="hash-val">{h.sha256}</code>
            </li>
          ))}
        </ul>
        <p className="prose small">
          Check a file yourself: <code>sha256sum prereg/experiment-1.md</code> must print the first line above.
        </p>
        {repo.hypothesis && (
          <>
            <h3>Hypothesis, as registered</h3>
            <blockquote className="hypothesis">
              <p>{repo.hypothesis}</p>
            </blockquote>
          </>
        )}
        <h3>Question</h3>
        <Blocks blocks={P.question} base="prereg/" />
      </Section>

      <Section id="rule" title="The decision rule" kicker="Three conditions. All must hold, or control stays.">
        <Blocks blocks={P.decisionRule} base="prereg/" className="prose rule-prose" />
        <h3>Metrics</h3>
        <Blocks blocks={P.metrics} base="prereg/" />
      </Section>

      <Section id="margin" title="The margin m" kicker="How much solve rate lanes_v1 may lose and still pass rule 2.">
        {power && (
          <p className="big-figure" data-reveal="stamp">
            m = {Math.round(power.m * 100)} <small>percentage points</small>
          </p>
        )}
        <DecisionText id="D19" />
      </Section>

      <Section id="power" title="Power" kicker={power ? `From analysis/power.py on the ${power.pilot.n} pilot tasks, ${power.sims} simulations, seed ${power.seed}.` : undefined}>
        <Blocks blocks={P.power} base="prereg/" />
        {power && (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Power by tasks per arm">
            <table className="data-table">
              <caption className="sr-only">Power by tasks per arm, from analysis/out/power.json</caption>
              <thead>
                <tr>
                  <th scope="col">Tasks per arm</th>
                  <th scope="col" className="num">
                    Smallest detectable solve drop
                  </th>
                  <th scope="col" className="num">
                    Smallest detectable cost cut
                  </th>
                  <th scope="col" className="num">
                    Power at the pilot's cost effect
                  </th>
                  <th scope="col" className="num">
                    Rule 2 pass rate, no true drop
                  </th>
                </tr>
              </thead>
              <tbody>
                {power.grid
                  .filter((r) => r.n_per_arm <= 100)
                  .map((r) => {
                    const tag = r.n_per_arm === registeredN ? "registered" : r.n_per_arm === amendedN ? "amendment" : "";
                    return (
                      <tr key={r.n_per_arm} className={tag ? "is-hl" : ""}>
                        <th scope="row">
                          {r.n_per_arm}
                          {tag && <span className="row-tag">{tag}</span>}
                        </th>
                        <td className="num">{r.mde_solve_pp.toFixed(1)} pp</td>
                        <td className="num">{Math.round(r.mde_cost_pct)}%</td>
                        <td className="num">{pct(r.power_at_pilot_cost_effect, 1)}</td>
                        <td className="num">{pct(r.guardrail_pass_rate, 1)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <p className="prose small">
          Source: <a href={ghFile("analysis/out/power.json")}>analysis/out/power.json</a>. Larger sizes up to {power?.grid[power.grid.length - 1]?.n_per_arm} per arm
          are in the file.
        </p>
      </Section>

      <Section id="pools" title="Task pools" kicker={man ? `Seeded (seed ${man.seed}), disjoint, and pinned to one dataset revision.` : undefined}>
        {man && (
          <>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Task pools">
              <table className="data-table">
                <caption className="sr-only">Task pools from tasks/pools/manifest.json</caption>
                <thead>
                  <tr>
                    <th scope="col">Pool</th>
                    <th scope="col" className="num">
                      Tasks
                    </th>
                    <th scope="col" className="num">
                      Languages
                    </th>
                    <th scope="col">File sha256</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(man.pools).map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">
                        <code>{k}</code>
                      </th>
                      <td className="num">{v.count}</td>
                      <td className="num">{v.languages}</td>
                      <td>
                        <code>{v.sha256.slice(0, 16)}…</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="prose">
              Stratum: the fix touches {man.stratum.min_gold_files} to {man.stratum.max_gold_files} files and at most {man.stratum.max_gold_lines} changed
              lines; problem statements under {man.stratum.max_problem_chars.toLocaleString("en-US")} characters. Fresh tier: created on or after{" "}
              {man.freshFrom}. Pre-cutoff tier: from {man.preFrom}. Dataset revision <code>{man.revision?.slice(0, 12)}</code>.
            </p>
          </>
        )}
        <DecisionText id="D1" />
        <DecisionText id="D10" />
      </Section>

      <Section id="validation" title="Validation and order" kicker="Each task is built and its gold patch tested before any model sees it.">
        <Blocks blocks={P.units} base="prereg/" />
        <DecisionText id="D20" />
      </Section>

      <Section id="exclusions" title="Exclusions and stopping" kicker="What may be dropped, and when the run ends.">
        <h3>Exclusions</h3>
        <Blocks blocks={P.exclusions} base="prereg/" />
        <h3>Stopping</h3>
        <Blocks blocks={P.stopping} base="prereg/" />
        <h3>About task_seconds</h3>
        <Blocks blocks={P.seconds} base="prereg/" />
      </Section>

      <Section id="pilot" title="What the pilot decided" kicker="Arms forced by the runner, a disjoint pool, no Flagsmith exposure. Used only to set N and m.">
        {pilotTable[0] && <Blocks blocks={[pilotTable[0]]} />}
        <p className="prose small">
          Source: <a href={ghFile("prereg/pilot-report.md")}>prereg/pilot-report.md</a>, generated by <code>analysis/pilot_report.py</code>.
        </p>
        <DecisionText id="D16" />
        <DecisionText id="D17" />
      </Section>

      <Section id="amendment" title="The amendment" kicker="More tasks so that Flagsmith can give a verdict at all.">
        <h3>Why</h3>
        <Blocks blocks={A.why} base="prereg/" />
        <h3>What was known when it was written</h3>
        <Blocks blocks={A.known} base="prereg/" />
        <h3>Change</h3>
        <Blocks blocks={A.change} base="prereg/" />
        <h3>Power at the new size</h3>
        <Blocks blocks={A.power} base="prereg/" />
      </Section>

      <Section id="after" title="After the decision" kicker="The rollout and the second experiment.">
        <Blocks blocks={P.after} base="prereg/" />
        <DecisionText id="D24" />
      </Section>
    </DocPage>
  );
}
