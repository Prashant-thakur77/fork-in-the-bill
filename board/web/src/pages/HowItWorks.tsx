import { DocPage } from "../site/DocPage";
import { Link } from "../site/router";
import { RepoCode, Section } from "../site/ui";
import { DecisionText } from "../site/DecisionText";
import { ghFile, repo, usd } from "../site/data";
import { HarnessDiagram } from "../art/HarnessDiagram";

const C = repo.policies.control;
const V = repo.policies.lanes_v1;
const H = repo.harness;
const prices = repo.pricing?.models ?? {};

const TOC = [
  { id: "lanes", label: "Two lanes" },
  { id: "delegation", label: "Delegation" },
  { id: "caps", label: "Costs and caps" },
  { id: "same", label: "What both arms share" },
  { id: "grading", label: "Grading" },
];

export default function HowItWorks() {
  return (
    <DocPage
      path="/how-it-works"
      toc={TOC}
      lead={
        <>
          One coding agent, split into a planner and a worker. Both arms run the same agent; they differ only in the model behind the worker. Each task is a
          real bug from SWE-bench-Live, graded by that repo's own tests.
        </>
      }
    >
      <Section id="lanes" title="Two lanes inside one container" kicker="The planner decides and writes; the worker searches, builds and runs tests.">
        <HarnessDiagram planner={C?.mainShort ?? "planner"} worker={`${C?.delegateShort ?? ""} or ${V?.delegateShort ?? ""}`} />
        <div className="prose">
          <p>
            <strong>Planner lane.</strong> It has four tools: read up to {H.viewMaxLines ?? "a fixed number of"} numbered lines of one file, edit a file,
            hand a job to the worker, and submit. It has no shell, so anything that needs searching or running goes through the worker.
          </p>
          <p>
            <strong>Worker lane.</strong> It has <code>bash</code> in the same container, with up to{" "}
            {H.delegateOutputBytes ? `${(H.delegateOutputBytes / 1000).toFixed(0)} KB` : "a capped amount"} of output per command. It works in its own
            conversation and answers with JSON. The planner never sees its transcript.
          </p>
        </div>
        <RepoCode s={repo.snippets.tools!} />
      </Section>

      <Section id="delegation" title="How a job is handed off" kicker="The planner asks; the worker digs; a short answer comes back.">
        <div className="prose">
          <p>
            The planner calls <code>delegate</code> with a task in plain words. The worker gets its own tool loop of at most {H.delegateMaxTurns ?? "a few"}{" "}
            turns and must end with <code>{"{summary, findings[], confidence}"}</code>. Only that JSON enters the planner's context, which is why the worker's
            model can be small: it reads the long output, the planner reads the summary.
          </p>
        </div>
        <DecisionText id="D18" />
      </Section>

      <Section id="caps" title="Costs and caps" kicker="Read from the flag values. Identical in both arms.">
        {C && V && (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Policy settings by arm">
            <table className="data-table">
              <caption className="sr-only">Routing policy settings for each arm, from flagsmith/policies</caption>
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col">control</th>
                  <th scope="col">lanes_v1</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Planner model", C.main.model, V.main.model],
                    ["Worker model", C.delegate.model, V.delegate.model],
                    ["Planner max tokens per call", C.main.max_tokens, V.main.max_tokens],
                    ["Worker max tokens per call", C.delegate.max_tokens, V.delegate.max_tokens],
                    ["Worker context limit", C.delegate.max_context_tokens, V.delegate.max_context_tokens],
                    ["Effort, planner / worker", `${C.main.effort} / ${C.delegate.effort}`, `${V.main.effort} / ${V.delegate.effort}`],
                    ["Cap: planner turns", C.caps.turns, V.caps.turns],
                    ["Cap: dollars per task", usd(C.caps.usd_per_task), usd(V.caps.usd_per_task)],
                    ["Cap: agent seconds", C.caps.seconds, V.caps.seconds],
                    [
                      "Worker input price, per MTok",
                      prices[C.delegate.model] ? usd(prices[C.delegate.model]!.input) : "—",
                      prices[V.delegate.model] ? usd(prices[V.delegate.model]!.input) : "—",
                    ],
                  ] as [string, string | number, string | number][]
                ).map(([k, a, b]) => (
                  <tr key={k} className={a !== b ? "is-hl" : ""}>
                    <th scope="row">{k}</th>
                    <td>
                      <code>{String(a)}</code>
                    </td>
                    <td>
                      <code>{String(b)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="prose small">
          Highlighted rows differ between arms. Sources: <a href={ghFile("flagsmith/policies/control.json")}>control.json</a>,{" "}
          <a href={ghFile("flagsmith/policies/lanes_v1.json")}>lanes_v1.json</a>, <a href={ghFile("harness/pricing.json")}>pricing.json</a>.
        </p>
        <DecisionText id="D6" />
        <DecisionText id="D7" />
      </Section>

      <Section id="same" title="What both arms share" kicker="A clean A/B test changes one thing.">
        <DecisionText id="D2" />
        <DecisionText id="D3" />
      </Section>

      <Section id="grading" title="How a fix is graded" kicker="The repo's own tests, in a fresh container, after the agent has stopped.">
        <RepoCode s={repo.snippets.grading!} lang="sh" />
        <DecisionText id="D11" />
        <DecisionText id="D15" />
        <p className="doc-next">
          <Link to="/why-flagsmith" className="text-link">
            Next: how Flagsmith assigns each task <span aria-hidden="true">→</span>
          </Link>
        </p>
      </Section>
    </DocPage>
  );
}
