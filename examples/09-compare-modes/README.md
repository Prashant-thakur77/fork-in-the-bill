# 09: the same arm in every evaluation mode

The kit can read flags four ways: from Flagsmith's API (`remote`), from the environment document
evaluated in process (`local`), from an Edge Proxy (`edge`), or from the Edge Proxy's copy of
the document evaluated in process (`edge-local`). An experiment only means something if an
identity gets the same arm whichever way a worker reads it. This example checks that on 200
identities.

## Run it

```sh
selfhost/bootstrap.sh                                              # once, see ../README.md
examples/09-compare-modes/run.sh                                   # remote and local, about 9 seconds
examples/09-compare-modes/run.sh remote local edge edge-local      # also starts the Edge Proxy, about 38 seconds
```

## What the output shows

`forkbill compare` reads `agent_routing` for `ex09-compare:0000` to `0199` in each mode with
`get_identity_flags`, which records no exposure, and exits 1 unless every mode agrees with the
first. From [`output/run.txt`](output/run.txt): both modes served `control` to 93 identities
and `lanes_v1` to 107, `"same_policy_as_baseline": 200` and `"same_variant_as_baseline": 200`,
`"all_agree": true`. The comparison stored nothing:

```text
events sent: 0; rows in Flagsmith's events table for ex09-compare:*: 0 ()
```

Then 20 simulated tasks run with `--mode local`. Flags are evaluated in the worker's process,
and the exposures and events still reach Flagsmith:

```text
events sent: 90; rows in Flagsmith's events table for ex09-local:*: 90 ($flag_exposure 20, task_cost 20, task_seconds 20, task_solved 10, task_turns 20)
== identities Flagsmith's API has seen, by prefix (Admin API identity search)
ex09-compare: 200
ex09-local: 0
```

The last two lines are the difference between the modes seen from Flagsmith's side. The remote
reads of the comparison created 200 identities. The 20 local tasks created none, because no
identity request was ever made for them, yet all 20 were exposed in the experiment.

With the proxy ([`output/run-with-edge-proxy.txt`](output/run-with-edge-proxy.txt)) all four
modes serve the same policy to all 200 identities. `edge` is the odd one out in what it reports:

```text
"edge": {
  "by_policy": { "control": 93, "lanes_v1": 107 },
  "by_variant": { "(no variant)": 200 },
  "in_experiment": 0,
```

(reflowed here; the file has one key per line). Edge Proxy 2.24.0 answers an identity request
with the right value but no variant key and no experiment metadata, so a worker in `edge` mode
runs the right policy and records no exposure. Use `edge-local` to run an experiment through a
proxy. [`selfhost/README.md`](../../selfhost/README.md) explains why from the proxy's source.

## What is simulated

The 20 tasks in the second step (`forkbill demo`, the kit's fake agent loop: no model calls).
The comparison itself involves no tasks at all: it only reads the flag.
