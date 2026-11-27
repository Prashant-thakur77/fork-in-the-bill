import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin, useGSAP);

// The harness in plan view: two lanes inside the task container. The planner lane runs along
// the top with its tool signs; the delegate ramp drops a job into the worker lane, which runs the
// shell and climbs back with JSON findings. Submit exits to the grading container.

const PLAN_Y = 130;
const WORK_Y = 330;
const TOUR = `M70 ${PLAN_Y} L380 ${PLAN_Y} C430 ${PLAN_Y} 430 ${WORK_Y} 480 ${WORK_Y} L640 ${WORK_Y} C690 ${WORK_Y} 690 ${PLAN_Y} 740 ${PLAN_Y} L1010 ${PLAN_Y} C1050 ${PLAN_Y} 1060 250 1100 250`;

function Plate({ x, y, text, tone = "sheet" }: { x: number; y: number; text: string; tone?: "sheet" | "amber" }) {
  const w = text.length * 11.5 + 24;
  return (
    <g className={`hd-plate is-${tone}`} transform={`translate(${x - w / 2} ${y})`}>
      <rect width={w} height="30" rx="5" />
      <text x={w / 2} y="21" textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

export function HarnessDiagram({ planner, worker }: { planner: string; worker: string }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(".hd-draw", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.4, ease: "power2.out", stagger: 0.1, scrollTrigger: { trigger: root.current, start: "top 80%", once: true } });
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6, paused: true });
        tl.fromTo(".hd-token", { opacity: 0 }, { opacity: 1, duration: 0.2 })
          .to(".hd-token", { motionPath: { path: TOUR }, duration: 6, ease: "none" }, 0)
          .to(".hd-token", { opacity: 0, duration: 0.3 }, 5.7);
        ScrollTrigger.create({ trigger: root.current, start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? tl.play() : tl.pause()) });
      });
    },
    { scope: root },
  );
  return (
    <div className="harness" ref={root}>
      <div className="j-scroll" tabIndex={0} role="region" aria-label="Harness diagram, scrolls sideways on small screens">
        <svg viewBox="0 0 1200 470" className="hd-svg" role="img" aria-labelledby="hd-title">
          <title id="hd-title">
            {`The task container holds two lanes. The planner lane (${planner}) reads and edits files, delegates and submits. The worker lane (${worker}) runs bash and returns JSON findings. Submit sends the patch to a fresh grading container.`}
          </title>
          <rect x="30" y="40" width="1010" height="400" rx="14" className="hd-box" />
          <text x="50" y="72" className="hd-box-label">
            Task container · network off
          </text>
          {/* lanes */}
          <path d={`M60 ${PLAN_Y} L1010 ${PLAN_Y}`} className="road-edge" strokeWidth="76" />
          <path d={`M60 ${PLAN_Y} L1010 ${PLAN_Y}`} className="road-asphalt" strokeWidth="66" />
          <path d={`M60 ${WORK_Y} L1010 ${WORK_Y}`} className="road-edge" strokeWidth="76" />
          <path d={`M60 ${WORK_Y} L1010 ${WORK_Y}`} className="road-asphalt" strokeWidth="66" />
          <path d={`M380 ${PLAN_Y} C430 ${PLAN_Y} 430 ${WORK_Y} 480 ${WORK_Y}`} className="road-asphalt" strokeWidth="40" fill="none" />
          <path d={`M640 ${WORK_Y} C690 ${WORK_Y} 690 ${PLAN_Y} 740 ${PLAN_Y}`} className="road-asphalt" strokeWidth="40" fill="none" />
          <path d={`M70 ${PLAN_Y} L1000 ${PLAN_Y}`} className="hd-dash hd-draw" pathLength={1} />
          <path d={`M70 ${WORK_Y} L1000 ${WORK_Y}`} className="hd-dash hd-draw" pathLength={1} />
          <path d={`M1010 ${PLAN_Y} C1050 ${PLAN_Y} 1060 250 1100 250`} className="hd-exit hd-draw" pathLength={1} />
          {/* lane names */}
          <text x="70" y={PLAN_Y + 64} className="hd-lane">
            Planner lane · {planner}
          </text>
          <text x="70" y={WORK_Y + 66} className="hd-lane">
            Worker lane · {worker}
          </text>
          {/* tool signs */}
          <Plate x={170} y={PLAN_Y - 15} text="view_file" />
          <Plate x={290} y={PLAN_Y - 15} text="edit_file" />
          <Plate x={420} y={215} text="delegate" tone="amber" />
          <Plate x={660} y={215} text="JSON findings" tone="amber" />
          <Plate x={880} y={PLAN_Y - 15} text="submit" />
          <Plate x={560} y={WORK_Y - 15} text="bash" />
          {/* grading */}
          <g className="hd-grade">
            <rect x="1062" y="170" width="128" height="160" rx="12" />
            <text x="1126" y="208" textAnchor="middle" className="hd-grade-h">
              Grading
            </text>
            <text x="1126" y="232" textAnchor="middle" className="hd-grade-s">
              fresh container
            </text>
            <text x="1126" y="252" textAnchor="middle" className="hd-grade-s">
              network on
            </text>
            <path d="M1100 286 L1118 304 L1152 270" className="hd-tick" />
          </g>
          <circle r="11" className="hd-token" />
        </svg>
      </div>
    </div>
  );
}
