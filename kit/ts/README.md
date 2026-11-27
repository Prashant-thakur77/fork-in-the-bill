# @forkbill/flagsmith-lanes

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

## Install and build

```bash
cd kit/ts
npm ci
npm run build   # tsc, strict
npm test        # node:test with a fake Flagsmith client
```

Requires Node 20+ and `@flagsmith/nodejs` ^9.5 (older `flagsmith-nodejs` cannot send events).

## Usage

```ts
import { Flagsmith } from "@flagsmith/nodejs";
import { RoutedLanes, TablePricing, usageFromAnthropic } from "@forkbill/flagsmith-lanes";

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
