import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { useGSAP } from "@gsap/react";
import { rasterize } from "../led/font";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin, useGSAP);

// A task's journey drawn as a road in plan view: the queue, the Flagsmith gantry where the
// identity is hashed, the fork into one lane per arm, the toll gantry where events are sent,
// the merge at the results sign, the lane signals of the decision, and the single lane of the
// rollout. Scrolling drives two task tokens along it; reduced motion shows the finished still.

export interface JourneyStep {
  title: string;
  text: ReactNode;
}

const TRUNK_Y = 230;
const UP_Y = 140;
const DOWN_Y = 320;
const FORK_X = 470;
const MERGE_X = 900;

const upper = `M-20 ${TRUNK_Y} L${FORK_X} ${TRUNK_Y} C${FORK_X + 70} ${TRUNK_Y} ${FORK_X + 60} ${UP_Y} ${FORK_X + 140} ${UP_Y} L${MERGE_X - 140} ${UP_Y} C${MERGE_X - 60} ${UP_Y} ${MERGE_X - 70} ${TRUNK_Y} ${MERGE_X} ${TRUNK_Y} L1220 ${TRUNK_Y}`;
const lower = `M-20 ${TRUNK_Y} L${FORK_X} ${TRUNK_Y} C${FORK_X + 70} ${TRUNK_Y} ${FORK_X + 60} ${DOWN_Y} ${FORK_X + 140} ${DOWN_Y} L${MERGE_X - 140} ${DOWN_Y} C${MERGE_X - 60} ${DOWN_Y} ${MERGE_X - 70} ${TRUNK_Y} ${MERGE_X} ${TRUNK_Y} L1220 ${TRUNK_Y}`;

function LedText({ text, x, y, pitch, anchor = "middle", className = "" }: { text: string; x: number; y: number; pitch: number; anchor?: "start" | "middle"; className?: string }) {
  const bmp = rasterize(text);
  const ox = anchor === "middle" ? x - (bmp.length * pitch) / 2 : x;
  const r = pitch * 0.36;
  const dots: ReactNode[] = [];
  bmp.forEach((col, cx) =>
    col.forEach((on, cy) => {
      if (on) dots.push(<circle key={`${cx}-${cy}`} cx={ox + (cx + 0.5) * pitch} cy={y + (cy + 0.5) * pitch} r={r} />);
    }),
  );
  return <g className={`j-led ${className}`}>{dots}</g>;
}

function Diamond({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <g className="j-diamond" data-step={n} transform={`translate(${x} ${y})`}>
      <rect x="-15" y="-15" width="30" height="30" rx="4" transform="rotate(45)" />
      <text y="6" textAnchor="middle">
        {n + 1}
      </text>
    </g>
  );
}

function Car({ className, at }: { className: string; at: string }) {
  return (
    <g className={`j-car ${className}`} transform={at}>
      <rect x="-26" y="-15" width="52" height="30" rx="8" className="car-body" />
      <rect x="6" y="-11" width="12" height="22" rx="3" className="car-glass" />
      <rect x="-20" y="-11" width="8" height="22" rx="2" className="car-glass" />
    </g>
  );
}

export function Journey({ steps, id, compact = false }: { steps: JourneyStep[]; id: string; compact?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const N = steps.length;

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const mm = gsap.matchMedia();
      const setStep = (s: number) => {
        q("[data-step]").forEach((el) => el.classList.toggle("is-on", Number((el as HTMLElement).dataset.step) <= s));
        q(".j-caps > li").forEach((el, i) => el.classList.toggle("is-current", i === s));
        root.current?.setAttribute("data-at", String(s));
      };
      mm.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          wide: "(min-width: 900px) and (min-height: 640px)",
        },
        (ctx) => {
          const { motion, wide } = ctx.conditions as { motion: boolean; wide: boolean };
          if (!motion) {
            setStep(N - 1);
            return;
          }
          root.current?.classList.toggle("is-pinned", wide);
          const tl = gsap.timeline({ defaults: { ease: "none" } });
          tl.fromTo(q(".j-car-a"), { opacity: 1 }, { motionPath: { path: upper, autoRotate: true, start: 0.02, end: 0.98 }, duration: N }, 0)
            .fromTo(q(".j-car-b"), { opacity: 1 }, { motionPath: { path: lower, autoRotate: true, start: 0.0, end: 0.9 }, duration: N - 0.4 }, 0.4)
            .from(q(".j-event"), { y: 60, opacity: 0, stagger: 0.12, duration: 0.6, ease: "power2.out" }, 3)
            .to(q(".j-car-b"), { opacity: 0, duration: 0.3 }, N - 0.4);
          ScrollTrigger.create({
            trigger: root.current,
            start: wide ? "top top" : "top 75%",
            end: wide ? `+=${N * 55}%` : "bottom 25%",
            pin: wide,
            scrub: 0.6,
            animation: tl,
            onUpdate: (self) => setStep(Math.min(N - 1, Math.floor(self.progress * N))),
          });
          setStep(0);
          return () => root.current?.classList.remove("is-pinned");
        },
      );
    },
    { scope: root },
  );

  const signal = (x: number, y: number, n: number) => (
    <g className="j-signal" data-step={n} transform={`translate(${x} ${y})`}>
      <rect x="-20" y="-20" width="40" height="40" rx="5" />
      <path className="j-sig-x" d="M-9 -9 L9 9 M9 -9 L-9 9" />
    </g>
  );

  return (
    <div className={`journey ${compact ? "is-compact" : ""}`} ref={root} id={id} data-at="0">
      <div className="j-stage">
        <div className="j-scroll" tabIndex={0} role="region" aria-label="Diagram of a task's journey, scrolls sideways on small screens">
          <svg viewBox="0 0 1200 460" className="j-svg" role="img" aria-labelledby={`${id}-title`}>
            <title id={`${id}-title`}>
              {`A task's journey: ${steps.map((s, i) => `${i + 1}. ${s.title}`).join("; ")}`}
            </title>
            {/* gore area between the lanes */}
            <defs>
              <pattern id={`${id}-gore`} width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="20" height="20" className="gore-ground" />
                <rect width="8" height="20" className="gore-stripe" />
              </pattern>
            </defs>
            <path d={upper} className="road-edge" strokeWidth="86" fill="none" />
            <path d={lower} className="road-edge" strokeWidth="86" fill="none" />
            <path d={upper} className="road-asphalt" strokeWidth="74" fill="none" />
            <path d={lower} className="road-asphalt" strokeWidth="74" fill="none" />
            <path d={`M${FORK_X + 150} ${UP_Y + 40} L${MERGE_X - 150} ${UP_Y + 40} L${MERGE_X - 150} ${DOWN_Y - 40} L${FORK_X + 150} ${DOWN_Y - 40} Z`} fill="var(--ground)" />
            <path d={upper} className="j-dash" fill="none" />
            <path d={lower} className="j-dash" fill="none" />

            {/* 1 queue: tasks waiting */}
            <g className="j-queue" data-step={0}>
              {[0, 1, 2].map((i) => (
                <rect key={i} x={10 + i * 10} y={36 + i * 10} width="96" height="56" rx="6" className="j-card" />
              ))}
              <text x="68" y="88" textAnchor="middle" className="j-mono">
                task
              </text>
            </g>
            <text x="20" y="300" className="j-label" data-step={0}>
              Task queue
            </text>

            {/* 2 Flagsmith gantry: identity hashed */}
            <g className="j-gantry" data-step={1}>
              <rect x="300" y="168" width="8" height="140" className="j-steel" />
              <rect x="440" y="168" width="8" height="140" className="j-steel" />
              <rect x="300" y="160" width="148" height="10" className="j-steel" />
              <rect x="292" y="104" width="164" height="54" rx="6" className="j-housing" />
              <LedText text="FLAGSMITH" x={374} y={117} pitch={2.9} />
              <text x="374" y="98" textAnchor="middle" className="j-mono j-mono-sm">
                hash(identity)
              </text>
            </g>

            {/* 3 lanes */}
            <g className="j-lanetab" data-step={2}>
              <rect x="640" y="62" width="104" height="34" rx="6" className="j-tab" />
              <text x="692" y="85" textAnchor="middle">
                control
              </text>
              <rect x="640" y="370" width="120" height="34" rx="6" className="j-tab" />
              <text x="700" y="393" textAnchor="middle">
                lanes_v1
              </text>
            </g>

            {/* 4 toll gantry: events */}
            <g className="j-toll" data-step={3}>
              <rect x="790" y="40" width="8" height="330" className="j-steel" />
              <rect x="770" y="52" width="48" height="10" className="j-steel" />
              {["task_cost", "task_solved", "task_turns", "task_seconds"].map((e, i) => (
                <g key={e} className="j-event" transform={`translate(${826} ${44 + i * 26})`}>
                  <rect width="112" height="20" rx="4" />
                  <text x="8" y="15">
                    {e}
                  </text>
                </g>
              ))}
            </g>

            {/* 5 results: merge sign */}
            <g className="j-results" data-step={4}>
              <rect x="980" y="276" width="6" height="40" className="j-steel" />
              <rect x="936" y="296" width="148" height="70" rx="8" className="j-sign" />
              <rect x="941" y="301" width="138" height="60" rx="5" className="j-sign-border" />
              <text x="1010" y="326" textAnchor="middle" className="j-sign-text">
                Results
              </text>
              <text x="1010" y="348" textAnchor="middle" className="j-sign-sub">
                chance to beat
              </text>
            </g>

            {/* 6 decision: the rule's three checks, then the lane signals */}
            <g data-step={5} className="j-decision">
              {[0, 1, 2].map((i) => (
                <rect key={i} x={1000 + i * 26} y="140" width="18" height="18" rx="3" transform={`rotate(45 ${1009 + i * 26} 149)`} className="j-rule" />
              ))}
            </g>
            {signal(1060, 186, 5)}

            {/* 7 rollout */}
            <g className="j-rollout" data-step={6}>
              <path d="M1120 230 L1180 230 M1164 216 L1180 230 L1164 244" className="j-arrow" />
              <text x="1150" y="290" textAnchor="middle" className="j-label">
                same flag
              </text>
            </g>

            {/* step diamonds */}
            {[70, 374, 620, 806, 1010, 1060, 1150].slice(0, N).map((x, i) => (
              <Diamond key={i} n={i} x={x} y={i === 1 ? 70 : i === 3 ? 410 : i === 4 ? 410 : i === 5 ? 96 : i === 2 ? 230 : i === 6 ? 180 : 140} />
            ))}

            <Car className="j-car-a" at={`translate(700 ${UP_Y})`} />
            <Car className="j-car-b" at={`translate(560 ${DOWN_Y})`} />
          </svg>
        </div>
      </div>
      <ol className="j-caps">
        {steps.map((s, i) => (
          <li key={i} data-step={i}>
            <span className="j-n" aria-hidden="true">
              <b>{i + 1}</b>
            </span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
