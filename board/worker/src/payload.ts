// Shape of the ingest body and of every snapshot served by /state and /stream.

export type Status = "running" | "ended" | "rolled_out";

export interface Arm {
  done: number;
  solved: number;
  usd: number;
  running: number;
}

export interface LastTask {
  variant: string;
  usd: number;
  solved: boolean;
  language: string;
}

export interface Snapshot {
  experiment: string;
  ts: number;
  status: Status;
  flagsmith_experiment_url: string;
  arms: Record<string, Arm>;
  last_task?: LastTask | null;
}

const STATUSES: readonly string[] = ["running", "ended", "rolled_out"];
const EXPERIMENT = /^[a-z0-9_-]{1,32}$/;
const ARM_KEY = /^[a-z0-9_-]{1,32}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isMoney = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9;

function parseArm(v: unknown): Arm | null {
  if (!isObj(v)) return null;
  const { done, solved, usd, running } = v;
  if (!isCount(done) || !isCount(solved) || !isMoney(usd) || !isCount(running)) return null;
  if (solved > done) return null;
  return { done, solved, usd, running };
}

/** Validates an ingest body; returns the normalised snapshot or an error message. */
export function parseSnapshot(raw: unknown): { ok: true; value: Snapshot } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "body must be an object" };
  const { experiment, ts, status, flagsmith_experiment_url, arms, last_task } = raw;
  if (typeof experiment !== "string" || !EXPERIMENT.test(experiment)) {
    return { ok: false, error: "bad experiment" };
  }
  if (!isCount(ts)) return { ok: false, error: "bad ts" };
  if (typeof status !== "string" || !STATUSES.includes(status)) {
    return { ok: false, error: "bad status" };
  }
  let url = "";
  if (flagsmith_experiment_url !== undefined && flagsmith_experiment_url !== null) {
    if (typeof flagsmith_experiment_url !== "string" || flagsmith_experiment_url.length > 500) {
      return { ok: false, error: "bad flagsmith_experiment_url" };
    }
    if (flagsmith_experiment_url && !/^https:\/\//.test(flagsmith_experiment_url)) {
      return { ok: false, error: "flagsmith_experiment_url must be https" };
    }
    url = flagsmith_experiment_url;
  }
  if (!isObj(arms)) return { ok: false, error: "bad arms" };
  const armEntries = Object.entries(arms);
  if (armEntries.length < 1 || armEntries.length > 4) return { ok: false, error: "bad arms" };
  const parsedArms: Record<string, Arm> = {};
  for (const [k, v] of armEntries) {
    if (!ARM_KEY.test(k)) return { ok: false, error: `bad arm key ${k}` };
    const a = parseArm(v);
    if (!a) return { ok: false, error: `bad arm ${k}` };
    parsedArms[k] = a;
  }
  let lt: LastTask | null = null;
  if (last_task !== undefined && last_task !== null) {
    if (!isObj(last_task)) return { ok: false, error: "bad last_task" };
    const { variant, usd, solved, language } = last_task;
    if (
      typeof variant !== "string" ||
      !ARM_KEY.test(variant) ||
      !isMoney(usd) ||
      typeof solved !== "boolean" ||
      typeof language !== "string" ||
      language.length > 40
    ) {
      return { ok: false, error: "bad last_task" };
    }
    lt = { variant, usd, solved, language };
  }
  return {
    ok: true,
    value: {
      experiment,
      ts,
      status: status as Status,
      flagsmith_experiment_url: url,
      arms: parsedArms,
      last_task: lt,
    },
  };
}
