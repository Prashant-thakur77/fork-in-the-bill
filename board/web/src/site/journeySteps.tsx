import type { JourneyStep } from "../art/Journey";
import { repo } from "./data";

const c = repo.policies.control;
const v = repo.policies.lanes_v1;
const split = repo.split;

export const JOURNEY_STEPS: JourneyStep[] = [
  {
    title: "Queue",
    text: (
      <>
        A task is one real bug from SWE-bench-Live. It waits in the queue as the Flagsmith identity <code>swelive:&lt;instance_id&gt;</code>.
      </>
    ),
  },
  {
    title: "Flagsmith picks the lane",
    text: (
      <>
        The runner calls <code>get_experiment_flag("agent_routing")</code> for that identity. Flagsmith hashes it and serves a variant
        {split !== null ? ` (${100 - split}/${split} split)` : ""}. The runner never chooses an arm.
      </>
    ),
  },
  {
    title: "The lane runs",
    text: (
      <>
        The flag value is the routing policy. <code>control</code> sends worker calls to {c?.delegateShort}; <code>lanes_v1</code> sends them to {v?.delegateShort}.
        The exposure is recorded at this moment.
      </>
    ),
  },
  {
    title: "Events, same identity",
    text: (
      <>
        After grading, the runner sends <code>task_cost</code>, <code>task_turns</code>, <code>task_seconds</code> and, only on a solve, <code>task_solved</code>, all
        with the identity that was exposed.
      </>
    ),
  },
  {
    title: "Results",
    text: <>Flagsmith joins the events to the exposures in its warehouse and reports, per metric, the chance each variant beats control.</>,
  },
  {
    title: "Decision",
    text: <>The rule written before the first task reads those numbers. All three checks pass, or control stays.</>,
  },
  {
    title: "Rollout",
    text: <>End the experiment, set the winner's value on the same flag, and the next batch of tasks gets it with no deploy.</>,
  },
];
