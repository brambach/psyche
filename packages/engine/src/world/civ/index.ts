// The civilization systems, put together. A town runs them when it has `village.civ` (see
// `enableCiv`); a region runs the between-town ones when any of its towns does.
//
// Per town, each season (`civSeason`): pressures are noted, trades are taken up or given up, a
// later craft may be worked out, the market meets, sides are reckoned, the leader may answer the
// season with a law, and the scribe writes. Sickness runs by the day (`civDay` in a live town, the
// season's days in a row in a town on rules). Elections are contested (`electCiv`, each spring).
//
// Between towns, each season (`civRegionSeason`): each town learns how it stands with the others,
// merchants make their runs, households move, leaders weigh raids and truces.

import { clamp } from "../../memory.js";
import type { Faculties } from "../../ports.js";
import type { AgentId } from "../../types.js";
import { craftBonus } from "../knowledge.js";
import { yearOf } from "../life.js";
import type { RegionState, Town } from "../region.js";
import type { Household } from "../village.js";
import { carryWords } from "../voice.js";
import { feed, personName, type Sink, type Why, type WorldState } from "../world.js";
import { civOf, DAY, grownOf, mark, note, yearTicks, type CivEvent, type CivState } from "./base.js";
import { activeOutbreak, diseaseDay, expose, healthView, newHealth, type HealthView } from "./disease.js";
import { economyView, GOODS, marketDay, merchantRun, newEconomy, tradesTurn, warmth, type EconomyView } from "./economy.js";
import { factionsSeason, factionsView, newFactions } from "./factions.js";
import { hostile, regionCiv, treatyBetween, type CivHost, type Move, type Raid, type Run, type Treaty } from "./host.js";
import { migrationSeason } from "./migration.js";
import { landingClosed, newPolity, politySeason, polityView, type PolityView } from "./polity.js";
import { newRecords, recordsSeason, recordsView, type RecordsView } from "./records.js";
import { techTree, techTurn } from "./tech.js";
import { warSeason } from "./war.js";

/** Turn the civilization systems on in a town. Does nothing to a town that already has them. */
export function enableCiv(w: WorldState): CivState {
  const v = w.village!;
  if (v.civ) return v.civ;
  v.civ = { since: w.tick, economy: newEconomy(), factions: newFactions(), polity: newPolity(), health: newHealth(), records: newRecords(), marks: { hunger: [], cold: [], raided: [], raids: [], plague: [], trades: [] }, events: [], abroad: {} };
  w.places.workshop ??= { id: "workshop", name: "the workshops", x: 70, y: 33, social: true, outdoors: false, topics: ["craft", "work", "trade"] };
  return v.civ;
}

/** What winter does to those without a roof or cloth, and whether the season counts as a cold one. */
function pressures(w: WorldState): void {
  const v = w.village!;
  if (v.season !== "winter") return;
  const homes = Object.values(v.households);
  let bare = 0;
  for (const hh of homes) {
    const cold = (hh.shelter !== "house" ? 0.06 : 0.02) * (1 - warmth(w, hh));
    if (hh.shelter !== "house" && warmth(w, hh) < 0.5) bare++;
    for (const id of hh.members) if (w.order.includes(id)) w.minds[id]!.needs.energy = clamp(w.minds[id]!.needs.energy - cold);
  }
  if (bare >= Math.max(2, homes.length * 0.25)) mark(w, "cold");
}

/** One season of the civilization systems in one town. `live` is true for a town running hour by hour. */
export async function civSeason(w: WorldState, faculties: Faculties, sink: Sink, live: boolean): Promise<void> {
  const c = civOf(w);
  if (!c) return;
  const v = w.village!;
  pressures(w);
  // An id can come round again once the long dead are forgotten (a second Ysolde, years later):
  // what was kept under it belongs to the one who died.
  for (const book of [c.health.immune, c.health.sick, c.economy.wiped, c.economy.was] as Record<string, unknown>[]) for (const id of Object.keys(book)) if (!w.order.includes(id)) delete book[id];
  if (v.season === "spring") tradesTurn(w, sink);
  techTurn(w, sink);
  await marketDay(w, faculties, sink, live);
  await factionsSeason(w, faculties, sink, live);
  await politySeason(w, faculties, sink, live);
  recordsSeason(w, sink);
  if (!live) for (let d = 0; d < v.seasonDays; d++) await diseaseDay(w, faculties, sink, false, d);
}

/** One morning in a live town. */
export async function civDay(w: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  if (!civOf(w)) return;
  await diseaseDay(w, faculties, sink, true);
}

/** A group has left `from` to found `to`: the new town runs the same systems, and takes what was theirs. */
export function civFound(from: WorldState, to: WorldState, group: Household[]): void {
  const a = civOf(from);
  if (!a) return;
  const b = enableCiv(to);
  for (const hh of group) {
    if (a.economy.goods[hh.id]) b.economy.goods[hh.id] = a.economy.goods[hh.id]!;
    delete a.economy.goods[hh.id];
    delete a.factions.of[hh.id];
    for (const id of hh.members) {
      if (a.health.immune[id]) b.health.immune[id] = a.health.immune[id]!;
      delete a.health.immune[id];
      delete a.health.sick[id];
      if (a.economy.was[id]) b.economy.was[id] = a.economy.was[id]!;
      delete a.economy.was[id];
    }
  }
  // They remember what the old town has been through, as far as it marks them.
  b.marks.plague = [...a.marks.plague];
}

// ---------------------------------------------------------------- between towns

/** Whether anything stops an ordinary trading boat between two towns today. */
export function civBlocksTrade(A: WorldState, B: WorldState): boolean {
  return !!civOf(A)?.health.closed || !!civOf(B)?.health.closed;
}

/** After a trading boat from A has been to B: it counts as trade, and sickness can ride along either way. */
export function civAfterTrade(a: Town, A: WorldState, b: Town, B: WorldState, trader: AgentId, sA: Sink, sB: Sink): void {
  if (!civOf(A) && !civOf(B)) return;
  mark(A, "trades");
  const obA = activeOutbreak(A);
  const obB = activeOutbreak(B);
  if (obA) expose(B, obA.disease, { kind: "trader", town: a.id, townName: a.name }, sB, landingClosed(B) ? 0.15 : 0.35);
  if (obB) expose(A, obB.disease, { kind: "trader", town: b.id, townName: b.name, carrier: trader }, sA, 0.3);
}

/** Each town learns how it stands with the others. */
function refreshAbroad(host: CivHost): void {
  const r = host.region;
  const R = regionCiv(r);
  for (const a of r.towns) {
    const A = host.world(a.id);
    const c = civOf(A);
    if (!c) continue;
    const span = 5 * yearTicks(A);
    const abroad: CivState["abroad"] = {};
    for (const b of r.towns) {
      if (b.id === a.id) continue;
      const B = host.world(b.id);
      const recent = R.raids.filter((x) => r.tick - x.tick < span);
      abroad[b.id] = { name: b.name, regard: (r.regard[`${a.id}>${b.id}`] ?? 0) + 0, raidedUs: recent.filter((x) => x.from === b.id && x.to === a.id).length, fought: recent.filter((x) => (x.from === b.id && x.to === a.id) || (x.from === a.id && x.to === b.id)).length, treaty: treatyBetween(r, a.id, b.id)?.kind, sick: activeOutbreak(B)?.disease };
    }
    c.abroad = abroad;
    for (const k of Object.keys(c.polity.stance)) if (!abroad[k]) delete c.polity.stance[k];
  }
}

/** Each merchant takes what is cheap at home to where it is dear. */
function merchantSeason(host: CivHost): void {
  const r = host.region;
  const R = regionCiv(r);
  for (const a of r.towns) {
    const A = host.world(a.id);
    const ca = civOf(A);
    if (!ca || ca.health.closed) continue;
    for (const m of A.order.filter((x) => A.agents[x]!.role === "merchant")) {
      const dests = r.towns.filter((b) => b.id !== a.id && !hostile(r, a.id, b.id) && civOf(host.world(b.id)) && !civOf(host.world(b.id))!.health.closed && host.world(b.id).order.length >= 6);
      for (const b of dests.sort((x, y) => (r.regard[`${a.id}>${y.id}`] ?? 0) - (r.regard[`${a.id}>${x.id}`] ?? 0) || x.id.localeCompare(y.id))) {
        const B = host.world(b.id);
        const run = merchantRun(A, B, m);
        if (!run) continue;
        const year = yearOf(A);
        const first = !R.runs.some((x) => x.from === a.id && x.to === b.id);
        R.runs.push({ tick: r.tick, year, from: a.id, to: b.id, merchant: m, good: run.good, qty: run.qty, profit: run.profit });
        mark(A, "trades");
        const route = ((r.routes ??= {})[`${a.id}>${b.id}`] ??= {});
        route[year] = (route[year] ?? 0) + 1;
        carryWords(A, B, m);
        const name = personName(A, m);
        const text = `${run.qty} ${GOODS[run.good].name}, bought at ${run.from} in ${a.name} and sold at ${run.to} in ${b.name}. ${name} cleared ${run.profit} days' food on the trip${craftBonus(A, "boats") > 0.5 ? ", under sail" : ""}.`;
        const why: Why[] = [{ agent: m, town: a.id, text: `${name} of ${a.name} lives by trade, and ${GOODS[run.good].name} fetched more in ${b.name} (${run.to}) than at home (${run.from}).` }];
        feed(A, host.sink(a.id), { kind: "event", place: "harbour", agents: [m], title: `${name} takes ${GOODS[run.good].name} to ${b.name}`, text });
        feed(B, host.sink(b.id), { kind: "event", place: "harbour", agents: [], title: `${name} of ${a.name} sells ${GOODS[run.good].name} at the landing`, text });
        if (first) {
          host.chronicle({ town: a.id, kind: "trade", text: `${name} of ${a.name} begins carrying ${GOODS[run.good].name} to ${b.name}.`, agents: [m], why });
          note(A, { kind: "trade", title: `${name} begins trading with ${b.name}`, text, agents: [m], why });
        }
        const obA = activeOutbreak(A);
        const obB = activeOutbreak(B);
        if (obA) expose(B, obA.disease, { kind: "merchant", town: a.id, townName: a.name }, host.sink(b.id), 0.35);
        if (obB) expose(A, obB.disease, { kind: "merchant", town: b.id, townName: b.name, carrier: m }, host.sink(a.id), 0.3);
        break;
      }
    }
  }
  if (R.runs.length > 200) R.runs.splice(0, R.runs.length - 200);
}

/** One season of what happens between towns. */
export async function civRegionSeason(host: CivHost): Promise<void> {
  if (!host.region.towns.some((t) => civOf(host.world(t.id)))) return;
  refreshAbroad(host);
  merchantSeason(host);
  await migrationSeason(host);
  await warSeason(host);
  refreshAbroad(host);
}

// ---------------------------------------------------------------- reading it

export interface CivView {
  since: number;
  economy?: EconomyView;
  factions?: ReturnType<typeof factionsView>;
  polity?: PolityView;
  health?: HealthView;
  records?: RecordsView;
  tech: ReturnType<typeof techTree>;
  /** How often each pressure has come in the last ten years. */
  pressures: Record<string, number>;
  abroad: { town: string; name: string; regard: number; raidedUs: number; fought: number; treaty?: string; sick?: string; stance?: string }[];
  events: (CivEvent & { names: string[] })[];
}

export function civView(w: WorldState): CivView | undefined {
  const c = civOf(w);
  if (!c) return undefined;
  const since = w.tick - 10 * yearTicks(w);
  return {
    since: yearOf({ ...w, tick: c.since }),
    economy: economyView(w),
    factions: factionsView(w),
    polity: polityView(w),
    health: healthView(w),
    records: recordsView(w),
    tech: techTree(w),
    pressures: Object.fromEntries(Object.entries(c.marks).map(([k, ts]) => [k, (ts as number[]).filter((t) => t >= since).length])),
    abroad: Object.entries(c.abroad).map(([town, a]) => ({ town, ...a, stance: c.polity.stance[town] })),
    events: c.events.slice(-60).reverse().map((e) => ({ ...e, names: (e.agents ?? []).map((id) => personName(w, id)) })),
  };
}

export interface RegionCivView {
  raids: (Omit<Raid, "went" | "stayed"> & { fromName: string; toName: string; leaderName: string; went: number; stayed: number })[];
  treaties: (Treaty & { aName: string; bName: string; inForce: boolean })[];
  moves: (Move & { fromName: string; toName: string; headName: string })[];
  runs: (Run & { fromName: string; toName: string; merchantName: string })[];
  /** People living by a trade, towns that can write, and towns with sides, for the map. */
  towns: { id: string; name: string; specialists: number; literate: boolean; factions: number; sick?: string; closed: boolean; grown: number }[];
}

export function regionCivView(region: RegionState, worldOf: (town: string) => WorldState): RegionCivView | undefined {
  if (!region.towns.some((t) => civOf(worldOf(t.id)))) return undefined;
  const R = regionCiv(region);
  const tn = (id: string) => region.towns.find((t) => t.id === id)?.name ?? id;
  const pn = (town: string, id: AgentId) => {
    for (const t of [town, ...region.towns.map((x) => x.id)]) {
      const n = worldOf(t)?.agents[id]?.name;
      if (n) return n;
    }
    return id;
  };
  return {
    raids: R.raids.slice(-20).reverse().map(({ went, stayed, ...x }) => ({ ...x, went: went.length, stayed: stayed.length, fromName: tn(x.from), toName: tn(x.to), leaderName: pn(x.from, x.leader) })),
    treaties: R.treaties.slice(-12).reverse().map((t) => ({ ...t, aName: tn(t.a), bName: tn(t.b), inForce: !t.ended })),
    moves: R.moves.slice(-20).reverse().map((m) => ({ ...m, fromName: tn(m.from), toName: tn(m.to), headName: pn(m.to, m.head) })),
    runs: R.runs.slice(-20).reverse().map((x) => ({ ...x, fromName: tn(x.from), toName: tn(x.to), merchantName: pn(x.from, x.merchant) })),
    towns: region.towns.map((t) => {
      const w = worldOf(t.id);
      const c = civOf(w);
      return { id: t.id, name: t.name, specialists: w.order.filter((x) => ["potter", "weaver", "smith", "healer", "merchant", "scribe"].includes(w.agents[x]!.role)).length, literate: !!c?.records.since, factions: c?.factions.factions.filter((f) => !f.ended).length ?? 0, sick: activeOutbreak(w)?.disease, closed: !!c && landingClosed(w), grown: grownOf(w).length };
    }),
  };
}

void DAY;
export * from "./base.js";
export { PROFESSIONS, GOODS, GOOD_IDS, marketDay, merchantRun, takeUp, tradesTurn, townGini, wealthOf, gini, capacity, toolBonus, spoilFactor, civTrade, settleTrade, economyView, type Good, type Economy, type EconomyView, type MarketDay } from "./economy.js";
export { findFactions, factionsSeason, factionOf, liveFactions, rivalryBetween, wrong, factionsView, type Faction, type FactionState, type FactionView } from "./factions.js";
export { electCiv, politySeason, platformFor, interest, lawInForce, landingClosed, polityView, type Contest, type Candidate, type Platform, type Polity, type PolityView, type Issue } from "./polity.js";
export { diseaseDay, expose, activeOutbreak, healthView, SICKNESSES, type Health, type Outbreak, type HealthView, type Sickness } from "./disease.js";
export { recordsSeason, readBack, writeDown, isWritten, writtenFounding, burnRecords, writerOf, recordsView, type Records, type RecordItem, type RecordsView } from "./records.js";
export { techTurn, techTree, openTechs } from "./tech.js";
export { moveHousehold, migrationSeason } from "./migration.js";
export { warSeason, raid, sue } from "./war.js";
export { regionCiv, treatyBetween, type CivHost, type RegionCiv, type Raid, type Treaty, type Move, type Run } from "./host.js";
