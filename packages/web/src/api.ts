import type { VoiceSummary, VoiceLineage, Guise } from "@psyche/engine";
import type { Intention, Butterfly, EngineChain, NestedPersonView, NestedWorldView, EditRecord, MindEdit, TraitName, AwaySummary, Beat, ChronicleEntry, Notice, Scene3D, Timeline, Ablations, AgentState, AtlasEntry, MythComparison, RegionView, Concern, Counterfactual, CounterfactualEdit, DivergenceEntry, FeedItem, LedgerNode, MindState, Place, PlaceId, Rumor, SaysVsWas, Trace, VillageView, WhyTree, WorldInput } from "@psyche/engine";

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

export type Scenario = "island" | "village" | "region";

export interface WorldView {
  faculties: "claude" | "mock";
  scenario: Scenario;
  name: string;
  places: Record<PlaceId, Place>;
  village?: VillageView;
  /** Present when the world is a region of towns; `town` is the one being watched. */
  region?: RegionView;
  town?: string;
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
  /** Years passing on the offline mock, when they are. */
  fastForward?: { from: number; to: number; at: number; started: number };
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
  intent?: Intention;
  past?: Intention[];
}

export interface TraceView {
  trace: Trace;
  state: MindState;
  trail: { v: number; a: number }[];
}

export async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export type { Butterfly, EditRecord, MindEdit };

/** Someone's mind as the editor shows it, with the library of core beliefs and presets. */
export interface Editable {
  id: string;
  name: string;
  traits: Record<TraitName, number>;
  locks: { trait: TraitName; heritable: boolean }[];
  schemas: { text: string; strength: number; edited: boolean; heritable: boolean }[];
  goals: { text: string; priority: number; edited: boolean }[];
  others: { id: string; name: string; liking: number; trust: number; edited: boolean }[];
  memories: { id: string; gist: string; valence: number; implanted: boolean }[];
  edits: EditRecord[];
  fears: { text: string; triggers: string[]; threat: number; blame: number; hint: string }[];
  presets: { id: string; label: string; hint: string }[];
}

/** Every change made in this town, and how far it has reached. */
export interface EditReach extends EditRecord {
  /** Whether it can still be run both ways. */
  ripple: boolean;
  decisions: number;
  direct: number;
  minds: number;
  recent: { id: string; label: string; tick: number; agent?: string; trace?: string }[];
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
  town: (town: string) => call<WorldView>("/api/town", { town }),
  myths: () => call<MythComparison>("/api/myths"),
  timeline: () => call<Timeline>("/api/timeline"),
  town3d: () => call<Scene3D>("/api/town3d"),
  digest: (from?: number) => call<{ from: number; to: number; text: string }>(`/api/digest${from ? `?from=${from}` : ""}`),
  atlas: () => call<{ beliefs: AtlasEntry[] }>("/api/atlas"),
  years: (years: number) => call<WorldView>("/api/years", { years }),
  counterfactual: (edit: CounterfactualEdit & { days?: number }) => call<Counterfactual>("/api/counterfactual", edit),
  account: (agent: string, trace: string) => call<SaysVsWas>(`/api/account?${new URLSearchParams({ agent, trace })}`),
  slots: () => call<{ slots: Slot[] }>("/api/slots"),
  saveSlot: (name: string) => call<{ slots: Slot[] }>("/api/slots/save", { name }),
  loadSlot: (name: string) => call<{ slots: Slot[] }>("/api/slots/load", { name }),
  deleteSlot: (name: string) => call<{ slots: Slot[] }>("/api/slots/delete", { name }),
  speak: (b: { guise: Guise; text: string; to?: string; place?: string }) => call<{ summary: VoiceSummary }>("/api/voice/speak", b),
  fulfil: (word: string) => call<{ summary: VoiceSummary }>("/api/voice/fulfil", { word }),
  voiceWord: (id: string) => call<VoiceLineage>(`/api/voice/word?id=${encodeURIComponent(id)}`),
  editable: (id: string) => call<Editable>(`/api/editable/${id}`),
  edit: (b: { who: string; edit?: MindEdit & { written?: boolean }; preset?: string; notice?: boolean }) => call<{ records: EditRecord[]; editable?: Omit<Editable, "fears" | "presets"> }>("/api/edit", b),
  edits: () => call<{ edits: EditReach[] }>("/api/edits"),
  butterfly: (edit: string, days: number) => call<Butterfly>("/api/butterfly", { edit, days }),
  nested: () => call<{ engines: EngineChain[] }>("/api/nested"),
  nestedWorld: (town: string, depth: number) => call<NestedWorldView>(`/api/nested/world?${new URLSearchParams({ town, depth: String(depth) })}`),
  nestedScene: (town: string, depth: number) => call<Scene3D>(`/api/nested/scene?${new URLSearchParams({ town, depth: String(depth) })}`),
  nestedPerson: (town: string, depth: number, id: string) => call<NestedPersonView>(`/api/nested/person?${new URLSearchParams({ town, depth: String(depth), id })}`),
};

export interface Slot {
  name: string;
  savedAt: number;
  scenario: Scenario;
  tick?: number;
  year?: number;
  towns?: number;
  people?: number;
}

/** One frame of the live game, as the stream builds it (see the server's gameFrame). */
export interface GameView {
  scenario: Scenario;
  name: string;
  seed: number;
  faculties: "claude" | "mock";
  running: boolean;
  speed: number;
  /** Sim minutes actually covered in the last real second. */
  pace: number;
  /** Why speech is on the free mock right now, if it is. */
  free?: "away" | "fast";
  tick: number;
  town?: string;
  fastForward?: { from: number; to: number; at: number; started: number };
  viewers: number;
  cost: { sessionUsd: number; todayUsd: number; capUsd: number; level: string; estimated: boolean; perSimDay?: number; perHour?: number; perHourAt1x?: number };
  card?: {
    people: number;
    adults: number;
    children: number;
    households: number;
    houses: number;
    tents: number;
    building: { name: string; progress: number }[];
    works: { id: string; kind: string; name: string; status: "proposed" | "building" | "done" | "ruin"; progress: number; condition: number; mending: boolean; proposer: string; proposerName?: string; why: string; does: string; design?: string; trace?: string }[];
    plans: { kind: string; text: string; n: number }[];
    store: number;
    leader?: string;
    leaderName?: string;
    laws: number;
    norms: string[];
    year: number;
    season: string;
    weather: string;
  };
  towns?: { id: string; name: string; people: number; children: number; leaderName?: string; tier: "live" | "aggregate"; crafts: string[]; lost: string[]; laws: number; store: number; founded: number; from?: string }[];
  year?: number;
  chronicle?: ChronicleEntry[];
  places?: Record<PlaceId, Place>;
  agents?: { id: string; name: string; role: string; activity: string; place: string; mood: number; emotion?: string }[];
  feed?: { id: string; tick: number; kind: FeedItem["kind"]; title: string; text?: string; agents: string[]; refs?: { agent: string; trace: string }[]; line?: { speaker: string; text: string } }[];
  beats?: Beat[];
  notices?: Notice[];
  /** Your words in this town, once you have spoken. */
  voice?: VoiceSummary;
  /** The town's 3D scene, put back together from its `scene.*` keys. */
  scene?: Scene3D;
  /** Towns that have started counting, and the worlds inside their engines. */
  engines?: EngineChip[];
}

export interface EngineChip {
  id: string;
  townName: string;
  stage: "tally" | "frame" | "building" | "running" | "stilled";
  depth: number;
  worlds: { name: string; people: number; believers: number; adults: number; year: number }[];
}

export type { AwaySummary };
