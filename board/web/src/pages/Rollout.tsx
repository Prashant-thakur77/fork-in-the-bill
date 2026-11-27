import { useRef } from "react";
import { Code, Kinetic, PageHead, RepoCode, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { routeFor } from "../site/routes";
import { ghFile, repo, type FlagState } from "../site/data";
import { batchOf, gapBetween, utcStamp } from "../site/batches";
import { format } from "../data/format";
import { Led } from "../led/Led";

// What ending experiment 1 did, read from the two environment snapshots that open the exp1 and
// rollout ledgers, and what the fresh batch on the same flag cost and solved (numbers.json).

const N = repo.numbers;
const R = N?.rollout ?? null;
const SHIP = repo.decisions["exp1.decision.ship"] ?? null;
const before = repo.flagStates.before;
const after = repo.flagStates.after;
const integ = N?.integrity?.by_experiment.rollout ?? null;
const exp1Arm = SHIP && N?.exp1 ? N.exp1.arms[SHIP] : null;
const batch = batchOf("rollout");

function weight(s: FlagState, variant: string): string {
  const w = s.variants.find(([k]) => k === variant);
  return w ? `${w[1]}%` : "not set";
}

/** One snapshot of the flag as a plate: what Flagsmith would serve at that moment. */
function FlagPlate({ s, when, title }: { s: FlagState; when: string; title: string }) {
  const variant = s.variants[0]?.[0] ?? "lanes_v1";
  const over = s.overrides[0];
  return (
    <article className={`flag-plate ${s.experimentId ? "is-exp" : "is-rolled"}`}>
      <header>
        <span className="flag-plate-when">{when}</span>
        <h3>{title}</h3>
        <time dateTime={s.takenAt ?? undefined}>snapshot taken {utcStamp(s.takenAt, true, true)}</time>
      </header>
      <dl>
        <div>
          <dt>
            <code>agent_routing</code>, weight of <code>{variant}</code>
          </dt>
          <dd>{weight(s, variant)}</dd>
        </div>
        <div>
          <dt>Experiment on the flag</dt>
          <dd>{s.experimentId ? `${s.experimentId}, running` : "none"}</dd>
        </div>
        <div>
          <dt>Experiment segment</dt>
          <dd>{over ? `${over.variants[0]?.[0]} ${over.variants[0]?.[1]}%, the rest control` : "removed"}</dd>
        </div>
        <div>
          <dt>Flag value, sha256</dt>
          <dd>
            <code>{s.valueSha256?.slice(0, 16)}…</code>
          </dd>
        </div>
        <div>
          <dt>Whole environment, sha256</dt>
          <dd>
            <code>{s.envSha256?.slice(0, 16)}…</code>
          </dd>
        </div>
      </dl>
      <a className="flag-plate-src" href={ghFile(s.file)}>
        {s.file}
      </a>
    </article>
  );
}

export default function Rollout() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  const sameValue = before && after && before.valueSha256 === after.valueSha256;
  return (
    <div className="page-wrap ro-page" ref={root}>
      <PageHead
        route={routeFor("/rollout")}
        lead={
          SHIP ? (
            <>
              Experiment 1 ended with {SHIP} as the rollout decision. From that moment the same flag serves {SHIP} to every task. No code was deployed, and the next
              batch ran on it as it was.
            </>
          ) : (
            <>When experiment 1 is decided, it is ended in Flagsmith with the winner as the rollout decision, and the next batch runs on the same flag.</>
          )
        }
      />

      <section className="ro-sec" aria-labelledby="ro-what">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">End Experiment</p>
          <Kinetic id="ro-what" text="One action in Flagsmith, two snapshots to show it" />
          <p>
            The runner saves Flagsmith's environment document at the start of every run and hashes it into the ledger. These are the first records of the experiment 1
            ledger and of the rollout ledger.
          </p>
        </div>
        {before && after ? (
          <div className="ro-pair">
            <FlagPlate s={before} when="Before" title="Experiment 1 starts" />
            <div className="ro-arrow" aria-hidden="true">
              <svg viewBox="0 0 120 60">
                <path d="M6 30 H104 M86 12 L106 30 L86 48" />
              </svg>
              <span>End Experiment{before.takenAt && after.updatedAt ? `, ${gapBetween(before.takenAt, after.updatedAt)} after the start` : ""}</span>
            </div>
            <FlagPlate s={after} when="After" title="The rollout batch starts" />
          </div>
        ) : (
          <p className="prose">The snapshots post here when both run ledgers are committed.</p>
        )}
        {before && after && (
          <div className="prose ro-read">
            <p>
              Before, the flag itself gives <code>lanes_v1</code> a weight of {weight(before, "lanes_v1")}, and a segment that Flagsmith created for the experiment
              splits the traffic. After, the experiment and its segment are gone and the flag gives <code>lanes_v1</code> {weight(after, "lanes_v1")}: every identity
              gets the winner's policy.
              {sameValue ? " The flag's base value has the same hash in both snapshots; only the weights moved." : ""}
            </p>
            <p>
              The environment's hash changed once, when the experiment ended{after.updatedAt ? ` (Flagsmith's own timestamp: ${utcStamp(after.updatedAt, true, true)})` : ""}
              . It did not change again during the batch{integ ? `: ${integ.env_snapshots} snapshots, ${integ.env_snapshot_distinct_hashes} distinct hash` : ""}.
            </p>
          </div>
        )}
        <div className="ro-cmd">
          <RepoCode s={repo.snippets.complete!} lang="sh" />
          <p className="prose small">
            The same call the smoke test uses, from <a href={ghFile("flagsmith/smoke_test.sh")}>flagsmith/smoke_test.sh</a>. The winner's name goes in{" "}
            <code>rollout_decision</code>.
          </p>
        </div>
      </section>

      <section className="ro-sec ro-batch live-sec" aria-labelledby="ro-batch">
        <div className="ro-batch-inner">
          <div className="hsec-copy">
            <p className="eyebrow-sign is-dark">The batch</p>
            <Kinetic id="ro-batch" text={R ? `${R.n} fresh tasks on the same flag` : "A fresh batch on the same flag"} />
            <p>
              Tasks no arm had seen, from a pool disjoint from every other. The runner asked Flagsmith for the policy the same way it did during the experiment.
              {batch?.startedAt ? ` Started ${utcStamp(batch.startedAt, true)}.` : ""}
            </p>
          </div>
          {R ? (
            <div className="ro-sign sign" data-reveal="hang">
              <div className="sign-tab">{SHIP}</div>
              <div className="sign-face">
                <p className="sign-legend">The winner, rolled out</p>
                <div className="led-housing">
                  <span className="led-caption">Mean cost per task</span>
                  <Led text={format(R.cost_mean, "usd4")} cols={50} label={`${format(R.cost_mean, "usd4")} mean cost per task`} />
                </div>
                <dl className="sign-stats">
                  <div>
                    <dt>Tasks</dt>
                    <dd data-count="">{R.n}</dd>
                  </div>
                  <div>
                    <dt>Solve rate</dt>
                    <dd>{format(R.solve_rate, "prob1")}</dd>
                  </div>
                  <div>
                    <dt>Batch spend</dt>
                    <dd>{N?.spend?.by_experiment.rollout !== undefined ? format(N.spend.by_experiment.rollout, "usd2") : "—"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : (
            <p>The batch's figures post here when the analysis has run.</p>
          )}
        </div>
      </section>

      <section className="ro-sec" aria-labelledby="ro-read">
        <div className="x2-copy wide">
          <p className="eyebrow-sign">How to read it</p>
          <Kinetic id="ro-read" text="It shows the flag working, not a second result" />
        </div>
        <div className="ro-cols">
          <div className="prose">
            <p>
              The batch has no comparison arm, so it cannot say again that the small-model lane is cheaper. What it shows is that the decision became the flag's
              behaviour with no deploy, and that the policy kept working on tasks it had not met.
            </p>
            {R && exp1Arm && (
              <p>
                For scale only: in experiment 1 the {SHIP} arm cost {format(exp1Arm.cost_mean, "usd4")} a task and solved {format(exp1Arm.solve_rate, "prob1")}. This
                batch cost {format(R.cost_mean, "usd4")} and solved {format(R.solve_rate, "prob1")} of {R.n} tasks, which is too few to compare the two.
              </p>
            )}
            <p>
              Experiment 2 starts from this state: the rolled-out policy is its control. <Link to="/experiment-2">Experiment 2</Link>.
            </p>
          </div>
          <dl className="ro-checks">
            <div>
              <dt>Arms recomputed offline</dt>
              <dd>{integ?.assignment ? `${integ.assignment.matched} of ${integ.assignment.checked}` : "—"}</dd>
              <dd className="ro-note">Flagsmith's flag-engine, run on the saved snapshot, gives every task {SHIP ?? "the winner"}.</dd>
            </div>
            <div>
              <dt>Ledger</dt>
              <dd>{integ ? `${integ.task_done_records} task records` : "—"}</dd>
              <dd className="ro-note">
                Merkle root <code>{integ?.merkle_root.slice(0, 16)}…</code> <Link to="/verify">Check it in your browser</Link>.
              </dd>
            </div>
          </dl>
        </div>
        <Code code={"uv run python -m integrity.verify_ledger runs/rollout\nuv run python -m integrity.verify_assignment --run runs/rollout"} lang="sh" caption="from a clone, after uv sync" />
      </section>
    </div>
  );
}
