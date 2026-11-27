import { useRef, type ReactNode } from "react";
import { Kinetic, PageHead, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { routeFor } from "../site/routes";
import { ghFile, repo, type Reference } from "../site/data";
import { format } from "../data/format";

// From the research to the code: one card per source in docs/references.md that the project uses.
// The citation and the note under it are read from that file. What was taken, where it lives and
// the result it produces here are read from the repository and from numbers.json. A card whose
// analysis has not been written to numbers.json yet shows only what exists.

const N = repo.numbers;
const N1 = N?.exp1 ?? null;
const refs = new Map(repo.references.map((r) => [r.id, r]));
const integ = N?.integrity?.by_experiment.exp1 ?? null;
const hasChart = (f: string) => repo.charts.includes(f);
const AV = N1?.secondary?.always_valid ?? null;
const MV = N1?.secondary?.multiverse ?? null;
const FR = N?.frontier ?? null;
const PR = N?.integrity?.proofs ?? null;
const p3 = (v: number) => format(v, "p3");

/** A short table of readings inside a card. */
function Readings({ rows, note }: { rows: [string, ReactNode][]; note?: ReactNode }) {
  return (
    <div className="rs-read">
      <dl className="rs-block">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="rs-read-note">{note}</p>}
    </div>
  );
}

function Chart({ file, alt }: { file: string; alt: string }) {
  if (!hasChart(file)) return null;
  return (
    <figure className="rs-chart">
      <img src={`/figures/${file}`} alt={alt} loading="lazy" decoding="async" />
      <figcaption>
        <a href={ghFile(`analysis/charts/${file}`)}>analysis/charts/{file}</a>, drawn by the analysis, not for the site.
      </figcaption>
    </figure>
  );
}

interface Card {
  /** Reference ids, first one named on the card's post. */
  ids: string[];
  topic: string;
  took: ReactNode;
  file: string;
  fileLabel?: string;
  result: ReactNode;
  extra?: ReactNode;
  group: "question" | "experiment" | "analysis" | "integrity";
}

const usd4 = (v: number) => format(v, "usd4");

export const CARDS: Card[] = [
  {
    ids: ["chen-zaharia-2023", "ong-almahairi-2024", "aggarwal-madaan-2023", "ding-mallick-2024"],
    group: "question",
    topic: "Send work to a cheaper model",
    took: <>The hypothesis: moving the delegate lane to a small model lowers the cost per task. Here the routing is fixed per arm, so one switch can be tested.</>,
    file: "flagsmith/policies/lanes_v1.json",
    result: N1 ? (
      <>
        Mean cost per task {format(N1.delta.cost_mean_pct, "pct1")}, interval {format(N1.delta.cost_mean_pct_ci[0], "pct1")} to {format(N1.delta.cost_mean_pct_ci[1], "pct1")}.
      </>
    ) : null,
  },
  {
    ids: ["xu-peng-2023"],
    group: "question",
    topic: "Split planning from execution",
    took: <>The agent's two lanes: a planner that reads, edits and decides, and a worker that runs the shell and reports back as short findings.</>,
    file: "harness/agent.py",
    result: N1 ? (
      <>
        The worker lane took {format(N1.arms.control!.delegate_share_cost, "prob1")} of control's cost and {format(N1.arms.lanes_v1!.delegate_share_cost, "prob1")} of lanes_v1's.
      </>
    ) : null,
  },
  {
    ids: ["jimenez-yang-2023", "zhang-he-2025", "li-li-2026"],
    group: "question",
    topic: "Real issues, graded by the repository's tests",
    took: <>The unit of the experiment and its outcome: one issue is one task, and it counts as solved only when the repository's own tests say so in a fresh container.</>,
    file: "runner/grading.py",
    result: (
      <>
        {repo.scale.totals.attempts.toLocaleString("en-US")} attempts graded from {repo.scale.totals.tests.toLocaleString("en-US")} test results, across {repo.scale.totals.repos}{" "}
        repositories.
      </>
    ),
  },
  {
    ids: ["liang-garg-2025"],
    group: "question",
    topic: "Models may have seen the tasks",
    took: <>Two tiers: tasks created after the models' training cutoff, and older ones. They are reported separately, and the fresh tier is the registered pool.</>,
    file: "tasks/select_tasks.py",
    result: N1?.by_tier?.fresh ? (
      <>
        Fresh tier alone: solve rate {format(N1.by_tier.fresh.delta.solve_rate_pp, "pp1")}, mean cost {format(N1.by_tier.fresh.delta.cost_mean_pct, "pct1")}.
      </>
    ) : null,
  },
  {
    ids: ["kapoor-stroebl-2024"],
    group: "analysis",
    topic: "Report cost with accuracy",
    took: <>The primary outcome is dollars, not a score: mean cost per task and cost per solved task, beside the solve rate.</>,
    file: "analysis/analyse.py",
    result: N1 ? (
      <>
        Cost per solved task {usd4(N1.arms.control!.cost_per_solve)} for control, {usd4(N1.arms.lanes_v1!.cost_per_solve)} for lanes_v1.
      </>
    ) : null,
    extra: FR ? (
      <>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Every arm that has run: cost and solve rate">
          <table className="data-table">
            <caption className="sr-only">Mean cost per task and solve rate of every arm that has run, with the frontier marked</caption>
            <thead>
              <tr>
                <th scope="col">Arm</th>
                <th scope="col" className="num">
                  Tasks
                </th>
                <th scope="col" className="num">
                  Mean cost
                </th>
                <th scope="col" className="num">
                  Solve rate
                </th>
                <th scope="col">On the frontier</th>
              </tr>
            </thead>
            <tbody>
              {FR.order.map((k) => {
                const arm = FR.arms[k];
                if (!arm) return null;
                return (
                  <tr key={k} className={arm.on_frontier ? "is-hl" : ""}>
                    <th scope="row">{arm.label}</th>
                    <td className="num">{arm.n}</td>
                    <td className="num">{usd4(arm.cost_mean)}</td>
                    <td className="num">{format(arm.solve_rate, "prob1")}</td>
                    <td>{arm.on_frontier ? "yes" : "no: another arm is cheaper and solves more"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="rs-read-note">
          {FR.n_on_frontier} of {FR.n_arms} arms are on the frontier. This reading is descriptive: {FR.note.charAt(0).toLowerCase() + FR.note.slice(1)}
        </p>
        <Chart file="frontier.png" alt="Cost against solve rate for every arm that has run, with the frontier marked." />
      </>
    ) : undefined,
  },
  {
    ids: ["kohavi-tang-2020", "tang-agarwal-2010", "flagsmith-nd", "flagsmith-nd-2"],
    group: "experiment",
    topic: "A controlled experiment on the live system",
    took: <>The design: one randomisation unit (the task), a primary metric and a guardrail, and assignment by the flag platform, never by the runner.</>,
    file: "harness/policy.py",
    result: integ?.assignment ? (
      <>
        {integ.assignment.matched} of {integ.assignment.checked} recorded arms match Flagsmith's flag-engine {integ.assignment.flag_engine_version}, run offline on the saved environment.
      </>
    ) : null,
  },
  {
    ids: ["fabijan-gupchup-2019"],
    group: "experiment",
    topic: "Check the split came out as designed",
    took: <>A chi-square test on the arm counts against the 50/50 split. A flagged mismatch stops the result from being acted on.</>,
    file: "analysis/analyse.py",
    result: N1 ? (
      <>
        Chi-square {format(N1.srm.chi2, "f3")}, p = {format(N1.srm.p, "f3")}: {N1.srm.flag ? "flagged" : "not flagged"}.
      </>
    ) : null,
  },
  {
    ids: ["johari-koomen-2017", "deng-lu-2016"],
    group: "experiment",
    topic: "Do not stop on a good reading",
    took: <>The stopping rule: the run continues until every task is done, excluded or invalid. The live board shows totals; the decision is read once, at the end.</>,
    file: "prereg/experiment-1.md",
    result: N1 ? (
      <>
        The decision was read once, on {N1.arms.control!.n_analysed + N1.arms.lanes_v1!.n_analysed} analysed tasks, after the last one finished.
      </>
    ) : null,
    extra: AV ? (
      <>
        <Readings
          rows={[
            ["Cost: first below " + AV.alpha, AV.cost.crossed && AV.cost.first_cross_at ? `task ${AV.cost.first_cross_at} of ${AV.n_tasks}` : "never"],
            ["Cost: at the end", `p ${p3(AV.cost.p_final)}`],
            ["Cost: interval at the end", `${usd4(AV.cost.ci_final[0])} to ${usd4(AV.cost.ci_final[1])}`],
            ["Solve rate: below " + AV.alpha, AV.solve.crossed ? "yes" : `never (p ${p3(AV.solve.p_final)})`],
            [`When the board went public (${AV.board_live_after_tasks} tasks in)`, `cost p ${p3(AV.cost.p_at_board_live)}, solve p ${p3(AV.solve.p_at_board_live)}`],
          ]}
          note={
            <>
              Added after experiment 1 and labelled secondary; it did not enter the decision. An always-valid p-value stays valid however often it is looked at, so it
              answers the question a live board raises. The cost reading crossed the line and holds under continuous watching; the solve-rate reading never crossed
              in either direction. Method: {AV.method}.
            </>
          }
        />
        <Chart file="exp1-always-valid.png" alt="The always-valid p-value for cost and for solve rate, task by task, against the 0.05 line." />
      </>
    ) : undefined,
  },
  {
    ids: ["nosek-ebersole-2018", "gelman-loken-2013"],
    group: "experiment",
    topic: "Write the plan down first",
    took: <>The hypothesis, metrics, margin, exclusions and decision rule in one file, hashed and tagged before the first task. A change goes in a separate hashed amendment.</>,
    file: "prereg/HASHES.txt",
    result: N1 ? (
      <>
        sha256 <code>{N1.prereg.sha256.slice(0, 16)}…</code>, tag <code>{N1.prereg.tag}</code>; all three registered conditions held.
      </>
    ) : null,
    extra: MV ? (
      <>
        <Readings
          rows={[
            ["Specifications run", String(MV.n_specs)],
            ["Cost per solved task lower", `${MV.cost_direction} of ${MV.n_specs}`],
            ["Its change, across all of them", `${format(MV.cps_change_pct_range[0], "pct1")} to ${format(MV.cps_change_pct_range[1], "pct1")}`],
            ["Guardrail passes", `${MV.guardrail_pass} of ${MV.n_specs}`],
            ["Guardrail fails", MV.guardrail_fail_only_fresh ? `${MV.guardrail_fail}, all on the fresh tier alone` : String(MV.guardrail_fail)],
            ["Guardrail probability, lowest to highest", `${format(MV.guardrail_posterior_range[0], "prob1")} to ${format(MV.guardrail_posterior_range[1], "prob1")}`],
          ]}
          note={
            <>
              The forking paths, walked on purpose: every combination of {Object.entries(MV.choices).map(([k, v]) => `${v.length} choices of ${k.replace(/_/g, " ")}`).join(", ")}
              . The registered analysis is one of the {MV.n_specs}. The cost finding does not depend on the choice. The solve-rate check does: it fails in every
              specification that uses the fresh tier alone ({MV.fresh_specs_failing} of {MV.fresh_specs}) and in none of the others. Added after experiment 1 and labelled
              secondary.
            </>
          }
        />
        <Chart file="exp1-specification-curve.png" alt="The change in cost per solved task under each of the specifications, sorted, with the analysis choices marked beneath." />
      </>
    ) : undefined,
  },
  {
    ids: ["u-s-food-and-drug-administration-2016"],
    group: "analysis",
    topic: "A margin for 'not worse'",
    took: <>The solve-rate guardrail is a non-inferiority test: the challenger passes if its solve rate is not lower by more than a margin fixed before the run.</>,
    file: "prereg/experiment-1.md",
    result: N1 ? (
      <>
        Margin {Math.round(N1.prereg.m * 100)} points; probability the drop is within it {format(N1.delta.p_solve_drop_within_m, "prob1")}, against a bar of{" "}
        {format(N1.decision.bars.guardrail_posterior, "prob1")}.
      </>
    ) : null,
  },
  {
    ids: ["gelman-carlin-2013"],
    group: "analysis",
    topic: "A posterior for each solve rate",
    took: <>A Beta(1,1) prior with binomial data for each arm, and {N1 ? N1.posterior_draws.toLocaleString("en-US") : "many"} draws for the difference.</>,
    file: "analysis/analyse.py",
    result: N1 ? (
      <>
        Solve-rate difference {format(N1.delta.solve_rate_pp, "pp1")}, posterior interval {format(N1.delta.solve_rate_ci[0], "pp1")} to {format(N1.delta.solve_rate_ci[1], "pp1")}.
      </>
    ) : null,
  },
  {
    ids: ["efron-tibshirani-1994"],
    group: "analysis",
    topic: "Intervals by resampling",
    took: <>Percentile bootstrap intervals for mean cost, cost per solved task and their differences, since cost per task is skewed.</>,
    file: "analysis/analyse.py",
    result: N1 ? (
      <>
        {N1.bootstrap_resamples.toLocaleString("en-US")} resamples; cost per solved task changed {format(N1.delta.cost_per_solve_pct, "pct1")}, interval{" "}
        {format(N1.delta.cost_per_solve_pct_ci[0], "pct1")} to {format(N1.delta.cost_per_solve_pct_ci[1], "pct1")}.
      </>
    ) : null,
  },
  {
    ids: ["deng-xu-2013"],
    group: "analysis",
    topic: "Use what was known before",
    took: <>CUPED, a covariate adjustment from pre-experiment data, as a secondary analysis that is labelled as such and never enters the decision.</>,
    file: "analysis/analyse.py",
    result: N1 ? (
      <>
        {N1.cuped?.variance_reduction_pct != null
          ? `Variance reduced by ${format(N1.cuped.variance_reduction_pct, "pct1").replace("+", "")}.`
          : `Not computed for experiment 1: ${N1.cuped?.note ?? "no covariate was available"}. It is reported as not available, not left out.`}
      </>
    ) : null,
  },
  {
    ids: ["haber-stornetta-1991", "crosby-wallach-2009"],
    group: "integrity",
    topic: "Chain every record to the one before",
    took: <>The run ledger: each record's hash includes the previous record's hash, so an edit or a deletion breaks every hash after it.</>,
    file: "integrity/ledger.py",
    result: (
      <>
        {repo.scale.totals.ledger.toLocaleString("en-US")} chained records across {repo.scale.totals.runs} runs, all verified on every push. <Link to="/verify">Check one yourself</Link>.
      </>
    ),
  },
  {
    ids: ["merkle-1988", "laurie-langley-2013"],
    group: "integrity",
    topic: "One root over every finished task",
    took: <>A Merkle root over the task records, published with the results, so anyone holding the ledger can rebuild it, and one task can be proved to be under it.</>,
    file: "integrity/merkle.py",
    result: integ ? (
      <>
        Root <code>{integ.merkle_root.slice(0, 16)}…</code> over {integ.task_done_records} finished tasks of experiment 1. <Link to="/verify#proof">Prove one task</Link>.
      </>
    ) : null,
    extra: PR ? (
      <Readings
        rows={Object.entries(PR).flatMap(([run, v]): [string, ReactNode][] => [
          [`${run}: proofs that verify`, `${v.verified} of ${v.leaves}`],
          [`${run}: longest path`, `${v.path_length_max} hashes`],
        ])}
        note={
          <>
            One inclusion proof per task is exported with the analysis (<a href={ghFile("analysis/out/proofs/exp1.json")}>analysis/out/proofs</a>). Each is the task's
            hash and at most {Math.max(...Object.values(PR).map((v) => v.path_length_max))} neighbours; <Link to="/verify#proof">the verify page checks any of them in your browser</Link>.
          </>
        }
      />
    ) : undefined,
  },
];

const GROUPS: { key: Card["group"]; title: string; line: string }[] = [
  { key: "question", title: "The question", line: "What is being tested, and on what" },
  { key: "experiment", title: "The experiment", line: "How the comparison is kept fair" },
  { key: "analysis", title: "The analysis", line: "How the result is read" },
  { key: "integrity", title: "The record", line: "How anyone can check it" },
];

function Source({ r }: { r: Reference }) {
  return (
    <li>
      <a href={r.url} rel="noopener">
        {r.short}
      </a>
      . <cite>{r.title}</cite>
      {r.note && <span className="rs-note"> {r.note}</span>}
    </li>
  );
}

export default function Research() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  const live = CARDS.map((c) => ({ ...c, refs: c.ids.map((id) => refs.get(id)).filter((r): r is Reference => !!r) })).filter((c) => c.refs.length > 0);
  return (
    <div className="page-wrap research-page" ref={root}>
      <PageHead
        route={routeFor("/research")}
        lead={
          <>
            Nothing in the method is new. Each part comes from published work, and each card says what was taken, where it lives in the code and what it produces here.
          </>
        }
      />
      <nav className="rs-jump" aria-label="Groups">
        {GROUPS.map((g) => (
          <a key={g.key} href={`#rs-${g.key}`}>
            <b>{g.title}</b>
            <span>{g.line}</span>
            <i aria-hidden="true">{live.filter((c) => c.group === g.key).length}</i>
          </a>
        ))}
      </nav>
      {GROUPS.map((g) => (
        <section className="rs-group" key={g.key} id={`rs-${g.key}`} aria-labelledby={`rs-h-${g.key}`}>
          <div className="rs-head">
            <Kinetic id={`rs-h-${g.key}`} text={g.title} />
            <p>{g.line}</p>
          </div>
          <div className="rs-cards">
            {live
              .filter((c) => c.group === g.key)
              .map((c) => (
                <article className="rs-card" key={c.ids[0]} id={c.ids[0]} aria-labelledby={`rs-${c.ids[0]}-h`}>
                  <span className="rs-post" aria-hidden="true">
                    {c.refs[0]!.short}
                  </span>
                  <h3 id={`rs-${c.ids[0]}-h`}>{c.topic}</h3>
                  <dl className="rs-rows">
                    <div>
                      <dt>The source says</dt>
                      <dd>
                        <ul className="rs-sources">
                          {c.refs.map((r) => (
                            <Source key={r.id} r={r} />
                          ))}
                        </ul>
                      </dd>
                    </div>
                    <div>
                      <dt>What we took</dt>
                      <dd>{c.took}</dd>
                    </div>
                    <div>
                      <dt>Where it lives</dt>
                      <dd>
                        <a href={ghFile(c.file)}>
                          <code>{c.fileLabel ?? c.file}</code>
                        </a>
                      </dd>
                    </div>
                    {c.result && (
                      <div className="rs-result">
                        <dt>What it produces here</dt>
                        <dd>{c.result}</dd>
                      </div>
                    )}
                  </dl>
                  {c.extra}
                </article>
              ))}
          </div>
        </section>
      ))}
      <p className="faq-more">
        The full list, with how each entry was checked, is <a href={ghFile("docs/references.md")}>docs/references.md</a>. How this differs from common practice is on{" "}
        <Link to="/different">the comparison page</Link>.
      </p>
    </div>
  );
}
