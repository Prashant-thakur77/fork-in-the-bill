#!/usr/bin/env node
// Writes src/seed.json from analysis/out/numbers.json.
//   node scripts/fill-seed.mjs [path/to/numbers.json] [flagsmith_experiment_url]
// Every figure is stored as {key, fmt, text} so analysis/check_consistency.py can verify it.
// Keys missing from numbers.json are skipped, never invented.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const numbersPath = resolve(process.argv[2] ?? resolve(here, "../../../analysis/out/numbers.json"));
const url = process.argv[3] ?? "";
const keys = JSON.parse(readFileSync(resolve(here, "../src/data/keys.json"), "utf8"));
const numbers = JSON.parse(readFileSync(numbersPath, "utf8"));

const MINUS = "−";
const sign = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
// Must match src/data/format.ts and analysis/render_docs.py.
function format(value, fmt) {
  if (fmt === "hash12") return String(value).slice(0, 12);
  const v = Number(value);
  switch (fmt) {
    case "usd2":
      return `${v < 0 ? MINUS : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "usd4":
      return `${v < 0 ? MINUS : ""}$${Math.abs(v).toFixed(4)}`;
    case "pct1":
      return `${sign(v)}${Math.abs(v).toFixed(1)}%`;
    case "pp1":
      return `${sign(v)}${Math.abs(v).toFixed(1)} pp`;
    case "int":
      return Math.round(v).toLocaleString("en-US");
    case "f3":
      return v.toFixed(3);
    case "prob1":
      return `${(v * 100).toFixed(1)}%`;
    default:
      throw new Error(`unknown fmt ${fmt}`);
  }
}

const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

const entries = [];
for (const { key, fmt } of keys) {
  const v = get(numbers, key);
  if (v === undefined || v === null || v === "...") continue;
  entries.push({ key, fmt, text: format(v, fmt) });
}
const decisions = {};
for (const k of ["exp1.decision.ship", "exp2.decision.ship"]) {
  const v = get(numbers, k);
  if (typeof v === "string" && /^[a-z0-9_]+$/.test(v)) decisions[k] = v;
}
for (const exp of ["exp1", "exp2"]) {
  const met = get(numbers, `${exp}.decision.rule_met`) ?? {};
  for (const [k, v] of Object.entries(met)) if (typeof v === "boolean") decisions[`${exp}.decision.rule_met.${k}`] = String(v);
}
const seed = {
  status: decisions["exp1.decision.ship"] ? "final" : "awaiting_run",
  experiment: "exp1",
  flagsmith_experiment_url: url,
  decisions,
  numbers: entries,
};
writeFileSync(resolve(here, "../src/seed.json"), JSON.stringify(seed, null, 2) + "\n");
console.log(`seed.json: ${seed.status}, ${entries.length} figures`);
