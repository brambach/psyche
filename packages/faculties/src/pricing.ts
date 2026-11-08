// Model tiers and prices. Haiku does almost all the language work; Sonnet thinks things through
// and designs buildings. Prices are US dollars per million tokens, Anthropic first-party rates
// as of 2026-10. Cache writes cost 1.25x input; cache reads are listed per model.

import type { FacultyName } from "@psyche/engine";

export const HAIKU = "claude-haiku-5-5";
export const SONNET = "claude-sonnet-5-5";
export const OPUS = "claude-opus-5-5";

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

export const PRICES: Record<string, Price> = {
  [HAIKU]: { input: 0.1, output: 0.5, cacheRead: 0.01 },
  [SONNET]: { input: 2, output: 10, cacheRead: 0.2 },
  [OPUS]: { input: 4, output: 20, cacheRead: 0.2 },
};

/** Default model per faculty: the tier plan in docs/civilization-plan.md, section 2.1. */
export const TIERS: Record<FacultyName, string> = {
  perceive: HAIKU,
  speak: HAIKU,
  reconstruct: HAIKU,
  dream: HAIKU,
  deliberate: SONNET,
  architect: SONNET,
};

export function defaultModel(faculty: FacultyName): string {
  return TIERS[faculty];
}

/** The price of a model, falling back to the most expensive known one so estimates err high. */
export function priceOf(model: string): Price {
  return PRICES[model] ?? PRICES[OPUS]!;
}

export interface Tokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export function costOf(model: string, t: Tokens): number {
  const p = priceOf(model);
  return (t.input * p.input + t.cacheWrite * p.input * 1.25 + t.cacheRead * p.cacheRead + t.output * p.output) / 1e6;
}
