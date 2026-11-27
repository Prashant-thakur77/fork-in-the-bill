import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ghFile, pct, repo } from "../site/data";
import { prefersReducedMotion } from "../motion";

// Guess, then reveal: what share of the control arm's spend went to the worker lane in the pilot?
// The answer is the pilot's measured figure from analysis/out/pilot.json. Without JavaScript, or
// after "Show me", the bars read straight away; nothing is hidden behind the game.

export function ShareGuess() {
  const c = repo.pilot?.arms.control;
  const v = repo.pilot?.arms.lanes_v1;
  const [guess, setGuess] = useState(30);
  const [shown, setShown] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shown || !root.current || prefersReducedMotion()) return;
    const q = gsap.utils.selector(root.current);
    const tl = gsap.timeline();
    tl.from(q(".share-fill"), { scaleX: 0, transformOrigin: "left center", duration: 1.2, ease: "power3.out", stagger: 0.18 }).from(
      q(".share-v, .sg-verdict"),
      { opacity: 0, duration: 0.3, stagger: 0.1 },
      0.5,
    );
    return () => {
      tl.kill();
    };
  }, [shown]);

  if (!c || !v) return null;
  const real = Math.round(c.delegate_share * 100);
  const off = guess - real;
  const verdict =
    Math.abs(off) <= 5
      ? `You guessed ${guess}%. Close: the pilot measured ${real}%.`
      : `You guessed ${guess}%. The pilot measured ${real}%, ${Math.abs(off)} points ${off < 0 ? "more" : "less"} than your guess.`;

  return (
    <div className={`share ${shown ? "is-shown" : "is-guessing"}`} ref={root}>
      <p className="share-h">Share of each arm's spend that went to the worker lane, pilot</p>
      <div className="sg-guess">
        <label htmlFor="sg-range">
          Guess first: what share of <code>control</code>'s bill paid for grunt work?
        </label>
        <div className="sg-row">
          <input
            id="sg-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={guess}
            onChange={(e) => setGuess(+e.target.value)}
            aria-valuetext={`${guess} percent`}
          />
          <output htmlFor="sg-range" className="sg-out">
            {guess}%
          </output>
        </div>
        <div className="sg-btns">
          <button type="button" className="rb-btn is-on" onClick={() => setShown(true)}>
            Reveal the pilot figure
          </button>
        </div>
      </div>
      {(
        [
          ["control", c],
          ["lanes_v1", v],
        ] as const
      ).map(([k, a]) => (
        <div className="share-row" key={k}>
          <span className="share-k">{k}</span>
          <span className="share-track">
            <span className={`share-fill ${k === "control" ? "is-big" : ""}`} style={{ transform: `scaleX(${a.delegate_share})` }} />
            {shown && k === "control" && <span className="sg-mark" style={{ left: `${guess}%` }} aria-hidden="true" />}
          </span>
          <span className="share-v">{pct(a.delegate_share)}</span>
        </div>
      ))}
      <p className="sg-verdict" role="status">
        {shown ? `${verdict} With the small model in the worker lane, that share fell to ${pct(v.delegate_share)}.` : ""}
      </p>
      <p className="share-foot">
        Pilot only: {c.n} tasks per arm, arms forced by the runner, not the result. Source: <a href={ghFile("analysis/out/pilot.json")}>analysis/out/pilot.json</a>
      </p>
    </div>
  );
}
