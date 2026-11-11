// What the between-town systems (merchants, migration, war) need from the region, and what they
// keep there. The region session implements `CivHost`; nothing here knows how towns are stepped.

import type { Faculties } from "../../ports.js";
import type { AgentId, Tick } from "../../types.js";
import type { ChronicleEntry, RegionState, Town } from "../region.js";
import type { Household } from "../village.js";
import type { Sink, Why, WorldState } from "../world.js";
import type { Good } from "./economy.js";

export interface Raid {
  tick: Tick;
  year: number;
  from: string;
  to: string;
  leader: AgentId;
  /** What it was over, in a few words. */
  casus: string;
  went: AgentId[];
  stayed: AgentId[];
  defenders: number;
  /** The raiders' chance, as the two sides' strengths stood. */
  odds: number;
  won: boolean;
  loot: number;
  dead: { id: AgentId; name: string; town: string }[];
  burned: number;
  trace?: string;
  why: Why[];
}

export interface Treaty {
  id: string;
  tick: Tick;
  year: number;
  a: string;
  b: string;
  kind: "truce" | "tribute";
  terms: string;
  /** Who shook hands on it, for each town. */
  by: [AgentId, AgentId];
  /** Set down in writing in at least one of the towns: it then holds whoever leads. */
  written: boolean;
  until?: Tick;
  /** Food the loser sends the winner each autumn. */
  tribute?: { from: string; to: string; amount: number; paid: number };
  ended?: { tick: Tick; why: string };
  why: Why[];
}

export interface Move {
  tick: Tick;
  year: number;
  from: string;
  to: string;
  household: string;
  head: AgentId;
  people: AgentId[];
  /** A whole side leaving together. */
  faction?: string;
  why: Why[];
}

export interface Run {
  tick: Tick;
  year: number;
  from: string;
  to: string;
  merchant: AgentId;
  good: Good;
  qty: number;
  profit: number;
}

/** What the region keeps of the civilization systems. */
export interface RegionCiv {
  raids: Raid[];
  treaties: Treaty[];
  moves: Move[];
  runs: Run[];
  /** The last year each town's leader weighed a raid, and each pair weighed peace. */
  weighed: Record<string, number>;
  n: number;
}

declare module "../region.js" {
  interface RegionState {
    /** Raids, treaties, moves and merchant runs between towns (absent in regions without the civilization systems). */
    civ?: RegionCiv;
  }
}

export const newRegionCiv = (): RegionCiv => ({ raids: [], treaties: [], moves: [], runs: [], weighed: {}, n: 0 });
export const regionCiv = (r: RegionState): RegionCiv => (r.civ ??= newRegionCiv());

export interface CivHost {
  region: RegionState;
  world(id: string): WorldState;
  sink(id: string): Sink;
  faculties(id: string): Faculties;
  /** Whether the town runs hour by hour (so choices go through minds in full). */
  live(id: string): boolean;
  rand(): number;
  chronicle(e: Omit<ChronicleEntry, "tick" | "year">): void;
  /** Beliefs about other towns changed: regard needs working out again. */
  touch(): void;
  /** Whether the region has room for another town. */
  canFound(): boolean;
  /** A group leaves `from` to found a town of its own. */
  found(from: Town, group: Household[], seed: AgentId, reason: string, why: Why[]): Promise<Town | undefined>;
}

/** The treaty that binds two towns now, if any. */
export function treatyBetween(r: RegionState, a: string, b: string): Treaty | undefined {
  return regionCiv(r).treaties.find((t) => !t.ended && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}

export const hostile = (r: RegionState, a: string, b: string) => (r.regard[`${a}>${b}`] ?? 0) <= -0.35 || (r.regard[`${b}>${a}`] ?? 0) <= -0.35;
