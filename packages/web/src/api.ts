import type { Ablations, AgentState, FeedItem, MindState, PlaceId, Rumor, Trace, WorldInput } from "@psyche/engine";

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  place: PlaceId;
  activity: string;
  talking: boolean;
  mood: number;
  valence: number;
  arousal: number;
  stress: number;
  fatigue: number;
  emotion?: { name: string; value: number };
  needs: MindState["needs"];
  pronoun: string;
}

export interface Relation {
  from: string;
  to: string;
  liking: number;
  benevolence: number;
  integrity: number;
  believedRegard: number;
}

export interface RumorView extends Rumor {
  believers: { agent: string; confidence: number; text: string }[];
}

export interface WorldView {
  faculties: "claude" | "mock";
  seed: number;
  running: boolean;
  speed: number;
  tick: number;
  ablations: Ablations;
  order: string[];
  agents: AgentSummary[];
  relations: Relation[];
  feed: FeedItem[];
  rumors: RumorView[];
  rewind: { index: number; tick: number; dayStart: boolean }[];
  calls: number;
  conversations: number;
}

export interface TraceSummary {
  id: string;
  tick: number;
  kind: Trace["kind"];
  question: string;
  heard?: string;
  action?: string;
  actionKind?: string;
  system?: 1 | 2;
  changed: boolean;
}

export interface AgentView {
  mind: MindState;
  agent: AgentState;
  traces: TraceSummary[];
  actual: Record<string, number>;
}

export interface TraceView {
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

export const api = {
  world: () => call<WorldView>("/api/world"),
  agent: (id: string) => call<AgentView>(`/api/agent/${id}`),
  trace: (agent: string, id: string) => call<TraceView>(`/api/trace/${agent}/${id}`),
  control: (c: { running?: boolean; speed?: number }) => call<WorldView>("/api/control", c),
  input: (input: WorldInput) => call<WorldView>("/api/input", { input }),
  rewind: (index: number) => call<WorldView>("/api/rewind", { index }),
  reset: (opts: { seed?: number; ablations?: Partial<Ablations> }) => call<WorldView>("/api/reset", opts),
};
