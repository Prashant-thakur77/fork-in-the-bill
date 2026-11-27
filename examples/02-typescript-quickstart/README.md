# 02: TypeScript quickstart

The loop from example 01 in TypeScript, with the kit installed from the npm registry.
[`package.json`](package.json) pins `forkbill` to 0.1.0 and the lockfile records the registry
tarball, so this checks the published package and not the copy in `kit/ts`.

## Run it

```sh
selfhost/bootstrap.sh                       # once, see ../README.md
examples/02-typescript-quickstart/run.sh    # about 7 seconds
```

`run.sh` runs `npm ci`, type-checks [`quickstart.ts`](quickstart.ts) with `tsc --noEmit`, then
runs it with `node quickstart.ts`. Node 22.18 or later runs TypeScript files directly.

## The code

- `flagsmithConfig("remote", { environmentKey, apiUrl, eventsApiUrl })` returns the options for
  `new Flagsmith(...)` with events on.
- `await RoutedLanes.create({ flagsmith, identity, pricing })` reads the kill switch and then
  the policy with `getExperimentFlag`, which records the exposure.
- `lanes.recordCall(lane, usage)` prices a model call.
- `await lanes.finish(solved, turns, seconds)` sends the four events and flushes each one.

## What the output shows

From [`output/run.txt`](output/run.txt):

```text
forkbill 0.1.0 from https://registry.npmjs.org/forkbill/-/forkbill-0.1.0.tgz
@flagsmith/nodejs 9.5.0, node v22.23.5
== tsc --noEmit
no type errors
== node quickstart.ts
ex02:task-00  arm=control   delegate=claude-sonnet-5-5  $0.1185  solved=true   sent: task_cost, task_solved, task_turns, task_seconds
...
arms Flagsmith served: {"control":4,"lanes_v1":4}  (simulated tasks, illustrative prices)
sent to Flagsmith: 8 exposures + 31 task events = 39
events sent: 39; rows in Flagsmith's events table for ex02:*: 39 ($flag_exposure 8, task_cost 8, task_seconds 8, task_solved 7, task_turns 8)
```

The exposures and events land in the same experiment as the Python ones from example 01. Both
kits send the same event names with the task's identity, so agents in either language can
report into one experiment.

## What is simulated

The agent. `simulatedTask` calls no model. It derives turns, tokens and the outcome from md5
hashes of the identity (the kit exports `md5`), so a rerun gives the same numbers. Prices are
illustrative.
