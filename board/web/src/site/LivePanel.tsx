import { Led } from "../led/Led";
import { money } from "../data/format";
import { useTween } from "../data/useTween";
import { armInfo, orderArms } from "../data/arms";
import { Link } from "./router";
import { useLiveState, utcTime } from "./live";
import type { Arm } from "../data/types";

function Meter({ arm }: { arm: Arm }) {
  const v = useTween(arm.usd);
  return <Led text={money(v)} cols={46} label={`${money(arm.usd)} spent`} />;
}

/** Running totals per arm from the board API's /state: the same numbers the live board shows. */
export function LivePanel({ cta = true }: { cta?: boolean }) {
  const live = useLiveState();
  const snap = live.kind === "ok" ? live.snapshot : null;
  const keys = snap ? orderArms(Object.keys(snap.arms)).slice(0, 2) : ["control", "lanes_v1"];

  let note = "Connecting to the board…";
  if (live.kind === "none") note = "This build has no board API configured, so there are no live numbers here.";
  if (live.kind === "error") note = "The board API did not answer. The live board retries on its own.";
  if (live.kind === "ok" && !snap) note = "The run has not posted any totals yet.";
  if (snap) note = `${snap.experiment} · ${snap.status.replace("_", " ")} · read ${utcTime(live.kind === "ok" ? live.checkedAt : Date.now())}`;

  return (
    <div className="live-panel">
      <div className="lp-meters">
        {keys.map((k) => {
          const arm = snap?.arms[k];
          const info = armInfo(k);
          return (
            <article className="lp-arm" key={k} aria-label={`${info.tab} lane`}>
              <header>
                <span className="lp-tab">{info.tab}</span>
                <span className="lp-legend">{info.legend}</span>
              </header>
              <div className="led-housing">
                <span className="led-caption">{arm ? "Spent so far" : "Standing by"}</span>
                {arm ? <Meter arm={arm} /> : <Led text="STANDBY" cols={46} label="No live numbers" />}
              </div>
              <dl className="lp-stats">
                <div>
                  <dt>Tasks done</dt>
                  <dd>{arm ? arm.done.toLocaleString("en-US") : "—"}</dd>
                </div>
                <div>
                  <dt>Solved</dt>
                  <dd>{arm ? arm.solved.toLocaleString("en-US") : "—"}</dd>
                </div>
                <div>
                  <dt>Per solve</dt>
                  <dd>{arm && arm.solved > 0 ? money(arm.usd / arm.solved) : "—"}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <p className="lp-note" aria-live="polite">
        {note}
      </p>
      <p className="lp-caveat">
        Running totals, not the result. The verdict comes from the analysis script and the pre-registered rule once every task is done.
      </p>
      {cta && (
        <Link to="/live" className="btn btn-sheet">
          Open the live board <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
