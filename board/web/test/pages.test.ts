import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "../src/entry-server";
import { MENU_GROUPS, MOVED, PARTS, ROUTES } from "../src/site/routes";
import { chainage } from "../src/site/scroll";
import { STACKS, WANTS } from "../src/site/Booth";
// @ts-expect-error plain ESM build script without types
import { loadRepoData } from "../scripts/repo-data.mjs";

const REPO = resolve(__dirname, "../../..");
const data = loadRepoData(REPO);
const text = (path: string) =>
  render(path)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("navigation", () => {
  it("puts every page except home in exactly one menu group, and numbers the exits in order", () => {
    const groups = new Set(MENU_GROUPS.map((g) => g.key));
    for (const r of ROUTES.slice(1)) expect(groups.has(r.menu!), r.path).toBe(true);
    expect(ROUTES.map((r) => r.exit)).toEqual(ROUTES.map((_, i) => String(i)));
  });

  it("lists every page in the menu and the footer of every page", () => {
    const html = render("/");
    for (const r of ROUTES.slice(1)) expect(html.split(`href="${r.path}"`).length - 1, r.path).toBeGreaterThanOrEqual(r.path === "/updates" ? 1 : 2);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it("keeps the menu to about a dozen entries in four groups, with four links in the header", () => {
    const listed = ROUTES.filter((r) => r.menu && r.path !== "/updates");
    expect(listed.length).toBeGreaterThanOrEqual(10);
    expect(listed.length).toBeLessThanOrEqual(12);
    expect(new Set(listed.map((r) => r.menu)).size).toBe(4);
    expect(ROUTES.filter((r) => r.group === "main")).toHaveLength(4);
  });

  it("redirects every folded page to its part, and that part is on the page", () => {
    const redirects = readFileSync(resolve(REPO, "board/web/public/_redirects"), "utf8");
    for (const [from, { to, anchor }] of Object.entries(MOVED)) {
      expect(ROUTES.some((r) => r.path === from), from).toBe(false);
      expect(ROUTES.some((r) => r.path === to), to).toBe(true);
      expect(PARTS.some((r) => r.path === from), from).toBe(true);
      expect(redirects).toContain(`${from} ${to}${anchor ? `#${anchor}` : ""} 301`);
      const html = render(to);
      if (anchor) expect(html, `${to}#${anchor}`).toContain(`id="${anchor}"`);
      // the folded page's own title heads its part, or the page itself
      expect(html).toContain(PARTS.find((r) => r.path === from)!.title.split(" ")[0]);
      // no link on the site still points at the old address
      for (const r of ROUTES) expect(render(r.path), `${r.path} links to ${from}`).not.toMatch(new RegExp(`href="${from}["#]`));
    }
  });

  it("gives every element on a merged page its own id", () => {
    for (const to of new Set(Object.values(MOVED).map((m) => m.to))) {
      const ids = [...render(to).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!).filter((id) => !/^:r/.test(id));
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect([...new Set(dup)], to).toEqual([]);
    }
  });

  it("reads the scroll position as a chainage", () => {
    expect(chainage(0)).toBe("km 0+000");
    expect(chainage(3449)).toBe("km 3+400");
    expect(chainage(12960)).toBe("km 13+000");
  });
});

describe("experiment 2 and the rollout", () => {
  it("shows the registration and no verdict while experiment 2 is open", () => {
    const exp2 = data.batches.find((b: { id: string }) => b.id === "exp2");
    if (exp2.state !== "open") return;
    const page = text("/experiment-2");
    expect(page).toContain(exp2.preregSha);
    expect(page).toContain("prereg-exp2");
    expect(page).toContain("What will count as a win");
    expect(page).toContain("They are not the result");
    expect(page).not.toMatch(/lanes_v2 ships|lanes_v1 stays /);
    expect(page).toContain("pending");
  });

  it("describes the flag before and after End Experiment from the two ledgers' first snapshots", () => {
    const { before, after } = data.flagStates;
    if (!before || !after) return;
    expect(before.experimentId).toBeTruthy();
    expect(after.experimentId).toBeNull();
    const page = text("/results");
    expect(page).toContain(before.envSha256.slice(0, 16));
    expect(page).toContain(after.envSha256.slice(0, 16));
    expect(page).toContain(`${after.variants[0][1]}%`);
    if (data.numbers?.rollout) expect(page).toContain(data.figures["rollout.solve_rate"]);
  });
});

describe("the paper, the guide and the updates window", () => {
  it("links the PDFs and figures that exist in the repository", () => {
    const html = render("/research");
    if (existsSync(resolve(REPO, "docs/paper.pdf"))) expect(html).toContain("/downloads/fork-in-the-bill-paper.pdf");
    if (existsSync(resolve(REPO, "docs/deck.pdf"))) expect(html).toContain("/downloads/fork-in-the-bill-deck.pdf");
    for (const f of data.paper.figures) expect(existsSync(resolve(REPO, "analysis/charts", f.file)), f.file).toBe(true);
    expect(text("/research")).toContain(data.paper.title);
  });

  it("takes every snippet in the guide from a file in the repository", () => {
    for (const k of ["kitInit", "kitPy", "kitTs", "kitOpenFeature", "tsInstall", "selfhostRun", "selfhostDown"]) {
      const s = data.snippets[k];
      const src = readFileSync(resolve(REPO, s.file), "utf8");
      expect(src, k).toContain(s.code.split("\n")[0]);
    }
    const page = text("/use-it");
    expect(page).toContain(data.kit.ts.name);
    if (!data.kit.mcp) {
      expect(page).toContain("Coming with the next release");
      expect(page).not.toMatch(/npx [a-z-]*mcp|"mcpServers"/);
    } else expect(page).toContain(data.kit.mcp.name);
  });

  it("offers the same choices the worker accepts, as a plain form before any script runs", () => {
    const worker = readFileSync(resolve(REPO, "board/worker/src/waitlist.ts"), "utf8");
    for (const w of WANTS) expect(worker).toContain(`${w.key}:`);
    expect(STACKS.every((s) => s.length <= 200)).toBe(true);
    const html = render("/updates");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/waitlist"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="wants"');
    expect(html).toContain('name="website"');
    expect(text("/updates")).toContain("Nobody is typing back");
    expect(text("/updates")).toContain("open an issue");
    expect(html).not.toMatch(/mailto:/);
  });
});

describe("the worker's configuration", () => {
  const toml = readFileSync(resolve(REPO, "board/worker/wrangler.toml"), "utf8");
  it("still answers unknown paths with the 404 page", () => {
    expect(toml).toContain('not_found_handling = "404-page"');
  });
  it("sends the sign-up paths to the Worker first, and keeps the table to what the form asks", () => {
    expect(toml).toMatch(/run_worker_first = \[[^\]]*"\/waitlist"[^\]]*"\/waitlist\/\*"/);
    const sql = readFileSync(resolve(REPO, "board/worker/migrations/0003_waitlist.sql"), "utf8");
    const table = /CREATE TABLE IF NOT EXISTS waitlist \(([\s\S]*?)\);/.exec(sql)![1]!;
    const cols = table.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
    expect(cols).toEqual(["id", "email", "wants", "stack", "created_at", "source"]);
  });
});
