/**
 * The MCP server: five tools, three resources and one prompt over the TypeScript kit.
 *
 * The server never chooses an arm. `get_routing_policy` asks Flagsmith through the kit's
 * `RoutedLanes` and returns what it served; when Flagsmith cannot serve a valid policy the tool
 * returns that error, unless the caller passed a `fallback_policy` of its own.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { ConfigError, describeConfig, loadConfig, logLevelOf, type ServerConfig } from "./config.js";
import { EXPOSURE_EVENT, type Fetch } from "./delivery.js";
import { connect, describeError, engineEvaluate, kitLogger, stderrLogger, type EngineFlag, type FlagsmithHandle } from "./flagsmith.js";
import {
  AssignmentError,
  DEFAULT_VARIANT,
  explainAssignment,
  parsePolicy,
  RoutedLanes,
  sendTaskEvents,
  totalTokens,
  UnsupportedDocumentError,
  type AssignmentWorking,
  type FlagSource,
  type Lane,
  type RoutingPolicy,
  type Usage,
} from "forkbill";
import { describePricing, loadPricingTable, type PricingTable } from "./pricing.js";
import {
  explainAssignmentInput,
  explainAssignmentOutput,
  getKillSwitchOutput,
  getRoutingPolicyInput,
  getRoutingPolicyOutput,
  priceUsageInput,
  priceUsageOutput,
  reportOutcomeInput,
  reportOutcomeOutput,
} from "./schemas.js";
import { INSTRUCTIONS, POLICY_FORMAT, renderWorking, routingPrompt } from "./text.js";

const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

export interface ServerOptions {
  /** Where configuration is read from. Pass `process.env`. */
  env: Record<string, string | undefined>;
  /** The HTTP layer the Flagsmith client uses. Defaults to the global `fetch`. */
  fetch?: Fetch;
}

export interface ForkbillServer {
  server: McpServer;
  /** Send buffered events and stop the Flagsmith client. */
  close(timeoutMs?: number): Promise<void>;
}

interface Assignment {
  identity: string;
  flag: string;
  variant: string | null;
  source: FlagSource;
  exposed: boolean;
  /** Null for an identity this session only reported on, its exposure having been recorded elsewhere. */
  policy: RoutingPolicy | null;
  failReason: string | null;
  outcome: { events: Array<{ event: string; value: number }>; delivered: boolean; note: string } | null;
}

function packageVersion(): string {
  // dist/src/server.js -> package.json
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  try {
    return String((JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const arm = (variant: string | null): string => variant ?? DEFAULT_VARIANT;

export function createForkbillServer(options: ServerOptions): ForkbillServer {
  let config: ServerConfig | null = null;
  let configError: string | null = null;
  try {
    config = loadConfig(options.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    configError = err.message;
  }
  const log = stderrLogger(config?.logLevel ?? logLevelOf(options.env));
  const key = config?.environmentKey ?? null;
  /** Nothing the server sends may contain the environment key. */
  const scrub = (text: string): string =>
    key !== null && key.length >= 8 ? text.split(key).join("<environment key>") : text;

  const assignments = new Map<string, Assignment>();
  let handle: FlagsmithHandle | null = null;
  let table: PricingTable | null = null;

  const settings = (): ServerConfig => {
    if (config === null) throw new ConfigError(configError ?? "the server is not configured");
    return config;
  };
  const flagsmith = (): FlagsmithHandle => {
    handle ??= connect(settings(), log, options.fetch ?? fetch);
    return handle;
  };
  const pricing = (): PricingTable => {
    table ??= loadPricingTable(config?.pricingFile ?? null);
    return table;
  };

  const ok = (result: Record<string, unknown>, text?: string): CallToolResult => {
    const json = JSON.stringify(result, null, 2);
    const content: CallToolResult["content"] = [{ type: "text", text: scrub(json) }];
    if (text !== undefined) content.unshift({ type: "text", text: scrub(text) });
    return { content, structuredContent: JSON.parse(scrub(json)) as Record<string, unknown> };
  };
  const fail = (message: string): CallToolResult => {
    log.warn(scrub(message));
    return { isError: true, content: [{ type: "text", text: scrub(message) }] };
  };
  /** Turn anything a handler throws into a tool error that says what went wrong. */
  const guarded =
    <A>(handler: (args: A) => Promise<CallToolResult>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return await handler(args);
      } catch (err) {
        const prefix = err instanceof ConfigError ? "Configuration: " : "";
        return fail(`${prefix}${describeError(err)}`);
      }
    };

  /**
   * One call at a time per identity, so two calls for the same task cannot both ask Flagsmith or
   * both send its events.
   */
  const busy = new Map<string, Promise<unknown>>();
  const perIdentity = <A extends { identity: string }>(handler: (args: A) => Promise<CallToolResult>) =>
    guarded(async (args: A): Promise<CallToolResult> => {
      const before = busy.get(args.identity) ?? Promise.resolve();
      const mine = before.catch(() => undefined).then(() => handler(args));
      busy.set(args.identity, mine);
      try {
        return await mine;
      } finally {
        if (busy.get(args.identity) === mine) busy.delete(args.identity);
      }
    });

  const server = new McpServer(
    { name: "forkbill-mcp", title: "Fork in the Bill", version: packageVersion() },
    { instructions: INSTRUCTIONS },
  );

  // Tools ---------------------------------------------------------------------------------

  const policyView = (a: Assignment, reused: boolean): Record<string, unknown> => {
    const edge = config?.mode === "edge";
    const notes: Record<FlagSource, string> = {
      experiment: "Run the task with these models and caps, then call report_outcome once with the same identity.",
      flag: edge
        ? "No exposure was recorded: an Edge Proxy identity response carries no variant or experiment. This is the value the proxy served; report_outcome will send nothing. Use FORKBILL_MODE=edge-local to run an experiment through a proxy."
        : "This identity is not enrolled in a running experiment, so this is the flag's value, no exposure was recorded and report_outcome will send nothing.",
      kill_switch:
        "The kill switch is on. This is the control policy, no exposure was recorded and report_outcome will send nothing.",
      fail_closed: `Flagsmith could not serve a valid policy, so this is the fallback_policy you passed. ${
        a.exposed ? "The exposure had already been recorded, so report_outcome still sends the task's events." : "No exposure was recorded and report_outcome will send nothing."
      }`,
    };
    return {
      identity: a.identity,
      flag: a.flag,
      variant: a.variant,
      source: a.source,
      from_experiment: a.exposed,
      exposure_recorded: a.exposed,
      policy: a.policy,
      fail_reason: a.failReason,
      reused,
      note: reused ? `Already assigned in this session; Flagsmith was not asked again. ${notes[a.source]}` : notes[a.source],
    };
  };

  server.registerTool(
    "get_routing_policy",
    {
      title: "Get the routing policy for a task",
      description:
        "Ask Flagsmith which routing policy one task runs: the model for each lane, the caps and the prompt variant. Call it once per task, before the first model call. Flagsmith buckets the identity into an arm and, when the identity is enrolled in a running experiment, the exposure is recorded and sent at once. The server never picks an arm: if the kill switch or the flag cannot be read, or the flag's value is not a valid policy, the result is an error carrying Flagsmith's own message, unless you passed fallback_policy. Calling it again for the same identity in one session returns the first answer without asking Flagsmith again.",
      inputSchema: getRoutingPolicyInput,
      outputSchema: getRoutingPolicyOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    perIdentity(async ({ identity, traits, fallback_policy }) => {
      const prior = assignments.get(identity);
      if (prior && prior.policy !== null) return ok(policyView(prior, true));

      let fallback: RoutingPolicy | null = null;
      if (fallback_policy !== undefined) {
        try {
          fallback = parsePolicy(fallback_policy);
        } catch (err) {
          return fail(`fallback_policy: ${(err as Error).message}. Nothing was sent to Flagsmith.`);
        }
      }
      const cfg = settings();
      const fs = flagsmith();
      let lanes: RoutedLanes;
      try {
        lanes = await RoutedLanes.create({
          flagsmith: fs.client,
          identity,
          pricing: { cost: (model: string, usage: Usage) => pricing().pricing.cost(model, usage) },
          flag: cfg.flag,
          killFlag: cfg.killFlag,
          logger: kitLogger(log),
          ...(traits !== undefined ? { traits } : {}),
          ...(fallback !== null ? { control: fallback, onFailure: "control" as const } : { onFailure: "throw" as const }),
        });
      } catch (err) {
        fs.deliveries.take(identity);
        return fail(
          `Flagsmith did not serve a routing policy for "${identity}": ${describeError(err)}. No arm was chosen and no policy was substituted. Fix the cause and call again, or pass fallback_policy to say what to run when Flagsmith is unavailable.`,
        );
      }
      const delivery = fs.deliveries.take(identity);
      if (lanes.exposed && !delivery.delivered.some((e) => e.event === EXPOSURE_EVENT)) {
        return fail(
          `Flagsmith bucketed "${identity}" into variant ${arm(lanes.variant)}, but the exposure was not accepted: ${
            delivery.failure ?? "no answer from the events API was seen"
          }. A task with no exposure does not count in the experiment, so no policy is returned. Check FLAGSMITH_EVENTS_API_URL and the environment key, then call again; the bucket will be the same.`,
        );
      }
      const assignment: Assignment = {
        identity,
        flag: cfg.flag,
        variant: lanes.variant,
        source: lanes.flagSource,
        exposed: lanes.exposed,
        policy: lanes.policy,
        failReason: lanes.failReason,
        outcome: prior?.outcome ?? null,
      };
      assignments.set(identity, assignment);
      return ok(policyView(assignment, false));
    }),
  );

  server.registerTool(
    "report_outcome",
    {
      title: "Report how a task ended",
      description:
        "Send a finished task's outcome to Flagsmith as the experiment's metric events: task_cost (US dollars), task_turns and task_seconds for every task, and task_solved only when solved is true. Call it once per task, with the identity used in get_routing_policy, for unsolved and capped tasks as well. Events go out only for an identity whose exposure was recorded; for any other identity nothing is sent and the result says why. The result lists the events Flagsmith accepted, and it is an error if any was not accepted.",
      inputSchema: reportOutcomeInput,
      outputSchema: reportOutcomeOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    perIdentity(async ({ identity, cost_usd, solved, turns, seconds, exposure_recorded_elsewhere }) => {
      const assignment = assignments.get(identity);
      if (assignment?.outcome) {
        return fail(
          `An outcome for "${identity}" was already reported in this session (${assignment.outcome.note}) Sending it again would count the task twice, so nothing was sent.`,
        );
      }
      if (!assignment && exposure_recorded_elsewhere !== true) {
        return fail(
          `No routing policy was requested for "${identity}" in this session, so the server cannot tell whether it was exposed. Call get_routing_policy first, or set exposure_recorded_elsewhere to true if another process recorded the exposure. Nothing was sent.`,
        );
      }
      const variant = assignment?.variant ?? null;
      if (assignment && !assignment.exposed) {
        const note = `"${identity}" was not exposed to an experiment (source: ${assignment.source}), so no events were sent.`;
        assignment.outcome = { events: [], delivered: false, note };
        return ok({ identity, variant, events: [], delivered: false, note });
      }
      const fs = flagsmith();
      const sent = await sendTaskEvents(fs.client, identity, { usd: cost_usd, solved, turns, seconds });
      const delivery = fs.deliveries.take(identity);
      const accepted = sent.filter(([event, value]) =>
        delivery.delivered.some((d) => d.event === event && d.value === String(value)),
      );
      const events = accepted.map(([event, value]) => ({ event, value }));
      if (accepted.length < sent.length) {
        const missing = sent.filter((e) => !accepted.includes(e)).map(([event]) => event);
        const note = `Flagsmith accepted ${accepted.length} of ${sent.length} events; not accepted: ${missing.join(", ")}.`;
        if (assignment) {
          assignment.outcome = { events, delivered: false, note };
        } else {
          assignments.set(identity, {
            identity, flag: settings().flag, variant: null, source: "flag", exposed: true, policy: null, failReason: null,
            outcome: { events, delivered: false, note },
          });
        }
        return fail(
          `${note} Reason: ${delivery.failure ?? "no answer from the events API was seen"}. While this server runs the Flagsmith client keeps events the API was unavailable for and retries them, so do not report this task again from this session. Check FLAGSMITH_EVENTS_API_URL and the environment key.`,
        );
      }
      const note = assignment
        ? `Flagsmith accepted ${events.length} events for variant ${arm(variant)}.`
        : `Flagsmith accepted ${events.length} events. This session did not record the exposure, so they count only if one exists for "${identity}".`;
      if (assignment) {
        assignment.outcome = { events, delivered: true, note };
      } else {
        assignments.set(identity, {
          identity,
          flag: settings().flag,
          variant: null,
          source: "flag",
          exposed: true,
          policy: null,
          failReason: null,
          outcome: { events, delivered: true, note },
        });
      }
      return ok({ identity, variant, events, delivered: true, note });
    }),
  );

  server.registerTool(
    "get_kill_switch",
    {
      title: "Read the kill switch",
      description:
        "Read the kill switch flag (routing_kill unless FORKBILL_KILL_FLAG names another) at environment level. When it is on, get_routing_policy returns the control policy, records no exposure and report_outcome sends nothing, so tasks run but stay out of the experiment's data. This call reads one flag and sends no exposure or event. get_routing_policy checks the switch itself for each identity, so this is for status, not a step you must take.",
      outputSchema: getKillSwitchOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    guarded(async () => {
      const cfg = settings();
      if (cfg.killFlag === null) {
        return ok({
          flag: null,
          configured: false,
          exists: false,
          enabled: false,
          note: "The kill switch is turned off with FORKBILL_KILL_FLAG=none, so get_routing_policy does not check one.",
        });
      }
      const fs = flagsmith();
      let served;
      try {
        served = (await fs.client.getEnvironmentFlags()).getFlag(cfg.killFlag);
      } catch (err) {
        return fail(`Flagsmith did not serve the kill switch "${cfg.killFlag}": ${describeError(err)}.`);
      }
      const exists = served.isDefault !== true;
      const enabled = exists && served.enabled;
      const note = !exists
        ? `This environment has no flag named "${cfg.killFlag}". get_routing_policy treats a missing kill switch as off.`
        : enabled
          ? "On: tasks run the control policy, no exposure is recorded and no outcome events are sent."
          : "Off: tasks are assigned by the routing flag as usual.";
      return ok({ flag: cfg.killFlag, configured: true, exists, enabled, note });
    }),
  );

  server.registerTool(
    "explain_assignment",
    {
      title: "Re-derive an assignment offline",
      description:
        "Work out, with no network call, which variant an identity gets from a saved Flagsmith environment document, and show every step: the hashing key, the md5 of each segment check, the feature state chosen, the md5 of the split and the range it lands in. The same document is also evaluated with Flagsmith's own engine and the two answers are compared. Use it to check that a task ran the arm it was dealt, or to see why an identity landed where it did. Needs no Flagsmith key and sends nothing. The md5 recomputation covers percentage-split segments, which is what an experiment rollout uses; for other segment rules the working is null and the engine's answer is reported.",
      inputSchema: explainAssignmentInput,
      outputSchema: explainAssignmentOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ identity, environment_document, environment_document_path, flag, traits, expected_variant }) => {
      if ((environment_document === undefined) === (environment_document_path === undefined)) {
        return fail("Give exactly one of environment_document and environment_document_path.");
      }
      let document: unknown;
      if (environment_document_path !== undefined) {
        try {
          if (statSync(environment_document_path).size > MAX_DOCUMENT_BYTES) {
            return fail(`${environment_document_path} is larger than ${MAX_DOCUMENT_BYTES} bytes.`);
          }
          document = JSON.parse(readFileSync(environment_document_path, "utf8"));
        } catch (err) {
          return fail(`Cannot read an environment document from ${environment_document_path}: ${(err as Error).message}`);
        }
      } else if (typeof environment_document === "string") {
        try {
          document = JSON.parse(environment_document);
        } catch (err) {
          return fail(`environment_document is not JSON: ${(err as Error).message}`);
        }
      } else {
        document = environment_document;
      }
      const flagName = flag ?? config?.flag ?? "agent_routing";

      let working: AssignmentWorking | null = null;
      let independentError: string | null = null;
      try {
        working = explainAssignment(document, identity, flagName);
      } catch (err) {
        if (err instanceof AssignmentError) return fail(`Cannot re-derive the assignment: ${err.message}.`);
        if (!(err instanceof UnsupportedDocumentError)) throw err;
        independentError = err.message;
      }
      let engine: EngineFlag | null = null;
      let engineError: string | null = null;
      try {
        engine = await engineEvaluate(document, identity, traits ?? {}, flagName, log);
      } catch (err) {
        engineError = describeError(err);
      }
      if (working === null && engine === null) {
        return fail(
          `Cannot re-derive the assignment. md5 recomputation: ${independentError}. Flagsmith engine: ${engineError}.`,
        );
      }

      // As in integrity/verify_assignment.py: when both ran, the engine's answer is the one reported.
      const variant = engine !== null ? engine.variant : (working?.variant ?? null);
      const agree = engine !== null && working !== null ? engine.variant === working.variant : null;
      let policy: RoutingPolicy | null = null;
      let policyError: string | null = null;
      try {
        policy = parsePolicy(working !== null && agree !== false ? working.value : engine?.value);
      } catch (err) {
        policyError = (err as Error).message;
      }
      const session = assignments.get(identity);
      const sessionVariant = session && session.flag === flagName && session.policy !== null ? arm(session.variant) : null;
      const matchesExpected = expected_variant === undefined ? null : expected_variant === arm(variant);
      const matchesSession = sessionVariant === null ? null : sessionVariant === arm(variant);

      const lines: string[] = [];
      if (working !== null) lines.push(renderWorking(working));
      else lines.push(`${flagName} for identity ${identity}`, `The md5 recomputation does not cover this document: ${independentError}.`);
      if (engine !== null) {
        lines.push(
          `Flagsmith's engine: variant ${engine.variant ?? "none"}${engine.reason ? ` (${engine.reason})` : ""}.${
            agree === null ? "" : agree ? " The two agree." : " The two DISAGREE; the engine's answer is reported."
          }`,
        );
      } else {
        lines.push(`Flagsmith's engine could not evaluate the document: ${engineError}.`);
      }
      if (matchesExpected !== null) {
        lines.push(
          matchesExpected
            ? `Expected ${expected_variant}: matches.`
            : `Expected ${expected_variant}: DOES NOT MATCH the re-derived ${arm(variant)}.`,
        );
      }
      if (matchesSession !== null) {
        lines.push(
          matchesSession
            ? `This session was served ${sessionVariant} for the identity: matches.`
            : `This session was served ${sessionVariant} for the identity: DOES NOT MATCH the re-derived ${arm(variant)}. The document may be from a different time than the assignment.`,
        );
      }
      const explanation = lines.join("\n");

      return ok(
        {
          identity,
          flag: flagName,
          variant,
          in_experiment: working?.featureState.experiment?.inExperiment ?? engine?.inExperiment ?? null,
          policy,
          policy_error: policyError,
          working:
            working === null
              ? null
              : {
                  identity_key: working.identityKey,
                  segments: working.segments,
                  feature_state: {
                    source: working.featureState.source,
                    segment: working.featureState.segment,
                    id: working.featureState.id,
                    enabled: working.featureState.enabled,
                    experiment:
                      working.featureState.experiment === null
                        ? null
                        : {
                            id: working.featureState.experiment.id,
                            name: working.featureState.experiment.name,
                            in_experiment: working.featureState.experiment.inExperiment,
                          },
                  },
                  split: working.split,
                },
          independent: { variant: working?.variant ?? null, error: independentError },
          engine: {
            variant: engine?.variant ?? null,
            enabled: engine?.enabled ?? null,
            in_experiment: engine?.inExperiment ?? null,
            reason: engine?.reason ?? null,
            error: engineError,
          },
          agree,
          expected_variant: expected_variant ?? null,
          matches_expected: matchesExpected,
          session_variant: sessionVariant,
          matches_session: matchesSession,
          explanation,
        },
        explanation,
      );
    }),
  );

  server.registerTool(
    "price_usage",
    {
      title: "Price token usage",
      description:
        "Turn token counts into US dollars with the server's pricing table (the forkbill://pricing resource). Pass one entry per model call, or one per lane with the task's totals. Each entry needs a model, or a lane together with the identity of a task that got its policy in this session, in which case the lane's model comes from that policy and the total is checked against the policy's dollar cap. Nothing is sent to Flagsmith; use the total as cost_usd in report_outcome. Rates are flat per token: a higher tier a provider charges for long prompts is not applied.",
      inputSchema: priceUsageInput,
      outputSchema: priceUsageOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ calls, identity }) => {
      const prices = pricing();
      let policy: RoutingPolicy | null = null;
      if (identity !== undefined) {
        const assignment = assignments.get(identity);
        if (!assignment || assignment.policy === null) {
          return fail(
            `No routing policy was requested for "${identity}" in this session. Call get_routing_policy first, or leave identity out and name a model in each call.`,
          );
        }
        policy = assignment.policy;
      }
      const empty = () => ({ calls: 0, tokens: 0, usd: 0 });
      const byLane = { main: empty(), delegate: empty(), other: empty() };
      const priced: Array<{ lane: Lane | null; model: string; tokens: number; usd: number }> = [];
      let total = 0;
      for (const [i, call] of calls.entries()) {
        const laneModel = call.lane && policy ? (call.lane === "main" ? policy.main.model : policy.delegate.model) : undefined;
        const model = call.model ?? laneModel;
        if (model === undefined) {
          return fail(
            `calls[${i}] has no model. Give it a model, or a lane together with the identity of a task assigned in this session.`,
          );
        }
        const usage: Usage = {
          inputTokens: call.input_tokens,
          outputTokens: call.output_tokens,
          cacheWrite5mTokens: call.cache_write_5m_tokens,
          cacheWrite1hTokens: call.cache_write_1h_tokens,
          cacheReadTokens: call.cache_read_tokens,
        };
        let usd: number;
        try {
          usd = prices.pricing.cost(model, usage);
        } catch (err) {
          return fail(
            `calls[${i}]: ${(err as Error).message} in the ${prices.origin} pricing table. Priced models: ${Object.keys(prices.models).join(", ")}. Set FORKBILL_PRICING_FILE to use your own table.`,
          );
        }
        const tokens = totalTokens(usage);
        const bucket = byLane[call.lane ?? "other"];
        bucket.calls += 1;
        bucket.tokens += tokens;
        bucket.usd += usd;
        total += usd;
        priced.push({ lane: call.lane ?? null, model, tokens, usd: round6(usd) });
      }
      for (const bucket of Object.values(byLane)) bucket.usd = round6(bucket.usd);
      const totalUsd = round6(total);
      return ok({
        calls: priced,
        by_lane: byLane,
        total_tokens: priced.reduce((sum, c) => sum + c.tokens, 0),
        total_usd: totalUsd,
        cap_usd: policy?.caps.usd_per_task ?? null,
        over_budget: policy ? total >= policy.caps.usd_per_task : null,
        pricing: { table: prices.origin, source: prices.source, checked_on: prices.checkedOn, unit: prices.unit },
      });
    }),
  );

  // Resources -----------------------------------------------------------------------------

  const json = (uri: URL, body: unknown) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: scrub(JSON.stringify(body, null, 2)) }],
  });

  server.registerResource(
    "pricing",
    "forkbill://pricing",
    {
      title: "Pricing table",
      description: "The per-model token prices price_usage uses, with where they came from and the date they were checked.",
      mimeType: "application/json",
    },
    (uri) => json(uri, describePricing(pricing())),
  );

  server.registerResource(
    "config",
    "forkbill://config",
    {
      title: "Server configuration",
      description:
        "Which Flagsmith the server talks to, the evaluation mode, the flag names and whether exposures are recorded. The environment key is reported as set or not set and never shown.",
      mimeType: "application/json",
    },
    (uri) => json(uri, config === null ? { error: configError } : describeConfig(config)),
  );

  server.registerResource(
    "routing-policy",
    "forkbill://routing-policy",
    {
      title: "Routing policy format",
      description: "The JSON a routing flag's value must hold, field by field, with an example. Use it to write flag values and a fallback_policy.",
      mimeType: "text/markdown",
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: POLICY_FORMAT }] }),
  );

  // Prompt --------------------------------------------------------------------------------

  server.registerPrompt(
    "route_behind_experiment",
    {
      title: "Put my routing behind an experiment",
      description:
        "Instructions for an agent to take its model routing from a Flagsmith experiment through this server: one identity per task, the policy before the first model call, the outcome after the last.",
      argsSchema: {
        agent: z.string().optional().describe("What the agent does, for example \"the code review agent\"."),
        identity_scheme: z.string().optional().describe("How a task's identity is built, for example \"pr:<number>\"."),
      },
    },
    (args) => ({
      description: "Run each task on the routing policy Flagsmith assigns and report its outcome.",
      messages: [{ role: "user", content: { type: "text", text: routingPrompt(args) } }],
    }),
  );

  if (configError !== null) log.error(`configuration: ${configError}`);
  else if (key === null) log.warn("no Flagsmith environment key is set: the tools that talk to Flagsmith will return a configuration error");

  return {
    server,
    async close(timeoutMs = 5000) {
      await handle?.close(timeoutMs);
      handle = null;
    },
  };
}
