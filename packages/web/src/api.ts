import type { Ablations, AgentState, Concern, DivergenceEntry, FeedItem, LedgerNode, MindState, Place, PlaceId, Rumor, SaysVsWas, Trace, VillageView, WhyTree, WorldInput } from "@psyche/engine";

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  household?: string;
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

export type Scenario = "island" | "village";

export interface WorldView {
  faculties: "claude" | "mock";
  scenario: Scenario;
  name: string;
  places: Record<PlaceId, Place>;
  village?: VillageView;
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
  cost: CostView;
  conversations: number;
}

export interface CostView {
  mode: "claude" | "mock";
  estimated: boolean;
  level: "normal" | "economy" | "thrifty" | "offline";
  levelMeans: string;
  capUsd: number;
  todayUsd: number;
  sessionUsd: number;
  perSimDay?: number;
  calls: number;
  templated: number;
  cacheHitRate: number;
  byFaculty: Record<string, { calls: number; templated: number; usd: number; input: number; output: number; cacheRead: number }>;
  byModel: Record<string, { calls: number; usd: number }>;
}

export interface ConcernView extends Concern {
  decisions: number;
  direct: number;
  minds: string[];
}

export interface WhyView {
  tree: WhyTree;
  chain: LedgerNode[];
  genealogy: { ancestors: number; roots: LedgerNode[]; minds: string[] };
  influence: { direct: number; total: number; decisions: { node: LedgerNode; share: number; steps: number }[]; minds: string[] };
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
  concerns: (id: string) => call<{ concerns: ConcernView[]; nodes: number; edges: number }>(`/api/concerns/${id}`),
  why: (q: { node?: string; agent?: string; trace?: string }) => call<WhyView>(`/api/why?${new URLSearchParams(q as Record<string, string>)}`),
  focus: (agents: string[]) => call<{ focus: string[] }>("/api/focus", { agents }),
  reset: (opts: { seed?: number; ablations?: Partial<Ablations>; scenario?: Scenario }) => call<WorldView>("/api/reset", opts),
  divergence: () => call<{ events: DivergenceEntry[] }>("/api/divergence"),
  account: (agent: string, trace: string) => call<SaysVsWas>(`/api/account?${new URLSearchParams({ agent, trace })}`),
};
