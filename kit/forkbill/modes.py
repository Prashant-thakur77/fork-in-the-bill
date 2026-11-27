"""Compare what several evaluation modes serve to the same identities.

Each mode's client reads the routing flag for every identity with `get_identity_flags`, which
records no exposure and sends no event, so the comparison does not touch the experiment's data.
Two modes agree on an identity when they serve the same policy (the `policy` name inside the flag
value) and, where both report one, the same variant key. Bucketing is a deterministic hash of
the identity and the segment or feature, so every mode should agree on every identity.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from forkbill.lanes import FlagsmithLike, parse_policy


@dataclass(frozen=True)
class Served:
    identity: str
    policy: str | None
    variant: str | None
    in_experiment: bool | None
    error: str | None = None


def read_served(client: FlagsmithLike, identity: str, flag: str) -> Served:
    try:
        served = client.get_identity_flags(identity).get_flag(flag)
    except Exception as exc:  # the SDK raises its own error types on API failures
        return Served(identity, None, None, None, error=f"{type(exc).__name__}: {exc}")
    if served is None or getattr(served, "is_default", False) is True:
        return Served(identity, None, None, None, error="flag not found")
    try:
        policy: str | None = parse_policy(getattr(served, "value", None)).policy
    except (ValueError, json.JSONDecodeError) as exc:
        policy, error = None, f"invalid policy: {exc}"
    else:
        error = None
    experiment = getattr(served, "experiment", None)
    variant = getattr(served, "variant", None)
    return Served(
        identity,
        policy,
        str(variant) if variant is not None else None,
        None if experiment is None else bool(getattr(experiment, "in_experiment", False)),
        error,
    )


def compare_modes(
    clients: Mapping[str, FlagsmithLike], identities: Sequence[str], flag: str = "agent_routing"
) -> dict[str, Any]:
    """Read `flag` for each identity in each mode and report agreement with the first mode."""
    if not clients:
        raise ValueError("compare_modes needs at least one client")
    served = {mode: [read_served(c, i, flag) for i in identities] for mode, c in clients.items()}
    base_mode = next(iter(clients))
    base = served[base_mode]
    report: dict[str, Any] = {"identities": len(identities), "baseline": base_mode, "modes": {}}
    for mode, rows in served.items():
        same_policy = sum(1 for a, b in zip(base, rows, strict=True) if a.policy is not None and a.policy == b.policy)
        both = [(a, b) for a, b in zip(base, rows, strict=True) if a.variant is not None and b.variant is not None]
        report["modes"][mode] = {
            "by_policy": dict(sorted(Counter(r.policy or "(none)" for r in rows).items())),
            "by_variant": dict(sorted(Counter(r.variant or "(no variant)" for r in rows).items())),
            "in_experiment": sum(1 for r in rows if r.in_experiment),
            "errors": sum(1 for r in rows if r.error),
            "same_policy_as_baseline": same_policy,
            "variant_compared": len(both),
            "same_variant_as_baseline": sum(1 for a, b in both if a.variant == b.variant),
        }
    report["all_agree"] = all(
        m["same_policy_as_baseline"] == len(identities)
        and m["same_variant_as_baseline"] == m["variant_compared"]
        and m["errors"] == 0
        for m in report["modes"].values()
    )
    report["first_disagreements"] = [
        {"identity": a.identity, base_mode: a.policy, mode: b.policy}
        for mode, rows in served.items()
        for a, b in zip(base, rows, strict=True)
        if a.policy != b.policy
    ][:5]
    return report
