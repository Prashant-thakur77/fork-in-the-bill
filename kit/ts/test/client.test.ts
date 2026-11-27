import assert from "node:assert/strict";
import { test } from "node:test";

import { flagsmithConfig, MODES } from "../src/index.js";

const CORE = "http://localhost:8000/api/v1/";
const EVENTS = "http://localhost:8000/api/";
const EDGE = "http://localhost:8001/api/v1";

test("modes send flags to the right host and events to the core API", () => {
  assert.deepEqual([...MODES], ["remote", "local", "edge", "edge-local"]);
  const remote = flagsmithConfig("remote", { environmentKey: "abc", apiUrl: CORE, eventsApiUrl: EVENTS });
  assert.equal(remote.apiUrl, CORE);
  assert.equal(remote.enableLocalEvaluation, false);
  assert.equal(remote.enableEvents, true);
  const local = flagsmithConfig("local", { environmentKey: "ser.x", apiUrl: CORE, eventsApiUrl: EVENTS });
  assert.equal(local.enableLocalEvaluation, true);
  assert.equal(local.environmentRefreshIntervalSeconds, 60);
  for (const mode of ["edge", "edge-local"] as const) {
    const cfg = flagsmithConfig(mode, { environmentKey: "ser.x", apiUrl: CORE, eventsApiUrl: EVENTS, edgeUrl: EDGE });
    assert.equal(cfg.apiUrl, `${EDGE}/`);
    assert.equal(cfg.eventProcessorConfig?.eventsApiUrl, EVENTS);
    assert.equal(cfg.enableLocalEvaluation, mode === "edge-local");
  }
});

test("misconfigured modes are refused", () => {
  assert.throws(() => flagsmithConfig("local", { environmentKey: "client" }), /server-side key/);
  assert.throws(() => flagsmithConfig("edge", { environmentKey: "k", eventsApiUrl: EVENTS }), /edgeUrl/);
  assert.throws(() => flagsmithConfig("edge", { environmentKey: "k", edgeUrl: EDGE }), /eventsApiUrl/);
});
