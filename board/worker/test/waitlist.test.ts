import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryStore } from "../src/store";
import { attemptKey, cleanEmail, cleanSource, cleanStack, cleanWants, STACK_MAX_CHARS, WAITLIST_MAX_ATTEMPTS, WAITLIST_MIN_PUBLIC_COUNT } from "../src/waitlist";

const ORIGIN = "https://board.example.dev";
let clock = 1_800_000_000;

function makeApp(store = new MemoryStore()) {
  return { store, app: createApp({ store, secret: "ingest-secret", waitlistSalt: "salt", allowedOrigins: [ORIGIN], now: () => clock }) };
}

function join(body: Record<string, unknown>, over: { origin?: string | null; ip?: string; form?: boolean } = {}) {
  const headers: Record<string, string> = { "CF-Connecting-IP": over.ip ?? "203.0.113.7" };
  if (over.origin !== null) headers.Origin = over.origin ?? ORIGIN;
  if (over.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    return new Request("https://board.test/waitlist", { method: "POST", headers, body: new URLSearchParams(body as Record<string, string>).toString() });
  }
  headers["Content-Type"] = "application/json";
  return new Request("https://board.test/waitlist", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /waitlist", () => {
  it("stores a valid address once, with the answers given, the page it came from and nothing else", async () => {
    const { app, store } = makeApp();
    const res = await app.fetch(join({ email: "  Reader@Example.org ", wants: "both", stack: "  LangGraph\n on  Bedrock ", source: "/updates", extra: "ignored" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, state: "joined" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(store.waitlist).toEqual([{ email: "reader@example.org", wants: "both", stack: "LangGraph on Bedrock", created_at: clock, source: "/updates" }]);
  });

  it("limits the answers on the server: a known choice or nothing, and at most 200 characters of text", async () => {
    const { app, store } = makeApp();
    await app.fetch(join({ email: "a@example.org", wants: "everything", stack: "x".repeat(900) }));
    await app.fetch(join({ email: "b@example.org", wants: ["kit"], stack: { a: 1 } }, { ip: "203.0.113.20" }));
    await app.fetch(join({ email: "c@example.org", wants: "kit" }, { ip: "203.0.113.21" }));
    expect(store.waitlist.map((r) => [r.wants, r.stack.length])).toEqual([
      ["", STACK_MAX_CHARS],
      ["", 0],
      ["kit", 0],
    ]);
  });

  it("says so when the address is already on the list, and keeps one row", async () => {
    const { app, store } = makeApp();
    await app.fetch(join({ email: "reader@example.org" }));
    const again = await app.fetch(join({ email: "READER@example.org", source: "/" }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, state: "already" });
    expect(store.waitlist).toHaveLength(1);
  });

  it("rejects things that are not email addresses", async () => {
    const { app, store } = makeApp();
    for (const email of ["", "nope", "a@b", "a b@example.org", "a@example", "a..b@example.org", ".a@example.org", "a@-example.org", "a@example.123", 42, null, `${"x".repeat(250)}@example.org`]) {
      const res = await app.fetch(join({ email }, { ip: `198.51.100.${Math.floor(Math.random() * 250)}` }));
      expect(res.status, String(email)).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, state: "invalid" });
    }
    expect(store.waitlist).toHaveLength(0);
  });

  it("answers a filled trap field as a success and stores nothing", async () => {
    const { app, store } = makeApp();
    const res = await app.fetch(join({ email: "bot@example.org", website: "https://spam.example" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, state: "joined" });
    expect(store.waitlist).toHaveLength(0);
  });

  it("limits attempts per address and stores only a hash of it", async () => {
    const { app, store } = makeApp();
    for (let i = 0; i < WAITLIST_MAX_ATTEMPTS; i++) {
      expect((await app.fetch(join({ email: `r${i}@example.org` }))).status).toBe(200);
    }
    const blocked = await app.fetch(join({ email: "one-more@example.org" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("600");
    expect(await blocked.json()).toMatchObject({ ok: false, state: "slow" });
    expect(store.waitlist).toHaveLength(WAITLIST_MAX_ATTEMPTS);
    // another address is not affected
    expect((await app.fetch(join({ email: "other@example.org" }, { ip: "203.0.113.8" }))).status).toBe(200);
    // what is kept about the address is a 64-hex hash, never the address
    for (const a of store.attempts) {
      expect(a.key).toMatch(/^[0-9a-f]{64}$/);
      expect(a.key).not.toContain("203.0.113");
    }
    // the window passes
    clock += 601;
    expect((await app.fetch(join({ email: "later@example.org" }))).status).toBe(200);
    // and old attempt records are deleted
    clock += 3601;
    await app.fetch(join({ email: "much-later@example.org" }));
    expect(store.attempts).toHaveLength(1);
  });

  it("accepts only requests from the site's own origin", async () => {
    const { app, store } = makeApp();
    expect((await app.fetch(join({ email: "a@example.org" }, { origin: "https://elsewhere.example" }))).status).toBe(403);
    expect((await app.fetch(join({ email: "a@example.org" }, { origin: null }))).status).toBe(403);
    expect(store.waitlist).toHaveLength(0);
  });

  it("answers a plain form post with a page, not JSON", async () => {
    const { app, store } = makeApp();
    const res = await app.fetch(join({ email: "form@example.org", wants: "writeup", stack: "", stack_choice: "<b>My own loop</b>", source: "/updates", website: "" }, { form: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("You are on the list.");
    expect(html).not.toContain("form@example.org");
    expect(html).toContain("The experiment 2 write-up");
    expect(html).toContain("&lt;b>My own loop&lt;/b>");
    expect(store.waitlist).toHaveLength(1);
    expect(store.waitlist[0]).toMatchObject({ wants: "writeup", stack: "<b>My own loop</b>" });
    const bad = await app.fetch(join({ email: "nope" }, { form: true, ip: "203.0.113.9" }));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("does not look like an email address");
  });

  it("refuses other content types, oversized bodies and other methods", async () => {
    const { app } = makeApp();
    const text = new Request("https://board.test/waitlist", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain" }, body: "a@example.org" });
    expect((await app.fetch(text)).status).toBe(415);
    const big = await app.fetch(join({ email: "a@example.org", source: "x".repeat(4000) }));
    expect(big.status).toBe(413);
    expect((await app.fetch(new Request("https://board.test/waitlist", { method: "DELETE" }))).status).toBe(405);
    const get = await app.fetch(new Request("https://board.test/waitlist"));
    expect(get.status).toBe(303);
    expect(get.headers.get("Location")).toBe("/updates");
  });
});

describe("GET /waitlist/count", () => {
  it("withholds the number until the list is large enough, and never returns an address", async () => {
    const { app } = makeApp();
    const count = async () => {
      const res = await app.fetch(new Request("https://board.test/waitlist/count", { headers: { Origin: ORIGIN } }));
      const text = await res.text();
      expect(text).not.toContain("@");
      return JSON.parse(text) as { count: number | null };
    };
    expect(await count()).toEqual({ count: null });
    for (let i = 0; i < WAITLIST_MIN_PUBLIC_COUNT - 1; i++) await app.fetch(join({ email: `p${i}@example.org` }, { ip: `192.0.2.${i}` }));
    expect(await count()).toEqual({ count: null });
    await app.fetch(join({ email: "tenth@example.org" }, { ip: "192.0.2.200" }));
    expect(await count()).toEqual({ count: WAITLIST_MIN_PUBLIC_COUNT });
  });

  it("has no route that lists the stored addresses", async () => {
    const { app } = makeApp();
    await app.fetch(join({ email: "private@example.org" }));
    for (const path of ["/waitlist", "/waitlist/", "/waitlist/list", "/waitlist/export", "/waitlist/count", "/state", "/flags/history", "/"]) {
      const res = await app.fetch(new Request(`https://board.test${path}`, { headers: { Origin: ORIGIN } }));
      expect(await res.text(), path).not.toContain("private@example.org");
    }
  });
});

describe("helpers", () => {
  it("cleans the answers", () => {
    expect(cleanWants("kit")).toBe("kit");
    expect(cleanWants("toString")).toBe("");
    expect(cleanWants(undefined)).toBe("");
    expect(cleanStack(" a\tb\u0000c ")).toBe("a b c");
    expect(cleanStack(7)).toBe("");
  });

  it("normalises addresses and sources", () => {
    expect(cleanEmail(" A.Reader+tag@Sub.Example.ORG ")).toBe("a.reader+tag@sub.example.org");
    expect(cleanEmail("a@b.c")).toBeNull();
    expect(cleanSource("/updates")).toBe("/updates");
    expect(cleanSource("/")).toBe("/");
    expect(cleanSource("https://x.example/")).toBe("");
    expect(cleanSource("/a?b=1")).toBe("");
  });

  it("changes the address key with the salt and the day", async () => {
    const a = await attemptKey("salt", "203.0.113.7", 1_800_000_000);
    expect(a).toBe(await attemptKey("salt", "203.0.113.7", 1_800_000_100));
    expect(a).not.toBe(await attemptKey("pepper", "203.0.113.7", 1_800_000_000));
    expect(a).not.toBe(await attemptKey("salt", "203.0.113.7", 1_800_000_000 + 86400));
  });
});
