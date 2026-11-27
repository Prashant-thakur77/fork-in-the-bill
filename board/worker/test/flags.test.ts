import { describe, expect, it } from "vitest";
import { createApp, MAX_WEBHOOK_BYTES } from "../src/app";
import { parseFlagWebhook } from "../src/flags";
import { signFlagsmith, verifyFlagsmithSignature } from "../src/hmac";
import { MemoryStore } from "../src/store";

const SECRET = "fs-webhook-secret";
const ORIGIN = "https://board.example.dev";
const NOW = 1_800_000_000;

const POLICY_CONTROL = '{"policy":"control","main":{"model":"m-large"}}';
const POLICY_LANES = '{"policy":"lanes_v1","main":{"model":"m-large"},"delegate":{"model":"m-small"}}';
const PII = ["alice@example.com", "Alice Example", "user-7731@example.org", "Bob Builder", "bob@example.com"];

function state(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    environment: { id: 11, name: "Production" },
    feature: { id: 306193, name: "agent_routing", type: "MULTIVARIATE", description: "routing policy" },
    feature_segment: null,
    feature_state_value: POLICY_CONTROL,
    identity: null,
    identity_identifier: null,
    multivariate_feature_state_values: [
      { id: 901, multivariate_feature_option: { id: 37431, value: POLICY_LANES }, percentage_allocation: 50 },
    ],
    ...over,
  };
}

function flagUpdated(newOver: Record<string, unknown> = {}, prevOver: Record<string, unknown> = {}) {
  return {
    event_type: "FLAG_UPDATED",
    data: {
      changed_by: "Alice Example <alice@example.com>",
      timestamp: "2027-01-15T08:00:00.123456Z",
      new_state: state(newOver),
      previous_state: state(prevOver),
    },
  };
}

function auditLog(over: Record<string, unknown> = {}) {
  return {
    created_date: "2027-01-15T08:00:01.000000Z",
    log: "Flag state / Remote config value updated for feature 'agent_routing' and identity 'user-7731@example.org'",
    author: { id: 4, email: "bob@example.com", first_name: "Bob", last_name: "Builder" },
    environment: { id: 11, name: "Production", api_key: "ser.secretish" },
    project: { id: 56673, name: "fork", organisation: 9 },
    related_object_id: 1234,
    related_object_uuid: "0f8fad5b-d9cb-469f-a165-70867728950e",
    related_object_type: "FEATURE_STATE",
    ...over,
  };
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();

/** HMAC computed straight from WebCrypto, independent of the worker's helpers. */
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

function makeApp(store = new MemoryStore()) {
  const app = createApp({
    store,
    secret: "ingest-secret",
    flagsmithSecret: SECRET,
    allowedOrigins: [ORIGIN],
    now: () => NOW,
    pollMs: 5,
    heartbeatMs: 1000,
    maxStreamMs: 60,
  });
  return { store, app };
}

/** Signs like Flagsmith does: hex HMAC-SHA256 of the raw body. */
async function post(body: string, signature?: string | null) {
  if (signature === undefined) signature = await hmacHex(SECRET, body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["X-Flagsmith-Signature"] = signature;
  return new Request("https://board.test/flagsmith/webhook", { method: "POST", headers, body });
}

describe("Flagsmith webhook signature", () => {
  it("matches a hex HMAC-SHA256 of the raw body (known vector)", async () => {
    // python: hmac.new(b"fs-webhook-secret", b'{"event_type":"FLAG_UPDATED"}', hashlib.sha256).hexdigest()
    expect(await signFlagsmith(SECRET, '{"event_type":"FLAG_UPDATED"}')).toBe(
      "86e4e64ed592051853d6b5208d5b2bf62f4bffda288369b2a08a25f64882b120",
    );
  });

  it("accepts a valid signature, in either case", async () => {
    const body = '{"a":1}';
    const sig = await hmacHex(SECRET, body);
    expect((await verifyFlagsmithSignature({ secret: SECRET, signatureHeader: sig, rawBody: body })).ok).toBe(true);
    expect(
      (await verifyFlagsmithSignature({ secret: SECRET, signatureHeader: sig.toUpperCase(), rawBody: body })).ok,
    ).toBe(true);
  });

  it("rejects wrong, tampered, malformed and missing signatures with 401", async () => {
    const { app, store } = makeApp();
    const body = JSON.stringify(flagUpdated());
    const wrong = await hmacHex("other", body);
    const forOther = await hmacHex(SECRET, body + " ");
    for (const sig of [wrong, forOther, "zz", "", null]) {
      const res = await app.fetch(await post(body, sig));
      expect(res.status, String(sig)).toBe(401);
    }
    expect(await store.flagHistory()).toHaveLength(0);
  });

  it("fails closed when the secret is not configured", async () => {
    const store = new MemoryStore();
    const app = createApp({ store, secret: "x", allowedOrigins: [], now: () => NOW });
    const res = await app.fetch(await post(JSON.stringify(flagUpdated())));
    expect(res.status).toBe(500);
  });

  it("rejects bodies over the size cap before checking anything else", async () => {
    const { app } = makeApp();
    const big = JSON.stringify({ ...flagUpdated(), pad: "x".repeat(MAX_WEBHOOK_BYTES) });
    expect((await app.fetch(await post(big))).status).toBe(413);
  });

  it("only accepts POST", async () => {
    const { app } = makeApp();
    expect((await app.fetch(new Request("https://board.test/flagsmith/webhook"))).status).toBe(405);
  });
});

describe("environment webhook (FLAG_UPDATED)", () => {
  it("stores before/after enabled, weights and value digests", async () => {
    const { app } = makeApp();
    const body = JSON.stringify(
      flagUpdated(
        { multivariate_feature_state_values: [{ id: 901, multivariate_feature_option: { id: 37431, value: POLICY_LANES }, percentage_allocation: 100 }] },
        { enabled: false },
      ),
    );
    const res = await app.fetch(await post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: true });

    const hist = await app.fetch(new Request("https://board.test/flags/history?feature=agent_routing", { headers: { Origin: ORIGIN } }));
    expect(hist.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const { changes } = (await hist.json()) as { changes: Record<string, unknown>[] };
    expect(changes).toHaveLength(1);
    const sha = await sha256(POLICY_CONTROL);
    expect(changes[0]).toEqual({
      id: 1,
      at: Math.floor(Date.parse("2027-01-15T08:00:00Z") / 1000),
      received_at: NOW,
      source: "flag",
      event_type: "FLAG_UPDATED",
      feature: "agent_routing",
      environment: "Production",
      scope: "environment",
      segment: null,
      enabled_before: false,
      enabled_after: true,
      weights_before: [{ option_id: 37431, pct: 50 }],
      weights_after: [{ option_id: 37431, pct: 100 }],
      value_sha256_before: sha,
      value_sha256_after: sha,
    });
  });

  it("records a segment override by segment name and an identity override without the identifier", async () => {
    const seg = await parseFlagWebhook(
      flagUpdated({ feature_segment: { segment: { id: 5, name: "canary" }, priority: 1 } }),
      NOW,
    );
    expect(seg).toMatchObject({ ok: true, value: { scope: "segment", segment: "canary" } });
    const ident = await parseFlagWebhook(flagUpdated({ identity: 77, identity_identifier: "user-7731@example.org" }), NOW);
    expect(ident).toMatchObject({ ok: true, value: { scope: "identity", segment: null } });
    expect(JSON.stringify(ident)).not.toContain("user-7731");
  });

  it("handles a deleted flag with no new state", async () => {
    const r = await parseFlagWebhook({ event_type: "FLAG_DELETED", data: { timestamp: "2027-01-15T09:00:00Z", new_state: null, previous_state: state() } }, NOW);
    expect(r).toMatchObject({ ok: true, value: { event_type: "FLAG_DELETED", enabled_before: true, enabled_after: null, weights_after: null } });
  });

  it("rejects unknown shapes and bad JSON with 400", async () => {
    const { app } = makeApp();
    for (const bad of ["not json", "[]", '{"hello":1}', '{"event_type":"flag updated","data":{}}', '{"event_type":"FLAG_UPDATED","data":{}}']) {
      expect((await app.fetch(await post(bad))).status, bad).toBe(400);
    }
  });

  it("stores a replayed delivery once", async () => {
    const { app, store } = makeApp();
    const body = JSON.stringify(flagUpdated());
    expect(await (await app.fetch(await post(body))).json()).toEqual({ ok: true, stored: true });
    expect(await (await app.fetch(await post(body))).json()).toEqual({ ok: true, stored: false });
    expect(await store.flagHistory()).toHaveLength(1);
  });
});

describe("audit-log webhook", () => {
  it("stores the object type, feature and environment only", async () => {
    const { app, store } = makeApp();
    const res = await app.fetch(await post(JSON.stringify(auditLog())));
    expect(res.status).toBe(200);
    const [c] = await store.flagHistory();
    expect(c).toMatchObject({
      source: "audit",
      event_type: "AUDIT_FEATURE_STATE",
      feature: "agent_routing",
      environment: "Production",
      at: Math.floor(Date.parse("2027-01-15T08:00:01Z") / 1000),
      enabled_before: null,
      weights_after: null,
      value_sha256_after: null,
    });
  });

  it("reads the feature from a FEATURE log line and tolerates a missing environment", async () => {
    const r = await parseFlagWebhook(auditLog({ log: "New Flag / Remote Config created: agent_routing", related_object_type: "FEATURE", environment: null }), NOW);
    expect(r).toMatchObject({ ok: true, value: { feature: "agent_routing", environment: null } });
  });
});

describe("privacy", () => {
  it("keeps no names, emails, identifiers, log text or raw values anywhere in the store", async () => {
    const { app, store } = makeApp();
    await app.fetch(await post(JSON.stringify(flagUpdated({ identity: 77, identity_identifier: "user-7731@example.org" }))));
    await app.fetch(await post(JSON.stringify(flagUpdated())));
    await app.fetch(await post(JSON.stringify(auditLog())));
    const history = await (await app.fetch(new Request("https://board.test/flags/history"))).text();
    const everything = JSON.stringify(store, (_k, v) => (v instanceof Set || v instanceof Map ? [...v] : v)) + history;
    expect((await store.flagHistory()).length).toBe(3);
    for (const needle of [...PII, POLICY_CONTROL, POLICY_LANES, '"policy"', "m-small", "Flag state", "ser.secretish", "changed_by", "author"]) {
      expect(everything, needle).not.toContain(needle);
    }
  });
});

describe("GET /stream flags event", () => {
  it("sends the flag history on connect and again after a webhook", async () => {
    const { app } = makeApp();
    const res = await app.fetch(new Request("https://board.test/stream?feature=agent_routing"));
    const textP = res.text();
    await new Promise((r) => setTimeout(r, 15));
    await app.fetch(await post(JSON.stringify(flagUpdated())));
    const events = (await textP).split("\n\n").filter((e) => e.startsWith("event: flags"));
    expect(events[0]).toContain('data: {"changes":[]}');
    expect(events.at(-1)).toContain('"feature":"agent_routing"');
  });
});
