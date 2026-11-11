// Civilization systems: what a town grows into once it is more than a camp. Trades and a market,
// later crafts that need earlier ones, factions, contested elections and new kinds of law, sickness
// that travels, households that move between towns, writing and what it fixes in place, and raids,
// truces and treaties between towns.
//
// The rule every part follows is the engine's own: nothing here writes anyone's personality, and
// nothing happens "because the simulation says so". A price is raised by a seller with a mind; a
// faction is the households who like each other and not the rest; a raid is a leader's choice and
// then each adult's choice to go or stay; a fear of strangers is a memory of a death that someone
// can be traced back to. Each event keeps its causes (`Why`), so the analysis layer can follow a
// war back to a short-weighted trade and the temperament of the trader who did it.
//
// Everything is off unless a town's world has `village.civ` (see `enableCiv`), so worlds that
// don't ask for it run exactly as before.
//
// This file holds the shared state and the small helpers the parts use.

import { clamp } from "../../memory.js";
import { runPercept } from "../../mind.js";
import type { ActionOption, Faculties, Percept } from "../../ports.js";
import { nextId } from "../../rng.js";
import type { AgentId, MindState, Schema, Tick } from "../../types.js";
import { ageOf, isChild, yearOf } from "../life.js";
import type { Household } from "../village.js";
import { luck, record, type Sink, type Why, type WorldState } from "../world.js";
import type { Health } from "./disease.js";
import type { Economy } from "./economy.js";
import type { FactionState } from "./factions.js";
import type { Polity } from "./polity.js";
import type { Records } from "./records.js";

/** One thing the civilization systems did in a town, kept for the town's civ page. */
export interface CivEvent {
  tick: Tick;
  year: number;
  kind: "market" | "trade" | "tech" | "faction" | "election" | "law" | "plague" | "migration" | "record" | "war" | "truce";
  title: string;
  text?: string;
  agents?: AgentId[];
  why?: Why[];
}

/** Pressures a town has been under, as the ticks they happened: what later crafts are worked out against. */
export interface Marks {
  hunger: Tick[];
  cold: Tick[];
  raided: Tick[];
  raids: Tick[];
  plague: Tick[];
  trades: Tick[];
}

/** What a town knows of another, refreshed by the region each season. */
export interface Abroad {
  name: string;
  /** How this town regards it, -1 to 1. */
  regard: number;
  /** Times it raided this town in the last five years. */
  raidedUs: number;
  /** Raids either way in the last five years. */
  fought: number;
  treaty?: string;
  /** A sickness is going round there. */
  sick?: string;
}

export interface CivState {
  since: Tick;
  economy: Economy;
  factions: FactionState;
  polity: Polity;
  health: Health;
  records: Records;
  marks: Marks;
  events: CivEvent[];
  /** The other towns, as this one knows them. */
  abroad: Record<string, Abroad>;
}

declare module "../village.js" {
  interface VillageState {
    /** Present when the civilization systems run in this town (civ/index.ts `enableCiv`). */
    civ?: CivState;
  }
}

export const DAY = 1440;
export const civOf = (w: WorldState): CivState | undefined => w.village?.civ;
export const yearTicks = (w: WorldState) => w.village!.seasonDays * 4 * DAY;
export const adultsOf = (w: WorldState): AgentId[] => w.order.filter((x) => !isChild(w, x));
/** Old enough to vote, fight, hold a trade and head a household. */
export const grownOf = (w: WorldState): AgentId[] => w.order.filter((x) => ageOf(w, x) >= 16);
export const hhOf = (w: WorldState, id: AgentId): Household | undefined => Object.values(w.village!.households).find((h) => h.members.includes(id));
export const homesOf = (w: WorldState): Household[] => Object.values(w.village!.households).filter((h) => h.members.some((x) => w.order.includes(x)));
export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const round = (x: number, d = 2) => Number(x.toFixed(d));

/** The adult who speaks for a household: the steadiest of its grown members. */
export function headOf(w: WorldState, hh: Household): AgentId | undefined {
  return hh.members
    .filter((x) => w.order.includes(x) && ageOf(w, x) >= 16)
    .sort((a, b) => w.minds[b]!.traits.conscientiousness - w.minds[a]!.traits.conscientiousness || a.localeCompare(b))[0];
}

/** How many of the last `years` saw this pressure. */
export function recent(w: WorldState, ticks: Tick[], years: number): number {
  const since = w.tick - years * yearTicks(w);
  return ticks.filter((t) => t >= since).length;
}

export function mark(w: WorldState, kind: keyof Marks): void {
  const c = civOf(w);
  if (!c) return;
  const m = c.marks[kind];
  // One mark a season is enough to say "it happened that season".
  if (m.length && w.tick - m.at(-1)! < w.village!.seasonDays * DAY * 0.9) return;
  m.push(w.tick);
  if (m.length > 40) m.splice(0, m.length - 40);
}

/** Keep a line for the town's civ page. */
export function note(w: WorldState, e: Omit<CivEvent, "tick" | "year">): void {
  const c = civOf(w);
  if (!c) return;
  c.events.push({ tick: w.tick, year: yearOf(w), ...e });
  if (c.events.length > 240) c.events.splice(0, c.events.length - 240);
}

/**
 * A choice someone makes. In a town running hour by hour it goes through their own mind: the options
 * are scored from who they are and what is in their head, and the trace lands in the ledger like any
 * other decision. In a town running on rules nobody is watching closely enough for that, so `rule`
 * answers from the same things (temperament, the pulls on each option) without the full cycle.
 */
export async function choose(w: WorldState, id: AgentId, p: Percept, faculties: Faculties, sink: Sink, live: boolean, rule?: () => string): Promise<{ choice: string; trace?: string }> {
  const options = p.options ?? [];
  if (!live) {
    if (rule) return { choice: rule() };
    return { choice: ruleChoice(w, id, options, p.eventId ?? p.id) };
  }
  const m = w.minds[id]!;
  const tr = await runPercept(m, p, faculties);
  record(w, sink, id, tr);
  const choice = tr.decision?.choice ?? tr.action?.option ?? options[0]?.id ?? "";
  return { choice: options.some((o) => o.id === choice) ? choice : (options[0]?.id ?? ""), trace: tr.id };
}

/**
 * The same choice by rule: each option's pull terms, its kindness weighed by the chooser's own
 * agreeableness, its boldness by their extraversion and steadiness, and a little luck.
 */
export function ruleChoice(w: WorldState, id: AgentId, options: ActionOption[], key: string): string {
  const t = w.minds[id]!.traits;
  let best: { id: string; s: number } | undefined;
  for (const o of options) {
    const pull = [...(o.pull ?? []), ...(o.situation ?? [])].reduce((s, x) => s + x.value, 0);
    const s = pull + o.prosocial * (t.agreeableness - 0.5) + o.assertive * 0.4 * (t.extraversion - 0.5) - o.assertive * 0.3 * (t.neuroticism - 0.5) + o.avoidant * 0.3 * (t.neuroticism - 0.5) + (luck(w, "choice", id, key, o.id) - 0.5) * 0.25;
    if (!best || s > best.s) best = { id: o.id, s };
  }
  return best?.id ?? "";
}

/** Everyone in `ids` lives through something: each takes it in through their own mind. */
export async function witness(w: WorldState, ids: AgentId[], make: (m: MindState, id: AgentId) => Percept | undefined, faculties: Faculties, sink: Sink): Promise<Record<AgentId, string | undefined>> {
  const out: Record<AgentId, string | undefined> = {};
  for (const id of ids) {
    const m = w.minds[id];
    if (!m || !w.order.includes(id)) continue;
    const p = make(m, id);
    if (!p) continue;
    const tr = await runPercept(m, p, faculties);
    record(w, sink, id, tr);
    out[id] = tr.encoded;
  }
  return out;
}

/** Hold, or strengthen, a belief, with the memories behind it as evidence. Opposite beliefs about the same thing weaken. */
export function believe(m: MindState, about: string, topics: string[], proposition: string, valence: number, confidence: number, evidence: string[], tick: Tick): void {
  const same = m.beliefs.find((b) => b.about === about && Math.sign(b.valence) === Math.sign(valence));
  const opposite = m.beliefs.find((b) => b.about === about && Math.sign(b.valence) !== Math.sign(valence));
  if (opposite) opposite.confidence = round(clamp(opposite.confidence - 0.25));
  if (same) {
    same.confidence = round(clamp(Math.max(same.confidence, confidence) + 0.05));
    same.evidence = [...new Set([...same.evidence, ...evidence])].slice(-8);
    // The sharper charge becomes what the belief says.
    if (Math.abs(valence) > Math.abs(same.valence)) {
      same.valence = valence;
      same.proposition = proposition;
    }
  } else m.beliefs.push({ id: nextId(m, "bel"), about, topics, proposition, confidence: round(clamp(confidence)), valence, source: { kind: "inferred" }, formed: tick, evidence, retrievals: [tick] });
}

/** What someone believes of another town, summed the way the region reads regard (-1 to 1). */
export function townBeliefOf(m: MindState, town: string): number {
  return clamp(m.beliefs.filter((b) => b.about === `town:${town}`).reduce((s, b) => s + b.valence * b.confidence, 0), -1, 1);
}

/**
 * A core belief laid down by something lived through, with the memory that formed it as its origin
 * (so a child who is told the story can be traced back to it). An existing one with the same words
 * is deepened instead.
 */
export function formSchema(m: MindState, s: Omit<Schema, "id" | "origin">, origin: string | undefined): Schema {
  const have = m.schemas.find((x) => x.text === s.text);
  if (have) {
    have.strength = round(clamp(have.strength + 0.1));
    if (origin && !have.origin?.includes(origin)) (have.origin ??= []).push(origin);
    return have;
  }
  const made: Schema = { ...s, id: nextId(m, "sch"), origin: origin ? [origin] : [] };
  m.schemas.push(made);
  return made;
}

/** A person's surname, from the line that says who they are. */
export function surnameOf(w: WorldState, id: AgentId): string {
  const m = w.minds[id];
  const hit = m && /^(\S+) ([A-Z][\w'-]+)[,.]/.exec(m.identity.summary)?.[2];
  return hit || hhOf(w, id)?.name.replace(/^the /, "").replace(/e?s$/, "") || id;
}

export function trait(m: MindState, name: keyof MindState["traits"]): string {
  return `${name} ${m.traits[name].toFixed(2)}`;
}
