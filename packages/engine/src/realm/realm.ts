// A realm: many regions on one sea. A region (region.ts) is a coast of towns that runs entirely on
// its own; the realm is what happens between coasts. It grows the way a region does, one level up:
// when a coast is full, the next group that leaves sails on, and either settles a coast with room or
// founds a new one. Boats cross between neighbouring coasts with food, timber, stories and crafts;
// a short load becomes a grievance one coast holds against another, and a gift can mend it.
//
// This is what lets the world be big. Regions do not touch each other during a season, so each can
// run on its own thread; at the end of every season the realm reads their reports and carries out,
// in a fixed order, whatever crosses between them. Nothing here depends on how the regions are
// spread over threads, so the same seed gives the same world on one thread or on sixteen.
//
// The realm never touches a mind itself. It asks regions for plain packets (runner.ts, sea.ts) and
// hands them on, through a host that may be this thread (host.ts) or a pool of workers.

import { nextRandom } from "../rng.js";
import type { Tick } from "../types.js";
import type { TownPacket } from "../world/region.js";
import { MAX_REGIONS, regionName } from "./names.js";
import type { RealmEvent, RegionReport, RegionSpec, RunnerOp, RunnerOps } from "./runner.js";
import type { Abroad } from "./sea.js";

export interface RealmOptions {
  seed: number;
  /** Towns a region holds before its next new town sails on. */
  regionTowns: number;
  /** Regions the sea has room for. Past this, full regions simply stop splitting. */
  maxRegions: number;
  /** A town splits once it reaches this many living. */
  splitAt: number;
  /** The first coast runs hour by hour this many years before it too goes on to rules. */
  liveYears: number;
  /** Each region trades over the sea with this many of its nearest neighbours. */
  neighbors: number;
}

export const REALM_DEFAULTS: RealmOptions = { seed: 11, regionTowns: 12, maxRegions: 40, splitAt: 50, liveYears: 2, neighbors: 3 };

export interface RealmRegion {
  id: string;
  index: number;
  name: string;
  founded: Tick;
  foundedYear: number;
  /** The region its first town sailed from. */
  from?: string;
  /** Where it lies on the chart (0 to 1 each way). */
  site: { x: number; y: number };
  people: number;
  children: number;
  towns: number;
  minds: number;
  /** People at the end of each year. */
  history: { year: number; people: number; towns: number }[];
}

export interface RealmState {
  v: 1;
  opts: RealmOptions;
  rng: number;
  tick: Tick;
  year: number;
  season: string;
  /** Seasons run since the realm began. */
  seasons: number;
  regions: RealmRegion[];
  /** How each region regards another it has dealt with (-1 to 1), keyed `a>b`. */
  regard: Record<string, number>;
  /** The season of the last boat between two regions, keyed `a>b`. */
  sailed: Record<string, number>;
  /** Events the realm itself has written (colonies, boats, quarrels over the sea). */
  written: number;
  /** One row a year for the whole realm. */
  history: { year: number; people: number; regions: number; towns: number }[];
  totals: { births: number; deaths: number; colonies: number; boats: number; events: number };
}

/** What a season did, for whoever keeps the records. */
export interface SeasonResult {
  tick: Tick;
  year: number;
  season: string;
  people: number;
  towns: number;
  regions: number;
  minds: number;
  births: number;
  deaths: number;
  /** Everything chronicled this season, by regions and by the realm, in order. */
  events: RealmEvent[];
  /** Milliseconds each region took, and the whole season. */
  ms: number;
  regionMs: Record<string, number>;
  reports: RegionReport[];
}

/**
 * Where regions live. The realm asks for everything through this, so it does not know or care
 * whether a region is in this thread or another.
 */
export interface RegionHost {
  /** Begin the first coast. */
  origin(spec: RegionSpec): Promise<RegionReport>;
  /** Begin a region from a town come over the sea. */
  colony(spec: RegionSpec, packet: TownPacket, from: { id: string; name: string }): Promise<RegionReport>;
  /** Every region runs one season; the reports come back in the order of `ids`. */
  season(ids: string[]): Promise<RegionReport[]>;
  call<K extends RunnerOp>(region: string, op: K, arg: RunnerOps[K]["in"]): Promise<RunnerOps[K]["out"]>;
}

const QUARREL = -0.35;

export class Realm {
  state: RealmState;
  private host: RegionHost;
  /** The last report from each region. */
  reports = new Map<string, RegionReport>();

  constructor(state: RealmState, host: RegionHost) {
    this.state = state;
    this.host = host;
  }

  /** A new realm: one coast, Hollow Bay, the summer after the crossing. */
  static async create(host: RegionHost, opts: Partial<RealmOptions> = {}): Promise<Realm> {
    const o = { ...REALM_DEFAULTS, ...opts };
    if (o.maxRegions > MAX_REGIONS) throw new Error(`A realm holds at most ${MAX_REGIONS} regions.`);
    const spec: RegionSpec = { id: "r0", index: 0, name: "the Hollow Coast", seed: o.seed, splitAt: o.splitAt, maxTowns: o.regionTowns, liveYears: o.liveYears };
    const rep = await host.origin(spec);
    const state: RealmState = {
      v: 1,
      opts: o,
      rng: (Math.imul(o.seed, 2246822519) ^ 0x9e3779b9) >>> 0,
      tick: rep.tick,
      year: rep.year,
      season: rep.season,
      seasons: 0,
      regions: [{ id: spec.id, index: 0, name: spec.name, founded: rep.tick, foundedYear: rep.year, site: { x: 0.5, y: 0.5 }, people: rep.people, children: rep.children, towns: rep.towns.length, minds: rep.minds, history: [] }],
      regard: {},
      sailed: {},
      written: 0,
      history: [],
      totals: { births: 0, deaths: 0, colonies: 0, boats: 0, events: 0 },
    };
    const realm = new Realm(state, host);
    realm.reports.set(spec.id, rep);
    return realm;
  }

  /** A realm picked up from a save. The regions must already be with the host; this asks each how it stands. */
  static async resume(state: RealmState, host: RegionHost): Promise<Realm> {
    const realm = new Realm(state, host);
    for (const r of state.regions) realm.reports.set(r.id, await host.call(r.id, "report", undefined));
    return realm;
  }

  get people(): number {
    return this.state.regions.reduce((s, r) => s + r.people, 0);
  }

  private rand(): number {
    return nextRandom(this.state);
  }

  private region(id: string): RealmRegion {
    return this.state.regions.find((r) => r.id === id)!;
  }

  /** Note how a region stands now; anything it chronicled since its last report joins `events`. */
  private take(rep: RegionReport, events?: RealmEvent[]): void {
    if (events) events.push(...rep.events);
    const r = this.region(rep.id);
    r.people = rep.people;
    r.children = rep.children;
    r.towns = rep.towns.length;
    r.minds = rep.minds;
    this.reports.set(rep.id, rep);
  }

  private write(e: Omit<RealmEvent, "tick" | "year" | "seq" | "sea">, out: RealmEvent[]): void {
    const s = this.state;
    s.written++;
    out.push({ tick: s.tick, year: s.year, sea: true, ...e });
  }

  /** One season, everywhere: every region runs it, then whatever crosses between regions is carried out. */
  async step(): Promise<SeasonResult> {
    const s = this.state;
    const start = Date.now();
    const ids = s.regions.map((r) => r.id);
    const reports = await this.host.season(ids);
    const events: RealmEvent[] = [];
    let births = 0;
    let deaths = 0;
    const regionMs: Record<string, number> = {};
    for (const rep of reports) {
      this.take(rep, events);
      births += rep.births;
      deaths += rep.deaths;
      regionMs[rep.id] = rep.ms;
    }
    const first = reports[0]!;
    const newYear = first.year !== s.year;
    s.tick = first.tick;
    s.year = first.year;
    s.season = first.season;
    s.seasons++;

    await this.colonies(reports, events);
    this.regards(reports, events);
    await this.boats(events);
    await this.gifts(events);

    // What the last three wrote in the regions' own chronicles is read at the next report; the
    // realm's own lines are in `events` already.
    if (newYear) {
      for (const r of s.regions) {
        r.history.push({ year: s.year - 1, people: r.people, towns: r.towns });
        if (r.history.length > 600) r.history.splice(0, r.history.length - 600);
      }
      s.history.push({ year: s.year - 1, people: this.people, regions: s.regions.length, towns: s.regions.reduce((n, r) => n + r.towns, 0) });
      if (s.history.length > 5000) s.history.splice(0, s.history.length - 5000);
    }
    s.totals.births += births;
    s.totals.deaths += deaths;
    s.totals.events += events.length;
    return {
      tick: s.tick,
      year: s.year,
      season: s.season,
      people: this.people,
      towns: s.regions.reduce((n, r) => n + r.towns, 0),
      regions: s.regions.length,
      minds: s.regions.reduce((n, r) => n + r.minds, 0),
      births,
      deaths,
      events,
      ms: Date.now() - start,
      regionMs,
      reports: s.regions.map((r) => this.reports.get(r.id)!),
    };
  }

  // ------------------------------------------------------------ colonies

  /** A region with a town too many sends its newest town on: to a new coast while the sea has room, or to a neighbour with room. */
  private async colonies(reports: RegionReport[], events: RealmEvent[]): Promise<void> {
    const s = this.state;
    for (const rep of reports) {
      if (rep.towns.length <= s.opts.regionTowns) continue;
      const home = this.region(rep.id);
      const town = [...rep.towns.slice(1)].sort((a, b) => b.founded - a.founded || a.id.localeCompare(b.id))[0];
      if (!town) continue;
      const room = this.near(home, s.regions.length)
        .filter((r) => r.towns < s.opts.regionTowns)
        .slice(0, 3);
      const canFound = s.regions.length < s.opts.maxRegions;
      // Most groups that sail want a shore of their own; some would rather land among people.
      const join = room.length > 0 && (!canFound || this.rand() < 0.25);
      if (!canFound && !join) continue;
      const leaving = rep.events.filter((e) => e.kind === "founding" && e.town === town.id).at(-1);
      const parent = rep.towns.find((t) => t.id === town.from);
      if (join) {
        const dest = room[Math.floor(this.rand() * room.length)]!;
        const packet = await this.host.call(home.id, "detach", { town: town.id, to: { id: dest.id, name: dest.name } });
        this.take(await this.host.call(dest.id, "attach", { packet, from: { id: home.id, name: home.name }, home: parent && { id: parent.id, name: parent.name } }), events);
        this.take(await this.host.call(home.id, "report", undefined), events);
        this.write({ region: dest.id, regionName: dest.name, town: town.id, townName: town.name, kind: "founding", text: `${town.name}, ${town.people} people out of ${parent?.name ?? home.name}, found no room left on ${home.name} and crossed the water to settle on ${dest.name}.`, why: [{ text: `${home.name} already held ${s.opts.regionTowns} towns.`, town: parent?.id }, ...(leaving?.why ?? [])] }, events);
      } else {
        const index = s.regions.length;
        const spec: RegionSpec = { id: `r${index}`, index, name: regionName(index), seed: (Math.imul(s.opts.seed + index, 2654435761) ^ Math.floor(this.rand() * 0xffffffff)) >>> 0, splitAt: s.opts.splitAt, maxTowns: s.opts.regionTowns, liveYears: 0 };
        const site = this.siteNear(home);
        const packet = await this.host.call(home.id, "detach", { town: town.id, to: { id: spec.id, name: spec.name } });
        const born = await this.host.colony(spec, packet, { id: home.id, name: home.name });
        s.regions.push({ id: spec.id, index, name: spec.name, founded: s.tick, foundedYear: s.year, from: home.id, site, people: born.people, children: born.children, towns: born.towns.length, minds: born.minds, history: [] });
        this.take(born, events);
        this.take(await this.host.call(home.id, "report", undefined), events);
        this.write({ region: spec.id, regionName: spec.name, town: town.id, townName: town.name, kind: "founding", text: `${town.name}, ${town.people} people out of ${parent?.name ?? home.name}, found no room left on ${home.name} and sailed until they raised a shore nobody lived on. They are the first town of ${spec.name}.`, why: [{ text: `${home.name} already held ${s.opts.regionTowns} towns.`, town: parent?.id }, ...(leaving?.why ?? [])] }, events);
      }
      s.totals.colonies++;
    }
  }

  /** The regions nearest a region on the chart, nearest first. */
  private near(of: RealmRegion, k: number): RealmRegion[] {
    return this.state.regions
      .filter((r) => r.id !== of.id)
      .map((r) => ({ r, d: Math.hypot(r.site.x - of.site.x, r.site.y - of.site.y) }))
      .sort((a, b) => a.d - b.d || a.r.index - b.r.index)
      .slice(0, k)
      .map((x) => x.r);
  }

  /** Somewhere on the chart near a region with open water around it; later tries look further and accept closer. */
  private siteNear(from: RealmRegion): { x: number; y: number } {
    const taken = this.state.regions.map((r) => r.site);
    const fit = (x: number, y: number, gap: number) => taken.every((t) => Math.hypot(t.x - x, t.y - y) > gap);
    for (let k = 0; k < 80; k++) {
      const reach = 0.1 + this.rand() * 0.12 + k * 0.006;
      const angle = this.rand() * Math.PI * 2;
      const x = from.site.x + Math.cos(angle) * reach;
      const y = from.site.y + Math.sin(angle) * reach;
      if (x > 0.03 && x < 0.97 && y > 0.03 && y < 0.97 && fit(x, y, k < 50 ? 0.09 : 0.05)) return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
    }
    return { x: Number((0.03 + this.rand() * 0.94).toFixed(3)), y: Number((0.03 + this.rand() * 0.94).toFixed(3)) };
  }

  // ------------------------------------------------------------ regard, boats and gifts

  private regards(reports: RegionReport[], events: RealmEvent[]): void {
    const s = this.state;
    for (const rep of reports) {
      for (const [other, now] of Object.entries(rep.regard)) {
        const k = `${rep.id}>${other}`;
        const before = s.regard[k] ?? 0;
        s.regard[k] = now;
        const o = s.regions.find((r) => r.id === other);
        if (o && before > QUARREL && now <= QUARREL) this.write({ region: rep.id, regionName: rep.name, kind: "quarrel", text: `${rep.name} turns against ${o.name}: a town there now believes the folk across the water cheat. No boats cross between them.`, why: [{ text: `Loads from ${o.name} came short and were noticed.` }] }, events);
      }
    }
  }

  /** Each season a region with food to spare may send a boat to a near region with timber to spare. */
  private async boats(events: RealmEvent[]): Promise<void> {
    const s = this.state;
    for (const a of [...s.regions]) {
      for (const b of this.near(a, s.opts.neighbors)) {
        const k = `${a.id}>${b.id}`;
        if ((s.regard[k] ?? 0) <= QUARREL || (s.regard[`${b.id}>${a.id}`] ?? 0) <= QUARREL) continue;
        const out = this.reports.get(a.id)?.ports.out;
        const inn = this.reports.get(b.id)?.ports.in;
        if (!out || !inn || out.perHead < inn.perHead * 1.6) continue;
        // One boat a year between any two coasts, at most.
        if (s.sailed[k] !== undefined && s.seasons - s.sailed[k]! < 4) continue;
        if (this.rand() > 0.5) continue;
        const to: Abroad = { region: b.id, regionName: b.name, town: inn.town, townName: inn.name };
        const packet = await this.host.call(a.id, "sendTrade", { town: out.town, to });
        if (!packet) continue;
        const receipt = await this.host.call(b.id, "receiveTrade", packet);
        if (!receipt) continue;
        await this.host.call(a.id, "settleTrade", receipt);
        s.sailed[k] = s.seasons;
        s.totals.boats++;
        // The stores have changed; a second boat this season should not count on what is gone.
        out.perHead = 0;
        this.write({ region: a.id, regionName: a.name, town: out.town, townName: out.name, kind: "trade", agents: [receipt.trader], text: `${receipt.traderName} of ${out.name} (${a.name}) took ${receipt.food} days' food over the sea to ${inn.name} (${b.name}) for ${receipt.timber} timber${receipt.noticed ? `, and ${inn.name} found the load short` : receipt.short ? ", keeping some back unnoticed" : ""}${receipt.taught ? `. ${inn.name} learned a craft from the visit` : ""}.` }, events);
      }
    }
  }

  /** A region held in bad regard over the sea may send a gift to mend it. */
  private async gifts(events: RealmEvent[]): Promise<void> {
    const s = this.state;
    for (const [k, regard] of Object.entries(s.regard)) {
      if (regard > -0.3) continue;
      const [vid, gid] = k.split(">") as [string, string];
      const victim = s.regions.find((r) => r.id === vid);
      const giver = s.regions.find((r) => r.id === gid);
      if (!victim || !giver) continue;
      const port = this.reports.get(vid)?.towns[0];
      if (!port) continue;
      const packet = await this.host.call(giver.id, "sendGift", { to: { region: victim.id, regionName: victim.name, town: port.id, townName: port.name } });
      if (!packet) continue;
      await this.host.call(victim.id, "receiveGift", packet);
      this.write({ region: giver.id, regionName: giver.name, town: packet.from.town, townName: packet.from.townName, kind: "peace", text: `${packet.who} (${giver.name}) sent ${packet.food} days' food over the sea to ${victim.name} to mend the quarrel.` }, events);
    }
  }
}
