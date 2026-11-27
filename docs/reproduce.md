# Reproduce it

This page takes you from a clone to four checks: the registrations are the ones that were tagged, the run ledgers are intact, every task ran the arm Flagsmith's hashing gives it, and the published numbers come out of the committed logs again. None of it needs a Flagsmith key, a model key, Docker or any money. After the install, the checks take under a minute of compute.

The output shown here was captured on 27 November 2026 at the commit tagged `v0.2.0`, with the release tooling from this branch on top. Counts will grow when experiment 2 is added; the experiment 1 figures will not change.

## What you need

Python 3.12 or newer, [uv](https://docs.astral.sh/uv/), git and make. The clone is about 350 MB because the run logs are committed.

If you would rather not install anything, open the repository in a GitHub codespace. [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json) builds a container with Python 3.12, uv and Node 22 and runs the `uv sync` below for you, so you can start at step 2. The steps on this page were also run in that container's base image, on Python 3.12.16, and gave the same Merkle roots and the same comparison result as the laptop the excerpts come from.

## 1. Clone and install

```sh
git clone https://github.com/Prashant-thakur77/fork-in-the-bill
cd fork-in-the-bill
uv sync --locked --all-extras --dev
```

`--locked` makes uv fail if `uv.lock` does not match `pyproject.toml`, so you get the versions the analysis was run with. The extras are only needed for `make check` in step 5; `uv sync --locked` is enough for steps 2 to 4.

## 2. The registrations are the ones that were tagged

Each experiment's plan was committed and tagged before its first task ran. `prereg/HASHES.txt` lists the SHA-256 of each file.

```sh
sha256sum -c prereg/HASHES.txt
```

```
prereg/experiment-1.md: OK
prereg/pilot-report.md: OK
prereg/experiment-1-amendment-1.md: OK
prereg/experiment-2.md: OK
```

That shows the files match the list, which would also be true if someone had edited both. The tag settles it: read the file as it was at the tag and hash that.

```sh
git show prereg-exp1:prereg/experiment-1.md | sha256sum
git log -1 --format='%h %cI %s' prereg-exp1
```

```
44d715bd6bd7f8580e8bb1950a21ea852dfea4daaf040c84009f391bf56e19c2  -
c0856c6 2026-11-27T04:27:35+05:30 Pre-register experiment 1
```

The hash is the first line of `HASHES.txt`. The commit time is 22:57:35 UTC on 26 November, and `runs/exp1/meta.json` records the run starting at `2026-11-26T23:02:48.309+00:00`, five minutes later. The same two commands work for `prereg-exp1-amend1` (`prereg/experiment-1-amendment-1.md`) and `prereg-exp2` (`prereg/experiment-2.md`).

## 3. Ledgers and assignments

```sh
make verify
```

This runs `integrity.verify_ledger` on every directory under `runs/`, then `integrity.verify_assignment` on the two runs where Flagsmith chose the arm. It took four seconds on the laptop this was captured on. Each ledger prints two lines; these are the ones for `exp1`, followed by the end of the output:

```
records=467 task_done=146
merkle_root=7ed364648c7513ef22280eaed97a2ab77e92d91b8f88f5bbfab08d747a989929
```

```
runs/exp1/ assignments match Flagsmith engine
runs/rollout/ assignments match Flagsmith engine
```

`verify_ledger` recomputes every record's hash from the previous hash and the record's payload, so an edited, removed or reordered record makes it print a `MISMATCH` line and exit 1. The Merkle root is computed over the 146 `task_done` records. Compare it with the root in the README's integrity section and with `integrity.merkle_root` in `analysis/out/numbers.json`; a release's notes carry it too.

To see what the assignment check did, run it on one directory without the Makefile's redirect:

```sh
uv run python -m integrity.verify_assignment --run runs/exp1
```

```
{
  "run": "runs/exp1",
  "env_file": "runs/exp1/env/000-start.json",
  "env_sha256": "9f01eed3330f17025faa1655eb31b09d9fcd77503487822c81a355e9925c0826",
  "env_updated_at": "2026-11-26T23:02:34.400405+00:00",
  "flag": "agent_routing",
  "flag_engine_version": "11.1.2",
  "flagsmith_sdk_version": "6.7.0",
  "records": 146,
  "checked": 146,
  "matched": 146,
  "match_rate": 1.0,
  "recorded_counts": {
    "control": 76,
    "lanes_v1": 70
  },
  "expected_counts": {
    "control": 76,
    "lanes_v1": 70
  },
  "mismatched": [],
```

It loads the environment document saved at the start of the run, evaluates each of the 146 identities with Flagsmith's own flag engine, and compares the arm with the one written in `tasks.jsonl`. Nobody chose which task got which model. The arm follows from a hash of the task's identity, the environment's client-side key and ids in the environment document, and you have just recomputed it.

## 4. Re-derive the numbers

```sh
make analyse
```

Seven seconds on the same laptop. It converts the logs to Parquet under `analysis/out/parquet/`, recomputes every statistic into `analysis/out/numbers.json` (bootstrap and posterior draws use fixed seeds), redraws the charts, and ends with the consistency gate:

```
uv run python -m analysis.analyse --runs runs --out analysis/out
wrote analysis/out/numbers.json
ok    README.md (93 markers)
wrote analysis/results.md (193 markers)
ok    docs/paper.md (245 markers)
ok    docs/build/deck.html (59 markers)
ok    board/web/src/seed.json (0 markers)
skip video/captions.json (not found)
uv run python -m analysis.charts
wrote analysis/charts/exp1-cost-distribution.png
```

```
uv run python -m analysis.check_consistency
notice: video/captions.json not found, skipped
consistent
```

`ok` means a document already showed exactly what the fresh numbers format to. Now ask git what changed:

```sh
git status --short
```

```
 M analysis/out/numbers.json
 M analysis/results.md
```

Two files, and neither change is a number. `numbers.json` gets a new `generated_at` and `source_commit` on every run. `results.md` comes out with the same tables in another order: `make analyse` writes the by-trait tables in the order it computed them, while the committed file was last written by `analysis.render_docs` from the saved JSON, whose keys are sorted. The charts are byte-identical, so git does not list them.

You do not have to take the "neither change is a number" on trust. This compares the file you just produced with the committed one, value by value:

```sh
uv run python -m tools.compare_numbers
```

```
462 values match HEAD (ignored: generated_at, source_commit)
```

Floats are compared with a relative tolerance of 1e-9, because a different CPU or thread count can change the last bits of a sum. On the machine this was captured on, the values were identical to the last digit. If a value differs, the script prints its key with both values and exits 1.

Then put the two files back, so the tree is clean again:

```sh
git restore analysis/out/numbers.json analysis/results.md
```

`numbers.json` in the repository was restored the same way after these commands were run for this page.

## 5. The documents say what the numbers say

`make analyse` already ended with `consistent`. That line comes from `analysis.check_consistency`, which re-renders every number marker in the README, `analysis/results.md`, the paper and the deck from `numbers.json` and fails on any marker that shows something else, or on a bare number inside a results section. To run it with the linters, the type checker and the unit tests:

```sh
make check
```

```
All checks passed!
120 files already formatted
0 errors, 0 warnings, 0 informations
221 passed, 1 deselected in 14.61s
consistent
```

(Excerpt: the command echoes, the progress dots and one pytest deprecation warning are left out.) The tests replay recorded model responses and spend nothing. One test is deselected because it carries the `docker` marker. On a machine with no Docker daemon, a codespace for example, five container tests are skipped as well and the line reads `216 passed, 5 skipped, 1 deselected`.

## 6. Check a release download

Releases built by [`.github/workflows/release.yml`](../.github/workflows/release.yml) attach the two PDFs, `numbers.json`, `results.md`, the Parquet export and a `SHA256SUMS` file, and sign a build provenance attestation for each asset. With the assets in one directory:

```sh
sha256sum -c SHA256SUMS
gh attestation verify run-data-parquet.zip --repo Prashant-thakur77/fork-in-the-bill
```

The second command needs the GitHub CLI. It confirms the file came out of a workflow run in this repository, and prints which workflow and commit. `v0.1.0` and `v0.2.0` were uploaded by hand before the workflow existed, so they have no attestations; `v0.2.0` has a `SHA256SUMS`, `v0.1.0` does not.

## What this does not reproduce

The agent runs themselves. Running the tasks again needs an Anthropic key, a Flagsmith environment and Docker, costs money, and would not give the same transcripts, because model output is not deterministic. What you verified above is that the published numbers follow from the published logs, and that the logs have not been altered since their Merkle root was published.

Whether a task was solved. `tasks.jsonl` records the grading result for each task, but the transcripts and test logs behind it (`runs/raw/`) are too large for git. They are not in the repository, and not among the `v0.1.0` and `v0.2.0` release assets. Re-grading means re-running the task's container.

Flagsmith's own statistics. The chance to beat control and the guardrail status are read from the response saved in `analysis/flagsmith/exp1/`. Fetching it again needs the project's keys. The analysis recomputes the per-arm means from the logs and reports the gap to Flagsmith's figures, so a disagreement would show, but Flagsmith's Bayesian readout is quoted, not recomputed.

That the ledger was written during the run. A hash chain shows the records are consistent with each other, and a commit date is whatever the committer's clock said. The evidence for timing has to come from outside the files: when the tags reached GitHub, and Flagsmith's own record of the experiment, which only the project's account can show.

The PDFs, byte for byte. `make docs` rebuilds `docs/paper.pdf` and `docs/deck.pdf` with Playwright's Chromium (`npx playwright install --with-deps chromium` on a fresh machine), and the files differ on every build because a PDF embeds its creation time. The text and figures are the same, since both are filled from `numbers.json`.
