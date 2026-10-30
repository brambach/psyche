// Generations. People in Hollow Bay age a year every four seasons, pair up, have children, grow old
// and die, and each spring a boat may bring newcomers. Nothing here writes anyone's personality.
//
// The part that matters for the analysis layer is how children come to carry fears they never
// lived through. A child hears stories at bedtime and at the fire. A story is remembered as heard,
// with a pointer to the teller's own memory, and if it is told with dread by someone whose core
// belief it feeds, the child can come away with that belief too: verbal threat information is one
// of the three pathways to fear (Rachman 1977; Field & Lawson 2003; Askew & Field 2008), and fear
// can be learned by watching a parent's fear (Mineka & Cook 1993). When those children grow up and
// tell the story to their own, the pointer chain runs back to the first-hand memory, so the atlas
// can say which grandparent's storm a fear came from.
//
// Norms (Bicchieri 2006) are here too: when holding back from the common store keeps being seen and
// sanctioned, an expectation takes hold, people come to believe in it, and it changes what holding
// back costs them.

import { clamp } from "../memory.js";
import { dayOf, identityOf, runPercept } from "../mind.js";
import type { Faculties, Percept } from "../ports.js";
import { gaussian, nextId, nextRandom } from "../rng.js";
import type { Trace } from "../trace.js";
import { TRAIT_NAMES, type AgentId, type Episode, type MindState, type Schema, type Tick } from "../types.js";
import { baseMind } from "./cast.js";
import { createSettlers, FIRST_NAMES, other, routineFor, uniqueId } from "./people.js";
import type { RoutineEntry } from "./places.js";
import { eventPercept, feed, personName, record, thirdPerson, type Sink, type WorldState } from "./world.js";
import type { Household, VillageState } from "./village.js";

export interface Life {
  /** Tick of birth; founders were born long before the story starts. */
  born: Tick;
  parents: AgentId[];
  /** 0 for the founders and newcomers, 1 for their children, and so on. */
  generation: number;
  partner?: AgentId;
  died?: Tick;
  cause?: string;
  arrived?: Tick;
}

export interface Norm {
  id: string;
  text: string;
  topic: string;
  /** Times someone was seen breaking it and it was held against them. */
  sanctions: number;
  /** Pledge rounds in which it was sanctioned. */
  rounds: number[];
  /** Witnessed violations, as the witness's memory of them (capped). */
  cases: { agent: AgentId; episode: string }[];
  established?: Tick;
  strength: number;
}

const DAY = 1440;
export const CHILDHOOD = 12;
const ADULT = 17;
const POP_CAP = 150;

const yearTicks = (v: VillageState) => v.seasonDays * 4 * DAY;
export const ageOf = (world: WorldState, id: AgentId): number => {
  const l = world.village!.life[id];
  return l ? ((l.died ?? world.tick) - l.born) / yearTicks(world.village!) : 30;
};
export const isChild = (world: WorldState, id: AgentId) => ageOf(world, id) < CHILDHOOD;
export const yearOf = (world: WorldState) => Math.floor((dayOf(world.tick) - 1) / (world.village!.seasonDays * 4)) + 1;

/** Ages from the identity line ("Theo Barra, 38, ..."), so the founders' births line up with who they are. */
export function initLife(world: WorldState): void {
  const v = world.village!;
  for (const id of world.order) {
    const age = Number(/, (\d+),/.exec(world.minds[id]!.identity.summary)?.[1] ?? 35);
    v.life[id] = { born: world.tick - age * yearTicks(v), parents: [], generation: 0 };
  }
}

// ---------------------------------------------------------------- the turn of a season

/** Deaths, pairings, births, coming of age, and in spring, newcomers. */
export async function lifeTurn(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  // Deaths: rising with age past fifty, and with hunger.
  for (const id of [...world.order]) {
    const age = ageOf(world, id);
    const m = world.minds[id]!;
    // Chances per year, taken a season at a time.
    const yearly = age < 3 ? 0.04 : age < 50 ? 0.008 : 0.015 + (age - 50) ** 2 * 0.0006;
    let p = yearly / 4;
    if (m.needs.energy < 0.15) p += 0.06;
    if (nextRandom(world) < p) await die(world, id, age >= 50 ? "old age" : m.needs.energy < 0.15 ? "hunger and cold" : "a fever", faculties, sink);
  }
  // Pairing: two unpartnered adults who like each other well enough.
  const single = world.order.filter((id) => !v.life[id]!.partner && ageOf(world, id) >= ADULT && ageOf(world, id) < 46);
  const paired = new Set<AgentId>();
  for (const a of single) {
    if (paired.has(a)) continue;
    const A = world.minds[a]!;
    const kin = new Set([...v.life[a]!.parents, ...world.order.filter((x) => v.life[x]!.parents.some((p) => v.life[a]!.parents.includes(p)) || v.life[x]!.parents.includes(a))]);
    const best = single
      .filter((b) => b !== a && !paired.has(b) && !kin.has(b) && !v.life[b]!.parents.includes(a))
      .map((b) => ({ b, mutual: ((A.others[b]?.liking ?? 0.5) + (world.minds[b]!.others[a]?.liking ?? 0.5)) / 2 }))
      .sort((x, y) => y.mutual - x.mutual)[0];
    if (best && best.mutual > 0.6 && nextRandom(world) < 0.45) {
      paired.add(a).add(best.b);
      await pair(world, a, best.b, faculties, sink);
    }
  }
  // Births: a couple with food enough and fewer than four children at home.
  for (const id of world.order) {
    const l = v.life[id]!;
    if (!l.partner || id > l.partner || !world.order.includes(l.partner)) continue;
    if (ageOf(world, id) > 44 || ageOf(world, l.partner) > 44) continue;
    const hh = householdOf(v, id);
    if (!hh) continue;
    const kids = hh.members.filter((m) => isChild(world, m)).length;
    if (kids >= 4 || hh.food < hh.members.length * 1.2 || world.order.length >= POP_CAP) continue;
    if (hh.members.some((m) => ageOf(world, m) < 1.5)) continue;
    if (nextRandom(world) < 0.15) await birth(world, [id, l.partner], faculties, sink);
  }
  // Coming of age.
  for (const id of world.order) {
    const a = world.agents[id]!;
    if (a.role === "child" && ageOf(world, id) >= CHILDHOOD) comeOfAge(world, id, sink);
  }
  if (v.season === "spring" && world.order.length < POP_CAP - 5) await newcomers(world, faculties, sink);
}

const householdOf = (v: VillageState, id: AgentId): Household | undefined => Object.values(v.households).find((h) => h.members.includes(id));

function moveHome(world: WorldState, id: AgentId, to: Household): void {
  const v = world.village!;
  const from = householdOf(v, id);
  if (from === to) return;
  const a = world.agents[id]!;
  const oldHome = a.home;
  if (from) {
    from.members = from.members.filter((m) => m !== id);
    if (from.members.length === 0) {
      // An empty household's unbuilt house goes back to the piles.
      const s = v.structures.find((x) => x.household === from.id && !x.done);
      if (s) {
        for (const k of ["timber", "stone", "reeds"] as const) v.stock[k] += s.have[k];
        v.structures = v.structures.filter((x) => x !== s);
      }
      to.food += from.food;
      delete v.households[from.id];
    }
  }
  to.members.push(id);
  a.home = to.home;
  a.routine = a.routine.map((e) => ({ ...e, place: e.place === oldHome ? to.home : e.place, evening: e.evening && { ...e.evening, place: e.evening.place === oldHome ? to.home : e.evening.place } }));
}

async function pair(world: WorldState, a: AgentId, b: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  v.life[a]!.partner = b;
  v.life[b]!.partner = a;
  const ha = householdOf(v, a)!;
  const hb = householdOf(v, b)!;
  // The one with less of a roof moves in with the other.
  const score = (h: Household) => (h.shelter === "house" ? 10 : 0) + h.members.length;
  const [mover, into] = score(ha) >= score(hb) ? [b, ha] : [a, hb];
  moveHome(world, mover, into);
  const refs: { agent: AgentId; trace: string }[] = [];
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const m = world.minds[x]!;
    const o = m.others[y]!;
    o.liking = clamp(o.liking + 0.15);
    o.bond = clamp(o.bond + 0.4);
    const tr = await runPercept(m, eventPercept(m, y, "other", 0.7, 0.75, ["love", "family", "home", y], `${personName(world, y)} and I made a life together.`, `${personName(world, x)} and ${personName(world, y)} set up home together.`, nextId(world, "ev_pair"), [y]), faculties);
    record(world, sink, x, tr);
    refs.push({ agent: x, trace: tr.id });
  }
  feed(world, sink, { kind: "event", agents: [a, b], title: `${personName(world, a)} and ${personName(world, b)} set up home together`, text: `${personName(world, mover)} moves in with ${personName(world, mover === a ? b : a)}.`, refs });
}

/** A new mind: temperament from both parents with its own variation, and nothing else yet but who they love. */
async function birth(world: WorldState, parents: AgentId[], faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const [p1, p2] = parents.map((p) => world.minds[p]!);
  const taken = new Set([...Object.keys(world.minds), ...Object.keys(v.households)]);
  // A name nobody living or remembered has had, while there are any left.
  const used = new Set(Object.values(world.minds).map((m) => m.name));
  const free = FIRST_NAMES.filter(([n]) => !used.has(n));
  const pool = free.length ? free : FIRST_NAMES;
  const [first, pronouns] = pool[Math.floor(nextRandom(world) * pool.length)]!;
  const id = uniqueId(first.toLowerCase(), taken);
  const hh = householdOf(v, parents[0]!)!;
  const surname = /^(\S+) (\S+)/.exec(p1!.identity.summary)?.[2]?.replace(/,$/, "") ?? hh.name.replace(/^the /, "");
  const rng = { rng: (world.rng ^ Math.imul(world.idCounter + 1, 2654435761)) >>> 0 };
  const traits = Object.fromEntries(TRAIT_NAMES.map((t) => [t, Number(clamp((p1!.traits[t] + p2!.traits[t]) / 2 + gaussian(rng) * 0.1, 0.05, 0.95).toFixed(2))])) as unknown as MindState["traits"];
  const year = yearOf(world);
  const mind = baseMind(
    {
      id,
      name: first,
      pronouns,
      identity: {
        summary: `${first} ${surname}, born in Hollow Bay in year ${year}, child of ${p1!.name} and ${p2!.name}. Has never known anywhere else.`,
        voice: "A child's way of talking: short, direct, full of questions. Grows plainer with age.",
      },
      traits,
      attachment: { anxiety: Number(((p1!.attachment.anxiety + p2!.attachment.anxiety) / 2).toFixed(2)), avoidance: Number(((p1!.attachment.avoidance + p2!.attachment.avoidance) / 2).toFixed(2)) },
      needs: { autonomy: 0.5, competence: 0.5, relatedness: 0.7, energy: 0.9 },
      goals: [
        { id: `g_${id}_grow`, text: "Grow up and be useful", tags: ["help", "work", "family"], priority: 0.6, progress: 0.05, invested: 0.05, rate: 0 },
        { id: `g_${id}_fed`, text: "Not go hungry", tags: ["food", "hunger", "winter", "store"], priority: 0.7, progress: 0.4, invested: 0.05, rate: 0 },
      ],
      self: { selfEsteem: 0.55, selfEfficacy: 0.45, control: 0.5, lifeStory: `I was born in Hollow Bay. My parents are ${p1!.name} and ${p2!.name}.` },
      others: { visitor: other("visitor", "the visitor", 0.5, 0.5, 0) },
      episodes: [],
      beliefs: [],
      habits: [],
      schemas: [],
      mood: 0.15,
      stress: 0.1,
    },
    rng.rng,
    p1!.ablations,
  );
  mind.tick = world.tick;
  mind.lastSleep = world.tick;
  // Children start out seeing people the way their parents do: grudges included.
  for (const o of world.order) {
    if (parents.includes(o)) {
      mind.others[o] = other(o, world.minds[o]!.name, 0.9, 0.92, 0.9, 0.7);
      continue;
    }
    const like = (x: number | undefined, y: number | undefined) => Number((((x ?? 0.5) + (y ?? 0.5)) / 2 * 0.7 + 0.15).toFixed(2));
    const ben = like(p1!.others[o]?.trust.benevolence, p2!.others[o]?.trust.benevolence);
    mind.others[o] = other(o, world.minds[o]!.name, ben, like(p1!.others[o]?.liking, p2!.others[o]?.liking), hh.members.includes(o) ? 0.6 : 0.05);
  }
  for (const o of world.order) world.minds[o]!.others[id] = other(id, first, 0.7, parents.includes(o) ? 0.95 : 0.6, parents.includes(o) ? 0.95 : hh.members.includes(o) ? 0.6 : 0.1, 0.3);
  world.minds[id] = mind;
  world.order.push(id);
  hh.members.push(id);
  world.agents[id] = { id, name: first, role: "child", place: hh.home, activity: "a newborn", home: hh.home, routine: childRoutine(hh.home), wants: [], lastTalk: {}, told: [] };
  v.life[id] = { born: world.tick, parents: [...parents], generation: Math.max(...parents.map((p) => v.life[p]!.generation)) + 1 };
  const refs: { agent: AgentId; trace: string }[] = [];
  for (const p of parents) {
    const m = world.minds[p]!;
    const tr = await runPercept(m, eventPercept(m, "world", "circumstance", 0.8, 0.85, ["family", "child", "birth", id], `Our child ${first} was born.`, `${first} is born to ${p1!.name} and ${p2!.name}.`, nextId(world, "ev_birth")), faculties);
    record(world, sink, p, tr);
    refs.push({ agent: p, trace: tr.id });
  }
  feed(world, sink, { kind: "event", place: hh.home, agents: [...parents, id], title: `${first} is born to ${p1!.name} and ${p2!.name}`, text: `Generation ${v.life[id]!.generation} of Hollow Bay. ${world.order.length} people in the village now.`, refs });
}

function childRoutine(home: string): RoutineEntry[] {
  return [
    { from: 7, place: home, activity: "waking up" },
    { from: 9, place: "harbour", activity: "playing on the landing" },
    { from: 12, place: "tavern", activity: "the midday meal at the fire circle" },
    { from: 13, place: "reeds", activity: "running about in the reedbed" },
    { from: 17, place: home, activity: "at home", evening: { place: "tavern", activity: "listening at the fire circle" } },
    { from: 20.5, place: home, activity: "being put to bed" },
  ];
}

/** At twelve a child takes up a trade: what the village is short of, weighed by what suits them. */
function comeOfAge(world: WorldState, id: AgentId, sink: Sink): void {
  const t = world.minds[id]!.traits;
  const count = (r: string) => world.order.filter((x) => world.agents[x]!.role === r).length;
  const food = world.order.filter((x) => ["fisher", "farmer", "forager"].includes(world.agents[x]!.role)).length;
  const workers = world.order.filter((x) => world.agents[x]!.role !== "child").length || 1;
  const fit: Record<string, number> = {
    fisher: 0.4 + t.neuroticism * -0.2 + t.openness * 0.3,
    farmer: 0.4 + t.conscientiousness * 0.4,
    forager: 0.3 + t.openness * 0.4,
    woodcutter: 0.3 + t.extraversion * 0.1 + t.conscientiousness * 0.2,
    quarrier: 0.3 + t.conscientiousness * 0.3 - t.extraversion * 0.1,
    builder: 0.3 + t.conscientiousness * 0.3 + t.openness * 0.2,
    thatcher: 0.3 + t.agreeableness * 0.2,
  };
  const need = (r: string) => (["fisher", "farmer", "forager"].includes(r) ? (food / workers < 0.45 ? 1.5 : 1) : 1) / (1 + count(r));
  const role = Object.keys(fit).sort((a, b) => fit[b]! * need(b) - fit[a]! * need(a))[0]!;
  const a = world.agents[id]!;
  a.role = role;
  a.routine = routineFor(role, a.home);
  world.minds[id]!.identity.voice = "Plain and direct, like the people who raised them.";
  feed(world, sink, { kind: "event", agents: [id], title: `${a.name} comes of age and takes up a trade`, text: `${a.name} ${{ fisher: "goes out with the boats", farmer: "works the barley", forager: "forages the pinewood", woodcutter: "fells timber", quarrier: "cuts stone", builder: "learns to build", thatcher: "cuts reeds" }[role]}.` });
}

export async function die(world: WorldState, id: AgentId, cause: string, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  const l = v.life[id]!;
  l.died = world.tick;
  l.cause = cause;
  world.order = world.order.filter((x) => x !== id);
  const hh = householdOf(v, id);
  if (hh) hh.members = hh.members.filter((m) => m !== id);
  if (hh && hh.members.length === 0) delete v.households[hh.id];
  if (l.partner) v.life[l.partner]!.partner = undefined;
  const a = world.agents[id]!;
  a.place = "graveyard";
  a.activity = "buried on the headland";
  for (const x of world.order) world.agents[x]!.wants = world.agents[x]!.wants.filter((w) => w.target !== id);
  const name = personName(world, id);
  const age = Math.floor(ageOf(world, id));
  const evId = nextId(world, "ev_death");
  world.events.push({ id: evId, tick: world.tick, kind: "death", label: `${name}'s death`, topics: ["death", "grief", id, evId] });
  const refs: { agent: AgentId; trace: string }[] = [];
  for (const x of world.order) {
    const m = world.minds[x]!;
    const o = m.others[id];
    const close = !!o && (o.bond > 0.5 || l.parents.includes(x) || v.life[x]!.parents.includes(id) || l.partner === x);
    if (!close && (o?.liking ?? 0.5) < 0.6) continue;
    const tr = await runPercept(m, eventPercept(m, "world", "circumstance", close ? -0.75 : -0.3, close ? 0.85 : 0.45, ["death", "grief", id, evId], `${name} died${cause === "old age" ? "" : ` of ${cause}`}.`, `${name} dies, ${age} years old.`, evId, [id]), faculties);
    record(world, sink, x, tr);
    if (close) refs.push({ agent: x, trace: tr.id });
  }
  feed(world, sink, { kind: "event", place: "cliffs", agents: [id, ...refs.map((r) => r.agent)], title: `${name} dies`, text: `${name} was ${age}. ${cause === "old age" ? "Old age." : `Taken by ${cause}.`} Buried on the headland.`, refs: refs.slice(0, 10) });
}

/** A boat in spring, with two to four strangers who have pasts of their own. */
async function newcomers(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  if (nextRandom(world) > 0.6) return;
  const n = 2 + Math.floor(nextRandom(world) * 3);
  const year = yearOf(world);
  const known = world.order.map((id) => ({ id, name: world.minds[id]!.name, role: world.agents[id]!.role }));
  const taken = new Set([...Object.keys(world.minds), ...Object.keys(v.households)]);
  const crossing = `ep_boat_y${year}`;
  const { settlers, households } = createSettlers(world.seed * 31 + year * 977, n, world.minds[world.order[0]!]!.ablations, known, { taken, names: new Set(Object.values(world.minds).map((m) => m.name)), crossing, now: world.tick });
  const placeCount = Object.keys(v.households).length + Object.keys(world.places).filter((p) => p.startsWith("home_")).length;
  households.forEach((h, i) => {
    const home = `home_${h.id}`;
    const hh: Household = { id: h.id, name: h.name, members: [...h.members], home, food: 4 * h.members.length, shelter: "tent", rate: 0 };
    v.households[h.id] = hh;
    const k = placeCount + i;
    const row = Math.floor(k / 5);
    world.places[home] = { id: home, name: `${h.name}' tents`, x: 32 + (k % 5) * 10 + (row % 2) * 5, y: 43 + (row % 3) * 8, social: false, outdoors: false, topics: ["home"] };
  });
  for (const s of settlers) {
    s.mind.tick = world.tick;
    s.mind.lastSleep = world.tick;
    world.minds[s.mind.id] = s.mind;
    world.order.push(s.mind.id);
    const home = `home_${s.household}`;
    world.agents[s.mind.id] = { id: s.mind.id, name: s.mind.name, role: s.role, place: "harbour", activity: "just off the boat", home, routine: routineFor(s.role, home), wants: s.wants, lastTalk: {}, told: [] };
    const age = Number(/, (\d+),/.exec(s.mind.identity.summary)?.[1] ?? 30);
    v.life[s.mind.id] = { born: world.tick - age * yearTicks(v), parents: [], generation: 0, arrived: world.tick };
  }
  for (const id of world.order) {
    const m = world.minds[id]!;
    for (const s of settlers) if (s.mind.id !== id) m.others[s.mind.id] ??= other(s.mind.id, s.mind.name, 0.45, 0.45, 0);
  }
  const names = settlers.map((s) => s.mind.name);
  feed(world, sink, { kind: "event", place: "harbour", agents: settlers.map((s) => s.mind.id), title: `A boat brings ${n} newcomers`, text: `${names.slice(0, -1).join(", ")} and ${names.at(-1)} come ashore at the landing, strangers to everyone.` });
  void faculties;
}

// ---------------------------------------------------------------- stories, and fears passed down

const charge = (e: Episode) => Math.abs(e.valence) * (0.3 + e.arousal) + (e.details.length ? 0.1 : 0);

/**
 * A child (or anyone) takes in a story told by someone else. The heard memory keeps a pointer to the
 * teller's, takes on some of its feeling, and for a child can install the teller's core belief.
 * Returns the schema it installed or strengthened, if any.
 */
export function hearStory(world: WorldState, teller: AgentId, told: Episode, listener: AgentId, trace: Trace, gain: number): Schema | undefined {
  const L = world.minds[listener]!;
  const T = world.minds[teller]!;
  const heard = trace.encoded ? L.episodes.find((e) => e.id === trace.encoded) : undefined;
  if (!heard) return undefined;
  // Remembered as what happened, in the teller's voice, with the source kept.
  heard.gist = thirdPerson(told.gist, T.name, T.pronouns);
  heard.source = { kind: "told", from: teller, ref: told.id };
  heard.topics = [...new Set([...told.topics, ...heard.topics.filter((t) => t === "stories")])];
  heard.about = [...new Set([...told.about.filter((x) => x !== listener), ...(told.source.kind === "told" ? [] : [teller])])];
  heard.valence = Number((told.valence * 0.7).toFixed(2));
  heard.valenceAtEncoding = heard.valence;
  heard.arousal = Math.max(heard.arousal, Number((told.arousal * 0.7).toFixed(2)));
  if (gain <= 0) return undefined;
  // The teller's dread (or faith) comes with it when the story feeds one of their core beliefs:
  // the memory that formed the belief, however faded, or any strongly felt story it bears on.
  // A dark story carries the wary beliefs, a hopeful one the trusting ones.
  // A formative memory keeps the tone it was laid down with, even when telling it has softened it.
  const feeds = T.schemas.filter((s) => {
    const formative = s.origin?.includes(told.id);
    if (!formative && (Math.abs(told.valence) < 0.3 || !s.triggers.some((t) => told.topics.includes(t)))) return false;
    return Math.sign(s.blameBias + s.threatBias) === -Math.sign(formative ? told.valenceAtEncoding : told.valence);
  });
  let out: Schema | undefined;
  for (const s of feeds) {
    const mine = L.schemas.find((x) => x.text === s.text);
    if (mine) {
      mine.strength = clamp(mine.strength + gain * 0.5 * s.strength);
      if (!mine.origin?.includes(heard.id)) (mine.origin ??= []).push(heard.id);
      if (mine.origin.length > 6) mine.origin.splice(1, mine.origin.length - 6);
    } else {
      L.schemas.push({ id: nextId(L, "sch"), text: s.text, triggers: [...s.triggers], blameBias: s.blameBias, threatBias: s.threatBias, strength: Number(clamp(0.1 + gain * s.strength).toFixed(2)), origin: [heard.id] });
      out = L.schemas.at(-1);
    }
  }
  return out;
}

/** Bedtime: in households with young children, someone at home tells them a story. */
export async function bedtime(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.village!;
  for (const hh of Object.values(v.households)) {
    const kids = hh.members.filter((m) => { const a = ageOf(world, m); return a >= 3 && a < CHILDHOOD && world.agents[m]!.place === hh.home; });
    const adults = hh.members.filter((m) => !isChild(world, m) && world.agents[m]!.place === hh.home);
    if (!kids.length || !adults.length || nextRandom(world) > 0.55) continue;
    // Whoever has the most charged story the children haven't heard from them.
    let best: { teller: AgentId; ep: Episode; score: number } | undefined;
    for (const t of adults) {
      const m = world.minds[t]!;
      for (const ep of m.episodes) {
        if (/^(talk_|pc_|ev_pledge|ev_hungry|ev_tent|ev_gale|ev_design|ev_birth|ev_pair)/.test(ep.id)) continue;
        if (kids.every((k) => v.told.includes(`${t}:${ep.id}>${k}`))) continue;
        const score = charge(ep) * (0.5 + m.traits.extraversion) + (m.schemas.some((s) => s.origin?.includes(ep.id)) ? 0.6 : 0);
        if (!best || score > best.score) best = { teller: t, ep, score };
      }
    }
    if (!best || best.score < 0.2) continue;
    const T = world.minds[best.teller]!;
    const story = thirdPerson(best.ep.gist, T.name, T.pronouns);
    const line = (await faculties.speak({
      self: identityOf(T),
      listener: { id: kids[0]!, name: kids.length > 1 ? "the children" : world.minds[kids[0]!]!.name },
      heard: "",
      intent: { option: "Tell a story", description: "Tell the children a bedtime story about this, the way you remember it." },
      content: [{ id: best.ep.id, text: best.ep.gist }],
      style: { warmth: 0.7, curtness: 0.1, hedging: clamp(T.traits.neuroticism * 0.4), verbosity: 0.5 },
      stance: ["It is bedtime and the children are listening. Two or three sentences, told simply."],
      salience: 0.45,
    })).utterance;
    const refs: { agent: AgentId; trace: string }[] = [];
    const learned: string[] = [];
    for (const k of kids) {
      v.told.push(`${best.teller}:${best.ep.id}>${k}`);
      const m = world.minds[k]!;
      const p: Percept = {
        id: nextId(m, "pc"),
        tick: m.tick,
        kind: "speech",
        rawText: `${T.name}, at bedtime: "${line}"`,
        actor: best.teller,
        addressedToSelf: false,
        about: best.ep.about.filter((x) => x !== k),
        topics: [...best.ep.topics, "stories"],
        features: { outcomeForSelf: 0, agency: "other", intentional: 0.3, normViolation: 0, prospective: false, intensity: 0.4 + Math.abs(best.ep.valence) * 0.4 },
        claims: [],
        details: [],
        gist: story,
      };
      const tr = await runPercept(m, p, faculties);
      const s = hearStory(world, best.teller, best.ep, k, tr, 0.35);
      record(world, sink, k, tr);
      refs.push({ agent: k, trace: tr.id });
      if (s) learned.push(`${m.name} now carries ${T.name}'s core belief: “${s.text}”.`);
    }
    feed(world, sink, {
      kind: learned.length ? "insight" : "talk",
      place: hh.home,
      agents: [best.teller, ...kids],
      title: `${T.name} tells ${kids.length > 1 ? "the children" : world.minds[kids[0]!]!.name} a bedtime story`,
      lines: [{ speaker: best.teller, text: line }],
      text: learned.join(" ") || undefined,
      refs,
    });
  }
}

/** Where a core belief came from, hop by hop through who told whom, back to a first-hand memory. */
export function schemaLineage(world: WorldState, agent: AgentId, schema: Schema): { agent: AgentId; episode: string; gist: string; firstHand: boolean }[] {
  const out: { agent: AgentId; episode: string; gist: string; firstHand: boolean }[] = [];
  let at: { agent: AgentId; id: string } | undefined = schema.origin?.[0] ? { agent, id: schema.origin[0] } : undefined;
  const seen = new Set<string>();
  while (at && !seen.has(`${at.agent}/${at.id}`)) {
    seen.add(`${at.agent}/${at.id}`);
    const ep = world.minds[at.agent]?.episodes.find((e) => e.id === at!.id);
    if (!ep) break;
    const told = ep.source.kind === "told" && ep.source.from && ep.source.ref;
    out.push({ agent: at.agent, episode: ep.id, gist: ep.gist, firstHand: !told });
    at = told ? { agent: ep.source.from!, id: ep.source.ref! } : undefined;
  }
  return out;
}

// ---------------------------------------------------------------- norms

export const STORE_NORM = "Everyone puts into the common store";

export function storeNorm(v: VillageState): Norm {
  let n = v.norms.find((x) => x.topic === "store");
  if (!n) {
    n = { id: "norm_store", text: STORE_NORM, topic: "store", sanctions: 0, rounds: [], cases: [], strength: 0 };
    v.norms.push(n);
  }
  return n;
}

/** Someone saw the store norm broken and held it against the breaker. */
export function sanction(world: WorldState, witness: AgentId, trace: Trace): void {
  const n = storeNorm(world.village!);
  n.sanctions++;
  const round = world.village!.pledges.length;
  if (!n.rounds.includes(round)) n.rounds.push(round);
  if (trace.encoded && n.cases.length < 60) n.cases.push({ agent: witness, episode: trace.encoded });
  if (n.established) n.strength = clamp(n.sanctions / 80);
}

/**
 * After a pledge round: once breaking the norm has been sanctioned across two rounds and often
 * enough, it takes hold, and each adult comes to believe in it as strongly as their temperament
 * and what they have seen allow.
 */
export function settleNorms(world: WorldState, sink: Sink): void {
  const v = world.village!;
  const n = storeNorm(v);
  if (!n.established && n.rounds.length >= 2 && n.sanctions >= 30) {
    n.established = world.tick;
    n.strength = clamp(n.sanctions / 80);
    feed(world, sink, { kind: "insight", agents: [], title: "A norm takes hold in Hollow Bay", text: `“${n.text}.” Holding back has been seen and held against people ${n.sanctions} times. From now on it costs more, and most people believe in it.` });
  }
  if (!n.established) return;
  for (const id of world.order) {
    if (isChild(world, id)) continue;
    const m = world.minds[id]!;
    const seen = n.cases.filter((c) => c.agent === id).map((c) => c.episode).filter((e) => m.episodes.some((x) => x.id === e));
    const confidence = Number(clamp(n.strength * (0.4 + 0.6 * m.traits.agreeableness) + seen.length * 0.03).toFixed(2));
    const b = m.beliefs.find((x) => x.about === "village" && x.proposition === n.text);
    if (b) {
      b.confidence = Math.max(b.confidence, confidence);
      b.evidence = [...new Set([...b.evidence, ...seen])].slice(-8);
    } else {
      m.beliefs.push({ id: nextId(m, "bel"), about: "village", topics: ["store", "fairness", "norm", "food"], proposition: n.text, confidence, valence: 0.3, source: { kind: "inferred" }, formed: world.tick, evidence: seen.slice(-8), retrievals: [world.tick] });
    }
  }
}

/** How strongly this person holds the store norm (0 if it has not taken hold). */
export function normHeld(world: WorldState, id: AgentId): number {
  const n = world.village!.norms.find((x) => x.topic === "store");
  if (!n?.established) return 0;
  return world.minds[id]!.beliefs.find((b) => b.about === "village" && b.proposition === n.text)?.confidence ?? 0;
}
