# 01: Python quickstart

[`quickstart.py`](quickstart.py) is the kit's loop in one file. For each of eight tasks it asks
Flagsmith which routing policy the task gets, runs the task with the models that policy names,
and reports how the task ended.

## Run it

```sh
selfhost/bootstrap.sh                   # once, see ../README.md
examples/01-python-quickstart/run.sh    # about 3 seconds
```

## The code

Three calls do the work:

- `make_client("remote", ...)` builds the Flagsmith SDK client with events on. The key and the
  two URLs come from `selfhost/.state/credentials.env`, which `run.sh` loads.
- `RoutedLanes(flagsmith=..., identity=..., pricing=...)` reads the kill switch, then calls
  `get_experiment_flag` for `agent_routing`. Flagsmith picks the arm and the SDK records the
  exposure. The policy is on `lanes.policy`; `lanes.main_model` and `lanes.delegate_model` are
  the two models to call.
- `lanes.finish(solved=..., turns=..., seconds=...)` sends `task_cost`, `task_solved` (only when
  solved), `task_turns` and `task_seconds` with the same identity, so Flagsmith can join them to
  the exposure.

In between, `lanes.record_call(lane, usage)` prices each model call. In a real agent the usage
comes from the model's response; here `simulated_task` makes it up.

## What the output shows

From [`output/run.txt`](output/run.txt):

```text
ex01:task-00  arm=control   delegate=claude-sonnet-5-5  $0.2671  solved=True   sent: task_cost, task_solved, task_turns, task_seconds
ex01:task-01  arm=lanes_v1  delegate=claude-haiku-5-5   $0.1312  solved=True   sent: task_cost, task_solved, task_turns, task_seconds
...
arms Flagsmith served: {'control': 2, 'lanes_v1': 6}  (simulated tasks, illustrative prices)
sent to Flagsmith: 8 exposures + 28 task events = 36
events sent: 36; rows in Flagsmith's events table for ex01:*: 36 ($flag_exposure 8, task_cost 8, task_seconds 8, task_solved 4, task_turns 8)
```

Flagsmith put two of the eight identities in `control` and six in `lanes_v1`. With eight
identities a 50/50 split rarely comes out even; example 09 shows 93 and 107 of 200. The last
line is `run.sh` counting what Flagsmith stored: one exposure per task and every event.

The arms depend on the instance, because the environment key and the experiment's ids go into
the hash. On your instance the same eight identities will land differently, and the same way
every time you rerun.

## What is simulated

The agent. `simulated_task` calls no model: turns, tokens and the outcome come from
`random.Random(identity)`, and the prices are round illustrative figures. The two arms differ
only in the delegate lane's model, so the cost gap is the price table's.
