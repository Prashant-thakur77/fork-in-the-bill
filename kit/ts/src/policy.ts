/**
 * The routing policy stored as the JSON value of each variation of the routing flag.
 * Same rules as the Python kit's `forkbill.policy.RoutingPolicy` (pydantic, extra keys forbidden).
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type PromptVariant = "delegate_v1" | "draft_review_v1";

export interface MainLane {
  model: string;
  max_tokens: number;
  cache: boolean;
  effort: Effort;
}

export interface DelegateLane {
  model: string;
  max_tokens: number;
  max_context_tokens: number;
  effort: Effort;
}

export interface Caps {
  turns: number;
  usd_per_task: number;
  seconds: number;
}

export interface RoutingPolicy {
  policy: string;
  schema: 1;
  main: MainLane;
  delegate: DelegateLane;
  caps: Caps;
  prompt_variant: PromptVariant;
}

export class PolicyValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid routing policy: ${problems.join("; ")}`);
    this.name = "PolicyValidationError";
  }
}

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
const PROMPT_VARIANTS: readonly PromptVariant[] = ["delegate_v1", "draft_review_v1"];
const MAX_TOKENS = 128_000;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

class Checker {
  readonly problems: string[] = [];

  object(v: unknown, path: string, allowed: readonly string[]): Obj {
    if (!isObj(v)) {
      this.problems.push(`${path}: expected an object`);
      return {};
    }
    for (const k of Object.keys(v)) {
      if (!allowed.includes(k)) this.problems.push(`${path}.${k}: extra field not permitted`);
    }
    return v;
  }

  str(o: Obj, key: string, path: string): string {
    const v = o[key];
    if (typeof v !== "string") {
      this.problems.push(`${path}.${key}: expected a string`);
      return "";
    }
    return v;
  }

  int(o: Obj, key: string, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
    const v = o[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      this.problems.push(`${path}.${key}: expected an integer in [${min}, ${max}]`);
      return min;
    }
    return v;
  }

  positive(o: Obj, key: string, path: string): number {
    const v = o[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      this.problems.push(`${path}.${key}: expected a number > 0`);
      return 1;
    }
    return v;
  }

  choice<T extends string>(o: Obj, key: string, path: string, options: readonly T[], dflt: T): T {
    if (!(key in o)) return dflt;
    const v = o[key];
    if (typeof v !== "string" || !(options as readonly string[]).includes(v)) {
      this.problems.push(`${path}.${key}: expected one of ${options.join(", ")}`);
      return dflt;
    }
    return v as T;
  }

  bool(o: Obj, key: string, path: string, dflt: boolean): boolean {
    if (!(key in o)) return dflt;
    const v = o[key];
    if (typeof v !== "boolean") {
      this.problems.push(`${path}.${key}: expected a boolean`);
      return dflt;
    }
    return v;
  }
}

/** Validate a flag value (JSON string or parsed object) as a RoutingPolicy. Throws on failure. */
export function parsePolicy(value: unknown): RoutingPolicy {
  let doc: unknown = value;
  if (typeof value === "string") {
    try {
      doc = JSON.parse(value);
    } catch (err) {
      throw new PolicyValidationError([`not JSON: ${(err as Error).message}`]);
    }
  }
  const c = new Checker();
  const root = c.object(doc, "$", ["policy", "schema", "main", "delegate", "caps", "prompt_variant"]);
  const policy = c.str(root, "policy", "$");
  if (root["schema"] !== 1) c.problems.push("$.schema: expected 1");
  const m = c.object(root["main"], "$.main", ["model", "max_tokens", "cache", "effort"]);
  const d = c.object(root["delegate"], "$.delegate", ["model", "max_tokens", "max_context_tokens", "effort"]);
  const k = c.object(root["caps"], "$.caps", ["turns", "usd_per_task", "seconds"]);
  const result: RoutingPolicy = {
    policy,
    schema: 1,
    main: {
      model: c.str(m, "model", "$.main"),
      max_tokens: c.int(m, "max_tokens", "$.main", 1, MAX_TOKENS),
      cache: c.bool(m, "cache", "$.main", true),
      effort: c.choice(m, "effort", "$.main", EFFORTS, "medium"),
    },
    delegate: {
      model: c.str(d, "model", "$.delegate"),
      max_tokens: c.int(d, "max_tokens", "$.delegate", 1, MAX_TOKENS),
      max_context_tokens: c.int(d, "max_context_tokens", "$.delegate", 1),
      effort: c.choice(d, "effort", "$.delegate", EFFORTS, "low"),
    },
    caps: {
      turns: c.int(k, "turns", "$.caps", 1),
      usd_per_task: c.positive(k, "usd_per_task", "$.caps"),
      seconds: c.int(k, "seconds", "$.caps", 1),
    },
    prompt_variant: c.choice(root, "prompt_variant", "$", PROMPT_VARIANTS, "delegate_v1"),
  };
  if (c.problems.length > 0) throw new PolicyValidationError(c.problems);
  return result;
}
