// Ask Flagsmith which routing policy each task gets, run the task, report how it ended.
import { Flagsmith } from "@flagsmith/nodejs";
import { RoutedLanes, TablePricing, flagsmithConfig, md5 } from "forkbill";

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

// Illustrative prices in US dollars per million tokens, not a provider's list prices.
const pricing = new TablePricing({
  models: { "claude-sonnet-5-5": { input: 3, output: 15 }, "claude-haiku-5-5": { input: 1, output: 5 } },
});

// SIMULATED agent: no model is called. Tokens and the outcome are fixed by the identity.
function simulatedTask(lanes: RoutedLanes): { solved: boolean; turns: number; seconds: number } {
  const rand = (label: string): number => parseInt(md5(`${lanes.identity}:${label}`).slice(0, 8), 16) / 2 ** 32;
  const between = (label: string, lo: number, hi: number): number => Math.floor(lo + rand(label) * (hi - lo + 1));
  const turns = between("turns", 4, 12);
  for (let t = 0; t < turns; t++) {
    lanes.recordCall("main", { inputTokens: between(`in${t}`, 2000, 6000), outputTokens: between(`out${t}`, 200, 800) });
    if (rand(`delegate${t}`) < 0.5) {
      // grunt work goes to the model the policy names for the delegate lane
      lanes.recordCall("delegate", { inputTokens: between(`din${t}`, 8000, 20000), outputTokens: between(`dout${t}`, 300, 1500) });
    }
  }
  return { solved: rand("solved") < 0.6, turns, seconds: Math.round(turns * (5 + 5 * rand("pace")) * 10) / 10 };
}

const flagsmith = new Flagsmith(
  flagsmithConfig("remote", {
    environmentKey: env("FLAGSMITH_SERVER_KEY"),
    apiUrl: env("FLAGSMITH_SDK_API_URL"),
    eventsApiUrl: env("FLAGSMITH_EVENTS_API_URL"),
  }),
);
const arms: Record<string, number> = {};
let exposures = 0;
let events = 0;
for (let i = 0; i < 8; i++) {
  // Reads the kill switch, then the policy; Flagsmith picks the arm and the exposure is recorded.
  const lanes = await RoutedLanes.create({ flagsmith, identity: `ex02:task-${String(i).padStart(2, "0")}`, pricing });
  const { solved, turns, seconds } = simulatedTask(lanes);
  // Sends task_cost, task_solved (only when solved), task_turns and task_seconds for the same identity.
  const result = await lanes.finish(solved, turns, seconds);
  const arm = String(result.variant);
  arms[arm] = (arms[arm] ?? 0) + 1;
  exposures += result.exposed ? 1 : 0;
  events += result.events.length;
  console.log(
    `${result.identity}  arm=${arm.padEnd(8)}  delegate=${lanes.delegateModel.padEnd(17)}  ` +
      `$${result.usd.toFixed(4)}  solved=${String(result.solved).padEnd(5)}  sent: ${result.events.map(([name]) => name).join(", ")}`,
  );
}
await flagsmith.close();
const served = Object.fromEntries(Object.entries(arms).sort());
console.log(`arms Flagsmith served: ${JSON.stringify(served)}  (simulated tasks, illustrative prices)`);
console.log(`sent to Flagsmith: ${exposures} exposures + ${events} task events = ${exposures + events}`);
