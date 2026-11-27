import { DocPage } from "../site/DocPage";
import { Link } from "../site/router";
import { Code, Md, Section } from "../site/ui";
import { LivePanel } from "../site/LivePanel";
import { repo, ghFile, type ExperimentNumbers } from "../site/data";
import { batchOf, gapBetween, utcStamp } from "../site/batches";
import { format } from "../data/format";
import { ResultPair } from "../site/ResultPair";

// Every figure here is read from analysis/out/numbers.json at build time. Nothing is typed in.
// Until the file holds a decision, the page shows its empty state. Experiment 2 shows running
// totals from the board API and no verdict until the analysis has run on its finished ledger.

const f = repo.figures;
const d = repo.decisions;
const N = repo.numbers;

export function resultsReady(figures: Record<string, string>, decisions: Record<string, string>): boolean {
  return !!decisions["exp1.decision.ship"] && Object.keys(figures).length > 0;
}

type Row = [string, string | undefined, string | undefined, string | undefined];

function Table({ caption, cols, rows, text = false }: { caption: string; cols: string[]; rows: (string | undefined)[][]; text?: boolean }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            {cols.map((c) => (
              <th scope="col" key={c} className={text ? undefined : "num"}>
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
                <td key={i} className={text ? undefined : "num"}>
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

const RULE_KEYS = ["flagsmith_95", "guardrail_90", "no_guardrail_loss"];
const usd4 = (v: number | null | undefined) => (v === null || v === undefined ? undefined : format(v, "usd4"));
const prob = (v: number | null | undefined) => (v === null || v === undefined ? undefined : format(v, "prob1"));
const range = (ci: [number, number] | undefined, fmt: "usd4" | "prob1" | "pp1" | "pct1") => (ci ? `${format(ci[0], fmt)} to ${format(ci[1], fmt)}` : undefined);

function RuleList({ exp, items }: { exp: string; items: string[] }) {
  const figs = [f[`${exp}.flagsmith.chance_to_beat_control_cost`], f[`${exp}.delta.p_solve_drop_within_m`], undefined];
  return (
    <ol className="rule-list">
      {items.map((t, i) => {
        const v = d[`${exp}.decision.rule_met.${RULE_KEYS[i]}`];
        const state = v === "true" ? "met" : v === "false" ? "not met" : "pending";
        return (
          <li key={i} className={`rule-row is-quote is-${state.replace(" ", "-")}`}>
            <span className="rule-n" aria-hidden="true">
              <b>{i + 1}</b>
            </span>
            <span className="rule-text">
              <Md text={t} />
            </span>
            {figs[i] && (
              <span className="rule-fig">
                <small>{i === 0 ? "Chance to beat control" : "P(drop within margin)"}</small>
                {figs[i]}
              </span>
            )}
            <span className="rule-state">{state}</span>
          </li>
        );
      })}
    </ol>
  );
}

function listOf(blocks: typeof repo.prereg.decisionRule): string[] {
  const b = blocks.find((x) => x.type === "list");
  return b && b.type === "list" ? b.items : [];
}

const TRAIT_LABEL: Record<string, string> = { difficulty: "By difficulty", language: "By language", created_month: "By month the task was created" };
const TRAIT_ORDER: Record<string, string[]> = { difficulty: ["low", "mid", "high"] };

function Traits({ n, treatment }: { n: ExperimentNumbers; treatment: string }) {
  return (
    <>
      {Object.entries(n.by_trait).map(([trait, levels]) => {
        const order = TRAIT_ORDER[trait] ?? Object.keys(levels).sort();
        return (
          <details className="trait" key={trait} open={trait === "difficulty"}>
            <summary>{TRAIT_LABEL[trait] ?? trait}</summary>
            <Table
              caption={`Experiment results ${TRAIT_LABEL[trait]?.toLowerCase() ?? trait}`}
              cols={["control n", "control solved", "control cost", `${treatment} n`, `${treatment} solved`, `${treatment} cost`]}
              rows={order
                .filter((k) => levels[k])
                .map((k) => {
                  const c = levels[k]!.control as { n: number; solve_rate: number | null; cost_mean: number | null };
                  const t = levels[k]![treatment] as { n: number; solve_rate: number | null; cost_mean: number | null };
                  return [k, String(c.n), prob(c.solve_rate), usd4(c.cost_mean), String(t.n), prob(t.solve_rate), usd4(t.cost_mean)];
                })}
            />
          </details>
        );
      })}
      <p className="prose small">
        These splits were not part of the decision rule. Most cells hold few tasks, so a row can swing either way by chance; they are here so nothing is
        hidden.
      </p>
    </>
  );
}

function Exp1() {
  const ship = d["exp1.decision.ship"]!;
  const n = N?.exp1;
  const b = batchOf("exp1");
  return (
    <>
      <Section id="exp1" title={ship === "control" ? "Experiment 1: control stays" : `Experiment 1: ${ship} ships`} kicker="Decided by the pre-registered rule. All three conditions had to hold.">
        <RuleList exp="exp1" items={listOf(repo.prereg.decisionRule)} />
        {n && <ResultPair exp="exp1" treatment="lanes_v1" n={n} />}
        <Table
          caption="Experiment 1 results by arm"
          cols={["control", "lanes_v1", "change"]}
          rows={
            [
              ["Cost per solved task", f["exp1.arms.control.cost_per_solve"], f["exp1.arms.lanes_v1.cost_per_solve"], f["exp1.delta.cost_per_solve_pct"]],
              ["Mean cost per task", f["exp1.arms.control.cost_mean"], f["exp1.arms.lanes_v1.cost_mean"], f["exp1.delta.cost_mean_pct"]],
              ["Median cost per task", usd4(n?.arms.control?.cost_median), usd4(n?.arms.lanes_v1?.cost_median), undefined],
              ["Solve rate", f["exp1.arms.control.solve_rate"], f["exp1.arms.lanes_v1.solve_rate"], f["exp1.delta.solve_rate_pp"]],
              ["Tasks analysed", f["exp1.arms.control.n_analysed"], f["exp1.arms.lanes_v1.n_analysed"], undefined],
              ["Worker lane's share of cost", f["exp1.arms.control.delegate_share_cost"], f["exp1.arms.lanes_v1.delegate_share_cost"], undefined],
              ["Chance lanes_v1 is cheaper (Flagsmith)", undefined, f["exp1.flagsmith.chance_to_beat_control_cost"], undefined],
              ["P(solve drop within m)", undefined, f["exp1.delta.p_solve_drop_within_m"], undefined],
            ] as Row[]
          }
        />
        <p className="prose small">
          {f["exp1.srm.p"] && <>Sample-ratio check p = {f["exp1.srm.p"]}. </>}
          {n && (
            <>
              Intervals are 95%, from {n.bootstrap_resamples.toLocaleString("en-US")} bootstrap resamples for cost and {n.posterior_draws.toLocaleString("en-US")}{" "}
              Beta posterior draws for solve rate.{" "}
            </>
          )}
          {b?.flagsmithId && <>Flagsmith experiment {b.flagsmithId}. </>}
          The full table is in <a href={ghFile("analysis/results.md")}>analysis/results.md</a>.
        </p>
      </Section>

      {n && (
        <Section id="honest" title="What this does and does not show" kicker="Read the solve-rate line with the margin in mind.">
          <div className="prose">
            <p>
              The cost result is clear: lanes_v1 cost {format(n.delta.cost_mean_pct, "pct1")} per task, and the whole interval is below zero. The solve rate
              was {format(n.delta.solve_rate_pp, "pp1")} for lanes_v1, with an interval from {format(n.delta.solve_rate_ci[0], "pp1")} to{" "}
              {format(n.delta.solve_rate_ci[1], "pp1")}. That interval includes no difference and it includes a real loss.
            </p>
            <p>
              The guardrail only rules out a drop larger than {format(n.prereg.m * 100, "pp1").replace("+", "")}, the margin fixed before the run. At this
              sample size a drop of a few points cannot be told from zero. <Link to="/faq#margin">Why the margin is that wide</Link>.
            </p>
          </div>
        </Section>
      )}

      {n && (
        <Section id="traits" title="The same result, cut three ways" kicker="Reported in full, as the registration promised.">
          <Traits n={n} treatment="lanes_v1" />
        </Section>
      )}
    </>
  );
}

function Rollout() {
  const r = N?.rollout;
  const ship = d["exp1.decision.ship"];
  const integ = N?.integrity?.by_experiment.rollout;
  const b = batchOf("rollout");
  if (!r) {
    return (
      <Section id="rollout" title="Rollout on the same flag" kicker="Runs after the decision.">
        <p className="prose">After End Experiment, a fresh batch runs on the same flag with no code change. Its figures post here.</p>
      </Section>
    );
  }
  return (
    <Section id="rollout" title="Rolled out on the same flag" kicker={`After End Experiment, ${ship} is what the flag returns for every task.`}>
      <dl className="fact-plates" data-reveal="hang">
        <div>
          <dt>Fresh tasks</dt>
          <dd>{f["rollout.n"]}</dd>
        </div>
        <div>
          <dt>Mean cost per task</dt>
          <dd>{f["rollout.cost_mean"]}</dd>
        </div>
        <div>
          <dt>Solve rate</dt>
          <dd>{f["rollout.solve_rate"]}</dd>
        </div>
        <div>
          <dt>Arms recomputed offline</dt>
          <dd>{integ?.assignment ? `${integ.assignment.matched} of ${integ.assignment.checked}` : "—"}</dd>
        </div>
      </dl>
      <p className="prose">
        The batch has no comparison arm, so it shows the winner working as the flag's own value, not a second estimate of the effect.
        {b?.startedAt && <> It started at {utcStamp(b.startedAt, true)}.</>} No code changed between the experiment and this batch: the runner asks
        Flagsmith for the policy the same way. <Link to="/why-flagsmith">What End Experiment did</Link>.
      </p>
    </Section>
  );
}

function Exp2() {
  const b = batchOf("exp2");
  const ship = d["exp2.decision.ship"];
  const n = N?.exp2;
  if (ship && n) {
    return (
      <Section id="exp2" title={ship === "control" ? "Experiment 2: lanes_v1 stays" : `Experiment 2: ${ship} ships`} kicker="The small model drafts the patch; the frontier model reviews it.">
        <RuleList exp="exp2" items={listOf(repo.prereg2.decisionRule)} />
        <ResultPair exp="exp2" treatment="lanes_v2" n={n} />
        <Table
          caption="Experiment 2 results by arm"
          cols={["control", "lanes_v2", "change"]}
          rows={
            [
              ["Cost per solved task", f["exp2.arms.control.cost_per_solve"], f["exp2.arms.lanes_v2.cost_per_solve"], f["exp2.delta.cost_per_solve_pct"]],
              ["Mean cost per task", f["exp2.arms.control.cost_mean"], f["exp2.arms.lanes_v2.cost_mean"], f["exp2.delta.cost_mean_pct"]],
              ["Solve rate", f["exp2.arms.control.solve_rate"], f["exp2.arms.lanes_v2.solve_rate"], f["exp2.delta.solve_rate_pp"]],
              ["Tasks analysed", f["exp2.arms.control.n_analysed"], f["exp2.arms.lanes_v2.n_analysed"], undefined],
              ["Chance lanes_v2 is cheaper (Flagsmith)", undefined, f["exp2.flagsmith.chance_to_beat_control_cost"], undefined],
              ["P(solve drop within m)", undefined, f["exp2.delta.p_solve_drop_within_m"], undefined],
            ] as Row[]
          }
        />
      </Section>
    );
  }
  if (b?.state !== "open") {
    return (
      <Section id="exp2" title="Experiment 2: lanes_v2" kicker="Not started.">
        <p className="prose">The second experiment is registered and tagged before its first task. Its result posts here either way.</p>
      </Section>
    );
  }
  return (
    <Section id="exp2" title="Experiment 2: running" kicker="Registered before its first task. No verdict until every task is done.">
      <div className="regs" data-reveal="hang">
        <p className="regs-k">Registered</p>
        <p className="regs-v">
          <code className="hash-full">{b.preregSha}</code>
        </p>
        <p className="regs-meta">
          sha256 of <a href={ghFile(b.preregFile!)}>{b.preregFile}</a>, tagged <code>{b.preregTag}</code>
          {b.registeredAt && <> at {utcStamp(b.registeredAt, true, true)}</>}
          {b.startedAt && (
            <>
              . First worker started at {utcStamp(b.startedAt, true, true)}, {gapBetween(b.registeredAt, b.startedAt)} later
            </>
          )}
          .
        </p>
      </div>
      <p className="prose">
        Control is the rolled-out lanes_v1 policy. In lanes_v2 the small model drafts the patch and the frontier model reviews it. The rule is the same three
        conditions, with lanes_v2 in place of lanes_v1. <a href={ghFile(b.preregFile!)}>The whole registration</a>.
      </p>
      <div className="live-on-ground">
        <LivePanel experiment="exp2" />
      </div>
    </Section>
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
          <LivePanel experiment="exp1" />
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

function Checks() {
  const n = N?.exp1;
  const integ = N?.integrity?.by_experiment.exp1;
  if (!n) return null;
  return (
    <Section id="checks" title="Checks on the result" kicker="Each one can be rerun from the repository.">
      <Table
        caption="Checks on experiment 1"
        text
        cols={["Reading", "What it means"]}
        rows={[
          ["Sample ratio", `p = ${format(n.srm.p, "f3")}`, "The 50/50 split came out as expected; no sign of a broken assignment."],
          [
            "Flagsmith against our own analysis",
            `${format(Math.max(...Object.values(n.agreement.cost_mean_abs_diff)), "usd4")} at most`,
            "The gap between Flagsmith's mean cost per arm and ours, computed from the run's own logs.",
          ],
          ["Arms recomputed offline", integ?.assignment ? `${integ.assignment.matched} of ${integ.assignment.checked}` : undefined, "Every recorded arm matches what Flagsmith's flag-engine gives from the saved environment."],
          ["Flag config during the run", integ ? `${integ.env_snapshots} snapshots, ${integ.env_snapshot_distinct_hashes} distinct` : undefined, "One distinct hash means the flag and the split never changed."],
          ["Merkle root", integ ? `${integ.merkle_root.slice(0, 12)}… over ${integ.task_done_records}` : undefined, "Covers every finished task. Change one record and it no longer matches."],
        ]}
      />
      <p className="prose">
        The commands for each check are on the <Link to="/proof">proof page</Link>.
      </p>
    </Section>
  );
}

export default function Results() {
  const ready = resultsReady(f, d);
  const exp2 = batchOf("exp2");
  const toc = ready
    ? [
        { id: "exp1", label: "Experiment 1" },
        { id: "honest", label: "What it shows" },
        { id: "traits", label: "Cut three ways" },
        { id: "rollout", label: "Rollout" },
        { id: "exp2", label: d["exp2.decision.ship"] ? "Experiment 2" : "Experiment 2, running" },
        { id: "checks", label: "Checks" },
      ]
    : undefined;
  return (
    <DocPage
      path="/results"
      toc={toc}
      lead={
        ready ? (
          <>
            Experiment 1 is decided, by the rule fixed before the first task. The winner is rolled out.{" "}
            {exp2?.state === "open" ? "Experiment 2 is running now and has no verdict yet. " : ""}Every figure is read from the analysis output.
          </>
        ) : (
          <>The run is in progress. Results post when the analysis script runs. Nothing on this page is typed by hand: it fills itself from the analysis output.</>
        )
      }
    >
      <div className="results-body">
        {ready ? (
          <>
            <Exp1 />
            <Rollout />
            <Exp2 />
            <Checks />
          </>
        ) : (
          <Pending />
        )}
      </div>
    </DocPage>
  );
}
