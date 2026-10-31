// The living island. A world is five minds plus where they are, what they want from each other,
// and the stories moving between them. Time advances in ten-minute steps. People follow their
// routines, bump into each other, and talk. Most steps need no language model at all: the engine
// decides who talks to whom and about what, and the Speak faculty only puts it into words.

import { baseLevel, clamp, reconsolidate, render, use } from "../memory.js";
import { dayOf, hourOf, identityOf, perceiveText, runPercept, wait } from "../mind.js";
import { PARAMS } from "../params.js";
import type { Claim, Faculties, Percept, SpeakRequest, StyleVector } from "../ports.js";
import { nextId, nextRandom } from "../rng.js";
import type { ReconsolidationTrace, Trace } from "../trace.js";
import type { Ablations, AgentId, Belief, Episode, MindState, Pronouns, Tick } from "../types.js";
import { CAST_ORDER, createCast, WORLD_START } from "./cast.js";
import { PLACES, type Place, type PlaceId, type RoutineEntry, type Want } from "./places.js";
import { injectVillage, overhear, villageStep, villageWorkplace, type VillageEvent, type VillageState } from "./village.js";

const STEP = 10;
/** Minutes before the same two people strike up another conversation. */
const TALK_COOLDOWN = 150;
/** In a village, a person who just talked is not up for another conversation for this long. */
const VILLAGE_TALK_REST = 50;

export interface AgentState {
  id: AgentId;
  name: string;
  role: string;
  place: PlaceId;
  activity: string;
  home: PlaceId;
  routine: RoutineEntry[];
  wants: Want[];
  /** A coping action or a gathering can pull someone away from their routine for a while. */
  override?: { place: PlaceId; activity: string; until: Tick };
  /** Tonight's choice between going out and staying in, made once per evening. */
  evening?: { day: number; out: boolean };
  lastTalk: Record<AgentId, Tick>;
  /** Stories already passed on, as `item>listener`. */
  told: string[];
  talkingUntil?: Tick;
}

export interface RumorHop {
  tick: Tick;
  from: AgentId;
  to: AgentId;
  text: string;
  /** How much the listener believed it, right after hearing it. */
  confidence: number;
  mutated: boolean;
  trace?: string;
  /** Caught by a bystander rather than told to them. */
  overheard?: boolean;
}

export interface Rumor {
  id: string;
  subject: AgentId;
  origin: AgentId;
  /** Third-person rendering with `{slot}` left open for the detail that drifts as it is retold. */
  template?: string;
  slotKey?: string;
  first: string;
  hops: RumorHop[];
}

export interface WorldEventRecord {
  id: string;
  tick: Tick;
  kind: string;
  label: string;
  topics: string[];
}

export interface WorldState {
  /** Shown in the feed and the header. */
  name: string;
  places: Record<PlaceId, Place>;
  seed: number;
  tick: Tick;
  rng: number;
  idCounter: number;
  order: AgentId[];
  minds: Record<AgentId, MindState>;
  agents: Record<AgentId, AgentState>;
  rumors: Record<string, Rumor>;
  events: WorldEventRecord[];
  /** Present when this world is a village with food, houses and a common store. */
  village?: VillageState;
}

export interface FeedLine {
  speaker: AgentId;
  text: string;
  trace?: string;
}

export interface FeedItem {
  id: string;
  tick: Tick;
  kind: "talk" | "event" | "move" | "night" | "morning" | "memory" | "insight";
  place?: PlaceId;
  agents: AgentId[];
  title: string;
  text?: string;
  lines?: FeedLine[];
  refs?: { agent: AgentId; trace: string }[];
  rumor?: string;
  /** Marks an item the region's chronicle should keep, with what led to it. */
  chronicle?: { kind: string; why?: Why[] };
}

/** One link in the explanation of an event: what led to it, with the person and memory behind it when known. */
export interface Why {
  text: string;
  agent?: AgentId;
  episode?: string;
  town?: string;
}

export interface WorldTrace {
  agent: AgentId;
  trace: Trace;
}

/** Everything a step produced: the feed and every mind's traces. */
export interface Sink {
  feed: FeedItem[];
  traces: WorldTrace[];
}

export type WorldEvent =
  | { kind: "storm" }
  | { kind: "catch"; who: AgentId }
  | { kind: "gathering" }
  | { kind: "rumor"; teller: AgentId; subject: AgentId; text: string; valence: number }
  | VillageEvent;

// ---------------------------------------------------------------- setup

export function createWorld(seed = 7, ablations: Partial<Ablations> = {}): WorldState {
  const cast = createCast(seed, ablations);
  const world: WorldState = {
    name: "Kettle Island",
    places: structuredClone(PLACES),
    seed,
    tick: WORLD_START,
    rng: (seed * 2246822519) >>> 0,
    idCounter: 0,
    order: [...CAST_ORDER],
    minds: {},
    agents: {},
    rumors: {},
    events: [],
  };
  for (const c of cast) {
    world.minds[c.mind.id] = c.mind;
    world.agents[c.mind.id] = {
      id: c.mind.id,
      name: c.mind.name,
      role: c.role,
      place: c.home,
      activity: "waking up",
      home: c.home,
      routine: c.routine,
      wants: c.wants,
      lastTalk: {},
      told: [],
    };
  }
  updatePositions(world, { feed: [], traces: [] });
  return world;
}

export const isNight = (t: Tick) => hourOf(t) >= 23 || hourOf(t) < 7;
const untilMorning = (t: Tick) => Math.round(((7 - hourOf(t) + 24) % 24) * 60) || 1440;

function name(world: WorldState, id: string): string {
  if (id === "visitor") return "the visitor";
  return world.agents[id]?.name ?? id;
}

function feed(world: WorldState, sink: Sink, item: Omit<FeedItem, "id" | "tick">): FeedItem {
  const f = { id: nextId(world, "f"), tick: world.tick, ...item };
  sink.feed.push(f);
  return f;
}

/** Rewrite a first-person memory as something another person can say: "Theo let me down" to "Theo let Mara down". */
export function thirdPerson(text: string, who: string, p: Pronouns): string {
  return text
    .replace(/\bI'd\b/g, `${who}'d`)
    .replace(/\bI'm\b/g, `${who} is`)
    .replace(/\bI've\b/g, `${who} has`)
    .replace(/\bI\b/g, who)
    .replace(/\bmyself\b/g, p.reflexive)
    .replace(/\b[Mm]y\b/g, `${who}'s`)
    .replace(/\bmine\b/g, `${who}'s`)
    .replace(/\bme\b/g, who)
    .replace(/\b(Dad|Mum|Mam|Da|Ma)\b/g, (_, k: string) => `${who}'s ${k.toLowerCase().startsWith("d") ? "father" : "mother"}`)
    .replace(/\b[Oo]ur\b/g, "their")
    .replace(/\bus\b/g, "them")
    .replace(/\b[Ww]e\b/g, "they");
}

// ---------------------------------------------------------------- time

/** Run the island forward. Night passes in one stride; the day in ten-minute steps. */
export async function advance(world: WorldState, minutes: number, faculties: Faculties, sink: Sink): Promise<void> {
  const end = world.tick + minutes;
  while (world.tick < end) {
    const before = world.tick;
    const night = isNight(before);
    const toBoundary = STEP - (before % STEP) || STEP;
    const dt = Math.min(end - before, night ? untilMorning(before) : toBoundary);
    world.tick += dt;
    const slept: WorldTrace[] = [];
    for (const id of world.order) {
      const mind = world.minds[id]!;
      for (const t of await wait(mind, world.tick - mind.tick, faculties)) slept.push({ agent: id, trace: t });
      if (!night) mind.needs.relatedness = clamp(mind.needs.relatedness - (dt / 60) * 0.012);
    }
    for (const s of slept) record(world, sink, s.agent, s.trace);
    if (!night && isNight(world.tick)) {
      feed(world, sink, { kind: "night", agents: [], title: `Night falls on ${world.name}`, text: "Everyone heads home to sleep. Tonight, sleep will replay the day and settle what it meant." });
    }
    if (slept.length > 0) morning(world, sink, slept);
    updatePositions(world, sink);
    if (world.village) await villageStep(world, dt, faculties, sink);
    if (isNight(world.tick)) continue;
    await encounters(world, faculties, sink);
  }
}

function morning(world: WorldState, sink: Sink, slept: WorldTrace[]): void {
  const lines: string[] = [];
  const refs: { agent: AgentId; trace: string }[] = [];
  for (const { agent, trace } of slept) {
    refs.push({ agent, trace: trace.id });
    for (const n of trace.notes) {
      const m = /^New belief from \d+ memories: "(.*)"\.$/.exec(n) ?? /^Core belief deepened: "(.*)"\.$/.exec(n);
      const subject = trace.notes.length && m ? world.minds[agent]!.beliefs.find((b) => b.proposition === m[1])?.about : undefined;
      if (m && subject && subject in world.minds) lines.push(`${name(world, agent)} woke up believing "${m[1]}".`);
    }
  }
  feed(world, sink, {
    kind: "morning",
    agents: slept.map((s) => s.agent),
    title: `Day ${dayOf(world.tick)} begins`,
    text: lines.length ? lines.join(" ") : "Sleep replayed yesterday's strongest memories and softened their sting.",
    refs,
  });
}

function scheduled(world: WorldState, a: AgentState): { place: PlaceId; activity: string } {
  const t = world.tick;
  if (isNight(t)) return { place: a.home, activity: "asleep" };
  if (a.override && a.override.until > t) return a.override;
  const h = hourOf(t);
  const entry = [...a.routine].reverse().find((e) => e.from <= h);
  if (!entry) return { place: a.home, activity: "at home" };
  if (entry.place === "@work") return world.village ? villageWorkplace(world, a, entry.activity) : { place: a.home, activity: entry.activity };
  if (entry.evening) {
    const day = dayOf(t);
    if (!a.evening || a.evening.day !== day) {
      const m = world.minds[a.id]!;
      // Going out: extraverts and the lonely go; stress and avoidance keep people in.
      const p = clamp(0.15 + 0.45 * m.traits.extraversion + 0.5 * (1 - m.needs.relatedness) - 0.3 * m.affect.stress - 0.2 * m.attachment.avoidance);
      a.evening = { day, out: nextRandom(world) < p };
    }
    if (a.evening.out) return entry.evening;
  }
  return { place: entry.place, activity: entry.activity };
}

function updatePositions(world: WorldState, _sink: Sink): void {
  for (const id of world.order) {
    const a = world.agents[id]!;
    if (a.override && a.override.until <= world.tick) a.override = undefined;
    const s = scheduled(world, a);
    a.place = s.place;
    a.activity = s.activity;
  }
}

function setOverride(world: WorldState, sink: Sink, id: AgentId, place: PlaceId, activity: string, minutes: number, trace?: Trace): void {
  const a = world.agents[id]!;
  const until = Math.min(world.tick + minutes, world.tick + untilMorning(world.tick) - 8 * 60);
  a.override = { place, activity, until };
  a.place = place;
  a.activity = activity;
  feed(world, sink, { kind: "move", place, agents: [id], title: `${a.name} is ${activity}`, refs: trace ? [{ agent: id, trace: trace.id }] : undefined });
}

/** What someone does after deciding how to cope shows up as where they go next. */
function applyCoping(world: WorldState, sink: Sink, id: AgentId, trace: Trace, victim?: AgentId): void {
  const a = world.agents[id]!;
  switch (trace.action?.option) {
    case "calm":
      return setOverride(world, sink, id, "cliffs", `walking ${world.places.cliffs!.name} to cool off`, 60, trace);
    case "seek":
      return setOverride(world, sink, id, "tavern", `looking for company at ${world.places.tavern!.name}`, 120, trace);
    case "withdraw":
      return setOverride(world, sink, id, a.home, "shut away at home", 240, trace);
    case "tackle":
      if (id === victim) return setOverride(world, sink, id, "harbour", "patching the boat", 180, trace);
      if (world.village) return;
      return;
    case "share": {
      const m = world.minds[id]!;
      const friend = world.order
        .filter((o) => o !== id && !isNight(world.tick) && world.places[world.agents[o]!.place]!.social)
        .sort((x, y) => (m.others[y]?.liking ?? 0) - (m.others[x]?.liking ?? 0))[0];
      if (friend) setOverride(world, sink, id, world.agents[friend]!.place, `looking for ${world.agents[friend]!.name} to share the news`, 60, trace);
      return;
    }
  }
}

function record(world: WorldState, sink: Sink, agent: AgentId, trace: Trace): void {
  sink.traces.push({ agent, trace });
  for (const r of trace.reconsolidations) {
    for (const c of r.version.changes) {
      const ep = world.minds[agent]!.episodes.find((e) => e.id === r.episodeId);
      feed(world, sink, {
        kind: "memory",
        agents: [agent],
        title: `${name(world, agent)}'s memory just changed`,
        text:
          `Remembering "${ep?.gist ?? r.episodeId}", "${c.from}" became "${c.to}"` +
          (c.cause === "misinformation" ? `, borrowed from something ${name(world, c.source.from ?? "someone")} said.` : `, filled in from mood and belief.`),
        refs: [{ agent, trace: trace.id }],
      });
    }
  }
}

// ---------------------------------------------------------------- encounters

async function encounters(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const busy = new Set<AgentId>();
  for (const place of Object.keys(world.places)) {
    if (!world.places[place]!.social) continue;
    const present = world.order.filter((id) => world.agents[id]!.place === place);
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i]!;
        const b = present[j]!;
        if (busy.has(a) || busy.has(b)) continue;
        if (world.village && ((world.agents[a]!.talkingUntil ?? 0) > world.tick || (world.agents[b]!.talkingUntil ?? 0) > world.tick)) continue;
        if (world.tick - (world.agents[a]!.lastTalk[b] ?? -1e9) < TALK_COOLDOWN) continue;
        const ma = world.minds[a]!;
        const mb = world.minds[b]!;
        const liking = ((ma.others[b]?.liking ?? 0.5) + (mb.others[a]?.liking ?? 0.5)) / 2;
        const lonely = 2 - (ma.needs.relatedness + mb.needs.relatedness) / 2;
        let p = 0.07 * (0.5 + (ma.traits.extraversion + mb.traits.extraversion) / 2) * (0.4 + liking * 1.2) * lonely;
        if (place === "tavern") p *= 1.4;
        if (place === "fishshed") p += 0.04;
        if (pendingWant(world, a, b) || pendingWant(world, b, a)) p += 0.06;
        if (nextRandom(world) >= p) continue;
        busy.add(a);
        busy.add(b);
        const aFirst = pendingWant(world, a, b) ? true : pendingWant(world, b, a) ? false : nextRandom(world) < ma.traits.extraversion / (ma.traits.extraversion + mb.traits.extraversion);
        await converse(world, aFirst ? a : b, aFirst ? b : a, place, faculties, sink);
      }
    }
  }
}

function pendingWant(world: WorldState, from: AgentId, to: AgentId): Want | undefined {
  return world.agents[from]!.wants.find((w) => w.target === to && (w.notBefore ?? -Infinity) <= world.tick);
}

interface Opener {
  kind: "request" | "offer" | "confide" | "gossip" | "ask" | "smalltalk";
  label: string;
  description: string;
  content: { id: string; text: string }[];
  topics: string[];
  about: AgentId[];
  want?: Want;
  claim?: Claim;
  told?: string;
  mutated?: boolean;
  event?: WorldEventRecord;
  summary: string;
  /** Telling a memory recalls it in full, which can rewrite it (shown on the teller's trace). */
  recalled?: ReconsolidationTrace;
}

async function tell(world: WorldState, teller: AgentId, ep: Episode, faculties: Faculties): Promise<ReconsolidationTrace | undefined> {
  const m = world.minds[teller]!;
  return reconsolidate(m, ep, world.tick, faculties, true);
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const partOfDay = (t: Tick) => (hourOf(t) < 12 ? "morning" : hourOf(t) < 17 ? "afternoon" : "evening");

/** The engine picks what the conversation is about from the initiator's state. */
async function chooseOpener(world: WorldState, a: AgentId, b: AgentId, place: PlaceId, faculties: Faculties): Promise<Opener> {
  const A = world.minds[a]!;
  const bName = name(world, b);
  const aName = A.name;
  const want = pendingWant(world, a, b);
  if (want && (want.kind !== "confide" || nextRandom(world) < 0.5 + 0.4 * A.traits.agreeableness - 0.3 * A.attachment.avoidance)) {
    if (want.kind === "request") {
      return { kind: "request", label: "Ask a favour", description: `Ask ${bName} to ${want.what}.`, content: [], topics: want.topics, about: [], want, summary: `${aName} asked ${bName} to ${want.what}` };
    }
    if (want.kind === "offer") {
      return { kind: "offer", label: "Offer help", description: `Offer to ${want.what}.`, content: [], topics: want.topics, about: [], want, summary: `${aName} offered to ${want.what}` };
    }
    const ep = A.episodes.find((e) => e.id === want.episode);
    if (ep) {
      const recalled = await tell(world, a, ep, faculties);
      const built = claimFromEpisode(world, a, ep, b, a);
      return {
        kind: "confide",
        label: "Clear the air",
        description: `Explain to ${bName} ${want.what.replace(/\bhe\b/, "you").replace(/\bhis\b/, "your")}. Be honest about it.`,
        content: [{ id: ep.id, text: render(ep) }],
        topics: ep.topics,
        about: [a],
        want,
        claim: { ...built.claim, valence: 0.2 },
        recalled,
        summary: `${aName} tried to explain to ${bName} about ${ep.gist.replace(/\.$/, "").replace(/^I /, "how he ")}`,
      };
    }
  }

  // Gossip, the island's way of trading reputation (Dunbar 2004): the most charged story about
  // someone else that this listener hasn't heard from us.
  const ag = world.agents[a]!;
  type Cand = { score: number; key: string; ep?: Episode; bel?: Belief; subject: AgentId };
  const cands: Cand[] = [];
  const valid = (s: string) => s in world.minds && s !== a && s !== b;
  for (const ep of A.episodes) {
    if (ep.id.startsWith("talk_") || ep.agency === "self") continue;
    const subject = ep.about.find(valid);
    if (!subject) continue;
    const charge = Math.abs(ep.valence) * (0.3 + ep.arousal);
    if (charge < 0.15 || ag.told.includes(`rum_${a}_${ep.id}>${b}`)) continue;
    const recency = logistic(baseLevel(ep.retrievals, world.tick, PARAMS.memory.gistDecay));
    cands.push({ score: charge * (0.5 + 0.5 * recency), key: ep.id, ep, subject });
  }
  for (const bel of A.beliefs) {
    if (!valid(bel.about) || Math.abs(bel.valence) < 0.2 || bel.confidence < 0.4) continue;
    if (bel.source.from === b || ag.told.includes(`${bel.rumor ?? `rum_${a}_${bel.id}`}>${b}`)) continue;
    const recency = logistic(baseLevel(bel.retrievals, world.tick, PARAMS.memory.gistDecay));
    cands.push({ score: Math.abs(bel.valence) * bel.confidence * (0.5 + 0.5 * recency) * (bel.rumor ? 1.3 : 1), key: bel.rumor ?? bel.id, bel, subject: bel.about });
  }
  cands.sort((x, y) => y.score - x.score);
  const best = cands[0];
  if (best) {
    const p = clamp(best.score * 1.5) * (0.4 + 0.8 * A.traits.extraversion) * (0.6 + 0.8 * (A.others[b]?.liking ?? 0.5));
    if (nextRandom(world) < p) {
      const recalled = best.ep ? await tell(world, a, best.ep, faculties) : undefined;
      const built = best.ep ? claimFromEpisode(world, a, best.ep, b, best.subject) : await claimFromBelief(world, a, best.bel!, faculties);
      return {
        kind: "gossip",
        label: "Share gossip",
        description: `Tell ${bName} what you know about ${name(world, best.subject)}.`,
        content: [{ id: best.ep?.id ?? best.bel!.id, text: built.text }],
        topics: [...new Set([...built.claim.topics])],
        about: [best.subject],
        claim: built.claim,
        told: `${built.claim.rumor}>${b}`,
        mutated: built.mutated,
        recalled,
        summary: `${aName} told ${bName} something about ${name(world, best.subject)}`,
      };
    }
  }

  // A shared event worth asking about.
  const recent = [...world.events].reverse().find((e) => world.tick - e.tick < 36 * 60 && !ag.told.includes(`ask:${e.id}>${b}`) && world.minds[b]!.episodes.some((x) => x.id === e.id));
  if (recent && nextRandom(world) < 0.6) {
    return {
      kind: "ask",
      label: "Ask about",
      description: `Ask ${bName} how they got on in ${recent.label}.`,
      content: [],
      topics: recent.topics,
      about: [],
      event: recent,
      told: `ask:${recent.id}>${b}`,
      summary: `${aName} asked ${bName} about ${recent.label}`,
    };
  }
  return {
    kind: "smalltalk",
    label: "Small talk",
    description: `Pass the time of day with ${bName} at ${world.places[place]!.name} this ${partOfDay(world.tick)}.`,
    content: [],
    topics: world.places[place]!.topics,
    about: [],
    summary: `${aName} and ${bName} passed the time at ${world.places[place]!.name}`,
  };
}

function rumorText(r: Rumor | undefined, value: string | undefined, fallback: string): string {
  if (r?.template && r.slotKey && value) return r.template.replace(`{${r.slotKey}}`, value);
  return fallback;
}

/** Turn one of the teller's memories into a story someone else can carry: a claim with a lineage. */
function claimFromEpisode(world: WorldState, teller: AgentId, ep: Episode, _listener: AgentId, subject: AgentId): { claim: Claim; text: string; mutated: boolean } {
  const T = world.minds[teller]!;
  const id = `rum_${teller}_${ep.id}`;
  const slot = ep.template ? [...ep.details].sort((x, y) => y.salience - x.salience)[0] : undefined;
  const value = slot ? thirdPerson(slot.value, T.name, T.pronouns) : undefined;
  if (!world.rumors[id]) {
    let template: string | undefined;
    if (slot) {
      const filled = ep.template.replace(/\{(\w+)\}/g, (_, k: string) => (k === slot.key ? `{${k}}` : (ep.details.find((d) => d.key === k)?.value ?? "...")));
      template = thirdPerson(filled, T.name, T.pronouns);
    }
    world.rumors[id] = { id, subject, origin: teller, template, slotKey: slot?.key, first: "", hops: [] };
    world.rumors[id]!.first = rumorText(world.rumors[id], value, thirdPerson(ep.gist, T.name, T.pronouns));
  }
  const text = rumorText(world.rumors[id], value, thirdPerson(ep.gist, T.name, T.pronouns));
  return {
    claim: {
      about: subject,
      topics: ep.topics,
      proposition: text,
      valence: ep.valence,
      slotKey: slot?.key,
      value,
      episodeHint: slot ? ep.id : undefined,
      rumor: id,
    },
    text,
    mutated: false,
  };
}

/**
 * Retell a belief. If it has faded, the teller rebuilds it from mood and attitude toward its
 * subject, and the story drifts: sharpened by those who dislike the subject, levelled by those
 * who like them (Allport & Postman 1947; Bartlett 1932).
 */
async function claimFromBelief(world: WorldState, teller: AgentId, bel: Belief, faculties: Faculties): Promise<{ claim: Claim; text: string; mutated: boolean }> {
  const T = world.minds[teller]!;
  const id = bel.rumor ?? `rum_${teller}_${bel.id}`;
  if (!bel.rumor) bel.rumor = id;
  // One's own conclusions are passed on in the third person: "Mara hasn't forgiven me" becomes "...forgiven Theo".
  if (bel.source.kind !== "told") bel.proposition = thirdPerson(bel.proposition, T.name, T.pronouns);
  if (!world.rumors[id]) world.rumors[id] = { id, subject: bel.about, origin: teller, first: bel.proposition, hops: [] };
  const r = world.rumors[id]!;
  let value = bel.claim?.value;
  let mutated = false;
  const faded = baseLevel(bel.retrievals, world.tick, PARAMS.memory.detailDecay) < PARAMS.social.retellFade;
  if (bel.source.kind === "told" && faded && T.ablations.reconsolidation) {
    const attitude = (T.others[bel.about]?.liking ?? 0.5) - 0.5;
    const faint = value ?? bel.proposition;
    const res = await faculties.reconstruct({
      gist: bel.proposition,
      slotKey: bel.claim?.slotKey ?? "story",
      fadedValue: faint,
      mood: T.affect.mood.valence + PARAMS.social.retellAttitude * attitude,
      beliefs: T.beliefs.filter((x) => x.about === bel.about && x.id !== bel.id).map((x) => ({ id: x.id, text: x.proposition })),
      schemas: [],
    });
    const next = res.value.trim();
    if (next && next !== faint) {
      mutated = true;
      if (bel.claim && value !== undefined) {
        bel.claim.value = next;
        value = next;
        bel.proposition = rumorText(r, value, bel.proposition);
      } else bel.proposition = next;
    }
  }
  use(bel.retrievals, world.tick);
  const text = rumorText(r, value, bel.proposition);
  return {
    claim: {
      about: bel.about,
      topics: bel.topics,
      proposition: text,
      valence: bel.valence,
      slotKey: bel.claim?.slotKey,
      value,
      episodeHint: bel.claim?.episodeHint,
      rumor: id,
    },
    text,
    mutated,
  };
}

function openerStyle(A: MindState, b: AgentId): StyleVector {
  const liking = A.others[b]?.liking ?? 0.5;
  const af = A.affect;
  return {
    warmth: clamp(0.5 * A.traits.agreeableness + 0.3 * af.mood.valence + 0.3 * (liking - 0.5) - 0.4 * af.emotions.anger),
    curtness: clamp(af.emotions.anger * 0.7 + af.stress * 0.3 + (1 - A.traits.agreeableness) * 0.2),
    hedging: clamp(A.traits.neuroticism * 0.5),
    verbosity: clamp(A.traits.extraversion * 0.6 + 0.2),
  };
}

const REPLY_OUTCOME: Record<string, [number, number]> = {
  grant: [0.6, 0],
  refuse_flat: [-0.45, 0.15],
  refuse_explain: [-0.2, 0],
  put_off: [-0.15, 0],
  tell_fully: [0.25, 0],
  tell_briefly: [0.1, 0],
  deflect: [-0.2, 0],
  warm: [0.3, 0],
  polite: [0, 0],
  cold: [-0.35, 0.1],
};

function replyGist(world: WorldState, b: AgentId, option: string | undefined, o: Opener, place: PlaceId): string {
  const B = name(world, b);
  const at = ` at ${world.places[place]!.name}`;
  switch (option) {
    case "grant":
      return o.kind === "offer" ? `${B} let me ${o.want!.what}` : `${B} agreed when I asked to ${o.want!.what.replace(/\bme\b/g, "me").replace(/\byour\b/g, "their")}`;
    case "refuse_flat":
    case "refuse_explain":
      return o.kind === "offer" ? `${B} wouldn't let me ${o.want!.what}` : `${B} turned me down when I asked to ${o.want!.what.replace(/\byour\b/g, "their")}`;
    case "put_off":
      return `${B} put me off when I asked to ${o.want!.what.replace(/\byour\b/g, "their")}`;
    case "tell_fully":
    case "tell_briefly":
      return `${B} told me about ${o.event?.label ?? "it"}${at}`;
    case "deflect":
      return `${B} dodged my question${at}`;
    case "warm":
      return `${B} was warm with me${at}`;
    case "cold":
      return `${B} brushed me off${at}`;
    default:
      return `${B} chatted with me${at}`;
  }
}

/** How much an opening line matters, by kind: small talk can come from templates. */
const OPENER_SALIENCE: Record<string, number> = { smalltalk: 0.2, ask: 0.4, request: 0.5, offer: 0.5, gossip: 0.7, confide: 0.8 };

async function converse(world: WorldState, a: AgentId, b: AgentId, place: PlaceId, faculties: Faculties, sink: Sink): Promise<void> {
  const A = world.minds[a]!;
  const B = world.minds[b]!;
  const o = await chooseOpener(world, a, b, place, faculties);
  const talkId = nextId(world, "talk");

  const opening: SpeakRequest = {
    self: identityOf(A),
    listener: { id: b, name: B.name },
    heard: "",
    intent: { option: o.label, description: o.description },
    content: o.content,
    style: openerStyle(A, b),
    stance: [`You are starting a conversation with ${B.name} at ${world.places[place]!.name}. Keep it to one or two lines.`],
    salience: OPENER_SALIENCE[o.kind] ?? 0.4,
  };
  const aLine = (await faculties.speak(opening)).utterance;

  // The listener hears it. The engine already knows what was said, so no Perceive call is needed.
  const gossip = o.kind === "gossip";
  const pB: Percept = {
    id: nextId(B, "pc"),
    tick: world.tick,
    kind: "speech",
    rawText: `${A.name}: "${aLine}"`,
    actor: a,
    addressedToSelf: true,
    about: o.about,
    topics: o.topics,
    features: {
      outcomeForSelf: o.kind === "offer" ? 0.2 : o.kind === "smalltalk" ? 0.1 : o.kind === "confide" ? 0.1 : 0,
      agency: "other",
      intentional: o.kind === "offer" ? 0.8 : 0.5,
      normViolation: 0,
      prospective: o.kind === "request" || o.kind === "offer",
      intensity: o.kind === "confide" ? 0.6 : gossip ? 0.3 + 0.4 * Math.abs(o.claim!.valence) : o.kind === "request" || o.kind === "offer" ? 0.55 : 0.3,
    },
    request: o.want && (o.kind === "request" || o.kind === "offer") ? { what: o.want.what, topics: o.want.topics } : undefined,
    asksRecall: o.kind === "ask" ? { about: [], topics: o.topics } : undefined,
    claims: o.claim ? [o.claim] : [],
    details: [],
    alreadySaid: [...said(world, b, a), ...o.content.map((c) => c.id)],
    gist:
      o.kind === "gossip" || o.kind === "confide"
        ? `${A.name} told me: ${o.claim!.proposition.replace(/\.$/, "")}`
        : o.kind === "request"
          ? `${A.name} asked me to ${o.want!.what.replace(/\bme\b/g, A.pronouns.object).replace(/\bmy\b/g, A.pronouns.possessive)}`
          : o.kind === "offer"
            ? `${A.name} offered to ${o.want!.what.replace(/\byour\b/g, "my").replace(/\byou\b/g, "me")}`
            : o.kind === "ask"
              ? `${A.name} asked me about ${o.event!.label}`
              : `${A.name} passed the time with me at ${world.places[place]!.name}`,
    eventId: talkId,
  };
  const tB = await runPercept(B, pB, faculties);
  record(world, sink, b, tB);
  const bLine = tB.action?.kind === "speech" ? tB.action.text : "...";
  const option = tB.action?.option;

  // What the reply passed on: memories the listener told, if they are about someone.
  const replyClaims: Claim[] = [];
  const replyRumors: string[] = [];
  for (const id of tB.action?.content ?? []) {
    const ep = B.episodes.find((e) => e.id === id);
    const subject = ep?.about.find((s) => s in world.minds && s !== b && s !== a) ?? ep?.about.find((s) => s in world.minds && s !== b);
    if (!ep || !subject || ep.id.startsWith("talk_")) continue;
    const built = claimFromEpisode(world, b, ep, a, subject);
    replyClaims.push(built.claim);
    replyRumors.push(built.claim.rumor!);
    world.agents[b]!.told.push(`${built.claim.rumor}>${a}`);
  }

  const [outcome, normViolation] = REPLY_OUTCOME[option ?? "polite"] ?? [0, 0];
  const pA: Percept = {
    id: nextId(A, "pc"),
    tick: world.tick,
    kind: "speech",
    rawText: `${B.name}: "${bLine}"`,
    actor: b,
    addressedToSelf: true,
    about: [...new Set([b, ...replyClaims.map((c) => c.about)])].filter((x) => x !== a),
    topics: o.topics,
    features: { outcomeForSelf: outcome, agency: "other", intentional: 0.7, normViolation, prospective: false, intensity: 0.3 + Math.abs(outcome) * 0.6 },
    claims: replyClaims,
    details: [],
    gist: replyGist(world, b, option, o, place),
    eventId: talkId,
    alreadySaid: [...said(world, a, b), ...o.content.map((c) => c.id), ...(tB.action?.content ?? [])],
  };
  const tA = await runPercept(A, pA, faculties);
  if (o.recalled) tA.reconsolidations.unshift(o.recalled);
  record(world, sink, a, tA);
  const aLine2 = tA.action?.kind === "speech" ? tA.action.text : undefined;

  // Consequences.
  const ag = world.agents[a]!;
  const bg = world.agents[b]!;
  ag.lastTalk[b] = bg.lastTalk[a] = world.tick;
  ag.talkingUntil = bg.talkingUntil = world.tick + (world.village ? VILLAGE_TALK_REST : 20);
  A.needs.relatedness = clamp(A.needs.relatedness + 0.03);
  B.needs.relatedness = clamp(B.needs.relatedness + 0.03);
  if (o.told) ag.told.push(o.told);
  let title = o.summary;
  if (o.want) {
    const w = o.want;
    if (o.kind === "confide") {
      ag.wants = ag.wants.filter((x) => x !== w);
    } else if (option === "grant") {
      ag.wants = ag.wants.filter((x) => x !== w);
      const g = A.goals.find((x) => x.id === w.goal);
      if (g) g.progress = clamp(g.progress + 0.2);
      title = o.kind === "offer" ? `${B.name} accepted ${A.name}'s help` : `${B.name} said yes to ${A.name}`;
    } else {
      w.notBefore = world.tick + (option === "put_off" ? 1 : 2) * 1440;
      title = o.kind === "offer" ? `${B.name} turned down ${A.name}'s help` : option === "put_off" ? `${B.name} put ${A.name} off` : `${B.name} turned ${A.name} down`;
    }
  }
  if (gossip) title = `${A.name} passed on a story about ${name(world, o.about[0]!)}`;

  const lines: FeedLine[] = [
    { speaker: a, text: aLine },
    { speaker: b, text: bLine, trace: tB.id },
  ];
  if (aLine2) lines.push({ speaker: a, text: aLine2, trace: tA.id });
  feed(world, sink, {
    kind: "talk",
    place,
    agents: [a, b],
    title,
    lines,
    refs: [
      { agent: b, trace: tB.id },
      { agent: a, trace: tA.id },
    ],
    rumor: o.claim?.rumor,
  });

  if (o.claim?.rumor) hop(world, o.claim.rumor, a, b, o.claim.proposition, !!o.mutated, tB.id);
  if (world.village && o.claim && (o.kind === "gossip" || o.kind === "confide")) await overhear(world, a, b, place, o.claim, aLine, faculties, sink);
  for (let i = 0; i < replyClaims.length; i++) hop(world, replyRumors[i]!, b, a, replyClaims[i]!.proposition, false, tA.id);

  // Help accepted becomes help given.
  if (o.kind === "offer" && option === "grant" && o.want) {
    const done = o.want.what.replace(/\byour\b/g, "my").replace(/^help you /, "helped me ");
    const pHelp: Percept = {
      id: nextId(B, "pc"),
      tick: world.tick,
      kind: "event",
      rawText: `${A.name} spends the afternoon helping ${B.name}.`,
      actor: a,
      addressedToSelf: false,
      about: [a],
      topics: o.want.topics,
      features: { outcomeForSelf: 0.55, agency: "other", intentional: 0.9, normViolation: 0, prospective: false, intensity: 0.55 },
      claims: [],
      details: [],
      gist: `${A.name} ${done}`,
    };
    const tHelp = await runPercept(B, pHelp, faculties);
    record(world, sink, b, tHelp);
    for (const g of B.goals.filter((g) => g.tags.some((t) => o.want!.topics.includes(t)))) g.progress = clamp(g.progress + 0.15);
    feed(world, sink, { kind: "event", place, agents: [a, b], title: `${A.name} helps ${B.name}`, text: pHelp.rawText, refs: [{ agent: b, trace: tHelp.id }] });
  }
}

/** Episodes this person has already told that listener, recovered from the rumor ids they passed on. */
function said(world: WorldState, teller: AgentId, listener: AgentId): string[] {
  const prefix = `rum_${teller}_`;
  return world.agents[teller]!.told.filter((t) => t.startsWith(prefix) && t.endsWith(`>${listener}`)).map((t) => t.slice(prefix.length, -(listener.length + 1)));
}

function hop(world: WorldState, rumorId: string, from: AgentId, to: AgentId, text: string, mutated: boolean, trace?: string): void {
  const r = world.rumors[rumorId];
  if (!r) return;
  const bel = world.minds[to]!.beliefs.find((b) => b.rumor === rumorId);
  r.hops.push({ tick: world.tick, from, to, text, confidence: bel?.confidence ?? 0, mutated, trace });
}

// ---------------------------------------------------------------- outside input

/** The visitor (you) says something to one of the islanders. */
export async function say(world: WorldState, to: AgentId, text: string, faculties: Faculties, sink: Sink): Promise<void> {
  const mind = world.minds[to]!;
  const p = await perceiveText(mind, "visitor", text, faculties);
  const t = await runPercept(mind, p, faculties);
  record(world, sink, to, t);
  feed(world, sink, {
    kind: "talk",
    place: world.agents[to]!.place,
    agents: [to],
    title: `You spoke to ${mind.name}`,
    lines: [
      { speaker: "visitor", text },
      ...(t.action?.kind === "speech" ? [{ speaker: to, text: t.action.text, trace: t.id }] : []),
    ],
    refs: [{ agent: to, trace: t.id }],
  });
}

export async function inject(world: WorldState, ev: WorldEvent, faculties: Faculties, sink: Sink): Promise<void> {
  if (ev.kind === "pledge" || ev.kind === "blight" || ev.kind === "gale") {
    if (!world.village) return;
    return injectVillage(world, ev, faculties, sink);
  }
  if (ev.kind === "storm") return storm(world, faculties, sink);
  if (ev.kind === "gathering") {
    if (isNight(world.tick)) return;
    const at = world.places.tavern!.name;
    feed(world, sink, { kind: "event", place: "tavern", agents: [...world.order], title: world.village ? `Everyone gathers at ${at}` : `Wren rings the bell at ${at}`, text: world.village ? "Wren has something hot in the pot. The whole village turns up." : "Drinks on the house tonight. The whole island turns up." });
    for (const id of world.order) setOverride(world, sink, id, "tavern", `at the gathering at ${at}`, 180);
    return;
  }
  if (ev.kind === "catch") {
    const who = world.minds[ev.who]!;
    const evId = nextId(world, "ev_catch");
    world.events.push({ id: evId, tick: world.tick, kind: "catch", label: `${who.name}'s big catch`, topics: ["catch", evId] });
    const t = await runPercept(who, eventPercept(who, "world", "self", 0.7, 0.7, ["catch", "fish", "money", evId], `I brought in the biggest catch of the season.`, `${who.name} hauls in the biggest catch of the season.`, evId), faculties);
    record(world, sink, ev.who, t);
    for (const g of who.goals.filter((g) => g.tags.includes("catch"))) g.progress = clamp(g.progress + 0.1);
    feed(world, sink, { kind: "event", place: world.agents[ev.who]!.place, agents: [ev.who], title: `${who.name} lands the catch of the season`, refs: [{ agent: ev.who, trace: t.id }] });
    applyCoping(world, sink, ev.who, t);
    for (const id of world.order) {
      if (id === ev.who || world.agents[id]!.place !== world.agents[ev.who]!.place) continue;
      const m = world.minds[id]!;
      const seen = await runPercept(m, eventPercept(m, ev.who, "other", 0, 0.3, ["catch", "fish", evId], `${who.name} brought in the biggest catch of the season.`, `${who.name} hauls in the biggest catch of the season.`, evId, [ev.who]), faculties);
      record(world, sink, id, seen);
    }
    return;
  }
  // A rumor arrives on the ferry and lodges in one mind. From there it travels on its own.
  const teller = world.minds[ev.teller]!;
  const id = nextId(world, "rum_planted");
  const text = ev.text.trim().replace(/\.?$/, ".");
  world.rumors[id] = { id, subject: ev.subject, origin: ev.teller, first: text, hops: [] };
  teller.beliefs.push({
    id: nextId(teller, "bel"),
    about: ev.subject,
    topics: ["rumor"],
    proposition: text,
    confidence: 0.75,
    valence: ev.valence,
    source: { kind: "told", from: "visitor" },
    formed: world.tick,
    evidence: [],
    retrievals: [world.tick],
    rumor: id,
  });
  world.rumors[id]!.hops.push({ tick: world.tick, from: "visitor", to: ev.teller, text, confidence: 0.75, mutated: false });
  feed(world, sink, { kind: "event", agents: [ev.teller, ev.subject], title: `A stranger off the ferry tells ${teller.name} a story about ${name(world, ev.subject)}`, text: `"${text}"`, rumor: id });
}

function eventPercept(
  mind: MindState,
  actor: AgentId | "world",
  agency: "self" | "other" | "circumstance",
  outcome: number,
  intensity: number,
  topics: string[],
  gist: string,
  rawText: string,
  eventId: string,
  about: AgentId[] = [],
): Percept {
  return {
    id: nextId(mind, "pc"),
    tick: mind.tick,
    kind: "event",
    rawText,
    actor,
    addressedToSelf: false,
    about,
    topics,
    features: { outcomeForSelf: outcome, agency, intentional: 0, normViolation: 0, prospective: false, intensity },
    claims: [],
    details: [],
    gist,
    eventId,
  };
}

async function storm(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const id = nextId(world, "ev_storm");
  const fishers = world.order.filter((x) => world.agents[x]!.role === "fisher");
  const victim = fishers[Math.floor(nextRandom(world) * fishers.length)]!;
  world.events.push({ id, tick: world.tick, kind: "storm", label: "the storm", topics: ["storm", id] });
  feed(world, sink, {
    kind: "event",
    agents: [...world.order],
    title: `A storm tears across ${world.name}`,
    text: `Boats are thrown against the harbour wall. ${name(world, victim)}'s boat takes the worst of it.`,
  });
  for (const who of world.order) {
    if (world.agents[who]!.place === "sea") setOverride(world, sink, who, "harbour", "racing the storm back to harbour", 60);
  }
  for (const who of world.order) {
    const m = world.minds[who]!;
    const p =
      who === victim
        ? {
            ...eventPercept(m, "world", "circumstance", -0.8, 0.9, ["storm", "boat", "nets", id], "The storm tore my nets and stove in the side of my boat.", "The storm smashes the boat against the harbour wall.", id),
            template: "The storm {damage}.",
            details: [{ key: "damage", value: "tore my nets and stove in the side of my boat", salience: 0.5 }],
          }
        : who === "wren" && !world.village
          ? eventPercept(m, "world", "circumstance", -0.45, 0.6, ["storm", "shutters", "tavern", id], "The storm ripped the Gull's shutters loose.", "The storm rips the Gull's shutters loose.", id)
          : eventPercept(m, "world", "circumstance", -0.3, 0.55, ["storm", "boat", id], `A storm tore through the island and wrecked ${name(world, victim)}'s boat.`, "A storm tears through the island.", id, [victim]);
    const t = await runPercept(m, p, faculties);
    record(world, sink, who, t);
    applyCoping(world, sink, who, t, victim);
  }
  // People who care, and can help, will offer.
  const V = world.minds[victim]!;
  for (const who of world.order) {
    if (who === victim) continue;
    const m = world.minds[who]!;
    const ag = world.agents[who]!;
    const canHelp = ag.role === "boatwright" || ag.role === "fisher";
    if (canHelp && m.traits.agreeableness > 0.6 && (m.others[victim]?.liking ?? 0) > 0.5 && !ag.wants.some((w) => w.kind === "offer" && w.target === victim)) {
      ag.wants.push({ id: nextId(world, "w"), kind: "offer", target: victim, what: "help you patch your boat", topics: ["boat", "help", "rely"], notBefore: world.tick });
    }
  }
  void V;
}

export { name as personName, feed, record, setOverride, eventPercept, claimFromEpisode, hop };
