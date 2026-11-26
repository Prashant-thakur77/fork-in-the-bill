import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { sign } from "../src/hmac";
import { MemoryStore } from "../src/store";

const SECRET = "test-secret";
const ORIGIN = "https://board.example.dev";
let clock = 1_700_000_000;

function payload(over: Record<string, unknown> = {}) {
  return {
    experiment: "exp1",
    ts: clock,
    status: "running",
    flagsmith_experiment_url: "https://app.flagsmith.com/project/1/environment/x/experiments/7",
    arms: {
      control: { done: 3, solved: 2, usd: 4.5, running: 1 },
      lanes_v1: { done: 2, solved: 1, usd: 1.25, running: 2 },
    },
    last_task: { variant: "lanes_v1", usd: 0.61, solved: true, language: "rust" },
    ...over,
  };
}

async function signed(body: string, ts = clock, secret = SECRET) {
  const t = String(ts);
  return new Request("https://board.test/ingest", {
    method: "POST",
    headers: { "X-FB-Timestamp": t, "X-FB-Signature": await sign(secret, t, body), "Content-Type": "application/json" },
    body,
  });
}

function makeApp(store = new MemoryStore()) {
  return { store, app: createApp({ store, secret: SECRET, allowedOrigins: [ORIGIN], now: () => clock, pollMs: 5, heartbeatMs: 1000, maxStreamMs: 60 }) };
}

describe("POST /ingest", () => {
  it("stores a valid signed snapshot and serves it from /state", async () => {
    const { app } = makeApp();
    const body = JSON.stringify(payload());
    const res = await app.fetch(await signed(body));
    expect(res.status).toBe(200);
    const state = await app.fetch(new Request("https://board.test/state", { headers: { Origin: ORIGIN } }));
    expect(state.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(await state.json()).toMatchObject({ experiment: "exp1", arms: { control: { usd: 4.5 } } });
  });

  it("rejects a replay of the same signature", async () => {
    const { app } = makeApp();
    const body = JSON.stringify(payload());
    expect((await app.fetch(await signed(body))).status).toBe(200);
    const again = await app.fetch(await signed(body));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "replayed signature" });
  });

  it("rejects stale timestamps and bad signatures", async () => {
    const { app } = makeApp();
    const body = JSON.stringify(payload());
    expect((await app.fetch(await signed(body, clock - 61))).status).toBe(401);
    expect((await app.fetch(await signed(body, clock, "wrong"))).status).toBe(401);
    const unsigned = new Request("https://board.test/ingest", { method: "POST", body });
    expect((await app.fetch(unsigned)).status).toBe(401);
  });

  it("rejects invalid bodies even when signed", async () => {
    const { app } = makeApp();
    for (const bad of [
      payload({ status: "paused" }),
      payload({ arms: { control: { done: 1, solved: 2, usd: 1, running: 0 } } }),
      payload({ flagsmith_experiment_url: "javascript:alert(1)" }),
    ]) {
      expect((await app.fetch(await signed(JSON.stringify(bad)))).status).toBe(400);
    }
    expect((await app.fetch(await signed("not json"))).status).toBe(400);
  });

  it("keeps the newest snapshot when an older one arrives late", async () => {
    const { app } = makeApp();
    await app.fetch(await signed(JSON.stringify(payload({ ts: clock, status: "ended" }))));
    clock += 1;
    await app.fetch(await signed(JSON.stringify(payload({ ts: clock - 10, status: "running" }))));
    const s = await (await app.fetch(new Request("https://board.test/state"))).json();
    expect(s).toMatchObject({ status: "ended" });
  });
});

describe("GET /stream", () => {
  it("sends a snapshot on connect and after an ingest", async () => {
    const { app } = makeApp();
    const res = await app.fetch(new Request("https://board.test/stream", { headers: { Origin: ORIGIN } }));
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const textP = res.text(); // read like a client; the stream closes after maxStreamMs
    await new Promise((r) => setTimeout(r, 15)); // let the connect snapshot go out first
    clock += 1;
    await app.fetch(await signed(JSON.stringify(payload({ ts: clock }))));
    const text = await textP;
    const events = text.split("\n\n").filter((e) => e.startsWith("event: snapshot"));
    expect(events[0]).toContain("data: null");
    expect(events.at(-1)).toContain('"experiment":"exp1"');
  });

  it("answers CORS preflight only for allowed origins", async () => {
    const { app } = makeApp();
    const ok = await app.fetch(new Request("https://board.test/state", { method: "OPTIONS", headers: { Origin: ORIGIN } }));
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const no = await app.fetch(new Request("https://board.test/state", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
    expect(no.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
