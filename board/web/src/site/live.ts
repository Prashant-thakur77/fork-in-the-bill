import { useEffect, useState } from "react";
import { resolveApi } from "../data/useBoard";
import type { Snapshot } from "../data/types";
import { CURRENT, batchOf } from "./batches";

// Shared reads of the board API's /state, one per batch name, for the pages that show a live line
// (the hero signs, the live strip, the results and experiment pages, the menu and the footer).
// GET only. A batch that is still open is read again every minute while a page is visible; a
// finished one is read once.

export type LiveState =
  | { kind: "loading" }
  | { kind: "none" } // no API configured for this build
  | { kind: "error" }
  | { kind: "ok"; snapshot: Snapshot | null; checkedAt: number };

interface Store {
  state: LiveState;
  subs: Set<(s: LiveState) => void>;
  started: boolean;
}

const stores = new Map<string, Store>();

function storeFor(experiment: string): Store {
  let s = stores.get(experiment);
  if (!s) {
    s = { state: { kind: "loading" }, subs: new Set(), started: false };
    stores.set(experiment, s);
  }
  return s;
}

function set(store: Store, s: LiveState) {
  store.state = s;
  store.subs.forEach((f) => f(s));
}

async function poll(store: Store, base: string, experiment: string) {
  try {
    const res = await fetch(`${base}/state?experiment=${experiment}`, { cache: "no-store" });
    if (res.status === 404 || res.status === 204) return set(store, { kind: "ok", snapshot: null, checkedAt: Date.now() });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as unknown;
    const snap = body && typeof body === "object" && "arms" in body ? (body as Snapshot) : null;
    set(store, { kind: "ok", snapshot: snap, checkedAt: Date.now() });
  } catch {
    set(store, { kind: "error" });
  }
}

function start(store: Store, experiment: string) {
  if (store.started) return;
  store.started = true;
  void resolveApi().then((base) => {
    if (!base) return set(store, { kind: "none" });
    void poll(store, base, experiment);
    if (batchOf(experiment)?.state === "final") return;
    window.setInterval(() => {
      if (document.visibilityState === "visible") void poll(store, base, experiment);
    }, 60_000);
  });
}

/** The latest totals of one batch (default: the batch that is running now). */
export function useLiveState(experiment: string = CURRENT): LiveState {
  const [s, setS] = useState<LiveState>({ kind: "loading" });
  useEffect(() => {
    const store = storeFor(experiment);
    store.subs.add(setS);
    setS(store.state);
    start(store, experiment);
    return () => {
      store.subs.delete(setS);
    };
  }, [experiment]);
  return s;
}

export function totals(snap: Snapshot): { done: number; solved: number; usd: number } {
  return Object.values(snap.arms).reduce((a, x) => ({ done: a.done + x.done, solved: a.solved + x.solved, usd: a.usd + x.usd }), { done: 0, solved: 0, usd: 0 });
}

export function utcTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
