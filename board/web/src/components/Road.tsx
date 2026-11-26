import { useEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "../motion";

// Plan view of the junction. Tasks arrive on one road from the queue (bottom), Flagsmith's
// bucketing forks them into one lane per arm, and each lane runs up under its gantry sign.
// Cars on a lane = tasks currently running in that arm.

const W = 1000;
const H = 330;
const LANE = 148;
const CAR_W = 40;
const CAR_H = 68;
const SPEED = 125; // viewBox units per second
const MIN_GAP = 104; // spacing between spawned cars, in path units
const MAX_CARS = 5;

export function lanePath(x: number): string {
  // trunk from the queue, an S-curve into the lane, then straight up past the gantry
  return `M500 ${H + 60} L500 ${H - 50} C500 ${H - 140} ${x} ${H - 130} ${x} ${H - 220} L${x} -80`;
}

interface Props {
  lanes: { key: string; x: number; cars: number; closed: boolean }[];
}

const SVGNS = "http://www.w3.org/2000/svg";

function makeCar(): SVGGElement {
  const g = document.createElementNS(SVGNS, "g");
  g.setAttribute("class", "car");
  g.innerHTML = `
    <rect x="${-CAR_W / 2}" y="${-CAR_H / 2}" width="${CAR_W}" height="${CAR_H}" rx="9" class="car-body"/>
    <rect x="${-CAR_W / 2 + 6}" y="${-CAR_H / 2 + 10}" width="${CAR_W - 12}" height="14" rx="3" class="car-glass"/>
    <rect x="${-CAR_W / 2 + 6}" y="${CAR_H / 2 - 20}" width="${CAR_W - 12}" height="9" rx="2" class="car-glass"/>
    <rect x="${-CAR_W / 2 + 3}" y="${CAR_H / 2 - 5}" width="8" height="4" rx="1" class="car-tail"/>
    <rect x="${CAR_W / 2 - 11}" y="${CAR_H / 2 - 5}" width="8" height="4" rx="1" class="car-tail"/>`;
  return g;
}

export function Road({ lanes }: Props) {
  const layer = useRef<SVGGElement>(null);
  const paths = useRef<Record<string, SVGPathElement | null>>({});
  const targets = useRef<Record<string, number>>({});
  targets.current = Object.fromEntries(lanes.map((l) => [l.key, l.closed ? 0 : Math.min(l.cars, MAX_CARS)]));

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    type Car = { el: SVGGElement; lane: string; d: number };
    const cars: Car[] = [];
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
    };

    const spawn = (lane: string, d: number) => {
      const el = makeCar();
      g.appendChild(el);
      const c = { el, lane, d };
      cars.push(c);
      place(c);
      return c;
    };

    if (reduce) {
      // Static: draw the running cars spaced along each lane, no travel.
      const draw = () => {
        while (cars.length) cars.pop()!.el.remove();
        for (const [lane, n] of Object.entries(targets.current)) {
          for (let i = 0; i < n; i++) spawn(lane, 330 + i * MIN_GAP);
        }
      };
      draw();
      const id = window.setInterval(draw, 1000);
      return () => {
        window.clearInterval(id);
        while (cars.length) cars.pop()!.el.remove();
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
      const newest = cars.reduce((m, c) => Math.min(m, c.d), Infinity);
      if (newest > MIN_GAP) {
        let pick: string | null = null;
        let deficit = 0;
        for (const [lane, target] of Object.entries(targets.current)) {
          const n = cars.filter((c) => c.lane === lane).length;
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
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i]!;
        c.d += dd;
        const L = paths.current[c.lane]?.getTotalLength() ?? 0;
        if (c.d > L) {
          c.el.remove();
          cars.splice(i, 1);
          continue;
        }
        place(c);
      }
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      io.disconnect();
      while (cars.length) cars.pop()!.el.remove();
    };
  }, [lanes.map((l) => l.key).join(",")]);

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
          <g key={`c${l.key}`} className="closure" data-lane={l.key}>
            {Array.from({ length: 7 }, (_, i) => {
              const t = i / 6;
              const x = l.x - LANE / 2 + 12 + t * (LANE - 24);
              const y = H - 222 - t * 50;
              return <circle key={i} cx={x} cy={y} r={9} className="cone" />;
            })}
          </g>
        ))}
    </svg>
  );
}
