/**
 * RoutedLanes for Node agent loops, with the same behaviour as the Python kit's
 * `forkbill.RoutedLanes`:
 *
 * 1. the kill switch flag is read with `getIdentityFlags` (no exposure); when on, the control
 *    policy is used and no exposure is recorded;
 * 2. otherwise the routing flag is read once with `getExperimentFlag`, which records the exposure
 *    (value = variant key) when the identity is in a running experiment;
 * 3. the value is validated as a RoutingPolicy; an invalid or missing value fails closed to the
 *    control policy, with the reason logged. With `onFailure: "throw"` nothing is substituted:
 *    `create` rejects with a `PolicyError` that carries the reason.
 *
 * `finish(solved, turns, seconds)` sends `task_cost`, `task_solved` (only when solved),
 * `task_turns` and `task_seconds` with the exposure's identifier. The exposure and every event
 * are flushed as soon as they are tracked: a small `maxBuffer` would otherwise drop the oldest.
 * `sendTaskEvents` sends the same four events for a caller that keeps its own totals.
 */

import { parsePolicy, type RoutingPolicy } from "./policy.js";
import { totalTokens, type Pricing, type Usage } from "./pricing.js";

export const EVENT_COST = "task_cost";
export const EVENT_SOLVED = "task_solved";
export const EVENT_TURNS = "task_turns";
export const EVENT_SECONDS = "task_seconds";

export type Lane = "main" | "delegate";
export type FlagSource = "experiment" | "flag" | "kill_switch" | "fail_closed";
type EventValue = string | number | boolean | null;

/** The parts of a `@flagsmith/nodejs` Flag / DefaultFlag the kit reads. */
export interface FlagLike {
  enabled: boolean;
  value: string | number | boolean | null | undefined;
  isDefault?: boolean;
  variant?: string | undefined;
  experiment?: { id: number; name: string; inExperiment: boolean } | undefined;
}

export interface FlagsLike {
  getFlag(featureName: string): FlagLike;
}

/** The subset of the `@flagsmith/nodejs` 9.5 `Flagsmith` client the kit uses. */
export interface FlagsmithLike {
  getExperimentFlag(featureName: string, identifier: string, traits?: Record<string, EventValue>): Promise<FlagLike>;
  getIdentityFlags(identifier: string, traits?: Record<string, EventValue>): Promise<FlagsLike>;
  getEnvironmentFlags(): Promise<FlagsLike>;
  trackEvent(event: string, opts?: { identifier?: string; value?: EventValue }): void;
  flushEvents(): Promise<void>;
}

export interface Logger {
  warn(message: string): void;
  error(message: string): void;
}

export interface RoutedLanesOptions {
  flagsmith: FlagsmithLike;
  identity: string;
  pricing: Pricing;
  flag?: string;
  /** Set to null to skip the kill switch. */
  killFlag?: string | null;
  /** Policy for the kill switch and fail-closed paths. Defaults to the flag's environment value. */
  control?: RoutingPolicy | string | Record<string, unknown>;
  /**
   * What to do when the kill switch or the flag cannot be read, or the flag's value is not a valid
   * policy. `control` (the default) fails closed to the control policy. `throw` rejects with a
   * `PolicyError` and substitutes nothing; the kill switch still serves the control policy.
   */
  onFailure?: "control" | "throw";
  traits?: Record<string, EventValue>;
  emitUnexposed?: boolean;
  onEvent?: (identity: string, event: string, value: number) => void;
  logger?: Logger;
  now?: () => number;
}

export interface LaneTotals {
  calls: number;
  usd: number;
  tokens: number;
}

export interface TaskResult {
  identity: string;
  variant: string | null;
  policy: RoutingPolicy;
  flagSource: FlagSource;
  exposed: boolean;
  solved: boolean;
  usd: number;
  usdMain: number;
  usdDelegate: number;
  tokensMain: number;
  tokensDelegate: number;
  delegateCalls: number;
  turns: number;
  seconds: number;
  events: Array<[string, number]>;
  failReason: string | null;
}

export class PolicyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PolicyError";
  }
}

export interface TaskOutcome {
  usd: number;
  solved: boolean;
  turns: number;
  seconds: number;
}

/** The events one finished task sends, in order. `task_solved` is only there for a solve. */
export function taskEvents(outcome: TaskOutcome): Array<[string, number]> {
  const events: Array<[string, number]> = [[EVENT_COST, Math.round(outcome.usd * 1e6) / 1e6]];
  if (outcome.solved) events.push([EVENT_SOLVED, 1]);
  events.push([EVENT_TURNS, outcome.turns]);
  events.push([EVENT_SECONDS, Math.round(outcome.seconds * 1000) / 1000]);
  return events;
}

/**
 * Send a finished task's events with the exposure's identifier, flushing after each one.
 * Returns the events in the order they were sent.
 */
export async function sendTaskEvents(
  client: Pick<FlagsmithLike, "trackEvent" | "flushEvents">,
  identity: string,
  outcome: TaskOutcome,
  onEvent?: (identity: string, event: string, value: number) => void,
): Promise<Array<[string, number]>> {
  const events = taskEvents(outcome);
  for (const [event, value] of events) {
    client.trackEvent(event, { identifier: identity, value });
    await client.flushEvents();
    onEvent?.(identity, event, value);
  }
  return events;
}

function isExposed(flag: FlagLike | undefined): boolean {
  if (!flag || flag.isDefault === true) return false;
  return Boolean(flag.enabled && flag.experiment?.inExperiment && flag.variant != null);
}

export class RoutedLanes {
  readonly identity: string;
  readonly flag: string;
  policy!: RoutingPolicy;
  flagSource!: FlagSource;
  variant: string | null = null;
  exposed = false;
  failReason: string | null = null;

  private readonly client: FlagsmithLike;
  private readonly pricing: Pricing;
  private readonly opts: RoutedLanesOptions;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly started: number;
  private readonly totals: Record<Lane, LaneTotals> = {
    main: { calls: 0, usd: 0, tokens: 0 },
    delegate: { calls: 0, usd: 0, tokens: 0 },
  };
  private finished: TaskResult | null = null;

  private constructor(opts: RoutedLanesOptions) {
    if (!opts.identity) throw new Error("identity must be a non-empty identifier");
    this.identity = opts.identity;
    this.flag = opts.flag ?? "agent_routing";
    this.client = opts.flagsmith;
    this.pricing = opts.pricing;
    this.opts = opts;
    this.log = opts.logger ?? console;
    this.now = opts.now ?? (() => performance.now() / 1000);
    this.started = this.now();
  }

  /** Fetch and validate the policy for `identity` once. */
  static async create(opts: RoutedLanesOptions): Promise<RoutedLanes> {
    const lanes = new RoutedLanes(opts);
    const [policy, source] = await lanes.resolve(opts.killFlag === undefined ? "routing_kill" : opts.killFlag);
    lanes.policy = policy;
    lanes.flagSource = source;
    return lanes;
  }

  private async control(): Promise<RoutingPolicy> {
    if (this.opts.control !== undefined) return parsePolicy(this.opts.control);
    try {
      const env = await this.client.getEnvironmentFlags();
      return parsePolicy(env.getFlag(this.flag).value);
    } catch (err) {
      throw new PolicyError(`control policy for "${this.flag}" is not a valid RoutingPolicy: ${(err as Error).message}`);
    }
  }

  private async failClosed(reason: string, cause?: unknown): Promise<[RoutingPolicy, FlagSource]> {
    this.failReason = reason;
    if (this.opts.onFailure === "throw") throw new PolicyError(reason, { cause });
    this.log.error(`forkbill: identity ${this.identity} fails closed to the control policy: ${reason}`);
    return [await this.control(), "fail_closed"];
  }

  private async resolve(killFlag: string | null): Promise<[RoutingPolicy, FlagSource]> {
    if (killFlag) {
      let kill: FlagLike;
      try {
        kill = (await this.client.getIdentityFlags(this.identity, this.opts.traits)).getFlag(killFlag);
      } catch (err) {
        return this.failClosed(`kill switch "${killFlag}" unreadable: ${(err as Error).message}`, err);
      }
      if (kill.enabled && kill.isDefault !== true) {
        this.log.warn(`forkbill: kill switch "${killFlag}" is on for ${this.identity}`);
        return [await this.control(), "kill_switch"];
      }
    }

    let served: FlagLike;
    try {
      served = await this.client.getExperimentFlag(this.flag, this.identity, this.opts.traits);
    } catch (err) {
      return this.failClosed(`flag "${this.flag}" unreadable: ${(err as Error).message}`, err);
    }
    this.exposed = isExposed(served);
    this.variant = served.variant ?? null;
    if (this.exposed) await this.client.flushEvents();

    if (served.isDefault === true) return this.failClosed(`flag "${this.flag}" does not exist in this environment`);
    if (!served.enabled) return this.failClosed(`flag "${this.flag}" is disabled`);
    try {
      const policy = parsePolicy(served.value);
      return [policy, this.exposed ? "experiment" : "flag"];
    } catch (err) {
      return this.failClosed(`flag "${this.flag}" value is not a valid policy: ${(err as Error).message}`, err);
    }
  }

  get mainModel(): string {
    return this.policy.main.model;
  }

  get delegateModel(): string {
    return this.policy.delegate.model;
  }

  modelFor(lane: Lane): string {
    return lane === "main" ? this.mainModel : this.delegateModel;
  }

  get usd(): number {
    return this.totals.main.usd + this.totals.delegate.usd;
  }

  laneTotals(lane: Lane): Readonly<LaneTotals> {
    return this.totals[lane];
  }

  /** True once spend reaches the policy's per-task dollar cap. */
  get overBudget(): boolean {
    return this.usd >= this.policy.caps.usd_per_task;
  }

  /** Price one model call on `lane` and add it to the task's totals. Returns dollars. */
  recordCall(lane: Lane, usage: Usage, model?: string): number {
    if (this.finished) throw new Error("recordCall after finish");
    const usd = this.pricing.cost(model ?? this.modelFor(lane), usage);
    const t = this.totals[lane];
    t.calls += 1;
    t.usd += usd;
    t.tokens += totalTokens(usage);
    return usd;
  }

  /** Send the task's events with the exposure's identifier, flushing each one. */
  async finish(solved: boolean, turns: number, seconds?: number): Promise<TaskResult> {
    if (this.finished) throw new Error("finish called twice");
    const secs = seconds ?? this.now() - this.started;
    const usd = Math.round(this.usd * 1e6) / 1e6;
    const events =
      this.exposed || this.opts.emitUnexposed
        ? await sendTaskEvents(this.client, this.identity, { usd, solved, turns, seconds: secs }, this.opts.onEvent)
        : [];
    this.finished = {
      identity: this.identity,
      variant: this.variant,
      policy: this.policy,
      flagSource: this.flagSource,
      exposed: this.exposed,
      solved,
      usd,
      usdMain: this.totals.main.usd,
      usdDelegate: this.totals.delegate.usd,
      tokensMain: this.totals.main.tokens,
      tokensDelegate: this.totals.delegate.tokens,
      delegateCalls: this.totals.delegate.calls,
      turns,
      seconds: secs,
      events,
      failReason: this.failReason,
    };
    return this.finished;
  }
}
