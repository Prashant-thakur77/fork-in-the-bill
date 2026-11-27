# Script with timings

Total 3:24.5. Two narrators: A tells the story, B gives the evidence. Times are where each line starts in the film.

| Time | Scene | Voice | Narration (as captioned) | Picture |
|---|---|---|---|---|
| 0:00.2 | problem | A | A coding agent bills you by the token. | Dusk drive; the road surface reads SEARCH FILES, READ LOGS, RUN TESTS (illustration) |
| 0:02.3 |  | A | Most tokens are grunt work: searching files, reading logs, running tests. |  |
| 0:07.5 | flagsmith | A | We tested the fix as a real experiment. | The fork, with the FLAGSMITH gantry over it for the first time |
| 0:09.8 |  | A | Flagsmith picks every lane, and judges the result. |  |
| 0:12.7 | why | B | Why it matters: grunt work is paid at the frontier price, 20 times the small model's. | LED board: the price gap, the worker lane's share of the bill, a bill that grows with every task; small citation |
| 0:17.8 |  | B | It was 62.5% of our all-Sonnet bill, and it grows with every task. |  |
| 0:22.2 |  | B | A cheaper model is tempting, but it can quietly fix fewer bugs. |  |
| 0:26.1 | answer | A | On 145 real bug fixes, Flagsmith's verdict: over 99% chance the cheaper lane wins. | Real Flagsmith results page: the winner banner |
| 0:33.0 | money | B | Each solved bug: $0.1753 before, $0.0837 after. | LED board: worker-lane spend per task, cost per solved bug, the projection ladder and the example team (labelled as arithmetic) |
| 0:37.2 |  | B | Per thousand bugs, about $91.53 saved. |  |
| 0:40.6 |  | B | A team fixing a thousand a month keeps about $1,098.35 a year. |  |
| 0:44.8 | title | A | This is Fork in the Bill. | Title sign |
| 0:47.4 | different | B | Most routing claims are benchmark scores, read afterwards. | The site's /different page, then the lane board: the usual way coned off, this experiment's way with its evidence |
| 0:51.5 |  | B | Here the bugs are real. |  |
| 0:53.2 |  | B | Flagsmith assigns every task. |  |
| 0:55.7 |  | B | The rule is hashed first. |  |
| 0:58.1 |  | B | And the price is per solved bug. |  |
| 1:00.7 | map1 | B | Tasks are drawn with a fixed seed, checked against their gold patch, blind to the arm, then queued. | Route map (diagram): task pool, validation, queue, worker |
| 1:06.0 | assign | B | The worker asks Flagsmith. One identity per task. | Route map to the Flagsmith gantry; the get_experiment_flag line with real identities; the real flag page; the one-field diff |
| 1:09.4 |  | B | Flagsmith hashes it into a lane and returns that lane's policy. |  |
| 1:13.2 |  | B | One flag carries the whole policy. The lanes differ in one field. |  |
| 1:17.3 | map2 | B | Planner and worker fix the bug in a sealed container. A fresh container runs the tests. | Route map: planner and worker lanes in a sealed container, grading container |
| 1:21.9 | metrics | B | Two events go back to Flagsmith: task_cost is the goal, task_solved is the guardrail. | Route map to the second Flagsmith gantry; the real Flagsmith metrics page |
| 1:26.8 | integrity | B | Every step enters a hash-chained ledger, and the Flagsmith environment is snapshotted throughout. | Route map: the integrity service road with its four posts and counts |
| 1:31.7 | board | | (no narration) | Real capture of the site's /live board (no narration) |
| 1:34.0 | verdict | A | Flagsmith's results page: cost per task, down −56.6%. | Real Flagsmith results page: lift, credible interval, win probability; LED card of our own means |
| 1:38.7 |  | A | The whole credible interval sits below −44%. |  |
| 1:42.2 |  | A | Our replication matches Flagsmith's means to a hundredth of a cent. |  |
| 1:47.0 | guard | A | The guardrail: solve rate fell 4.2 points, 97.7% likely inside our margin. | One car per task; solved tasks light up |
| 1:53.5 | ship | A | All three conditions met. The rule said: ship it. | The registered rule as three barriers that lift |
| 1:57.7 | rollout | A | We ended the experiment in Flagsmith, and the winner became the flag's own value. | Real Flagsmith page: lanes_v1 rolled out to everyone; rollout batch figures |
| 2:02.0 |  | A | A fresh batch ran on it, with no code change. |  |
| 2:05.5 | limits | A | The caveat: a big drop in solve rate is excluded, a small one is not, and on the newest tasks alone the check did not clear its bar. | The barrier that stays down; then the caveat inside the result card on the site's home page |
| 2:14.2 | proof | B | All 146 lanes re-derived with Flagsmith's own engine. | Proof run, one real capture per line: verify_assignment; /verify in the browser; a planted edit failing; the transcripts; /scale and the CI and test run; the examples; the re-analysis; the release attestation |
| 2:18.1 |  | B | A hash-chained ledger and a Merkle root, checkable in your browser. |  |
| 2:21.7 |  | B | Edit one record, and it fails. |  |
| 2:24.1 |  | B | 163 transcripts and graded patches, published. |  |
| 2:27.8 |  | B | 994,644 graded test results. CI green. |  |
| 2:31.1 |  | B | 9 examples on self-hosted Flagsmith. |  |
| 2:33.9 |  | B | The analysis reruns from the logs with one command. |  |
| 2:36.9 |  | B | Releases carry signed provenance. |  |
| 2:40.3 | research | B | Four more checks, in code. | The real charts (always-valid test, specification curve, frontier), the Merkle proof in the terminal, the site's /research page |
| 2:42.6 |  | B | An always-valid test: cost crossed its threshold at task 72 of 145, and never came back. |  |
| 2:50.2 |  | B | A specification curve: the cost per bug fixed is lower in all 72 analyses, and the guardrail fails only on the newest tasks. |  |
| 2:58.2 |  | B | A cost frontier, and a Merkle proof for any single task. |  |
| 3:02.2 | exp2 | A | Experiment two is running now on the same flag, registered first: the small model drafts, Sonnet reviews. | Real Flagsmith page of experiment 2, running at capture, and the live board (the slot) |
| 3:08.9 | run | A | Less than half the cost per bug fixed. | Closing run: cost LED, winner banner, rolled out, the consistency gate, the name, the site with the npm commands |
| 3:11.9 |  | B | Assigned and judged by Flagsmith. |  |
| 3:14.1 |  | A | Rolled out on the same flag. |  |
| 3:16.1 |  | B | Every number checked in public. |  |
| 3:18.2 |  | A | Fork in the Bill. |  |
| 3:19.8 |  | B | Run it on your agent. |  |
| 3:21.2 | close | | (no narration) | End sign with the repository and site addresses |

Scene starts: problem 0:00.0, flagsmith 0:07.3, why 0:12.4, answer 0:25.6, money 0:32.7, title 0:44.5, different 0:46.4, map1 1:00.5, assign 1:05.8, map2 1:17.1, metrics 1:21.7, integrity 1:26.6, board 1:31.7, verdict 1:33.5, guard 1:46.8, ship 1:53.2, rollout 1:57.4, limits 2:05.2, proof 2:13.9, research 2:40.0, exp2 3:01.9, run 3:08.6, close 3:21.2
