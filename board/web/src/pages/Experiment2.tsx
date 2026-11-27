import { useRef } from "react";
import { Blocks, Kinetic, Md, PageHead, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { pageMeta } from "../site/routes";
import { ghFile, repo } from "../site/data";
import { batchOf, batchStatus, gapBetween, utcStamp } from "../site/batches";
import { LivePanel } from "../site/LivePanel";
import { useLiveState } from "../site/live";
import { PolicyDiff } from "../art/PriceBoard";
import { ResultPair } from "../site/ResultPair";
import { Shot } from "../site/Shot";

// Experiment 2, told in the order it happened: the question, the two roles, the registration,
// the run as it stands, and what will count as ship or keep. No figure from the run's analysis
// appears until numbers.json holds its decision; running totals are labelled as such.

const B2 = batchOf("exp2")!;
const B1 = batchOf("exp1")!;
const N2 = repo.numbers?.exp2 ?? null;
const SHIP2 = repo.decisions["exp2.decision.ship"];
const rule = repo.prereg2.decisionRule;
const ruleItems = (rule.find((b) => b.type === "list") as { items: string[] } | undefined)?.items ?? [];
const ruleElse = rule.filter((b) => b.type === "p").slice(1);
const main = repo.policies.lanes_v2?.mainShort ?? "the frontier model";
const small = repo.policies.lanes_v2?.delegateShort ?? "the small model";

/* ---------- the two roles, drawn as two lanes with one hand-off each ---------- */

function Glyph({ kind }: { kind: "read" | "write" | "review" | "test" }) {
  return (
    <svg viewBox="0 0 48 48" className="role-glyph" aria-hidden="true">
      {kind === "read" && (
        <>
          <path d="M4 24 C12 12 36 12 44 24 C36 36 12 36 4 24 Z" />
          <circle cx="24" cy="24" r="6" />
        </>
      )}
      {kind === "write" && <path d="M8 40 L10 30 L32 8 L40 16 L18 38 Z M28 12 L36 20" />}
      {kind === "review" && (
        <>
          <rect x="8" y="6" width="26" height="34" rx="3" />
          <path d="M14 16 H28 M14 24 H24" />
          <path className="is-accent" d="M22 34 L29 41 L42 26" />
        </>
      )}
      {kind === "test" && <path d="M10 8 H38 M18 8 V22 L8 40 H40 L30 22 V8 M14 30 H34" />}
    </svg>
  );
}

function RoleLane({ arm, legend, steps, note }: { arm: string; legend: string; steps: { who: string; model: string; does: string; glyph: "read" | "write" | "review" | "test"; small?: boolean }[]; note: string }) {
  return (
    <article className="role-lane" aria-label={`${arm}: ${legend}`}>
      <div className="role-sign">
        <span className="sign-tab">{arm}</span>
        <div className="role-sign-face">
          <h3>{legend}</h3>
          <p>{note}</p>
        </div>
      </div>
      <ol className="role-road">
        {steps.map((s, i) => (
          <li key={i} className={s.small ? "is-small" : "is-main"}>
            <Glyph kind={s.glyph} />
            <span className="role-who">
              {s.who} <small>{s.model}</small>
            </span>
            <span className="role-does">{s.does}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function Roles() {
  return (
    <div className="roles" data-reveal="row">
      <RoleLane
        arm="control"
        legend="Small model reads"
        note="The lanes_v1 policy, rolled out after experiment 1."
        steps={[
          { who: "Worker lane", model: small, does: "Explores the repository, reads files, runs the tests and reports back.", glyph: "read", small: true },
          { who: "Planner lane", model: main, does: "Writes every edit itself.", glyph: "write" },
          { who: "Worker lane", model: small, does: "Runs the tests again when asked.", glyph: "test", small: true },
        ]}
      />
      <RoleLane
        arm="lanes_v2"
        legend="Small model drafts"
        note="One switch changes the division of work."
        steps={[
          { who: "Worker lane", model: small, does: "Explores, then writes a first draft of the fix. It can edit files in this arm.", glyph: "write", small: true },
          { who: "Planner lane", model: main, does: "Reviews the draft and corrects it.", glyph: "review" },
          { who: "Worker lane", model: small, does: "Runs the tests again when asked.", glyph: "test", small: true },
        ]}
      />
    </div>
  );
}

/* ---------- registration: two mileposts on one line, registered then started ---------- */

function RegLine({ label, tag, sha, registeredAt, startedAt, file }: { label: string; tag: string | null; sha: string | null; registeredAt: string | null; startedAt: string | null; file: string | null }) {
  const gap = gapBetween(registeredAt, startedAt);
  return (
    <div className="regline">
      <p className="regline-name">{label}</p>
      <ol className="regline-road">
        <li className="is-reg">
          <i aria-hidden="true" />
          <b>Registered</b>
          <time dateTime={registeredAt ?? undefined}>{registeredAt ? utcStamp(registeredAt, true, true) : "tag time not available in this build"}</time>
          <span>
            tag <code>{tag}</code>
          </span>
        </li>
        <li className="is-gap" aria-hidden={!gap}>
          {gap ? `${gap} later` : ""}
        </li>
        <li className={`is-start ${startedAt ? "" : "is-open"}`}>
          <i aria-hidden="true" />
          <b>First worker started</b>
          {startedAt ? <time dateTime={startedAt}>{utcStamp(startedAt, true, true)}</time> : <span>posts here when the run's records are committed</span>}
          <span>{startedAt ? "from the run's meta.json" : "the run is still going"}</span>
        </li>
      </ol>
      {sha && file && (
        <p className="regline-hash">
          sha256 of <a href={ghFile(file)}>{file}</a>
          <code className="hash-full">{sha}</code>
        </p>
      )}
    </div>
  );
}

function LiveLine() {
  const live = useLiveState("exp2");
  const st = batchStatus(B2, live.kind === "ok" ? live.snapshot : null);
  return (
    <span className={`batch-chip is-${st.key}`}>
      <i aria-hidden="true" />
      {st.label}
    </span>
  );
}

export default function Experiment2() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  const decided = !!SHIP2 && !!N2;
  return (
    <div className="page-wrap x2-page" ref={root}>
      <PageHead
        route={pageMeta("/experiment-2")}
        lead={
          decided ? (
            <>Experiment 2 is decided by the rule registered before its first task. Every figure is read from the analysis output.</>
          ) : (
            <>
              Experiment 1 moved the reading to a small model. Experiment 2 asks whether it can also write the first draft. It is running now, and nothing here is a
              verdict.
            </>
          )
        }
      />

      <section className="x2-sec x2-question" aria-labelledby="x2-q">
        <div className="x2-copy">
          <p className="eyebrow-sign">The question</p>
          <Kinetic id="x2-q" text="Can the small model write the first draft?" />
          <Blocks blocks={repo.prereg2.question} base="prereg/" />
        </div>
        <figure className="x2-hyp" data-reveal="hang">
          <figcaption>Hypothesis, as registered and as sent to Flagsmith</figcaption>
          <blockquote>
            <Md text={repo.hypothesis2} />
          </blockquote>
        </figure>
      </section>

      <section className="x2-sec" aria-labelledby="x2-roles">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">The two arms</p>
          <Kinetic id="x2-roles" text="Same models, different jobs" />
          <p>
            Both arms run {main} in the planner lane and {small} in the worker lane, with the same caps. What changes is who writes the patch first. The flag values
            differ in one line.
          </p>
        </div>
        <Roles />
        <div className="x2-diff">
          <PolicyDiff from="lanes_v1" to="lanes_v2" />
          <div className="prose">
            <p>
              That one switch moves three things together: the planner's prompt, the worker's prompt and the worker's tools, which gain the ability to edit files.
              This is the treatment as one unit. The experiment cannot say which of the three matters.
            </p>
            <p>
              Control is not the old control. After experiment 1, Flagsmith serves the lanes_v1 policy to every task, so that policy is what lanes_v2 has to beat.{" "}
              <Link to="/results#end-experiment">What ending experiment 1 did to the flag</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="x2-sec x2-reg" aria-labelledby="x2-reg">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">The registration</p>
          <Kinetic id="x2-reg" text="Written down before the first task" />
          <p>
            The question, the arms, the pool, the metrics, the margin and the rule were hashed and tagged before any task of the run started. The file is never edited
            after the tag; a change would go in a separate amendment with its own hash.
          </p>
        </div>
        <div className="reglines" data-reveal="row">
          <RegLine label="Experiment 2" tag={B2.preregTag} sha={B2.preregSha} registeredAt={B2.registeredAt} startedAt={B2.startedAt} file={B2.preregFile} />
          <RegLine label="Experiment 1, for comparison" tag={B1.preregTag} sha={null} registeredAt={B1.registeredAt} startedAt={B1.startedAt} file={null} />
        </div>
        <Shot
          name="experiment-2-running"
          caption="Experiment 2 in the Flagsmith dashboard at its start: running on agent_routing with the registered hypothesis, 50% control, 50% lanes_v2, lanes_v1 at 0%, results still collecting."
        />
        <div className="x2-pool prose">
          <Blocks blocks={repo.prereg2.units} base="prereg/" className="x2-pool-list" />
        </div>
      </section>

      <section className="x2-sec x2-live live-sec" aria-labelledby="x2-live">
        <div className="live-sec-inner">
          <div className="hsec-copy">
            <p className="eyebrow-sign is-dark">{decided ? "The run" : "Running totals"}</p>
            <Kinetic id="x2-live" text={decided ? "What each lane spent" : "Where the run is now"} />
            <p>
              <LiveLine /> Read from the board's API. {decided ? "The decision is below." : "These totals move as tasks finish. They are not the result, and no decision is read from them."}
            </p>
          </div>
          <LivePanel experiment="exp2" />
        </div>
      </section>

      <section className="x2-sec" aria-labelledby="x2-rule">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">{decided ? "The decision" : "Ship or keep"}</p>
          <Kinetic id="x2-rule" text={decided ? (SHIP2 === "control" ? "lanes_v1 stays" : `${SHIP2} ships`) : "What will count as a win"} />
        </div>
        {decided && N2 && <ResultPair exp="exp2" treatment="lanes_v2" n={N2} />}
        <div className="x2-fork">
          <div className="x2-out is-ship" data-reveal="hang">
            <span className="x2-out-tab">Ship lanes_v2</span>
            <p className="x2-out-if">only if all three hold</p>
            <ol>
              {ruleItems.map((t, i) => {
                const met = repo.decisions[`exp2.decision.rule_met.${["flagsmith_95", "guardrail_90", "no_guardrail_loss"][i]}`];
                return (
                  <li key={i}>
                    <span className="rule-n" aria-hidden="true">
                      <b>{i + 1}</b>
                    </span>
                    <span>
                      <Md text={t} />
                    </span>
                    <span className={`x2-state ${met === "true" ? "is-met" : met === "false" ? "is-not" : ""}`}>{met === "true" ? "met" : met === "false" ? "not met" : "pending"}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="x2-out is-keep" data-reveal="hang">
            <span className="x2-out-tab">Keep lanes_v1</span>
            <p className="x2-out-if">otherwise</p>
            {ruleElse.map((b, i) => (b.type === "p" ? <p key={i}>{<Md text={b.text} />}</p> : null))}
            <Blocks blocks={repo.prereg2.stopping} className="x2-stop" />
          </div>
        </div>
        <div className="x2-power">
          <h3>What this run can and cannot detect</h3>
          <Blocks blocks={repo.prereg2.power} base="" />
        </div>
        <p className="doc-next">
          <Link to="/live" className="text-link">
            Watch both lanes on the live board <span aria-hidden="true">→</span>
          </Link>{" "}
          <a className="text-link" href={ghFile("prereg/experiment-2.md")}>
            Read the registration file <span aria-hidden="true">↗</span>
          </a>
        </p>
      </section>
    </div>
  );
}
