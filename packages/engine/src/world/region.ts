// A region of towns. Hollow Bay grows until a group that never quite belonged leaves to found a
// town of its own; towns trade, and traders carry stories; a short-weighted trade becomes a grievance
// that the whole town comes to believe, and a gift can mend it.
//
// Each town is its own world on its own session (the village loop runs unchanged inside it). The
// region steps them together and does what happens between them. When a mind needs to point at a
// memory in another town (a trader's story, the stories the leavers grew up on), the memories that
// chain needs are carried across as remembered copies, so the lineage can still be followed.
//
// Only the towns someone is watching need to run hour by hour. With a live budget, the others drop
// to the aggregate tier (aggregate.ts): a season at a time, on rules, with their people intact, and
// they come back to the hourly loop when someone looks at them again. Between towns, everything
// (splits, trade, grievances, peace gifts, regard) works the same whichever tier a town is on.

import { clamp, render } from "../memory.js";
import { dayOf, runPercept } from "../mind.js";
import type { Faculties, Percept } from "../ports.js";
import { nextId, nextRandom } from "../rng.js";
import type { AgentId, Episode, MindState, Tick } from "../types.js";
import { aggAdvance, dematerialize, materialize } from "./aggregate.js";
import { foundingVersion, rootOf } from "./civic.js";
import { craft, craftBonus, knows, learn, townCrafts } from "./knowledge.js";
import { ageOf, hearStory, isChild, schemaLineage, yearOf } from "./life.js";
import { CROSSING } from "./people.js";
import { WorldSession, type WorldSessionOptions } from "./session.js";
import { createVillage, foundVillage, type Household } from "./village.js";
import { eventPercept, feed, personName, record, thirdPerson, type Sink, type Why, type WorldState } from "./world.js";

export interface Town {
  id: string;
  name: string;
  founded: Tick;
  from?: string;
  founders: AgentId[];
  /** Running on the aggregate tier (nobody is watching it). */
  agg?: boolean;
  /** One sample a season. */
  history: { tick: Tick; year: number; people: number; children: number; food: number; store: number; leader?: AgentId }[];
}

export interface Trade {
  tick: Tick;
  from: string;
  to: string;
  trader: AgentId;
  gave: { kind: "food" | "timber" | "stone"; amount: number };
  got: { kind: "food" | "timber" | "stone"; amount: number };
  /** The trader kept back part of what was owed. */
  short: boolean;
  noticed: boolean;
  story?: string;
}

export interface ChronicleEntry {
  tick: Tick;
  year: number;
  town?: string;
  kind: "founding" | "leader" | "law" | "death" | "trade" | "quarrel" | "peace" | "hunger" | "craft" | "lost";
  text: string;
  agents?: AgentId[];
  /** What led to it, as far back as the records go: the people, their reasons and the memories behind them. */
  why?: Why[];
}

export interface RegionState {
  seed: number;
  tick: Tick;
  rng: number;
  idCounter: number;
  towns: Town[];
  /** How each town regards another, from its adults' beliefs about it (-1 to 1), keyed `a>b`. */
  regard: Record<string, number>;
  trades: Trade[];
  chronicle: ChronicleEntry[];
  /** Who left which town for which, and when. */
  departed: Record<AgentId, { from: string; to: string; tick: Tick }>;
  last: { day: number; season: string; feed: Record<string, number> };
}

export interface RegionOptions {
  /** A town splits once it reaches this many living. */
  splitAt?: number;
  maxTowns?: number;
  session?: WorldSessionOptions;
  /** How many towns run live at once; the rest run on the aggregate tier. Default: all live. */
  live?: number;
  /** Faculties for aggregated towns (the few things that still go through a mind there). Default: the region's own. */
  cheap?: Faculties;
}

const TOWN_NAMES = ["Saltmarsh", "Greyhaven", "Wickstead", "Thornmouth", "Fennick Cove", "Larkhollow", "Corrie", "Seal Point", "Kittiwake", "Brindle", "Ashgrove", "Westering", "Mullion", "Gannet Rock", "Dunlin", "Tarn"];
const SPLIT_AT = 26;
const MAX_TOWNS = 4;
const townBelief = (t: Town) => `town:${t.id}`;

export class RegionSession {
  region: RegionState;
  /** The towns running live, each on its own session. */
  towns: Record<string, WorldSession> = {};
  /** The towns on the aggregate tier, as their trimmed worlds. */
  aggs: Record<string, WorldState> = {};
  private sinks: Record<string, Sink> = {};
  private faculties: Faculties;
  private opts: RegionOptions;
  /** Most recently watched first: the towns the live budget keeps. */
  private watched: string[] = [];
  /** Beliefs about other towns changed today, so regard needs working out again. */
  private dirty = false;

  constructor(region: RegionState, worlds: Record<string, WorldState>, faculties: Faculties, opts: RegionOptions = {}) {
    this.region = region;
    this.faculties = faculties;
    this.opts = opts;
    for (const [id, w] of Object.entries(worlds)) {
      if (region.towns.find((t) => t.id === id)?.agg) this.aggs[id] = w;
      else this.towns[id] = new WorldSession(w, faculties, opts.session);
    }
    this.watched = region.towns.filter((t) => !t.agg).map((t) => t.id);
  }

  static create(seed = 11, faculties: Faculties, opts: RegionOptions = {}): RegionSession {
    const w = createVillage(seed);
    w.village!.town = "hollow";
    const region: RegionState = {
      seed,
      tick: w.tick,
      rng: (seed * 2654435761) >>> 0,
      idCounter: 0,
      towns: [{ id: "hollow", name: w.name, founded: w.tick, founders: [...w.order], history: [] }],
      regard: {},
      trades: [],
      chronicle: [],
      departed: {},
      last: { day: dayOf(w.tick), season: w.village!.season, feed: { hollow: 0 } },
    };
    return new RegionSession(region, { hollow: w }, faculties, opts);
  }

  setFaculties(f: Faculties): void {
    this.faculties = f;
    for (const s of Object.values(this.towns)) s.setFaculties(f);
  }

  world(town: string): WorldState {
    return this.towns[town]?.world ?? this.aggs[town]!;
  }

  /** Every town's world, live or aggregated (what a save keeps). */
  worlds(): Record<string, WorldState> {
    return Object.fromEntries(this.region.towns.map((t) => [t.id, this.world(t.id)]));
  }

  /** Watch a town: bring it back to life if it was aggregated, and let the budget drop another. */
  focus(town: string): WorldSession {
    if (!this.region.towns.some((t) => t.id === town)) throw new Error(`No town ${town}.`);
    if (this.aggs[town]) this.materializeTown(town);
    this.watched = [town, ...this.watched.filter((x) => x !== town)];
    this.budget();
    return this.towns[town]!;
  }

  /** Change how many towns run live (0: all aggregated). */
  setLive(n: number): void {
    this.opts = { ...this.opts, live: n };
    this.budget();
  }

  private budget(): void {
    const max = this.opts.live ?? Infinity;
    const live = this.region.towns.filter((t) => !t.agg).map((t) => t.id);
    if (live.length <= max) return;
    const rank = (id: string) => (this.watched.includes(id) ? this.watched.indexOf(id) : Infinity);
    for (const id of live.sort((a, b) => rank(b) - rank(a)).slice(0, live.length - max)) this.dematerializeTown(id);
  }

  private dematerializeTown(id: string): void {
    this.harvest();
    const t = this.region.towns.find((x) => x.id === id)!;
    this.aggs[id] = dematerialize(this.towns[id]!.world);
    delete this.towns[id];
    t.agg = true;
    this.sinks[id] = { feed: [], traces: [] };
    this.region.last.feed[id] = 0;
    this.watched = this.watched.filter((x) => x !== id);
  }

  private materializeTown(id: string): void {
    this.harvest();
    const t = this.region.towns.find((x) => x.id === id)!;
    this.towns[id] = new WorldSession(materialize(this.aggs[id]!), this.faculties, this.opts.session);
    delete this.aggs[id];
    delete this.sinks[id];
    t.agg = false;
    this.region.last.feed[id] = 0;
  }

  private sinkOf(id: string): Sink {
    const s = this.towns[id];
    return s ? { feed: s.feed, traces: s.traces } : (this.sinks[id] ??= { feed: [], traces: [] });
  }

  private facultiesOf(id: string): Faculties {
    return this.towns[id] ? this.faculties : (this.opts.cheap ?? this.faculties);
  }

  /** Every mind in the region, the living copy first, then the dead, departed and remembered. */
  minds(): Record<AgentId, MindState> {
    const out: Record<AgentId, MindState> = {};
    const worlds = this.region.towns.map((t) => this.world(t.id));
    for (const w of worlds) for (const id of w.order) out[id] = w.minds[id]!;
    // Each town keeps its own remembered copy of someone, with the memories its own stories point to;
    // together they are as much of that person as the region still holds.
    for (const w of worlds)
      for (const [id, m] of Object.entries(w.minds)) {
        const have = out[id];
        if (!have) {
          out[id] = m;
          continue;
        }
        if (have === m) continue;
        const ids = new Set(have.episodes.map((e) => e.id));
        const extra = m.episodes.filter((e) => !ids.has(e.id));
        if (extra.length) out[id] = { ...have, episodes: [...have.episodes, ...extra] };
      }
    return out;
  }

  /** Advance every town together, then do what happens between them. */
  async advance(minutes: number, opts: { snapshot?: boolean } = {}): Promise<void> {
    for (const t of this.region.towns) {
      this.reserve(t.id);
      if (this.towns[t.id]) await this.towns[t.id]!.apply({ type: "advance", minutes }, opts);
      else await aggAdvance(this.aggs[t.id]!, minutes, this.facultiesOf(t.id), this.sinkOf(t.id));
    }
    this.region.tick = this.world(this.region.towns[0]!.id).tick;
    await this.turn();
  }

  rebase(): void {
    for (const s of Object.values(this.towns)) s.rebase();
  }

  private reserve(town: string): void {
    const ids: string[] = [];
    const names: string[] = [];
    for (const t of this.region.towns) {
      if (t.id === town) continue;
      const w = this.world(t.id);
      ids.push(...Object.keys(w.minds), ...Object.keys(w.village!.households));
      names.push(...Object.values(w.minds).map((m) => m.name));
    }
    this.world(town).village!.reserved = { ids, names: [...new Set(names)] };
  }

  private rand(): number {
    return nextRandom(this.region as unknown as { rng: number });
  }

  private chronicle(e: Omit<ChronicleEntry, "tick" | "year">): void {
    const w = this.world(this.region.towns[0]!.id);
    this.region.chronicle.push({ tick: this.region.tick, year: yearOf(w), ...e, text: cap(e.text) });
    if (this.region.chronicle.length > 2000) this.region.chronicle.splice(0, this.region.chronicle.length - 2000);
  }

  private async turn(): Promise<void> {
    const r = this.region;
    this.harvest();
    const day = dayOf(r.tick);
    if (day === r.last.day) return;
    r.last.day = day;
    const first = this.world(r.towns[0]!.id).village!;
    let season = false;
    if (first.season !== r.last.season) {
      season = true;
      r.last.season = first.season;
      for (const t of r.towns) this.sample(t);
      if (first.season === "spring") await this.maybeSplit();
      await this.mend();
    }
    await this.trade();
    // Regard is worked out from everyone's beliefs: each season, and whenever something changed them.
    if (season || this.dirty) this.regard();
    this.dirty = false;
    this.harvest();
  }

  /** The chronicle reads what each town's feed recorded since the last turn. */
  private harvest(): void {
    for (const t of this.region.towns) {
      const s = this.sinkOf(t.id);
      const from = this.region.last.feed[t.id] ?? 0;
      for (const f of s.feed.slice(from)) {
        if (f.chronicle) this.chronicle({ town: t.id, kind: f.chronicle.kind as ChronicleEntry["kind"], text: f.chronicle.why?.length ? `${f.title}.` : `${f.title}. ${f.text ?? ""}`.trim(), agents: f.agents.slice(0, 3), why: f.chronicle.why });
        else if (/ dies$/.test(f.title) && f.text && !/^\S+ was (\d|1[01])\./.test(f.text)) {
          const w = this.world(t.id);
          const id = f.agents[0];
          const leader = id && (w.village!.civic?.elections ?? []).some((e) => e.leader === id);
          // The crossing generation's deaths are history; later founders' are their own town's.
          const founder = id && this.region.towns[0]!.founders.includes(id);
          if (leader || founder || /hunger/.test(f.text)) this.chronicle({ town: t.id, kind: /hunger/.test(f.text) ? "hunger" : "death", text: `${f.title} in ${t.name}. ${f.text}`, agents: f.agents.slice(0, 1) });
        } else if (/ is asked to lead /.test(f.title)) this.chronicle({ town: t.id, kind: "leader", text: f.title + ".", agents: f.agents });
        else if (/law/i.test(f.title) && f.kind === "event" && !/takes its share/.test(f.title)) this.chronicle({ town: t.id, kind: "law", text: `${f.title}: “${f.lines?.[0]?.text ?? ""}” ${f.text ?? ""}`, agents: f.agents.slice(0, 1) });
      }
      this.region.last.feed[t.id] = s.feed.length;
      // Nobody reads an aggregated town's feed but the chronicle; its traces are not kept at all.
      if (!this.towns[t.id]) {
        s.feed.length = 0;
        s.traces.length = 0;
        this.region.last.feed[t.id] = 0;
      }
    }
  }

  private sample(t: Town): void {
    const w = this.world(t.id);
    const v = w.village!;
    const food = Object.values(v.households).reduce((s, h) => s + h.food, 0);
    t.history.push({ tick: w.tick, year: yearOf(w), people: w.order.length, children: w.order.filter((x) => isChild(w, x)).length, food: Math.round(food), store: Math.round(v.store.food), leader: v.civic?.leader });
    if (t.history.length > 800) t.history.splice(0, t.history.length - 800);
  }

  // ------------------------------------------------------------ a town splits

  /**
   * In spring a town past its size can split: the adult who least belongs (who likes the others least)
   * leaves, with their household and the households closest to them, to found a town of their own.
   */
  private async maybeSplit(): Promise<void> {
    const r = this.region;
    if (r.towns.length >= (this.opts.maxTowns ?? MAX_TOWNS)) return;
    const last = Math.max(...r.towns.map((t) => t.founded));
    const yearTicks = this.world(r.towns[0]!.id).village!.seasonDays * 4 * 1440;
    if (r.tick - last < 2 * yearTicks) return;
    for (const t of r.towns) {
      const w = this.world(t.id);
      if (w.order.length < (this.opts.splitAt ?? SPLIT_AT)) continue;
      await this.split(t, w);
      return;
    }
  }

  private async split(from: Town, w: WorldState): Promise<void> {
    const r = this.region;
    const v = w.village!;
    const adults = w.order.filter((x) => !isChild(w, x) && ageOf(w, x) >= 18);
    const belonging = (id: AgentId) => {
      const m = w.minds[id]!;
      const xs = adults.filter((o) => o !== id).map((o) => m.others[o]?.liking ?? 0.5);
      return xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
    };
    const hhOf = (id: AgentId) => Object.values(v.households).find((h) => h.members.includes(id));
    const seed = [...adults].filter((x) => hhOf(x)).sort((a, b) => belonging(a) - belonging(b) || a.localeCompare(b))[0];
    if (!seed) return;
    const S = w.minds[seed]!;
    const group: Household[] = [hhOf(seed)!];
    const size = () => group.reduce((s, h) => s + h.members.length, 0);
    const close = Object.values(v.households)
      .filter((h) => !group.includes(h))
      .map((h) => ({ h, pull: Math.max(...h.members.filter((m) => !isChild(w, m)).map((m) => w.minds[m]!.others[seed]?.liking ?? 0), 0) - Math.max(...h.members.map((m) => belonging(m) - 0.5), 0) }))
      .sort((a, b) => b.pull - a.pull || a.h.id.localeCompare(b.h.id));
    for (const { h, pull } of close) {
      if (size() >= w.order.length * 0.3 || pull < 0.45) break;
      if (size() + h.members.length > w.order.length * 0.45) continue;
      group.push(h);
    }
    if (size() < 5) return;
    const leavers = group.flatMap((h) => h.members);
    const tname = TOWN_NAMES[r.towns.length - 1] ?? `New ${w.name} ${r.towns.length}`;
    const town: Town = { id: tname.toLowerCase().replace(/\s+/g, "_"), name: tname, founded: r.tick, from: from.id, founders: leavers, history: [] };
    const why = this.splitWhy(w, seed, belonging(seed), group.slice(1), adults);
    const reason = belonging(seed) < 0.45 ? `${S.name} never felt welcome at the fire in ${w.name}` : `there was no more room at ${w.name} for all of us`;
    const leaving = `ep_leaving_${town.id}`;
    const share = v.store.food * (leavers.length / w.order.length) * 0.5;
    v.store.food = Number((v.store.food - share).toFixed(1));

    // The new town's minds are the leavers' own; the stories they grew up on come with them as remembered copies.
    const minds: Record<AgentId, MindState> = {};
    const agents: WorldState["agents"] = {};
    for (const id of leavers) {
      minds[id] = structuredClone(w.minds[id]!);
      agents[id] = structuredClone(w.agents[id]!);
    }
    const fac = this.facultiesOf(from.id);
    const nw = foundVillage({ name: town.name, town: town.id, seed: w.seed * 7 + r.towns.length, tick: w.tick, rng: w.rng ^ Math.imul(r.towns.length + 1, 2246822519), from: v, households: group.map((h) => structuredClone(h)), minds, agents, order: leavers, food: share, founding: leaving });
    carryLineage(w.minds, nw, leavers.flatMap((id) => w.minds[id]!.episodes.filter((e) => e.source.kind === "told").map((e) => ({ agent: id, ep: e }))));

    // Gone from the old town: kept in memory there, as the dead are, but no longer part of its days.
    for (const h of group) {
      const st = v.structures.find((x) => x.household === h.id && !x.done);
      if (st) {
        for (const k of ["timber", "stone", "reeds"] as const) v.stock[k] += st.have[k];
        v.structures = v.structures.filter((x) => x !== st);
      }
      delete v.households[h.id];
    }
    w.order = w.order.filter((x) => !leavers.includes(x));
    for (const id of leavers) {
      w.agents[id]!.place = "harbour";
      w.agents[id]!.activity = `gone to ${town.name}`;
      r.departed[id] = { from: from.id, to: town.id, tick: r.tick };
    }
    for (const id of w.order) w.agents[id]!.wants = w.agents[id]!.wants.filter((x) => !x.target || !leavers.includes(x.target));
    if (v.civic?.leader && leavers.includes(v.civic.leader)) v.civic.leader = undefined;
    r.towns.push(town);
    r.last.feed[town.id] = 0;
    this.towns[town.id] = new WorldSession(nw, this.faculties, this.opts.session);
    // The session works on its own copy; everything from here on happens to that one.
    const nwLive = this.towns[town.id]!.world;
    this.watched = this.watched.filter((x) => x !== town.id);

    // Both sides remember it. The leavers share one memory of leaving: the new town's founding story.
    const counts = new Map<string, number>();
    for (const h of group) counts.set(h.name, (counts.get(h.name) ?? 0) + 1);
    const names = [...counts].map(([n, k]) => (k > 1 ? `${n} (${k} households)` : n));
    const listed = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
    const sNew = this.sinkOf(town.id);
    for (const id of leavers) {
      const m = nwLive.minds[id]!;
      const gist = isChild(nwLive, id) ? `We sailed from ${w.name} to ${town.name} when I was small.` : `We left ${w.name} for ${town.name}, because ${reason.replace(new RegExp(`\\b${S.name}\\b`), id === seed ? "I" : S.name)}.`;
      const p = eventPercept(m, "world", "circumstance", 0.1, 0.75, ["leaving", "founding", "home", from.id, town.id], gist.replace(/\bI never felt\b/, "I never felt"), `${listed} sail from ${w.name} to found ${town.name}.`, leaving);
      const tr = await runPercept(m, p, fac);
      const ep = m.episodes.find((e) => e.id === tr.encoded);
      if (ep) {
        ep.id = leaving;
        tr.encoded = leaving;
      }
      record(nwLive, sNew, id, tr);
    }
    feed(nwLive, sNew, { kind: "event", place: "harbour", agents: leavers, title: `${listed} found ${town.name}`, text: `${leavers.length} people come ashore from ${w.name}. ${cap(reason)}.` });
    const sOld = this.sinkOf(from.id);
    for (const id of w.order.filter((x) => !isChild(w, x))) {
      const m = w.minds[id]!;
      const fond = Math.max(...leavers.map((l) => m.others[l]?.liking ?? 0.5));
      const tr = await runPercept(m, eventPercept(m, "world", "circumstance", fond > 0.65 ? -0.3 : -0.05, 0.5, ["leaving", from.id, town.id], `${listed} left ${w.name} to found ${town.name}.`, `${listed} load the boats and sail for ${town.name}.`, `${leaving}_seen`, leavers.slice(0, 4)), fac);
      record(w, sOld, id, tr);
    }
    feed(w, sOld, { kind: "event", place: "harbour", agents: leavers, title: `${listed} leave to found ${town.name}`, text: `${leavers.length} people sail. ${cap(reason)}.` });
    this.chronicle({ town: town.id, kind: "founding", text: `${listed} left ${w.name} and founded ${town.name}, ${leavers.length} people in all. ${cap(reason)}.`, agents: [seed], why });
    r.regard[`${town.id}>${from.id}`] = 0;
    r.regard[`${from.id}>${town.id}`] = 0;
    this.dirty = true;
    this.budget();
  }

  /**
   * Why a group left: the town's size, the one who belonged least and whom they liked least, the
   * memory behind that, the core belief that colours it and whose memory that belief goes back to,
   * and what drew the other households along.
   */
  private splitWhy(w: WorldState, seed: AgentId, belonging: number, followers: Household[], adults: AgentId[]): Why[] {
    const S = w.minds[seed]!;
    const why: Why[] = [{ text: `${w.name} had grown to ${w.order.length} people; past ${this.opts.splitAt ?? SPLIT_AT}, a town can split.`, town: w.village!.town }];
    why.push({ agent: seed, text: `Of all its adults, ${S.name} liked the rest least (${belonging.toFixed(2)} on average, where 0.5 is indifferent).` });
    const coldest = adults.filter((o) => o !== seed && S.others[o]).sort((a, b) => S.others[a]!.liking - S.others[b]!.liking)[0];
    if (coldest && S.others[coldest]!.liking < 0.45) {
      const mem = S.episodes.filter((e) => e.about.includes(coldest) && e.valence < 0).sort((a, b) => a.valence - b.valence)[0];
      why.push({ agent: seed, episode: mem?.id, text: `${S.name} liked ${personName(w, coldest)} least of all (${S.others[coldest]!.liking.toFixed(2)})${mem ? `, and remembers: “${unstop(render(mem))}”` : ""}.` });
    }
    // Only a wary core belief pushes someone out; a trusting one would have kept them.
    const sch = [...S.schemas].filter((x) => x.blameBias + x.threatBias > 0).sort((a, b) => b.strength - a.strength)[0];
    if (sch && sch.strength > 0.2) {
      const line = schemaLineage(w, seed, sch);
      const root = line.at(-1);
      why.push({ agent: root?.agent ?? seed, episode: root?.episode, text: `${S.name} carries the core belief “${sch.text}” (strength ${sch.strength.toFixed(2)})${root && root.agent !== seed ? `, passed down ${line.length - 1} ${line.length === 2 ? "telling" : "tellings"} from ${personName(w, root.agent)}'s memory: “${unstop(root.gist)}”` : root ? `, from ${S.pronouns.possessive} own memory: “${unstop(root.gist)}”` : ""}. It makes slights read as threats.` });
    }
    for (const h of followers) {
      const who = h.members.filter((m) => !isChild(w, m)).sort((a, b) => (w.minds[b]!.others[seed]?.liking ?? 0) - (w.minds[a]!.others[seed]?.liking ?? 0))[0];
      if (who) why.push({ agent: who, text: `${h.name} went with them: ${personName(w, who)} likes ${S.name} (${(w.minds[who]!.others[seed]?.liking ?? 0).toFixed(2)}).` });
    }
    return why;
  }

  // ------------------------------------------------------------ trade

  /** Each day, a town with food to spare may send someone with a load to a town with timber and stone to spare. */
  private async trade(): Promise<void> {
    const r = this.region;
    for (const a of r.towns) {
      for (const b of r.towns) {
        if (a === b) continue;
        if ((r.regard[`${a.id}>${b.id}`] ?? 0) < -0.35 || (r.regard[`${b.id}>${a.id}`] ?? 0) < -0.35) continue;
        const A = this.world(a.id);
        const B = this.world(b.id);
        const perHead = (w: WorldState) => w.village!.store.food / Math.max(1, w.order.length);
        if (perHead(A) < 3 || perHead(A) < perHead(B) * 1.6 || B.village!.stock.timber < 20) continue;
        if (r.trades.some((t) => t.from === a.id && t.to === b.id && r.tick - t.tick < B.village!.seasonDays * 1440)) continue;
        if (this.rand() > 0.5) continue;
        await this.exchange(a, A, b, B);
      }
    }
  }

  private async exchange(a: Town, A: WorldState, b: Town, B: WorldState): Promise<void> {
    const r = this.region;
    const adults = A.order.filter((x) => !isChild(A, x));
    const trader = [...adults].sort((x, y) => (A.agents[y]!.role === "keeper" ? 1 : 0) - (A.agents[x]!.role === "keeper" ? 1 : 0) || A.minds[y]!.traits.extraversion - A.minds[x]!.traits.extraversion || x.localeCompare(y))[0];
    if (!trader) return;
    const T = A.minds[trader]!;
    // Keel boats, where someone still knows how to build them, carry more.
    const food = Number(Math.min(A.village!.store.food * 0.15, 25 * (1 + craftBonus(A, "boats"))).toFixed(1));
    const timber = Math.floor(Math.min(B.village!.stock.timber * 0.3, food * 1.5));
    // An honest trader hands over all of it; a careless or grasping one keeps a little back.
    const short = this.rand() < (1 - T.traits.conscientiousness) * (1 - T.traits.agreeableness) * 0.9;
    const delivered = Number((short ? food * 0.7 : food).toFixed(1));
    A.village!.store.food = Number((A.village!.store.food - food).toFixed(1));
    B.village!.store.food = Number((B.village!.store.food + delivered).toFixed(1));
    B.village!.stock.timber -= timber;
    A.village!.stock.timber += timber;
    const noticed = short && this.rand() < 0.75;
    const trade: Trade = { tick: r.tick, from: a.id, to: b.id, trader, gave: { kind: "food", amount: food }, got: { kind: "timber", amount: timber }, short, noticed };
    r.trades.push(trade);
    if (r.trades.length > 300) r.trades.splice(0, r.trades.length - 300);

    // The trader tells a story at the other town's fire. Its pointer goes home with a remembered copy.
    const sB = this.sinkOf(b.id);
    const fB = this.facultiesOf(b.id);
    const told = [...T.episodes]
      .filter((e) => !/^(talk_|pc_|ev_pledge|ev_hungry|ev_tent|ev_gale|ev_design)/.test(e.id) && Math.abs(e.valence) * (0.3 + e.arousal) > 0.2)
      .sort((x, y) => Math.abs(y.valence) * (0.3 + y.arousal) - Math.abs(x.valence) * (0.3 + x.arousal) || x.id.localeCompare(y.id))[0];
    const listeners = B.order.filter((x) => !isChild(B, x) || this.rand() < 0.5).slice(0, 12);
    if (told) {
      carryLineage(A.minds, B, [{ agent: trader, ep: told }], true);
      const story = thirdPerson(render(told), T.name, T.pronouns);
      trade.story = story;
      for (const id of listeners) {
        const m = B.minds[id]!;
        const p: Percept = {
          id: nextId(m, "pc"),
          tick: m.tick,
          kind: "speech",
          rawText: `${T.name}, a trader from ${a.name}, at the fire: "${story}"`,
          actor: trader,
          addressedToSelf: false,
          about: told.about.filter((x) => x !== id),
          topics: [...told.topics, "stories", "trade", a.id],
          features: { outcomeForSelf: 0, agency: "other", intentional: 0.3, normViolation: 0, prospective: false, intensity: 0.3 + Math.abs(told.valence) * 0.3 },
          claims: [],
          details: [],
          gist: story,
        };
        const tr = await runPercept(m, p, fB);
        hearStory(B, trader, told, id, tr, isChild(B, id) ? 0.2 : 0);
        record(B, sB, id, tr);
      }
    }
    feed(B, sB, { kind: "event", place: "harbour", agents: listeners.slice(0, 8), title: `${T.name} comes from ${a.name} to trade`, text: `${delivered} days' food for ${timber} timber.${story(trade)}` });
    // A trader can show someone a craft the other town doesn't know.
    const have = new Set(townCrafts(B));
    const teach = (A.village!.knowledge?.known[trader] ?? []).find((k) => !have.has(k.craft));
    if (teach && listeners.length && this.rand() < 0.3) {
      const learner = [...listeners].filter((x) => !isChild(B, x)).sort((x, y) => B.minds[y]!.traits.openness - B.minds[x]!.traits.openness || x.localeCompare(y))[0];
      if (learner && !knows(B, learner, teach.craft)) {
        learn(B, learner, { craft: teach.craft, tick: B.tick, how: "brought", from: trader, town: a.id });
        const C = craft(teach.craft);
        const why: Why[] = [{ agent: trader, text: `${T.name} knew ${C.name}${teach.how === "taught" && teach.from ? `, taught by ${personName(A, teach.from)}` : teach.how === "worked out" ? `, having worked it out` : ""}.` }, { agent: learner, text: `${personName(B, learner)} was the most curious at the fire (openness ${B.minds[learner]!.traits.openness.toFixed(2)}).` }];
        feed(B, sB, { kind: "event", agents: [trader, learner], title: `${T.name} of ${a.name} shows ${personName(B, learner)} ${C.name}`, text: `${b.name} had nobody who knew it. Now ${C.does}.`, chronicle: { kind: "craft", why } });
      }
    }
    const sA = this.sinkOf(a.id);
    feed(A, sA, { kind: "event", place: "harbour", agents: [trader], title: `${T.name} trades with ${b.name}`, text: `${food} days' food out, ${timber} timber back.${short ? ` ${T.name} kept some of the food back.` : ""}` });
    if (noticed) await this.grievance(b, B, a, trader, `The food ${T.name} brought from ${a.name} came short: they kept some back.`);
    this.chronicle({ town: a.id, kind: "trade", text: `${T.name} of ${a.name} traded ${food} days' food to ${b.name} for ${timber} timber${noticed ? `, and ${b.name} found the load short` : short ? ", keeping some back unnoticed" : ""}.`, agents: [trader] });
  }

  /** A town that was wronged remembers it, and comes to believe it of the other town. */
  private async grievance(victim: Town, V: WorldState, other: Town, culprit: AgentId, text: string): Promise<void> {
    const sV = this.sinkOf(victim.id);
    const fV = this.facultiesOf(victim.id);
    this.dirty = true;
    const evId = nextId(V, "ev_short");
    for (const id of V.order.filter((x) => !isChild(V, x))) {
      const m = V.minds[id]!;
      const p = eventPercept(m, "world", "other", -0.35, 0.6, ["trade", "fairness", "food", other.id, evId], text, text, evId);
      p.features.normViolation = 0.7;
      p.features.intentional = 0.8;
      const tr = await runPercept(m, p, fV);
      record(V, sV, id, tr);
      believeOf(m, other, -0.5, 0.55 + 0.2 * m.traits.neuroticism, tr.encoded ? [tr.encoded] : [], V.tick, `Folk from ${other.name} will cheat you on a trade`);
    }
    feed(V, sV, { kind: "event", agents: [], title: `${V.name} finds the ${other.name} load short`, text });
    void culprit;
  }

  /** Each season, a town on bad terms may send a gift. A leader who likes peace is likelier to. */
  private async mend(): Promise<void> {
    const r = this.region;
    for (const [key, regard] of Object.entries(r.regard)) {
      if (regard > -0.3) continue;
      const [vid, oid] = key.split(">") as [string, string];
      const victim = r.towns.find((t) => t.id === vid)!;
      const giver = r.towns.find((t) => t.id === oid)!;
      const G = this.world(giver.id);
      const V = this.world(victim.id);
      const lead = G.village!.civic?.leader;
      const kind = lead && G.order.includes(lead) ? G.minds[lead]!.traits.agreeableness : 0.4;
      if (this.rand() > kind * 0.6 || G.village!.store.food < 20) continue;
      const gift = Number(Math.min(G.village!.store.food * 0.1, 15).toFixed(1));
      G.village!.store.food = Number((G.village!.store.food - gift).toFixed(1));
      V.village!.store.food = Number((V.village!.store.food + gift).toFixed(1));
      const sV = this.sinkOf(victim.id);
      const fV = this.facultiesOf(victim.id);
      this.dirty = true;
      const who = lead && G.order.includes(lead) ? G.minds[lead]!.name : G.name;
      const text = `${who} sent ${gift} days' food from ${G.name} as a peace gift.`;
      const evId = nextId(V, "ev_gift");
      for (const id of V.order.filter((x) => !isChild(V, x))) {
        const m = V.minds[id]!;
        const tr = await runPercept(m, eventPercept(m, "world", "other", 0.3, 0.5, ["trade", "gift", "food", giver.id, evId], text, text, evId), fV);
        record(V, sV, id, tr);
        believeOf(m, giver, 0.3, 0.4 + 0.3 * m.traits.agreeableness, tr.encoded ? [tr.encoded] : [], V.tick, `Folk from ${giver.name} make things right`);
      }
      feed(V, sV, { kind: "event", agents: [], title: `A peace gift from ${G.name}`, text });
      this.chronicle({ town: giver.id, kind: "peace", text: `${who} of ${G.name} sent ${V.name} a gift of food to mend the quarrel.` });
    }
  }

  /** How each town regards each other: its adults' beliefs about the other town, averaged. */
  private regard(): void {
    const r = this.region;
    for (const a of r.towns) {
      const A = this.world(a.id);
      const adults = A.order.filter((x) => !isChild(A, x));
      for (const b of r.towns) {
        if (a === b) continue;
        const k = `${a.id}>${b.id}`;
        const sum = adults.reduce((s, id) => s + A.minds[id]!.beliefs.filter((x) => x.about === townBelief(b)).reduce((t, x) => t + x.valence * x.confidence, 0), 0);
        const now = Number(clamp(sum / Math.max(1, adults.length), -1, 1).toFixed(2));
        const before = r.regard[k] ?? 0;
        r.regard[k] = now;
        if (before > -0.35 && now <= -0.35) this.chronicle({ town: a.id, kind: "quarrel", text: `${a.name} turns against ${b.name}: most there now believe folk from ${b.name} cheat. Trade stops.`, why: this.quarrelWhy(a, A, b) });
      }
    }
  }

  /**
   * Why one town turned on another: the loads that came short and the traders who kept food back
   * (and the temperament that made them likelier to), how many came to believe it and what they
   * remember, and whether anyone tried to make it right.
   */
  private quarrelWhy(a: Town, A: WorldState, b: Town): Why[] {
    const r = this.region;
    const minds = this.minds();
    const why: Why[] = [];
    const year = A.village!.seasonDays * 4 * 1440;
    const shorts = r.trades.filter((t) => t.from === b.id && t.to === a.id && t.noticed);
    for (const t of shorts.slice(-3)) {
      const T = minds[t.trader];
      why.push({ agent: t.trader, town: b.id, text: `In year ${Math.floor((dayOf(t.tick) - 1) / (year / 1440)) + 1}, ${T?.name ?? t.trader} brought ${t.gave.amount} days' food from ${b.name} and kept part of it back; ${a.name} noticed.${T ? ` ${trait(T)}` : ""}` });
    }
    const adults = A.order.filter((x) => !isChild(A, x));
    const holders = adults
      .map((id) => ({ id, b: A.minds[id]!.beliefs.find((x) => x.about === townBelief(b) && x.valence < 0) }))
      .filter((x) => x.b && x.b.confidence >= 0.3)
      .sort((x, y) => y.b!.confidence - x.b!.confidence);
    if (holders.length) {
      const top = holders[0]!;
      const ev = top.b!.evidence.map((e) => A.minds[top.id]!.episodes.find((x) => x.id === e)).find(Boolean);
      why.push({ agent: top.id, episode: ev?.id, text: `${holders.length} of ${adults.length} adults in ${a.name} now believe “${top.b!.proposition}”. ${personName(A, top.id)} holds it hardest (${top.b!.confidence.toFixed(2)})${ev ? `, remembering: “${unstop(render(ev))}”` : ""}.` });
    }
    const gifts = r.chronicle.filter((c) => c.kind === "peace" && c.town === b.id && c.text.includes(a.name)).length;
    const B = this.world(b.id);
    const lead = B.village!.civic?.leader;
    const L = lead ? B.minds[lead] : undefined;
    if (!gifts) why.push({ agent: lead, town: b.id, text: `${b.name} had sent no peace gift${L ? (L.traits.agreeableness < 0.5 ? `; its leader, ${L.name}, is not much given to making amends (agreeableness ${L.traits.agreeableness.toFixed(2)})` : ` yet, though its leader, ${L.name}, is the kind who might (agreeableness ${L.traits.agreeableness.toFixed(2)})`) : ""}.` });
    else why.push({ town: b.id, text: `${b.name} sent ${gifts} peace ${gifts === 1 ? "gift" : "gifts"}, not enough to outweigh it.` });
    return why;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** What in a trader's temperament made a short load likelier (a careless or grasping one keeps some back). */
function trait(T: MindState): string {
  const c = T.traits.conscientiousness;
  const a = T.traits.agreeableness;
  const what = [c < 0.45 ? "careless" : "", a < 0.45 ? "grasping" : ""].filter(Boolean).join(" and ");
  return what
    ? `${T.name} is ${what} as traders go (conscientiousness ${c.toFixed(2)}, agreeableness ${a.toFixed(2)}), and the less of either, the likelier a short load.`
    : `${T.name} is neither especially careless nor grasping (conscientiousness ${c.toFixed(2)}, agreeableness ${a.toFixed(2)}): a short load from them was more chance than character.`;
}

/** A quoted memory inside a sentence: no full stop of its own. */
const unstop = (s: string) => s.replace(/[.\s]+$/, "");
const story = (t: Trade) => (t.story ? ` At the fire, ${t.story.replace(/\.$/, "")}.` : "");

/** Hold, or strengthen, a belief about another town, with the memory behind it as evidence. */
function believeOf(m: MindState, town: Town, valence: number, confidence: number, evidence: string[], tick: Tick, proposition: string): void {
  const about = townBelief(town);
  const same = m.beliefs.find((b) => b.about === about && Math.sign(b.valence) === Math.sign(valence));
  const opposite = m.beliefs.find((b) => b.about === about && Math.sign(b.valence) !== Math.sign(valence));
  if (opposite) opposite.confidence = Number(clamp(opposite.confidence - 0.25).toFixed(2));
  if (same) {
    same.confidence = Number(clamp(Math.max(same.confidence, confidence) + 0.05).toFixed(2));
    same.evidence = [...new Set([...same.evidence, ...evidence])].slice(-8);
  } else m.beliefs.push({ id: nextId(m, "bel"), about, topics: ["trade", "fairness", town.id], proposition, confidence: Number(clamp(confidence).toFixed(2)), valence, source: { kind: "inferred" }, formed: tick, evidence, retrievals: [tick] });
}

/**
 * Copy into `to` the memories a set of stories points back to, hop by hop, as remembered copies of
 * the people who told them, so a lineage can be followed inside one town. `self` also carries the
 * starting memories themselves (a visitor's own story).
 */
export function carryLineage(from: Record<AgentId, MindState>, to: WorldState, starts: { agent: AgentId; ep: Episode }[], self = false): void {
  const queue = starts.map((s) => ({ agent: s.agent, ep: s.ep, own: self }));
  const seen = new Set<string>();
  while (queue.length) {
    const { agent, ep, own } = queue.shift()!;
    if (own) keep(from, to, agent, ep);
    const src = ep.source;
    if (src.kind !== "told" || !src.from || !src.ref) continue;
    const key = `${src.from}/${src.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const next = from[src.from]?.episodes.find((e) => e.id === src.ref);
    if (!next) continue;
    queue.push({ agent: src.from, ep: next, own: true });
  }
}

/** A remembered copy: who they were and the one memory needed, not a working mind. */
function keep(from: Record<AgentId, MindState>, to: WorldState, agent: AgentId, ep: Episode): void {
  const m = from[agent];
  if (!m) return;
  if (to.order.includes(agent)) return;
  let copy = to.minds[agent];
  if (!copy) {
    copy = { ...structuredClone({ ...m, episodes: [], beliefs: [], schemas: [], goals: [], habits: [], expressions: [], others: {} }) } as MindState;
    to.minds[agent] = copy;
  }
  if (!copy.episodes.some((e) => e.id === ep.id)) copy.episodes.push(structuredClone(ep));
}

// ---------------------------------------------------------------- reading the region

export interface MythVersion {
  /** The version as most living people in the town tell it. */
  text: string;
  holders: number;
  /** All versions in the town, most held first. */
  versions: { text: string; holders: AgentId[]; root: { agent: AgentId; name: string; text: string }; chain: { agent: AgentId; name: string; text: string }[] }[];
}

export interface MythComparison {
  founding: string;
  towns: { town: string; name: string; dominant?: MythVersion["versions"][number]; holders: number; firstHand: number; versions: MythVersion["versions"] }[];
  /** Where two towns' dominant versions part: the step on each side where the wording changed, or different first tellers. */
  splits: { a: string; b: string; at: string }[];
}

/** How each town tells the story of the crossing, whose memory each version grew from, and where they part. */
export function compareMyths(rs: RegionSession, founding = CROSSING): MythComparison {
  const all = rs.minds();
  const towns = rs.region.towns.map((t) => {
    const w = rs.world(t.id);
    const minds = { ...all, ...w.minds };
    const by = new Map<string, MythVersion["versions"][number]>();
    let firstHand = 0;
    for (const id of w.order) {
      const ep = foundingVersion(minds, id, founding);
      if (!ep) continue;
      if (ep.id === founding) firstHand++;
      const m = minds[id]!;
      const text = ep.id === founding ? thirdPerson(render(ep), m.name, m.pronouns) : render(ep);
      const chain: { agent: AgentId; name: string; text: string }[] = [];
      let at: { agent: AgentId; ep: Episode } | undefined = { agent: id, ep };
      const seen = new Set<string>();
      while (at && !seen.has(`${at.agent}/${at.ep.id}`)) {
        seen.add(`${at.agent}/${at.ep.id}`);
        const mm = minds[at.agent]!;
        chain.push({ agent: at.agent, name: mm.name, text: at.ep.id === founding ? thirdPerson(render(at.ep), mm.name, mm.pronouns) : render(at.ep) });
        const src: Episode["source"] = at.ep.source;
        const next: Episode | undefined = src.kind === "told" && src.from && src.ref ? minds[src.from]?.episodes.find((e) => e.id === src.ref) : undefined;
        at = next ? { agent: src.from!, ep: next } : undefined;
      }
      const root = rootOf(minds, id, ep);
      const v = by.get(text) ?? { text, holders: [], root: { agent: root.agent, name: minds[root.agent]!.name, text: chain.at(-1)!.text }, chain };
      v.holders.push(id);
      // Show the longest road the version took to reach someone.
      if (chain.length > v.chain.length) v.chain = chain;
      by.set(text, v);
    }
    const versions = [...by.values()].sort((a, b) => b.holders.length - a.holders.length || a.text.localeCompare(b.text));
    return { town: t.id, name: t.name, dominant: versions[0], holders: versions.reduce((s, v) => s + v.holders.length, 0), firstHand, versions };
  });
  const splits: MythComparison["splits"] = [];
  for (let i = 0; i < towns.length; i++)
    for (let j = i + 1; j < towns.length; j++) {
      const A = towns[i]!;
      const B = towns[j]!;
      if (!A.dominant || !B.dominant || A.dominant.text === B.dominant.text) continue;
      const ra = A.dominant.root;
      const rb = B.dominant.root;
      let at: string;
      if (ra.agent !== rb.agent) at = `They grew from different people's memories of it: ${A.name}'s from ${ra.name} (“${ra.text}”), ${B.name}'s from ${rb.name} (“${rb.text}”).`;
      else {
        const change = (c: MythVersion["versions"][number]["chain"]) => {
          for (let k = c.length - 1; k > 0; k--) if (stripNames(c[k]!.text) !== stripNames(c[k - 1]!.text)) return `when ${c[k]!.name} told it to ${c[k - 1]!.name}`;
          return undefined;
        };
        at = `Both go back to ${ra.name}. ${A.name}'s changed ${change(A.dominant.chain) ?? "nowhere on the way"}; ${B.name}'s ${change(B.dominant.chain) ?? "nowhere on the way"}.`;
      }
      splits.push({ a: A.town, b: B.town, at });
    }
  return { founding, towns, splits };
}

const stripNames = (s: string) => s.replace(/\b[A-Z][a-z]+\b/g, "_");

export interface RegionView {
  year: number;
  towns: { id: string; name: string; people: number; children: number; founded: Tick; from?: string; leader?: AgentId; leaderName?: string; store: number; history: Town["history"]; laws: number; tier: "live" | "aggregate"; crafts: string[]; lost: string[] }[];
  regard: { from: string; to: string; value: number }[];
  trades: Trade[];
  chronicle: ChronicleEntry[];
}

export function regionView(rs: RegionSession): RegionView {
  const r = rs.region;
  const first = rs.world(r.towns[0]!.id);
  return {
    year: yearOf(first),
    towns: r.towns.map((t) => {
      const w = rs.world(t.id);
      const c = w.village!.civic;
      const k = w.village!.knowledge;
      return {
        id: t.id,
        name: t.name,
        people: w.order.length,
        children: w.order.filter((x) => isChild(w, x)).length,
        founded: t.founded,
        from: t.from,
        leader: c?.leader,
        leaderName: c?.leader ? personName(w, c.leader) : undefined,
        store: Math.round(w.village!.store.food),
        history: t.history.slice(-80),
        laws: (c?.laws ?? []).filter((l) => l.passed).length,
        tier: t.agg ? "aggregate" : "live",
        crafts: townCrafts(w).map((x) => craft(x).name),
        lost: Object.keys(k?.lost ?? {}).map((x) => craft(x).name),
      };
    }),
    regard: Object.entries(r.regard).map(([k, value]) => {
      const [from, to] = k.split(">") as [string, string];
      return { from, to, value };
    }),
    trades: r.trades.slice(-20),
    chronicle: r.chronicle.slice(-200),
  };
}
