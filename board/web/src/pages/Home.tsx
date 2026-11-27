import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Led } from "../led/Led";
import { Road } from "../components/Road";
import { Journey } from "../art/Journey";
import { RolloutPreview } from "../art/RolloutPreview";
import { SplitLab } from "../art/SplitLab";
import { Link } from "../site/router";
import { Kinetic, useReveals } from "../site/ui";
import { repo } from "../site/data";
import { LivePanel } from "../site/LivePanel";
import { ResultPair } from "../site/ResultPair";
import { Booth } from "../site/Booth";
import { useLiveState } from "../site/live";
import { CURRENT, batchOf, batchStatus } from "../site/batches";
import { format, money } from "../data/format";
import { useTween } from "../data/useTween";
import { prefersReducedMotion } from "../motion";
import { JOURNEY_STEPS } from "../site/journeySteps";

// The story page: hero, one task's journey, the split, the decision, the result so far, the
// live strip, the exit. Everything else (prices, the agent, the rule, the receipt, the kit, the
// questions) lives on its own page.

const C = repo.policies.control;
const V = repo.policies.lanes_v1;
const prices = repo.pricing?.models ?? {};
const big = C ? prices[C.main.model] : undefined;
const small = V ? prices[V.delegate.model] : undefined;
const split = repo.split;
const N1 = repo.numbers?.exp1 ?? null;
const SHIP1 = repo.decisions["exp1.decision.ship"];
const f = repo.figures;
const FRESH = N1?.by_tier?.fresh ?? null;

function shortModel(id: string | undefined): string {
  return (/claude-([a-z]+)/.exec(id ?? "")?.[1] ?? "").toUpperCase();
}

/* ---------- hero: the junction, with steady traffic split by the Flagsmith gantry ---------- */

interface HeroLane {
  key: string;
  legend: string;
  sub: string;
  /** What the sign's panel reads when it is not showing live spend. */
  word: string;
  wordCaption: string;
  wordLabel: string;
  /** A fixed fact for the sign's first cell; without it the sign shows done and solved. */
  stat?: [string, string];
}

function HeroSign({ lane }: { lane: HeroLane }) {
  const live = useLiveState(CURRENT);
  const arm = live.kind === "ok" ? live.snapshot?.arms[lane.key] : undefined;
  const spent = useTween(arm?.usd ?? 0);
  // Like a real message sign, the panel alternates: the lane's job, then its live spend.
  const [phase, setPhase] = useState<"word" | "spend">("word");
  const hasArm = !!arm;
  useEffect(() => {
    if (!hasArm || prefersReducedMotion()) return;
    const id = window.setInterval(() => setPhase((p) => (p === "word" ? "spend" : "word")), 4200);
    return () => window.clearInterval(id);
  }, [hasArm]);
  const showSpend = hasArm && (phase === "spend" || (typeof window !== "undefined" && prefersReducedMotion()));
  return (
    <article className="sign" aria-label={`${lane.key} lane`}>
      <div className="sign-tab">{lane.key}</div>
      <div className="sign-face">
        <h2 className="sign-legend">{lane.legend}</h2>
        <p className="sign-sub">{lane.sub}</p>
        <div className="led-housing">
          <span className="led-caption">
            {showSpend ? "Spent, live" : lane.wordCaption}
            {hasArm && <i className="led-live" aria-hidden="true" />}
          </span>
          <Led text={showSpend ? money(spent) : lane.word} cols={46} align="center" scan={!showSpend} label={showSpend ? `${money(arm.usd)} spent so far` : lane.wordLabel} />
        </div>
        <dl className="sign-stats">
          {lane.stat && (
            <div>
              <dt>{lane.stat[0]}</dt>
              <dd>{lane.stat[1]}</dd>
            </div>
          )}
          <div>
            <dt>Done, live</dt>
            <dd>{arm ? arm.done.toLocaleString("en-US") : "—"}</dd>
          </div>
          {!lane.stat && (
            <div>
              <dt>Solved, live</dt>
              <dd>{arm ? arm.solved.toLocaleString("en-US") : "—"}</dd>
            </div>
          )}
        </dl>
      </div>
    </article>
  );
}

const priceIn = (m?: { input: number }) => (m ? `$${m.input.toFixed(2)}` : "—");

// The hero signs read the batch that is running now, and say which one it is.
const HERO_SIGNS: Record<string, HeroLane[]> = {
  exp1: [
    {
      key: "control",
      legend: "Frontier everywhere",
      sub: "One model plans, patches and does the grunt work.",
      word: shortModel(C?.delegate.model),
      wordCaption: "Worker model",
      wordLabel: `Worker lane runs on ${shortModel(C?.delegate.model).toLowerCase()}`,
      stat: ["Worker input, $/MTok", priceIn(big)],
    },
    {
      key: "lanes_v1",
      legend: "Small delegate",
      sub: "Same planner. A small model does the grunt work.",
      word: shortModel(V?.delegate.model),
      wordCaption: "Worker model",
      wordLabel: `Worker lane runs on ${shortModel(V?.delegate.model).toLowerCase()}`,
      stat: ["Worker input, $/MTok", priceIn(small)],
    },
  ],
  exp2: [
    {
      key: "control",
      legend: "Small model reads",
      sub: "The experiment 1 winner, rolled out. The frontier model writes every edit.",
      word: "READS",
      wordCaption: "Small model's job",
      wordLabel: "In control the small model reads and reports",
    },
    {
      key: "lanes_v2",
      legend: "Small model drafts",
      sub: "The small model writes a first patch. The frontier model reviews it.",
      word: "DRAFTS",
      wordCaption: "Small model's job",
      wordLabel: "In lanes_v2 the small model drafts the patch",
    },
  ],
};
const HERO_BATCH = batchOf(HERO_SIGNS[CURRENT] ? CURRENT : "exp1")!;
const HERO_SET = HERO_SIGNS[HERO_BATCH.id]!;

const HERO_LANES = [
  { key: HERO_SET[0]!.key, x: 250, cars: 4, closed: false },
  { key: HERO_SET[1]!.key, x: 750, cars: 4, closed: false },
];

function HeroBatchPlate() {
  const live = useLiveState(CURRENT);
  const st = batchStatus(HERO_BATCH, live.kind === "ok" ? live.snapshot : null);
  return (
    <Link to="/live" className="hero-batch">
      <span className={`batch-chip is-${st.key}`}>
        <i aria-hidden="true" />
        {st.label}
      </span>
      <span>
        <b>{HERO_BATCH.label}</b> is what these signs read<span aria-hidden="true"> →</span>
      </span>
    </Link>
  );
}

function HeroJunction() {
  return (
    <div className="junction hero-junction" data-phase="running">
      <HeroBatchPlate />
      <div className="gantry">
        <div className="beam" aria-hidden="true">
          <svg viewBox="0 0 1000 24" preserveAspectRatio="none">
            <rect x="0" y="2" width="1000" height="3" />
            <rect x="0" y="19" width="1000" height="3" />
            <path d={Array.from({ length: 50 }, (_, i) => `M${i * 20} 4 L${i * 20 + 10} 20 L${i * 20 + 20} 4`).join(" ")} />
          </svg>
        </div>
        <div className="signs">
          {HERO_SET.map((lane) => (
            <HeroSign key={lane.key} lane={lane} />
          ))}
        </div>
        <div className="signals" aria-hidden="true">
          {[0, 1].map((i) => (
            <div className="signal signal-open" key={i}>
              <svg viewBox="0 0 40 40">
                <path d="M20 6 V30 M10 21 L20 32 L30 21" />
              </svg>
            </div>
          ))}
        </div>
      </div>
      <div className="hero-road">
        <Road lanes={HERO_LANES} />
        <div className="fs-gantry">
          <span className="fs-gantry-beam" aria-hidden="true" />
          <div className="fs-gantry-panel">
            <Led text="FLAGSMITH" cols={62} align="center" label="Flagsmith" />
          </div>
          <span className="fs-gantry-cap">{split !== null ? `splits ${100 - split} / ${split}` : "splits the traffic"}</span>
        </div>
      </div>
      <p className="hero-art-note">
        The road is an illustration: each car is a task, each lane an arm. The signs read live from {HERO_BATCH.label.toLowerCase()}
        {HERO_BATCH.state === "open" ? ", which is running now" : ""}.
      </p>
    </div>
  );
}

/** The answer to the headline, once experiment 1 has one: a toll plate that links to the results. */
function Answer() {
  if (!N1 || !SHIP1) return null;
  const cut = format(N1.delta.cost_mean_pct, "pct1");
  const pp = format(N1.delta.solve_rate_pp, "pp1");
  return (
    <Link to="/results" className="answer">
      <span className="answer-tab">Experiment 1 · decided</span>
      <span className="answer-led">
        <Led text={cut.replace("−", "-")} cols={40} align="center" label={`${cut} mean cost per task`} />
      </span>
      <span className="answer-text">
        <b>{SHIP1 === "control" ? "No: control stays." : "Yes, by the registered rule."}</b> Mean cost per task {cut} with the small model on the grunt work; solve
        rate {pp}, inside the margin fixed before the run.<span aria-hidden="true"> →</span>
      </span>
      {FRESH && (
        <span className="answer-caveat">
          Caveat: on the fresh tier alone the solve rate was {format(FRESH.delta.solve_rate_pp, "pp1")} and the solve-rate check would not have passed.
        </span>
      )}
    </Link>
  );
}

/* ---------- the result so far ---------- */

const RULE_SHORT = ["Flagsmith: chance the small-model lane is cheaper, at least 95%", "Our posterior: solve-rate drop within the margin, at least 90%", "Flagsmith: no loss on the solve-rate guardrail"];
const RULE_KEYS = ["flagsmith_95", "guardrail_90", "no_guardrail_loss"];

function Result() {
  const exp2 = batchOf("exp2");
  if (!N1 || !SHIP1) {
    return (
      <section className="hsec result-sec" aria-labelledby="result-h">
        <div className="result-head">
          <p className="eyebrow-sign">The result so far</p>
          <Kinetic id="result-h" text="No verdict yet" />
          <p>The run is in progress. The verdict posts when the analysis script has run on the finished ledger, by the rule fixed before the first task.</p>
          <Link to="/method" className="text-link">
            Read the rule <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    );
  }
  const d = N1.delta;
  const cheaper = Math.abs(d.cost_mean_pct).toFixed(1);
  const pts = Math.abs(d.solve_rate_pp).toFixed(1);
  const figs = [f["exp1.flagsmith.chance_to_beat_control_cost"], f["exp1.delta.p_solve_drop_within_m"], undefined];
  return (
    <section className="hsec result-sec" aria-labelledby="result-h">
      <div className="result-head">
        <p className="eyebrow-sign">The result so far</p>
        <Kinetic id="result-h" text={SHIP1 === "control" ? "Experiment 1 is decided: control stays" : `Experiment 1 is decided: ${SHIP1} shipped`} />
        <p>
          The small model did the grunt work for {cheaper}% {d.cost_mean_pct < 0 ? "less" : "more"} per task. It solved {pts} points{" "}
          {d.solve_rate_pp < 0 ? "fewer" : "more"} bugs, a gap that is inside the {Math.round(N1.prereg.m * 100)}-point margin fixed before the run and cannot be told
          from zero at this sample size.
        </p>
        {FRESH && (
          <p className="result-caveat">
            <b>The caveat.</b> The rule was registered on all tasks. On the fresh tier alone, the tasks created after the models' training cutoff, the solve rate was{" "}
            {format(FRESH.delta.solve_rate_pp, "pp1")} and the guardrail's probability {format(FRESH.delta.p_solve_drop_within_m, "prob1")}, under its{" "}
            {format(N1.decision.bars.guardrail_posterior, "prob1")} bar. <Link to="/results#honest">What this does and does not show</Link>.
          </p>
        )}
      </div>
      <ResultPair exp="exp1" treatment="lanes_v1" n={N1} heading="p" />
      <div className="result-foot">
        <ol className="result-checks" aria-label="The three registered conditions" data-reveal="row">
          {RULE_SHORT.map((t, i) => {
            const met = repo.decisions[`exp1.decision.rule_met.${RULE_KEYS[i]}`] === "true";
            return (
              <li key={i} className={met ? "is-met" : "is-not-met"}>
                <span className="rule-n" aria-hidden="true">
                  <b>{i + 1}</b>
                </span>
                <span className="rc-text">{t}</span>
                {figs[i] && <span className="rc-fig">{figs[i]}</span>}
                <span className="rule-state">{met ? "met" : "not met"}</span>
              </li>
            );
          })}
        </ol>
        <div className="result-next">
          {repo.numbers?.rollout && (
            <Link to="/rollout" className="next-row">
              <span className="next-k">Then: rollout</span>
              <span className="next-v">
                The experiment was ended with {SHIP1} as the flag's own value. {f["rollout.n"]} fresh tasks ran on the same flag with no code change:{" "}
                {f["rollout.cost_mean"]} a task, {f["rollout.solve_rate"]} solved.
              </span>
              <span className="next-go" aria-hidden="true">
                →
              </span>
            </Link>
          )}
          {exp2?.state === "open" && (
            <Link to="/experiment-2" className="next-row">
              <span className="next-k">Now: experiment 2</span>
              <span className="next-v">The winner against lanes_v2, where the small model drafts the patch. Registered before its first task. No verdict yet.</span>
              <span className="next-go" aria-hidden="true">
                →
              </span>
            </Link>
          )}
          <div className="cta-row">
            <Link to="/results" className="btn btn-dark">
              All the results <span aria-hidden="true">→</span>
            </Link>
            <Link to="/method" className="btn btn-line">
              How the rule was fixed
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- page ---------- */

export default function Home() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  const open = batchOf(CURRENT)?.state === "open";

  // Load sequence: headline lines rise, the gantry beam extends, the signs are hung one after the
  // other, the signals snap on, the road paints in, then traffic starts on its own.
  useGSAP(
    () => {
      document.documentElement.classList.remove("js-intro");
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        tl.from(".home-hero .hl > span", { yPercent: 110, duration: 0.9, stagger: 0.08 }, 0.15)
          .from(".home-hero .hero-copy > :not(h1):not(.answer)", { opacity: 0, y: 12, duration: 0.6, stagger: 0.06 }, 0.45)
          .from(".home-hero .answer", { rotate: -2, y: -14, opacity: 0, transformOrigin: "12% 0%", duration: 1, ease: "elastic.out(1, 0.6)" }, 0.75)
          .from(".hero-junction .beam", { scaleX: 0, transformOrigin: "left center", duration: 0.7, ease: "power3.inOut" }, 0.25)
          .from(".hero-junction .sign", { rotate: -3, y: -20, opacity: 0, transformOrigin: "50% 0%", duration: 1.1, ease: "elastic.out(1, 0.6)", stagger: 0.14 }, 0.6)
          .from(".hero-junction .signal", { scale: 0.6, opacity: 0, duration: 0.16, ease: "power4.out", stagger: 0.08 }, 1.15)
          .fromTo(".hero-junction .hero-road", { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "power3.out", clearProps: "clipPath" }, 0.55)
          .from(".hero-junction .road .lane-centre, .hero-junction .road .road-dash", { strokeDashoffset: 400, duration: 1.2, ease: "power2.out" }, 0.9)
          .from(".fs-gantry", { y: 16, opacity: 0, duration: 0.5 }, 0.9);

        // Closing sign: the arrow nudges toward the exit.
        gsap.to(".close-arrow", { x: 8, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1, scrollTrigger: { trigger: ".closing", start: "top bottom", toggleActions: "play pause resume pause" } });
      });
    },
    { scope: root },
  );

  return (
    <div className="home" ref={root}>
      {/* 1. hero */}
      <section className="home-hero hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title" className="hero-title">
            <span className="line hl">
              <span>Can a small model</span>
            </span>
            <span className="line hl">
              <span>do the grunt work?</span>
            </span>
          </h1>
          <p className="lead">
            A pre-registered A/B test of a coding agent's model routing, run as a Flagsmith experiment on real bug fixes and paid for in real dollars.
          </p>
          <Answer />
          <div className="cta-row">
            <Link to="/live" className="btn btn-dark">
              {open ? `Watch ${HERO_BATCH.label.toLowerCase()} live` : "Open the board"} <span aria-hidden="true">→</span>
            </Link>
            <Link to="/results" className="btn btn-line">
              See the results
            </Link>
          </div>
        </div>
        <HeroJunction />
      </section>

      {/* 2. a task's journey */}
      <section className="hsec journey-sec" aria-labelledby="journey-h">
        <div className="hsec-copy wide">
          <p className="eyebrow-sign">How it runs</p>
          <Kinetic id="journey-h" text="One task, from the queue to the decision" />
          <p>
            Flagsmith picks the lane, records the exposure, joins the events and reports the result. Scroll to follow two tasks through experiment 1.{" "}
            <Link to="/why-flagsmith">Why it cannot run without Flagsmith</Link>.
          </p>
        </div>
        <Journey steps={JOURNEY_STEPS} id="home-journey" />
      </section>

      {/* 3. move the split */}
      <section className="hsec lab-sec" aria-label="Move the split yourself">
        <SplitLab />
      </section>

      {/* 4. play the decision */}
      <section className="hsec decide-sec" aria-label="Play the decision">
        <RolloutPreview />
      </section>

      {/* 5. the result so far */}
      <Result />

      {/* 6. live strip */}
      <section className="hsec live-sec" aria-labelledby="live-h">
        <div className="live-sec-inner">
          <div className="hsec-copy">
            <p className="eyebrow-sign is-dark">{open ? "Live now" : "Latest totals"}</p>
            <Kinetic id="live-h" text={open ? `${HERO_BATCH.label} is on the road` : "What each lane spent"} />
            <p>
              {HERO_BATCH.id === "exp2"
                ? "The rolled-out winner against lanes_v2, on the same flag. Read from the board's API as the run goes."
                : "Read from the board's API. The full board has the lanes, the signals and the flag history."}
            </p>
          </div>
          <LivePanel />
        </div>
      </section>

      {/* 7. the updates window */}
      <section className="closing-booth" aria-labelledby="cb-h">
        <div className="closing-booth-copy">
          <p className="eyebrow-sign">Updates</p>
          <Kinetic id="cb-h" text={open && HERO_BATCH.id === "exp2" ? "Get the experiment 2 write-up" : "Get the next write-up"} />
          <p>
            {open && HERO_BATCH.id === "exp2" ? "Experiment 2 is still running. " : ""}Leave an address at the window and you get one email when its write-up is published, and
            one when the kit is on npm if you ask for that too. Nothing else is sent.
          </p>
          <Link to="/updates#privacy" className="text-link">
            What is stored, and how to be removed <span aria-hidden="true">→</span>
          </Link>
        </div>
        <Booth source="/" heading="h3" />
      </section>

      {/* 8. closing */}
      <section className="closing" aria-labelledby="close-h">
        <div className="closing-sign" data-reveal="hang">
          <svg className="closing-exit" viewBox="0 0 120 120" aria-hidden="true">
            <path d="M34 98 L34 60 C34 44 46 34 62 34 L84 34" />
            <path d="M70 18 L88 34 L70 50" />
          </svg>
          <span className="closing-tab">Next exit</span>
          <h2 id="close-h">Don't take the sign's word for it.</h2>
          <p>Every finished task is a record in a hash chain, and every arm can be recomputed offline. The commands are one line each.</p>
          <div className="cta-row">
            <Link to="/verify" className="btn btn-sheet">
              Check a ledger in your browser <span className="close-arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/method" className="btn btn-ghost-sheet">
              Read the method
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
