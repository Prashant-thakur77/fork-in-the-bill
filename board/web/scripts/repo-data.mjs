// Reads the repository at build time and returns every fact the site shows.
// Nothing here is typed by hand: numbers, hashes, snippets and versions come from files in the
// repo (or from git). A missing file gives an empty value, and the page shows its empty state.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");
export const REPO_URL = "https://github.com/Prashant-thakur77/fork-in-the-bill";

const MINUS = "−";

function read(root, rel) {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
function readJson(root, rel) {
  const t = read(root, rel);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Same rules as src/data/format.ts and analysis/render_docs.py. */
export function formatFigure(value, fmt) {
  if (fmt === "hash12") return String(value).slice(0, 12);
  const v = Number(value);
  const sign = v < 0 ? MINUS : v > 0 ? "+" : "";
  const grouped = (x, p) => {
    const [w = "", f] = x.toFixed(p).split(".");
    const c = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return f === undefined ? c : `${c}.${f}`;
  };
  switch (fmt) {
    case "usd2":
      return `${v < 0 ? MINUS : ""}$${grouped(Math.abs(v), 2)}`;
    case "usd4":
      return `${v < 0 ? MINUS : ""}$${Math.abs(v).toFixed(4)}`;
    case "pct1":
      return `${sign}${Math.abs(v).toFixed(1)}%`;
    case "pp1":
      return `${sign}${Math.abs(v).toFixed(1)} pp`;
    case "int":
      return Math.round(v).toLocaleString("en-US");
    case "f3":
      return `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(3)}`;
    case "prob1":
      return `${v < 0 ? MINUS : ""}${Math.abs(v * 100).toFixed(1)}%`;
    default:
      throw new Error(`unknown fmt ${fmt}`);
  }
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Figures from analysis/out/numbers.json, formatted per board/web/src/data/keys.json. */
export function figuresFrom(numbers, keys) {
  const out = {};
  if (!numbers) return out;
  for (const { key, fmt } of keys) {
    const v = getPath(numbers, key);
    if (v === undefined || v === null || v === "...") continue;
    out[key] = formatFigure(v, fmt);
  }
  return out;
}

export function decisionsFrom(numbers) {
  const d = {};
  if (!numbers) return d;
  for (const k of ["exp1.decision.ship", "exp2.decision.ship"]) {
    const v = getPath(numbers, k);
    if (typeof v === "string" && /^[a-z0-9_]+$/.test(v)) d[k] = v;
  }
  for (const exp of ["exp1", "exp2"]) {
    const met = getPath(numbers, `${exp}.decision.rule_met`) ?? {};
    for (const [k, v] of Object.entries(met)) if (typeof v === "boolean") d[`${exp}.decision.rule_met.${k}`] = String(v);
  }
  return d;
}

/** Split a markdown file into { "Heading": "body" } by `## ` headings. */
export function sections(md) {
  const out = {};
  if (!md) return out;
  let cur = "_intro";
  out[cur] = [];
  for (const line of md.split("\n")) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      cur = m[1].trim();
      out[cur] = [];
    } else out[cur].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join("\n").trim()]));
}

/** Paragraphs and list items of a markdown block, as plain blocks the site can render. */
export function blocks(md) {
  if (!md) return [];
  const res = [];
  let para = [];
  let list = null;
  const flush = () => {
    if (para.length) res.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const lines = md.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  let table = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|/.test(line)) {
      flush();
      if (list) (res.push(list), (list = null));
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      if (!table) {
        table = { type: "table", head: cells, rows: [] };
        res.push(table);
      } else table.rows.push(cells);
      continue;
    }
    table = null;
    const li = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = !!li[1];
      if (!list || list.ordered !== ordered) {
        if (list) res.push(list);
        list = { type: "list", ordered, items: [] };
      }
      list.items.push(li[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += " " + line.trim();
      continue;
    }
    if (line.trim() === "") {
      flush();
      if (list) (res.push(list), (list = null));
      continue;
    }
    if (list) (res.push(list), (list = null));
    if (/^```/.test(line)) continue;
    para.push(line.trim());
  }
  flush();
  if (list) res.push(list);
  return res;
}

function dedent(lines) {
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0));
}

/**
 * A snippet of a repo file: from the first line matching `start`, through the first later line
 * matching `end` (inclusive), or `count` lines. Throws when the anchor is gone, so a moved line
 * fails the build instead of showing stale code.
 */
export function snippet(root, file, start, { end, count, skip = [] } = {}) {
  const text = read(root, file);
  if (text === null) throw new Error(`snippet: ${file} is missing`);
  const lines = text.split("\n");
  const i = lines.findIndex((l) => start.test(l));
  if (i < 0) throw new Error(`snippet: ${start} not found in ${file}`);
  let j = i + (count ?? 1) - 1;
  if (end) {
    j = lines.findIndex((l, k) => k > i && end.test(l));
    if (j < 0) throw new Error(`snippet: end ${end} not found in ${file}`);
  }
  const body = dedent(lines.slice(i, j + 1)).filter((l) => !skip.some((s) => s.test(l)));
  return { file, line: i + 1, code: body.join("\n").replace(/\s+$/, "") };
}

function tidy(s) {
  return { ...s, code: s.code.replace(/^(def .*\n)\n/, "$1") };
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Merkle root over task_done hashes, as integrity/merkle.py computes it. */
export function merkleRoot(hexLeaves) {
  if (!hexLeaves.length) return sha256Hex(Buffer.alloc(0));
  let level = hexLeaves.map((h) => Buffer.from(h, "hex"));
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]);
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(createHash("sha256").update(Buffer.concat([level[i], level[i + 1]])).digest());
    level = next;
  }
  return level[0].toString("hex");
}

function ledgers(root) {
  const dir = join(root, "runs");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const run of readdirSync(dir).sort()) {
    const text = read(root, `runs/${run}/ledger.jsonl`);
    if (!text || !/^pilot-/.test(run)) continue;
    const recs = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const done = recs.filter((r) => r.kind === "task_done");
    out.push({ run, records: recs.length, taskDone: done.length, merkleRoot: merkleRoot(done.map((r) => r.hash)) });
  }
  return out;
}

function lockVersion(lock, name) {
  if (!lock) return null;
  const m = new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock);
  return m ? m[1] : null;
}

function modelShort(id) {
  const m = /claude-([a-z]+)-(\d+)-(\d+)/.exec(id ?? "");
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

function git(root, cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function constant(root, file, name) {
  const t = read(root, file);
  const m = t && new RegExp(`^${name}\\s*=\\s*([0-9_]+)`, "m").exec(t);
  return m ? Number(m[1].replace(/_/g, "")) : null;
}

function progressLog(md) {
  const sec = sections(md);
  const phases = [];
  for (const line of (sec["_intro"] ?? "").split("\n")) {
    const c = line.replace(/^\||\|$/g, "").split("|").map((s) => s.trim());
    if (c.length >= 4 && /^\d+$/.test(c[0])) phases.push({ n: Number(c[0]), phase: c[1], status: c[2], evidence: c[3] });
  }
  const log = [];
  for (const line of (sec["Log"] ?? "").split("\n")) {
    const m = /^-\s+(\d{4}-\d{2}-\d{2}):\s+(.*)$/.exec(line);
    if (m) log.push({ date: m[1], text: m[2] });
  }
  return { phases, log };
}

function decisionList(md) {
  const sec = sections(md);
  return Object.entries(sec)
    .filter(([k]) => /^D\d+\./.test(k))
    .map(([k, body]) => {
      const m = /^(D\d+)\.\s+(.*)$/.exec(k);
      return { id: m[1], title: m[2], blocks: blocks(body) };
    });
}

function wranglerHost(root) {
  const t = read(root, "board/worker/wrangler.toml");
  const m = t && /pattern\s*=\s*"([^"]+)"/.exec(t);
  return m ? `https://${m[1]}` : "";
}

function isoSecond(t) {
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d+Z$/, "Z");
}

function tagTime(root, tag) {
  return isoSecond(git(root, `for-each-ref refs/tags/${tag} --format='%(creatordate:iso-strict)'`));
}

/**
 * The batches the board API serves by name, with what the repository says about each at build
 * time. A batch is finished when numbers.json holds its result; the API's own status field is
 * not used for that, because nothing posts a final status when a run stops.
 */
export function batchesFrom(root, numbers, hashes) {
  const sha = (file) => hashes.find((h) => h.file === file)?.sha256 ?? null;
  const meta = (run) => readJson(root, `runs/${run}/meta.json`);
  const ship1 = getPath(numbers, "exp1.decision.ship") ?? null;
  const ship2 = getPath(numbers, "exp2.decision.ship") ?? null;
  const rolloutN = getPath(numbers, "rollout.n") ?? null;
  const exp2Registered = !!sha("prereg/experiment-2.md");
  const m1 = meta("exp1");
  const mr = meta("rollout");
  const m2 = meta("exp2");
  const batches = [
    {
      id: "exp1",
      label: "Experiment 1",
      arms: ["control", "lanes_v1"],
      state: ship1 ? "final" : "open",
      ship: ship1,
      preregFile: "prereg/experiment-1.md",
      preregTag: "prereg-exp1",
      preregSha: sha("prereg/experiment-1.md"),
      registeredAt: tagTime(root, "prereg-exp1"),
      startedAt: isoSecond(m1?.started_at),
      flagsmithId: m1?.flagsmith_experiment_id ?? null,
    },
    {
      id: "rollout",
      label: "Rollout batch",
      arms: ship1 ? [ship1] : [],
      state: rolloutN ? "final" : "open",
      ship: null,
      preregFile: null,
      preregTag: null,
      preregSha: null,
      registeredAt: null,
      startedAt: isoSecond(mr?.started_at),
      flagsmithId: null,
    },
    {
      id: "exp2",
      label: "Experiment 2",
      arms: ["control", "lanes_v2"],
      state: ship2 ? "final" : exp2Registered ? "open" : "planned",
      ship: ship2,
      preregFile: "prereg/experiment-2.md",
      preregTag: "prereg-exp2",
      preregSha: sha("prereg/experiment-2.md"),
      registeredAt: exp2Registered ? tagTime(root, "prereg-exp2") : null,
      startedAt: isoSecond(m2?.started_at),
      flagsmithId: m2?.flagsmith_experiment_id ?? null,
    },
  ];
  // The batch the site reads live: the newest one that is registered and not finished.
  const newest = [...batches].reverse();
  const open = newest.find((b) => b.state === "open");
  return { batches, current: (open ?? newest.find((b) => b.state === "final" && b.id !== "rollout") ?? batches[0]).id };
}

export function loadRepoData(root = REPO_ROOT) {
  const keys = readJson(root, "board/web/src/data/keys.json") ?? [];
  const numbers = readJson(root, "analysis/out/numbers.json");
  const seed = readJson(root, "board/web/src/seed.json");
  let figures = figuresFrom(numbers, keys);
  let decisions = decisionsFrom(numbers);
  if (!Object.keys(figures).length && seed?.numbers?.length) {
    figures = Object.fromEntries(seed.numbers.map((n) => [n.key, n.text]));
    decisions = seed.decisions ?? {};
  }
  const hashes = (read(root, "prereg/HASHES.txt") ?? "")
    .split("\n")
    .map((l) => /^([0-9a-f]{64})\s+(\S+)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ sha256: m[1], file: m[2] }));

  const { batches, current } = batchesFrom(root, numbers, hashes);
  const prereg2Text = read(root, "prereg/experiment-2.md");
  const prereg2 = sections(prereg2Text);
  const hypothesis2 = (/<!-- hypothesis:start -->\s*([\s\S]*?)\s*<!-- hypothesis:end -->/.exec(prereg2Text ?? "") ?? [])[1] ?? "";

  const policies = {};
  for (const name of ["control", "lanes_v1", "lanes_v2"]) {
    const p = readJson(root, `flagsmith/policies/${name}.json`);
    if (p) policies[name] = { ...p, mainShort: modelShort(p.main.model), delegateShort: modelShort(p.delegate.model) };
  }
  const pricing = readJson(root, "harness/pricing.json");
  const manifestFull = readJson(root, "tasks/pools/manifest.json");
  const manifest = manifestFull && {
    seed: manifestFull.seed,
    stratum: manifestFull.params?.stratum,
    freshFrom: manifestFull.params?.fresh_from,
    preFrom: manifestFull.params?.pre_from,
    languages: manifestFull.params?.languages,
    revision: manifestFull.sources?.[0]?.revision,
    tiers: manifestFull.tiers,
    validationAppliedAt: manifestFull.validation_applied_at,
    pools: Object.fromEntries(
      Object.entries(manifestFull.pools ?? {}).map(([k, v]) => [
        k,
        { count: v.count, languages: Object.keys(v.by_language ?? {}).length, droppedInvalid: v.dropped_invalid ?? null, sha256: v.jsonl_sha256 },
      ]),
    ),
  };
  const exp1Body = readJson(root, "flagsmith/experiment-1.json");
  const split = exp1Body?.experiment_rollout?.multivariate_feature_state_values?.[0]?.percentage_allocation ?? null;
  const lock = read(root, "uv.lock");
  const compose = read(root, "selfhost/docker-compose.yml") ?? "";
  const img = (re) => (re.exec(compose) ?? [])[1] ?? null;
  const tsPkg = readJson(root, "kit/ts/package.json");

  const prereg = sections(read(root, "prereg/experiment-1.md"));
  const amend = sections(read(root, "prereg/experiment-1-amendment-1.md"));
  const hypothesis = (/<!-- hypothesis:start -->\s*([\s\S]*?)\s*<!-- hypothesis:end -->/.exec(read(root, "prereg/experiment-1.md") ?? "") ?? [])[1] ?? "";

  const S = (file, start, opts) => snippet(root, file, start, opts);
  const tsReadme = read(root, "kit/ts/README.md") ?? "";
  const tsUsage = (/## Usage\s+```ts\n([\s\S]*?)```/.exec(tsReadme) ?? [])[1]?.trimEnd() ?? "";

  const commit = process.env.GIT_COMMIT || git(root, "rev-parse HEAD");

  return {
    site: {
      url: process.env.SITE_URL || wranglerHost(root),
      repo: REPO_URL,
      commit,
      commitShort: commit.slice(0, 7),
    },
    figures,
    decisions,
    hasNumbers: !!numbers,
    batches,
    currentExperiment: current,
    numbers: numbers
      ? {
          generatedAt: numbers.generated_at ?? null,
          exp1: numbers.exp1 ?? null,
          exp2: numbers.exp2 ?? null,
          rollout: numbers.rollout ?? null,
          spend: numbers.spend ?? null,
          integrity: numbers.integrity ?? null,
        }
      : null,
    hypothesis2,
    prereg2: {
      start: blocks(prereg2["Where this starts"]),
      question: blocks(prereg2["Question"]),
      arms: blocks(prereg2["Arms"]),
      units: blocks(prereg2["Units and pool"]),
      decisionRule: blocks(prereg2["Decision rule"]),
      power: blocks(prereg2["Power"]),
      exclusions: blocks(prereg2["Exclusions"]),
      stopping: blocks(prereg2["Stopping"]),
      before: blocks(prereg2["Before the run"]),
    },
    power2: readJson(root, "analysis/out/power-exp2/power.json"),
    hashes,
    hypothesis,
    policies,
    pricing,
    ids: readJson(root, "flagsmith/ids.json"),
    metrics: readJson(root, "flagsmith/metrics.json")?.metrics ?? [],
    split,
    exp1Tasks: (read(root, "tasks/pools/exp1.txt") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    manifest,
    pilot: readJson(root, "analysis/out/pilot.json"),
    power: readJson(root, "analysis/out/power.json"),
    prereg: {
      question: blocks(prereg["Question"]),
      decisionRule: blocks(prereg["Decision rule"]),
      power: blocks(prereg["Power"]),
      exclusions: blocks(prereg["Exclusions"]),
      stopping: blocks(prereg["Stopping"]),
      after: blocks(prereg["After the decision"]),
      units: blocks(prereg["Units and pool"]),
      metrics: blocks(prereg["Metrics (Flagsmith)"]),
      seconds: blocks(prereg["Seconds"]),
    },
    amendment: {
      why: blocks(amend["Why"]),
      known: blocks(amend["What was known when this was written"]),
      change: blocks(amend["Change"]),
      power: blocks(amend["Power at the new size"]),
    },
    pilotReport: blocks(read(root, "prereg/pilot-report.md")?.split("\n").slice(1).join("\n")),
    decisionsLog: decisionList(read(root, "DECISIONS.md")),
    progress: progressLog(read(root, "PROGRESS.md")),
    ledgers: ledgers(root),
    harness: {
      delegateMaxTurns: constant(root, "harness/agent.py", "DELEGATE_MAX_TURNS"),
      viewMaxLines: constant(root, "harness/tools/defs.py", "VIEW_MAX_LINES"),
      delegateOutputBytes: constant(root, "harness/tools/defs.py", "OUTPUT_LIMIT_BYTES"),
    },
    versions: {
      flagEngine: lockVersion(lock, "flagsmith-flag-engine"),
      pythonSdk: lockVersion(lock, "flagsmith"),
      nodeSdk: tsPkg?.dependencies?.["@flagsmith/nodejs"]?.replace(/^\^/, "") ?? null,
      flagsmithImage: img(/flagsmith\/flagsmith:([0-9.]+)/),
      edgeProxy: img(/edge-proxy:([0-9.]+)/),
    },
    snippets: {
      assign: tidy(S("harness/policy.py", /^def assign\(/, { end: /return Assignment\(variant, policy, "experiment"\)/, skip: [/^\s*"""/, /^\s{4}(The kill|control policy|exposure was)/, /^\s*Called once/] })),
      events: S("harness/events.py", /sent: list\[tuple/, { end: /client\.flush_events\(\)/ }),
      experimentBody: S("flagsmith/experiment-1.json", /"metrics": \[/, { end: /^\s{2}\}$/ }),
      metricCost: S("flagsmith/metrics.json", /"name": "task_cost"/, { count: 7 }),
      start: S("flagsmith/start_experiment.sh", /^fs_api POST/),
      complete: S("flagsmith/smoke_test.sh", /experiments\/\$EXP_ID\/complete\//),
      engine: S("integrity/verify_assignment.py", /result = engine\.get_evaluation_result/, { count: 1 }),
      verifyUsage: S("integrity/verify_assignment.py", /^Usage: python -m integrity\.verify_assignment/),
      terraform: S("infra/flagsmith/main.tf", /^resource "flagsmith_feature" "agent_routing"/, { end: /^\}/ }),
      drift: S("infra/flagsmith/README.md", /^\{"drift":false/),
      webhook: S("board/worker/src/app.ts", /async function flagWebhook/, { end: /if \(!verdict\.ok\)/ }),
      health: S("runner/health.py", /^\s*python -m runner\.health runs\/exp1 --window/),
      modes: S("kit/forkbill/client.py", /^\| mode\s+\|/, { count: 6 }),
      openfeature: S("kit/forkbill/openfeature.py", /^\s+from flagsmith import Flagsmith/, { count: 4 }),
      selfhost: S("selfhost/README.md", /^selfhost\/bootstrap\.sh/, { count: 3 }),
      ledgerRule: S("integrity/canonical.py", /^def record_hash/, { count: 3 }),
      merkle: S("integrity/merkle.py", /^\s+level = list\(leaves\)/, { end: /return level\[0\]\.hex\(\)/ }),
      makeVerify: S("Makefile", /^verify:/, { count: 3 }),
      ciVerify: S(".github/workflows/ci.yml", /integrity\.verify_ledger "\$d"/, { count: 2 }),
      killFlag: S("infra/flagsmith/main.tf", /^resource "flagsmith_feature" "routing_kill"/, { end: /^\}/ }),
      policy: { file: "flagsmith/policies/lanes_v1.json", line: 1, code: JSON.stringify(readJson(root, "flagsmith/policies/lanes_v1.json"), null, 2) },
      demoLoop: S("kit/forkbill/demo.py", /^def fake_task/, { end: /return lanes\.finish/ }),
      tsUsage: { file: "kit/ts/README.md", line: 0, code: tsUsage },
      grading: S("runner/grading.py", /^Per instance, in a fresh container/, { end: /including its handling of truncated/ }),
      tools: S("harness/tools/defs.py", /^MAIN_TOOLS = /, { count: 3 }),
      forkbillInit: S("selfhost/demo.sh", /^INIT_ARGS=\(init --control/, { count: 2 }),
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const d = loadRepoData();
  console.log(JSON.stringify(process.argv[2] ? getPath(d, process.argv[2]) : Object.keys(d), null, 2));
}
