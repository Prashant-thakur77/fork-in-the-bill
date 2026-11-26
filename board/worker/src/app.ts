import { verifySignature } from "./hmac";
import { parseSnapshot } from "./payload";
import type { Store, StoredSnapshot } from "./store";

export interface AppOptions {
  store: Store;
  secret: string;
  allowedOrigins: string[];
  now?: () => number; // unix seconds
  pollMs?: number;
  heartbeatMs?: number;
  maxStreamMs?: number;
}

const MAX_BODY_BYTES = 16 * 1024;

function corsHeaders(request: Request, allowed: string[]): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !(allowed.includes(origin) || allowed.includes("*"))) return {};
  return {
    "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID",
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

  function stream(request: Request, cors: Record<string, string>, experiment?: string): Response {
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

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }
      if (url.pathname === "/ingest") {
        if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { Allow: "POST" });
        return ingest(request);
      }
      if (url.pathname === "/state" && request.method === "GET") {
        const s = await store.latest(experiment);
        return json(s ? s.snapshot : null, 200, {
          ...cors,
          ...(s ? { "X-Board-Version": String(s.version) } : {}),
        });
      }
      if (url.pathname === "/stream" && request.method === "GET") {
        const res = stream(request, cors, experiment);
        ctx?.waitUntil((res as Response & { done: Promise<void> }).done);
        return res;
      }
      if (url.pathname === "/" && request.method === "GET") {
        return json({ ok: true, endpoints: ["POST /ingest", "GET /state", "GET /stream"] }, 200, cors);
      }
      return json({ error: "not found" }, 404, cors);
    },
  };
}
