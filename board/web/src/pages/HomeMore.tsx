import type { ReactNode } from "react";
import { Led } from "../led/Led";
import { Link } from "../site/router";
import { Kinetic } from "../site/ui";
import { ghFile, repo } from "../site/data";
import { format } from "../data/format";

// The home page's supporting sections: the bill split by lane, Flagsmith's four jobs, the measured
// gap at a larger size, the later checks, and how to use it. Every figure is read from
// analysis/out/numbers.json or the repository at build; each section renders only when its data exists.

const N = repo.numbers;
const N1 = N?.exp1 ?? null;
const usd4 = (v: number) => format(v, "usd4");
const n = (v: number) => v.toLocaleString("en-US");

/* ---------- the bill, split into its two lanes ---------- */

function Receipt({ arm, legend }: { arm: string; legend: string }) {
  const a = N1!.arms[arm] as unknown as { cost_mean: number; main_cost_mean?: number; delegate_cost_mean?: number; delegate_share_cost: number };
  if (a.main_cost_mean === undefined || a.delegate_cost_mean === undefined) return null;
  const share = a.delegate_share_cost;
  return (
    <div className="printer bill-printer">
      <div className="printer-slot" aria-hidden="true" />
      <div className="receipt bill-receipt" data-reveal="print">
        <div className="receipt-head">
          <span>{arm}</span>
          <span>{legend}</span>
        </div>
        <div className="receipt-line">
          <span>Planner lane: reads, edits, decides</span>
          <span>{usd4(a.main_cost_mean)}</span>
        </div>
        <div className="receipt-line is-grunt">
          <span>Worker lane: searches, builds, runs tests</span>
          <span>{usd4(a.delegate_cost_mean)}</span>
        </div>
        <div className="receipt-cut" aria-hidden="true" />
        <div className="receipt-line is-total">
          <span>One task, on average</span>
          <span>{usd4(a.cost_mean)}</span>
        </div>
        <div className="bill-bar" role="img" aria-label={`The worker lane is ${format(share, "prob1")} of this bill`}>
          <i style={{ width: `${(share * 100).toFixed(1)}%` }} />
        </div>
        <p className="receipt-foot">Grunt work is {format(share, "prob1")} of this bill.</p>
      </div>
    </div>
  );
}

export function Bill() {
  if (!N1 || N1.arms.control?.delegate_share_cost === undefined) return null;
  const P = N?.pricing ?? null;
  return (
    <section className="hsec more-sec bill-sec" aria-labelledby="bill-h">
      <div className="more-head">
        <p className="eyebrow-sign">The problem</p>
        <Kinetic id="bill-h" text="Most of the bill was grunt work" />
        <p>
          A coding agent spends much of its money searching the repository, reading long files and running tests. With one frontier model doing everything, that work
          was {format(N1.arms.control!.delegate_share_cost, "prob1")} of each task's cost.
          {P ? ` The small model's list price per token is ${n(P.frontier_to_small_ratio)} times lower.` : ""}
        </p>
        <Link to="/method#why" className="text-link">
          The prices, and the two lanes <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="bill-pair">
        <Receipt arm="control" legend="frontier everywhere" />
        <Receipt arm="lanes_v1" legend="small model on the worker lane" />
      </div>
      <p className="more-src">
        Mean cost per task in experiment 1, split by lane. <a href={ghFile("analysis/out/numbers.json")}>analysis/out/numbers.json</a>
      </p>
    </section>
  );
}

/* ---------- Flagsmith at the centre: four jobs hung from one gantry ---------- */

function JobArt({ kind }: { kind: "assign" | "record" | "judge" | "roll" }) {
  return (
    <svg viewBox="0 0 72 56" className="job-art" aria-hidden="true">
      {kind === "assign" && <path d="M36 54 V38 C36 26 16 28 16 16 V4 M36 38 C36 26 56 28 56 16 V4 M9 11 L16 3 L23 11 M49 11 L56 3 L63 11" />}
      {kind === "record" && (
        <>
          <rect x="10" y="6" width="52" height="44" rx="4" />
          <path d="M20 20 H52 M20 30 H44" />
          <path className="is-accent" d="M20 40 H36" />
        </>
      )}
      {kind === "judge" && (
        <>
          <path d="M8 48 H64 M16 48 V28 M30 48 V14 M44 48 V34" />
          <path className="is-accent" d="M50 20 L56 27 L66 12" />
        </>
      )}
      {kind === "roll" && (
        <>
          <path d="M24 54 V30 C24 18 40 20 40 8 V2" />
          <path d="M52 54 V42" />
          <path className="is-accent" d="M45 22 L59 36 M59 22 L45 36" />
        </>
      )}
    </svg>
  );
}

export function FourJobs() {
  const assign = N?.integrity?.by_experiment.exp1?.assignment ?? null;
  const jobs: { kind: "assign" | "record" | "judge" | "roll"; verb: string; what: string; fig: ReactNode; to: string }[] = [
    {
      kind: "assign",
      verb: "Assigns",
      what: "Hashes each task's identity against the split. The runner never picks an arm.",
      fig: assign ? `${assign.matched} of ${assign.checked} arms re-derived offline` : "every arm re-derivable offline",
      to: "/flagsmith#engine",
    },
    {
      kind: "record",
      verb: "Records",
      what: "Takes the exposure when the policy is applied, then the cost and solve events for the same identity.",
      fig: `${n(repo.scale.totals.events)} events sent to it, all runs`,
      to: "/flagsmith#events",
    },
    {
      kind: "judge",
      verb: "Judges",
      what: "Joins events to exposures and reports, per metric, the chance a variant beats control.",
      fig: N1 ? `${format(N1.flagsmith.chance_to_beat_control_cost, "prob1")} chance lanes_v1 is cheaper` : "the verdict the rule reads",
      to: "/results",
    },
    {
      kind: "roll",
      verb: "Rolls out",
      what: "Ending the experiment makes the winner what every task gets, on the same flag, with no deploy.",
      fig: N?.rollout ? `${N.rollout.n} fresh tasks on the rolled-out flag` : "the winner, on the same flag",
      to: "/results#end-experiment",
    },
  ];
  return (
    <section className="hsec more-sec jobs-sec" aria-labelledby="jobs-h">
      <div className="more-head is-center">
        <p className="eyebrow-sign">Flagsmith at the centre</p>
        <Kinetic id="jobs-h" text="One flag does four jobs" />
        <p>The routing policy is the flag's value. Everything the experiment needs to be believed happens at that flag.</p>
      </div>
      <div className="jobs-gantry">
        <span className="jobs-beam" aria-hidden="true" />
        <div className="jobs-led" aria-hidden="true">
          <Led text="FLAGSMITH" cols={64} align="center" label="Flagsmith" />
        </div>
        <ol className="jobs" data-reveal="row">
          {jobs.map((j, i) => (
            <li key={j.verb}>
              <Link to={j.to} className="job" data-cursor="open">
                <span className="job-n" aria-hidden="true">
                  {i + 1}
                </span>
                <JobArt kind={j.kind} />
                <b>{j.verb}</b>
                <span className="job-what">{j.what}</span>
                <span className="job-fig">{j.fig}</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- the measured gap at a larger size ---------- */

export function Money() {
  const P = N?.projection ?? null;
  if (!P) return null;
  const rows: [string, number][] = [
    ["control", P.per_1000_solved.control],
    ["lanes_v1", P.per_1000_solved.lanes_v1],
  ];
  return (
    <section className="hsec more-sec money-sec live-sec" aria-labelledby="money-h">
      <div className="money-inner">
        <div className="hsec-copy">
          <p className="eyebrow-sign is-dark">At a larger size</p>
          <Kinetic id="money-h" text="Per thousand solved bugs" />
          <p>
            Experiment 1's cost per solved task in each arm, multiplied by 1,000. It assumes the same agent, models, prices and kind of task, and it is exactly as
            uncertain as the figures it is made from.
          </p>
          <p className="money-label">Arithmetic on measured figures, not a measurement</p>
          <Link to="/scale" className="btn btn-sheet">
            Every count, with its source <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="money-signs" data-reveal="row">
          {rows.map(([arm, v]) => (
            <div className="money-sign" key={arm}>
              <span className="lp-tab">{arm}</span>
              <div className="led-housing">
                <span className="led-caption">1,000 solved tasks would cost</span>
                <Led text={format(v, "usd2")} cols={46} label={`${format(v, "usd2")} per 1,000 solved tasks`} />
              </div>
            </div>
          ))}
          <p className="money-saved">
            <b data-count="">{format(P.per_1000_solved.saved, "usd2")}</b>
            <span>difference per 1,000 solved bugs</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------- the later checks, in one strip ---------- */

export function Checks() {
  const av = N1?.secondary?.always_valid ?? null;
  const mv = N1?.secondary?.multiverse ?? null;
  const fr = N?.frontier ?? null;
  const pr = N?.integrity?.proofs ?? null;
  const has = (f: string) => repo.charts.includes(f);
  const cards: { id: string; img?: string; alt?: string; k: string; v: string; t: string }[] = [];
  if (av)
    cards.push({
      id: "johari-koomen-2017",
      img: has("exp1-always-valid.png") ? "exp1-always-valid.png" : undefined,
      alt: "The always-valid p-values over the run",
      k: "Could it have been stopped early on a lucky reading?",
      v: av.cost.first_cross_at ? `Cost crossed at task ${av.cost.first_cross_at} of ${av.n_tasks}` : "Cost never crossed",
      t: `with a p-value that stays valid under continuous watching. The solve rate ${av.solve.crossed ? "crossed too" : "never crossed"}.`,
    });
  if (mv)
    cards.push({
      id: "nosek-ebersole-2018",
      img: has("exp1-specification-curve.png") ? "exp1-specification-curve.png" : undefined,
      alt: "The specification curve",
      k: "Does it depend on how the analysis was done?",
      v: `Cheaper in ${mv.cost_direction} of ${mv.n_specs} analyses`,
      t: `The solve-rate check passes in ${mv.guardrail_pass}${mv.guardrail_fail_only_fresh ? `; all ${mv.guardrail_fail} failures use the fresh tier alone` : ""}.`,
    });
  if (fr)
    cards.push({
      id: "kapoor-stroebl-2024",
      img: has("frontier.png") ? "frontier.png" : undefined,
      alt: "Cost against solve rate for every arm",
      k: "Where does each arm sit on cost against solve rate?",
      v: `${fr.n_on_frontier} of ${fr.n_arms} arms on the frontier`,
      t: "Descriptive only: the batches ran on different task pools.",
    });
  if (pr?.exp1)
    cards.push({
      id: "merkle-1988",
      k: "Is one task really part of the published result?",
      v: `${pr.exp1.verified} of ${pr.exp1.leaves} proofs verify`,
      t: `Each is the task's hash and at most ${pr.exp1.path_length_max} neighbours.`,
    });
  if (!cards.length) return null;
  return (
    <section className="hsec more-sec checks-sec" aria-labelledby="checks-h">
      <div className="more-head">
        <p className="eyebrow-sign">Checked again, after</p>
        <Kinetic id="checks-h" text="Four ways the result could have been wrong" />
        <p>Each check comes from published work and was run after the decision. None of them entered it; all are labelled secondary.</p>
        <Link to="/research" className="text-link">
          Every source, and what it produces here <span aria-hidden="true">→</span>
        </Link>
      </div>
      <ul className="checks" data-reveal="row">
        {cards.map((c) => (
          <li key={c.id}>
            <Link to={c.id === "merkle-1988" ? "/verify#proof" : `/research#${c.id}`} className="check" data-cursor="open">
              {c.img ? (
                <img src={`/figures/${c.img}`} alt={c.alt} width={320} height={200} loading="lazy" decoding="async" />
              ) : (
                <svg viewBox="0 0 320 200" className="check-art" aria-hidden="true">
                  <path d="M160 26 V58 M90 58 H230 M90 58 V92 M230 58 V92 M56 92 H124 M196 92 H264 M56 92 V126 M124 92 V126 M196 92 V126 M264 92 V126" />
                  <rect x="130" y="8" width="60" height="26" rx="5" className="is-root" />
                  {[56, 124, 196, 264].map((x) => (
                    <rect key={x} x={x - 22} y={126} width="44" height="24" rx="4" className={x === 196 ? "is-leaf" : ""} />
                  ))}
                  <path className="is-path" d="M196 126 V92 H230 V58 H160 V34" />
                </svg>
              )}
              <span className="check-k">{c.k}</span>
              <b>{c.v}</b>
              <span className="check-t">{c.t}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- use it: three ways in, as a terminal ---------- */

export function UseStrip() {
  const K = repo.kit;
  const cfg = (() => {
    try {
      const j = JSON.parse(K.mcp?.blocks[0]?.code ?? "") as { mcpServers?: Record<string, { command?: string; args?: string[] }> };
      const s = Object.values(j.mcpServers ?? {})[0];
      return s?.command ? `${s.command} ${(s.args ?? []).join(" ")}` : null;
    } catch {
      return null;
    }
  })();
  const lines: { label: string; cmd: string; note: string }[] = [];
  if (K.ts?.published && repo.snippets.tsInstall) lines.push({ label: "TypeScript", cmd: repo.snippets.tsInstall.code.split("\n")[0]!, note: `${K.ts.name} ${K.ts.version}` });
  if (K.mcp && cfg) lines.push({ label: "Any MCP client", cmd: cfg, note: `${K.mcp.name} ${K.mcp.version}` });
  lines.push({ label: "Python", cmd: `git clone ${repo.site.repo}.git && cd ${repo.site.repo.split("/").pop()} && uv sync`, note: "package forkbill, in kit/forkbill" });
  return (
    <section className="hsec more-sec use-sec" aria-labelledby="use-h">
      <div className="more-head">
        <p className="eyebrow-sign">Use it</p>
        <Kinetic id="use-h" text="Put your own agent on the same road" />
        <p>
          The kit turns any agent loop into a two-lane loop driven by a Flagsmith experiment: one task is one identity, the flag's value is the routing policy, and four
          events carry the outcome.
        </p>
        <Link to="/use-it" className="btn btn-dark">
          The six steps <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="term" data-reveal="hang">
        <div className="term-bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>three ways in</span>
        </div>
        <ol className="term-lines">
          {lines.map((l) => (
            <li key={l.label}>
              <span className="term-label">
                {l.label} <small>{l.note}</small>
              </span>
              <code>
                <span className="term-prompt" aria-hidden="true">
                  ${" "}
                </span>
                {l.cmd}
              </code>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
