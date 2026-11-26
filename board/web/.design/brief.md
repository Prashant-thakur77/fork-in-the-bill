# Brief: Fork in the Bill live board

- Subject: a pre-registered Flagsmith A/B test on a coding agent's model routing. Arm `control` uses the frontier model everywhere; arm `lanes_v1` sends delegated grunt work to a small model. Units are real SWE-bench-Live tasks. Primary metric: mean USD per task; guardrail: solve rate.
- Audience: hackathon judges (Flagsmith engineers, devrel), developers who pay agent bills, and the demo-video viewer. They read dashboards all day; they trust numbers that show their method.
- One job: show, live, what each arm is spending and solving, and where the experiment stands. Primary action: open the Flagsmith results.
- Must appear: per-arm dollar meters, tasks done, solves, cost per solve, status (running, ended, rolled out), Flagsmith results link, final verdict, experiment 2 (negative result), integrity proof (Merkle root, prereg sha256).
- States: awaiting run (no numbers), running, ended, rolled out; replay preview (fixture data, labelled).
- Stack: React + Vite + TS on Cloudflare Pages; Worker + D1 + SSE. Captured for a ~3 min demo video at 1920x1080.
- Dials: CRAZINESS 7, MOTION 7, DENSITY 5, ART 7, PLAY 4, CALM 7. (A live monitor people watch; play is light: scrub the replay, hover a lane.)

## The subject's world
A fork in the road (the 50/50 split), a bill (the spend), a git fork (the branch). Merged into one place: a **tolled highway junction**. Traffic (tasks) arrives on one road and Flagsmith's bucketing splits it into two lanes. Each lane has an overhead gantry with an amber LED price sign, the toll each lane is running up. Lane-use signals above the lanes (green down-arrow open, red X closed, yellow diagonal merge) carry the experiment status. Rollout = the losing lane closes and traffic merges into the winner. A second experiment that fails = a lane coned off with an orange "closed" board.
Materials: retroreflective sign sheeting, extruded aluminium, galvanised gantry steel, asphalt, thermoplastic lane paint, concrete barrier, amber LED matrices with unlit dots. Motion: steady traffic flow, LED digits switching instantly row by row, signals snapping, a slow merge. Sounds (not used): tyre hum, toll beep.
