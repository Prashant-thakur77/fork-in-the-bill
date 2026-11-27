import { useEffect, useMemo, useRef, useState } from "react";
import seedJson from "../seed.json";
import { EXPERIMENT_FLAG, type FlagChange } from "./flags";
import type { Board, Connection, Seed, Snapshot } from "./types";

const seed = seedJson as Seed;

export interface ReplayControls {
  t: number;
  duration: number;
  playing: boolean;
  toggle(): void;
  seek(ms: number): void;
  restart(): void;
}

function seedFigures(): Record<string, string> {
  return Object.fromEntries(seed.numbers.map((n) => [n.key, n.text]));
}

/** API base: runtime /board-config.json wins over the build-time VITE_BOARD_API. */
async function resolveApi(): Promise<string> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}board-config.json`, { cache: "no-store" });
    if (res.ok) {
      const cfg = (await res.json()) as { api?: string };
      if (cfg.api) return cfg.api.replace(/\/$/, "");
    }
  } catch {
    // no runtime config; fall through
  }
  return (import.meta.env.VITE_BOARD_API ?? "").replace(/\/$/, "");
}

function isSnapshot(v: unknown): v is Snapshot {
  return !!v && typeof v === "object" && "arms" in v && "status" in v;
}

function flagsOf(v: unknown): FlagChange[] | null {
  if (!v || typeof v !== "object" || !("changes" in v) || !Array.isArray(v.changes)) return null;
  return v.changes as FlagChange[];
}

export function useBoard(): { board: Board; replay: ReplayControls | null } {
  const isReplay = useMemo(() => new URLSearchParams(window.location.search).get("demo") === "replay", []);
  const live = useLive(!isReplay);
  const replay = useReplay(isReplay);

  if (replay) return { board: replay.board, replay: replay.controls };
  return {
    board: {
      mode: live.api ? "live" : "seed",
      connection: live.connection,
      snapshot: live.snapshot,
      figures: seedFigures(),
      decisions: seed.decisions,
      flagsmithUrl: live.snapshot?.flagsmith_experiment_url || seed.flagsmith_experiment_url,
      final: seed.status === "final",
      flags: live.flags,
    },
    replay: null,
  };
}

function useLive(enabled: boolean) {
  const [api, setApi] = useState<string>("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("none");
  const [flags, setFlags] = useState<FlagChange[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let cancelled = false;
    void resolveApi().then(async (base) => {
      if (cancelled || !base) return;
      setApi(base);
      setConnection("connecting");
      const feature = `feature=${EXPERIMENT_FLAG}`;
      await Promise.all([
        fetch(`${base}/state`, { cache: "no-store" })
          .then((res) => res.json())
          .then((body: unknown) => {
            if (!cancelled && isSnapshot(body)) setSnapshot(body);
          })
          .catch(() => {
            // the stream below retries on its own
          }),
        fetch(`${base}/flags/history?${feature}`, { cache: "no-store" })
          .then((res) => res.json())
          .then((body: unknown) => {
            const f = flagsOf(body);
            if (!cancelled && f) setFlags(f);
          })
          .catch(() => {
            // the stream sends the history too
          }),
      ]);
      if (cancelled) return;
      es = new EventSource(`${base}/stream?${feature}`);
      es.addEventListener("open", () => setConnection("open"));
      es.addEventListener("error", () => setConnection("retrying"));
      es.addEventListener("snapshot", (ev) => {
        try {
          const body: unknown = JSON.parse((ev as MessageEvent<string>).data);
          if (isSnapshot(body)) setSnapshot(body);
        } catch {
          // ignore a malformed frame
        }
      });
      es.addEventListener("flags", (ev) => {
        try {
          const f = flagsOf(JSON.parse((ev as MessageEvent<string>).data));
          if (f) setFlags(f);
        } catch {
          // ignore a malformed frame
        }
      });
    });
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [enabled]);

  return { api, snapshot, connection, flags };
}

type Replay = Awaited<ReturnType<typeof import("../replay/fixture")["buildReplay"]>>;

function useReplay(enabled: boolean): { board: Board; controls: ReplayControls } | null {
  const [data, setData] = useState<Replay | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const clock = useRef({ origin: 0, raf: 0 });

  useEffect(() => {
    if (!enabled) return;
    // Loaded only in replay mode, so fixture numbers never ship in the normal path.
    void import("../replay/fixture").then((m) => setData(m.buildReplay()));
  }, [enabled]);

  const duration = data ? data.frames[data.frames.length - 1]!.at + 4000 : 1;

  useEffect(() => {
    if (!data || !playing) return;
    const c = clock.current;
    c.origin = performance.now() - t;
    let last = -1;
    const tick = (now: number) => {
      const next = Math.min(now - c.origin, duration);
      // Re-render at most ~10 times a second; meters tween between frames.
      if (Math.floor(next / 100) !== last) {
        last = Math.floor(next / 100);
        setT(next);
      }
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      c.raf = requestAnimationFrame(tick);
    };
    c.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(c.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, playing]);

  if (!enabled || !data) {
    return enabled
      ? {
          board: { mode: "replay", connection: "none", snapshot: null, figures: {}, decisions: {}, flagsmithUrl: "", final: false, flags: null },
          controls: { t: 0, duration: 1, playing: false, toggle() {}, seek() {}, restart() {} },
        }
      : null;
  }

  let frame = data.frames[0]!;
  for (const f of data.frames) if (f.at <= t) frame = f;
  const ended = frame.snapshot.status !== "running";

  return {
    board: {
      mode: "replay",
      connection: "none",
      snapshot: frame.snapshot,
      figures: ended ? data.figures : pick(data.figures, ["exp1.prereg.sha256", "exp1.prereg.m"]),
      decisions: ended ? data.decisions : {},
      flagsmithUrl: "",
      final: ended,
      flags: data.flags.filter((c) => c.at <= data.flagsBase + t / 1000),
    },
    controls: {
      t,
      duration,
      playing,
      toggle: () => setPlaying((p) => (t >= duration ? (setT(0), true) : !p)),
      seek: (ms) => {
        const v = Math.max(0, Math.min(ms, duration));
        clock.current.origin = performance.now() - v;
        setT(v);
      },
      restart: () => {
        clock.current.origin = performance.now();
        setT(0);
        setPlaying(true);
      },
    },
  };
}

function pick(o: Record<string, string>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]!]));
}
