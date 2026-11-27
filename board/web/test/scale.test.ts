import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "../src/entry-server";
import { CARDS } from "../src/pages/Research";
import { ROWS } from "../src/pages/Different";
import { HEADLINE } from "../src/pages/Scale";
// @ts-expect-error plain ESM build script without types
import { ciStats, codeStats, groupOf, runStats, scaleFrom, testStats, withNumbersScale } from "../scripts/scale-data.mjs";
// @ts-expect-error plain ESM build script without types
import { loadRepoData, referencesFrom } from "../scripts/repo-data.mjs";

const REPO = resolve(__dirname, "../../..");
const data = loadRepoData(REPO);
const text = (path: string) =>
  render(path)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const linesOf = (rel: string) => readFileSync(resolve(REPO, rel), "utf8").split("\n").filter((l) => l.trim()).length;

describe("build-time counters", () => {
  it("counts one attempt per line of tasks.jsonl and one call per line of calls.jsonl", () => {
    const r = runStats(REPO, "rollout");
    expect(r.attempts).toBe(linesOf("runs/rollout/tasks.jsonl"));
    expect(r.calls).toBe(linesOf("runs/rollout/calls.jsonl"));
    expect(r.ledger).toBe(linesOf("runs/rollout/ledger.jsonl"));
    expect(r.tasks).toBeLessThanOrEqual(r.attempts);
    expect(r.solved).toBeLessThanOrEqual(r.attempts);
    expect(r.tests).toBeGreaterThan(r.attempts);
    expect(r.tokens).toBeGreaterThan(r.calls);
  });

  it("agrees with numbers.json where both know the answer", () => {
    const numbers = JSON.parse(readFileSync(resolve(REPO, "analysis/out/numbers.json"), "utf8"));
    const rollout = runStats(REPO, "rollout");
    expect(rollout.tasks).toBe(numbers.rollout.n);
    const exp1 = runStats(REPO, "exp1");
    expect(exp1.solved).toBe(numbers.exp1.arms.control.solves + numbers.exp1.arms.lanes_v1.solves);
    expect(exp1.tasks).toBeGreaterThanOrEqual(numbers.exp1.arms.control.n_analysed + numbers.exp1.arms.lanes_v1.n_analysed);
    // the site's own count and the analysis output's scale block agree on what both count from the same files
    if (numbers.scale) {
      const own = scaleFrom(REPO);
      expect(own.totals.tasks).toBe(numbers.scale.tasks_run);
      expect(own.totals.tests).toBe(numbers.scale.tests_executed);
      expect(own.totals.calls).toBe(numbers.scale.model_calls);
      expect(own.totals.tokens).toBe(numbers.scale.tokens);
      expect(own.totals.ledger).toBe(numbers.scale.ledger_records);
      expect(own.totals.events).toBe(numbers.scale.events_sent);
      expect(own.totals.envSnapshots).toBe(numbers.scale.env_snapshots);
      expect(own.totals.transcripts).toBe(numbers.scale.transcripts);
      // and the shipped page uses the block's values wherever it has a key
      expect(data.scale.totals.attempts).toBe(numbers.scale.task_attempts);
      expect(data.scale.totals.repos).toBe(numbers.scale.repos);
      expect(data.scale.tests.python + data.scale.tests.typescript).toBe(numbers.scale.unit_tests);
      expect(data.scale.fromNumbers).toEqual(expect.arrayContaining(["tasks", "attempts", "tests", "unitTests"]));
    }
  });

  it("groups runs into batches and adds them up", () => {
    expect(groupOf("pilot-control")).toBe("pilot");
    expect(groupOf("dryrun3-lanes_v1")).toBe("dryrun");
    expect(groupOf("exp1")).toBe("exp1");
    const s = scaleFrom(REPO);
    const sum = (k: string) => s.groups.reduce((n: number, g: Record<string, number>) => n + g[k]!, 0);
    for (const k of ["attempts", "tasks", "tests", "calls", "tokens", "ledger"]) expect(sum(k), k).toBe(s.totals[k]);
    expect(s.totals.distinctTasks).toBeLessThanOrEqual(s.totals.tasks);
  });

  it("counts code, tests and CI jobs from tracked files, leaving data out", () => {
    const code = codeStats(REPO);
    expect(code.lines).toBe(code.byLang.reduce((n: number, l: { lines: number }) => n + l.lines, 0));
    expect(code.byLang.map((l: { lang: string }) => l.lang)).toEqual(expect.arrayContaining(["Python", "TypeScript"]));
    expect(code.lines).toBeLessThan(200_000); // run records are not counted as code
    const t = testStats(REPO);
    expect(t.python).toBeGreaterThan(50);
    expect(t.typescript).toBeGreaterThan(50);
    const jobs = ciStats(REPO).flatMap((w: { jobs: string[] }) => w.jobs);
    expect(jobs).toEqual(expect.arrayContaining(["python", "board"]));
  });

  it("lets the analysis output's scale block replace the site's own counts, key by key", () => {
    const own = scaleFrom(REPO);
    const plain = withNumbersScale(own, undefined);
    expect(plain.fromNumbers).toEqual([]);
    expect(plain.totals.tests).toBe(own.totals.tests);
    const over = withNumbersScale(own, { tests_executed: 7, model_calls: 9, languages: ["go", "c"], npm_packages: 2, unit_tests_python: 3, unit_tests_ts: 4, tasks_by_batch: { exp1: 5, rollout: 4 }, tests_by_result: { pass: 6, fail: 1 }, unknown_key: 1 });
    expect(over.totals.tests).toBe(7);
    expect(over.totals.calls).toBe(9);
    expect(over.totals.attempts).toBe(own.totals.attempts);
    expect(over.totals.languages).toEqual(["c", "go"]);
    expect(over.totals.languageCount).toBe(2);
    expect(over.tests.python).toBe(3);
    expect(over.tests.typescript).toBe(4);
    expect(over.testsByResult).toEqual({ pass: 6, fail: 1 });
    expect(plain.testsByResult).toBeNull();
    expect(over.groups.find((g: { key: string }) => g.key === "exp1").tasks).toBe(5);
    expect(over.fromNumbers).toEqual(expect.arrayContaining(["tests", "calls", "languages", "packageCount", "unitTests", "tasksByBatch"]));
    expect(own.totals.tests).not.toBe(7); // the input is not changed
  });
});

describe("the reference list", () => {
  it("is parsed into one entry per source with a stable id", () => {
    const refs = referencesFrom("# R\n\n## 1. Topic one\n\n- Kapoor, S., Stroebl, B., & Narayanan, A. (2024). AI Agents That Matter. arXiv:1. https://example.org/a\n  - Argues something.\n- Flagsmith (n.d.). Docs page. Flagsmith Docs. https://example.org/b\n- Flagsmith (n.d.). Other page. https://example.org/c\n");
    expect(refs.map((r: { id: string }) => r.id)).toEqual(["kapoor-stroebl-2024", "flagsmith-nd", "flagsmith-nd-2"]);
    expect(refs[0]).toMatchObject({ short: "Kapoor et al., 2024", title: "AI Agents That Matter", url: "https://example.org/a", note: "Argues something.", section: "Topic one" });
    expect(new Set(data.references.map((r: { id: string }) => r.id)).size).toBe(data.references.length);
    expect(data.references.length).toBeGreaterThan(20);
  });

  it("backs every research card and every citation with an entry and a file that exist", () => {
    const ids = new Set(data.references.map((r: { id: string }) => r.id));
    for (const c of CARDS) {
      for (const id of c.ids) expect(ids.has(id), id).toBe(true);
      expect(existsSync(resolve(REPO, c.file)), c.file).toBe(true);
    }
    const html = render("/different");
    for (const m of html.matchAll(/class="cite" href="([^"]+)"/g)) expect(data.references.some((r: { url: string }) => r.url === m[1]), m[1]).toBe(true);
    expect([...html.matchAll(/class="cite"/g)].length).toBeGreaterThanOrEqual(8);
    expect(ROWS.length).toBeGreaterThanOrEqual(7);
  });
});

describe("the pages", () => {
  it("shows the counted figures on /scale and on the home strip", () => {
    const page = text("/scale");
    const home = text("/");
    for (const f of HEADLINE) {
      expect(page).toContain(f.value);
      expect(home).toContain(f.value);
    }
    expect(page).toContain(data.scale.totals.tokens.toLocaleString("en-US"));
    expect(page).toContain(`${data.scale.code.lines.toLocaleString("en-US")} lines`);
    expect(render("/scale")).toContain("data-count");
    const proj = data.numbers?.projection;
    if (proj) {
      expect(page).toContain("Arithmetic on measured figures, not a measurement");
      expect(page).toContain("Per 1,000 solved bugs");
      expect(page).toContain(`$${proj.per_1000_solved.saved.toFixed(2)}`);
    } else expect(page).not.toContain("Per 1,000 solved bugs");
    if (data.numbers?.pricing) expect(page).toContain(`${data.numbers.pricing.frontier_to_small_ratio} times the price per token`);
  });

  it("shows the four later analyses from numbers.json, and nothing for one that is absent", () => {
    const html = render("/research");
    const page = text("/research");
    const sec = data.numbers?.exp1?.secondary ?? {};
    if (sec.always_valid) {
      expect(page).toContain(`task ${sec.always_valid.cost.first_cross_at} of ${sec.always_valid.n_tasks}`);
      expect(page).toContain(`${sec.always_valid.board_live_after_tasks} tasks in`);
      expect(page).toContain("labelled secondary");
    } else expect(page).not.toContain("always-valid p-value stays valid");
    if (sec.multiverse) {
      expect(page).toContain(`${sec.multiverse.guardrail_pass} of ${sec.multiverse.n_specs}`);
      expect(page).toContain(`${sec.multiverse.cost_direction} of ${sec.multiverse.n_specs}`);
      if (sec.multiverse.guardrail_fail_only_fresh) expect(page).toContain(`${sec.multiverse.guardrail_fail}, all on the fresh tier alone`);
    } else expect(page).not.toContain("Specifications run");
    if (data.numbers?.frontier) {
      expect(page).toContain("This reading is descriptive");
      expect(page).toContain(`${data.numbers.frontier.n_on_frontier} of ${data.numbers.frontier.n_arms} arms`);
    } else expect(page).not.toContain("On the frontier");
    if (data.numbers?.integrity?.proofs?.exp1) expect(page).toContain(`${data.numbers.integrity.proofs.exp1.verified} of ${data.numbers.integrity.proofs.exp1.leaves}`);
    for (const f of ["frontier.png", "exp1-always-valid.png", "exp1-specification-curve.png"]) {
      if (data.charts.includes(f)) expect(html).toContain(`/figures/${f}`);
      else expect(html).not.toContain(`/figures/${f}`);
    }
    expect(page).not.toMatch(/exp1\.secondary\.|integrity\.proofs\./); // readings carry plain labels, not key names
    expect(text("/research")).not.toMatch(/coming soon|placeholder|to be added/i);
    expect(text("/research")).toContain("What we took");
  });

  it("names no product in the comparison's left column", () => {
    const page = text("/different");
    expect(page).toContain("The usual way");
    expect(page).not.toMatch(/FrugalGPT|RouteLLM|AutoMix|OpenAI|LangChain|Google/);
  });
});
