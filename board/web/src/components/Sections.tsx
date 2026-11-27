import type { Board } from "../data/types";
import { FlagHistory } from "./FlagHistory";
import type { Phase } from "./Junction";
import { repo } from "../site/data";
import { batchOf, utcStamp } from "../site/batches";
import { Link } from "../site/router";

// Each section reads the batch the board is showing. Registration hashes are known from the repo
// at build time; the run's own figures come from analysis/out/numbers.json once it holds them.

type Tri = "pending" | "met" | "not met";

function triOf(v: string | undefined): Tri {
  return v === "true" ? "met" : v === "false" ? "not met" : "pending";
}

const TREATMENT: Record<string, string> = { exp1: "lanes_v1", exp2: "lanes_v2" };
const KEEP: Record<string, string> = { exp1: "control", exp2: "lanes_v1" };

function Rule({ board }: { board: Board }) {
  const exp = board.experiment;
  const t = TREATMENT[exp] ?? "lanes_v1";
  const batch = board.mode === "replay" ? undefined : batchOf(exp);
  const sha = batch?.preregSha ?? (exp === "exp1" ? repo.hashes.find((h) => h.file === "prereg/experiment-1.md")?.sha256 : undefined);
  const f = board.figures;
  const d = board.decisions;
  const m = f[`${exp}.prereg.m`];
  const rows: { text: string; figure?: string; figureLabel: string; state: Tri }[] = [
    {
      text: `Flagsmith gives ${t} at least a 95% chance of a lower mean cost per task.`,
      figure: f[`${exp}.flagsmith.chance_to_beat_control_cost`],
      figureLabel: "Chance to beat control",
      state: triOf(d[`${exp}.decision.rule_met.flagsmith_95`]),
    },
    {
      text: `Our own posterior gives at least 90% that the solve rate drops by less than ${m ? m.replace(/^\+/, "") : "the margin m"}.`,
      figure: f[`${exp}.delta.p_solve_drop_within_m`],
      figureLabel: "P(drop within margin)",
      state: triOf(d[`${exp}.decision.rule_met.guardrail_90`]),
    },
    {
      text: "Flagsmith shows no loss on the solve-rate guardrail.",
      figureLabel: "Guardrail",
      state: triOf(d[`${exp}.decision.rule_met.no_guardrail_loss`]),
    },
  ];
  return (
    <section className="block rule" id="rule" aria-labelledby="rule-title">
      <div className="block-head">
        <h2 id="rule-title">The rule, fixed before the first task</h2>
        <p>
          {t} ships only if all three hold. Otherwise {KEEP[exp] ?? "control"} stays, and the reason is published. No early stopping.
        </p>
      </div>
      <ol className="rule-list" data-reveal="hang">
        {rows.map((r, i) => (
          <li key={i} className={`rule-row is-${r.state.replace(" ", "-")}`}>
            <span className="rule-n" aria-hidden="true">
              <b>{i + 1}</b>
            </span>
            <span className="rule-text">{r.text}</span>
            <span className="rule-fig">
              <small>{r.figureLabel}</small>
              {r.figure ?? (r.state === "pending" ? "—" : "")}
            </span>
            <span className="rule-state">{r.state}</span>
          </li>
        ))}
      </ol>
      <p className="prereg">
        Pre-registration sha256{" "}
        <code className="hash-full">{sha ?? (f[`${exp}.prereg.sha256`] ? `${f[`${exp}.prereg.sha256`]}…` : "posts with the pre-registration tag")}</code>
        {batch?.registeredAt && (
          <span className="prereg-when">
            {" "}
            tagged <code>{batch.preregTag}</code> at {utcStamp(batch.registeredAt, true)}
          </span>
        )}
      </p>
    </section>
  );
}

function RateTable({
  caption,
  cols,
  rows,
}: {
  caption: string;
  cols: [string, string, string];
  rows: [string, string | undefined, string | undefined, string | undefined][];
}) {
  return (
    <table className="rate-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">Measure</span>
          </th>
          {cols.map((c) => (
            <th scope="col" key={c}>
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
              <td key={i}>{v ?? "—"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Verdict({ board, phase }: { board: Board; phase: Phase }) {
  const exp = board.experiment;
  const t = TREATMENT[exp] ?? "lanes_v1";
  const f = board.figures;
  const ship = board.decisions[`${exp}.decision.ship`];
  const ready = board.final && !!ship;
  return (
    <section className="block verdict" aria-labelledby="verdict-title">
      <div className="block-head">
        <h2 id="verdict-title">Verdict</h2>
        <p>
          {ready
            ? "Decided by the rule above, then rolled out on the same Flagsmith flag."
            : phase === "running"
              ? "Posts when the run ends. Numbers come from the analysis, not from this page."
              : "Posts when the run ends."}
        </p>
      </div>
      <div className="verdict-gantry" aria-hidden="true">
        <span className="verdict-hanger" />
        <span className="verdict-hanger" />
      </div>
      <div className={`verdict-sign ${ready ? "is-ready" : "is-pending"}`} data-reveal="hang">
        <div className="verdict-legend">
          {ready ? (
            ship === "control" ? (
              <>
                <span>{KEEP[exp] ?? "control"}</span> stays
              </>
            ) : (
              <>
                <span>{ship}</span> ships
              </>
            )
          ) : phase === "running" ? (
            "Run in progress"
          ) : (
            "Awaiting run"
          )}
        </div>
        {ready && (
          <RateTable
            caption={`${exp} results by arm`}
            cols={["control", t, "change"]}
            rows={[
              ["Cost per solved task", f[`${exp}.arms.control.cost_per_solve`], f[`${exp}.arms.${t}.cost_per_solve`], f[`${exp}.delta.cost_per_solve_pct`]],
              ["Mean cost per task", f[`${exp}.arms.control.cost_mean`], f[`${exp}.arms.${t}.cost_mean`], f[`${exp}.delta.cost_mean_pct`]],
              ["Solve rate", f[`${exp}.arms.control.solve_rate`], f[`${exp}.arms.${t}.solve_rate`], f[`${exp}.delta.solve_rate_pp`]],
              ["Tasks analysed", f[`${exp}.arms.control.n_analysed`], f[`${exp}.arms.${t}.n_analysed`], undefined],
            ]}
          />
        )}
        {ready && f[`${exp}.srm.p`] && (
          <p className="verdict-foot">
            Sample-ratio check p = {f[`${exp}.srm.p`]}. Cost per solved task = mean cost ÷ solve rate.
          </p>
        )}
      </div>
    </section>
  );
}

/** What came next on the same flag, under the experiment 1 board. */
function Next({ board }: { board: Board }) {
  const f = board.figures;
  const exp2 = batchOf("exp2");
  const ship2 = board.decisions["exp2.decision.ship"];
  const rolled = !!f["rollout.n"];
  return (
    <section className="block exp2" aria-labelledby="next-title">
      <div className="block-head">
        <h2 id="next-title">What happened next</h2>
        <p>The experiment was ended in Flagsmith with the winner as the rollout decision, so the winner became the flag's own value.</p>
      </div>
      <div className="next-rows" data-reveal="hang">
        <a className="next-row" href="/live?experiment=rollout">
          <span className="next-k">Rollout batch</span>
          <span className="next-v">
            {rolled ? (
              <>
                {f["rollout.n"]} fresh tasks on the same flag, no code change: {f["rollout.cost_mean"]} mean cost, {f["rollout.solve_rate"]} solved.
              </>
            ) : (
              "Runs on the same flag after the decision."
            )}
          </span>
          <span className="next-go" aria-hidden="true">
            →
          </span>
        </a>
        <a className="next-row" href="/live?experiment=exp2">
          <span className="next-k">Experiment 2</span>
          <span className="next-v">
            {ship2
              ? ship2 === "control"
                ? "lanes_v2 did not beat the rolled-out winner. Published as run."
                : "lanes_v2 beat the rolled-out winner."
              : exp2?.state === "open"
                ? "lanes_v2 against the rolled-out winner. Registered before its first task; running now."
                : "lanes_v2 against the rolled-out winner. Not started."}
          </span>
          <span className="next-go" aria-hidden="true">
            →
          </span>
        </a>
      </div>
    </section>
  );
}

/** The rollout batch: no rule and no verdict, only what the flag served and what it cost. */
function RolloutFacts({ board }: { board: Board }) {
  const f = board.figures;
  const ship = board.decisions["exp1.decision.ship"];
  const integrity = repo.numbers?.integrity?.by_experiment.rollout;
  return (
    <section className="block rule" id="rule" aria-labelledby="rollout-title">
      <div className="block-head">
        <h2 id="rollout-title">Same flag, no deploy</h2>
        <p>
          After End Experiment, {ship ?? "the winner"} is what <code>agent_routing</code> returns for every identity. This batch ran on that flag with no
          code change. It has no comparison arm, so it shows the winner working, not a second estimate of the effect.
        </p>
      </div>
      <dl className="fact-plates" data-reveal="hang">
        <div>
          <dt>Tasks</dt>
          <dd>{f["rollout.n"] ?? "—"}</dd>
        </div>
        <div>
          <dt>Mean cost per task</dt>
          <dd>{f["rollout.cost_mean"] ?? "—"}</dd>
        </div>
        <div>
          <dt>Solve rate</dt>
          <dd>{f["rollout.solve_rate"] ?? "—"}</dd>
        </div>
        <div>
          <dt>Arms recomputed offline</dt>
          <dd>{integrity?.assignment ? `${integrity.assignment.matched} of ${integrity.assignment.checked}` : "—"}</dd>
        </div>
      </dl>
      <p className="prereg">
        <Link to="/results#end-experiment">What End Experiment did to the flag</Link>
      </p>
    </section>
  );
}

/** Replay only: the fixture's second experiment, drawn as a work-zone board. */
function ReplayExp2({ board }: { board: Board }) {
  const f = board.figures;
  const ship = board.decisions["exp2.decision.ship"];
  const ready = board.final && !!ship;
  const closed = ready && ship === "control";
  return (
    <section className="block exp2" aria-labelledby="exp2-title">
      <div className="block-head">
        <h2 id="exp2-title">Second test: lanes_v2</h2>
        <p>After the rollout, lanes_v1 became control. The challenger lets the small model draft the patch while the frontier model reviews it.</p>
      </div>
      <div className={`workzone ${ready ? "is-ready" : "is-pending"}`} data-reveal="hang">
        <div className="workzone-board">
          <span className="workzone-legend">{ready ? (closed ? "Lane closed" : "Lane opened") : "Not run yet"}</span>
          <span className="workzone-sub">
            {ready
              ? closed
                ? "lanes_v2 did not beat the new control. Published as run."
                : "lanes_v2 beat the new control."
              : "Runs after the rollout. The result posts here either way."}
          </span>
        </div>
        {ready && (
          <RateTable
            caption="Experiment 2 results by arm"
            cols={["control", "lanes_v2", "change"]}
            rows={[
              ["Cost per solved task", f["exp2.arms.control.cost_per_solve"], f["exp2.arms.lanes_v2.cost_per_solve"], f["exp2.delta.cost_per_solve_pct"]],
              ["Solve rate", f["exp2.arms.control.solve_rate"], f["exp2.arms.lanes_v2.solve_rate"], f["exp2.delta.solve_rate_pp"]],
              ["Chance lanes_v2 is cheaper", undefined, f["exp2.flagsmith.chance_to_beat_control_cost"], undefined],
            ]}
          />
        )}
      </div>
    </section>
  );
}

function Proof({ board }: { board: Board }) {
  const exp = board.experiment;
  const f = board.figures;
  const batch = board.mode === "replay" ? undefined : batchOf(exp);
  const run = board.mode === "replay" ? undefined : repo.numbers?.integrity?.by_experiment[exp];
  const sha = batch?.preregSha ?? undefined;
  const line = (k: string, v: string | undefined, suffix = "") => (
    <div className="receipt-line">
      <span>{k}</span>
      <span>{v ? `${v}${suffix}` : "fills when the run ends"}</span>
    </div>
  );
  // Replay mode has only the fixture's own figures; a real batch reads its own ledger summary.
  const merkle = run ? run.merkle_root : board.mode === "replay" ? f["integrity.merkle_root"] : undefined;
  return (
    <section className="block proof" aria-labelledby="proof-title">
      <div className="block-head">
        <h2 id="proof-title">Proof the run was not edited</h2>
        <p>
          Every finished task is a record in a hash chain. The Merkle root below covers all of them. Flag config was
          snapshotted through the run; one distinct hash means it never changed.
        </p>
      </div>
      <div className="printer">
        <div className="printer-slot" aria-hidden="true" />
        <div className="receipt" data-reveal="print">
          <div className="receipt-head">
            <span>Fork in the Bill</span>
            <span>Run receipt · {exp}</span>
          </div>
          {exp !== "rollout" && (sha ? line("Pre-reg sha256", sha) : line("Pre-reg sha256", f[`${exp}.prereg.sha256`], "…"))}
          {line("Merkle root", merkle, run ? "" : "…")}
          {line("Task records", run ? String(run.task_done_records) : board.mode === "replay" ? f["integrity.task_done_records"] : undefined)}
          {line("Config snapshots", run ? String(run.env_snapshots) : board.mode === "replay" ? f["integrity.env_snapshots"] : undefined)}
          {line("Distinct config hashes", run ? String(run.env_snapshot_distinct_hashes) : board.mode === "replay" ? f["integrity.env_snapshot_distinct_hashes"] : undefined)}
          {line("Batch model spend", f[`spend.by_experiment.${exp}`] ?? (board.mode === "replay" ? f["spend.total_usd"] : undefined))}
          <div className="receipt-cut" aria-hidden="true" />
          <p className="receipt-foot">
            Check it yourself: <code>uv run python -m integrity.verify_ledger runs/{exp}</code>
          </p>
        </div>
      </div>
    </section>
  );
}

export function Sections({ board, phase }: { board: Board; phase: Phase }) {
  const exp = board.experiment;
  return (
    <>
      {exp === "rollout" ? (
        <RolloutFacts board={board} />
      ) : (
        <>
          <Rule board={board} />
          <Verdict board={board} phase={phase} />
        </>
      )}
      {exp === "exp1" && (board.mode === "replay" ? <ReplayExp2 board={board} /> : <Next board={board} />)}
      <Proof board={board} />
      <FlagHistory board={board} />
    </>
  );
}
