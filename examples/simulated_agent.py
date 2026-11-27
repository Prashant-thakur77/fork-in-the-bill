"""The SIMULATED agent the Python examples share. No model is called and nothing is spent.

A task's turn count, token counts and outcome come from a random generator seeded by the
identity, so a rerun gives the same numbers. The two arms differ only in the model the policy
names for the delegate lane, so the cost difference between them comes from the price table
below and nothing else. The prices are round illustrative figures, not a provider's list prices.
"""

import random

from forkbill import RoutedLanes, TablePricing, Usage

PRICING = TablePricing.from_dict(
    {"models": {"claude-sonnet-5-5": {"input": 3, "output": 15}, "claude-haiku-5-5": {"input": 1, "output": 5}}}
)


def simulated_task(lanes: RoutedLanes) -> tuple[bool, int, float]:
    """Record simulated model calls on `lanes`; return (solved, turns, seconds)."""
    rng = random.Random(lanes.identity)
    turns = rng.randint(4, 12)
    for _ in range(turns):
        lanes.record_call("main", Usage(input_tokens=rng.randint(2000, 6000), output_tokens=rng.randint(200, 800)))
        if rng.random() < 0.5:  # grunt work goes to the model the policy names for the delegate lane
            usage = Usage(input_tokens=rng.randint(8000, 20000), output_tokens=rng.randint(300, 1500))
            lanes.record_call("delegate", usage)
    return rng.random() < 0.6, turns, round(turns * rng.uniform(5, 10), 1)
