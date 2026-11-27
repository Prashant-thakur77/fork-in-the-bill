import { describe, expect, it } from "vitest";
import { describe as describeChange, timeline, utcMinute, VARIANT_OPTIONS, type FlagChange } from "../src/data/flags";
import ids from "../../../flagsmith/ids.json";

let nextId = 1;
const START = 1_800_000_000;

function flag(at: number, before: number | null, after: number | null, over: Partial<FlagChange> = {}): FlagChange {
  const w = (p: number | null) => (p === null ? null : [{ option_id: 37431, pct: p }]);
  return {
    id: nextId++,
    at,
    received_at: at,
    source: "flag",
    event_type: "FLAG_UPDATED",
    feature: "agent_routing",
    environment: "Production",
    scope: "environment",
    segment: null,
    enabled_before: true,
    enabled_after: true,
    weights_before: w(before),
    weights_after: w(after),
    value_sha256_before: "a".repeat(64),
    value_sha256_after: "a".repeat(64),
    ...over,
  };
}

function audit(at: number): FlagChange {
  return {
    ...flag(at, null, null),
    source: "audit",
    event_type: "AUDIT_FEATURE_STATE",
    scope: null,
    enabled_before: null,
    enabled_after: null,
    value_sha256_before: null,
    value_sha256_after: null,
  };
}

describe("describe", () => {
  it("names start, rollout and end from the variant weights", () => {
    expect(describeChange(flag(START, 0, 50))).toMatchObject({ kind: "start", detail: "control 50 · lanes_v1 50 · Production" });
    expect(describeChange(flag(START, null, 50))).toMatchObject({ kind: "start" });
    expect(describeChange(flag(START, 50, 100))).toMatchObject({ kind: "rollout", label: "Rolled out: lanes_v1" });
    expect(describeChange(flag(START, 50, 0))).toMatchObject({ kind: "end" });
    expect(describeChange(flag(START, 50, 30))).toMatchObject({ kind: "change", label: "Split changed" });
  });

  it("names switches, value changes, no-op saves and audit entries", () => {
    expect(describeChange(flag(START, 50, 50, { enabled_after: false }))).toMatchObject({ label: "Flag switched off" });
    expect(describeChange(flag(START, 50, 50, { value_sha256_after: "b".repeat(64) }))).toMatchObject({ label: "Control value changed" });
    expect(describeChange(flag(START, 50, 50))).toMatchObject({ kind: "noop" });
    expect(describeChange(audit(START))).toMatchObject({ kind: "audit", label: "Audit log: feature state" });
  });

  it("treats a segment override as a change, never as the run starting", () => {
    expect(describeChange(flag(START, 0, 50, { scope: "segment", segment: "canary" }))).toMatchObject({
      kind: "change",
      detail: "control 50 · lanes_v1 50 · Production · segment canary",
    });
  });
});

describe("timeline", () => {
  it("says there were no changes during the run when only the start and rollout happened", () => {
    const t = timeline([flag(START, 0, 50), audit(START + 1), flag(START + 86_400, 50, 100), audit(START + 86_401)]);
    expect(t.during).toBe(0);
    expect(t.summary).toBe("No changes during the run.");
  });

  it("counts a mid-run change and marks it", () => {
    const t = timeline([flag(START, 0, 50), flag(START + 600, 50, 50, { enabled_after: false }), flag(START + 86_400, 50, 100)]);
    expect(t.during).toBe(1);
    expect(t.summary).toBe("1 change during the run.");
    expect(t.rows.filter((r) => r.during).map((r) => r.d.label)).toEqual(["Flag switched off"]);
  });

  it("counts an audit entry with no matching flag webhook, and ignores no-op saves", () => {
    const t = timeline([flag(START, 0, 50), flag(START + 300, 50, 50), audit(START + 301), audit(START + 5000), flag(START + 86_400, 50, 0)]);
    expect(t.during).toBe(1);
    expect(t.summary).toBe("1 change during the run.");
  });

  it("reports a running experiment and the empty and unknown cases", () => {
    expect(timeline([flag(START, 0, 50)]).summary).toBe("No changes since the run started.");
    expect(timeline([]).summary).toBe("No flag changes recorded yet.");
    expect(timeline(null).summary).toBe("Posts when Flagsmith reports a change to the flag.");
    expect(timeline([flag(START, 50, 30)]).summary).toBe("No experiment start recorded yet.");
  });

  it("uses the last start, so an earlier pilot does not count as the run", () => {
    const t = timeline([flag(START, 0, 50), flag(START + 10, 50, 0), flag(START + 100, 50, 50, { enabled_after: false }), flag(START + 200, 0, 50), flag(START + 900, 50, 100)]);
    expect(t.start?.at).toBe(START + 200);
    expect(t.summary).toBe("No changes during the run.");
  });
});

describe("helpers", () => {
  it("formats UTC minutes", () => {
    expect(utcMinute(START)).toBe("2027-01-15 08:00 UTC");
  });
  it("names the same variant options as flagsmith/ids.json", () => {
    const fromIds = Object.fromEntries(Object.entries(ids.variants.agent_routing).map(([name, id]) => [id, name]));
    expect(VARIANT_OPTIONS).toEqual(fromIds);
  });
});
