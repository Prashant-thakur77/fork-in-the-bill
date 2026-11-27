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

export type BatchId = "exp1" | "rollout" | "exp2";

/** One batch the board API serves by name, with what the repo says about it at build time. */
export interface Batch {
  id: BatchId;
  label: string;
  arms: string[];
  /** "final": numbers.json holds its result. "open": registered, no result yet. "planned": not registered. */
  state: "final" | "open" | "planned";
  ship: string | null;
  preregFile: string | null;
  preregTag: string | null;
  preregSha: string | null;
  /** When the pre-registration tag was created (UTC, ISO), from git. */
  registeredAt: string | null;
  /** When the run's first worker started (UTC, ISO), from runs/<id>/meta.json once committed. */
  startedAt: string | null;
  flagsmithId: string | null;
}

/** Per-arm block of numbers.json (docs/interfaces.md, ARM). */
export interface ArmNumbers {
  n_exposed: number;
  n_excluded: number;
  n_analysed: number;
  cost_mean: number;
  cost_mean_ci: [number, number];
  cost_median: number;
  solve_rate: number;
  solve_rate_ci: [number, number];
  solves: number;
  cost_per_solve: number;
  cost_per_solve_ci: [number, number];
  delegate_share_cost: number;
  delegate_share_tokens: number;
  turns_mean: number;
  seconds_mean: number;
}

export interface TraitLevel {
  delta_cost_pct: number | null;
  delta_solve_pp: number | null;
  [arm: string]: { n: number; solves: number; solve_rate: number | null; cost_mean: number | null } | number | null;
}

export interface TierNumbers {
  delta: { cost_mean_pct: number; cost_per_solve_pct: number; p_solve_drop_within_m: number; solve_rate_pp: number; solve_rate_ci: [number, number] };
  [arm: string]: { n: number; solves: number; solve_rate: number; cost_mean: number; cost_per_solve: number } | TierNumbers["delta"];
}

export interface ExperimentNumbers {
  prereg: { tag: string; sha256: string; m: number };
  arms: Record<string, ArmNumbers>;
  delta: {
    treatment: string;
    cost_mean: number;
    cost_mean_ci: [number, number];
    cost_mean_pct: number;
    cost_mean_pct_ci: [number, number];
    cost_per_solve_pct: number;
    cost_per_solve_pct_ci: [number, number];
    solve_rate_pp: number;
    solve_rate_ci: [number, number];
    p_solve_drop_within_m: number;
    p_solve_worse: number;
  };
  srm: { chi2: number; p: number; flag: boolean };
  agreement: { cost_mean_abs_diff: Record<string, number>; solve_rate_abs_diff: Record<string, number> };
  flagsmith: { chance_to_beat_control_cost: number; lift_cost: number; ci_cost: [number, number]; solve_rate_status: string; pulled_at: string; guardrail_loss: boolean };
  decision: { ship: string; rule_met: Record<string, boolean>; bars: { flagsmith_chance: number; guardrail_posterior: number; m: number } };
  power: { n_per_arm: number; mde_solve_pp: number; mde_cost_pct: number; power: number };
  cuped?: { variance_reduction_pct: number | null; note?: string };
  by_trait: Record<string, Record<string, TraitLevel>>;
  /** Analyses added after the decision; each key appears when the analysis has written it. */
  secondary?: Record<string, unknown>;
  /** The same estimates for the fresh tier and the pre-cutoff tier alone; reported, not part of the decision. */
  by_tier?: Record<string, TierNumbers>;
  bootstrap_resamples: number;
  posterior_draws: number;
}

export interface IntegrityRun {
  ledger_ok: boolean;
  merkle_root: string;
  task_done_records: number;
  env_snapshots: number;
  env_snapshot_distinct_hashes: number;
  assignment: { checked: number; matched: number; mismatched: number; ok: boolean; flag_engine_version: string; env_sha256: string } | null;
}

export interface Numbers {
  generatedAt: string | null;
  exp1: ExperimentNumbers | null;
  exp2: ExperimentNumbers | null;
  rollout: { n: number; cost_mean: number; solve_rate: number } | null;
  /** Cost and solve rate of every arm on one chart, when the analysis has written it. */
  frontier: unknown;
  spend: { total_usd: number; by_experiment: Record<string, number> } | null;
  integrity: { merkle_root: string; task_done_records: number; by_experiment: Record<string, IntegrityRun>; proofs?: unknown } | null;
}

/** What a run's first environment snapshot says about the experiment flag. */
export interface FlagState {
  run: string;
  takenAt: string | null;
  updatedAt: string | null;
  envSha256: string | null;
  file: string;
  enabled: boolean;
  valueSha256: string | null;
  /** [variant, percentage weight] on the flag itself. */
  variants: [string, number][];
  experimentId: number | null;
  experimentName: string | null;
  /** Segment overrides Flagsmith created for a running experiment. */
  overrides: { variants: [string, number][]; experimentId: number | null; inExperiment: boolean }[];
}

export interface PaperData {
  title: string;
  abstract: Block[];
  conclusion: Block[];
  limits: Block[];
  sections: string[];
  figures: { file: string; caption: string }[];
  hasPdf: boolean;
  hasDeck: boolean;
  pdfBytes: number;
  deckBytes: number;
}

export interface KitData {
  ts: { name: string; version: string; published: boolean; node: string | null } | null;
  py: { name: string | null; script: string | null; python: string | null };
  mcp: { name: string; version: string; published: boolean; description: string; intro: Block[]; node: string | null; blocks: { lang: string; code: string }[]; tools: { name: string; does: string; flagsmith: string }[] } | null;
}

export interface Reference {
  id: string;
  section: string;
  /** "Kapoor et al., 2024" */
  short: string;
  authors: string;
  year: string;
  title: string;
  venue: string;
  url: string;
  /** The note the reference list gives under the entry. */
  note: string;
}

export interface ScaleGroup {
  key: string;
  label: string;
  runs: string[];
  attempts: number;
  tasks: number;
  solved: number;
  tests: number;
  calls: number;
  tokens: number;
  ledger: number;
  transcripts: number;
  events: number;
  envSnapshots: number;
}

/** Counts made from the repository at build time (scripts/scale-data.mjs). */
export interface ScaleData {
  groups: ScaleGroup[];
  totals: {
    runs: number;
    attempts: number;
    tasks: number;
    distinctTasks: number;
    solved: number;
    tests: number;
    calls: number;
    tokens: number;
    ledger: number;
    events: number;
    envSnapshots: number;
    transcripts: number;
    languages: string[];
    languageCount: number;
    repos: number;
  };
  /** Figures that came from the `scale` block of numbers.json rather than from the site's own count. */
  fromNumbers: string[];
  packageCount: number;
  exampleCount: number;
  preregCount: number;
  code: { byLang: { lang: string; files: number; lines: number }[]; files: number; lines: number; tracked: number };
  tests: { python: number; pythonFiles: number; typescript: number; typescriptFiles: number };
  ci: { file: string; jobs: string[] }[];
  examples: string[];
  packages: { name: string; version: string; dir: string }[];
  tags: { prereg: string[]; releases: string[] };
}

export interface RepoData {
  site: { url: string; repo: string; commit: string; commitShort: string };
  figures: Record<string, string>;
  decisions: Record<string, string>;
  hasNumbers: boolean;
  batches: Batch[];
  currentExperiment: BatchId;
  /** Raw values from analysis/out/numbers.json, for figures the site formats itself. */
  numbers: Numbers | null;
  hypothesis2: string;
  prereg2: Record<"start" | "question" | "arms" | "units" | "decisionRule" | "power" | "exclusions" | "stopping" | "before", Block[]>;
  flagStates: { before: FlagState | null; after: FlagState | null };
  paper: PaperData | null;
  kit: KitData;
  releaseTag: string | null;
  scale: ScaleData;
  /** docs/references.md, one entry per source. */
  references: Reference[];
  /** Chart files present in analysis/charts, copied to /figures at build. */
  charts: string[];
  /** Flagsmith dashboard screenshots in docs/img, keyed by name (results, experiments, flags, experiment-2-running). */
  shots: Record<string, { file: string; width: number; height: number }>;
  transcripts: { exp1: number; rollout: number; examples: boolean };
  /** The ledger the verify page fetches, gzipped into the site at build. */
  verifyLedger: { run: string; gzBytes: number } | null;
  power2: { m: number; power: number; sims: number; seed: number; pilot: { n: number; solve_rate: number }; grid: PowerRow[] } | null;
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
