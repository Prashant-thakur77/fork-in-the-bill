#!/usr/bin/env node
// Sends one signed test snapshot to a board worker.
//   BOARD_INGEST_SECRET=... node scripts/sign.mjs [url] [payload.json]
// Defaults: url http://localhost:8787/ingest, a small built-in test payload.
// Add --replay to send the same signed request twice (the second must be rejected with 409).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const replay = process.argv.includes("--replay");
const url = args[0] ?? "http://localhost:8787/ingest";
const secret = process.env.BOARD_INGEST_SECRET;
if (!secret) {
  console.error("Set BOARD_INGEST_SECRET");
  process.exit(2);
}
const ts = Math.floor(Date.now() / 1000);
const payload = args[1]
  ? JSON.parse(readFileSync(args[1], "utf8"))
  : {
      experiment: "dryrun",
      ts,
      status: "running",
      flagsmith_experiment_url: "",
      arms: {
        control: { done: 1, solved: 1, usd: 0.5, running: 0 },
        lanes_v1: { done: 1, solved: 0, usd: 0.2, running: 1 },
      },
      last_task: { variant: "lanes_v1", usd: 0.2, solved: false, language: "python" },
    };
payload.ts ??= ts;
const body = JSON.stringify(payload);
const signature = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
const send = () =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-FB-Timestamp": String(ts), "X-FB-Signature": signature },
    body,
  });
for (let i = 0; i < (replay ? 2 : 1); i++) {
  const res = await send();
  console.log(res.status, await res.text());
}
