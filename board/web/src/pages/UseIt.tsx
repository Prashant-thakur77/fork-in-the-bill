import { useRef, useState, type ReactNode } from "react";
import { Blocks, Code, Kinetic, PageHead, RepoCode, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { pageMeta } from "../site/routes";
import { ghFile, repo } from "../site/data";
import { Shot } from "../site/Shot";

// A getting-started guide. Every command and code block is cut from a file in the repository when
// the site is built (the README, the kit's own README, the self-host scripts), and package names
// are read from the packages' manifests, so a rename or a release shows up here on the next build.

const S = repo.snippets;
const K = repo.kit;
const V = repo.versions;
const repoDir = repo.site.repo.split("/").pop() ?? "fork-in-the-bill";

type Lang = "py" | "ts" | "of";
const LANGS: { key: Lang; label: string }[] = [
  { key: "py", label: "Python" },
  { key: "ts", label: "TypeScript" },
  { key: "of", label: "OpenFeature" },
];

function Step({ n, id, title, children }: { n: number; id: string; title: string; children: ReactNode }) {
  return (
    <section className="use-step" id={id} aria-labelledby={`${id}-h`}>
      <div className="use-km" aria-hidden="true">
        <span>step</span>
        <b>{n}</b>
      </div>
      <div className="use-body">
        <Kinetic id={`${id}-h`} text={title} />
        {children}
      </div>
    </section>
  );
}

function LangTabs({ lang, setLang, id }: { lang: Lang; setLang: (l: Lang) => void; id: string }) {
  return (
    <div className="tabs use-tabs" role="tablist" aria-label="Language">
      {LANGS.map((l, i) => (
        <button
          key={l.key}
          role="tab"
          type="button"
          id={`${id}-tab-${l.key}`}
          aria-selected={lang === l.key}
          aria-controls={`${id}-panel`}
          tabIndex={lang === l.key ? 0 : -1}
          onClick={() => setLang(l.key)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const next = LANGS[(i + (e.key === "ArrowRight" ? 1 : LANGS.length - 1)) % LANGS.length]!.key;
            setLang(next);
            document.getElementById(`${id}-tab-${next}`)?.focus();
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export default function UseIt() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  const [lang, setLang] = useState<Lang>("py");
  const tsName = K.ts?.name ?? "the TypeScript kit";
  return (
    <div className="page-wrap use-page" ref={root}>
      <PageHead
        route={pageMeta("/use-it")}
        lead={
          <>
            Put your own agent on a Flagsmith experiment in six steps. The kit does what this study's runner does: one task is one identity, the flag's value is the
            routing policy, and four events carry the outcome.
          </>
        }
      >
        <div className="cta-row">
          <a className="btn btn-sheet" href={ghFile("kit")} rel="noopener">
            Kit source <span aria-hidden="true">↗</span>
          </a>
          <Link className="btn btn-ghost-sheet" to="/use-it#kit">
            Kit reference
          </Link>
        </div>
      </PageHead>

      <nav className="use-map" aria-label="Steps">
        {["Flagsmith", "Get the kit", "Create the flag", "Wrap your loop", "Read the result", "MCP server"].map((t, i) => (
          <a key={t} href={`#use-${i + 1}`}>
            <b>{i + 1}</b>
            {t}
          </a>
        ))}
      </nav>

      <Step n={1} id="use-1" title="Have a Flagsmith environment">
        <p className="prose">
          You need a project with experimentation on and a server-side environment key. Flagsmith Cloud works as it is. To try everything on your own machine first,
          the repository brings up open-source Flagsmith{V.flagsmithImage ? ` ${V.flagsmithImage}` : ""} with experimentation enabled, in Docker Compose.
        </p>
        <RepoCode s={S.selfhostRun!} lang="sh" />
        <p className="prose small">
          The self-hosted path uses a fake agent loop: no model is called and no money is spent. It needs Docker with Compose v2, <code>jq</code>, <code>curl</code>,{" "}
          <code>openssl</code> and the Flagsmith CLI. Details and the verified run are in <a href={ghFile("selfhost/README.md")}>selfhost/README.md</a>. To remove it
          again:
        </p>
        <RepoCode s={S.selfhostDown!} lang="sh" />
      </Step>

      <Step n={2} id="use-2" title="Get the kit">
        <div className="use-two">
          <div>
            <h3>Python</h3>
            <Code code={`git clone ${repo.site.repo}.git\ncd ${repoDir}\nuv sync`} lang="sh" caption="shell" />
            <p className="prose small">
              Package <code>forkbill</code> in <a href={ghFile("kit/forkbill")}>kit/forkbill</a>
              {K.py.python ? `, Python ${K.py.python.replace(">=", "")} or later` : ""}, Flagsmith SDK {V.pythonSdk ?? ""}. <code>uv sync</code> also installs the{" "}
              <code>{K.py.script ?? "forkbill"}</code> command.
            </p>
          </div>
          <div>
            <h3>TypeScript</h3>
            <RepoCode s={S.tsInstall!} lang="sh" />
            <p className="prose small">
              Package <code>{tsName}</code>
              {K.ts ? ` ${K.ts.version}` : ""} in <a href={ghFile("kit/ts")}>kit/ts</a>
              {K.ts?.node ? `, Node ${K.ts.node.replace(">=", "")} or later` : ""}, <code>@flagsmith/nodejs</code> {V.nodeSdk ?? ""}.
              {K.ts?.published ? " To work on the package itself, build it from the repository:" : ""}
            </p>
            {K.ts?.published && <RepoCode s={S.tsBuild!} lang="sh" />}
          </div>
        </div>
      </Step>

      <Step n={3} id="use-3" title="Create the flag, the variant, the metrics and the experiment">
        <p className="prose">
          One command creates the flag with your control policy as its value, a keyed variant for the challenger, the kill switch and the four metrics, and can
          create and start the experiment from your hypothesis file. Running it twice reuses what exists and stops on any difference.
        </p>
        <RepoCode s={S.kitInit!} lang="sh" />
        <p className="prose small">
          Start from this study's files and change the models: <a href={ghFile("flagsmith/policies/control.json")}>control.json</a>,{" "}
          <a href={ghFile("flagsmith/policies/lanes_v1.json")}>lanes_v1.json</a>, <a href={ghFile("flagsmith/metrics.json")}>metrics.json</a>. Write the hypothesis
          and the decision rule down first. <Link to="/method">How this study registered its own</Link>.
        </p>
        <Shot name="flags" caption="What that leaves in the Flagsmith dashboard for this study: agent_routing, the smoke-test flag and the routing_kill switch." />
      </Step>

      <Step n={4} id="use-4" title="Wrap your agent loop">
        <p className="prose">
          The kit reads the policy once per task, which records the exposure, tells your loop which model to call in each lane, prices every call you report, and
          sends the events when the task ends. Your model calls and your stopping test stay yours.
        </p>
        <LangTabs lang={lang} setLang={setLang} id="use-wrap" />
        <div role="tabpanel" id="use-wrap-panel" aria-labelledby={`use-wrap-tab-${lang}`} className="use-panel">
          {lang === "py" && <RepoCode s={S.kitPy!} lang="py" />}
          {lang === "ts" && <RepoCode s={S.kitTs!} lang="ts" />}
          {lang === "of" && (
            <>
              <RepoCode s={S.kitOpenFeature!} lang="py" />
              <p className="prose small">
                It needs the <code>openfeature</code> extra; the module's docstring gives it as <code>pip install {K.py.name ?? "fork-in-the-bill"}[openfeature]</code>.
                Through OpenFeature the exposure is sent
                with <code>track()</code> when the flag resolves to a variant; the module's docstring says when that over-counts control.
              </p>
            </>
          )}
        </div>
        <p className="prose small">
          For local evaluation or an Edge Proxy, build the client with <code>forkbill.client.make_client(mode, ...)</code> or <code>flagsmithConfig(mode, ...)</code>
          . <Link to="/use-it#modes">The four evaluation modes</Link>.
        </p>
      </Step>

      <Step n={5} id="use-5" title="Run your tasks and read the result">
        <div className="use-two">
          <div className="prose">
            <p>
              Run each task through the loop. When the last one has finished, Flagsmith's results page shows, per metric, the chance each variant beats control. Read
              it against the rule you wrote down in step 3, then end the experiment with the winner as the rollout decision.
            </p>
            <p>
              The kit sends events only for tasks that were exposed. A task under the kill switch, or one whose flag value was not a valid policy, runs control and
              is not counted.
            </p>
          </div>
          <ul className="use-events">
            {repo.metrics.map((m) => (
              <li key={m.name}>
                <code>{m.name}</code>
                <span>
                  {m.aggregation}, {m.role}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="prose small">
          What this study's own run looked like, live: <Link to="/live">the board</Link>. What the result looked like: <Link to="/results">the results</Link>.
        </p>
      </Step>

      <Step n={6} id="use-6" title="The MCP server">
        {K.mcp ? (
          <>
            <div className="prose">
              <p>
                <code>{K.mcp.name}</code> {K.mcp.version}
                {K.mcp.node ? `, Node ${K.mcp.node.replace(">=", "")} or later` : ""}. It gives any agent that speaks MCP the same loop as tools, built on the{" "}
                <code>{K.ts?.name ?? "forkbill"}</code> kit. The server never chooses an arm: if Flagsmith cannot serve a valid policy, the tool returns Flagsmith's
                error and no models.
              </p>
            </div>
            {K.mcp.blocks.map((b, i) => (
              <Code key={i} code={b.code} lang={b.lang === "bash" ? "sh" : b.lang} caption="your MCP client's configuration" href={ghFile("kit/mcp/README.md")} label="kit/mcp/README.md" />
            ))}
            {K.mcp.tools.length > 0 && (
              <ul className="use-events use-tools">
                {K.mcp.tools.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code>
                    <span>{t.does}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="prose small">
              Flagsmith needs the same four things as in step 3 before the first task. The tools' inputs and a worked example are in{" "}
              <a href={ghFile("kit/mcp/README.md")}>kit/mcp/README.md</a>.
            </p>
          </>
        ) : (
          <div className="use-soon" role="note">
            <span className="use-soon-tab">Coming with the next release</span>
            <p>
              An MCP server for the kit is being built in <code>kit/mcp</code>. It is not in this build of the repository, so there is nothing to install yet and
              nothing is described here. This block fills itself from that package's own files once they are merged.
            </p>
            <Link to="/updates" className="text-link">
              Get one email when it ships <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
      </Step>
    </div>
  );
}
