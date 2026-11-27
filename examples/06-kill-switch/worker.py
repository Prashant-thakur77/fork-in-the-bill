"""A worker that takes one task a second through the kit and prints what each one ran.

It knows nothing about the kill switch beyond what `RoutedLanes` does for every task: read
`routing_kill` first and, when it is on, run the control policy with no exposure and no events.
The tasks are simulated (`examples/simulated_agent.py`): no model is called.

Usage: python worker.py <number of tasks> <summary.json>
"""

import json
import logging
import os
import sys
import time
from datetime import UTC, datetime

from simulated_agent import PRICING, simulated_task

from forkbill import RoutedLanes
from forkbill.client import make_client

logging.getLogger("forkbill").setLevel(logging.ERROR)  # the table below already shows each kill-switch task
TASKS = int(sys.argv[1])
flagsmith = make_client(
    "remote",
    environment_key=os.environ["FLAGSMITH_SERVER_KEY"],
    api_url=os.environ["FLAGSMITH_SDK_API_URL"],
    events_api_url=os.environ["FLAGSMITH_EVENTS_API_URL"],
)
rows = []
for i in range(TASKS):
    lanes = RoutedLanes(flagsmith=flagsmith, identity=f"ex06:task-{i:02d}", pricing=PRICING)
    solved, turns, seconds = simulated_task(lanes)
    result = lanes.finish(solved=solved, turns=turns, seconds=seconds)
    rows.append(
        {
            "identity": result.identity,
            "source": result.flag_source,
            "policy": result.policy.policy,
            "variant": result.variant,
            "exposed": result.exposed,
            "events": len(result.events),
        }
    )
    print(
        f"{datetime.now(UTC):%H:%M:%S}  {result.identity}  source={result.flag_source:<11}  "
        f"policy={result.policy.policy:<8}  variant={result.variant!s:<8}  exposed={result.exposed!s:<5}  "
        f"events sent={len(result.events)}",
        flush=True,
    )
    time.sleep(1)
flagsmith.close()
with open(sys.argv[2], "w") as fh:
    json.dump(rows, fh)
