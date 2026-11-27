/**
 * A stand-in for Flagsmith's SDK and events APIs, for tests only. It answers the four endpoints the
 * `@flagsmith/nodejs` client calls, from the fixture environment document, and writes down every
 * request. It can be used as a `fetch` (no socket at all) or served on 127.0.0.1.
 *
 * No test in this package talks to a real Flagsmith.
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { explainAssignment } from "forkbill";

// dist/test/ -> kit/ts/test/fixtures (written by make_fixtures.py from the Python implementation)
const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, "..", "..", "..", "ts", "test", "fixtures");
export const REPO_ROOT = join(HERE, "..", "..", "..", "..");
export const ENVIRONMENT_FILE = join(FIXTURES, "environment.json");

export interface Vector {
  identity: string;
  segment_percentage: number;
  in_rollout: boolean;
  split_percentage: number;
  independent_variant: string | null;
  engine_variant: string | null;
  engine_in_experiment: boolean | null;
}

export const DOCUMENT: Record<string, any> = JSON.parse(readFileSync(ENVIRONMENT_FILE, "utf8"));
export const VECTORS: Vector[] = JSON.parse(readFileSync(join(FIXTURES, "vectors.json"), "utf8")).assignments;

export const KEY = "ser.fixture";
export const ORIGIN = "http://flagsmith.test";

/** An identity from the Python vectors that is in the rollout with this variant, or outside it. */
export function identityFor(variant: "control" | "lanes_v1" | "lanes_v2" | "outside", n = 0): string {
  const found = VECTORS.filter((v) =>
    variant === "outside" ? !v.in_rollout : v.in_rollout && v.independent_variant === variant,
  )[n];
  if (!found) throw new Error(`no fixture identity for ${variant}`);
  return found.identity;
}

export interface Recorded {
  method: string;
  path: string;
  key: string | null;
  body: any;
}

export interface FakeOptions {
  /** HTTP status for flag reads (identities, flags, environment document) instead of 200. */
  flagsStatus?: number;
  /** HTTP status for the events endpoint instead of 202, or "network" for a connection error. */
  eventsStatus?: number | "network";
  /** Turn the kill switch on. */
  killed?: boolean;
  /** Serve this as the value of every arm of the routing flag. */
  routingValue?: string;
  /** Leave the kill switch out of the environment. */
  noKillFlag?: boolean;
  /** Answer identity reads as Edge Proxy 2.24.0 does: no variant and no metadata. */
  edgeProxy?: boolean;
}

interface Reply {
  status: number;
  body: unknown;
}

export class FakeFlagsmith {
  readonly requests: Recorded[] = [];
  private readonly accepted: any[] = [];
  options: FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.options = options;
  }

  private states(): Array<Record<string, any>> {
    return (DOCUMENT["feature_states"] as Array<Record<string, any>>).filter(
      (fs) => !(this.options.noKillFlag && fs["feature"].name === "routing_kill"),
    );
  }

  private flag(fs: Record<string, any>, identity: string | null): Record<string, unknown> {
    const name: string = fs["feature"].name;
    if (name === "routing_kill") {
      return { feature: fs["feature"], enabled: Boolean(this.options.killed), feature_state_value: null };
    }
    if (identity === null) {
      return { feature: fs["feature"], enabled: fs["enabled"], feature_state_value: fs["feature_state_value"] };
    }
    const w = explainAssignment(DOCUMENT, identity, name);
    const exp = w.featureState.experiment;
    if (this.options.edgeProxy) {
      return { feature: fs["feature"], enabled: w.featureState.enabled, feature_state_value: w.value, reason: "DEFAULT" };
    }
    return {
      feature: fs["feature"],
      enabled: w.featureState.enabled,
      feature_state_value: this.options.routingValue ?? w.value,
      variant: w.variant,
      reason: w.featureState.source === "segment_override" ? "TARGETING_MATCH" : "DEFAULT",
      metadata: exp ? { experiment: { id: exp.id, name: exp.name, in_experiment: exp.inExperiment } } : {},
    };
  }

  handle(method: string, path: string, key: string | null, body: any): Reply {
    this.requests.push({ method, path, key, body });
    if (path === "/api/v1/events") {
      const status = this.options.eventsStatus ?? 202;
      if (status === "network") throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
      if (status >= 200 && status < 300) this.accepted.push(...body.events);
      return { status, body: {} };
    }
    const status = this.options.flagsStatus ?? 200;
    if (status !== 200) return { status, body: { detail: "refused by the fake" } };
    if (method === "POST" && path === "/api/v1/identities/") {
      const identity = String(body.identifier);
      return { status: 200, body: { identifier: identity, traits: body.traits ?? [], flags: this.states().map((fs) => this.flag(fs, identity)) } };
    }
    if (method === "GET" && path === "/api/v1/flags/") {
      return { status: 200, body: this.states().map((fs) => this.flag(fs, null)) };
    }
    if (method === "GET" && path === "/api/v1/environment-document/") {
      const doc = structuredClone(DOCUMENT);
      for (const fs of doc["feature_states"]) if (fs.feature.name === "routing_kill") fs.enabled = Boolean(this.options.killed);
      return { status: 200, body: doc };
    }
    return { status: 404, body: { detail: `the fake has no ${method} ${path}` } };
  }

  /** The fake as a `fetch`. A request to any other origin fails the test that made it. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== ORIGIN) throw new Error(`a test tried to reach ${url.origin}`);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const reply = this.handle(init?.method ?? "GET", url.pathname, headers.get("x-environment-key"), body);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  };

  /** Serve the fake on a free port of 127.0.0.1. */
  async listen(): Promise<{ origin: string; close(): Promise<void> }> {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const key = req.headers["x-environment-key"];
        let reply: Reply;
        try {
          reply = this.handle(
            req.method ?? "GET",
            new URL(req.url ?? "/", "http://127.0.0.1").pathname,
            typeof key === "string" ? key : null,
            text ? JSON.parse(text) : undefined,
          );
        } catch {
          req.socket.destroy();
          return;
        }
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      origin: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  /** Events the fake accepted, flattened. */
  events(): Array<{ event: string; identifier: string | null; value: string | null; feature_name: string | null; traits: unknown }> {
    return this.accepted;
  }

  paths(): string[] {
    return this.requests.map((r) => `${r.method} ${r.path}`);
  }
}

export function testEnv(extra: Record<string, string> = {}, origin = ORIGIN): Record<string, string> {
  return {
    FLAGSMITH_SERVER_KEY: KEY,
    FLAGSMITH_SDK_API_URL: `${origin}/api/v1/`,
    FLAGSMITH_EVENTS_API_URL: `${origin}/api/`,
    FORKBILL_RETRIES: "0",
    FORKBILL_LOG_LEVEL: "silent",
    ...extra,
  };
}

/** The text of the first item of a resources/read result. */
export function resourceText(result: { contents: unknown[] }): string {
  const first = result.contents[0] as { text?: unknown } | undefined;
  return String(first?.text ?? "");
}
