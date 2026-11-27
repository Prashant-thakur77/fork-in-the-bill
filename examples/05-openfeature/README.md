# 05: OpenFeature

The same routing decision through the OpenFeature API, with Flagsmith's official provider
underneath. A codebase that already evaluates flags through OpenFeature can keep doing that and
still run the experiment.

## Run it

```sh
uv sync --extra openfeature           # the provider is an optional extra
selfhost/bootstrap.sh                 # once, see ../README.md
examples/05-openfeature/run.sh        # about 4 seconds
```

## The code

[`openfeature_example.py`](openfeature_example.py) has three parts.

Part 1 uses only the OpenFeature API. `client.get_string_details("agent_routing", "", ctx)` with
`EvaluationContext(targeting_key=identity)` returns the policy JSON, the variant and the reason;
`get_boolean_details("routing_kill", False, ctx)` reads the kill switch. Nothing in those lines
names Flagsmith, and they record no exposure.

Part 2 hands the same client to the kit:
`RoutedLanes(flagsmith=OpenFeatureFlagsmith.from_flagsmith(flagsmith), ...)`. The loop is the
one from example 01. The adapter ([`kit/forkbill/openfeature.py`](../../kit/forkbill/openfeature.py))
records the exposure with `track("feature_flag.exposure", ...)` and sends the task events with
`track()` too.

Part 3 reads the flag for the same identities with the Flagsmith SDK directly and compares.

## What the output shows

From [`output/run.txt`](output/run.txt):

```text
openfeature-sdk 0.9.0 | openfeature-provider-flagsmith 1.0.0 | flagsmith 6.7.0
== part 1: the plain OpenFeature API (no exposure, no events)
provider: FlagsmithProvider
ex05:task-00  variant=lanes_v1  delegate=claude-haiku-5-5   reason=SPLIT; weight=50.0
ex05:task-01  variant=control   delegate=claude-sonnet-5-5  reason=TARGETING_MATCH; segment=experiment-2-rollout
...
same variant from both paths: 8 of 8
arms Flagsmith served: {'control': 4, 'lanes_v1': 4}  (simulated tasks, illustrative prices)
sent to Flagsmith: 8 exposures + 28 task events = 36
events sent: 36; rows in Flagsmith's events table for ex05:*: 36 ($flag_exposure 8, task_cost 8, task_seconds 8, task_solved 4, task_turns 8)
```

The two reasons in part 1 are why the adapter tracks the exposure itself. The provider's own
exposure hook fires only for reason `SPLIT`, and a control identity resolves with
`TARGETING_MATCH`, so the hook alone would never expose the control arm. Here all eight tasks
were exposed, four in each arm, and Flagsmith stored eight `$flag_exposure` rows.

The adapter treats "resolved to a variant" as enrolled. That is right for an experiment at 100%
rollout, as this one is, and would over-count control for a partial rollout; the module's
docstring has the details.

## What is simulated

The agent, as in example 01: [`../simulated_agent.py`](../simulated_agent.py) calls no model and
uses illustrative prices.
