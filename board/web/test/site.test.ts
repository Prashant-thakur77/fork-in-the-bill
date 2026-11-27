import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NOT_FOUND, ROUTES, normalize, routeFor } from "../src/site/routes";
import { PAGES } from "../src/site/Shell";
import { render } from "../src/entry-server";
import { resultsReady } from "../src/pages/Results";
import { signalOf } from "../src/pages/Timeline";
import { PY_QUICKSTART } from "../src/site/quickstart";
// @ts-expect-error plain ESM build script without types
import { figuresFrom, loadRepoData, merkleRoot, sections, blocks } from "../scripts/repo-data.mjs";
import keys from "../src/data/keys.json";

const REPO = resolve(__dirname, "../../..");

describe("routes", () => {
  it("normalises paths for deep links and reloads", () => {
    expect(normalize("/live/")).toBe("/live");
    expect(normalize("/live?demo=replay")).toBe("/live");
    expect(normalize("/method#power")).toBe("/method");
    expect(normalize("")).toBe("/");
    expect(routeFor("/proof/").path).toBe("/proof");
  });

  it("sends unknown paths to the wrong-exit page", () => {
    expect(routeFor("/nope")).toBe(NOT_FOUND);
    expect(routeFor("/live/extra")).toBe(NOT_FOUND);
  });

  it("has a page component for every route, unique paths and exits", () => {
    for (const r of [...ROUTES, NOT_FOUND]) expect(PAGES[r.path], r.path).toBeTypeOf("function");
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.exit)).size).toBe(ROUTES.length);
  });

  it("keeps the top navigation short", () => {
    expect(ROUTES.filter((r) => r.group === "main").length).toBeLessThanOrEqual(5);
  });
});

describe("prerender", () => {
  for (const r of [...ROUTES, NOT_FOUND]) {
    it(`renders ${r.path} with one h1, the header and the footer`, () => {
      const html = render(r.path);
      expect(html.match(/<h1[\s>]/g)?.length, r.path).toBe(1);
      expect(html).toContain('id="main"');
      expect(html).toContain("site-footer");
      expect(html).toMatch(/aria-current="page"|Wrong exit|Can a small model/);
    });
  }

  it("renders the 404 as a wrong exit with links to every page", () => {
    const html = render("/404");
    expect(html).toContain("Wrong exit");
    for (const r of ROUTES.filter((x) => x.path !== "/")) expect(html).toContain(`href="${r.path}"`);
  });

  it("writes no credits or tool mentions into any page", () => {
    for (const r of [...ROUTES, NOT_FOUND]) {
      const text = render(r.path).replace(/<[^>]+>/g, " ");
      expect(text, r.path).not.toMatch(/built with|thanks to|inspired by|generated with|co-authored|powered by/i);
    }
  });
});

describe("results empty state", () => {
  it("is not ready without numbers.json figures and a decision", () => {
    expect(resultsReady({}, {})).toBe(false);
    expect(resultsReady({ "exp1.arms.control.cost_mean": "$1.00" }, {})).toBe(false);
    expect(resultsReady({ "exp1.arms.control.cost_mean": "$1.00" }, { "exp1.decision.ship": "control" })).toBe(true);
  });

  it("shows the in-progress state and no dollar figures while numbers.json is missing", () => {
    const data = loadRepoData(REPO);
    if (data.hasNumbers) return; // the run has finished; the verdict test below covers it
    const html = render("/results");
    expect(html).toContain("Run in progress");
    expect(html).toContain("Results post here when the analysis script runs");
    const main = html.slice(html.indexOf('id="main"'), html.indexOf("site-footer"));
    // The live panel renders dashes until the API answers; no figure is typed into the page.
    expect(main).not.toMatch(/\$\d/);
  });

  it("fills itself from numbers.json when the analysis has run", () => {
    const fake = {
      exp1: { arms: { control: { cost_mean: 0.1234, solve_rate: 0.5 } }, delta: { cost_mean_pct: -31.24 }, decision: { ship: "lanes_v1" } },
    };
    const f = figuresFrom(fake, keys);
    expect(f["exp1.arms.control.cost_mean"]).toBe("$0.1234");
    expect(f["exp1.arms.control.solve_rate"]).toBe("50.0%");
    expect(f["exp1.delta.cost_mean_pct"]).toBe("−31.2%");
    expect(Object.keys(f)).toHaveLength(3);
  });

  it("fails the build loudly when a quoted source file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "fib-"));
    mkdirSync(join(root, "board/web/src/data"), { recursive: true });
    writeFileSync(join(root, "board/web/src/data/keys.json"), JSON.stringify(keys));
    for (const f of ["harness/policy.py"]) {
      mkdirSync(join(root, f, ".."), { recursive: true });
    }
    expect(() => loadRepoData(root)).toThrow(/snippet/); // missing source files fail the build loudly
  });
});

describe("repo data", () => {
  const data = loadRepoData(REPO);

  it("recomputes the pilot Merkle roots recorded in PROGRESS.md", () => {
    const progress = readFileSync(join(REPO, "PROGRESS.md"), "utf8");
    for (const l of data.ledgers) expect(progress).toContain(l.merkleRoot.slice(0, 8));
    expect(merkleRoot([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("reads the prereg hashes, the decision rule and every decision", () => {
    expect(data.hashes.length).toBeGreaterThanOrEqual(2);
    for (const h of data.hashes) expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
    const rule = data.prereg.decisionRule.find((b: { type: string }) => b.type === "list");
    expect(rule.items).toHaveLength(3);
    expect(data.decisionsLog.length).toBeGreaterThan(10);
    expect(data.decisionsLog[0].id).toBe("D1");
  });

  it("parses markdown sections and blocks", () => {
    const s = sections("# T\nintro\n## A\none\n\n- x\n- y\n## B\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(Object.keys(s)).toEqual(["_intro", "A", "B"]);
    expect(blocks(s.A)).toEqual([
      { type: "p", text: "one" },
      { type: "list", ordered: false, items: ["x", "y"] },
    ]);
    expect(blocks(s.B)[0]).toEqual({ type: "table", head: ["a", "b"], rows: [["1", "2"]] });
  });

  it("quotes the Python quickstart only from names the kit exports", () => {
    const init = readFileSync(join(REPO, "kit/forkbill/__init__.py"), "utf8");
    const names = /from forkbill import (.*)/.exec(PY_QUICKSTART)![1]!.split(",").map((s) => s.trim());
    for (const n of names) expect(init, n).toContain(`"${n}"`);
  });

  it("maps PROGRESS.md status words to lane signals", () => {
    expect(signalOf("done")).toBe("done");
    expect(signalOf("running")).toBe("live");
    expect(signalOf("in progress (code)")).toBe("work");
    expect(signalOf("blocked on 7")).toBe("wait");
  });
});
