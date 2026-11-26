import { describe, expect, it } from "vitest";
import { sign, timingSafeEqual, verifySignature, WINDOW_SECONDS } from "../src/hmac";

const SECRET = "test-secret";
const BODY = '{"experiment":"exp1"}';

describe("sign", () => {
  it("matches HMAC-SHA256 over ts + '.' + body (known vector)", async () => {
    // python: hmac.new(b"test-secret", b'1700000000.{"experiment":"exp1"}', hashlib.sha256).hexdigest()
    const sig = await sign(SECRET, "1700000000", BODY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toBe("7353d602880b714ef289c02c882bb4bf26cce21520ebdaa4c1695fba3cb6c6ac");
  });
});

describe("timingSafeEqual", () => {
  it("compares by value and length", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("verifySignature", () => {
  const now = 1_700_000_000;
  const base = async (over: Partial<Parameters<typeof verifySignature>[0]> = {}) => {
    const ts = String(now);
    return verifySignature({
      secret: SECRET,
      timestampHeader: ts,
      signatureHeader: await sign(SECRET, ts, BODY),
      rawBody: BODY,
      nowSeconds: now,
      ...over,
    });
  };

  it("accepts a fresh, correct signature", async () => {
    const r = await base();
    expect(r.ok).toBe(true);
  });

  it("accepts an uppercase hex signature", async () => {
    const r = await base({ signatureHeader: (await sign(SECRET, String(now), BODY)).toUpperCase() });
    expect(r.ok).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const r = await base({ rawBody: BODY.replace("exp1", "exp2") });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "bad signature" });
  });

  it("rejects the wrong secret", async () => {
    const r = await base({ signatureHeader: await sign("other", String(now), BODY) });
    expect(r).toMatchObject({ ok: false, reason: "bad signature" });
  });

  it("rejects a signature made for another timestamp", async () => {
    const ts = String(now - 5);
    const r = await base({ timestampHeader: ts, signatureHeader: await sign(SECRET, String(now), BODY) });
    expect(r).toMatchObject({ ok: false, reason: "bad signature" });
  });

  it("enforces the 60 s window on both sides", async () => {
    for (const delta of [WINDOW_SECONDS + 1, -(WINDOW_SECONDS + 1)]) {
      const ts = String(now + delta);
      const r = await base({ timestampHeader: ts, signatureHeader: await sign(SECRET, ts, BODY) });
      expect(r).toMatchObject({ ok: false, reason: "timestamp outside window" });
    }
    const edge = String(now - WINDOW_SECONDS);
    const ok = await base({ timestampHeader: edge, signatureHeader: await sign(SECRET, edge, BODY) });
    expect(ok.ok).toBe(true);
  });

  it("rejects missing or malformed headers", async () => {
    expect(await base({ timestampHeader: null })).toMatchObject({ ok: false, reason: "missing signature headers" });
    expect(await base({ signatureHeader: null })).toMatchObject({ ok: false, reason: "missing signature headers" });
    expect(await base({ timestampHeader: "12.5" })).toMatchObject({ ok: false, reason: "bad timestamp" });
    expect(await base({ signatureHeader: "zz" })).toMatchObject({ ok: false, reason: "bad signature format" });
  });

  it("fails closed when no secret is configured", async () => {
    expect(await base({ secret: "" })).toMatchObject({ ok: false, status: 500 });
  });
});
