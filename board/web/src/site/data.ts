import raw from "virtual:repo-data";

export type Block =
  | { type: "p"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] };

export interface Snippet {
  file: string;
  line: number;
  code: string;
}

export interface Policy {
  policy: string;
  main: { model: string; max_tokens: number; effort: string };
  delegate: { model: string; max_tokens: number; max_context_tokens: number; effort: string };
  caps: { turns: number; usd_per_task: number; seconds: number };
  prompt_variant: string;
  mainShort: string;
  delegateShort: string;
}

export interface PilotArm {
  n: number;
  solved: number;
  solve_rate: number;
  usd_mean: number;
  usd_median: number;
  usd_max: number;
  delegate_share: number;
  turns_max: number;
  infra_retries: number;
  usd_incl_retries: number;
  failure_modes: Record<string, number>;
}

export interface PowerRow {
  n_per_arm: number;
  mde_solve_pp: number;
  mde_cost_pct: number;
  guardrail_pass_rate: number;
  power_at_pilot_cost_effect: number;
}

export interface RepoData {
  site: { url: string; repo: string; commit: string; commitShort: string };
  figures: Record<string, string>;
  decisions: Record<string, string>;
  hasNumbers: boolean;
  hashes: { sha256: string; file: string }[];
  hypothesis: string;
  policies: Record<string, Policy>;
  pricing: { source: string; checked_on: string; models: Record<string, { input: number; output: number; cache_read: number }> } | null;
  ids: { features: Record<string, number>; metrics: Record<string, number> } | null;
  metrics: { name: string; aggregation: string; direction: string; role: string; description: string }[];
  split: number | null;
  exp1Tasks: string[];
  manifest: {
    seed: number;
    stratum: { min_gold_files: number; max_gold_files: number; max_gold_lines: number; max_problem_chars: number };
    freshFrom: string;
    preFrom: string;
    languages: string[];
    revision: string;
    tiers: Record<string, number>;
    validationAppliedAt: string;
    pools: Record<string, { count: number; languages: number; droppedInvalid: number | null; sha256: string }>;
  } | null;
  pilot: { arms: Record<string, PilotArm> } | null;
  power: { m: number; power: number; sims: number; seed: number; pilot: { n: number; solve_rate: number }; grid: PowerRow[] } | null;
  prereg: Record<"question" | "decisionRule" | "power" | "exclusions" | "stopping" | "after" | "units" | "metrics" | "seconds", Block[]>;
  amendment: Record<"why" | "known" | "change" | "power", Block[]>;
  pilotReport: Block[];
  decisionsLog: { id: string; title: string; blocks: Block[] }[];
  progress: { phases: { n: number; phase: string; status: string; evidence: string }[]; log: { date: string; text: string }[] };
  ledgers: { run: string; records: number; taskDone: number; merkleRoot: string }[];
  harness: { delegateMaxTurns: number | null; viewMaxLines: number | null; delegateOutputBytes: number | null };
  versions: { flagEngine: string | null; pythonSdk: string | null; nodeSdk: string | null; flagsmithImage: string | null; edgeProxy: string | null };
  snippets: Record<string, Snippet>;
}

export const repo = raw as RepoData;

/** A link to a file in the public repo at the commit this site was built from. */
export function ghFile(path: string, line?: number): string {
  const ref = repo.site.commit || "main";
  return `${repo.site.repo}/blob/${ref}/${path}${line ? `#L${line}` : ""}`;
}

export const pct = (x: number, places = 0) => `${(x * 100).toFixed(places)}%`;
export const usd = (x: number, places = 2) => `$${x.toFixed(places)}`;
