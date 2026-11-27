export type Status = "running" | "ended" | "rolled_out";

export interface Arm {
  done: number;
  solved: number;
  usd: number;
  running: number;
}

/** Same shape as the worker's ingest body and /state, /stream payloads (docs/interfaces.md). */
export interface Snapshot {
  experiment: string;
  ts: number;
  status: Status;
  flagsmith_experiment_url: string;
  arms: Record<string, Arm>;
  last_task?: { variant: string; usd: number; solved: boolean; language: string } | null;
}

import type { FlagChange } from "./flags";

export type Fmt = "usd2" | "usd4" | "pct1" | "pp1" | "int" | "f3" | "prob1" | "hash12";

/** One figure copied from analysis/out/numbers.json; checked like the README markers. */
export interface SeedEntry {
  key: string;
  fmt: Fmt;
  text: string;
}

export interface Seed {
  /** "awaiting_run" until analysis/out/numbers.json holds the experiment's results. */
  status: "awaiting_run" | "final";
  experiment: string;
  flagsmith_experiment_url: string;
  /** Non-numeric outcomes from numbers.json (exp1.decision.ship, exp2.decision.ship). */
  decisions: Record<string, string>;
  numbers: SeedEntry[];
}

export type Mode = "live" | "seed" | "replay";
export type Connection = "connecting" | "open" | "retrying" | "none";

export interface Board {
  mode: Mode;
  /** The batch this board shows: exp1, rollout or exp2. */
  experiment: string;
  connection: Connection;
  snapshot: Snapshot | null;
  /** key -> display text, from the seed (or the replay fixture in replay mode). */
  figures: Record<string, string>;
  decisions: Record<string, string>;
  flagsmithUrl: string;
  /** True once final numbers exist (seed final, or the replay reached its end). */
  final: boolean;
  /** Flag history for the experiment flag; null when there is no worker to ask. */
  flags: FlagChange[] | null;
}
