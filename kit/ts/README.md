# forkbill

Routed lanes for a Node agent loop, driven by a Flagsmith experiment flag. It does the same job as
the Python kit (`forkbill.RoutedLanes`) and sends the same events with the same identifiers, so
both kinds of agent can report into one experiment.

- One task is one Flagsmith identity.
- The routing policy (main lane model, delegate lane model, caps) is the JSON value of the
  `agent_routing` flag. It is read once per task with `getExperimentFlag`, which records the
  exposure.
- `routing_kill` is read with `getIdentityFlags`, which records no exposure. When it is on, the
  task runs the control policy.
- If the flag value is not a valid policy, the task falls back to the control policy and logs the
  reason. By default the control policy is the flag's own environment value; you can pass one
  with `control`.
- `finish()` sends `task_cost`, `task_solved` (only when solved), `task_turns` and
  `task_seconds`, and flushes after each one.

## Install

```bash
npm install forkbill @flagsmith/nodejs
```

Requires Node 20+ and `@flagsmith/nodejs` ^9.5 (older `flagsmith-nodejs` cannot send events).

To work on the package, it sits in an npm workspace under `kit/` with the MCP server
([`forkbill-mcp`](../mcp/README.md)), which is built on it:

```bash
cd kit
npm ci
npm run build --workspace forkbill   # tsc, strict
npm test --workspace forkbill        # node:test with a fake Flagsmith client
```

## Usage

```ts
import { Flagsmith } from "@flagsmith/nodejs";
import { RoutedLanes, TablePricing, usageFromAnthropic } from "forkbill";

const flagsmith = new Flagsmith({
  environmentKey: process.env.FLAGSMITH_SERVER_KEY!,
  enableEvents: true,
  // self-hosted: apiUrl: "http://localhost:8000/api/v1/",
  //              eventProcessorConfig: { eventsApiUrl: "http://localhost:8000/api/" },
});

const pricing = new TablePricing({
  models: {
    "<frontier-model>": { input: 3, output: 15, cache_write_5m: 3.75, cache_read: 0.3 },
    "<small-model>": { input: 1, output: 5 },
  },
}); // US dollars per million tokens; use the provider's current prices

const lanes = await RoutedLanes.create({ flagsmith, identity: `swelive:${instanceId}`, pricing });

let turns = 0;
while (!done && !lanes.overBudget && turns < lanes.policy.caps.turns) {
  turns += 1;
  const reply = await callModel(lanes.mainModel, lanes.policy.main.max_tokens /* ... */);
  lanes.recordCall("main", usageFromAnthropic(reply.usage));
  if (needsGruntWork) {
    const sub = await callModel(lanes.delegateModel, lanes.policy.delegate.max_tokens /* ... */);
    lanes.recordCall("delegate", usageFromAnthropic(sub.usage));
  }
}
await lanes.finish(solved, turns); // seconds default to wall-clock time since create()
await flagsmith.close();
```

`lanes.flagSource` tells you how the policy was chosen: `experiment` (exposed), `flag` (no running
experiment), `kill_switch` or `fail_closed`. Events are only sent for exposed tasks unless you set
`emitUnexposed: true`.

Pass `onFailure: "throw"` to `RoutedLanes.create` if a task should not run at all when Flagsmith
cannot serve a valid policy. `create` then rejects with a `PolicyError` whose message holds the
reason and whose `cause` is the SDK's error, and no control policy is substituted. The kill switch
still serves the control policy.

A caller that keeps its own totals can skip `recordCall` and `finish` and send the same four
events with `sendTaskEvents(flagsmith, identity, { usd, solved, turns, seconds })`.

## Checking an assignment offline

Flagsmith assigns a variant by hashing the identity, so a saved environment document fixes the
arm every identity gets. `explainAssignment(document, identity, flag)` re-derives it with no
network call and returns each step: the md5 of every segment check, the feature state chosen,
the md5 of the split and the range it falls in.

```ts
import { readFileSync } from "node:fs";
import { explainAssignment } from "forkbill";

const doc = JSON.parse(readFileSync("env.json", "utf8")); // flagsmith environment document > env.json
const w = explainAssignment(doc, "swelive:some-task");
console.log(w.variant, w.split?.hash.percentage, w.split?.ranges);
```

It is the same recomputation as `independent_variant` in `integrity/verify_assignment.py`, and the
tests hold it to that: `test/fixtures/make_fixtures.py` writes the expected values from the
Python code and from Flagsmith's engine, and one test re-derives every arm recorded in
`runs/exp1`. It covers percentage-split segments, which is what an experiment rollout uses, and
throws `UnsupportedDocumentError` for other segment rules or an identity override. The
environment key is never copied into the result. `md5`, `hashedPercentage` and `hashWorking` are
exported too; the site's "move the split" lab uses the same functions.

## Local evaluation and the Edge Proxy

`flagsmithConfig(mode, opts)` returns `Flagsmith` constructor options for `remote`, `local`
(environment document, needs a `ser.` key), `edge` (flags from an Edge Proxy) or `edge-local`
(the Edge Proxy's copy of the environment document). Events always go to `eventsApiUrl`, the
core API.

```ts
const flagsmith = new Flagsmith(
  flagsmithConfig("local", {
    environmentKey: process.env.FLAGSMITH_SERVER_KEY!,
    apiUrl: "http://localhost:8000/api/v1/",
    eventsApiUrl: "http://localhost:8000/api/",
  }),
);
```

In `@flagsmith/nodejs` 9.5 locally evaluated identity flags keep their `experiment`, so
`getExperimentFlag` records exposures in `local` and `edge-local`. Edge Proxy 2.24.0 returns no
`variant` or `metadata` from `POST /identities/`, so `edge` serves the right value but records
no exposure. The 9.5 client has no analytics URL option: keep `enableAnalytics` off in the edge
modes, since analytics would go to the proxy. See `selfhost/README.md` for a run of all four modes.

## Event buffer

In `@flagsmith/nodejs` 9.5, `eventProcessorConfig.maxBuffer` is the buffer's capacity. When it is
full and a batch is already in flight, the SDK drops the oldest event. The adapter awaits
`flushEvents()` after the exposure and after each event, so nothing is lost even with
`maxBuffer: 1`. This was checked against a self-hosted Flagsmith: 4 identities sent 4 exposures
and 14 task events, and all 18 arrived (see `selfhost/README.md`).
