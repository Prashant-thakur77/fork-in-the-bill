import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parsePolicy, type RoutingPolicy } from "forkbill";

import { createForkbillServer } from "../src/index.js";
import {
  DOCUMENT,
  ENVIRONMENT_FILE,
  FakeFlagsmith,
  identityFor,
  KEY,
  REPO_ROOT,
  resourceText,
  testEnv,
  VECTORS,
  type FakeOptions,
} from "./fake-flagsmith.js";

const policyFile = (name: string): RoutingPolicy =>
  parsePolicy(readFileSync(join(REPO_ROOT, "flagsmith", "policies", `${name}.json`), "utf8"));
const CONTROL = policyFile("control");
const LANES_V1 = policyFile("lanes_v1");
const LANES_V2 = policyFile("lanes_v2");

interface Called {
  isError: boolean;
  data: Record<string, any>;
  text: string;
}

interface Harness {
  fake: FakeFlagsmith;
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<Called>;
  stop(): Promise<void>;
}

const everything: string[] = [];

/** A server wired to the fake through `fetch`, and a client talking to it in process. */
async function start(fakeOptions: FakeOptions = {}, env: Record<string, string> | null = null): Promise<Harness> {
  const fake = new FakeFlagsmith(fakeOptions);
  const app = createForkbillServer({ env: env ?? testEnv(), fetch: fake.fetch });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "forkbill-mcp-tests", version: "0.0.0" });
  await Promise.all([app.server.connect(serverSide), client.connect(clientSide)]);
  await client.listTools();
  return {
    fake,
    client,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
      everything.push(text, JSON.stringify(result.structuredContent ?? null));
      return { isError: result.isError === true, data: (result.structuredContent ?? {}) as Record<string, any>, text };
    },
    async stop() {
      await client.close();
      await app.close();
      // Every request the server made went to the fake, with the configured key.
      for (const r of fake.requests) assert.equal(r.key, KEY, `${r.method} ${r.path}`);
    },
  };
}

test("the server lists its tools, resources and prompt", async () => {
  const h = await start();
  const tools = (await h.client.listTools()).tools;
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["explain_assignment", "get_kill_switch", "get_routing_policy", "price_usage", "report_outcome"],
  );
  for (const tool of tools) {
    assert.ok((tool.description ?? "").length > 80, tool.name);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.outputSchema?.type, "object", tool.name);
  }
  const routing = tools.find((t) => t.name === "get_routing_policy");
  assert.deepEqual(routing?.inputSchema.required, ["identity"]);
  assert.deepEqual(Object.keys(routing?.inputSchema.properties ?? {}), ["identity", "traits", "fallback_policy"]);
  const report = tools.find((t) => t.name === "report_outcome");
  assert.deepEqual(report?.inputSchema.required, ["identity", "cost_usd", "solved", "turns", "seconds"]);
  assert.equal(tools.find((t) => t.name === "get_kill_switch")?.annotations?.readOnlyHint, true);

  assert.deepEqual(
    (await h.client.listResources()).resources.map((r) => r.uri).sort(),
    ["forkbill://config", "forkbill://pricing", "forkbill://routing-policy"],
  );
  assert.deepEqual((await h.client.listPrompts()).prompts.map((p) => p.name), ["route_behind_experiment"]);
  assert.match(h.client.getInstructions() ?? "", /Flagsmith chooses the arm/);
  assert.deepEqual(h.fake.requests, [], "listing must not touch Flagsmith");
  await h.stop();
});

test("get_routing_policy: Flagsmith's arm, its policy, and the exposure", async () => {
  const h = await start();
  const cases: Array<["control" | "lanes_v1" | "lanes_v2", RoutingPolicy]> = [
    ["lanes_v1", LANES_V1],
    ["control", CONTROL],
    ["lanes_v2", LANES_V2],
  ];
  for (const [variant, policy] of cases) {
    const identity = identityFor(variant);
    const r = await h.call("get_routing_policy", { identity, traits: { repo: "acme/widgets", gold_files: 2 } });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data["variant"], variant);
    assert.equal(r.data["source"], "experiment");
    assert.equal(r.data["from_experiment"], true);
    assert.equal(r.data["exposure_recorded"], true);
    assert.equal(r.data["reused"], false);
    assert.deepEqual(r.data["policy"], policy);
    assert.equal(r.data["policy"].delegate.model, policy.delegate.model);
    assert.equal(r.data["fail_reason"], null);
  }
  // Per identity, as the kit does it: the kill switch read, the experiment read, the exposure.
  assert.deepEqual(h.fake.paths(), Array(3).fill(["POST /api/v1/identities/", "POST /api/v1/identities/", "POST /api/v1/events"]).flat());
  assert.deepEqual(
    h.fake.events().map((e) => [e.event, e.feature_name, e.identifier, e.value]),
    cases.map(([variant]) => ["$flag_exposure", "agent_routing", identityFor(variant), variant]),
  );
  assert.deepEqual(h.fake.events()[0]?.traits, { repo: "acme/widgets", gold_files: 2 });
  assert.deepEqual(h.fake.requests[0]?.body.traits, [
    { trait_key: "repo", trait_value: "acme/widgets" },
    { trait_key: "gold_files", trait_value: 2 },
  ]);
  await h.stop();
});

test("get_routing_policy serves every fixture identity the arm Python and Flagsmith's engine derive", async () => {
  const h = await start();
  for (const v of VECTORS) {
    const r = await h.call("get_routing_policy", { identity: v.identity });
    assert.equal(r.data["variant"], v.engine_variant, v.identity);
    assert.equal(r.data["from_experiment"], v.in_rollout, v.identity);
    assert.equal(r.data["policy"].policy, v.engine_variant, v.identity);
  }
  assert.equal(h.fake.events().length, VECTORS.filter((v) => v.in_rollout).length);
  await h.stop();
});

test("get_routing_policy is asked once per identity", async () => {
  const h = await start();
  const identity = identityFor("lanes_v1");
  const first = await h.call("get_routing_policy", { identity });
  const before = h.fake.requests.length;
  const again = await h.call("get_routing_policy", { identity });
  assert.equal(again.data["reused"], true);
  assert.equal(again.data["variant"], first.data["variant"]);
  assert.deepEqual(again.data["policy"], first.data["policy"]);
  assert.match(again.data["note"], /Already assigned in this session/);
  assert.equal(h.fake.requests.length, before, "no second read and no second exposure");
  await h.stop();
});

test("two calls at once for one task ask Flagsmith once", async () => {
  const h = await start();
  const identity = identityFor("lanes_v2");
  const [a, b] = await Promise.all([
    h.call("get_routing_policy", { identity }),
    h.call("get_routing_policy", { identity }),
  ]);
  assert.deepEqual([a.data["reused"], b.data["reused"]].sort(), [false, true]);
  assert.equal(a.data["variant"], "lanes_v2");
  assert.equal(b.data["variant"], "lanes_v2");
  assert.equal(h.fake.events().length, 1);
  const outcome = { identity, cost_usd: 0.1, solved: true, turns: 1, seconds: 1 };
  const reports = await Promise.all([h.call("report_outcome", outcome), h.call("report_outcome", outcome)]);
  assert.deepEqual(reports.map((r) => r.isError).sort(), [false, true]);
  assert.equal(h.fake.events().length, 5);
  await h.stop();
});

test("edge mode: the proxy's value is served, with no exposure and a note that says why", async () => {
  const h = await start({ edgeProxy: true }, testEnv({ FORKBILL_MODE: "edge", FLAGSMITH_EDGE_API_URL: "http://flagsmith.test/api/v1/" }));
  const identity = identityFor("lanes_v1");
  const r = await h.call("get_routing_policy", { identity });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data["source"], "flag");
  assert.equal(r.data["variant"], null);
  assert.equal(r.data["exposure_recorded"], false);
  assert.equal(r.data["policy"].policy, "lanes_v1");
  assert.match(r.data["note"], /Edge Proxy identity response carries no variant or experiment.*FORKBILL_MODE=edge-local/);
  assert.deepEqual(h.fake.events(), []);
  await h.stop();
});

test("outside the rollout: the flag's value, no exposure, and report_outcome sends nothing", async () => {
  const h = await start();
  const identity = identityFor("outside");
  const r = await h.call("get_routing_policy", { identity });
  assert.equal(r.data["source"], "flag");
  assert.equal(r.data["from_experiment"], false);
  assert.equal(r.data["exposure_recorded"], false);
  assert.deepEqual(r.data["policy"], CONTROL);
  const out = await h.call("report_outcome", { identity, cost_usd: 0.1, solved: true, turns: 3, seconds: 9 });
  assert.equal(out.isError, false);
  assert.equal(out.data["delivered"], false);
  assert.deepEqual(out.data["events"], []);
  assert.match(out.data["note"], /was not exposed to an experiment \(source: flag\)/);
  assert.deepEqual(h.fake.events(), []);
  await h.stop();
});

test("a Flagsmith error is the tool error: no arm, no substitute, no exposure", async () => {
  const h = await start({ flagsStatus: 403 });
  const identity = identityFor("lanes_v1");
  const r = await h.call("get_routing_policy", { identity });
  assert.equal(r.isError, true);
  assert.match(r.text, /Flagsmith did not serve a routing policy/);
  assert.match(r.text, /kill switch "routing_kill" unreadable/);
  assert.match(r.text, /Invalid request made to Flagsmith API\. Response status code: 403/);
  assert.match(r.text, /No arm was chosen and no policy was substituted/);
  assert.ok(!r.text.includes("claude-"), "an error must not carry a model to run");
  assert.deepEqual(h.fake.paths(), ["POST /api/v1/identities/"]);

  // Nothing was remembered: once Flagsmith answers, the identity is assigned normally.
  h.fake.options = {};
  const retry = await h.call("get_routing_policy", { identity });
  assert.equal(retry.isError, false);
  assert.equal(retry.data["variant"], "lanes_v1");
  assert.equal(retry.data["reused"], false);
  await h.stop();
});

test("fallback_policy is used only when passed, and the result says so", async () => {
  const h = await start({ flagsStatus: 503 });
  const identity = identityFor("lanes_v1");
  const fallback = structuredClone(CONTROL) as Record<string, any>;
  fallback["policy"] = "my_fallback";
  const r = await h.call("get_routing_policy", { identity, fallback_policy: fallback });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data["source"], "fail_closed");
  assert.equal(r.data["policy"].policy, "my_fallback");
  assert.equal(r.data["variant"], null);
  assert.equal(r.data["from_experiment"], false);
  assert.equal(r.data["exposure_recorded"], false);
  assert.match(r.data["fail_reason"], /unreadable/);
  assert.match(r.data["note"], /this is the fallback_policy you passed/);
  assert.deepEqual(h.fake.events(), []);
  const out = await h.call("report_outcome", { identity, cost_usd: 0.1, solved: false, turns: 1, seconds: 1 });
  assert.deepEqual(out.data["events"], []);
  await h.stop();
});

test("an invalid fallback_policy is refused before Flagsmith is asked", async () => {
  const h = await start();
  const r = await h.call("get_routing_policy", { identity: "task:x", fallback_policy: { policy: "p", schema: 2 } });
  assert.equal(r.isError, true);
  assert.match(r.text, /fallback_policy: invalid routing policy: .*\$\.schema: expected 1/);
  assert.deepEqual(h.fake.requests, []);
  await h.stop();
});

test("an invalid flag value is an error, not a quiet switch to control", async () => {
  const h = await start({ routingValue: '{"policy": "broken"' });
  const r = await h.call("get_routing_policy", { identity: identityFor("lanes_v1") });
  assert.equal(r.isError, true);
  assert.match(r.text, /flag "agent_routing" value is not a valid policy/);
  assert.ok(!h.fake.paths().includes("GET /api/v1/flags/"), "the control value was not fetched as a substitute");
  await h.stop();
});

test("kill switch on: the control policy from Flagsmith, no exposure, no events", async () => {
  const h = await start({ killed: true });
  const identity = identityFor("lanes_v1");
  const r = await h.call("get_routing_policy", { identity });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data["source"], "kill_switch");
  assert.equal(r.data["from_experiment"], false);
  assert.equal(r.data["exposure_recorded"], false);
  assert.deepEqual(r.data["policy"], CONTROL);
  assert.deepEqual(h.fake.paths(), ["POST /api/v1/identities/", "GET /api/v1/flags/"]);
  const out = await h.call("report_outcome", { identity, cost_usd: 0.2, solved: true, turns: 2, seconds: 2 });
  assert.match(out.data["note"], /source: kill_switch/);
  assert.deepEqual(h.fake.events(), []);
  await h.stop();
});

test("an exposure Flagsmith does not accept is an error and assigns nothing", async () => {
  for (const [eventsStatus, reason] of [[403, /the events API answered HTTP 403/], ["network", /could not be reached \(fetch failed: connect ECONNREFUSED\)/]] as const) {
    const h = await start({ eventsStatus });
    const identity = identityFor("lanes_v1");
    const r = await h.call("get_routing_policy", { identity });
    assert.equal(r.isError, true);
    assert.match(r.text, /bucketed "[^"]+" into variant lanes_v1, but the exposure was not accepted/);
    assert.match(r.text, reason);
    assert.ok(!r.text.includes("claude-"));
    const out = await h.call("report_outcome", { identity, cost_usd: 0.1, solved: true, turns: 1, seconds: 1 });
    assert.equal(out.isError, true);
    assert.match(out.text, /No routing policy was requested/);
    await h.stop();
  }
});

test("report_outcome sends the kit's four events, flushed one at a time", async () => {
  const h = await start();
  const identity = identityFor("lanes_v1");
  await h.call("get_routing_policy", { identity });
  const r = await h.call("report_outcome", { identity, cost_usd: 0.0837294, solved: true, turns: 7, seconds: 441.98765 });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data["delivered"], true);
  assert.equal(r.data["variant"], "lanes_v1");
  const expected = [
    { event: "task_cost", value: 0.083729 },
    { event: "task_solved", value: 1 },
    { event: "task_turns", value: 7 },
    { event: "task_seconds", value: 441.988 },
  ];
  assert.deepEqual(r.data["events"], expected);
  assert.deepEqual(
    h.fake.events().slice(1).map((e) => [e.event, e.identifier, e.value]),
    expected.map((e) => [e.event, identity, String(e.value)]),
  );
  assert.equal(h.fake.paths().filter((p) => p === "POST /api/v1/events").length, 5, "the exposure and each event get their own flush");

  const twice = await h.call("report_outcome", { identity, cost_usd: 1, solved: true, turns: 1, seconds: 1 });
  assert.equal(twice.isError, true);
  assert.match(twice.text, /already reported in this session/);
  assert.equal(h.fake.events().length, 5);
  await h.stop();
});

test("report_outcome: an unsolved task sends no task_solved", async () => {
  const h = await start();
  const identity = identityFor("control");
  await h.call("get_routing_policy", { identity });
  const r = await h.call("report_outcome", { identity, cost_usd: 0.6, solved: false, turns: 40, seconds: 1200 });
  assert.deepEqual(r.data["events"].map((e: { event: string }) => e.event), ["task_cost", "task_turns", "task_seconds"]);
  await h.stop();
});

test("report_outcome refuses an identity it knows nothing about, unless told the exposure exists", async () => {
  const h = await start();
  const unknown = await h.call("report_outcome", { identity: "task:elsewhere", cost_usd: 0.1, solved: true, turns: 1, seconds: 1 });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /Call get_routing_policy first, or set exposure_recorded_elsewhere/);
  assert.deepEqual(h.fake.requests, []);

  const told = await h.call("report_outcome", {
    identity: "task:elsewhere", cost_usd: 0.1, solved: true, turns: 1, seconds: 1, exposure_recorded_elsewhere: true,
  });
  assert.equal(told.isError, false, told.text);
  assert.equal(told.data["events"].length, 4);
  assert.match(told.data["note"], /did not record the exposure/);
  const again = await h.call("report_outcome", {
    identity: "task:elsewhere", cost_usd: 0.1, solved: true, turns: 1, seconds: 1, exposure_recorded_elsewhere: true,
  });
  assert.equal(again.isError, true);

  const bad = await h.call("report_outcome", { identity: "task:bad", cost_usd: -1, solved: true, turns: 1.5, seconds: 1 });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /cost_usd/);
  await h.stop();
});

test("report_outcome: events Flagsmith does not accept are an error that names them", async () => {
  const h = await start();
  const identity = identityFor("lanes_v2");
  await h.call("get_routing_policy", { identity });
  h.fake.options = { eventsStatus: 400 };
  const r = await h.call("report_outcome", { identity, cost_usd: 0.1, solved: false, turns: 2, seconds: 3 });
  assert.equal(r.isError, true);
  assert.match(r.text, /Flagsmith accepted 0 of 3 events; not accepted: task_cost, task_turns, task_seconds/);
  assert.match(r.text, /the events API answered HTTP 400/);
  h.fake.options = {};
  const again = await h.call("report_outcome", { identity, cost_usd: 0.1, solved: false, turns: 2, seconds: 3 });
  assert.equal(again.isError, true);
  assert.match(again.text, /already reported in this session \(Flagsmith accepted 0 of 3 events/);
  await h.stop();
});

test("get_kill_switch reads the environment flag and sends nothing else", async () => {
  const off = await start();
  const r = await off.call("get_kill_switch");
  assert.deepEqual(
    { flag: r.data["flag"], configured: r.data["configured"], exists: r.data["exists"], enabled: r.data["enabled"] },
    { flag: "routing_kill", configured: true, exists: true, enabled: false },
  );
  assert.deepEqual(off.fake.paths(), ["GET /api/v1/flags/"]);
  await off.stop();

  const on = await start({ killed: true });
  const killed = await on.call("get_kill_switch");
  assert.equal(killed.data["enabled"], true);
  assert.match(killed.data["note"], /^On: tasks run the control policy/);
  await on.stop();

  const missing = await start({ noKillFlag: true });
  const none = await missing.call("get_kill_switch");
  assert.equal(none.isError, false);
  assert.equal(none.data["exists"], false);
  assert.equal(none.data["enabled"], false);
  await missing.stop();

  const disabled = await start({}, testEnv({ FORKBILL_KILL_FLAG: "none" }));
  const skipped = await disabled.call("get_kill_switch");
  assert.equal(skipped.data["configured"], false);
  assert.deepEqual(disabled.fake.requests, []);
  const policy = await disabled.call("get_routing_policy", { identity: identityFor("lanes_v1") });
  assert.equal(policy.data["variant"], "lanes_v1");
  assert.deepEqual(disabled.fake.paths(), ["POST /api/v1/identities/", "POST /api/v1/events"]);
  await disabled.stop();

  const down = await start({ flagsStatus: 500 });
  const failed = await down.call("get_kill_switch");
  assert.equal(failed.isError, true);
  assert.match(failed.text, /Flagsmith did not serve the kill switch "routing_kill".*status code: 500/);
  await down.stop();
});

test("explain_assignment re-derives every fixture identity and agrees with Python and the engine", async () => {
  const h = await start();
  for (const v of VECTORS) {
    const r = await h.call("explain_assignment", { identity: v.identity, environment_document_path: ENVIRONMENT_FILE });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data["variant"], v.independent_variant, v.identity);
    assert.equal(r.data["independent"].variant, v.independent_variant);
    assert.equal(r.data["engine"].variant, v.engine_variant);
    assert.equal(r.data["engine"].in_experiment, v.engine_in_experiment);
    assert.equal(r.data["agree"], true);
    assert.equal(r.data["in_experiment"], v.in_rollout);
    assert.equal(r.data["policy"].policy, v.independent_variant);
    assert.equal(r.data["working"].segments[0].conditions[0].hash.percentage, v.segment_percentage);
    assert.equal(r.data["working"].split.hash.percentage, v.split_percentage);
  }
  assert.deepEqual(h.fake.requests, [], "offline means offline");
  await h.stop();
});

test("explain_assignment shows the working and takes the document as a path, an object or a string", async () => {
  const h = await start();
  const identity = identityFor("lanes_v2");
  const byPath = await h.call("explain_assignment", { identity, environment_document_path: ENVIRONMENT_FILE });
  const byObject = await h.call("explain_assignment", { identity, environment_document: DOCUMENT });
  const byString = await h.call("explain_assignment", { identity, environment_document: JSON.stringify(DOCUMENT) });
  assert.deepEqual(byObject.data, byPath.data);
  assert.deepEqual(byString.data, byPath.data);

  const w = byPath.data["working"];
  assert.equal(w.identity_key, `<api_key>_${identity}`);
  assert.equal(w.feature_state.source, "segment_override");
  assert.deepEqual(w.feature_state.segment, { id: "7001", name: "experiment-1-rollout" });
  assert.deepEqual(w.feature_state.experiment, { id: 1, name: "fixture experiment", in_experiment: true });
  assert.deepEqual(
    w.split.ranges.map((x: any) => [x.variant, x.start, x.end, x.matched]),
    [["lanes_v1", 0, 30, false], ["lanes_v2", 30, 60, true], ["control", 60, 100, false]],
  );
  const text = byPath.data["explanation"] as string;
  assert.match(text, new RegExp(`1\\. Hashing key: <api_key>_${identity}`));
  assert.match(text, new RegExp(`md5\\("7001,<api_key>_${identity}"\\) = [0-9a-f]{32}; as an integer mod 9999 = \\d+`));
  assert.match(text, /<= 60, inside the segment/);
  assert.match(text, /Ranges in variant id order: lanes_v1 \[0, 30\), lanes_v2 \[30, 60\), control \[60, 100\)/);
  assert.match(text, /Variant: lanes_v2\./);
  assert.match(text, /Flagsmith's engine: variant lanes_v2.*The two agree\./);
  assert.ok(byPath.text.startsWith(text), "the readable working comes first");
  assert.ok(!byPath.text.includes(DOCUMENT["api_key"]), "the environment key is not in the output");
  await h.stop();
});

test("explain_assignment checks an expected variant and what this session was served", async () => {
  const h = await start();
  const identity = identityFor("lanes_v1");
  const right = await h.call("explain_assignment", { identity, environment_document_path: ENVIRONMENT_FILE, expected_variant: "lanes_v1" });
  assert.equal(right.data["matches_expected"], true);
  assert.equal(right.data["matches_session"], null);
  const wrong = await h.call("explain_assignment", { identity, environment_document_path: ENVIRONMENT_FILE, expected_variant: "control" });
  assert.equal(wrong.isError, false);
  assert.equal(wrong.data["matches_expected"], false);
  assert.match(wrong.data["explanation"], /Expected control: DOES NOT MATCH the re-derived lanes_v1/);

  await h.call("get_routing_policy", { identity });
  const served = await h.call("explain_assignment", { identity, environment_document_path: ENVIRONMENT_FILE });
  assert.equal(served.data["session_variant"], "lanes_v1");
  assert.equal(served.data["matches_session"], true);
  await h.stop();
});

test("explain_assignment refuses what it cannot derive and falls back to the engine for rules md5 does not cover", async () => {
  const h = await start();
  const identity = identityFor("lanes_v1");
  const both = await h.call("explain_assignment", { identity, environment_document: DOCUMENT, environment_document_path: ENVIRONMENT_FILE });
  assert.match(both.text, /exactly one of environment_document and environment_document_path/);
  const neither = await h.call("explain_assignment", { identity });
  assert.equal(neither.isError, true);
  const noFile = await h.call("explain_assignment", { identity, environment_document_path: "/nonexistent/env.json" });
  assert.match(noFile.text, /Cannot read an environment document from \/nonexistent\/env\.json/);
  const notJson = await h.call("explain_assignment", { identity, environment_document: "{nope" });
  assert.match(notJson.text, /environment_document is not JSON/);
  const noFlag = await h.call("explain_assignment", { identity, environment_document: DOCUMENT, flag: "missing_flag" });
  assert.equal(noFlag.isError, true);
  assert.match(noFlag.text, /missing_flag is not in the environment document/);

  // A trait rule: the md5 recomputation steps aside and the engine, given the trait, answers.
  const traitDoc = structuredClone(DOCUMENT);
  traitDoc["project"].segments[0].rules[0].conditions[0] = { operator: "EQUAL", property_: "plan", value: "pro" };
  const pro = await h.call("explain_assignment", { identity, environment_document: traitDoc, traits: { plan: "pro" } });
  assert.equal(pro.isError, false, pro.text);
  assert.equal(pro.data["working"], null);
  assert.match(pro.data["independent"].error, /condition EQUAL on "plan"/);
  assert.equal(pro.data["agree"], null);
  assert.equal(pro.data["engine"].in_experiment, true);
  assert.equal(pro.data["variant"], pro.data["engine"].variant);
  const free = await h.call("explain_assignment", { identity, environment_document: traitDoc, traits: { plan: "free" } });
  assert.equal(free.data["engine"].in_experiment, false);
  assert.equal(free.data["variant"], "control");
  await h.stop();
});

test("price_usage prices calls with the kit's table arithmetic", async () => {
  const h = await start();
  const r = await h.call("price_usage", {
    calls: [
      { lane: "main", model: "claude-sonnet-5-5", input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 500_000 },
      { lane: "delegate", model: "claude-haiku-5-5", input_tokens: 2_000_000, output_tokens: 400_000, cache_write_5m_tokens: 80_000 },
      { model: "claude-opus-5-5", output_tokens: 1000, cache_write_1h_tokens: 1000 },
    ],
  });
  assert.equal(r.isError, false, r.text);
  // Sonnet 2 + 1 + 0.05; Haiku 0.2 + 0.2 + 0.01; Opus 0.02 + 0.008
  assert.deepEqual(r.data["calls"].map((c: any) => c.usd), [3.05, 0.41, 0.028]);
  assert.deepEqual(r.data["by_lane"], {
    main: { calls: 1, tokens: 1_600_000, usd: 3.05 },
    delegate: { calls: 1, tokens: 2_480_000, usd: 0.41 },
    other: { calls: 1, tokens: 2000, usd: 0.028 },
  });
  assert.equal(r.data["total_usd"], 3.488);
  assert.equal(r.data["total_tokens"], 4_082_000);
  assert.equal(r.data["cap_usd"], null);
  assert.equal(r.data["over_budget"], null);
  assert.equal(r.data["pricing"].table, "bundled");
  assert.deepEqual(h.fake.requests, []);

  const unknown = await h.call("price_usage", { calls: [{ model: "gpt-unknown", input_tokens: 1 }] });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /calls\[0\]: no price for model "gpt-unknown" in the bundled pricing table\. Priced models: .*claude-haiku-5-5/);
  const noModel = await h.call("price_usage", { calls: [{ lane: "main", input_tokens: 1 }] });
  assert.match(noModel.text, /calls\[0\] has no model/);
  const stranger = await h.call("price_usage", { calls: [{ lane: "main" }], identity: "task:none" });
  assert.match(stranger.text, /No routing policy was requested for "task:none"/);
  const negative = await h.call("price_usage", { calls: [{ model: "claude-haiku-5-5", input_tokens: -5 }] });
  assert.equal(negative.isError, true);
  await h.stop();
});

test("price_usage takes each lane's model and the cap from the task's policy", async () => {
  const h = await start();
  const identity = identityFor("lanes_v1");
  await h.call("get_routing_policy", { identity });
  const usage = { input_tokens: 100_000, output_tokens: 10_000 };
  const r = await h.call("price_usage", { identity, calls: [{ lane: "main", ...usage }, { lane: "delegate", ...usage }] });
  assert.deepEqual(r.data["calls"].map((c: any) => [c.lane, c.model, c.usd]), [
    ["main", "claude-sonnet-5-5", 0.3],
    ["delegate", "claude-haiku-5-5", 0.015],
  ]);
  assert.equal(r.data["total_usd"], 0.315);
  assert.equal(r.data["cap_usd"], 0.6);
  assert.equal(r.data["over_budget"], false);
  const over = await h.call("price_usage", { identity, calls: [{ lane: "main", output_tokens: 60_000 }] });
  assert.equal(over.data["total_usd"], 0.6);
  assert.equal(over.data["over_budget"], true);
  await h.stop();
});

test("FORKBILL_PRICING_FILE replaces the table, and a bad file is a clear error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forkbill-mcp-test-"));
  try {
    const file = join(dir, "prices.json");
    writeFileSync(file, JSON.stringify({ checked_on: "2026-01-01", models: { "my-model": { input: 1, output: 4 } } }));
    const h = await start({}, testEnv({ FORKBILL_PRICING_FILE: file }));
    const r = await h.call("price_usage", { calls: [{ model: "my-model", input_tokens: 500_000, output_tokens: 250_000 }] });
    assert.equal(r.data["total_usd"], 1.5);
    assert.equal(r.data["pricing"].table, file);
    assert.equal(r.data["pricing"].checked_on, "2026-01-01");
    await h.stop();

    writeFileSync(file, JSON.stringify({ models: { "my-model": { input: "cheap" } } }));
    const bad = await start({}, testEnv({ FORKBILL_PRICING_FILE: file }));
    const failed = await bad.call("price_usage", { calls: [{ model: "my-model" }] });
    assert.equal(failed.isError, true);
    assert.match(failed.text, /my-model\.input must be a number of at least 0/);
    await bad.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resources: the pricing table, the configuration without the key, the policy format", async () => {
  const h = await start();
  const read = async (uri: string): Promise<string> => {
    const text = resourceText(await h.client.readResource({ uri }));
    everything.push(text);
    return text;
  };
  const pricing = JSON.parse(await read("forkbill://pricing"));
  const study = JSON.parse(readFileSync(join(REPO_ROOT, "harness", "pricing.json"), "utf8"));
  assert.equal(pricing.checked_on, study.checked_on);
  assert.equal(pricing.source, study.source);
  assert.deepEqual(Object.keys(pricing.models), Object.keys(study.models));
  for (const [id, price] of Object.entries<Record<string, number>>(pricing.models)) {
    for (const [rate, value] of Object.entries(price)) assert.equal(value, study.models[id][rate], `${id}.${rate}`);
  }

  const config = JSON.parse(await read("forkbill://config"));
  assert.equal(config.environment_key, "set (server-side)");
  assert.equal(config.mode, "remote");
  assert.equal(config.routing_flag, "agent_routing");
  assert.equal(config.flags_api, "http://flagsmith.test/api/v1/");

  const format = await read("forkbill://routing-policy");
  const example = /```json\n([\s\S]*?)```/.exec(format)?.[1] ?? "";
  assert.deepEqual(parsePolicy(example), CONTROL, "the documented example is the study's control policy");
  assert.deepEqual(h.fake.requests, []);
  await h.stop();
});

test("the prompt walks an agent through the loop with its own identity scheme", async () => {
  const h = await start();
  const p = await h.client.getPrompt({ name: "route_behind_experiment", arguments: { agent: "the review agent", identity_scheme: "pr:<number>" } });
  const text = String((p.messages[0]?.content as { text?: string }).text);
  assert.match(text, /Put the model routing of the review agent behind a Flagsmith experiment/);
  assert.match(text, /Pick the identity: pr:<number>\./);
  for (const tool of ["get_routing_policy", "report_outcome", "get_kill_switch", "price_usage", "explain_assignment"]) {
    assert.ok(text.includes(tool), tool);
  }
  const bare = await h.client.getPrompt({ name: "route_behind_experiment" });
  assert.match(String((bare.messages[0]?.content as { text?: string }).text), /routing of this agent/);
  await h.stop();
});

test("with no key the Flagsmith tools say what to set and the offline tools still work", async () => {
  const h = await start({}, { FORKBILL_LOG_LEVEL: "silent" });
  for (const [name, args] of [
    ["get_routing_policy", { identity: "task:1" }],
    ["get_kill_switch", {}],
    ["report_outcome", { identity: "task:1", cost_usd: 0, solved: false, turns: 0, seconds: 0, exposure_recorded_elsewhere: true }],
  ] as const) {
    const r = await h.call(name, args);
    assert.equal(r.isError, true, name);
    assert.match(r.text, /Configuration: no Flagsmith environment key: set FLAGSMITH_SERVER_KEY \(or FLAGSMITH_ENVIRONMENT_KEY\)/);
  }
  const explained = await h.call("explain_assignment", { identity: identityFor("lanes_v1"), environment_document_path: ENVIRONMENT_FILE });
  assert.equal(explained.data["variant"], "lanes_v1");
  const priced = await h.call("price_usage", { calls: [{ model: "claude-haiku-5-5", input_tokens: 1_000_000 }] });
  assert.equal(priced.data["total_usd"], 0.1);
  assert.deepEqual(h.fake.requests, []);
  await h.stop();
});

test("a configuration the kit refuses is reported by the tool, naming the variable", async () => {
  const selfHostedNoEvents = await start({}, { FLAGSMITH_SERVER_KEY: KEY, FLAGSMITH_SDK_API_URL: "http://flagsmith.test/api/v1/", FORKBILL_LOG_LEVEL: "silent" });
  const a = await selfHostedNoEvents.call("get_routing_policy", { identity: "task:1" });
  assert.match(a.text, /Configuration: FLAGSMITH_SDK_API_URL points at your own Flagsmith, so FLAGSMITH_EVENTS_API_URL must be set too/);
  const shown = JSON.parse(resourceText(await selfHostedNoEvents.client.readResource({ uri: "forkbill://config" })));
  assert.match(shown.error, /FLAGSMITH_EVENTS_API_URL/);
  await selfHostedNoEvents.stop();

  const clientKeyLocal = await start({}, testEnv({ FLAGSMITH_SERVER_KEY: "clientkey", FORKBILL_MODE: "local" }));
  const b = await clientKeyLocal.call("get_routing_policy", { identity: "task:1" });
  assert.match(b.text, /Configuration: mode local evaluates locally and needs a server-side key \(ser\.\*\) in FLAGSMITH_SERVER_KEY/);
  assert.deepEqual(clientKeyLocal.fake.requests, []);
  await clientKeyLocal.client.close();

  const edgeNoUrl = await start({}, testEnv({ FORKBILL_MODE: "edge" }));
  const c = await edgeNoUrl.call("get_kill_switch");
  assert.match(c.text, /Configuration: mode edge needs FLAGSMITH_EDGE_API_URL \(edgeUrl\)/);
  await edgeNoUrl.stop();
});

test("local mode: the SDK evaluates the document itself and still records the exposure", async () => {
  const h = await start({}, testEnv({ FORKBILL_MODE: "local" }));
  for (const v of VECTORS.slice(0, 20)) {
    const r = await h.call("get_routing_policy", { identity: v.identity });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data["variant"], v.engine_variant, v.identity);
    assert.equal(r.data["from_experiment"], v.in_rollout, v.identity);
  }
  assert.ok(h.fake.paths().includes("GET /api/v1/environment-document/"));
  assert.ok(!h.fake.paths().includes("POST /api/v1/identities/"), "no identity request in local mode");
  const exposed = VECTORS.slice(0, 20).filter((v) => v.in_rollout);
  assert.deepEqual(h.fake.events().map((e) => [e.identifier, e.value]), exposed.map((v) => [v.identity, v.engine_variant]));
  const kill = await h.call("get_kill_switch");
  assert.equal(kill.data["enabled"], false);
  await h.stop();
});

test("nothing the server returned contains the environment key", () => {
  assert.ok(everything.length > 100);
  for (const text of everything) assert.ok(!text.includes(KEY));
});
