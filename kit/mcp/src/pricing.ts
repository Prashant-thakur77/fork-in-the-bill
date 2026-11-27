/**
 * The pricing table the server prices with: the one built into the package (the study's
 * `harness/pricing.json`, copied in at build time) or the file named by `FORKBILL_PRICING_FILE`.
 * The arithmetic is the kit's `TablePricing`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TablePricing, type ModelPrice } from "forkbill";

// dist/src/pricing.js -> dist/pricing.json
const BUNDLED = join(dirname(fileURLToPath(import.meta.url)), "..", "pricing.json");

export interface PricingTable {
  /** `bundled`, or the path of the file it was read from. */
  origin: string;
  source: string | null;
  checkedOn: string | null;
  unit: string;
  models: Record<string, ModelPrice>;
  pricing: TablePricing;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

const RATES = ["input", "output", "cache_write_5m", "cache_write_1h", "cache_read"] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Check a parsed table and keep the flat per-token rates the kit prices with. */
export function parsePricingTable(doc: unknown, origin: string): PricingTable {
  if (!isObj(doc) || !isObj(doc["models"])) {
    throw new PricingError(`${origin}: expected {"models": {"<model id>": {"input": .., "output": ..}}}`);
  }
  const models: Record<string, ModelPrice> = {};
  for (const [id, raw] of Object.entries(doc["models"])) {
    if (!isObj(raw)) throw new PricingError(`${origin}: price of ${id} is not an object`);
    const rates: Partial<Record<(typeof RATES)[number], number>> = {};
    for (const rate of RATES) {
      const value = raw[rate];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new PricingError(`${origin}: ${id}.${rate} must be a number of at least 0`);
      }
      rates[rate] = value;
    }
    const { input, output } = rates;
    if (input === undefined || output === undefined) {
      throw new PricingError(`${origin}: ${id} needs both an input and an output price`);
    }
    models[id] = { ...rates, input, output };
  }
  if (Object.keys(models).length === 0) throw new PricingError(`${origin}: the table has no models`);
  return {
    origin,
    source: typeof doc["source"] === "string" ? doc["source"] : null,
    checkedOn: typeof doc["checked_on"] === "string" ? doc["checked_on"] : null,
    unit: typeof doc["unit"] === "string" ? doc["unit"] : "USD per million tokens",
    models,
    pricing: new TablePricing({ models }),
  };
}

export function loadPricingTable(file: string | null): PricingTable {
  const path = file ?? BUNDLED;
  const origin = file ?? "bundled";
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new PricingError(`${origin}: cannot read the pricing table (${(err as Error).message})`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new PricingError(`${origin}: the pricing table is not JSON (${(err as Error).message})`);
  }
  return parsePricingTable(doc, origin);
}

/** The table as a client sees it. */
export function describePricing(table: PricingTable): Record<string, unknown> {
  return {
    table: table.origin,
    source: table.source,
    checked_on: table.checkedOn,
    unit: table.unit,
    note: "Flat per-token rates. A tier a provider charges above some prompt length is not applied.",
    models: table.models,
  };
}
