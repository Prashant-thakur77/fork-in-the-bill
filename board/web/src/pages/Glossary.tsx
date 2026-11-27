import type { ReactNode } from "react";
import { DocPage } from "../site/DocPage";
import { Link } from "../site/router";

export const TERMS: { term: string; def: ReactNode; see?: [string, string] }[] = [
  { term: "Amendment", def: "A change to the registered plan, written as its own hashed file before it applies. The original file is never edited.", see: ["/method#amendment", "The amendment"] },
  { term: "Arm", def: "One version of the agent in the experiment. Every task runs in exactly one arm, chosen by Flagsmith." },
  { term: "Chance to beat control", def: "Flagsmith's estimate of the probability that a variant does better than control on a metric. Rule 1 of the decision uses it for cost.", see: ["/method#rule", "Decision rule"] },
  { term: "Control", def: "The arm the challenger is compared against. Here the frontier model does everything, and its policy is the flag's own value." },
  { term: "Delegate lane", def: "Another name for the worker lane: the model that does searching, builds and test runs for the planner." },
  { term: "Drift", def: "Any difference between the live Flagsmith flags and the Terraform code that describes them. The drift check must find none.", see: ["/flagsmith#terraform", "Terraform drift"] },
  { term: "Edge Proxy", def: "A Flagsmith service you run near your app that serves flags from a polled copy of the environment. It serves values but no variant key.", see: ["/flagsmith#modes", "Evaluation modes"] },
  { term: "Environment document", def: "The full flag configuration of one Flagsmith environment. Saved during the run, it is what the offline assignment check evaluates." },
  { term: "Event", def: "A number sent to Flagsmith for an identity, such as task_cost. Flagsmith counts only events at or after that identity's exposure." },
  { term: "Exposure", def: "The record that an identity was served a variant in a running experiment. Sent once per task, where the policy is applied.", see: ["/flagsmith#exposure", "Exposure"] },
  { term: "FAIL_TO_PASS / PASS_TO_PASS", def: "The tests SWE-bench-Live uses to grade a fix: the first set must start passing, the second must keep passing. A task is solved only if both hold." },
  { term: "Flag-engine", def: "Flagsmith's open-source evaluation library, the same code the SDKs use for local evaluation. Used here to recompute every arm offline.", see: ["/flagsmith#engine", "Flag-engine check"] },
  { term: "Fresh tier", def: "Tasks created after the models' training cutoff, so the models cannot have seen them. Experiment 1's registered pool." },
  { term: "Guardrail", def: "A metric the change must not hurt. Here it is the solve rate: a cheaper arm that solves far fewer bugs does not ship." },
  { term: "Identity", def: "Flagsmith's unit of assignment. Each task is one identity, swelive:<instance_id>, used for the exposure and every event." },
  { term: "Kill switch", def: "The routing_kill flag. When on, tasks run control with no exposure, so the experiment's data stays clean.", see: ["/flagsmith#kill", "Kill switch"] },
  { term: "lanes_v1", def: "The challenger in experiment 1: the same planner, with a small model in the worker lane." },
  { term: "lanes_v2", def: "The challenger in experiment 2: the small model drafts the patch and the frontier model reviews it." },
  { term: "Ledger", def: "An append-only file of run records where each record's hash includes the previous one, so an edit breaks every later hash.", see: ["/proof#rules", "Hashing rules"] },
  { term: "Margin m", def: "How far the solve rate may drop and still pass rule 2. Set from the pilot before the run.", see: ["/method#margin", "The margin"] },
  { term: "Merkle root", def: "One hash computed over every finished task's record. If two people get the same root, they have the same set of tasks." },
  { term: "OpenFeature", def: "A vendor-neutral feature flag API. The kit can read the policy and send events through it with the official Flagsmith provider." },
  { term: "Planner lane", def: "The main model of the agent. It reads files, writes the fix, delegates grunt work and submits. It has no shell." },
  { term: "Policy", def: "The JSON value of the routing flag: which model runs each lane, token limits and caps. Remote config, changed without a deploy." },
  { term: "Posterior", def: "Our own estimate of the solve-rate difference, from a Beta(1,1) model of each arm. Rule 2 reads it, alongside Flagsmith's numbers." },
  { term: "Pre-cutoff tier", def: "Tasks created before the models' training cutoff. Used for the pilot, the rollout batch, experiment 2 and the amendment, and reported separately." },
  { term: "Pre-registration", def: "The plan, hypothesis and decision rule, hashed and tagged in git before the first task of the main run.", see: ["/method#registration", "The registration"] },
  { term: "Rollout", def: "After the experiment ends, the winner's value becomes the flag's value and new tasks get it, on the same flag." },
  { term: "Snapshot", def: "A saved copy of the environment document, taken through the run. One distinct hash across all of them means the flag never changed." },
  { term: "SRM", def: "Sample-ratio mismatch: when the arms' sizes differ more than a fair split would allow. A sign that assignment or counting broke." },
  { term: "Stratum", def: "The slice of the dataset the pools are drawn from: small fixes, in a fixed set of languages. Results apply to this slice." },
  { term: "SWE-bench-Live", def: "A public dataset of real GitHub issues with the fix and the tests that check it, refreshed with new issues over time." },
  { term: "Variant", def: "A named value of a multivariate flag. lanes_v1 is the variant; control is the flag's own value." },
  { term: "Worker lane", def: "The model that runs bash in the task's container and reports back as JSON. The only thing that differs between the arms." },
];

export default function Glossary() {
  const letters = [...new Set(TERMS.map((t) => t.term[0]!.toUpperCase()))];
  return (
    <DocPage path="/glossary" lead={<>The words this site uses, in plain terms. Each one links to the page where it matters most.</>}>
      <nav className="gl-letters" aria-label="Jump to letter">
        {letters.map((l) => (
          <a key={l} href={`#gl-${l.toLowerCase()}`}>
            {l}
          </a>
        ))}
      </nav>
      <dl className="glossary">
        {TERMS.map((t, i) => {
          const first = i === 0 || TERMS[i - 1]!.term[0]!.toUpperCase() !== t.term[0]!.toUpperCase();
          return (
            <div className="gl-item" key={t.term} id={first ? `gl-${t.term[0]!.toLowerCase()}` : undefined}>
              <dt>{t.term}</dt>
              <dd>
                {t.def}
                {t.see && (
                  <>
                    {" "}
                    <Link to={t.see[0]}>{t.see[1]} →</Link>
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </DocPage>
  );
}
