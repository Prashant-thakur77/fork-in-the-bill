/**
 * Configuration, read from environment variables only. The names match the rest of the kit:
 * `forkbill demo` reads the same key variables and `selfhost/bootstrap.sh` writes the same URL
 * variables, so `source selfhost/.state/credentials.env` is enough to point the server at a
 * self-hosted Flagsmith.
 */

import { MODES, type Mode } from "forkbill";

export const ENV = {
  key: ["FLAGSMITH_SERVER_KEY", "FLAGSMITH_ENVIRONMENT_KEY"],
  apiUrl: ["FLAGSMITH_SDK_API_URL", "FLAGSMITH_API_URL_SDK"],
  eventsApiUrl: ["FLAGSMITH_EVENTS_API_URL"],
  edgeUrl: ["FLAGSMITH_EDGE_API_URL"],
  mode: ["FORKBILL_MODE"],
  flag: ["FORKBILL_FLAG"],
  killFlag: ["FORKBILL_KILL_FLAG"],
  pricingFile: ["FORKBILL_PRICING_FILE"],
  timeout: ["FORKBILL_REQUEST_TIMEOUT_SECONDS"],
  retries: ["FORKBILL_RETRIES"],
  logLevel: ["FORKBILL_LOG_LEVEL"],
} as const;

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ServerConfig {
  /** Null when no key is set: the offline tools still work, the Flagsmith tools say what is missing. */
  environmentKey: string | null;
  mode: Mode;
  apiUrl: string | null;
  eventsApiUrl: string | null;
  edgeUrl: string | null;
  flag: string;
  /** Null when the kill switch is turned off with `FORKBILL_KILL_FLAG=none`. */
  killFlag: string | null;
  pricingFile: string | null;
  requestTimeoutSeconds: number;
  retries: number;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function read(env: Env, names: readonly string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function url(env: Env, names: readonly string[]): string | null {
  const value = read(env, names);
  if (value === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${names[0]} is not a URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(`${names[0]} must be an http or https URL`);
  }
  if (parsed.username || parsed.password) throw new ConfigError(`${names[0]} must not carry credentials`);
  return value;
}

function number(env: Env, names: readonly string[], dflt: number, opts: { min: number; integer?: boolean }): number {
  const value = read(env, names);
  if (value === null) return dflt;
  const n = Number(value);
  if (!Number.isFinite(n) || n < opts.min || (opts.integer && !Number.isInteger(n))) {
    throw new ConfigError(`${names[0]} must be ${opts.integer ? "a whole number" : "a number"} of at least ${opts.min}`);
  }
  return n;
}

/** The log level alone, for a server whose other settings could not be read. */
export function logLevelOf(env: Env): LogLevel {
  const level = read(env, ENV.logLevel);
  return level !== null && (LOG_LEVELS as readonly string[]).includes(level) ? (level as LogLevel) : "warn";
}

/** Read the configuration. Throws `ConfigError` naming the variable at fault, never its value. */
export function loadConfig(env: Env): ServerConfig {
  const mode = read(env, ENV.mode) ?? "remote";
  if (!(MODES as readonly string[]).includes(mode)) {
    throw new ConfigError(`FORKBILL_MODE must be one of ${MODES.join(", ")}`);
  }
  const logLevel = read(env, ENV.logLevel) ?? "warn";
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    throw new ConfigError(`FORKBILL_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
  }
  const apiUrl = url(env, ENV.apiUrl);
  const eventsApiUrl = url(env, ENV.eventsApiUrl);
  const edgeUrl = url(env, ENV.edgeUrl);
  if (apiUrl !== null && eventsApiUrl === null) {
    // Without it the SDK would post exposures and events to Flagsmith Cloud's events API.
    throw new ConfigError(
      "FLAGSMITH_SDK_API_URL points at your own Flagsmith, so FLAGSMITH_EVENTS_API_URL must be set too (for example http://localhost:8000/api/)",
    );
  }
  const killFlag = read(env, ENV.killFlag) ?? "routing_kill";
  return {
    environmentKey: read(env, ENV.key),
    mode: mode as Mode,
    apiUrl,
    eventsApiUrl,
    edgeUrl,
    flag: read(env, ENV.flag) ?? "agent_routing",
    killFlag: killFlag.toLowerCase() === "none" ? null : killFlag,
    pricingFile: read(env, ENV.pricingFile),
    requestTimeoutSeconds: number(env, ENV.timeout, 10, { min: 0.1 }),
    retries: number(env, ENV.retries, 3, { min: 0, integer: true }),
    logLevel: logLevel as LogLevel,
  };
}

function host(value: string | null, dflt: string): string {
  if (value === null) return dflt;
  const u = new URL(value);
  return `${u.protocol}//${u.host}${u.pathname}`;
}

/** The configuration as it may be shown to a client: the key is reported as set or not, never printed. */
export function describeConfig(config: ServerConfig): Record<string, unknown> {
  const local = config.mode === "local" || config.mode === "edge-local";
  const edge = config.mode === "edge" || config.mode === "edge-local";
  const key = config.environmentKey;
  return {
    mode: config.mode,
    flags_evaluated: local ? "in this process, from the environment document" : "by the API, one request per identity",
    environment_key: key === null ? "not set" : key.startsWith("ser.") ? "set (server-side)" : "set (client-side)",
    flags_api: edge ? host(config.edgeUrl, "not set") : host(config.apiUrl, "Flagsmith Cloud (SDK default)"),
    events_api: host(config.eventsApiUrl, "Flagsmith Cloud (SDK default)"),
    routing_flag: config.flag,
    kill_switch_flag: config.killFlag ?? "off (FORKBILL_KILL_FLAG=none)",
    exposures_recorded:
      config.mode === "edge"
        ? "no: an Edge Proxy identity response carries no variant or experiment, so use edge-local to run an experiment"
        : "yes, for identities enrolled in a running experiment",
    pricing_table: config.pricingFile ?? "bundled",
    request_timeout_seconds: config.requestTimeoutSeconds,
    retries: config.retries,
  };
}
