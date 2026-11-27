// The Python quickstart, written against the kit's public API (kit/forkbill/__init__.py).
// test/site.test.ts checks that every name it imports is exported by the kit.
export const PY_QUICKSTART = `import os
from flagsmith import Flagsmith
from forkbill import Lane, RoutedLanes, TablePricing, Usage

flagsmith = Flagsmith(environment_key=os.environ["FLAGSMITH_SERVER_KEY"], enable_events=True)
pricing = TablePricing.from_json("pricing.json")  # USD per million tokens, your provider's prices

# One task = one Flagsmith identity. Reads the policy once and records the exposure.
lanes = RoutedLanes(flagsmith=flagsmith, identity=f"swelive:{instance_id}", pricing=pricing)

turns = 0
while not done and not lanes.over_budget and turns < lanes.policy.caps.turns:
    turns += 1
    reply = call_model(lanes.main_model, max_tokens=lanes.policy.main.max_tokens)
    lanes.record_call(Lane.main, Usage.from_anthropic(reply.usage))
    if needs_grunt_work:
        sub = call_model(lanes.delegate_model, max_tokens=lanes.policy.delegate.max_tokens)
        lanes.record_call(Lane.delegate, Usage.from_anthropic(sub.usage))

# Sends task_cost, task_turns, task_seconds and, on a solve, task_solved.
lanes.finish(solved=solved, turns=turns)
flagsmith.close()`;
