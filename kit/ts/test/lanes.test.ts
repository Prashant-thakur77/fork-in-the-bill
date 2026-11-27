import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Flagsmith } from "@flagsmith/nodejs";

import {
  parsePolicy,
  PolicyError,
  RoutedLanes,
  sendTaskEvents,
  TablePricing,
  taskEvents,
  usageFromAnthropic,
  type FlagLike,
  type FlagsLike,
  type FlagsmithLike,
  type Logger,
} from "../src/index.js";

// dist/test/ -> repository root
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const POLICIES = join(ROOT, "flagsmith", "policies");
const CONTROL = readFileSync(join(POLICIES, "control.json"), "utf8");
const LANES_V1 = readFileSync(join(POLICIES, "lanes_v1.json"), "utf8");
const LANES_V2 = readFileSync(join(POLICIES, "lanes_v2.json"), "utf8");

const PRICING = new TablePricing({
  models: {
    "claude-sonnet-5-5": { input: 3, output: 15, cache_write_5m: 3.75, cache_read: 0.3 },
    "claude-haiku-5-5": { input: 1, output: 5 },
  },
});

// The real client must satisfy the interface the kit is written against.
function _clientIsCompatible(c: Flagsmith): FlagsmithLike {
  return c;
}
void _clientIsCompatible;

const silent: Logger & { errors: string[] } = {
  errors: [],
  warn: () => undefined,
  error(m: string) {
    this.errors.push(m);
  },
};

class FakeFlagsmith implements FlagsmithLike {
  exposures: Array<[string, string]> = [];
  buffered: Array<[string, string | undefined, unknown]> = [];
  delivered: Array<[string, string | undefined, unknown]> = [];
  calls: string[] = [];
  flushes = 0;

  constructor(
    private readonly control: string | null,
    private readonly variants: Record<string, string>,
    private readonly opts: { running?: boolean; killed?: boolean; failOn?: string } = {},
  ) {}

  assign(id: string): string {
    const keys = ["control", ...Object.keys(this.variants).sort()];
    const n = BigInt("0x" + createHash("sha256").update(id).digest("hex"));
    return keys[Number(n % BigInt(keys.length))] ?? "control";
  }

  private routing(id: string): FlagLike {
    if (this.control === null) return { enabled: false, value: null, isDefault: true };
    if (this.opts.running === false) return { enabled: true, value: this.control };
    const key = this.assign(id);
    return {
      enabled: true,
      value: key === "control" ? this.control : (this.variants[key] ?? null),
      variant: key,
      experiment: { id: 1, name: "fake", inExperiment: true },
    };
  }

  private flags(map: Record<string, FlagLike>): FlagsLike {
    return { getFlag: (name) => map[name] ?? { enabled: false, value: null, isDefault: true } };
  }

  async getIdentityFlags(id: string): Promise<FlagsLike> {
    this.calls.push(`getIdentityFlags:${id}`);
    return this.flags({ agent_routing: this.routing(id), routing_kill: { enabled: !!this.opts.killed, value: null } });
  }

  async getEnvironmentFlags(): Promise<FlagsLike> {
    this.calls.push("getEnvironmentFlags");
    return this.flags({ agent_routing: { enabled: true, value: this.control } });
  }

  async getExperimentFlag(name: string, id: string): Promise<FlagLike> {
    this.calls.push(`getExperimentFlag:${id}`);
    if (this.opts.failOn === "getExperimentFlag") throw new Error("fake API unavailable");
    const f = this.routing(id);
    if (f.enabled && f.experiment?.inExperiment && f.variant) this.exposures.push([name, id]);
    return f;
  }

  trackEvent(event: string, opts?: { identifier?: string; value?: string | number | boolean | null }): void {
    assert.equal(this.buffered.length, 0, "previous event still buffered: a 1-item buffer would drop it");
    this.buffered.push([event, opts?.identifier, opts?.value]);
  }

  async flushEvents(): Promise<void> {
    this.flushes += 1;
    this.delivered.push(...this.buffered);
    this.buffered = [];
  }
}

function idFor(c: FakeFlagsmith, variant: string): string {
  for (let i = 0; i < 1000; i++) if (c.assign(`t:${i}`) === variant) return `t:${i}`;
  throw new Error("no identity");
}

test("exposed variant: policy, exposure, events, flushes", async () => {
  const c = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 });
  const id = idFor(c, "lanes_v1");
  const lanes = await RoutedLanes.create({ flagsmith: c, identity: id, pricing: PRICING, logger: silent });
  assert.equal(lanes.flagSource, "experiment");
  assert.equal(lanes.variant, "lanes_v1");
  assert.deepEqual([lanes.mainModel, lanes.delegateModel], ["claude-sonnet-5-5", "claude-haiku-5-5"]);
  assert.deepEqual(c.calls, [`getIdentityFlags:${id}`, `getExperimentFlag:${id}`]);
  assert.equal(lanes.recordCall("main", { inputTokens: 1_000_000 }), 3);
  assert.equal(lanes.recordCall("delegate", { outputTokens: 1_000_000 }), 5);
  const r = await lanes.finish(true, 7, 12.5);
  assert.equal(r.usd, 8);
  assert.deepEqual(c.delivered, [
    ["task_cost", id, 8],
    ["task_solved", id, 1],
    ["task_turns", id, 7],
    ["task_seconds", id, 12.5],
  ]);
  assert.equal(c.flushes, 5);
});

test("unsolved sends no task_solved", async () => {
  const c = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 });
  const lanes = await RoutedLanes.create({ flagsmith: c, identity: idFor(c, "control"), pricing: PRICING });
  assert.equal(lanes.delegateModel, "claude-sonnet-5-5");
  await lanes.finish(false, 3, 1);
  assert.deepEqual(c.delivered.map((e) => e[0]), ["task_cost", "task_turns", "task_seconds"]);
});

test("kill switch: control, no exposure, no events", async () => {
  const c = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 }, { killed: true });
  const lanes = await RoutedLanes.create({ flagsmith: c, identity: idFor(c, "lanes_v1"), pricing: PRICING, logger: silent });
  assert.equal(lanes.flagSource, "kill_switch");
  assert.equal(lanes.policy.policy, "control");
  assert.deepEqual(c.exposures, []);
  await lanes.finish(true, 1, 1);
  assert.deepEqual(c.delivered, []);
});

test("invalid JSON fails closed to control and logs", async () => {
  const c = new FakeFlagsmith(CONTROL, { lanes_v1: '{"policy": "broken"' });
  const log = { ...silent, errors: [] as string[] };
  const lanes = await RoutedLanes.create({ flagsmith: c, identity: idFor(c, "lanes_v1"), pricing: PRICING, logger: log });
  assert.equal(lanes.flagSource, "fail_closed");
  assert.equal(lanes.policy.policy, "control");
  assert.ok(lanes.exposed);
  assert.match(log.errors[0] ?? "", /fails closed/);
});

test("API failure fails closed to explicit control", async () => {
  const c = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 }, { failOn: "getExperimentFlag" });
  const lanes = await RoutedLanes.create({ flagsmith: c, identity: "t:x", pricing: PRICING, control: LANES_V1, logger: silent });
  assert.equal(lanes.flagSource, "fail_closed");
  assert.equal(lanes.policy.policy, "lanes_v1");
  assert.ok(!c.calls.includes("getEnvironmentFlags"));
});

test("missing flag and no valid control throws PolicyError", async () => {
  const c = new FakeFlagsmith(null, {});
  await assert.rejects(RoutedLanes.create({ flagsmith: c, identity: "t:1", pricing: PRICING, logger: silent }), PolicyError);
});

test("no running experiment: flag value, no events unless emitUnexposed", async () => {
  const c = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 }, { running: false });
  const lanes = await RoutedLanes.create({ flagsmith: c, identity: "t:1", pricing: PRICING });
  assert.equal(lanes.flagSource, "flag");
  await lanes.finish(true, 1, 1);
  assert.deepEqual(c.delivered, []);
  const seen: string[] = [];
  const l2 = await RoutedLanes.create({
    flagsmith: c, identity: "t:2", pricing: PRICING, emitUnexposed: true, onEvent: (_i, e) => seen.push(e),
  });
  await l2.finish(false, 1, 1);
  assert.deepEqual(seen, ["task_cost", "task_turns", "task_seconds"]);
});

test("budget cap and double finish", async () => {
  const c = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 });
  const lanes = await RoutedLanes.create({ flagsmith: c, identity: "t:1", pricing: PRICING });
  lanes.recordCall("main", { outputTokens: 40_000 });
  assert.ok(lanes.overBudget);
  await lanes.finish(false, 1, 1);
  await assert.rejects(lanes.finish(false, 1, 1));
  assert.throws(() => lanes.recordCall("main", {}));
});

test("policy validation matches the Python schema rules", () => {
  for (const raw of [CONTROL, LANES_V1, LANES_V2]) parsePolicy(raw);
  const base = (): Record<string, any> => JSON.parse(CONTROL);
  const accept = [
    (d: any) => { d.main.effort = "max"; },
    (d: any) => { delete d.prompt_variant; },
    (d: any) => { delete d.main.cache; },
  ];
  const reject = [
    (d: any) => { d.schema = 2; },
    (d: any) => { delete d.schema; },
    (d: any) => { d.extra = 1; },
    (d: any) => { d.main.max_tokens = 0; },
    (d: any) => { d.main.max_tokens = 128_001; },
    (d: any) => { d.delegate.max_context_tokens = 0; },
    (d: any) => { d.delegate.effort = "turbo"; },
    (d: any) => { d.caps.usd_per_task = 0; },
    (d: any) => { d.caps.turns = -1; },
    (d: any) => { d.prompt_variant = "other"; },
    (d: any) => { delete d.delegate; },
    (d: any) => { d.main.model = 5; },
  ];
  for (const f of accept) { const d = base(); f(d); parsePolicy(d); }
  for (const f of reject) { const d = base(); f(d); assert.throws(() => parsePolicy(d), f.toString()); }
});

test("onFailure throw: no policy is substituted and the cause is kept", async () => {
  const down = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 }, { failOn: "getExperimentFlag" });
  await assert.rejects(
    RoutedLanes.create({ flagsmith: down, identity: "t:x", pricing: PRICING, onFailure: "throw", logger: silent }),
    (err: unknown) => {
      assert.ok(err instanceof PolicyError);
      assert.equal(err.message, 'flag "agent_routing" unreadable: fake API unavailable');
      assert.equal((err.cause as Error).message, "fake API unavailable");
      return true;
    },
  );
  assert.ok(!down.calls.includes("getEnvironmentFlags"));

  const broken = new FakeFlagsmith(CONTROL, { lanes_v1: '{"policy": "broken"' });
  await assert.rejects(
    RoutedLanes.create({
      flagsmith: broken, identity: idFor(broken, "lanes_v1"), pricing: PRICING, onFailure: "throw", logger: silent,
    }),
    /value is not a valid policy/,
  );

  const killed = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 }, { killed: true });
  const lanes = await RoutedLanes.create({
    flagsmith: killed, identity: "t:1", pricing: PRICING, onFailure: "throw", logger: silent,
  });
  assert.equal(lanes.flagSource, "kill_switch");
  assert.equal(lanes.policy.policy, "control");
});

test("sendTaskEvents sends what finish sends", async () => {
  assert.deepEqual(taskEvents({ usd: 0.1234567, solved: false, turns: 3, seconds: 1.23456 }), [
    ["task_cost", 0.123457],
    ["task_turns", 3],
    ["task_seconds", 1.235],
  ]);
  const c = new FakeFlagsmith(CONTROL, { lanes_v1: LANES_V1 });
  const seen: string[] = [];
  const sent = await sendTaskEvents(c, "t:9", { usd: 8, solved: true, turns: 7, seconds: 12.5 }, (_i, e) => seen.push(e));
  assert.deepEqual(sent, [["task_cost", 8], ["task_solved", 1], ["task_turns", 7], ["task_seconds", 12.5]]);
  assert.deepEqual(c.delivered, [
    ["task_cost", "t:9", 8],
    ["task_solved", "t:9", 1],
    ["task_turns", "t:9", 7],
    ["task_seconds", "t:9", 12.5],
  ]);
  assert.equal(c.flushes, 4);
  assert.deepEqual(seen, ["task_cost", "task_solved", "task_turns", "task_seconds"]);
});

test("usageFromAnthropic", () => {
  assert.deepEqual(
    usageFromAnthropic({
      input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30,
      cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 50 },
    }),
    { inputTokens: 10, outputTokens: 20, cacheWrite5mTokens: 40, cacheWrite1hTokens: 50, cacheReadTokens: 30 },
  );
});
