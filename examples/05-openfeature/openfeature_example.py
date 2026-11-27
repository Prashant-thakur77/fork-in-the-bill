"""The routing decision through OpenFeature, with Flagsmith as the provider.

Part 1 is code that only knows the OpenFeature API: it asks for a string flag and a boolean flag
by name, and would run unchanged on another provider. Part 2 puts the same OpenFeature client
under the kit's `RoutedLanes`, so the loop from example 01 runs without the Flagsmith SDK in it.
The tasks are simulated (`examples/simulated_agent.py`): no model is called.
"""

import json
import os
import sys
from collections import Counter

from openfeature import api
from openfeature.evaluation_context import EvaluationContext
from simulated_agent import PRICING, simulated_task

from forkbill import RoutedLanes
from forkbill.client import make_client
from forkbill.openfeature import DOMAIN, OpenFeatureFlagsmith

IDENTITIES = [f"ex05:task-{i:02d}" for i in range(8)]
EXPERIMENT_ID = int(sys.argv[1]) if len(sys.argv) > 1 else None

# The only Flagsmith-specific lines: build the SDK client and register it as the provider.
flagsmith = make_client(
    "remote",
    environment_key=os.environ["FLAGSMITH_SERVER_KEY"],
    api_url=os.environ["FLAGSMITH_SDK_API_URL"],
    events_api_url=os.environ["FLAGSMITH_EVENTS_API_URL"],
)
adapter = OpenFeatureFlagsmith.from_flagsmith(flagsmith, experiment_id=EXPERIMENT_ID)

print("== part 1: the plain OpenFeature API (no exposure, no events)")
client = api.get_client(DOMAIN)
print(f"provider: {client.provider.get_metadata().name}")
for identity in IDENTITIES[:3]:
    details = client.get_string_details("agent_routing", "", EvaluationContext(targeting_key=identity))
    delegate = json.loads(details.value)["delegate"]["model"]
    print(f"{identity}  variant={details.variant!s:<8}  delegate={delegate:<17}  reason={details.reason}")
kill = client.get_boolean_details("routing_kill", False, EvaluationContext(targeting_key=IDENTITIES[0]))
print(f"routing_kill: value={kill.value}")

print("== part 2: the kit's loop over the same OpenFeature client (exposure and events sent with track())")
arms, exposures, events = Counter[str](), 0, 0
for identity in IDENTITIES:
    lanes = RoutedLanes(flagsmith=adapter, identity=identity, pricing=PRICING)
    solved, turns, seconds = simulated_task(lanes)
    result = lanes.finish(solved=solved, turns=turns, seconds=seconds)
    arm = str(result.variant)
    arms[arm] += 1
    exposures += result.exposed
    events += len(result.events)
    print(
        f"{result.identity}  arm={arm:<8}  delegate={lanes.delegate_model:<17}  ${result.usd:.4f}  "
        f"solved={result.solved!s:<5}  exposed={result.exposed}  source={result.flag_source}"
    )

print("== check: the Flagsmith SDK on its own serves the same arms (get_identity_flags, no exposure)")
agree = 0
for identity in IDENTITIES:
    native = flagsmith.get_identity_flags(identity).get_flag("agent_routing").variant
    through_openfeature = adapter.get_identity_flags(identity).get_flag("agent_routing").variant
    agree += native == through_openfeature
    if native != through_openfeature:
        print(f"{identity}: SDK {native}, OpenFeature {through_openfeature}")
print(f"same variant from both paths: {agree} of {len(IDENTITIES)}")

adapter.close(10.0)
print(f"arms Flagsmith served: {dict(sorted(arms.items()))}  (simulated tasks, illustrative prices)")
print(f"sent to Flagsmith: {exposures} exposures + {events} task events = {exposures + events}")
if agree != len(IDENTITIES):
    sys.exit(1)
