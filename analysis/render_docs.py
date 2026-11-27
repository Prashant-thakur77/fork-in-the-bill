"""Fill number markers from analysis/out/numbers.json (scheme in docs/interfaces.md).

Markdown markers look like `<!--n:exp1.arms.control.cost_mean:usd2-->$1.23<!--/n-->`.
JSON files hold entries `{"key": ..., "fmt": ..., "text": ...}` anywhere in their tree; the
`text` becomes the formatted value, or `template` with `{value}` substituted when an entry
has a `template`.

Value conventions in numbers.json: `*_pct` fields are already percentages (-32.1 means
-32.1%), `*_pp` fields are percentage points, and rates, shares and probabilities are 0-1
fractions rendered with `prob1`.

Formats: usd2, usd4, pct1, pp1, int, f3, prob1, hash12, p3 (a p-value to three decimals, or
`<0.001`), plus `str` for labels such as the shipped arm. A key segment that is an integer
indexes a list (`...cost_mean_ci.0`).

This module also owns the generated block of analysis/results.md between
`<!--results:start-->` and `<!--results:end-->`; text outside that block is kept as written.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Annotated, Any

import typer

MARKER_RE = re.compile(r"<!--n:(?P<key>[^:<>\s]+):(?P<fmt>[a-z0-9]+)-->(?P<val>.*?)<!--/n-->")
RESULTS_START = "<!--results:start-->"
RESULTS_END = "<!--results:end-->"
FORMATS = ("usd2", "usd4", "pct1", "pp1", "int", "f3", "prob1", "hash12", "p3", "str")
MISSING = "n/a"

MARKDOWN_TARGETS = ("README.md", "analysis/results.md", "docs/paper.md", "docs/build/deck.html", "SUBMISSION.md")
JSON_TARGETS = ("board/web/src/seed.json", "video/captions.json")


class MissingKeyError(KeyError):
    pass


def lookup(numbers: Any, key: str) -> Any:
    node = numbers
    for part in key.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list) and part.lstrip("-").isdigit() and -len(node) <= int(part) < len(node):
            node = node[int(part)]
        else:
            raise MissingKeyError(key)
    return node


MINUS = "\u2212"


def _fixed(x: float, places: int) -> str:
    """JavaScript Number.prototype.toFixed for x >= 0: exact binary value, ties away from zero."""
    q = Decimal(1).scaleb(-places)
    return str(Decimal(x).quantize(q, rounding=ROUND_HALF_UP))


def _grouped(x: float, places: int) -> str:
    whole, _, frac = _fixed(x, places).partition(".")
    return f"{int(whole):,}" + (f".{frac}" if frac else "")


def fmt_value(value: Any, fmt: str) -> str:
    if fmt not in FORMATS:
        raise ValueError(f"unknown format {fmt!r}")
    if value is None:
        return MISSING
    if fmt == "str":
        return str(value)
    if fmt == "hash12":
        return str(value)[:12]
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"format {fmt} needs a number, got {type(value).__name__}")
    v = float(value)
    # Same strings as board/web/src/data/format.ts: U+2212 minus, explicit plus on signed deltas.
    minus = MINUS if v < 0 else ""
    signed = MINUS if v < 0 else "+" if v > 0 else ""
    if fmt == "usd2":
        return f"{minus}${_grouped(abs(v), 2)}"
    if fmt == "usd4":
        return f"{minus}${_fixed(abs(v), 4)}"
    if fmt == "pct1":
        return f"{signed}{_fixed(abs(v), 1)}%"
    if fmt == "pp1":
        return f"{signed}{_fixed(abs(v), 1)} pp"
    if fmt == "int":
        return f"{math.floor(v + 0.5):,}"  # Math.round
    if fmt == "f3":
        return f"{minus}{_fixed(abs(v), 3)}"
    if fmt == "p3":
        return "<0.001" if v < 0.001 else _fixed(v, 3)
    p = v * 100
    return f"{MINUS if p < 0 else ''}{_fixed(abs(p), 1)}%"  # prob1


def marker(key: str, fmt: str, numbers: Any) -> str:
    """A filled marker for use when generating documents."""
    try:
        text = fmt_value(lookup(numbers, key), fmt)
    except MissingKeyError:
        text = MISSING
    return f"<!--n:{key}:{fmt}-->{text}<!--/n-->"


@dataclass
class Problem:
    file: str
    kind: str  # stale | missing_key | bad_format | bare_number
    detail: str

    def __str__(self) -> str:
        return f"{self.file}: {self.kind}: {self.detail}"


@dataclass
class FileResult:
    path: str
    skipped: bool = False
    markers: int = 0
    changed: bool = False
    problems: list[Problem] = field(default_factory=list)


def render_markdown(text: str, numbers: Any, name: str = "") -> tuple[str, int, list[Problem]]:
    """Return the re-rendered text, the marker count and the problems found."""
    problems: list[Problem] = []
    count = 0

    def sub(m: re.Match[str]) -> str:
        nonlocal count
        count += 1
        key, fmt, old = m.group("key"), m.group("fmt"), m.group("val")
        try:
            new = fmt_value(lookup(numbers, key), fmt)
        except MissingKeyError:
            problems.append(Problem(name, "missing_key", key))
            return m.group(0)
        except ValueError as exc:
            problems.append(Problem(name, "bad_format", f"{key}:{fmt}: {exc}"))
            return m.group(0)
        if new != old:
            problems.append(Problem(name, "stale", f"{key}:{fmt} shows {old!r}, expected {new!r}"))
        return f"<!--n:{key}:{fmt}-->{new}<!--/n-->"

    return MARKER_RE.sub(sub, text), count, problems


def render_json_entries(obj: Any, numbers: Any, name: str = "") -> tuple[Any, int, list[Problem]]:
    problems: list[Problem] = []
    count = 0

    def walk(node: Any) -> Any:
        nonlocal count
        if isinstance(node, list):
            return [walk(x) for x in node]
        if not isinstance(node, dict):
            return node
        out = {k: walk(v) for k, v in node.items()}
        key, fmt = out.get("key"), out.get("fmt")
        if isinstance(key, str) and isinstance(fmt, str):
            count += 1
            try:
                value = fmt_value(lookup(numbers, key), fmt)
            except MissingKeyError:
                problems.append(Problem(name, "missing_key", key))
                return out
            except ValueError as exc:
                problems.append(Problem(name, "bad_format", f"{key}:{fmt}: {exc}"))
                return out
            template = out.get("template")
            new = template.replace("{value}", value) if isinstance(template, str) else value
            if out.get("text") != new:
                problems.append(Problem(name, "stale", f"{key}:{fmt} shows {out.get('text')!r}, expected {new!r}"))
            out["text"] = new
        return out

    return walk(obj), count, problems


# --------------------------------------------------------------------------------------
# Bare-number detection inside results sections

_BARE_RE = re.compile(r"(?<![A-Za-z0-9_\-./#])[-+]?\$?\d+(?:[.,]\d+)*%?")
_STRIP_RES = (
    re.compile(r"```.*?```", re.S),
    MARKER_RE,
    re.compile(r"<!--lit-->.*?<!--/lit-->", re.S),
    re.compile(r"<!--.*?-->", re.S),
    re.compile(r"`[^`\n]*`"),
    re.compile(r"\]\([^)]*\)"),
    re.compile(r"^\s*\d+\.\s", re.M),
)


def results_sections(text: str) -> list[str]:
    return re.findall(re.escape(RESULTS_START) + r"(.*?)" + re.escape(RESULTS_END), text, re.S)


def bare_numbers(text: str) -> list[str]:
    """Numbers inside results sections that are not wrapped in a marker.

    Ignored: markers, `<!--lit-->...<!--/lit-->` spans for literal constants such as a
    pre-registered threshold, HTML comments, code, link targets, ordered-list numerals and
    digits that are part of an identifier (exp1, lanes_v1).
    """
    found: list[str] = []
    for section in results_sections(text):
        for rx in _STRIP_RES:
            section = rx.sub(" ", section)
        found.extend(m.group(0) for m in _BARE_RE.finditer(section))
    return found


# --------------------------------------------------------------------------------------
# Generated results.md block


def _arm_names(exp: dict[str, Any]) -> list[str]:
    arms = list(exp.get("arms", {}))
    return sorted(arms, key=lambda a: (a != "control", a))


def level_order(trait: str, levels: dict[str, Any]) -> list[str]:
    """Difficulty tertiles in difficulty order; other traits sorted by name."""
    if trait == "difficulty":
        return [lv for lv in ("low", "mid", "high") if lv in levels] + sorted(
            lv for lv in levels if lv not in ("low", "mid", "high")
        )
    return sorted(levels)


def _ci(base: str, fmt: str, numbers: Any) -> str:
    return f"{marker(base + '.0', fmt, numbers)} to {marker(base + '.1', fmt, numbers)}"


def _lit(text: str) -> str:
    """Wrap fixed text that holds digits (Beta(1,1), p99) so the bare-number check skips it."""
    return f"<!--lit-->{text}<!--/lit-->" if any(c.isdigit() for c in text) else text


SPEC_LABELS = {
    "all": "all tasks",
    "fresh": "fresh tier",
    "pre_cutoff": "pre-cutoff tier",
    "last": "last",
    "first": "first",
    "mean": "mean",
    "median": "median",
    "trimmed10": "10% trimmed mean",
    "beta11": "Beta(1,1)",
    "beta0505": "Beta(0.5,0.5)",
    "as_is": "as recorded",
    "winsorised": "winsorised at p99",
}


def _always_valid_lines(name: str, exp: dict[str, Any], numbers: Any) -> list[str]:
    av = (exp.get("secondary") or {}).get("always_valid") or {}
    if "cost" not in av:
        return []
    b = f"{name}.secondary.always_valid"
    alpha = marker(b + ".alpha", "f3", numbers)
    cost = (
        f"it first fell below {alpha} after task {marker(b + '.cost.first_cross_at', 'int', numbers)}, "
        f"which finished at {marker(b + '.cost.first_cross_finished_at', 'str', numbers)}"
        if av["cost"].get("crossed")
        else f"it never fell below {alpha}"
    )
    harm = (
        f"it crossed {alpha} in the harmful direction after task "
        f"{marker(b + '.solve.first_harmful_cross_at', 'int', numbers)}"
        if av["solve"].get("crossed_harmful")
        else f"it never crossed {alpha} with `{exp['delta']['treatment']}` solving less"
    )
    lines = [
        "### Secondary: always-valid p-values (added after `exp1` ended, not part of the decision)",
        "",
        f"The run is replayed in the order its {marker(b + '.n_tasks', 'int', numbers)} analysed tasks finished. "
        "A mixture sequential probability ratio test with a normal mixing distribution is evaluated after every "
        f"task once each arm has {marker(b + '.min_per_arm', 'int', numbers)} tasks, which first happens at task "
        f"{marker(b + '.first_evaluated_at', 'int', numbers)}. The mixing scale comes from the pilot alone: "
        f"{marker(b + '.cost.tau', 'usd4', numbers)} per task for cost and "
        f"{marker(b + '.solve.tau', 'prob1', numbers)} for solve rate (`analysis/always_valid.py`, DECISIONS.md D29).",
        "",
        f"- Mean cost per task: always-valid p = {marker(b + '.cost.p_final', 'p3', numbers)} at the end; {cost}. "
        f"Always-valid interval at the end: {_ci(b + '.cost.ci_final', 'usd4', numbers)}.",
        f"- Solve rate: always-valid p = {marker(b + '.solve.p_final', 'p3', numbers)} at the end, interval "
        f"{_ci(b + '.solve.ci_final_pp', 'pp1', numbers)}; {harm}.",
    ]
    if av.get("board_live_after_tasks"):
        lines.append(
            "- When the live board went public (DECISIONS.md D24), "
            f"{marker(b + '.board_live_after_tasks', 'int', numbers)} tasks had finished. The always-valid p was "
            f"then {marker(b + '.cost.p_at_board_live', 'p3', numbers)} for cost and "
            f"{marker(b + '.solve.p_at_board_live', 'p3', numbers)} for solve rate."
        )
    return [*lines, "", f"![Always-valid p-values for {name}](charts/{name}-always-valid.png)", ""]


def _multiverse_lines(name: str, exp: dict[str, Any], numbers: Any) -> list[str]:
    mv = (exp.get("secondary") or {}).get("multiverse") or {}
    if not mv.get("n_specs"):
        return []
    b = f"{name}.secondary.multiverse"
    treatment = exp["delta"]["treatment"]

    def share(key: str) -> str:
        return f"{marker(f'{b}.{key}', 'int', numbers)} ({marker(f'{b}.{key}_share', 'prob1', numbers)})"

    lines = [
        "### Secondary: specification curve (added after `exp1` ended, not part of the decision)",
        "",
        f"{marker(b + '.n_specs', 'int', numbers)} specifications: every combination of task set (all, fresh tier, "
        "pre-cutoff tier), the attempt kept for an identity that ran twice (last, first), the cost statistic (mean, "
        f"median, {_lit('10%')} trimmed mean), the solve-rate prior ({_lit('Beta(1,1)')}, {_lit('Beta(0.5,0.5)')}) "
        f"and cost outliers (as recorded, winsorised at the pooled {_lit('99th')} percentile). A tier with too few "
        "tasks in an arm is left out (`analysis/multiverse.py`, DECISIONS.md D29).",
        "",
        f"- Guardrail posterior at or above the bar: {share('guardrail_pass')} of specifications.",
        f"- Cost per solved task lower under `{treatment}`: {share('cost_direction')}; with the whole bootstrap "
        f"interval below zero: {share('cps_ci_below_zero')}.",
        f"- Both the guardrail and the cost direction hold: {share('both')}.",
        f"- The change in cost per solved task ranges from {_ci(b + '.cps_change_pct_range', 'pct1', numbers)}, "
        f"and the guardrail posterior from {_ci(b + '.guardrail_posterior_range', 'prob1', numbers)}.",
        "- Specifications below the guardrail bar use the task set: "
        f"{marker(b + '.guardrail_fail_task_sets', 'str', numbers)} "
        f"({marker(b + '.fresh_specs_failing', 'int', numbers)} of {marker(b + '.fresh_specs', 'int', numbers)} "
        f"fresh-tier specifications fail, and {marker(b + '.non_fresh_specs_failing', 'int', numbers)} others do), "
        "as in the by-tier section.",
        "",
        f"![Specification curve for {name}](charts/{name}-specification-curve.png)",
        "",
        "<details>",
        "<summary>Every specification</summary>",
        "",
        "| task set | attempt | cost statistic | prior | outliers | n control | n treatment "
        "| change in cost per solved task | bootstrap interval | P(Δsolve > \u2212m) |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for i, s in enumerate(mv["specs"]):
        base = f"{b}.specs.{i}"
        choices = [_lit(SPEC_LABELS[s[k]]) for k in ("task_set", "attempt", "cost_stat", "prior", "outliers")]
        if s.get("registered"):
            choices[0] = f"{choices[0]} (registered)"
        cells = [
            *choices,
            marker(base + ".n_control", "int", numbers),
            marker(base + ".n_treatment", "int", numbers),
            marker(base + ".cps_change_pct", "pct1", numbers),
            _ci(base + ".cps_change_pct_ci", "pct1", numbers),
            marker(base + ".guardrail_posterior", "prob1", numbers),
        ]
        lines.append("| " + " | ".join(cells) + " |")
    return [*lines, "", "</details>", ""]


def _frontier_lines(numbers: Any) -> list[str]:
    fr = numbers.get("frontier") or {}
    if not fr.get("arms"):
        return []
    lines = [
        "## Secondary: every arm on one cost-accuracy plane (added after `exp1` ended)",
        "",
        "Mean cost per task against solve rate for every arm the project ran, with percentile bootstrap intervals "
        "on both. An arm is on the frontier when no other arm costs no more and solves no less. The batches ran on "
        "different task pools (pilot, exp1, rollout, exp2), so a comparison across batches describes them and tests "
        "nothing; only the arms within one experiment were randomised (`analysis/frontier.py`).",
        "",
        "| arm | tasks | mean cost | interval | solve rate | interval | on the frontier |",
        "|---|---|---|---|---|---|---|",
    ]
    for key in fr["order"]:
        base = f"frontier.arms.{key}"
        lines.append(
            f"| {marker(base + '.label', 'str', numbers)} | {marker(base + '.n', 'int', numbers)} "
            f"| {marker(base + '.cost_mean', 'usd4', numbers)} | {_ci(base + '.cost_mean_ci', 'usd4', numbers)} "
            f"| {marker(base + '.solve_rate', 'prob1', numbers)} | {_ci(base + '.solve_rate_ci', 'prob1', numbers)} "
            f"| {marker(base + '.on_frontier', 'str', numbers)} |"
        )
    return [*lines, "", "![Every arm on one cost-accuracy plane](charts/frontier.png)", ""]


def _proof_lines(numbers: Any) -> list[str]:
    proofs = (numbers.get("integrity") or {}).get("proofs") or {}
    if not proofs:
        return []
    lines = [
        "## Integrity: inclusion proofs",
        "",
        "Every `task_done` record has an audit path to its run's Merkle root (`integrity/merkle.py`). "
        "`uv run python -m integrity.prove --run runs/exp1 --task <identity>` prints one and checks it; "
        "the files below hold every path, for the site.",
        "",
    ]
    for run in proofs:
        b = f"integrity.proofs.{run}"
        lines.append(
            f"- `{run}`: {marker(b + '.verified', 'int', numbers)} of {marker(b + '.leaves', 'int', numbers)} "
            f"leaves verified against root {marker(b + '.root', 'hash12', numbers)}, longest path "
            f"{marker(b + '.path_length_max', 'int', numbers)} hashes, "
            f"{marker(b + '.bytes', 'int', numbers)} bytes in `analysis/out/{proofs[run]['file']}`."
        )
    return [*lines, ""]


def _experiment_block(name: str, numbers: Any) -> list[str]:
    exp = numbers[name]
    arms = _arm_names(exp)
    p = f"{name}.arms"
    lines = [f"## Experiment `{name}`", ""]
    pr = exp.get("prereg", {})
    if pr:
        lines += [
            f"Pre-registration tag {marker(name + '.prereg.tag', 'str', numbers)}, "
            f"sha256 {marker(name + '.prereg.sha256', 'hash12', numbers)}, "
            f"guardrail margin m = {marker(name + '.prereg.m', 'prob1', numbers)} of solve rate.",
            "",
        ]
    lines += ["| | " + " | ".join(f"`{a}`" for a in arms) + " |", "|---" * (len(arms) + 1) + "|"]
    rows: list[tuple[str, str, str]] = [
        ("Exposed", "n_exposed", "int"),
        ("Excluded", "n_excluded", "int"),
        ("Analysed", "n_analysed", "int"),
        ("Mean cost per task", "cost_mean", "usd4"),
        ("Median cost per task", "cost_median", "usd4"),
        ("Solves", "solves", "int"),
        ("Solve rate", "solve_rate", "prob1"),
        ("Cost per solved task", "cost_per_solve", "usd4"),
        ("Delegate share of cost", "delegate_share_cost", "prob1"),
        ("Delegate share of tokens", "delegate_share_tokens", "prob1"),
        ("Mean turns", "turns_mean", "f3"),
        ("Mean seconds", "seconds_mean", "f3"),
    ]
    for label, field_, fmt in rows:
        cells = [marker(f"{p}.{a}.{field_}", fmt, numbers) for a in arms]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    for label, field_, fmt in (
        ("Mean cost, bootstrap interval", "cost_mean_ci", "usd4"),
        ("Solve rate, posterior interval", "solve_rate_ci", "prob1"),
        ("Cost per solve, bootstrap interval", "cost_per_solve_ci", "usd4"),
    ):
        cells = [_ci(f"{p}.{a}.{field_}", fmt, numbers) for a in arms]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    d = f"{name}.delta"
    lines += [
        "",
        "### Differences (treatment minus control)",
        "",
        f"- Mean cost: {marker(d + '.cost_mean', 'usd4', numbers)} per task "
        f"({marker(d + '.cost_mean_pct', 'pct1', numbers)}), bootstrap interval "
        f"{_ci(d + '.cost_mean_ci', 'usd4', numbers)}.",
        f"- Cost per solved task: {marker(d + '.cost_per_solve_pct', 'pct1', numbers)}.",
        f"- Solve rate: {marker(d + '.solve_rate_pp', 'pp1', numbers)}, posterior interval "
        f"{_ci(d + '.solve_rate_ci', 'pp1', numbers)}.",
        f"- Posterior probability that the solve-rate drop is within m: "
        f"{marker(d + '.p_solve_drop_within_m', 'prob1', numbers)}.",
        "",
        "### Sample ratio",
        "",
        f"Chi-square {marker(name + '.srm.chi2', 'f3', numbers)}, "
        f"p = {marker(name + '.srm.p', 'f3', numbers)}, "
        f"flagged: {marker(name + '.srm.flag', 'str', numbers)}.",
        "",
        "### Flagsmith readout",
        "",
        f"- Chance to beat control on `task_cost`: "
        f"{marker(name + '.flagsmith.chance_to_beat_control_cost', 'prob1', numbers)}.",
        f"- Guardrail `task_solved` status: {marker(name + '.flagsmith.solve_rate_status', 'str', numbers)}.",
        f"- Results pulled at {marker(name + '.flagsmith.pulled_at', 'str', numbers)}.",
    ]
    for a in arms:
        lines.append(
            f"- `{a}` mean cost, absolute difference between our figure and Flagsmith's: "
            f"{marker(f'{name}.agreement.cost_mean_abs_diff.{a}', 'usd4', numbers)}."
        )
    rm = f"{name}.decision.rule_met"
    lines += [
        "",
        "### Decision",
        "",
        f"Ship: {marker(name + '.decision.ship', 'str', numbers)}. "
        f"Flagsmith chance to beat control at or above the pre-registered bar: "
        f"{marker(rm + '.flagsmith_95', 'str', numbers)}; "
        f"guardrail posterior at or above the bar: {marker(rm + '.guardrail_90', 'str', numbers)}; "
        f"no Flagsmith guardrail loss: {marker(rm + '.no_guardrail_loss', 'str', numbers)}.",
        "",
        "### Secondary: CUPED (labelled secondary, not part of the decision)",
        "",
        f"Variance reduction from the pilot-trained cost covariate: "
        f"{marker(name + '.cuped.variance_reduction_pct', 'pct1', numbers)}; adjusted mean cost "
        f"difference {marker(name + '.cuped.delta_cost_mean', 'usd4', numbers)}.",
        "",
    ]
    tiers = {t: v for t, v in (exp.get("by_tier") or {}).items() if all((v.get(a) or {}).get("n") for a in arms)}
    if len(tiers) > 1:
        lines += [
            "### Secondary: by tier (reported, not part of the decision)",
            "",
            "`fresh` tasks were created after the models' training cutoff; `pre_cutoff` tasks were created before it.",
            "",
            "| tier | "
            + " | ".join(f"`{a}` n | `{a}` solve rate | `{a}` mean cost | `{a}` cost per solve" for a in arms)
            + " |",
            "|---" * (1 + 4 * len(arms)) + "|",
        ]
        for tier in tiers:
            base = f"{name}.by_tier.{tier}"
            cells = []
            for a in arms:
                cells += [
                    marker(f"{base}.{a}.n", "int", numbers),
                    marker(f"{base}.{a}.solve_rate", "prob1", numbers),
                    marker(f"{base}.{a}.cost_mean", "usd4", numbers),
                    marker(f"{base}.{a}.cost_per_solve", "usd4", numbers),
                ]
            lines.append(f"| `{tier}` | " + " | ".join(cells) + " |")
        lines.append("")
        for tier in tiers:
            d = f"{name}.by_tier.{tier}.delta"
            lines.append(
                f"- `{tier}`: mean cost {marker(d + '.cost_mean_pct', 'pct1', numbers)} "
                f"(bootstrap interval {_ci(d + '.cost_mean_pct_ci', 'pct1', numbers)}), "
                f"cost per solved task {marker(d + '.cost_per_solve_pct', 'pct1', numbers)}, "
                f"solve rate {marker(d + '.solve_rate_pp', 'pp1', numbers)} "
                f"(posterior interval {_ci(d + '.solve_rate_ci', 'pp1', numbers)}), "
                f"posterior probability that the drop is within m: "
                f"{marker(d + '.p_solve_drop_within_m', 'prob1', numbers)}."
            )
        lines.append("")
    lines += _always_valid_lines(name, exp, numbers)
    lines += _multiverse_lines(name, exp, numbers)
    lines += [
        "### By trait",
        "",
    ]
    for trait, levels in exp.get("by_trait", {}).items():
        if not levels:
            continue
        lines += [
            f"#### `{trait}`",
            "",
            "| level | " + " | ".join(f"`{a}` n | `{a}` solve rate | `{a}` mean cost" for a in arms) + " |",
            "|---" * (1 + 3 * len(arms)) + "|",
        ]
        for level in level_order(trait, levels):
            base = f"{name}.by_trait.{trait}.{level}"
            cells: list[str] = []
            for a in arms:
                cells += [
                    marker(f"{base}.{a}.n", "int", numbers),
                    marker(f"{base}.{a}.solve_rate", "prob1", numbers),
                    marker(f"{base}.{a}.cost_mean", "usd4", numbers),
                ]
            lines.append(f"| `{level}` | " + " | ".join(cells) + " |")
        lines.append("")
    return lines


def build_results_body(numbers: Any) -> str:
    lines: list[str] = [""]
    if "integrity" in numbers:
        lines += [
            f"Merkle root over {marker('integrity.task_done_records', 'int', numbers)} "
            f"`task_done` records: {marker('integrity.merkle_root', 'hash12', numbers)}.",
            "",
        ]
    if "spend" in numbers:
        lines += [f"Total model spend: {marker('spend.total_usd', 'usd2', numbers)}.", ""]
    for name in ("exp1", "exp2"):
        if isinstance(numbers.get(name), dict) and numbers[name].get("arms"):
            lines += _experiment_block(name, numbers)
            lines.append("")
    lines += _frontier_lines(numbers)
    lines += _proof_lines(numbers)
    return "\n".join(lines).rstrip() + "\n"


RESULTS_TEMPLATE = (
    "# Results\n\n"
    "Every figure in the block below comes from `analysis/out/numbers.json` and is filled by\n"
    "`analysis/render_docs.py`.\n\n" + RESULTS_START + "\n" + RESULTS_END + "\n"
)


def regenerate_results_md(text: str | None, numbers: Any) -> str:
    if text is None or RESULTS_START not in text or RESULTS_END not in text:
        text = (text.rstrip() + "\n\n" if text else "") + (
            RESULTS_TEMPLATE if not text else RESULTS_START + "\n" + RESULTS_END + "\n"
        )
    head, rest = text.split(RESULTS_START, 1)
    _, tail = rest.split(RESULTS_END, 1)
    return head + RESULTS_START + "\n" + build_results_body(numbers) + RESULTS_END + tail


# --------------------------------------------------------------------------------------
# Driver


def process(root: Path, numbers: Any, write: bool, regenerate: bool = False) -> list[FileResult]:
    """Render (write=True) or check (write=False) every target file under root."""
    results: list[FileResult] = []
    for rel in MARKDOWN_TARGETS:
        path = root / rel
        res = FileResult(rel)
        original = path.read_text(encoding="utf-8") if path.exists() else None
        if regenerate and rel == "analysis/results.md":
            source = regenerate_results_md(original, numbers)
        elif original is None:
            res.skipped = True
            results.append(res)
            continue
        else:
            source = original
        new, res.markers, res.problems = render_markdown(source, numbers, rel)
        res.problems += [Problem(rel, "bare_number", n) for n in bare_numbers(new)]
        res.changed = new != original
        if write and res.changed:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(new, encoding="utf-8")
        results.append(res)
    for rel in JSON_TARGETS:
        path = root / rel
        res = FileResult(rel)
        if not path.exists():
            res.skipped = True
            results.append(res)
            continue
        original_text = path.read_text(encoding="utf-8")
        new_obj, res.markers, res.problems = render_json_entries(json.loads(original_text), numbers, rel)
        new_text = json.dumps(new_obj, indent=2, ensure_ascii=False) + "\n"
        res.changed = bool(res.problems) and any(p.kind == "stale" for p in res.problems)
        if write and res.changed:
            path.write_text(new_text, encoding="utf-8")
        results.append(res)
    return results


def load_numbers(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


app = typer.Typer(add_completion=False)


@app.command()
def main(
    root: Annotated[Path, typer.Option(help="repository root")] = Path("."),
    numbers: Annotated[Path, typer.Option()] = Path("analysis/out/numbers.json"),
    regenerate: Annotated[bool, typer.Option(help="rebuild the generated block of analysis/results.md")] = True,
) -> None:
    nums = load_numbers(root / numbers if not numbers.is_absolute() else numbers)
    failed = False
    for res in process(root, nums, write=True, regenerate=regenerate):
        if res.skipped:
            typer.echo(f"skip {res.path} (not found)")
            continue
        typer.echo(f"{'wrote' if res.changed else 'ok   '} {res.path} ({res.markers} markers)")
        for p in res.problems:
            if p.kind in ("missing_key", "bad_format", "bare_number"):
                failed = True
                typer.echo(f"  {p}", err=True)
    raise typer.Exit(1 if failed else 0)


if __name__ == "__main__":
    app()
