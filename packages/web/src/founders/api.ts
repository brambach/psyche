import type { Bill, Blueprint, Builder, FounderFeed, FounderInput, Goal, MindState, Plot, Pronouns, Trace } from "@psyche/engine";

export interface FoundersView {
  faculties: "claude" | "mock";
  seed: number;
  running: boolean;
  speed: number;
  tick: number;
  builders: { id: string; name: string; role: string; summary: string }[];
  builder: Builder & {
    pronouns: Pronouns;
    summary: string;
    mood: number;
    stress: number;
    fatigue: number;
    energy: number;
    emotion?: { name: string; value: number };
    lifeStory: string;
    goals: Goal[];
  };
  plan: string;
  storm: { at: number; until: number; state: "coming" | "raging" | "over"; dry?: number };
  hoursUntilStorm: number;
  plot: Plot;
  project?: {
    blueprint: Blueprint;
    proposed: Partial<Blueprint>;
    description: string;
    proposedDescription: string;
    rationale: string;
    because: { ref: string; label: string; weight: number }[];
    repairs: string[];
    revisions: string[];
    bill: Bill;
    progress: number;
    remainingHours: number;
    dryness: number;
    startedAt: number;
    finishedAt?: number;
    trace: string;
    ghost: [number, number, number, number][];
  };
  grid: { version: number; w: number; d: number; h: number };
  feed: FounderFeed[];
  traces: { id: string; tick: number; kind: Trace["kind"]; heard?: string; action?: string; system?: 1 | 2; llm: string[] }[];
  rewind: { index: number; tick: number; dayStart: boolean }[];
  calls: number;
  callsBy: Record<string, number>;
}

export interface GridData {
  version: number;
  w: number;
  d: number;
  h: number;
  cells: Uint8Array;
}

export interface FounderTraceView {
  trace: Trace;
  state: MindState;
  trail: { v: number; a: number }[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const foundersApi = {
  view: () => call<FoundersView>("/api/founders"),
  grid: async (): Promise<GridData> => {
    const g = await call<{ version: number; w: number; d: number; h: number; cells: string }>("/api/founders/grid");
    const bin = atob(g.cells);
    const cells = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) cells[i] = bin.charCodeAt(i);
    return { ...g, cells };
  },
  trace: (id: string) => call<FounderTraceView>(`/api/founders/trace/${id}`),
  control: (c: { running?: boolean; speed?: number }) => call<FoundersView>("/api/founders/control", c),
  input: (input: FounderInput) => call<FoundersView>("/api/founders/input", { input }),
  rewind: (index: number) => call<FoundersView>("/api/founders/rewind", { index }),
  reset: (opts: { seed?: number; builder?: string }) => call<FoundersView>("/api/founders/reset", opts),
};
