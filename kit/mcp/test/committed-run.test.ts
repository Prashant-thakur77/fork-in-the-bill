import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createForkbillServer } from "../src/index.js";
import { REPO_ROOT } from "./fake-flagsmith.js";

test("explain_assignment re-derives every arm recorded in the committed experiment, offline", async (t) => {
  const run = join(REPO_ROOT, "runs", "exp1");
  if (!existsSync(join(run, "tasks.jsonl"))) return t.skip("runs/exp1 is not in this checkout");
  const records = readFileSync(join(run, "tasks.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { identity: string; variant: string; flag_source: string; traits?: Record<string, string | number> })
    .filter((rec) => rec.flag_source === "experiment");
  assert.ok(records.length > 100);

  // No key and no fetch that works: the tool has to do this without Flagsmith.
  const app = createForkbillServer({
    env: { FORKBILL_LOG_LEVEL: "silent" },
    fetch: async () => {
      throw new Error("explain_assignment must not make a request");
    },
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "forkbill-mcp-tests", version: "0.0.0" });
  await Promise.all([app.server.connect(serverSide), client.connect(clientSide)]);
  const snapshot = join(run, "env", "000-start.json");
  const counts: Record<string, number> = {};
  for (const rec of records) {
    const result = await client.callTool({
      name: "explain_assignment",
      arguments: {
        identity: rec.identity,
        environment_document_path: snapshot,
        traits: rec.traits ?? {},
        expected_variant: rec.variant,
      },
    });
    assert.notEqual(result.isError, true, rec.identity);
    const data = result.structuredContent as Record<string, any>;
    assert.equal(data["matches_expected"], true, rec.identity);
    assert.equal(data["agree"], true, rec.identity);
    assert.equal(data["in_experiment"], true, rec.identity);
    assert.equal(data["policy"].policy, rec.variant, rec.identity);
    counts[rec.variant] = (counts[rec.variant] ?? 0) + 1;
  }
  assert.deepEqual(Object.keys(counts).sort(), ["control", "lanes_v1"]);
  await client.close();
  await app.close();
});
