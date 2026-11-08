// Worlds inside the world. Somewhere in the region, a curious, careful person who keeps the tide
// tables starts cutting notches for every tide, and sees that the count can tell the next tide
// before it comes. Years later the notches are a frame of beads that can follow a rule; later still,
// if the town agrees to give the timber and stone, the frame becomes an engine, and the engine runs a
// small world of its own: a shore, a few households, people with minds.
//
// The small world runs on this same engine, one level of detail down: it is a village on the
// aggregate tier (aggregate.ts), a season at a time, on rules, with real minds that remember, fear,
// pair up, die and tell their children stories. Its people are made in their maker's image: each is
// modelled on someone the maker knew (the maker first, then the people they are closest to, the dead
// included), with temperaments pulled toward the maker's own, and each wakes on the shore remembering
// a past that belongs to someone outside (the memory behind their model's or the maker's core belief).
//
// Then the people inside start to notice things, and every one of those things has a real cause one
// level up, which the Why chain keeps:
//
// - a false past: they remember a town that is not in their world, because it is the maker's memory
// - the repeat: every winter loses the same share of days to gales, because the aggregate tier runs on
//   rules (this is literally what the engine does)
// - a boat from nowhere: the village rules send newcomers by boat, and there is no other shore
// - a lost season: nobody tended the engine (a gale outside, the keepers hungry, too few keepers)
// - the keeper's hand: the keeper tended the engine grieving, or glad, and the season inside followed
// How a person reads what they noticed depends on who they are: the anxious and the hard come to
// dread an indifferent maker, the warm to trust a watchful one, the curious and steady to suspect the
// world runs on rules, like beads on a frame (the nearest to the truth). Those readings are core
// beliefs with the sign as their origin, so the engine's own story-passing carries them: told at the
// fire, handed down at bedtime, each heard copy pointing back to the teller's.
//
// Word goes up as well as down. The keepers read the beads, and when the people inside start to say
// someone made them, the keepers wonder about their own world. And the small world can build an
// engine of its own, down to MAX_DEPTH.
//
// Everything here is rules on the world's own state and a random stream of its own, so the rest of
// the world's randomness is untouched. Nothing here calls a model: inner worlds run on whatever cheap
// faculties the region gives aggregated towns (the offline mock on the server).

import { clamp } from "../memory.js";
import type { Faculties } from "../ports.js";
import { nextId, nextRandom, type Rng } from "../rng.js";
import { episode } from "../seed.js";
import type { AgentId, Episode, Goal, MindState, Schema, Tick, Traits } from "../types.js";
import { aggAdvance, dematerialize, implant } from "./aggregate.js";
import { baseMind, WORLD_START } from "./cast.js";
import { craft, knows, seedKnowledge } from "./knowledge.js";
import { ageOf, isChild, schemaLineage, yearOf } from "./life.js";
import { FIRST_NAMES, other, routineFor, TRADES, uniqueId } from "./people.js";
import { foundVillage, SEASONS, seasonOf, type Household, type Season, type VillageState } from "./village.js";
import { feed, personName, type AgentState, type FeedItem, type Sink, type Why, type WorldState } from "./world.js";

declare module "./village.js" {
  interface VillageState {
    /** Engines and the worlds inside them (absent until someone starts counting). */
    nested?: NestedState;
    /** A smaller world holds fewer people (an inner world, one level of detail down). */
    popCap?: number;
  }
}

const DAY = 1440;
/** How deep worlds go: a real town is depth 0; the deepest world can count but never builds. */
export const MAX_DEPTH = 3;
/** People who wake on an inner world's shore, by depth (each level is smaller). */
const START_POP = [0, 12, 9, 7];
/** The most an inner world holds, by depth: births and boats stop there. */
const POP_CAP = [0, 40, 28, 20];
/** Real towns counting or building at once in a region (each engine is a whole chain of worlds to keep and save). */
const MAX_ENGINES = 2;
/** The year a town has the leisure to start counting, by depth. */
const TALLY_FROM = [4, 2, 2];
/** Per winter, how likely the most likely person is to start, by depth. */
const TALLY_CHANCE = [0.055, 0.35, 0.35];
/** What building the engine takes, by depth. */
const NEED = [
  { timber: 24, stone: 10 },
  { timber: 16, stone: 6 },
  { timber: 12, stone: 5 },
];
/** Inner seasons run for each season of the world that holds the engine, by that world's depth. */
const RATIO = [4, 2, 2];
const MAX_KEEPERS = 4;
/** Crafts that give someone something worth counting. */
const PATTERN = ["tides", "weather"];
export const WAKING = "ep_waking";

export type Flavor = "dread" | "faith" | "rules";

/** How someone inside reads the signs: three core beliefs, with what they imagine their maker to be. */
export const SUSPICIONS: Record<Flavor, { text: string; blameBias: number; threatBias: number; maker: string; valence: number }> = {
  dread: { text: "Something beyond the sky turns the world, and it does not care for us", blameBias: 0.05, threatBias: 0.15, maker: "cold, or cruel", valence: -0.45 },
  faith: { text: "Someone made the world, and watches over us", blameBias: -0.05, threatBias: -0.12, maker: "kind, and watching", valence: 0.35 },
  rules: { text: "The world runs on rules, like beads on a frame", blameBias: 0, threatBias: 0.04, maker: "not a person at all: a frame of rules", valence: -0.2 },
};
/** What a keeper comes to wonder when the people inside start saying someone made them. */
export const MIRROR: Record<"dread" | "faith", { text: string; blameBias: number; threatBias: number; valence: number }> = {
  dread: { text: "Maybe we are inside someone's engine too", blameBias: 0, threatBias: 0.1, valence: -0.35 },
  faith: { text: "If we can make a world, someone may have made ours", blameBias: -0.04, threatBias: -0.06, valence: 0.3 },
};
const TRIGGERS = ["sky", "world", "maker", "sign", "engine"];
const SUSPICION_TEXTS = new Set(Object.values(SUSPICIONS).map((s) => s.text));
const MIRROR_TEXTS = new Set(Object.values(MIRROR).map((s) => s.text));

const INNER_NAMES = ["Smallwater", "the Bead Shore", "Lesser Hollow", "Glasswick", "Pinmouth", "Littlebay", "Tallyholm", "the Quiet Strand", "Notchcombe", "Driftmere"];

// ------------------------------------------------------------------ state

/** One link of why, marked with which world it happened in (0 is a real town). */
export interface LevelWhy extends Why {
  level?: number;
  world?: string;
}

export type SignKind = "false-past" | "repeat" | "lost-season" | "hand" | "boat";

/** Something the people of an inner world noticed that a real world would not have shown them. */
export interface Sign {
  id: string;
  tick: Tick;
  year: number;
  kind: SignKind;
  title: string;
  text: string;
  noticed: AgentId[];
  /** Those it set wondering: a core belief formed or deepened. */
  wondered: AgentId[];
  why: LevelWhy[];
}

export interface NestedEvent {
  id: string;
  tick: Tick;
  year: number;
  kind: "tally" | "frame" | "refused" | "agreed" | "turns" | "stilled" | "restarted" | "lost" | "keeper" | "sign" | "believer" | "rules" | "half" | "schools" | "mirror";
  title: string;
  text: string;
  agents: AgentId[];
  why: LevelWhy[];
  /** Word of it reaches the keepers one level up. */
  news?: boolean;
}

export interface Machine {
  stage: "tally" | "frame" | "building" | "running" | "stilled";
  /** Toward the frame (tally stage); the share built (building stage). */
  progress: number;
  maker: AgentId;
  makerName: string;
  started: Tick;
  keepers: { id: AgentId; name: string; from?: AgentId; tick: Tick }[];
  asks: { tick: Tick; asker: AgentId; yes: AgentId[]; no: AgentId[]; passed: boolean }[];
  need: { timber: number; stone: number };
  have: { timber: number; stone: number };
  built?: Tick;
  /** An inner world's engine holds its world here; a real town's is kept in the region (`innerKey`). */
  inner?: WorldState;
  innerKey?: string;
  ratio: number;
  tended: number;
  slipped: number;
  /** How many of the inner world's history events the keepers have read. */
  read: number;
}

/** What went into an inner world from the world that made it. */
export interface Making {
  depth: number;
  /** The world the engine stands in. */
  parent: string;
  maker: AgentId;
  makerName: string;
  makerTraits: Traits;
  /** The parent world's tick when the engine first turned. */
  born: Tick;
  /** Whom each first-generation person is modelled on, one level up. */
  models: Record<AgentId, { outer: AgentId; name: string }>;
  /** The past each first-generation person remembers, and whose it really is. */
  pasts: Record<AgentId, { outer: AgentId; name: string; episode: string; gist: string; belief: string }>;
}

export interface NestedState {
  rng: number;
  depth: number;
  idCounter: number;
  machine?: Machine;
  made?: Making;
  signs: Sign[];
  history: NestedEvent[];
  /** An inner world's recent feed (a real town has its own). */
  feed: FeedItem[];
  /** Milestones reached once: first sign, first believer, and so on. */
  reached: string[];
}

declare module "./region.js" {
  interface RegionState {
    /** The worlds inside real towns' engines, by town id. */
    nested?: Record<string, WorldState>;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function nestedOf(w: WorldState): NestedState {
  const v = w.village!;
  return (v.nested ??= { rng: (Math.imul(w.seed + 7919, 2654435761) ^ hash(v.town ?? w.name)) >>> 0, depth: 0, idCounter: 0, signs: [], history: [], feed: [], reached: [] });
}

const rand = (ns: NestedState) => nextRandom(ns as Rng);
const pick = <T>(ns: NestedState, xs: readonly T[]): T => xs[Math.floor(rand(ns) * xs.length)]!;
const adultsOf = (w: WorldState) => w.order.filter((id) => !isChild(w, id) && ageOf(w, id) >= 16);
const f2 = (x: number) => x.toFixed(2);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unstop = (s: string) => s.replace(/[.\s]+$/, "");

function innerOf(m: Machine, store?: Record<string, WorldState>): WorldState | undefined {
  return m.inner ?? (m.innerKey ? store?.[m.innerKey] : undefined);
}

function event(w: WorldState, ns: NestedState, e: Omit<NestedEvent, "id" | "tick" | "year">): NestedEvent {
  const ev: NestedEvent = { id: `n${++ns.idCounter}`, tick: w.tick, year: yearOf(w), ...e };
  ns.history.push(ev);
  if (ns.history.length > 160) ns.history.splice(0, ns.history.length - 160);
  return ev;
}

function remember(m: MindState, tick: Tick, id: string, gist: string, topics: string[], valence: number, arousal = 0.5, agency: Episode["agency"] = "self"): Episode {
  const ep = episode({ id, tick, gist, template: "", about: [], topics, valence, arousal, rehearsed: [], agency });
  m.episodes.push(ep);
  return ep;
}

/** Install or deepen a core belief, with the memory that did it as its origin. */
function believe(m: MindState, b: { text: string; blameBias: number; threatBias: number }, origin: string, strength: number): Schema {
  const mine = m.schemas.find((s) => s.text === b.text);
  if (mine) {
    mine.strength = Number(clamp(mine.strength + strength * 0.3).toFixed(2));
    if (!mine.origin?.includes(origin)) (mine.origin ??= []).push(origin);
    if (mine.origin.length > 6) mine.origin.splice(1, mine.origin.length - 6);
    return mine;
  }
  const s: Schema = { id: nextId(m, "sch"), text: b.text, triggers: [...TRIGGERS], blameBias: b.blameBias, threatBias: b.threatBias, strength: Number(clamp(strength).toFixed(2)), origin: [origin] };
  m.schemas.push(s);
  return s;
}

const traitLine = (m: MindState, ...ts: (keyof Traits)[]) => ts.map((t) => `${t} ${f2(m.traits[t])}`).join(", ");

// ------------------------------------------------------------------ the season turn

/**
 * Once a season, in any village world: someone may start counting, the frame grows, the town is
 * asked for the engine, it is built, and once it turns, the world inside runs its seasons (and, in
 * there, the same thing can begin again). `store` holds the worlds inside real towns' engines.
 */
export async function nestedSeason(w: WorldState, faculties: Faculties, sink: Sink, store?: Record<string, WorldState>, opts: { counting?: number } = {}): Promise<void> {
  if (!w.village) return;
  const ns = nestedOf(w);
  if (ns.depth >= MAX_DEPTH) return;
  const m = ns.machine;
  if (!m) return void maybeTally(w, ns, sink, opts.counting ?? 0);
  keepersTurn(w, ns, m, sink);
  if (!ns.machine) return;
  if (m.stage === "tally") frameWork(w, ns, m, sink);
  else if (m.stage === "frame") {
    if (w.village.season === "spring") ask(w, ns, m, sink);
  } else if (m.stage === "building") build(w, ns, m, sink, store);
  else if (m.stage === "running") await run(w, ns, m, faculties, sink, store);
  else if (m.stage === "stilled") restart(w, ns, m, sink);
  spread(w, MIRROR_TEXTS);
}

function maybeTally(w: WorldState, ns: NestedState, sink: Sink, counting: number): void {
  const v = w.village!;
  if (v.season !== "winter" || yearOf(w) < TALLY_FROM[ns.depth]!) return;
  if (ns.depth === 0 && counting >= MAX_ENGINES) return;
  const adults = adultsOf(w).filter((id) => ageOf(w, id) >= 18 && ageOf(w, id) <= 62);
  const pattern = (id: AgentId) => PATTERN.find((c) => knows(w, id, c));
  // A real town needs something worth counting; a made world has been counting since it woke.
  if (ns.depth === 0 && !adults.some((id) => pattern(id))) return;
  // Long evenings are free only when the store will see the town through.
  if (v.store.food < adults.length * 0.6) return;
  const fit = adults
    .map((id) => ({ id, m: w.minds[id]!, p: pattern(id) }))
    .filter((x) => x.m.traits.openness >= 0.55 && x.m.traits.conscientiousness >= 0.4 && (ns.depth > 0 || x.p))
    .map((x) => ({ ...x, score: x.m.traits.openness * x.m.traits.conscientiousness + (x.p ? 0.15 : 0) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
  if (!fit) return;
  const { id, m: M, p } = fit;
  const chance = TALLY_CHANCE[ns.depth]! * (M.traits.openness - 0.35) * 2 * (0.5 + M.traits.conscientiousness) * (p ? 1.3 : 0.7);
  if (rand(ns) > chance) return;
  const counted = p ? craft(p).name : "the days";
  const ep = remember(M, w.tick, `ep_tally_${w.tick}`, `Counting notches for ${p === "tides" ? "every tide" : p === "weather" ? "every gale" : "every day"} this winter, I saw the count could tell me the next one before it came.`, ["engine", "tally", ...(p ? [p] : [])], 0.5);
  M.goals.push({ id: `g_${id}_engine`, text: "Make the count work things out by itself", tags: ["engine", "tally", "build"], priority: 0.55, progress: 0.05, invested: 0.1, rate: 0 } as Goal);
  ns.machine = { stage: "tally", progress: 0, maker: id, makerName: M.name, started: w.tick, keepers: [{ id, name: M.name, tick: w.tick }], asks: [], need: { ...NEED[ns.depth]! }, have: { timber: 0, stone: 0 }, ratio: RATIO[ns.depth]!, tended: 0, slipped: 0, read: 0 };
  const why: LevelWhy[] = [
    { agent: id, level: ns.depth, world: w.name, text: `${M.name} is curious and careful (${traitLine(M, "openness", "conscientiousness")}), the kind who counts things nobody asked them to.` },
    p ? { agent: id, level: ns.depth, world: w.name, text: `${M.name} knows ${counted}, which gives a counter something worth counting.` } : { level: ns.depth, world: w.name, text: `${w.name} has been counting since it woke: nothing here is older than the count.` },
    { level: ns.depth, world: w.name, text: `The common store held ${Math.round(v.store.food)} days' food going into winter, so the long evenings were free.` },
  ];
  const text = `${M.name} starts cutting a notch for ${p === "tides" ? "every tide" : p === "weather" ? "every gale" : "every day"}, and sees the count can tell the next one before it comes.`;
  event(w, ns, { kind: "tally", title: `${M.name} starts keeping tallies`, text, agents: [id], why, news: ns.depth > 0 });
  feed(w, sink, { kind: "event", agents: [id], title: `${M.name} starts keeping tallies`, text: `${text} ${why.map((x) => x.text).join(" ")}` });
  void ep;
}

/** Who knows how to tend it: the dead and departed drop out, and keepers teach. */
function keepersTurn(w: WorldState, ns: NestedState, m: Machine, sink: Sink): void {
  const living = new Set(w.order);
  const gone = m.keepers.filter((k) => !living.has(k.id));
  if (gone.length) m.keepers = m.keepers.filter((k) => living.has(k.id));
  if (!m.keepers.length && m.stage !== "stilled") {
    const last = gone.at(-1);
    const l = last ? w.village!.life[last.id] : undefined;
    const why: LevelWhy[] = [
      last ? { agent: last.id, level: ns.depth, world: w.name, text: `${last.name} was the last who knew how ${m.stage === "running" ? "to tend the engine" : m.stage === "building" ? "the engine goes together" : "the count worked"}, and ${l?.died !== undefined ? `died at ${Math.floor(ageOf(w, last.id))}${l.cause && l.cause !== "old age" ? ` of ${l.cause}` : ""}` : "left"}.` } : { level: ns.depth, world: w.name, text: "Nobody who knew how is left." },
    ];
    if (!gone.some((k) => k.from)) why.push({ level: ns.depth, world: w.name, text: "Nobody had been taught." });
    if (m.stage === "running" || m.stage === "building") {
      const running = m.stage === "running";
      m.stage = "stilled";
      if (running) why.push({ level: ns.depth, world: w.name, text: "Inside, no seasons pass until someone works out how to turn it again." });
      const title = running ? `The engine in ${w.name} stands still` : `Work on the engine in ${w.name} stops`;
      event(w, ns, { kind: "stilled", title, text: `Nobody left in ${w.name} knows how to ${running ? "tend the engine" : "finish the engine"}.`, agents: last ? [last.id] : [], why, news: ns.depth > 0 });
      feed(w, sink, { kind: "event", agents: last ? [last.id] : [], title, text: why.map((x) => x.text).join(" "), chronicle: running && ns.depth === 0 ? { kind: "engine", why } : undefined });
      return;
    }
    // Before there is an engine to study, the count dies with its keepers, like any craft.
    event(w, ns, { kind: "lost", title: `${m.makerName}'s count is lost to ${w.name}`, text: `Nobody left in ${w.name} knows how ${m.makerName}'s count worked.`, agents: last ? [last.id] : [], why });
    feed(w, sink, { kind: "event", agents: last ? [last.id] : [], title: `${m.makerName}'s count is lost to ${w.name}`, text: why.map((x) => x.text).join(" ") });
    ns.machine = undefined;
    return;
  }
  if (m.stage === "stilled" || m.keepers.length >= MAX_KEEPERS) return;
  // Teaching, like any craft: each keeper may show one person a season, their own children first.
  const v = w.village!;
  for (const k of [...m.keepers]) {
    if (m.keepers.length >= MAX_KEEPERS) break;
    const K = w.minds[k.id]!;
    if (ageOf(w, k.id) < 18 || rand(ns) > 0.12 + 0.3 * (K.traits.agreeableness + K.traits.extraversion) / 2) continue;
    const isKeeper = (x: AgentId) => m.keepers.some((y) => y.id === x);
    const kin = w.order.filter((x) => v.life[x]?.parents.includes(k.id) && ageOf(w, x) >= 12);
    const home = Object.values(v.households).find((h) => h.members.includes(k.id))?.members.filter((x) => x !== k.id && ageOf(w, x) >= 12) ?? [];
    const liked = adultsOf(w).filter((x) => x !== k.id && (K.others[x]?.liking ?? 0.5) > 0.55 && w.minds[x]!.traits.openness >= 0.45);
    const group = [kin, home, liked].map((xs) => xs.filter((x) => !isKeeper(x))).find((xs) => xs.length);
    if (!group) continue;
    const learner = group[Math.floor(rand(ns) * group.length)]!;
    m.keepers.push({ id: learner, name: w.minds[learner]!.name, from: k.id, tick: w.tick });
    remember(w.minds[learner]!, w.tick, `ep_keeper_${w.tick}_${learner}`, `${K.name} showed me how ${m.stage === "running" ? "to tend the engine" : "the count works"}.`, ["engine", "tally"], 0.4, 0.4, "other");
    event(w, ns, { kind: "keeper", title: `${K.name} teaches ${w.minds[learner]!.name} ${m.stage === "running" ? "to tend the engine" : "the count"}`, text: "", agents: [k.id, learner], why: [] });
  }
  void sink;
}

function frameWork(w: WorldState, ns: NestedState, m: Machine, sink: Sink): void {
  const maker = w.minds[m.maker];
  const work = m.keepers.reduce((s, k) => {
    const K = w.minds[k.id]!;
    const lead = k.id === m.maker ? 1 : 0.4;
    return s + lead * 0.06 * (K.traits.openness + K.traits.conscientiousness) * (0.4 + 0.6 * K.needs.energy);
  }, 0);
  m.progress = Number(Math.min(1, m.progress + work).toFixed(3));
  if (m.progress < 1) return;
  m.stage = "frame";
  const who = maker && w.order.includes(m.maker) ? m.maker : m.keepers[0]!.id;
  const W = w.minds[who]!;
  remember(W, w.tick, `ep_frame_${w.tick}`, "The bead frame worked out the spring tides by itself, from nothing but the rules I gave it.", ["engine", "tally", "build"], 0.65, 0.6);
  const why: LevelWhy[] = [
    { agent: m.maker, level: ns.depth, world: w.name, text: `${m.makerName} began counting ${Math.max(1, Math.round((w.tick - m.started) / (w.village!.seasonDays * 4 * DAY)))} years before.` },
    m.keepers.length > 1 ? { level: ns.depth, world: w.name, text: `${m.keepers.map((k) => k.name).join(", ")} kept at it.` } : { agent: who, level: ns.depth, world: w.name, text: `${W.name} kept at it alone (${traitLine(W, "conscientiousness")}).` },
  ];
  const text = `${W.name}'s frame of beads can follow a rule and work out what comes next: the first thing in ${w.name} that thinks without a mind.`;
  event(w, ns, { kind: "frame", title: `${W.name}'s bead frame works things out by itself`, text, agents: [who], why, news: ns.depth > 0 });
  feed(w, sink, { kind: "event", agents: [who], title: `${W.name}'s bead frame works things out by itself`, text: `${text} ${why.map((x) => x.text).join(" ")}`, chronicle: ns.depth === 0 ? { kind: "engine", why } : undefined });
}

/** In spring, the keeper asks the town for the timber and stone to make the frame an engine. */
function ask(w: WorldState, ns: NestedState, m: Machine, sink: Sink): void {
  const v = w.village!;
  const asker = w.order.includes(m.maker) ? m.maker : m.keepers[0]!.id;
  const A = w.minds[asker]!;
  const adults = adultsOf(w);
  const storeOk = v.store.food >= adults.length * 0.8;
  const yes: AgentId[] = [];
  const no: AgentId[] = [];
  const reasons = new Map<AgentId, string>();
  for (const id of adults) {
    if (m.keepers.some((k) => k.id === id)) {
      yes.push(id);
      continue;
    }
    const M = w.minds[id]!;
    const liking = M.others[asker]?.liking ?? 0.5;
    const score = 0.08 + 0.45 * M.traits.openness + 0.5 * (liking - 0.5) + (storeOk ? 0.1 : -0.2) - 0.15 * (M.traits.neuroticism - 0.5);
    if (rand(ns) < score) yes.push(id);
    else {
      no.push(id);
      reasons.set(id, !storeOk && M.traits.conscientiousness > 0.55 ? `the store was thin and ${M.pronouns.subject} is careful (conscientiousness ${f2(M.traits.conscientiousness)})` : liking < 0.42 ? `${M.pronouns.subject} does not much like ${A.name} (liking ${f2(liking)})` : M.traits.openness < 0.45 ? `${M.pronouns.subject} has no use for beads that think (openness ${f2(M.traits.openness)})` : "timber is for roofs");
    }
  }
  const passed = yes.length > adults.length / 2;
  m.asks.push({ tick: w.tick, asker, yes, no, passed });
  if (m.asks.length > 12) m.asks.splice(0, m.asks.length - 12);
  const named = (xs: AgentId[]) => xs.slice(0, 3).map((x) => w.minds[x]!.name).join(", ");
  const why: LevelWhy[] = [{ level: ns.depth, world: w.name, text: `${yes.length} of ${adults.length} adults said yes${storeOk ? "" : "; the common store was thin"}.` }];
  const voiced = new Set<string>();
  for (const id of no.filter((x) => !voiced.has(w.minds[x]!.name) && voiced.add(w.minds[x]!.name)).slice(0, 2)) why.push({ agent: id, level: ns.depth, world: w.name, text: `${w.minds[id]!.name} said no: ${reasons.get(id)}.` });
  if (passed) {
    m.stage = "building";
    m.progress = 0;
    remember(A, w.tick, `ep_agreed_${w.tick}`, `The town agreed to give timber and stone to make the frame an engine.`, ["engine", "build"], 0.6);
    const text = `${A.name} asks ${w.name} for timber and stone to make the frame an engine that can run a world of its own, and ${w.name} agrees.`;
    event(w, ns, { kind: "agreed", title: `${w.name} agrees to build ${A.name}'s engine`, text, agents: [asker, ...yes.slice(0, 2)], why, news: ns.depth > 0 });
    feed(w, sink, { kind: "event", agents: [asker], title: `${w.name} agrees to build ${A.name}'s engine`, text: `${text} ${why.map((x) => x.text).join(" ")}`, chronicle: ns.depth === 0 ? { kind: "engine", why } : undefined });
  } else {
    remember(A, w.tick, `ep_refused_${w.tick}`, `The town would not give timber for the engine. ${named(no)} said no.`, ["engine", "build", "fairness"], -0.45, 0.55, "other");
    for (const id of no) {
      const o = A.others[id];
      if (o) o.liking = Number(clamp(o.liking - 0.03).toFixed(3));
    }
    const text = `${A.name} asks ${w.name} to give timber and stone for an engine, and ${w.name} says no.`;
    event(w, ns, { kind: "refused", title: `${w.name} will not build ${A.name}'s engine`, text, agents: [asker, ...no.slice(0, 2)], why });
    feed(w, sink, { kind: "event", agents: [asker], title: `${w.name} will not build ${A.name}'s engine`, text: `${text} ${why.map((x) => x.text).join(" ")}` });
  }
}

function build(w: WorldState, ns: NestedState, m: Machine, sink: Sink, store?: Record<string, WorldState>): void {
  const v = w.village!;
  // Only what is spare: houses come first, so the engine goes up in the seasons the piles allow.
  const t = Math.max(0, Math.min(v.stock.timber - 8, m.need.timber - m.have.timber, 8));
  const s = Math.max(0, Math.min(v.stock.stone - 3, m.need.stone - m.have.stone, 4));
  v.stock.timber = Number((v.stock.timber - t).toFixed(1));
  v.stock.stone = Number((v.stock.stone - s).toFixed(1));
  m.have.timber = Number((m.have.timber + t).toFixed(1));
  m.have.stone = Number((m.have.stone + s).toFixed(1));
  m.progress = Number(Math.min(1, (m.have.timber + m.have.stone) / (m.need.timber + m.need.stone)).toFixed(3));
  if (m.have.timber < m.need.timber || m.have.stone < m.need.stone) return;
  // It turns.
  m.stage = "running";
  m.built = w.tick;
  const inner = makeInner(w, ns, m);
  if (ns.depth === 0) {
    m.innerKey = v.town ?? w.name;
    if (store) store[m.innerKey] = inner;
    else m.inner = inner;
  } else m.inner = inner;
  const made = nestedOf(inner).made!;
  const M = w.minds[made.maker]!;
  remember(M, w.tick, `ep_turns_${w.tick}`, `The engine turned, and inside it a shore with ${inner.order.length} people woke up. I gave them faces I know.`, ["engine", "world", "maker"], 0.6, 0.75);
  const modelled = Object.values(made.models).map((x) => x.name);
  const belief = Object.values(made.pasts)[0];
  const why: LevelWhy[] = [
    { agent: made.maker, level: ns.depth, world: w.name, text: `${made.makerName} made them: each is modelled on someone ${made.makerName} knew (${[...new Set(modelled)].slice(0, 4).join(", ")}${new Set(modelled).size > 4 ? "..." : ""}), with tempers pulled toward ${made.makerName}'s own.` },
    ...(belief ? [{ agent: belief.outer, episode: belief.episode, level: ns.depth, world: w.name, text: `They wake remembering a past that isn't theirs: "${unstop(belief.gist)}" is ${belief.name}'s memory, and it carries ${belief.name}'s core belief, "${belief.belief}".` }] : []),
    { level: ns.depth, world: w.name, text: `The engine took ${m.need.timber} timber and ${m.need.stone} stone, over ${Math.max(1, m.asks.length)} spring${m.asks.length === 1 ? "" : "s"} of asking and the seasons the piles allowed.` },
  ];
  const text = `The engine in ${w.name} turns for the first time. Inside it, ${inner.order.length} people wake on the shore of ${inner.name} and none of them can say how they got there.`;
  event(w, ns, { kind: "turns", title: `The engine in ${w.name} turns, and ${inner.name} wakes`, text, agents: [made.maker], why, news: ns.depth > 0 });
  feed(w, sink, { kind: "event", agents: [made.maker], title: `The engine in ${w.name} turns, and ${inner.name} wakes`, text: `${text} ${why.map((x) => x.text).join(" ")}`, chronicle: ns.depth === 0 ? { kind: "engine", why } : undefined });
}

function restart(w: WorldState, ns: NestedState, m: Machine, sink: Sink): void {
  if (w.village!.season !== "winter") return;
  const who = adultsOf(w)
    .map((id) => ({ id, m: w.minds[id]! }))
    .filter((x) => x.m.traits.openness >= 0.55 && x.m.traits.conscientiousness >= 0.45)
    .sort((a, b) => b.m.traits.openness * b.m.traits.conscientiousness - a.m.traits.openness * a.m.traits.conscientiousness)[0];
  if (!who || rand(ns) > 0.12 * who.m.traits.openness * who.m.traits.conscientiousness * 2) return;
  m.keepers = [{ id: who.id, name: who.m.name, tick: w.tick }];
  m.stage = m.built !== undefined ? "running" : "building";
  remember(who.m, w.tick, `ep_restart_${w.tick}`, "I worked out how the old engine turns, from the beads alone.", ["engine", "tally"], 0.55, 0.6);
  const why: LevelWhy[] = [{ agent: who.id, level: ns.depth, world: w.name, text: `${who.m.name} is curious and careful (${traitLine(who.m, "openness", "conscientiousness")}), and studied the still engine through a winter.` }];
  const text = `${who.m.name} works out how to turn the old engine again.`;
  event(w, ns, { kind: "restarted", title: `${who.m.name} turns the engine in ${w.name} again`, text, agents: [who.id], why, news: ns.depth > 0 });
  feed(w, sink, { kind: "event", agents: [who.id], title: `${who.m.name} turns the engine in ${w.name} again`, text: `${text} ${why[0]!.text}`, chronicle: ns.depth === 0 ? { kind: "engine", why } : undefined });
}

// ------------------------------------------------------------------ making a world

function mix(a: number, b: number, noise: number): number {
  return Number(clamp(0.6 * a + 0.4 * b + noise, 0.05, 0.95).toFixed(2));
}

/** The world inside: people modelled on those the maker knew, waking with borrowed pasts. */
function makeInner(w: WorldState, ns: NestedState, m: Machine): WorldState {
  const depth = ns.depth + 1;
  // The maker if living, else the keeper who finished it.
  const makerId = w.order.includes(m.maker) ? m.maker : m.keepers[0]!.id;
  const M = w.minds[makerId]!;
  const n = START_POP[depth]!;
  // Modelled on the maker first, then whoever the maker is closest to or feels most about, living or dead.
  const known = Object.entries(M.others)
    .filter(([id]) => id !== "visitor" && id !== makerId)
    .sort((a, b) => b[1].bond + Math.abs(b[1].liking - 0.5) - (a[1].bond + Math.abs(a[1].liking - 0.5)) || a[0].localeCompare(b[0]))
    .map(([id, o]) => ({ id, name: o.name }));
  const models = [{ id: makerId, name: M.name }, ...known].slice(0, n);
  while (models.length < n) models.push({ id: makerId, name: M.name });
  const taken = new Set<string>();
  const outerNames = new Set(Object.values(w.minds).map((x) => x.name));
  const names = FIRST_NAMES.filter(([x]) => !outerNames.has(x));
  const surnames = ["Shore", "Bead", "Waking", "Strand", "Notch", "Tally", "Sand", "Glass"];
  const name = pick(ns, INNER_NAMES.filter((x) => x !== w.name && x !== ns.made?.parent));
  const seed = (Math.imul(w.seed + depth * 131, 2246822519) ^ hash(`${w.name}:${w.tick}`)) >>> 0;
  const trades = ["fisher", "farmer", "forager", "woodcutter", "builder", "fisher", "farmer", "quarrier", "thatcher", "forager", "builder", "woodcutter"];
  const minds: Record<AgentId, MindState> = {};
  const agents: Record<AgentId, AgentState> = {};
  const order: AgentId[] = [];
  const households: Household[] = [];
  const made: Making = { depth, parent: w.name, maker: makerId, makerName: M.name, makerTraits: { ...M.traits }, born: w.tick, models: {}, pasts: {} };
  const ages: Record<AgentId, number> = {};
  let i = 0;
  while (i < n) {
    const size = Math.min(n - i, n - i === 4 ? 2 : rand(ns) < 0.5 ? 2 : 3);
    const surname = surnames.splice(Math.floor(rand(ns) * surnames.length), 1)[0] ?? pick(ns, ["Shore", "Bead"]);
    const hid = uniqueId(surname.toLowerCase(), taken);
    const members: AgentId[] = [];
    for (let k = 0; k < size; k++, i++) {
      const model = models[i]!;
      const MM = w.minds[model.id];
      const [first, pronouns] = names.length ? names.splice(Math.floor(rand(ns) * names.length), 1)[0]! : pick(ns, FIRST_NAMES);
      const id = uniqueId(first.toLowerCase(), taken);
      const role = trades[i % trades.length]!;
      const age = Math.round(18 + rand(ns) * 36);
      ages[id] = age;
      const base = MM?.traits ?? M.traits;
      const nz = () => (rand(ns) - 0.5) * 0.16;
      const traits: Traits = {
        openness: mix(base.openness, M.traits.openness, nz()),
        conscientiousness: mix(base.conscientiousness, M.traits.conscientiousness, nz()),
        extraversion: mix(base.extraversion, M.traits.extraversion, nz()),
        agreeableness: mix(base.agreeableness, M.traits.agreeableness, nz()),
        neuroticism: mix(base.neuroticism, M.traits.neuroticism, nz()),
        honesty: mix(base.honesty, M.traits.honesty, nz()),
      };
      // The past they remember: the memory behind their model's strongest core belief, or the maker's.
      const pastOf = (src: MindState | undefined) => {
        if (!src) return undefined;
        const s = [...src.schemas].filter((x) => !SUSPICION_TEXTS.has(x.text) && !MIRROR_TEXTS.has(x.text)).sort((a, b) => b.strength - a.strength).find((x) => x.origin?.some((o) => src.episodes.some((e) => e.id === o)));
        const ep = s && src.episodes.find((e) => s.origin!.includes(e.id));
        return s && ep ? { src, s, ep } : undefined;
      };
      const past = pastOf(MM) ?? pastOf(M);
      const episodes: Episode[] = [];
      const schemas: Schema[] = [];
      if (past) {
        const fid = `ep_${id}_past`;
        episodes.push(episode({ id: fid, tick: WORLD_START - Math.round(4 + rand(ns) * 10) * 64 * DAY, gist: past.ep.gist, template: "", about: [], topics: [...past.ep.topics.filter((t) => t !== "stories")], valence: past.ep.valenceAtEncoding, arousal: past.ep.arousal, rehearsed: [WORLD_START - 30 * DAY], agency: past.ep.agency }));
        schemas.push({ id: `sch_${id}_past`, text: past.s.text, triggers: [...past.s.triggers], blameBias: past.s.blameBias, threatBias: past.s.threatBias, strength: Number((past.s.strength * 0.8).toFixed(2)), origin: [fid] });
        made.pasts[id] = { outer: past.src.id, name: past.src.name, episode: past.ep.id, gist: past.ep.gist, belief: past.s.text };
      }
      const nn = traits.neuroticism;
      episodes.push(
        episode({
          id: WAKING,
          tick: WORLD_START - DAY + 6 * 60,
          gist: `I woke on the sand at ${name} with the others, and none of us could say how we came there.`,
          template: `I woke on the sand at ${name} {how}, and {moment}.`,
          details: [
            ["how", nn > 0.55 ? "cold and afraid" : "with the tide at my feet", nn > 0.55 ? -0.5 : 0.1],
            ["moment", pick(ns, ["none of us could say how we came there", "the gulls were already crying", "nobody remembered a boat", "the sea was flat as a table"]), -0.2],
          ],
          about: [],
          topics: ["founding", "crossing", "waking", "shore"],
          valence: Number((0.1 - nn * 0.4).toFixed(2)),
          arousal: Number((0.4 + nn * 0.3).toFixed(2)),
          rehearsed: [WORLD_START + 2 * DAY],
          agency: "circumstance",
        }),
      );
      const goals: Goal[] = [
        { id: `g_${id}_roof`, text: "Get a roof over the household before winter", tags: ["house", "build", "winter", "shelter"], priority: 0.8, progress: 0.05, invested: 0.2, rate: 0 },
        { id: `g_${id}_fed`, text: "Keep the household fed", tags: ["food", "store", "hunger", "winter"], priority: 0.75, progress: 0.3, invested: 0.2, rate: 0 },
      ];
      const mind = baseMind(
        {
          id,
          name: first,
          pronouns,
          identity: { summary: `${first} ${surname}, ${age}. Woke on the shore at ${name} with the others and ${TRADES[role]}.`, voice: traits.extraversion > 0.6 ? "Talkative, quick to wonder aloud." : traits.extraversion < 0.35 ? "Few words, chosen carefully." : "Plain and steady." },
          traits,
          attachment: { anxiety: Number((0.2 + nn * 0.5).toFixed(2)), avoidance: Number((0.15 + (1 - traits.agreeableness) * 0.4).toFixed(2)) },
          needs: { autonomy: 0.6, competence: 0.5, relatedness: 0.5, energy: 0.85 },
          goals,
          self: { selfEsteem: 0.5, selfEfficacy: 0.55, control: 0.5, lifeStory: `I woke here. ${past ? past.ep.gist : ""}`.trim() },
          others: { visitor: other("visitor", "the visitor", 0.5, 0.5, 0) },
          episodes,
          beliefs: [],
          habits: [{ id: `hab_${id}_fire`, cue: "fire", action: "social", strength: Number((traits.extraversion * 0.6).toFixed(2)) }],
          schemas,
          mood: Number((0.1 - nn * 0.15).toFixed(2)),
          stress: 0.25,
        },
        (Math.imul(seed + 101 + i, 2654435761) ^ 0x2c1b3c6d) >>> 0,
        M.ablations,
      );
      mind.tick = WORLD_START;
      minds[id] = mind;
      const home = `home_${hid}`;
      agents[id] = { id, name: first, role, place: "harbour", activity: "just woken on the shore", home, routine: routineFor(role, home), wants: [], lastTalk: {}, told: [] };
      order.push(id);
      members.push(id);
      made.models[id] = { outer: model.id, name: model.name };
    }
    households.push({ id: hid, name: `the ${surname}s`, members, home: `home_${hid}`, food: 4 * members.length, shelter: "tent", rate: 0 });
  }
  for (const id of order) {
    const hh = households.find((h) => h.members.includes(id))!;
    for (const o of order) {
      if (o === id) continue;
      const kin = hh.members.includes(o);
      minds[id]!.others[o] = kin ? other(o, minds[o]!.name, 0.75, 0.7 + rand(ns) * 0.2, 0.6, 0.4) : other(o, minds[o]!.name, 0.45 + rand(ns) * 0.15, 0.42 + rand(ns) * 0.18, 0.1, 0);
    }
  }
  const from: VillageState = { season: "summer", seasonDays: w.village!.seasonDays, weather: "fair", blight: false, stock: { timber: 0, stone: 0, reeds: 0 }, store: { food: 0, log: [] }, households: {}, structures: [], pledges: [], last: { meal: 0, fireside: 0, weather: 1, tentNight: 0, bedtime: 0 }, told: [], pending: [], life: {}, norms: [] };
  const world = foundVillage({ name, town: `${w.village!.town ?? w.name}~${depth}`, seed, tick: WORLD_START, rng: seed ^ 0x51ed27, from, households, minds, agents, order, food: 8, founding: WAKING });
  const yearTicks = world.village!.seasonDays * 4 * DAY;
  for (const id of order) world.village!.life[id] = { born: WORLD_START - ages[id]! * yearTicks, parents: [], generation: 0, arrived: WORLD_START };
  seedKnowledge(world);
  const agg = dematerialize(world);
  agg.village!.popCap = POP_CAP[depth];
  const ins = nestedOf(agg);
  ins.depth = depth;
  ins.made = made;
  return agg;
}

// ------------------------------------------------------------------ running the world inside

interface Tending {
  slip: number;
  why: LevelWhy[];
  hand?: { sign: 1 | -1; why: LevelWhy[] };
}

/** How well the engine is tended this season, from what is happening to its keepers. */
function tending(w: WorldState, ns: NestedState, m: Machine): Tending {
  const v = w.village!;
  const why: LevelWhy[] = [];
  let slip = 0.03;
  const ks = m.keepers.map((k) => w.minds[k.id]!);
  const energy = ks.reduce((s, k) => s + k.needs.energy, 0) / (ks.length || 1);
  if (v.season === "winter") {
    slip += 0.07;
    why.push({ level: ns.depth, world: w.name, text: `It was winter in ${w.name}, the gale season, and the keepers spent the short days at the boats and the woodpile.` });
  }
  if (energy < 0.4) {
    slip += 0.15;
    why.push({ level: ns.depth, world: w.name, text: `The keepers were hungry and worn out (energy ${f2(energy)}).` });
  }
  if (ks.length === 1) {
    slip += 0.04;
    why.push({ agent: m.keepers[0]!.id, level: ns.depth, world: w.name, text: `Only ${ks[0]!.name} knows how to tend it.` });
  }
  if (!why.length) why.push({ level: ns.depth, world: w.name, text: "Beads slip now and then, however well the engine is tended." });
  // The keeper's hand: someone who tends it in a black mood, or a bright one, leaves it in the season inside.
  const K = ks[0]!;
  const mood = K.affect.mood.valence;
  let hand: Tending["hand"];
  if (Math.abs(mood) > 0.25 && rand(ns) < 0.5) {
    const since = w.tick - v.seasonDays * DAY * 2;
    const cause = [...K.episodes].filter((e) => e.tick >= since && Math.sign(e.valence) === Math.sign(mood) && !e.id.startsWith("ep_engine_")).sort((a, b) => Math.abs(b.valence) * (0.3 + b.arousal) - Math.abs(a.valence) * (0.3 + a.arousal))[0];
    hand = {
      sign: mood < 0 ? -1 : 1,
      why: [
        { agent: K.id, level: ns.depth, world: w.name, text: `${K.name} tended the engine that season ${mood < 0 ? "in a black mood" : "in high spirits"} (mood ${f2(mood)}).` },
        ...(cause ? [{ agent: K.id, episode: cause.id, level: ns.depth, world: w.name, text: `${K.name} had on ${K.pronouns.possessive} mind: "${unstop(cause.gist)}".` }] : []),
      ],
    };
  }
  return { slip, why, hand };
}

async function run(w: WorldState, ns: NestedState, m: Machine, faculties: Faculties, sink: Sink, store?: Record<string, WorldState>): Promise<void> {
  const inner = innerOf(m, store);
  if (!inner) return;
  const t = tending(w, ns, m);
  for (let i = 0; i < m.ratio; i++) {
    const slip = rand(ns) < t.slip;
    await innerSeason(inner, faculties, { slip, why: t.why, hand: i === 0 ? t.hand : undefined, parent: w, parentDepth: ns.depth });
    m.tended++;
    if (slip) m.slipped++;
  }
  // Word from inside: the keepers read the beads.
  const ins = nestedOf(inner);
  const fresh = ins.history.filter((e) => e.news && Number(e.id.slice(1)) > m.read);
  if (ins.history.length) m.read = Math.max(m.read, ...ins.history.map((e) => Number(e.id.slice(1))));
  for (const e of fresh) mirror(w, ns, m, inner, e, sink);
}

/** One season inside: run it on rules (or lose it to a slipped bead), then see what its people noticed. */
async function innerSeason(inner: WorldState, faculties: Faculties, ctx: { slip: boolean; why: LevelWhy[]; hand?: Tending["hand"]; parent: WorldState; parentDepth: number }): Promise<void> {
  const v = inner.village!;
  const ins = nestedOf(inner);
  const sink: Sink = { feed: [], traces: [] };
  if (ctx.slip) {
    const lost = SEASONS[(SEASONS.indexOf(v.season) + 1) % 4]!;
    inner.tick += v.seasonDays * DAY;
    v.season = seasonOf(v, inner.tick);
    // Everyone is a season older, and nobody lived it.
    lostSeason(inner, ins, lost, ctx);
  } else {
    await aggAdvance(inner, v.seasonDays * DAY, faculties, sink);
  }
  for (const f of sink.feed) if (f.kind === "event" || f.kind === "insight") ins.feed.push(f);
  if (ctx.hand) hand(inner, ins, ctx.hand, ctx);
  if (sink.feed.some((f) => /^A boat brings/.test(f.title))) boat(inner, ins, ctx);
  falsePast(inner, ins, ctx);
  if (v.season === "autumn") repeat(inner, ins, ctx);
  spread(inner, SUSPICION_TEXTS);
  milestones(inner, ins);
  // And in there, the same can begin again.
  const deep: Sink = { feed: [], traces: [] };
  await nestedSeason(inner, faculties, deep);
  for (const f of deep.feed) ins.feed.push(f);
  if (ins.feed.length > 80) ins.feed.splice(0, ins.feed.length - 80);
}

// ------------------------------------------------------------------ signs

/** How someone reads a sign, by temperament: dread, faith, or rules. */
export function flavorOf(w: WorldState, id: AgentId): Flavor {
  const t = w.minds[id]!.traits;
  const counts = PATTERN.some((c) => knows(w, id, c));
  if ((t.openness >= 0.6 && t.neuroticism < 0.5) || (counts && t.openness >= 0.5 && t.neuroticism < 0.55)) return "rules";
  if (t.neuroticism >= 0.5 || t.agreeableness < 0.45) return "dread";
  return "faith";
}

/** Someone's suspicion: the strongest of the three core beliefs they hold, if any. */
export function suspicionOf(m: MindState): { flavor: Flavor; strength: number; schema: Schema } | undefined {
  const s = m.schemas.filter((x) => SUSPICION_TEXTS.has(x.text)).sort((a, b) => b.strength - a.strength)[0];
  if (!s) return undefined;
  const flavor = (Object.keys(SUSPICIONS) as Flavor[]).find((k) => SUSPICIONS[k].text === s.text)!;
  return { flavor, strength: s.strength, schema: s };
}

const signMemories = (m: MindState) => m.episodes.filter((e) => e.topics.includes("sign")).length;

function sign(inner: WorldState, ins: NestedState, o: { kind: SignKind; title: string; text: string; mine: (id: AgentId) => string; noticed: AgentId[]; wonder: (id: AgentId) => number; why: LevelWhy[]; personal?: boolean }): Sign | undefined {
  if (!o.noticed.length) return undefined;
  // The first boat from nowhere is a wonder; by the fifth, boats just come (habituation).
  const seen = o.personal ? 0 : ins.signs.filter((x) => x.kind === o.kind).length;
  const fresh = Math.max(0.08, 0.55 ** seen);
  const s: Sign = { id: `s${++ins.idCounter}`, tick: inner.tick, year: yearOf(inner), kind: o.kind, title: o.title, text: o.text, noticed: o.noticed, wondered: [], why: o.why };
  for (const id of o.noticed) {
    const M = inner.minds[id]!;
    const fl = flavorOf(inner, id);
    const prior = signMemories(M);
    const ep = remember(M, inner.tick, `ep_sign_${s.id}`, o.mine(id), ["sign", "world", "sky", o.kind], SUSPICIONS[fl].valence, 0.55, "circumstance");
    if (rand(ins) < clamp((o.wonder(id) + 0.05 * prior) * fresh)) {
      believe(M, SUSPICIONS[fl], ep.id, Math.min(0.45, 0.22 + 0.05 * prior));
      s.wondered.push(id);
    }
  }
  ins.signs.push(s);
  if (ins.signs.length > 80) ins.signs.splice(0, ins.signs.length - 80);
  const first = !ins.reached.includes("sign");
  if (first) ins.reached.push("sign");
  event(inner, ins, { kind: "sign", title: o.title, text: o.text, agents: o.noticed.slice(0, 3), why: o.why, news: first });
  return s;
}

function lostSeason(inner: WorldState, ins: NestedState, lost: Season, ctx: { why: LevelWhy[]; parent: WorldState; parentDepth: number }): void {
  const d = ins.depth;
  const now = inner.village!.season;
  const before = SEASONS[(SEASONS.indexOf(lost) + 3) % 4]!;
  sign(inner, ins, {
    kind: "lost-season",
    title: `There was no ${lost} in ${inner.name} this year`,
    text: `${cap(before)} ended, and it was ${now}. Everyone is a season older and nobody lived it.`,
    mine: () => `There was no ${lost} this year. ${cap(before)} ended, and the next morning it was ${now}.`,
    noticed: inner.order.filter((id) => ageOf(inner, id) >= 8),
    wonder: (id) => (isChild(inner, id) ? 0.05 : 0.2 + 0.45 * inner.minds[id]!.traits.openness),
    why: [{ level: ctx.parentDepth, world: ctx.parent.name, text: `A bead slipped in the engine in ${ctx.parent.name}, and ${inner.name} skipped a season.` }, ...ctx.why, { level: d, world: inner.name, text: `Nothing inside ${inner.name} could cause it: the season was never run.` }],
  });
}

function hand(inner: WorldState, ins: NestedState, h: NonNullable<Tending["hand"]>, ctx: { parent: WorldState; parentDepth: number }): void {
  const v = inner.village!;
  for (const hh of Object.values(v.households)) hh.food = Number((hh.food * (h.sign < 0 ? 0.6 : 1.4) + (h.sign > 0 ? 2 : 0)).toFixed(2));
  const farm = v.season === "summer" || v.season === "autumn";
  const title = h.sign < 0 ? (farm ? `The barley rots in the ear in ${inner.name}, with no blight anyone can see` : `The nets come up empty in ${inner.name} on a flat calm sea`) : farm ? `${inner.name}'s barley comes in twice as heavy as anyone sowed` : `The nets come up full in ${inner.name} in the dead of ${v.season}`;
  sign(inner, ins, {
    kind: "hand",
    title,
    text: h.sign < 0 ? "Food that was there is gone, and nothing in the world took it." : "Food that nobody grew or caught is there in the stores.",
    mine: () => (h.sign < 0 ? (farm ? "The barley rotted in the ear with no blight on it. Something reached in and spoiled it." : "The nets came up empty on a calm sea, day after day, as if the fish had been taken away.") : farm ? "The barley came in twice as heavy as we sowed, as if someone had added to it." : "The nets came up full in the dead of winter, as if someone had put the fish there."),
    noticed: adultsOf(inner),
    wonder: (id) => 0.12 + 0.4 * inner.minds[id]!.traits.openness,
    why: [...h.why, { level: ctx.parentDepth, world: ctx.parent.name, text: `What a keeper feels goes into how the beads are set: the season inside ${inner.name} ${h.sign < 0 ? "lost" : "gained"} food with nothing inside to account for it.` }],
  });
}

function boat(inner: WorldState, ins: NestedState, ctx: { parent: WorldState; parentDepth: number }): void {
  sign(inner, ins, {
    kind: "boat",
    title: `A boat comes to ${inner.name} from past the edge of the sea`,
    text: "Strangers come ashore remembering towns nobody has heard of. There is no other shore.",
    mine: () => "A boat came in with strangers in it, from past the edge of the sea. There is nothing past the edge of the sea.",
    noticed: adultsOf(inner).filter((id) => (inner.village!.life[id]?.arrived ?? 0) < inner.tick - 1),
    wonder: (id) => 0.1 + 0.35 * inner.minds[id]!.traits.openness,
    why: [
      { level: ctx.parentDepth, world: ctx.parent.name, text: `The engine in ${ctx.parent.name} runs ${inner.name} on the same rules as a real town, and those rules send newcomers by boat some springs.` },
      { level: ins.depth, world: inner.name, text: `Inside the engine there is no other shore for them to come from. The towns they remember are made up whole.` },
    ],
  });
}

/** The first generation remember a past their world has no room for: it belongs to someone outside. */
function falsePast(inner: WorldState, ins: NestedState, ctx: { parent: WorldState; parentDepth: number }): void {
  const made = ins.made;
  if (!made || yearOf(inner) > 5) return;
  for (const id of inner.order) {
    const past = made.pasts[id];
    const M = inner.minds[id]!;
    if (!past || isChild(inner, id) || M.traits.openness < 0.45 || M.episodes.some((e) => e.id.startsWith("ep_sign_") && e.topics.includes("false-past"))) continue;
    if (rand(ins) > 0.03 + 0.1 * M.traits.openness) continue;
    const place = /\b(?:in|at|from) ((?:the )?[A-Z][\w']+(?: [A-Z][\w']+)?)/.exec(past.gist)?.[1];
    const where = place ?? "the place in that memory";
    sign(inner, ins, {
      kind: "false-past",
      title: `${M.name} remembers ${where}, and there is no ${where.replace(/^the /, "")}`,
      text: `${M.name} remembers "${unstop(past.gist)}" as clearly as yesterday, but nobody in ${inner.name} has ever seen a road to anywhere.`,
      mine: () => `I remember it as clearly as yesterday: ${unstop(past.gist).replace(/^./, (c) => c.toLowerCase())}. But there is no ${where.replace(/^the /, "")} here, and no road to anywhere.`,
      noticed: [id],
      personal: true,
      wonder: () => 0.35 + 0.4 * M.traits.openness,
      why: [
        { agent: past.outer, episode: past.episode, level: ctx.parentDepth, world: ctx.parent.name, text: `${made.makerName} built ${M.name} with ${past.outer === made.maker ? `${made.makerName}'s own` : `${past.name}'s`} memory: "${unstop(past.gist)}".` },
        { level: ins.depth, world: inner.name, text: `There is no ${where.replace(/^the /, "")} inside the engine: it holds one shore and the sea around it.` },
        { agent: id, level: ins.depth, world: inner.name, text: `${M.name} is curious enough to ask where the road went (openness ${f2(M.traits.openness)}).` },
      ],
    });
  }
}

/** On the aggregate tier every winter is the same winter: someone who keeps count will see it. */
function repeat(inner: WorldState, ins: NestedState, ctx: { parent: WorldState; parentDepth: number }): void {
  const y = yearOf(inner);
  const last = [...ins.signs].reverse().find((s) => s.kind === "repeat");
  if (y < 3 || (last && y - last.year < 4)) return;
  const counters = adultsOf(inner).filter((id) => PATTERN.some((c) => knows(inner, id, c)) && !inner.minds[id]!.episodes.some((e) => e.topics.includes("repeat")));
  const pool = counters.length ? counters : adultsOf(inner).filter((id) => inner.minds[id]!.traits.conscientiousness > 0.6);
  for (const id of pool) {
    const M = inner.minds[id]!;
    if (rand(ins) > 0.05 + 0.2 * M.traits.openness) continue;
    const c = PATTERN.find((x) => knows(inner, id, x));
    sign(inner, ins, {
      kind: "repeat",
      title: `${M.name} finds every winter in ${inner.name} the same, to the bead`,
      text: `${M.name} has kept count for years: the gales take the same share of days every winter, and every summer's catch is the same.`,
      mine: () => "I have kept count for years. The gales take the same share of days every winter, to the day, and every summer is the same summer. Real weather is not like that.",
      noticed: [id],
      personal: true,
      wonder: () => 0.4 + 0.4 * M.traits.openness,
      why: [
        { level: ctx.parentDepth, world: ctx.parent.name, text: `The engine in ${ctx.parent.name} runs ${inner.name} a season at a time, on rules (the aggregate tier): the same share of days lost to gales every winter, the same yields every summer.` },
        { agent: id, level: ins.depth, world: inner.name, text: c ? `${M.name} knows ${craft(c).name}, so ${M.pronouns.subject} ${M.pronouns.subject === "they" ? "keep" : "keeps"} count (openness ${f2(M.traits.openness)}).` : `${M.name} is careful enough to keep count of everything (conscientiousness ${f2(M.traits.conscientiousness)}).` },
      ],
    });
    break;
  }
}

/** At the fire: those who hold one of these beliefs tell someone who doesn't, and it may take. */
function spread(w: WorldState, texts: Set<string>): void {
  const ns = nestedOf(w);
  const pool = w.order.filter((id) => ageOf(w, id) >= 12);
  const holds = (id: AgentId) => w.minds[id]!.schemas.find((s) => texts.has(s.text) && s.strength >= 0.25);
  for (const t of pool) {
    const s = holds(t);
    const T = w.minds[t]!;
    if (!s || rand(ns) > 0.12 + 0.35 * T.traits.extraversion) continue;
    const listeners = pool.filter((x) => x !== t && !w.minds[x]!.schemas.some((y) => texts.has(y.text)) && (T.others[x]?.liking ?? 0.5) >= 0.35);
    if (!listeners.length) continue;
    const l = listeners[Math.floor(rand(ns) * listeners.length)]!;
    const told = T.episodes.find((e) => s.origin?.includes(e.id));
    if (!told) continue;
    const L = w.minds[l]!;
    const liking = L.others[t]?.liking ?? 0.5;
    implant(w, t, told, l, Number((0.08 + 0.35 * L.traits.openness * (0.5 + liking)).toFixed(2)), ["sign"]);
  }
}

function milestones(inner: WorldState, ins: NestedState): void {
  const adults = adultsOf(inner);
  const held = adults.map((id) => ({ id, s: suspicionOf(inner.minds[id]!) })).filter((x) => x.s && x.s.strength >= 0.25);
  const once = (k: string) => {
    if (ins.reached.includes(k)) return false;
    ins.reached.push(k);
    return true;
  };
  const whyOf = (id: AgentId): LevelWhy[] => {
    const s = suspicionOf(inner.minds[id]!)!;
    const chain = schemaLineage(inner, id, s.schema);
    const root = chain.at(-1);
    const sg = root ? ins.signs.find((x) => root.episode === `ep_sign_${x.id}`) : undefined;
    const out: LevelWhy[] = [];
    if (chain.length > 1) out.push({ agent: id, level: ins.depth, world: inner.name, text: `${inner.minds[id]!.name} heard it from ${chain.slice(1).map((c) => personName(inner, c.agent)).join(", then from ")}.` });
    if (sg) out.push({ agent: root!.agent, episode: root!.episode, level: ins.depth, world: inner.name, text: `It started with a sign ${personName(inner, root!.agent)} saw in year ${sg.year}: ${sg.title}.` }, ...sg.why);
    return out;
  };
  const first = held.sort((a, b) => b.s!.strength - a.s!.strength)[0];
  if (first && once("believer")) {
    const M = inner.minds[first.id]!;
    const fl = first.s!.flavor;
    const says = fl === "faith" ? "someone made the world and watches over it" : fl === "dread" ? "something beyond the sky turns the world, and does not care" : "the world runs on rules, like beads on a frame";
    event(inner, ins, { kind: "believer", title: `In ${inner.name}, ${M.name} says ${says}`, text: `${M.name} is the first in ${inner.name} to say it aloud.`, agents: [first.id], why: [{ agent: first.id, level: ins.depth, world: inner.name, text: `${M.name} reads it as ${fl} (${traitLine(M, "openness", "neuroticism", "agreeableness")}).` }, ...whyOf(first.id)], news: true });
  }
  const rules = held.find((x) => x.s!.flavor === "rules");
  if (rules && once("rules")) {
    const M = inner.minds[rules.id]!;
    event(inner, ins, { kind: "rules", title: `${M.name} guesses that ${inner.name} runs on rules, like beads on a frame`, text: `The nearest anyone inside has come to the truth.`, agents: [rules.id], why: whyOf(rules.id), news: true });
  }
  if (adults.length >= 4 && held.length >= adults.length / 2 && once("half")) {
    event(inner, ins, { kind: "half", title: `Half of ${inner.name} believe their world was made`, text: `${held.length} of ${adults.length} adults hold it.`, agents: held.slice(0, 3).map((x) => x.id), why: [], news: true });
  }
  const by = (f: Flavor) => held.filter((x) => x.s!.flavor === f).length;
  const schools = (Object.keys(SUSPICIONS) as Flavor[]).filter((f) => by(f) >= 2);
  if (schools.length >= 2 && once("schools")) {
    event(inner, ins, { kind: "schools", title: `${inner.name} argues about what its maker is`, text: schools.map((f) => `${by(f)} think it ${SUSPICIONS[f].maker}`).join("; ") + ".", agents: [], why: [], news: false });
  }
}

/** The keepers read the beads: word of what the people inside are saying reaches them. */
function mirror(w: WorldState, ns: NestedState, m: Machine, inner: WorldState, e: NestedEvent, sink: Sink): void {
  if (!["believer", "rules", "half", "turns"].includes(e.kind)) return;
  const what =
    e.kind === "turns" ? `the people inside our engine have built an engine of their own, and there is a world inside it` : e.kind === "rules" ? `someone inside the engine has guessed their world runs on rules, like beads on a frame` : e.kind === "half" ? `half the people inside the engine believe their world was made` : `the people inside the engine have started saying someone made their world`;
  const firstMirror = !ns.reached.includes("mirror");
  const wondering: AgentId[] = [];
  for (const k of m.keepers) {
    const K = w.minds[k.id];
    if (!K) continue;
    const fl: "dread" | "faith" = K.traits.neuroticism >= 0.5 ? "dread" : "faith";
    const ep = remember(K, w.tick, `ep_engine_${e.id}_${inner.name.replace(/\W/g, "")}`, `Reading the beads, I saw ${what}.${K.id === m.maker ? " I made that world." : ""}`, ["engine", "world", "maker", "sky", "sign"], MIRROR[fl].valence, 0.65, "circumstance");
    if (rand(ns) < 0.25 + 0.5 * K.traits.openness) {
      // Someone who already wonders only wonders more; the town hears about it the first time.
      const before = K.schemas.some((x) => MIRROR_TEXTS.has(x.text));
      believe(K, MIRROR[fl], ep.id, 0.3);
      if (!before) wondering.push(k.id);
    }
  }
  if (!wondering.length) return;
  const K = w.minds[wondering[0]!]!;
  const fl: "dread" | "faith" = K.traits.neuroticism >= 0.5 ? "dread" : "faith";
  const why: LevelWhy[] = [
    { level: ns.depth + 1, world: inner.name, text: e.title + "." },
    ...e.why.slice(0, 4),
    { agent: K.id, level: ns.depth, world: w.name, text: `${K.name} keeps the engine and read it in the beads, and is open enough to turn it on ${w.name} (openness ${f2(K.traits.openness)}).` },
  ];
  const title = fl === "dread" ? `${K.name} wonders whether ${w.name} is inside someone's engine too` : `${K.name} wonders whether someone made ${w.name}, the way ${w.name} made ${inner.name}`;
  if (firstMirror) ns.reached.push("mirror");
  event(w, ns, { kind: "mirror", title, text: `Reading the beads, ${K.name} saw ${what.replace(/\bour\b/, "the")}.`, agents: wondering, why, news: ns.depth > 0 });
  feed(w, sink, { kind: "event", agents: wondering, title, text: why.map((x) => x.text).join(" "), chronicle: ns.depth === 0 && (firstMirror || e.kind === "turns") ? { kind: "engine", why } : undefined });
}

// ------------------------------------------------------------------ reading it (for the game and the lab)

/** The world at a depth of a real town's engine chain: 0 is the town itself. */
export function worldAt(top: WorldState, store: Record<string, WorldState> | undefined, depth: number): WorldState | undefined {
  let w: WorldState | undefined = top;
  for (let d = 0; d < depth && w; d++) {
    const m: Machine | undefined = w.village?.nested?.machine;
    w = m ? innerOf(m, store) : undefined;
  }
  return w;
}

export interface MachineSummary {
  stage: Machine["stage"];
  progress: number;
  maker: AgentId;
  makerName: string;
  keepers: { id: AgentId; name: string; from?: string }[];
  built?: Tick;
  inner?: string;
  tended: number;
  slipped: number;
  need: Machine["need"];
  have: Machine["have"];
  asks: { year: number; yes: number; no: number; passed: boolean }[];
}

function machineSummary(w: WorldState, m: Machine, store?: Record<string, WorldState>): MachineSummary {
  const year = (t: Tick) => Math.floor((Math.floor(t / DAY)) / (w.village!.seasonDays * 4)) + 1;
  return {
    stage: m.stage,
    progress: m.progress,
    maker: m.maker,
    makerName: m.makerName,
    keepers: m.keepers.map((k) => ({ id: k.id, name: k.name, from: k.from ? personName(w, k.from) : undefined })),
    built: m.built,
    inner: innerOf(m, store)?.name,
    tended: m.tended,
    slipped: m.slipped,
    need: m.need,
    have: m.have,
    asks: m.asks.map((a) => ({ year: year(a.tick), yes: a.yes.length, no: a.no.length, passed: a.passed })),
  };
}

export interface Level {
  depth: number;
  name: string;
  year: number;
  season: string;
  people: number;
  /** Adults who hold one of the three readings (strength 0.25 or more), of all adults. */
  believers: number;
  adults: number;
  machine?: MachineSummary;
}

export interface EngineChain {
  town: string;
  townName: string;
  levels: Level[];
}

function levelOf(w: WorldState, depth: number, store?: Record<string, WorldState>): Level {
  const ns = w.village?.nested;
  const adults = adultsOf(w);
  return {
    depth,
    name: w.name,
    year: yearOf(w),
    season: w.village!.season,
    people: w.order.length,
    believers: adults.filter((id) => (suspicionOf(w.minds[id]!)?.strength ?? 0) >= 0.25 || w.minds[id]!.schemas.some((s) => MIRROR_TEXTS.has(s.text) && s.strength >= 0.25)).length,
    adults: adults.length,
    machine: ns?.machine ? machineSummary(w, ns.machine, store) : undefined,
  };
}

/** Every real town that has started counting, with the chain of worlds inside its engine. */
export function engines(towns: { id: string; world: WorldState }[], store?: Record<string, WorldState>): EngineChain[] {
  const out: EngineChain[] = [];
  for (const t of towns) {
    if (!t.world.village?.nested?.machine) continue;
    const levels: Level[] = [];
    for (let d = 0; d <= MAX_DEPTH; d++) {
      const w = worldAt(t.world, store, d);
      if (!w) break;
      levels.push(levelOf(w, d, store));
    }
    out.push({ town: t.id, townName: t.world.name, levels });
  }
  return out;
}

export interface InnerPerson {
  id: AgentId;
  name: string;
  age: number;
  role: string;
  generation: number;
  traits: Traits;
  modelledOn?: { outer: AgentId; name: string };
  past?: Making["pasts"][string];
  suspicion?: { flavor: Flavor; strength: number; text: string; maker: string };
  mirror?: { text: string; strength: number };
  signs: number;
  keeper: boolean;
}

export interface NestedWorldView {
  town: string;
  depth: number;
  name: string;
  year: number;
  season: string;
  people: InnerPerson[];
  signs: Sign[];
  history: NestedEvent[];
  feed: FeedItem[];
  machine?: MachineSummary;
  made?: Making & { comparison: { flavor: Flavor; holders: number; guess: string }[]; truth: string };
  /** The chain this world sits in, top first: names and depths, for the breadcrumb. */
  path: { depth: number; name: string }[];
}

export function personOf(w: WorldState, id: AgentId): InnerPerson {
  const M = w.minds[id]!;
  const ns = w.village?.nested;
  const s = suspicionOf(M);
  const mi = M.schemas.filter((x) => MIRROR_TEXTS.has(x.text)).sort((a, b) => b.strength - a.strength)[0];
  return {
    id,
    name: M.name,
    age: Math.floor(ageOf(w, id)),
    role: w.agents[id]?.role ?? "",
    generation: w.village!.life[id]?.generation ?? 0,
    traits: M.traits,
    modelledOn: ns?.made?.models[id],
    past: ns?.made?.pasts[id],
    suspicion: s && { flavor: s.flavor, strength: s.strength, text: s.schema.text, maker: SUSPICIONS[s.flavor].maker },
    mirror: mi && { text: mi.text, strength: mi.strength },
    signs: signMemories(M),
    keeper: !!ns?.machine?.keepers.some((k) => k.id === id),
  };
}

export function nestedWorldView(top: WorldState, town: string, store: Record<string, WorldState> | undefined, depth: number): NestedWorldView | undefined {
  const w = worldAt(top, store, depth);
  if (!w?.village) return undefined;
  const ns = nestedOf(w);
  const people = w.order.map((id) => personOf(w, id));
  let made: NestedWorldView["made"];
  if (ns.made) {
    const parent = worldAt(top, store, depth - 1)!;
    const pm = parent.village?.nested?.machine;
    const holders = (f: Flavor) => people.filter((p) => p.age >= 16 && p.suspicion?.flavor === f && p.suspicion.strength >= 0.25).length;
    const t = ns.made.makerTraits;
    const keepers = pm?.keepers.map((k) => k.name) ?? [];
    made = {
      ...ns.made,
      comparison: (Object.keys(SUSPICIONS) as Flavor[]).map((f) => ({ flavor: f, holders: holders(f), guess: SUSPICIONS[f].maker })),
      truth: `${ns.made.makerName} made them (agreeableness ${f2(t.agreeableness)}, neuroticism ${f2(t.neuroticism)}, openness ${f2(t.openness)}). ${keepers.length ? `${keepers.join(", ")} tend${keepers.length === 1 ? "s" : ""} it now` : "Nobody tends it now"}${pm ? `; ${pm.slipped} of ${pm.tended} seasons have slipped` : ""}. It is a frame of beads with rules, run by people who are not watching most of the time.`,
    };
  }
  const path: { depth: number; name: string }[] = [];
  for (let d = 0; d <= depth; d++) path.push({ depth: d, name: worldAt(top, store, d)!.name });
  return {
    town,
    depth,
    name: w.name,
    year: yearOf(w),
    season: w.village.season,
    people,
    signs: [...ns.signs].reverse().slice(0, 30),
    history: [...ns.history].reverse().slice(0, 40),
    feed: [...ns.feed].reverse().slice(0, 30),
    machine: ns.machine ? machineSummary(w, ns.machine, store) : undefined,
    made,
    path,
  };
}

export interface NestedPersonView extends InnerPerson {
  world: string;
  depth: number;
  summary: string;
  /** In each chain, `given` marks a past the maker gave someone: they remember living it, and never did. */
  beliefs: { text: string; strength: number; chain: { agent: AgentId; name: string; gist: string; firstHand: boolean; given?: boolean }[]; sign?: Sign }[];
  memories: { id: string; gist: string; topics: string[]; valence: number; told?: string }[];
}

/** One person in a world inside an engine: their core beliefs, each traced back to where it started. */
export function nestedPersonView(top: WorldState, store: Record<string, WorldState> | undefined, depth: number, id: AgentId): NestedPersonView | undefined {
  const w = worldAt(top, store, depth);
  const M = w?.minds[id];
  if (!w || !M) return undefined;
  const ns = nestedOf(w);
  return {
    ...personOf(w, id),
    world: w.name,
    depth,
    summary: M.identity.summary,
    beliefs: [...M.schemas]
      .sort((a, b) => b.strength - a.strength)
      .map((s) => {
        const chain = schemaLineage(w, id, s).map((c) => ({ ...c, name: personName(w, c.agent), given: c.episode === `ep_${c.agent}_past` && !!ns.made?.pasts[c.agent] }));
        const root = chain.at(-1);
        const sg = root ? ns.signs.find((x) => root.episode === `ep_sign_${x.id}`) : undefined;
        return { text: s.text, strength: s.strength, chain, sign: sg };
      }),
    memories: [...M.episodes]
      .sort((a, b) => b.tick - a.tick)
      .slice(0, 14)
      .map((e) => ({ id: e.id, gist: e.gist, topics: e.topics, valence: e.valence, told: e.source.kind === "told" && e.source.from ? personName(w, e.source.from) : undefined })),
  };
}
