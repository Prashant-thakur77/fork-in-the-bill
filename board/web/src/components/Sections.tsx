import type { Board } from "../data/types";
import { FlagHistory } from "./FlagHistory";
import type { Phase } from "./Junction";
import { repo } from "../site/data";

// The registration hash is known from the repo at build time; the run's own figures fill in later.
const PREREG_SHA = repo.hashes.find((h) => h.file === "prereg/experiment-1.md")?.sha256;

type Tri = "pending" | "met" | "not met";

function triOf(v: string | undefined): Tri {
  return v === "true" ? "met" : v === "false" ? "not met" : "pending";
}

function Rule({ board }: { board: Board }) {
  const f = board.figures;
  const d = board.decisions;
  const m = f["exp1.prereg.m"];
  const rows: { text: string; figure?: string; figureLabel: string; state: Tri }[] = [
    {
      text: "Flagsmith gives lanes_v1 at least a 95% chance of a lower mean cost per task.",
      figure: f["exp1.flagsmith.chance_to_beat_control_cost"],
      figureLabel: "Chance to beat control",
      state: triOf(d["exp1.decision.rule_met.flagsmith_95"]),
    },
    {
      text: `Our own posterior gives at least 90% that the solve rate drops by less than ${m ?? "the margin m"}.`,
      figure: f["exp1.delta.p_solve_drop_within_m"],
      figureLabel: "P(drop within margin)",
      state: triOf(d["exp1.decision.rule_met.guardrail_90"]),
    },
    {
      text: "Flagsmith shows no loss on the solve-rate guardrail.",
      figureLabel: "Guardrail",
      state: triOf(d["exp1.decision.rule_met.no_guardrail_loss"]),
    },
  ];
  return (
    <section className="block rule" id="rule" aria-labelledby="rule-title">
      <div className="block-head">
        <h2 id="rule-title">The rule, fixed before the first task</h2>
        <p>
          lanes_v1 ships only if all three hold. Otherwise control stays, and the reason is published. No early
          stopping.
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
        <code className="hash-full">{PREREG_SHA ?? (f["exp1.prereg.sha256"] ? `${f["exp1.prereg.sha256"]}…` : "posts with the pre-registration tag")}</code>
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
  const f = board.figures;
  const ship = board.decisions["exp1.decision.ship"];
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
                <span>control</span> stays
              </>
            ) : (
              <>
                <span>{ship}</span> ships
              </>
            )
          ) : (
            "Awaiting run"
          )}
        </div>
        {ready && (
          <RateTable
            caption="Experiment 1 results by arm"
            cols={["control", "lanes_v1", "change"]}
            rows={[
              ["Cost per solved task", f["exp1.arms.control.cost_per_solve"], f["exp1.arms.lanes_v1.cost_per_solve"], f["exp1.delta.cost_per_solve_pct"]],
              ["Mean cost per task", f["exp1.arms.control.cost_mean"], f["exp1.arms.lanes_v1.cost_mean"], f["exp1.delta.cost_mean_pct"]],
              ["Solve rate", f["exp1.arms.control.solve_rate"], f["exp1.arms.lanes_v1.solve_rate"], f["exp1.delta.solve_rate_pp"]],
              ["Tasks analysed", f["exp1.arms.control.n_analysed"], f["exp1.arms.lanes_v1.n_analysed"], undefined],
            ]}
          />
        )}
        {ready && f["exp1.srm.p"] && (
          <p className="verdict-foot">
            Sample-ratio check p = {f["exp1.srm.p"]}. Cost per solved task = mean cost ÷ solve rate.
          </p>
        )}
      </div>
    </section>
  );
}

function Exp2({ board }: { board: Board }) {
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
  const f = board.figures;
  const line = (k: string, v: string | undefined, suffix = "") => (
    <div className="receipt-line">
      <span>{k}</span>
      <span>{v ? `${v}${suffix}` : "fills when the run ends"}</span>
    </div>
  );
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
          <span>Run receipt · exp1</span>
        </div>
        {PREREG_SHA ? line("Pre-reg sha256", PREREG_SHA) : line("Pre-reg sha256", f["exp1.prereg.sha256"], "…")}
        {line("Merkle root", f["integrity.merkle_root"], "…")}
        {line("Task records", f["integrity.task_done_records"])}
        {line("Config snapshots", f["integrity.env_snapshots"])}
        {line("Distinct config hashes", f["integrity.env_snapshot_distinct_hashes"])}
        {line("Total model spend", f["spend.total_usd"])}
        <div className="receipt-cut" aria-hidden="true" />
        <p className="receipt-foot">
          Check it yourself: <code>python integrity/verify_ledger.py</code>
        </p>
        </div>
      </div>
    </section>
  );
}

export function Sections({ board, phase }: { board: Board; phase: Phase }) {
  return (
    <>
      <Rule board={board} />
      <Verdict board={board} phase={phase} />
      <Exp2 board={board} />
      <Proof board={board} />
      <FlagHistory board={board} />
    </>
  );
}
