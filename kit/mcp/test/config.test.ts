import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, describeConfig, loadConfig } from "../src/index.js";

test("defaults: Flagsmith Cloud, remote mode, the kit's flag names", () => {
  const c = loadConfig({});
  assert.deepEqual(c, {
    environmentKey: null,
    mode: "remote",
    apiUrl: null,
    eventsApiUrl: null,
    edgeUrl: null,
    flag: "agent_routing",
    killFlag: "routing_kill",
    pricingFile: null,
    requestTimeoutSeconds: 10,
    retries: 3,
    logLevel: "warn",
  });
});

test("the kit's variable names are read, in the kit's order of preference", () => {
  assert.equal(loadConfig({ FLAGSMITH_ENVIRONMENT_KEY: "abc" }).environmentKey, "abc");
  assert.equal(loadConfig({ FLAGSMITH_SERVER_KEY: "ser.x", FLAGSMITH_ENVIRONMENT_KEY: "abc" }).environmentKey, "ser.x");
  const selfHosted = loadConfig({
    FLAGSMITH_SERVER_KEY: " ser.x ",
    FLAGSMITH_SDK_API_URL: "http://localhost:8000/api/v1/",
    FLAGSMITH_EVENTS_API_URL: "http://localhost:8000/api/",
    FLAGSMITH_EDGE_API_URL: "http://localhost:8001/api/v1/",
    FORKBILL_MODE: "edge-local",
    FORKBILL_FLAG: "routing",
    FORKBILL_KILL_FLAG: "NONE",
    FORKBILL_RETRIES: "0",
    FORKBILL_REQUEST_TIMEOUT_SECONDS: "2.5",
    FORKBILL_LOG_LEVEL: "silent",
  });
  assert.equal(selfHosted.environmentKey, "ser.x");
  assert.equal(selfHosted.apiUrl, "http://localhost:8000/api/v1/");
  assert.equal(selfHosted.edgeUrl, "http://localhost:8001/api/v1/");
  assert.equal(selfHosted.mode, "edge-local");
  assert.equal(selfHosted.flag, "routing");
  assert.equal(selfHosted.killFlag, null);
  assert.equal(selfHosted.retries, 0);
  assert.equal(selfHosted.requestTimeoutSeconds, 2.5);
  // The name harness/policy.py reads works too.
  const harness = loadConfig({
    FLAGSMITH_API_URL_SDK: "http://localhost:8000/api/v1/",
    FLAGSMITH_EVENTS_API_URL: "http://localhost:8000/api/",
  });
  assert.equal(harness.apiUrl, "http://localhost:8000/api/v1/");
});

test("a self-hosted API URL without an events URL is refused, so events cannot go to the cloud", () => {
  assert.throws(
    () => loadConfig({ FLAGSMITH_SERVER_KEY: "k", FLAGSMITH_SDK_API_URL: "http://localhost:8000/api/v1/" }),
    (err: unknown) => err instanceof ConfigError && /FLAGSMITH_EVENTS_API_URL must be set/.test(err.message),
  );
});

test("bad values name the variable and never echo a secret", () => {
  assert.throws(() => loadConfig({ FORKBILL_MODE: "turbo" }), /FORKBILL_MODE must be one of remote, local, edge, edge-local/);
  assert.throws(() => loadConfig({ FORKBILL_RETRIES: "1.5" }), /FORKBILL_RETRIES must be a whole number/);
  assert.throws(() => loadConfig({ FORKBILL_REQUEST_TIMEOUT_SECONDS: "0" }), /FORKBILL_REQUEST_TIMEOUT_SECONDS/);
  assert.throws(() => loadConfig({ FORKBILL_LOG_LEVEL: "loud" }), /FORKBILL_LOG_LEVEL/);
  assert.throws(() => loadConfig({ FLAGSMITH_EVENTS_API_URL: "localhost:8000" }), /FLAGSMITH_EVENTS_API_URL/);
  assert.throws(
    () => loadConfig({ FLAGSMITH_EVENTS_API_URL: "http://user:pw@localhost:8000/api/" }),
    (err: unknown) => err instanceof ConfigError && /must not carry credentials/.test(err.message) && !err.message.includes("user:pw"),
  );
});

test("the described configuration says whether a key is set and never shows it", () => {
  const key = "ser.SECRETSECRETSECRET";
  const shown = describeConfig(
    loadConfig({ FLAGSMITH_SERVER_KEY: key, FLAGSMITH_SDK_API_URL: "http://localhost:8000/api/v1/", FLAGSMITH_EVENTS_API_URL: "http://localhost:8000/api/" }),
  );
  assert.ok(!JSON.stringify(shown).includes(key));
  assert.equal(shown["environment_key"], "set (server-side)");
  assert.equal(shown["flags_api"], "http://localhost:8000/api/v1/");
  assert.equal(describeConfig(loadConfig({ FLAGSMITH_ENVIRONMENT_KEY: "abc" }))["environment_key"], "set (client-side)");
  assert.equal(describeConfig(loadConfig({}))["environment_key"], "not set");
  assert.match(String(describeConfig(loadConfig({ FORKBILL_MODE: "edge" }))["exposures_recorded"]), /^no/);
});
