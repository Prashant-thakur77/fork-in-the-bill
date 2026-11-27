import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { render } from "../src/entry-server";
import { batchPhase, batchStatus, gapBetween, utcStamp } from "../src/site/batches";
import type { Batch } from "../src/site/data";
import type { Snapshot } from "../src/data/types";
// @ts-expect-error plain ESM build script without types
import { batchesFrom, loadRepoData } from "../scripts/repo-data.mjs";

const REPO = resolve(__dirname, "../../..");
const HASHES = [
  { sha256: "a".repeat(64), file: "prereg/experiment-1.md" },
  { sha256: "b".repeat(64), file: "prereg/experiment-2.md" },
];
const snap = (experiment: string, status: Snapshot["status"] = "running"): Snapshot => ({
  experiment,
  ts: 1,
  status,
  flagsmith_experiment_url: "",
  arms: { control: { done: 3, solved: 1, usd: 0.1, running: 0 } },
});
const state = (list: Batch[], id: string) => list.find((b) => b.id === id)!;
/** The words a reader sees: tags and React's text markers removed, entities decoded. */
const text = (path: string) =>
  render(path)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("batches from the repository", () => {
  it("calls a batch finished only when numbers.json holds its result", () => {
    const none = batchesFrom(REPO, null, HASHES);
    expect(none.batches.map((b: Batch) => b.state)).toEqual(["open", "open", "open"]);
    const decided = batchesFrom(REPO, { exp1: { decision: { ship: "lanes_v1" } }, rollout: { n: 13 } }, HASHES);
    expect(state(decided.batches, "exp1").state).toBe("final");
    expect(state(decided.batches, "rollout").state).toBe("final");
    expect(state(decided.batches, "rollout").arms).toEqual(["lanes_v1"]);
    expect(state(decided.batches, "exp2").state).toBe("open");
    expect(decided.current).toBe("exp2");
  });

  it("reads the newest open batch live, and the last decided one when nothing is open", () => {
    expect(batchesFrom(REPO, null, HASHES.slice(0, 1)).batches[2].state).toBe("planned");
    const all = batchesFrom(REPO, { exp1: { decision: { ship: "lanes_v1" } }, rollout: { n: 13 }, exp2: { decision: { ship: "control" } } }, HASHES);
    expect(all.current).toBe("exp2");
    expect(state(all.batches, "exp2").state).toBe("final");
  });

  it("never lets the API's status field mark a finished batch as running", () => {
    const { batches } = batchesFrom(REPO, { exp1: { decision: { ship: "lanes_v1" } }, rollout: { n: 13 } }, HASHES);
    const exp1 = state(batches, "exp1");
    expect(batchStatus(exp1, snap("exp1", "running")).key).toBe("final");
    expect(batchPhase(exp1, snap("exp1", "running"))).toBe("rolled_out");
    expect(batchStatus(state(batches, "rollout"), snap("rollout")).label).toBe("Done");
    const exp2 = state(batches, "exp2");
    expect(batchStatus(exp2, snap("exp2")).key).toBe("live");
    expect(batchStatus(exp2, null).key).toBe("registered");
    expect(batchStatus(exp2, snap("exp2", "ended")).key).toBe("ended");
    expect(batchPhase(exp2, null)).toBe("awaiting");
  });

  it("formats registration times in UTC", () => {
    expect(utcStamp("2026-11-27T12:53:08Z", true, true)).toBe("27 Nov 2026, 12:53:08 UTC");
    expect(utcStamp(null)).toBe("");
    expect(gapBetween("2026-11-26T22:57:35Z", "2026-11-26T23:02:48Z")).toBe("5 min 13 s");
    expect(gapBetween("2026-11-27T12:00:00Z", "2026-11-27T11:00:00Z")).toBe("");
  });
});

describe("pages against this repository's numbers", () => {
  const data = loadRepoData(REPO);
  const exp1 = data.batches.find((b: Batch) => b.id === "exp1");
  const exp2 = data.batches.find((b: Batch) => b.id === "exp2");

  it("opens the live board on the running batch with a tab for each one", () => {
    const html = text("/live");
    for (const b of data.batches.filter((x: Batch) => x.state !== "planned")) expect(html).toContain(b.label);
    expect(render("/live")).toContain("batch-switch");
    if (data.currentExperiment === "exp2") expect(html).toContain("Experiment 2, running now");
    if (exp1.state === "final") expect(html).not.toMatch(/EXP1 · RUNNING/);
  });

  it("shows the experiment 1 decision and the rollout on the results page once they exist", () => {
    if (exp1.state !== "final") return;
    const html = text("/results");
    expect(html).toContain(`Experiment 1: ${exp1.ship === "control" ? "control stays" : `${exp1.ship} ships`}`);
    expect(html).toContain(data.figures["exp1.delta.cost_mean_pct"]);
    expect(html).toContain(data.figures["exp1.arms.lanes_v1.cost_per_solve"]);
    if (data.numbers?.rollout) {
      expect(html).toContain("Rolled out on the same flag");
      expect(html).toContain(data.figures["rollout.cost_mean"]);
    }
  });

  it("shows experiment 2 as running and registered, with no verdict, until its result exists", () => {
    if (exp2.state !== "open") return;
    const html = text("/results");
    expect(html).toContain("Experiment 2: running");
    expect(html).toContain("Registered before its first task");
    expect(html).toContain(exp2.preregSha);
    expect(html).not.toMatch(/Experiment 2: lanes_v\d (ships|stays)/);
    expect(Object.keys(data.figures).filter((k) => k.startsWith("exp2.") && !k.startsWith("exp2.prereg"))).toEqual([]);
  });
});
