import { dedupeKey, parseFlagWebhook, type StoredFlagChange } from "./flags";
import { verifyFlagsmithSignature, verifySignature } from "./hmac";
import { parseSnapshot } from "./payload";
import type { Store, StoredSnapshot } from "./store";
import {
  attemptKey,
  cleanEmail,
  cleanSource,
  cleanStack,
  cleanWants,
  JOIN_COPY,
  joinPage,
  parseJoinBody,
  WAITLIST_ATTEMPT_TTL_SECONDS,
  WAITLIST_MAX_ATTEMPTS,
  WAITLIST_MAX_BODY_BYTES,
  WAITLIST_MIN_PUBLIC_COUNT,
  WAITLIST_WINDOW_SECONDS,
  type JoinState,
} from "./waitlist";

export interface AppOptions {
  store: Store;
  secret: string;
  /** FLAGSMITH_WEBHOOK_SECRET; the webhook route fails closed without it. */
  flagsmithSecret?: string;
  allowedOrigins: string[];
  /** Salt for the hashed address key used to rate-limit sign-ups; falls back to `secret`. */
  waitlistSalt?: string;
  now?: () => number; // unix seconds
  pollMs?: number;
  heartbeatMs?: number;
  maxStreamMs?: number;
}

const MAX_BODY_BYTES = 16 * 1024;
// Flagsmith payloads carry full feature objects (description, tags), so allow more than /ingest.
export const MAX_WEBHOOK_BYTES = 64 * 1024;
const FEATURE_PARAM = /^[A-Za-z0-9_.-]{1,150}$/;

/** Reads a body as text, giving up (null) once it passes maxBytes, whatever Content-Length says. */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

function corsHeaders(request: Request, allowed: string[]): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !(allowed.includes(origin) || allowed.includes("*"))) return {};
  return {
    "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Last-Event-ID",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

function sseEvent(s: StoredSnapshot | null): string {
  const id = s ? `id: ${s.version}\n` : "";
  return `event: snapshot\n${id}data: ${JSON.stringify(s ? s.snapshot : null)}\n\n`;
}

function flagsEvent(changes: StoredFlagChange[]): string {
  return `event: flags\ndata: ${JSON.stringify({ changes })}\n\n`;
}

const lastId = (changes: StoredFlagChange[]) => changes.reduce((m, c) => Math.max(m, c.id), 0);

export function createApp(opts: AppOptions) {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const pollMs = opts.pollMs ?? 2000;
  const heartbeatMs = opts.heartbeatMs ?? 15000;
  const maxStreamMs = opts.maxStreamMs ?? 10 * 60 * 1000;
  const { store } = opts;

  async function ingest(request: Request): Promise<Response> {
    const length = Number(request.headers.get("Content-Length") ?? "0");
    if (length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);

    const nowS = now();
    const verdict = await verifySignature({
      secret: opts.secret,
      timestampHeader: request.headers.get("X-FB-Timestamp"),
      signatureHeader: request.headers.get("X-FB-Signature"),
      rawBody,
      nowSeconds: nowS,
    });
    if (!verdict.ok) return json({ error: verdict.reason }, verdict.status);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return json({ error: "body is not JSON" }, 400);
    }
    const snap = parseSnapshot(parsed);
    if (!snap.ok) return json({ error: snap.error }, 400);

    // Claim the signature only after the body is known good, so a rejected body can be fixed and resent.
    if (!(await store.claimSignature(verdict.signature, verdict.ts, nowS))) {
      return json({ error: "replayed signature" }, 409);
    }
    const version = await store.putSnapshot(snap.value, nowS);
    return json({ ok: true, version }, 200);
  }

  async function flagWebhook(request: Request): Promise<Response> {
    const rawBody = await readCapped(request, MAX_WEBHOOK_BYTES);
    if (rawBody === null) return json({ error: "body too large" }, 413);
    const verdict = await verifyFlagsmithSignature({
      secret: opts.flagsmithSecret ?? "",
      signatureHeader: request.headers.get("X-Flagsmith-Signature"),
      rawBody,
    });
    if (!verdict.ok) return json({ error: verdict.reason }, verdict.status);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return json({ error: "body is not JSON" }, 400);
    }
    const nowS = now();
    const change = await parseFlagWebhook(parsed, nowS);
    if (!change.ok) return json({ error: change.error }, 400);
    const stored = await store.addFlagChange(change.value, await dedupeKey(change.value), nowS);
    // A duplicate is answered 200 so Flagsmith does not keep retrying a delivery we already hold.
    return json({ ok: true, stored }, 200);
  }

  /**
   * Adds one address to the updates list. Same-origin only: the request must carry an Origin, and
   * it must be this Worker's own origin or one the site is served from. Answers JSON to a script
   * and a small page to a plain form post.
   */
  async function joinWaitlist(request: Request, cors: Record<string, string>): Promise<Response> {
    const wantsJson = (request.headers.get("Content-Type") ?? "").includes("application/json") || (request.headers.get("Accept") ?? "").includes("application/json");
    let said: { wants: ReturnType<typeof cleanWants>; stack: string } = { wants: "", stack: "" };
    const answer = (state: JoinState, extra: Record<string, string> = {}): Response => {
      const c = JOIN_COPY[state];
      if (wantsJson) return json({ ok: state === "joined" || state === "already", state, message: `${c.title} ${c.text}` }, c.status, { ...cors, ...extra });
      return new Response(joinPage(state, said), { status: c.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extra } });
    };
    const origin = request.headers.get("Origin");
    const own = new URL(request.url).origin;
    if (!origin || !(origin === own || opts.allowedOrigins.includes(origin))) return json({ error: "origin not allowed" }, 403);

    const rawBody = await readCapped(request, WAITLIST_MAX_BODY_BYTES);
    if (rawBody === null) return json({ error: "body too large" }, 413, cors);
    const body = parseJoinBody(request.headers.get("Content-Type") ?? "", rawBody);
    if (!body) return json({ error: "send JSON or a form" }, 415, cors);

    const nowS = now();
    try {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const key = await attemptKey(opts.waitlistSalt || opts.secret, ip, nowS);
      const attempts = await store.waitlistAttempt(key, nowS, nowS - WAITLIST_WINDOW_SECONDS, nowS - WAITLIST_ATTEMPT_TTL_SECONDS);
      if (attempts > WAITLIST_MAX_ATTEMPTS) return answer("slow", { "Retry-After": String(WAITLIST_WINDOW_SECONDS) });
      // A filled trap field means a script: answer as if it worked and store nothing.
      if (typeof body.trap === "string" && body.trap.trim() !== "") return answer("joined");
      const email = cleanEmail(body.email);
      if (!email) return answer("invalid");
      said = { wants: cleanWants(body.wants), stack: cleanStack(body.stack) };
      const added = await store.joinWaitlist({ email, wants: said.wants, stack: said.stack, source: cleanSource(body.source) }, nowS);
      return answer(added ? "joined" : "already");
    } catch {
      return answer("error");
    }
  }

  function stream(request: Request, cors: Record<string, string>, experiment?: string, feature?: string): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    let closed = false;
    request.signal?.addEventListener("abort", () => {
      closed = true;
    });

    const write = async (text: string) => {
      try {
        await writer.write(enc.encode(text));
      } catch {
        closed = true;
      }
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const run = async () => {
      const started = Date.now();
      await write("retry: 3000\n\n");
      let current = await store.latest(experiment);
      await write(sseEvent(current));
      let flags = await store.flagHistory({ feature });
      await write(flagsEvent(flags));
      let lastVersion = await store.version();
      let lastBeat = Date.now();
      while (!closed && Date.now() - started < maxStreamMs) {
        await sleep(pollMs);
        if (closed) break;
        try {
          const v = await store.version();
          if (v !== lastVersion) {
            lastVersion = v;
            const next = await store.latest(experiment);
            if (next && (!current || next.version !== current.version)) {
              current = next;
              await write(sseEvent(current));
              lastBeat = Date.now();
            }
            const nextFlags = await store.flagHistory({ feature });
            if (lastId(nextFlags) !== lastId(flags)) {
              flags = nextFlags;
              await write(flagsEvent(flags));
              lastBeat = Date.now();
            }
          }
        } catch {
          // A transient D1 error should not end the stream; try again on the next poll.
        }
        if (Date.now() - lastBeat >= heartbeatMs) {
          await write(`: heartbeat ${now()}\n\n`);
          lastBeat = Date.now();
        }
      }
      try {
        await writer.close();
      } catch {
        // already closed by the client
      }
    };
    const done = run();

    return Object.assign(
      new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          ...cors,
        },
      }),
      { done },
    );
  }

  return {
    async fetch(request: Request, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
      const url = new URL(request.url);
      const cors = corsHeaders(request, opts.allowedOrigins);
      const experimentParam = url.searchParams.get("experiment") ?? undefined;
      const experiment = experimentParam && /^[a-z0-9_-]{1,32}$/.test(experimentParam) ? experimentParam : undefined;
      const featureParam = url.searchParams.get("feature") ?? undefined;
      const feature = featureParam && FEATURE_PARAM.test(featureParam) ? featureParam : undefined;

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }
      if (url.pathname === "/ingest") {
        if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { Allow: "POST" });
        return ingest(request);
      }
      if (url.pathname === "/flagsmith/webhook") {
        if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { Allow: "POST" });
        return flagWebhook(request);
      }
      if (url.pathname === "/waitlist") {
        if (request.method === "POST") return joinWaitlist(request, cors);
        // The form lives on the updates page; nothing is ever listed here.
        if (request.method === "GET" || request.method === "HEAD") return new Response(null, { status: 303, headers: { Location: "/updates" } });
        return json({ error: "method not allowed" }, 405, { Allow: "GET, POST" });
      }
      if (url.pathname === "/waitlist/count" && request.method === "GET") {
        const n = await store.waitlistCount();
        return json({ count: n >= WAITLIST_MIN_PUBLIC_COUNT ? n : null }, 200, cors);
      }
      if (url.pathname === "/flags/history" && request.method === "GET") {
        const limitParam = Number(url.searchParams.get("limit") ?? "");
        const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined;
        return json({ changes: await store.flagHistory({ feature, limit }) }, 200, cors);
      }
      if (url.pathname === "/state" && request.method === "GET") {
        const s = await store.latest(experiment);
        return json(s ? s.snapshot : null, 200, {
          ...cors,
          ...(s ? { "X-Board-Version": String(s.version) } : {}),
        });
      }
      if (url.pathname === "/stream" && request.method === "GET") {
        const res = stream(request, cors, experiment, feature);
        ctx?.waitUntil((res as Response & { done: Promise<void> }).done);
        return res;
      }
      if (url.pathname === "/" && request.method === "GET") {
        return json({ ok: true, endpoints: ["POST /ingest", "POST /flagsmith/webhook", "GET /state", "GET /flags/history", "GET /stream", "POST /waitlist", "GET /waitlist/count"] }, 200, cors);
      }
      return json({ error: "not found" }, 404, cors);
    },
  };
}
