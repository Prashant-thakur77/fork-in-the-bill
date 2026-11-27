import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Led } from "../led/Led";
import { textColumns } from "../led/font";
import { Road } from "../components/Road";
import { Journey } from "../art/Journey";
import { RolloutPreview } from "../art/RolloutPreview";
import { SplitLab } from "../art/SplitLab";
import { ShareGuess } from "../art/ShareGuess";
import { Link } from "../site/router";
import { Code, Kinetic, Md, useReveals } from "../site/ui";
import { ghFile, pct, repo } from "../site/data";
import { LivePanel } from "../site/LivePanel";
import { useLiveState } from "../site/live";
import { money } from "../data/format";
import { useTween } from "../data/useTween";
import { prefersReducedMotion } from "../motion";
import { JOURNEY_STEPS } from "../site/journeySteps";
import { PY_QUICKSTART } from "../site/quickstart";

const C = repo.policies.control;
const V = repo.policies.lanes_v1;
const prices = repo.pricing?.models ?? {};
const big = C ? prices[C.main.model] : undefined;
const small = V ? prices[V.delegate.model] : undefined;
const ratio = big && small ? Math.round(big.input / small.input) : null;
const pilotC = repo.pilot?.arms.control;
const pilotV = repo.pilot?.arms.lanes_v1;
const preregHash = repo.hashes.find((h) => h.file === "prereg/experiment-1.md");
const amendHash = repo.hashes.find((h) => /amendment/.test(h.file));
const ruleList = repo.prereg.decisionRule.find((b) => b.type === "list");
const ruleItems = ruleList && ruleList.type === "list" ? ruleList.items : [];
const split = repo.split;
const PRICE_COLS = Math.max(30, ...[big, small].filter(Boolean).flatMap((m) => [m!.input, m!.output]).map((v) => textColumns(`$${v.toFixed(2)}`) + 4));

function shortModel(id: string | undefined): string {
  return (/claude-([a-z]+)/.exec(id ?? "")?.[1] ?? "").toUpperCase();
}

/* ---------- hero: the junction, with steady traffic split by the Flagsmith gantry ---------- */

function HeroSign({ armKey, legend, sub, worker, priceIn }: { armKey: string; legend: string; sub: string; worker: string; priceIn: string }) {
  const live = useLiveState();
  const arm = live.kind === "ok" ? live.snapshot?.arms[armKey] : undefined;
  const spent = useTween(arm?.usd ?? 0);
  // Like a real message sign, the panel alternates: the worker's model, then this lane's live spend.
  const [phase, setPhase] = useState<"model" | "spend">("model");
  const hasArm = !!arm;
  useEffect(() => {
    if (!hasArm || prefersReducedMotion()) return;
    const id = window.setInterval(() => setPhase((p) => (p === "model" ? "spend" : "model")), 4200);
    return () => window.clearInterval(id);
  }, [hasArm]);
  const showSpend = hasArm && (phase === "spend" || prefersReducedMotionSafe());
  const text = showSpend ? money(spent) : worker;
  return (
    <article className="sign" aria-label={`${armKey} lane`}>
      <div className="sign-tab">{armKey}</div>
      <div className="sign-face">
        <h2 className="sign-legend">{legend}</h2>
        <p className="sign-sub">{sub}</p>
        <div className="led-housing">
          <span className="led-caption">
            {showSpend ? "Spent, live" : "Worker model"}
            {hasArm && <i className="led-live" aria-hidden="true" />}
          </span>
          <Led text={text} cols={46} align="center" scan={!showSpend} label={showSpend ? `${money(arm.usd)} spent so far` : `Worker lane runs on ${worker.toLowerCase()}`} />
        </div>
        <dl className="sign-stats">
          <div>
            <dt>Worker input, $/MTok</dt>
            <dd>{priceIn}</dd>
          </div>
          <div>
            <dt>Done, live</dt>
            <dd>{arm ? arm.done.toLocaleString("en-US") : "—"}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

function prefersReducedMotionSafe(): boolean {
  return typeof window !== "undefined" && prefersReducedMotion();
}

const HERO_LANES = [
  { key: "control", x: 250, cars: 3, closed: false },
  { key: "lanes_v1", x: 750, cars: 3, closed: false },
];

function HeroJunction() {
  const priceIn = (m?: { input: number }) => (m ? `$${m.input.toFixed(2)}` : "—");
  return (
    <div className="junction hero-junction" data-phase="running">
      <div className="gantry">
        <div className="beam" aria-hidden="true">
          <svg viewBox="0 0 1000 24" preserveAspectRatio="none">
            <rect x="0" y="2" width="1000" height="3" />
            <rect x="0" y="19" width="1000" height="3" />
            <path d={Array.from({ length: 50 }, (_, i) => `M${i * 20} 4 L${i * 20 + 10} 20 L${i * 20 + 20} 4`).join(" ")} />
          </svg>
        </div>
        <div className="signs">
          <HeroSign armKey="control" legend="Frontier everywhere" sub="One model plans, patches and does the grunt work." worker={shortModel(C?.delegate.model)} priceIn={priceIn(big)} />
          <HeroSign armKey="lanes_v1" legend="Small delegate" sub="Same planner. A small model does the grunt work." worker={shortModel(V?.delegate.model)} priceIn={priceIn(small)} />
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
      <p className="hero-art-note">The road is an illustration: each car is a task, each lane an arm. The signs read live from the run.</p>
    </div>
  );
}

/* ---------- the policy diff: the one line that differs between arms ---------- */

function PolicyDiff() {
  if (!C || !V) return null;
  const a = JSON.stringify(Object.fromEntries(Object.entries(C).filter(([k]) => !/Short$/.test(k))), null, 2).split("\n");
  const b = JSON.stringify(Object.fromEntries(Object.entries(V).filter(([k]) => !/Short$/.test(k))), null, 2).split("\n");
  return (
    <figure className="diff">
      <figcaption className="code-bar">
        <span className="code-file">flagsmith/policies/control.json → lanes_v1.json</span>
        <a className="code-src" href={ghFile("flagsmith/policies/lanes_v1.json")} rel="noopener">
          Source<span className="sr-only">: the lanes_v1 policy file</span> <span aria-hidden="true">↗</span>
        </a>
      </figcaption>
      <pre tabIndex={0}>
        {a.map((line, i) =>
          line === b[i] ? (
            <span className="dl" key={i}>
              {"  "}
              {line}
              {"\n"}
            </span>
          ) : (
            <span key={i}>
              <span className="dl dl-del">
                {"- "}
                {line}
                {"\n"}
              </span>
              <span className="dl dl-add">
                {"+ "}
                {b[i]}
                {"\n"}
              </span>
            </span>
          ),
        )}
      </pre>
    </figure>
  );
}

/* ---------- FAQ ---------- */

const m = repo.power ? Math.round(repo.power.m * 100) : null;

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is this a benchmark of two models?",
    a: (
      <>
        No. Both arms use the same planner model, prompts, tools and caps. The only difference is which model does the delegated grunt work. The question is
        about a routing decision inside one agent, the kind of change a team would ship behind a flag.
      </>
    ),
  },
  {
    q: "Who decides which arm a task runs in?",
    a: (
      <>
        Flagsmith. The runner calls <code>get_experiment_flag</code> with the task's identity and uses whatever policy comes back. Every arm can be
        recomputed offline from a saved environment document with Flagsmith's own flag-engine. See <Link to="/why-flagsmith">Why Flagsmith</Link>.
      </>
    ),
  },
  {
    q: "Can you stop early if the numbers look good?",
    a: (
      <>
        No. The run continues until every task in the pool is done, excluded or invalid. The live board shows running totals, but the rule, the margin, the
        pools and the stopping rule were fixed in the pre-registration first.
      </>
    ),
  },
  {
    q: "Why is the solve-rate margin so wide?",
    a: (
      <>
        Because the pool of fresh tasks is small. {m !== null ? `The margin m is ${m} percentage points. ` : ""}A tighter margin would fail even an arm that
        is truly as good as control, so the experiment would decide nothing. The pre-registration says plainly that small solve-rate losses cannot be ruled
        out. <Link to="/method">Read the method</Link>.
      </>
    ),
  },
  {
    q: "What happens if the small model loses?",
    a: <>Control stays, and the reason is published with the numbers. The second experiment runs either way.</>,
  },
  {
    q: "Could the models have seen these bugs in training?",
    a: (
      <>
        The registered pool holds only tasks created after the models' training cutoff. The amendment added older tasks to reach Flagsmith's minimum sample;
        those are reported as a separate tier. Assignment is random, so any leak lifts both arms alike.
      </>
    ),
  },
  {
    q: "Can I run this on my own agent?",
    a: (
      <>
        Yes. The <Link to="/kit">kit</Link> wraps any agent loop in Python or TypeScript, works with Flagsmith Cloud or self-hosted Flagsmith, and sends the
        same events.
      </>
    ),
  },
];

/* ---------- page ---------- */

export default function Home() {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"py" | "ts">("py");
  useReveals(root);

  // Load sequence: headline lines rise, the gantry beam extends, the signs are hung one after the
  // other, the signals snap on, the road paints in, then traffic starts on its own.
  useGSAP(
    () => {
      document.documentElement.classList.remove("js-intro");
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        tl.from(".home-hero .hl > span", { yPercent: 110, duration: 0.9, stagger: 0.08 }, 0.15)
          .from(".home-hero .hero-copy > :not(h1)", { opacity: 0, y: 12, duration: 0.6, stagger: 0.06 }, 0.45)
          .from(".hero-junction .beam", { scaleX: 0, transformOrigin: "left center", duration: 0.7, ease: "power3.inOut" }, 0.25)
          .from(".hero-junction .sign", { rotate: -3, y: -20, opacity: 0, transformOrigin: "50% 0%", duration: 1.1, ease: "elastic.out(1, 0.6)", stagger: 0.14 }, 0.6)
          .from(".hero-junction .signal", { scale: 0.6, opacity: 0, duration: 0.16, ease: "power4.out", stagger: 0.08 }, 1.15)
          .from(".hero-junction .road .lane-centre, .hero-junction .road .road-dash", { strokeDashoffset: 400, duration: 1.2, ease: "power2.out" }, 0.5)
          .from(".fs-gantry", { y: 16, opacity: 0, duration: 0.5 }, 0.9);

        // Two lanes: the lane lines draw down the page.
        gsap.from(".idea-lane-line", { scaleY: 0, transformOrigin: "50% 0%", ease: "none", scrollTrigger: { trigger: ".idea", start: "top 70%", end: "bottom 60%", scrub: 0.6 } });
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
          <p className="question">Two lanes, one bill: does the cheaper lane cut the cost per task without solving fewer bugs?</p>
          <div className="cta-row">
            <Link to="/live" className="btn btn-dark">
              Watch the live board <span aria-hidden="true">→</span>
            </Link>
            <Link to="/method" className="btn btn-line">
              Read the method
            </Link>
          </div>
          <Link to="/why-flagsmith" className="why-link">
            <span className="why-tab">Why Flagsmith</span>
            <span>
              It picks every arm and measures every result. Here is how<span aria-hidden="true"> →</span>
            </span>
          </Link>
        </div>
        <HeroJunction />
      </section>

      {/* 2. the problem */}
      <section className="hsec problem" aria-labelledby="problem-h">
        <div className="hsec-copy">
          <p className="eyebrow-sign">The problem</p>
          <Kinetic id="problem-h" text="The frontier model reads the logs at frontier prices" />
          <p>
            A coding agent spends much of its tokens on grunt work: searching the repo, reading long files, running tests and reading what they print. When one
            frontier model does everything, that work is billed at the frontier rate.
          </p>
          {ratio !== null && C && V && (
            <p>
              At list price, a million input tokens cost {ratio} times as much on {C.mainShort} as on {V.delegateShort}
              {repo.pricing ? ` (prices checked ${repo.pricing.checked_on})` : ""}.
            </p>
          )}
        </div>
        <div className="hsec-art">
          <div className="rate-board">
            <div role="table" aria-label="List prices, US dollars per million tokens">
            <div className="rb-head" role="row">
              <span role="columnheader">Toll, per million tokens</span>
              <span role="columnheader">Input</span>
              <span role="columnheader">Output</span>
            </div>
            {[C?.main.model, V?.delegate.model].filter(Boolean).map((id) => {
              const p = prices[id!];
              if (!p) return null;
              return (
                <div className="rb-row" role="row" key={id}>
                  <span role="rowheader" className="rb-model">
                    {id === C?.main.model ? C?.mainShort : V?.delegateShort}
                  </span>
                  <span role="cell">
                    <Led text={`$${p.input.toFixed(2)}`} cols={PRICE_COLS} label={`$${p.input.toFixed(2)} input`} />
                  </span>
                  <span role="cell">
                    <Led text={`$${p.output.toFixed(2)}`} cols={PRICE_COLS} label={`$${p.output.toFixed(2)} output`} />
                  </span>
                </div>
              );
            })}
            </div>
            <p className="rb-foot">
              Source: <a href={ghFile("harness/pricing.json")}>harness/pricing.json</a>
            </p>
          </div>
          <ShareGuess />
        </div>
      </section>

      {/* 3. the idea */}
      <section className="hsec idea" aria-labelledby="idea-h">
        <div className="idea-lanes" aria-hidden="true">
          <span className="idea-lane-line" />
          <span className="idea-lane-line" />
        </div>
        <div className="hsec-copy">
          <p className="eyebrow-sign">The idea</p>
          <Kinetic id="idea-h" text="Split the agent into two lanes" />
          <p>
            The planner lane reads code{repo.harness.viewMaxLines ? ` (up to ${repo.harness.viewMaxLines} lines at a time)` : ""}, writes the fix and decides
            when it is done. It has no shell. The worker lane runs the shell in the same container: searches, builds, test runs. It reports back as short JSON
            findings{repo.harness.delegateMaxTurns ? `, in at most ${repo.harness.delegateMaxTurns} turns per job` : ""}.
          </p>
          <p>
            Both arms run this same split. The test changes one thing: the worker's model. Everything else in the flag value is identical, and the harness
            refuses a variant that differs anywhere else.
          </p>
          <Link to="/how-it-works" className="text-link">
            How the agent works <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="hsec-art">
          <div className="lane-cards" data-reveal="row">
            <div className="lane-card">
              <span className="lane-card-tab">Planner lane</span>
              <p className="lane-card-model">{C?.mainShort}</p>
              <p className="lane-card-tools">
                <code>view_file</code> <code>edit_file</code> <code>delegate</code> <code>submit</code>
              </p>
            </div>
            <div className="lane-card is-worker">
              <span className="lane-card-tab">Worker lane</span>
              <p className="lane-card-model">
                {C?.delegateShort} <span className="vs">or</span> {V?.delegateShort}
              </p>
              <p className="lane-card-tools">
                <code>bash</code>
              </p>
            </div>
          </div>
          <PolicyDiff />
        </div>
      </section>

      {/* 4. how Flagsmith splits and measures */}
      <section className="hsec journey-sec" aria-labelledby="journey-h">
        <div className="hsec-copy wide">
          <p className="eyebrow-sign">How Flagsmith runs it</p>
          <Kinetic id="journey-h" text="How Flagsmith runs each task" />
          <p>Scroll to follow two tasks from the queue to the decision.</p>
        </div>
        <Journey steps={JOURNEY_STEPS} id="home-journey" />
        <SplitLab />
        <RolloutPreview />
        <p className="journey-more">
          <Link to="/why-flagsmith" className="text-link">
            Why the experiment cannot exist without Flagsmith <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>

      {/* 5. the rule */}
      <section className="hsec rule-sec" aria-labelledby="rule-h">
        <div className="hsec-copy">
          <p className="eyebrow-sign">The rule</p>
          <Kinetic id="rule-h" text="The rule was fixed before the first task" />
          <p>
            <code>lanes_v1</code> ships only if all three hold. Otherwise control stays and the reason is published. The text below is quoted from the
            pre-registration.
          </p>
        </div>
        <div className="hsec-art">
          <div className="rule-gantry" aria-hidden="true" />
          <div className="rule-sign" data-reveal="hang">
          <ol className="rule-list">
            {ruleItems.map((t, i) => (
              <li className="rule-row is-quote" key={i}>
                <span className="rule-n" aria-hidden="true">
                  <b>{i + 1}</b>
                </span>
                <span className="rule-text">
                  <Md text={t} />
                </span>
              </li>
            ))}
          </ol>
          </div>
          {preregHash && (
            <a className="reg-stamp" data-reveal="stamp" href={ghFile(preregHash.file)} rel="noopener">
              <span className="reg-k">Registered · sha256</span>
              <code>{preregHash.sha256}</code>
              <span className="reg-file">{preregHash.file}</span>
            </a>
          )}
        </div>
      </section>

      {/* 6. live teaser */}
      <section className="hsec live-sec" aria-labelledby="live-h">
        <div className="live-sec-inner">
          <div className="hsec-copy">
            <p className="eyebrow-sign is-dark">Live now</p>
            <Kinetic id="live-h" text="What each lane has spent so far" />
            <p>Read from the board's API as the run goes. The full board has the lanes, the signals and the flag history.</p>
          </div>
          <LivePanel />
        </div>
      </section>

      {/* 7. proof */}
      <section className="hsec proof-sec" aria-labelledby="proof-h">
        <div className="hsec-copy">
          <p className="eyebrow-sign">Proof</p>
          <Kinetic id="proof-h" text="Anyone can check that nothing was edited" />
          <Link to="/proof" className="text-link">
            Check it yourself <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="hsec-art">
          <div className="printer">
            <div className="printer-slot" aria-hidden="true" />
            <div className="receipt" data-reveal="print">
              <div className="receipt-head">
                <span>Fork in the Bill</span>
                <span>Receipt so far</span>
              </div>
              {preregHash && (
                <div className="receipt-line">
                  <span>Pre-reg sha256</span>
                  <span>{preregHash.sha256}</span>
                </div>
              )}
              {amendHash && (
                <div className="receipt-line">
                  <span>Amendment sha256</span>
                  <span>{amendHash.sha256}</span>
                </div>
              )}
              {repo.ledgers.map((l) => (
                <div className="receipt-line" key={l.run}>
                  <span>Merkle root, {l.run}</span>
                  <span>{l.merkleRoot}</span>
                </div>
              ))}
              <div className="receipt-line">
                <span>Merkle root, exp1</span>
                <span>{repo.figures["integrity.merkle_root"] ? `${repo.figures["integrity.merkle_root"]}…` : "after the run"}</span>
              </div>
              <div className="receipt-cut" aria-hidden="true" />
              <p className="receipt-foot">
                Pilot roots computed from <code>runs/*/ledger.jsonl</code> when this site was built.
              </p>
            </div>
          </div>
          <ul className="check-list">
            <li>
              <b>Every finished task</b> is a record in a hash chain. Change one and every later hash breaks.
            </li>
            <li>
              <b>The flag config</b> is saved through the run. One distinct hash means nobody touched it.
            </li>
            <li>
              <b>Every arm</b> is recomputed offline with Flagsmith's own flag-engine{repo.versions.flagEngine ? ` ${repo.versions.flagEngine}` : ""} and must match
              what the run recorded.
            </li>
          </ul>
        </div>
      </section>

      {/* 8. kit */}
      <section className="hsec kit-sec" aria-labelledby="kit-h">
        <div className="hsec-copy">
          <p className="eyebrow-sign">Run it yourself</p>
          <Kinetic id="kit-h" text="Put your own agent on the same road" />
          <p>
            The kit turns any agent loop into a two-lane loop driven by a Flagsmith experiment flag. It reads the policy once per task, records the exposure,
            prices every call and sends the same four events. Python and TypeScript, Flagsmith Cloud or self-hosted.
          </p>
          <Link to="/kit" className="text-link">
            Kit quickstart <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="hsec-art">
          <div className="tabs" role="tablist" aria-label="Language">
            {(["py", "ts"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                id={`kit-tab-${k}`}
                aria-selected={tab === k}
                aria-controls={`kit-panel-${k}`}
                tabIndex={tab === k ? 0 : -1}
                onClick={() => setTab(k)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    const next = tab === "py" ? "ts" : "py";
                    setTab(next);
                    document.getElementById(`kit-tab-${next}`)?.focus();
                  }
                }}
              >
                {k === "py" ? "Python" : "TypeScript"}
              </button>
            ))}
            <span className={`tabs-bar is-${tab}`} aria-hidden="true" />
          </div>
          <div role="tabpanel" id={`kit-panel-${tab}`} aria-labelledby={`kit-tab-${tab}`}>
            {tab === "py" ? (
              <Code code={PY_QUICKSTART} lang="py" caption="your_agent.py (forkbill)" />
            ) : (
              <Code code={repo.snippets.tsUsage!.code} lang="ts" caption="kit/ts/README.md" href={ghFile("kit/ts/README.md")} />
            )}
          </div>
        </div>
      </section>

      {/* 9. FAQ */}
      <section className="hsec faq-sec" aria-labelledby="faq-h">
        <div className="hsec-copy">
          <p className="eyebrow-sign">Questions</p>
          <Kinetic id="faq-h" text="Questions people ask first" />
        </div>
        <div className="faq">
          {FAQ.map((f, i) => (
            <details key={i} className="faq-item">
              <summary>
                <span className="faq-q">{f.q}</span>
                <span className="faq-icon" aria-hidden="true" />
              </summary>
              <div className="faq-a">
                <p>{f.a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* 10. closing */}
      <section className="closing" aria-labelledby="close-h">
        <div className="closing-sign" data-reveal="hang">
          <svg className="closing-exit" viewBox="0 0 120 120" aria-hidden="true">
            <path d="M34 98 L34 60 C34 44 46 34 62 34 L84 34" />
            <path d="M70 18 L88 34 L70 50" />
          </svg>
          <span className="closing-tab">Next exit</span>
          <h2 id="close-h">Follow the run to the end.</h2>
          <p>Watch both lanes fill up live, or read exactly how the verdict will be made.</p>
          <div className="cta-row">
            <Link to="/live" className="btn btn-sheet">
              Watch the live board <span className="close-arrow" aria-hidden="true">→</span>
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
