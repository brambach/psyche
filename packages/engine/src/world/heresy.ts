// The Made World: people who start to suspect their world is simulated, and a town that has to live
// with the idea.
//
// Nothing here is scripted. The engine already produces real seams: the same small-talk line from
// three different mouths (templates are cheap, and the cheap tier is exactly where the world repeats
// itself), a voice from the sky or a dream that knows something nobody was told, a friend who wakes
// up a different person after their mind was edited, a belief that arrives with no memory behind it,
// the same moment lived twice after a rewind, a gale out of a clear sky when the player sends one, an
// answer that comes right after someone asks whoever is watching for a sign. Each of these is noticed
// (or not) by a particular person, according to their temperament, and becomes an ordinary memory
// tagged "uncanny".
//
// Suspicion is built from those memories the way the engine builds any belief from experience: at
// night, from the evidence still remembered, weighted by how vivid it is. Openness and a felt lack of
// control make patterns easier to see (Whitson & Galinsky 2008: lacking control increases illusory
// pattern perception); conscientious, closed minds explain things away. A belief that grows strong
// enough, with a frightening memory under it, becomes a core belief, which a parent can pass on at
// bedtime through the existing story machinery.
//
// The idea travels as a story with a lineage, like any rumor, but people take it in according to how
// well it fits what they have seen themselves (a told claim is checked against one's own evidence),
// and they choose how to answer the person telling them. Those who think it madness say so, and
// "Ilse has been saying the world is made" becomes ordinary gossip about Ilse that the normal rumor
// system carries round the town. When the leader hears of it, a closed and orderly leader denounces it
// at the fire. Believers then either go quiet and whisper only to friends (the spiral of silence,
// Noelle-Neumann 1974) or hold on harder because they were told not to (reactance, Brehm 1966). A
// believer who calls out to the watcher and gets no answer either loses faith or, if they have staked
// a lot on it, preaches harder (Festinger, Riecken & Schachter 1956).
//
// Everything leaves the usual provenance behind: anomalies are world events, uncanny memories are
// episodes, beliefs keep their evidence and their teller, core beliefs keep the memory that installed
// them, so the causal ledger can answer "why does Corran think the world is made?" back to the voice
// Ilse heard three days ago.

import { baseLevel, clamp, use } from "../memory.js";
import { dayOf, hourOf, identityOf, runPercept } from "../mind.js";
import { PARAMS } from "../params.js";
import type { ActionOption, Claim, Faculties, Percept } from "../ports.js";
import { nextId, nextRandom } from "../rng.js";
import type { Trace } from "../trace.js";
import type { AgentId, Belief, Episode, MindState, Schema, Tick, Traits } from "../types.js";
import { TRAIT_NAMES } from "../types.js";
import { ageOf, CHILDHOOD } from "./life.js";
import { feed, hop, isNight, personName, record, type FeedItem, type Sink, type WorldState } from "./world.js";

// ---------------------------------------------------------------- state

export type AnomalyKind =
  /** A voice with nobody behind it (the god voice from the sky). */
  | "voice"
  /** A dream that speaks. Dreams are ordinary; a dream that speaks plainly is less so. */
  | "dream"
  /** A voice or dream that knew something the person never told anyone. */
  | "secret"
  /** The same words, verbatim, from three different people. */
  | "echo"
  /** Living a moment again after the world was wound back. */
  | "deja_vu"
  /** Someone close is suddenly not themselves (their mind was edited). */
  | "changed"
  /** Waking up as someone slightly different. */
  | "not_myself"
  /** Knowing something with no memory of how. */
  | "orphan"
  /** Weather or blight that came from nowhere (sent by the player). */
  | "unnatural"
  /** A sign, right after asking whoever is watching for one. */
  | "answered";

/** How much each kind of seam counts as evidence, before temperament and fading. */
export const ANOMALY_WEIGHT: Record<AnomalyKind, number> = {
  voice: 0.6,
  dream: 0.15,
  secret: 0.9,
  echo: 0.18,
  deja_vu: 0.35,
  changed: 0.3,
  not_myself: 0.25,
  orphan: 0.4,
  unnatural: 0.25,
  answered: 0.85,
};

export interface Anomaly {
  /** Also the id of the memory it became, and of the world event the ledger shows. */
  id: string;
  tick: Tick;
  kind: AnomalyKind;
  agent: AgentId;
  /** The person it concerns, when it concerns someone (a friend who changed). */
  about?: AgentId;
  /** The memory as the witness keeps it, first person. */
  text: string;
  weight: number;
  trace?: string;
}

export type HeresyEventKind = "anomaly" | "doubt" | "belief" | "core" | "confide" | "reject" | "sermon" | "denounce" | "tolerate" | "reactance" | "silenced" | "call" | "answered" | "unanswered" | "leader";

export interface HeresyEvent {
  tick: Tick;
  kind: HeresyEventKind;
  agents: AgentId[];
  text: string;
  trace?: string;
}

export interface HeresyState {
  rng: number;
  idCounter: number;
  anomalies: Anomaly[];
  events: HeresyEvent[];
  /** What each person has heard, line by line, and from whom (for echoes). */
  heard: Record<AgentId, Record<string, AgentId[]>>;
  /** Echoes already noticed, as `listener|line`. */
  echoed: string[];
  /** How far traces and feed have been read: the last tick read and the ids read at it. */
  scan: { tick: Tick; traces: string[]; feed: string[] };
  /** Each person's temperament and what they knew as of the last look, to notice edits. */
  seen: Record<AgentId, { traits: Traits; beliefs: string[]; schemas: string[] }>;
  /** People who changed all at once, waiting for someone close to notice. */
  changed: { who: AgentId; tick: Tick; size: number; noticed: AgentId[] }[];
  /** Moments from a discarded timeline, for déjà vu if they come round again. */
  residue: Record<AgentId, { tick: Tick; gist: string }[]>;
  /** Believers who asked whoever is watching for a sign. */
  calls: { who: AgentId; tick: Tick; answered?: boolean; settled?: boolean }[];
  /** Things the player sent into the world, waiting to be noticed. */
  unnatural: { tick: Tick; label: string }[];
  /** Who has passed which line of the story to whom, as `line>listener`. */
  told: string[];
  /** Told beliefs already weighed against the hearer's own experience, as `agent:belief`. */
  judged: string[];
  /** Times each believer has spoken of it: their stake in it. */
  zeal: Record<AgentId, number>;
  /** Daily head count by faction. */
  census: { tick: Tick; believers: number; hidden: number; doubters: number; skeptics: number; unaware: number }[];
  last: { day: number; sermon: number; denounce: number; tolerated?: AgentId; leaderBeliever?: AgentId };
  /** Seams noticed but not yet lived through as a memory (noticed at night, felt in the morning). */
  found: Found[];
}

export function enableHeresy(world: WorldState): HeresyState {
  if (world.heresy) return world.heresy;
  const h: HeresyState = {
    rng: (world.seed * 3266489917 + 668265263) >>> 0,
    idCounter: 0,
    anomalies: [],
    events: [],
    heard: {},
    echoed: [],
    scan: { tick: world.tick, traces: [], feed: [] },
    seen: {},
    changed: [],
    residue: {},
    calls: [],
    unnatural: [],
    told: [],
    judged: [],
    zeal: {},
    census: [],
    last: { day: dayOf(world.tick), sermon: 0, denounce: 0 },
    found: [],
  };
  world.heresy = h;
  for (const id of world.order) h.seen[id] = look(world.minds[id]!);
  return h;
}

// ---------------------------------------------------------------- the beliefs involved

/** Topics every belief and memory in this business carries, so they come to mind together. */
export const UNCANNY = "uncanny";
export const MADE = "made-world";
const ORTHODOX = "orthodoxy";
const SILENCE = "silence";

/** The suspicion, worded by how far it has gone. */
export function heresyText(confidence: number): string {
  if (confidence >= 0.75) return "None of this is real. Someone made us, and moves us.";
  if (confidence >= 0.5) return "The world was made, and someone is watching it.";
  return "Something about the world is not right.";
}
export const CORE_TEXT = "Nothing here is real. Something is watching.";
const ORTHODOX_TEXT = "The world is only the world. Talk of it being made is madness.";
const SILENCE_TEXT = "Speaking of the made world brings trouble.";

export const heresyOf = (m: MindState): Belief | undefined => m.beliefs.find((b) => b.about === "world" && b.topics.includes(MADE));
export const orthodoxyOf = (m: MindState): Belief | undefined => m.beliefs.find((b) => b.about === "world" && b.topics.includes(ORTHODOX));
export const silenceOf = (m: MindState): Belief | undefined => m.beliefs.find((b) => b.about === "village" && b.topics.includes(SILENCE));
const conf = (b: Belief | undefined) => b?.confidence ?? 0;
/** A judgement about a believer ("Ilse isn't right in the head"), which plain gossip carries. */
const scornOf = (m: MindState, about?: AgentId) => m.beliefs.filter((b) => b.topics.includes(MADE) && b.about !== "world" && (!about || b.about === about));

/**
 * How readily a mind sees a pattern behind things: openness and a felt lack of control raise it,
 * a conscientious, closed mind explains things away, worry adds a little.
 */
export function susceptibility(m: MindState): number {
  const t = m.traits;
  return clamp(0.25 + 0.8 * t.openness - 0.35 * t.conscientiousness * (1 - t.openness) + 0.15 * t.neuroticism + 0.3 * (0.5 - m.self.control), 0.05, 1.2);
}

/** How strongly a mind reaches for the plain explanation. */
const mundane = (m: MindState) => m.traits.conscientiousness * (1 - m.traits.openness);

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

export interface Evidence {
  /** Weighted, faded sum of what they have lived through themselves (capped per kind). */
  total: number;
  episodes: { ep: Episode; kind: AnomalyKind | "told"; value: number }[];
}

/**
 * The uncanny things a person still remembers, each weighted by its kind and how vivid it still is.
 * Only the two strongest of each kind count, so a hundred echoes are not a revelation.
 * Uncanny stories heard from others (at the fire, say) count for a little.
 */
export function evidenceOf(world: WorldState, m: MindState): Evidence {
  const h = world.heresy;
  const kinds = new Map((h?.anomalies ?? []).filter((a) => a.agent === m.id).map((a) => [a.id, a]));
  const items: Evidence["episodes"] = [];
  for (const ep of m.episodes) {
    if (!ep.topics.includes(UNCANNY)) continue;
    const a = kinds.get(ep.id);
    const vivid = logistic(baseLevel(ep.retrievals, world.tick, PARAMS.memory.gistDecay));
    const w = a ? a.weight : 0.12;
    items.push({ ep, kind: a?.kind ?? "told", value: w * (0.4 + 0.6 * vivid) });
  }
  const byKind = new Map<string, number[]>();
  for (const it of items) (byKind.get(it.kind) ?? byKind.set(it.kind, []).get(it.kind)!).push(it.value);
  let total = 0;
  for (const vs of byKind.values()) total += vs.sort((a, b) => b - a).slice(0, 2).reduce((s, v) => s + v, 0);
  return { total, episodes: items.sort((a, b) => b.value - a.value) };
}

/** Doubt from one's own experience: evidence, times temperament, held back by the orthodox view. */
export function doubtOf(world: WorldState, m: MindState): number {
  return evidenceOf(world, m).total * susceptibility(m) * (1 - 0.5 * conf(orthodoxyOf(m)));
}

export type Faction = "believer" | "hidden" | "doubter" | "skeptic" | "authority" | "unaware";

export function factionOf(world: WorldState, id: AgentId): Faction {
  const m = world.minds[id]!;
  const h = world.heresy;
  const H = conf(heresyOf(m));
  if (H < 0.5 && h?.events.some((e) => e.kind === "denounce" && e.agents[0] === id)) return "authority";
  if (H >= 0.5) return conf(silenceOf(m)) >= 0.4 ? "hidden" : "believer";
  if (H >= 0.2) return "doubter";
  if (conf(orthodoxyOf(m)) >= 0.3 || scornOf(m).some((b) => b.confidence >= 0.35)) return "skeptic";
  return "unaware";
}

// ---------------------------------------------------------------- the step

const adult = (world: WorldState, id: AgentId) => !world.village || ageOf(world, id) >= CHILDHOOD;
const rand = (h: HeresyState) => nextRandom(h);
const nm = (world: WorldState, id: AgentId) => personName(world, id);

/** Called by the world every step, after the village has done its business. */
export async function heresyStep(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const h = world.heresy;
  if (!h) return;
  scan(world, h, sink);
  noticeEdits(world, h);
  if (isNight(world.tick)) return;
  const day = dayOf(world.tick);
  if (day !== h.last.day) {
    h.last.day = day;
    await morning(world, h, faculties, sink);
  }
  await dejaVu(world, h, faculties, sink);
  await noticeChanged(world, h, faculties, sink);
  await noticeUnnatural(world, h, faculties, sink);
  await pending(world, h, faculties, sink);
  await confiding(world, h, faculties, sink);
  const hr = hourOf(world.tick);
  if (hr >= 19.6 && hr < 22) await evening(world, h, faculties, sink);
}

// ---------------------------------------------------------------- noticing

/** Anomalies found by reading, run as percepts at the next point where minds can act. */
export interface Found {
  kind: AnomalyKind;
  agent: AgentId;
  about?: AgentId;
  text: string;
  label: string;
  intensity: number;
}
const enqueue = (h: HeresyState, f: Found) => {
  h.found.push(f);
  if (h.found.length > 60) h.found.splice(0, h.found.length - 60);
};

/** Words that mark a memory as private enough that a voice knowing it is uncanny. */
const STOP = new Set(["about", "after", "again", "always", "because", "before", "being", "could", "every", "never", "other", "people", "right", "should", "their", "there", "these", "thing", "think", "those", "under", "until", "where", "which", "while", "would", "world", "something", "nothing", "everyone", "someone"]);
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z']{5,}/g)?.filter((w) => !STOP.has(w)) ?? []);

/** Read what happened since the last step: voices from nowhere, and lines heard before. */
function scan(world: WorldState, h: HeresyState, sink: Sink): void {
  // Read backwards from the newest until reaching what was read last time.
  const newTraces: Sink["traces"] = [];
  for (let i = sink.traces.length - 1; i >= 0; i--) {
    const t = sink.traces[i]!;
    if (t.trace.tick < h.scan.tick) break;
    if (t.trace.tick > h.scan.tick || !h.scan.traces.includes(t.trace.id)) newTraces.unshift(t);
  }
  const newFeed: FeedItem[] = [];
  for (let i = sink.feed.length - 1; i >= 0; i--) {
    const f = sink.feed[i]!;
    if (f.tick < h.scan.tick) break;
    if (f.tick > h.scan.tick || !h.scan.feed.includes(f.id)) newFeed.unshift(f);
  }
  const top = Math.max(h.scan.tick, ...newTraces.map((t) => t.trace.tick), ...newFeed.map((f) => f.tick));
  h.scan = {
    tick: top,
    traces: [...(top === h.scan.tick ? h.scan.traces : []), ...newTraces.filter((t) => t.trace.tick === top).map((t) => t.trace.id)],
    feed: [...(top === h.scan.tick ? h.scan.feed : []), ...newFeed.filter((f) => f.tick === top).map((f) => f.id)],
  };

  for (const { agent, trace } of newTraces) {
    const p = trace.percept;
    if (!p || p.kind !== "speech" || p.actor === "visitor" || p.actor === "world" || p.actor in world.minds || !world.minds[agent]) continue;
    voiceHeard(world, h, agent, trace);
  }
  for (const f of newFeed) echoes(world, h, f);
}

/** A voice with nobody behind it. Its memory becomes uncanny where it lies; nothing new is encoded. */
function voiceHeard(world: WorldState, h: HeresyState, agent: AgentId, trace: Trace): void {
  const m = world.minds[agent]!;
  const p = trace.percept!;
  const ep = trace.encoded ? m.episodes.find((e) => e.id === trace.encoded) : undefined;
  if (!ep || h.anomalies.some((a) => a.id === ep.id)) return;
  const dream = p.actor === "dream" || p.topics.includes("dream");
  // What only they could know: a core belief, or a memory never told to anyone.
  const said = new Set((world.agents[agent]?.told ?? []).map((t) => t.split(">")[0]!.replace(`rum_${agent}_`, "")));
  const heard = words(p.rawText);
  const privy = [...m.schemas.map((s) => s.text), ...m.episodes.filter((e) => e.id !== ep.id && e.source.kind !== "told" && !said.has(e.id) && Math.abs(e.valence) > 0.3).map((e) => e.gist)];
  const knew = privy.find((t) => [...words(t)].filter((w) => heard.has(w)).length >= 2);
  const kind: AnomalyKind = knew ? "secret" : dream ? "dream" : "voice";
  ep.topics = [...new Set([...ep.topics, UNCANNY, "world", kind])];
  ep.arousal = Math.max(ep.arousal, kind === "dream" ? 0.4 : 0.75);
  if (ep.valence > -0.3 && kind !== "dream") ep.valence = Number((ep.valence * 0.5 - 0.3).toFixed(2));
  const text = knew ? `${ep.gist} It knew something I have never told anyone.` : ep.gist;
  addAnomaly(world, h, { id: ep.id, tick: ep.tick, kind, agent, text, weight: ANOMALY_WEIGHT[kind], trace: trace.id });
  answer(world, h, agent, kind === "dream" ? "a dream that spoke" : "a voice from nowhere");
}

const LINE_MIN_WORDS = 3;
const LINE_MAX_WORDS = 14;

/** The same words from three different people. */
function echoes(world: WorldState, h: HeresyState, f: FeedItem): void {
  // Only words said to them, face to face: a pledge or a story at the fire is meant to sound the same.
  if (f.kind !== "talk" || !f.lines || f.rumor || f.agents.length !== 2) return;
  for (const line of f.lines) {
    const text = line.text.trim();
    const n = text.split(/\s+/).length;
    if (n < LINE_MIN_WORDS || n > LINE_MAX_WORDS || !(line.speaker in world.minds)) continue;
    for (const listener of f.agents) {
      if (listener === line.speaker || !world.minds[listener] || !adult(world, listener)) continue;
      const heard = (h.heard[listener] ??= {});
      const from = (heard[text] ??= []);
      if (!from.includes(line.speaker)) from.push(line.speaker);
      if (from.length < 3 || h.echoed.includes(`${listener}|${text}`)) continue;
      h.echoed.push(`${listener}|${text}`);
      const m = world.minds[listener]!;
      if (rand(h) > 0.15 + 0.45 * m.traits.openness) continue;
      const who = from.slice(-3).map((x) => nm(world, x));
      enqueue(h, { kind: "echo", agent: listener, text: `${who[0]}, ${who[1]} and ${who[2]} have all said the very same words to me: "${text}"`, label: `the same words from three mouths`, intensity: 0.45 });
    }
    // Keep each person's ear small: lines heard once, oldest first, go.
    for (const listener of f.agents) {
      const heard = h.heard[listener];
      if (!heard) continue;
      const keys = Object.keys(heard);
      if (keys.length > 80) for (const k of keys.filter((k) => heard[k]!.length < 2).slice(0, keys.length - 60)) delete heard[k];
    }
  }
  if (h.echoed.length > 400) h.echoed.splice(0, h.echoed.length - 400);
}

function look(m: MindState): HeresyState["seen"][string] {
  return { traits: { ...m.traits }, beliefs: m.beliefs.map((b) => b.id), schemas: m.schemas.map((s) => s.id) };
}

/** A mind changed from outside: a big jump in temperament, or something known with no history. */
function noticeEdits(world: WorldState, h: HeresyState): void {
  for (const id of world.order) {
    const m = world.minds[id]!;
    const was = h.seen[id];
    h.seen[id] = look(m);
    if (!was) continue;
    const size = TRAIT_NAMES.reduce((s, t) => s + Math.abs(m.traits[t] - was.traits[t]), 0);
    if (size > 0.12) {
      h.changed.push({ who: id, tick: world.tick, size, noticed: [] });
      if (size > 0.2 && rand(h) < 0.5 && adult(world, id)) enqueue(h, { kind: "not_myself", agent: id, text: "I woke up not feeling like myself. Things I would never have done seem natural now.", label: "waking up someone else", intensity: 0.5 });
    }
    const before = new Set(was.schemas);
    for (const s of m.schemas) {
      if (before.has(s.id) || s.origin?.length || s.text === CORE_TEXT) continue;
      enqueue(h, { kind: "orphan", agent: id, text: `I am sure of it, "${s.text}", but I can't remember how I came to be sure.`, label: "a certainty with no memory behind it", intensity: 0.6 });
    }
    const known = new Set(was.beliefs);
    for (const b of m.beliefs) {
      if (known.has(b.id) || b.evidence.length || b.source.kind === "told" || b.topics.includes(MADE) || b.topics.includes(ORTHODOX) || b.topics.includes(SILENCE) || b.about === "village" || b.about.startsWith("town:")) continue;
      enqueue(h, { kind: "orphan", agent: id, text: `I know that ${b.proposition.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}, but I can't think how I know it.`, label: "knowing without remembering", intensity: 0.5 });
    }
  }
  if (h.changed.length > 40) h.changed.splice(0, h.changed.length - 40);
}

/** Someone close to a changed person notices, the next time they are together. */
async function noticeChanged(world: WorldState, h: HeresyState, _faculties: Faculties, _sink: Sink): Promise<void> {
  for (const c of h.changed) {
    if (world.tick - c.tick > 3 * 1440 || !world.agents[c.who]) continue;
    const place = world.agents[c.who]!.place;
    for (const id of world.order) {
      if (id === c.who || c.noticed.includes(id) || world.agents[id]!.place !== place || !adult(world, id)) continue;
      const o = world.minds[id]!.others[c.who];
      if (!o || (o.bond < 0.3 && o.liking < 0.65)) continue;
      c.noticed.push(id);
      if (rand(h) > clamp(c.size * 1.5) * (0.4 + 0.6 * o.bond)) continue;
      enqueue(h, { kind: "changed", agent: id, about: c.who, text: `${nm(world, c.who)} isn't ${world.minds[c.who]!.pronouns.reflexive}. Overnight, for no reason, a different person.`, label: `${nm(world, c.who)} changed overnight`, intensity: 0.55 });
    }
  }
}

/** Something the player sent: a storm, gale or blight out of nowhere. Called by `inject`. */
export function markUnnatural(world: WorldState, label: string): void {
  const h = world.heresy;
  if (!h) return;
  h.unnatural.push({ tick: world.tick, label });
  for (const c of h.calls) if (!c.answered && world.tick - c.tick <= 1440) answer(world, h, c.who, label);
}

async function noticeUnnatural(world: WorldState, h: HeresyState, _faculties: Faculties, _sink: Sink): Promise<void> {
  if (!h.unnatural.length) return;
  for (const u of h.unnatural.splice(0)) {
    for (const id of world.order) {
      const m = world.minds[id]!;
      if (!adult(world, id) || rand(h) > 0.1 + 0.3 * m.traits.openness * (1 - mundane(m))) continue;
      enqueue(h, { kind: "unnatural", agent: id, text: `${u.label.replace(/^./, (c) => c.toUpperCase())} came out of nowhere. The sky gave no warning at all.`, label: u.label, intensity: 0.5 });
    }
  }
}

/** A sign, right after asking for one. */
function answer(world: WorldState, h: HeresyState, who: AgentId, what: string): void {
  const c = h.calls.find((x) => x.who === who && !x.answered && world.tick - x.tick <= 1440);
  if (!c) return;
  c.answered = true;
  enqueue(h, { kind: "answered", agent: who, text: `I asked whoever is watching for a sign, and then came ${what}. It answered me.`, label: "an answer to a call", intensity: 0.85 });
}

/** Keep moments from a timeline that was wound back, so they can come round again as déjà vu. */
export function leaveResidue(discarded: WorldState, restored: WorldState): void {
  const h = restored.heresy;
  if (!h) return;
  for (const id of restored.order) {
    const m = discarded.minds[id];
    if (!m) continue;
    const later = m.episodes
      .filter((e) => e.tick > restored.tick && e.source.kind === "witnessed" && Math.abs(e.valence) * (0.3 + e.arousal) >= 0.12 && !e.topics.includes(UNCANNY))
      .sort((a, b) => Math.abs(b.valence) * b.arousal - Math.abs(a.valence) * a.arousal)
      .slice(0, 6)
      .map((e) => ({ tick: e.tick, gist: e.gist }));
    if (later.length) h.residue[id] = [...(h.residue[id] ?? []), ...later].slice(-12);
  }
}

async function dejaVu(world: WorldState, h: HeresyState, _faculties: Faculties, _sink: Sink): Promise<void> {
  for (const [id, items] of Object.entries(h.residue)) {
    const m = world.minds[id];
    if (!m) {
      delete h.residue[id];
      continue;
    }
    // Looked at just after the moment would have come round (it is lived later in the same step).
    const due = items.filter((r) => r.tick < world.tick);
    if (!due.length) continue;
    h.residue[id] = items.filter((r) => r.tick >= world.tick);
    // Only what actually comes round again: the same thing happening to them, give or take an hour.
    for (const r of due) {
      if (world.tick - r.tick > 90) continue;
      const again = m.episodes.some((e) => e.gist === r.gist && Math.abs(e.tick - r.tick) <= 60);
      if (!again || rand(h) > 0.3 + 0.5 * m.traits.openness) continue;
      enqueue(h, { kind: "deja_vu", agent: id, text: `I have lived this exact moment before: ${r.gist.replace(/\.$/, "")}. Every word of it.`, label: "a moment lived twice", intensity: 0.6 });
    }
  }
}

function addAnomaly(world: WorldState, h: HeresyState, a: Anomaly): void {
  h.anomalies.push(a);
  if (h.anomalies.length > 600) h.anomalies.splice(0, h.anomalies.length - 600);
  h.events.push({ tick: a.tick, kind: "anomaly", agents: a.about ? [a.agent, a.about] : [a.agent], text: a.text, trace: a.trace });
  trimEvents(h);
  void world;
}

const trimEvents = (h: HeresyState) => {
  if (h.events.length > 800) h.events.splice(0, h.events.length - 800);
};

/** Turn what was found into memories: an ordinary percept, tagged uncanny, with a world event behind it. */
async function pending(world: WorldState, h: HeresyState, faculties: Faculties, sink: Sink): Promise<void> {
  if (!h.found.length) return;
  for (const f of h.found.splice(0)) {
    const m = world.minds[f.agent];
    if (!m) continue;
    const id = nextId(world, "ev_uncanny");
    world.events.push({ id, tick: world.tick, kind: "anomaly", label: `${nm(world, f.agent)}: ${f.label}`, topics: [UNCANNY, id] });
    if (world.events.length > 400) world.events.splice(0, world.events.length - 400);
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: world.tick,
      kind: "event",
      rawText: f.text,
      actor: "world",
      addressedToSelf: false,
      about: f.about ? [f.about] : [],
      topics: [UNCANNY, "world", f.kind],
      features: { outcomeForSelf: -0.25 - 0.3 * f.intensity, agency: "circumstance", intentional: 0, normViolation: 0, prospective: false, intensity: f.intensity },
      claims: [],
      details: [],
      gist: f.text,
      eventId: id,
    };
    const t = await runPercept(m, p, faculties);
    const ep = m.episodes.find((e) => e.id === t.encoded);
    if (ep) ep.arousal = Math.max(ep.arousal, f.intensity);
    record(world, sink, f.agent, t);
    addAnomaly(world, h, { id: t.encoded ?? id, tick: world.tick, kind: f.kind, agent: f.agent, about: f.about, text: f.text, weight: ANOMALY_WEIGHT[f.kind], trace: t.id });
    feed(world, sink, { kind: "insight", place: world.agents[f.agent]?.place, agents: f.about ? [f.agent, f.about] : [f.agent], title: `Something uncanny: ${nm(world, f.agent)} notices ${f.label}`, text: f.text, refs: [{ agent: f.agent, trace: t.id }] });
  }
}

// ---------------------------------------------------------------- the night's reckoning

/** Each morning, what everyone made overnight of the uncanny things they remember. */
async function morning(world: WorldState, h: HeresyState, faculties: Faculties, sink: Sink): Promise<void> {
  settleCalls(world, h, sink);
  for (const id of world.order) {
    if (!adult(world, id)) continue;
    const m = world.minds[id]!;
    const ev = evidenceOf(world, m);
    const D = ev.total * susceptibility(m) * (1 - 0.5 * conf(orthodoxyOf(m)));
    let H = heresyOf(m);
    const before = conf(H);
    if (!H && D >= 0.3) {
      H = {
        id: nextId(m, "bel"),
        about: "world",
        topics: ["world", UNCANNY, MADE],
        proposition: heresyText(clamp(D, 0, 0.95)),
        confidence: clamp(D, 0, 0.95),
        valence: -0.3,
        source: { kind: "inferred" },
        formed: world.tick,
        evidence: ev.episodes.slice(0, 6).map((x) => x.ep.id),
        retrievals: [world.tick],
      };
      m.beliefs.push(H);
      event(world, h, sink, "doubt", [id], `${nm(world, id)} has started to think ${H.proposition.replace(/^./, (c) => c.toLowerCase())}`, `From ${ev.episodes.length} uncanny ${ev.episodes.length === 1 ? "memory" : "memories"}: ${ev.episodes.slice(0, 2).map((x) => `"${x.ep.gist}"`).join(", ")}.`);
    } else if (H) {
      if (H.source.kind === "inferred") {
        // Belief perseverance: it fades slowly, but never below what the remembered evidence supports.
        H.confidence = clamp(Math.max(H.confidence * 0.97, Math.min(D, 0.95)));
        H.evidence = [...new Set([...H.evidence, ...ev.episodes.slice(0, 6).map((x) => x.ep.id)])].slice(-8);
      } else {
        // A story told to them, checked against their own experience: it fits, or it fades.
        H.confidence = clamp(H.confidence * (0.97 - 0.05 * (1 - Math.min(susceptibility(m), 1))) + 0.25 * D * (1 - H.confidence), 0, 0.95);
        for (const x of ev.episodes.slice(0, 3)) if (!H.evidence.includes(x.ep.id)) H.evidence.push(x.ep.id);
        if (H.evidence.length > 8) H.evidence.splice(0, H.evidence.length - 8);
      }
      const text = heresyText(H.confidence);
      if (text !== H.proposition) {
        const deeper = H.confidence > before;
        H.proposition = text;
        if (deeper && H.confidence >= 0.5 && before < 0.5) event(world, h, sink, "belief", [id], `${nm(world, id)} now believes the world was made`, `"${text}"`);
      }
    }
    // A strong belief with a frightening memory under it becomes a core belief.
    if (H && H.confidence >= 0.7 && !m.schemas.some((s) => s.text === CORE_TEXT)) {
      const D_ = PARAMS.development;
      const formative = ev.episodes.filter((x) => x.kind !== "told" && x.ep.arousal >= D_.formativeArousal * 0.8 && x.ep.valence < -0.35 && x.ep.coping < D_.formativeCoping + 0.15);
      if (formative.length) {
        const s: Schema = { id: nextId(m, "sch"), text: CORE_TEXT, triggers: [UNCANNY, "world", MADE], blameBias: 0, threatBias: 0.2, strength: clamp(0.3 + 0.3 * H.confidence), origin: formative.slice(0, 3).map((x) => x.ep.id) };
        m.schemas.push(s);
        event(world, h, sink, "core", [id], `It has become a core belief for ${nm(world, id)}: "${CORE_TEXT}"`, `Installed by ${formative.slice(0, 2).map((x) => `"${x.ep.gist}"`).join(" and ")}.`);
      }
    }
  }
  await calling(world, h, faculties, sink);
  const tally = { tick: world.tick, believers: 0, hidden: 0, doubters: 0, skeptics: 0, unaware: 0 };
  for (const id of world.order) {
    if (!adult(world, id)) continue;
    const f = factionOf(world, id);
    if (f === "believer") tally.believers++;
    else if (f === "hidden") tally.hidden++;
    else if (f === "doubter") tally.doubters++;
    else if (f === "skeptic" || f === "authority") tally.skeptics++;
    else tally.unaware++;
  }
  h.census.push(tally);
  if (h.census.length > 400) h.census.splice(0, h.census.length - 400);
  const leader = leaderOf(world);
  if (leader && conf(heresyOf(world.minds[leader]!)) >= 0.5 && h.last.leaderBeliever !== leader) {
    h.last.leaderBeliever = leader;
    event(world, h, sink, "leader", [leader], `${nm(world, leader)}, who leads ${world.name}, believes the world was made`, undefined, true);
  }
}

function event(world: WorldState, h: HeresyState, sink: Sink, kind: HeresyEventKind, agents: AgentId[], title: string, text?: string, chronicle = false, trace?: { agent: AgentId; trace: string }): void {
  h.events.push({ tick: world.tick, kind, agents, text: text ? `${title}. ${text}` : `${title}.`, trace: trace?.trace });
  trimEvents(h);
  feed(world, sink, { kind: "insight", place: world.agents[agents[0]!]?.place, agents, title, text, refs: trace ? [trace] : undefined, chronicle: chronicle ? { kind: "heresy", why: agents.map((a) => ({ text: whyLine(world, a), agent: a })) } : undefined });
}

/** One line on why someone believes: their own experience, or who told them. */
function whyLine(world: WorldState, id: AgentId): string {
  const m = world.minds[id]!;
  const H = heresyOf(m);
  if (!H) return `${nm(world, id)} does not believe it`;
  if (H.source.kind === "told" && H.source.from) return `${nm(world, id)} heard it from ${nm(world, H.source.from)}`;
  const ev = evidenceOf(world, m).episodes[0];
  return ev ? `${nm(world, id)} saw it for ${m.pronouns.reflexive}: "${ev.ep.gist}"` : `${nm(world, id)} came to it alone`;
}

// ---------------------------------------------------------------- calling out to the watcher

/** A believer, alone, asks whoever is watching for a sign. */
async function calling(world: WorldState, h: HeresyState, faculties: Faculties, sink: Sink): Promise<void> {
  for (const id of world.order) {
    const m = world.minds[id]!;
    const H = heresyOf(m);
    if (!H || H.confidence < 0.6 || m.traits.openness < 0.5 || !adult(world, id)) continue;
    const last = h.calls.filter((c) => c.who === id).at(-1);
    if (last && world.tick - last.tick < 3 * 1440) continue;
    if (rand(h) > 0.35) continue;
    const line = (
      await faculties.speak({
        self: identityOf(m),
        listener: { id: "sky", name: "whoever is watching" },
        heard: "",
        intent: { option: "Call out to the watcher", description: "Alone, ask whoever made the world and is watching it for a sign that they are there." },
        content: [],
        style: { warmth: 0.4, curtness: 0.1, hedging: clamp(m.traits.neuroticism * 0.5), verbosity: 0.4 },
        stance: ["You are alone, early in the morning, speaking to the sky. One or two sentences."],
        salience: 0.5,
      })
    ).utterance;
    h.calls.push({ who: id, tick: world.tick });
    if (h.calls.length > 100) h.calls.splice(0, h.calls.length - 100);
    use(H.retrievals, world.tick);
    h.events.push({ tick: world.tick, kind: "call", agents: [id], text: `${nm(world, id)} called out to whoever is watching: "${line}"` });
    feed(world, sink, { kind: "talk", place: world.agents[id]!.place, agents: [id], title: `${nm(world, id)} calls out to whoever is watching`, lines: [{ speaker: id, text: line }], text: "If anyone answers within the day, they will take it as a sign." });
  }
}

/** A day on, unanswered calls are reckoned with: faith fades, unless much has been staked on it. */
function settleCalls(world: WorldState, h: HeresyState, sink: Sink): void {
  for (const c of h.calls) {
    if (c.settled || c.answered || world.tick - c.tick < 1440) continue;
    c.settled = true;
    const m = world.minds[c.who];
    const H = m && heresyOf(m);
    if (!m || !H) continue;
    const stake = h.zeal[c.who] ?? 0;
    if (stake >= 2) {
      // When prophecy fails, the committed preach harder (Festinger, Riecken & Schachter 1956).
      h.zeal[c.who] = stake + 1;
      event(world, h, sink, "unanswered", [c.who], `Nobody answered ${nm(world, c.who)}, and ${m.pronouns.subject} only talks of it more`, `${cap(m.pronouns.subject)} has told ${stake} ${stake === 1 ? "person" : "people"} already; too much is staked on it to let it go.`);
    } else {
      H.confidence = clamp(H.confidence - 0.08);
      H.proposition = heresyText(H.confidence);
      event(world, h, sink, "unanswered", [c.who], `Nobody answered ${nm(world, c.who)}`, `${cap(m.pronouns.subject)} is a little less sure now.`);
    }
  }
}

// ---------------------------------------------------------------- telling people

const HERESY_TOPICS = ["world", UNCANNY, MADE];

/** Believers tell people they trust, a pair at a time, when they find themselves together. */
async function confiding(world: WorldState, h: HeresyState, faculties: Faculties, sink: Sink): Promise<void> {
  for (const a of world.order) {
    const A = world.minds[a]!;
    const H = heresyOf(A);
    if (!H || H.confidence < 0.45 || !adult(world, a)) continue;
    const ag = world.agents[a]!;
    // Anywhere people talk, and at home, where secrets are mostly told.
    if ((ag.talkingUntil ?? 0) > world.tick || !(world.places[ag.place]?.social || ag.place === ag.home)) continue;
    const silence = conf(silenceOf(A));
    const zeal = 1 + 0.25 * Math.min(h.zeal[a] ?? 0, 4) * (h.calls.some((c) => c.who === a && c.settled && !c.answered) ? 1.5 : 1);
    const line = H.rumor ?? `heresy_${a}_${H.id}`;
    const near = world.order.filter((b) => b !== a && adult(world, b) && world.agents[b]!.place === ag.place && (world.agents[b]!.talkingUntil ?? 0) <= world.tick && !h.told.includes(`${line}>${b}`) && conf(heresyOf(world.minds[b]!)) < 0.5);
    if (!near.length) continue;
    // Under suspicion, only those they like best are told, and quietly.
    const liked = near.map((b) => ({ b, liking: A.others[b]?.liking ?? 0.4 })).filter((x) => x.liking >= (silence > 0.3 ? 0.62 : 0.4)).sort((x, y) => y.liking - x.liking);
    const pick = liked[0];
    if (!pick) continue;
    // Whoever has told nobody yet feels the need to tell someone most.
    const first = (h.zeal[a] ?? 0) === 0 ? 2 : 1;
    const p = 0.07 * (0.4 + A.traits.extraversion) * H.confidence * zeal * first * (1 - silence) * (0.5 + pick.liking);
    if (rand(h) >= p) continue;
    await confide(world, h, a, pick.b, faculties, sink);
  }
}

/** Ensure a believer's belief carries a story line other people can inherit. */
function lineOf(world: WorldState, a: AgentId, H: Belief): string {
  const id = H.rumor ?? `heresy_${a}_${H.id}`;
  H.rumor = id;
  if (!world.rumors[id]) world.rumors[id] = { id, subject: "world", origin: H.source.kind === "told" && H.source.from ? H.source.from : a, first: H.proposition, hops: [] };
  return id;
}

/** One believer tells one person, who chooses how to take it. */
export async function confide(world: WorldState, h: HeresyState, a: AgentId, b: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const A = world.minds[a]!;
  const B = world.minds[b]!;
  const H = heresyOf(A)!;
  const line = lineOf(world, a, H);
  const why = firsthand(world, A)?.ep;
  const aLine = (
    await faculties.speak({
      self: identityOf(A),
      listener: { id: b, name: B.name },
      heard: "",
      intent: { option: "Confide a suspicion", description: `Tell ${B.name}, quietly, what you have come to believe about the world, and what made you think so.` },
      content: [{ id: why?.id ?? H.id, text: `${H.proposition}${why ? ` ${why.gist}` : ""}` }],
      style: { warmth: clamp(0.4 + 0.3 * (A.others[b]?.liking ?? 0.5)), curtness: 0.1, hedging: clamp(0.2 + A.traits.neuroticism * 0.5 + 0.4 * conf(silenceOf(A))), verbosity: clamp(0.3 + A.traits.extraversion * 0.4) },
      stance: ["You are telling a friend something you have told almost nobody, and you know how it sounds. Two or three sentences."],
      salience: 0.8,
    })
  ).utterance;
  const claim: Claim = { about: "world", topics: HERESY_TOPICS, proposition: H.proposition, valence: H.valence, rumor: line };
  const own = evidenceOf(world, B).total;
  // What the decent answer feels like depends on how it sounds to them: taking it seriously is a
  // kindness only if it could be true; to a closed, orderly mind, telling them to stop is the kindness.
  const plaus = clamp(plausibility(world, B, B.others[a]?.liking ?? 0.5));
  const options: ActionOption[] = [
    { id: "hear", label: "Hear them out", verb: `hear ${A.name} out`, description: "Listen, and take it seriously.", prosocial: 0.2 + 0.5 * plaus, assertive: 0, avoidant: 0, disclosure: 0.3 },
    ...(own >= 0.08 ? [{ id: "seen", label: "Say you've seen it too", verb: `admit to ${A.name} you've noticed it too`, description: "Tell them about the strange thing you noticed yourself.", prosocial: 0.2 + 0.4 * plaus, assertive: 0.1, avoidant: 0, disclosure: 0.9 }] : []),
    { id: "laugh", label: "Laugh it off", verb: `laugh off what ${A.name} said`, description: "Make light of it and change the subject.", prosocial: 0.45 * (1 - plaus), assertive: 0.2, avoidant: 0.5, disclosure: -0.2 },
    { id: "madness", label: "Call it madness", verb: `tell ${A.name} it's madness`, description: "Tell them plainly it is nonsense and they should stop.", prosocial: -0.5 + 1.4 * mundane(B) * (1 - plaus), assertive: 0.8, avoidant: 0, disclosure: 0 },
  ];
  const ownEp = firsthand(world, B)?.ep;
  const pB: Percept = {
    id: nextId(B, "pc"),
    tick: world.tick,
    kind: "speech",
    rawText: `${A.name}: "${aLine}"`,
    actor: a,
    addressedToSelf: true,
    about: [],
    topics: HERESY_TOPICS,
    features: { outcomeForSelf: 0, agency: "other", intentional: 0.6, normViolation: 0.15 * conf(orthodoxyOf(B)), prospective: false, intensity: 0.55 },
    claims: [claim],
    details: [],
    gist: `${A.name} told me: ${H.proposition.replace(/\.$/, "")}`,
    options,
  };
  const tB = await runPercept(B, pB, faculties);
  const choice = tB.decision?.choice ?? "hear";
  const reply = tB.action?.kind === "speech" ? tB.action.text : (await faculties.speak({ self: identityOf(B), listener: { id: a, name: A.name }, heard: aLine, intent: { option: options.find((o) => o.id === choice)!.label, description: options.find((o) => o.id === choice)!.description }, content: choice === "seen" && ownEp ? [{ id: ownEp.id, text: ownEp.gist }] : [], style: { warmth: 0.5, curtness: choice === "madness" ? 0.7 : 0.2, hedging: 0.3, verbosity: 0.4 }, stance: [], salience: 0.6 })).utterance;
  record(world, sink, b, tB);
  h.told.push(`${line}>${b}`);
  if (h.told.length > 2000) h.told.splice(0, h.told.length - 2000);
  h.zeal[a] = (h.zeal[a] ?? 0) + 1;
  judge(world, h, b, choice);
  if (choice === "madness") scorn(world, h, b, a, tB.encoded);
  // How it went, from the teller's side.
  const outcome = choice === "seen" ? 0.5 : choice === "hear" ? 0.2 : choice === "laugh" ? -0.25 : -0.5;
  const pA: Percept = {
    id: nextId(A, "pc"),
    tick: world.tick,
    kind: "speech",
    rawText: `${B.name}: "${reply}"`,
    actor: b,
    addressedToSelf: false,
    about: [b],
    topics: HERESY_TOPICS,
    features: { outcomeForSelf: outcome, agency: "other", intentional: 0.7, normViolation: choice === "madness" ? 0.2 : 0, prospective: false, intensity: 0.3 + Math.abs(outcome) * 0.6 },
    claims: [],
    details: [],
    gist: choice === "seen" ? `${B.name} said ${B.pronouns.subject}'d noticed it too` : choice === "hear" ? `${B.name} heard me out about the world` : choice === "laugh" ? `${B.name} laughed off what I said about the world` : `${B.name} told me my talk of a made world is madness`,
    options: [
      { id: "press", label: "Press the point", verb: "press the point", description: "Insist it is true.", prosocial: 0, assertive: 0.7, avoidant: 0, disclosure: 0.4, act: "presses the point" },
      { id: "drop", label: "Let it drop", verb: "let it drop", description: "Say no more about it.", prosocial: 0.3, assertive: 0, avoidant: 0.6, disclosure: -0.2, act: "lets it drop" },
    ],
  };
  const tA = await runPercept(A, pA, faculties);
  record(world, sink, a, tA);
  if (choice === "seen") {
    // Being believed by someone who saw it too is the strongest confirmation there is.
    H.confidence = clamp(H.confidence + 0.08 * (1 - H.confidence), 0, 0.95);
  } else if (choice === "madness" || choice === "laugh") {
    // Ridicule: the agreeable and the anxious learn to keep it to themselves.
    shush(world, A, tA.encoded, (choice === "madness" ? 0.25 : 0.12) * (A.traits.agreeableness + A.traits.neuroticism) / 2, tA.id);
  }
  const ag = world.agents[a]!;
  const bg = world.agents[b]!;
  ag.lastTalk[b] = bg.lastTalk[a] = world.tick;
  ag.talkingUntil = bg.talkingUntil = world.tick + 40;
  hop(world, line, a, b, H.proposition, false, tB.id);
  settleHop(world, line, b);
  const verb = choice === "seen" ? "who has noticed it too" : choice === "hear" ? "who hears them out" : choice === "laugh" ? "who laughs it off" : "who calls it madness";
  const title = `${A.name} confides in ${B.name} that the world is made, and ${B.name} ${choice === "seen" ? "has noticed it too" : choice === "hear" ? "hears them out" : choice === "laugh" ? "laughs it off" : "calls it madness"}`;
  void verb;
  h.events.push({ tick: world.tick, kind: choice === "madness" ? "reject" : "confide", agents: [a, b], text: `${title}.`, trace: tB.id });
  trimEvents(h);
  feed(world, sink, {
    kind: "talk",
    place: ag.place,
    agents: [a, b],
    title,
    lines: [
      { speaker: a, text: aLine },
      { speaker: b, text: reply, trace: tB.id },
    ],
    refs: [
      { agent: b, trace: tB.id },
      { agent: a, trace: tA.id },
    ],
    rumor: line,
  });
}

/**
 * Weigh a told belief against the hearer's own experience and temperament (and the choice they
 * made, when they were told to their face). A second telling of the same idea, by another line,
 * strengthens the first belief rather than adding another.
 */
function judge(world: WorldState, h: HeresyState, id: AgentId, choice?: string): void {
  const m = world.minds[id]!;
  const told = m.beliefs.filter((b) => b.topics.includes(MADE) && b.about === "world" && b.source.kind === "told" && !h.judged.includes(`${id}:${b.id}`));
  for (const b of told) {
    h.judged.push(`${id}:${b.id}`);
    const older = m.beliefs.find((x) => x !== b && x.about === "world" && x.topics.includes(MADE));
    const teller = b.source.from ? m.others[b.source.from] : undefined;
    const plausible = plausibility(world, m, teller?.liking ?? 0.5);
    const factor = choice === "seen" ? 1.4 : choice === "laugh" ? 0.5 : choice === "madness" ? 0.2 : 1;
    if (older) {
      // Heard again, from someone else: it feels truer (illusory truth), if it is at all plausible.
      older.confidence = clamp(older.confidence + PARAMS.social.illusoryTruth * Math.min(1, plausible) * factor * (1 - older.confidence), 0, 0.95);
      older.proposition = heresyText(older.confidence);
      use(older.retrievals, world.tick);
      for (const e of b.evidence) if (!older.evidence.includes(e)) older.evidence.push(e);
      m.beliefs = m.beliefs.filter((x) => x !== b);
      continue;
    }
    b.confidence = clamp(b.confidence * plausible * factor, 0, 0.95);
    b.proposition = heresyText(b.confidence);
  }
  if (h.judged.length > 3000) h.judged.splice(0, h.judged.length - 3000);
}

/** How believable the idea sounds to someone: their temperament, what they have seen, the orthodox view, and who is telling them. */
function plausibility(world: WorldState, m: MindState, liking: number): number {
  const own = evidenceOf(world, m).total;
  return susceptibility(m) * (0.45 + Math.min(1, own * 1.5)) * (1 - 0.6 * conf(orthodoxyOf(m))) * (0.6 + 0.8 * liking);
}

/** The strongest uncanny thing someone lived through themselves (not a story they heard). */
function firsthand(world: WorldState, m: MindState) {
  return evidenceOf(world, m).episodes.find((x) => x.kind !== "told");
}

/** A hop records how far the hearer believes the idea once they have weighed it, whichever line they hold it by. */
function settleHop(world: WorldState, line: string, to: AgentId): void {
  const hop_ = world.rumors[line]?.hops.at(-1);
  if (hop_ && hop_.to === to) hop_.confidence = conf(heresyOf(world.minds[to]!));
}

/** Someone who thinks it madness now thinks less of the person who said it, and that is gossip. */
function scorn(world: WorldState, h: HeresyState, judge_: AgentId, believer: AgentId, episode?: string): void {
  const m = world.minds[judge_]!;
  const o = m.others[believer];
  if (o) {
    o.liking = clamp(o.liking - 0.06);
    o.trust.ability = clamp(o.trust.ability - 0.05);
  }
  if (scornOf(m, believer).length) return;
  const B = world.minds[believer]!;
  m.beliefs.push({
    id: nextId(m, "bel"),
    about: believer,
    topics: ["world", MADE, "madness"],
    proposition: `${B.name} has been saying the world is made. ${cap(B.pronouns.subject)} isn't right in the head.`,
    confidence: clamp(0.45 + 0.4 * mundane(m)),
    valence: -0.45,
    source: { kind: "inferred" },
    formed: world.tick,
    evidence: episode ? [episode] : [],
    retrievals: [world.tick],
  });
  void h;
}

/** Learning to keep quiet: a belief that speaking of it brings trouble, resting on the moment that taught it. */
function shush(world: WorldState, m: MindState, episode: string | undefined, amount: number, _trace: string): void {
  if (amount <= 0.01) return;
  let S = silenceOf(m);
  if (!S) {
    S = { id: nextId(m, "bel"), about: "village", topics: ["world", SILENCE, MADE], proposition: SILENCE_TEXT, confidence: 0, valence: -0.3, source: { kind: "inferred" }, formed: world.tick, evidence: [], retrievals: [world.tick] };
    m.beliefs.push(S);
  }
  S.confidence = clamp(S.confidence + amount * (1 - S.confidence));
  if (episode && !S.evidence.includes(episode)) S.evidence.push(episode);
  if (S.evidence.length > 6) S.evidence.splice(0, S.evidence.length - 6);
  use(S.retrievals, world.tick);
}

// ---------------------------------------------------------------- the fire: sermons and the leader

/** Who speaks for the town: the leader, or before there is one, whoever asks for the common store. */
export function leaderOf(world: WorldState): AgentId | undefined {
  const v = world.village;
  if (!v) return undefined;
  const id = v.civic?.leader ?? v.pledges.at(-1)?.proposer;
  return id && world.order.includes(id) ? id : undefined;
}

async function evening(world: WorldState, h: HeresyState, faculties: Faculties, sink: Sink): Promise<void> {
  const day = dayOf(world.tick);
  // Everyone at the fire hears what is said to the whole fire, even mid-conversation.
  const present = world.order.filter((x) => world.agents[x]!.place === "tavern" && adult(world, x));
  if (present.length < 3) return;
  const free = (x: AgentId) => (world.agents[x]!.talkingUntil ?? 0) <= world.tick;
  const leader = leaderOf(world);
  // A believer who has not been made to keep quiet, with enough fire in them, speaks to everyone.
  if (h.last.sermon !== day) {
    const preacher = present
      .filter(free)
      .map((id) => ({ id, m: world.minds[id]! }))
      .filter(({ m }) => conf(heresyOf(m)) >= 0.7 && conf(silenceOf(m)) < 0.3)
      .map((x) => ({ ...x, drive: x.m.traits.extraversion * 0.6 + (1 - x.m.traits.agreeableness) * 0.3 + 0.1 * Math.min(h.zeal[x.id] ?? 0, 5) }))
      .sort((a, b) => b.drive - a.drive)[0];
    if (preacher && rand(h) < 0.25 + 0.4 * preacher.drive) {
      h.last.sermon = day;
      await sermon(world, h, preacher.id, present, faculties, sink);
    }
  }
  if (!leader || h.last.denounce === day || !present.includes(leader) || !free(leader)) return;
  const L = world.minds[leader]!;
  if (conf(heresyOf(L)) >= 0.35) return;
  // The leader knows: they were told, they heard it at the fire, or they hold someone mad for it.
  const named = world.order.filter((id) => id !== leader && (scornOf(L, id).length > 0 || h.told.some((t) => t.startsWith(`heresy_${id}_`) && t.endsWith(`>${leader}`)) || h.events.some((e) => e.kind === "sermon" && e.agents[0] === id && e.agents.includes(leader) && world.tick - e.tick < 4 * 1440)));
  const aware = named.length > 0 || L.beliefs.some((b) => b.topics.includes(MADE));
  if (!aware) return;
  const order = (L.traits.conscientiousness + (1 - L.traits.openness)) / 2;
  if (L.traits.openness > 0.6 && L.traits.agreeableness > 0.5) {
    if (h.last.tolerated !== leader) {
      h.last.tolerated = leader;
      event(world, h, sink, "tolerate", [leader], `${L.name} lets the talk of a made world be`, `${cap(L.pronouns.subject)} is too curious, and too kind, to stop anyone saying it.`, true);
    }
    return;
  }
  const lastDenounce = h.events.filter((e) => e.kind === "denounce").at(-1);
  if (lastDenounce && world.tick - lastDenounce.tick < 3 * 1440) return;
  if (rand(h) > 0.3 + 0.6 * order) return;
  h.last.denounce = day;
  await denounce(world, h, leader, named.filter((id) => conf(heresyOf(world.minds[id]!)) >= 0.35 || scornOf(L, id).length > 0), present, faculties, sink);
}

/** A believer speaks of it to the whole fire. */
async function sermon(world: WorldState, h: HeresyState, who: AgentId, present: AgentId[], faculties: Faculties, sink: Sink): Promise<void> {
  const T = world.minds[who]!;
  const H = heresyOf(T)!;
  const line = lineOf(world, who, H);
  const why = firsthand(world, T)?.ep;
  const text = (
    await faculties.speak({
      self: identityOf(T),
      listener: { id: "everyone", name: "everyone at the fire" },
      heard: "",
      intent: { option: "Preach at the fire", description: "Tell everyone at the fire what you believe about the world, and what you have seen that proves it." },
      content: [{ id: why?.id ?? H.id, text: `${H.proposition}${why ? ` ${why.gist}` : ""}` }],
      style: { warmth: 0.4, curtness: 0.2, hedging: 0.1, verbosity: clamp(0.5 + T.traits.extraversion * 0.4) },
      stance: ["It is evening at the fire circle and everyone is there. You are going to say it out loud, whatever they think. Three or four sentences."],
      salience: 0.8,
    })
  ).utterance;
  h.zeal[who] = (h.zeal[who] ?? 0) + 2;
  const refs: { agent: AgentId; trace: string }[] = [];
  const claim: Claim = { about: "world", topics: HERESY_TOPICS, proposition: H.proposition, valence: H.valence, rumor: line };
  for (const id of present) {
    if (id === who) continue;
    const m = world.minds[id]!;
    if (conf(heresyOf(m)) >= 0.5) continue;
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: world.tick,
      kind: "speech",
      rawText: `${T.name}, at the fire: "${text}"`,
      actor: who,
      addressedToSelf: false,
      about: [who],
      topics: [...HERESY_TOPICS, "fire"],
      features: { outcomeForSelf: 0, agency: "other", intentional: 0.5, normViolation: 0.2 * conf(orthodoxyOf(m)), prospective: false, intensity: 0.5 },
      claims: [claim],
      details: [],
      gist: `${T.name} told the whole fire the world is made`,
    };
    const tr = await runPercept(m, p, faculties);
    record(world, sink, id, tr);
    refs.push({ agent: id, trace: tr.id });
    h.told.push(`${line}>${id}`);
    hop(world, line, who, id, H.proposition, false, tr.id);
    judge(world, h, id);
    settleHop(world, line, id);
    // The closed and orderly think the less of whoever says it out loud.
    if (conf(heresyOf(m)) < 0.15 && mundane(m) > 0.3) scorn(world, h, id, who, tr.encoded);
  }
  h.events.push({ tick: world.tick, kind: "sermon", agents: [who, ...present.filter((x) => x !== who)], text: `${T.name} told the whole fire that the world is made.`, trace: refs[0]?.trace });
  trimEvents(h);
  feed(world, sink, { kind: "talk", place: "tavern", agents: present, title: `${T.name} tells the whole fire the world is made`, lines: [{ speaker: who, text }], refs: refs.slice(0, 12), rumor: line, chronicle: { kind: "heresy", why: [{ text: whyLine(world, who), agent: who }] } });
}

/** The leader speaks against it. Believers go quiet, or hold on harder. */
async function denounce(world: WorldState, h: HeresyState, leader: AgentId, named: AgentId[], present: AgentId[], faculties: Faculties, sink: Sink): Promise<void> {
  const L = world.minds[leader]!;
  const harsh = L.traits.agreeableness < 0.5;
  const names = named.map((id) => nm(world, id));
  const text = (
    await faculties.speak({
      self: identityOf(L),
      listener: { id: "everyone", name: "everyone at the fire" },
      heard: "",
      intent: { option: "Denounce the heresy", description: `As the one who speaks for ${world.name}, tell everyone the talk of the world being made is madness and must stop.${harsh && names.length ? ` Name ${list(names)}.` : ""}` },
      content: [{ id: "orthodoxy", text: `${ORTHODOX_TEXT}${harsh && names.length ? ` ${list(names)}, that means you.` : ""}` }],
      style: { warmth: harsh ? 0.1 : 0.4, curtness: harsh ? 0.7 : 0.3, hedging: 0.05, verbosity: 0.5 },
      stance: ["You are standing at the fire, speaking for the whole town. Two or three sentences, firm."],
      salience: 0.8,
    })
  ).utterance;
  const line = `orthodoxy_${world.village?.town ?? "town"}_${leader}`;
  if (!world.rumors[line]) world.rumors[line] = { id: line, subject: "world", origin: leader, first: ORTHODOX_TEXT, hops: [] };
  const claim: Claim = { about: "world", topics: ["world", ORTHODOX], proposition: ORTHODOX_TEXT, valence: 0.2, rumor: line };
  const refs: { agent: AgentId; trace: string }[] = [];
  const reactant: AgentId[] = [];
  const quieted: AgentId[] = [];
  for (const id of present) {
    if (id === leader) continue;
    const m = world.minds[id]!;
    const H = heresyOf(m);
    const isNamed = harsh && named.includes(id);
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: world.tick,
      kind: "speech",
      rawText: `${L.name}, at the fire: "${text}"`,
      actor: leader,
      addressedToSelf: false,
      about: isNamed ? [id] : [],
      topics: ["world", ORTHODOX, MADE, "fire"],
      features: { outcomeForSelf: isNamed ? -0.45 : H ? -0.15 : 0, agency: "other", intentional: 0.8, normViolation: 0, prospective: false, intensity: isNamed ? 0.7 : 0.45 },
      claims: [claim],
      details: [],
      gist: isNamed ? `${L.name} named me before the whole fire for my talk of a made world` : `${L.name} told the fire that talk of a made world is madness`,
      options: isNamed
        ? [
            { id: "defy", label: "Stand by it", verb: `stand up to ${L.name}`, description: "Say you know what you saw.", prosocial: -0.3, assertive: 0.9, avoidant: 0, disclosure: 0.6, act: "stands by it in front of everyone" },
            { id: "yield", label: "Say nothing", verb: "keep quiet", description: "Look at the ground and say nothing.", prosocial: 0.2, assertive: -0.3, avoidant: 0.8, disclosure: -0.4, act: "says nothing and looks at the fire" },
          ]
        : undefined,
    };
    const tr = await runPercept(m, p, faculties);
    record(world, sink, id, tr);
    refs.push({ agent: id, trace: tr.id });
    hop(world, line, leader, id, ORTHODOX_TEXT, false, tr.id);
    const O = orthodoxyOf(m);
    if (O && H) O.confidence = clamp(O.confidence * (1 - H.confidence));
    if (!H) continue;
    // Reactance: the open and disagreeable hold on harder for being told not to (Brehm 1966).
    const r = m.traits.openness * (1 - m.traits.agreeableness) * (1 - 0.4 * m.traits.neuroticism) + (tr.decision?.choice === "defy" ? 0.25 : 0);
    if (r > 0.3) {
      H.confidence = clamp(H.confidence + 0.12 * r, 0, 0.95);
      H.proposition = heresyText(H.confidence);
      const o = m.others[leader];
      if (o) {
        o.liking = clamp(o.liking - 0.08 * r);
        o.trust.benevolence = clamp(o.trust.benevolence - 0.05 * r);
      }
      reactant.push(id);
    } else {
      // The spiral of silence: most learn to keep it to themselves (Noelle-Neumann 1974).
      shush(world, m, tr.encoded, (isNamed ? 0.6 : 0.35) * (0.5 + 0.5 * (m.traits.agreeableness + m.traits.neuroticism) / 2) * (tr.decision?.choice === "yield" ? 1.3 : 1), tr.id);
      if (H.confidence < 0.5) {
        H.confidence = clamp(H.confidence * (1 - 0.3 * conf(orthodoxyOf(m)) - 0.1));
        H.proposition = heresyText(H.confidence);
      }
      if (H.confidence >= 0.2) quieted.push(id);
    }
  }
  const named_ = named.filter((id) => present.includes(id));
  h.events.push({ tick: world.tick, kind: "denounce", agents: [leader, ...named_], text: `${L.name} denounced the talk of a made world at the fire${harsh && named_.length ? `, naming ${list(named_.map((x) => nm(world, x)))}` : ""}.`, trace: refs[0]?.trace });
  if (reactant.length) h.events.push({ tick: world.tick, kind: "reactance", agents: reactant, text: `${list(reactant.map((x) => nm(world, x)))} only believe it more for being told not to.` });
  if (quieted.length) h.events.push({ tick: world.tick, kind: "silenced", agents: quieted, text: `${list(quieted.map((x) => nm(world, x)))} will keep it to themselves now.` });
  trimEvents(h);
  feed(world, sink, {
    kind: "talk",
    place: "tavern",
    agents: present,
    title: `${L.name} denounces the talk of a made world`,
    lines: [{ speaker: leader, text }],
    text: [reactant.length ? `${list(reactant.map((x) => nm(world, x)))} only believe it more for being told not to.` : "", quieted.length ? `${list(quieted.map((x) => nm(world, x)))} will keep it to themselves now.` : ""].filter(Boolean).join(" ") || undefined,
    refs: refs.slice(0, 12),
    rumor: line,
    chronicle: { kind: "heresy", why: [{ text: `${L.name} leads ${world.name} and thinks it madness`, agent: leader }, ...named_.slice(0, 3).map((id) => ({ text: whyLine(world, id), agent: id }))] },
  });
}

// ---------------------------------------------------------------- the player answering

/**
 * Answer someone from the sky. A stand-in for the god voice (packages/engine/src/world/voice.ts on
 * its own branch): the percept looks the same to the mind and to `scan` (an actor with no body).
 */
export async function voiceFromSky(world: WorldState, to: AgentId, text: string, faculties: Faculties, sink: Sink): Promise<Trace> {
  const m = world.minds[to]!;
  const p: Percept = {
    id: nextId(m, "pc"),
    tick: world.tick,
    kind: "speech",
    rawText: `A voice from the sky: "${text}"`,
    actor: "sky",
    addressedToSelf: true,
    about: [],
    topics: ["voice", "sky", "world"],
    features: { outcomeForSelf: -0.1, agency: "other", intentional: 1, normViolation: 0, prospective: false, intensity: 0.85 },
    claims: [],
    details: [],
    gist: `A voice came out of the empty sky and said: "${text}"`,
  };
  const t = await runPercept(m, p, faculties);
  record(world, sink, to, t);
  feed(world, sink, { kind: "talk", place: world.agents[to]?.place, agents: [to], title: `A voice from the sky speaks to ${m.name}`, lines: [{ speaker: "sky", text }, ...(t.action?.kind === "speech" ? [{ speaker: to, text: t.action.text, trace: t.id }] : [])], refs: [{ agent: to, trace: t.id }] });
  return t;
}

// ---------------------------------------------------------------- views

export interface HeresyPerson {
  id: AgentId;
  name: string;
  faction: Faction;
  heresy: number;
  orthodoxy: number;
  silence: number;
  /** Doubt from their own experience alone. */
  doubt: number;
  susceptibility: number;
  /** What they believe, in their words. */
  belief?: string;
  core: boolean;
  /** How they came by it. */
  chain: ChainStep[];
}

export interface ChainStep {
  agent: AgentId;
  name: string;
  kind: "told" | "firsthand" | "anomaly";
  tick: Tick;
  text: string;
  anomaly?: AnomalyKind;
  trace?: string;
}

export interface HeresyView {
  people: HeresyPerson[];
  factions: Record<Faction, number>;
  anomalies: (Anomaly & { name: string })[];
  events: (HeresyEvent & { names: string[] })[];
  lines: { id: string; origin: AgentId; originName: string; first: string; believers: number; hops: { tick: Tick; from: AgentId; to: AgentId; fromName: string; toName: string; text: string; confidence: number; overheard?: boolean }[] }[];
  census: HeresyState["census"];
  leader?: { id: AgentId; name: string; stance: "believer" | "tolerant" | "suppresses" | "unaware" };
  calls: { who: AgentId; name: string; tick: Tick; answered: boolean; open: boolean }[];
}

/** The chain behind someone's belief: who told whom, back to the first believer and what they saw. */
export function heresyChain(world: WorldState, id: AgentId, depth = 12): ChainStep[] {
  const out: ChainStep[] = [];
  const h = world.heresy;
  let cur: AgentId | undefined = id;
  const seen = new Set<AgentId>();
  while (cur && !seen.has(cur) && out.length < depth) {
    seen.add(cur);
    const m: MindState | undefined = world.minds[cur];
    const H: Belief | undefined = m ? heresyOf(m) : undefined;
    if (!m || !H) break;
    if (H.source.kind === "told" && H.source.from) {
      const hop_ = H.rumor ? world.rumors[H.rumor]?.hops.find((x) => x.to === cur && x.from === H.source.from) : undefined;
      out.push({ agent: cur, name: m.name, kind: "told", tick: hop_?.tick ?? H.formed, text: `${m.name} heard it from ${nm(world, H.source.from)}: "${hop_?.text ?? H.proposition}"`, trace: hop_?.trace });
      cur = H.source.from;
      continue;
    }
    out.push({ agent: cur, name: m.name, kind: "firsthand", tick: H.formed, text: `${m.name} came to it from what ${m.pronouns.subject} lived through` });
    for (const x of evidenceOf(world, m).episodes.slice(0, 3)) {
      const a = h?.anomalies.find((y) => y.id === x.ep.id && y.agent === cur);
      out.push({ agent: cur, name: m.name, kind: "anomaly", tick: x.ep.tick, text: x.ep.gist, anomaly: a?.kind, trace: a?.trace });
    }
    break;
  }
  return out;
}

export function heresyView(world: WorldState): HeresyView | undefined {
  const h = world.heresy;
  if (!h) return undefined;
  const people: HeresyPerson[] = world.order
    .filter((id) => adult(world, id))
    .map((id) => {
      const m = world.minds[id]!;
      const H = heresyOf(m);
      return {
        id,
        name: m.name,
        faction: factionOf(world, id),
        heresy: Number(conf(H).toFixed(2)),
        orthodoxy: Number(conf(orthodoxyOf(m)).toFixed(2)),
        silence: Number(conf(silenceOf(m)).toFixed(2)),
        doubt: Number(doubtOf(world, m).toFixed(2)),
        susceptibility: Number(susceptibility(m).toFixed(2)),
        belief: H?.proposition,
        core: m.schemas.some((s) => s.text === CORE_TEXT),
        chain: H ? heresyChain(world, id) : [],
      };
    })
    .sort((a, b) => b.heresy - a.heresy || b.doubt - a.doubt);
  const factions = { believer: 0, hidden: 0, doubter: 0, skeptic: 0, authority: 0, unaware: 0 } as Record<Faction, number>;
  for (const p of people) factions[p.faction]++;
  const lines = Object.values(world.rumors)
    .filter((r) => r.id.startsWith("heresy_") && r.hops.length)
    .map((r) => ({
      id: r.id,
      origin: r.origin,
      originName: nm(world, r.origin),
      first: r.first,
      believers: world.order.filter((id) => (world.minds[id]!.beliefs.find((b) => b.rumor === r.id)?.confidence ?? 0) >= 0.5).length,
      hops: r.hops.map((x) => ({ tick: x.tick, from: x.from, to: x.to, fromName: nm(world, x.from), toName: nm(world, x.to), text: x.text, confidence: Number(x.confidence.toFixed(2)), overheard: x.overheard })),
    }))
    .sort((a, b) => b.hops.length - a.hops.length);
  const leader = leaderOf(world);
  let stance: NonNullable<HeresyView["leader"]>["stance"] = "unaware";
  if (leader) {
    if (conf(heresyOf(world.minds[leader]!)) >= 0.5) stance = "believer";
    else if (h.events.some((e) => e.kind === "denounce" && e.agents[0] === leader)) stance = "suppresses";
    else if (h.last.tolerated === leader) stance = "tolerant";
  }
  return {
    people,
    factions,
    anomalies: h.anomalies.slice(-80).map((a) => ({ ...a, name: nm(world, a.agent) })).reverse(),
    events: h.events.filter((e) => e.kind !== "anomaly").slice(-80).map((e) => ({ ...e, names: e.agents.map((x) => nm(world, x)) })).reverse(),
    lines,
    census: h.census.slice(-120),
    leader: leader ? { id: leader, name: nm(world, leader), stance } : undefined,
    calls: h.calls.slice(-12).map((c) => ({ who: c.who, name: nm(world, c.who), tick: c.tick, answered: !!c.answered, open: !c.answered && world.tick - c.tick <= 1440 })).reverse(),
  };
}

/** What the player should hear about: someone asking the watcher for a sign, a denunciation, a new believer. */
export function heresyNotices(world: WorldState, since: Tick): { id: string; tick: Tick; kind: HeresyEventKind; agent: AgentId; text: string }[] {
  const h = world.heresy;
  if (!h) return [];
  return h.events
    .filter((e) => e.tick >= since && ["call", "belief", "core", "sermon", "denounce", "leader", "answered"].includes(e.kind))
    .map((e, i) => ({ id: `heresy:${e.kind}:${e.agents[0]}:${e.tick}:${i}`, tick: e.tick, kind: e.kind, agent: e.agents[0]!, text: e.text }));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
