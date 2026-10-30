// Hollow Bay: the first village. The Kettle five and a boatload of settlers land on an empty shore
// at the end of summer with four seasons to get through. The minds are the same engine as the
// island's; what is new is a world that pushes back. Food has to be caught or grown and it spoils.
// Houses have to be designed (by the Architect, in the household head's own terms) and built from
// timber, stone and reeds someone else had to cut. And the village has to decide, out loud by the
// fire, whether to keep a common store for the people whose work feeds nobody directly.
//
// That decision is the point. Every adult chooses how much to put in, from their own state: trust
// in the others, a core belief left by a hungry winter years ago, how hungry they are tonight.
// Everyone sees who held back. Holding back is a norm violation that moves trust and becomes a
// story, and the stories travel by the existing rumor machinery, overheard and retold at the fire.
// When the season turns, the pledge is asked again, and the ledger can show why it changed.

import { reconsolidate, clamp } from "../memory.js";
import { dayOf, hourOf, identityOf, runPercept } from "../mind.js";
import type { ActionOption, Claim, Faculties, Percept } from "../ports.js";
import { nextId, nextRandom } from "../rng.js";
import type { Ablations, AgentId, Episode, MindState } from "../types.js";
import { check, describe, PACE, type Blueprint } from "../founders/blueprint.js";
import { createCast, WORLD_START } from "./cast.js";
import { considerLaw, elect, enforceLaws, foundingDay, type Civic, type Election, type Law } from "./civic.js";
import { ageOf, bedtime, hearStory, initLife, isChild, yearOf, lifeTurn, normHeld, sanction, settleNorms, storeNorm, type Life, type Norm } from "./life.js";
import { CROSSING, createSettlers, crossingMemory, other } from "./people.js";
import type { Place, PlaceId, RoutineEntry } from "./places.js";
import { claimFromEpisode, eventPercept, feed, hop, isNight, personName, record, thirdPerson, type AgentState, type Sink, type WorldState } from "./world.js";

export type Season = "summer" | "autumn" | "winter" | "spring";
export const SEASONS: Season[] = ["summer", "autumn", "winter", "spring"];
export type Weather = "fair" | "rain" | "gale";
export type Resource = "timber" | "stone" | "reeds";

export interface Household {
  id: string;
  name: string;
  members: AgentId[];
  home: PlaceId;
  food: number;
  shelter: "tent" | "house";
  /** The share of each day's surplus this household puts in the common store, from its members' pledges. */
  rate: number;
}

export interface Structure {
  id: string;
  name: string;
  household: string;
  designer: AgentId;
  blueprint: Blueprint;
  rationale: string;
  repairs: string[];
  need: Record<Resource, number>;
  have: Record<Resource, number>;
  hours: number;
  work: number;
  done: boolean;
  started: number;
  finished?: number;
  /** The trace of the decision the design came out of. */
  trace: string;
  builders: AgentId[];
}

export interface Pledge {
  agent: AgentId;
  option: "commit" | "token" | "hold";
  trace: string;
}

export interface StoreEntry {
  tick: number;
  household: string;
  amount: number;
  kind: "put" | "take";
}

export interface VillageState {
  season: Season;
  /** Days each season lasts, so a year fits in an evening of watching. */
  seasonDays: number;
  weather: Weather;
  blight: boolean;
  stock: Record<Resource, number>;
  /** `folded` sums the oldest entries, so a long-lived store keeps its totals without its whole log. */
  store: { food: number; log: StoreEntry[]; folded?: { put: number; take: number } };
  households: Record<string, Household>;
  structures: Structure[];
  /** Pledge rounds, newest last. */
  pledges: { tick: number; season: Season; proposer: AgentId; answers: Pledge[] }[];
  /** Last day each daily thing happened. */
  last: { meal: number; fireside: number; weather: number; tentNight: number; bedtime: number; founding?: number };
  /** Stories told at the fire, as `teller:episode`. */
  told: string[];
  /** Percepts raised inside synchronous bookkeeping (a house finished mid-step), run at the next step. */
  pending: { id: AgentId; p: Percept }[];
  /** Everyone who has lived here, alive or dead. */
  life: Record<AgentId, Life>;
  norms: Norm[];
  /** Leader, laws and the founding story (absent in worlds saved before C3). */
  civic?: Civic;
  /** The memory the founding story grows from: the crossing, or for a daughter town, the leaving. */
  founding?: string;
  /** Set when this village is one town of several. */
  town?: string;
  /** Ids and names in use anywhere in the region, so a birth in one town never takes another's. */
  reserved?: { ids: string[]; names: string[] };
}

export type VillageEvent = { kind: "pledge" } | { kind: "blight" } | { kind: "gale" };

const DAY = 1440;
const SHARE = 3;
const RATION = 1;
const SPOIL = 0.06;

/** What each trade makes per working hour, before weather, season and tiredness. */
const JOBS: Record<string, { place: PlaceId; makes: "food" | Resource | "build" | "cook" | "keep"; rate: number }> = {
  fisher: { place: "sea", makes: "food", rate: 0.9 },
  farmer: { place: "fields", makes: "food", rate: 0.55 },
  forager: { place: "woods", makes: "food", rate: 0.45 },
  woodcutter: { place: "woods", makes: "timber", rate: 1.4 },
  quarrier: { place: "quarry", makes: "stone", rate: 1.2 },
  thatcher: { place: "reeds", makes: "reeds", rate: 1.5 },
  builder: { place: "@build", makes: "build", rate: 1 },
  cook: { place: "tavern", makes: "cook", rate: 0 },
  keeper: { place: "store", makes: "keep", rate: 0 },
};

const SEASON_YIELD: Record<Season, Partial<Record<string, number>>> = {
  summer: { farmer: 1, forager: 1, fisher: 1 },
  autumn: { farmer: 1.4, forager: 1.2, fisher: 0.9 },
  winter: { farmer: 0.1, forager: 0.35, fisher: 0.6 },
  spring: { farmer: 0.5, forager: 0.8, fisher: 1 },
};
const GALE_CHANCE: Record<Season, number> = { summer: 0.06, autumn: 0.2, winter: 0.3, spring: 0.12 };

export const VILLAGE_PLACES: Record<PlaceId, Place> = {
  sea: { id: "sea", name: "the bay", x: 12, y: 12, social: false, outdoors: true, topics: ["sea", "catch"] },
  harbour: { id: "harbour", name: "the landing", x: 24, y: 30, social: true, outdoors: true, topics: ["boat", "landing"] },
  tavern: { id: "tavern", name: "the fire circle", x: 50, y: 33, social: true, outdoors: true, topics: ["fire", "stories"] },
  cliffs: { id: "cliffs", name: "the headland", x: 88, y: 10, social: true, outdoors: true, topics: ["headland"] },
  store: { id: "store", name: "the common store", x: 62, y: 21, social: true, outdoors: false, topics: ["store", "food", "winter"] },
  woods: { id: "woods", name: "the pinewood", x: 86, y: 42, social: true, outdoors: true, topics: ["timber", "forage"] },
  quarry: { id: "quarry", name: "the quarry", x: 90, y: 25, social: true, outdoors: true, topics: ["stone"] },
  fields: { id: "fields", name: "the barley field", x: 87, y: 56, social: true, outdoors: true, topics: ["barley", "harvest"] },
  graveyard: { id: "graveyard", name: "the burial ground", x: 76, y: 12, social: false, outdoors: true, topics: ["death", "grief"] },
  reeds: { id: "reeds", name: "the reedbed", x: 22, y: 56, social: true, outdoors: true, topics: ["reeds", "thatch"] },
};

const KETTLE_ROLES: Record<string, string> = { mara: "fisher", theo: "builder", jun: "fisher", corran: "keeper", wren: "cook" };
const KETTLE_JOBS: Record<string, string> = { fisher: "fishing the bay", builder: "building", keeper: "keeping the common store", cook: "cooking at the fire circle" };

function kettleRoutine(id: AgentId, home: PlaceId): RoutineEntry[] {
  const role = KETTLE_ROLES[id]!;
  const job = KETTLE_JOBS[role]!;
  const work = role === "cook" ? "tavern" : role === "keeper" ? "store" : "@work";
  return [
    { from: 7, place: home, activity: "waking up" },
    { from: 7.5, place: work, activity: job },
    { from: 12, place: "tavern", activity: role === "cook" ? "serving the midday meal" : "the midday meal at the fire circle" },
    { from: 13, place: work, activity: job },
    { from: 17.5, place: role === "cook" ? "tavern" : home, activity: role === "cook" ? "cooking supper" : "at home", evening: { place: "tavern", activity: "sitting by the fire circle" } },
    { from: 22, place: home, activity: "at home" },
  ];
}

/** Homes sit in staggered rows below the fire circle, in household order. */
function homePlace(id: string, name: string, i: number): Place {
  const row = Math.floor(i / 5);
  return { id, name, x: 32 + (i % 5) * 10 + (row % 2) * 5, y: 43 + row * 8, social: false, outdoors: false, topics: ["home"] };
}

export function createVillage(seed = 11, ablations: Partial<Ablations> = {}, settlerCount = 10): WorldState {
  const cast = createCast(seed, ablations);
  const known = cast.map((c) => ({ id: c.mind.id, name: c.mind.name, role: KETTLE_ROLES[c.mind.id]! }));
  const { settlers, households: hs } = createSettlers(seed, settlerCount, ablations, known);
  const households: Record<string, Household> = {};
  const places: Record<PlaceId, Place> = structuredClone(VILLAGE_PLACES);
  const homes = [...cast.map((c) => ({ id: c.mind.id, name: c.mind.name, members: [c.mind.id] })), ...hs];
  homes.forEach((h, i) => {
    const hh: Household = { id: h.id, name: h.name, members: h.members, home: `home_${h.id}`, food: 4 * h.members.length, shelter: "tent", rate: 0 };
    places[hh.home] = homePlace(hh.home, homeName(hh), i);
    households[h.id] = hh;
  });

  const world: WorldState = {
    name: "Hollow Bay",
    places,
    seed,
    tick: WORLD_START,
    rng: (seed * 2246822519) >>> 0,
    idCounter: 0,
    order: [],
    minds: {},
    agents: {},
    rumors: {},
    events: [],
    village: {
      season: "summer",
      seasonDays: 4,
      weather: "fair",
      blight: false,
      stock: { timber: 12, stone: 4, reeds: 4 },
      store: { food: 0, log: [] },
      households,
      structures: [],
      pledges: [],
      last: { meal: 0, fireside: 0, weather: 1, tentNight: 0, bedtime: 0 },
      told: [],
      pending: [],
      life: {},
      norms: [],
    },
  };

  const add = (mind: MindState, role: string, home: PlaceId, routine: RoutineEntry[], wants: AgentState["wants"]) => {
    world.order.push(mind.id);
    world.minds[mind.id] = mind;
    world.agents[mind.id] = { id: mind.id, name: mind.name, role, place: home, activity: "waking up", home, routine, wants, lastTalk: {}, told: [] };
  };
  for (const c of cast) {
    const m = c.mind;
    const home = `home_${m.id}`;
    // They came too: the same people, the same grudges, a new shore.
    m.episodes.push(crossingMemory(m, world));
    for (const s of settlers) m.others[s.mind.id] ??= other(s.mind.id, s.mind.name, 0.5, 0.5, 0.1);
    m.goals.push({ id: `g_${m.id}_roof`, text: "Get a roof over my head before winter", tags: ["house", "build", "winter", "shelter"], priority: 0.7, progress: 0.05, invested: 0.2, rate: 0 });
    m.goals.push({ id: `g_${m.id}_fed`, text: "Get through the winter fed", tags: ["food", "store", "hunger", "winter"], priority: 0.6, progress: 0.3, invested: 0.1, rate: 0 });
    const wants = c.wants.filter((w) => !/shutters|price/.test(w.what));
    if (m.id === "wren") wants.push({ id: "w_wren_roof", kind: "request", target: "theo", what: "put a roof over the fire circle before the rains", topics: ["fire", "build", "help"], goal: `g_wren_roof` });
    add(m, KETTLE_ROLES[m.id]!, home, kettleRoutine(m.id, home), wants);
  }
  for (const s of settlers) add(s.mind, s.role, s.home, s.routine, s.wants);
  for (const id of world.order) world.agents[id]!.place = world.agents[id]!.home;
  initLife(world);
  return world;
}

/**
 * A daughter town: households that left another town, with their minds, on a fresh shore. The map is
 * the same bay's layout under a new name; everything else (store, houses, norms' strength) starts
 * from what they carried.
 */
export function foundVillage(o: {
  name: string;
  town: string;
  seed: number;
  tick: number;
  rng: number;
  from: VillageState;
  households: Household[];
  minds: Record<AgentId, MindState>;
  agents: Record<AgentId, AgentState>;
  order: AgentId[];
  food: number;
  founding: string;
}): WorldState {
  const places: Record<PlaceId, Place> = structuredClone(VILLAGE_PLACES);
  const households: Record<string, Household> = {};
  o.households.forEach((h, i) => {
    const hh: Household = { ...structuredClone(h), home: `home_${h.id}`, shelter: "tent", rate: 0 };
    places[hh.home] = homePlace(hh.home, homeName(hh), i);
    households[h.id] = hh;
  });
  const world: WorldState = {
    name: o.name,
    places,
    seed: o.seed,
    tick: o.tick,
    rng: o.rng >>> 0,
    idCounter: 0,
    order: [...o.order],
    minds: o.minds,
    agents: o.agents,
    rumors: {},
    events: [],
    village: {
      season: o.from.season,
      seasonDays: o.from.seasonDays,
      weather: "fair",
      blight: false,
      stock: { timber: 10, stone: 4, reeds: 4 },
      store: { food: Number(o.food.toFixed(1)), log: [] },
      households,
      structures: [],
      pledges: [],
      last: { ...o.from.last },
      told: [],
      pending: [],
      life: Object.fromEntries(Object.entries(o.from.life).filter(([id]) => id in o.minds).map(([id, l]) => [id, structuredClone(l)])),
      norms: structuredClone(o.from.norms),
      founding: o.founding,
      town: o.town,
    },
  };
  for (const id of world.order) {
    const a = world.agents[id]!;
    const hh = Object.values(households).find((h) => h.members.includes(id))!;
    const old = a.home;
    a.home = hh.home;
    a.place = "harbour";
    a.activity = "just ashore";
    a.override = undefined;
    a.talkingUntil = undefined;
    a.routine = a.routine.map((e) => ({ ...e, place: e.place === old ? hh.home : e.place, evening: e.evening && { ...e.evening, place: e.evening.place === old ? hh.home : e.evening.place } }));
    a.wants = a.wants.filter((w) => !w.target || world.order.includes(w.target));
  }
  return world;
}

// ---------------------------------------------------------------- reading the village

export const seasonOf = (v: VillageState, t: number): Season => SEASONS[Math.floor((dayOf(t) - 1) / v.seasonDays) % 4]!;
export const householdOf = (world: WorldState, id: AgentId): Household | undefined => Object.values(world.village!.households).find((h) => h.members.includes(id));

/** Where "@work" means today, and what the person is doing there. */
export function villageWorkplace(world: WorldState, a: AgentState, activity: string): { place: PlaceId; activity: string } {
  const v = world.village!;
  const job = JOBS[a.role];
  if (!job) return { place: "tavern", activity };
  if (a.role === "fisher" && v.weather === "gale") return { place: "harbour", activity: "mending nets, kept ashore by the gale" };
  if (a.role === "farmer" && v.season === "winter") return { place: "woods", activity: "foraging the pinewood; nothing grows in winter" };
  if (job.makes === "build") {
    const site = v.structures.find((s) => !s.done && s.builders.includes(a.id)) ?? v.structures.find((s) => !s.done);
    if (!site) return { place: "woods", activity: "felling pines for the next house" };
    const owner = v.households[site.household]!;
    return { place: owner.home, activity: `building ${possessive(owner)} house` };
  }
  return { place: job.place, activity };
}

// ---------------------------------------------------------------- the day

/** Called by advance() once per step, after positions update. */
export async function villageStep(world: WorldState, dt: number, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const t = world.tick;
  const day = dayOf(t);
  const h = hourOf(t);

  if (day !== v.last.weather && !isNight(t)) await newDay(world, faculties, sink);
  if (isNight(t)) {
    if (v.last.tentNight !== day - (h < 12 ? 1 : 0) && v.weather !== "fair") await tentNight(world, faculties, sink);
    return;
  }
  work(world, dt, sink);
  await startBuilding(world, faculties, sink);
  if (h >= 19 && v.last.meal !== day) await supper(world, faculties, sink);
  // The first night of summer, from the second year on, belongs to the founding story.
  if (v.season === "summer" && (day - 1) % v.seasonDays === 0 && day > v.seasonDays && h >= 19.5 && h < 22 && v.last.founding !== day) {
    v.last.founding = day;
    // A daughter town tells its own beginning, then the older story of the crossing.
    for (const f of [...new Set([v.founding ?? CROSSING, CROSSING])]) if (await foundingDay(world, f, faculties, sink)) v.last.fireside = day;
  }
  if (h >= 19.5 && h < 22 && v.last.fireside !== day) await fireside(world, faculties, sink);
  if (h >= 20.75 && h < 22 && v.last.bedtime !== day) {
    v.last.bedtime = day;
    await bedtime(world, faculties, sink);
  }
  // The pledge is asked on the second evening, and again when each season turns.
  const seasonStart = (day - 1) % v.seasonDays === 0;
  const due = (day === 2 && v.pledges.length === 0) || (seasonStart && day > 2 && !v.pledges.some((p) => dayOf(p.tick) === day));
  if (due && h >= 19.25 && h < 21) await pledge(world, faculties, sink);
}

async function newDay(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const day = dayOf(world.tick);
  v.last.weather = day;
  const before = v.season;
  v.season = seasonOf(v, world.tick);
  if (v.season !== before) {
    v.blight = false;
    feed(world, sink, { kind: "event", agents: [], title: `${cap(v.season)} comes to ${world.name}`, text: SEASON_TEXT[v.season] });
    await lifeTurn(world, faculties, sink);
    if (v.season === "spring") elect(world, sink);
  }
  const r = nextRandom(world);
  v.weather = r < GALE_CHANCE[v.season] ? "gale" : r < GALE_CHANCE[v.season] + 0.25 ? "rain" : "fair";
  if (v.weather === "gale") {
    feed(world, sink, { kind: "event", agents: [], title: "A gale keeps the boats in", text: "Spray over the landing all day. Nobody fishes." });
    for (const id of world.order.filter((x) => world.agents[x]!.role === "fisher")) {
      const m = world.minds[id]!;
      const tr = await runPercept(m, eventPercept(m, "world", "circumstance", -0.04, 0.4, ["gale", "catch", "food"], "A gale kept the boats in all day.", "A gale blows all day; the boats stay drawn up on the landing.", `ev_gale_${day}`), faculties);
      record(world, sink, id, tr);
    }
  }
  // Food spoils in tents. What is in the store keeps.
  for (const hh of Object.values(v.households)) hh.food = Number((hh.food * (1 - SPOIL)).toFixed(2));
}

const SEASON_TEXT: Record<Season, string> = {
  summer: "Long light evenings. The barley is green.",
  autumn: "The barley turns. Harvest, and the first hard winds.",
  winter: "Short days. Nothing grows. The fish go deep.",
  spring: "Thaw. Planting, and whatever is left in the store.",
};

function work(world: WorldState, dt: number, sink: Sink): void {
  const v = world.village!;
  const hours = dt / 60;
  for (const id of world.order) {
    const a = world.agents[id]!;
    const job = JOBS[a.role];
    if (!job || (a.talkingUntil ?? 0) > world.tick || a.override) continue;
    const m = world.minds[id]!;
    const pace = hours * (0.5 + 0.5 * m.needs.energy);
    const hh = householdOf(world, id);
    if (a.place === "harbour" || a.place === "tavern" || (a.place === a.home && job.makes !== "build")) continue;
    if (job.makes === "food") {
      let y = SEASON_YIELD[v.season][a.role] ?? 1;
      if (a.role === "fisher" && a.place !== "sea") continue;
      if (a.role === "farmer" && v.blight) y *= 0.4;
      if (a.place === "woods" && a.role !== "forager") y = (SEASON_YIELD[v.season].forager ?? 1) * 0.8;
      if (v.weather === "rain") y *= 0.8;
      if (hh) hh.food = Number((hh.food + JOBS[a.role]!.rate * y * pace).toFixed(2));
    } else if (job.makes === "timber" || job.makes === "stone" || job.makes === "reeds") {
      v.stock[job.makes] = Number((v.stock[job.makes] + job.rate * pace * (v.weather === "rain" ? 0.8 : 1)).toFixed(2));
    } else if (job.makes === "build") {
      if (a.place === "woods") {
        v.stock.timber = Number((v.stock.timber + 1 * pace).toFixed(2));
        continue;
      }
      const site = v.structures.find((s) => !s.done && v.households[s.household]?.home === a.place);
      if (!site) continue;
      if (!site.builders.includes(id)) site.builders.push(id);
      const next = Math.min(site.hours, site.work + pace);
      const frac = next / site.hours;
      // Draw what this much work needs from the village's piles; stop when a pile runs out.
      let short: Resource | undefined;
      for (const k of ["timber", "stone", "reeds"] as Resource[]) {
        const want = site.need[k] * frac - site.have[k];
        if (want <= 0) continue;
        const got = Math.min(want, v.stock[k]);
        v.stock[k] = Number((v.stock[k] - got).toFixed(2));
        site.have[k] = Number((site.have[k] + got).toFixed(2));
        if (got < want - 1e-6) short = k;
      }
      if (short) {
        a.activity = `waiting on ${short}`;
        continue;
      }
      site.work = next;
      if (site.work >= site.hours - 1e-6) finish(world, site, sink);
    }
  }
}

function finish(world: WorldState, s: Structure, sink: Sink): void {
  const v = world.village!;
  s.done = true;
  s.finished = world.tick;
  const hh = v.households[s.household]!;
  hh.shelter = "house";
  world.places[hh.home]!.name = homeName(hh);
  feed(world, sink, {
    kind: "event",
    place: hh.home,
    agents: [...hh.members, ...s.builders],
    title: `${cap(possessive(hh))} house is finished`,
    text: `Built by ${list(s.builders.map((b) => personName(world, b)))} in ${Math.round((world.tick - s.started) / 60)} hours.`,
  });
  for (const id of hh.members) {
    const m = world.minds[id]!;
    const p = eventPercept(m, "world", "circumstance", 0.6, 0.6, ["house", "shelter", "build", "winter"], "We have a roof over our heads at last.", `The last of the roof goes on ${world.places[hh.home]!.name}.`, `ev_house_${s.id}`);
    v.pending.push({ id, p });
  }
}

async function flush(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  while (v.pending.length) {
    const { id, p } = v.pending.shift()!;
    const m = world.minds[id]!;
    p.tick = m.tick;
    record(world, sink, id, await runPercept(m, p, faculties));
  }
  for (const g of Object.values(world.minds).flatMap((m) => m.goals.filter((g) => g.tags.includes("shelter")).map((g) => ({ m, g })))) {
    const hh = householdOf(world, g.m.id);
    if (hh?.shelter === "house") g.g.progress = 1;
  }
}

// ---------------------------------------------------------------- designing houses

const DESIGN_OPTIONS: ActionOption[] = [
  { id: "build_sturdy", label: "Build it to last", verb: "plan a house to last the winters", description: "A sturdy house, even if it takes longer and uses more of the village's timber and stone.", prosocial: -0.1, assertive: 0.4, avoidant: 0, disclosure: 0, coping: "problem", act: "plans a house to last" },
  { id: "build_quick", label: "Get a roof up fast", verb: "plan something quick", description: "A small plain house that can be up within a couple of days.", prosocial: 0.2, assertive: 0, avoidant: 0.2, disclosure: 0, coping: "problem", act: "plans something small and quick" },
];

/** When a builder is free and a household is still in tents, its head designs a house. */
async function startBuilding(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  await flush(world, faculties, sink);
  const v = world.village!;
  if (v.structures.filter((s) => !s.done).length >= Math.max(1, world.order.filter((x) => world.agents[x]!.role === "builder").length)) return;
  if (hourOf(world.tick) < 8 || hourOf(world.tick) > 16) return;
  // Bigger households first, then whoever has gone hungriest; ties by order.
  const waiting = Object.values(v.households)
    .filter((h) => h.shelter === "tent" && !v.structures.some((s) => s.household === h.id))
    .sort((a, b) => b.members.length - a.members.length);
  const hh = waiting[0];
  if (!hh) return;
  const head = [...hh.members].sort((a, b) => world.minds[b]!.traits.conscientiousness - world.minds[a]!.traits.conscientiousness)[0]!;
  const m = world.minds[head]!;
  const p: Percept = {
    ...eventPercept(m, "world", "circumstance", 0.3, 0.6, ["house", "build", "shelter", "winter", "storm"], `The builders are ready to start on our house.`, `The builders tell ${m.name} they can start on ${possessive(hh)} house.`, nextId(world, "ev_design")),
    options: DESIGN_OPTIONS,
  };
  const decided = await runPercept(m, p, faculties);
  const sturdy = decided.action?.option === "build_sturdy";
  const ws = decided.workspace;
  const af = m.affect;
  const stance: string[] = [];
  if (af.emotions.fear > 0.15) stance.push("You are uneasy about the winter.");
  if (af.mood.valence < -0.2) stance.push("Your mood is low.");
  if (sturdy) stance.push("You have decided to build it to last.");
  else stance.push("You have decided to get a roof up fast and keep it small.");
  const supply = { logs: Math.round(v.stock.timber + 40), stone: Math.round(v.stock.stone + 30), reeds: Math.round(v.stock.reeds + 20) };
  const res = await faculties.architect({
    self: identityOf(m),
    want: `A house in ${world.name} for ${hh.members.length > 1 ? `${hh.members.length} of us` : "me"} that will see us through the winter. ${sturdy ? "Built to last." : "Small and quick."}`,
    site: {
      plot: { w: 11, d: 11 },
      weatherFrom: "west",
      seaTo: "west",
      materials: [
        { name: "timber", available: supply.logs, note: "the pinewood; the woodcutters bring it in, one log saws into 4 planks" },
        { name: "stone", available: supply.stone, note: "the quarry on the hill; one quarried stone is one block" },
        { name: "reeds", available: supply.reeds, note: "the reedbed; one bed makes 2 thatch" },
      ],
      hoursOfWorkLeft: sturdy ? 40 : 16,
      pace: "The materials are gathered by others. Setting blocks takes about 2.5 minutes each: a 7 by 6 plank house is about 10 hours for one builder; a 9 by 8 stone house nearer 20.",
    },
    workspace: ws.map((w) => ({ id: w.ref, kind: w.kind, label: w.label, text: w.text, weight: Number(w.score.toFixed(2)) })),
    stance,
    temperament: { openness: m.traits.openness, conscientiousness: m.traits.conscientiousness, extraversion: m.traits.extraversion, neuroticism: m.traits.neuroticism },
    patternBook: v.structures.map((s) => ({ name: s.blueprint.name, summary: describe(s.blueprint) })),
  });
  decided.llmCalls.push("architect");
  const checked = check(res.blueprint, { x0: 0, z0: 0, w: 13, d: 13, y: 1 }, supply);
  const raw = checked.bill.raw;
  const s: Structure = {
    id: nextId(world, "house"),
    name: checked.blueprint.name,
    household: hh.id,
    designer: head,
    blueprint: checked.blueprint,
    rationale: res.rationale,
    repairs: checked.repairs,
    need: { timber: raw.logs, stone: raw.stone, reeds: raw.reeds },
    have: { timber: 0, stone: 0, reeds: 0 },
    hours: Number(((checked.bill.blocks * PACE.place) / 60).toFixed(1)),
    work: 0,
    done: false,
    started: world.tick,
    trace: decided.id,
    builders: [],
  };
  v.structures.push(s);
  record(world, sink, head, decided);
  feed(world, sink, {
    kind: "insight",
    place: hh.home,
    agents: [head],
    title: `${m.name} designs ${s.name.replace(/^A /, "a ")} for ${hh.members.length > 1 ? hh.name : `${m.pronouns.reflexive}`}`,
    text: `${cap(describe(s.blueprint))}. Needs ${raw.logs} timber, ${raw.stone} stone, ${raw.reeds} reeds; about ${Math.round(s.hours)} hours of building. "${res.rationale}"`,
    refs: [{ agent: head, trace: decided.id }],
  });
}

// ---------------------------------------------------------------- food

async function supper(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const day = dayOf(world.tick);
  v.last.meal = day;
  const cook = world.order.find((x) => world.agents[x]!.role === "cook" && world.agents[x]!.place === "tavern");
  const ration = cook ? RATION * 0.85 : RATION;
  const put: string[] = [];
  const took: string[] = [];
  const hungry: AgentId[] = [];
  for (const hh of Object.values(v.households)) {
    const need = ration * hh.members.reduce((n, m) => n + (isChild(world, m) ? 0.6 : 1), 0);
    // Committed households put a share of what is over two days' needs into the store.
    const surplus = hh.food - need * 3;
    if (hh.rate > 0 && surplus > 0) {
      const amount = Number((surplus * hh.rate).toFixed(1));
      if (amount >= 0.1) {
        hh.food -= amount;
        v.store.food = Number((v.store.food + amount).toFixed(1));
        logStore(v, { tick: world.tick, household: hh.id, amount, kind: "put" });
        put.push(`${hh.name} ${amount}`);
      }
    }
    if (hh.food >= need) {
      hh.food = Number((hh.food - need).toFixed(2));
      continue;
    }
    let short = need - hh.food;
    hh.food = 0;
    const take = Math.min(short, v.store.food);
    if (take > 0) {
      v.store.food = Number((v.store.food - take).toFixed(1));
      logStore(v, { tick: world.tick, household: hh.id, amount: Number(take.toFixed(1)), kind: "take" });
      took.push(`${hh.name} ${take.toFixed(1)}`);
      short -= take;
      await tookAfterHolding(world, hh, faculties, sink);
    }
    if (short > 0.05) hungry.push(...hh.members.slice(0, Math.max(1, Math.round((short / need) * hh.members.length))));
  }
  for (const id of hungry) {
    const m = world.minds[id]!;
    m.needs.energy = clamp(m.needs.energy - 0.12);
    const tr = await runPercept(m, eventPercept(m, "world", "circumstance", -0.45, 0.55, ["food", "hunger", "store", "winter"], "I went to bed hungry.", `There isn't enough for ${m.name}'s supper.`, `ev_hungry_${day}`), faculties);
    record(world, sink, id, tr);
  }
  for (const id of world.order) if (!hungry.includes(id)) world.minds[id]!.needs.energy = clamp(world.minds[id]!.needs.energy + 0.08);
  if (put.length || took.length || hungry.length) {
    feed(world, sink, {
      kind: "event",
      place: "store",
      agents: hungry,
      title: hungry.length ? `${hungry.length} ${hungry.length === 1 ? "person goes" : "people go"} to bed hungry` : `Supper, and the store stands at ${v.store.food.toFixed(0)}`,
      text: [put.length ? `Put in the store: ${put.join(", ")}.` : "", took.length ? `Taken from the store: ${took.join(", ")}.` : "", hungry.length ? `Hungry tonight: ${list(hungry.map((x) => personName(world, x)))}.` : ""].filter(Boolean).join(" "),
    });
  }
}

/** Someone whose household held back takes from the store. The keeper sees it. */
async function tookAfterHolding(world: WorldState, hh: Household, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const last = v.pledges.at(-1);
  if (!last || hh.rate >= 0.35) return;
  const holders = last.answers.filter((a) => a.option === "hold" && hh.members.includes(a.agent)).map((a) => a.agent);
  const culprit = holders[0];
  if (!culprit) return;
  const keeper = world.order.find((x) => world.agents[x]!.role === "keeper");
  const witnesses = world.order.filter((x) => x !== culprit && !hh.members.includes(x) && (x === keeper || world.agents[x]!.place === "store"));
  for (const w of witnesses) {
    const m = world.minds[w]!;
    const p = eventPercept(m, culprit, "other", -0.04, 0.6, ["store", "fairness", "food", "winter"], `${personName(world, culprit)} took from the common store after holding back from it.`, `${personName(world, culprit)} takes a share from the common store.`, nextId(world, "ev_took"), [culprit]);
    p.features.intentional = 0.9;
    p.features.normViolation = 0.75;
    const tr = await runPercept(m, p, faculties);
    record(world, sink, w, tr);
    sanction(world, w, tr);
  }
  if (witnesses.length) feed(world, sink, { kind: "event", place: "store", agents: [culprit, ...witnesses], title: `${personName(world, culprit)} takes from the store`, text: `${list(witnesses.map((x) => personName(world, x)))} saw it, and remembers that ${personName(world, culprit)} put nothing in.` });
}

// ---------------------------------------------------------------- the common store

/** The choices at the pledge. Someone who believes in the store norm finds holding back costs more (Bicchieri 2006). */
const PLEDGE_OPTIONS = (share: number, norm = 0): ActionOption[] => [
  { id: "commit", label: "Put in a full share", verb: "commit to the common store", description: `Pledge a full share, about ${share} days' food from the household's surplus, to feed the builders and the cook and to keep for winter.`, prosocial: Math.min(1, 0.85 + 0.15 * norm), assertive: 0.1, avoidant: 0, disclosure: 0.3, comply: true },
  { id: "token", label: "Put in a little", verb: "put in a token amount", description: "Pledge a little, enough to be seen to give, and keep the rest for the household.", prosocial: 0.15 - 0.3 * norm, assertive: 0, avoidant: 0.4, disclosure: 0 },
  { id: "hold", label: "Hold back", verb: "hold back from the store", description: `Keep the household's food for the household. Let others feed the builders.${norm > 0.3 ? " Everyone here expects you to put in." : ""}`, prosocial: -0.6 - 0.5 * norm, assertive: 0.5, avoidant: 0.2, disclosure: 0 },
];
const RATE: Record<Pledge["option"], number> = { commit: 0.6, token: 0.15, hold: 0 };

/** Wren (or whoever is most trusted) asks the fire for a common store. Every adult answers. */
async function pledge(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const present = world.order.filter((x) => world.agents[x]!.place === "tavern");
  const everyone = world.order.filter((x) => !isChild(world, x));
  const leader = v.civic?.leader;
  const proposer = leader && everyone.includes(leader) ? leader : world.minds.wren && everyone.includes("wren") ? "wren" : [...everyone].sort((a, b) => world.minds[b]!.traits.agreeableness - world.minds[a]!.traits.agreeableness)[0]!;
  const P = world.minds[proposer]!;
  const first = v.pledges.length === 0;
  const builders = everyone.filter((x) => ["builder", "woodcutter", "quarrier", "thatcher", "cook", "keeper"].includes(world.agents[x]!.role));
  const ask = first
    ? `We need a common store. ${list(builders.map((b) => personName(world, b)))} are building and cutting for all of us and catching nothing. Every household puts by a share for them and for the winter.`
    : `It's ${v.season} now. The store stands at ${v.store.food.toFixed(0)}. I'm asking again: who's putting in?`;
  const line = (await faculties.speak({
    self: identityOf(P),
    listener: { id: "everyone", name: "everyone at the fire" },
    heard: "",
    intent: { option: "Propose a common store", description: ask },
    content: [],
    style: { warmth: 0.6, curtness: 0.2, hedging: 0.2, verbosity: 0.5 },
    stance: ["You are standing up at the fire circle to speak to the whole village. Two or three sentences."],
    salience: 0.9,
  })).utterance;
  // Everyone comes to the fire for this.
  for (const id of everyone) {
    const a = world.agents[id]!;
    a.place = "tavern";
    a.activity = "at the fire circle for the village meeting";
  }
  const round = { tick: world.tick, season: v.season, proposer, answers: [] as Pledge[] };
  const lines = [{ speaker: proposer, text: line }];
  const evId = nextId(world, "ev_pledge");
  world.events.push({ id: evId, tick: world.tick, kind: "pledge", label: first ? "the meeting about the common store" : `the ${v.season} pledge`, topics: ["store", "food", "winter", "fairness", evId] });
  for (const id of everyone) {
    const m = world.minds[id]!;
    const hh = householdOf(world, id)!;
    const own = id === proposer;
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: m.tick,
      kind: own ? "event" : "speech",
      rawText: `${P.name}, to the whole fire: "${line}"`,
      actor: own ? "world" : proposer,
      addressedToSelf: true,
      about: [],
      topics: ["store", "food", "winter", "fairness", evId],
      features: { outcomeForSelf: -0.15, agency: own ? "circumstance" : "other", intentional: 0.6, normViolation: 0, prospective: true, intensity: 0.65 },
      request: { what: "put a share of the household's food into the common store", topics: ["store", "food"] },
      claims: [],
      details: [{ key: "store", value: `the store held ${v.store.food.toFixed(0)}`, salience: 0.3 }],
      template: "At the fire, {who} asked every household to put by for the common store; {store}.",
      gist: own ? "I asked the village to put by for a common store." : `${P.name} asked every household to put by for the common store.`,
      eventId: evId,
      options: PLEDGE_OPTIONS(SHARE, normHeld(world, id)),
    };
    p.details.unshift({ key: "who", value: P.name, salience: 0.2 });
    // Hunger tonight weighs: the household's own food changes what giving costs.
    p.features.outcomeForSelf -= hh.food < hh.members.length * 2 ? 0.25 : 0;
    const tr = await runPercept(m, p, faculties);
    record(world, sink, id, tr);
    const option = (tr.action?.option ?? "token") as Pledge["option"];
    round.answers.push({ agent: id, option, trace: tr.id });
    if (tr.action?.kind === "speech" && present.length) lines.push({ speaker: id, text: tr.action.text });
  }
  v.pledges.push(round);
  for (const hh of Object.values(v.households)) {
    const rs = round.answers.filter((a) => hh.members.includes(a.agent)).map((a) => RATE[a.option]);
    hh.rate = rs.length ? Number((rs.reduce((s, x) => s + x, 0) / rs.length).toFixed(2)) : 0;
  }
  await enforceLaws(world, round.answers, faculties, sink);
  const by = (o: Pledge["option"]) => round.answers.filter((a) => a.option === o).map((a) => personName(world, a.agent));
  feed(world, sink, {
    kind: "talk",
    place: "tavern",
    agents: [...everyone],
    title: first ? `${P.name} asks the village for a common store` : `${P.name} asks for the ${v.season} pledge`,
    lines: lines.slice(0, 7),
    text: [by("commit").length ? `A full share: ${list(by("commit"))}.` : "", by("token").length ? `A little: ${list(by("token"))}.` : "", by("hold").length ? `Held back: ${list(by("hold"))}.` : ""].filter(Boolean).join(" "),
    refs: round.answers.slice(0, 20).map((a) => ({ agent: a.agent, trace: a.trace })),
  });

  // Everyone heard who held back. That is a broken norm, and it is remembered.
  const holders = round.answers.filter((a) => a.option !== "commit");
  for (const id of everyone) {
    const m = world.minds[id]!;
    for (const hd of holders) {
      if (hd.agent === id) continue;
      const kin = householdOf(world, id)?.members.includes(hd.agent);
      if (kin) continue;
      const severe = hd.option === "hold";
      const p = eventPercept(
        m,
        hd.agent,
        "other",
        -0.04,
        severe ? 0.5 : 0.25,
        ["store", "fairness", "food", evId],
        severe ? `${personName(world, hd.agent)} held back from the common store.` : `${personName(world, hd.agent)} only put a little into the common store.`,
        `${personName(world, hd.agent)} ${severe ? "says they'll keep their food for their own" : "pledges a token amount"}.`,
        `${evId}_${hd.agent}`,
        [hd.agent],
      );
      p.features.intentional = 0.8;
      p.features.normViolation = (severe ? 0.6 : 0.25) + 0.3 * storeNorm(v).strength;
      const tr = await runPercept(m, p, faculties);
      record(world, sink, id, tr);
      if (severe) sanction(world, id, tr);
    }
  }
  settleNorms(world, sink);
  await considerLaw(world, round.answers, faculties, sink);
}

// ---------------------------------------------------------------- nights and stories

async function tentNight(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const day = dayOf(world.tick) - (hourOf(world.tick) < 12 ? 1 : 0);
  v.last.tentNight = day;
  const cold: AgentId[] = [];
  for (const hh of Object.values(v.households)) {
    if (hh.shelter !== "tent") continue;
    for (const id of hh.members) {
      const m = world.minds[id]!;
      m.needs.energy = clamp(m.needs.energy - (v.weather === "gale" ? 0.15 : 0.06));
      const p = eventPercept(m, "world", "circumstance", v.weather === "gale" ? -0.4 : -0.2, v.weather === "gale" ? 0.6 : 0.35, ["shelter", "house", "cold", v.weather, "winter"], v.weather === "gale" ? "The gale nearly took the tent down in the night." : "Rain came through the tent all night.", v.weather === "gale" ? "The gale pulls at the tents all night." : "It rains all night on the tents.", `ev_tent_${day}`);
      record(world, sink, id, await runPercept(m, p, faculties));
      cold.push(id);
    }
  }
  if (cold.length) feed(world, sink, { kind: "event", agents: cold, title: v.weather === "gale" ? "A bad night in the tents" : "Rain on the tents", text: `Still under canvas: ${list(cold.map((c) => personName(world, c)))}.` });
}

/** Once an evening, someone at the fire tells a story to everyone there. */
async function fireside(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const present = world.order.filter((x) => world.agents[x]!.place === "tavern" && (world.agents[x]!.talkingUntil ?? 0) <= world.tick);
  if (present.length < 3) return;
  v.last.fireside = dayOf(world.tick);
  // The teller: whoever is most moved to talk, weighed by temperament and the charge of what they carry.
  type Cand = { who: AgentId; ep: Episode; score: number };
  const cands: Cand[] = [];
  for (const id of present) {
    const m = world.minds[id]!;
    for (const ep of m.episodes) {
      // Stories are about something: not village business, not other stories, not last night's hunger.
      if (/^(talk_|pc_|story_|ev_pledge|ev_hungry|ev_tent|ev_gale|ev_design)/.test(ep.id) || v.told.includes(`${id}:${ep.id}`)) continue;
      const charge = Math.abs(ep.valence) * (0.3 + ep.arousal) + (ep.details.length ? 0.1 : 0);
      if (charge < 0.2) continue;
      cands.push({ who: id, ep, score: charge * (0.3 + m.traits.extraversion) * (0.7 + 0.6 * nextRandom(world)) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best) return;
  const T = world.minds[best.who]!;
  v.told.push(`${best.who}:${best.ep.id}`);
  const recalled = await reconsolidate(T, best.ep, world.tick, faculties, true);
  const subject = best.ep.about.find((s) => s in world.minds && s !== best.who);
  const built = subject ? claimFromEpisode(world, best.who, best.ep, "everyone", subject) : undefined;
  const story = built?.text ?? thirdPerson(best.ep.gist, T.name, T.pronouns);
  const line = (await faculties.speak({
    self: identityOf(T),
    listener: { id: "everyone", name: "everyone at the fire" },
    heard: "",
    intent: { option: "Tell a story", description: "Tell the people around the fire about this, the way you remember it." },
    content: [{ id: best.ep.id, text: best.ep.gist }],
    style: { warmth: 0.6, curtness: 0.1, hedging: clamp(T.traits.neuroticism * 0.4), verbosity: clamp(0.4 + T.traits.extraversion * 0.4) },
    stance: ["It is evening at the fire circle and people are listening. Three or four sentences, told as a story."],
    salience: 0.6,
  })).utterance;
  const storyId = nextId(world, "story");
  const refs: { agent: AgentId; trace: string }[] = [];
  const lessons: string[] = [];
  for (const id of present) {
    if (id === best.who) continue;
    const m = world.minds[id]!;
    const claims: Claim[] = built ? [built.claim] : [];
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: m.tick,
      kind: "speech",
      rawText: `${T.name}, at the fire: "${line}"`,
      actor: best.who,
      addressedToSelf: false,
      about: subject ? [subject] : [],
      topics: [...best.ep.topics, "fire", "stories"],
      features: { outcomeForSelf: 0, agency: "other", intentional: 0.3, normViolation: 0, prospective: false, intensity: 0.3 + Math.abs(best.ep.valence) * 0.3 },
      claims,
      details: [],
      gist: `${T.name} told the fire about ${story.replace(/\.$/, "")}`,
      eventId: storyId,
    };
    const tr = await runPercept(m, p, faculties);
    // Remembered with a pointer to the teller's memory; children can take on the teller's dread with it.
    const learned = hearStory(world, best.who, best.ep, id, tr, isChild(world, id) ? 0.2 : 0);
    if (learned) lessons.push(`${m.name} now carries ${T.name}'s core belief: “${learned.text}”.`);
    record(world, sink, id, tr);
    refs.push({ agent: id, trace: tr.id });
    if (built?.claim.rumor) hop(world, built.claim.rumor, best.who, id, built.claim.proposition, false, tr.id);
  }
  feed(world, sink, {
    kind: "talk",
    place: "tavern",
    agents: present,
    title: `${T.name} tells a story at the fire`,
    lines: [{ speaker: best.who, text: line }],
    text: [present.length > 2 ? `Listening: ${list(present.filter((x) => x !== best.who).map((x) => personName(world, x)))}.` : "", ...lessons].filter(Boolean).join(" ") || undefined,
    refs: refs.slice(0, 12),
    rumor: built?.claim.rumor,
  });
  if (recalled) feedRecall(world, sink, best.who, recalled.version.changes.length);
}

function feedRecall(world: WorldState, sink: Sink, who: AgentId, changes: number): void {
  if (!changes) return;
  feed(world, sink, { kind: "memory", agents: [who], title: `Telling it changed how ${personName(world, who)} remembers it`, text: `${changes} detail${changes > 1 ? "s" : ""} shifted in the telling.` });
}

/**
 * People nearby catch some of what is said. A bystander who overhears gossip takes it in like any
 * other claim, at a little remove, and the rumor's lineage records the hop as overheard.
 */
export async function overhear(world: WorldState, a: AgentId, b: AgentId, place: PlaceId, claim: Claim, line: string, faculties: Faculties, sink: Sink): Promise<void> {
  const near = world.order.filter((x) => x !== a && x !== b && x !== claim.about && world.agents[x]!.place === place && (world.agents[x]!.talkingUntil ?? 0) <= world.tick);
  for (const id of near) {
    if (nextRandom(world) > 0.25) continue;
    const m = world.minds[id]!;
    // Nothing new to catch: they already carry this story.
    if (claim.rumor && m.beliefs.some((b) => b.rumor === claim.rumor)) continue;
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: m.tick,
      kind: "speech",
      rawText: `${personName(world, a)}, to ${personName(world, b)}: "${line}"`,
      actor: a,
      addressedToSelf: false,
      about: [claim.about],
      topics: claim.topics,
      features: { outcomeForSelf: 0, agency: "other", intentional: 0.2, normViolation: 0, prospective: false, intensity: 0.3 + Math.abs(claim.valence) * 0.3 },
      claims: [claim],
      details: [],
      gist: `I overheard ${personName(world, a)} telling ${personName(world, b)}: ${claim.proposition.replace(/\.$/, "")}`,
    };
    const tr = await runPercept(m, p, faculties);
    record(world, sink, id, tr);
    if (claim.rumor) {
      hop(world, claim.rumor, a, id, claim.proposition, false, tr.id);
      const h = world.rumors[claim.rumor]?.hops.at(-1);
      if (h) h.overheard = true;
    }
    feed(world, sink, { kind: "move", place, agents: [id, a, b], title: `${personName(world, id)} overhears ${personName(world, a)} and ${personName(world, b)}`, refs: [{ agent: id, trace: tr.id }], rumor: claim.rumor });
  }
}

// ---------------------------------------------------------------- outside input

export async function injectVillage(world: WorldState, ev: VillageEvent, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  if (ev.kind === "pledge") {
    if (isNight(world.tick)) return;
    return pledge(world, faculties, sink);
  }
  if (ev.kind === "blight") {
    v.blight = true;
    const evId = nextId(world, "ev_blight");
    world.events.push({ id: evId, tick: world.tick, kind: "blight", label: "the blight on the barley", topics: ["barley", "food", "harvest", evId] });
    feed(world, sink, { kind: "event", place: "fields", agents: [], title: "Blight in the barley", text: "Black rot along the rows. Most of this season's barley is lost." });
    for (const id of world.order) {
      const m = world.minds[id]!;
      const farmer = world.agents[id]!.role === "farmer";
      const tr = await runPercept(m, eventPercept(m, "world", "circumstance", farmer ? -0.6 : -0.25, farmer ? 0.75 : 0.45, ["barley", "food", "harvest", "winter", "store", evId], farmer ? "Blight took the barley I'd been working all season." : "Blight got into the barley; there'll be less food this winter.", "Black rot spreads along the barley rows.", evId), faculties);
      record(world, sink, id, tr);
    }
    return;
  }
  v.weather = "gale";
}

// ---------------------------------------------------------------- views

export interface VillageView {
  season: Season;
  day: number;
  dayOfSeason: number;
  seasonDays: number;
  weather: Weather;
  blight: boolean;
  stock: Record<Resource, number>;
  store: { food: number; put: number; taken: number };
  households: { id: string; name: string; members: AgentId[]; home: PlaceId; food: number; shelter: Household["shelter"]; rate: number }[];
  structures: { id: string; name: string; household: string; designer: AgentId; description: string; rationale: string; repairs: string[]; need: Record<Resource, number>; have: Record<Resource, number>; progress: number; done: boolean; trace: string; builders: AgentId[] }[];
  pledges: { tick: number; season: Season; proposer: AgentId; answers: Pledge[] }[];
  year: number;
  /** The living, then the most recent dead. */
  people: { id: AgentId; name: string; age: number; generation: number; parents: AgentId[]; partner?: AgentId; alive: boolean; died?: number; cause?: string; arrived?: number }[];
  norms: { text: string; sanctions: number; rounds: number; established?: number; strength: number }[];
  leader?: AgentId;
  elections: Election[];
  laws: Law[];
  /** The founding story as told each summer, latest last. */
  foundingDays: Civic["foundingDays"];
}

export function villageView(world: WorldState): VillageView | undefined {
  const v = world.village;
  if (!v) return undefined;
  const day = dayOf(world.tick);
  const sum = (k: StoreEntry["kind"]) => Number(v.store.log.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, v.store.folded?.[k] ?? 0).toFixed(1));
  return {
    season: v.season,
    day,
    dayOfSeason: ((day - 1) % v.seasonDays) + 1,
    seasonDays: v.seasonDays,
    weather: v.weather,
    blight: v.blight,
    stock: { timber: Math.floor(v.stock.timber), stone: Math.floor(v.stock.stone), reeds: Math.floor(v.stock.reeds) },
    store: { food: v.store.food, put: sum("put"), taken: sum("take") },
    households: Object.values(v.households).map((h) => ({ ...h, food: Number(h.food.toFixed(1)) })),
    structures: v.structures.map((s) => ({ id: s.id, name: s.name, household: s.household, designer: s.designer, description: describe(s.blueprint), rationale: s.rationale, repairs: s.repairs, need: s.need, have: s.have, progress: Number((s.work / s.hours).toFixed(2)), done: s.done, trace: s.trace, builders: s.builders })),
    pledges: v.pledges.slice(-6),
    year: yearOf(world),
    people: [
      ...world.order.map((id) => ({ id, alive: true })),
      ...Object.entries(v.life).filter(([, l]) => l.died !== undefined).sort((a, b) => b[1].died! - a[1].died!).slice(0, 40).map(([id]) => ({ id, alive: false })),
    ].map(({ id, alive }) => {
      const l = v.life[id]!;
      return { id, name: world.minds[id]!.name, age: Math.floor(ageOf(world, id)), generation: l.generation, parents: l.parents, partner: l.partner, alive, died: l.died, cause: l.cause, arrived: l.arrived };
    }),
    norms: v.norms.map((n) => ({ text: n.text, sanctions: n.sanctions, rounds: n.rounds.length, established: n.established, strength: Number(n.strength.toFixed(2)) })),
    leader: v.civic?.leader,
    elections: (v.civic?.elections ?? []).slice(-6),
    laws: (v.civic?.laws ?? []).map((l) => ({ ...l, compelled: l.compelled.slice(-20) })),
    foundingDays: (v.civic?.foundingDays ?? []).slice(-8),
  };
}

function logStore(v: VillageState, e: StoreEntry): void {
  v.store.log.push(e);
  if (v.store.log.length <= 500) return;
  const f = (v.store.folded ??= { put: 0, take: 0 });
  for (const old of v.store.log.splice(0, 100)) f[old.kind] = Number((f[old.kind] + old.amount).toFixed(1));
}

// ---------------------------------------------------------------- helpers

/** "Mara's", "the Coyles'". */
const possessive = (h: Household) => (h.name.startsWith("the ") ? `${h.name}'` : `${h.name}'s`);
const homeName = (h: Household) => `${possessive(h)} ${h.shelter === "house" ? "house" : h.members.length === 1 ? "tent" : "tents"}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export { CROSSING };
