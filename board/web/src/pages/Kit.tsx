import { DocPage } from "../site/DocPage";
import { Link } from "../site/router";
import { Code, RepoCode, Section } from "../site/ui";
import { ghFile, repo } from "../site/data";
import { PY_QUICKSTART } from "../site/quickstart";

const S = repo.snippets;
const V = repo.versions;

const TOC = [
  { id: "what", label: "What it does" },
  { id: "setup", label: "Set up the flag" },
  { id: "python", label: "Python quickstart" },
  { id: "typescript", label: "TypeScript quickstart" },
  { id: "modes", label: "Evaluation modes" },
  { id: "openfeature", label: "OpenFeature" },
  { id: "selfhost", label: "Self-hosting" },
];

export default function Kit() {
  return (
    <DocPage
      path="/kit"
      toc={TOC}
      lead={
        <>
          The kit turns any agent loop into a two-lane loop driven by a Flagsmith experiment flag. It does what this study's runner does, so your own agent
          can answer the same question with the same method.
        </>
      }
      headExtra={
        <div className="cta-row">
          <a className="btn btn-sheet" href={ghFile("kit")} rel="noopener">
            Kit source on GitHub <span aria-hidden="true">↗</span>
          </a>
        </div>
      }
    >
      <Section id="what" title="What it does for one task" kicker="One task is one Flagsmith identity.">
        <ol className="steps-list" data-reveal="row">
          <li>
            Reads <code>routing_kill</code> without an exposure. If it is on, the task runs control and is not counted.
          </li>
          <li>
            Reads <code>agent_routing</code> with <code>get_experiment_flag</code>, which records the exposure, and validates the value as a routing policy.
            A bad value fails closed to control.
          </li>
          <li>Tells your loop which model to call in each lane and prices every call you report.</li>
          <li>
            On <code>finish</code>, sends <code>task_cost</code>, <code>task_turns</code>, <code>task_seconds</code> and, on a solve, <code>task_solved</code>,
            flushing after each one.
          </li>
        </ol>
      </Section>

      <Section id="setup" title="Set up the flag, variants and metrics" kicker="One command creates everything, through the Flagsmith CLI.">
        <p className="prose">
          <code>forkbill init</code> creates the flag with your control policy as its value, a keyed variant per challenger, the kill switch and the metrics,
          and can create and start the experiment from your pre-registration file. Running it twice reuses what exists and stops on any difference.
        </p>
        <RepoCode s={S.forkbillInit!} lang="sh" />
        <p className="prose small">
          Policies: <a href={ghFile("flagsmith/policies/control.json")}>control.json</a>, <a href={ghFile("flagsmith/policies/lanes_v1.json")}>lanes_v1.json</a>.
          Metrics: <a href={ghFile("flagsmith/metrics.json")}>metrics.json</a>.
        </p>
      </Section>

      <Section id="python" title="Python quickstart" kicker={`Flagsmith Python SDK ${V.pythonSdk ?? ""}. Package forkbill, in kit/forkbill.`}>
        <Code code={"git clone " + repo.site.repo + ".git\ncd fork-in-the-bill && uv sync\nPYTHONPATH=kit uv run python -m forkbill.cli --help"} lang="sh" caption="shell" />
        <Code code={PY_QUICKSTART} lang="py" caption="your_agent.py" />
        <p className="prose">
          <code>call_model</code>, <code>done</code> and <code>needs_grunt_work</code> are yours. Everything else is the kit's public API. A fake loop that
          runs without any model is in <a href={ghFile("kit/forkbill/demo.py", S.demoLoop!.line)}>kit/forkbill/demo.py</a>.
        </p>
      </Section>

      <Section id="typescript" title="TypeScript quickstart" kicker={`@flagsmith/nodejs ${V.nodeSdk ?? ""}. Package ${repo.kit.ts?.name ?? "forkbill"}${repo.kit.ts ? ` ${repo.kit.ts.version}` : ""}, in kit/ts.`}>
        <RepoCode s={S.tsInstall!} lang="sh" />
        <p className="prose small">To work on the package itself, it sits in an npm workspace under kit/ with the MCP server:</p>
        <RepoCode s={S.tsBuild!} lang="sh" />
        <RepoCode s={S.tsUsage!} lang="ts" />
      </Section>

      <Section id="modes" title="Four evaluation modes" kicker="Pick where flags come from. Events always go to the core API.">
        <RepoCode s={S.modes!} lang="sh" />
        <p className="prose">
          In <code>edge</code> the Edge Proxy serves the right value but no variant, so no exposure is recorded and the kit sends no task events. Use{" "}
          <code>edge-local</code> to run an experiment through the proxy. <code>forkbill compare</code> reads the flag for the same identities in every mode
          and stops unless they agree. More on the <Link to="/flagsmith#modes">Flagsmith page</Link>.
        </p>
      </Section>

      <Section id="openfeature" title="Through OpenFeature" kicker="Use the official Flagsmith provider behind the same RoutedLanes.">
        <RepoCode s={S.openfeature!} />
        <p className="prose">
          Install the extra with <code>pip install fork-in-the-bill[openfeature]</code>. The exposure is sent with OpenFeature <code>track()</code> by
          default; the provider's exposure hook is also supported.
        </p>
      </Section>

      <Section id="selfhost" title="Self-hosting" kicker={`Open-source Flagsmith ${V.flagsmithImage ?? ""} with experimentation on, in Docker Compose.`}>
        <RepoCode s={S.selfhost!} lang="sh" />
        <p className="prose">
          The demo uses the Flagsmith database as the warehouse, which suits a demo of a few hundred events. Full instructions, the verified run and the
          teardown command are in <a href={ghFile("selfhost/README.md")}>selfhost/README.md</a>.
        </p>
      </Section>
    </DocPage>
  );
}
