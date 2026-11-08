import { homedir } from "node:os";
import { join } from "node:path";
import type { Faculties } from "@psyche/engine";
import { Governor, type GovernorOptions } from "./governor.js";

export { configuredModel, createClaudeCaller, createClaudeFaculties, FacultyRefusal, type CallUsage, type ClaudeFacultiesConfig, type FacultyCaller } from "./claude.js";
export { createMockFaculties, mockArchitect, mockDeliberate, mockDream, mockPerceive, mockReconstruct, mockSpeak } from "./mock.js";
export { breakdown, Governor, LEVELS, meterLine, type BudgetLevel, type FacultyStats, type GovernorOptions, type MeterSnapshot } from "./governor.js";
export { costOf, defaultModel, HAIKU, OPUS, PRICES, priceOf, SONNET, TIERS } from "./pricing.js";

/**
 * Claude when credentials are configured (or PSYCHE_FACULTIES=claude), otherwise the offline mock.
 * Either way calls go through the budget governor, which routes, caps and meters them.
 */
export function createFaculties(
  kind = process.env.PSYCHE_FACULTIES,
  opts: Omit<GovernorOptions, "mode"> = { spendFile: process.env.PSYCHE_SPEND_FILE ?? join(homedir(), ".psyche", "usage.json") },
): { kind: "claude" | "mock"; faculties: Faculties; governor: Governor } {
  const useClaude = kind === "claude" || (kind !== "mock" && !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN));
  const governor = new Governor({ ...opts, mode: useClaude ? "claude" : "mock" });
  return { kind: governor.mode, faculties: governor.faculties, governor };
}
