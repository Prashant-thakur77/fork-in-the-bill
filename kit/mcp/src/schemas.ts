/** Input and output schemas of the tools. Policy rules themselves live in the kit's `parsePolicy`. */

import { z } from "zod";

import type { RoutingPolicy } from "forkbill";

const identity = z
  .string()
  .min(1)
  .max(2000)
  .describe(
    "The Flagsmith identity of one task, for example \"task:1234\". Use one identity per task and the same one in every call about that task: Flagsmith joins the exposure and the outcome on it.",
  );

const traitValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const tokens = (what: string) => z.number().int().min(0).default(0).describe(what);

const effort = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const policySchema = z.object({
  policy: z.string().describe("The policy's label, usually the variant key."),
  schema: z.literal(1),
  main: z.object({
    model: z.string().describe("Model for the main lane: planning and decisions."),
    max_tokens: z.number(),
    cache: z.boolean(),
    effort,
  }),
  delegate: z.object({
    model: z.string().describe("Model for the delegate lane: searches, long reads, test runs."),
    max_tokens: z.number(),
    max_context_tokens: z.number(),
    effort,
  }),
  caps: z.object({
    turns: z.number().describe("Stop after this many main-lane turns."),
    usd_per_task: z.number().describe("Stop once the task has spent this many US dollars."),
    seconds: z.number().describe("Stop after this many seconds."),
  }),
  prompt_variant: z.enum(["delegate_v1", "draft_review_v1"]),
});

// The schema above describes the kit's type; this fails to compile if the two drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const policySchemaMatchesKit: Same<z.infer<typeof policySchema>, RoutingPolicy> = true;

export const getRoutingPolicyInput = {
  identity,
  traits: z
    .record(z.string(), traitValue)
    .optional()
    .describe(
      "Traits of the task (for example repo, language) sent to Flagsmith with the identity, for segment rules and breakdowns. Values are strings, numbers, booleans or null.",
    ),
  fallback_policy: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Optional. A complete routing policy (your control policy; format in the forkbill://routing-policy resource) to run when Flagsmith cannot serve a valid one. Leave it out and a Flagsmith failure is returned as an error. Pass it and the result uses this policy for the kill switch, an unreadable flag or an invalid flag value, and says so in `source` and `fail_reason`.",
    ),
};

export const getRoutingPolicyOutput = {
  identity: z.string(),
  flag: z.string(),
  variant: z.string().nullable().describe("The variant key Flagsmith bucketed the identity into, when it reported one."),
  source: z
    .enum(["experiment", "flag", "kill_switch", "fail_closed"])
    .describe(
      "experiment: enrolled in a running experiment, exposure recorded. flag: the flag's value, no experiment. kill_switch: the kill switch is on. fail_closed: the fallback_policy you passed.",
    ),
  from_experiment: z.boolean(),
  exposure_recorded: z.boolean().describe("True when the exposure event was accepted by Flagsmith's events API."),
  policy: policySchema,
  fail_reason: z.string().nullable(),
  reused: z.boolean().describe("True when this identity was already assigned in this session and Flagsmith was not asked again."),
  note: z.string(),
};

export const reportOutcomeInput = {
  identity,
  cost_usd: z.number().min(0).describe("Total model spend on the task in US dollars. Report it for every task, solved or not."),
  solved: z.boolean().describe("Whether the task met its success test. task_solved is sent only when true."),
  turns: z.number().int().min(0).describe("Number of agent turns the task took."),
  seconds: z.number().min(0).describe("Seconds from getting the policy to the end of the task."),
  exposure_recorded_elsewhere: z
    .boolean()
    .optional()
    .describe(
      "Set true only when this identity's exposure was recorded by another process or an earlier session of this server, so the server cannot see it. Events for an identity with no exposure are ignored by Flagsmith's results.",
    ),
};

export const reportOutcomeOutput = {
  identity: z.string(),
  variant: z.string().nullable(),
  events: z.array(z.object({ event: z.string(), value: z.number() })).describe("The events Flagsmith accepted, in order."),
  delivered: z.boolean(),
  note: z.string(),
};

export const getKillSwitchOutput = {
  flag: z.string().nullable(),
  configured: z.boolean().describe("False when the kill switch is turned off with FORKBILL_KILL_FLAG=none."),
  exists: z.boolean().describe("False when the environment has no flag of that name."),
  enabled: z.boolean(),
  note: z.string(),
};

export const explainAssignmentInput = {
  identity,
  environment_document: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .describe(
      "The Flagsmith environment document, as a JSON object or a JSON string (what `flagsmith environment document` prints). Give this or environment_document_path, not both.",
    ),
  environment_document_path: z
    .string()
    .min(1)
    .optional()
    .describe("Path of a saved environment document on the machine the server runs on."),
  flag: z.string().min(1).optional().describe("Flag to explain. Defaults to the server's routing flag."),
  traits: z
    .record(z.string(), traitValue)
    .optional()
    .describe("Traits the identity had. Only needed when a segment rule reads a trait; the engine check uses them."),
  expected_variant: z
    .string()
    .min(1)
    .optional()
    .describe("The variant the task actually ran, to check against the re-derived one."),
};

const hash = z.object({
  input: z.string().describe("The string that was hashed, with the environment key shown as <api_key>."),
  md5: z.string(),
  remainder: z.number().describe("int(md5, 16) % 9999"),
  percentage: z.number().describe("remainder / 9998 * 100"),
  iterations: z.number(),
});

export const explainAssignmentOutput = {
  identity: z.string(),
  flag: z.string(),
  variant: z.string().nullable().describe("The re-derived variant key. Null for a flag with no variants."),
  in_experiment: z.boolean().nullable(),
  policy: policySchema.nullable().describe("The policy that variant serves, when the value is a valid routing policy."),
  policy_error: z.string().nullable(),
  working: z
    .object({
      identity_key: z.string(),
      segments: z.array(
        z.object({
          id: z.string(),
          name: z.string().nullable(),
          priority: z.number().nullable(),
          matched: z.boolean(),
          conditions: z.array(
            z.object({ operator: z.string(), threshold: z.number(), hash, matched: z.boolean() }),
          ),
        }),
      ),
      feature_state: z.object({
        source: z.enum(["segment_override", "environment"]),
        segment: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
        id: z.string(),
        enabled: z.boolean(),
        experiment: z
          .object({ id: z.number().nullable(), name: z.string().nullable(), in_experiment: z.boolean() })
          .nullable(),
      }),
      split: z
        .object({
          hash,
          ranges: z.array(
            z.object({ variant: z.string().nullable(), start: z.number(), end: z.number(), matched: z.boolean() }),
          ),
        })
        .nullable(),
    })
    .nullable()
    .describe("Every step of the md5 recomputation. Null when the document needs rules it does not cover."),
  independent: z.object({ variant: z.string().nullable(), error: z.string().nullable() }),
  engine: z.object({
    variant: z.string().nullable(),
    enabled: z.boolean().nullable(),
    in_experiment: z.boolean().nullable(),
    reason: z.string().nullable(),
    error: z.string().nullable(),
  }),
  agree: z.boolean().nullable().describe("Whether the md5 recomputation and Flagsmith's engine give the same variant."),
  expected_variant: z.string().nullable(),
  matches_expected: z.boolean().nullable(),
  session_variant: z.string().nullable().describe("The variant get_routing_policy got for this identity in this session, if any."),
  matches_session: z.boolean().nullable(),
  explanation: z.string(),
};

const lane = z.enum(["main", "delegate"]);

export const priceUsageInput = {
  calls: z
    .array(
      z.object({
        lane: lane.optional().describe("The lane the call ran on. With `identity`, the lane also picks the model."),
        model: z.string().min(1).optional().describe("Model id as it appears in the pricing table. Overrides the lane's model."),
        input_tokens: tokens("Uncached input tokens."),
        output_tokens: tokens("Output tokens."),
        cache_write_5m_tokens: tokens("Tokens written to the 5-minute cache."),
        cache_write_1h_tokens: tokens("Tokens written to the 1-hour cache."),
        cache_read_tokens: tokens("Tokens read from the cache."),
      }),
    )
    .min(1)
    .max(10_000)
    .describe("One entry per model call, or one per lane with the task's token totals."),
  identity: z
    .string()
    .min(1)
    .optional()
    .describe(
      "A task that got its policy from get_routing_policy in this session. Calls that name only a lane are priced with that policy's models, and the total is checked against its dollar cap.",
    ),
};

const laneTotal = z.object({ calls: z.number(), tokens: z.number(), usd: z.number() });

export const priceUsageOutput = {
  calls: z.array(z.object({ lane: lane.nullable(), model: z.string(), tokens: z.number(), usd: z.number() })),
  by_lane: z.object({ main: laneTotal, delegate: laneTotal, other: laneTotal }),
  total_tokens: z.number(),
  total_usd: z.number().describe("US dollars, rounded to 6 places as task_cost is."),
  cap_usd: z.number().nullable(),
  over_budget: z.boolean().nullable().describe("True once total_usd reaches the policy's usd_per_task cap."),
  pricing: z.object({
    table: z.string(),
    source: z.string().nullable(),
    checked_on: z.string().nullable(),
    unit: z.string(),
  }),
};
