import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Led } from "../led/Led";
import { textColumns } from "../led/font";
import { useBoard, type ReplayControls } from "../data/useBoard";
import type { Board } from "../data/types";
import { Junction, phaseOf, type Phase } from "../components/Junction";
import { Sections } from "../components/Sections";
import { DUR, EASE } from "../motion";

gsap.registerPlugin(ScrollTrigger, useGSAP);

function statusText(board: Board, phase: Phase): string {
  const exp = (board.snapshot?.experiment ?? "exp1").toUpperCase();
  const ship = board.decisions["exp1.decision.ship"];
  switch (phase) {
    case "awaiting":
      return `${exp} · AWAITING RUN`;
    case "running":
      return `${exp} · RUNNING · 50/50`;
    case "ended":
      return `${exp} · ENDED`;
    case "rolled_out":
      return ship ? `${exp} · ROLLED OUT · ${ship.toUpperCase()}` : `${exp} · ROLLED OUT`;
  }
}

function ModeBadge({ board }: { board: Board }) {
  if (board.mode === "replay") {
    return (
      <span className="badge badge-replay" title="Fixture data for local preview. Not a result.">
        Replay<span className="badge-long">: fixture data</span>
      </span>
    );
  }
  if (board.mode === "live") {
    const open = board.connection === "open";
    return (
      <span className={`badge badge-live ${open ? "is-open" : ""}`} aria-live="polite">
        <i aria-hidden="true" /> {open ? "Live" : board.connection === "retrying" ? "Reconnecting" : "Connecting"}
      </span>
    );
  }
  return <span className="badge badge-static">{board.final ? "Final numbers" : "Not started"}</span>;
}

function FlagsmithLink({ url }: { url: string }) {
  if (!url) {
    return (
      <span className="fs-link is-pending" aria-disabled="true">
        Flagsmith results <small>link posts at start</small>
      </span>
    );
  }
  return (
    <a className="fs-link" href={url} target="_blank" rel="noopener noreferrer">
      Flagsmith results <span aria-hidden="true">↗</span>
    </a>
  );
}

function LastTask({ board }: { board: Board }) {
  const t = board.snapshot?.last_task;
  return (
    <p className="last-task" aria-live="polite">
      <span className="last-task-k">Last task</span>
      {t ? (
        <span key={`${board.snapshot?.ts}-${t.variant}-${t.usd}`} className="last-task-v">
          {t.variant} · {t.language} · {t.solved ? "solved" : "not solved"} · ${t.usd.toFixed(2)}
        </span>
      ) : (
        <span className="last-task-v is-quiet">none yet</span>
      )}
    </p>
  );
}

function ReplayBar({ c }: { c: ReplayControls }) {
  const sec = (ms: number) => `${Math.floor(ms / 1000)}s`;
  return (
    <div className="replay-bar" role="group" aria-label="Replay controls">
      <button type="button" onClick={c.toggle}>
        {c.playing ? "Pause" : c.t >= c.duration ? "Play again" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={Math.round(c.duration)}
        step={100}
        value={Math.round(c.t)}
        onChange={(e) => c.seek(Number(e.target.value))}
        aria-label="Replay position"
        aria-valuetext={`${sec(c.t)} of ${sec(c.duration)}`}
      />
      <span className="replay-time">
        {sec(c.t)} / {sec(c.duration)}
      </span>
    </div>
  );
}

export default function Live() {
  const { board, replay } = useBoard();
  const phase = phaseOf(board);
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: EASE.reveal } });
        tl.from(".board-bar > *", { y: -14, opacity: 0, duration: DUR.ui, stagger: 0.05 })
          .from(".hero-title .line > span", { yPercent: 110, duration: DUR.reveal, stagger: 0.08 }, 0.1)
          .from(".hero-copy > *:not(.hero-title)", { opacity: 0, y: 10, duration: 0.6, stagger: 0.06 }, 0.35)
          .from(".beam", { scaleX: 0, transformOrigin: "left center", duration: 0.7, ease: "power3.inOut" }, 0.2)
          .from(".sign", { clipPath: "inset(0 0 100% 0)", y: -8, duration: 0.7, stagger: 0.12 }, 0.6)
          .from(".signal", { scale: 0.6, opacity: 0, duration: DUR.snap, ease: EASE.snap, stagger: 0.08 }, 1.1)
          .from(".road .road-edge, .road .road-asphalt", { opacity: 0, duration: 0.5, ease: "none" }, 0.3)
          .from(".road .lane-centre, .road .road-dash", { strokeDashoffset: 400, duration: 1.2, ease: "power2.out" }, 0.5);

        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          const kind = el.dataset.reveal;
          const from =
            kind === "print"
              ? { clipPath: "inset(0 0 100% 0)", duration: 1.4, ease: "steps(18)" }
              : kind === "hang"
                ? { clipPath: "inset(0 0 100% 0)", y: -16, duration: DUR.reveal }
                : { y: 24, opacity: 0, duration: DUR.reveal };
          gsap.from(el, { ...from, scrollTrigger: { trigger: el, start: "top 85%", once: true } });
        });
      });
    },
    { scope: root },
  );

  return (
    <div className="page board-page" ref={root} data-mode={board.mode}>
      <div className="board-bar">
        <div className="vms" aria-label={`Experiment status: ${statusText(board, phase).toLowerCase()}`}>
          <Led
            text={statusText(board, phase)}
            cols={Math.max(140, textColumns(statusText(board, phase)) + 6)}
            align="center"
            scan
            label={statusText(board, phase)}
          />
        </div>
        <div className="masthead-end">
          <ModeBadge board={board} />
          <FlagsmithLink url={board.flagsmithUrl} />
        </div>
      </div>

      <div className="board-main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title" className="hero-title">
              <span className="line">
                <span>Two lanes.</span>
              </span>
              <span className="line">
                <span>One bill.</span>
              </span>
            </h1>
            <p className="lead">
              A live A/B test on a coding agent, run as a Flagsmith experiment. Every task is a real bug fix from a
              public repo. Each lane's sign shows what that arm has spent.
            </p>
            <p className="question">
              Does sending grunt work to a small model cut the cost per solved task, without solving fewer bugs?
            </p>
            <LastTask board={board} />
            {replay && <ReplayBar c={replay} />}
            {!replay && phase === "awaiting" && (
              <a className="preview-link" href="?demo=replay">
                Preview the board with fixture data <span aria-hidden="true">→</span>
              </a>
            )}
          </div>
          <Junction board={board} />
        </section>

        <Sections board={board} phase={phase} />
      </div>
    </div>
  );
}
