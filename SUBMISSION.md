# Submission text

Paste-ready answers for the Toggle Wars submission form. Every figure is a marker filled from `analysis/out/numbers.json` by `analysis/render_docs.py` and checked by `analysis/check_consistency.py`.

## Project name

Fork in the Bill

## Track

Track 01: Test Something Real

## One-line pitch

A pre-registered Flagsmith A/B test on a coding agent's model routing: does a small model on the grunt-work lane cut the dollars spent per solved bug?

## Short description

A coding agent spends most of its tokens on grunt work: searching the repository, reading long files, running tests and reading the logs. We put that choice behind one Flagsmith flag. In `control` a frontier model (Claude Sonnet 5.5) does everything; in `lanes_v1` the grunt-work lane goes to a small model (Claude Haiku 5.5) and the frontier model still plans and writes every edit. Each real SWE-bench-Live bug fix is one Flagsmith identity, and Flagsmith's experiment picks its lane.

The hypothesis, the metrics and the shipping rule were hashed and tagged before the first task ran. On <!--n:exp1.arms.control.n_analysed:int-->76<!--/n--> control and <!--n:exp1.arms.lanes_v1.n_analysed:int-->69<!--/n--> lanes_v1 tasks, cost per solved task went from <!--n:exp1.arms.control.cost_per_solve:usd4-->$0.1753<!--/n--> to <!--n:exp1.arms.lanes_v1.cost_per_solve:usd4-->$0.0837<!--/n--> (<!--n:exp1.delta.cost_per_solve_pct:pct1-->−52.2%<!--/n-->). The solve rate was <!--n:exp1.arms.lanes_v1.solve_rate:prob1-->40.6%<!--/n--> against <!--n:exp1.arms.control.solve_rate:prob1-->44.7%<!--/n-->, a difference of <!--n:exp1.delta.solve_rate_pp:pp1-->−4.2 pp<!--/n--> with an interval from <!--n:exp1.delta.solve_rate_ci.0:pp1-->−19.8 pp<!--/n--> to <!--n:exp1.delta.solve_rate_ci.1:pp1-->+11.8 pp<!--/n-->. So a large drop is ruled out and a small one is not, and on the newest tasks alone (created after the models' training cutoff) the solve-rate check would not have cleared its bar. We say that next to the result everywhere.

The registered rule said ship <!--n:exp1.decision.ship:str-->lanes_v1<!--/n-->. We ended the experiment in Flagsmith with that variant as the rollout decision, and a fresh batch of <!--n:rollout.n:int-->13<!--/n--> tasks ran on the same flag with no code change. A second experiment on the same flag, where the small model drafts the patch and the frontier model reviews it, was registered before its first task.

## How Flagsmith is used

Flagsmith does the work the result depends on. The multivariate flag `agent_routing` carries the whole routing policy as its JSON value, so the two arms differ in one field. Each task is an identity with traits, and the experiment's bucketing assigns its arm; the runner never chooses. The exposure is recorded at the moment the policy is read (`harness/policy.py`), and `task_cost`, `task_solved`, `task_turns` and `task_seconds` go back as events. Flagsmith's results page computes the lift and the chance to beat control, and the registered decision rule reads that verdict: <!--n:exp1.flagsmith.chance_to_beat_control_cost:prob1-->100.0%<!--/n--> on `task_cost`. End Experiment then rolled the winner out on the same flag.

Around that core: setup and every experiment call go through the Flagsmith CLI v2; a kill switch flag (`routing_kill`); environment-document snapshots every 15 minutes to show the flag was not touched mid-run; every recorded arm re-derived offline with Flagsmith's own flag-engine (<!--n:integrity.assignment.matched:int-->146<!--/n--> of <!--n:integrity.assignment.checked:int-->146<!--/n--> match); flags described in Terraform with a read-only drift check; a self-hosted Flagsmith path; and a kit, published on npm as `forkbill` and `forkbill-mcp`, so another team can put its own agent's routing behind an experiment the same way.

## Links

- Repository: https://github.com/Prashant-thakur77/fork-in-the-bill
- Live site and board: https://forkbill.prashantthakur.dev
- Demo video: added when uploaded
- Paper (PDF): https://github.com/Prashant-thakur77/fork-in-the-bill/blob/main/docs/paper.pdf
- Releases: https://github.com/Prashant-thakur77/fork-in-the-bill/releases

## Team

CoffeeAndToggle
