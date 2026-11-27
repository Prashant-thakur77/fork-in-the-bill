/**
 * The Flagsmith client the tools use: the real `@flagsmith/nodejs` client, configured by the kit's
 * `flagsmithConfig` for the chosen mode. Nothing here reads a flag or decides anything.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Flagsmith, LocalFileHandler } from "@flagsmith/nodejs";
import { pino, type Logger as PinoLogger } from "pino";

import { ConfigError, ENV, type LogLevel, type ServerConfig } from "./config.js";
import { DeliveryLog, type Fetch } from "./delivery.js";
import { flagsmithConfig, type FlagsmithLike, type Logger } from "forkbill";

/**
 * A logger on stderr. stdout carries the MCP protocol, and the SDK's default logger writes there,
 * so every client this server builds is given this one instead.
 */
export function stderrLogger(level: LogLevel): PinoLogger {
  return pino(
    { base: { name: "forkbill-mcp" }, level, redact: ["environmentKey", "*.environmentKey", 'headers["X-Environment-Key"]'] },
    pino.destination({ dest: 2, sync: true }),
  );
}

export function kitLogger(log: PinoLogger): Logger {
  return { warn: (message) => log.warn(message), error: (message) => log.error(message) };
}

export interface FlagsmithHandle {
  client: FlagsmithLike;
  deliveries: DeliveryLog;
  close(timeoutMs?: number): Promise<void>;
}

/** Build the client for `config`. Throws `ConfigError` when the configuration cannot work. */
export function connect(config: ServerConfig, log: PinoLogger, baseFetch: Fetch = fetch): FlagsmithHandle {
  if (config.environmentKey === null) {
    throw new ConfigError(
      `no Flagsmith environment key: set ${ENV.key[0]} (or ${ENV.key[1]}) in the server's environment`,
    );
  }
  const deliveries = new DeliveryLog();
  let client: Flagsmith;
  try {
    const options = flagsmithConfig(config.mode, {
      environmentKey: config.environmentKey,
      ...(config.apiUrl !== null ? { apiUrl: config.apiUrl } : {}),
      ...(config.eventsApiUrl !== null ? { eventsApiUrl: config.eventsApiUrl } : {}),
      ...(config.edgeUrl !== null ? { edgeUrl: config.edgeUrl } : {}),
    });
    client = new Flagsmith({
      ...options,
      fetch: deliveries.wrap(baseFetch),
      logger: log,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
      retries: config.retries,
    });
  } catch (err) {
    throw new ConfigError(configHint((err as Error).message));
  }
  return { client, deliveries, close: (timeoutMs) => client.close(timeoutMs) };
}

/** The kit names its options; say which environment variable sets each one. */
function configHint(message: string): string {
  return message
    .replace("edgeUrl", `${ENV.edgeUrl[0]} (edgeUrl)`)
    .replace("eventsApiUrl", `${ENV.eventsApiUrl[0]} (eventsApiUrl)`)
    .replace("needs a server-side key (ser.*)", `needs a server-side key (ser.*) in ${ENV.key[0]}`);
}

export interface EngineFlag {
  variant: string | null;
  enabled: boolean;
  reason: string | null;
  inExperiment: boolean | null;
  /** The value the engine serves for the flag. */
  value: unknown;
}

/**
 * Evaluate one identity against an environment document with Flagsmith's own engine, the code the
 * SDK runs under local evaluation. The client is offline: it is given the document and makes no
 * network request.
 */
export async function engineEvaluate(
  document: unknown,
  identity: string,
  traits: Record<string, string | number | boolean | null>,
  flag: string,
  log: PinoLogger,
): Promise<EngineFlag> {
  // The SDK's offline handler reads a file, so the document goes through a private temp file.
  const dir = mkdtempSync(join(tmpdir(), "forkbill-mcp-"));
  let handler: LocalFileHandler;
  try {
    const file = join(dir, "environment.json");
    writeFileSync(file, JSON.stringify(document), { mode: 0o600 });
    handler = new LocalFileHandler(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const offline = new Flagsmith({ offlineMode: true, offlineHandler: handler, logger: log });
  const served = (await offline.getIdentityFlags(identity, traits)).getFlag(flag);
  if (served.isDefault) throw new Error(`${flag} is not in the environment document`);
  const f = served as { variant?: string; reason?: string; experiment?: { inExperiment: boolean } };
  return {
    variant: f.variant ?? null,
    enabled: served.enabled,
    reason: f.reason ?? null,
    inExperiment: f.experiment === undefined ? null : f.experiment.inExperiment,
    value: served.value,
  };
}

/** An error with the causes behind it, so a tool error carries what Flagsmith actually said. */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    const code = (current as { code?: unknown }).code;
    const text = typeof code === "string" && !message.includes(code) ? `${message} (${code})` : message;
    if (text && !parts.some((p) => p.includes(text))) parts.push(text);
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(": ");
}
