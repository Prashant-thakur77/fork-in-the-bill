import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Road } from "../components/Road";
import { armInfo } from "../data/arms";
import { Led } from "../led/Led";
import { prefersReducedMotion } from "../motion";
import { ghFile, repo } from "../site/data";

// The board's signature moment, playable before the run ends: pick an outcome and watch the
// losing lane close (red X, the last cars clear, cones placed one by one, the "Lane closed" plate
// lands) while traffic merges into the winner. The signs carry each lane's pilot figures, so the
// choice shows what is at stake. Both outcomes are offered, and the panel says it is a preview.

type Outcome = "running" | "lanes_v1" | "control";
const KEYS = ["control", "lanes_v1"] as const;
const pilot = repo.pilot?.arms;

const usd3 = (v: number) => `$${v.toFixed(3)}`;
const ofN = (a: { solved: number; n: number }) => `${a.solved} of ${a.n}`;

function stakes(outcome: Outcome): string {
  if (!pilot?.control || !pilot.lanes_v1) return "";
  const c = pilot.control;
  const v = pilot.lanes_v1;
  const less = Math.round((1 - v.usd_mean / c.usd_mean) * 100);
  const more = Math.round((c.usd_mean / v.usd_mean - 1) * 100);
  if (outcome === "lanes_v1")
    return `Every task would take the small-delegate lane. In the pilot that lane cost ${usd3(v.usd_mean)} a task against ${usd3(c.usd_mean)} (${less}% less) and solved ${ofN(v)} bugs against ${ofN(c)}.`;
  if (outcome === "control")
    return `Every task would keep the frontier model for the grunt work. In the pilot that lane cost ${usd3(c.usd_mean)} a task, ${more}% more than the small delegate, and solved ${ofN(c)} bugs against ${ofN(v)}.`;
  return "";
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

  return (
    <div className="rollout" ref={root}>
      <div className="rollout-head">
        <span className="rollout-badge">Preview, not a result</span>
        <h3 className="rollout-h">Play the decision</h3>
        <p>
          When the run ends, the experiment stops and the winner's value is served on the same flag. Pick an outcome: the other lane closes and every task
          merges into the winner.
        </p>
        <div className="rollout-btns" role="group" aria-label="Preview a rollout outcome">
          {(
            [
              ["lanes_v1", "If lanes_v1 ships"],
              ["control", "If control stays"],
              ["running", "Reopen both lanes"],
            ] as [Outcome, string][]
          ).map(([k, label]) => (
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
              const a = pilot?.[k];
              const shut = closed(k);
              return (
                <article key={k} className={`sign ${shut ? "is-closed" : ""}`} aria-label={`${k} lane${shut ? ", closed" : ", open"}`}>
                  <div className="sign-tab">{armInfo(k).tab}</div>
                  {shut && <div className="closed-plate">Lane closed</div>}
                  <div className="sign-face">
                    <h4 className="sign-legend">{armInfo(k).legend}</h4>
                    <div className="led-housing">
                      <span className="led-caption">{shut ? "Lane status" : "Pilot, per task"}</span>
                      <Led
                        text={shut ? "CLOSED" : a ? usd3(a.usd_mean) : "$-.---"}
                        cols={38}
                        align="center"
                        scan
                        tone={shut ? "red" : "amber"}
                        label={shut ? "Lane closed" : a ? `${usd3(a.usd_mean)} per task in the pilot` : "no pilot figure"}
                      />
                    </div>
                    <dl className="sign-stats">
                      <div>
                        <dt>Pilot solves</dt>
                        <dd>{a ? ofN(a) : "—"}</dd>
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
        <p>{line || "Both lanes are open, as they are while the run goes on. Pick an outcome above."}</p>
        {pilot && (
          <p className="rollout-src">
            Pilot figures: {pilot.control?.n} tasks per arm, arms forced by the runner, from{" "}
            <a href={ghFile("analysis/out/pilot.json")}>analysis/out/pilot.json</a>. They show the stakes, not the result.
          </p>
        )}
      </div>
    </div>
  );
}
