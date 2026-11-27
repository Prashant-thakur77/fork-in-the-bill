// Flagsmith webhook payloads -> the privacy-safe flag change record kept in D1.
//
// Two shapes arrive on POST /flagsmith/webhook:
//   environment webhook: {"event_type": "FLAG_UPDATED", "data": {changed_by, timestamp, new_state, previous_state}}
//   audit-log webhook:   {created_date, log, author, environment, project, related_object_id,
//                         related_object_uuid, related_object_type}
//
// Only what the board needs is kept. Never kept: changed_by, author, identity identifiers, the audit log
// text (it can name identities) and raw flag values (they hold routing policies). Values are kept as
// sha256 digests: of the string itself for string values, of JSON.stringify(value) otherwise.

import { sha256Hex } from "./hmac";

export interface Weight {
  /** Flagsmith multivariate option id; option values are never stored. */
  option_id: number;
  pct: number;
}

export type Scope = "environment" | "segment" | "identity";

export interface FlagChange {
  /** Unix seconds of the change, from the payload (falls back to receipt time). */
  at: number;
  source: "flag" | "audit";
  event_type: string;
  feature: string | null;
  environment: string | null;
  scope: Scope | null;
  segment: string | null;
  enabled_before: boolean | null;
  enabled_after: boolean | null;
  weights_before: Weight[] | null;
  weights_after: Weight[] | null;
  value_sha256_before: string | null;
  value_sha256_after: string | null;
}

/** A stored change, as served by GET /flags/history and the /stream "flags" event. */
export interface StoredFlagChange extends FlagChange {
  id: number;
  received_at: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const FEATURE_NAME = /^[A-Za-z0-9_.-]{1,150}$/;
const EVENT_TYPE = /^[A-Z_]{1,40}$/;

/** A short label from user-chosen text (environment or segment name): printable, trimmed, capped. */
function label(v: unknown, max = 100): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return s || null;
}

function featureName(v: unknown): string | null {
  return typeof v === "string" && FEATURE_NAME.test(v) ? v : null;
}

function unixSeconds(v: unknown, fallback: number): number {
  if (typeof v !== "string") return fallback;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : fallback;
}

async function valueDigest(v: unknown): Promise<string | null> {
  if (v === null || v === undefined) return null;
  return sha256Hex(typeof v === "string" ? v : JSON.stringify(v));
}

function weights(v: unknown): Weight[] | null {
  if (!Array.isArray(v)) return null;
  const out: Weight[] = [];
  for (const mv of v.slice(0, 20)) {
    if (!isObj(mv)) continue;
    const opt = mv.multivariate_feature_option;
    const id = isObj(opt) ? opt.id : opt;
    const pct = mv.percentage_allocation;
    if (!Number.isInteger(id) || typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    out.push({ option_id: id as number, pct });
  }
  return out.sort((a, b) => a.option_id - b.option_id);
}

function segmentOf(fs: unknown): string | null {
  if (!isObj(fs)) return null;
  const seg = fs.segment;
  if (isObj(seg)) return label(seg.name) ?? (Number.isInteger(seg.id) ? `segment ${seg.id}` : "segment");
  if (Number.isInteger(seg)) return `segment ${seg}`;
  return label(fs.segment_name) ?? "segment";
}

interface StateView {
  enabled: boolean | null;
  environment: string | null;
  feature: string | null;
  scope: Scope;
  segment: string | null;
  weights: Weight[] | null;
  value: string | null;
}

async function stateView(s: unknown): Promise<StateView | null> {
  if (!isObj(s)) return null;
  const segment = segmentOf(s.feature_segment);
  const identity = s.identity !== null && s.identity !== undefined;
  const hasIdentifier = s.identity_identifier !== null && s.identity_identifier !== undefined;
  return {
    enabled: typeof s.enabled === "boolean" ? s.enabled : null,
    environment: isObj(s.environment) ? label(s.environment.name) : null,
    feature: isObj(s.feature) ? featureName(s.feature.name) : null,
    scope: identity || hasIdentifier ? "identity" : segment ? "segment" : "environment",
    segment,
    weights: weights(s.multivariate_feature_state_values),
    value: await valueDigest(s.feature_state_value),
  };
}

async function fromEnvironmentWebhook(raw: Obj, nowS: number): Promise<FlagChange | string> {
  const eventType = raw.event_type;
  if (typeof eventType !== "string" || !EVENT_TYPE.test(eventType)) return "bad event_type";
  const data = raw.data;
  if (!isObj(data)) return "bad data";
  const after = await stateView(data.new_state);
  const before = await stateView(data.previous_state);
  const main = after ?? before;
  if (!main) return "no flag state";
  return {
    at: unixSeconds(data.timestamp, nowS),
    source: "flag",
    event_type: eventType,
    feature: main.feature,
    environment: main.environment,
    scope: main.scope,
    segment: main.segment,
    enabled_before: before?.enabled ?? null,
    enabled_after: after?.enabled ?? null,
    weights_before: before?.weights ?? null,
    weights_after: after?.weights ?? null,
    value_sha256_before: before?.value ?? null,
    value_sha256_after: after?.value ?? null,
  };
}

/** Pulls the feature name out of an audit log line without keeping the line itself. */
function featureFromLog(log: unknown, type: string): string | null {
  if (typeof log !== "string") return null;
  const m = /\bfeature\b[\s:]*['"]?([A-Za-z0-9_.-]+)/i.exec(log);
  if (m) return featureName(m[1]);
  if (type === "FEATURE") {
    const tail = /:\s*['"]?([A-Za-z0-9_.-]+)['"]?\s*$/.exec(log);
    if (tail) return featureName(tail[1]);
  }
  return null;
}

function fromAuditWebhook(raw: Obj, nowS: number): FlagChange | string {
  const type = raw.related_object_type;
  if (typeof type !== "string" || !EVENT_TYPE.test(type)) return "bad related_object_type";
  return {
    at: unixSeconds(raw.created_date, nowS),
    source: "audit",
    event_type: `AUDIT_${type}`.slice(0, 40),
    feature: featureFromLog(raw.log, type),
    environment: isObj(raw.environment) ? label(raw.environment.name) : null,
    scope: type.includes("IDENTITY") ? "identity" : type === "SEGMENT" ? "segment" : null,
    segment: null,
    enabled_before: null,
    enabled_after: null,
    weights_before: null,
    weights_after: null,
    value_sha256_before: null,
    value_sha256_after: null,
  };
}

/** Validates a webhook body and reduces it to the record kept in D1, or returns an error message. */
export async function parseFlagWebhook(
  raw: unknown,
  nowS: number,
): Promise<{ ok: true; value: FlagChange } | { ok: false; error: string }> {
  if (!isObj(raw)) return { ok: false, error: "body must be an object" };
  const r =
    "event_type" in raw
      ? await fromEnvironmentWebhook(raw, nowS)
      : "related_object_type" in raw
        ? fromAuditWebhook(raw, nowS)
        : "unknown webhook shape";
  return typeof r === "string" ? { ok: false, error: r } : { ok: true, value: r };
}

/** Key for replay detection: the digest of the stored record, so nothing links back to the raw body. */
export function dedupeKey(change: FlagChange): Promise<string> {
  return sha256Hex(JSON.stringify(change));
}
