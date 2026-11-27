/**
 * `@flagsmith/nodejs` constructor options for the kit's evaluation modes, matching the Python
 * kit's `forkbill.client`:
 *
 * - `remote`: flags from the core API (`POST /identities/` per read);
 * - `local`: flags evaluated in process from the environment document (server-side key);
 * - `edge`: flags from an Edge Proxy (`POST /identities/` per read);
 * - `edge-local`: flags evaluated in process from the Edge Proxy's copy of the document.
 *
 * Events always go to the core API's events endpoint. In `@flagsmith/nodejs` 9.5 the local
 * evaluation mapper keeps `experiment` on identity flags, so `getExperimentFlag` records exposures
 * under local evaluation. Edge Proxy 2.24.0 returns no `variant` or `metadata` on identity flags,
 * so in `edge` mode no exposure is recorded. The 9.5 client has no analytics URL option, so leave
 * `enableAnalytics` off in the edge modes.
 */

import type { FlagsmithConfig } from "@flagsmith/nodejs";

export const MODES = ["remote", "local", "edge", "edge-local"] as const;
export type Mode = (typeof MODES)[number];

export interface ModeOptions {
  environmentKey: string;
  /** Core API SDK base, e.g. `http://localhost:8000/api/v1/`. */
  apiUrl?: string;
  /** Core API events base, e.g. `http://localhost:8000/api/`. Required in the edge modes. */
  eventsApiUrl?: string;
  /** Edge Proxy SDK base, e.g. `http://localhost:8001/api/v1/`. Required in the edge modes. */
  edgeUrl?: string;
  refreshSeconds?: number;
  maxBuffer?: number;
}

const slash = (url: string): string => (url.endsWith("/") ? url : `${url}/`);

export function flagsmithConfig(mode: Mode, opts: ModeOptions): FlagsmithConfig {
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${String(mode)}; expected one of ${MODES.join(", ")}`);
  const local = mode === "local" || mode === "edge-local";
  const edge = mode === "edge" || mode === "edge-local";
  if (local && !opts.environmentKey.startsWith("ser.")) {
    throw new Error(`mode ${mode} evaluates locally and needs a server-side key (ser.*)`);
  }
  if (edge && !opts.edgeUrl) throw new Error(`mode ${mode} needs edgeUrl, the Edge Proxy's /api/v1/ URL`);
  if (edge && !opts.eventsApiUrl) {
    throw new Error(`mode ${mode} needs eventsApiUrl: the Edge Proxy does not accept events`);
  }
  const flagsUrl = edge ? opts.edgeUrl : opts.apiUrl;
  const events: NonNullable<FlagsmithConfig["eventProcessorConfig"]> = {};
  if (opts.eventsApiUrl) events.eventsApiUrl = slash(opts.eventsApiUrl);
  if (opts.maxBuffer !== undefined) events.maxBuffer = opts.maxBuffer;
  const config: FlagsmithConfig = {
    environmentKey: opts.environmentKey,
    enableEvents: true,
    enableLocalEvaluation: local,
    eventProcessorConfig: events,
  };
  if (flagsUrl) config.apiUrl = slash(flagsUrl);
  if (local) config.environmentRefreshIntervalSeconds = opts.refreshSeconds ?? 60;
  return config;
}
