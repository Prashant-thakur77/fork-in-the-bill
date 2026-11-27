# 07: verify assignments offline

Flagsmith assigns an arm by hashing the identity with ids from the environment document. So a
saved copy of that document is enough to work out, with no network and no key, which arm every
task should have run, and to compare that with what a run recorded.

This example records 40 tasks, saves the document, re-derives all 40 arms two ways, and then
shows the check failing when the document comes from the wrong environment.

## Run it

```sh
selfhost/bootstrap.sh                # once, see ../README.md
examples/07-verify-offline/run.sh    # about 6 seconds
```

## What it does

The quoted lines are from [`output/run.txt`](output/run.txt).

1. `forkbill demo --n 40 --prefix ex07 --out work/run` sends 40 simulated identities through
   the experiment with remote evaluation, so Flagsmith's API picks each arm. `tasks.jsonl`
   records what was served: `control 19  lanes_v1 21`.
2. `flagsmith environment document > work/run/env/000-start.json` saves the document. What it
   says about the flag: `{"segment":"experiment-2-rollout","rule":[{"operator":"PERCENTAGE_SPLIT","value":"100.0"}],"split":{"lanes_v1":50}}`.
3. Two re-derivations from the document alone:
   - `python -m integrity.verify_assignment --run work/run` evaluates each identity with
     Flagsmith's own `flag-engine` 11.1.2, the code path the SDK's local evaluation uses, and
     runs an independent md5 recomputation next to it. Result: `"checked": 40, "matched": 40`,
     and the two recomputations agree on all 40.
   - [`verify.ts`](verify.ts) calls `explainAssignment` from the published `forkbill` package
     and prints the working for the first five identities:

     ```text
     ex07:0000  segment experiment-2-rollout: md5 a1a10406f47d.. -> 66.7834 <= 100  split: md5 7e394b01b311.. -> 40.4581 in lanes_v1 [0, 50)  recorded lanes_v1  ok
     ex07:0001  segment experiment-2-rollout: md5 0a6a7e1fc82f.. -> 46.1292 <= 100  split: md5 8ff1d7618518.. -> 57.0414 in control [50, 100)  recorded control  ok
     ...
     explainAssignment (forkbill, TypeScript): 40 of 40 recorded arms re-derived from work/run/env/000-start.json
     ```
4. The same two checks against a copy of the document whose `api_key` has been changed. The
   key is part of every hash input (`<key>_<identity>`), so the identities bucket differently:

   ```text
   "checked": 40,
   "matched": 20,
   ...
   python exit code: 1
   ...
   explainAssignment (forkbill, TypeScript): 20 of 40 recorded arms re-derived from work/wrong-key.json
   mismatched: 20
     ex07:0002: recorded control, re-derived lanes_v1
   ...
   node exit code: 1
   both checks caught the wrong key
   ```

   Python and TypeScript disagree with the record on the same 20 identities. Matching half by
   chance is what a 50/50 split gives, which is why the check counts every task and does not
   sample.

## Using it on your own run

A run directory needs `tasks.jsonl` (one JSON object per line with `identity`, `variant` and
`flag_source`) and `env/<name>.json`. Then either:

```sh
uv run python -m integrity.verify_assignment --run <run directory>
node examples/07-verify-offline/verify.ts <run directory>      # after npm ci in this folder
```

Both exit 1 on any mismatch. Example 08 runs the same check on the study's committed run as a
CI job.

The environment document holds the environment's client-side key, which the hash needs. This
example keeps the document in `work/` (gitignored) and prints only what the document says about
the flag.

## What is simulated

The 40 tasks (`forkbill demo`, the kit's fake agent loop: no model calls). The arms, the
document and both re-derivations are real.
