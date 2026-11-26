// Ingest signature checks (docs/interfaces.md, "Board ingest"):
//   X-FB-Timestamp: <unix seconds>
//   X-FB-Signature: hex(hmac_sha256(BOARD_INGEST_SECRET, ts + "." + raw_body))
// Requests outside a 60 second window are rejected; replays are rejected by the caller
// using the store, keyed on the signature.

export const WINDOW_SECONDS = 60;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sign(secret: string, ts: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${ts}.${rawBody}`));
  return toHex(mac);
}

/** Constant-time comparison of two strings of hex. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult =
  | { ok: true; ts: number; signature: string }
  | { ok: false; status: number; reason: string };

export async function verifySignature(opts: {
  secret: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  nowSeconds: number;
}): Promise<VerifyResult> {
  const { secret, timestampHeader, signatureHeader, rawBody, nowSeconds } = opts;
  if (!secret) return { ok: false, status: 500, reason: "ingest secret not configured" };
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, status: 401, reason: "missing signature headers" };
  }
  if (!/^\d{1,12}$/.test(timestampHeader)) {
    return { ok: false, status: 401, reason: "bad timestamp" };
  }
  const ts = Number(timestampHeader);
  if (Math.abs(nowSeconds - ts) > WINDOW_SECONDS) {
    return { ok: false, status: 401, reason: "timestamp outside window" };
  }
  const given = signatureHeader.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) {
    return { ok: false, status: 401, reason: "bad signature format" };
  }
  const expected = await sign(secret, timestampHeader, rawBody);
  if (!timingSafeEqual(expected, given)) {
    return { ok: false, status: 401, reason: "bad signature" };
  }
  return { ok: true, ts, signature: given };
}
