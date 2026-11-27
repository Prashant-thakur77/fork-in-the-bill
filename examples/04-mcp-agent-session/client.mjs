// A minimal MCP client: starts `npx -y forkbill-mcp` and talks JSON-RPC 2.0 to it over stdio,
// one JSON message per line, the way an MCP host does. It has no dependencies, so every byte
// that crosses the pipe is in the transcript.
//
//   node client.mjs <environment-document.json> <transcript.jsonl>
//
// The "agent" here is SIMULATED: no model is called. The token counts, the outcome and the
// turn count for the one task are fixed numbers below.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream } from "node:fs";

const [documentPath, transcriptPath] = process.argv.slice(2);
if (!documentPath || !transcriptPath) throw new Error("usage: node client.mjs <environment-document.json> <transcript.jsonl>");
for (const name of ["FLAGSMITH_SERVER_KEY", "FLAGSMITH_SDK_API_URL", "FLAGSMITH_EVENTS_API_URL"]) {
  if (!process.env[name]) throw new Error(`${name} is not set`);
}
const IDENTITY = process.env.MCP_IDENTITY ?? "ex04:task-0001";
const PACKAGE = process.env.FORKBILL_MCP_PACKAGE ?? "forkbill-mcp@0.1.0";

// The server gets the three Flagsmith settings and nothing else from this shell.
const server = spawn("npx", ["-y", PACKAGE], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    FLAGSMITH_SERVER_KEY: process.env.FLAGSMITH_SERVER_KEY,
    FLAGSMITH_SDK_API_URL: process.env.FLAGSMITH_SDK_API_URL,
    FLAGSMITH_EVENTS_API_URL: process.env.FLAGSMITH_EVENTS_API_URL,
  },
});
const transcript = createWriteStream(transcriptPath);
const record = (direction, message) => transcript.write(`${JSON.stringify({ direction, message })}\n`);

const waiting = new Map();
createInterface({ input: server.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  record("server->client", message);
  if (message.id !== undefined && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
});
server.on("exit", (code) => {
  for (const resolve of waiting.values()) resolve({ error: { message: `server exited with code ${code}` } });
});

let nextId = 1;
function send(message) {
  record("client->server", message);
  server.stdin.write(`${JSON.stringify(message)}\n`);
}
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, (reply) => (reply.error ? reject(new Error(`${method}: ${reply.error.message}`)) : resolve(reply.result)));
    send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
  });
}
async function callTool(name, args) {
  const result = await request("tools/call", { name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${result.content?.[0]?.text ?? "tool error"}`);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

const init = await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "forkbill-example-client", version: "0.1.0" },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
console.log(`server: ${init.serverInfo.name} ${init.serverInfo.version}, protocol ${init.protocolVersion}`);

const { tools } = await request("tools/list");
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

const kill = await callTool("get_kill_switch", {});
console.log(`get_kill_switch: ${kill.flag} enabled=${kill.enabled}`);

const routed = await callTool("get_routing_policy", { identity: IDENTITY, traits: { repo: "acme/widgets", language: "go" } });
console.log(
  `get_routing_policy: ${IDENTITY} -> variant ${routed.variant} (source ${routed.source}, exposure_recorded ${routed.exposure_recorded}), ` +
    `main ${routed.policy.main.model}, delegate ${routed.policy.delegate.model}`,
);

// SIMULATED task: the token counts an agent would have counted per lane while it worked.
const priced = await callTool("price_usage", {
  identity: IDENTITY,
  calls: [
    { lane: "main", input_tokens: 20000, output_tokens: 2000 },
    { lane: "delegate", input_tokens: 150000, output_tokens: 6000 },
  ],
});
console.log(`price_usage: $${priced.total_usd} of a $${priced.cap_usd} cap, over_budget=${priced.over_budget}`);

const outcome = await callTool("report_outcome", {
  identity: IDENTITY,
  cost_usd: priced.total_usd,
  solved: true,
  turns: 5,
  seconds: 61.5,
});
console.log(`report_outcome: delivered=${outcome.delivered}, events ${outcome.events.map((e) => `${e.event}=${e.value}`).join(", ")}`);

const explained = await callTool("explain_assignment", { identity: IDENTITY, environment_document_path: documentPath });
console.log(`explain_assignment (offline, from ${documentPath}):`);
console.log(explained.explanation.replace(/^/gm, "  "));
console.log(
  `  md5 working and Flagsmith's engine agree: ${explained.agree}; matches what this session was served: ${explained.matches_session}`,
);

const config = await request("resources/read", { uri: "forkbill://config" });
console.log(`forkbill://config: ${config.contents[0].text.replace(/\s+/g, " ")}`);

server.stdin.end();
await new Promise((resolve) => server.on("exit", resolve));
await new Promise((resolve) => transcript.end(resolve));
if (explained.agree !== true || explained.matches_session !== true) {
  throw new Error("the offline re-derivation does not match the arm Flagsmith served");
}
