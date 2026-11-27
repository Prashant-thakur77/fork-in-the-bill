import { DocPage } from "../site/DocPage";
import { Md, Section } from "../site/ui";
import { ghFile, repo } from "../site/data";

// Read from PROGRESS.md: the phase table becomes milestone signs along one road, the log
// becomes mileposts. Status words map to lane-use signals.

export function signalOf(status: string): "done" | "live" | "work" | "wait" {
  const s = status.toLowerCase();
  if (s.startsWith("done")) return "done";
  if (s.startsWith("running")) return "live";
  if (s.startsWith("in progress")) return "work";
  return "wait";
}

const SIGNAL_LABEL = { done: "Done", live: "Running now", work: "In progress", wait: "Not started" };

function Signal({ kind }: { kind: ReturnType<typeof signalOf> }) {
  return (
    <span className={`tl-signal is-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        {kind === "work" ? <path d="M10 30 L30 10 M16 10 H30 V24" /> : <path d="M20 6 V30 M10 21 L20 32 L30 21" />}
      </svg>
    </span>
  );
}

export default function Timeline() {
  const { phases, log } = repo.progress;
  return (
    <DocPage
      path="/timeline"
      lead={
        <>
          The study, phase by phase, from the first Flagsmith smoke test to the second experiment. Read from{" "}
          <a href={ghFile("PROGRESS.md")}>PROGRESS.md</a> when this site was built. A phase counts as done only when its gate passes.
        </>
      }
    >
      <Section id="phases" title="Phases" kicker="Each sign is one phase. The signal shows its state; the evidence is what passed the gate.">
        <ol className="tl-road" data-reveal="row">
          {phases.map((p) => {
            const kind = signalOf(p.status);
            return (
              <li key={p.n} className={`tl-stop is-${kind}`}>
                <span className="tl-km" aria-hidden="true">
                  {p.n}
                </span>
                <div className="tl-sign">
                  <div className="tl-sign-top">
                    <Signal kind={kind} />
                    <span className="tl-status">
                      {kind === "wait" && p.status !== "not started" ? `Waiting · ${p.status}` : SIGNAL_LABEL[kind]}
                    </span>
                  </div>
                  <h3>
                    <span className="sr-only">Phase {p.n}: </span>
                    {p.phase}
                  </h3>
                  {p.evidence && (
                    <details className="tl-evidence">
                      <summary>Gate evidence</summary>
                      <p>
                        <Md text={p.evidence} />
                      </p>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
      <Section id="log" title="Log" kicker="Dated notes from the run, oldest first.">
        <ol className="flaglog-list tl-log">
          {log.map((l, i) => (
            <li key={i} className="flaglog-row">
              <span className="flaglog-time">{l.date}</span>
              <span className="flaglog-mark" aria-hidden="true" />
              <span className="flaglog-what">
                <span>
                  <Md text={l.text} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </DocPage>
  );
}
