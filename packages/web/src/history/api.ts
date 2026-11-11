import type { AgentId, BriefNode, Calendar, HistorianReply, HistoryNode, LedgerNode, Mark, Moment, MomentKind, PersonRecord, ThreadStep, Weight, WhyTree } from "@psyche/engine";
import { call } from "../api";

/** Ticks arrive as numbers, or null for things that were always there (JSON has no -Infinity). */
export type T = number | null;

export interface Overview {
  calendar: Calendar;
  year?: number;
  from: number;
  to: number;
  size: { nodes: number; edges: number; moments: number; people: number; marks: number };
  kinds: { kind: MomentKind; label: string; means: string }[];
  towns: { id: string; name: string }[];
  people: (PersonRecord & { choices: number })[];
  /** id, tick, agent, kind, what they chose, weight, town. */
  moments: [string, number, AgentId, MomentKind, string, number, string | 0][];
  marks: Mark[];
  weights: (Weight & { shaped: number; minds: number; since?: T })[];
  historian: { method: "claude" | "offline"; model?: string };
}

export interface Why {
  node: HistoryNode;
  moment?: Moment;
  weight?: Weight;
  tree: WhyTree;
  strongest: ThreadStep[];
  longest: ThreadStep[];
  origins: { causes: number; roots: LedgerNode[]; minds: AgentId[]; earliest?: number };
  reach: { total: number; direct: number; minds: { agent: AgentId; choices: number }[]; byYear: { year: number; choices: number }[]; first?: number; last?: number; choices: { node: LedgerNode; share: number; steps: number }[] };
  held: string[];
}

export interface Answer extends HistorianReply {
  question: string;
  nodes: BriefNode[];
  focus: string[];
  briefTokens: number;
}

/** Where the explorer gets the history from. The server by default; a saved history could stand in. */
export interface HistorySource {
  overview(): Promise<Overview>;
  why(node: string): Promise<Why>;
  find(q: string, at?: number): Promise<{ found: { node: HistoryNode; moment?: Moment }[] }>;
  ask(question: string, focus?: string[], at?: number): Promise<Answer>;
}

export const server: HistorySource = {
  overview: () => call<Overview>("/api/history"),
  why: (node) => call<Why>(`/api/history/why?${new URLSearchParams({ node })}`),
  find: (q, at) => call(`/api/history/find?${new URLSearchParams(at === undefined ? { q } : { q, at: String(Math.round(at)) })}`),
  ask: (question, focus, at) => call<Answer>("/api/history/ask", { question, focus, at }),
};
