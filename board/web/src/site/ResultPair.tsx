import { Led } from "../led/Led";
import { armInfo } from "../data/arms";
import { format } from "../data/format";
import type { ExperimentNumbers } from "./data";

const range = (ci: [number, number] | undefined, fmt: "usd4" | "prob1" | "pp1" | "pct1") => (ci ? `${format(ci[0], fmt)} to ${format(ci[1], fmt)}` : undefined);

/**
 * A decided experiment as two signs on one beam, each with its LED reading, then the change.
 * Every figure is a value from analysis/out/numbers.json, formatted like the README.
 */
export function ResultPair({ exp, treatment, n, deltas = true, heading = "h3" }: { exp: string; treatment: string; n: ExperimentNumbers; deltas?: boolean; heading?: "h3" | "p" }) {
  const lanes = ["control", treatment];
  const H = heading;
  return (
    <div className="res-pair">
      <div className="res-signs" data-reveal="row">
        {lanes.map((key) => {
          const a = n.arms[key]!;
          const info = armInfo(key, exp);
          const mean = format(a.cost_mean, "usd4");
          return (
            <article className="sign res-sign" key={key} aria-label={`${key} lane, ${exp}`}>
              <div className="sign-tab">{key}</div>
              <div className="sign-face">
                <H className="sign-legend">{info.legend}</H>
                <div className="led-housing">
                  <span className="led-caption">Mean cost per task</span>
                  <Led text={mean} cols={50} label={`${mean} mean cost per task`} />
                </div>
                <p className="res-ci">95% interval {range(a.cost_mean_ci, "usd4")}</p>
                <dl className="sign-stats">
                  <div>
                    <dt>Solved</dt>
                    <dd>
                      {a.solves} of {a.n_analysed}
                    </dd>
                  </div>
                  <div>
                    <dt>Solve rate</dt>
                    <dd>{format(a.solve_rate, "prob1")}</dd>
                  </div>
                  <div>
                    <dt>Per solved task</dt>
                    <dd>{format(a.cost_per_solve, "usd4")}</dd>
                  </div>
                </dl>
              </div>
            </article>
          );
        })}
      </div>
      {deltas && (
        <dl className="res-delta">
          <div>
            <dt>Mean cost per task</dt>
            <dd>{format(n.delta.cost_mean_pct, "pct1")}</dd>
            <dd className="res-range">{range(n.delta.cost_mean_pct_ci, "pct1")}</dd>
          </div>
          <div>
            <dt>Cost per solved task</dt>
            <dd>{format(n.delta.cost_per_solve_pct, "pct1")}</dd>
            <dd className="res-range">{range(n.delta.cost_per_solve_pct_ci, "pct1")}</dd>
          </div>
          <div>
            <dt>Solve rate</dt>
            <dd>{format(n.delta.solve_rate_pp, "pp1")}</dd>
            <dd className="res-range">{range(n.delta.solve_rate_ci, "pp1")}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
