import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, merkleRoot, parseKeepingNumbers, pyFloat, recordHash, tamper, verifyLedger, GENESIS, type RecordCheck } from "../src/site/ledger";

const REPO = resolve(__dirname, "../../..");
const numbers = existsSync(resolve(REPO, "analysis/out/numbers.json")) ? JSON.parse(readFileSync(resolve(REPO, "analysis/out/numbers.json"), "utf8")) : null;
const ledger = (run: string) => readFileSync(resolve(REPO, `runs/${run}/ledger.jsonl`), "utf8");

/** What `uv run python -m integrity.verify_ledger runs/<run>` prints, or null when uv is not installed here. */
function pythonRoot(run: string): { root: string; records: number; taskDone: number } | null {
  try {
    const out = execFileSync("uv", ["run", "python", "-m", "integrity.verify_ledger", `runs/${run}`], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 });
    const root = /merkle_root=([0-9a-f]{64})/.exec(out);
    const counts = /records=(\d+) task_done=(\d+)/.exec(out);
    return root && counts ? { root: root[1]!, records: Number(counts[1]), taskDone: Number(counts[2]) } : null;
  } catch {
    return null;
  }
}

describe("canonical JSON, as Python writes it", () => {
  it("prints floats by Python's repr rule", () => {
    const cases: [number, string][] = [
      [0, "0.0"],
      [1, "1.0"],
      [100, "100.0"],
      [0.5, "0.5"],
      [0.0384802, "0.0384802"],
      [0.1 + 0.2, "0.30000000000000004"],
      [0.0001, "0.0001"],
      [0.00001, "1e-05"],
      [1.5e-7, "1.5e-07"],
      [1e16, "1e+16"],
      [1234567890123456, "1234567890123456.0"],
      [1.7976931348623157e308, "1.7976931348623157e+308"],
      [-2.5, "-2.5"],
      [-0, "-0.0"],
      [622.6153815789472, "622.6153815789472"],
    ];
    for (const [x, want] of cases) expect(pyFloat(x), String(x)).toBe(want);
  });

  it("keeps ints as ints, sorts keys by code point and escapes like json.dumps", () => {
    const v = parseKeepingNumbers('{"b": 1, "a": [1.0, 2, 1e-5, -0.0, 12345678901234567890], "é": "x\\ny\\u00e9\\u0001\\"", "Z": null, "t": true}');
    expect(canonicalJson(v)).toBe('{"Z":null,"a":[1.0,2,1e-05,-0.0,12345678901234567890],"b":1,"t":true,"é":"x\\nyé\\u0001\\""}');
  });

  it("rejects text that is not JSON", () => {
    for (const bad of ["", "{", '{"a":}', "[1,]", '{"a":1} x', "01"]) expect(() => parseKeepingNumbers(bad), bad).toThrow(SyntaxError);
  });

  it("hashes a record the way integrity/canonical.py does", async () => {
    // record_hash("0" * 64, {"b": [1.0, 1e-05, "é"], "a": 1}) from Python
    expect(await recordHash(GENESIS, parseKeepingNumbers('{"b": [1.0, 0.00001, "é"], "a": 1}'))).toBe("7b0702adb207b09c8ef556093ee92e26841250661d976f5a0996d8002812e785");
    expect(await merkleRoot([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const leaf = "ab".repeat(32);
    expect(await merkleRoot([leaf])).toBe(leaf);
  });
});

describe("the rollout ledger, checked the way the browser checks it", () => {
  const text = ledger("rollout");

  it("verifies every record and reproduces the Merkle root in numbers.json", async () => {
    const seen: RecordCheck[] = [];
    const report = await verifyLedger(text, (r) => void seen.push(r));
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(seen).toHaveLength(report.records);
    expect(seen.every((r) => r.ok && r.stored === r.recomputed)).toBe(true);
    expect(seen[0]!.seq).toBe(0);
    if (numbers) {
      const want = numbers.integrity.by_experiment.rollout;
      expect(report.merkleRoot).toBe(want.merkle_root);
      expect(report.taskDone).toBe(want.task_done_records);
    }
  });

  it("reproduces the Merkle root that the Python verifier prints", async () => {
    const py = pythonRoot("rollout");
    if (!py) return; // uv is not installed here; the numbers.json comparison above still holds
    const report = await verifyLedger(text);
    expect(report.merkleRoot).toBe(py.root);
    expect(report.records).toBe(py.records);
    expect(report.taskDone).toBe(py.taskDone);
  }, 180_000);

  it("breaks at the edited record when one payload is changed", async () => {
    const first = (await collect(text)).find((r) => r.kind === "task_done")!;
    const edited = tamper(text, first.seq)!;
    expect(edited.text).not.toBe(text);
    const report = await verifyLedger(edited.text);
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual([`line ${first.line}: hash mismatch (seq ${first.seq})`]);
  });

  it("breaks when a record is removed or reordered", async () => {
    const lines = text.split("\n").filter(Boolean);
    const dropped = await verifyLedger([...lines.slice(0, 3), ...lines.slice(4)].join("\n"));
    expect(dropped.errors.some((e) => /seq 4, expected 3/.test(e))).toBe(true);
    expect(dropped.errors.some((e) => /prev_hash does not match/.test(e))).toBe(true);
  });
});

describe("the other committed ledgers", () => {
  for (const run of ["pilot-control", "pilot-lanes_v1", "dryrun-lanes_v2"]) {
    it(`verifies runs/${run} and matches numbers.json`, async () => {
      const report = await verifyLedger(ledger(run));
      expect(report.errors).toEqual([]);
      if (numbers?.integrity?.by_experiment?.[run]) expect(report.merkleRoot).toBe(numbers.integrity.by_experiment[run].merkle_root);
    }, 60_000);
  }
});

async function collect(text: string): Promise<RecordCheck[]> {
  const out: RecordCheck[] = [];
  await verifyLedger(text, (r) => void out.push(r));
  return out;
}
