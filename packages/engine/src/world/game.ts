// The game layer (G1): what a live viewer needs that the simulation does not. Nothing here changes
// the world. It reads it:
//
// - Frames and deltas: the server pushes a frame of everything on screen each tick, and only what
//   changed since the last one goes down the wire.
// - Beats: which recent moments are worth a director's cut, scored by what kind of moment they are.
// - Notices: what a player would want to be told (a leader chosen, a craft about to die with its last
//   keeper, a town about to split and who would lead the leavers).
// - While you were away: what changed between two ticks, from the region's chronicle and its samples.

import type { AgentId, Tick } from "../types.js";
import { craft, knowledgeOf } from "./knowledge.js";
import { ageOf, isChild } from "./life.js";
import type { ChronicleEntry, RegionSession } from "./region.js";
import { personName, type FeedItem, type WorldState } from "./world.js";

// ------------------------------------------------------------------ frames and deltas

/** A frame is a plain object; arrays of objects with a string `id` are sent item by item. */
export type Frame = Record<string, unknown>;

export interface FrameDelta {
  /** Keys whose whole value is replaced. */
  set?: Record<string, unknown>;
  /** Keys removed from the frame. */
  drop?: string[];
  /** Keyed arrays: items added or changed, ids removed, and the new order when it changed. */
  items?: Record<string, { up?: { id: string }[]; del?: string[]; order?: string[] }>;
}

type Keyed = { id: string } & Record<string, unknown>;
const keyed = (v: unknown): v is Keyed[] => Array.isArray(v) && v.every((x) => x !== null && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");

/** What the sender remembers of the last frame it sent: a fingerprint per key and per item. */
export interface DeltaMemory {
  keys: Map<string, string>;
  items: Map<string, { order: string[]; json: Map<string, string> }>;
}

export const deltaMemory = (): DeltaMemory => ({ keys: new Map(), items: new Map() });

/**
 * The delta from what `mem` last saw to `next`, and remember `next`. A keyed array is diffed item by
 * item (an item whose JSON changed is sent whole); anything else is sent whole when its JSON changed.
 * Returns undefined when nothing changed.
 */
export function frameDelta(mem: DeltaMemory, next: Frame): FrameDelta | undefined {
  const d: FrameDelta = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    const prevItems = mem.items.get(k);
    if (keyed(v) && (prevItems || !mem.keys.has(k))) {
      const json = new Map(v.map((x) => [x.id, JSON.stringify(x)]));
      const order = v.map((x) => x.id);
      const up = prevItems ? v.filter((x) => prevItems.json.get(x.id) !== json.get(x.id)) : v;
      const del = prevItems ? prevItems.order.filter((id) => !json.has(id)) : [];
      // Order is sent only when the ids no longer line up with what the receiver will have.
      const expect = prevItems ? [...prevItems.order.filter((id) => json.has(id)), ...up.filter((x) => !prevItems.json.has(x.id)).map((x) => x.id)] : order;
      const reorder = expect.length !== order.length || expect.some((id, i) => id !== order[i]);
      if (up.length || del.length || reorder) (d.items ??= {})[k] = { ...(up.length ? { up } : {}), ...(del.length ? { del } : {}), ...(reorder ? { order } : {}) };
      mem.items.set(k, { order, json });
      mem.keys.set(k, "[keyed]");
      continue;
    }
    const json = JSON.stringify(v);
    if (mem.keys.get(k) !== json) (d.set ??= {})[k] = v;
    mem.keys.set(k, json);
    mem.items.delete(k);
  }
  for (const k of [...mem.keys.keys()])
    if (next[k] === undefined) {
      (d.drop ??= []).push(k);
      mem.keys.delete(k);
      mem.items.delete(k);
    }
  return d.set || d.drop || d.items ? d : undefined;
}

/** Apply a delta to a frame the receiver holds, in place, and return it. */
export function applyDelta(frame: Frame, d: FrameDelta): Frame {
  for (const [k, v] of Object.entries(d.set ?? {})) frame[k] = v;
  for (const k of d.drop ?? []) delete frame[k];
  for (const [k, ch] of Object.entries(d.items ?? {})) {
    const cur = (Array.isArray(frame[k]) ? (frame[k] as Keyed[]) : []).filter((x) => !(ch.del ?? []).includes(x.id));
    const at = new Map(cur.map((x, i) => [x.id, i]));
    for (const x of ch.up ?? []) {
      const i = at.get(x.id);
      if (i === undefined) {
        at.set(x.id, cur.length);
        cur.push(x as Keyed);
      } else cur[i] = x as Keyed;
    }
    if (ch.order) {
      const by = new Map(cur.map((x) => [x.id, x]));
      frame[k] = ch.order.map((id) => by.get(id)).filter((x): x is Keyed => !!x);
    } else frame[k] = cur;
  }
  return frame;
}

// ------------------------------------------------------------------ beats (the director's shot list)

export interface Beat {
  id: string;
  tick: Tick;
  /** Who the camera should find; absent for a moment about a place or the whole town. */
  agent?: AgentId;
  place?: string;
  title: string;
  text?: string;
  /** How much a viewer would want to see it, 0 to 1. */
  score: number;
  /** A wide shot of the town rather than a close one on someone. */
  wide?: boolean;
}

/** How much each kind of moment is worth a cut, by what the feed says it is. */
const RULES: [RegExp, number, boolean?][] = [
  [/ dies\b| drowned| is lost at sea/, 0.95],
  [/prophecy comes true|never comes|faith is born|Schism|voice speaks out of the sky|dreams the same words|rite takes hold/, 0.92],
  [/prophet preaches|stranger stops|preaches at/, 0.8],
  [/ is asked to lead /, 0.9],
  [/law/i, 0.85],
  [/ is born /, 0.85],
  [/leave|found(s|ing)? a (new )?town|sets out/i, 0.85],
  [/storm|blight|fever/i, 0.8, true],
  [/ house is finished/, 0.75],
  [/set up home together/, 0.7],
  [/newcomer/, 0.7],
  [/designs /, 0.6],
  [/ trade|trader/i, 0.6],
  [/ comes to /, 0.5, true],
  [/gale/, 0.5, true],
  [/tents/, 0.45],
  [/Supper, and the store/, 0.3],
];

/** Score one feed item as a director's beat, or undefined when it is not worth a cut. */
export function beatOf(f: FeedItem): Beat | undefined {
  if (f.kind === "move" || f.kind === "night" || f.kind === "morning") return undefined;
  let score = f.kind === "event" ? 0.55 : f.kind === "insight" ? 0.55 : f.kind === "memory" ? 0.35 : f.kind === "talk" ? (f.rumor ? 0.4 : (f.lines?.length ?? 0) >= 2 ? 0.25 : 0.15) : 0;
  let wide = false;
  if (f.kind === "event" || f.kind === "insight") {
    for (const [re, s, w] of RULES)
      if (re.test(f.title)) {
        score = s;
        wide = !!w;
        break;
      }
  }
  if (f.chronicle) score = Math.max(score, 0.9);
  const agent = f.agents[0];
  if (!agent && !f.place) wide = true;
  if (score <= 0) return undefined;
  return { id: f.id, tick: f.tick, agent: wide ? undefined : agent, place: f.place, title: f.title, text: f.text ?? f.lines?.[0]?.text, score, wide: wide || undefined };
}

/** The best recent beats, newest first among equals: the director's shot list. */
export function beats(feed: FeedItem[], now: Tick, opts: { within?: number; max?: number } = {}): Beat[] {
  const within = opts.within ?? 240;
  const out: Beat[] = [];
  for (let i = feed.length - 1; i >= 0; i--) {
    const f = feed[i]!;
    if (now - f.tick > within) break;
    const b = beatOf(f);
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.score - a.score || b.tick - a.tick).slice(0, opts.max ?? 16);
}

// ------------------------------------------------------------------ notices

export interface Notice {
  id: string;
  tick: Tick;
  /** chronicle: something that happened and is history. warning: something about to happen. moment: a big moment in the watched town. */
  kind: "chronicle" | "warning" | "moment";
  text: string;
  town?: string;
  agent?: AgentId;
}

const CHRONICLE_NOTICE: Partial<Record<ChronicleEntry["kind"], true>> = { faith: true, founding: true, leader: true, law: true, death: true, quarrel: true, peace: true, hunger: true, craft: true, lost: true, engine: true, work: true, ruin: true, money: true };

/** Warnings about the watched world: a craft down to its last keeper, a town close to splitting. */
export function warnings(w: WorldState, town: string | undefined, region?: RegionSession): Notice[] {
  const out: Notice[] = [];
  const v = w.village;
  if (!v) return out;
  const k = knowledgeOf(w);
  const living = new Set(w.order);
  const keepers: Record<string, AgentId[]> = {};
  for (const [id, ks] of Object.entries(k.known)) if (living.has(id)) for (const x of ks) (keepers[x.craft] ??= []).push(id);
  for (const [c, ids] of Object.entries(keepers)) {
    if (ids.length !== 1) continue;
    const id = ids[0]!;
    const age = ageOf(w, id);
    if (age < 55) continue;
    out.push({ id: `last:${town ?? "village"}:${c}:${id}`, tick: w.tick, kind: "warning", town, agent: id, text: `Only ${personName(w, id)} (${Math.floor(age)}) still knows ${craft(c).name} in ${w.name}. If ${w.minds[id]?.pronouns.subject ?? "they"} dies untaught, it is gone.` });
  }
  const split = region?.splitWatch();
  if (split && split.town === (town ?? split.town)) {
    const sw = region!.world(split.town);
    out.push({
      id: `split:${split.town}:${split.leaver}:${Math.floor(sw.tick / (sw.village!.seasonDays * 4 * 1440))}`,
      tick: w.tick,
      kind: "warning",
      town: split.town,
      agent: split.leaver,
      text: `${sw.name} has ${split.people} people. ${personName(sw, split.leaver)}, who feels least at home there, may lead a group away to found a town in spring.`,
    });
  }
  const adults = w.order.filter((x) => !isChild(w, x));
  if (v.season === "autumn" && adults.length && v.store.food < adults.length * 2) {
    const year = Math.floor(w.tick / (v.seasonDays * 4 * 1440));
    out.push({ id: `lean:${town ?? "village"}:${year}`, tick: w.tick, kind: "warning", town, text: `Winter is coming and ${w.name}'s common store holds ${Math.round(v.store.food)} for ${adults.length} adults.` });
  }
  return out;
}

/** Big moments in the watched town's feed since a tick, as notices. */
export function momentNotices(feed: FeedItem[], since: Tick, town?: string): Notice[] {
  const out: Notice[] = [];
  for (const f of feed) {
    if (f.tick <= since) continue;
    const b = beatOf(f);
    if (!b || b.score < 0.7) continue;
    out.push({ id: `m:${f.id}`, tick: f.tick, kind: "moment", town, agent: f.agents[0], text: f.text && b.score >= 0.85 ? `${f.title}. ${f.text}` : f.title });
  }
  return out;
}

/** Chronicle entries since a tick, as notices. */
export function chronicleNotices(chronicle: ChronicleEntry[], since: Tick): Notice[] {
  return chronicle
    .filter((e) => e.tick > since && CHRONICLE_NOTICE[e.kind])
    .map((e, i) => ({ id: `c:${e.tick}:${e.kind}:${e.town ?? ""}:${(e.agents ?? []).join(",")}:${i}`, tick: e.tick, kind: "chronicle" as const, town: e.town, agent: e.agents?.[0], text: e.text }));
}

// ------------------------------------------------------------------ while you were away

export interface AwaySummary {
  from: Tick;
  to: Tick;
  days: number;
  years: number;
  towns: { id: string; name: string; before: number; after: number; new: boolean }[];
  people: { before: number; after: number };
  /** The chronicle in that time, most significant first, at most a dozen. */
  entries: ChronicleEntry[];
  /** How many chronicle entries there were in all. */
  total: number;
}

const WEIGHT: Record<ChronicleEntry["kind"], number> = { faith: 8, founding: 10, lost: 9, engine: 9, quarrel: 8, law: 7, leader: 6, hunger: 6, peace: 5, craft: 5, heresy: 5, work: 6, ruin: 5, money: 7, death: 4, trade: 1 };

/** What changed in a region between two ticks: populations then and now, new towns, and what the chronicle kept. */
export function awaySummary(rs: RegionSession, from: Tick, to = rs.region.tick): AwaySummary {
  const r = rs.region;
  const first = rs.world(r.towns[0]!.id).village!;
  const yearTicks = first.seasonDays * 4 * 1440;
  const towns = r.towns.map((t) => {
    const w = rs.world(t.id);
    const before = t.founded > from ? 0 : ([...t.history].reverse().find((h) => h.tick <= from)?.people ?? t.history[0]?.people ?? w.order.length);
    return { id: t.id, name: t.name, before, after: w.order.length, new: t.founded > from };
  });
  const all = r.chronicle.filter((e) => e.tick > from && e.tick <= to && e.kind !== "trade");
  const entries = [...all].sort((a, b) => WEIGHT[b.kind] - WEIGHT[a.kind] || b.tick - a.tick).slice(0, 12).sort((a, b) => a.tick - b.tick);
  return {
    from,
    to,
    days: Math.floor((to - from) / 1440),
    years: Number(((to - from) / yearTicks).toFixed(1)),
    towns,
    people: { before: towns.reduce((s, t) => s + t.before, 0), after: towns.reduce((s, t) => s + t.after, 0) },
    entries,
    total: all.length,
  };
}
