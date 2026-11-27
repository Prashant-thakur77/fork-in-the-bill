import type { Board } from "../data/types";
import { EXPERIMENT_FLAG, timeline, utcMinute } from "../data/flags";

const SHOW = 12;

/** Changes Flagsmith reported for the experiment flag, read as mileposts along one line. */
export function FlagHistory({ board }: { board: Board }) {
  const t = timeline(board.flags);
  const state = t.during > 0 ? "changed" : t.start && t.end ? "unchanged" : t.start ? "watching" : "pending";
  const rows = t.rows.slice(-SHOW);
  // Nothing has been reported yet: say why, and where the flag's state is recorded meanwhile.
  const waiting = board.mode !== "replay" && t.rows.length === 0;
  const hidden = t.rows.length - rows.length;
  return (
    <section className="block flags" aria-labelledby="flags-title">
      <div className="block-head">
        <h2 id="flags-title">Flag history</h2>
        <p>
          Every change Flagsmith reported for <code>{EXPERIMENT_FLAG}</code>, through a signed webhook. Who made a
          change is never stored, and flag values only as hashes.
        </p>
      </div>
      <div className={`flaglog is-${state}`} data-reveal="hang">
        <p className="flaglog-summary" aria-live="polite">
          <span className="flaglog-tag">{waiting ? "after experiment 2" : state}</span>
          <span>
            {waiting
              ? "The webhook that feeds this list is connected once experiment 2 has ended, because nothing about the flag is touched while an experiment runs. Until then the flag's state is in each run's ledger, as hashed environment snapshots taken at the start, every 15 minutes and at the end."
              : t.summary}
          </span>
        </p>
        {rows.length > 0 && (
          <ol className="flaglog-list">
            {hidden > 0 && <li className="flaglog-more">{hidden} earlier not shown</li>}
            {rows.map(({ change: c, d, during }) => (
              <li key={c.id} className={`flaglog-row is-${d.kind}${during ? " is-during" : ""}`}>
                <time className="flaglog-time" dateTime={new Date(c.at * 1000).toISOString()}>
                  {utcMinute(c.at)}
                </time>
                <span className="flaglog-mark" aria-hidden="true" />
                <span className="flaglog-what">
                  <b>{d.label}</b>
                  {d.detail && <small>{d.detail}</small>}
                </span>
                {during && <span className="flaglog-state">during run</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
