import { useRef } from "react";
import { Journey } from "../art/Journey";
import { RolloutPreview } from "../art/RolloutPreview";
import { SplitLab } from "../art/SplitLab";
import { Link } from "../site/router";
import { Kinetic, OnThisPage, PageHead, useReveals } from "../site/ui";
import { ghFile, repo, type Snippet } from "../site/data";
import { pageMeta } from "../site/routes";
import { JOURNEY_STEPS } from "../site/journeySteps";

const S = repo.snippets;
const V = repo.versions;

interface Role {
  id: string;
  title: string;
  body: React.ReactNode;
  code?: Snippet;
  more: string;
}

const ROLES: Role[] = [
  {
    id: "decides",
    title: "Flagsmith alone decides each arm",
    body: (
      <>
        For every task the runner calls <code>get_experiment_flag("agent_routing", identifier=identity)</code> and runs whatever policy comes back. There is
        no <code>random()</code> in the runner and no arm argument on the command line.
      </>
    ),
    code: S.assign,
    more: "/flagsmith#exposure",
  },
  {
    id: "hash",
    title: "The split is a hash anyone can recompute",
    body: (
      <>
        Bucketing is a deterministic hash of the identity and the experiment segment. From a saved environment document, every arm is recomputed offline
        with Flagsmith's own flag-engine{V.flagEngine ? ` ${V.flagEngine}` : ""}, and it must match what the run recorded.
      </>
    ),
    code: S.engine,
    more: "/flagsmith#engine",
  },
  {
    id: "exposure",
    title: "Exposure is recorded where the policy is used",
    body: (
      <>
        The exposure is sent at the moment the policy is applied, then flushed before anything else, so a task is counted in its arm only if it really ran
        that arm.
      </>
    ),
    code: S.assign,
    more: "/flagsmith#exposure",
  },
  {
    id: "events",
    title: "Events carry the same identity",
    body: (
      <>
        Cost, turns, seconds and solves go to Flagsmith with the identity that was exposed. Flagsmith counts only events at or after the first exposure.
      </>
    ),
    code: S.events,
    more: "/flagsmith#events",
  },
  {
    id: "results",
    title: "The warehouse gives chance to beat control",
    body: (
      <>
        Flagsmith's managed warehouse joins exposures to events and reports, per metric, the lift, its interval and the chance each variant beats control.
        That number is rule 1 of the decision.
      </>
    ),
    code: S.metricCost,
    more: "/flagsmith#experiment",
  },
  {
    id: "kill",
    title: "A kill switch that keeps the data clean",
    body: (
      <>
        <code>routing_kill</code> is read without an exposure. When it is on, a task runs control, sends no exposure and no events, and the ledger notes why.
      </>
    ),
    code: S.killFlag,
    more: "/flagsmith#kill",
  },
  {
    id: "rollout",
    title: "End the experiment, then roll out on the same flag",
    body: <>The winner's value becomes the flag's value. The next batch of tasks gets it with no code change and no deploy.</>,
    code: S.complete,
    more: "/flagsmith#rollout",
  },
  {
    id: "config",
    title: "The policy is remote config",
    body: (
      <>
        The flag's value is a JSON routing policy: models per lane, token limits, caps. The two values differ only in the worker's model, which the harness
        checks before it runs.
      </>
    ),
    code: S.policy,
    more: "/method#lanes",
  },
  {
    id: "terraform",
    title: "Flags described as code, checked for drift",
    body: <>The flags, the variant and the experiment's segment override are written as Terraform. A read-only plan must report no changes.</>,
    code: S.drift,
    more: "/flagsmith#terraform",
  },
  {
    id: "webhooks",
    title: "Signed webhooks feed the flag history",
    body: <>Every change to the routing flag reaches the live board as a signed Flagsmith webhook, so any edit during the run would show up in public.</>,
    code: S.webhook,
    more: "/flagsmith#webhooks",
  },
  {
    id: "health",
    title: "Feature health that cannot peek",
    body: <>The runner reports the flag's health to Flagsmith from infrastructure errors and budget only. It never reads an outcome metric.</>,
    code: S.health,
    more: "/flagsmith#health",
  },
  {
    id: "anywhere",
    title: "Runs anywhere Flagsmith runs",
    body: (
      <>
        The kit works with remote and local evaluation, through the Edge Proxy, through OpenFeature, and on self-hosted Flagsmith
        {V.flagsmithImage ? ` ${V.flagsmithImage}` : ""}.
      </>
    ),
    code: S.modes,
    more: "/flagsmith#modes",
  },
];

const WITHOUT: [string, string, string][] = [
  ["Who picks the arm", "Flagsmith hashes the identity. The runner cannot choose.", "A random() call in the runner. Nobody can show it was not re-rolled."],
  ["Proof of the split", "Recompute every arm offline from the saved environment document.", "Trust the log file the same script wrote."],
  ["Changing the routing", "Edit the flag value. The next task gets it.", "Change code, rebuild, redeploy the workers."],
  ["Counting who was in the test", "Exposure recorded at the point of use, same identity as the events.", "Join two log files by hand and hope the ids line up."],
  ["Reading the result", "Chance to beat control per metric, from the warehouse.", "A notebook, written after the data is in."],
  ["Stopping a bad arm", "Flip routing_kill. Killed tasks carry no exposure.", "Kill the process and clean the data afterwards."],
  ["Rolling out the winner", "End the experiment, serve the winner on the same flag.", "Another deploy, another untested path."],
  ["Showing nobody touched it", "Snapshots, a drift-free Terraform plan and signed webhooks.", "A promise."],
];

const TOC = [
  { id: "journey", label: "A task's journey" },
  { id: "roles", label: "What Flagsmith does" },
  { id: "without", label: "Without it" },
];

export default function WhyFlagsmith() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  return (
    <div className="page-wrap" ref={root}>
      <PageHead
        route={pageMeta("/why-flagsmith")}
        lead={
          <>
            This is a Flagsmith experiment, not a script with a Flagsmith call in it. Flagsmith decides every arm, records every exposure, measures the outcome
            and carries the rollout. Take it away and none of the result can be checked.
          </>
        }
      />
      <div className="doc">
        <OnThisPage items={TOC} />
        <div className="doc-body">
          <section id="journey" className="doc-section" aria-labelledby="journey-h">
            <Kinetic id="journey-h" text="A task's journey through Flagsmith" />
            <p className="doc-kicker">Scroll to drive two tasks from the queue to the rollout. Every step below is a Flagsmith feature doing real work.</p>
            <Journey steps={JOURNEY_STEPS} id="why-journey" />
            <SplitLab />
            <RolloutPreview />
          </section>

          <section id="roles" className="doc-section" aria-labelledby="roles-h">
            <Kinetic id="roles-h" text="What Flagsmith does in this experiment" />
            <p className="doc-kicker">Each job, with the file in the repo that does it.</p>
            <ol className="role-grid" data-reveal="row">
              {ROLES.map((r) => (
                <li key={r.id} className="role">
                  <h3>{r.title}</h3>
                  <p>{r.body}</p>
                  <p className="role-links">
                    {r.code && (
                      <a href={ghFile(r.code.file, r.code.line || undefined)} rel="noopener" className="role-file">
                        <code>
                          {r.code.file}
                          {r.code.line ? `:${r.code.line}` : ""}
                        </code>
                      </a>
                    )}
                    <Link to={r.more} className="role-more">
                      Code and details <span aria-hidden="true">→</span>
                    </Link>
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section id="without" className="doc-section" aria-labelledby="without-h">
            <Kinetic id="without-h" text="What would break without it" />
            <p className="doc-kicker">The same study, hand-rolled. Each row is something a reader could no longer check.</p>
            <div className="versus" role="table" aria-label="With Flagsmith compared with a hand-rolled experiment">
              <div className="vs-head" role="row">
                <span role="columnheader" className="vs-k">
                  <span className="sr-only">Concern</span>
                </span>
                <span role="columnheader" className="vs-open">
                  With Flagsmith
                </span>
                <span role="columnheader" className="vs-closed">
                  Hand-rolled
                </span>
              </div>
              {WITHOUT.map(([k, a, b]) => (
                <div className="vs-row" role="row" key={k}>
                  <span role="rowheader" className="vs-k">
                    {k}
                  </span>
                  <span role="cell" className="vs-a">
                    {a}
                  </span>
                  <span role="cell" className="vs-b">
                    {b}
                  </span>
                </div>
              ))}
            </div>
            <p className="doc-next">
              <Link to="/flagsmith" className="text-link">
                Every Flagsmith feature used, with code <span aria-hidden="true">→</span>
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
