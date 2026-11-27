import { useRef, type ReactNode } from "react";
import { PageHead, Kinetic, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { pageMeta } from "../site/routes";
import { ghFile, repo } from "../site/data";
import { format } from "../data/format";

// Questions a careful reader asks, answered plainly. Every figure is read from the repository
// when the site is built: the power grid, the pilot, the pools, the pricing file and numbers.json.

const P = repo.power;
const N1 = repo.numbers?.exp1 ?? null;
const SPEND = repo.numbers?.spend ?? null;
const M = P ? Math.round(P.m * 100) : null;
const minArm = N1 ? Math.min(...Object.values(N1.arms).map((a) => a.n_analysed)) : null;
/** The power grid row closest to the smaller arm's size. */
const row = P && minArm ? P.grid.reduce((best, r) => (Math.abs(r.n_per_arm - minArm) < Math.abs(best.n_per_arm - minArm) ? r : best), P.grid[0]!) : null;
/** The smallest grid size at which a 5-point solve-rate drop is detected with the stated power. */
const fivePoint = P ? P.grid.find((r) => r.mde_solve_pp <= 5) : null;
const pools = repo.manifest?.pools ?? {};
const C = repo.policies.control;
const V = repo.policies.lanes_v1;
const usd2 = (v: number) => format(v, "usd2");

interface QA {
  id: string;
  q: string;
  a: ReactNode;
}

const GROUPS: { id: string; title: string; sign: string; items: QA[] }[] = [
  {
    id: "design",
    title: "The design",
    sign: "What was tested",
    items: [
      {
        id: "benchmark",
        q: "Is this a benchmark of two models?",
        a: (
          <p>
            No. Both arms use the same planner model, prompts, tools and caps. The only difference is which model does the delegated grunt work
            {C && V ? ` (${C.delegateShort} in control, ${V.delegateShort} in lanes_v1)` : ""}. The question is about a routing decision inside one agent, the
            kind of change a team would ship behind a flag. The result applies to this planner and worker design, not to an agent that does its own grunt
            work. <Link to="/method#how-it-works">How the agent works</Link>.
          </p>
        ),
      },
      {
        id: "arms",
        q: "Who decides which arm a task runs in?",
        a: (
          <p>
            Flagsmith. The runner calls <code>get_experiment_flag</code> with the task's identity and uses whatever policy comes back. It never picks an arm.
            Every recorded arm can be recomputed offline from a saved environment document with Flagsmith's own flag-engine
            {repo.versions.flagEngine ? ` ${repo.versions.flagEngine}` : ""}
            {repo.numbers?.integrity?.by_experiment.exp1?.assignment
              ? `: ${repo.numbers.integrity.by_experiment.exp1.assignment.matched} of ${repo.numbers.integrity.by_experiment.exp1.assignment.checked} matched for experiment 1`
              : ""}
            . <Link to="/flagsmith">Why Flagsmith is the core</Link>.
          </p>
        ),
      },
      {
        id: "early",
        q: "Could the run be stopped early when the numbers looked good?",
        a: (
          <p>
            No. The run continued until every task in the pools was done, excluded or invalid. The live board showed running totals from 89 tasks in, so the
            operator did see interim figures; the rule, the margin, the pools and the stopping rule were fixed in the registration before that and there was
            no early stop to take. <Link to="/timeline#d24">Decision D24</Link> records this.
          </p>
        ),
      },
      {
        id: "harness",
        q: "Was the agent changed to make the arms differ?",
        a: (
          <p>
            Yes, before registration, and identically for both arms. In the first dry runs the planner never delegated, so both arms would have run the same
            model on nearly every call and measured nothing. The planner prompt was changed to delegate surveys, long reads and test runs, then its shell
            output was cut, then its shell was removed. These three changes were in place before the pilot. <Link to="/timeline#d16">Decisions D16 to D18</Link>.
          </p>
        ),
      },
    ],
  },
  {
    id: "numbers",
    title: "The numbers",
    sign: "How sure",
    items: [
      {
        id: "power",
        q: "How much could this experiment detect?",
        a: (
          <>
            {row && P ? (
              <p>
                At {row.n_per_arm} tasks per arm, the simulation in <a href={ghFile("analysis/power.py")}>analysis/power.py</a> ({P.sims.toLocaleString("en-US")}{" "}
                runs seeded from the pilot) detects a {Math.round(row.mde_cost_pct)}% cut in mean cost with {Math.round(P.power * 100)}% power, and a solve-rate
                drop of {row.mde_solve_pp.toFixed(0)} points with the same power. If the small-model lane truly solves as many tasks as control, the guardrail
                passes {Math.round(row.guardrail_pass_rate * 100)}% of the time.
              </p>
            ) : (
              <p>The power figures come from analysis/power.py on the pilot.</p>
            )}
            <p>
              So the cost question was well powered and the solve-rate question was not. A drop of a few points cannot be seen at this size
              {fivePoint ? `: detecting a 5-point drop would take about ${fivePoint.n_per_arm.toLocaleString("en-US")} tasks per arm` : ""}.{" "}
              <Link to="/method#power">The power table</Link>.
            </p>
          </>
        ),
      },
      {
        id: "margin",
        q: "Why is the solve-rate margin so wide, and when was it chosen?",
        a: (
          <>
            <p>
              {M !== null ? `The margin m is ${M} percentage points. ` : ""}It was chosen after the pilot had been run and looked at, and before any experiment
              task ran. It was set so that an arm truly as good as control passes the guardrail more often than not at the sample size the task supply allowed.
              A 5-point margin would fail almost every time, even for an equal arm, so the experiment would decide nothing.
            </p>
            <p>
              That means rule 2 is a check against large losses only. A reader who wanted a tighter margin should read the result that way
              {N1 ? `: the solve-rate interval runs from ${format(N1.delta.solve_rate_ci[0], "pp1")} to ${format(N1.delta.solve_rate_ci[1], "pp1")}` : ""}.{" "}
              <Link to="/timeline#d19">Decision D19</Link>.
            </p>
          </>
        ),
      },
      {
        id: "cutoff",
        q: "Could the models have seen these bugs in training?",
        a: (
          <>
            <p>
              Some of them, yes. The registered pool held only tasks created after the models' training cutoff
              {repo.manifest?.freshFrom ? ` (from ${repo.manifest.freshFrom})` : ""}. That pool was too small for Flagsmith to report a verdict, so an amendment,
              hashed and tagged before any of its tasks ran, added {pools.exp1b?.count ?? "more"} older tasks
              {repo.manifest?.preFrom ? ` created from ${repo.manifest.preFrom}` : ""}. The pilot, the rollout batch and experiment 2 use pre-cutoff tasks only.
            </p>
            <p>
              Assignment is random, so a leak lifts both arms alike and does not bias the difference. It can raise the absolute solve rates, which is why the
              tiers are reported separately.
              {N1?.by_tier?.fresh
                ? ` On the fresh tier alone the solve rate was ${format(N1.by_tier.fresh.delta.solve_rate_pp, "pp1")} for lanes_v1 and the guardrail would not have cleared its bar; the decision was registered on both tiers together.`
                : ""}{" "}
              <Link to="/results#honest">The result by tier</Link>.
            </p>
          </>
        ),
      },
      {
        id: "agree",
        q: "Do Flagsmith's numbers and yours agree?",
        a: (
          <p>
            {N1 ? (
              <>
                Yes. The largest gap between Flagsmith's mean cost per arm and the one computed from the run's own logs is{" "}
                {format(Math.max(...Object.values(N1.agreement.cost_mean_abs_diff)), "usd4")}
                {Math.max(...Object.values(N1.agreement.solve_rate_abs_diff)) === 0 ? ", and the solve rates match exactly" : ""}. Flagsmith gave the small-model lane
                a {format(N1.flagsmith.chance_to_beat_control_cost, "prob1")} chance of being cheaper and called the solve-rate guardrail {N1.flagsmith.solve_rate_status}.
              </>
            ) : (
              <>The comparison posts with the results.</>
            )}{" "}
            <Link to="/results#checks">The checks</Link>.
          </p>
        ),
      },
    ],
  },
  {
    id: "flagsmith",
    title: "Flagsmith",
    sign: "Why this tool",
    items: [
      {
        id: "why",
        q: "Why run this as a Flagsmith experiment and not a script?",
        a: (
          <>
            <p>
              Because the claim has to be checkable by someone who does not trust the author. Flagsmith picks every arm by hashing the task's identity, records
              the exposure when the policy is applied, joins the cost and solve events to those exposures and reports the chance each variant beats control.
              The routing policy is the flag's value, so the thing being tested is the thing that ships.
            </p>
            <p>
              When the experiment ended, the winner became the flag's own value and the next batch ran on it with no deploy. A script that picked arms with
              its own random number generator could show none of that. <Link to="/flagsmith">Every Flagsmith feature used</Link>.
            </p>
          </>
        ),
      },
      {
        id: "lost",
        q: "What would have happened if the small model had lost?",
        a: (
          <p>
            Control would have stayed as the flag's value and the reason would have been published with the same tables. The second experiment follows the
            same promise: a result that keeps the current policy is published in full, the same way a win would be.
          </p>
        ),
      },
      {
        id: "touch",
        q: "Was the flag touched while an experiment ran?",
        a: (
          <p>
            No.
            {repo.numbers?.integrity?.by_experiment.exp1
              ? ` The environment was saved ${repo.numbers.integrity.by_experiment.exp1.env_snapshots} times through experiment 1 and every snapshot has the same hash (${repo.numbers.integrity.by_experiment.exp1.env_snapshot_distinct_hashes} distinct).`
              : ""}{" "}
            Flagsmith also locks a flag while its experiment runs, and the flags-as-code setup is read-only during a run. Only the kill switch may be used, for
            safety, and any use is logged. <Link to="/verify#run-receipt">The proof</Link>.
          </p>
        ),
      },
    ],
  },
  {
    id: "running",
    title: "Running it",
    sign: "Cost and reuse",
    items: [
      {
        id: "cost",
        q: "What did it cost to run?",
        a: (
          <>
            <p>
              {SPEND ? (
                <>
                  Model spend across the whole study so far is {usd2(SPEND.total_usd)}: {usd2(SPEND.by_experiment.exp1 ?? 0)} for experiment 1,{" "}
                  {usd2((SPEND.by_experiment["pilot-control"] ?? 0) + (SPEND.by_experiment["pilot-lanes_v1"] ?? 0))} for the pilot,{" "}
                  {usd2(SPEND.by_experiment.rollout ?? 0)} for the rollout batch and the rest for dry runs.
                </>
              ) : (
                <>The model spend posts with the results.</>
              )}{" "}
              Each task is capped{C ? ` at $${C.caps.usd_per_task.toFixed(2)}, ${C.caps.turns} planner turns and ${C.caps.seconds} seconds` : ""}, so a pool has a
              known worst case before it starts.
            </p>
            <p>
              That figure is model calls only. The run also used a rented Linux machine for the task containers and Flagsmith's free plan; neither is in the
              number above. Experiment 2's spend is added when its analysis runs.
            </p>
          </>
        ),
      },
      {
        id: "own",
        q: "Can I run this on my own agent?",
        a: (
          <p>
            Yes. The <Link to="/use-it#kit">kit</Link> wraps any agent loop in Python or TypeScript, works with Flagsmith Cloud or self-hosted Flagsmith, and sends the
            same four events. You bring the tasks and a way to grade them.
          </p>
        ),
      },
      {
        id: "check",
        q: "How do I check that the run was not edited?",
        a: (
          <p>
            Clone the repository and run one command per run directory: it walks the hash chain of the ledger and prints the Merkle root over every finished
            task. A second command recomputes every arm with Flagsmith's flag-engine. <Link to="/verify#run-receipt">The commands</Link>.
          </p>
        ),
      },
    ],
  },
];

export const FAQ_COUNT = GROUPS.reduce((n, g) => n + g.items.length, 0);

export default function Faq() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  return (
    <div className="page-wrap faq-page" ref={root}>
      <PageHead route={pageMeta("/faq")} lead={<>The questions a careful reader asks, answered plainly, with the weak points left in.</>} />
      <nav className="faq-jump" aria-label="Question groups">
        {GROUPS.map((g) => (
          <a key={g.id} href={`#${g.id}`}>
            <span>{g.sign}</span>
            <b>{g.title}</b>
            <i aria-hidden="true">{g.items.length}</i>
          </a>
        ))}
      </nav>
      {GROUPS.map((g, gi) => (
        <section className="faq-group" id={g.id} key={g.id} aria-labelledby={`${g.id}-h`}>
          <div className="faq-group-head">
            <span className="faq-km" aria-hidden="true">
              km {gi + 1}
            </span>
            <Kinetic id={`${g.id}-h`} text={g.title} />
            <p>{g.sign}</p>
          </div>
          <div className="faq">
            {g.items.map((it) => (
              <details key={it.id} id={it.id} className="faq-item" open={gi === 0 && it === g.items[0]}>
                <summary>
                  <span className="faq-q">{it.q}</span>
                  <span className="faq-icon" aria-hidden="true" />
                </summary>
                <div className="faq-a">{it.a}</div>
              </details>
            ))}
          </div>
        </section>
      ))}
      <p className="faq-more">
        A question that is not here? The <a href={`${repo.site.repo}/issues`}>issue tracker</a> is open, and every design choice is in{" "}
        <Link to="/timeline#decisions">the decisions log</Link>.
      </p>
    </div>
  );
}
