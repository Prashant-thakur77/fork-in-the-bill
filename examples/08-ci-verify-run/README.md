# 08: verify a run directory in CI

A run directory holds what each task ran (`tasks.jsonl`), the Flagsmith environment document
saved when the run started (`env/000-start.json`) and a hash-chained ledger (`ledger.jsonl`).
Both checks on it work from files alone, so a CI job can run them with no Flagsmith account and
no secret, including on pull requests from forks.

The repository ships that job as a composite action,
[`.github/actions/verify-run`](../../.github/actions/verify-run/README.md), and its own CI uses
it on every committed run. This example shows how to call the action and what it prints when a
run passes and when it has been altered.

It is the only example that uses real study data and no Flagsmith instance: it checks
[`runs/exp1`](../../runs/exp1), the committed run of experiment 1.

## Files

| File | What it is |
|---|---|
| [`verify-run.yml`](verify-run.yml) | A workflow to copy into `.github/workflows/`. It calls the action on every run directory when a pull request touches `runs/`. The comment in it shows the form for another repository, pinned to a tag. |
| [`run.sh`](run.sh) | Runs the action's own script, `.github/actions/verify-run/verify.sh`, by hand: on `runs/exp1`, then on two tampered copies, then the TypeScript check from [example 07](../07-verify-offline/README.md). |

## Run it

```sh
uv sync                              # once, in the repository root
examples/08-ci-verify-run/run.sh     # about 9 seconds
```

Needs uv, `jq` and Node 22.18 or later. Step 4 downloads the `forkbill` package from the npm
registry.

## What the output shows

The real output is in [`output/run.txt`](output/run.txt).

Step 1 is the run as committed. The ledger has 467 records, 146 of them `task_done`, its chain
recomputes, and all 146 recorded arms match what Flagsmith's flag-engine gives for the same
identities under the start-of-run document:

```text
runs/exp1: records=467 task_done=146 merkle_root=7ed364648c7513ef22280eaed97a2ab77e92d91b8f88f5bbfab08d747a989929
runs/exp1: 146 of 146 recorded arms match the Flagsmith engine
exit code: 0
```

Step 2 copies the run and swaps the recorded arm of one task in `tasks.jsonl`, which is what
moving a bad result to the other arm would look like. The step fails:

```text
::error::examples/08-ci-verify-run/work/arm-changed: only 145 of 146 recorded arms match the Flagsmith engine
exit code: 1
```

Step 3 copies the run and changes one dollar figure inside a ledger record. The assignments
still match, but that record's hash no longer does:

```text
::error::examples/08-ci-verify-run/work/ledger-changed: line 4: hash mismatch (seq 3)
exit code: 1
```

The `::error::` prefix is GitHub's annotation syntax; in a workflow run those lines show up as
errors on the job.

Step 4 runs [`../07-verify-offline/verify.ts`](../07-verify-offline/verify.ts) on the same run.
It uses `explainAssignment` from the published `forkbill` package, so a repository with no
Python can run the assignment check with `npm ci && node verify.ts <run directory>`. It
re-derives the same 146 of 146.

## What was and was not run

`run.sh` was run and its output committed unchanged. `verify-run.yml` has not been executed on
GitHub from this folder. Its one substantive step is the action, whose `verify.sh` is exactly
what `run.sh` called, and the repository's own workflow already runs that action on `runs/*/`
(the "ledgers and assignments of committed runs" step in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

Nothing here is simulated. `runs/exp1` is the study's data. The two tampered copies are made in
`work/` (gitignored) and replaced on the next run.
