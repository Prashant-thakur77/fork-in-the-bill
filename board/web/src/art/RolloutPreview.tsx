import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Road } from "../components/Road";
import { armInfo } from "../data/arms";
import { format } from "../data/format";
import { Led } from "../led/Led";
import { prefersReducedMotion } from "../motion";
import { ghFile, repo } from "../site/data";

// The board's signature moment, playable: pick an outcome and watch the losing lane close (red X,
// the last cars clear, cones placed one by one, the "Lane closed" plate lands) while traffic
// merges into the winner. Once experiment 1 is decided the signs carry its real figures and the
// panel says which outcome happened; before that they carry the pilot's, as a labelled preview.

type Outcome = "running" | "lanes_v1" | "control";
const KEYS = ["control", "lanes_v1"] as const;
const pilot = repo.pilot?.arms;
const N1 = repo.numbers?.exp1 ?? null;
const SHIP = (repo.decisions["exp1.decision.ship"] as Outcome | undefined) ?? null;
const decided = !!N1 && (SHIP === "lanes_v1" || SHIP === "control");

const usd3 = (v: number) => `$${v.toFixed(3)}`;
const ofN = (a: { solved: number; n: number }) => `${a.solved} of ${a.n}`;

/** What each lane's sign reads: the experiment's figures once decided, the pilot's before. */
function reading(k: (typeof KEYS)[number]): { cost: string; solves: string } | null {
  if (decided) {
    const a = N1!.arms[k];
    return a ? { cost: format(a.cost_mean, "usd4"), solves: `${a.solves} of ${a.n_analysed}` } : null;
  }
  const a = pilot?.[k];
  return a ? { cost: usd3(a.usd_mean), solves: ofN(a) } : null;
}

function stakes(outcome: Outcome): string {
  if (outcome === "running") return "";
  if (decided) {
    const d = N1!.delta;
    if (outcome === SHIP) {
      return outcome === "lanes_v1"
        ? `This is what happened. All three registered conditions held, so the experiment was ended with lanes_v1 as the flag's own value: mean cost per task ${format(d.cost_mean_pct, "pct1")}, solve rate ${format(d.solve_rate_pp, "pp1")}.`
        : "This is what happened. One of the three registered conditions failed, so control stayed and the reason was published.";
    }
    return outcome === "control"
      ? "This did not happen. Had any one of the three conditions failed, control would have stayed, the small-delegate lane would have closed and the reason would have been published."
      : "This did not happen. Had all three conditions held, lanes_v1 would have become the flag's own value.";
  }
  if (!pilot?.control || !pilot.lanes_v1) return "";
  const c = pilot.control;
  const v = pilot.lanes_v1;
  const less = Math.round((1 - v.usd_mean / c.usd_mean) * 100);
  const more = Math.round((c.usd_mean / v.usd_mean - 1) * 100);
  if (outcome === "lanes_v1")
    return `Every task would take the small-delegate lane. In the pilot that lane cost ${usd3(v.usd_mean)} a task against ${usd3(c.usd_mean)} (${less}% less) and solved ${ofN(v)} bugs against ${ofN(c)}.`;
  return `Every task would keep the frontier model for the grunt work. In the pilot that lane cost ${usd3(c.usd_mean)} a task, ${more}% more than the small delegate, and solved ${ofN(c)} bugs against ${ofN(v)}.`;
}

export function RolloutPreview() {
  const [outcome, setOutcome] = useState<Outcome>("running");
  const root = useRef<HTMLDivElement>(null);
  const closed = (k: string) => outcome !== "running" && k !== outcome;

  useEffect(() => {
    if (outcome === "running" || !root.current || prefersReducedMotion()) return;
    const q = gsap.utils.selector(root.current);
    const tl = gsap.timeline();
    tl.from(q(".signal-closed"), { scale: 0.7, duration: 0.16, ease: "power4.out" })
      .from(q(".closed-plate"), { scale: 1.35, opacity: 0, duration: 0.32, ease: "power4.out" }, 0.3)
      .from(q(".rollout-stakes > p"), { opacity: 0, y: 8, duration: 0.4, ease: "expo.out" }, 0.2);
    return () => {
      tl.kill();
    };
  }, [outcome]);

  const lanes = KEYS.map((k, i) => ({ key: k, x: i === 0 ? 250 : 750, cars: 2, closed: closed(k) }));
  const line = stakes(outcome);
  const real = decided && outcome === SHIP;
  const buttons: [Outcome, string][] = decided
    ? [
        [SHIP!, SHIP === "lanes_v1" ? "What happened: lanes_v1 shipped" : "What happened: control stayed"],
        [SHIP === "lanes_v1" ? "control" : "lanes_v1", SHIP === "lanes_v1" ? "The other outcome: control stays" : "The other outcome: lanes_v1 ships"],
        ["running", "Reopen both lanes"],
      ]
    : [
        ["lanes_v1", "If lanes_v1 ships"],
        ["control", "If control stays"],
        ["running", "Reopen both lanes"],
      ];

  return (
    <div className="rollout" ref={root}>
      <div className="rollout-head">
        {decided ? (
          <span className={`rollout-tag ${outcome === "running" ? "" : real ? "is-real" : "is-other"}`}>
            {outcome === "running" ? "Experiment 1 · decided" : real ? "What happened" : "Not what happened"}
          </span>
        ) : (
          <span className="rollout-badge">Preview, not a result</span>
        )}
        <h2 className="rollout-h">Play the decision</h2>
        <p>
          {decided
            ? "When experiment 1 ended, it was stopped in Flagsmith and the winner's value was served on the same flag. Play it back, or play the outcome the rule would have given had a condition failed."
            : "When the run ends, the experiment stops and the winner's value is served on the same flag. Pick an outcome: the other lane closes and every task merges into the winner."}
        </p>
        <div className="rollout-btns" role="group" aria-label={decided ? "Play a rollout outcome" : "Preview a rollout outcome"}>
          {buttons.map(([k, label]) => (
            <button key={k} type="button" className={`rb-btn ${outcome === k ? "is-on" : ""}`} aria-pressed={outcome === k} onClick={() => setOutcome(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="junction rollout-junction" data-phase={outcome === "running" ? "running" : "rolled_out"}>
        <div className="gantry">
          <div className="beam" aria-hidden="true">
            <svg viewBox="0 0 1000 24" preserveAspectRatio="none">
              <rect x="0" y="2" width="1000" height="3" />
              <rect x="0" y="19" width="1000" height="3" />
              <path d={Array.from({ length: 50 }, (_, i) => `M${i * 20} 4 L${i * 20 + 10} 20 L${i * 20 + 20} 4`).join(" ")} />
            </svg>
          </div>
          <div className="signs">
            {KEYS.map((k) => {
              const r = reading(k);
              const shut = closed(k);
              return (
                <article key={k} className={`sign ${shut ? "is-closed" : ""}`} aria-label={`${k} lane${shut ? ", closed" : ", open"}`}>
                  <div className="sign-tab">{armInfo(k).tab}</div>
                  {shut && <div className="closed-plate">Lane closed</div>}
                  <div className="sign-face">
                    <h3 className="sign-legend">{armInfo(k).legend}</h3>
                    <div className="led-housing">
                      <span className="led-caption">{shut ? "Lane status" : decided ? "Experiment 1, per task" : "Pilot, per task"}</span>
                      <Led
                        text={shut ? "CLOSED" : r ? r.cost : "$-.---"}
                        cols={decided ? 44 : 38}
                        align="center"
                        scan
                        tone={shut ? "red" : "amber"}
                        label={shut ? "Lane closed" : r ? `${r.cost} per task${decided ? " in experiment 1" : " in the pilot"}` : "no figure"}
                      />
                    </div>
                    <dl className="sign-stats">
                      <div>
                        <dt>{decided ? "Solved" : "Pilot solves"}</dt>
                        <dd>{r ? r.solves : "—"}</dd>
                      </div>
                    </dl>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="signals" aria-hidden="true">
            {KEYS.map((k) => (
              <div key={k} className={`signal ${closed(k) ? "signal-closed" : "signal-open"}`}>
                <svg viewBox="0 0 40 40">{closed(k) ? <path d="M9 9 L31 31 M31 9 L9 31" /> : <path d="M20 6 V30 M10 21 L20 32 L30 21" />}</svg>
              </div>
            ))}
          </div>
        </div>
        <Road lanes={lanes} />
      </div>
      <div className="rollout-stakes" role="status">
        <p>{line || (decided ? "Both lanes are open, as they were while the run went on. Pick an outcome above." : "Both lanes are open, as they are while the run goes on. Pick an outcome above.")}</p>
        {decided ? (
          <p className="rollout-src">
            Experiment 1 figures from <a href={ghFile("analysis/out/numbers.json")}>analysis/out/numbers.json</a>. The cars are an illustration.
          </p>
        ) : (
          pilot && (
            <p className="rollout-src">
              Pilot figures: {pilot.control?.n} tasks per arm, arms forced by the runner, from <a href={ghFile("analysis/out/pilot.json")}>analysis/out/pilot.json</a>. They
              show the stakes, not the result.
            </p>
          )
        )}
      </div>
    </div>
  );
}
