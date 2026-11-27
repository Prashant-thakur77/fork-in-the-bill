# Contributing

Bug reports, replication reports and pull requests are welcome. The most useful thing you can send is a replication report: run the steps in [`docs/reproduce.md`](docs/reproduce.md) and tell us what you got, including when it matched.

This is a pre-registered experiment, so a few files follow stricter rules than ordinary code. They are at the end of this page, and CI enforces most of them.

## Setup

You need Python 3.12 or newer, [uv](https://docs.astral.sh/uv/), git and make. Node 22 is needed only for the board, the TypeScript kit and the PDF builder. Docker, `jq` and the Flagsmith CLI are needed only to run tasks.

```sh
git clone https://github.com/Prashant-thakur77/fork-in-the-bill
cd fork-in-the-bill
uv sync --locked --all-extras --dev
```

`make setup` runs the same sync without `--locked`, and also runs `npm ci` for the board and the TypeScript kit. A codespace gives you the Python part ready-made, from [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json).

No key is needed for anything on this page. To run tasks you would copy `.env.example` to `.env` and fill it in; `.env` is gitignored and must stay out of commits.

## Checks to run before a pull request

```sh
make check                          # ruff, pyright, unit tests, consistency gate
make verify                         # ledgers and assignments of every committed run
sha256sum -c prereg/HASHES.txt      # registration files are unchanged
uv run python tools/check_links.py  # relative links in README.md and docs/ resolve
```

CI runs the same four, a secret scan over the full history, and the board and kit builds. If you touched `board/` or the TypeScript under `kit/`, also run the steps of the matching job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

The unit tests replay recorded model responses. They make no network calls and spend nothing. A test that needs Docker carries the `docker` marker and is skipped by `make check`.

Installing the pre-commit hooks (`pip install pre-commit && pre-commit install`) runs the secret scan and ruff on every commit.

## Numbers come from the script

No figure in the README, the paper, the deck, `analysis/results.md` or the board is typed by hand. Each one is a marker that `analysis/render_docs.py` fills from `analysis/out/numbers.json`:

```
<!--n:exp1.delta.cost_per_solve_pct:pct1-->?<!--/n-->
```

The part before the second colon is a key in `numbers.json`, and the part after it is a format (`usd2`, `usd4`, `pct1`, `pp1`, `int`, `f3`, `prob1`, `hash12`, `str`). To cite a number, write the marker with a placeholder inside, as above, and run `uv run python -m analysis.render_docs`, which replaces the `?` with the formatted value. To cite a number that does not exist yet, add it to `analysis/analyse.py` first, with a test, and run `make analyse`.

`analysis.check_consistency` re-renders every marker and fails if one is stale, if its key is missing, or if a bare number appears between `<!--results:start-->` and `<!--results:end-->`. A constant that is not a result, such as a pre-registered threshold, goes inside `<!--lit-->...<!--/lit-->`. Do not edit `numbers.json` by hand. `make analyse` rewrites it from the run logs.

`make analyse` also changes `generated_at` and `source_commit` in `numbers.json` on every run. If nothing else changed (`uv run python -m tools.compare_numbers` says so), restore the file with `git restore analysis/out/numbers.json analysis/results.md` instead of committing a new timestamp.

## Registrations are immutable after their tag

Every file listed in `prereg/HASHES.txt` was committed and tagged (`prereg-exp1`, `prereg-exp1-amend1`, `prereg-exp2`) before the first task of its experiment ran. After the tag the file does not change, even to fix a typo or a trailing space. CI checks the hashes, and `.editorconfig` tells editors to leave these files alone.

A change of plan goes in a new file, the way `prereg/experiment-1-amendment-1.md` amends experiment 1. The new file says what changes and why, and whether any outcome data had been seen. It gets its own line in `HASHES.txt` and its own tag, before any task that depends on it runs. Tags are never moved or deleted.

## Run logs are append-only

Files under `runs/<exp>/` are written by the runner and committed as they are. Editing a record breaks the hash chain in `ledger.jsonl`, and `make verify` and CI will fail. If a run has a problem, describe it in `DECISIONS.md` and handle it in the analysis, where the handling is visible; do not repair the log.

## Commits and pull requests

One change per pull request. A commit message is one plain line that says what changed. Fill in the pull request template, including which checks you ran. Never commit a key, a token or a `.env` file; if you think you pushed one, treat it as leaked, rotate it, and see [`SECURITY.md`](SECURITY.md).

By contributing you agree that your contribution is released under the project's [MIT licence](LICENSE).
