// Re-derive every identity's arm from a saved environment document with the published kit's
// `explainAssignment`, and compare it with the arm the run recorded. No network, no key.
//
//   node verify.ts <run directory> [environment document]
//
// The run directory holds tasks.jsonl (one JSON object per task with `identity`, `variant` and
// `flag_source`) and env/*.json. Exits 1 when any recorded arm differs from the re-derived one.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { explainAssignment } from "forkbill";

const [runDir, documentArg] = process.argv.slice(2);
if (!runDir) throw new Error("usage: node verify.ts <run directory> [environment document]");
const documentPath = documentArg ?? join(runDir, "env", readdirSync(join(runDir, "env")).sort()[0] ?? "");
const document: unknown = JSON.parse(readFileSync(documentPath, "utf8"));

interface Task {
  identity: string;
  variant: string | null;
  flag_source: string;
}
const tasks: Task[] = readFileSync(join(runDir, "tasks.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as Task)
  .filter((task) => task.flag_source === "experiment");

const pct = (n: number): string => n.toFixed(4).padStart(7);
let matched = 0;
const mismatched: string[] = [];
tasks.forEach((task, i) => {
  const w = explainAssignment(document, task.identity, "agent_routing");
  const ok = w.variant === task.variant;
  if (ok) matched += 1;
  else mismatched.push(`${task.identity}: recorded ${task.variant}, re-derived ${w.variant}`);
  if (i < 5) {
    // The working for the first few: the segment check, then the split inside the segment.
    const segment = w.segments.find((s) => s.matched);
    const check = segment?.conditions[0];
    const range = w.split?.ranges.find((r) => r.matched);
    console.log(
      `${task.identity}  segment ${segment?.name ?? "none"}: md5 ${check?.hash.md5.slice(0, 12)}.. -> ${pct(check?.hash.percentage ?? NaN)} <= ${check?.threshold}` +
        `  split: md5 ${w.split?.hash.md5.slice(0, 12)}.. -> ${pct(w.split?.hash.percentage ?? NaN)} in ${range?.variant} [${range?.start}, ${range?.end})` +
        `  recorded ${task.variant}  ${ok ? "ok" : "MISMATCH"}`,
    );
  }
});
if (tasks.length > 5) console.log(`... ${tasks.length - 5} more`);
console.log(`explainAssignment (forkbill, TypeScript): ${matched} of ${tasks.length} recorded arms re-derived from ${documentPath}`);
if (mismatched.length > 0) {
  console.log(`mismatched: ${mismatched.length}`);
  for (const line of mismatched.slice(0, 5)) console.log(`  ${line}`);
  if (mismatched.length > 5) console.log(`  ... ${mismatched.length - 5} more`);
  process.exit(1);
}
