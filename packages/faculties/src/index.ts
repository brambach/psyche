import type { Faculties } from "@psyche/engine";
import { createClaudeFaculties } from "./claude.js";
import { createMockFaculties } from "./mock.js";

export { createClaudeFaculties, FacultyRefusal, type ClaudeFacultiesConfig } from "./claude.js";
export { createMockFaculties, mockDeliberate, mockDream, mockPerceive, mockReconstruct, mockSpeak } from "./mock.js";

/** Claude when credentials are configured (or PSYCHE_FACULTIES=claude), otherwise the offline mock. */
export function createFaculties(kind = process.env.PSYCHE_FACULTIES): { kind: "claude" | "mock"; faculties: Faculties } {
  const useClaude = kind === "claude" || (kind !== "mock" && !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN));
  return useClaude ? { kind: "claude", faculties: createClaudeFaculties() } : { kind: "mock", faculties: createMockFaculties() };
}
