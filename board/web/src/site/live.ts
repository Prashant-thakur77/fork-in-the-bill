import { useEffect, useState } from "react";
import { resolveApi } from "../data/useBoard";
import type { Snapshot } from "../data/types";

// One shared read of the board API's /state for the pages that show a live line (the landing
// teaser, the results page and the footer). GET only; refreshed every minute while a page is open.

export type LiveState =
  | { kind: "loading" }
  | { kind: "none" } // no API configured for this build
  | { kind: "error" }
  | { kind: "ok"; snapshot: Snapshot | null; checkedAt: number };

let state: LiveState = { kind: "loading" };
const subs = new Set<(s: LiveState) => void>();
let started = false;

function set(s: LiveState) {
  state = s;
  subs.forEach((f) => f(s));
}

async function poll(base: string) {
  try {
    const res = await fetch(`${base}/state`, { cache: "no-store" });
    if (res.status === 404 || res.status === 204) return set({ kind: "ok", snapshot: null, checkedAt: Date.now() });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as unknown;
    const snap = body && typeof body === "object" && "arms" in body ? (body as Snapshot) : null;
    set({ kind: "ok", snapshot: snap, checkedAt: Date.now() });
  } catch {
    set({ kind: "error" });
  }
}

function start() {
  if (started) return;
  started = true;
  void resolveApi().then((base) => {
    if (!base) return set({ kind: "none" });
    void poll(base);
    window.setInterval(() => {
      if (document.visibilityState === "visible") void poll(base);
    }, 60_000);
  });
}

export function useLiveState(): LiveState {
  const [s, setS] = useState<LiveState>({ kind: "loading" });
  useEffect(() => {
    subs.add(setS);
    setS(state);
    start();
    return () => {
      subs.delete(setS);
    };
  }, []);
  return s;
}

export function totals(snap: Snapshot): { done: number; solved: number; usd: number } {
  return Object.values(snap.arms).reduce((a, x) => ({ done: a.done + x.done, solved: a.solved + x.solved, usd: a.usd + x.usd }), { done: 0, solved: 0, usd: 0 });
}

export function utcTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
