import { Led } from "../led/Led";
import { textColumns } from "../led/font";
import { ghFile, repo } from "../site/data";

// The toll table (list prices on an LED board), the two lane cards and the policy diff: the
// reason the experiment exists. Every figure comes from harness/pricing.json and the two policy
// files, read when the site is built.

const C = repo.policies.control;
const V = repo.policies.lanes_v1;
const prices = repo.pricing?.models ?? {};
const big = C ? prices[C.main.model] : undefined;
const small = V ? prices[V.delegate.model] : undefined;

/** How many times dearer a million input tokens are on the frontier model than on the small one. */
export const PRICE_RATIO = big && small ? Math.round(big.input / small.input) : null;
const PRICE_COLS = Math.max(30, ...[big, small].filter(Boolean).flatMap((m) => [m!.input, m!.output]).map((v) => textColumns(`$${v.toFixed(2)}`) + 4));

export function PriceBoard() {
  return (
    <div className="rate-board">
      <div role="table" aria-label="List prices, US dollars per million tokens">
        <div className="rb-head" role="row">
          <span role="columnheader">Toll, per million tokens</span>
          <span role="columnheader">Input</span>
          <span role="columnheader">Output</span>
        </div>
        {[C?.main.model, V?.delegate.model].filter(Boolean).map((id) => {
          const p = prices[id!];
          if (!p) return null;
          return (
            <div className="rb-row" role="row" key={id}>
              <span role="rowheader" className="rb-model">
                {id === C?.main.model ? C?.mainShort : V?.delegateShort}
              </span>
              <span role="cell">
                <Led text={`$${p.input.toFixed(2)}`} cols={PRICE_COLS} label={`$${p.input.toFixed(2)} input`} />
              </span>
              <span role="cell">
                <Led text={`$${p.output.toFixed(2)}`} cols={PRICE_COLS} label={`$${p.output.toFixed(2)} output`} />
              </span>
            </div>
          );
        })}
      </div>
      <p className="rb-foot">
        Source: <a href={ghFile("harness/pricing.json")}>harness/pricing.json</a>
        {repo.pricing ? `, checked ${repo.pricing.checked_on}` : ""}
      </p>
    </div>
  );
}

export function LaneCards() {
  return (
    <div className="lane-cards" data-reveal="row">
      <div className="lane-card">
        <span className="lane-card-tab">Planner lane</span>
        <p className="lane-card-model">{C?.mainShort}</p>
        <p className="lane-card-tools">
          <code>view_file</code> <code>edit_file</code> <code>delegate</code> <code>submit</code>
        </p>
      </div>
      <div className="lane-card is-worker">
        <span className="lane-card-tab">Worker lane</span>
        <p className="lane-card-model">
          {C?.delegateShort} <span className="vs">or</span> {V?.delegateShort}
        </p>
        <p className="lane-card-tools">
          <code>bash</code>
        </p>
      </div>
    </div>
  );
}

/** The one line that differs between two arms' flag values. */
export function PolicyDiff({ from = "control", to = "lanes_v1" }: { from?: string; to?: string }) {
  const A = repo.policies[from];
  const B = repo.policies[to];
  if (!A || !B) return null;
  const strip = (p: object) => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !/Short$/.test(k))), null, 2).split("\n");
  const a = strip(A);
  const b = strip(B);
  return (
    <figure className="diff">
      <figcaption className="code-bar">
        <span className="code-file">
          flagsmith/policies/{from}.json → {to}.json
        </span>
        <a className="code-src" href={ghFile(`flagsmith/policies/${to}.json`)} rel="noopener">
          Source<span className="sr-only">: the {to} policy file</span> <span aria-hidden="true">↗</span>
        </a>
      </figcaption>
      <pre tabIndex={0}>
        {a.map((line, i) =>
          line === b[i] ? (
            <span className="dl" key={i}>
              {"  "}
              {line}
              {"\n"}
            </span>
          ) : (
            <span key={i}>
              <span className="dl dl-del">
                {"- "}
                {line}
                {"\n"}
              </span>
              <span className="dl dl-add">
                {"+ "}
                {b[i]}
                {"\n"}
              </span>
            </span>
          ),
        )}
      </pre>
    </figure>
  );
}
