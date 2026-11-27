# infra/flagsmith

The Flagsmith configuration that experiment 822 (flag `agent_routing`) runs on, written as Terraform. It is used for one thing: `terraform plan` against the live project, to show that the flags matched the committed code for the whole run. It is never applied. The CLI scripts in `flagsmith/` created everything here and remain the only way it is changed (see D23 in `DECISIONS.md`).

```
make flags-drift                                 # or: infra/flagsmith/drift.sh
make flags-drift LEDGER=runs/exp1/ledger.jsonl   # also append the result to the run ledger
```

`drift.sh` prints one line, for example:

```
{"drift":false,"resources":6,"plan_sha256":"e2c7...","live_versions":true}
```

Exit 0 means no drift, 2 means drift, anything else means the check itself failed. With `--ledger`, the same object is appended as a `config` record with `"event": "flags_drift"`.

## What it does

1. Reads `FLAGSMITH_API_KEY` (the master key) from `.env` and hands it to the provider as `FLAGSMITH_MASTER_API_KEY`. In a git worktree it uses the main checkout's `.env`. Server-side SDK keys are removed from Terraform's environment. No key is printed.
2. Uses `terraform.tfvars` if it exists. Otherwise it takes the client-side environment key from `flagsmith.json` and the project uuid from a GET of `api/v1/projects/<id>/`.
3. `terraform init`, then on an empty state `terraform import` for each block in `imports.tf`. This writes local state only.
4. `terraform plan -detailed-exitcode -refresh=true -lock=false`.
5. Checks that the feature states in state are exactly the live ones for each tracked feature. The environment uses v2 feature versioning: each published change creates new feature-state uuids and the old ones remain readable, so a plan on its own would keep reading a superseded version and report no change. This step also catches a new segment override added on a tracked feature.
6. `plan_sha256` is the SHA-256 of the sorted list of `{address, actions, before, after, importing}` from `terraform show -json`. Two runs against an unchanged project give the same hash.

State is local (`terraform.tfstate`, gitignored) and is not shared. A fresh checkout rebuilds it with the imports.

## What is described

| Resource | Live object | Import id |
|---|---|---|
| `flagsmith_feature.agent_routing` | feature 306193, MULTIVARIATE, initial value `flagsmith/policies/control.json` | `69f8b5ca-3e61-4d80-aabf-2a5bd35bdf0c` |
| `flagsmith_feature.routing_kill` | feature 306194, STANDARD, off by default | `37b48a8e-69bf-4249-971d-b3d3f4a5f020` |
| `flagsmith_mv_feature_option.lanes_v1` | option 37431, value `flagsmith/policies/lanes_v1.json`, default weight 0 | `<feature uuid>,e83f10f5-e34c-4e7e-a20b-cd9a3bf32db1` |
| `flagsmith_feature_state.agent_routing` | Production default: enabled, control policy | `<env key>,426a4583-0ae1-4fce-90a6-f05d7775b360` |
| `flagsmith_feature_state.routing_kill` | Production default: disabled, no value | `<env key>,78107960-2ee5-40ce-84eb-a654a9d4f9ac` |
| `flagsmith_feature_state.agent_routing_experiment_822` | segment override on segment 1206056 (`experiment-822-rollout`), priority 0, enabled, control policy | `<env key>,7f4557f9-fc59-4e49-bf9c-1db1e83b512f` |

The policy values are read from the same files `setup.sh` uses, byte for byte (`trimspace(file(...))`), so a change to a policy file shows up as drift. No `ignore_changes` is needed: the plan is clean against the live project.

## What is not described, and who owns it

These parts are set by `flagsmith/setup.sh`, `create_experiment.sh` and `start_experiment.sh`, and Terraform does not check them:

- **Variant key.** The provider's `flagsmith_mv_feature_option` has no `key` attribute, so the key `lanes_v1` is not compared.
- **Per-segment variant weights.** `flagsmith_feature_state` cannot express multivariate weights, so the 50% lanes_v1 weight on the experiment's segment override (and the 0% on the environment default) is not compared.
- **The experiment segment.** Flagsmith creates `experiment-822-rollout` as a system segment managed by the experiment. The Admin API does not list it or return it by id, and its uuid is not exposed, so it cannot be imported as `flagsmith_segment`. The override that uses it is covered by its numeric id.
- **The experiment itself** (name, hypothesis, metrics 737-740, status, audience). The provider has no experiment resource. `integrity/snapshot_env.py` records the environment document during the run.
- **The `fib_smoke` feature**, a throwaway flag from `flagsmith/smoke_test.sh` that the experiment does not use.

When the experiment ends, or after any sanctioned change through the scripts, the feature-state uuids change. Update the ids in `imports.tf`, delete the local state and run `drift.sh` again.
