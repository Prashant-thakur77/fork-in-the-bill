# Results

Every figure in the block below comes from `analysis/out/numbers.json` and is filled by
`analysis/render_docs.py`.

<!--results:start-->

Merkle root over <!--n:integrity.task_done_records:int-->146<!--/n--> `task_done` records: <!--n:integrity.merkle_root:hash12-->7ed364648c75<!--/n-->.

Total model spend: <!--n:spend.total_usd:usd2-->$11.87<!--/n-->.

## Experiment `exp1`

Pre-registration tag <!--n:exp1.prereg.tag:str-->prereg-exp1<!--/n-->, sha256 <!--n:exp1.prereg.sha256:hash12-->44d715bd6bd7<!--/n-->, guardrail margin m = <!--n:exp1.prereg.m:prob1-->20.0%<!--/n--> of solve rate.

| | `control` | `lanes_v1` |
|---|---|---|
| Exposed | <!--n:exp1.arms.control.n_exposed:int-->76<!--/n--> | <!--n:exp1.arms.lanes_v1.n_exposed:int-->69<!--/n--> |
| Excluded | <!--n:exp1.arms.control.n_excluded:int-->0<!--/n--> | <!--n:exp1.arms.lanes_v1.n_excluded:int-->0<!--/n--> |
| Analysed | <!--n:exp1.arms.control.n_analysed:int-->76<!--/n--> | <!--n:exp1.arms.lanes_v1.n_analysed:int-->69<!--/n--> |
| Mean cost per task | <!--n:exp1.arms.control.cost_mean:usd4-->$0.0784<!--/n--> | <!--n:exp1.arms.lanes_v1.cost_mean:usd4-->$0.0340<!--/n--> |
| Median cost per task | <!--n:exp1.arms.control.cost_median:usd4-->$0.0491<!--/n--> | <!--n:exp1.arms.lanes_v1.cost_median:usd4-->$0.0273<!--/n--> |
| Solves | <!--n:exp1.arms.control.solves:int-->34<!--/n--> | <!--n:exp1.arms.lanes_v1.solves:int-->28<!--/n--> |
| Solve rate | <!--n:exp1.arms.control.solve_rate:prob1-->44.7%<!--/n--> | <!--n:exp1.arms.lanes_v1.solve_rate:prob1-->40.6%<!--/n--> |
| Cost per solved task | <!--n:exp1.arms.control.cost_per_solve:usd4-->$0.1753<!--/n--> | <!--n:exp1.arms.lanes_v1.cost_per_solve:usd4-->$0.0837<!--/n--> |
| Delegate share of cost | <!--n:exp1.arms.control.delegate_share_cost:prob1-->62.5%<!--/n--> | <!--n:exp1.arms.lanes_v1.delegate_share_cost:prob1-->11.5%<!--/n--> |
| Delegate share of tokens | <!--n:exp1.arms.control.delegate_share_tokens:prob1-->55.3%<!--/n--> | <!--n:exp1.arms.lanes_v1.delegate_share_tokens:prob1-->64.8%<!--/n--> |
| Mean turns | <!--n:exp1.arms.control.turns_mean:f3-->4.921<!--/n--> | <!--n:exp1.arms.lanes_v1.turns_mean:f3-->5.145<!--/n--> |
| Mean seconds | <!--n:exp1.arms.control.seconds_mean:f3-->622.615<!--/n--> | <!--n:exp1.arms.lanes_v1.seconds_mean:f3-->442.046<!--/n--> |
| Mean cost, bootstrap interval | <!--n:exp1.arms.control.cost_mean_ci.0:usd4-->$0.0632<!--/n--> to <!--n:exp1.arms.control.cost_mean_ci.1:usd4-->$0.0962<!--/n--> | <!--n:exp1.arms.lanes_v1.cost_mean_ci.0:usd4-->$0.0282<!--/n--> to <!--n:exp1.arms.lanes_v1.cost_mean_ci.1:usd4-->$0.0406<!--/n--> |
| Solve rate, posterior interval | <!--n:exp1.arms.control.solve_rate_ci.0:prob1-->34.1%<!--/n--> to <!--n:exp1.arms.control.solve_rate_ci.1:prob1-->55.9%<!--/n--> | <!--n:exp1.arms.lanes_v1.solve_rate_ci.0:prob1-->29.8%<!--/n--> to <!--n:exp1.arms.lanes_v1.solve_rate_ci.1:prob1-->52.4%<!--/n--> |
| Cost per solve, bootstrap interval | <!--n:exp1.arms.control.cost_per_solve_ci.0:usd4-->$0.1233<!--/n--> to <!--n:exp1.arms.control.cost_per_solve_ci.1:usd4-->$0.2607<!--/n--> | <!--n:exp1.arms.lanes_v1.cost_per_solve_ci.0:usd4-->$0.0614<!--/n--> to <!--n:exp1.arms.lanes_v1.cost_per_solve_ci.1:usd4-->$0.1191<!--/n--> |

### Differences (treatment minus control)

- Mean cost: <!--n:exp1.delta.cost_mean:usd4-->−$0.0444<!--/n--> per task (<!--n:exp1.delta.cost_mean_pct:pct1-->−56.7%<!--/n-->), bootstrap interval <!--n:exp1.delta.cost_mean_ci.0:usd4-->−$0.0632<!--/n--> to <!--n:exp1.delta.cost_mean_ci.1:usd4-->−$0.0281<!--/n-->.
- Cost per solved task: <!--n:exp1.delta.cost_per_solve_pct:pct1-->−52.2%<!--/n-->.
- Solve rate: <!--n:exp1.delta.solve_rate_pp:pp1-->−4.2 pp<!--/n-->, posterior interval <!--n:exp1.delta.solve_rate_ci.0:pp1-->−19.8 pp<!--/n--> to <!--n:exp1.delta.solve_rate_ci.1:pp1-->+11.8 pp<!--/n-->.
- Posterior probability that the solve-rate drop is within m: <!--n:exp1.delta.p_solve_drop_within_m:prob1-->97.7%<!--/n-->.

### Sample ratio

Chi-square <!--n:exp1.srm.chi2:f3-->0.338<!--/n-->, p = <!--n:exp1.srm.p:f3-->0.561<!--/n-->, flagged: <!--n:exp1.srm.flag:str-->False<!--/n-->.

### Flagsmith readout

- Chance to beat control on `task_cost`: <!--n:exp1.flagsmith.chance_to_beat_control_cost:prob1-->100.0%<!--/n-->.
- Guardrail `task_solved` status: <!--n:exp1.flagsmith.solve_rate_status:str-->inconclusive<!--/n-->.
- Results pulled at <!--n:exp1.flagsmith.pulled_at:str-->20261127T120242Z<!--/n-->.
- `control` mean cost, absolute difference between our figure and Flagsmith's: <!--n:exp1.agreement.cost_mean_abs_diff.control:usd4-->$0.0000<!--/n-->.
- `lanes_v1` mean cost, absolute difference between our figure and Flagsmith's: <!--n:exp1.agreement.cost_mean_abs_diff.lanes_v1:usd4-->$0.0001<!--/n-->.

### Decision

Ship: <!--n:exp1.decision.ship:str-->lanes_v1<!--/n-->. Flagsmith chance to beat control at or above the pre-registered bar: <!--n:exp1.decision.rule_met.flagsmith_95:str-->True<!--/n-->; guardrail posterior at or above the bar: <!--n:exp1.decision.rule_met.guardrail_90:str-->True<!--/n-->; no Flagsmith guardrail loss: <!--n:exp1.decision.rule_met.no_guardrail_loss:str-->True<!--/n-->.

### Secondary: CUPED (labelled secondary, not part of the decision)

Variance reduction from the pilot-trained cost covariate: <!--n:exp1.cuped.variance_reduction_pct:pct1-->n/a<!--/n-->; adjusted mean cost difference <!--n:exp1.cuped.delta_cost_mean:usd4-->n/a<!--/n-->.

### By trait

#### `created_month`

| level | `control` n | `control` solve rate | `control` mean cost | `lanes_v1` n | `lanes_v1` solve rate | `lanes_v1` mean cost |
|---|---|---|---|---|---|---|
| `2026-03` | <!--n:exp1.by_trait.created_month.2026-03.control.n:int-->9<!--/n--> | <!--n:exp1.by_trait.created_month.2026-03.control.solve_rate:prob1-->22.2%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-03.control.cost_mean:usd4-->$0.0810<!--/n--> | <!--n:exp1.by_trait.created_month.2026-03.lanes_v1.n:int-->12<!--/n--> | <!--n:exp1.by_trait.created_month.2026-03.lanes_v1.solve_rate:prob1-->50.0%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-03.lanes_v1.cost_mean:usd4-->$0.0273<!--/n--> |
| `2026-04` | <!--n:exp1.by_trait.created_month.2026-04.control.n:int-->10<!--/n--> | <!--n:exp1.by_trait.created_month.2026-04.control.solve_rate:prob1-->40.0%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-04.control.cost_mean:usd4-->$0.0774<!--/n--> | <!--n:exp1.by_trait.created_month.2026-04.lanes_v1.n:int-->14<!--/n--> | <!--n:exp1.by_trait.created_month.2026-04.lanes_v1.solve_rate:prob1-->35.7%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-04.lanes_v1.cost_mean:usd4-->$0.0342<!--/n--> |
| `2026-05` | <!--n:exp1.by_trait.created_month.2026-05.control.n:int-->1<!--/n--> | <!--n:exp1.by_trait.created_month.2026-05.control.solve_rate:prob1-->0.0%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-05.control.cost_mean:usd4-->$0.0775<!--/n--> | <!--n:exp1.by_trait.created_month.2026-05.lanes_v1.n:int-->0<!--/n--> | <!--n:exp1.by_trait.created_month.2026-05.lanes_v1.solve_rate:prob1-->n/a<!--/n--> | <!--n:exp1.by_trait.created_month.2026-05.lanes_v1.cost_mean:usd4-->n/a<!--/n--> |
| `2026-06` | <!--n:exp1.by_trait.created_month.2026-06.control.n:int-->2<!--/n--> | <!--n:exp1.by_trait.created_month.2026-06.control.solve_rate:prob1-->50.0%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-06.control.cost_mean:usd4-->$0.0776<!--/n--> | <!--n:exp1.by_trait.created_month.2026-06.lanes_v1.n:int-->3<!--/n--> | <!--n:exp1.by_trait.created_month.2026-06.lanes_v1.solve_rate:prob1-->66.7%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-06.lanes_v1.cost_mean:usd4-->$0.0512<!--/n--> |
| `2026-07` | <!--n:exp1.by_trait.created_month.2026-07.control.n:int-->54<!--/n--> | <!--n:exp1.by_trait.created_month.2026-07.control.solve_rate:prob1-->50.0%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-07.control.cost_mean:usd4-->$0.0782<!--/n--> | <!--n:exp1.by_trait.created_month.2026-07.lanes_v1.n:int-->40<!--/n--> | <!--n:exp1.by_trait.created_month.2026-07.lanes_v1.solve_rate:prob1-->37.5%<!--/n--> | <!--n:exp1.by_trait.created_month.2026-07.lanes_v1.cost_mean:usd4-->$0.0346<!--/n--> |

#### `difficulty`

| level | `control` n | `control` solve rate | `control` mean cost | `lanes_v1` n | `lanes_v1` solve rate | `lanes_v1` mean cost |
|---|---|---|---|---|---|---|
| `low` | <!--n:exp1.by_trait.difficulty.low.control.n:int-->25<!--/n--> | <!--n:exp1.by_trait.difficulty.low.control.solve_rate:prob1-->68.0%<!--/n--> | <!--n:exp1.by_trait.difficulty.low.control.cost_mean:usd4-->$0.0700<!--/n--> | <!--n:exp1.by_trait.difficulty.low.lanes_v1.n:int-->24<!--/n--> | <!--n:exp1.by_trait.difficulty.low.lanes_v1.solve_rate:prob1-->58.3%<!--/n--> | <!--n:exp1.by_trait.difficulty.low.lanes_v1.cost_mean:usd4-->$0.0288<!--/n--> |
| `mid` | <!--n:exp1.by_trait.difficulty.mid.control.n:int-->28<!--/n--> | <!--n:exp1.by_trait.difficulty.mid.control.solve_rate:prob1-->46.4%<!--/n--> | <!--n:exp1.by_trait.difficulty.mid.control.cost_mean:usd4-->$0.0590<!--/n--> | <!--n:exp1.by_trait.difficulty.mid.lanes_v1.n:int-->22<!--/n--> | <!--n:exp1.by_trait.difficulty.mid.lanes_v1.solve_rate:prob1-->40.9%<!--/n--> | <!--n:exp1.by_trait.difficulty.mid.lanes_v1.cost_mean:usd4-->$0.0387<!--/n--> |
| `high` | <!--n:exp1.by_trait.difficulty.high.control.n:int-->23<!--/n--> | <!--n:exp1.by_trait.difficulty.high.control.solve_rate:prob1-->17.4%<!--/n--> | <!--n:exp1.by_trait.difficulty.high.control.cost_mean:usd4-->$0.1112<!--/n--> | <!--n:exp1.by_trait.difficulty.high.lanes_v1.n:int-->23<!--/n--> | <!--n:exp1.by_trait.difficulty.high.lanes_v1.solve_rate:prob1-->21.7%<!--/n--> | <!--n:exp1.by_trait.difficulty.high.lanes_v1.cost_mean:usd4-->$0.0349<!--/n--> |

#### `language`

| level | `control` n | `control` solve rate | `control` mean cost | `lanes_v1` n | `lanes_v1` solve rate | `lanes_v1` mean cost |
|---|---|---|---|---|---|---|
| `c` | <!--n:exp1.by_trait.language.c.control.n:int-->11<!--/n--> | <!--n:exp1.by_trait.language.c.control.solve_rate:prob1-->63.6%<!--/n--> | <!--n:exp1.by_trait.language.c.control.cost_mean:usd4-->$0.0982<!--/n--> | <!--n:exp1.by_trait.language.c.lanes_v1.n:int-->13<!--/n--> | <!--n:exp1.by_trait.language.c.lanes_v1.solve_rate:prob1-->38.5%<!--/n--> | <!--n:exp1.by_trait.language.c.lanes_v1.cost_mean:usd4-->$0.0462<!--/n--> |
| `cpp` | <!--n:exp1.by_trait.language.cpp.control.n:int-->7<!--/n--> | <!--n:exp1.by_trait.language.cpp.control.solve_rate:prob1-->42.9%<!--/n--> | <!--n:exp1.by_trait.language.cpp.control.cost_mean:usd4-->$0.0834<!--/n--> | <!--n:exp1.by_trait.language.cpp.lanes_v1.n:int-->13<!--/n--> | <!--n:exp1.by_trait.language.cpp.lanes_v1.solve_rate:prob1-->38.5%<!--/n--> | <!--n:exp1.by_trait.language.cpp.lanes_v1.cost_mean:usd4-->$0.0287<!--/n--> |
| `cs` | <!--n:exp1.by_trait.language.cs.control.n:int-->10<!--/n--> | <!--n:exp1.by_trait.language.cs.control.solve_rate:prob1-->20.0%<!--/n--> | <!--n:exp1.by_trait.language.cs.control.cost_mean:usd4-->$0.0896<!--/n--> | <!--n:exp1.by_trait.language.cs.lanes_v1.n:int-->4<!--/n--> | <!--n:exp1.by_trait.language.cs.lanes_v1.solve_rate:prob1-->25.0%<!--/n--> | <!--n:exp1.by_trait.language.cs.lanes_v1.cost_mean:usd4-->$0.0240<!--/n--> |
| `go` | <!--n:exp1.by_trait.language.go.control.n:int-->4<!--/n--> | <!--n:exp1.by_trait.language.go.control.solve_rate:prob1-->0.0%<!--/n--> | <!--n:exp1.by_trait.language.go.control.cost_mean:usd4-->$0.1135<!--/n--> | <!--n:exp1.by_trait.language.go.lanes_v1.n:int-->9<!--/n--> | <!--n:exp1.by_trait.language.go.lanes_v1.solve_rate:prob1-->55.6%<!--/n--> | <!--n:exp1.by_trait.language.go.lanes_v1.cost_mean:usd4-->$0.0372<!--/n--> |
| `java` | <!--n:exp1.by_trait.language.java.control.n:int-->23<!--/n--> | <!--n:exp1.by_trait.language.java.control.solve_rate:prob1-->73.9%<!--/n--> | <!--n:exp1.by_trait.language.java.control.cost_mean:usd4-->$0.0417<!--/n--> | <!--n:exp1.by_trait.language.java.lanes_v1.n:int-->18<!--/n--> | <!--n:exp1.by_trait.language.java.lanes_v1.solve_rate:prob1-->50.0%<!--/n--> | <!--n:exp1.by_trait.language.java.lanes_v1.cost_mean:usd4-->$0.0262<!--/n--> |
| `js` | <!--n:exp1.by_trait.language.js.control.n:int-->7<!--/n--> | <!--n:exp1.by_trait.language.js.control.solve_rate:prob1-->14.3%<!--/n--> | <!--n:exp1.by_trait.language.js.control.cost_mean:usd4-->$0.0677<!--/n--> | <!--n:exp1.by_trait.language.js.lanes_v1.n:int-->3<!--/n--> | <!--n:exp1.by_trait.language.js.lanes_v1.solve_rate:prob1-->33.3%<!--/n--> | <!--n:exp1.by_trait.language.js.lanes_v1.cost_mean:usd4-->$0.0280<!--/n--> |
| `rust` | <!--n:exp1.by_trait.language.rust.control.n:int-->13<!--/n--> | <!--n:exp1.by_trait.language.rust.control.solve_rate:prob1-->23.1%<!--/n--> | <!--n:exp1.by_trait.language.rust.control.cost_mean:usd4-->$0.1122<!--/n--> | <!--n:exp1.by_trait.language.rust.lanes_v1.n:int-->8<!--/n--> | <!--n:exp1.by_trait.language.rust.lanes_v1.solve_rate:prob1-->25.0%<!--/n--> | <!--n:exp1.by_trait.language.rust.lanes_v1.cost_mean:usd4-->$0.0444<!--/n--> |
| `ts` | <!--n:exp1.by_trait.language.ts.control.n:int-->1<!--/n--> | <!--n:exp1.by_trait.language.ts.control.solve_rate:prob1-->100.0%<!--/n--> | <!--n:exp1.by_trait.language.ts.control.cost_mean:usd4-->$0.0542<!--/n--> | <!--n:exp1.by_trait.language.ts.lanes_v1.n:int-->1<!--/n--> | <!--n:exp1.by_trait.language.ts.lanes_v1.solve_rate:prob1-->0.0%<!--/n--> | <!--n:exp1.by_trait.language.ts.lanes_v1.cost_mean:usd4-->$0.0303<!--/n--> |
<!--results:end-->
