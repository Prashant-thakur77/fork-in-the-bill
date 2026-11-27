import { useEffect, useRef, useState, type MouseEvent } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Led } from "../led/Led";
import { textColumns } from "../led/font";
import { boardExperiment, useBoard, type ReplayControls } from "../data/useBoard";
import type { Board } from "../data/types";
import { Junction, phaseOf, type Phase } from "../components/Junction";
import { Sections } from "../components/Sections";
import { DUR, EASE } from "../motion";
import { repo, type Batch } from "../site/data";
import { BATCHES, CURRENT, batchOf, batchStatus } from "../site/batches";
import { useLiveState, utcTime } from "../site/live";

gsap.registerPlugin(ScrollTrigger, useGSAP);

function statusText(board: Board, phase: Phase): string {
  const exp = board.experiment.toUpperCase();
  if (board.mode === "replay") {
    const ship = board.decisions["exp1.decision.ship"];
    if (phase === "awaiting") return `${exp} · AWAITING RUN`;
    if (phase === "running") return repo.split !== null ? `${exp} · RUNNING · ${100 - repo.split}/${repo.split}` : `${exp} · RUNNING`;
    if (phase === "ended") return `${exp} · ENDED`;
    return ship ? `${exp} · ROLLED OUT · ${ship.toUpperCase()}` : `${exp} · ROLLED OUT`;
  }
  const batch = batchOf(board.experiment);
  if (batch?.state === "final") {
    if (batch.id === "rollout") return `ROLLOUT · DONE · ${board.figures["rollout.n"] ?? ""} TASKS`.replace("  ", " ");
    return batch.ship ? `${exp} · FINAL · ${batch.ship === "control" ? "CONTROL STAYS" : `${batch.ship.toUpperCase()} SHIPPED`}` : `${exp} · FINAL`;
  }
  switch (phase) {
    case "awaiting":
      return batch?.state === "open" ? `${exp} · REGISTERED` : `${exp} · AWAITING RUN`;
    case "running":
      return `${exp} · RUNNING · 50/50`;
    case "ended":
      return `${exp} · ENDED`;
    case "rolled_out":
      return `${exp} · ROLLED OUT`;
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
  if (board.final) return <span className="badge badge-static">Final numbers</span>;
  if (board.mode === "live") {
    const open = board.connection === "open";
    return (
      <span className={`badge badge-live ${open ? "is-open" : ""}`} aria-live="polite">
        <i aria-hidden="true" /> {open ? "Live" : board.connection === "retrying" ? "Reconnecting" : "Connecting"}
      </span>
    );
  }
  return <span className="badge badge-static">Not started</span>;
}

function FlagsmithLink({ url, started }: { url: string; started: boolean }) {
  if (!url) {
    return (
      <span className="fs-link is-pending" aria-disabled="true">
        Flagsmith results <small>{started ? "link not published yet" : "link posts at start"}</small>
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

/* ---------- which run: three plates on one rail, each with its state ---------- */

function BatchTab({ batch, active, onPick }: { batch: Batch; active: boolean; onPick(id: string, e: MouseEvent): void }) {
  const live = useLiveState(batch.id);
  const snap = live.kind === "ok" ? live.snapshot : null;
  const st = batchStatus(batch, snap);
  const done = snap ? Object.values(snap.arms).reduce((a, x) => a + x.done, 0) : null;
  const sub =
    batch.id === "exp1"
      ? "control vs lanes_v1"
      : batch.id === "rollout"
        ? `${batch.arms[0] ?? "the winner"} for every task`
        : "the winner vs lanes_v2";
  return (
    <a
      className={`bs-tab is-${st.key}${active ? " is-active" : ""}`}
      href={batch.id === CURRENT ? "/live" : `/live?experiment=${batch.id}`}
      aria-current={active ? "true" : undefined}
      onClick={(e) => onPick(batch.id, e)}
    >
      <span className="bs-state">
        <i aria-hidden="true" />
        {st.label}
      </span>
      <span className="bs-name">{batch.label}</span>
      <span className="bs-sub">
        {sub}
        {st.key === "live" && done !== null ? ` · ${done} done` : ""}
      </span>
    </a>
  );
}

function BatchSwitch({ experiment, onPick }: { experiment: string; onPick(id: string, e: MouseEvent): void }) {
  return (
    <nav className="batch-switch" aria-label="Which run the board shows">
      <span className="bs-rail" aria-hidden="true" />
      {BATCHES.filter((b) => b.state !== "planned").map((b) => (
        <BatchTab key={b.id} batch={b} active={b.id === experiment} onPick={onPick} />
      ))}
    </nav>
  );
}

const COPY: Record<string, { title: [string, string]; lead: string; question: string }> = {
  exp1: {
    title: ["Two lanes.", "One bill."],
    lead: "Experiment 1, finished. Every task was a real bug fix from a public repo, split 50/50 by Flagsmith. Each lane's sign shows that arm's final cost per solved task.",
    question: "Does sending grunt work to a small model cut the cost per solved task, without solving fewer bugs?",
  },
  rollout: {
    title: ["One lane.", "Same flag."],
    lead: "The rollout batch, finished. After End Experiment the winner became the flag's own value, and a fresh batch ran on that flag with no code change.",
    question: "Does the winner keep working once Flagsmith serves it to every task?",
  },
  exp2: {
    title: ["Two lanes.", "One bill."],
    lead: "Experiment 2, running now on the same flag. Control is the rolled-out winner. In lanes_v2 the small model drafts the patch and the frontier model reviews it. Each lane's sign shows what that arm has spent so far.",
    question: "Does letting the small model draft the fix cut the cost per task further, without solving fewer bugs?",
  },
};

export default function Live() {
  // The prerendered page and the first client render agree on the running batch; a
  // ?experiment= query is read after mount.
  const [experiment, setExperiment] = useState<string>(CURRENT);
  useEffect(() => {
    const q = boardExperiment();
    if (q !== experiment) setExperiment(q);
    const onPop = () => setExperiment(boardExperiment());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { board, replay } = useBoard(experiment);
  const phase = phaseOf(board);
  const root = useRef<HTMLDivElement>(null);
  const copy = (board.mode === "replay" ? COPY.exp1 : COPY[experiment]) ?? COPY.exp1!;
  const batch = batchOf(experiment);
  const st = batch ? batchStatus(batch, board.snapshot) : null;

  const pick = (id: string, e?: MouseEvent) => {
    if (e && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    e?.preventDefault();
    if (id === experiment) return;
    window.history.pushState(null, "", id === CURRENT ? "/live" : `/live?experiment=${id}`);
    setExperiment(id);
  };
  // Links inside the board that point at another batch switch in place.
  const onBoardClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/live?experiment="]');
    if (!a || a.closest(".batch-switch")) return;
    const id = new URL(a.href).searchParams.get("experiment");
    if (!id || !batchOf(id)) return;
    pick(id, e);
    if (!e.defaultPrevented) return;
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: EASE.reveal } });
        tl.from(".bs-rail", { scaleX: 0, transformOrigin: "left center", duration: 0.6, ease: "power3.inOut" }, 0)
          .from(".bs-tab", { y: -18, opacity: 0, rotate: -2, transformOrigin: "50% 0%", duration: 0.7, ease: "elastic.out(1, 0.7)", stagger: 0.08 }, 0.15)
          .from(".board-bar > *", { y: -14, opacity: 0, duration: DUR.ui, stagger: 0.05 }, 0.2)
          .from(".hero-title .line > span", { yPercent: 110, duration: DUR.reveal, stagger: 0.08 }, 0.25)
          .from(".hero-copy > *:not(.hero-title)", { opacity: 0, y: 10, duration: 0.6, stagger: 0.06 }, 0.45)
          .from(".beam", { scaleX: 0, transformOrigin: "left center", duration: 0.7, ease: "power3.inOut" }, 0.3)
          .from(".sign", { clipPath: "inset(0 0 100% 0)", y: -8, duration: 0.7, stagger: 0.12 }, 0.7)
          .from(".signal", { scale: 0.6, opacity: 0, duration: DUR.snap, ease: EASE.snap, stagger: 0.08 }, 1.2)
          .from(".road .road-edge, .road .road-asphalt", { opacity: 0, duration: 0.5, ease: "none" }, 0.4)
          .from(".road .lane-centre, .road .road-dash", { strokeDashoffset: 400, duration: 1.2, ease: "power2.out" }, 0.6);
      });
    },
    { scope: root },
  );

  // Changing the batch re-hangs the signs and re-runs the scroll reveals for the new sections.
  const first = useRef(true);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        if (!first.current) {
          gsap.from(".sign", { clipPath: "inset(0 0 100% 0)", y: -8, duration: 0.6, ease: EASE.reveal, stagger: 0.1 });
          gsap.from(".hero-copy > *", { opacity: 0, y: 8, duration: 0.4, ease: EASE.reveal, stagger: 0.04 });
        }
        first.current = false;
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
    { scope: root, dependencies: [experiment], revertOnUpdate: true },
  );

  const live = board.snapshot && !board.final && board.mode === "live";
  return (
    <div className="page board-page" ref={root} data-mode={board.mode} data-batch={experiment} onClick={onBoardClick}>
      {!replay && <BatchSwitch experiment={experiment} onPick={pick} />}
      <div className="board-bar">
        <div className="vms" aria-label={`Status: ${statusText(board, phase).toLowerCase()}`}>
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
          <FlagsmithLink url={board.flagsmithUrl} started={phase !== "awaiting"} />
        </div>
      </div>

      <div className="board-main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title" className="hero-title">
              <span className="line">
                <span>{copy.title[0]}</span>
              </span>
              <span className="line">
                <span>{copy.title[1]}</span>
              </span>
            </h1>
            <p className="lead">{board.mode === "replay" ? "A replay of the board on recorded fixture data. Nothing here is a result." : copy.lead}</p>
            <p className="question">{copy.question}</p>
            {st && !replay && (
              <p className="batch-line" aria-live="polite">
                <span className={`batch-chip is-${st.key}`}>
                  <i aria-hidden="true" />
                  {st.label}
                </span>
                <span>
                  {st.line}
                  {live && board.snapshot ? ` Last update ${utcTime(board.snapshot.ts * 1000)}.` : ""}
                </span>
              </p>
            )}
            {(live || replay) && <LastTask board={board} />}
            {replay && <ReplayBar c={replay} />}
            {!replay && phase === "awaiting" && (
              <a className="preview-link" href="?demo=replay">
                Preview the board with fixture data <span aria-hidden="true">→</span>
              </a>
            )}
          </div>
          <Junction key={experiment} board={board} />
        </section>

        <Sections board={board} phase={phase} />
      </div>
    </div>
  );
}
