import { DocPage } from "../site/DocPage";
import { Link } from "../site/router";
import { Code, Md, Section } from "../site/ui";
import { LivePanel } from "../site/LivePanel";
import { repo } from "../site/data";

// Every figure here is read from analysis/out/numbers.json at build time (or the board seed made
// from it). Nothing is typed in. Until the file exists, the page shows its empty state.

const f = repo.figures;
const d = repo.decisions;

export function resultsReady(figures: Record<string, string>, decisions: Record<string, string>): boolean {
  return !!decisions["exp1.decision.ship"] && Object.keys(figures).length > 0;
}

type Row = [string, string | undefined, string | undefined, string | undefined];

function Table({ caption, cols, rows }: { caption: string; cols: [string, string, string]; rows: Row[] }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            {cols.map((c) => (
              <th scope="col" key={c} className="num">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, ...vals]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {vals.map((v, i) => (
                <td key={i} className="num">
                  {v ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ruleList = repo.prereg.decisionRule.find((b) => b.type === "list");
const RULE_KEYS = ["flagsmith_95", "guardrail_90", "no_guardrail_loss"];

function Verdict() {
  const ship = d["exp1.decision.ship"]!;
  return (
    <>
      <Section id="exp1" title={ship === "control" ? "Experiment 1: control stays" : `Experiment 1: ${ship} ships`} kicker="Decided by the pre-registered rule.">
        <ol className="rule-list">
          {ruleList?.type === "list" &&
            ruleList.items.map((t, i) => {
              const v = d[`exp1.decision.rule_met.${RULE_KEYS[i]}`];
              const state = v === "true" ? "met" : v === "false" ? "not met" : "pending";
              return (
                <li key={i} className={`rule-row is-quote is-${state.replace(" ", "-")}`}>
                  <span className="rule-n" aria-hidden="true">
                    <b>{i + 1}</b>
                  </span>
                  <span className="rule-text">
                    <Md text={t} />
                  </span>
                  <span className="rule-state">{state}</span>
                </li>
              );
            })}
        </ol>
        <Table
          caption="Experiment 1 results by arm"
          cols={["control", "lanes_v1", "change"]}
          rows={[
            ["Cost per solved task", f["exp1.arms.control.cost_per_solve"], f["exp1.arms.lanes_v1.cost_per_solve"], f["exp1.delta.cost_per_solve_pct"]],
            ["Mean cost per task", f["exp1.arms.control.cost_mean"], f["exp1.arms.lanes_v1.cost_mean"], f["exp1.delta.cost_mean_pct"]],
            ["Solve rate", f["exp1.arms.control.solve_rate"], f["exp1.arms.lanes_v1.solve_rate"], f["exp1.delta.solve_rate_pp"]],
            ["Tasks analysed", f["exp1.arms.control.n_analysed"], f["exp1.arms.lanes_v1.n_analysed"], undefined],
            ["Chance lanes_v1 is cheaper (Flagsmith)", undefined, f["exp1.flagsmith.chance_to_beat_control_cost"], undefined],
            ["P(solve drop within m)", undefined, f["exp1.delta.p_solve_drop_within_m"], undefined],
          ]}
        />
        {f["exp1.srm.p"] && <p className="prose small">Sample-ratio check p = {f["exp1.srm.p"]}.</p>}
      </Section>
      {d["exp2.decision.ship"] && (
        <Section id="exp2" title="Experiment 2: lanes_v2" kicker="The small model drafts the patch; the frontier model reviews it.">
          <Table
            caption="Experiment 2 results by arm"
            cols={["control", "lanes_v2", "change"]}
            rows={[
              ["Cost per solved task", f["exp2.arms.control.cost_per_solve"], f["exp2.arms.lanes_v2.cost_per_solve"], f["exp2.delta.cost_per_solve_pct"]],
              ["Solve rate", f["exp2.arms.control.solve_rate"], f["exp2.arms.lanes_v2.solve_rate"], f["exp2.delta.solve_rate_pp"]],
              ["Chance lanes_v2 is cheaper", undefined, f["exp2.flagsmith.chance_to_beat_control_cost"], undefined],
            ]}
          />
        </Section>
      )}
    </>
  );
}

function Pending() {
  return (
    <>
      <section className="doc-section" aria-labelledby="pending-h">
        <div className="workzone is-live" data-reveal="hang">
          <div className="workzone-board">
            <span className="workzone-legend" id="pending-h">
              Run in progress
            </span>
            <span className="workzone-sub">Results post here when the analysis script runs. Until then this page shows no numbers on purpose.</span>
          </div>
        </div>
      </section>
      <Section id="now" title="Where the run is now" kicker="Running totals from the board's API. They are not the result.">
        <div className="live-on-ground">
          <LivePanel />
        </div>
      </Section>
      <Section id="coming" title="What will appear here" kicker="The same figures for both experiments, each read from analysis/out/numbers.json.">
        <ul className="pending-list">
          <li>The verdict of experiment 1 and which of the three rule conditions held.</li>
          <li>Cost per solved task, mean cost per task and solve rate for each arm, with the change.</li>
          <li>Flagsmith's chance that lanes_v1 is cheaper, next to our own bootstrap and Beta posterior.</li>
          <li>The sample-ratio check, the Merkle root over every finished task and the count of flag snapshots.</li>
          <li>Experiment 2, whatever it shows.</li>
        </ul>
        <h3>How this page fills itself</h3>
        <Code code={"make analyse          # writes analysis/out/numbers.json from the run logs\ncd board/web && npm run build"} lang="sh" caption="Makefile" />
        <p className="prose">
          The build reads <code>numbers.json</code> and formats each figure the same way the README markers do, so a consistency check can compare them. See{" "}
          <Link to="/method">the method</Link> for the rule that turns these numbers into a decision.
        </p>
      </Section>
    </>
  );
}

export default function Results() {
  const ready = resultsReady(f, d);
  return (
    <DocPage
      path="/results"
      lead={
        ready ? (
          <>The verdicts, decided by the rule fixed before the first task. Every figure is read from the analysis output.</>
        ) : (
          <>The run is in progress. Results post when the analysis script runs. Nothing on this page is typed by hand: it fills itself from the analysis output.</>
        )
      }
    >
      <div className="results-body">{ready ? <Verdict /> : <Pending />}</div>
    </DocPage>
  );
}
