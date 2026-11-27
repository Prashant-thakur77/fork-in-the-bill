// Screenshots of the self-hosted Flagsmith dashboard after example 03 has run.
//
//   FLAGSMITH_DASHBOARD_URL=http://localhost:8000 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//   FLAGSMITH_ENV_KEY=<client-side key> node dashboard.mjs <experiment id> <output directory>
//
// The admin email and password are in selfhost/.state/credentials.env and the environment key
// in selfhost/.state/flagsmith.json. When Flagsmith runs on another machine, forward its port
// first: ssh -N -L 8000:127.0.0.1:8000 <host>.
import { chromium } from "playwright";

const [experimentId, outDir] = process.argv.slice(2);
if (!experimentId || !outDir) throw new Error("usage: node dashboard.mjs <experiment id> <output directory>");
const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const base = need("FLAGSMITH_DASHBOARD_URL").replace(/\/$/, "");
const env = `${base}/project/${process.env.FLAGSMITH_PROJECT_ID ?? "1"}/environment/${need("FLAGSMITH_ENV_KEY")}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[name="email"]', { timeout: 30000 });
await page.fill('input[name="email"]', need("ADMIN_EMAIL"));
await page.fill('input[name="password"]', need("ADMIN_PASSWORD"));
await page.keyboard.press("Enter");
await page.waitForURL(/organisation|project/, { timeout: 30000 });

async function shot(path, waitForText, file, fullPage = false) {
  await page.goto(`${env}/${path}`, { waitUntil: "domcontentloaded" });
  await page.getByText(waitForText).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000); // charts and counts render after the first paint
  await page.screenshot({ path: `${outDir}/${file}`, fullPage });
  console.log(`${file}: ${path}`);
}

await shot("experiments", "Linked Flag", "flagsmith-experiments.png");
await shot(`experiments/${experimentId}`, "task_cost", "flagsmith-experiment-results.png", true);
await browser.close();
