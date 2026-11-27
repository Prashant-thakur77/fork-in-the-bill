import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ENVIRONMENT_FILE, FakeFlagsmith, identityFor, KEY, resourceText, testEnv } from "./fake-flagsmith.js";

// dist/test/ -> dist/src/cli.js, the file the package's `bin` points at
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

test("the built server over stdio: list the tools, run a task through them against a local HTTP fake", async () => {
  const fake = new FakeFlagsmith();
  const http = await fake.listen();
  // The child gets this environment and nothing else: no variable of the parent can leak in.
  const env = { ...testEnv({ FORKBILL_LOG_LEVEL: "debug" }, http.origin), PATH: process.env["PATH"] ?? "" };
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI], env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const client = new Client({ name: "forkbill-mcp-e2e", version: "0.0.0" });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "forkbill-mcp");
    assert.match(client.getServerVersion()?.version ?? "", /^\d+\.\d+\.\d+$/);

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["explain_assignment", "get_kill_switch", "get_routing_policy", "price_usage", "report_outcome"]);

    const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      return result.structuredContent as Record<string, any>;
    };

    const kill = await call("get_kill_switch");
    assert.equal(kill["enabled"], false);

    const identity = identityFor("lanes_v1");
    const policy = await call("get_routing_policy", { identity, traits: { language: "go" } });
    assert.equal(policy["variant"], "lanes_v1");
    assert.equal(policy["exposure_recorded"], true);
    assert.equal(policy["policy"].main.model, "claude-sonnet-5-5");
    assert.equal(policy["policy"].delegate.model, "claude-haiku-5-5");

    const price = await call("price_usage", {
      identity,
      calls: [
        { lane: "main", input_tokens: 20_000, output_tokens: 2_000 },
        { lane: "delegate", input_tokens: 150_000, output_tokens: 6_000 },
      ],
    });
    assert.equal(price["total_usd"], 0.078);
    assert.equal(price["over_budget"], false);

    const outcome = await call("report_outcome", { identity, cost_usd: price["total_usd"], solved: true, turns: 5, seconds: 61.5 });
    assert.equal(outcome["delivered"], true);
    assert.deepEqual(outcome["events"], [
      { event: "task_cost", value: 0.078 },
      { event: "task_solved", value: 1 },
      { event: "task_turns", value: 5 },
      { event: "task_seconds", value: 61.5 },
    ]);

    const explained = await call("explain_assignment", { identity, environment_document_path: ENVIRONMENT_FILE });
    assert.equal(explained["variant"], "lanes_v1");
    assert.equal(explained["agree"], true);
    assert.equal(explained["matches_session"], true);

    const config = JSON.parse(resourceText(await client.readResource({ uri: "forkbill://config" })));
    assert.equal(config.flags_api, `${http.origin}/api/v1/`);

    // What the fake Flagsmith received over real HTTP: flag reads, one exposure, four events.
    assert.deepEqual(fake.paths(), [
      "GET /api/v1/flags/",
      "POST /api/v1/identities/",
      "POST /api/v1/identities/",
      ...Array(5).fill("POST /api/v1/events"),
    ]);
    assert.deepEqual(
      fake.events().map((e) => [e.event, e.identifier, e.value]),
      [
        ["$flag_exposure", identity, "lanes_v1"],
        ["task_cost", identity, "0.078"],
        ["task_solved", identity, "1"],
        ["task_turns", identity, "5"],
        ["task_seconds", identity, "61.5"],
      ],
    );
    for (const r of fake.requests) assert.equal(r.key, KEY);

    // A Flagsmith failure crosses the wire as a tool error, not as a policy.
    fake.options = { flagsStatus: 502 };
    const failed = await client.callTool({ name: "get_routing_policy", arguments: { identity: identityFor("control") } });
    assert.equal(failed.isError, true);
    assert.match(JSON.stringify(failed.content), /Response status code: 502/);
    assert.equal(failed.structuredContent, undefined);
  } finally {
    await client.close();
    await http.close();
  }
  assert.ok(!stderr.includes(KEY), "the key must never be logged");
  assert.match(stderr, /Flagsmith did not serve a routing policy/, "failures are logged to stderr");
});

test("--help prints the environment variables to stderr and leaves stdout to the protocol", async () => {
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync(process.execPath, [CLI, "--help"], { env: { PATH: process.env["PATH"] ?? "" }, encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
  for (const name of ["FLAGSMITH_SERVER_KEY", "FLAGSMITH_SDK_API_URL", "FLAGSMITH_EVENTS_API_URL", "FORKBILL_MODE"]) {
    assert.ok(run.stderr.includes(name), name);
  }
});
