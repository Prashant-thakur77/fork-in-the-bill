# Script with timings

Total 2:38.8. Voice: one narrator. Times are where each line starts in the film.

| Time | Scene | Narration (as captioned) | Picture |
|---|---|---|---|
| 0:00.5 | bill | Most of a coding agent's bill is grunt work: searching files, reading logs, running tests. | Driving at dusk toward a toll gantry; the road surface reads SEARCH FILES, READ LOGS, RUN TESTS; the gantry shows the worker lane's share of spend (illustration, figures from the run) |
| 0:05.9 |  | In our all-Sonnet runs, that was 62.5% of the spend. |  |
| 0:10.9 | question | So hand the grunt work to a small model. Does the bill drop, or do you just fix fewer bugs? | The road forks into two signed lanes: control (Sonnet, Sonnet) and lanes_v1 (Sonnet, Haiku) (illustration) |
| 0:16.8 | answer | We ran it as a real A/B test in Flagsmith, on 145 real bug fixes. | Real Flagsmith results page for experiment 1: hypothesis, then the green winner banner; LED card of cost per solved task |
| 0:23.2 |  | Flagsmith's verdict: more than 99% chance the cheaper lane wins. |  |
| 0:28.0 |  | Each solved task costs less than half as much. |  |
| 0:32.6 | title | This is Fork in the Bill: a pre-registered experiment on a coding agent's model routing. | Title sign: Fork in the Bill |
| 0:39.2 | prereg | Before the first task ran, we wrote down the hypothesis and the rule for shipping, hashed the file, and tagged the commit. | Real terminal: sha256sum -c prereg/HASHES.txt, git tag -l, git log of the tagged commit; the registration stamp |
| 0:46.6 | flag | Everything hangs on one Flagsmith flag, agent_routing. Its value is the whole routing policy. | Real Flagsmith features page: agent_routing and its value |
| 0:53.2 | arms | Control keeps Sonnet on both lanes. lanes_v1 moves the worker lane to Haiku. Nothing else changes. | The two arms as hung signs, and the one differing field read from flagsmith/policies/*.json |
| 1:00.4 | split | Each task is one Flagsmith identity. Flagsmith hashes it and picks the lane, fifty-fifty. We never choose. | The exposure line of harness/policy.py; real task identities of runs/exp1 taking their recorded lanes |
| 1:07.6 | metrics | task_cost and task_solved go back to Flagsmith as events: the goal metric and the guardrail. | Real Flagsmith metrics page: task_cost and task_solved |
| 1:14.8 | verdict | Then, Flagsmith's results page. Cost per task: down −56.6%. | Real Flagsmith results page: lift, credible interval, win probability; LED card of our own means |
| 1:20.3 |  | The whole credible interval sits below −44%. |  |
| 1:25.5 | guard | The guardrail: solve rate fell 4.2 points, and it is 97.7% likely to be inside our margin. | One car per task in two lots; solved tasks turn their lights on (counts from the run) |
| 1:33.2 | ship | All three conditions met. The rule said ship. | The registered rule as three toll barriers; readings arrive, the arms lift, the car drives through |
| 1:38.6 | rollout | So we ended the experiment in Flagsmith, and the winner became the flag's own value. | Real Flagsmith results page: lanes_v1 rolled out to everyone; lane-closure card; rollout batch figures |
| 1:43.5 |  | A fresh batch of 13 tasks ran on the same flag, with no code change. |  |
| 1:49.3 | limits | The caveat: a big drop in solve rate is excluded, a small one is not, and on the newest tasks alone the check did not clear its bar. | One barrier at dusk that does not lift: the newest tasks alone |
| 1:58.1 | verify | Don't take our word for it. One command checks the ledger and re-derives every lane with Flagsmith's own engine. | Real terminal: verify_ledger and verify_assignment on runs/exp1 |
| 2:04.3 |  | All 146 match. |  |
| 2:07.4 | tamper | Change one record in a copy, and the chain breaks. | Real terminal: one record of a copy edited, verify_ledger prints MISMATCH (planted, labelled) |
| 2:12.8 | exp2 | Experiment two is running now on the same flag: the small model drafts the patch, Sonnet reviews it. | Real Flagsmith page of experiment 2, running at capture (the slot) |
| 2:19.6 | exp2b | It was registered before its first task, and the live board shows each lane's spend. | Live site /live with experiment 2's running totals (the slot) |
| 2:25.6 | get | Every transcript and graded patch is public, and the kit installs from npm. | Live site home page |
| 2:30.8 | close | Before you trust a routing claim, run the test. Fork in the Bill. | End sign with the repository and site addresses |

Scene starts: bill 0:00.0, question 0:10.6, answer 0:16.4, title 0:32.1, prereg 0:38.6, flag 0:45.9, arms 0:52.9, split 1:00.1, metrics 1:07.2, verdict 1:14.1, guard 1:25.1, ship 1:32.9, rollout 1:38.2, limits 1:48.8, verify 1:57.5, tamper 2:07.0, exp2 2:12.3, exp2b 2:19.3, get 2:25.0, close 2:30.3
