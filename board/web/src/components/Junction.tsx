import { useEffect, useRef } from "react";
import gsap from "gsap";
import { Led } from "../led/Led";
import { prefersReducedMotion } from "../motion";
import { armInfo, DEFAULT_ARMS, orderArms } from "../data/arms";
import { money } from "../data/format";
import type { Arm, Board } from "../data/types";
import { useTween } from "../data/useTween";
import { batchOf, batchPhase } from "../site/batches";
import { Road } from "./Road";

export type Phase = "awaiting" | "running" | "ended" | "rolled_out";

export function phaseOf(board: Board): Phase {
  if (board.mode === "replay") return board.snapshot ? board.snapshot.status : "awaiting";
  return batchPhase(batchOf(board.experiment), board.snapshot);
}

type SignalKind = "off" | "open" | "closing" | "closed";

function Signal({ kind, lane }: { kind: SignalKind; lane: string }) {
  const label = { off: "signal off", open: "lane open", closing: "lane closing", closed: "lane closed" }[kind];
  return (
    <div className={`signal signal-${kind}`} role="img" aria-label={`${lane}: ${label}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        {kind === "open" || kind === "off" ? (
          <path d="M20 6 V30 M10 21 L20 32 L30 21" />
        ) : (
          <path d="M9 9 L31 31 M31 9 L9 31" />
        )}
      </svg>
    </div>
  );
}

function StatRow({ items }: { items: [string, string][] }) {
  return (
    <dl className="sign-stats">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function LiveMeter({ arm }: { arm: Arm }) {
  const usd = useTween(arm.usd);
  const text = money(usd);
  return <Led text={text} cols={50} label={`${money(arm.usd)} spent`} />;
}

function Sign({ armKey, arm, board, phase, closed }: { armKey: string; arm?: Arm; board: Board; phase: Phase; closed: boolean }) {
  const exp = board.experiment;
  const info = armInfo(armKey, board.mode === "replay" ? undefined : exp);
  const f = (k: string) => board.figures[`${exp}.arms.${armKey}.${k}`];
  // A finished batch reads its sign from the analysis output, so it matches the results page.
  const fromBuild = board.final && board.mode !== "replay";
  let meterLabel = "Spent so far";
  let meter = <Led text="STANDBY" cols={50} label="No spend yet: the run has not started" />;
  let stats: [string, string][] = [
    ["Tasks done", "—"],
    ["Solved", "—"],
    ["Per solve", "—"],
  ];
  if (fromBuild && exp === "rollout" && board.figures["rollout.cost_mean"]) {
    const mean = board.figures["rollout.cost_mean"]!;
    meterLabel = "Mean cost per task · final";
    meter = <Led text={mean} cols={50} label={`${mean} mean cost per task`} />;
    stats = [
      ["Tasks", board.figures["rollout.n"] ?? "—"],
      ["Solve rate", board.figures["rollout.solve_rate"] ?? "—"],
      ["Batch spend", board.figures["spend.by_experiment.rollout"] ?? "—"],
    ];
  } else if (fromBuild && f("cost_per_solve")) {
    meterLabel = "Cost per solved task · final";
    meter = <Led text={f("cost_per_solve")!} cols={50} label={`${f("cost_per_solve")} per solved task`} />;
    stats = [
      ["Tasks", f("n_analysed") ?? "—"],
      ["Solved", f("solves") ?? "—"],
      ["Solve rate", f("solve_rate") ?? "—"],
    ];
  } else if (arm) {
    meter = <LiveMeter arm={arm} />;
    if (phase !== "running") meterLabel = "Spent";
    stats = [
      ["Tasks done", arm.done.toLocaleString("en-US")],
      ["Solved", arm.solved.toLocaleString("en-US")],
      ["Per solve", arm.solved > 0 ? money(arm.usd / arm.solved) : "—"],
    ];
  } else if (board.final && f("cost_per_solve")) {
    meterLabel = "Cost per solved task";
    meter = <Led text={f("cost_per_solve")!} cols={50} label={`${f("cost_per_solve")} per solved task`} />;
    stats = [
      ["Tasks", f("n_analysed") ?? "—"],
      ["Solved", f("solves") ?? "—"],
      ["Solve rate", f("solve_rate") ?? "—"],
    ];
  }
  return (
    <article className={`sign ${closed ? "is-closed" : ""}`} data-arm={armKey} aria-label={`${info.tab} lane`}>
      <div className="sign-tab">{info.tab}</div>
      {closed && (
        <div className="closed-plate" role="status">
          Lane closed
        </div>
      )}
      <div className="sign-face">
        <h2 className="sign-legend">{info.legend}</h2>
        <p className="sign-sub">{info.sub}</p>
        <div className="led-housing">
          <span className="led-caption">{meterLabel}</span>
          {meter}
        </div>
        <StatRow items={stats} />
      </div>
    </article>
  );
}

export function Junction({ board }: { board: Board }) {
  const phase = phaseOf(board);
  const s = board.snapshot;
  // A batch always has its registered lanes on the road, even before one of them reports a task.
  const batch = board.mode === "replay" ? undefined : batchOf(board.experiment);
  const known = s && batch?.state !== "final" ? Object.keys(s.arms) : [];
  const keys = orderArms([...new Set([...(batch?.arms.length ? batch.arms : DEFAULT_ARMS), ...known])]).slice(0, 2);
  const winner = batch?.id === "rollout" ? batch.arms[0] : board.decisions[`${board.experiment}.decision.ship`];
  const isClosed = (k: string) => phase === "rolled_out" && !!winner && k !== winner;
  const signal = (k: string): SignalKind =>
    phase === "awaiting" ? "off" : phase === "running" ? "open" : phase === "ended" ? "closing" : isClosed(k) ? "closed" : "open";

  const lanes = keys.map((k, i) => ({
    key: k,
    x: keys.length === 1 ? 500 : i === 0 ? 250 : 750,
    cars: s?.arms[k]?.running ?? 0,

    closed: isClosed(k),
  }));

  // Signature moment: on rollout the losing lane is coned off cone by cone and its sign gets the plate.
  const root = useRef<HTMLDivElement>(null);
  const closedKey = keys.filter(isClosed).join(",");
  useEffect(() => {
    if (!closedKey || !root.current || prefersReducedMotion()) return;
    const q = gsap.utils.selector(root.current);
    const tl = gsap.timeline();
    tl.from(q(".signal-closed"), { scale: 0.7, duration: 0.16, ease: "power4.out" })
      .from(q(".closed-plate"), { scale: 1.35, opacity: 0, duration: 0.32, ease: "power4.out" }, 0.55);
    return () => {
      tl.kill();
    };
  }, [closedKey]);

  return (
    <div className="junction" data-phase={phase} data-lanes={keys.length} ref={root}>
      <div className="gantry">
        <div className="beam" aria-hidden="true">
          <svg viewBox="0 0 1000 24" preserveAspectRatio="none">
            <rect x="0" y="2" width="1000" height="3" />
            <rect x="0" y="19" width="1000" height="3" />
            <path d={Array.from({ length: 50 }, (_, i) => `M${i * 20} 4 L${i * 20 + 10} 20 L${i * 20 + 20} 4`).join(" ")} />
          </svg>
        </div>
        <div className="signs">
          {keys.map((k) => (
            <Sign key={k} armKey={k} arm={s?.arms[k]} board={board} phase={phase} closed={isClosed(k)} />
          ))}
        </div>
        <div className="signals">
          {keys.map((k) => (
            <Signal key={k} kind={signal(k)} lane={k} />
          ))}
        </div>
      </div>
      <Road lanes={lanes} />
      {phase === "running" && lanes.every((l) => l.cars === 0) && (
        <p className="road-idle">
          <span>No task on the road right now</span>
          <span>The signs keep each lane's totals</span>
        </p>
      )}
      <div className="queue-label">
        <span>Task queue</span>
        <span>{keys.length === 1 ? `Flagsmith serves ${keys[0]} to every task` : "Flagsmith splits 50 / 50"}</span>
      </div>
    </div>
  );
}
