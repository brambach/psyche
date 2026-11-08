// Civic works: what a town builds together. Someone proposes a granary, a well, a hall, a jetty or a
// memorial because of what is on their mind (a fear of hunger, a grief, a love of the sea); the
// town votes, each person choosing through their own mind; the proposer designs it with the
// Architect; builders and volunteers raise it block by block from the town's piles; and once it
// stands it changes life there. Left unmended it decays, and in the end it is a ruin.
//
// The aggregate tier (towns nobody is watching) builds and mends on rules, a season at a time.

import { clamp } from "../memory.js";
import { identityOf, runPercept } from "../mind.js";
import type { ActionOption, Faculties, Percept } from "../ports.js";
import { nextId } from "../rng.js";
import type { AgentId, Tick } from "../types.js";
import { check, compile, describe, PACE, type Blueprint } from "../founders/blueprint.js";
import { ageOf, isChild, yearOf } from "./life.js";
import { eventPercept, feed, luck, personName, record, type Sink, type WorldState } from "./world.js";
import { intentOf, steer } from "./intentions.js";

export type WorkKind = "granary" | "well" | "hall" | "jetty" | "memorial";

export interface Work {
  id: string;
  kind: WorkKind;
  /** "the granary" */
  name: string;
  proposer: AgentId;
  proposed: Tick;
  /** What on the proposer's mind made them ask for it. */
  why: string;
  votes: { agent: AgentId; support: boolean; trace: string }[];
  status: "proposed" | "rejected" | "building" | "done" | "ruin";
  /** Which civic plot it stands on. */
  slot: number;
  blueprint?: Blueprint;
  rationale?: string;
  need: { timber: number; stone: number; reeds: number };
  have: { timber: number; stone: number; reeds: number };
  hours: number;
  work: number;
  builders: AgentId[];
  started?: Tick;
  finished?: Tick;
  /** 1 when new or mended; it wears down, and at 0 it is a ruin. */
  condition: number;
  /** Mending under way: hours of work and materials, a fraction of the first build. */
  mending?: { hours: number; work: number };
  mended: number;
  ruined?: Tick;
  /** The vote's trace, and the design's. */
  trace?: string;
}

export const WORKS: Record<WorkKind, { name: string; topics: string[]; want: string; size: number; does: string }> = {
  granary: { name: "the granary", topics: ["food", "store", "winter", "hunger", "harvest"], want: "A granary for the whole town: raised and dry, room for a winter's grain and fish, so what we put by doesn't rot.", size: 9, does: "Food keeps longer: households lose half as much to spoiling." },
  well: { name: "the well", topics: ["death", "grief", "fever", "health", "water", "family"], want: "A stone well-house over a deep well, so the town drinks clean water and fewer fall to fevers.", size: 7, does: "Fewer fevers: the young and middle-aged die less often." },
  hall: { name: "the hall", topics: ["help", "fairness", "family", "stories", "home", "trust", "law", "love"], want: "A meeting hall big enough for the whole town to sit together through a winter evening.", size: 11, does: "People keep each other company: nobody gets as lonely, and winter is less of a strain." },
  jetty: { name: "the jetty", topics: ["sea", "boat", "catch", "storm", "dock"], want: "A jetty and boat shed at the shore, so the boats go out further and come in safe.", size: 9, does: "Fishers bring in a quarter more." },
  memorial: { name: "the memorial", topics: ["death", "grief", "founding", "crossing", "leaving"], want: "A memorial stone and a small roofed shrine for those the town has lost and the crossing that brought us.", size: 7, does: "Grief is easier to carry: those who lost someone feel it less each day." },
};
export const WORK_KINDS = Object.keys(WORKS) as WorkKind[];

/** Civic plots on the town grid, near the fire circle and the store, away from the homes. */
export const CIVIC_SLOTS: { x0: number; z0: number }[] = [
  { x0: 60, z0: 30 },
  { x0: 94, z0: 20 },
  { x0: 120, z0: 54 },
  { x0: 62, z0: 52 },
  { x0: 138, z0: 38 },
  { x0: 100, z0: 58 },
  // By the landing, for a jetty's boat shed.
  { x0: 38, z0: 38 },
];
const SHORE = 6;

/** A free civic plot for a work: a jetty goes by the landing, everything else near the fire. */
function pickSlot(w: WorldState, kind: WorkKind): number {
  const used = new Set(works(w).filter((x) => x.status !== "rejected").map((x) => x.slot));
  if (kind === "jetty" && !used.has(SHORE)) return SHORE;
  const free = CIVIC_SLOTS.findIndex((_, i) => i !== SHORE && !used.has(i));
  return free >= 0 ? free : works(w).length % SHORE;
}

/** Plain designs for works a town built while nobody watched. */
const STOCK: Record<WorkKind, Blueprint> = {
  granary: { name: "A raised granary", width: 9, depth: 7, wallHeight: 3, walls: "plank", foundation: "cobble", corners: "log", floor: "plank", roof: { shape: "gable", material: "thatch", overhang: 1 }, door: "south", windows: [], furniture: ["chest"], porch: false },
  well: { name: "A well-house", width: 5, depth: 5, wallHeight: 3, walls: "cobble", foundation: "cobble", corners: "same", floor: "cobble", roof: { shape: "hip", material: "plank", overhang: 1 }, door: "south", windows: [], furniture: [], porch: false },
  hall: { name: "A long hall", width: 11, depth: 9, wallHeight: 4, walls: "log", foundation: "cobble", corners: "same", floor: "plank", roof: { shape: "gable", material: "thatch", overhang: 1 }, door: "south", windows: ["east", "west"], furniture: ["hearth", "table"], porch: true },
  jetty: { name: "A boat shed", width: 9, depth: 7, wallHeight: 3, walls: "plank", foundation: "plank", corners: "log", floor: "plank", roof: { shape: "flat", material: "plank", overhang: 0 }, door: "west", windows: ["north"], furniture: ["chest"], porch: true },
  memorial: { name: "A memorial shrine", width: 5, depth: 5, wallHeight: 3, walls: "cobble", foundation: "cobble", corners: "same", floor: "cobble", roof: { shape: "hip", material: "plank", overhang: 0 }, door: "south", windows: ["east", "west"], furniture: [], porch: false },
};

export const works = (w: WorldState): Work[] => w.village?.works ?? [];
/** A work that stands and does its job (a ruin does nothing). */
export const stands = (w: WorldState, kind: WorkKind): Work | undefined => works(w).find((x) => x.kind === kind && x.status === "done");
const active = (w: WorldState) => works(w).find((x) => x.status === "proposed" || x.status === "building");
/** What builders work on when no house is waiting: a work going up, or one being mended. */
export const civicSite = (w: WorldState): Work | undefined => works(w).find((x) => x.status === "building") ?? works(w).find((x) => x.status === "done" && x.mending);

const DAY = 1440;
/** A work is built to last (deep footings, dressed stone, joints pegged and checked), so each block takes far longer than a house's. */
const CARE = 8;
const yearDays = (w: WorldState) => w.village!.seasonDays * 4;
/** Unmended, a work falls to ruin in about three years. */
const WEAR = (w: WorldState) => 1 / (yearDays(w) * 3);
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * How much a work speaks to one person: their core beliefs, goals and charged memories on its topics,
 * and what the town has been through (hunger, deaths, a town of fishers).
 */
export function concernFor(w: WorldState, id: AgentId, kind: WorkKind): { score: number; why: string; motives: { name: string; value: number; ref?: string }[] } {
  const m = w.minds[id]!;
  const T = WORKS[kind].topics;
  const hits = (ts: string[]) => ts.some((t) => T.includes(t));
  let score = 0;
  let why = "";
  let best = 0;
  const motives: { name: string; value: number; ref?: string }[] = [];
  const note = (s: number, text: string, ref?: string) => {
    score += s;
    motives.push({ name: text, value: s, ref });
    if (s > best) {
      best = s;
      why = text;
    }
  };
  // A fear of loss moves someone to build against it; a core belief about others doesn't move them to build a place to sit together.
  if (kind !== "hall") for (const s of m.schemas) if (hits(s.triggers)) note(s.strength * (s.threatBias > 0 ? 1 : 0.6), `the core belief “${s.text}”`, s.id);
  for (const g of m.goals) if (hits(g.tags)) note(g.priority * 0.5, `the goal “${g.text}”`, g.id);
  const recent = m.episodes.filter((e) => w.tick - e.tick < yearDays(w) * DAY && Math.abs(e.valence) > 0.4 && hits(e.topics)).slice(-3);
  for (const e of recent) note(0.15, `the memory “${e.gist}”`, e.id);
  const v = w.village!;
  const year = yearDays(w) * DAY;
  const deaths = Object.values(v.life).filter((l) => l.died !== undefined && w.tick - l.died < year).length;
  if (kind === "granary" && v.store.food < w.order.length * 3) note(0.25, `a store of ${Math.round(v.store.food)} for ${w.order.length} people`);
  if ((kind === "well" || kind === "memorial") && deaths) note(0.12 * deaths, `${deaths} death${deaths === 1 ? "" : "s"} this past year`);
  if (kind === "jetty" && w.order.filter((x) => w.agents[x]!.role === "fisher").length >= 3) note(0.15, "a town that lives off the sea");
  if (kind === "hall" && w.order.length >= 18) note(0.15, `${w.order.length} people and nowhere to sit together`);
  return { score, why, motives };
}

/** Works nobody has built, is building, or turned down in the last year. */
export function openKinds(w: WorldState): WorkKind[] {
  const year = yearDays(w) * DAY;
  return WORK_KINDS.filter((k) => !works(w).some((x) => x.kind === k && (x.status === "done" || x.status === "building" || (x.status === "rejected" && w.tick - x.proposed < year))));
}

/** Who would stand up and ask for something, and for what. Open, outgoing people speak up. */
function proposal(w: WorldState): { who: AgentId; kind: WorkKind; why: string; score: number } | undefined {
  const v = w.village!;
  const open = openKinds(w);
  if (!open.length) return undefined;
  let best: { who: AgentId; kind: WorkKind; why: string; score: number } | undefined;
  for (const id of w.order) {
    if (ageOf(w, id) < 18) continue;
    const m = w.minds[id]!;
    const voice = 0.4 + 0.4 * m.traits.extraversion + 0.4 * m.traits.openness + (v.civic?.leader === id ? 0.2 : 0);
    for (const k of open) {
      const c = concernFor(w, id, k);
      const s = c.score * voice;
      if (!best || s > best.score) best = { who: id, kind: k, why: c.why, score: s };
    }
  }
  return best && best.score >= 0.35 ? best : undefined;
}

const VOTE: ActionOption[] = [
  { id: "support", label: "Back it", verb: "back it", description: "Say yes: the town builds it, with the town's timber and stone and its people's hours.", prosocial: 0.5, assertive: 0.1, avoidant: 0, disclosure: 0.2, coping: "problem", act: "backs it" },
  { id: "oppose", label: "Speak against it", verb: "speak against it", description: "Say no: the timber and the hours are better spent on our own houses and boats.", prosocial: -0.3, assertive: 0.4, avoidant: 0, disclosure: 0.1, comply: false, act: "speaks against it" },
];

/** Once a season: someone may ask the town for a work, and the town decides. */
export async function worksSeason(w: WorldState, faculties: Faculties, sink: Sink, ask?: { who: AgentId; kind: WorkKind; why: string }): Promise<Work | undefined> {
  const v = w.village!;
  if (active(w)) return undefined;
  const p = ask ?? proposal(w);
  if (!p) return undefined;
  const P = w.minds[p.who]!;
  const spec = WORKS[p.kind];
  const evId = nextId(w, "ev_work");
  w.events.push({ id: evId, tick: w.tick, kind: "work", label: `the vote on ${spec.name}`, topics: [...spec.topics, "build", evId] });
  const adults = w.order.filter((x) => !isChild(w, x));
  const work: Work = { id: nextId(w, "work"), kind: p.kind, name: spec.name, proposer: p.who, proposed: w.tick, why: p.why, votes: [], status: "proposed", slot: pickSlot(w, p.kind), need: { timber: 0, stone: 0, reeds: 0 }, have: { timber: 0, stone: 0, reeds: 0 }, hours: 0, work: 0, builders: [], condition: 1, mended: 0 };
  (v.works ??= []).push(work);
  for (const id of adults) {
    const m = w.minds[id]!;
    const own = id === p.who;
    const pc: Percept = {
      ...eventPercept(m, own ? "world" : p.who, own ? "circumstance" : "other", -0.05, 0.55, [...spec.topics, "build", evId], own ? `I asked the town to build ${spec.name}.` : `${P.name} asked the town to build ${spec.name}.`, `${P.name}, to the whole town: "We should build ${spec.name}." ${cap(spec.does)}`, evId),
      kind: own ? "event" : "speech",
      addressedToSelf: true,
      request: { what: `back building ${spec.name}`, topics: [...spec.topics, "build"] },
      options: steer(w, id, VOTE, { help: "support", keep: "oppose" }, 0.25),
    };
    pc.features.intentional = 0.6;
    pc.features.prospective = true;
    const tr = await runPercept(m, pc, faculties);
    record(w, sink, id, tr);
    work.votes.push({ agent: id, support: own || tr.action?.option !== "oppose", trace: tr.id });
  }
  const yes = work.votes.filter((x) => x.support);
  const no = work.votes.filter((x) => !x.support);
  const passed = yes.length > adults.length / 2;
  work.trace = work.votes.find((x) => x.agent === p.who)?.trace;
  feed(w, sink, {
    kind: "event",
    place: "tavern",
    agents: [p.who, ...no.map((x) => x.agent)].slice(0, 6),
    title: passed ? `${w.name} will build ${spec.name}` : `${w.name} turns down ${spec.name}`,
    text: `${P.name} asked for it, with ${p.why} on ${P.pronouns.possessive} mind. For: ${yes.length}. Against: ${no.length}${no.length ? ` (${list(no.slice(0, 5).map((x) => personName(w, x.agent)))}${no.length > 5 ? " and others" : ""})` : ""}.`,
    refs: work.votes.slice(0, 20).map((x) => ({ agent: x.agent, trace: x.trace })),
    chronicle: passed ? { kind: "work", why: [{ agent: p.who, text: `${P.name} asked for it, with ${p.why} on ${P.pronouns.possessive} mind.` }, { text: `${yes.length} for, ${no.length} against.` }] } : undefined,
  });
  if (!passed) {
    work.status = "rejected";
    return work;
  }
  await design(w, work, faculties);
  work.status = "building";
  work.started = w.tick;
  w.places.works ??= { id: "works", name: "the building site", x: 50, y: 22, social: true, outdoors: true, topics: ["build", "village"] };
  return work;
}

async function design(w: WorldState, work: Work, faculties: Faculties): Promise<void> {
  const v = w.village!;
  const spec = WORKS[work.kind];
  const m = w.minds[work.proposer]!;
  const supply = { logs: Math.round(v.stock.timber + 40), stone: Math.round(v.stock.stone + 30), reeds: Math.round(v.stock.reeds + 20) };
  const res = await faculties.architect({
    self: identityOf(m),
    want: `${spec.want} It is for the whole town of ${w.name}, not a home.`,
    site: {
      plot: { w: spec.size, d: spec.size },
      weatherFrom: "west",
      seaTo: "west",
      materials: [
        { name: "timber", available: supply.logs, note: "the pinewood; one log saws into 4 planks" },
        { name: "stone", available: supply.stone, note: "the quarry on the hill; one quarried stone is one block" },
        { name: "reeds", available: supply.reeds, note: "the reedbed; one bed makes 2 thatch" },
      ],
      hoursOfWorkLeft: 30,
      pace: "Builders and volunteers raise it with care, built to last: about 20 minutes a block, so a big hall is weeks of the town's spare hours.",
    },
    workspace: [],
    stance: [`You asked the town for this because of ${work.why}.`],
    temperament: { openness: m.traits.openness, conscientiousness: m.traits.conscientiousness, extraversion: m.traits.extraversion, neuroticism: m.traits.neuroticism },
    patternBook: works(w).filter((x) => x.blueprint).map((x) => ({ name: x.blueprint!.name, summary: describe(x.blueprint!) })),
  });
  const checked = check(res.blueprint, { x0: 0, z0: 0, w: spec.size + 2, d: spec.size + 2, y: 1 }, supply);
  const raw = checked.bill.raw;
  work.blueprint = checked.blueprint;
  work.rationale = res.rationale;
  work.need = { timber: raw.logs, stone: raw.stone, reeds: raw.reeds };
  work.hours = Number(((checked.bill.blocks * PACE.place * CARE) / 60).toFixed(1));
}

/**
 * An hour of building or mending at the civic site, by one person at `pace`. Draws from the town's
 * piles as the work needs them; returns the material it ran short of, if any.
 */
export function buildWork(w: WorldState, work: Work, who: AgentId, pace: number, sink: Sink): "timber" | "stone" | "reeds" | undefined {
  const v = w.village!;
  if (work.status !== "building" && !work.mending) return undefined;
  if (!work.builders.includes(who)) work.builders.push(who);
  const target = work.mending ? work.mending : work;
  const next = Math.min(target.hours, target.work + pace);
  const scale = work.mending ? 0.15 : 1;
  const frac = next / Math.max(0.1, target.hours);
  let short: "timber" | "stone" | "reeds" | undefined;
  if (!work.mending) {
    for (const k of ["timber", "stone", "reeds"] as const) {
      const want = work.need[k] * scale * frac - work.have[k];
      if (want <= 0) continue;
      const got = Math.min(want, v.stock[k]);
      v.stock[k] = Number((v.stock[k] - got).toFixed(2));
      work.have[k] = Number((work.have[k] + got).toFixed(2));
      if (got < want - 1e-6) short = k;
    }
  } else {
    const want = (work.need.timber * 0.15) / Math.max(1, target.hours) * pace;
    if (v.stock.timber < want) short = "timber";
    else v.stock.timber = Number((v.stock.timber - want).toFixed(2));
  }
  if (short) return short;
  target.work = next;
  if (target.work >= target.hours - 1e-6) (work.mending ? mended : finished)(w, work, sink);
  return undefined;
}

function finished(w: WorldState, work: Work, sink: Sink): void {
  work.status = "done";
  work.finished = w.tick;
  work.condition = 1;
  const spec = WORKS[work.kind];
  const who = work.builders.slice(0, 6).map((b) => personName(w, b));
  feed(w, sink, {
    kind: "event",
    place: "works",
    agents: [work.proposer, ...work.builders].slice(0, 8),
    title: `${cap(spec.name)} is finished`,
    text: `Raised by ${list(who)}${work.builders.length > 6 ? " and others" : ""} in ${Math.round((w.tick - (work.started ?? w.tick)) / DAY)} days. ${spec.does}`,
    chronicle: { kind: "work", why: [{ agent: work.proposer, text: `${personName(w, work.proposer)} had asked for it, with ${work.why} in mind.` }] },
  });
  const v = w.village!;
  for (const id of w.order) {
    const m = w.minds[id]!;
    const p = eventPercept(m, "world", "circumstance", 0.5, 0.55, [...spec.topics, "build", "village"], `We built ${spec.name} together.`, `${cap(spec.name)} stands finished.`, `ev_${work.id}_done`);
    v.pending.push({ id, p });
  }
}

function mended(w: WorldState, work: Work, sink: Sink): void {
  work.mending = undefined;
  work.condition = 1;
  work.mended++;
  feed(w, sink, { kind: "event", place: "works", agents: work.builders.slice(-3), title: `${cap(work.name)} is mended`, text: `${list(work.builders.slice(-3).map((b) => personName(w, b)))} put it right.` });
}

/**
 * Each morning: works wear, the worn get mended if anyone will, volunteers give an hour or two, and
 * what stands does its job.
 */
export function worksDay(w: WorldState, sink: Sink): void {
  const v = w.village;
  if (!v?.works?.length) return;
  for (const work of v.works) {
    if (work.status !== "done") continue;
    work.condition = clamp(work.condition - WEAR(w) * (v.weather === "gale" ? 2 : 1));
    if (work.condition < 0.55 && !work.mending) work.mending = { hours: Math.max(2, work.hours * 0.2), work: 0 };
    if (work.condition <= 0) {
      work.status = "ruin";
      work.ruined = w.tick;
      work.mending = undefined;
      feed(w, sink, {
        kind: "event",
        place: "works",
        agents: [work.proposer],
        title: `${cap(work.name)} falls to ruin`,
        text: `Built in year ${yearOf({ ...w, tick: work.finished ?? w.tick })}, mended ${work.mended} time${work.mended === 1 ? "" : "s"}, and left to the weather since.`,
        chronicle: { kind: "ruin", why: [{ text: `Nobody mended it once it began to fail.` }] },
      });
    }
  }
  // Volunteers: people who backed it give a couple of hours when they're kind and steady enough.
  const site = civicSite(w);
  if (site) {
    // Those who backed it, and anyone who means to give it their hours this season.
    const helpers = [...site.votes.filter((x) => x.support).map((x) => x.agent), ...w.order.filter((x) => intentOf(w, x)?.kind === "help")];
    for (const agent of [...new Set(helpers)]) {
      const b = { agent };
      const m = w.minds[b.agent];
      if (!m || !w.order.includes(b.agent) || isChild(w, b.agent)) continue;
      const roll = luck(w, "volunteer", b.agent, site.id);
      if (intentOf(w, b.agent)?.kind !== "help" && roll > 0.1 + 0.35 * (m.traits.agreeableness + m.traits.conscientiousness) / 2) continue;
      if (buildWork(w, site, b.agent, 2 * (0.5 + 0.5 * m.needs.energy), sink) || civicSite(w) !== site) break;
    }
  }
  // A hall keeps people company; a memorial eases grief.
  if (stands(w, "hall")) {
    for (const id of w.order) {
      const m = w.minds[id]!;
      m.needs.relatedness = clamp(m.needs.relatedness + 0.04);
      if (v.season === "winter") m.affect.stress = clamp(m.affect.stress - 0.02);
    }
  }
  if (stands(w, "memorial")) {
    for (const id of w.order) {
      const l = v.life[id];
      const bereaved = Object.entries(v.life).some(([o, x]) => x.died !== undefined && (l?.parents.includes(o) || x.parents.includes(id) || l?.partner === o));
      if (bereaved) w.minds[id]!.affect.emotions.distress = clamp(w.minds[id]!.affect.emotions.distress - 0.03);
    }
  }
}

/** The aggregate tier, a season at a time: wear, mending and new works on rules. */
export function aggWorks(w: WorldState, sink: Sink): void {
  const v = w.village!;
  v.works ??= [];
  const adults = w.order.filter((x) => !isChild(w, x));
  if (!adults.length) return;
  const mean = (f: (id: AgentId) => number) => adults.reduce((s, x) => s + f(x), 0) / adults.length;
  const care = mean((x) => w.minds[x]!.traits.conscientiousness);
  const kind = mean((x) => w.minds[x]!.traits.agreeableness);
  for (const work of v.works) {
    if (work.status === "building") {
      work.status = "done";
      work.finished = w.tick;
      work.condition = 1;
      continue;
    }
    if (work.status !== "done") continue;
    work.condition = clamp(work.condition - WEAR(w) * v.seasonDays);
    if (work.condition < 0.55 && luck(w, "mend", work.id) < 0.25 + 0.6 * care) {
      work.condition = 1;
      work.mended++;
      work.mending = undefined;
    } else if (work.condition <= 0) {
      work.status = "ruin";
      work.ruined = w.tick;
      feed(w, sink, { kind: "event", agents: [], title: `${cap(work.name)} falls to ruin`, text: "Nobody mended it once it began to fail.", chronicle: { kind: "ruin" } });
    }
  }
  if (active(w)) return;
  if (luck(w, "works") > 0.1 + 0.4 * kind) return;
  const p = proposal(w);
  if (!p) return;
  const slot = pickSlot(w, p.kind);
  const bp = STOCK[p.kind];
  v.works.push({ id: nextId(w, "work"), kind: p.kind, name: WORKS[p.kind].name, proposer: p.who, proposed: w.tick, why: p.why, votes: [], status: "done", slot, blueprint: bp, need: { timber: 0, stone: 0, reeds: 0 }, have: { timber: 0, stone: 0, reeds: 0 }, hours: 0, work: 0, builders: [], started: w.tick, finished: w.tick, condition: 1, mended: 0 });
  feed(w, sink, { kind: "event", agents: [p.who], title: `${w.name} builds ${WORKS[p.kind].name}`, text: `${personName(w, p.who)} asked for it, with ${p.why} on their mind.`, chronicle: { kind: "work", why: [{ agent: p.who, text: `${personName(w, p.who)} asked for it, with ${p.why} on their mind.` }] } });
}

/** How many blocks of a work show: all of a sound one, the roof going as it wears, a stump of a ruin. */
export function shownBlocks(work: Work, total: number): number {
  if (work.status === "building") return Math.min(total, Math.floor((total * work.work) / Math.max(0.1, work.hours)));
  if (work.status === "ruin") return Math.floor(total * 0.4);
  return Math.floor(total * (work.condition >= 0.7 ? 1 : 0.7 + 0.3 * (work.condition / 0.7)));
}

export { compile as compileWork };
