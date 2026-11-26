# Fork in the Bill board: design system

## Taste
- IS: **exact** (every figure is a fixed sign reading, tabular, dot-matrix true), **wayfinding-plain** (one road, two lanes, readable at a glance), **alive** (traffic moves while the run is live; LED digits switch; signals change).
- NEVER: fintech-slick (no gradients, glass, neon everywhere), cute (no cartoon cars, emoji, mascots), noisy (no particles, nothing moving over a number being read).
- Feel in motion: mechanical and steady. Vehicles glide at constant speed; signals snap; LEDs scan row by row; signs are hung (clip from the top).
- Material: retroreflective sign sheeting, galvanised steel, asphalt, thermoplastic paint, amber LED matrix with unlit dots, thermal receipt paper.
- Lines not to cross: no real highway shields or agency marks, no company logos (Flagsmith is a text link only), no numbers outside replay mode until the run has them.

## Concept
A tolled motorway junction. Tasks arrive on one road (the queue); Flagsmith's bucketing forks them into one lane per arm. Each lane has an overhead guide sign with an amber LED toll meter showing what that arm has spent. Lane-use signals carry the experiment status. Rollout closes the losing lane with cones and a "Lane closed" plate. The negative second experiment is a work-zone board. The integrity proof is a toll receipt.

## Colour tokens (src/styles.css)
| Token | Hex | Source / role |
|---|---|---|
| `--ground` | #ECEAE3 | dry concrete; page |
| `--surface` / `--inset` / `--line` | #F6F5F0 / #DFDDD4 / #C9C6BB | raised rows / pending panels / rules |
| `--text` / `--quiet` | #1B211E / #4A514C | text 13.6:1, quiet 6.8:1 on ground |
| `--sign` / `--sheet` | #0B6B45 / #F4F5EF | guide-sign green and sheeting white (5.98:1) |
| `--housing` / `--led` / `--led-quiet` | #141716 / #FFB21A / #C48A1C | LED housings; amber LED (10:1) |
| `--asphalt` / `--paint` / `--paint-yellow` | #2B2E2D / #F4F5EF / #EDBB2C | road, markings, the question rule and the rule diamonds |
| `--orange` / `--orange-text` | #EE6A1F / #9E3E0A | work zone, closures, replay badge (text on orange is `--text`, 5.2:1) |
| `--red` / `--red-text` | #D7261E / #A91C15 | "not met" only |
| signal green / yellow / red | #3BD67A / #EDBB2C / #FF4A3D | lane-use signals only (on housing) |
Meaning is fixed: green = guide sign / open lane / rule met; amber = money; orange = closed or not real (replay); red = not met / closed signal. Checked with `.design/palette-check.mjs`.

## Type
Overpass (variable, OFL; derived from the road-sign letterform) for everything; Overpass Mono for receipts, hashes, the last-task line; a hand-built 5x7 LED matrix (src/led) for meters and the status sign.
| Role | Spec | 360 / 1440 |
|---|---|---|
| Display | 900, `clamp(52px, 5.2vw, 108px)`, lh 0.9, -0.035em | 52 / 75 |
| h2 | 900, `clamp(28px, 2.9vw, 46px)`, lh 1, -0.025em | 28 / 42 |
| Sign legend | 800, `clamp(18px, 1.7vw, 30px)` | 18 / 24 |
| Lead | 400/700, `clamp(17px, 1.25vw, 20px)`, max 38ch | 17 / 18 |
| Body | 400, 17px, lh 1.55 | 17 |
| Small / mono | 14px | 14 |
| Label | 600-800, 12px, +0.06em caps (LED captions, badges, rule state only) | 12 |
Numbers: tabular everywhere.

## Motion
Durations: snap 160 ms, ui 320 ms, reveal 800 ms, show 1.6 s. Easings: snap `power4.out`, reveal `expo.out`, exit `power2.in`, merge `power2.inOut`. Vehicles and the footer dashes are linear (constant speed).
Score:
- Load: masthead items drop in (320 ms, 50 ms stagger); headline lines rise from masks; the gantry beam extends left to right; signs are hung (clip from top, 120 ms stagger); signals snap on; road markings draw. LED panels row-scan (18 ms per row) on first paint.
- Live: cars = running tasks, released one at a time from the shared trunk to the lane furthest below its count, 125 units/s; meters roll to new values over 0.9 s; the status sign row-scans when its message changes; the last-task line prints in (260 ms, steps).
- Signature (rollout): losing lane's signal snaps to a red X, seven cones place one by one across the lane (90 ms stagger, back-out), the orange "Lane closed" plate lands on its sign (scale 1.35 to 1), the sign desaturates; traffic continues into the winning lane only.
- Scroll: rule rows and boards are hung (clip from top + 16 px drop), the receipt prints (clip, 18 steps over 1.4 s); each plays once.
- Footer: an asphalt band with lane dashes running at constant speed, then the exit sign.
- Reduced motion: no travel, no scans or tweens; cars drawn static at their positions; numbers and states still update.

## Components
Masthead (wordmark, VMS status LED, mode badge: Live / Not started / Final numbers / Replay, Flagsmith link), Junction (gantry beam, guide signs with exit tab, LED meter and three stats; lane-use signals; plan-view road), Rule list (diamond numbers, figure, state tag), Verdict sign with rate table, Work-zone board with rate table, Receipt, Footer.

## States
Awaiting run: signals dark, LED `$---.--`, stats dashes, verdict/exp2/receipt read "pending". Running, ended (yellow X both lanes), rolled out (winner green arrow, loser red X + cones + plate). Replay: orange "Replay · fixture data" badge and an orange-outlined control bar (play, pause, scrub).
