// REPLAY OF FIXTURE DATA, FOR LOCAL PREVIEW ONLY.
// Nothing here is a result. These numbers are generated from a fixed random seed so the
// board's meters and states can be previewed (?demo=replay) before a real run exists.
// The page shows a "Replay" badge whenever this module drives it.

import { format } from "../data/format";
import type { FlagChange } from "../data/flags";
import type { Snapshot, Status } from "../data/types";

export interface ReplayFrame {
  at: number; // ms from replay start
  snapshot: Snapshot;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LANGS = ["python", "rust", "go", "typescript", "java", "c"];
const TASKS_PER_ARM = 60;
const RUN_MS = 36_000;
export const REPLAY_END_MS = RUN_MS + 9_000;

interface ArmModel {
  costMean: number;
  solveRate: number;
}
const MODEL: Record<string, ArmModel> = {
  control: { costMean: 1.64, solveRate: 0.43 },
  lanes_v1: { costMean: 1.02, solveRate: 0.41 },
};

/** Fixture clock for flag changes: unix seconds at replay time 0. */
const FLAGS_BASE = 1_800_000_000;

function fixtureFlags(): FlagChange[] {
  const base = {
    feature: "agent_routing",
    environment: "Production",
    scope: "environment" as const,
    segment: null,
    enabled_before: true,
    enabled_after: true,
    value_sha256_before: "5f1c0a9b".padEnd(64, "0"),
    value_sha256_after: "5f1c0a9b".padEnd(64, "0"),
  };
  const at = (ms: number) => FLAGS_BASE + Math.floor(ms / 1000);
  const audit = (id: number, ms: number): FlagChange => ({
    ...base,
    id,
    at: at(ms),
    received_at: at(ms),
    source: "audit",
    event_type: "AUDIT_FEATURE_STATE",
    scope: null,
    enabled_before: null,
    enabled_after: null,
    weights_before: null,
    weights_after: null,
    value_sha256_before: null,
    value_sha256_after: null,
  });
  return [
    { ...base, id: 1, at: at(0), received_at: at(0), source: "flag", event_type: "FLAG_UPDATED", weights_before: [{ option_id: 37431, pct: 0 }], weights_after: [{ option_id: 37431, pct: 50 }] },
    audit(2, 0),
    { ...base, id: 3, at: at(RUN_MS + 6000), received_at: at(RUN_MS + 6000), source: "flag", event_type: "FLAG_UPDATED", weights_before: [{ option_id: 37431, pct: 50 }], weights_after: [{ option_id: 37431, pct: 100 }] },
    audit(4, RUN_MS + 6000),
  ];
}

export function buildReplay(): {
  frames: ReplayFrame[];
  figures: Record<string, string>;
  decisions: Record<string, string>;
  flags: FlagChange[];
  flagsBase: number;
} {
  const rand = mulberry32(20261127);
  type Ev = { at: number; arm: string; usd: number; solved: boolean; language: string; start: number };
  const events: Ev[] = [];
  for (const [arm, m] of Object.entries(MODEL)) {
    // Exactly round(rate * N) solves per arm, in shuffled order, so the fixture stays coherent.
    const quota = Math.round(m.solveRate * TASKS_PER_ARM);
    const solvedFlags = Array.from({ length: TASKS_PER_ARM }, (_, i) => i < quota);
    for (let i = solvedFlags.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [solvedFlags[i], solvedFlags[j]] = [solvedFlags[j]!, solvedFlags[i]!];
    }
    for (let i = 0; i < TASKS_PER_ARM; i++) {
      const at = 600 + rand() * (RUN_MS - 600);
      const usd = Math.max(0.08, m.costMean * (0.35 + rand() * 1.3));
      events.push({
        at,
        arm,
        usd,
        solved: solvedFlags[i]!,
        language: LANGS[Math.floor(rand() * LANGS.length)]!,
        start: Math.max(0, at - (3000 + rand() * 6000)),
      });
    }
  }
  events.sort((a, b) => a.at - b.at);

  const arms: Snapshot["arms"] = {
    control: { done: 0, solved: 0, usd: 0, running: 0 },
    lanes_v1: { done: 0, solved: 0, usd: 0, running: 0 },
  };
  const runningAt = (arm: string, t: number) =>
    events.filter((e) => e.arm === arm && e.start <= t && e.at > t).length;

  const snap = (status: Status, at: number, last: Ev | null): Snapshot => ({
    experiment: "exp1",
    ts: Math.floor(at / 1000),
    status,
    flagsmith_experiment_url: "",
    arms: Object.fromEntries(
      Object.entries(arms).map(([k, a]) => [k, { ...a, usd: Math.round(a.usd * 100) / 100, running: status === "running" ? Math.min(runningAt(k, at), 8) : status === "rolled_out" && k === "lanes_v1" ? 4 : 0 }]),
    ),
    last_task: last ? { variant: last.arm, usd: Math.round(last.usd * 100) / 100, solved: last.solved, language: last.language } : null,
  });

  const frames: ReplayFrame[] = [{ at: 0, snapshot: snap("running", 0, null) }];
  for (const e of events) {
    const a = arms[e.arm]!;
    a.done += 1;
    a.usd += e.usd;
    if (e.solved) a.solved += 1;
    frames.push({ at: e.at, snapshot: snap("running", e.at, e) });
  }
  frames.push({ at: RUN_MS + 2500, snapshot: snap("ended", RUN_MS + 2500, null) });
  frames.push({ at: RUN_MS + 6000, snapshot: snap("rolled_out", RUN_MS + 6000, null) });

  // Fixture "final" figures derived from the fixture run above.
  const c = arms.control!;
  const l = arms.lanes_v1!;
  const cps = (a: typeof c) => a.usd / Math.max(a.solved, 1);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
  const f: Record<string, string> = {};
  const put = (k: string, v: number | string, fmt: Parameters<typeof format>[1]) => (f[k] = format(v, fmt));
  put("exp1.arms.control.n_analysed", c.done, "int");
  put("exp1.arms.lanes_v1.n_analysed", l.done, "int");
  put("exp1.arms.control.solves", c.solved, "int");
  put("exp1.arms.lanes_v1.solves", l.solved, "int");
  put("exp1.arms.control.solve_rate", c.solved / c.done, "prob1");
  put("exp1.arms.lanes_v1.solve_rate", l.solved / l.done, "prob1");
  put("exp1.arms.control.cost_mean", c.usd / c.done, "usd2");
  put("exp1.arms.lanes_v1.cost_mean", l.usd / l.done, "usd2");
  put("exp1.arms.control.cost_per_solve", cps(c), "usd2");
  put("exp1.arms.lanes_v1.cost_per_solve", cps(l), "usd2");
  put("exp1.delta.cost_mean_pct", ((l.usd / l.done) / (c.usd / c.done) - 1) * 100, "pct1");
  put("exp1.delta.cost_per_solve_pct", (cps(l) / cps(c) - 1) * 100, "pct1");
  put("exp1.delta.solve_rate_pp", (l.solved / l.done - c.solved / c.done) * 100, "pp1");
  put("exp1.delta.p_solve_drop_within_m", 0.934, "prob1");
  put("exp1.flagsmith.chance_to_beat_control_cost", 0.991, "prob1");
  put("exp1.prereg.m", 5, "pp1");
  put("exp1.prereg.sha256", hex(64), "hash12");
  put("exp1.srm.p", 0.81, "f3");
  put("exp2.arms.control.cost_per_solve", cps(l), "usd2");
  put("exp2.arms.lanes_v2.cost_per_solve", cps(l) * 1.18, "usd2");
  put("exp2.arms.control.solve_rate", l.solved / l.done, "prob1");
  put("exp2.arms.lanes_v2.solve_rate", l.solved / l.done - 0.09, "prob1");
  put("exp2.delta.cost_per_solve_pct", 18, "pct1");
  put("exp2.delta.solve_rate_pp", -9, "pp1");
  put("exp2.flagsmith.chance_to_beat_control_cost", 0.38, "prob1");
  put("exp2.prereg.sha256", hex(64), "hash12");
  put("integrity.merkle_root", hex(64), "hash12");
  put("integrity.task_done_records", c.done + l.done, "int");
  put("integrity.env_snapshots", 7, "int");
  put("integrity.env_snapshot_distinct_hashes", 1, "int");
  put("spend.total_usd", c.usd + l.usd, "usd2");

  return { frames, figures: f, flags: fixtureFlags(), flagsBase: FLAGS_BASE, decisions: {
      "exp1.decision.ship": "lanes_v1",
      "exp1.decision.rule_met.flagsmith_95": "true",
      "exp1.decision.rule_met.guardrail_90": "true",
      "exp1.decision.rule_met.no_guardrail_loss": "true",
      "exp2.decision.ship": "control",
    },
  };
}
