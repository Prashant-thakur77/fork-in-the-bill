import { describe, expect, it } from "vitest";
import { hashedPercentage, md5 } from "../src/data/bucket";

// Reference values from Python's hashlib and the bucketing in integrity/verify_assignment.py.
describe("md5", () => {
  it("matches known digests", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("a".repeat(100))).toBe("36a92cc94a9e0fa21f625f8bfb007adf");
  });
});

describe("hashedPercentage", () => {
  it("matches the Python recomputation", () => {
    expect(hashedPercentage(["demo", "floci-io__floci-1837"])).toBeCloseTo(12.44248849769954, 10);
    expect(hashedPercentage(["12345", "env_abc_task-1"])).toBeCloseTo(92.04840968193638, 10);
    expect(hashedPercentage(["x"])).toBeCloseTo(18.24364872974595, 10);
  });
  it("is deterministic", () => {
    expect(hashedPercentage(["a", "b"])).toBe(hashedPercentage(["a", "b"]));
  });
});
