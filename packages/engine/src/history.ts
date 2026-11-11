// The causal history: the ledger, kept for good.
//
// ledger.ts rebuilds its graph from the traces a session still holds, and a session lets old traces
// go (a region keeps about a year and a half of them). Minds forget too: a memory nobody retells is
// pruned in sleep, and a town nobody is watching keeps only what matters. So the live ledger can say
// why someone did a thing this season, and not why their grandmother did the thing that made them
// who they are.
//
// The history is the part that stays. Every so often it reads the live ledger and keeps, for each
// choice worth keeping and each thing that weighs on someone, the causes upstream of it: what was in
// mind, the memory behind that, who told it to them, and so on back. Kept nodes never leave, so a
// chain can run from a choice made in year 40 through the dead to a night before the crossing.
//
// Walking it is strictly backwards in time. A cause only counts if it had happened by the moment it
// is said to have acted: trust that was moved in year 12 cannot explain a choice made in year 9.
//
// Like the ledger, nothing here causes behaviour. It is a record, built after the fact.

import { buildLedger, nodeId, type Ledger, type LedgerEdge, type LedgerInput, type LedgerNode, type Mechanism, type NodeKind, type WhyTree } from "./ledger.js";
import { dayOf, hourOf } from "./mind.js";
import type { AgentId, Tick } from "./types.js";
import type { FeedItem, Why, WorldState, WorldTrace } from "./world/world.js";

// ---------------------------------------------------------------- the calendar

/** How this world counts time. A village has seasons and years; the island only has days. */
export interface Calendar {
  /** Days in a season (a year is four of them). Absent where there are no seasons. */
  seasonDays?: number;
}

const SEASON_NAMES = ["summer", "autumn", "winter", "spring"] as const;
const DAY = 1440;
const BACKSTORY_YEAR = 365 * DAY;

export const yearMinutes = (cal: Calendar): number | undefined => (cal.seasonDays ? cal.seasonDays * 4 * DAY : undefined);

/** The year a tick falls in (1 is the first year of the story; 0 and below are before it). */
export function yearAt(cal: Calendar, t: Tick): number | undefined {
  const y = yearMinutes(cal);
  return y && Number.isFinite(t) ? Math.floor(t / y) + 1 : undefined;
}

/** "year 12, autumn" or "31 years before the story" or "day 3, 14:20"; "always" for standing things. */
export function whenText(cal: Calendar, t: Tick | null | undefined): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return "always there";
  const y = yearMinutes(cal);
  if (!y) {
    if (t < 0) return `${Math.max(1, Math.round(-t / DAY))} days before the story`;
    const h = hourOf(t);
    return `day ${dayOf(t)}, ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;
  }
  if (t < 0) {
    // Backstory is dated in ordinary years (people.ts), whatever the length of the village's own year.
    const years = -t / BACKSTORY_YEAR;
    return years >= 1 ? `${Math.round(years)} ${Math.round(years) === 1 ? "year" : "years"} before the story` : `${Math.max(1, Math.round(-t / DAY))} days before the story`;
  }
  const season = SEASON_NAMES[Math.floor((dayOf(t) - 1) / cal.seasonDays!) % 4]!;
  return `year ${yearAt(cal, t)}, ${season}`;
}

/** How long before `later` something at `earlier` happened: "3 hours earlier", "a season earlier", "31 years earlier". */
export function agoText(cal: Calendar, earlier: Tick | null | undefined, later: Tick): string {
  if (earlier === null || earlier === undefined || !Number.isFinite(earlier)) return "always there";
  const d = later - earlier;
  if (d < 1) return "at the same moment";
  const y = yearMinutes(cal);
  const n = (x: number, unit: string) => `${x} ${unit}${x === 1 ? "" : "s"} earlier`;
  if (d < 90) return n(Math.max(1, Math.round(d)), "minute");
  if (d < 1.5 * DAY) return d < 20 * 60 ? n(Math.round(d / 60), "hour") : "a day earlier";
  if (!y) return n(Math.round(d / DAY), "day");
  if (d < y / 4) return n(Math.round(d / DAY), "day");
  if (d < y) return d < y * 0.375 ? "a season earlier" : n(Math.round(d / (y / 4)), "season");
  // Years of the story count in the village's years; whatever lies before it, in ordinary ones.
  const story = Math.max(0, later) - Math.max(0, earlier);
  return n(Math.max(1, Math.round(story / y + (d - story) / BACKSTORY_YEAR)), "year");
}

// ---------------------------------------------------------------- what is kept

export interface HistoryNode extends LedgerNode {
  /** The town it happened in, in a region. */
  town?: string;
}

/** The kinds of choice the timeline tells apart. */
export type MomentKind = "talk" | "store" | "works" | "plan" | "money" | "peace" | "home" | "life" | "world" | "faith" | "other";

export const MOMENT_KINDS: { kind: MomentKind; label: string; means: string }[] = [
  { kind: "plan", label: "Intentions", means: "what someone meant to do with a season" },
  { kind: "store", label: "The common store", means: "pledges: how much to put in, or to hold back" },
  { kind: "works", label: "Building together", means: "asking for a work, and voting on one" },
  { kind: "money", label: "Food and debts", means: "a neighbour asks for food: give, lend, sell or refuse" },
  { kind: "peace", label: "Making peace", means: "answering someone who came to mend a quarrel" },
  { kind: "home", label: "Home", means: "how to build, and what to do without a roof" },
  { kind: "life", label: "Births and deaths", means: "what someone did with a birth, a death, a pairing, a founding" },
  { kind: "world", label: "Weather and luck", means: "storms, blight, a big catch" },
  { kind: "faith", label: "The made world", means: "the uncanny, and voices" },
  { kind: "talk", label: "Talk", means: "a conversation that went somewhere unusual" },
  { kind: "other", label: "Other", means: "everything else" },
];

const KIND_OF_EVENT: [RegExp, MomentKind][] = [
  [/^(talk|story)_/, "talk"],
  [/^ev_season_/, "plan"],
  [/^(ev_pledge|ev_took|ev_hungry|law)_/, "store"],
  [/^ev_(work|design)_/, "works"],
  [/^ev_(ask|ans|debt)_/, "money"],
  [/^ev_amends_/, "peace"],
  [/^ev_(tent|house)_/, "home"],
  [/^ev_(birth|death|pair|founding)_/, "life"],
  [/^ev_(storm|gale|blight|catch)_/, "world"],
  [/^ev_uncanny_/, "faith"],
];

/** A choice on the timeline: someone decided something, and the history kept why. */
export interface Moment {
  /** The ledger node of the decision. */
  id: string;
  agent: AgentId;
  tick: Tick;
  town?: string;
  kind: MomentKind;
  /** What they chose. */
  choice: string;
  /** What they turned down, nearest first, with how far behind it was. */
  over: { label: string; gap: number }[];
  /** The plain-language question and answer the engine wrote for it at the time. */
  question: string;
  answer: string;
  /** They stopped and thought it through (System 2). */
  thought: boolean;
  /** What they said or did, when the choice came out as words or an act. */
  said?: string;
  /** How much it matters, 0 to 1: for ranking in lists, never for causes. */
  weight: number;
  trace: string;
}

/** Someone who lived here, kept after they are gone. */
export interface PersonRecord {
  id: AgentId;
  name: string;
  role?: string;
  town?: string;
  born?: Tick;
  died?: Tick;
  cause?: string;
  parents: AgentId[];
  generation?: number;
}

/** Something that happened to the place, for the timeline: a founding, a law, a death, a lost craft. */
export interface Mark {
  id: string;
  tick: Tick;
  kind: string;
  text: string;
  town?: string;
  agents?: AgentId[];
  why?: Why[];
}

/** Something that weighed on someone when the history last read their mind: a way in to "where did this come from". */
export interface Weight {
  /** The ledger node. */
  id: string;
  agent: AgentId;
  kind: "schema" | "belief";
  label: string;
  strength: number;
  /** When it was last seen in their mind. */
  seen: Tick;
}

/** What one reading of the live ledger added. */
export interface AbsorbReport {
  moments: number;
  nodes: number;
  edges: number;
  ms: number;
}

/** What the history reads from: one town's world and the traces its session still holds. */
export interface HistorySource {
  world: WorldState;
  traces: WorldTrace[];
  /** In a region: the town's id and name. */
  town?: string;
  /** How many of `traces`, counted from the end, are new since the last reading. Default: all of them. */
  fresh?: number;
  bends?: LedgerInput["bends"];
  /** The town's feed, for births, deaths and what the chronicle would keep. */
  feed?: FeedItem[];
  /** A region's chronicle, when there is one (it is read instead of the feed). */
  chronicle?: { tick: Tick; town?: string; kind: string; text: string; agents?: AgentId[]; why?: Why[] }[];
}

export interface HistoryOptions {
  /** How many steps upstream of a kept choice are kept with it. */
  depth?: number;
  /** How many causes are kept per effect. */
  breadth?: number;
  /** Past this many choices, the least important old conversations are let go. */
  maxMoments?: number;
}

/** Traces before the fresh ones that are read again, so links to a little earlier (what was just said, a feeling that lingers) still join up. */
const OVERLAP = 600;

const edgeKey = (e: { from: string; to: string; mechanism: string }) => `${e.from}|${e.to}|${e.mechanism}`;

// ---------------------------------------------------------------- the history

export class CausalHistory {
  calendar: Calendar = {};
  nodes = new Map<string, HistoryNode>();
  private edgeMap = new Map<string, LedgerEdge>();
  into = new Map<string, LedgerEdge[]>();
  out = new Map<string, LedgerEdge[]>();
  /** Every kept choice, oldest first. */
  moments: Moment[] = [];
  private momentIds = new Map<string, Moment>();
  people: Record<AgentId, PersonRecord> = {};
  marks: Mark[] = [];
  private markIds = new Set<string>();
  weights = new Map<string, Weight>();
  /** The latest tick read. */
  to: Tick = 0;
  /** How many times the live ledger has been read. */
  readings = 0;
  private readonly opts: Required<HistoryOptions>;

  constructor(opts: HistoryOptions = {}) {
    this.opts = { depth: opts.depth ?? 9, breadth: opts.breadth ?? 4, maxMoments: opts.maxMoments ?? 80_000 };
  }

  get edges(): LedgerEdge[] {
    return [...this.edgeMap.values()];
  }
  get size(): { nodes: number; edges: number; moments: number; people: number; marks: number } {
    return { nodes: this.nodes.size, edges: this.edgeMap.size, moments: this.moments.length, people: Object.keys(this.people).length, marks: this.marks.length };
  }
  moment(id: string): Moment | undefined {
    return this.momentIds.get(id);
  }
  /** The history as a ledger, for the queries in ledger.ts that don't care about time. */
  ledger(): Ledger {
    return { nodes: this.nodes, edges: this.edges, into: this.into, out: this.out };
  }

  private addNode(n: LedgerNode, town?: string): void {
    const have = this.nodes.get(n.id);
    if (!have) this.nodes.set(n.id, { ...n, town: n.agent || n.kind === "event" || n.kind === "conversation" || n.kind === "norm" ? town : undefined });
    else {
      // A memory's wording changes as it is retold; the history shows how it is told now, and keeps the moment that laid it down.
      have.label = n.label;
      if (n.trace && !have.trace) have.trace = n.trace;
      if (Number.isFinite(n.tick) && !Number.isFinite(have.tick)) have.tick = n.tick;
    }
  }

  private addEdge(e: LedgerEdge): boolean {
    const k = edgeKey(e);
    const have = this.edgeMap.get(k);
    // Weights are kept to three places, so a saved history walks exactly like the one in memory.
    const weight = Math.round(e.weight * 1000) / 1000;
    if (have) {
      if (weight > have.weight) have.weight = weight;
      return false;
    }
    // A link is never older than its cause. (The ledger dates "told by" at the belief's birth, even when
    // the telling it points to is a later one; walking back in time must not pass through that.)
    const from = this.nodes.get(e.from);
    const kept = { ...e, weight, tick: from && Number.isFinite(from.tick) ? Math.max(e.tick, from.tick) : e.tick };
    this.edgeMap.set(k, kept);
    (this.into.get(e.to) ?? this.into.set(e.to, []).get(e.to)!).push(kept);
    (this.out.get(e.from) ?? this.out.set(e.from, []).get(e.from)!).push(kept);
    return true;
  }

  /** Keep a node from the live ledger with what is upstream of it, as far as the options allow. */
  private take(L: Ledger, id: string, bound: Tick, town: string | undefined, counts: { nodes: number; edges: number }): void {
    const reached = new Map<string, Tick>();
    let frontier: { id: string; bound: Tick }[] = [{ id, bound }];
    const before = this.nodes.size;
    for (let d = 0; d <= this.opts.depth && frontier.length; d++) {
      const next: { id: string; bound: Tick }[] = [];
      for (const f of frontier) {
        const n = L.nodes.get(f.id);
        if (!n) continue;
        this.addNode(n, town);
        if (d === this.opts.depth) continue;
        const done = reached.get(f.id);
        if (done !== undefined && done >= f.bound) continue;
        reached.set(f.id, f.bound);
        const incoming = causesAt(L.into.get(f.id), f.bound, n.kind === "decision" ? this.opts.breadth + 2 : n.kind === "relation" ? 3 : this.opts.breadth, d === 0 ? 0 : 0.03);
        for (const e of incoming) {
          const src = L.nodes.get(e.from);
          if (!src) continue;
          this.addNode(src, town);
          if (this.addEdge(e)) counts.edges++;
          next.push({ id: e.from, bound: Math.min(f.bound, e.tick) });
        }
      }
      frontier = next;
    }
    counts.nodes += this.nodes.size - before;
  }

  /** Read the live ledger of one town and keep what should outlast it. Reading the same traces twice adds nothing. */
  absorb(src: HistorySource): AbsorbReport {
    const started = Date.now();
    const { world: w, town } = src;
    if (w.village) this.calendar = { seasonDays: w.village.seasonDays };
    const fresh = Math.min(src.traces.length, src.fresh ?? src.traces.length);
    const traces = src.traces.slice(Math.max(0, src.traces.length - fresh - OVERLAP));
    const L = buildLedger({ minds: w.minds, traces, rumors: w.rumors, events: w.events, village: w.village, edits: w.edits, bends: src.bends });
    const counts = { nodes: 0, edges: 0 };
    let added = 0;
    // Something that happened to people with no record of its own (a roof finished, a birth) is named by what they saw.
    for (const { trace: t } of traces) {
      const p = t.percept;
      const n = p?.eventId && p.actor === "world" ? L.nodes.get(nodeId.world(p.eventId)) : undefined;
      if (n?.kind === "conversation") {
        n.kind = "event";
        n.label = p!.rawText;
      }
    }

    for (const { agent, trace: t } of traces) {
      const d = t.decision;
      if (!d || !t.percept) continue;
      const id = nodeId.decision(agent, t.id);
      if (this.momentIds.has(id) || !L.nodes.has(id)) continue;
      const kind = KIND_OF_EVENT.find(([re]) => re.test(t.percept!.eventId ?? ""))?.[1] ?? "other";
      const feeling = Math.max(0, ...Object.values(t.appraisal?.emotions ?? {}));
      const rewrote = t.reconsolidations.some((r) => r.version.changes.length > 0);
      // Most of life is small talk that goes the usual way. It is not kept unless something in it was out of the ordinary.
      // (Thinking it through and mood-congruent recall happen in most conversations, so they don't make one unusual.)
      const biases = t.biases.filter((b) => b.name !== "Mood-congruent recall");
      const routine = kind === "talk" && (d.choice === "warm" || d.choice === "polite") && feeling < 0.45 && !biases.length && !rewrote;
      if (routine) continue;
      const ranked = [...d.options].sort((a, b) => b.utility - a.utility);
      const chosen = d.options.find((o) => o.id === d.choice);
      const gap = ranked.length > 1 ? Math.abs(ranked[0]!.utility - ranked[1]!.utility) : 1;
      const weight = Math.min(1, (kind === "talk" ? 0.2 : kind === "plan" || kind === "works" ? 0.55 : 0.45) + (d.system === 2 && kind !== "talk" ? 0.15 : 0) + (gap < 0.08 ? 0.1 : 0) + (feeling >= 0.45 ? 0.15 : 0) + Math.min(0.15, biases.length * 0.08) + (rewrote ? 0.1 : 0));
      const m: Moment = {
        id,
        agent,
        tick: t.tick,
        town,
        kind,
        choice: chosen?.label ?? d.choice,
        over: ranked.filter((o) => o.id !== d.choice).slice(0, 3).map((o) => ({ label: o.label, gap: Number(((chosen?.utility ?? 0) - o.utility).toFixed(2)) })),
        question: t.headline.question,
        answer: t.headline.answer,
        thought: d.system === 2,
        said: t.action && t.action.kind !== "none" ? t.action.text : undefined,
        weight: Number(weight.toFixed(2)),
        trace: t.id,
      };
      this.take(L, id, t.tick, town, counts);
      // What competed for attention and lost, so "what didn't come to mind" outlasts the trace.
      for (const e of (L.into.get(id) ?? []).filter((x) => x.suppressed).slice(0, 2)) {
        this.addNode(L.nodes.get(e.from)!, town);
        this.addEdge(e);
      }
      // An intention made at the turn of the season may have left the live ledger by the time it leans on a choice.
      for (const term of chosen?.terms ?? []) {
        if (!term.ref?.startsWith("intent:") || term.value <= 0) continue;
        const from = nodeId.decision(agent, term.ref.slice(7));
        if (this.nodes.has(from)) this.addEdge({ from, to: id, mechanism: "meant to", weight: Math.min(1, term.value * 2), tick: t.tick });
      }
      this.moments.push(m);
      this.momentIds.set(id, m);
      added++;
    }

    // What weighs on each person now: their core beliefs and darkest beliefs, with where each came from.
    for (const id of w.order) {
      const mind = w.minds[id];
      if (!mind) continue;
      const mine: Weight[] = [];
      for (const s of mind.schemas) mine.push({ id: nodeId.item(id, s.id), agent: id, kind: "schema", label: s.text, strength: s.strength, seen: w.tick });
      for (const b of mind.beliefs.filter((x) => x.valence < -0.2 && x.confidence >= 0.4).sort((x, y) => y.confidence * -y.valence - x.confidence * -x.valence).slice(0, 3)) {
        mine.push({ id: nodeId.item(id, b.id), agent: id, kind: "belief", label: b.proposition, strength: b.confidence, seen: w.tick });
      }
      for (const c of mine) {
        if (!L.nodes.has(c.id)) continue;
        this.take(L, c.id, w.tick, town, counts);
        this.weights.set(c.id, c);
      }
    }

    this.readPeople(w, town);
    this.readMarks(src);
    this.to = Math.max(this.to, w.tick);
    this.readings++;
    if (added) this.moments.sort((a, b) => a.tick - b.tick);
    if (this.moments.length > this.opts.maxMoments) this.thin();
    return { moments: added, nodes: counts.nodes, edges: counts.edges, ms: Date.now() - started };
  }

  private readPeople(w: WorldState, town: string | undefined): void {
    for (const [id, mind] of Object.entries(w.minds)) {
      const life = w.village?.life[id];
      const have = this.people[id];
      this.people[id] = {
        id,
        name: mind.name,
        role: w.agents[id]?.role ?? have?.role,
        // Someone who left for another town is read there from then on; the dead stay where they died.
        town: w.order.includes(id) || !have ? town : have.town,
        born: life?.born ?? have?.born,
        died: life?.died ?? have?.died,
        cause: life?.cause ?? have?.cause,
        parents: life?.parents ?? have?.parents ?? [],
        generation: life?.generation ?? have?.generation,
      };
    }
  }

  private readMarks(src: HistorySource): void {
    const add = (m: Mark) => {
      if (this.markIds.has(m.id)) return;
      this.markIds.add(m.id);
      this.marks.push(m);
    };
    const before = this.marks.length;
    if (src.chronicle) {
      for (const c of src.chronicle) add({ id: `chr:${c.tick}:${c.town ?? ""}:${c.kind}:${c.text.slice(0, 48)}`, tick: c.tick, kind: c.kind, text: c.text, town: c.town, agents: c.agents, why: c.why });
    } else {
      for (const f of src.feed ?? []) {
        if (f.kind !== "event" && f.kind !== "insight") continue;
        const kind = f.chronicle?.kind ?? (/ is born /.test(f.title) ? "birth" : / dies|died/.test(f.title) ? "death" : / is asked to lead /.test(f.title) ? "leader" : /law/i.test(f.title) && !/takes its share/.test(f.title) ? "law" : undefined);
        if (!kind) continue;
        add({ id: `feed:${src.town ?? ""}:${f.id}`, tick: f.tick, kind, text: f.text && !f.chronicle?.why?.length ? `${f.title}. ${f.text}` : `${f.title}.`, town: src.town, agents: f.agents.slice(0, 3), why: f.chronicle?.why });
      }
      for (const e of src.world.events) {
        if (!["storm", "blight", "catch", "anomaly"].includes(e.kind)) continue;
        add({ id: `ev:${src.town ?? ""}:${e.id}`, tick: e.tick, kind: e.kind, text: `${e.label.charAt(0).toUpperCase()}${e.label.slice(1)}.`, town: src.town });
      }
    }
    if (this.marks.length > before) this.marks.sort((a, b) => a.tick - b.tick);
  }

  /** Let the least important old conversations go, and whatever only they were holding on to. */
  private thin(): void {
    const target = Math.floor(this.opts.maxMoments * 0.9);
    const drop = new Set(
      [...this.moments]
        .sort((a, b) => a.weight - b.weight || a.tick - b.tick)
        .slice(0, this.moments.length - target)
        .map((m) => m.id),
    );
    this.moments = this.moments.filter((m) => !drop.has(m.id));
    this.sweep();
  }

  /** Forget everything after a tick (the world was wound back to it). */
  truncate(tick: Tick): void {
    this.moments = this.moments.filter((m) => m.tick <= tick);
    this.marks = this.marks.filter((m) => m.tick <= tick);
    this.markIds = new Set(this.marks.map((m) => m.id));
    // What weighed on someone before then still does; only what formed afterwards goes.
    for (const [id, c] of this.weights) {
      const born = this.nodes.get(id)?.tick;
      if (born !== undefined && Number.isFinite(born) && born > tick) this.weights.delete(id);
      else c.seen = Math.min(c.seen, tick);
    }
    for (const [k, e] of this.edgeMap) if (e.tick > tick) this.edgeMap.delete(k);
    for (const p of Object.values(this.people)) {
      if (p.died !== undefined && p.died > tick) p.died = p.cause = undefined;
      if (p.born !== undefined && p.born > tick) delete this.people[p.id];
    }
    this.to = Math.min(this.to, tick);
    this.sweep();
  }

  /** Drop what no kept choice or weight still leads back to, and rebuild the indexes. */
  private sweep(): void {
    this.momentIds = new Map(this.moments.map((m) => [m.id, m]));
    const into = new Map<string, LedgerEdge[]>();
    for (const e of this.edgeMap.values()) (into.get(e.to) ?? into.set(e.to, []).get(e.to)!).push(e);
    const keep = new Set<string>();
    const stack = [...this.momentIds.keys(), ...this.weights.keys()];
    while (stack.length) {
      const id = stack.pop()!;
      if (keep.has(id) || !this.nodes.has(id)) continue;
      keep.add(id);
      for (const e of into.get(id) ?? []) stack.push(e.from);
    }
    for (const id of [...this.nodes.keys()]) if (!keep.has(id)) this.nodes.delete(id);
    for (const id of [...this.weights.keys()]) if (!keep.has(id)) this.weights.delete(id);
    this.into = new Map();
    this.out = new Map();
    for (const [k, e] of this.edgeMap) {
      if (!keep.has(e.from) || !keep.has(e.to)) {
        this.edgeMap.delete(k);
        continue;
      }
      (this.into.get(e.to) ?? this.into.set(e.to, []).get(e.to)!).push(e);
      (this.out.get(e.from) ?? this.out.set(e.from, []).get(e.from)!).push(e);
    }
  }

  // -------------------------------------------------------------- saving

  toJSON(): SavedHistory {
    const ids = [...this.nodes.keys()];
    const index = new Map(ids.map((id, i) => [id, i]));
    const mechs: Mechanism[] = [];
    const mech = (m: Mechanism) => (mechs.includes(m) ? mechs.indexOf(m) : mechs.push(m) - 1);
    return {
      version: 1,
      calendar: this.calendar,
      to: this.to,
      readings: this.readings,
      nodes: [...this.nodes.values()].map((n) => [n.id, n.kind, n.agent ?? 0, Number.isFinite(n.tick) ? n.tick : null, n.label, n.trace ?? 0, n.town ?? 0]),
      mechanisms: mechs,
      edges: [...this.edgeMap.values()].map((e) => [index.get(e.from)!, index.get(e.to)!, mech(e.mechanism), Number(e.weight.toFixed(3)), e.tick, e.suppressed ? 1 : 0]),
      moments: this.moments,
      people: this.people,
      marks: this.marks,
      weights: [...this.weights.values()],
    };
  }

  static fromJSON(s: SavedHistory, opts: HistoryOptions = {}): CausalHistory {
    const H = new CausalHistory(opts);
    H.calendar = s.calendar;
    H.to = s.to;
    H.readings = s.readings;
    for (const [id, kind, agent, tick, label, trace, town] of s.nodes) H.nodes.set(id, { id, kind, agent: agent || undefined, tick: tick ?? -Infinity, label, trace: trace || undefined, town: town || undefined });
    const ids = s.nodes.map((n) => n[0]);
    for (const [from, to, m, weight, tick, suppressed] of s.edges) H.addEdge({ from: ids[from]!, to: ids[to]!, mechanism: s.mechanisms[m]!, weight, tick, suppressed: suppressed ? true : undefined });
    H.moments = s.moments;
    H.momentIds = new Map(s.moments.map((m) => [m.id, m]));
    H.people = s.people;
    H.marks = s.marks;
    H.markIds = new Set(s.marks.map((m) => m.id));
    H.weights = new Map(s.weights.map((c) => [c.id, c]));
    return H;
  }
}

export interface SavedHistory {
  version: 1;
  calendar: Calendar;
  to: Tick;
  readings: number;
  /** id, kind, agent, tick (null for what was always there), label, trace, town. */
  nodes: [string, NodeKind, AgentId | 0, Tick | null, string, string | 0, string | 0][];
  mechanisms: Mechanism[];
  /** from and to as positions in `nodes`, mechanism as a position in `mechanisms`, weight, tick, suppressed. */
  edges: [number, number, number, number, Tick, 0 | 1][];
  moments: Moment[];
  people: Record<AgentId, PersonRecord>;
  marks: Mark[];
  weights: Weight[];
}

// ---------------------------------------------------------------- walking it

type Graph = Pick<Ledger, "nodes" | "into" | "out">;

/** The causes of an effect that had already happened by `bound`, strongest first (then latest), at most `breadth` of them. */
function causesAt(incoming: LedgerEdge[] | undefined, bound: Tick, breadth: number, floor = 0): LedgerEdge[] {
  if (!incoming) return [];
  return incoming
    .filter((e) => !e.suppressed && e.weight > floor && e.tick <= bound)
    .sort((x, y) => y.weight - x.weight || y.tick - x.tick)
    .slice(0, breadth);
}

export interface TrailOptions {
  depth?: number;
  breadth?: number;
  /** Causes that account for less than this share of the root are left out. */
  floor?: number;
  /** At most this many nodes; the floor is raised until the trail fits. */
  max?: number;
  /** Walk back from the node as it stood at this tick. Default: when it happened (or now, for standing things). */
  at?: Tick;
}

/**
 * Walk backwards in time from a node: its strongest causes, their causes, and so on, never following
 * a link that had not happened yet. The same shape as ledger.ts `why`, so the same views can draw it.
 */
export function trail(G: Graph, id: string, opts: TrailOptions = {}): WhyTree | undefined {
  const { depth = 10, breadth = 4, max = 90 } = opts;
  const root = G.nodes.get(id);
  if (!root) return undefined;
  const start = opts.at ?? (Number.isFinite(root.tick) && root.kind !== "schema" && root.kind !== "belief" ? root.tick : Infinity);
  let floor = opts.floor ?? 0.01;
  for (let attempt = 0; ; attempt++) {
    const shown = new Set<string>([id]);
    let count = 1;
    const grow = (n: LedgerNode, share: number, d: number, bound: Tick): WhyTree[] => {
      if (d >= depth) return [];
      const out: WhyTree[] = [];
      for (const e of causesAt(G.into.get(n.id), bound, breadth)) {
        const s = share * e.weight;
        if (s < floor) continue;
        const src = G.nodes.get(e.from);
        if (!src) continue;
        count++;
        if (shown.has(src.id)) {
          out.push({ node: src, via: e, share: s, repeat: true, causes: [] });
          continue;
        }
        shown.add(src.id);
        out.push({ node: src, via: e, share: s, causes: grow(src, s, d + 1, Math.min(bound, e.tick)), missed: missedAt(G, src.id) });
      }
      return out;
    };
    const tree: WhyTree = { node: root, share: 1, causes: grow(root, 1, 0, start), missed: missedAt(G, id) };
    if (count <= max || attempt >= 8) return tree;
    floor *= 1.8;
  }
}

function missedAt(G: Graph, id: string): LedgerNode[] | undefined {
  const m = (G.into.get(id) ?? []).filter((e) => e.suppressed).map((e) => G.nodes.get(e.from)).filter((n): n is LedgerNode => !!n);
  return m.length ? m : undefined;
}

/** One step on a thread, with the link that leads on from it towards the choice. */
export interface ThreadStep {
  node: LedgerNode;
  /** How this step led to the next one (absent on the last step, the thing being explained). */
  mechanism?: Mechanism;
  share: number;
}

const flatten = (t: WhyTree, path: WhyTree[] = [], out: WhyTree[][] = []): WhyTree[][] => {
  const here = [...path, t];
  if (!t.causes.length) out.push(here);
  for (const c of t.causes) flatten(c, here, out);
  return out;
};

const asThread = (path: WhyTree[]): ThreadStep[] => [...path].reverse().map((t) => ({ node: t.node, mechanism: t.via?.mechanism, share: t.share }));

/** The thread that carries the most weight, oldest cause first. */
export function strongestThread(tree: WhyTree): ThreadStep[] {
  const path = [tree];
  let t = tree;
  while (t.causes.length) {
    t = [...t.causes].sort((x, y) => y.share - x.share)[0]!;
    path.push(t);
    if (t.repeat) break;
  }
  return asThread(path);
}

/** The thread that reaches furthest back in time, oldest cause first: where it all started. */
export function longestThread(tree: WhyTree): ThreadStep[] {
  let best: WhyTree[] = [tree];
  let oldest = Infinity;
  for (const path of flatten(tree)) {
    // Standing things (trust, a goal) have no date; the oldest dated cause on the path is what counts.
    const t = Math.min(...path.map((p) => (Number.isFinite(p.node.tick) ? p.node.tick : Infinity)));
    const share = path[path.length - 1]!.share;
    if (t < oldest || (t === oldest && share > best[best.length - 1]!.share)) {
      oldest = t;
      best = path;
    }
  }
  return asThread(best);
}

export interface Origins {
  /** Everything upstream that had happened by then, oldest first. */
  ancestors: { node: LedgerNode; steps: number }[];
  /** Ancestors with nothing behind them: where it started. */
  roots: LedgerNode[];
  /** Other people whose minds it passed through. */
  minds: AgentId[];
  /** The earliest dated cause. */
  earliest?: Tick;
}

/** Everything upstream of a node, however weak, that had already happened: the whole family tree of a choice or a fear. */
export function origins(G: Graph, id: string, opts: { maxSteps?: number; max?: number; at?: Tick } = {}): Origins | undefined {
  const root = G.nodes.get(id);
  if (!root) return undefined;
  const { maxSteps = 14, max = 600 } = opts;
  const start = opts.at ?? (Number.isFinite(root.tick) && root.kind !== "schema" && root.kind !== "belief" ? root.tick : Infinity);
  const steps = new Map<string, number>();
  const bounds = new Map<string, Tick>([[id, start]]);
  let frontier = [id];
  for (let s = 1; s <= maxSteps && frontier.length && steps.size < max; s++) {
    const next: string[] = [];
    for (const n of frontier) {
      const bound = bounds.get(n)!;
      for (const e of G.into.get(n) ?? []) {
        if (e.suppressed || e.weight <= 0 || e.tick > bound || e.from === id || !G.nodes.has(e.from)) continue;
        const b = Math.min(bound, e.tick);
        if (steps.has(e.from) && bounds.get(e.from)! >= b) continue;
        if (!steps.has(e.from)) steps.set(e.from, s);
        bounds.set(e.from, b);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  const ancestors = [...steps.entries()].map(([n, s]) => ({ node: G.nodes.get(n)!, steps: s })).sort((x, y) => x.node.tick - y.node.tick || y.steps - x.steps);
  const roots = ancestors.filter((x) => !(G.into.get(x.node.id) ?? []).some((e) => !e.suppressed && e.weight > 0 && e.tick <= bounds.get(x.node.id)!)).map((x) => x.node);
  const minds = [...new Set(ancestors.map((x) => x.node.agent).filter((x): x is AgentId => !!x && x !== root.agent))];
  const dated = ancestors.map((x) => x.node.tick).filter((t) => Number.isFinite(t));
  return { ancestors, roots, minds, earliest: dated.length ? Math.min(...dated) : undefined };
}

export interface Reach {
  /** Choices downstream, strongest first. */
  choices: { node: LedgerNode; share: number; steps: number }[];
  /** Choices it sat directly in mind for. */
  direct: number;
  /** Everyone whose choices it reached, with how many. */
  minds: { agent: AgentId; choices: number }[];
  /** Choices reached per year (or per day where there are no years). */
  byYear: { year: number; choices: number }[];
  first?: Tick;
  last?: Tick;
}

/** Everything downstream of a node, forwards in time: the choices it went on to bend, in whose heads, and when. */
export function reach(G: Graph, cal: Calendar, id: string, opts: { maxSteps?: number; from?: Tick; floor?: number } = {}): Reach | undefined {
  const root = G.nodes.get(id);
  if (!root) return undefined;
  // Everything touches everything through enough conversations. A choice counts as shaped only if a
  // real share of it traces back here.
  const { maxSteps = 12, floor = 0.02 } = opts;
  const best = new Map<string, { share: number; steps: number; at: Tick }>();
  let frontier: { id: string; share: number; at: Tick }[] = [{ id, share: 1, at: opts.from ?? -Infinity }];
  for (let s = 1; s <= maxSteps && frontier.length; s++) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      for (const e of G.out.get(f.id) ?? []) {
        if (e.suppressed || e.to === id || e.tick < f.at || !G.nodes.has(e.to)) continue;
        const share = f.share * e.weight;
        if (share < floor) continue;
        const prev = best.get(e.to);
        if (prev && prev.share >= share && prev.at <= e.tick) continue;
        best.set(e.to, { share: Math.max(share, prev?.share ?? 0), steps: prev ? Math.min(prev.steps, s) : s, at: prev ? Math.min(prev.at, e.tick) : e.tick });
        next.push({ id: e.to, share, at: e.tick });
      }
    }
    frontier = next;
  }
  const choices = [...best.entries()]
    .map(([n, v]) => ({ node: G.nodes.get(n)!, share: v.share, steps: v.steps }))
    .filter((x) => x.node.kind === "decision")
    .sort((x, y) => y.share - x.share);
  const direct = (G.out.get(id) ?? []).filter((e) => !e.suppressed && G.nodes.get(e.to)?.kind === "decision").length;
  const perMind = new Map<AgentId, number>();
  const perYear = new Map<number, number>();
  const y = yearMinutes(cal) ?? DAY;
  for (const c of choices) {
    if (c.node.agent) perMind.set(c.node.agent, (perMind.get(c.node.agent) ?? 0) + 1);
    const yr = Math.floor(c.node.tick / y) + 1;
    perYear.set(yr, (perYear.get(yr) ?? 0) + 1);
  }
  const ticks = choices.map((c) => c.node.tick);
  return {
    choices,
    direct,
    minds: [...perMind.entries()].map(([agent, n]) => ({ agent, choices: n })).sort((a, b) => b.choices - a.choices),
    byYear: [...perYear.entries()].map(([year, n]) => ({ year, choices: n })).sort((a, b) => a.year - b.year),
    first: ticks.length ? Math.min(...ticks) : undefined,
    last: ticks.length ? Math.max(...ticks) : undefined,
  };
}

// ---------------------------------------------------------------- finding things

const STOP = new Set("a an the and or but of to in on at for with from by as is was were be been are did do does why what who whom when where how that this it its his her their they he she you i me my we our so not no than then into out about over after before ever never always still just had has have would could should will can may might there here which while if because came come comes go went got get made make makes back down up off them him".split(" "));

const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);
export const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);

export interface Found {
  node: HistoryNode;
  score: number;
  moment?: Moment;
}

/**
 * Find what a question is about: the people it names, the year it mentions, and the choices, memories
 * and beliefs whose words match. Plain word matching; the Historian does the understanding.
 */
export function find(H: CausalHistory, query: string, opts: { limit?: number; at?: Tick; kinds?: NodeKind[] } = {}): Found[] {
  const { limit = 12 } = opts;
  const words = wordsOf(query);
  if (!words.length) return [];
  const names = new Map<string, AgentId[]>();
  for (const p of Object.values(H.people)) {
    const k = stem(p.name.toLowerCase());
    (names.get(k) ?? names.set(k, []).get(k)!).push(p.id);
  }
  const who = new Set(words.flatMap((w) => names.get(w) ?? []));
  const rest = words.filter((w) => !names.has(w) && !/^\d+$/.test(w) && w !== "year");
  const y = yearMinutes(H.calendar);
  const yearAsked = /\byear\s+(\d+)/i.exec(query)?.[1];
  const at = yearAsked && y ? (Number(yearAsked) - 0.5) * y : opts.at;
  const wantsChoice = /\b(why|chose|choose|decid|refus|did|do)\b/i.test(query);
  const wantsFear = /\b(fear|afraid|belie|wary|distrust|trust|grudge|come from|came from)\b/i.test(query);
  const out: Found[] = [];
  for (const n of H.nodes.values()) {
    if (opts.kinds && !opts.kinds.includes(n.kind)) continue;
    if (n.kind === "percept" || n.kind === "conversation" || n.kind === "sleep" || n.kind === "need") continue;
    const m = n.kind === "decision" ? H.moment(n.id) : undefined;
    const text = wordsOf(m ? `${n.label} ${m.question} ${m.answer}` : n.label);
    let hits = 0;
    for (const w of rest) if (text.includes(w)) hits++;
    const named = !!n.agent && who.has(n.agent);
    if (!hits && !(named && (m || H.weights.has(n.id)))) continue;
    let score = rest.length ? (hits / rest.length) * 2 : 0;
    if (named) score += 1.5;
    else if (who.size) score -= 0.75;
    if (m) score += m.weight * 0.6 + (wantsChoice ? 0.4 : 0);
    if (n.kind === "schema") score += wantsFear ? 0.9 : 0.3;
    if (n.kind === "belief" && wantsFear) score += 0.4;
    if (at !== undefined && Number.isFinite(n.tick) && y) score += 0.8 / (1 + Math.abs(n.tick - at) / y);
    if (score > 0.5) out.push({ node: n, score, moment: m });
  }
  return out.sort((a, b) => b.score - a.score || b.node.tick - a.node.tick).slice(0, limit);
}
