import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Road } from "../components/Road";
import { armInfo } from "../data/arms";
import { prefersReducedMotion } from "../motion";

// The board's signature moment, playable before the run ends: pick an outcome and watch the
// losing lane close (red X, cones placed one by one, the "Lane closed" plate lands) while traffic
// merges into the winner. Both outcomes are offered, and the panel says it is a preview.

type Outcome = "running" | "lanes_v1" | "control";
const KEYS = ["control", "lanes_v1"] as const;

export function RolloutPreview() {
  const [outcome, setOutcome] = useState<Outcome>("running");
  const root = useRef<HTMLDivElement>(null);
  const closed = (k: string) => outcome !== "running" && k !== outcome;

  useEffect(() => {
    if (outcome === "running" || !root.current || prefersReducedMotion()) return;
    const q = gsap.utils.selector(root.current);
    const tl = gsap.timeline();
    tl.from(q(".signal-closed"), { scale: 0.7, duration: 0.16, ease: "power4.out" })
      .from(q(".closure .cone"), { scale: 0, transformOrigin: "50% 50%", transformBox: "fill-box", duration: 0.22, ease: "back.out(2.2)", stagger: 0.09 }, 0.1)
      .from(q(".closed-plate"), { scale: 1.35, opacity: 0, duration: 0.32, ease: "power4.out" }, 0.55);
    return () => {
      tl.kill();
    };
  }, [outcome]);

  const lanes = KEYS.map((k, i) => ({ key: k, x: i === 0 ? 250 : 750, cars: 2, closed: closed(k) }));

  return (
    <div className="rollout" ref={root}>
      <div className="rollout-head">
        <span className="rollout-badge">Preview, not a result</span>
        <p>
          After the decision, the experiment ends and the winner's value is served on the same flag. Pick an outcome to see the board close the other
          lane.
        </p>
        <div className="rollout-btns" role="group" aria-label="Preview a rollout outcome">
          {(
            [
              ["lanes_v1", "If lanes_v1 ships"],
              ["control", "If control stays"],
              ["running", "Reset"],
            ] as [Outcome, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" className={`rb-btn ${outcome === k ? "is-on" : ""}`} aria-pressed={outcome === k} onClick={() => setOutcome(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="sr-only" role="status">
        {outcome === "running" ? "Preview reset: both lanes open." : outcome === "control" ? "Preview: control stays, lanes_v1 lane closed." : "Preview: lanes_v1 ships, control lane closed."}
      </p>
      <div className="junction rollout-junction" data-phase={outcome === "running" ? "running" : "rolled_out"}>
        <div className="gantry">
          <div className="signs">
            {KEYS.map((k) => (
              <article key={k} className={`sign ${closed(k) ? "is-closed" : ""}`} aria-label={`${k} lane${closed(k) ? ", closed" : ", open"}`}>
                <div className="sign-tab">{armInfo(k).tab}</div>
                {closed(k) && <div className="closed-plate">Lane closed</div>}
                <div className="sign-face">
                  <h3 className="sign-legend">{armInfo(k).legend}</h3>
                </div>
              </article>
            ))}
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
    </div>
  );
}
