// The Voice: you, speaking into the world. You can walk in as a stranger and talk to one person, stand
// up as a prophet where people gather, speak to the whole town out of the sky, or send one person a
// dream. What you say is heard by minds (it goes through the same cognitive cycle as anything else,
// so it is appraised, remembered, and can scare someone), and then it is out of your hands.
//
// From there the words travel on their own, in conversations and at the fire, and they change as
// they go. Every change is made by a particular teller for a reason in that teller's mind, and the
// reason is recorded, so a version three hops out can be followed back to the grudge, the fear or the
// vanity that bent it:
//
// - Levelling and sharpening (Allport & Postman 1947): hedges and side details drop away, the core
//   gets bigger, faster when the teller is afraid.
// - Assimilation to what the teller already believes (Bartlett 1932): a bad omen picks up a culprit
//   from the teller's grudges (scapegoating; Girard 1986), a good one picks up a favourite.
// - Source inflation: who said it climbs from "a stranger" to "a prophet" to "the sky itself" as the
//   source is forgotten and filled in with what fits the content (source monitoring; Johnson,
//   Hashtroudi & Lindsay 1993).
// - Moralizing: a warning grows a condition ("unless we..."), and conditions become practices.
//
// Whether a listener believes it depends on who told them, how credulous and how frightened they
// are, whether it fits a fear they already have (error management; Haselton & Buss 2000), and how
// many people around them already believe (social proof; Asch 1956, Cialdini 1984).
//
// Prophecies are checked against what actually happens. A fulfilled one converts doubters. A failed
// one splits the believers the way Festinger, Riecken & Schachter (1956) saw it happen: the lightly
// committed drift away, the heavily committed with others around them double down, explain it away,
// and preach harder.
//
// Commands become practice: offerings that cost food, gatherings you can watch in 3D, taboos that
// keep fishers off the sea (and so change what the town eats). A practice most adults keep becomes a
// rite and joins the town's norms. Enough believers and a fulfilled sign or a rite make a faith, with
// a keeper who preaches at the fire. When a fervent believer's version of the words drifts far from
// the keeper's and they don't like each other, the faith splits (schism), and people follow the
// version they hold.
//
// All of this runs on its own random stream, so a world nobody speaks into runs exactly as before.

import { clamp } from "../memory.js";
import { dayOf, hourOf, runPercept } from "../mind.js";
import type { Faculties, Percept } from "../ports.js";
import { nextId, nextRandom } from "../rng.js";
import type { AgentId, MindState, Tick } from "../types.js";
import { isChild, normHeld } from "./life.js";
import type { PlaceId } from "./places.js";
import { householdOf } from "./village.js";
import { feed, isNight, personName, record, type FeedItem, type RumorHop, type Sink, type WorldState } from "./world.js";

// ------------------------------------------------------------------ types

export type Guise = "stranger" | "prophet" | "sky" | "dream";
export type ProphecyEvent = "gale" | "blight" | "hunger" | "death" | "birth";
export type BendKind = "source" | "deflated" | "levelled" | "sharpened" | "scapegoat" | "chosen" | "self" | "moralized" | "rationalized";

/** Who people say said it, from least to most authority. */
export const LADDER = ["a stranger", "a traveller who knew things", "a prophet", "a dream sent in the night", "a messenger from beyond the sea", "the sky itself", "the gods"];
const AUTHORITY = [0.3, 0.4, 0.55, 0.5, 0.65, 0.8, 0.85];
const START_RUNG: Record<Guise, number> = { stranger: 0, prophet: 2, dream: 3, sky: 5 };

/** One person's version of the words: what they would tell you if you asked. */
export interface Version {
  core: string;
  /** Rung on LADDER: who they think said it. */
  rung: number;
  /** A culprit the words picked up on the way. */
  blame?: AgentId;
  /** Someone the words picked up as favoured. */
  chosen?: AgentId;
  /** A condition the words grew ("unless we keep off the sea"). */
  unless?: string;
  /** Explained away after a prophecy failed. */
  held?: boolean;
}

/** One change made to the words on the way to someone, and the reason for it in the teller's mind. */
export interface Bend {
  kind: BendKind;
  text: string;
  /** The teller whose mind did it. */
  agent: AgentId;
  /** What in that mind did it: a belief, a core belief (schema), or how they feel about someone. */
  cause?: { kind: "belief" | "schema" | "relation" | "trait" | "emotion"; id: string; text: string };
}

export interface Carrier {
  agent: AgentId;
  /** Who they heard it from: a person, or "visitor" / "sky" / "dream" for you. */
  from: AgentId;
  tick: Tick;
  /** How many tellings from you. */
  depth: number;
  version: Version;
  /** What changed between the teller's version and this one. */
  bends: Bend[];
  /** How much they believe it, 0 to 1. */
  faith: number;
  belief: string;
  trace?: string;
  told: AgentId[];
  heardAgain: number;
  /** Days they kept the practice. */
  practiced: number;
  lastPractice?: number;
  lapsed?: Tick;
  doubled?: Tick;
}

export interface Practice {
  act: string;
  place: PlaceId;
  /** A rite is done at a time of day; a taboo keeps people away from a place during working hours. */
  kind: "rite" | "taboo";
  at?: "dawn" | "dusk";
  /** Costs the household food (an offering). */
  offering?: boolean;
  /** A taboo kept only every this many days (the seventh day). */
  every?: number;
}

export interface Word {
  id: string;
  tick: Tick;
  guise: Guise;
  text: string;
  place?: PlaceId;
  to?: AgentId;
  /** Waiting to be delivered: a prophet waiting for a crowd, a dream waiting for night. */
  pending?: boolean;
  subject?: AgentId;
  stance?: "accuse" | "praise";
  prophecy?: { event: ProphecyEvent; by: Tick; about?: AgentId; outcome?: "fulfilled" | "failed"; at?: Tick; how?: string };
  practice?: Practice;
  topics: string[];
  valence: number;
  carriers: Record<AgentId, Carrier>;
  hops: RumorHop[];
  /** Heard and believing, one sample a few hours. */
  curve: { tick: Tick; heard: number; believe: number }[];
  /** Committed believers preach harder until then (after a failed prophecy, or a fulfilled one). */
  zealUntil?: Tick;
  /** Days on which people kept its practice, and how many. */
  kept: Record<number, number>;
  rite?: Tick;
}

export interface Faith {
  id: string;
  name: string;
  founded: Tick;
  keeper: AgentId;
  members: AgentId[];
  /** The faith it split from. */
  parent?: string;
  /** The keeper's version of each word when the faith was founded (or split). */
  doctrine: Record<string, string>;
  /** Why it split, when it did. */
  split?: string;
  ended?: Tick;
}

export interface VoiceLog {
  tick: Tick;
  kind: "spoke" | "fulfilled" | "failed" | "rite" | "faith" | "schism" | "doubled" | "lapsed" | "crossed";
  text: string;
  word?: string;
  agents?: AgentId[];
}

export interface VoiceState {
  rng: number;
  idCounter: number;
  words: Word[];
  faiths: Faith[];
  log: VoiceLog[];
  /** People who saw a rite kept, and how many times. */
  witnessed: Record<AgentId, number>;
  seenFeed?: string;
  seenTick: Tick;
  last: { weather?: string; blight?: boolean; events: number; dawn: number; dusk: number; taboo: number; fire: number; sample: number; day: number };
}

export type VoiceAct =
  | { act: "speak"; guise: Guise; text: string; to?: AgentId; place?: PlaceId }
  /** Make a prophecy come true: send the gale or the blight you foretold. */
  | { act: "fulfil"; word: string };

// ------------------------------------------------------------------ setup and helpers

export function voiceOf(world: WorldState): VoiceState {
  return (world.voice ??= {
    rng: (world.seed * 2971215073 + 0x5eed) >>> 0,
    idCounter: 0,
    words: [],
    faiths: [],
    log: [],
    witnessed: {},
    seenTick: world.tick,
    last: { weather: world.village?.weather, blight: world.village?.blight, events: world.events.length, dawn: 0, dusk: 0, taboo: 0, fire: 0, sample: 0, day: dayOf(world.tick) },
  });
}

const rand = (v: VoiceState) => nextRandom(v);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const name = (w: WorldState, id: string) => (id === "visitor" ? "you" : id === "sky" ? "the sky" : id === "dream" ? "a dream" : personName(w, id));
const adult = (w: WorldState, id: AgentId) => !w.village || !isChild(w, id);
const adults = (w: WorldState) => w.order.filter((id) => adult(w, id));
const placeName = (w: WorldState, p: PlaceId) => w.places[p]?.name ?? p;
const hasPlace = (w: WorldState, p: PlaceId) => !!w.places[p];
const YOU = new Set(["visitor", "sky", "dream"]);

/** Who's really still with it: believes enough to act on it and hasn't fallen away. */
const believes = (c: Carrier) => c.faith >= 0.45 && !c.lapsed;

/** How easily this person takes the uncanny on trust: openness, agreeableness, and how unsettled they are now (Hogg 2007). */
function credulity(m: MindState): number {
  const t = m.traits;
  return clamp(0.08 + 0.25 * t.openness + 0.15 * t.agreeableness + 0.2 * m.affect.stress + 0.12 * t.neuroticism - 0.35 * (t.conscientiousness - 0.5));
}

/** How committed someone is: what they believe, plus what they have done and said for it (Festinger 1956). */
const commitment = (c: Carrier) => c.faith + 0.12 * Math.min(6, c.told.length) + 0.08 * Math.min(8, c.practiced);

// ------------------------------------------------------------------ reading what you said

const NUM: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, few: 3 };
const ORD: Record<string, number> = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

const PROPHECY: [RegExp, ProphecyEvent][] = [
  [/\b(blight|rot|crops? (will )?fail|harvest (will )?fail|barley (will )?(fail|die|rot|blacken))\b/, "blight"],
  [/\b(storm|gale|tempest|flood|great wind|waves)\b/, "gale"],
  [/\b(hunger|famine|starve|starving|go hungry|empty bellies)\b/, "hunger"],
  [/\b(will die|shall die|dies|death|perish|drown|will be taken)\b/, "death"],
  [/\b(born|a child (will|shall) come|baby)\b/, "birth"],
];
const FUTURE = /\b(will|shall|is coming|are coming|comes|is going to|before|soon|tomorrow|tonight|in \w+ days?|within)\b/;

const PLACE_WORDS: [RegExp, PlaceId][] = [
  [/\b(shore|landing|harbou?r|beach|water'?s edge)\b/, "harbour"],
  [/\b(sea|bay|fish|fishing|boats?|nets)\b/, "sea"],
  [/\b(fire|hearth|fire circle)\b/, "tavern"],
  [/\b(headland|cliffs?|hill|high place)\b/, "cliffs"],
  [/\b(woods?|forest|pinewood|trees)\b/, "woods"],
  [/\b(fields?|barley|farm|crops?|plough)\b/, "fields"],
  [/\b(quarry|stone)\b/, "quarry"],
  [/\b(reeds?|reedbed|marsh)\b/, "reeds"],
  [/\b(graves?|burial|the dead)\b/, "graveyard"],
  [/\b(store|storehouse)\b/, "store"],
];

const TOPIC_WORDS: [RegExp, string[]][] = [
  [/\b(storm|gale|wind|tempest|flood|waves)\b/, ["storm", "gale", "sea"]],
  [/\b(sea|bay|fish|boats?|nets|drown)\b/, ["sea", "catch"]],
  [/\b(food|hunger|famine|starve|store|bread|barley)\b/, ["food", "store", "winter"]],
  [/\b(dead|death|die|grave|perish)\b/, ["death", "grief"]],
  [/\b(child|born|baby)\b/, ["children"]],
  [/\b(blight|rot|harvest|crops?)\b/, ["harvest", "barley", "food"]],
  [/\b(fire)\b/, ["fire"]],
];

const NEG = ["storm", "die", "death", "curse", "cursed", "punish", "angry", "thief", "liar", "wicked", "evil", "steal", "stole", "betray", "rot", "blight", "hunger", "famine", "drown", "perish", "sin", "unclean", "doom", "fear", "watching"];
const POS = ["bless", "blessed", "chosen", "holy", "good", "safe", "spared", "plenty", "wise", "kind", "love", "protect", "trust", "lead", "saint", "gift"];
const count = (t: string, ws: string[]) => ws.filter((w) => new RegExp(`\\b${w}`).test(t)).length;

function horizon(world: WorldState, t: string): Tick {
  const now = world.tick;
  const day = 1440;
  if (/\btonight\b/.test(t)) return now + 0.6 * day;
  if (/\btomorrow\b/.test(t)) return now + 1.5 * day;
  const n = /\b(?:in|within) (\d+|\w+) days?\b/.exec(t);
  if (n) return now + (Number(n[1]) || NUM[n[1]!] || 3) * day + day * 0.5;
  const v = world.village;
  const season = /\b(?:this|before|by) (summer|autumn|winter|spring)\b/.exec(t)?.[1];
  if (v && season) {
    const seasons = ["summer", "autumn", "winter", "spring"];
    const yearDays = v.seasonDays * 4;
    const d0 = dayOf(now) - 1;
    const idx = seasons.indexOf(season);
    // The start of that season (for "before") or its end (for "this").
    let start = Math.floor(d0 / yearDays) * yearDays + idx * v.seasonDays;
    if (start + v.seasonDays <= d0) start += yearDays;
    const endDay = /\bbefore\b/.test(t) ? start : start + v.seasonDays;
    return Math.max(now + day, endDay * day + 7 * 60);
  }
  if (/\b(this|next) year\b/.test(t) && v) return now + v.seasonDays * 4 * day;
  return now + 3.5 * day;
}

/** Read what you said: is it a prophecy, a command, a judgement on someone, or a revelation? */
export function readWord(world: WorldState, text: string): Pick<Word, "subject" | "stance" | "prophecy" | "practice" | "topics" | "valence"> {
  const t = text.toLowerCase();
  const subject = adults(world).find((id) => new RegExp(`\\b${world.agents[id]!.name.toLowerCase()}\\b`).test(t)) ?? world.order.find((id) => new RegExp(`\\b${world.agents[id]!.name.toLowerCase()}\\b`).test(t));
  const valence = clamp((count(t, POS) - count(t, NEG)) * 0.25, -1, 1);
  const topics = [...new Set(TOPIC_WORDS.filter(([re]) => re.test(t)).flatMap(([, ts]) => ts))];
  let prophecy: Word["prophecy"];
  if (FUTURE.test(t)) {
    const hit = PROPHECY.find(([re]) => re.test(t));
    if (hit) prophecy = { event: hit[1], by: horizon(world, t), about: hit[1] === "death" ? subject : undefined };
  }
  let practice: Practice | undefined;
  const placeOf = (s: string) => PLACE_WORDS.find(([re, p]) => re.test(s) && hasPlace(world, p))?.[1];
  const taboo = /\b(?:do not|don't|never|no one (?:shall|may|should|must)|must not|shall not|none shall)\s+([^.!?;]+)/.exec(t);
  const rite = /\b(?:you must|you shall|you should|all must|let (?:all|everyone|every one of you)|each (?:dawn|morning|dusk|evening|night)|every (?:dawn|morning|dusk|evening|night)|always)?\s*\b(leave|give|offer|bring|light|sing|pray|gather|kneel|bow|bury|burn|share|go to|walk to|meet)\b([^.!?;]*)/.exec(t);
  if (taboo) {
    const act = taboo[1]!.trim();
    const place = placeOf(act);
    const ord = /\b(\w+) day\b/.exec(t)?.[1];
    if (place) practice = { kind: "taboo", act, place, every: ord ? ORD[ord] : undefined };
  }
  if (!practice && rite && (/\b(you must|you shall|you should|all must|let |each |every |always)\b/.test(t) || /^\s*(leave|give|offer|bring|light|sing|pray|gather|kneel|bow|bury|burn|share|go|walk|meet)\b/.test(t.split(/[.!?]/).find((s) => s.includes(rite[1]!)) ?? ""))) {
    const act = `${rite[1]}${rite[2] ?? ""}`.trim();
    const place = placeOf(act) ?? placeOf(t) ?? (hasPlace(world, "cliffs") ? "cliffs" : "tavern");
    const offering = /\b(leave|give|offer|bring|share|burn)\b/.test(rite[1]!) && /\b(fish|food|bread|barley|catch|share|meal|grain)\b/.test(act + t);
    practice = { kind: "rite", act, place, at: /\b(dawn|morning|sunrise)\b/.test(t) ? "dawn" : "dusk", offering };
  }
  const stance = subject && !prophecy ? (valence < 0 ? "accuse" : valence > 0 ? "praise" : undefined) : undefined;
  return { subject, stance, prophecy, practice, topics, valence };
}

// ------------------------------------------------------------------ rendering a version

export function renderVersion(world: WorldState, v: Version): string {
  let s = `${cap(LADDER[v.rung]!)} said: "${v.core}"`;
  if (v.chosen) s += ` ${name(world, v.chosen)} is the one it chose.`;
  if (v.blame) s += ` It is ${name(world, v.blame)}'s doing.`;
  if (v.unless) s += ` Unless we ${v.unless}.`;
  if (v.held) s += ` It was held back only because the faithful kept faith.`;
  return s;
}

/** What someone says out loud when they pass it on. */
function spoken(world: WorldState, v: Version, teller: MindState): string {
  const open = teller.traits.neuroticism > 0.6 ? "I can't stop thinking about it. " : teller.traits.extraversion > 0.6 ? "Listen to this. " : "";
  let s = `${open}${cap(LADDER[v.rung]!)} said it: "${v.core}"`;
  if (v.chosen) s += v.chosen === teller.id ? " And it chose me." : ` And it chose ${name(world, v.chosen)}.`;
  if (v.blame) s += ` It's ${name(world, v.blame)}'s doing, you know it is.`;
  if (v.unless) s += ` Unless we ${v.unless}.`;
  if (v.held) s += " It only held off because we kept faith.";
  return s;
}

/** How far apart two versions are, in doctrine (who said it, who's to blame, what we must do). */
export function versionDistance(a: Version, b: Version): number {
  return (a.blame !== b.blame ? 1 : 0) + (a.unless !== b.unless ? 1 : 0) + (a.chosen !== b.chosen ? 0.5 : 0) + (Math.abs(a.rung - b.rung) >= 2 ? 0.5 : 0) + (a.held !== b.held ? 0.5 : 0) + (a.core !== b.core ? 0.25 : 0);
}

// ------------------------------------------------------------------ the teller's mind bends the words

const HEDGES = /\b(perhaps|maybe|i think|it may be that|probably|possibly|i fear|it seems|they say)\b,?\s*/gi;
const SHARPEN: [RegExp, string][] = [
  [/\b(might|may|could)\b/, "will"],
  [/\ba storm\b/, "a great storm"],
  [/\bsoon\b/, "any day now"],
  [/\bwill come\b/, "is coming for us"],
  [/\bsome of you\b/, "all of you"],
  [/\bwatching\b/, "watching and counting"],
  [/\bangry\b/, "furious"],
  [/\bbad\b/, "terrible"],
  [/\bthief\b/, "thief and a liar"],
  [/\bblessed\b/, "chosen"],
  [/\bsick\b/, "struck down"],
  [/\bin (\w+) days\b/, "in a few days"],
];

/** The worst thing this teller thinks about anyone in town, as the cause of a scapegoat. */
function grudge(world: WorldState, m: MindState, exclude: Set<AgentId>): { id: AgentId; liking: number; cause: Bend["cause"] } | undefined {
  let best: { id: AgentId; liking: number } | undefined;
  for (const id of world.order) {
    if (id === m.id || exclude.has(id) || !adult(world, id)) continue;
    const o = m.others[id];
    if (!o) continue;
    if (!best || o.liking < best.liking) best = { id, liking: o.liking };
  }
  if (!best) return undefined;
  const bel = m.beliefs.filter((b) => b.about === best!.id && b.valence < 0).sort((a, b) => a.valence * a.confidence - b.valence * b.confidence)[0];
  return { ...best, cause: bel ? { kind: "belief", id: bel.id, text: bel.proposition } : { kind: "relation", id: best.id, text: `${m.name} dislikes ${personName(world, best.id)} (liking ${best.liking.toFixed(2)})` } };
}

/** A fear this teller already carries that the words touch: a core belief, or a bad memory on the same topic. */
const THREAT = new Set(["storm", "gale", "sea", "death", "grief", "harvest", "winter"]);
function fearFit(m: MindState, all: string[]): Bend["cause"] | undefined {
  const topics = all.filter((t) => THREAT.has(t));
  if (!topics.length) return undefined;
  const s = m.schemas.find((x) => x.threatBias > 0 && x.triggers.some((t) => topics.includes(t)));
  if (s) return { kind: "schema", id: s.id, text: s.text };
  const ep = m.episodes.filter((e) => e.valence < -0.3 && e.topics.some((t) => topics.includes(t))).sort((a, b) => a.valence - b.valence)[0];
  if (ep) return { kind: "belief", id: ep.id, text: ep.gist };
  return undefined;
}

/** Retell: the teller's version, bent by the teller's mind on its way to a listener. */
export function bend(world: WorldState, word: Word, teller: MindState, from: Version, faith: number): { version: Version; bends: Bend[] } {
  const v: VoiceState = voiceOf(world);
  const out: Version = { ...from };
  const bends: Bend[] = [];
  const cr = credulity(teller);
  const fear = teller.affect.emotions.fear;
  const negative = word.valence < -0.05 || (word.prophecy && word.prophecy.event !== "birth");

  // Source: a believer fills a forgotten source with something grander; a doubter shrinks it.
  if (faith >= 0.5 && out.rung < LADDER.length - 1 && rand(v) < 0.18 + 0.35 * cr * faith) {
    const was = LADDER[out.rung]!;
    out.rung = out.rung === 2 ? 4 : out.rung + 1;
    bends.push({ kind: "source", agent: teller.id, text: `"${was}" became "${LADDER[out.rung]}"`, cause: { kind: "trait", id: "openness", text: `${teller.name} believes it (${faith.toFixed(2)}) and is credulous (${cr.toFixed(2)})` } });
  } else if (faith < 0.35 && out.rung > 0 && rand(v) < 0.3) {
    const was = LADDER[out.rung]!;
    out.rung = Math.max(0, out.rung - 2);
    bends.push({ kind: "deflated", agent: teller.id, text: `"${was}" became "${LADDER[out.rung]}"`, cause: { kind: "trait", id: "conscientiousness", text: `${teller.name} doesn't really believe it (${faith.toFixed(2)})` } });
  }

  // Levelling: hedges go, and a long message loses its least charged sentence.
  if (rand(v) < 0.4) {
    let core = out.core.replace(HEDGES, "");
    const sentences = core.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 2 || core.split(/\s+/).length > 22) {
      const charged = (s: string) => count(s.toLowerCase(), [...NEG, ...POS]) + (FUTURE.test(s.toLowerCase()) ? 1 : 0) + (/\b(must|never|do not|leave|offer|gather)\b/i.test(s) ? 1.5 : 0);
      const drop = sentences.map((s, i) => ({ s, i, c: charged(s) })).sort((a, b) => a.c - b.c || b.i - a.i)[0]!;
      core = sentences.filter((_, i) => i !== drop.i).join(" ");
    }
    core = cap(core.trim());
    if (core && core !== out.core) {
      bends.push({ kind: "levelled", agent: teller.id, text: `"${clip(out.core)}" became "${clip(core)}"`, cause: { kind: "trait", id: "memory", text: "memory keeps the gist and lets the rest go" } });
      out.core = core;
    }
  }

  // Sharpening: the frightened make it bigger.
  const fearCause = fearFit(teller, word.topics);
  if (rand(v) < 0.15 + 0.6 * fear + (fearCause ? 0.2 : 0) + 0.15 * teller.traits.neuroticism) {
    for (const [re, to] of SHARPEN) {
      if (!re.test(out.core)) continue;
      const core = out.core.replace(re, to);
      bends.push({ kind: "sharpened", agent: teller.id, text: `"${clip(out.core)}" became "${clip(core)}"`, cause: fearCause ?? (fear >= 0.1 ? { kind: "emotion", id: "fear", text: `${teller.name}'s fear (${fear.toFixed(2)})` } : { kind: "trait", id: "neuroticism", text: `${teller.name}'s anxious temperament (neuroticism ${teller.traits.neuroticism.toFixed(2)})` }) });
      out.core = core;
      break;
    }
  }

  // Assimilation: a bad omen finds a culprit among the teller's grudges.
  if (negative && !out.blame) {
    const g = grudge(world, teller, new Set([out.chosen ?? ""]));
    if (g && g.liking < 0.4 && rand(v) < 0.2 + 1.2 * (0.4 - g.liking) + 0.4 * teller.affect.emotions.anger) {
      out.blame = g.id;
      bends.push({ kind: "scapegoat", agent: teller.id, text: `now it is ${personName(world, g.id)}'s doing`, cause: g.cause });
    }
  }
  // ...and a good one finds a favourite, or the teller themself.
  if (!negative && !out.chosen && faith >= 0.5) {
    if (teller.traits.honesty < 0.4 && rand(v) < 0.25) {
      out.chosen = teller.id;
      bends.push({ kind: "self", agent: teller.id, text: `now it chose ${teller.name}`, cause: { kind: "trait", id: "honesty", text: `${teller.name}'s low honesty-humility (${teller.traits.honesty.toFixed(2)})` } });
    } else {
      const fav = world.order.filter((id) => id !== teller.id && (teller.others[id]?.liking ?? 0) > 0.78).sort((a, b) => teller.others[b]!.liking - teller.others[a]!.liking)[0];
      if (fav && rand(v) < 0.18) {
        out.chosen = fav;
        bends.push({ kind: "chosen", agent: teller.id, text: `now it chose ${personName(world, fav)}`, cause: { kind: "relation", id: fav, text: `${teller.name} is fond of ${personName(world, fav)} (liking ${teller.others[fav]!.liking.toFixed(2)})` } });
      }
    }
  }

  // Moralizing: a warning with nothing to do about it grows a condition from the teller's own values.
  if (word.prophecy && !word.practice && !out.unless && faith >= 0.45 && rand(v) < 0.2 + 0.35 * teller.traits.conscientiousness * faith) {
    const u = condition(world, teller, out, word);
    out.unless = u.text;
    bends.push({ kind: "moralized", agent: teller.id, text: `it grew a condition: "unless we ${u.text}"`, cause: u.cause });
  }
  return { version: out, bends };
}

/** Send someone somewhere for a while, as a coping action or a gathering does, without a line in the feed for each. */
function pull(world: WorldState, id: AgentId, place: PlaceId, activity: string, minutes: number): void {
  const a = world.agents[id]!;
  a.override = { place, activity, until: world.tick + minutes };
  a.place = place;
  a.activity = activity;
}

const clip = (s: string) => (s.length > 70 ? `${s.slice(0, 67)}...` : s);

/** The condition a teller attaches to a warning, from what that teller already holds dear or fears. */
function condition(world: WorldState, m: MindState, v: Version, word: Word): { text: string; cause: Bend["cause"] } {
  if (v.blame) return { text: `send ${personName(world, v.blame)} away`, cause: { kind: "relation", id: v.blame, text: `${m.name} already blames ${personName(world, v.blame)}` } };
  const sea = fearFit(m, ["sea", "storm", "gale"]);
  if (word.prophecy?.event === "gale" && sea && hasPlace(world, "sea")) return { text: "keep off the sea", cause: sea };
  if (world.village && normHeld(world, m.id) > 0.3 && hasPlace(world, "store")) return { text: "share what we have at the common store", cause: { kind: "belief", id: "norm_store", text: "the store norm" } };
  return { text: "gather at the fire each night and keep faith", cause: { kind: "trait", id: "conscientiousness", text: `${m.name}'s conscientiousness (${m.traits.conscientiousness.toFixed(2)})` } };
}

/** The practice a version asks of its believers: the one you gave, or the one it grew on the way. */
export function practiceOf(world: WorldState, word: Word, v: Version): Practice | undefined {
  if (word.practice) return word.practice;
  if (!v.unless) return undefined;
  if (v.unless === "keep off the sea") return { kind: "taboo", act: "keep off the sea", place: "sea" };
  if (v.unless.startsWith("share what we have")) return { kind: "rite", act: "share what we have at the common store", place: "store", at: "dusk", offering: true };
  if (v.unless.startsWith("send ")) return undefined;
  if (v.unless.startsWith("gather at the fire")) return { kind: "rite", act: "gather at the fire and keep faith", place: hasPlace(world, "tavern") ? "tavern" : "cliffs", at: "dusk" };
  return undefined;
}

// ------------------------------------------------------------------ hearing

type Mode = "addressed" | "preached" | "overheard" | "told" | "voice" | "dream" | "quiet";

/** How much a listener believes what they just heard. Each term is a named mechanism. */
export function faithOf(world: WorldState, word: Word, listener: AgentId, from: AgentId, version: Version, mode: Mode): { faith: number; why: { name: string; value: number }[] } {
  const m = world.minds[listener]!;
  const v = voiceOf(world);
  const why: { name: string; value: number }[] = [];
  const authority = AUTHORITY[version.rung]!;
  const teller = m.others[from];
  // Who told you: a person you trust lends their credibility; you, in a guise, only your authority.
  const cred = teller ? 0.5 * authority + 0.5 * teller.trust.integrity * (0.6 + 0.4 * teller.liking) : authority;
  const cr = credulity(m);
  let faith = 0.5 * cred + 0.5 * cr - 0.12 + (mode === "addressed" ? 0.05 : 0);
  why.push({ name: `${LADDER[version.rung]} (authority ${authority.toFixed(2)})${teller ? `, told by ${teller.name}` : ""}`, value: cred });
  why.push({ name: `${m.name}'s credulity`, value: cr });
  // A voice out of the sky or in a dream is uncanny: the open are struck, the hard-headed explain it away.
  if (mode === "voice" || mode === "dream") {
    const awe = 0.4 * (m.traits.openness - 0.5) - 0.35 * (m.traits.conscientiousness - 0.5) + 0.15 * (m.traits.neuroticism - 0.5);
    faith += awe;
    why.push({ name: "awe or doubt at a voice from nowhere", value: awe });
  }
  if (mode === "overheard") {
    faith *= 0.85;
    why.push({ name: "only overheard", value: -0.15 });
  }
  const fit = fearFit(m, word.topics);
  if (fit && (word.valence < 0 || word.prophecy)) {
    faith += 0.15;
    why.push({ name: `fits a fear already there: ${clip(fit.text)}`, value: 0.15 });
  }
  // Social proof: how many of the people this person knows already believe.
  const known = world.order.filter((id) => id !== listener && m.others[id]);
  // Only people who believed before this moment count: a crowd hearing it at once can't sway each other yet.
  const proof = known.length ? known.filter((id) => word.carriers[id] && word.carriers[id]!.tick < world.tick && believes(word.carriers[id]!)).length / known.length : 0;
  if (proof > 0) {
    faith += 0.2 * proof;
    why.push({ name: `${Math.round(proof * 100)}% of the people ${m.name} knows believe it`, value: 0.2 * proof });
  }
  const seen = Math.min(5, v.witnessed[listener] ?? 0);
  if (seen) {
    faith += 0.03 * seen;
    why.push({ name: `has watched the rite kept ${seen} times`, value: 0.03 * seen });
  }
  // Motivated reasoning about the people in it (Kunda 1990).
  for (const [who, sign] of [[version.blame ?? (word.stance === "accuse" ? word.subject : undefined), -1], [version.chosen ?? (word.stance === "praise" ? word.subject : undefined), 1]] as const) {
    if (!who || who === listener) continue;
    const o = m.others[who];
    if (!o) continue;
    const s = 0.5 * sign * (o.liking - 0.5);
    faith += s;
    if (Math.abs(s) > 0.02) why.push({ name: `how ${m.name} feels about ${o.name}`, value: s });
  }
  if (version.blame === listener) {
    faith -= 0.5;
    why.push({ name: "it blames them", value: -0.5 });
  }
  if (teller && teller.liking < 0.35) {
    faith -= 0.15;
    why.push({ name: `doesn't like ${teller.name}`, value: -0.15 });
  }
  // Members of a rival sect hold their own version.
  const sect = v.faiths.find((f) => !f.ended && f.members.includes(listener));
  const tellerSect = v.faiths.find((f) => !f.ended && f.members.includes(from));
  if (sect && tellerSect && sect.id !== tellerSect.id) {
    faith -= 0.3;
    why.push({ name: `${m.name} keeps to ${sect.name}`, value: -0.3 });
  }
  return { faith: clamp(faith), why };
}

/** Someone hears the words: through the full cognitive cycle, unless the town is on rules (quiet). */
async function hear(
  world: WorldState,
  sink: Sink,
  faculties: Faculties,
  word: Word,
  o: { listener: AgentId; from: AgentId; version: Version; bends: Bend[]; depth: number; mode: Mode; line: string },
): Promise<Carrier | undefined> {
  const m = world.minds[o.listener];
  if (!m) return undefined;
  const v = voiceOf(world);
  const known = word.carriers[o.listener];
  if (known) {
    // Heard again, from someone new: it feels truer (illusory truth). You speaking again rekindles it.
    if (known.from !== o.from || YOU.has(o.from)) {
      const cred = m.others[o.from]?.trust.integrity ?? AUTHORITY[o.version.rung]!;
      known.faith = clamp(known.faith + 0.12 * cred * (1 - known.faith) * (YOU.has(o.from) ? 2 : 1));
      known.heardAgain++;
      if (known.lapsed && YOU.has(o.from)) known.lapsed = undefined;
      const bel = m.beliefs.find((b) => b.id === known.belief);
      // A different version from someone liked can overwrite your own (memory conformity; Gabbert, Memon & Allan 2003).
      const lik = m.others[o.from]?.liking ?? 0;
      if (!YOU.has(o.from) && versionDistance(o.version, known.version) > 0 && rand(v) < 0.4 * lik * (1 - 0.4 * known.faith)) {
        known.version = o.version;
        known.bends = [...o.bends, { kind: "levelled", agent: o.listener, text: `took on ${personName(world, o.from)}'s version`, cause: { kind: "relation", id: o.from, text: `${m.name} likes ${personName(world, o.from)} (liking ${lik.toFixed(2)})` } }];
        if (bel) bel.proposition = renderVersion(world, known.version);
      }
      if (bel) bel.confidence = known.faith;
    }
    return known;
  }
  const { faith } = faithOf(world, word, o.listener, o.from, o.version, o.mode);
  let trace: string | undefined;
  let encoded: string | undefined;
  if (o.mode !== "quiet") {
    const intensity = clamp(0.35 + (o.mode === "voice" || o.mode === "dream" ? 0.4 : o.mode === "preached" ? 0.2 : 0.05) + 0.2 * Math.abs(word.valence));
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: m.tick,
      kind: "speech",
      rawText: o.line,
      actor: o.from,
      addressedToSelf: o.mode === "addressed",
      about: [o.version.blame, o.version.chosen, word.subject].filter((x): x is string => !!x && x in m.others),
      topics: [...word.topics, "voice", word.guise, "faith"],
      features: { outcomeForSelf: clamp(word.valence * 0.5 * faith + (word.prophecy && word.prophecy.event !== "birth" ? -0.25 * faith : 0), -1, 1), agency: "other", intentional: 0.5, normViolation: 0, prospective: !!word.prophecy, intensity },
      claims: [],
      details: [],
      gist: YOU.has(o.from) ? `${cap(LADDER[o.version.rung]!)} said to me: "${o.version.core}"` : `${personName(world, o.from)} told me ${LADDER[o.version.rung]} said: "${o.version.core}"`,
    };
    const tr = await runPercept(m, p, faculties);
    record(world, sink, o.listener, tr);
    trace = tr.id;
    encoded = tr.encoded;
    if (o.mode === "addressed" && tr.action?.kind === "speech") feed(world, sink, { kind: "talk", place: world.agents[o.listener]!.place, agents: [o.listener], title: `${m.name} answers you`, lines: [{ speaker: o.listener, text: tr.action.text, trace: tr.id }], refs: [{ agent: o.listener, trace: tr.id }], rumor: word.id });
  }
  const belief = nextId(m, "bel");
  m.beliefs.push({
    id: belief,
    about: "faith",
    topics: [...word.topics, "voice", "faith"],
    proposition: renderVersion(world, o.version),
    confidence: faith,
    valence: word.valence,
    source: { kind: "told", from: o.from },
    formed: world.tick,
    evidence: encoded ? [encoded] : [],
    retrievals: [world.tick],
    rumor: word.id,
  });
  const c: Carrier = { agent: o.listener, from: o.from, tick: world.tick, depth: o.depth, version: o.version, bends: o.bends, faith, belief, trace, told: [], heardAgain: 0, practiced: 0 };
  word.carriers[o.listener] = c;
  word.hops.push({ tick: world.tick, from: o.from, to: o.listener, text: renderVersion(world, o.version), confidence: faith, mutated: o.bends.length > 0, trace, overheard: o.mode === "overheard" || undefined });
  // What the words say about people moves how the listener feels about them.
  const blame = o.version.blame ?? (word.stance === "accuse" ? word.subject : undefined);
  const chosen = o.version.chosen ?? (word.stance === "praise" ? word.subject : undefined);
  if (blame && blame !== o.listener && m.others[blame] && faith >= 0.35) {
    m.others[blame]!.liking = clamp(m.others[blame]!.liking - 0.18 * faith);
    m.others[blame]!.trust.benevolence = clamp(m.others[blame]!.trust.benevolence - 0.12 * faith);
  }
  if (chosen && chosen !== o.listener && m.others[chosen] && faith >= 0.35) {
    m.others[chosen]!.liking = clamp(m.others[chosen]!.liking + 0.12 * faith);
    m.others[chosen]!.trust.integrity = clamp(m.others[chosen]!.trust.integrity + 0.08 * faith);
  }
  void v;
  return c;
}

/** Keep the town's rumor list in step with the words, so the lineage views and the ledger see them. */
function syncRumors(world: WorldState, v: VoiceState): void {
  for (const w of v.words) {
    const r = world.rumors[w.id];
    if (!r) world.rumors[w.id] = { id: w.id, subject: w.subject ?? "faith", origin: "visitor", first: w.text, hops: w.hops, guise: w.guise };
    else if (r.hops !== w.hops) r.hops = w.hops;
  }
}

// ------------------------------------------------------------------ you speak

export async function voiceAct(world: WorldState, act: VoiceAct, faculties: Faculties, sink: Sink): Promise<void> {
  const v = voiceOf(world);
  if (act.act === "fulfil") return fulfil(world, act.word, faculties, sink);
  const text = act.text.trim().replace(/\s+/g, " ").slice(0, 400);
  if (!text) return;
  const read = readWord(world, text);
  const id = nextId(v, "word");
  const word: Word = { id, tick: world.tick, guise: act.guise, text, place: act.place, to: act.to, ...read, carriers: {}, hops: [], curve: [], kept: {} };
  v.words.push(word);
  syncRumors(world, v);
  const g = act.guise;
  if (g === "stranger") {
    const to = act.to && world.order.includes(act.to) ? act.to : world.order.find((x) => !isNight(world.tick) && world.agents[x]!.place === (act.place ?? world.agents[x]!.place));
    if (!to) return;
    word.to = to;
    word.place = world.agents[to]!.place;
  } else if (g === "prophet") {
    word.place = act.place && hasPlace(world, act.place) ? act.place : hasPlace(world, "tavern") ? "tavern" : world.agents[world.order[0]!]!.place;
  } else if (g === "dream") {
    word.to = act.to && world.order.includes(act.to) ? act.to : world.order[0];
  }
  v.log.push({ tick: world.tick, kind: "spoke", word: id, text: `You spoke as ${guiseName(g)}${word.to ? ` to ${personName(world, word.to)}` : word.place && g === "prophet" ? ` at ${placeName(world, word.place)}` : ""}: "${text}"` });
  word.pending = true;
  await deliver(world, word, faculties, sink);
}

export const guiseName = (g: Guise) => (g === "stranger" ? "a stranger" : g === "prophet" ? "a prophet" : g === "sky" ? "a voice from the sky" : "a dream");

/** Deliver your words to whoever can hear them now; a prophet waits for a crowd and a dream for night. */
async function deliver(world: WorldState, word: Word, faculties: Faculties, sink: Sink): Promise<void> {
  const night = isNight(world.tick);
  const version: Version = { core: word.text, rung: START_RUNG[word.guise] };
  const at = (p: PlaceId) => (night ? [] : world.order.filter((id) => world.agents[id]!.place === p));
  if (word.guise === "stranger") {
    const to = word.to!;
    const place = world.agents[to]!.place;
    word.pending = false;
    feed(world, sink, { kind: "event", place, agents: [to], title: `A stranger stops ${personName(world, to)} at ${placeName(world, place)}`, text: `"${word.text}"`, rumor: word.id });
    await hear(world, sink, faculties, word, { listener: to, from: "visitor", version, bends: [], depth: 1, mode: "addressed", line: word.text });
    const v = voiceOf(world);
    for (const id of at(place)) if (id !== to && rand(v) < 0.6) await hear(world, sink, faculties, word, { listener: id, from: "visitor", version, bends: [], depth: 1, mode: "overheard", line: word.text });
    return;
  }
  if (word.guise === "prophet") {
    const crowd = at(word.place!);
    if (night || crowd.length < 2) {
      if (word.tick === world.tick) feed(world, sink, { kind: "event", place: word.place, agents: crowd, title: `A prophet in a grey cloak waits at ${placeName(world, word.place!)}`, text: "Waiting for people to gather.", rumor: word.id });
      return;
    }
    word.pending = false;
    feed(world, sink, { kind: "event", place: word.place, agents: crowd, title: `A prophet preaches at ${placeName(world, word.place!)}`, text: `"${word.text}" ${crowd.length} ${crowd.length === 1 ? "person hears" : "people hear"} it.`, rumor: word.id, chronicle: { kind: "faith" } });
    for (const id of crowd) await hear(world, sink, faculties, word, { listener: id, from: "visitor", version, bends: [], depth: 1, mode: "preached", line: word.text });
    return;
  }
  if (word.guise === "sky") {
    word.pending = false;
    feed(world, sink, { kind: "event", agents: [...world.order], title: night ? `Everyone in ${world.name} dreams the same words` : `A voice speaks out of the sky over ${world.name}`, text: `"${word.text}"`, rumor: word.id, chronicle: { kind: "faith" } });
    const scoffers: AgentId[] = [];
    for (const id of world.order) {
      const c = await hear(world, sink, faculties, word, { listener: id, from: "sky", version, bends: [], depth: 1, mode: night ? "dream" : "voice", line: word.text });
      if (c && c.faith < 0.25 && adult(world, id)) scoffers.push(id);
    }
    for (const id of scoffers.slice(0, 3)) {
      const m = world.minds[id]!;
      feed(world, sink, { kind: "event", agents: [id], title: `${m.name} won't have it`, text: m.traits.conscientiousness > 0.6 ? `"Wind in the rocks. Nothing more."` : m.traits.agreeableness < 0.4 ? `"Fools. You'd believe a gull if it talked."` : `"I heard something. I don't know what I heard."`, rumor: word.id });
    }
    return;
  }
  // A dream comes at night.
  if (!night) return;
  word.pending = false;
  const to = word.to!;
  feed(world, sink, { kind: "event", agents: [to], title: `${personName(world, to)} dreams`, text: `In the dream a voice says: "${word.text}"`, rumor: word.id });
  await hear(world, sink, faculties, word, { listener: to, from: "dream", version, bends: [], depth: 1, mode: "dream", line: word.text });
}

// ------------------------------------------------------------------ the world goes on

/** Called from the world's clock after each step: words travel, practices are kept, prophecies are tested. */
export async function voiceStep(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = world.voice;
  if (!v || !v.words.length) return;
  syncRumors(world, v);
  for (const w of v.words) if (w.pending) await deliver(world, w, faculties, sink);
  const fresh = newFeed(v, sink.feed);
  if (!isNight(world.tick)) for (const f of fresh) if (f.kind === "talk" && f.agents.length >= 2 && !f.rumor?.startsWith("word_")) await conversation(world, f.agents[0]!, f.agents[1]!, faculties, sink);
  await testProphecies(world, fresh, faculties, sink);
  const h = hourOf(world.tick);
  const day = dayOf(world.tick);
  if (!isNight(world.tick)) {
    if (h >= 7 && h < 8.5 && v.last.dawn !== day) {
      v.last.dawn = day;
      practices(world, "dawn", sink);
    }
    if (h >= 7.5 && h < 9 && v.last.taboo !== day) {
      v.last.taboo = day;
      taboos(world, sink);
    }
    if (h >= 19 && h < 20.5 && v.last.dusk !== day) {
      v.last.dusk = day;
      practices(world, "dusk", sink);
    }
    if (h >= 20 && h < 22 && v.last.fire !== day) {
      v.last.fire = day;
      await preach(world, faculties, sink);
    }
  }
  if (world.tick - v.last.sample >= 240) {
    v.last.sample = world.tick;
    for (const w of v.words) {
      const cs = Object.values(w.carriers);
      w.curve.push({ tick: world.tick, heard: cs.length, believe: cs.filter(believes).length });
      if (w.curve.length > 400) w.curve.splice(0, w.curve.length - 400);
    }
  }
  if (day !== v.last.day) {
    v.last.day = day;
    settleRites(world, sink);
    faiths(world, sink);
  }
  if (v.log.length > 300) v.log.splice(0, v.log.length - 300);
}

function newFeed(v: VoiceState, all: FeedItem[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const f = all[i]!;
    if (f.id === v.seenFeed || f.tick < v.seenTick) break;
    out.push(f);
  }
  const last = all[all.length - 1];
  if (last) {
    v.seenFeed = last.id;
    v.seenTick = last.tick;
  }
  return out.reverse();
}

/** Two people talked. Either may pass on the words they burn with most that the other hasn't heard from them. */
async function conversation(world: WorldState, a: AgentId, b: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const v = voiceOf(world);
  if (!world.minds[a] || !world.minds[b]) return;
  for (const [t, l] of [[a, b], [b, a]] as const) {
    const pick = v.words
      .map((w) => ({ w, c: w.carriers[t] }))
      .filter((x): x is { w: Word; c: Carrier } => !!x.c && !x.c.lapsed && x.c.faith >= 0.3 && !x.c.told.includes(l) && !(x.w.carriers[l] && x.w.carriers[l]!.from === t))
      .map((x) => ({ ...x, s: fervor(world, x.w, x.c) }))
      .sort((p, q) => q.s - p.s)[0];
    if (!pick || rand(v) >= pick.s) continue;
    await tell(world, pick.w, pick.c, l, "told", faculties, sink);
  }
}

/** How likely someone is to bring it up: belief, temperament, urgency, and zeal after a sign. */
function fervor(world: WorldState, w: Word, c: Carrier): number {
  const m = world.minds[c.agent]!;
  const pending = w.prophecy && !w.prophecy.outcome ? 1.4 : 1;
  const zeal = w.zealUntil && w.zealUntil > world.tick && commitment(c) >= 0.9 ? 1.8 : 1;
  const doubled = c.doubled ? 1.5 : 1;
  return clamp(c.faith * (0.3 + 0.7 * m.traits.extraversion) * pending * zeal * doubled * 0.75);
}

async function tell(world: WorldState, w: Word, c: Carrier, listener: AgentId, mode: Mode, faculties: Faculties, sink: Sink): Promise<Carrier | undefined> {
  const teller = world.minds[c.agent]!;
  const { version, bends } = bend(world, w, teller, c.version, c.faith);
  c.told.push(listener);
  if (c.told.length > 40) c.told.splice(0, c.told.length - 40);
  const line = spoken(world, version, teller);
  const before = w.carriers[listener];
  const got = await hear(world, sink, faculties, w, { listener, from: c.agent, version, bends, depth: c.depth + 1, mode, line });
  if (mode !== "quiet" && got && !before) {
    const verdict = got.faith >= 0.45 ? "" : got.faith >= 0.25 ? ` ${personName(world, listener)} isn't sure.` : ` ${personName(world, listener)} doesn't believe a word of it.`;
    feed(world, sink, { kind: "talk", place: world.agents[c.agent]!.place, agents: [c.agent, listener], title: `${teller.name} tells ${personName(world, listener)} what ${LADDER[version.rung]} said`, text: bends.length ? `On the way: ${bends.map((b) => b.text).join("; ")}.${verdict}` : verdict.trim() || undefined, lines: [{ speaker: c.agent, text: line }], refs: got.trace ? [{ agent: listener, trace: got.trace }] : undefined, rumor: w.id });
  }
  return got;
}

/** In the evening the most fervent believer at the fire tells everyone there. */
async function preach(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = voiceOf(world);
  const place: PlaceId = hasPlace(world, "tavern") ? "tavern" : world.agents[world.order[0]!]!.place;
  const there = world.order.filter((id) => world.agents[id]!.place === place);
  if (there.length < 3) return;
  let best: { w: Word; c: Carrier; s: number } | undefined;
  for (const w of v.words)
    for (const id of there) {
      const c = w.carriers[id];
      if (!c || !believes(c)) continue;
      const keeper = v.faiths.some((f) => !f.ended && f.keeper === id);
      const s = commitment(c) * (0.4 + world.minds[id]!.traits.extraversion) * (keeper ? 1.6 : 1);
      if (!best || s > best.s) best = { w, c, s };
    }
  if (!best || best.s < 0.75 || rand(v) > 0.6 + (best.w.zealUntil && best.w.zealUntil > world.tick ? 0.3 : 0)) return;
  const listeners = there.filter((id) => id !== best!.c.agent && !best!.c.told.includes(id));
  if (!listeners.length) return;
  const m = world.minds[best.c.agent]!;
  feed(world, sink, { kind: "event", place, agents: [best.c.agent, ...listeners.slice(0, 6)], title: `${m.name} preaches at ${placeName(world, place)}`, text: `"${best.c.version.core}" ${listeners.length} ${listeners.length === 1 ? "person listens" : "people listen"}.`, rumor: best.w.id });
  for (const id of listeners) await tell(world, best.w, best.c, id, "preached", faculties, sink);
}

// ------------------------------------------------------------------ practice

/** Believers keep the rite: an offering that costs their household food, or a gathering at a place. */
function practices(world: WorldState, at: "dawn" | "dusk", sink: Sink): void {
  const v = voiceOf(world);
  const day = dayOf(world.tick);
  for (const w of v.words) {
    const keepers: AgentId[] = [];
    let place: PlaceId | undefined;
    let act = "";
    for (const c of Object.values(w.carriers)) {
      if (!believes(c) || !adult(world, c.agent) || !world.order.includes(c.agent)) continue;
      const p = practiceOf(world, w, c.version);
      if (!p || p.kind !== "rite" || p.at !== at) continue;
      const m = world.minds[c.agent]!;
      if (rand(v) > c.faith * (0.55 + 0.45 * m.traits.conscientiousness)) continue;
      if (p.offering && world.village) {
        const hh = householdOf(world, c.agent);
        if (!hh || hh.food < 1.5) continue;
        hh.food = Number((hh.food - 0.5).toFixed(2));
      }
      c.practiced++;
      c.lastPractice = day;
      keepers.push(c.agent);
      place = p.place;
      act = p.act;
      pull(world, c.agent, p.place, `keeping the rite at ${placeName(world, p.place)}`, 60);
    }
    if (!keepers.length || !place) continue;
    w.kept[day] = (w.kept[day] ?? 0) + keepers.length;
    // Whoever is there and sees it done remembers seeing it.
    for (const id of world.order) if (!keepers.includes(id) && world.agents[id]!.place === place) v.witnessed[id] = (v.witnessed[id] ?? 0) + 1;
    feed(world, sink, { kind: "event", place, agents: keepers.slice(0, 8), title: keepers.length > 1 ? `${keepers.length} people ${at === "dawn" ? "at dawn" : "at dusk"} at ${placeName(world, place)}` : `${personName(world, keepers[0]!)} keeps the rite at ${placeName(world, place)}`, text: `They ${act.replace(/^(you |we )/, "")}.`, rumor: w.id });
  }
}

/** Believers keep away from a forbidden place during the working day, and so don't work there. */
function taboos(world: WorldState, sink: Sink): void {
  const v = voiceOf(world);
  const day = dayOf(world.tick);
  for (const w of v.words) {
    const keep: AgentId[] = [];
    let place: PlaceId | undefined;
    for (const c of Object.values(w.carriers)) {
      if (!believes(c) || !world.order.includes(c.agent) || !adult(world, c.agent)) continue;
      const p = practiceOf(world, w, c.version);
      if (!p || p.kind !== "taboo" || (p.every && day % p.every !== 0)) continue;
      const a = world.agents[c.agent]!;
      const m = world.minds[c.agent]!;
      // Hunger argues back: a household with little food keeps a taboo less often.
      const hh = world.village ? householdOf(world, c.agent) : undefined;
      const hungry = hh && hh.food < hh.members.length * 1.5 ? 0.5 : 1;
      if (rand(v) > c.faith * (0.5 + 0.5 * m.traits.conscientiousness) * hungry) continue;
      c.practiced++;
      c.lastPractice = day;
      keep.push(c.agent);
      place = p.place;
      pull(world, c.agent, a.home, `staying away from ${placeName(world, p.place)}, as the words say`, 9 * 60);
    }
    if (!keep.length || !place) continue;
    w.kept[day] = (w.kept[day] ?? 0) + keep.length;
    feed(world, sink, { kind: "event", agents: keep.slice(0, 8), title: `${keep.length === 1 ? personName(world, keep[0]!) : `${keep.length} people`} won't go near ${placeName(world, place)} today`, text: `Because of what ${LADDER[w.carriers[keep[0]!]!.version.rung]} said.`, rumor: w.id });
  }
}

/** A practice most adults keep, day after day, becomes a rite: one of the things the town expects. */
function settleRites(world: WorldState, sink: Sink): void {
  const v = voiceOf(world);
  const day = dayOf(world.tick);
  const n = Math.max(3, adults(world).length);
  for (const w of v.words) {
    if (w.rite) continue;
    const days = [1, 2, 3, 4, 5].map((k) => w.kept[day - k] ?? 0);
    if (days.filter((x) => x >= n * 0.4).length < 3) continue;
    w.rite = world.tick;
    const keeperC = Object.values(w.carriers).filter(believes).sort((a, b) => b.practiced - a.practiced)[0];
    const p = keeperC ? practiceOf(world, w, keeperC.version) : w.practice;
    if (!p) continue;
    const text = p.kind === "taboo" ? `Keep away from ${placeName(world, p.place)}${p.every ? ` every ${p.every}th day` : ""}` : `${cap(p.act.replace(/^(you |we )/, ""))}${p.at && !/\b(dawn|morning|dusk|evening|night)\b/.test(p.act) ? ` at ${p.at}` : ""}`;
    world.village?.norms.push({ id: `norm_${w.id}`, text, topic: "rite", sanctions: 0, rounds: [], cases: [], established: world.tick, strength: 0.6 });
    v.log.push({ tick: world.tick, kind: "rite", word: w.id, text: `A rite takes hold in ${world.name}: ${text}.` });
    feed(world, sink, { kind: "insight", agents: [], title: `A rite takes hold in ${world.name}`, text: `“${text}.” Most of the town keeps it now. It began with words you said.`, rumor: w.id, chronicle: { kind: "faith" } });
  }
  for (const k of Object.keys(v.witnessed)) if (!world.order.includes(k)) delete v.witnessed[k];
}

// ------------------------------------------------------------------ prophecy

const EVENT_NAME: Record<ProphecyEvent, string> = { gale: "the storm", blight: "the blight", hunger: "the hunger", death: "the death", birth: "the birth" };

async function testProphecies(world: WorldState, fresh: FeedItem[], faculties: Faculties, sink: Sink): Promise<void> {
  const v = voiceOf(world);
  const vil = world.village;
  const happened: { event: ProphecyEvent; how: string; who?: AgentId }[] = [];
  if (vil && vil.weather === "gale" && v.last.weather !== "gale") happened.push({ event: "gale", how: "A gale came in off the sea" });
  if (vil && vil.blight && !v.last.blight) happened.push({ event: "blight", how: "Blight got into the barley" });
  for (const e of world.events.slice(v.last.events)) {
    if (e.kind === "storm") happened.push({ event: "gale", how: "A storm tore across the island" });
    if (e.kind === "blight") happened.push({ event: "blight", how: "Blight got into the barley" });
  }
  for (const f of fresh) {
    if (/ dies$/.test(f.title)) happened.push({ event: "death", how: f.title, who: f.agents[0] });
    if (/ is born\b/.test(f.title)) happened.push({ event: "birth", how: f.title });
    if (/hunger|go hungry|ran out/i.test(`${f.title} ${f.text ?? ""}`) && f.kind === "event") happened.push({ event: "hunger", how: f.title });
  }
  v.last.weather = vil?.weather;
  v.last.blight = vil?.blight;
  v.last.events = world.events.length;
  for (const w of v.words) {
    const p = w.prophecy;
    if (!p || p.outcome || w.pending) continue;
    const hit = happened.find((h) => h.event === p.event && (!p.about || h.who === p.about));
    if (hit) await fulfilled(world, w, hit.how, faculties, sink);
    else if (world.tick > p.by) failed(world, w, sink);
  }
}

/** Make a prophecy come true (you can: you are the weather). */
async function fulfil(world: WorldState, wordId: string, faculties: Faculties, sink: Sink): Promise<void> {
  const v = voiceOf(world);
  const w = v.words.find((x) => x.id === wordId);
  const p = w?.prophecy;
  if (!w || !p || p.outcome) return;
  if (p.event === "gale" && world.village) {
    world.village.weather = "gale";
    feed(world, sink, { kind: "event", agents: [], title: "The sky goes black over the bay", text: "A gale comes in off the sea, out of nowhere, as foretold. Nobody fishes.", rumor: w.id });
  } else if (p.event === "blight" && world.village) {
    world.village.blight = true;
    const id = nextId(world, "ev_blight");
    world.events.push({ id, tick: world.tick, kind: "blight", label: "the blight on the barley", topics: ["barley", "food", "harvest", id] });
    feed(world, sink, { kind: "event", place: "fields", agents: [], title: "Blight in the barley", text: "Black rot along the rows overnight, as foretold.", rumor: w.id });
  } else return;
  await testProphecies(world, [], faculties, sink);
}

async function fulfilled(world: WorldState, w: Word, how: string, faculties: Faculties, sink: Sink): Promise<void> {
  const v = voiceOf(world);
  const p = w.prophecy!;
  p.outcome = "fulfilled";
  p.at = world.tick;
  p.how = how;
  w.zealUntil = world.tick + 3 * 1440;
  const converts: AgentId[] = [];
  for (const c of Object.values(w.carriers)) {
    if (!world.order.includes(c.agent)) continue;
    const m = world.minds[c.agent]!;
    const before = c.faith;
    // Believers are confirmed; doubters who heard it are shaken ("they said it would happen").
    c.faith = believes(c) ? clamp(c.faith + 0.3 * (1 - c.faith)) : clamp(c.faith + 0.3 + 0.2 * m.traits.openness);
    c.lapsed = undefined;
    if (before < 0.45 && c.faith >= 0.45) converts.push(c.agent);
    const bel = m.beliefs.find((b) => b.id === c.belief);
    if (bel) bel.confidence = c.faith;
    const tr = await runPercept(m, {
      id: nextId(m, "pc"),
      tick: m.tick,
      kind: "event",
      rawText: `${how}, just as ${LADDER[c.version.rung]} said it would.`,
      actor: "world",
      addressedToSelf: false,
      about: [],
      topics: [...w.topics, "voice", "faith", "prophecy"],
      features: { outcomeForSelf: -0.2, agency: "circumstance", intentional: 0.6, normViolation: 0, prospective: false, intensity: 0.8 },
      claims: [],
      details: [],
      gist: `${how}, just as ${LADDER[c.version.rung]} foretold.`,
    }, faculties);
    record(world, sink, c.agent, tr);
  }
  const text = `${how}, as you foretold: "${w.text.replace(/[.!?]+$/, "")}." ${Object.values(w.carriers).filter(believes).length} believe now${converts.length ? `, ${converts.length} of them doubters until today` : ""}.`;
  v.log.push({ tick: world.tick, kind: "fulfilled", word: w.id, text, agents: converts });
  feed(world, sink, { kind: "insight", agents: converts.slice(0, 6), title: `The prophecy comes true`, text, rumor: w.id, chronicle: { kind: "faith" } });
}

/** The day passes and nothing comes. The lightly committed fall away; the committed, together, double down. */
function failed(world: WorldState, w: Word, sink: Sink): void {
  const v = voiceOf(world);
  const p = w.prophecy!;
  p.outcome = "failed";
  p.at = world.tick;
  const believers = Object.values(w.carriers).filter((c) => believes(c) && world.order.includes(c.agent));
  const committed = believers.filter((c) => commitment(c) >= 1.15);
  const doubled: AgentId[] = [];
  const lapsed: AgentId[] = [];
  for (const c of believers) {
    const m = world.minds[c.agent]!;
    const bel = m.beliefs.find((b) => b.id === c.belief);
    // Social support matters: alone, even the committed give up (Festinger et al. 1956).
    const support = committed.filter((x) => x.agent !== c.agent && (m.others[x.agent]?.liking ?? 0.5) > 0.4).length;
    if (commitment(c) >= 1.15 && support >= 2) {
      c.faith = clamp(c.faith + 0.05);
      c.doubled = world.tick;
      c.version = { ...c.version, held: true };
      if (bel) {
        bel.confidence = c.faith;
        bel.proposition = renderVersion(world, c.version);
      }
      doubled.push(c.agent);
    } else {
      c.faith = clamp(c.faith * 0.35);
      c.lapsed = world.tick;
      if (bel) bel.confidence = c.faith;
      lapsed.push(c.agent);
      m.affect.emotions.disappointment = clamp(m.affect.emotions.disappointment + 0.3);
    }
  }
  if (doubled.length) w.zealUntil = world.tick + 4 * 1440;
  const what = EVENT_NAME[p.event];
  const text = `The day passes and ${what} never comes.${lapsed.length ? " " : ""}${lapsed.length ? `${lapsed.map((x) => personName(world, x)).slice(0, 4).join(", ")}${lapsed.length > 4 ? ` and ${lapsed.length - 4} more` : ""} ${lapsed.length === 1 ? "stops" : "stop"} believing.` : ""}${doubled.length ? ` ${doubled.map((x) => personName(world, x)).slice(0, 4).join(", ")} ${doubled.length === 1 ? "believes" : "believe"} harder than ever: it was held back because they kept faith.` : ""}`.trim();
  v.log.push({ tick: world.tick, kind: "failed", word: w.id, text, agents: [...doubled, ...lapsed] });
  feed(world, sink, { kind: "insight", agents: [...doubled, ...lapsed].slice(0, 6), title: `${cap(what)} never comes`, text, rumor: w.id, chronicle: { kind: "faith" } });
}

// ------------------------------------------------------------------ faiths and schisms

const FAITH_NOUN = ["Stranger", "Traveller", "Prophet", "Dream", "Messenger", "Sky", "Gods"];
const FAITH_HEAD = ["The Listeners of the", "The Children of the", "The Watchers of the", "The Faithful of the"];

function faithName(v: VoiceState, rung: number, taken: string[]): string {
  for (let i = 0; i < 8; i++) {
    const n = `${FAITH_HEAD[Math.floor(rand(v) * FAITH_HEAD.length)]} ${FAITH_NOUN[rung]}`;
    if (!taken.includes(n)) return n;
  }
  return `The Followers of the ${FAITH_NOUN[rung]} (${taken.length + 1})`;
}

/** Each day: a faith is born when enough believe and there has been a sign or a rite; a faith splits when its keeper and a rival hold different words. */
function faiths(world: WorldState, sink: Sink): void {
  const v = voiceOf(world);
  const living = new Set(world.order);
  const all = adults(world).length || 1;
  // Members are whoever believes some word strongly enough; each faith keeps its own.
  const strongest = (id: AgentId) => v.words.map((w) => ({ w, c: w.carriers[id] })).filter((x): x is { w: Word; c: Carrier } => !!x.c && believes(x.c)).sort((a, b) => b.c.faith - a.c.faith)[0];
  const open = v.faiths.filter((f) => !f.ended);
  if (!open.length) {
    const believers = adults(world).filter((id) => strongest(id));
    const sign = v.words.some((w) => w.prophecy?.outcome === "fulfilled" || w.rite);
    if (believers.length >= Math.max(3, all * 0.3) && (sign || believers.length >= all * 0.5)) {
      const keeper = believers.map((id) => ({ id, s: commitment(strongest(id)!.c) * (0.5 + world.minds[id]!.traits.extraversion) })).sort((a, b) => b.s - a.s)[0]!.id;
      const kc = strongest(keeper)!.c;
      const f: Faith = { id: nextId(v, "faith"), name: faithName(v, kc.version.rung, v.faiths.map((x) => x.name)), founded: world.tick, keeper, members: believers, doctrine: Object.fromEntries(v.words.filter((w) => w.carriers[keeper]).map((w) => [w.id, renderVersion(world, w.carriers[keeper]!.version)])) };
      v.faiths.push(f);
      v.log.push({ tick: world.tick, kind: "faith", text: `A faith is born in ${world.name}: ${f.name}. ${believers.length} believe; ${personName(world, keeper)} keeps it.`, agents: [keeper] });
      feed(world, sink, { kind: "insight", agents: [keeper, ...believers.filter((x) => x !== keeper).slice(0, 5)], title: `A faith is born in ${world.name}: ${f.name}`, text: `${believers.length} of ${all} adults believe. ${personName(world, keeper)} keeps the words: “${renderVersion(world, kc.version)}”`, chronicle: { kind: "faith" } });
    }
    return;
  }
  for (const f of open) {
    f.members = f.members.filter((id) => living.has(id) && strongest(id));
    // New believers join the faith whose keeper's version is closest to their own.
    for (const id of adults(world)) {
      if (open.some((x) => x.members.includes(id)) || !strongest(id)) continue;
      const home = closest(world, v, id, open);
      if (home === f) f.members.push(id);
    }
    if (!living.has(f.keeper) || !f.members.includes(f.keeper)) {
      const next = f.members.map((id) => ({ id, s: commitment(strongest(id)!.c) })).sort((a, b) => b.s - a.s)[0];
      if (!next) {
        f.ended = world.tick;
        v.log.push({ tick: world.tick, kind: "lapsed", text: `${f.name} fades away: nobody keeps it any more.` });
        feed(world, sink, { kind: "insight", agents: [], title: `${f.name} fades away`, text: "Nobody keeps the words any more.", chronicle: { kind: "faith" } });
        continue;
      }
      f.keeper = next.id;
    }
    // In-group warmth (Tajfel & Turner 1979): members drift closer to each other.
    for (const a of f.members) for (const b of f.members) if (a !== b && world.minds[a]!.others[b]) world.minds[a]!.others[b]!.liking = clamp(world.minds[a]!.others[b]!.liking + 0.005);
  }
  shun(world, v);
  // Schism: a committed member whose version has drifted from the keeper's, and who doesn't like the keeper.
  const lastSplit = Math.max(-Infinity, ...v.faiths.map((x) => x.founded));
  for (const f of v.faiths.filter((x) => !x.ended)) {
    // Splits take time to brew, and a town only holds so many sects.
    if (f.members.length < 5 || world.tick - lastSplit < 4 * 1440 || v.faiths.filter((x) => !x.ended).length >= 3) continue;
    const kw = v.words.filter((w) => w.carriers[f.keeper]);
    let rival: { id: AgentId; w: Word; d: number } | undefined;
    for (const id of f.members) {
      if (id === f.keeper) continue;
      const m = world.minds[id]!;
      if ((m.others[f.keeper]?.liking ?? 0.5) >= 0.5) continue;
      for (const w of kw) {
        const c = w.carriers[id];
        if (!c || commitment(c) < 0.8) continue;
        const d = versionDistance(c.version, w.carriers[f.keeper]!.version);
        if (d >= 1 && (!rival || d > rival.d)) rival = { id, w, d };
      }
    }
    if (!rival || rand(v) > 0.5) continue;
    const rc = rival.w.carriers[rival.id]!;
    const kc = rival.w.carriers[f.keeper]!;
    const sect: Faith = { id: nextId(v, "faith"), name: sectName(world, v, f, rival.id), founded: world.tick, keeper: rival.id, members: [], parent: f.id, doctrine: { [rival.w.id]: renderVersion(world, rc.version) }, split: differ(world, rc.version, kc.version) };
    // Everyone follows whichever keeper's version is closer to their own, and whom they like more on a tie.
    const stay: AgentId[] = [];
    for (const id of f.members) {
      const c = rival.w.carriers[id];
      if (id === rival.id) sect.members.push(id);
      else if (id === f.keeper || !c) stay.push(id);
      else {
        const dk = versionDistance(c.version, kc.version);
        const dr = versionDistance(c.version, rc.version);
        const m = world.minds[id]!;
        if (dr < dk || (dr === dk && (m.others[rival.id]?.liking ?? 0.5) > (m.others[f.keeper]?.liking ?? 0.5))) sect.members.push(id);
        else stay.push(id);
      }
    }
    if (sect.members.length < 3 || stay.length < 1) continue;
    f.members = stay;
    v.faiths.push(sect);
    // The two sides cool on each other.
    for (const a of sect.members) for (const b of stay) {
      if (world.minds[a]!.others[b]) world.minds[a]!.others[b]!.liking = clamp(world.minds[a]!.others[b]!.liking - 0.08);
      if (world.minds[b]!.others[a]) world.minds[b]!.others[a]!.liking = clamp(world.minds[b]!.others[a]!.liking - 0.08);
    }
    const text = `${f.name} splits. ${personName(world, rival.id)} leads ${sect.members.length} away as ${sect.name}: ${sect.split}. ${stay.length} stay with ${personName(world, f.keeper)}.`;
    v.log.push({ tick: world.tick, kind: "schism", word: rival.w.id, text, agents: [rival.id, f.keeper] });
    feed(world, sink, { kind: "insight", agents: [rival.id, f.keeper], title: `Schism: ${f.name} splits`, text, rumor: rival.w.id, chronicle: { kind: "faith" } });
  }
}

/**
 * Believers whose words say "send X away" turn on X a little more each day, and X feels it. Someone the
 * town has turned on belongs there less, and is the one most likely to lead a group away (region.ts).
 */
function shun(world: WorldState, v: VoiceState): void {
  for (const w of v.words)
    for (const c of Object.values(w.carriers)) {
      const x = c.version.blame;
      if (!x || !believes(c) || !c.version.unless?.startsWith("send ") || !world.order.includes(x) || !world.order.includes(c.agent)) continue;
      const m = world.minds[c.agent]!;
      const o = m.others[x];
      if (o) o.liking = clamp(o.liking - 0.03 * c.faith);
      const back = world.minds[x]!.others[c.agent];
      if (back) back.believedRegard = clamp(back.believedRegard - 0.04 * c.faith, -1, 1);
    }
}

/** A sect's name: the old faith's, claimed as the true one, or reformed, or named for whoever leads it. */
function sectName(world: WorldState, v: VoiceState, f: Faith, keeper: AgentId): string {
  const base = f.name.replace(/^The (True|Reformed|Old) /, "The ").replace(/^Those Who Follow \w+$/, "the Faith");
  const bare = base.replace(/^The /, "");
  const options = [`The True ${bare}`, `The Reformed ${bare}`, `Those Who Follow ${personName(world, keeper)}`, `The Old ${bare}`];
  const taken = new Set(v.faiths.map((x) => x.name));
  return options.find((n) => !taken.has(n)) ?? `${personName(world, keeper)}'s ${bare}`;
}

function closest(world: WorldState, v: VoiceState, id: AgentId, open: Faith[]): Faith | undefined {
  let best: { f: Faith; d: number } | undefined;
  for (const f of open) {
    let d = 0;
    let n = 0;
    for (const w of v.words) {
      const a = w.carriers[id];
      const b = w.carriers[f.keeper];
      if (a && b) {
        d += versionDistance(a.version, b.version);
        n++;
      }
    }
    const score = n ? d / n : 5;
    if (!best || score < best.d) best = { f, d: score };
  }
  return best?.f;
}

function differ(world: WorldState, a: Version, b: Version): string {
  const parts: string[] = [];
  if (a.blame !== b.blame) parts.push(a.blame ? `they say it is ${personName(world, a.blame)}'s doing` : `they won't blame ${personName(world, b.blame!)}`);
  if (a.unless !== b.unless) parts.push(a.unless ? `they say we must ${a.unless}` : `they reject "${b.unless}"`);
  if (a.chosen !== b.chosen && a.chosen) parts.push(`they say it chose ${personName(world, a.chosen)}`);
  if (Math.abs(a.rung - b.rung) >= 2) parts.push(`they say it was ${LADDER[a.rung]}, not ${LADDER[b.rung]}`);
  if (a.held !== b.held) parts.push(a.held ? "they say the faithful held the storm back" : "they say the prophecy simply failed");
  return parts.join(", and ") || "they hold different words";
}

// ------------------------------------------------------------------ between towns, and towns on rules

/**
 * A trader who believes carries the words to the town they trade with, and tells someone there. Called
 * by the region after its trades. Works whether the far town is live or on rules.
 */
export function carryWords(from: WorldState, to: WorldState, trader: AgentId): void {
  const fv = from.voice;
  if (!fv) return;
  const tv = voiceOf(to);
  for (const w of fv.words) {
    const c = w.carriers[trader];
    if (!c || !believes(c)) continue;
    if (rand(fv) > fervor(from, w, c) + 0.2) continue;
    let tw = tv.words.find((x) => x.id === w.id);
    if (!tw) {
      tw = { ...structuredClone({ ...w, carriers: {}, hops: [], curve: [], kept: {} }), pending: false, rite: undefined, zealUntil: undefined };
      if (tw.prophecy && !tw.prophecy.outcome) tw.prophecy = { ...tw.prophecy };
      tw.subject = tw.subject && to.minds[tw.subject] ? tw.subject : undefined;
      tv.words.push(tw);
    }
    const mind = from.minds[trader]!;
    const listener = to.order.filter((id) => adult(to, id) && !tw!.carriers[id])[Math.floor(rand(tv) * to.order.length) % Math.max(1, to.order.filter((id) => adult(to, id) && !tw!.carriers[id]).length)];
    if (!listener) continue;
    const { version, bends } = bend(from, w, mind, c.version, c.faith);
    // The trader is a stranger here, so the listener weighs the words on authority alone.
    const { faith } = faithOf(to, tw, listener, trader, version, "told");
    const lm = to.minds[listener]!;
    const belief = nextId(lm, "bel");
    lm.beliefs.push({ id: belief, about: "faith", topics: [...tw.topics, "voice", "faith"], proposition: renderVersion(to, version), confidence: faith, valence: tw.valence, source: { kind: "told", from: trader }, formed: to.tick, evidence: [], retrievals: [to.tick], rumor: tw.id });
    tw.carriers[listener] = { agent: listener, from: trader, tick: to.tick, depth: c.depth + 1, version, bends, faith, belief, told: [], heardAgain: 0, practiced: 0 };
    tw.hops.push({ tick: to.tick, from: trader, to: listener, text: renderVersion(to, version), confidence: faith, mutated: bends.length > 0 });
    const text = `${mind.name}, trading from ${from.name}, tells ${lm.name} what ${LADDER[version.rung]} said: "${version.core}"`;
    tv.log.push({ tick: to.tick, kind: "crossed", word: tw.id, text, agents: [listener] });
    fv.log.push({ tick: from.tick, kind: "crossed", word: w.id, text: `${mind.name} carries the words to ${to.name}.`, agents: [trader] });
  }
}

/** A town on rules: no conversations to watch, so believers pass the words on by rule, once a day. */
export function quietSpread(world: WorldState): void {
  const v = world.voice;
  if (!v || !v.words.length) return;
  const day = dayOf(world.tick);
  if (v.last.day === day) return;
  v.last.day = day;
  const people = adults(world);
  for (const w of v.words) {
    for (const c of Object.values(w.carriers)) {
      if (!believes(c) || !world.order.includes(c.agent)) continue;
      if (rand(v) > fervor(world, w, c) * 1.5) continue;
      const cands = people.filter((id) => id !== c.agent && !w.carriers[id]);
      if (!cands.length) break;
      const l = cands[Math.floor(rand(v) * cands.length)]!;
      const { version, bends } = bend(world, w, world.minds[c.agent]!, c.version, c.faith);
      const { faith } = faithOf(world, w, l, c.agent, version, "quiet");
      const m = world.minds[l]!;
      const belief = nextId(m, "bel");
      m.beliefs.push({ id: belief, about: "faith", topics: [...w.topics, "voice", "faith"], proposition: renderVersion(world, version), confidence: faith, valence: w.valence, source: { kind: "told", from: c.agent }, formed: world.tick, evidence: [], retrievals: [world.tick], rumor: w.id });
      w.carriers[l] = { agent: l, from: c.agent, tick: world.tick, depth: c.depth + 1, version, bends, faith, belief, told: [], heardAgain: 0, practiced: 0 };
      c.told.push(l);
      w.hops.push({ tick: world.tick, from: c.agent, to: l, text: renderVersion(world, version), confidence: faith, mutated: bends.length > 0 });
    }
    const cs = Object.values(w.carriers);
    w.curve.push({ tick: world.tick, heard: cs.length, believe: cs.filter(believes).length });
  }
}

// ------------------------------------------------------------------ views

export interface WordSummary {
  id: string;
  tick: Tick;
  guise: Guise;
  text: string;
  to?: AgentId;
  place?: PlaceId;
  pending?: boolean;
  heard: number;
  believe: number;
  lapsed: number;
  versions: number;
  /** The version most believers hold now. */
  common?: string;
  /** The version furthest from what you said. */
  furthest?: { agent: AgentId; text: string; depth: number; bends: number };
  prophecy?: Word["prophecy"] & { event: ProphecyEvent; canFulfil: boolean };
  practice?: string;
  rite?: Tick;
}

export interface VoiceSummary {
  words: WordSummary[];
  faiths: { id: string; name: string; keeper: AgentId; keeperName: string; members: number; parent?: string; split?: string; founded: Tick; ended?: Tick }[];
  log: VoiceLog[];
}

export function voiceSummary(world: WorldState): VoiceSummary | undefined {
  const v = world.voice;
  if (!v) return undefined;
  return {
    words: v.words.map((w) => {
      const cs = Object.values(w.carriers);
      const live = cs.filter((c) => world.order.includes(c.agent));
      const texts = new Map<string, number>();
      for (const c of live.filter(believes)) {
        const t = renderVersion(world, c.version);
        texts.set(t, (texts.get(t) ?? 0) + 1);
      }
      const common = [...texts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const base: Version = { core: w.text, rung: START_RUNG[w.guise] };
      const far = [...cs].sort((a, b) => versionDistance(b.version, base) - versionDistance(a.version, base) || b.depth - a.depth)[0];
      const p = w.practice;
      return {
        id: w.id,
        tick: w.tick,
        guise: w.guise,
        text: w.text,
        to: w.to,
        place: w.place,
        pending: w.pending,
        heard: live.length,
        believe: live.filter(believes).length,
        lapsed: live.filter((c) => c.lapsed).length,
        versions: new Set(cs.map((c) => renderVersion(world, c.version))).size,
        common,
        furthest: far && versionDistance(far.version, base) > 0 ? { agent: far.agent, text: renderVersion(world, far.version), depth: far.depth, bends: far.bends.length } : undefined,
        prophecy: w.prophecy ? { ...w.prophecy, canFulfil: !w.prophecy.outcome && !!world.village && (w.prophecy.event === "gale" || w.prophecy.event === "blight") } : undefined,
        practice: p ? (p.kind === "taboo" ? `Keep away from ${placeName(world, p.place)}${p.every ? ` every ${p.every}th day` : ""}` : `${cap(p.act)} (${p.at})`) : undefined,
        rite: w.rite,
      };
    }),
    faiths: v.faiths.map((f) => ({ id: f.id, name: f.name, keeper: f.keeper, keeperName: personName(world, f.keeper), members: f.members.length, parent: f.parent, split: f.split, founded: f.founded, ended: f.ended })),
    log: v.log.slice(-40),
  };
}

export interface LineageNode {
  agent: AgentId;
  name: string;
  from: AgentId;
  fromName: string;
  tick: Tick;
  depth: number;
  text: string;
  spoken: string;
  bends: Bend[];
  faith: number;
  lapsed?: boolean;
  doubled?: boolean;
  told: number;
  practiced: number;
  trace?: string;
  alive: boolean;
  faith_?: string;
}

export interface Lineage {
  word: WordSummary;
  nodes: LineageNode[];
  curve: Word["curve"];
  /** How often each mechanism bent the words, and who did it most. */
  mechanisms: { kind: BendKind; count: number; by: { agent: AgentId; name: string; count: number }[] }[];
  /** The one person each culprit got blamed by first, with the reason. */
  culprits: { agent: AgentId; name: string; holders: number; first?: { by: AgentId; byName: string; cause?: Bend["cause"] } }[];
  log: VoiceLog[];
}

/** Everything about one of your words: who heard it from whom, what each version says and what bent it. */
export function lineage(world: WorldState, id: string): Lineage | undefined {
  const v = world.voice;
  const w = v?.words.find((x) => x.id === id);
  if (!v || !w) return undefined;
  const summary = voiceSummary(world)!.words.find((x) => x.id === id)!;
  const nodes: LineageNode[] = Object.values(w.carriers)
    .sort((a, b) => a.tick - b.tick)
    .map((c) => ({
      agent: c.agent,
      name: personName(world, c.agent),
      from: c.from,
      fromName: c.from === "visitor" ? `you, as ${guiseName(w.guise)}` : c.from === "sky" ? "you, out of the sky" : c.from === "dream" ? "you, in a dream" : personName(world, c.from),
      tick: c.tick,
      depth: c.depth,
      text: renderVersion(world, c.version),
      spoken: c.version.core,
      bends: c.bends,
      faith: Number(c.faith.toFixed(2)),
      lapsed: !!c.lapsed || undefined,
      doubled: !!c.doubled || undefined,
      told: c.told.length,
      practiced: c.practiced,
      trace: c.trace,
      alive: world.order.includes(c.agent),
      faith_: v.faiths.find((f) => !f.ended && f.members.includes(c.agent))?.name,
    }));
  const mech = new Map<BendKind, Map<AgentId, number>>();
  for (const c of Object.values(w.carriers)) for (const b of c.bends) {
    const m = mech.get(b.kind) ?? new Map<AgentId, number>();
    m.set(b.agent, (m.get(b.agent) ?? 0) + 1);
    mech.set(b.kind, m);
  }
  const culprits = new Map<AgentId, number>();
  for (const c of Object.values(w.carriers)) if (c.version.blame) culprits.set(c.version.blame, (culprits.get(c.version.blame) ?? 0) + 1);
  return {
    word: summary,
    nodes,
    curve: w.curve,
    mechanisms: [...mech.entries()].map(([kind, by]) => ({ kind, count: [...by.values()].reduce((s, x) => s + x, 0), by: [...by.entries()].map(([agent, count]) => ({ agent, name: personName(world, agent), count })).sort((a, b) => b.count - a.count) })).sort((a, b) => b.count - a.count),
    culprits: [...culprits.entries()].map(([agent, holders]) => {
      const first = Object.values(w.carriers).sort((a, b) => a.tick - b.tick).flatMap((c) => c.bends.filter((b) => b.kind === "scapegoat" && c.version.blame === agent))[0];
      return { agent, name: personName(world, agent), holders, first: first ? { by: first.agent, byName: personName(world, first.agent), cause: first.cause } : undefined };
    }),
    log: v.log.filter((l) => l.word === id || l.kind === "faith" || l.kind === "schism"),
  };
}

/** The ledger's extra edges: each bend links what was in the teller's mind to the belief it shaped in the listener. */
export function voiceBends(world: WorldState): { from: { agent: AgentId; kind: "belief" | "schema" | "relation" | "episode"; id: string }; to: { agent: AgentId; id: string }; tick: Tick; label: string }[] {
  const out: ReturnType<typeof voiceBends> = [];
  for (const w of world.voice?.words ?? [])
    for (const c of Object.values(w.carriers))
      for (const b of c.bends) {
        if (!b.cause) continue;
        const m = world.minds[b.agent];
        if (!m) continue;
        const kind = b.cause.kind === "schema" ? "schema" : b.cause.kind === "relation" ? "relation" : b.cause.kind === "belief" ? (m.beliefs.some((x) => x.id === b.cause!.id) ? "belief" : m.episodes.some((e) => e.id === b.cause!.id) ? "episode" : undefined) : undefined;
        if (!kind) continue;
        out.push({ from: { agent: b.agent, kind, id: b.cause.id }, to: { agent: c.agent, id: c.belief }, tick: c.tick, label: `${b.kind}: ${b.text}` });
      }
  return out;
}
