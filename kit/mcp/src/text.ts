/** The words the server sends to a client outside tool schemas: instructions, a resource, a prompt. */

import type { AssignmentWorking, HashWorking } from "forkbill";

export const INSTRUCTIONS = [
  "This server puts an agent's model routing behind a Flagsmith experiment.",
  "For each task: call get_routing_policy once with a stable identity for that task, run the task with the models and caps in the policy it returns, then call report_outcome once with the same identity.",
  "Flagsmith chooses the arm. Never pick a model yourself when get_routing_policy fails: report the error. Pass fallback_policy only if the user has decided what to run when Flagsmith is unavailable.",
  "get_kill_switch, price_usage and explain_assignment send nothing to the experiment. explain_assignment and price_usage work with no Flagsmith key.",
].join(" ");

export const EXAMPLE_POLICY = {
  policy: "control",
  schema: 1,
  main: { model: "claude-sonnet-5-5", max_tokens: 8000, cache: true, effort: "medium" },
  delegate: { model: "claude-sonnet-5-5", max_tokens: 2048, max_context_tokens: 24000, effort: "low" },
  caps: { turns: 40, usd_per_task: 0.6, seconds: 1200 },
  prompt_variant: "delegate_v1",
} as const;

export const POLICY_FORMAT = `# Routing policy

The value of each variation of the routing flag is one JSON object. The control arm is the flag's
own value and every other arm is a keyed variant of the same flag. Unknown fields are rejected, so
a typo in a flag value fails loudly instead of being ignored.

\`\`\`json
${JSON.stringify(EXAMPLE_POLICY, null, 2)}
\`\`\`

| Field | Rule |
|---|---|
| \`policy\` | A label, usually the variant key. |
| \`schema\` | Always 1. |
| \`main.model\`, \`delegate.model\` | Model ids. The main lane plans and decides; the delegate lane does searches, long reads and test runs. |
| \`main.max_tokens\`, \`delegate.max_tokens\` | Whole numbers from 1 to 128000. |
| \`main.cache\` | Boolean, true if left out. |
| \`main.effort\`, \`delegate.effort\` | One of low, medium, high, xhigh, max. Defaults: medium for main, low for delegate. |
| \`delegate.max_context_tokens\` | Whole number of at least 1. |
| \`caps.turns\`, \`caps.seconds\` | Whole numbers of at least 1. |
| \`caps.usd_per_task\` | A number above 0. |
| \`prompt_variant\` | delegate_v1 or draft_review_v1; delegate_v1 if left out. |

For a clean comparison the arms of one experiment should differ in one field, for example
\`delegate.model\`, and share everything else.
`;

export function routingPrompt(args: { agent?: string | undefined; identity_scheme?: string | undefined }): string {
  const agent = args.agent?.trim() || "this agent";
  const scheme = args.identity_scheme?.trim() || "a prefix and the task's own id, for example task:<id>";
  return `Put the model routing of ${agent} behind a Flagsmith experiment, using the forkbill tools.

Before the first task
1. Read the forkbill://config resource. It says which Flagsmith the server talks to, the name of the routing flag and whether exposures are recorded in this mode. If the key is not set, stop and say so.
2. Read forkbill://routing-policy for the shape of a policy. The flag, its variants, the four metrics (task_cost, task_solved, task_turns, task_seconds) and the experiment are created in Flagsmith, not through this server. If get_routing_policy reports that the flag does not exist, stop and ask for them to be created.
3. Call get_kill_switch once. If it is on, tell me before going on: tasks will run the control policy and will not count in the experiment.

For every task
1. Pick the identity: ${scheme}. One task is one identity, and it never changes for that task.
2. Call get_routing_policy with that identity (and traits such as repo or language if they are known). Use policy.main.model for planning and decisions and policy.delegate.model for searches, long reads and test runs. Do not choose a model any other way.
3. Keep count of turns and of tokens per lane. Call price_usage with the identity when you need the running cost. Stop the task when turns, dollars or seconds reach policy.caps.
4. When the task ends, solved or not, call report_outcome once with the same identity: cost_usd, solved, turns and seconds. Report unsolved and capped tasks too, or the cheaper arm looks better than it is.

If Flagsmith fails
get_routing_policy returns an error when Flagsmith cannot serve a valid policy. Do not fall back to a model of your own choosing: that task would have an arm picked by you instead of by Flagsmith. Report the error. Only pass fallback_policy if I have told you which policy to run when Flagsmith is unavailable.

Checking an assignment later
Save the environment document when the run starts (\`flagsmith environment document\`). explain_assignment takes an identity and that document and re-derives the arm offline with the same md5 bucketing Flagsmith uses, showing each step, so anyone can check that a task ran the arm it was dealt.`;
}

const pct = (n: number): string => n.toFixed(4);

function hashLine(h: HashWorking): string {
  const again = h.iterations > 1 ? ` (hashed ${h.iterations} times: the first result was exactly 100)` : "";
  return `md5("${h.input}") = ${h.md5}; as an integer mod 9999 = ${h.remainder}; ${h.remainder} / 9998 x 100 = ${pct(h.percentage)}${again}`;
}

/** The md5 recomputation as numbered steps a person can follow and repeat by hand. */
export function renderWorking(w: AssignmentWorking): string {
  const lines: string[] = [`${w.flag} for identity ${w.identity}`];
  let step = 1;
  lines.push(`${step++}. Hashing key: ${w.identityKey} (the environment key, an underscore, the identity).`);
  if (w.segments.length === 0) {
    lines.push(`${step++}. No segment overrides ${w.flag}, so the environment's own value applies.`);
  }
  for (const seg of w.segments) {
    const label = `Segment ${seg.name ?? seg.id} (${seg.id})`;
    if (seg.conditions.length === 0) {
      lines.push(`${step++}. ${label}: no rules, so it matches nobody.`);
      continue;
    }
    for (const cond of seg.conditions) {
      const verdict = cond.matched ? `<= ${cond.threshold}, inside the segment` : `> ${cond.threshold}, outside the segment`;
      lines.push(`${step++}. ${label}: ${hashLine(cond.hash)}; ${verdict}.`);
    }
  }
  const fs = w.featureState;
  const exp = fs.experiment;
  const expText =
    exp === null ? "no experiment on it" : `experiment ${exp.id ?? "?"} "${exp.name ?? ""}", in_experiment ${exp.inExperiment}`;
  const where =
    fs.source === "segment_override"
      ? `the override from segment ${fs.segment?.name ?? fs.segment?.id ?? "?"}`
      : "the environment's own feature state";
  lines.push(`${step++}. Feature state used: ${where}, id ${fs.id}, ${fs.enabled ? "enabled" : "disabled"}, ${expText}.`);
  if (w.split === null) {
    lines.push(`${step++}. The feature state has no variants, so there is no split.`);
  } else {
    const ranges = w.split.ranges.map((r) => `${r.variant ?? "(no key)"} [${r.start}, ${r.end})`).join(", ");
    lines.push(`${step++}. Split: ${hashLine(w.split.hash)}.`);
    lines.push(`${step++}. Ranges in variant id order: ${ranges}. ${pct(w.split.hash.percentage)} falls in ${w.variant ?? "(no key)"}.`);
  }
  lines.push(`Variant: ${w.variant ?? "none"}.`);
  return lines.join("\n");
}
