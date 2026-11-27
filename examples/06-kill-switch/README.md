# 06: the kill switch

`routing_kill` is a boolean flag. While it is on, every task runs the control policy, no
exposure is recorded and no events are sent, so tasks keep running but stay out of the
experiment's data. This example flips it in Flagsmith while a worker is running.

## Run it

```sh
selfhost/bootstrap.sh              # once, see ../README.md
examples/06-kill-switch/run.sh     # about 24 seconds
```

[`worker.py`](worker.py) takes 18 simulated tasks, one a second, through `RoutedLanes`. It has
no kill-switch code of its own. [`run.sh`](run.sh) starts it, waits six seconds, runs
`flagsmith flag enable routing_kill --yes`, waits six more, runs
`flagsmith flag disable routing_kill --yes`, and then checks what Flagsmith stored.

## What the output shows

From [`output/run.txt`](output/run.txt), around the two flips:

```text
15:07:50  ex06:task-05  source=experiment   policy=lanes_v1  variant=lanes_v1  exposed=True   events sent=3
15:07:51  ex06:task-06  source=kill_switch  policy=control   variant=None      exposed=False  events sent=0
15:07:51  >>> flagsmith flag enable routing_kill: {"feature":"routing_kill","enabled":true}
15:07:52  ex06:task-07  source=kill_switch  policy=control   variant=None      exposed=False  events sent=0
...
15:07:58  ex06:task-12  source=kill_switch  policy=control   variant=None      exposed=False  events sent=0
15:07:58  >>> flagsmith flag disable routing_kill: {"feature":"routing_kill","enabled":false}
15:07:59  ex06:task-13  source=experiment   policy=control   variant=control   exposed=True   events sent=3
```

The `>>>` lines are printed by `run.sh` after the CLI call returns and after it has read the
flag back, which is why one can appear a line below the first task it affected.

The worker reads the flag from the API for every task (remote evaluation), so the first task
after each flip sees it. Tasks 06 to 12 ran the control policy whatever arm their identity
hashes to, with no variant, no exposure and no events. Task 13 is back in the experiment.

```text
experiment: 11 tasks, policies control, lanes_v1, exposures 11, events 38
kill_switch: 7 tasks, policies control, exposures 0, events 0
7 tasks ran under the kill switch: all on the control policy, none exposed, no events
events sent: 49; rows in Flagsmith's events table for ex06:*: 49 ($flag_exposure 11, task_cost 11, task_seconds 11, task_solved 5, task_turns 11)
```

Flagsmith stored 49 rows for the 18 identities: 11 exposures and 38 events, all from the 11
tasks outside the kill window. `run.sh` stops with an error if a kill-switch task was exposed,
sent an event or ran anything but control.

With local evaluation (`make_client("local", ...)`) the switch takes effect at the next refresh
of the environment document, 60 seconds by default, and not on the next task.

## What is simulated

The tasks ([`../simulated_agent.py`](../simulated_agent.py)): no model is called. The flag, the
flips and the stored rows are real.
