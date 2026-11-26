/** Token usage and pluggable pricing (US dollars per million tokens). */

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheReadTokens?: number;
}

export interface Pricing {
  cost(model: string, usage: Usage): number;
}

export interface ModelPrice {
  input: number;
  output: number;
  cache_write_5m?: number;
  cache_write_1h?: number;
  cache_read?: number;
}

export function totalTokens(u: Usage): number {
  return (
    (u.inputTokens ?? 0) +
    (u.outputTokens ?? 0) +
    (u.cacheWrite5mTokens ?? 0) +
    (u.cacheWrite1hTokens ?? 0) +
    (u.cacheReadTokens ?? 0)
  );
}

/** Prices from a table shaped like the Python kit's: `{"models": {"<id>": {"input": .., ...}}}`. */
export class TablePricing implements Pricing {
  private readonly prices: Map<string, ModelPrice>;

  constructor(table: { models: Record<string, ModelPrice> } | Record<string, ModelPrice>) {
    const models = "models" in table && typeof table.models === "object" ? table.models : table;
    this.prices = new Map(Object.entries(models as Record<string, ModelPrice>));
  }

  cost(model: string, u: Usage): number {
    const p = this.prices.get(model);
    if (p === undefined) throw new Error(`no price for model "${model}"`);
    return (
      ((u.inputTokens ?? 0) * p.input +
        (u.outputTokens ?? 0) * p.output +
        (u.cacheWrite5mTokens ?? 0) * (p.cache_write_5m ?? 0) +
        (u.cacheWrite1hTokens ?? 0) * (p.cache_write_1h ?? 0) +
        (u.cacheReadTokens ?? 0) * (p.cache_read ?? 0)) /
      1_000_000
    );
  }
}

/** Map an Anthropic Messages API `usage` object to Usage. */
export function usageFromAnthropic(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}): Usage {
  const creation = usage.cache_creation ?? undefined;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheWrite5mTokens: creation ? (creation.ephemeral_5m_input_tokens ?? 0) : (usage.cache_creation_input_tokens ?? 0),
    cacheWrite1hTokens: creation ? (creation.ephemeral_1h_input_tokens ?? 0) : 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}
