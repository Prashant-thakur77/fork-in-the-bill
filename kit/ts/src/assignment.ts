/**
 * Re-derive the variant an identity gets for a flag from a saved environment document, with no
 * network call, and keep every step of the working.
 *
 * This is the same recomputation as `independent_variant` in `integrity/verify_assignment.py`:
 *
 * 1. the identity's hashing key is `<environment api_key>_<identifier>`;
 * 2. a segment that overrides the flag matches when its `PERCENTAGE_SPLIT` conditions hold, each
 *    one being `hashedPercentage([segment id, key]) <= value`; of the matching overrides the one
 *    with the lowest priority number wins, otherwise the environment's own feature state is used;
 * 3. the multivariate split hashes `[feature state id, key]` and walks the variants in id order,
 *    each taking `percentage_allocation` points of [0, 100); whatever is left is `control`.
 *
 * It covers what an experiment rollout uses. A document that needs more (other segment operators,
 * an identity override of the flag) raises `UnsupportedDocumentError` instead of guessing.
 *
 * The environment key is never copied into the working: hash inputs show `<api_key>` in its place.
 */

import { hashWorking, type HashWorking } from "./bucket.js";

/** The engine's name for the remainder bucket of a multivariate flag. */
export const DEFAULT_VARIANT = "control";
const KEY_PLACEHOLDER = "<api_key>";

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

export class AssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssignmentError";
  }
}

export interface ConditionWorking {
  operator: "PERCENTAGE_SPLIT";
  /** The condition holds when `hash.percentage <= threshold`. */
  threshold: number;
  hash: HashWorking;
  matched: boolean;
}

export interface SegmentWorking {
  id: string;
  name: string | null;
  priority: number | null;
  /** The conditions that were evaluated, in order. Evaluation stops as soon as a rule is decided. */
  conditions: ConditionWorking[];
  matched: boolean;
}

export interface SplitRange {
  variant: string | null;
  /** The variant takes percentages in [start, end). */
  start: number;
  end: number;
  matched: boolean;
}

export interface SplitWorking {
  hash: HashWorking;
  ranges: SplitRange[];
}

export interface ExperimentInfo {
  id: number | null;
  name: string | null;
  inExperiment: boolean;
}

export interface AssignmentWorking {
  flag: string;
  identity: string;
  /** `<api_key>_<identifier>`, with the key left as a placeholder. */
  identityKey: string;
  /** Every segment that overrides the flag, in document order. */
  segments: SegmentWorking[];
  featureState: {
    source: "segment_override" | "environment";
    segment: { id: string; name: string | null } | null;
    /** The id hashed for the split: `django_id`, or `featurestate_uuid` when there is none. */
    id: string;
    enabled: boolean;
    experiment: ExperimentInfo | null;
  };
  /** Null when the chosen feature state has no multivariate values. */
  split: SplitWorking | null;
  /** The variant key, `control` for the remainder, or null for a flag with no variants. */
  variant: string | null;
  /** The value served: the variant's value, or the feature state's own value for the remainder. */
  value: unknown;
}

type Doc = Record<string, unknown>;

function isObj(v: unknown): v is Doc {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function list(v: unknown): Doc[] {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

function featureName(fs: Doc): unknown {
  return isObj(fs["feature"]) ? fs["feature"]["name"] : undefined;
}

function shown(h: HashWorking, apiKey: string): HashWorking {
  return { ...h, input: h.input.split(apiKey).join(KEY_PLACEHOLDER) };
}

function conditionMatches(cond: Doc, segmentId: string, key: string, apiKey: string, out: ConditionWorking[]): boolean {
  const operator = cond["operator"];
  const property = cond["property_"] ?? "";
  if (operator !== "PERCENTAGE_SPLIT" || (property !== "" && property !== "$.identity.key")) {
    throw new UnsupportedDocumentError(
      `segment ${segmentId}: condition ${String(operator)} on ${JSON.stringify(cond["property_"] ?? null)} is not a percentage split of the identity key`,
    );
  }
  const threshold = Number(cond["value"]);
  if (!Number.isFinite(threshold)) {
    throw new AssignmentError(`segment ${segmentId}: PERCENTAGE_SPLIT value ${JSON.stringify(cond["value"])} is not a number`);
  }
  const hash = hashWorking([segmentId, key]);
  const matched = hash.percentage <= threshold;
  out.push({ operator: "PERCENTAGE_SPLIT", threshold, hash: shown(hash, apiKey), matched });
  return matched;
}

function ruleMatches(rule: Doc, segmentId: string, key: string, apiKey: string, out: ConditionWorking[]): boolean {
  const type = rule["type"];
  if (type !== "ALL" && type !== "ANY" && type !== "NONE") {
    throw new UnsupportedDocumentError(`segment ${segmentId}: rule type ${JSON.stringify(type ?? null)}`);
  }
  // Same short-circuiting as Python's all() and any() over a generator.
  const combine = <T>(items: T[], test: (item: T) => boolean): boolean =>
    type === "ALL" ? items.every(test) : type === "ANY" ? items.some(test) : !items.some(test);
  const conds = list(rule["conditions"]);
  const subs = list(rule["rules"]);
  const okConds = conds.length > 0 ? combine(conds, (c) => conditionMatches(c, segmentId, key, apiKey, out)) : true;
  const okSubs = subs.length > 0 ? combine(subs, (r) => ruleMatches(r, segmentId, key, apiKey, out)) : true;
  return okConds && okSubs;
}

function experimentOf(fs: Doc): ExperimentInfo | null {
  const meta = fs["metadata"];
  const exp = isObj(meta) ? meta["experiment"] : undefined;
  if (!isObj(exp)) return null;
  return {
    id: typeof exp["id"] === "number" ? exp["id"] : null,
    name: typeof exp["name"] === "string" ? exp["name"] : null,
    inExperiment: Boolean(exp["in_experiment"]),
  };
}

/** Sort key of a multivariate value: its id, or its uuid read as an integer. */
function mvOrder(mv: Doc): bigint {
  const id = mv["id"];
  if (typeof id === "number" && id !== 0) return BigInt(id);
  const uuid = mv["mv_fs_value_uuid"];
  if (typeof uuid !== "string") throw new AssignmentError("a multivariate value has neither an id nor a uuid");
  return BigInt(`0x${uuid.replaceAll("-", "")}`);
}

/**
 * The variant `identifier` gets for `flag` under `document` (a parsed Flagsmith environment
 * document), with the working. Throws `AssignmentError` when the document cannot answer and
 * `UnsupportedDocumentError` when it needs rules this recomputation does not cover.
 */
export function explainAssignment(document: unknown, identifier: string, flag = "agent_routing"): AssignmentWorking {
  if (!isObj(document)) throw new AssignmentError("the environment document is not a JSON object");
  if (!identifier) throw new AssignmentError("identity must be a non-empty identifier");
  const apiKey = document["api_key"];
  if (typeof apiKey !== "string" || apiKey === "") {
    throw new AssignmentError("the environment document has no api_key, so the identity's hashing key cannot be built");
  }
  if (document["use_identity_composite_key_for_hashing"] === false) {
    throw new UnsupportedDocumentError(
      "the environment hashes on identity database ids, which an offline check cannot recompute",
    );
  }
  const key = `${apiKey}_${identifier}`;

  for (const override of list(document["identity_overrides"])) {
    if (override["identifier"] !== identifier) continue;
    if (list(override["identity_features"]).some((fs) => featureName(fs) === flag)) {
      throw new UnsupportedDocumentError(`identity override of ${flag} for ${identifier}`);
    }
  }

  const segments: SegmentWorking[] = [];
  let chosen: Doc | null = null;
  let chosenSegment: { id: string; name: string | null } | null = null;
  let best = Number.POSITIVE_INFINITY;
  const project = isObj(document["project"]) ? document["project"] : {};
  for (const seg of list(project["segments"])) {
    const overrides = list(seg["feature_states"]).filter((fs) => featureName(fs) === flag);
    if (overrides.length === 0) continue;
    const segmentId = String(seg["id"]);
    const name = typeof seg["name"] === "string" ? seg["name"] : null;
    const rules = list(seg["rules"]);
    const conditions: ConditionWorking[] = [];
    const matched = rules.length > 0 && rules.every((r) => ruleMatches(r, segmentId, key, apiKey, conditions));
    let lowest: number | null = null;
    for (const fs of overrides) {
      const featureSegment = isObj(fs["feature_segment"]) ? fs["feature_segment"] : {};
      const raw = featureSegment["priority"];
      const priority = typeof raw === "number" ? raw : Number.POSITIVE_INFINITY;
      if (Number.isFinite(priority) && (lowest === null || priority < lowest)) lowest = priority;
      if (matched && (chosen === null || priority < best)) {
        chosen = fs;
        chosenSegment = { id: segmentId, name };
        best = priority;
      }
    }
    segments.push({ id: segmentId, name, priority: lowest, conditions, matched });
  }

  let source: "segment_override" | "environment" = "segment_override";
  if (chosen === null) {
    source = "environment";
    chosen = list(document["feature_states"]).find((fs) => featureName(fs) === flag) ?? null;
    if (chosen === null) throw new AssignmentError(`${flag} is not in the environment document`);
  }
  const fs: Doc = chosen;

  const rawId = fs["django_id"] || fs["featurestate_uuid"];
  if (rawId === undefined || rawId === null || rawId === "") {
    throw new AssignmentError(`the feature state of ${flag} has neither a django_id nor a featurestate_uuid`);
  }
  const fsId = String(rawId);
  const mvs = list(fs["multivariate_feature_state_values"]);

  let split: SplitWorking | null = null;
  let variant: string | null = null;
  let value: unknown = fs["feature_state_value"];
  if (mvs.length > 0) {
    const hash = hashWorking([fsId, key]);
    const ordered = mvs
      .map((mv) => ({ mv, order: mvOrder(mv) }))
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    const ranges: SplitRange[] = [];
    variant = DEFAULT_VARIANT;
    let start = 0;
    let found = false;
    for (const { mv } of ordered) {
      const option = isObj(mv["multivariate_feature_option"]) ? mv["multivariate_feature_option"] : {};
      const end = start + Number(mv["percentage_allocation"]);
      const matched = !found && start <= hash.percentage && hash.percentage < end;
      const optionKey = typeof option["key"] === "string" ? option["key"] : null;
      ranges.push({ variant: optionKey, start, end, matched });
      if (matched) {
        found = true;
        variant = optionKey;
        value = option["value"];
      }
      start = end;
    }
    ranges.push({ variant: DEFAULT_VARIANT, start, end: 100, matched: !found });
    split = { hash: shown(hash, apiKey), ranges };
  }

  return {
    flag,
    identity: identifier,
    identityKey: `${KEY_PLACEHOLDER}_${identifier}`,
    segments,
    featureState: {
      source,
      segment: source === "segment_override" ? chosenSegment : null,
      id: fsId,
      enabled: fs["enabled"] === true,
      experiment: experimentOf(fs),
    },
    split,
    variant,
    value,
  };
}
