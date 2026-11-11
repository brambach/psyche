// One region of a realm, as the thing that can be put on a thread. A runner wraps a RegionSession
// (the region runs exactly as it does on its own: region.ts and everything under it are unchanged),
// moves it on a season at a time, and answers a small set of plain-data requests: a report of the
// season, a town to send away or take in, a boat to load or unload, a save. Everything in and out
// is structured-cloneable, so a runner works the same in the caller's thread or in a worker.

import type { Faculties } from "../ports.js";
import type { AgentId, Tick } from "../types.js";
import { foundingVersion } from "../world/civic.js";
import { townCrafts } from "../world/knowledge.js";
import { ageOf, isChild, schemaLineage, yearOf } from "../world/life.js";
import { CROSSING } from "../world/people.js";
import { compareMyths, RegionSession, regionView, type ChronicleEntry, type RegionOptions, type RegionState, type RegionView, type TownPacket } from "../world/region.js";
import { render } from "../memory.js";
import type { WorldState } from "../world/world.js";
import { regionTag, townName } from "./names.js";
import { noteAbroad, ports, receiveGift, receiveTrade, regardAbroad, sendGift, sendTrade, settleTrade, type Abroad, type SeaGiftPacket, type SeaTradePacket, type SeaTradeReceipt } from "./sea.js";

export interface RegionSpec {
  id: string;
  /** 0 for the first coast; counts up as regions are founded. */
  index: number;
  name: string;
  seed: number;
  /** A town splits once it reaches this many living. */
  splitAt: number;
  /** Towns the region may hold before a new one has to sail on. */
  maxTowns: number;
  /** The first coast runs hour by hour for this many years, so its founders live their first seasons in full. */
  liveYears: number;
}

export interface SavedRegion {
  v: 1;
  spec: RegionSpec;
  state: RegionState;
  worlds: Record<string, WorldState>;
  /** The last chronicle entry already reported. */
  cursor: number;
}

export interface TownBrief {
  id: string;
  name: string;
  people: number;
  children: number;
  store: number;
  timber: number;
  founded: Tick;
  from?: string;
  leader?: string;
  laws: number;
  crafts: number;
  houses: number;
  site?: { along: number; inland: number };
}

/** A chronicle entry with where in the realm it happened. */
export interface RealmEvent extends ChronicleEntry {
  region: string;
  regionName: string;
  townName?: string;
  /** Written by the realm: something that crossed between regions. */
  sea?: boolean;
}

export interface RegionReport {
  id: string;
  name: string;
  tick: Tick;
  year: number;
  season: string;
  people: number;
  children: number;
  /** Minds held in all: the living, and the dead and departed still remembered. */
  minds: number;
  births: number;
  deaths: number;
  towns: TownBrief[];
  /** Towns founded since the last report. */
  founded: string[];
  ports: ReturnType<typeof ports>;
  /** How this region regards the regions it has dealt with. */
  regard: Record<string, number>;
  /** What the chronicle wrote since the last report. */
  events: RealmEvent[];
  eldest?: { id: AgentId; name: string; age: number; town: string };
  /** How long the season took to run here, in milliseconds. */
  ms: number;
}

export interface PersonBrief {
  id: AgentId;
  name: string;
  town: string;
  age: number;
  role: string;
  summary: string;
  traits: Record<string, number>;
  mood: number;
  parents: { id: AgentId; name: string }[];
  partner?: { id: AgentId; name: string };
  /** Core beliefs, each with where it came from: the chain of tellings back to someone who lived it. */
  schemas: { text: string; strength: number; lineage: { agent: AgentId; name: string; gist: string; firstHand: boolean }[] }[];
  beliefs: { about: string; text: string; confidence: number }[];
  memories: { id: string; tick: Tick; text: string; valence: number; from?: string }[];
  /** The founding story as this person tells it. */
  founding?: string;
}

/** Every request a runner answers, with what it takes and gives. All plain data. */
export interface RunnerOps {
  season: { in: void; out: RegionReport };
  report: { in: void; out: RegionReport };
  detach: { in: { town: string; to: { id: string; name: string } }; out: TownPacket };
  attach: { in: { packet: TownPacket; from: { id: string; name: string }; home?: { id: string; name: string } }; out: RegionReport };
  sendTrade: { in: { town: string; to: Abroad }; out: SeaTradePacket | undefined };
  receiveTrade: { in: SeaTradePacket; out: SeaTradeReceipt | undefined };
  settleTrade: { in: SeaTradeReceipt; out: void };
  sendGift: { in: { to: Abroad }; out: SeaGiftPacket | undefined };
  receiveGift: { in: SeaGiftPacket; out: boolean };
  save: { in: void; out: SavedRegion };
  view: { in: void; out: RegionView };
  myths: { in: void; out: { town: string; name: string; text?: string; holders: number; of: number; root?: string; tellings: number }[] };
  town: { in: { town: string }; out: { id: AgentId; name: string; age: number; role: string; household?: string }[] };
  person: { in: { id: AgentId }; out: PersonBrief | undefined };
  /** A save the game server can open (PSYCHE_DATA), to watch this region live. */
  export: { in: void; out: unknown };
}
export type RunnerOp = keyof RunnerOps;

const DAY = 1440;

export class RegionRunner {
  readonly spec: RegionSpec;
  readonly rs: RegionSession;
  private cursor: number;
  private lastTick: Tick;
  private known: Set<string>;

  private constructor(spec: RegionSpec, rs: RegionSession, cursor = 0) {
    this.spec = spec;
    this.rs = rs;
    this.cursor = cursor;
    this.lastTick = rs.region.tick;
    this.known = new Set(rs.region.towns.map((t) => t.id));
  }

  private static options(spec: RegionSpec, faculties: Faculties): RegionOptions {
    return {
      session: { keepRecent: 0, keepDays: 0, maxTraces: 2000, maxFeed: 500 },
      // One past the limit: the town that makes one too many is the one the realm sends on.
      maxTowns: spec.maxTowns + 1,
      splitAt: spec.splitAt,
      cheap: faculties,
      nameTown: (n) => townName(spec.index, n),
      idTag: regionTag(spec.index),
    };
  }

  /** The first coast: Hollow Bay, from the crossing. */
  static origin(spec: RegionSpec, faculties: Faculties): RegionRunner {
    const rs = RegionSession.create(spec.seed, faculties, RegionRunner.options(spec, faculties));
    // The first town of all was not founded by a split, so it is given its mark here.
    rs.region.towns[0]!.tag = `${regionTag(spec.index)}0`;
    if (spec.liveYears <= 0) rs.setLive(0);
    return new RegionRunner(spec, rs);
  }

  /** A region that begins with one town come over the sea. */
  static colony(spec: RegionSpec, packet: TownPacket, from: { id: string; name: string }, faculties: Faculties): RegionRunner {
    packet.town.fromRegion = from;
    const rs = RegionSession.found(spec.seed, packet, faculties, { ...RegionRunner.options(spec, faculties), live: 0 });
    return new RegionRunner(spec, rs);
  }

  static load(saved: SavedRegion, faculties: Faculties): RegionRunner {
    const allAgg = saved.state.towns.every((t) => t.agg);
    const rs = new RegionSession(saved.state, saved.worlds, faculties, { ...RegionRunner.options(saved.spec, faculties), live: allAgg ? 0 : undefined });
    return new RegionRunner(saved.spec, rs, saved.cursor);
  }

  save(): SavedRegion {
    return { v: 1, spec: this.spec, state: this.rs.region, worlds: this.rs.worlds(), cursor: this.cursor };
  }

  get people(): number {
    return this.rs.region.towns.reduce((s, t) => s + this.rs.world(t.id).order.length, 0);
  }

  /** Run one season, then say what happened. */
  async season(): Promise<RegionReport> {
    const start = Date.now();
    const rs = this.rs;
    const first = rs.world(rs.region.towns[0]!.id);
    const days = first.village!.seasonDays;
    if (rs.region.towns.some((t) => !t.agg) && yearOf(first) > this.spec.liveYears) rs.setLive(0);
    const live = rs.region.towns.some((t) => !t.agg);
    const step = live ? 360 : DAY;
    for (let m = 0; m < days * DAY; m += step) await rs.advance(step, { snapshot: false });
    rs.rebase();
    return this.report(Date.now() - start);
  }

  report(ms = 0): RegionReport {
    const rs = this.rs;
    const r = rs.region;
    const first = rs.world(r.towns[0]!.id);
    let people = 0;
    let children = 0;
    let minds = 0;
    let births = 0;
    let deaths = 0;
    let eldest: RegionReport["eldest"];
    const names = new Map(r.towns.map((t) => [t.id, t.name]));
    const towns: TownBrief[] = r.towns.map((t) => {
      const w = rs.world(t.id);
      const v = w.village!;
      let kids = 0;
      for (const id of w.order) {
        const age = ageOf(w, id);
        if (age < 12) kids++;
        if (!eldest || age > eldest.age) eldest = { id, name: w.minds[id]!.name, age: Math.floor(age), town: t.id };
      }
      for (const [id, l] of Object.entries(v.life)) {
        if (l.born > this.lastTick && w.minds[id]) births++;
        if (l.died !== undefined && l.died > this.lastTick) deaths++;
      }
      people += w.order.length;
      children += kids;
      minds += Object.keys(w.minds).length;
      const lead = v.civic?.leader;
      return {
        id: t.id,
        name: t.name,
        people: w.order.length,
        children: kids,
        store: Math.round(v.store.food),
        timber: Math.round(v.stock.timber),
        founded: t.founded,
        from: t.from,
        leader: lead && w.minds[lead] ? w.minds[lead]!.name : undefined,
        laws: (v.civic?.laws ?? []).filter((l) => l.passed).length,
        crafts: townCrafts(w).length,
        houses: Object.values(v.households).filter((h) => h.shelter === "house").length,
        site: t.site,
      };
    });
    const abroad = r.abroad ?? {};
    const events: RealmEvent[] = r.chronicle
      .filter((c) => (c.seq ?? 0) > this.cursor)
      .map((c) => ({ ...c, region: this.spec.id, regionName: this.spec.name, townName: c.town ? (names.get(c.town) ?? abroad[c.town]?.name) : undefined }));
    this.cursor = r.chronicled ?? this.cursor;
    const founded = r.towns.filter((t) => !this.known.has(t.id)).map((t) => t.id);
    this.known = new Set(r.towns.map((t) => t.id));
    this.lastTick = r.tick;
    return { id: this.spec.id, name: this.spec.name, tick: r.tick, year: yearOf(first), season: first.village!.season, people, children, minds, births, deaths, towns, founded, ports: ports(rs), regard: regardAbroad(rs), events, eldest, ms };
  }

  // ------------------------------------------------------------ requests

  async call<K extends RunnerOp>(op: K, arg: RunnerOps[K]["in"]): Promise<RunnerOps[K]["out"]> {
    type In<O extends RunnerOp> = RunnerOps[O]["in"];
    const rs = this.rs;
    const self = { region: this.spec.id, regionName: this.spec.name };
    switch (op) {
      case "season":
        return this.season();
      case "report":
        return this.report();
      case "detach": {
        const a = arg as In<"detach">;
        const packet = rs.detachTown(a.town);
        this.known.delete(a.town);
        noteAbroad(rs, { region: a.to.id, regionName: a.to.name, town: a.town, townName: packet.town.name });
        rs.port.chronicle({ town: packet.town.from, kind: "founding", text: `${packet.town.name}'s people did not stay on this shore: they sailed on, over the water, for ${a.to.name}.`, agents: packet.town.founders.slice(0, 1) });
        return packet;
      }
      case "attach": {
        const a = arg as In<"attach">;
        const town = rs.attachTown(a.packet, a.from);
        this.known.add(town.id);
        if (a.home) noteAbroad(rs, { region: a.from.id, regionName: a.from.name, town: a.home.id, townName: a.home.name });
        rs.port.chronicle({ town: town.id, kind: "founding", text: `${rs.world(town.id).order.length} people from ${a.home ? `${a.home.name}, on ${a.from.name},` : a.from.name} came ashore and settled ${town.name}.`, agents: town.founders.slice(0, 1) });
        return this.report();
      }
      case "sendTrade": {
        const a = arg as In<"sendTrade">;
        return sendTrade(rs, a.town, a.to, self);
      }
      case "receiveTrade":
        return receiveTrade(rs, arg as In<"receiveTrade">);
      case "settleTrade":
        return settleTrade(rs, arg as In<"settleTrade">);
      case "sendGift":
        return sendGift(rs, (arg as In<"sendGift">).to, self);
      case "receiveGift":
        return receiveGift(rs, arg as In<"receiveGift">);
      case "save":
        return this.save();
      case "view":
        return regionView(rs);
      case "myths":
        return this.myths();
      case "town":
        return this.town((arg as In<"town">).town);
      case "person":
        return this.person((arg as In<"person">).id);
      case "export":
        return { scenario: "region", seed: this.spec.seed, ablations: {}, inputs: [], log: [], region: { state: rs.region, worlds: rs.worlds(), feeds: {} } };
      default:
        throw new Error(`A region cannot ${String(op)}.`);
    }
  }

  /** How each town here tells its oldest story now, and whose memory that telling goes back to. */
  private myths(): RunnerOps["myths"]["out"] {
    const m = compareMyths(this.rs, CROSSING);
    return m.towns.map((t) => ({ town: t.town, name: t.name, text: t.dominant?.text, holders: t.dominant?.holders.length ?? 0, of: this.rs.world(t.town).order.length, root: t.dominant?.root.name, tellings: Math.max(0, (t.dominant?.chain.length ?? 1) - 1) }));
  }

  private town(id: string): RunnerOps["town"]["out"] {
    const t = this.rs.region.towns.find((x) => x.id === id);
    if (!t) return [];
    const w = this.rs.world(id);
    const hh = new Map<AgentId, string>();
    for (const h of Object.values(w.village!.households)) for (const m of h.members) hh.set(m, h.name);
    return w.order.map((p) => ({ id: p, name: w.minds[p]!.name, age: Math.floor(ageOf(w, p)), role: w.agents[p]!.role, household: hh.get(p) }));
  }

  private person(id: AgentId): PersonBrief | undefined {
    const t = this.rs.region.towns.find((x) => this.rs.world(x.id).order.includes(id));
    if (!t) return undefined;
    const w = this.rs.world(t.id);
    const m = w.minds[id]!;
    const l = w.village!.life[id];
    const nameOf = (x: AgentId) => w.minds[x]?.name ?? x;
    const found = foundingVersion(w.minds, id, w.village!.founding ?? CROSSING) ?? foundingVersion(w.minds, id, CROSSING);
    return {
      id,
      name: m.name,
      town: t.id,
      age: Math.floor(ageOf(w, id)),
      role: isChild(w, id) ? "child" : w.agents[id]!.role,
      summary: m.identity.summary,
      traits: { ...m.traits },
      mood: m.affect.mood.valence,
      parents: (l?.parents ?? []).map((p) => ({ id: p, name: nameOf(p) })),
      partner: l?.partner ? { id: l.partner, name: nameOf(l.partner) } : undefined,
      schemas: m.schemas.map((s) => ({ text: s.text, strength: s.strength, lineage: schemaLineage(w, id, s).map((x) => ({ agent: x.agent, name: nameOf(x.agent), gist: x.gist, firstHand: x.firstHand })) })),
      beliefs: [...m.beliefs].sort((a, b) => b.confidence - a.confidence).slice(0, 12).map((b) => ({ about: b.about, text: b.proposition, confidence: b.confidence })),
      memories: [...m.episodes].sort((a, b) => b.tick - a.tick).slice(0, 20).map((e) => ({ id: e.id, tick: e.tick, text: render(e), valence: e.valence, from: e.source.kind === "told" && e.source.from ? nameOf(e.source.from) : undefined })),
      founding: found ? render(found) : undefined,
    };
  }
}
