import { useEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "../motion";
import { carMarkup, CAR_KINDS, CAR_TONES } from "../art/car";

// Plan view of the junction. Tasks arrive on one road from the queue (bottom), Flagsmith's
// bucketing forks them into one lane per arm, and each lane runs up under its gantry sign.
// Cars on a lane = tasks currently running in that arm.

const W = 1000;
const H = 330;
const LANE = 148;
const CAR_H = 80; // the longest vehicle
const TRUNK = 110; // path length of the shared trunk before the fork
const CONES_END = 300; // path length by which a closed lane's taper is behind a car
const FADE_FROM = 120; // cars fade out between these y values as they pass under the gantry
const FADE_TO = 44;
const SPEED = 125; // viewBox units per second
const MIN_GAP = 112; // spacing between spawned cars, in path units
const MAX_CARS = 5;

export function lanePath(x: number): string {
  // trunk from the queue, an S-curve into the lane, then straight up past the gantry
  return `M500 ${H + 60} L500 ${H - 50} C500 ${H - 140} ${x} ${H - 130} ${x} ${H - 220} L${x} -80`;
}

/** A point and unit normal on a lane's fork curve, t in [0, 1]. */
function curveAt(x: number, t: number): { x: number; y: number; nx: number; ny: number } {
  const P = [
    [500, H - 50],
    [500, H - 140],
    [x, H - 130],
    [x, H - 220],
  ] as const;
  const u = 1 - t;
  const px = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
  const py = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
  const dx = 3 * u * u * (P[1][0] - P[0][0]) + 6 * u * t * (P[2][0] - P[1][0]) + 3 * t * t * (P[3][0] - P[2][0]);
  const dy = 3 * u * u * (P[1][1] - P[0][1]) + 6 * u * t * (P[2][1] - P[1][1]) + 3 * t * t * (P[3][1] - P[2][1]);
  const len = Math.hypot(dx, dy) || 1;
  return { x: px, y: py, nx: -dy / len, ny: dx / len };
}

/** Seven cones in a taper across the mouth of a closed lane, from its outer edge towards the gore. */
export function conePoints(x: number): { x: number; y: number }[] {
  const outer = x < 500 ? -1 : 1; // the normal's sign that points away from the other lane
  return Array.from({ length: 7 }, (_, i) => {
    const k = i / 6;
    const c = curveAt(x, 0.45 + k * 0.5);
    const off = outer * (LANE / 2 - 14) * (1 - 2 * k);
    return { x: c.x + c.nx * off, y: c.y + c.ny * off };
  });
}

interface Props {
  lanes: { key: string; x: number; cars: number; closed: boolean }[];
}

const SVGNS = "http://www.w3.org/2000/svg";

let carCount = 0;
function makeCar(): SVGGElement {
  const i = carCount++;
  const g = document.createElementNS(SVGNS, "g");
  g.setAttribute("class", "car");
  g.innerHTML = carMarkup(CAR_KINDS[i % CAR_KINDS.length]!, CAR_TONES[(i * 5 + Math.floor(i / 6)) % CAR_TONES.length]!);
  return g;
}

type Car = { el: SVGGElement; lane: string; d: number };

export function Road({ lanes }: Props) {
  const layer = useRef<SVGGElement>(null);
  const paths = useRef<Record<string, SVGPathElement | null>>({});
  const targets = useRef<Record<string, number>>({});
  targets.current = Object.fromEntries(lanes.map((l) => [l.key, l.closed ? 0 : Math.min(l.cars, MAX_CARS)]));
  const cars = useRef<Car[]>([]);
  const closures = useRef<Record<string, SVGGElement | null>>({});
  const closedKey = lanes
    .filter((l) => l.closed)
    .map((l) => l.key)
    .join(",");
  const lastClosed = useRef(closedKey);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    const list = cars.current;
    const reduce = prefersReducedMotion();

    const place = (c: Car) => {
      const path = paths.current[c.lane];
      if (!path) return;
      const L = path.getTotalLength();
      const at = Math.max(0, Math.min(L, c.d));
      const a = path.getPointAtLength(at);
      const b = path.getPointAtLength(Math.min(L, at + 4));
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
      c.el.setAttribute("transform", `translate(${a.x.toFixed(1)} ${a.y.toFixed(1)}) rotate(${angle.toFixed(1)})`);
      // Cars pass under the gantry: they fade out before they reach the signal heads.
      const o = Math.max(0, Math.min(1, (a.y - FADE_TO) / (FADE_FROM - FADE_TO)));
      c.el.style.opacity = o < 1 ? o.toFixed(2) : "";
    };

    const spawn = (lane: string, d: number) => {
      const el = makeCar();
      g.appendChild(el);
      const c = { el, lane, d };
      list.push(c);
      place(c);
      return c;
    };

    const clearAll = () => {
      while (list.length) list.pop()!.el.remove();
    };

    if (reduce) {
      // Static: draw the running cars spaced along each lane, no travel.
      const draw = () => {
        clearAll();
        carCount = 0;
        for (const [lane, n] of Object.entries(targets.current)) {
          for (let i = 0; i < n; i++) spawn(lane, 330 + i * MIN_GAP);
        }
      };
      draw();
      const id = window.setInterval(draw, 1000);
      return () => {
        window.clearInterval(id);
        clearAll();
      };
    }

    let visible = true;
    let lastLane = "";
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(g.ownerSVGElement ?? g);

    const tick = (_time: number, deltaMs: number) => {
      if (!visible) return;
      const dd = (Math.min(deltaMs, 64) / 1000) * SPEED;
      // One shared trunk: release one car at a time, to the lane furthest below its target.
      const newest = list.reduce((m, c) => Math.min(m, c.d), Infinity);
      if (newest > MIN_GAP) {
        let pick: string | null = null;
        let deficit = 0;
        for (const [lane, target] of Object.entries(targets.current)) {
          const n = list.filter((c) => c.lane === lane).length;
          const want = target - n;
          if (want > deficit || (want === deficit && want > 0 && lane !== lastLane)) {
            pick = lane;
            deficit = want;
          }
        }
        if (pick) {
          spawn(pick, 0);
          lastLane = pick;
        }
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i]!;
        c.d += dd;
        const L = paths.current[c.lane]?.getTotalLength() ?? 0;
        if (c.d > L) {
          c.el.remove();
          list.splice(i, 1);
          continue;
        }
        place(c);
      }
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      io.disconnect();
      clearAll();
    };
  }, [lanes.map((l) => l.key).join(",")]);

  // Closing a lane: cars still on the shared trunk merge into the open lane, cars already in the
  // closed lane drive on and clear it, and the cones are placed one by one behind the last of them.
  useEffect(() => {
    if (closedKey === lastClosed.current) return;
    lastClosed.current = closedKey;
    if (!closedKey) return;
    const shut = closedKey.split(",");
    const open = lanes.map((l) => l.key).filter((k) => !shut.includes(k));
    let wait = 0;
    for (const c of cars.current) {
      if (!shut.includes(c.lane)) continue;
      if (c.d < TRUNK && open[0]) c.lane = open[0];
      else if (c.d < CONES_END + CAR_H / 2) wait = Math.max(wait, (CONES_END + CAR_H / 2 - c.d) / SPEED);
    }
    if (prefersReducedMotion()) return;
    const cones = shut.flatMap((k) => Array.from(closures.current[k]?.querySelectorAll(".cone") ?? []));
    const tw = gsap.from(cones, {
      scale: 0,
      transformOrigin: "50% 50%",
      transformBox: "fill-box",
      duration: 0.22,
      ease: "back.out(2.2)",
      stagger: 0.09,
      delay: 0.12 + Math.min(wait, 2.4),
    });
    return () => {
      tw.revert();
    };
  }, [closedKey]);

  const xs = lanes.map((l) => l.x);
  const gore = xs.length === 2 ? `M500 ${H - 74} L${xs[0]! + LANE / 2 + 6} ${H - 212} L${xs[1]! - LANE / 2 - 6} ${H - 212} Z` : "";

  return (
    <svg className="road" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tasks arrive on one road and split into one lane per arm">
      <defs>
        <pattern id="gore" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="22" height="22" className="gore-ground" />
          <rect width="9" height="22" className="gore-stripe" />
        </pattern>
      </defs>
      {gore && <path d={gore} fill="url(#gore)" className="gore" />}
      {lanes.map((l) => (
        <path key={`e${l.key}`} d={lanePath(l.x)} className="road-edge" strokeWidth={LANE + 12} />
      ))}
      {lanes.map((l) => (
        <path
          key={`a${l.key}`}
          d={lanePath(l.x)}
          className="road-asphalt"
          strokeWidth={LANE}
          ref={(el) => {
            paths.current[l.key] = el;
          }}
        />
      ))}
      <path d={`M500 ${H + 60} L500 ${H - 50}`} className="road-asphalt" strokeWidth={LANE + 40} />
      <path d={`M500 ${H + 60} L500 ${H - 54}`} className="road-dash" />
      {lanes.map((l) => (
        <g key={`m${l.key}`}>
          <path d={`M${l.x} 60 L${l.x} ${H - 230}`} className="lane-centre" />
          <line x1={l.x - LANE / 2} x2={l.x + LANE / 2} y1={30} y2={30} className="toll-line" />
        </g>
      ))}
      <g ref={layer} />
      {lanes
        .filter((l) => l.closed)
        .map((l) => (
          <g
            key={`c${l.key}`}
            className="closure"
            data-lane={l.key}
            ref={(el) => {
              closures.current[l.key] = el;
            }}
          >
            {conePoints(l.x).map((p, i) => (
              <g key={i} className="cone" transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
                <circle r={11} className="cone-base" />
                <circle r={7} className="cone-band" />
                <circle r={3.2} className="cone-tip" />
              </g>
            ))}
          </g>
        ))}
    </svg>
  );
}
