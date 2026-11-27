// Flag history from the worker (GET /flags/history, /stream "flags" event) and how the board reads it.
// Records hold no names, emails or raw values; see board/worker/src/flags.ts.

export interface Weight {
  option_id: number;
  pct: number;
}

export interface FlagChange {
  id: number;
  at: number;
  received_at: number;
  source: "flag" | "audit";
  event_type: string;
  feature: string | null;
  environment: string | null;
  scope: "environment" | "segment" | "identity" | null;
  segment: string | null;
  enabled_before: boolean | null;
  enabled_after: boolean | null;
  weights_before: Weight[] | null;
  weights_after: Weight[] | null;
  value_sha256_before: string | null;
  value_sha256_after: string | null;
}

export const EXPERIMENT_FLAG = "agent_routing";

/** Multivariate option ids of agent_routing, as in flagsmith/ids.json (checked by a test). */
export const VARIANT_OPTIONS: Record<number, string> = { 37431: "lanes_v1" };

/** Webhooks from one save (flag state + audit log) land within this many seconds of each other. */
export const SAME_SAVE_SECONDS = 60;

export type Kind = "start" | "end" | "rollout" | "change" | "noop" | "audit";

export interface Described {
  kind: Kind;
  label: string;
  detail: string;
}

const split = (w: Weight[] | null): number | null => (w ? w.reduce((s, x) => s + x.pct, 0) : null);
const trim = (n: number) => String(Math.round(n * 10) / 10);

/** "control 50 · lanes_v1 50": the control share is what the options leave over. */
export function splitText(w: Weight[] | null): string {
  const used = split(w) ?? 0;
  const parts = [`control ${trim(Math.max(0, 100 - used))}`];
  for (const x of w ?? []) parts.push(`${VARIANT_OPTIONS[x.option_id] ?? `option ${x.option_id}`} ${trim(x.pct)}`);
  return parts.join(" · ");
}

const sameWeights = (a: Weight[] | null, b: Weight[] | null) =>
  JSON.stringify((a ?? []).filter((x) => x.pct > 0)) === JSON.stringify((b ?? []).filter((x) => x.pct > 0));

function scopeText(c: FlagChange): string {
  if (c.scope === "segment") return c.segment ? `segment ${c.segment}` : "segment override";
  if (c.scope === "identity") return "identity override";
  return "";
}

function auditLabel(eventType: string): string {
  const what = eventType.replace(/^AUDIT_/, "").replace(/_/g, " ").toLowerCase();
  return `Audit log: ${what || "entry"}`;
}

export function describe(c: FlagChange): Described {
  const where = [c.environment, scopeText(c)].filter(Boolean).join(" · ");
  const join = (...xs: string[]) => xs.filter(Boolean).join(" · ");
  if (c.source === "audit") return { kind: "audit", label: auditLabel(c.event_type), detail: where };
  if (c.event_type === "FLAG_DELETED") return { kind: "change", label: "Flag deleted", detail: where };

  const before = split(c.weights_before) ?? 0;
  const after = split(c.weights_after) ?? 0;
  const scoped = c.scope === "segment" || c.scope === "identity";
  if (c.enabled_before !== null && c.enabled_after !== null && c.enabled_before !== c.enabled_after) {
    return { kind: "change", label: c.enabled_after ? "Flag switched on" : "Flag switched off", detail: where };
  }
  if (!sameWeights(c.weights_before, c.weights_after)) {
    const detail = join(splitText(c.weights_after), where);
    if (!scoped && before === 0 && after > 0 && after < 100) return { kind: "start", label: "Experiment started", detail };
    if (!scoped && before > 0 && before < 100 && after >= 100) {
      const winner = c.weights_after?.find((x) => x.pct >= 100);
      const name = winner ? (VARIANT_OPTIONS[winner.option_id] ?? `option ${winner.option_id}`) : "one variant";
      return { kind: "rollout", label: `Rolled out: ${name}`, detail };
    }
    if (!scoped && before > 0 && after === 0) return { kind: "end", label: "Split ended: all on control", detail };
    return { kind: "change", label: "Split changed", detail };
  }
  if (c.value_sha256_before !== c.value_sha256_after && c.value_sha256_before && c.value_sha256_after) {
    return { kind: "change", label: "Control value changed", detail: join(`sha256 ${c.value_sha256_after.slice(0, 8)}`, where) };
  }
  return { kind: "noop", label: "Saved, nothing changed", detail: where };
}

export interface Timeline {
  rows: { change: FlagChange; d: Described; during: boolean }[];
  start: FlagChange | null;
  end: FlagChange | null;
  /** Changes that took effect inside the run window (start and end excluded). */
  during: number;
  summary: string;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Finds the run window (last start, then the first end or rollout after it) and what changed inside it. */
export function timeline(changes: FlagChange[] | null): Timeline {
  const list = [...(changes ?? [])].sort((a, b) => a.at - b.at || a.id - b.id);
  const ds = list.map((c) => ({ change: c, d: describe(c) }));
  const startIdx = ds.map((x) => x.d.kind).lastIndexOf("start");
  const start = startIdx >= 0 ? ds[startIdx]!.change : null;
  const endRow = startIdx >= 0 ? ds.slice(startIdx + 1).find((x) => x.d.kind === "end" || x.d.kind === "rollout") : undefined;
  const end = endRow?.change ?? null;
  const flagSaves = list.filter((c) => c.source === "flag");

  const inWindow = (c: FlagChange) => !!start && c !== start && c !== end && c.at >= start.at && (!end || c.at <= end.at);
  const rows = ds.map(({ change, d }) => {
    let during = false;
    if (inWindow(change)) {
      if (d.kind === "audit") {
        // An audit entry counts only when no flag-state webhook explains it (the same save sends both).
        during = !flagSaves.some((f) => Math.abs(f.at - change.at) <= SAME_SAVE_SECONDS);
      } else {
        during = d.kind !== "noop";
      }
    }
    return { change, d, during };
  });
  const during = rows.filter((r) => r.during).length;

  let summary: string;
  if (changes === null) summary = "Posts when Flagsmith reports a change to the flag.";
  else if (!list.length) summary = "No flag changes recorded yet.";
  else if (!start) summary = "No experiment start recorded yet.";
  else if (!end) summary = during ? `${plural(during, "change")} since the run started.` : "No changes since the run started.";
  else summary = during ? `${plural(during, "change")} during the run.` : "No changes during the run.";

  return { rows, start, end, during, summary };
}

/** "2027-01-15 08:00 UTC" */
export function utcMinute(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
