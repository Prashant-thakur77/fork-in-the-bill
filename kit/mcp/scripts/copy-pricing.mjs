// Ship the study's pricing table with the build, so the server has a default table and the
// repository keeps a single copy of it (harness/pricing.json).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "..", "harness", "pricing.json");
const to = join(here, "..", "dist", "pricing.json");
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
