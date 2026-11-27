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
Masthead (wordmark, VMS status LED, mode badge: Live / Not started / Final numbers / Replay, Flagsmith link), Junction (gantry beam, guide signs with exit tab, LED meter and three stats; lane-use signals; plan-view road), Rule list (diamond numbers, figure, state tag), Verdict sign with rate table, Work-zone board with rate table, Receipt, Flag history (summary plate with state tag, then mileposts on one painted line: green diamond start or rollout, yellow end, hollow audit or no-op save, red a change during the run), Footer.

## States
Awaiting run: signals dark, LED `$---.--`, stats dashes, verdict/exp2/receipt read "pending". Running, ended (yellow X both lanes), rolled out (winner green arrow, loser red X + cones + plate). Replay: orange "Replay · fixture data" badge and an orange-outlined control bar (play, pause, scrub).

---

# The site around the board

The board became one page (`/live`) of a multi-page site. Same taste, tokens, type and motion vocabulary; the junction world is extended, not replaced. Dials for the story pages: CRAZINESS 7, MOTION 7, DENSITY 5, ART 7, PLAY 4, CALM 7. Content pages run quieter (MOTION 4): signs hang in, headings rise, nothing moves while it is being read.

## Pages and structure
Each route is prerendered to its own HTML file at build (`scripts/prerender.mjs`), so every page reads without JavaScript and deep links survive a reload. The Worker serves `/x` from `x.html` and unknown paths from `404.html`. After load, a small router (`src/site/router.tsx`) swaps pages in place.

| Path | Sign | Purpose | Art |
|---|---|---|---|
| `/` | Exit 0 | Story page: what, why, how, the rule, live teaser, proof, kit, FAQ | hero junction with traffic and the Flagsmith gantry; task-journey road |
| `/live` | Exit 1 | The board, unchanged in behaviour | junction, LED meters, signals, flag history |
| `/how-it-works` | Exit 2 | The two-lane harness, caps, grading | harness plan: two lanes in a container, ramps, grading box |
| `/why-flagsmith` | Exit 3 | Why the experiment cannot exist without Flagsmith | task-journey road (full), open lane vs closed lane comparison |
| `/method` | Exit 4 | Prereg, rule, margin, power, pools, amendment | hash plates, margin stamp |
| `/results` | Exit 5 | Verdict, or the work-zone "run in progress" state | work-zone board, live panel on asphalt |
| `/flagsmith` | Exit 6 | Every Flagsmith feature used, with code | code housings |
| `/proof` | Exit 7 | Receipt and the commands to check it | receipt printer |
| `/kit` | Exit 8 | Python and TypeScript quickstart, modes, self-hosting | step plates |
| `/timeline` | Exit 9 | PROGRESS.md as a road with a sign per phase | vertical road, lane-use signal per phase, mileposts |
| `/decisions` | Exit 10 | DECISIONS.md, indexed | index plates |
| `/glossary` | Exit 11 | Plain definitions | letter plates |
| 404 | ? | Wrong exit | work-zone board, barricade, LED "WRONG EXIT" |

Navigation: five main items (Live board, How it works, Why Flagsmith, Method, Results) and "More" (a hung green panel listing the rest). Footer columns: The experiment, Evidence, Build your own, Source.

Every page opens with the **page sign**: breadcrumbs, a steel gantry, a green guide sign with a yellow "Exit n" tab, the title (kinetic) and one plain sentence of purpose. Long pages add an "On this page" list (sticky on desktop, a box on mobile) with a yellow bar on the current section.

## Content rule
Every number on the site is read at build time from a repo file (`scripts/repo-data.mjs`: prereg, HASHES.txt, power.json, pilot.json, manifest.json, policies, pricing.json, uv.lock, numbers.json when present) or live from the board API. Code snippets are cut from the source files by anchor; a moved anchor fails the build. Results stay empty until `analysis/out/numbers.json` exists.

## Added tokens (src/site/site.css)
| Token | Value | Use |
|---|---|---|
| `--t-h1` | `clamp(40px, 5.6vw, 92px)` (40 / 81) | page-sign titles, 900, lh 0.95, -0.035em |
| `--t-h2s` | `clamp(30px, 3.6vw, 56px)` (30 / 52) | story and doc section heads, 900, lh 1 |
| `--t-h3` | `clamp(19px, 1.5vw, 23px)` (19 / 22) | sub-heads, 800 |
| `--header-h` | 68px (60px under 760) | sticky header |
| `--maxw` | 1320px | content pages |
| z layers | header 40, menu 60, wipe 80 | |
Fallback face "Overpass Fallback" (Arial with size-adjust 103%, ascent 86%, descent 36%) so text does not shift when Overpass loads; the latin Overpass file is preloaded.

## Logo
The mark is a guide-sign plate (green, white inset border) with a road that forks into two lanes, each ending in a sign arrowhead. It is the favicon, the header mark (34px) and the footer mark (88px). Drawn in code (`src/site/Logo.tsx`), so tokens recolour it.
Motion set (from the world's action, split):
- **Reveal** (header, on load, about 1.2 s): plate hung (clip from top, 450 ms expo.out), border draws (600 ms), trunk draws up (250 ms), both lanes draw (400 ms), arrowheads snap (160 ms power4.out, 40 ms stagger), then one amber task token runs up the trunk and takes a lane.
- **Hover / focus**: a token runs again and takes the other lane each time: the 50/50 split.
- **Idle** (footer only): the same run every 8 s while visible, paused off-screen.
- **Reduced motion**: the still mark.
Favicons (svg, 32, 180, 192, 512) and the share images are rendered from the same paths at build.

## Motion score: home page
Easings and durations are the board's: snap 160 ms `power4.out`, ui 320 ms, reveal 800 ms `expo.out`, show 1.6 s; signs swing in with `elastic.out(1, 0.6)` (the sign settling on its hangers). Vehicles and lane dashes are linear.
| Region | Entrance | Scroll | Idle life | Response | Exit |
|---|---|---|---|---|---|
| Header | logo reveal | hides going down (240 ms ease-in), returns going up (320 ms ease-out); hairline once scrolled | — | yellow bar slides to the active link (420 ms) | — |
| Hero | headline lines rise from masks (80 ms stagger), copy follows, gantry beam extends, signs swing in (140 ms stagger), signals snap, road paints | — | cars stream at constant speed and split at the Flagsmith gantry (illustration, labelled) | magnetic-free buttons press to 0.97 | traffic pauses off-screen |
| Problem | heading words rise; LED prices scan in row by row | — | — | — | — |
| Share bars | fill to the pilot's worker share (1.4 s power3.out), once | — | — | — | — |
| Two lanes | lane cards hang in one by one; the policy diff sits still to be read | — | — | — | — |
| Journey | heading rises | **pinned on desktop**: scroll drives two task tokens from the queue through the Flagsmith gantry into their lanes, events rise at the toll gantry, results sign lights, rule diamonds light, signals turn, rollout arrow; one caption at a time. On phones the diagram scrolls sideways and the scrub runs without a pin | — | — | — |
| Rule | rows hang in; the "Registered · sha256" stamp lands with a press | — | — | — | — |
| Live teaser | asphalt band; LED meters roll to the API's values (0.9 s) | — | live status refreshes every minute | — | — |
| Proof | the receipt prints out of its slot (18 steps, 1.4 s) | — | — | — | — |
| Kit | — | — | — | tab bar slides between Python and TypeScript (360 ms) | — |
| FAQ | — | — | — | diamond icon turns to a green check state; answer slides 6 px | — |
| Closing | the Next-exit sign swings in | — | arrow nudges toward the exit while visible | — | — |
| Lane rail | — | a yellow dashed lane line in the left margin paints with scroll (desktop) | — | — | — |

**Signature moment** stays the rollout lane closure on the board. Until the run ends it is playable as a labelled preview after the journey (home and /why-flagsmith): the visitor picks "If lanes_v1 ships" or "If control stays" and the other lane closes with the board's own timeline (signal snaps to red X, cones placed 90 ms apart, "Lane closed" plate lands, traffic merges); an orange "Preview, not a result" badge sits beside it; reduced motion shows the closed state without travel. The site's second showpiece is the pinned task journey (desktop); mobile fallback is the unpinned scrub; reduced motion shows the finished still with every step lit and every caption listed.

**Page transition: lane change.** An asphalt panel with a slanted dashed lane line sweeps in from the left (260 ms power2.in), the page swaps underneath and scrolls to top, focus moves to `main`, then the panel leaves to the right (340 ms power3.out) while the lane line shifts over. Reduced motion: instant swap.

**Menu (under 1180px).** Full-screen asphalt sheet with one painted lane line, growing as a circle from the menu button (500 ms expo.out); links rise from masks with exit numbers (35 ms stagger); closes in 260 ms. Focus is trapped, Esc closes and returns focus, the page behind stops scrolling.

**Footer finale.** A steel gantry carries the green EXIT sign (big logo, idle token run, "Watch the live board", "Back to the start"); it swings in on its hangers. Below it, the road: a white edge line, lane dashes that run faster while the visitor scrolls and settle back to cruising, and the wordmark painted as road lettering (vertically stretched, white thermoplastic) whose letters rise from masks one by one. A yellow edge line closes the road. Then the link columns, the live run status from the API, the hackathon line and the build commit.

**Reduced motion.** No travel, scrub, pin, wipe, token runs or swings. Content and live numbers still update; the journey shows its final state.

## Art added
Task-journey road (plan view: queue cards, Flagsmith gantry with LED, fork, lane tabs, toll gantry with event plates, results sign, rule diamonds, lane signal, rollout arrow, numbered yellow diamonds). Harness plan (dashed container, two lanes, delegate and findings ramps with amber plates, grading box with tick). Timeline road (vertical asphalt, yellow kilometre plates, lane-use signals per phase). Work-zone states for results-pending and 404. Share images: the page sign with its title on an amber LED panel.
Art stops at dense content: decision text, tables and code sit on plain surfaces.

## Play pieces
Each one changes something real or teaches the experiment; every figure is read from the repo or the API, and anything illustrative carries an orange label.
| Piece | Where | Action | What it teaches | Data |
|---|---|---|---|---|
| Guess the grunt-work share | home, problem | drag a range, reveal, guess again | how much of control's bill is worker-lane work, and how far it falls with the small model | `analysis/out/pilot.json` delegate_share |
| Move the split yourself | home and /why-flagsmith, after the journey | drag the divider, arrow keys (Shift ±10, Home/End), tap the road; type or pick a task id | Flagsmith buckets by hashing the identity (md5, mod 9999, 0-100); moving the split moves only the tasks it crosses | real exp1 pool ids; stand-in key, labelled "Illustration" |
| Play the decision | home and /why-flagsmith, after the split lab | pick an outcome, reopen | what each outcome ships: the closed lane's LED turns red CLOSED, the last cars clear, cones land, the plate hangs; the stakes line gives that lane's pilot cost and solves | `pilot.json`, labelled "Preview, not a result" |
Reduced motion: no travel or tweens; states still change.

## Vehicles
`src/art/car.ts`: plan-view sedan, estate, hatch and van in four sheeting tones (sheet, concrete, steel, graphite), a flat offset shadow, panel lines, pale head lights, red tail lights and an amber toll tag (amber = money). Cars fade out as they pass under the gantry. On a lane closure, cars still on the shared trunk merge into the open lane, cars already in the closed lane clear it, then the cones are placed behind the last one.

## Live data
The site reads `/state?experiment=exp1` (a `?experiment=` query on the page reads another batch), because the board API keeps the latest totals of every batch that posts to it. Experiment 1 always draws both lanes; when nothing is running, a plate on the asphalt says so.
