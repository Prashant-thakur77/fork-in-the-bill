# verify-run

A composite action that checks a run directory the way this repository's CI checks its own. It needs no Flagsmith key and no model key, because both checks work from files.

For each directory it runs two modules:

- `integrity.verify_ledger` recomputes every hash in `ledger.jsonl` (`sha256(prev_hash + canonical_json(payload))`), checks the sequence numbers, and prints the Merkle root over the `task_done` records. The rule is written out in [`docs/interfaces.md`](../../../docs/interfaces.md#ledger).
- `integrity.verify_assignment` takes the first environment snapshot in `env/`, evaluates every identity in `tasks.jsonl` with Flagsmith's flag engine, and compares the arm it gets with the arm the run recorded.

The job summary gets one table row per directory with the record counts, the Merkle root and the number of matching arms. The step fails if any chain is broken or any arm differs, after it has gone through every directory.

## Use it in this repository

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
- uses: ./.github/actions/verify-run
  with:
    run-dir: runs/*/
```

## Use it on a run directory in another repository

```yaml
jobs:
  verify:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - id: verify
        uses: Prashant-thakur77/fork-in-the-bill/.github/actions/verify-run@<tag>
        with:
          run-dir: runs/my-experiment
      - run: echo "Merkle root ${{ steps.verify.outputs.merkle-root }}"
```

Replace `<tag>` with a release tag that contains this directory, or better with the full commit SHA of that tag. The verifier code and its lockfile are taken from the ref you pin, so a later change here cannot alter what your workflow runs.

## Inputs and outputs

| Input | Default | Meaning |
|---|---|---|
| `run-dir` | required | One run directory, or several separated by spaces or newlines. Shell globs such as `runs/*/` are expanded. Paths containing spaces are not supported. |
| `assignment` | `auto` | `auto` re-derives assignments for a directory that has an `env/` folder, `true` requires the check for every directory, `false` skips it. |
| `uv-version` | `0.10.9` | The uv release to install when the job has no `uv` on `PATH`. A job that already set up uv keeps its own. |

The output `merkle-root` is the Merkle root of the run directory. With several directories it is the root of the last one that verified, so use one directory per step when you need the value.

## What the run directory has to look like

`ledger.jsonl` holds one `LedgerRecord` per line: `seq`, `ts`, `kind`, `payload`, `prev_hash`, `hash`, with `kind` one of `task_done`, `event_sent`, `env_snapshot`, `exclusion`, `config`, `kill_switch`. The first record has `prev_hash` set to 64 zeros. `integrity/ledger.py` writes this format.

The assignment check also needs `tasks.jsonl` (each line with `identity`, `variant`, `flag_source` and the `traits` that were sent) and at least one environment document in `env/*.json`, saved with `flagsmith environment document --json`. It evaluates the flag named `agent_routing`, the one this project uses; a run on a flag with another name can still use the ledger check with `assignment: false`.

## Limits

The action downloads this whole repository at the pinned ref, including the committed run logs (about 220 MB once unpacked), and installs the project's locked Python dependencies. Expect a minute or two on a cold runner. It needs `jq`, which GitHub-hosted runners have.

A passing check says the ledger is internally consistent and that the recorded arms are the ones Flagsmith's hashing gives for the saved environment document. It cannot say the ledger is the one written during the run, unless you compare the Merkle root with one published at the time.

## Run it by hand

```sh
uv sync --locked
RUN_DIRS="runs/exp1 runs/rollout" bash .github/actions/verify-run/verify.sh
```
