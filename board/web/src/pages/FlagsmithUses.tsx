import { DocPage } from "../site/DocPage";
import { Link } from "../site/router";
import { Code, RepoCode, Section } from "../site/ui";
import { ghFile, repo } from "../site/data";

const S = repo.snippets;
const V = repo.versions;
const ids = repo.ids;

const TOC = [
  { id: "experiment", label: "Experiment and metrics" },
  { id: "exposure", label: "Exposure at the point of use" },
  { id: "events", label: "Events, same identity" },
  { id: "kill", label: "Kill switch" },
  { id: "rollout", label: "End, then roll out" },
  { id: "engine", label: "Flag-engine check" },
  { id: "terraform", label: "Terraform drift" },
  { id: "webhooks", label: "Webhooks" },
  { id: "health", label: "Feature health" },
  { id: "modes", label: "Evaluation modes and Edge Proxy" },
  { id: "openfeature", label: "OpenFeature" },
  { id: "selfhost", label: "Self-hosted" },
];

export default function FlagsmithUses() {
  return (
    <DocPage
      path="/flagsmith"
      toc={TOC}
      lead={
        <>
          Every Flagsmith feature this project uses, in the order a task meets them, each with the code or command from the repo. Snippets are read from the
          files when the site is built.
        </>
      }
    >
      <Section id="experiment" title="An experiment with four metrics" kicker="One multivariate flag, one keyed variant, four metrics, one experiment.">
        <p className="prose">
          The flag <code>agent_routing</code>
          {ids ? ` (feature ${ids.features.agent_routing})` : ""} holds the control policy as its value and <code>lanes_v1</code> as a keyed variant. The
          experiment body sets the split and the metrics with their expected direction. <code>task_cost</code> is the primary metric;{" "}
          <code>task_solved</code> is the guardrail.
        </p>
        <RepoCode s={S.experimentBody!} />
        <RepoCode s={S.metricCost!} />
        <p className="prose">Starting it is one Admin API call through the Flagsmith CLI. The flag is locked while the experiment runs.</p>
        <RepoCode s={S.start!} />
      </Section>

      <Section id="exposure" title="Exposure at the point of use" kicker="The exposure is recorded where the policy is applied, once per task.">
        <p className="prose">
          <code>get_experiment_flag</code> records the exposure with the variant key as its value. The runner flushes it before tracking anything else,
          because the SDK drops the oldest buffered event when a second one arrives too soon (DECISIONS.md D9). An invalid value fails closed to control.
        </p>
        <RepoCode s={S.assign!} />
      </Section>

      <Section id="events" title="Events with the same identity" kicker="Every exposed task sends its cost, turns and seconds; a solve sends task_solved.">
        <RepoCode s={S.events!} />
      </Section>

      <Section id="kill" title="The kill switch" kicker="A second flag, read without an exposure.">
        <p className="prose">
          When <code>routing_kill</code> is on, a task runs the control policy, sends no exposure and no events, and is written to the ledger as{" "}
          <code>kill_switch</code>. The experiment's data never holds a task the runner forced into an arm.
        </p>
        <RepoCode s={S.killFlag!} />
      </Section>

      <Section id="rollout" title="End the experiment, then roll out on the same flag" kicker="The decision is applied with Flagsmith, not with a deploy.">
        <p className="prose">
          Ending an experiment takes a rollout decision. The winning variation's value becomes the flag's value, and a fresh batch of tasks runs on the same
          flag with no code change. The call below is the one the smoke test used to finish its own throwaway experiment.
        </p>
        <RepoCode s={S.complete!} />
      </Section>

      <Section id="engine" title="Every arm recomputed with the flag-engine" kicker="Same code path as the SDK's local evaluation, run offline.">
        <p className="prose">
          <code>integrity/verify_assignment.py</code> loads a saved environment document and evaluates every identity with{" "}
          <code>flagsmith-flag-engine</code>
          {V.flagEngine ? ` ${V.flagEngine}` : ""}. Any task whose recorded variant differs fails the check. CI runs it on every committed run.
        </p>
        <RepoCode s={S.engine!} />
        <RepoCode s={S.verifyUsage!} lang="sh" />
      </Section>

      <Section id="terraform" title="Flags as Terraform, with zero drift" kicker="Described as code, planned against the live project, never applied.">
        <p className="prose">
          An apply mid-run would publish new feature-state versions on the flag the experiment is splitting, so the CLI scripts stay the only writers.{" "}
          <code>make flags-drift</code> runs a read-only plan that must report no change.
        </p>
        <RepoCode s={S.terraform!} />
        <Code code={`make flags-drift\n${S.drift!.code}`} lang="sh" caption="infra/flagsmith/README.md" href={ghFile("infra/flagsmith/README.md", S.drift!.line)} />
      </Section>

      <Section id="webhooks" title="Signed webhooks into the board" kicker="Every change to the flag reaches the public flag history.">
        <p className="prose">
          The board's Worker takes Flagsmith's environment and audit-log webhooks, checks <code>X-Flagsmith-Signature</code>, and stores one row per change
          with no author and no raw values. The <Link to="/live">live board</Link> draws them as mileposts.
        </p>
        <RepoCode s={S.webhook!} />
      </Section>

      <Section id="health" title="Feature health, infrastructure only" kicker="Unhealthy on infra errors or budget, never on outcomes.">
        <p className="prose">
          <code>runner/health.py</code> posts to Flagsmith's Feature health webhook when the share of <code>infra_error</code> tasks or the budget crosses a
          line. It never reads solve rates or costs per arm, so it cannot become a way to peek.
        </p>
        <RepoCode s={S.health!} lang="sh" />
      </Section>

      <Section id="modes" title="Four evaluation modes and the Edge Proxy" kicker="Same flag, four places to read it from.">
        <RepoCode s={S.modes!} lang="sh" />
        <p className="prose">
          Local evaluation records exposures because the environment document carries the experiment metadata. The Edge Proxy
          {V.edgeProxy ? ` ${V.edgeProxy}` : ""} serves the right value but no variant, so <code>edge</code> serves flags without running an experiment, and{" "}
          <code>edge-local</code> keeps the experiment working through the proxy. The kit checks that every mode serves the same policy to the same identities.
        </p>
      </Section>

      <Section id="openfeature" title="Through OpenFeature" kicker="The official Flagsmith provider behind the kit's client interface.">
        <RepoCode s={S.openfeature!} />
        <p className="prose">
          The policy is resolved as a string flag, the exposure is sent with OpenFeature <code>track()</code>, and every evaluation and event uses the task's
          identity as the targeting key.
        </p>
      </Section>

      <Section id="selfhost" title="On self-hosted Flagsmith" kicker="The kit's experiment, run end to end on your own machine.">
        <p className="prose">
          Open-source Flagsmith{V.flagsmithImage ? ` ${V.flagsmithImage}` : ""} with experimentation on, the Flagsmith database as the warehouse, and the
          same flag, metrics, exposures and events as Cloud. The loop is a deterministic fake, so no model is called and no money is spent.
        </p>
        <RepoCode s={S.selfhost!} lang="sh" />
      </Section>
    </DocPage>
  );
}
