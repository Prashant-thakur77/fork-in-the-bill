#!/usr/bin/env node
/**
 * `forkbill-mcp`: the server on stdio. stdout carries the protocol and nothing else; logs go to
 * stderr and never contain the environment key.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ENV } from "./config.js";
import { createForkbillServer } from "./server.js";

const HELP = `forkbill-mcp: an MCP server (stdio) that puts an agent's model routing behind a Flagsmith experiment.

Usage: forkbill-mcp            start the server on stdin/stdout
       forkbill-mcp --help     show this text

Configuration is by environment variable only:
  ${ENV.key[0]}             Flagsmith environment key (or ${ENV.key[1]})
  ${ENV.apiUrl[0]}            SDK API base for self-hosted Flagsmith, e.g. http://localhost:8000/api/v1/
  ${ENV.eventsApiUrl[0]}         events API base, e.g. http://localhost:8000/api/ (required with the line above)
  ${ENV.edgeUrl[0]}           Edge Proxy SDK base, for the edge modes
  ${ENV.mode[0]}                    remote (default), local, edge or edge-local
  ${ENV.flag[0]}                    routing flag name (default agent_routing)
  ${ENV.killFlag[0]}               kill switch flag name (default routing_kill; "none" turns it off)
  ${ENV.pricingFile[0]}            path of a pricing table to use instead of the built-in one
  ${ENV.timeout[0]} request timeout for flag reads (default 10)
  ${ENV.retries[0]}                 retries of a flag read after a network error (default 3)
  ${ENV.logLevel[0]}               debug, info, warn (default), error or silent; logs go to stderr
`;

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stderr.write(HELP);
    return;
  }
  const app = createForkbillServer({ env: process.env });
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await app.close().catch(() => undefined);
    await app.server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  // The client hanging up ends the session: send what is buffered, then leave.
  process.stdin.on("end", () => void shutdown());
  process.stdin.on("close", () => void shutdown());
  await app.server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`forkbill-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
