import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AssignmentError,
  explainAssignment,
  hashedPercentage,
  hashWorking,
  md5,
  parsePolicy,
  UnsupportedDocumentError,
} from "../src/index.js";

// dist/test/ -> kit/ts/test/fixtures and the repository root
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "test", "fixtures");
const ROOT = join(HERE, "..", "..", "..", "..");

interface Vectors {
  hashed_percentage: Array<{ ids: string[]; value: number }>;
  assignments: Array<{
    identity: string;
    segment_percentage: number;
    in_rollout: boolean;
    split_percentage: number;
    independent_variant: string | null;
    engine_variant: string | null;
    engine_in_experiment: boolean | null;
  }>;
}

// Both files are written by test/fixtures/make_fixtures.py from the Python implementation.
const DOC: Record<string, any> = JSON.parse(readFileSync(join(FIXTURES, "environment.json"), "utf8"));
const VECTORS: Vectors = JSON.parse(readFileSync(join(FIXTURES, "vectors.json"), "utf8"));
const clone = (): Record<string, any> => structuredClone(DOC);

test("md5 matches known digests", () => {
  assert.equal(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5("a".repeat(100)), "36a92cc94a9e0fa21f625f8bfb007adf");
});

test("hashedPercentage equals Python's hashed_percentage", () => {
  assert.ok(VECTORS.hashed_percentage.length >= 8);
  for (const { ids, value } of VECTORS.hashed_percentage) {
    assert.equal(hashedPercentage(ids), value, ids.join(","));
    const w = hashWorking(ids);
    assert.equal(w.input, ids.join(","));
    assert.equal(w.md5, md5(w.input));
    assert.equal(w.remainder, Number(BigInt(`0x${w.md5}`) % 9999n));
    assert.equal(w.percentage, value);
  }
});

test("explainAssignment equals Python's independent_variant and Flagsmith's engine", () => {
  assert.equal(VECTORS.assignments.length, 60);
  const seen = new Set<string>();
  for (const want of VECTORS.assignments) {
    const got = explainAssignment(DOC, want.identity);
    assert.equal(got.variant, want.independent_variant, want.identity);
    assert.equal(got.variant, want.engine_variant, want.identity);
    assert.equal(got.featureState.experiment?.inExperiment, want.engine_in_experiment, want.identity);
    assert.equal(got.segments.length, 1);
    assert.equal(got.segments[0]?.conditions[0]?.hash.percentage, want.segment_percentage);
    assert.equal(got.segments[0]?.matched, want.in_rollout);
    assert.equal(got.featureState.source, want.in_rollout ? "segment_override" : "environment");
    assert.equal(got.featureState.id, want.in_rollout ? "9002" : "9001");
    assert.equal(got.split?.hash.percentage, want.split_percentage);
    assert.equal(got.split?.ranges.filter((r) => r.matched).length, 1);
    assert.equal(got.split?.ranges.find((r) => r.matched)?.variant, want.independent_variant);
    assert.equal(parsePolicy(got.value).policy, want.independent_variant);
    seen.add(`${want.in_rollout}:${want.independent_variant}`);
  }
  // The fixture exercises every path: outside the rollout, and each of the three arms inside it.
  assert.deepEqual([...seen].sort(), ["false:control", "true:control", "true:lanes_v1", "true:lanes_v2"]);
});

test("the working never contains the environment key", () => {
  const got = explainAssignment(DOC, "task:0001");
  assert.equal(got.identityKey, "<api_key>_task:0001");
  assert.equal(got.segments[0]?.conditions[0]?.hash.input, "7001,<api_key>_task:0001");
  assert.ok(!JSON.stringify({ ...got, value: null }).includes(DOC["api_key"]));
});

test("variants are walked in id order and the remainder is control", () => {
  const inside = VECTORS.assignments.find((a) => a.in_rollout)?.identity ?? "";
  const got = explainAssignment(DOC, inside);
  assert.deepEqual(
    got.split?.ranges.map((r) => [r.variant, r.start, r.end]),
    [["lanes_v1", 0, 30], ["lanes_v2", 30, 60], ["control", 60, 100]],
  );
  const flipped = clone();
  flipped["project"].segments[0].feature_states[0].multivariate_feature_state_values.reverse();
  assert.deepEqual(explainAssignment(flipped, inside).split?.ranges, got.split?.ranges);

  // Outside the rollout the environment's own feature state gives every variant 0 points.
  const outside = VECTORS.assignments.find((a) => !a.in_rollout)?.identity ?? "";
  assert.deepEqual(
    explainAssignment(DOC, outside).split?.ranges.map((r) => [r.variant, r.start, r.end, r.matched]),
    [["lanes_v1", 0, 0, false], ["lanes_v2", 0, 0, false], ["control", 0, 100, true]],
  );
});

test("a flag with no variants has no split", () => {
  const got = explainAssignment(DOC, "task:0001", "routing_kill");
  assert.equal(got.variant, null);
  assert.equal(got.split, null);
  assert.equal(got.featureState.enabled, false);
  assert.deepEqual(got.segments, []);
});

test("documents that cannot be recomputed are refused, not guessed", () => {
  assert.throws(() => explainAssignment(DOC, "task:0001", "missing_flag"), AssignmentError);
  assert.throws(() => explainAssignment(DOC, ""), AssignmentError);
  assert.throws(() => explainAssignment("nope", "task:0001"), AssignmentError);
  const noKey = clone();
  delete noKey["api_key"];
  assert.throws(() => explainAssignment(noKey, "task:0001"), /no api_key/);
  const dbIds = clone();
  dbIds["use_identity_composite_key_for_hashing"] = false;
  assert.throws(() => explainAssignment(dbIds, "task:0001"), UnsupportedDocumentError);
  const traitRule = clone();
  traitRule["project"].segments[0].rules[0].conditions[0] = { operator: "EQUAL", property_: "plan", value: "pro" };
  assert.throws(() => explainAssignment(traitRule, "task:0001"), /condition EQUAL on "plan"/);
  const overridden = clone();
  overridden["identity_overrides"] = [
    { identifier: "task:0001", identity_features: [{ feature: { name: "agent_routing" }, enabled: true }] },
  ];
  assert.throws(() => explainAssignment(overridden, "task:0001"), UnsupportedDocumentError);
  assert.equal(explainAssignment(overridden, "task:0002").variant, explainAssignment(DOC, "task:0002").variant);
});

test("every arm recorded in the committed experiment is re-derived from its start snapshot", (t) => {
  const run = join(ROOT, "runs", "exp1");
  if (!existsSync(join(run, "tasks.jsonl"))) return t.skip("runs/exp1 is not in this checkout");
  const doc: unknown = JSON.parse(readFileSync(join(run, "env", "000-start.json"), "utf8"));
  const records = readFileSync(join(run, "tasks.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { identity: string; variant: string; flag_source: string })
    .filter((rec) => rec.flag_source === "experiment");
  assert.ok(records.length > 100);
  for (const rec of records) {
    assert.equal(explainAssignment(doc, rec.identity).variant ?? "control", rec.variant, rec.identity);
  }
});
