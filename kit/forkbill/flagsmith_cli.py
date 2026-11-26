"""Experiment setup through the Flagsmith CLI v2 (`flagsmith` binary).

Every call shells out to `flagsmith`, so credentials stay with the CLI (its login session, or
`FLAGSMITH_API_KEY[_<host>_<port>]` for a master key) and never pass through this process's
output. Failures raise `FlagsmithCliError` carrying Flagsmith's exact error text.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

# Admin API enum literals. Only "occurrence", "up" and "increase" are in the public docs; the rest
# were read from the API's own OPTIONS response (DRF choices) on self-hosted Flagsmith 2.295.2 on
# 2026-11-27, and every value is re-checked against the target instance by `check_literals`
# before anything is created. Keep this the only place these strings are spelled out.
API_LITERALS: dict[str, tuple[str, ...]] = {
    # experiment-metrics POST: aggregation
    "aggregation": ("occurrence", "count", "sum", "mean"),
    # experiment-metrics POST: direction ("down" = lower is better)
    "direction": ("up", "down", "informational"),
    # experiments POST: metrics[].expected_direction
    "expected_direction": ("increase", "decrease", "not_increase", "not_decrease"),
    # experiments POST: experiment_rollout.feature_state_value.type
    "feature_state_value_type": ("integer", "string", "boolean"),
}


class FlagsmithCliError(RuntimeError):
    def __init__(self, args: Sequence[str], returncode: int, stderr: str, stdout: str) -> None:
        self.cli_args = list(args)
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout
        detail = (stderr or stdout).strip()
        super().__init__(f"`flagsmith {' '.join(args[:3])} ...` failed ({returncode}):\n{detail}")


@dataclass
class FlagsmithCli:
    binary: str = "flagsmith"
    config_path: str | None = None
    api_url: str | None = None

    def __post_init__(self) -> None:
        if shutil.which(self.binary) is None:
            raise FileNotFoundError(
                f"{self.binary!r} not found; install it with "
                "`curl -fsSL https://get.flagsmith.com | sh` and run `flagsmith login`"
            )

    def _env(self) -> dict[str, str]:
        env = dict(os.environ)
        env["FLAGSMITH_NO_INPUT"] = "1"
        if self.config_path:
            env["FLAGSMITH_CONFIG_PATH"] = self.config_path
        if self.api_url:
            env["FLAGSMITH_API_URL"] = self.api_url
        return env

    def run(self, *args: str, stdin: str | None = None) -> str:
        proc = subprocess.run(
            [self.binary, *args],
            input=stdin,
            capture_output=True,
            text=True,
            env=self._env(),
            check=False,
        )
        if proc.returncode != 0:
            raise FlagsmithCliError(list(args), proc.returncode, proc.stderr, proc.stdout)
        return proc.stdout

    def json(self, *args: str, stdin: str | None = None) -> Any:
        out = self.run(*args, "--json", stdin=stdin)
        return json.loads(out) if out.strip() else None

    def api(self, path: str, method: str = "GET", body: object | None = None) -> Any:
        args = ["api", path.lstrip("/"), "-X", method]
        stdin = None
        if body is not None:
            args += ["--input", "-"]
            stdin = json.dumps(body)
        out = self.run(*args, stdin=stdin)
        return json.loads(out) if out.strip() else None

    # ------------------------------------------------------------------ context

    def environment_key(self) -> str:
        """The bound environment's client-side key (not a secret; never printed by the kit)."""
        if key := os.environ.get("FLAGSMITH_ENVIRONMENT"):
            return key
        cfg = self.json("config")
        key = (cfg or {}).get("environment", {}).get("value")
        if not key:
            raise FlagsmithCliError(["config"], 1, "no environment bound; run `flagsmith init` first", "")
        return str(key)

    # ------------------------------------------------------------------ literals

    def check_literals(self, env_key: str, used: Mapping[str, set[str]]) -> None:
        """Stop if any literal we are about to send is not offered by this instance."""
        metric_opts = self.api(f"api/v1/environments/{env_key}/experiment-metrics/", "OPTIONS")
        exp_opts = self.api(f"api/v1/environments/{env_key}/experiments/", "OPTIONS")
        post_m = (metric_opts or {}).get("actions", {}).get("POST", {})
        post_e = (exp_opts or {}).get("actions", {}).get("POST", {})
        offered: dict[str, set[str]] = {
            "aggregation": {c["value"] for c in post_m.get("aggregation", {}).get("choices", [])},
            "direction": {c["value"] for c in post_m.get("direction", {}).get("choices", [])},
            "expected_direction": {
                c["value"]
                for c in post_e.get("metrics", {})
                .get("child", {})
                .get("children", {})
                .get("expected_direction", {})
                .get("choices", [])
            },
        }
        for field, values in used.items():
            if field not in offered:
                continue
            if not offered[field]:
                raise FlagsmithCliError(["api", "OPTIONS"], 1, f"instance did not list choices for {field!r}", "")
            missing = values - offered[field]
            if missing:
                raise FlagsmithCliError(
                    ["api", "OPTIONS"],
                    1,
                    f"{field}: {sorted(missing)} not accepted here; offered {sorted(offered[field])}",
                    "",
                )

    # ------------------------------------------------------------------ features

    def get_feature(self, name: str) -> dict[str, Any] | None:
        try:
            data = self.json("feature", "get", name)
        except FlagsmithCliError as exc:
            if "not found" in (exc.stderr + exc.stdout).lower():
                return None
            raise
        return data if isinstance(data, dict) else None

    def ensure_feature(self, name: str, value: str | None, *, enabled: bool, description: str = "") -> int:
        existing = self.get_feature(name)
        if existing is not None:
            if value is not None and not _same_json(existing.get("default_value"), value):
                raise FlagsmithCliError(
                    ["feature", "get", name],
                    1,
                    f"feature {name!r} exists with a different value; refusing to overwrite it",
                    "",
                )
            return int(existing["id"])
        args = ["feature", "create", name]
        if value is not None:
            args += ["--value", value]
        if enabled:
            args.append("--enabled")
        if description:
            args += ["--description", description]
        self.run(*args)
        created = self.get_feature(name)
        if created is None:
            raise FlagsmithCliError(args, 1, f"feature {name!r} not found after create", "")
        return int(created["id"])

    def variant_ids(self, feature: str) -> dict[str, int]:
        """Every variant of `feature`, by key (or by id when a variant has no key)."""
        out: dict[str, int] = {}
        for v in self.json("feature", "variant", "list", feature) or []:
            out[str(v.get("key") or v["id"])] = int(v["id"])
        return out

    def ensure_variant(self, feature: str, key: str, value: str) -> int:
        def find() -> dict[str, Any] | None:
            for v in self.json("feature", "variant", "list", feature) or []:
                if v.get("key") == key:
                    return v
            return None

        existing = find()
        if existing is not None:
            if not _same_json(existing.get("value"), value):
                raise FlagsmithCliError(
                    ["feature", "variant", "list", feature],
                    1,
                    f"variant {key!r} of {feature!r} exists with a different value",
                    "",
                )
            return int(existing["id"])
        self.run("feature", "variant", "add", feature, "--value", value, "--key", key,
                 "--weight", "0")  # fmt: skip
        created = find()
        if created is None:
            raise FlagsmithCliError(["feature", "variant", "add"], 1, "variant missing", "")
        return int(created["id"])

    # ------------------------------------------------------------------ metrics/experiments

    def list_metrics(self, env_key: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        path: str | None = f"api/v1/environments/{env_key}/experiment-metrics/"
        while path:
            page = self.api(path)
            if isinstance(page, list):
                return out + page
            out += page.get("results", [])
            nxt = page.get("next")
            path = nxt.split("/api/v1/", 1)[1] if nxt else None
            path = f"api/v1/{path}" if path else None
        return out

    def ensure_metrics(self, env_key: str, metrics: Sequence[Mapping[str, Any]]) -> dict[str, int]:
        existing = {m["name"]: m for m in self.list_metrics(env_key)}
        ids: dict[str, int] = {}
        for spec in metrics:
            name = str(spec["name"])
            body = {
                "name": name,
                "description": str(spec.get("description", "")),
                "aggregation": spec["aggregation"],
                "direction": spec["direction"],
                "definition": {"version": 1, "event": spec["event"]},
            }
            if name in existing:
                have = existing[name]
                same = (
                    have.get("aggregation") == body["aggregation"]
                    and have.get("direction") == body["direction"]
                    and (have.get("definition") or {}).get("event") == spec["event"]
                )
                if not same:
                    raise FlagsmithCliError(
                        ["api", "experiment-metrics"],
                        1,
                        f"metric {name!r} exists with a different definition: "
                        f"{json.dumps({k: have.get(k) for k in ('aggregation', 'direction', 'definition')})}",
                        "",
                    )
                ids[name] = int(have["id"])
                continue
            created = self.api(f"api/v1/environments/{env_key}/experiment-metrics/", "POST", body)
            ids[name] = int(created["id"])
        return ids

    def create_experiment(self, env_key: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self.api(f"api/v1/environments/{env_key}/experiments/", "POST", dict(body))

    def start_experiment(self, env_key: str, experiment_id: int) -> dict[str, Any]:
        return self.api(f"api/v1/environments/{env_key}/experiments/{experiment_id}/start/", "POST")

    def warehouse_connections(self, env_key: str) -> list[dict[str, Any]]:
        data = self.api(f"api/v1/environments/{env_key}/warehouse-connections/")
        return data if isinstance(data, list) else data.get("results", [])


def _same_json(a: object, b: object) -> bool:
    def norm(x: object) -> object:
        if isinstance(x, str):
            try:
                return json.loads(x)
            except json.JSONDecodeError:
                return x
        return x

    return norm(a) == norm(b)


def literals_used(metrics: Sequence[Mapping[str, Any]]) -> dict[str, set[str]]:
    used: dict[str, set[str]] = {"aggregation": set(), "direction": set(), "expected_direction": set()}
    for m in metrics:
        for field in used:
            if field in m:
                used[field].add(str(m[field]))
    for field, values in used.items():
        bad = values - set(API_LITERALS[field])
        if bad:
            raise ValueError(f"{field}: {sorted(bad)} not in API_LITERALS[{field!r}]")
    return used


def extract_hypothesis(text: str) -> str:
    """The text between `<!-- hypothesis:start -->` and `<!-- hypothesis:end -->`, else all."""
    start, end = "<!-- hypothesis:start -->", "<!-- hypothesis:end -->"
    if start in text and end in text:
        text = text.split(start, 1)[1].split(end, 1)[0]
    text = text.strip()
    if not text:
        raise ValueError("hypothesis text is empty")
    return text
