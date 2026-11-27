// How big the project is, counted from the repository when the site is built. Nothing here is
// typed in: every figure is a count of lines, records, files or tags that anyone can repeat.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const lines = (text) => text.split("\n").filter((l) => l.trim() !== "");
const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()) : []);
const files = (p, re) => (existsSync(p) ? readdirSync(p).filter((f) => re.test(f)) : []);

/** Lines in a file that may be large, without building a string of it. */
function countLines(p) {
  if (!existsSync(p)) return 0;
  const buf = readFileSync(p);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return n + (buf.length > 0 && buf[buf.length - 1] !== 10 ? 1 : 0);
}

function sh(root, cmd) {
  try {
    return execSync(cmd, { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch {
    return "";
  }
}

export function groupOf(run) {
  if (/^pilot-/.test(run)) return "pilot";
  if (/^dryrun/.test(run)) return "dryrun";
  return run; // exp1, rollout, exp2
}

const GROUP_LABEL = { pilot: "Pilot", dryrun: "Dry runs", exp1: "Experiment 1", rollout: "Rollout batch", exp2: "Experiment 2" };
const GROUP_ORDER = ["dryrun", "pilot", "exp1", "rollout", "exp2"];

/** One run directory: what its own files hold. */
export function runStats(root, run) {
  const dir = join(root, "runs", run);
  const out = { run, group: groupOf(run), attempts: 0, tasks: 0, solved: 0, tests: 0, calls: 0, tokens: 0, usd: 0, ledger: 0, envSnapshots: 0, transcripts: 0, events: 0, languages: [], repos: [] };
  const ids = new Set();
  const langs = new Set();
  const repos = new Set();
  for (const l of lines(read(join(dir, "tasks.jsonl")))) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    out.attempts += 1;
    ids.add(r.instance_id);
    if (r.solved === true) out.solved += 1;
    // every entry is one test the grader ran in a fresh container and read the result of
    if (r.tests && typeof r.tests === "object") out.tests += Object.keys(r.tests).length;
    if (r.traits?.language) langs.add(r.traits.language);
    if (r.traits?.repo) repos.add(r.traits.repo);
    if (typeof r.usd === "number") out.usd += r.usd;
  }
  // a task record is one graded task; an attempt cut off before its record was written is not here
  out.tasks = out.attempts;
  out.ids = [...ids];
  out.languages = [...langs].sort();
  out.repos = [...repos].sort();
  for (const l of lines(read(join(dir, "calls.jsonl")))) {
    let c;
    try {
      c = JSON.parse(l);
    } catch {
      continue;
    }
    out.calls += 1;
    out.tokens += (c.input_tokens ?? 0) + (c.cache_write_5m_tokens ?? 0) + (c.cache_write_1h_tokens ?? 0) + (c.cache_read_tokens ?? 0) + (c.output_tokens ?? 0);
  }
  out.ledger = countLines(join(dir, "ledger.jsonl"));
  out.events = countLines(join(dir, "events.jsonl"));
  out.envSnapshots = files(join(dir, "env"), /\.json$/).length;
  out.transcripts = files(join(dir, "transcripts"), /\.json$/).length;
  return out;
}

const LANGS = [
  ["Python", /\.py$/],
  ["TypeScript", /\.(ts|tsx|mts)$/],
  ["JavaScript", /\.(mjs|js|cjs)$/],
  ["CSS", /\.css$/],
  ["Shell", /\.sh$/],
  ["Terraform", /\.tf$/],
  ["SQL", /\.sql$/],
  ["YAML", /\.(yml|yaml)$/],
  ["Markdown", /\.md$/],
];
// Data, generated output and lock files are not code.
const NOT_CODE = /^(runs\/|analysis\/out\/|analysis\/flagsmith\/|tasks\/pools\/|examples\/transcripts\/|examples\/[^/]+\/output\/|examples\/output\/|docs\/img\/|tests\/fixtures\/)|(^|\/)(package-lock\.json|uv\.lock)$|\.min\./;

/** Lines per language over the files git tracks, leaving out data, generated output and lock files. */
export function codeStats(root) {
  const tracked = sh(root, "git ls-files").split("\n").filter(Boolean);
  const by = new Map(LANGS.map(([l]) => [l, { lang: l, files: 0, lines: 0 }]));
  for (const f of tracked) {
    if (NOT_CODE.test(f)) continue;
    const lang = LANGS.find(([, re]) => re.test(f));
    if (!lang) continue;
    const p = join(root, f);
    if (!existsSync(p) || statSync(p).size > 2 * 1024 * 1024) continue;
    const row = by.get(lang[0]);
    row.files += 1;
    row.lines += countLines(p);
  }
  const byLang = [...by.values()].filter((r) => r.files > 0).sort((a, b) => b.lines - a.lines);
  return { byLang, files: byLang.reduce((n, r) => n + r.files, 0), lines: byLang.reduce((n, r) => n + r.lines, 0), tracked: tracked.length };
}

/** Test functions written in the repository: `def test_` in Python, `it(` or `test(` in TypeScript. */
export function testStats(root) {
  const tracked = sh(root, "git ls-files").split("\n").filter(Boolean);
  const py = tracked.filter((f) => /(^|\/)tests?\/.*\.py$/.test(f) || /(^|\/)test_[^/]*\.py$/.test(f));
  const ts = tracked.filter((f) => /\.test\.(ts|tsx|mts|mjs|js)$/.test(f));
  const count = (list, re) => list.reduce((n, f) => n + (read(join(root, f)).match(re) ?? []).length, 0);
  return {
    python: count(py, /^\s*(?:async\s+)?def test_/gm),
    pythonFiles: py.filter((f) => /^\s*(?:async\s+)?def test_/m.test(read(join(root, f)))).length,
    typescript: count(ts, /^\s*(?:it|test)(?:\.each\([^)]*\))?\(\s*["'`]/gm),
    typescriptFiles: ts.length,
  };
}

/** Job names per workflow file: the keys directly under `jobs:`. */
export function ciStats(root) {
  const dir = join(root, ".github/workflows");
  const out = [];
  for (const f of files(dir, /\.ya?ml$/)) {
    const text = read(join(dir, f));
    const at = text.search(/^jobs:\s*$/m);
    const jobs = at < 0 ? [] : [...text.slice(at).matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
    out.push({ file: `.github/workflows/${f}`, jobs });
  }
  return out;
}

export function scaleFrom(root) {
  const runs = dirs(join(root, "runs")).sort().map((r) => runStats(root, r));
  const groups = GROUP_ORDER.map((key) => {
    const rs = runs.filter((r) => r.group === key);
    const sum = (k) => rs.reduce((n, r) => n + r[k], 0);
    return {
      key,
      label: GROUP_LABEL[key] ?? key,
      runs: rs.map((r) => r.run),
      attempts: sum("attempts"),
      tasks: sum("tasks"),
      solved: sum("solved"),
      tests: sum("tests"),
      calls: sum("calls"),
      tokens: sum("tokens"),
      ledger: sum("ledger"),
      transcripts: sum("transcripts"),
      events: sum("events"),
      envSnapshots: sum("envSnapshots"),
    };
  }).filter((g) => g.runs.length > 0);
  const total = (k) => runs.reduce((n, r) => n + r[k], 0);
  const languages = [...new Set(runs.flatMap((r) => r.languages))].sort();
  const repos = new Set(runs.flatMap((r) => r.repos));
  const distinct = new Set(runs.flatMap((r) => r.ids));
  const tags = sh(root, "git tag --list").split("\n").filter(Boolean);
  const examples = dirs(join(root, "examples")).filter((d) => /^\d\d-/.test(d)).sort();
  const packages = ["kit/ts", "kit/mcp"]
    .map((p) => {
      try {
        const j = JSON.parse(read(join(root, p, "package.json")));
        return j.private === true ? null : { name: j.name, version: j.version, dir: p };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return {
    runs: runs.map(({ languages: _l, repos: _r, ids: _i, ...rest }) => rest),
    groups,
    totals: {
      runs: runs.length,
      attempts: total("attempts"),
      tasks: total("tasks"),
      distinctTasks: distinct.size,
      solved: total("solved"),
      tests: total("tests"),
      calls: total("calls"),
      tokens: total("tokens"),
      ledger: total("ledger"),
      events: total("events"),
      envSnapshots: total("envSnapshots"),
      transcripts: total("transcripts"),
      languages,
      repos: repos.size,
    },
    code: codeStats(root),
    tests: testStats(root),
    ci: ciStats(root),
    examples,
    packages,
    tags: { prereg: tags.filter((t) => /^prereg-/.test(t)).sort(), releases: tags.filter((t) => /^v\d/.test(t)).sort() },
  };
}

// numbers.json key -> where it lands in the counts above. When the analysis has written a `scale`
// block, its values replace the site's own counts, so the site, the paper and the film agree.
// Definitions are in docs/interfaces.md: tasks_run counts task records in the ledgers,
// task_attempts counts (task, attempt) pairs with a record or a transcript.
const FROM_NUMBERS = {
  tasks_run: "tasks",
  task_attempts: "attempts",
  tests_executed: "tests",
  model_calls: "calls",
  tokens: "tokens",
  ledger_records: "ledger",
  events_sent: "events",
  env_snapshots: "envSnapshots",
  transcripts: "transcripts",
  repos: "repos",
};
const size = (v) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : null);

/**
 * Overlays the `scale` block of numbers.json on the counts made here. `fromNumbers` lists the
 * figures that came from that file; the rest were counted by this script.
 */
export function withNumbersScale(scale, block) {
  const out = { ...scale, totals: { ...scale.totals }, groups: scale.groups.map((g) => ({ ...g })), tests: { ...scale.tests }, fromNumbers: [] };
  out.totals.languageCount = scale.totals.languages.length;
  out.packageCount = scale.packages.length;
  out.exampleCount = scale.examples.length;
  out.preregCount = scale.tags.prereg.length;
  out.testsByResult = null;
  out.tokensByKind = null;
  if (!block || typeof block !== "object") return out;
  for (const [key, field] of Object.entries(FROM_NUMBERS)) {
    if (typeof block[key] === "number" && Number.isFinite(block[key])) {
      out.totals[field] = block[key];
      out.fromNumbers.push(field);
    }
  }
  const langs = size(block.languages);
  if (langs !== null) {
    out.totals.languageCount = langs;
    if (Array.isArray(block.languages)) out.totals.languages = [...block.languages].map(String).sort();
    else if (langs !== scale.totals.languages.length) out.totals.languages = [];
    out.fromNumbers.push("languages");
  }
  for (const [key, field] of [
    ["npm_packages", "packageCount"],
    ["examples", "exampleCount"],
    ["prereg_tags", "preregCount"],
  ]) {
    const v = size(block[key]);
    if (v !== null) {
      out[field] = v;
      out.fromNumbers.push(field);
    }
  }
  if (typeof block.unit_tests_python === "number" && typeof block.unit_tests_ts === "number") {
    out.tests.python = block.unit_tests_python;
    out.tests.typescript = block.unit_tests_ts;
    out.fromNumbers.push("unitTests");
  }
  for (const [key, field, name] of [
    ["tasks_by_batch", "tasks", "tasksByBatch"],
    ["task_attempts_by_batch", "attempts", "attemptsByBatch"],
    ["tests_executed_by_batch", "tests", "testsByBatch"],
  ]) {
    const per = block[key];
    if (!per || typeof per !== "object") continue;
    for (const g of out.groups) {
      const vals = g.runs.map((r) => per[r]).filter((v) => typeof v === "number");
      if (vals.length === g.runs.length && vals.length > 0) g[field] = vals.reduce((a, b) => a + b, 0);
    }
    out.fromNumbers.push(name);
  }
  const counts = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number")) : null);
  out.testsByResult = counts(block.tests_by_result);
  out.tokensByKind = counts(block.tokens_by_kind);
  return out;
}
