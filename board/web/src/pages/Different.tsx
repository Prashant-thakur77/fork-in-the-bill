import { useRef, type ReactNode } from "react";
import { Kinetic, PageHead, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { routeFor } from "../site/routes";
import { ghFile, repo, type Reference } from "../site/data";
import { batchOf, gapBetween } from "../site/batches";
import { format } from "../data/format";

// How claims about model routing and agent cost are usually supported, beside what this project
// did, row by row. Where a row describes published research practice, it cites the source from
// docs/references.md; every "here" cell links to the file or page that shows it.

const N1 = repo.numbers?.exp1 ?? null;
const B1 = batchOf("exp1");
const assign = repo.numbers?.integrity?.by_experiment.exp1?.assignment ?? null;
const refs = new Map(repo.references.map((r) => [r.id, r]));

/** A citation from the reference list, or nothing when the list does not hold it. */
export function Cite({ id }: { id: string }) {
  const r: Reference | undefined = refs.get(id);
  if (!r) return null;
  return (
    <a className="cite" href={r.url} rel="noopener" title={r.title}>
      {r.short}
    </a>
  );
}

interface Row {
  id: string;
  topic: string;
  usual: ReactNode;
  here: ReactNode;
  figure?: [string, string];
  evidence: ReactNode;
}

export const ROWS: Row[] = [
  {
    id: "where",
    topic: "Where the number comes from",
    usual: (
      <>
        A score on a fixed benchmark, measured offline, one configuration at a time. The benchmark format is a real issue graded by the repository's tests (
        <Cite id="jimenez-yang-2023" />
        ), and there is evidence that models memorise a fixed set of such tasks (<Cite id="liang-garg-2025" />
        ).
      </>
    ),
    here: (
      <>
        A controlled experiment: two arms run on the same pool at the same time, on issues drawn from a source that is refreshed with new ones (
        <Cite id="zhang-he-2025" />
        ). Tasks created after the models' training cutoff are reported as their own tier.
      </>
    ),
    figure: N1 ? [String(N1.arms.control!.n_analysed + N1.arms.lanes_v1!.n_analysed), "tasks analysed, both arms"] : undefined,
    evidence: (
      <>
        <Link to="/method">The method</Link> · <a href={ghFile("tasks/pools/manifest.json")}>tasks/pools/manifest.json</a>
      </>
    ),
  },
  {
    id: "who",
    topic: "Who decides which task runs in which arm",
    usual: (
      <>
        The person running the comparison chooses what runs under each configuration. A trustworthy experiment needs the unit to be assigned at random by the system,
        not by the analyst (<Cite id="kohavi-tang-2020" />
        ).
      </>
    ),
    here: (
      <>
        Flagsmith assigns every task by hashing its identity against the split. The runner never picks an arm, and anyone can re-derive every assignment offline from
        the saved environment with Flagsmith's own flag-engine.
      </>
    ),
    figure: assign ? [`${assign.matched} of ${assign.checked}`, "arms re-derived offline"] : undefined,
    evidence: (
      <>
        <Link to="/why-flagsmith">Why Flagsmith</Link> · <a href={ghFile("integrity/verify_assignment.py")}>integrity/verify_assignment.py</a>
      </>
    ),
  },
  {
    id: "when",
    topic: "When the rule is written",
    usual: (
      <>
        After the data is in. Choices made once the results are visible act as extra degrees of freedom, even with no intent to fish (<Cite id="gelman-loken-2013" />
        ); registering the plan first is the remedy (<Cite id="nosek-ebersole-2018" />
        ).
      </>
    ),
    here: (
      <>
        The hypothesis, metrics, margin, exclusions and decision rule were written, hashed and tagged before the first task. The one change made later is a separate
        amendment with its own hash, written before any task it covers.
      </>
    ),
    figure: B1?.registeredAt && B1.startedAt ? [gapBetween(B1.registeredAt, B1.startedAt), "from the tag to the first worker"] : undefined,
    evidence: (
      <>
        <a href={ghFile("prereg/experiment-1.md")}>prereg/experiment-1.md</a> · <a href={ghFile("prereg/HASHES.txt")}>prereg/HASHES.txt</a>
      </>
    ),
  },
  {
    id: "peek",
    topic: "Looking while it runs",
    usual: (
      <>
        Stop when the numbers look good. Checking a running test again and again, and stopping on a good reading, breaks the error rate a fixed-horizon test promises (
        <Cite id="johari-koomen-2017" />
        ).
      </>
    ),
    here: (
      <>
        No early stop, by registration: the run ended when every task in the pools was done, excluded or invalid. The live board showed running totals while it ran,
        and the decision was read only from the finished ledger.
      </>
    ),
    evidence: (
      <>
        <Link to="/method">The stopping rule</Link> · <Link to="/decisions#d24">Decision D24</Link>
      </>
    ),
  },
  {
    id: "cost",
    topic: "What cost means",
    usual: (
      <>
        A price per call or per token, or accuracy with no cost beside it. Agent evaluations should report cost together with accuracy (<Cite id="kapoor-stroebl-2024" />
        ).
      </>
    ),
    here: (
      <>
        Dollars per solved task, from every priced call of every task, failed and capped ones included, with a bootstrap interval. A cheaper arm that solves fewer bugs
        can cost more per solved task; this measure shows it.
      </>
    ),
    figure: N1 ? [`${format(N1.arms.control!.cost_per_solve, "usd4")} → ${format(N1.arms.lanes_v1!.cost_per_solve, "usd4")}`, "per solved task, control to lanes_v1"] : undefined,
    evidence: (
      <>
        <Link to="/results">The results</Link> · <a href={ghFile("analysis/analyse.py")}>analysis/analyse.py</a>
      </>
    ),
  },
  {
    id: "caveat",
    topic: "What sits next to the headline",
    usual: <>One number, with its limits in an appendix or left out.</>,
    here: (
      <>
        The caveat is printed beside the result wherever the result appears: the solve-rate interval includes a real loss, the margin was chosen after the pilot, and on
        the fresh tier alone the solve-rate check would not have passed.
      </>
    ),
    figure: N1?.by_tier?.fresh ? [format(N1.by_tier.fresh.delta.solve_rate_pp, "pp1"), "solve rate, fresh tier alone"] : undefined,
    evidence: (
      <>
        <Link to="/results#honest">What it does and does not show</Link> · <Link to="/faq">Questions</Link>
      </>
    ),
  },
  {
    id: "check",
    topic: "How a reader checks it",
    usual: <>Trust the chart. The records behind it are not published, or cannot be shown to be the ones the chart was drawn from.</>,
    here: (
      <>
        Every finished task is a record in a hash-chained ledger (<Cite id="haber-stornetta-1991" />
        ), with a Merkle root over all of them (<Cite id="merkle-1988" />
        ) that an outsider can recompute (<Cite id="crosby-wallach-2009" />
        ). A page on this site does it in your browser.
      </>
    ),
    figure: repo.numbers?.integrity ? [String(repo.scale.totals.ledger.toLocaleString("en-US")), "ledger records, all runs"] : undefined,
    evidence: (
      <>
        <Link to="/verify">Verify in your browser</Link> · <a href={ghFile("integrity/verify_ledger.py")}>integrity/verify_ledger.py</a>
      </>
    ),
  },
  {
    id: "after",
    topic: "What happens after the result",
    usual: <>A one-off script and a write-up. Using the result means writing the change again in the product.</>,
    here: (
      <>
        The experiment ran on the flag that serves the policy, so ending it made the winner what every task gets, with no deploy (<Cite id="tang-agarwal-2010" /> describe
        infrastructure for running experiments on a live system). The loop is published as a kit and a server anyone can install.
      </>
    ),
    figure: repo.scale.packages.length ? [repo.scale.packages.map((p) => p.name).join(" · "), `npm, ${repo.scale.packages[0]!.version}`] : undefined,
    evidence: (
      <>
        <Link to="/rollout">The rollout</Link> · <Link to="/use-it">Use it</Link>
      </>
    ),
  },
];

export default function Different() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  return (
    <div className="page-wrap diff-page" ref={root}>
      <PageHead
        route={routeFor("/different")}
        lead={
          <>
            Claims that a cheaper model is "good enough" are common. This is how such claims are usually supported, and what was done here instead, with the evidence for
            each line.
          </>
        }
      />
      <div className="df-heads" aria-hidden="true">
        <span className="df-head is-usual">The usual way</span>
        <span className="df-head is-here">What this project did</span>
      </div>
      <ol className="df-rows">
        {ROWS.map((r, i) => (
          <li className="df-row" key={r.id} id={r.id}>
            <h2 className="df-topic">
              <span className="df-n" aria-hidden="true">
                {i + 1}
              </span>
              {r.topic}
            </h2>
            <div className="df-pair" data-reveal="row">
              <div className="df-cell is-usual">
                <span className="df-k">The usual way</span>
                <p>{r.usual}</p>
              </div>
              <div className="df-cell is-here">
                <span className="df-k">Here</span>
                <p>{r.here}</p>
                {r.figure && (
                  <p className="df-fig">
                    <b>{r.figure[0]}</b>
                    <span>{r.figure[1]}</span>
                  </p>
                )}
                <p className="df-ev">Evidence: {r.evidence}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <section className="df-end" aria-labelledby="df-end-h">
        <Kinetic id="df-end-h" text="What this does not make it" />
        <div className="prose">
          <p>
            It is one agent design, one pair of models and a task stratum of small fixes. The result applies to that, and the solve-rate question is answered only against
            a wide margin. The left column describes common practice, not any one piece of work; the sources are in{" "}
            <a href={ghFile("docs/references.md")}>docs/references.md</a>, and how each one is used is on <Link to="/research">the research page</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
