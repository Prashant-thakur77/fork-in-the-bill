"""Recompute each task's `agent_routing` variant offline from a saved environment document.

Flagsmith assigns a variant by hashing the identity, so the arm every task should have run is
fixed by the environment document alone. This check evaluates each identity in `tasks.jsonl`
(with the traits the runner sent) against an `env/*.json` snapshot using Flagsmith's own engine,
the same code path the SDK's local evaluation takes, and compares the result with the variant
the run recorded. A small independent recomputation of the segment and variant hashing runs
alongside it; if the two ever disagree, the engine's answer is the one compared and the report
lists the disagreement.

Usage: python -m integrity.verify_assignment --run runs/exp1 [--env FILE] [--out FILE]
Exits 1 if any recorded variant differs from the recomputed one, 0 otherwise.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from importlib.metadata import version
from pathlib import Path
from typing import Annotated, Any, cast

import typer
from flag_engine import engine
from flagsmith.api.types import EnvironmentModel
from flagsmith.local_evaluation import LocalEvaluation

from harness.schema import FLAG_ROUTING
from integrity.canonical import canonical_json

DEFAULT_VARIANT = "control"  # the engine's name for the remainder bucket of a multivariate flag
DEFAULT_PRIORITY = float("inf")


class Unsupported(Exception):
    """The independent recomputation does not cover this part of the document."""


# Independent recomputation ---------------------------------------------------------------


def hashed_percentage(object_ids: list[str], iterations: int = 1) -> float:
    """A value in [0, 100) from md5 over comma-joined ids, as Flagsmith buckets identities."""
    digest = hashlib.md5(",".join(object_ids * iterations).encode("utf-8")).hexdigest()
    value = (int(digest, 16) % 9999) / 9998 * 100
    return hashed_percentage(object_ids, iterations + 1) if value == 100 else value


def identity_key(doc: dict[str, Any], identifier: str) -> str:
    if doc.get("use_identity_composite_key_for_hashing") is False:
        raise ValueError("environment hashes on identity database ids, which an offline check cannot recompute")
    return f"{doc['api_key']}_{identifier}"


def _condition_matches(cond: dict[str, Any], segment_id: str, key: str) -> bool:
    if cond.get("operator") != "PERCENTAGE_SPLIT" or (cond.get("property_") or "") not in ("", "$.identity.key"):
        raise Unsupported(f"segment {segment_id}: condition {cond.get('operator')} on {cond.get('property_')!r}")
    return hashed_percentage([segment_id, key]) <= float(cond["value"])


def _rule_matches(rule: dict[str, Any], segment_id: str, key: str) -> bool:
    combine = {"ALL": all, "ANY": any, "NONE": lambda xs: not any(xs)}[rule["type"]]
    conds = rule.get("conditions") or []
    subs = rule.get("rules") or []
    ok_conds = combine(_condition_matches(c, segment_id, key) for c in conds) if conds else True
    ok_subs = combine(_rule_matches(r, segment_id, key) for r in subs) if subs else True
    return ok_conds and ok_subs


def _feature_state_for(doc: dict[str, Any], identifier: str, key: str, flag: str) -> dict[str, Any]:
    for override in doc.get("identity_overrides") or []:
        if override.get("identifier") == identifier and any(
            fs["feature"]["name"] == flag for fs in override.get("identity_features") or []
        ):
            raise Unsupported(f"identity override of {flag} for {identifier}")
    chosen: dict[str, Any] | None = None
    best = DEFAULT_PRIORITY
    for seg in (doc.get("project") or {}).get("segments") or []:
        overrides = [fs for fs in seg.get("feature_states") or [] if fs["feature"]["name"] == flag]
        if not overrides:
            continue
        rules = seg.get("rules") or []
        if not (rules and all(_rule_matches(r, str(seg["id"]), key) for r in rules)):
            continue
        for fs in overrides:
            prio = float((fs.get("feature_segment") or {}).get("priority", DEFAULT_PRIORITY))
            if chosen is None or prio < best:
                chosen, best = fs, prio
    if chosen is not None:
        return chosen
    for fs in doc.get("feature_states") or []:
        if fs["feature"]["name"] == flag:
            return fs
    raise KeyError(f"{flag} is not in the environment document")


def independent_variant(doc: dict[str, Any], identifier: str, flag: str = FLAG_ROUTING) -> str | None:
    """Variant key for `identifier`: segment match, then the multivariate split of that feature state."""
    key = identity_key(doc, identifier)
    fs = _feature_state_for(doc, identifier, key, flag)
    mvs = fs.get("multivariate_feature_state_values") or []
    if not mvs:
        return None
    fs_key = str(fs.get("django_id") or fs["featurestate_uuid"])
    pct = hashed_percentage([fs_key, key])

    def priority(mv: dict[str, Any]) -> int:
        return mv.get("id") or int(mv["mv_fs_value_uuid"].replace("-", ""), 16)

    start = 0.0
    for mv in sorted(mvs, key=priority):
        limit = start + float(mv["percentage_allocation"])
        if start <= pct < limit:
            return mv["multivariate_feature_option"].get("key")
        start = limit
    return DEFAULT_VARIANT


# Engine evaluation -----------------------------------------------------------------------


@dataclass(frozen=True)
class EngineFlag:
    variant: str | None
    enabled: bool
    reason: str
    in_experiment: bool | None


class EngineEvaluator:
    """Evaluates identities exactly as the Flagsmith SDK does in local evaluation."""

    def __init__(self, doc: dict[str, Any]) -> None:
        identity_key(doc, "")  # refuse documents whose hashing cannot be reproduced offline
        self._local = LocalEvaluation.from_environment_document(cast(EnvironmentModel, doc))

    def evaluate(self, identifier: str, traits: dict[str, Any], flag: str = FLAG_ROUTING) -> EngineFlag:
        context, _ = self._local.get_identity_context(identifier=identifier, traits=traits)
        result = engine.get_evaluation_result(context=context)["flags"][flag]
        experiment = (result.get("metadata") or {}).get("experiment")
        return EngineFlag(
            variant=result["variant"],
            enabled=result["enabled"],
            reason=result["reason"],
            in_experiment=None if experiment is None else bool(experiment.get("in_experiment")),
        )


# Report ----------------------------------------------------------------------------------


@dataclass
class AssignmentReport:
    run: str
    env_file: str
    env_sha256: str
    env_updated_at: str | None
    flag: str
    flag_engine_version: str
    flagsmith_sdk_version: str
    records: int = 0
    checked: int = 0
    matched: int = 0
    recorded_counts: dict[str, int] = field(default_factory=dict)
    expected_counts: dict[str, int] = field(default_factory=dict)
    mismatched: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[dict[str, Any]] = field(default_factory=list)
    not_in_experiment: list[str] = field(default_factory=list)
    independent_agree: int = 0
    independent_disagree: list[dict[str, Any]] = field(default_factory=list)
    independent_unsupported: list[dict[str, str]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.mismatched

    def to_json(self) -> dict[str, Any]:
        return {
            "run": self.run,
            "env_file": self.env_file,
            "env_sha256": self.env_sha256,
            "env_updated_at": self.env_updated_at,
            "flag": self.flag,
            "flag_engine_version": self.flag_engine_version,
            "flagsmith_sdk_version": self.flagsmith_sdk_version,
            "records": self.records,
            "checked": self.checked,
            "matched": self.matched,
            "match_rate": round(self.matched / self.checked, 6) if self.checked else None,
            "recorded_counts": self.recorded_counts,
            "expected_counts": self.expected_counts,
            "mismatched": self.mismatched,
            "skipped": self.skipped,
            "not_in_experiment": self.not_in_experiment,
            "independent_check": {
                "agree": self.independent_agree,
                "disagree": self.independent_disagree,
                "unsupported": self.independent_unsupported,
                "note": "on disagreement the engine's variant is the expected one",
            },
            "ok": self.ok,
        }


def first_snapshot(run_dir: Path) -> Path:
    snaps = sorted((run_dir / "env").glob("*.json"))
    if not snaps:
        raise FileNotFoundError(f"no environment snapshots in {run_dir / 'env'}")
    return snaps[0]


def read_records(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").split("\n") if line.strip()]


def verify(run_dir: Path, env_file: Path | None = None, flag: str = FLAG_ROUTING) -> AssignmentReport:
    env_path = env_file or first_snapshot(run_dir)
    doc: dict[str, Any] = json.loads(env_path.read_text(encoding="utf-8"))
    evaluator = EngineEvaluator(doc)
    report = AssignmentReport(
        run=str(run_dir),
        env_file=str(env_path),
        env_sha256=hashlib.sha256(canonical_json(doc)).hexdigest(),
        env_updated_at=doc.get("updated_at"),
        flag=flag,
        flag_engine_version=version("flagsmith-flag-engine"),
        flagsmith_sdk_version=version("flagsmith"),
    )
    recorded: Counter[str] = Counter()
    expected: Counter[str] = Counter()
    for rec in read_records(run_dir / "tasks.jsonl"):
        report.records += 1
        ident = str(rec["identity"])
        if rec.get("flag_source") != "experiment":
            report.skipped.append(
                {"identity": ident, "flag_source": rec.get("flag_source"), "attempt": rec.get("attempt", 1)}
            )
            continue
        got = evaluator.evaluate(ident, dict(rec.get("traits") or {}), flag)
        want = got.variant or DEFAULT_VARIANT  # the runner reads a missing variant as control
        try:
            other = independent_variant(doc, ident, flag)
        except Unsupported as exc:
            report.independent_unsupported.append({"identity": ident, "reason": str(exc)})
        else:
            if other == got.variant:
                report.independent_agree += 1
            else:
                report.independent_disagree.append({"identity": ident, "engine": got.variant, "independent": other})
        if got.in_experiment is not True:
            report.not_in_experiment.append(ident)
        report.checked += 1
        recorded[str(rec["variant"])] += 1
        expected[want] += 1
        if rec["variant"] == want:
            report.matched += 1
        else:
            report.mismatched.append(
                {
                    "identity": ident,
                    "attempt": rec.get("attempt", 1),
                    "recorded": rec["variant"],
                    "expected": want,
                    "reason": got.reason,
                }
            )
    report.recorded_counts = dict(sorted(recorded.items()))
    report.expected_counts = dict(sorted(expected.items()))
    return report


app = typer.Typer(add_completion=False)


@app.command()
def main(
    run: Annotated[Path, typer.Option(help="run directory holding tasks.jsonl and env/")],
    env: Annotated[Path | None, typer.Option(help="environment document; default is the run's first snapshot")] = None,
    out: Annotated[Path | None, typer.Option(help="write the JSON report here as well as to stdout")] = None,
) -> None:
    report = verify(run, env)
    text = json.dumps(report.to_json(), indent=2, sort_keys=False) + "\n"
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
    typer.echo(text, nl=False)
    if not report.ok:
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
