import type { Fmt } from "../src/data/types";
import { describe, expect, it } from "vitest";
import { format } from "../src/data/format";
import seed from "../src/seed.json";
import keys from "../src/data/keys.json";
import shared from "../../../tests/fixtures/formats.json";

describe("format", () => {
  it("matches the fixture shared with analysis/render_docs.py", () => {
    for (const [value, fmt, expected] of shared as [number | string, Fmt, string][]) {
      expect(format(value, fmt), `${value} ${fmt}`).toBe(expected);
    }
  });

  it("renders each numbers.json format", () => {
    expect(format(1234.5, "usd2")).toBe("$1,234.50");
    expect(format(0.12345, "usd4")).toBe("$0.1235");
    expect(format(-31.24, "pct1")).toBe("−31.2%");
    expect(format(1.25, "pp1")).toBe("+1.3 pp");
    expect(format(250.4, "int")).toBe("250");
    expect(format(0.81, "f3")).toBe("0.810");
    expect(format(0.9912, "prob1")).toBe("99.1%");
    expect(format("abcdef0123456789", "hash12")).toBe("abcdef012345");
  });
});

describe("seed.json", () => {
  it("only holds {key, fmt, text} entries for known keys", () => {
    const known = new Map(keys.map((k) => [k.key, k.fmt]));
    for (const n of seed.numbers as { key: string; fmt: string; text: string }[]) {
      expect(Object.keys(n).sort()).toEqual(["fmt", "key", "text"]);
      expect(known.get(n.key)).toBe(n.fmt);
    }
  });
  it("shows no numbers while awaiting the run", () => {
    if (seed.status === "awaiting_run") expect(seed.numbers).toHaveLength(0);
  });
});
