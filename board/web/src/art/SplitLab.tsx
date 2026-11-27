import { useEffect, useMemo, useRef, useState } from "react";
import { carMarkup, CAR_KINDS, CAR_TONES } from "./car";
import { hashedPercentage, md5 } from "../data/bucket";
import { ghFile, repo } from "../site/data";

// Split the traffic yourself. Real task ids from the exp1 pool are placed on a 0-100 road by
// Flagsmith's bucketing maths (md5 of the ids, mod 9999). The divider is the split: below it a
// task takes lanes_v1, above it control. Moving the divider moves only the tasks it crosses,
// because a task's hash never changes. The key is a stand-in, so this is labelled an illustration.

const N_TASKS = 32;
const FS_KEY = "feature-state"; // stand-in for the run's feature-state id
const ENV_KEY = "env-key"; // stand-in for the environment key
const ROW_H = 46;
const TOP = 58;

const keyFor = (id: string) => [FS_KEY, `${ENV_KEY}_${id}`];
const xAt = (W: number, v: number) => 20 + (v / 100) * (W - 40);

interface Placed {
  id: string;
  v: number;
  row: number;
  i: number;
}

/** Stack the cars in rows so none overlap: each takes the first row with room at its x. */
function place(ids: string[], W: number): Placed[] {
  const sorted = ids.map((id, i) => ({ id, i, v: hashedPercentage(keyFor(id)) })).sort((a, b) => a.v - b.v);
  const lastX: number[] = [];
  return sorted.map((t) => {
    const x = xAt(W, t.v);
    let row = lastX.findIndex((lx) => x - lx >= 46);
    if (row < 0) row = lastX.push(-Infinity) - 1;
    lastX[row] = x;
    return { ...t, row };
  });
}

export function SplitLab() {
  const registered = repo.split ?? 50;
  const ids = useMemo(() => repo.exp1Tasks.slice(0, N_TASKS), []);
  // Phones get a narrower road, so the cars stay big enough to see; they stack in more rows.
  const [W, setW] = useState(1000);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const on = () => setW(mq.matches ? 520 : 1000);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const xOf = (v: number) => xAt(W, v);
  const cars = useMemo(() => place(ids, W), [ids, W]);
  const ROAD_H = (Math.max(...cars.map((c) => c.row), 0) + 1) * ROW_H + 20;
  const H = TOP + ROAD_H + 46;
  const plateMin = W < 1000 ? 150 : 190;
  const [split, setSplit] = useState(registered);
  const [probe, setProbe] = useState(ids[0] ?? "");
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const lane = (v: number, s: number) => (v < s ? "lanes_v1" : "control");
  const nV = cars.filter((c) => c.v < split).length;
  const moved = cars.filter((c) => lane(c.v, split) !== lane(c.v, registered));

  const probeHex = probe ? md5(keyFor(probe).join(",")) : "";
  const probeV = probe ? hashedPercentage(keyFor(probe)) : null;

  const fromPointer = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((clientX - r.left) / r.width) * W;
    setSplit(Math.round(Math.max(0, Math.min(100, ((x - 20) / (W - 40)) * 100))));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? split - step
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? split + step
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? 100
              : null;
    if (next === null) return;
    e.preventDefault();
    setSplit(Math.max(0, Math.min(100, next)));
  };

  const sx = xOf(split);
  const message =
    split === registered
      ? `This is the registered split, ${registered} / ${100 - registered}: ${nV} of ${cars.length} tasks take lanes_v1, ${cars.length - nV} take control. Drag the divider.`
      : `Split moved from ${registered} to ${split} (lanes_v1 ${nV}, control ${cars.length - nV}): ${moved.length} ${moved.length === 1 ? "task changes" : "tasks change"} lane, marked in yellow. The other ${cars.length - moved.length} keep theirs, because a task's hash never changes.`;

  return (
    <div className="splitlab">
      <div className="sl-head">
        <span className="sl-badge">Illustration</span>
        <h3 className="sl-h">Move the split yourself</h3>
        <p>
          Flagsmith does not toss a coin per task. It hashes the task's identity to a number from 0 to 100, and the split decides which lane each number
          takes. Drag the divider, or focus it and use the arrow keys.
        </p>
      </div>

      <div className="sl-road">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="sl-svg"
          role="img"
          aria-label={`${cars.length} tasks placed by their hash. Split at ${split}: ${nV} in lanes_v1, ${cars.length - nV} in control.`}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            fromPointer(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          {/* lane plates */}
          <g className="sl-plates">
            <rect x={20} y={8} width={Math.max(0, sx - 26)} height={36} rx={6} className="sl-plate" />
            <rect x={sx + 6} y={8} width={Math.max(0, W - 20 - sx - 6)} height={36} rx={6} className="sl-plate" />
            {sx - 26 > 44 && (
              <text x={34} y={32} className="sl-plate-t">
                {sx - 26 > plateMin ? `lanes_v1: ${nV} tasks` : String(nV)}
              </text>
            )}
            {W - 20 - sx > 44 && (
              <text x={W - 34} y={32} className="sl-plate-t" textAnchor="end">
                {W - 20 - sx > plateMin ? `control: ${cars.length - nV} tasks` : String(cars.length - nV)}
              </text>
            )}
          </g>
          {/* the road, as a chainage strip */}
          <rect x={0} y={TOP} width={W} height={ROAD_H} className="sl-asphalt" />
          <line x1={0} x2={W} y1={TOP + 4} y2={TOP + 4} className="sl-edge" />
          <line x1={0} x2={W} y1={TOP + ROAD_H - 4} y2={TOP + ROAD_H - 4} className="sl-edge" />
          {cars.map((c) => {
            const x = xOf(c.v);
            const y = TOP + 10 + c.row * ROW_H + ROW_H / 2;
            const isMoved = moved.includes(c);
            const isProbe = c.id === probe;
            return (
              <g key={c.id} transform={`translate(${x.toFixed(1)} ${y}) rotate(90) scale(0.5)`} className={`sl-car ${isMoved ? "is-moved" : ""} ${isProbe ? "is-probe" : ""}`}>
                {(isMoved || isProbe) && <circle r={48} className="sl-ring" />}
                <g dangerouslySetInnerHTML={{ __html: carMarkup(CAR_KINDS[c.i % CAR_KINDS.length]!, CAR_TONES[(c.i * 5) % CAR_TONES.length]!) }} />
              </g>
            );
          })}
          {/* ruler */}
          {Array.from({ length: 11 }, (_, i) => (
            <g key={i}>
              <line x1={xOf(i * 10)} x2={xOf(i * 10)} y1={TOP + ROAD_H} y2={TOP + ROAD_H + 10} className="sl-tick" />
              <text x={xOf(i * 10)} y={TOP + ROAD_H + 30} className="sl-tick-t" textAnchor="middle">
                {i * 10}
              </text>
            </g>
          ))}
          {split !== registered && <line x1={xOf(registered)} x2={xOf(registered)} y1={TOP} y2={TOP + ROAD_H} className="sl-was" />}
          {/* the divider: a painted line with a handle */}
          <line x1={sx} x2={sx} y1={TOP - 6} y2={TOP + ROAD_H} className="sl-div" />
          <g
            className="sl-handle"
            transform={`translate(${sx} ${TOP + ROAD_H / 2})`}
            tabIndex={0}
            role="slider"
            aria-label="Split: tasks below this value take lanes_v1"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={split}
            aria-valuetext={`${split}: ${nV} tasks in lanes_v1, ${cars.length - nV} in control`}
            onKeyDown={onKey}
          >
            <rect x={-30} y={-22} width={60} height={44} rx={8} className="sl-handle-b" />
            <text y={8} textAnchor="middle" className="sl-handle-t">
              {split}
            </text>
          </g>
        </svg>
      </div>
      <p className="sl-status" role="status">
        {message}
      </p>
      {split !== registered && (
        <button type="button" className="rb-btn sl-reset" onClick={() => setSplit(registered)}>
          Back to {registered} / {100 - registered}
        </button>
      )}

      <div className="sl-probe">
        <label htmlFor="sl-id" className="sl-probe-l">
          Hash one task
        </label>
        <div className="sl-chips" role="group" aria-label="Pick a task id from the pool">
          {ids.slice(0, 4).map((id) => (
            <button key={id} type="button" className={`sl-chip ${probe === id ? "is-on" : ""}`} aria-pressed={probe === id} onClick={() => setProbe(id)}>
              {id}
            </button>
          ))}
        </div>
        <input id="sl-id" className="sl-input" value={probe} spellCheck={false} autoComplete="off" onChange={(e) => setProbe(e.target.value.trim())} placeholder="Type any task id" />
        {probeV !== null && (
          <ol className="sl-steps" aria-live="polite">
            <li>
              <span>md5("{keyFor(probe).join(",")}")</span>
              <code>{probeHex}</code>
            </li>
            <li>
              <span>as a number, mod 9999, scaled to 0–100</span>
              <code>{probeV.toFixed(2)}</code>
            </li>
            <li>
              <span>
                {probeV < split ? "below" : "at or above"} the split of {split}
              </span>
              <code className={probeV < split ? "is-v" : "is-c"}>{lane(probeV, split)} lane</code>
            </li>
          </ol>
        )}
        {probeV === null && <p className="sl-empty">Type a task id, or pick one above, to see its hash and its lane.</p>}
      </div>
      <p className="sl-src">
        Real task ids from the exp1 pool (<a href={ghFile("tasks/pools/exp1.txt")}>tasks/pools/exp1.txt</a>) and Flagsmith's bucketing maths, the same as{" "}
        <a href={ghFile("integrity/verify_assignment.py")}>integrity/verify_assignment.py</a>. The key is a stand-in: in the run it also holds the environment key
        and the feature-state id, so the lanes here are not the lanes the tasks ran in.
      </p>
    </div>
  );
}
