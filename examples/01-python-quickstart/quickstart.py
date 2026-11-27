"""Ask Flagsmith which routing policy each task gets, run the task, report how it ended."""

import os
import random
from collections import Counter

from forkbill import RoutedLanes, TablePricing, Usage
from forkbill.client import make_client

# Illustrative prices in US dollars per million tokens, not a provider's list prices.
PRICING = TablePricing.from_dict(
    {"models": {"claude-sonnet-5-5": {"input": 3, "output": 15}, "claude-haiku-5-5": {"input": 1, "output": 5}}}
)


def simulated_task(lanes: RoutedLanes) -> tuple[bool, int, float]:
    """SIMULATED agent: no model is called. Tokens and the outcome come from a generator seeded by the identity."""
    rng = random.Random(lanes.identity)
    turns = rng.randint(4, 12)
    for _ in range(turns):
        lanes.record_call("main", Usage(input_tokens=rng.randint(2000, 6000), output_tokens=rng.randint(200, 800)))
        if rng.random() < 0.5:  # grunt work goes to the model the policy names for the delegate lane
            usage = Usage(input_tokens=rng.randint(8000, 20000), output_tokens=rng.randint(300, 1500))
            lanes.record_call("delegate", usage)
    return rng.random() < 0.6, turns, round(turns * rng.uniform(5, 10), 1)


flagsmith = make_client(
    "remote",
    environment_key=os.environ["FLAGSMITH_SERVER_KEY"],
    api_url=os.environ["FLAGSMITH_SDK_API_URL"],
    events_api_url=os.environ["FLAGSMITH_EVENTS_API_URL"],
)
arms, exposures, events = Counter[str](), 0, 0
for i in range(8):
    # Reads the kill switch, then the policy; Flagsmith picks the arm and the exposure is recorded.
    lanes = RoutedLanes(flagsmith=flagsmith, identity=f"ex01:task-{i:02d}", pricing=PRICING)
    solved, turns, seconds = simulated_task(lanes)
    # Sends task_cost, task_solved (only when solved), task_turns and task_seconds for the same identity.
    result = lanes.finish(solved=solved, turns=turns, seconds=seconds)
    arm = str(result.variant)
    arms[arm] += 1
    exposures += result.exposed
    events += len(result.events)
    sent = ", ".join(name for name, _ in result.events)
    print(
        f"{result.identity}  arm={arm:<8}  delegate={lanes.delegate_model:<17}  "
        f"${result.usd:.4f}  solved={result.solved!s:<5}  sent: {sent}"
    )
flagsmith.close()
print(f"arms Flagsmith served: {dict(sorted(arms.items()))}  (simulated tasks, illustrative prices)")
print(f"sent to Flagsmith: {exposures} exposures + {events} task events = {exposures + events}")
