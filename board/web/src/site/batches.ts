import { repo, type Batch, type BatchId } from "./data";
import type { Snapshot, Status } from "../data/types";

// The three batches the board API serves by name. Whether one is finished is decided at build
// time from the repository (numbers.json holds its result), never from the API's status field:
// nothing posts a final status when a run stops, so a finished batch would read "running" forever.

export const BATCHES: Batch[] = repo.batches;

/** The batch that is registered and has no result yet: the one the site reads live. */
export const CURRENT: BatchId = repo.currentExperiment;

export function batchOf(id: string): Batch | undefined {
  return BATCHES.find((b) => b.id === id);
}

export type BatchStatusKey = "final" | "done" | "live" | "ended" | "registered" | "planned";

export interface BatchStatus {
  key: BatchStatusKey;
  /** One or two words for a tab or a chip. */
  label: string;
  /** A short plain sentence. */
  line: string;
}

export function batchStatus(b: Batch, snap: Snapshot | null | undefined): BatchStatus {
  if (b.state === "final") {
    if (b.id === "rollout") return { key: "done", label: "Done", line: "The batch has finished. Its figures are in the analysis output." };
    return {
      key: "final",
      label: "Final",
      line: b.ship ? (b.ship === "control" ? "Decided by the registered rule: control stays." : `Decided by the registered rule: ${b.ship} shipped.`) : "Decided by the registered rule.",
    };
  }
  if (b.state === "planned") return { key: "planned", label: "Not started", line: "Not registered yet." };
  if (snap && snap.status !== "running") return { key: "ended", label: "Ended", line: "The run has ended. The verdict posts when the analysis script has run." };
  if (snap) return { key: "live", label: "Live", line: "Running now. These are running totals, not a result." };
  return { key: "registered", label: "Registered", line: "Registered before its first task. No totals posted yet." };
}

/** Lane state for the junction: a finished batch is drawn from the build, an open one from the API. */
export function batchPhase(b: Batch | undefined, snap: Snapshot | null | undefined): "awaiting" | Status {
  if (b?.state === "final") return "rolled_out";
  return snap ? snap.status : "awaiting";
}

/** "13:23 UTC" from an ISO time; "27 Nov, 13:23 UTC" with the date. */
export function utcStamp(iso: string | null | undefined, withDate = false, seconds = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${seconds ? `:${p(d.getUTCSeconds())}` : ""} UTC`;
  if (!withDate) return time;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${time}`;
}

/** "5 min", "2 h 10 min": the gap between two ISO times. */
export function gapBetween(a: string | null | undefined, b: string | null | undefined): string {
  if (!a || !b) return "";
  const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return "";
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${s % 60} s`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
