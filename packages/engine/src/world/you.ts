// You, in the world. Not a voice from the sky and not a mind the engine runs: a body that walks up
// from the landing with a pack, and is whoever the villagers decide you are.
//
// Everything you do reaches people the way anything else does: as a percept that goes through the
// whole cognitive cycle of the person you did it to (appraisal, trust, memory, decision), and as a
// smaller percept for everyone standing close enough to see. Nothing about how they take you is
// scripted. A gift lands differently on someone who trusts nobody; a lie about a neighbour is
// believed more readily by those who already disliked them (Kunda 1990); a theft nobody saw is
// pinned on whoever the keeper trusted least, which may not be you. What you did becomes memories,
// the memories become stories told when you are not there, and enough bad ones bring the village
// to the fire to decide whether you stay.
//
// You are the outside actor "visitor" that the minds have always had a slot for, so the reputation
// you earn on foot is the same one a stranger's words are weighed by (voice.ts). The game shows the
// other side of every act: what each person felt, what they chose and the terms that tipped it, how
// far their liking and trust moved, and what they will remember.

import { clamp } from "../memory.js";
import { dayOf, hourOf, identityOf, perceiveText, runPercept } from "../mind.js";
import type { ActionOption, Claim, EventFeatures, Faculties, Percept } from "../ports.js";
import { nextId, nextRandom } from "../rng.js";
import type { Contribution, Trace } from "../trace.js";
import type { AgentId, MindState, OtherModel, Tick } from "../types.js";
import { isChild, sanction } from "./life.js";
import { moneyOf } from "./money.js";
import { other } from "./people.js";
import type { PlaceId } from "./places.js";
import { householdOf, JOBS, type Household } from "./village.js";
import { eventPercept, feed, hop, isNight, record, setOverride, type FeedLine, type Sink, type Why, type WorldState } from "./world.js";

/** The id the minds know you by. It predates this file: every mind is born with a slot for it. */
export const ME = "visitor";

// ------------------------------------------------------------------ state

/** How one person took something you did. */
export interface Reaction {
  agent: AgentId;
  name: string;
  /** You did it to them, or they were close enough to see. */
  role: "to" | "saw";
  trace: string;
  said?: string;
  /** What they chose to do about it, when there was a choice. */
  choice?: string;
  /** Their gut or their deliberation (System 1 or 2). */
  system?: 1 | 2;
  felt: { name: string; value: number }[];
  /** Before and after. */
  liking: [number, number];
  trust: [number, number];
  /** What tipped the choice, strongest first. */
  why: { name: string; value: number; ref?: string }[];
  /** The memory they keep of it. */
  kept?: string;
}

export interface Deed {
  id: string;
  tick: Tick;
  kind: string;
  place: PlaceId;
  title: string;
  /** What you said, when you said something. */
  said?: string;
  to?: AgentId;
  /** What came of it, in a line. */
  result?: string;
  tone: "good" | "bad" | "plain";
  reactions: Reaction[];
}

export type AskKind = "who" | "hungry" | "confront" | "debt" | "thanks" | "confide" | "invite" | "warn";

/** Someone has come up to you and is waiting on an answer. */
export interface Ask {
  id: string;
  tick: Tick;
  from: AgentId;
  kind: AskKind;
  line: string;
  options: { id: string; label: string; hint?: string }[];
  expires: Tick;
  /** What it is about: a memory of theirs, a debt, an amount. */
  about?: string;
  amount?: number;
}

export interface YouDebt {
  id: string;
  creditor: AgentId;
  amount: number;
  tick: Tick;
  due: Tick;
  repaid?: Tick;
  refused?: Tick;
}

export interface Theft {
  id: string;
  tick: Tick;
  /** "store", or the household it was taken from. */
  from: string;
  amount: number;
  seen: AgentId[];
  /** When someone found the food gone, and who they decided had taken it. */
  noticed?: Tick;
  by?: AgentId;
  blamed?: string;
}

export interface Verdict {
  tick: Tick;
  proposer: AgentId;
  grievance: string;
  send: AgentId[];
  stay: AgentId[];
  traces: { agent: AgentId; trace: string }[];
  banished: boolean;
}

export interface YouState {
  name: string;
  arrived: Tick;
  /** A place in the world, or "away" when you are off on your own. */
  place: PlaceId;
  /** In the world and awake to it. When false you are resting at your camp and nobody comes to you. */
  here: boolean;
  food: number;
  amber: number;
  /** Who knows your name. Everyone else calls you the stranger. */
  known: AgentId[];
  met: Record<AgentId, { first: Tick; last: Tick; n: number }>;
  deeds: Deed[];
  ask?: Ask;
  debts: YouDebt[];
  thefts: Theft[];
  /** Stories you started, and whether their subject has found out who did. */
  rumors: { id: string; about: AgentId; tick: Tick; leaked?: Tick }[];
  /** Grievances already had out with you, and kindnesses already thanked, as `person:memory`. */
  settled: string[];
  standing: "stranger" | "welcome" | "banished";
  banishedUntil?: Tick;
  verdicts: Verdict[];
  last: Record<string, Tick>;
  rng: number;
}

export type YouAct =
  | { act: "arrive"; name: string }
  | { act: "move"; place: PlaceId }
  | { act: "rest" }
  | { act: "leave" }
  | { act: "greet"; to: AgentId }
  | { act: "say"; to: AgentId; text: string }
  /** `about` is "me" or someone's id. */
  | { act: "ask"; to: AgentId; about: string }
  | { act: "compliment"; to: AgentId }
  | { act: "comfort"; to: AgentId }
  | { act: "insult"; to: AgentId }
  | { act: "apologize"; to: AgentId }
  | { act: "give"; to: AgentId; what: "food" | "amber"; amount: number }
  /** Amber for their food. */
  | { act: "buy"; to: AgentId }
  /** Your food for their amber. */
  | { act: "sell"; to: AgentId }
  | { act: "beg"; to: AgentId }
  | { act: "help"; to: AgentId }
  | { act: "rumor"; to: AgentId; about: AgentId; text: string; valence: number }
  | { act: "gather" }
  /** Put food into the common store. */
  | { act: "store"; amount: number }
  /** Take from the common store, or from the household of the person named. */
  | { act: "steal"; from: string }
  | { act: "repay"; debt: string }
  | { act: "answer"; ask: string; choice: string };

const START_FOOD = 6;
const START_AMBER = 3;
/** Food one piece of amber buys from you or for you (money.ts prices it the same). */
const AMBER_FOOD = 3;
const KEEP_DEEDS = 30;
const ASK_WAIT = 45;
const BANISHED_DAYS = 3;

// ------------------------------------------------------------------ helpers

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const r2 = (x: number) => Number(x.toFixed(2));
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const foodText = (n: number) => `${n % 1 ? n.toFixed(1) : n} food`;
const first = (name: string) => name.split(" ")[0]!;
/** "The stranger", mid-sentence. */
const low = (n: string) => (n === "The stranger" ? "the stranger" : n);
const poss = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

function rand(y: YouState): number {
  return nextRandom(y);
}

/** How this person holds you in mind. Every mind has the slot; a child born last night gets one here. */
function regard(world: WorldState, id: AgentId): OtherModel {
  const m = world.minds[id]!;
  const o = (m.others[ME] ??= other(ME, "the stranger", 0.5, 0.5, 0));
  const y = world.you;
  if (y) o.name = y.known.includes(id) ? y.name : "the stranger";
  return o;
}

/** What this person calls you. */
const calls = (world: WorldState, id: AgentId) => (world.you!.known.includes(id) ? world.you!.name : "the stranger");

function learnName(world: WorldState, id: AgentId): void {
  const y = world.you!;
  if (!y.known.includes(id)) y.known.push(id);
  regard(world, id);
}

const awake = (world: WorldState, id: AgentId) => !isNight(world.tick) && world.agents[id]!.activity !== "asleep";
const adults = (world: WorldState) => world.order.filter((x) => !world.village || !isChild(world, x));
const placeName = (world: WorldState, p: PlaceId) => world.places[p]?.name ?? "the edge of the village";

/** The memory of you that weighs most with this person, good or bad. */
function strongest(m: MindState, sign: -1 | 1 | 0 = 0) {
  return m.episodes
    .filter((e) => e.about.includes(ME) && (sign === 0 || Math.sign(e.valence) === sign))
    .sort((a, b) => Math.abs(b.valence) - Math.abs(a.valence))[0];
}

function meet(world: WorldState, id: AgentId): number {
  const y = world.you!;
  const m = (y.met[id] ??= { first: world.tick, last: world.tick, n: 0 });
  m.last = world.tick;
  return m.n++;
}

/**
 * Run a percept through someone's mind and read off how they took it. With a stranger there is
 * little to go on, so each of the first few things you do counts for more than it will later.
 */
async function through(world: WorldState, faculties: Faculties, sink: Sink, id: AgentId, p: Percept, role: Reaction["role"]): Promise<{ r: Reaction; tr: Trace }> {
  const m = world.minds[id]!;
  const o = regard(world, id);
  const before = { liking: o.liking, ben: o.trust.benevolence, integ: o.trust.integrity };
  const n = role === "to" ? meet(world, id) : (world.you!.met[id]?.n ?? 0);
  const tr = await runPercept(m, p, faculties);
  const k = (role === "to" ? 2 : 0.5) * Math.exp(-n / 4);
  if (k > 0.05) {
    const extra = { liking: (o.liking - before.liking) * k, ben: (o.trust.benevolence - before.ben) * k, integ: (o.trust.integrity - before.integ) * k };
    o.liking = clamp(o.liking + extra.liking);
    o.trust.benevolence = clamp(o.trust.benevolence + extra.ben);
    o.trust.integrity = clamp(o.trust.integrity + extra.integ);
    const moved = extra.liking + extra.ben + extra.integ;
    if (Math.abs(moved) > 0.004) (tr.changes ??= []).push({ name: `first impressions of ${o.name} count for more`, value: moved, ref: `other:${ME}` });
  }
  record(world, sink, id, tr);
  return { r: reactionOf(world, id, tr, before, role), tr };
}

function reactionOf(world: WorldState, id: AgentId, tr: Trace, before: { liking: number; ben: number; integ: number }, role: Reaction["role"]): Reaction {
  const o = regard(world, id);
  const chosen = tr.decision?.options.find((x) => x.id === tr.decision!.choice);
  return {
    agent: id,
    name: world.agents[id]!.name,
    role,
    trace: tr.id,
    said: tr.action?.kind === "speech" ? tr.action.text : undefined,
    choice: chosen?.label,
    system: tr.decision?.system,
    felt: Object.entries(tr.appraisal?.emotions ?? {})
      .filter(([, v]) => (v ?? 0) > 0.05)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 3)
      .map(([name, v]) => ({ name, value: r2(v ?? 0) })),
    liking: [r2(before.liking), r2(o.liking)],
    trust: [r2((before.ben + before.integ) / 2), r2((o.trust.benevolence + o.trust.integrity) / 2)],
    why: (chosen?.terms ?? [])
      .filter((t) => t.name !== "noise" && Math.abs(t.value) > 0.02)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 4)
      .map((t) => ({ name: t.name, value: r2(t.value), ref: t.ref })),
    kept: tr.percept?.gist,
  };
}

/** Move how someone holds you directly, and leave the reason on the trace so the ledger can show it. */
function shift(world: WorldState, id: AgentId, tr: Trace | undefined, why: string, d: { liking?: number; ben?: number; integ?: number }): void {
  const o = regard(world, id);
  o.liking = clamp(o.liking + (d.liking ?? 0));
  o.trust.benevolence = clamp(o.trust.benevolence + (d.ben ?? 0));
  o.trust.integrity = clamp(o.trust.integrity + (d.integ ?? 0));
  const c: Contribution = { name: why, value: (d.liking ?? 0) + (d.ben ?? 0) + (d.integ ?? 0), ref: `other:${ME}` };
  if (tr) (tr.changes ??= []).push(c);
}

interface Spoken {
  text: string;
  /** Their memory of it; `n` is what they call you. */
  gist: (n: string) => string;
  f?: Partial<EventFeatures>;
  topics: string[];
  about?: string[];
  options?: ActionOption[];
  request?: Percept["request"];
  asksRecall?: Percept["asksRecall"];
  claims?: Claim[];
  eventId?: string;
}

/** You say something to someone, face to face. */
function spoken(world: WorldState, to: AgentId, s: Spoken): Percept {
  const m = world.minds[to]!;
  const n = calls(world, to);
  return {
    id: nextId(m, "pc"),
    tick: m.tick,
    kind: "speech",
    rawText: `${cap(n)}: "${s.text}"`,
    actor: ME,
    addressedToSelf: true,
    about: s.about ?? [],
    topics: s.topics,
    features: { outcomeForSelf: 0, agency: "other", intentional: 0.6, normViolation: 0, prospective: false, intensity: 0.35, ...s.f },
    request: s.request,
    asksRecall: s.asksRecall,
    claims: s.claims ?? [],
    details: [],
    gist: s.gist(cap(n)),
    eventId: s.eventId,
    options: s.options,
  };
}

/** Everyone close enough to see what you did, apart from the people it was done to. */
function onlookers(world: WorldState, except: AgentId[], place = world.you!.place): AgentId[] {
  return world.order.filter((x) => !except.includes(x) && world.agents[x]!.place === place && awake(world, x)).slice(0, 12);
}

interface Seen {
  except: AgentId[];
  gist: (n: string) => string;
  raw: string;
  /** Positive for a kindness, negative for a wrong; kept small, because it was not done to them. */
  sign: 1 | -1 | 0;
  norm?: number;
  intensity: number;
  topics: string[];
  about?: AgentId[];
  /** Whose side they take: seeing a friend wronged costs you more with them. */
  victim?: AgentId;
  store?: boolean;
  place?: PlaceId;
}

async function seenBy(world: WorldState, faculties: Faculties, sink: Sink, deed: Deed, s: Seen): Promise<AgentId[]> {
  const who = onlookers(world, s.except, s.place);
  for (const id of who) {
    const m = world.minds[id]!;
    const p = eventPercept(m, ME, "other", 0.04 * s.sign, s.intensity, s.topics, s.gist(cap(calls(world, id))), s.raw, deed.id, s.about ?? []);
    p.features.intentional = 0.9;
    p.features.normViolation = s.norm ?? 0;
    const { r, tr } = await through(world, faculties, sink, id, p, "saw");
    if (s.victim && s.sign < 0) {
      const side = m.others[s.victim]?.liking ?? 0.5;
      const before = regard(world, id).liking;
      shift(world, id, tr, `${m.name} saw it done to ${world.agents[s.victim]?.name ?? "someone"}`, { liking: -0.08 * (0.4 + side) });
      r.liking = [r2(before), r2(regard(world, id).liking)];
    }
    if (s.store && world.village) sanction(world, id, tr);
    deed.reactions.push(r);
  }
  return who;
}

function begin(world: WorldState, kind: string, title: string, tone: Deed["tone"], to?: AgentId, said?: string): Deed {
  return { id: nextId(world, "ev_you"), tick: world.tick, kind, place: world.you!.place, title, said, to, tone, reactions: [] };
}

/** Put a deed on your record, in the feed, and (when it is the kind of thing people talk about) among the world's events. */
function finish(world: WorldState, sink: Sink, deed: Deed, o: { event?: string; topics?: string[]; text?: string; chronicle?: { kind: string; why?: Why[] } } = {}): Deed {
  const y = world.you!;
  y.deeds.push(deed);
  if (y.deeds.length > KEEP_DEEDS) y.deeds.splice(0, y.deeds.length - KEEP_DEEDS);
  if (o.event) {
    world.events.push({ id: deed.id, tick: world.tick, kind: "you", label: o.event, topics: [...(o.topics ?? []), deed.id] });
    const mine = world.events.filter((e) => e.kind === "you");
    if (mine.length > 12) world.events.splice(world.events.indexOf(mine[0]!), 1);
  }
  const target = deed.reactions.find((r) => r.role === "to");
  const lines: FeedLine[] = [];
  if (deed.said) lines.push({ speaker: ME, text: deed.said });
  if (target?.said) lines.push({ speaker: target.agent, text: target.said, trace: target.trace });
  feed(world, sink, {
    kind: lines.length ? "talk" : "event",
    place: world.places[deed.place] ? deed.place : undefined,
    agents: [...new Set([...(deed.to ? [deed.to] : []), ...deed.reactions.map((r) => r.agent)])].slice(0, 12),
    title: deed.title,
    text: o.text ?? deed.result,
    lines: lines.length ? lines : undefined,
    refs: deed.reactions.slice(0, 12).map((r) => ({ agent: r.agent, trace: r.trace })),
    chronicle: o.chronicle,
  });
  return deed;
}

// ------------------------------------------------------------------ what they can do about it

type Opt = Omit<ActionOption, "verb"> & { verb?: string };
const opts = (xs: Opt[]): ActionOption[] => xs.map((o) => ({ ...o, verb: o.verb ?? o.label.toLowerCase() }));

const pull = (name: string, value: number, ref?: string) => ({ name, value, ref });

/** How someone can answer a hello from a person nobody knows. */
function greetOptions(m: MindState): ActionOption[] {
  return opts([
    { id: "welcome", label: "Welcome the newcomer", description: "Be open and friendly. Say who you are and what you do here.", prosocial: 0.7, assertive: 0, avoidant: 0, disclosure: 0.5, pull: [pull("curious about someone new", (m.traits.openness - 0.5) * 0.5)] },
    { id: "nod", label: "Nod and carry on", description: "Polite and brief. Give nothing away.", prosocial: 0.15, assertive: 0.1, avoidant: 0.4, disclosure: 0 },
    { id: "wary", label: "Eye the newcomer warily", description: "Make it plain you don't know them and aren't sure you want to.", prosocial: -0.5, assertive: 0.3, avoidant: 0.5, disclosure: -0.2, pull: [pull("an outsider nobody here knows", (m.traits.neuroticism - 0.5) * 0.5 + (0.5 - m.traits.openness) * 0.4)] },
  ]);
}

/** The three ways a face-to-face moment with you can go when nothing is being asked. */
function replyOptions(): ActionOption[] {
  return opts([
    { id: "warm_to", label: "Warm to the newcomer", description: "Answer kindly and mean it.", prosocial: 0.7, assertive: 0, avoidant: 0, disclosure: 0.4 },
    { id: "guarded", label: "Stay guarded", description: "Civil, short, giving nothing away.", prosocial: 0.15, assertive: 0.1, avoidant: 0.4, disclosure: 0 },
    { id: "cold_to", label: "Turn cold", description: "Let them see you want nothing to do with them.", prosocial: -0.6, assertive: 0.6, avoidant: 0.4, disclosure: -0.2 },
  ]);
}

function hunger(world: WorldState, id: AgentId): { hh?: Household; short: boolean; spare: number } {
  const hh = world.village ? householdOf(world, id) : undefined;
  if (!hh) return { short: false, spare: 0 };
  const perDay = Math.max(1, hh.members.length);
  return { hh, short: hh.food < perDay * 1.5, spare: Math.max(0, hh.food - perDay * 3) };
}

// ------------------------------------------------------------------ checks

/** Why this can't be done right now, in words for the player; nothing when it can. */
export function youCheck(world: WorldState, act: YouAct): string | undefined {
  const y = world.you;
  if (act.act === "arrive") {
    if (!act.name.trim()) return "Give yourself a name.";
    if (y?.banishedUntil && world.tick < y.banishedUntil) return `${world.name} sent you away. They won't have you back before day ${dayOf(y.banishedUntil)}.`;
    return undefined;
  }
  if (!y) return "You are not in this world yet.";
  if (act.act === "rest" || act.act === "leave") return undefined;
  if (y.standing === "banished") return `${world.name} sent you away.`;
  if (act.act === "move") return act.place === "away" || world.places[act.place] ? undefined : "No such place.";
  if (!y.here) return "You are resting at your camp. Walk back in first.";
  const v = world.village;
  if ("to" in act) {
    const a = world.agents[act.to];
    if (!a || !world.minds[act.to]) return "There is nobody by that name here.";
    if (!awake(world, act.to)) return `${a.name} is asleep.`;
    const child = !!v && isChild(world, act.to);
    if (child && ["buy", "sell", "beg", "rumor", "help", "insult"].includes(act.act)) return `${a.name} is a child.`;
    if (["give", "buy", "sell", "beg", "help"].includes(act.act) && !v) return "There is nothing to trade or share here.";
  }
  switch (act.act) {
    case "say":
      return act.text.trim() ? undefined : "Say something.";
    case "ask":
      return act.about === "me" || (world.minds[act.about] && act.about !== act.to) ? undefined : "Ask about yourself or about someone else here.";
    case "give":
      if (!(act.amount > 0)) return "Give how much?";
      return (act.what === "food" ? y.food : y.amber) >= act.amount ? undefined : `You don't have that much ${act.what}.`;
    case "buy":
      return y.amber >= 1 ? undefined : "You have no amber to offer.";
    case "sell":
      return y.food >= AMBER_FOOD ? undefined : `You need ${AMBER_FOOD} food to make it worth a piece of amber.`;
    case "help":
      return world.tick - (y.last[`help:${act.to}`] ?? -1e9) >= 120 ? undefined : "You've only just helped them. Give it a couple of hours.";
    case "rumor":
      if (!world.minds[act.about] || act.about === act.to) return "Tell them about someone else here.";
      return act.text.trim() ? undefined : "What is the story?";
    case "gather":
      if (isNight(world.tick)) return "It is too dark to find anything.";
      if (!["woods", "fields", "harbour", "reeds", "cliffs"].includes(y.place)) return "There is nothing to gather here. Try the pinewood, the barley field or the landing.";
      return world.tick - (y.last.gather ?? -1e9) >= 60 ? undefined : "You've picked this over. Give it an hour.";
    case "store":
      if (!v) return "There is no common store here.";
      if (y.place !== "store") return "Go to the common store first.";
      return act.amount > 0 && y.food >= act.amount ? undefined : "You don't have that much food.";
    case "steal": {
      if (!v) return "There is nothing here to take.";
      if (act.from === "store") {
        if (y.place !== "store") return "Go to the common store first.";
        return v.store.food >= 0.5 ? undefined : "The store is empty.";
      }
      const hh = world.minds[act.from] ? householdOf(world, act.from) : v.households[act.from];
      if (!hh) return "Whose food?";
      if (y.place !== hh.home) return `Go to ${placeName(world, hh.home)} first.`;
      return hh.food >= 0.5 ? undefined : "There is nothing there to take.";
    }
    case "repay": {
      const d = y.debts.find((x) => x.id === act.debt && !x.repaid);
      if (!d) return "No such debt.";
      if (!world.minds[d.creditor]) return "The person you owed is gone.";
      return y.food >= d.amount ? undefined : `You need ${foodText(d.amount)} to pay it back.`;
    }
    case "answer":
      if (!y.ask || y.ask.id !== act.ask) return "They have stopped waiting for an answer.";
      return y.ask.options.some((o) => o.id === act.choice) ? undefined : "That is not one of the answers.";
  }
  return undefined;
}

// ------------------------------------------------------------------ doing things

/** One thing you do. Anything that can't be done is ignored (ask youCheck first to say why). */
export async function youAct(world: WorldState, act: YouAct, faculties: Faculties, sink: Sink): Promise<void> {
  if (youCheck(world, act)) return;
  if (act.act === "arrive") return arrive(world, act.name, faculties, sink);
  const y = world.you!;
  if ("to" in act) y.place = world.agents[act.to]!.place;
  switch (act.act) {
    case "move":
      y.place = act.place;
      y.here = true;
      return;
    case "rest":
      y.here = false;
      y.ask = undefined;
      return;
    case "leave":
      y.here = false;
      y.ask = undefined;
      feed(world, sink, { kind: "event", agents: [], title: `${y.name} walks back down to the landing`, text: "Gone for now. What people here remember stays." });
      return;
    case "greet":
      return void (await greet(world, act.to, faculties, sink));
    case "say":
      return say(world, act.to, act.text.trim().slice(0, 400), faculties, sink);
    case "ask":
      return askThem(world, act.to, act.about, faculties, sink);
    case "compliment":
      return compliment(world, act.to, faculties, sink);
    case "comfort":
      return comfort(world, act.to, faculties, sink);
    case "insult":
      return insult(world, act.to, faculties, sink);
    case "apologize":
      return void (await apologize(world, act.to, faculties, sink));
    case "give":
      return void (await give(world, act.to, act.what, act.amount, faculties, sink));
    case "buy":
      return buy(world, act.to, faculties, sink);
    case "sell":
      return sell(world, act.to, faculties, sink);
    case "beg":
      return beg(world, act.to, faculties, sink);
    case "help":
      return help(world, act.to, faculties, sink);
    case "rumor":
      return rumor(world, act.to, act.about, act.text.trim().slice(0, 240), clamp(act.valence, -1, 1), faculties, sink);
    case "gather":
      return gather(world, sink);
    case "store":
      return putInStore(world, act.amount, faculties, sink);
    case "steal":
      return steal(world, act.from, faculties, sink);
    case "repay":
      return void (await repay(world, y.debts.find((d) => d.id === act.debt)!, faculties, sink));
    case "answer":
      return answer(world, act.choice, faculties, sink);
  }
}

async function arrive(world: WorldState, name: string, faculties: Faculties, sink: Sink): Promise<void> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 24);
  const back = world.you;
  const y: YouState = back ?? {
    name: clean,
    arrived: world.tick,
    place: "harbour",
    here: true,
    food: START_FOOD,
    amber: world.village ? START_AMBER : 0,
    known: [],
    met: {},
    deeds: [],
    debts: [],
    thefts: [],
    rumors: [],
    settled: [],
    standing: "stranger",
    verdicts: [],
    last: {},
    rng: ((world.seed + 1) * 2654435761) >>> 0,
  };
  world.you = y;
  y.here = true;
  y.place = world.places.harbour ? "harbour" : (Object.keys(world.places)[0] ?? "away");
  if (y.standing === "banished") y.standing = "stranger";
  y.banishedUntil = undefined;
  for (const id of world.order) regard(world, id);
  if (back) {
    feed(world, sink, { kind: "event", place: y.place, agents: [], title: `${y.name} walks back up from the landing` });
    return;
  }
  const deed = begin(world, "arrive", `A stranger walks up from the landing`, "plain");
  await seenBy(world, faculties, sink, deed, {
    except: [],
    gist: () => `A stranger came ashore at ${placeName(world, y.place)}, alone, with a pack.`,
    raw: "A stranger steps off a boat nobody was expecting.",
    sign: 0,
    intensity: 0.35,
    topics: ["stranger", "landing", "boat"],
  });
  deed.result = `Nobody here knows ${y.name}. ${deed.reactions.length ? `${list(deed.reactions.map((r) => first(r.name)))} saw the boat come in.` : "Nobody saw the boat come in."}`;
  finish(world, sink, deed, { event: "the stranger's arrival", topics: ["stranger", "landing"] });
}

async function greet(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink, lead = ""): Promise<Reaction> {
  const y = world.you!;
  const m = world.minds[to]!;
  const knew = y.known.includes(to);
  const text = `${lead}${knew ? `Hello again, ${first(m.name)}.` : `Hello. I'm ${y.name}. I came in on the boat.`}`;
  learnName(world, to);
  const deed = begin(world, "greet", knew ? `${y.name} says hello to ${m.name}` : `${y.name} says hello to ${m.name} for the first time`, "good", to, text);
  const p = spoken(world, to, {
    text,
    gist: (n) => (knew ? `${n} stopped to say hello at ${placeName(world, y.place)}` : `A stranger called ${y.name} came up and said hello at ${placeName(world, y.place)}`),
    f: { outcomeForSelf: 0.1, intentional: 0.6, intensity: 0.3 },
    topics: ["stranger", "greeting", ...(world.places[y.place]?.topics ?? [])],
    options: greetOptions(m),
  });
  const { r } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  deed.result = r.choice === "Welcome the newcomer" ? `${first(m.name)} made you welcome.` : r.choice === "Eye the newcomer warily" ? `${first(m.name)} doesn't like the look of you.` : `${first(m.name)} nodded and went back to work.`;
  finish(world, sink, deed);
  return r;
}

async function say(world: WorldState, to: AgentId, text: string, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  // Saying who you are is how people come to know your name.
  if (new RegExp(`\\b(i am|i'm|my name is|call me|name's)\\s+${y.name.split(" ")[0]}`, "i").test(text)) learnName(world, to);
  const p = await perceiveText(m, ME, text, faculties);
  p.rawText = `${cap(calls(world, to))}: "${text}"`;
  p.addressedToSelf = true;
  const deed = begin(world, "say", `${y.name} talks with ${m.name}`, "plain", to, text);
  const { r, tr } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  const how: Record<string, string> = { warm: "was warm with you", polite: "was polite, and brief", cold: "brushed you off", grant: "said yes", refuse_flat: "said no", refuse_explain: "said no, and told you why", put_off: "put you off", tell_fully: "told you the whole story", tell_briefly: "gave you the short version", deflect: "changed the subject" };
  deed.result = `${first(m.name)} ${how[tr.action?.option ?? ""] ?? "heard you"}.`;
  deed.tone = tr.action?.option === "cold" ? "bad" : tr.action?.option === "warm" ? "good" : "plain";
  finish(world, sink, deed);
}

async function askThem(world: WorldState, to: AgentId, about: string, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const me = about === "me";
  const subject = me ? ME : about;
  const who = me ? "me" : world.agents[about]!.name;
  const text = me ? "Tell me straight. What do people here make of me?" : `What do you make of ${first(who)}?`;
  const deed = begin(world, "ask", me ? `${y.name} asks ${m.name} what people here think` : `${y.name} asks ${m.name} about ${who}`, "plain", to, text);
  // The ordinary machinery for being asked to recall: tell it all, tell a little, or change the subject.
  const p = spoken(world, to, {
    text,
    gist: (n) => (me ? `${n} asked me what people here think of them` : `${n} asked me what I make of ${who}`),
    f: { outcomeForSelf: 0, intentional: 0.5, intensity: 0.4 },
    topics: me ? ["stranger"] : [],
    about: me ? [] : [about],
    asksRecall: { about: [subject], topics: [] },
  });
  const { r, tr } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  const told = (tr.action?.content ?? []).length > 0;
  if (me) {
    const o = regard(world, to);
    deed.result = `${first(m.name)} ${told ? "told you what they remember of you" : r.choice === "Deflect" ? "changed the subject" : "had little to say"}. Liking ${o.liking.toFixed(2)}, trust ${((o.trust.benevolence + o.trust.integrity) / 2).toFixed(2)}.`;
  } else {
    const view = m.others[about];
    deed.result = `${first(m.name)} ${told ? `told you a story about ${first(who)}` : r.choice === "Deflect" ? "wouldn't be drawn" : "had little to say"}.${view ? ` (${first(m.name)}'s liking for ${first(who)} is ${view.liking.toFixed(2)}.)` : ""}`;
  }
  finish(world, sink, deed);
}

async function compliment(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const text = `You do good work, ${first(m.name)}. I can see why people here lean on you.`;
  const deed = begin(world, "compliment", `${y.name} pays ${m.name} a compliment`, "good", to, text);
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} told me I do good work and that people lean on me`,
    f: { outcomeForSelf: 0.3, intentional: 0.8, intensity: 0.35 },
    topics: ["stranger", "praise", "work"],
    options: opts([
      { id: "take_kindly", label: "Take it kindly", description: "Thank them. It is good to be seen.", prosocial: 0.7, assertive: 0, avoidant: 0, disclosure: 0.3 },
      { id: "shrug", label: "Shrug it off", description: "Wave it away and get back to the work.", prosocial: 0.1, assertive: 0, avoidant: 0.4, disclosure: 0, pull: [pull("doesn't think much of own work", (0.5 - m.self.selfEsteem) * 0.5)] },
      { id: "flattery", label: "Smell flattery", description: "Ask what they are after. Nobody says that for nothing.", prosocial: -0.5, assertive: 0.4, avoidant: 0.3, disclosure: -0.1 },
    ]),
  });
  const { r, tr } = await through(world, faculties, sink, to, p, "to");
  if (r.choice === "Smell flattery") {
    shift(world, to, tr, `${m.name} took the praise for flattery`, { integ: -0.04 });
    r.trust[1] = r2((regard(world, to).trust.benevolence + regard(world, to).trust.integrity) / 2);
  }
  if (r.choice === "Take it kindly") m.self.selfEsteem = clamp(m.self.selfEsteem + 0.02);
  deed.reactions.push(r);
  deed.result = r.choice === "Take it kindly" ? `${first(m.name)} took it kindly.` : r.choice === "Smell flattery" ? `${first(m.name)} wonders what you want.` : `${first(m.name)} shrugged it off.`;
  finish(world, sink, deed);
}

async function comfort(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const low = clamp(m.affect.emotions.distress + m.affect.emotions.fear + m.affect.stress * 0.6 - m.affect.mood.valence * 0.3);
  const weight = m.episodes.filter((e) => e.valence < -0.2 && !e.about.includes(ME)).sort((a, b) => b.tick - a.tick || a.valence - b.valence)[0];
  const text = "You look like you're carrying something. I've got time, if you want to talk.";
  const deed = begin(world, "comfort", `${y.name} sits down with ${m.name}`, "good", to, text);
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} saw I was low and offered to listen`,
    f: { outcomeForSelf: 0.12 + 0.3 * low, intentional: 0.8, intensity: 0.3 + 0.3 * low },
    topics: ["stranger", "comfort", ...(weight?.topics.slice(0, 3) ?? [])],
    options: opts([
      { id: "open_up", label: "Open up", description: "Tell them what has been weighing on you.", prosocial: 0.6, assertive: 0, avoidant: 0, disclosure: 0.9, pull: [pull("something weighing on them", low * 0.5), pull("need for connection", (1 - m.needs.relatedness) * 0.4, "need:relatedness")] },
      { id: "thank", label: "Thank them and leave it", description: "It is kind, but you keep your troubles to yourself.", prosocial: 0.3, assertive: 0, avoidant: 0.4, disclosure: 0 },
      { id: "alone", label: "Want to be left alone", description: "Tell them it is none of their business.", prosocial: -0.4, assertive: 0.3, avoidant: 0.8, disclosure: -0.3 },
    ]),
  });
  const { r } = await through(world, faculties, sink, to, p, "to");
  if (r.choice === "Open up") {
    m.needs.relatedness = clamp(m.needs.relatedness + 0.1);
    m.affect.stress *= 0.85;
    m.affect.emotions.distress *= 0.8;
    regard(world, to).bond = clamp(regard(world, to).bond + 0.08);
    deed.result = weight ? `${first(m.name)} told you what's been weighing on them: "${weight.gist}"` : `${first(m.name)} opened up a little.`;
  } else deed.result = r.choice === "Want to be left alone" ? `${first(m.name)} wants to be left alone.` : `${first(m.name)} thanked you and kept it to themself.`;
  deed.reactions.push(r);
  finish(world, sink, deed);
}

async function insult(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const text = `You're a fool, ${first(m.name)}, and everybody here knows it.`;
  const deed = begin(world, "insult", `${y.name} insults ${m.name}`, "bad", to, text);
  const at = placeName(world, y.place);
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} called me a fool to my face at ${at}`,
    f: { outcomeForSelf: -0.5, intentional: 0.95, normViolation: 0.5, intensity: 0.6 },
    topics: ["stranger", "insult", "respect"],
    eventId: deed.id,
    options: opts([
      { id: "snap_back", label: "Snap back", description: "Give as good as you got, loudly.", prosocial: -0.7, assertive: 0.8, avoidant: 0, disclosure: 0 },
      { id: "let_pass", label: "Let it pass", description: "Refuse to be drawn. Say something mild.", prosocial: 0.2, assertive: 0, avoidant: 0.4, disclosure: 0, pull: [pull("slow to anger", (m.traits.agreeableness - 0.5) * 0.4)] },
      { id: "turn_away", label: "Turn away", description: "Walk off without a word.", prosocial: -0.2, assertive: 0, avoidant: 0.9, disclosure: -0.3 },
    ]),
  });
  const { r } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  const saw = await seenBy(world, faculties, sink, deed, {
    except: [to],
    gist: (n) => `${n} called ${m.name} a fool in front of everyone at ${at}`,
    raw: `${y.name} insults ${m.name} at ${at}.`,
    sign: -1,
    norm: 0.3,
    intensity: 0.45,
    topics: ["stranger", "insult", "respect"],
    about: [to],
    victim: to,
  });
  deed.result = `${first(m.name)} ${r.choice === "Snap back" ? "snapped back" : r.choice === "Turn away" ? "turned away without a word" : "let it pass"}.${saw.length ? ` ${saw.length} ${saw.length === 1 ? "person" : "people"} heard it.` : ""}`;
  finish(world, sink, deed, { event: `${y.name}'s insult to ${m.name}`, topics: ["stranger", "insult"] });
}

async function apologize(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink, lead = ""): Promise<Reaction> {
  const y = world.you!;
  const m = world.minds[to]!;
  const wrong = strongest(m, -1);
  // Paying back what was taken from them counts for more than the words.
  const taken = y.thefts.filter((t) => (t.seen.includes(to) || t.by === to) && t.blamed !== "paid").reduce((s, t) => s + t.amount, 0);
  const pay = taken > 0 && y.food >= taken ? taken : 0;
  const text = `${lead}I did wrong by you, ${first(m.name)}. I'm sorry.${pay ? ` Here is the ${foodText(pay)} back.` : ""}`;
  const deed = begin(world, "apologize", `${y.name} apologises to ${m.name}`, "good", to, text);
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} came and said sorry${pay ? ", and gave back what was taken" : ""}`,
    f: { outcomeForSelf: 0.2 + (pay ? 0.2 : 0), intentional: 0.9, intensity: 0.5 },
    topics: ["stranger", "apology", "fairness"],
    options: opts([
      { id: "forgive", label: "Forgive", description: "Take the apology and let the thing go.", prosocial: 0.8, assertive: 0, avoidant: 0, disclosure: 0.3, pull: [...(pay ? [pull("gave back what was taken", 0.45)] : []), ...(wrong ? [pull(`memory: ${wrong.gist}`, wrong.valence * 0.5, wrong.id)] : [pull("nothing to forgive", 0.3)])] },
      { id: "accept_coolly", label: "Accept it, coolly", description: "Hear it. Promise nothing.", prosocial: 0.2, assertive: 0.1, avoidant: 0.3, disclosure: 0 },
      { id: "reject", label: "Refuse the apology", description: "Words are cheap. Say so.", prosocial: -0.6, assertive: 0.6, avoidant: 0.2, disclosure: 0 },
    ]),
  });
  const { r, tr } = await through(world, faculties, sink, to, p, "to");
  if (pay) {
    y.food = r2(y.food - pay);
    const hh = world.village ? householdOf(world, to) : undefined;
    if (y.thefts.some((t) => t.from === "store" && (t.seen.includes(to) || t.by === to)) && world.village) world.village.store.food = Number((world.village.store.food + pay).toFixed(1));
    else if (hh) hh.food = r2(hh.food + pay);
    for (const t of y.thefts) if (t.seen.includes(to) || t.by === to) t.blamed = "paid";
  }
  if (r.choice === "Forgive") {
    shift(world, to, tr, `${m.name} forgave ${regard(world, to).name}`, { liking: 0.05, integ: 0.08 });
    // Forgiving re-tags the memory: it still happened, but it stings less.
    if (wrong) wrong.valence *= 0.6;
    const o = regard(world, to);
    r.liking[1] = r2(o.liking);
    r.trust[1] = r2((o.trust.benevolence + o.trust.integrity) / 2);
  }
  if (wrong) y.settled.push(`${to}:${wrong.id}`);
  deed.reactions.push(r);
  deed.result = r.choice === "Forgive" ? `${first(m.name)} forgave you.` : r.choice === "Refuse the apology" ? `${first(m.name)} wouldn't have it.` : `${first(m.name)} heard you out and promised nothing.`;
  finish(world, sink, deed);
  return r;
}

async function give(world: WorldState, to: AgentId, what: "food" | "amber", amount: number, faculties: Faculties, sink: Sink, asked = false, lead = ""): Promise<Reaction> {
  const y = world.you!;
  const m = world.minds[to]!;
  const h = hunger(world, to);
  const thing = what === "food" ? foodText(amount) : `${amount} ${amount === 1 ? "piece" : "pieces"} of amber`;
  const text = `${lead}${asked ? `Take this. ${cap(thing)}.` : `Here. ${cap(thing)}, for you. No strings.`}`;
  const deed = begin(world, "give", `${y.name} gives ${m.name} ${thing}`, "good", to, text);
  const worth = what === "food" ? amount / Math.max(1, h.hh?.members.length ?? 1) : (moneyOf(world).accept[to] ?? 0.2) * amount;
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} gave me ${thing}${asked ? " when I asked" : " and asked for nothing"}`,
    f: { outcomeForSelf: clamp(0.2 + 0.12 * worth + (h.short && what === "food" ? 0.2 : 0), 0, 0.7), intentional: 0.9, intensity: 0.5 },
    topics: ["stranger", "gift", what === "food" ? "food" : "amber", ...(h.short ? ["hunger"] : [])],
    eventId: deed.id,
    options: opts([
      { id: "take_gladly", label: "Take it gladly", description: "Accept, and thank them properly.", prosocial: 0.7, assertive: 0, avoidant: 0, disclosure: 0.3, comply: true, pull: h.short && what === "food" ? [pull("the household is short of food", 0.5)] : [] },
      { id: "take_wary", label: "Take it, and wonder why", description: "Accept, but nobody gives for nothing.", prosocial: 0.1, assertive: 0, avoidant: 0.3, disclosure: 0, comply: true, pull: h.short && what === "food" ? [pull("the household is short of food", 0.3)] : [] },
      { id: "refuse_gift", label: "Refuse it", description: "You take nothing from someone you don't know.", prosocial: -0.5, assertive: 0.4, avoidant: 0.3, disclosure: 0, pull: [pull("owes nothing to an outsider", (0.5 - m.traits.agreeableness) * 0.4)] },
    ]),
  });
  const { r } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  const took = r.choice !== "Refuse it";
  if (took) {
    if (what === "food") {
      y.food = r2(y.food - amount);
      if (h.hh) h.hh.food = r2(h.hh.food + amount);
    } else {
      y.amber -= amount;
      const M = moneyOf(world);
      M.held[to] = (M.held[to] ?? 0) + amount;
    }
  }
  const saw = took
    ? await seenBy(world, faculties, sink, deed, {
        except: [to],
        gist: (n) => `${n} gave ${m.name} ${thing} and asked for nothing`,
        raw: `${y.name} hands ${m.name} ${thing}.`,
        sign: 1,
        intensity: 0.35,
        topics: ["stranger", "gift", "food"],
        about: [to],
      })
    : [];
  deed.result = `${first(m.name)} ${r.choice === "Take it gladly" ? "took it gladly" : took ? "took it, and wonders why" : "wouldn't take it"}.${saw.length ? ` ${list(saw.slice(0, 3).map((x) => first(world.agents[x]!.name)))}${saw.length > 3 ? " and others" : ""} saw.` : ""}`;
  finish(world, sink, deed, took ? { event: `${y.name}'s gift to ${m.name}`, topics: ["stranger", "gift"] } : {});
  return r;
}

async function buy(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const M = moneyOf(world);
  const h = hunger(world, to);
  const takes = M.accept[to] ?? 0.2;
  const text = `I've a piece of amber. Would you sell me ${foodText(AMBER_FOOD)} for it?`;
  const deed = begin(world, "buy", `${y.name} offers ${m.name} amber for food`, "plain", to, text);
  const can = (h.hh?.food ?? 0) >= AMBER_FOOD;
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} offered me a piece of amber for ${foodText(AMBER_FOOD)}`,
    f: { outcomeForSelf: 0.08, intentional: 0.5, prospective: true, intensity: 0.4 },
    topics: ["stranger", "amber", "food", "trade"],
    request: { what: `sell ${foodText(AMBER_FOOD)} for a piece of amber`, topics: ["food", "amber"] },
    options: opts([
      { id: "sell_food", label: "Sell for amber", description: "Take the amber and hand over the food.", prosocial: 0.3, assertive: 0, avoidant: 0, disclosure: 0, comply: true, pull: [pull("believes amber will buy food from someone else", (takes - 0.5) * 1.4), pull(can && h.spare > 0 ? "has food to spare" : "has no food to spare", can ? (h.spare > 0 ? 0.3 : -0.3) : -2)] },
      { id: "give_food", label: "Give it for nothing", description: "Keep your amber. Nobody should go hungry here.", prosocial: 0.9, assertive: 0, avoidant: 0, disclosure: 0.2, comply: true, pull: [pull(can && h.spare > 0 ? "has food to spare" : "has no food to spare", can ? (h.spare > 0 ? 0.1 : -0.6) : -2)] },
      { id: "no_sale", label: "Refuse to sell", description: "Amber is a pretty stone. You can't eat it.", prosocial: -0.4, assertive: 0.4, avoidant: 0.2, disclosure: 0 },
    ]),
  });
  const { r } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  if (r.choice === "Sell for amber" && h.hh) {
    y.amber -= 1;
    M.held[to] = (M.held[to] ?? 0) + 1;
    h.hh.food = r2(h.hh.food - AMBER_FOOD);
    y.food = r2(y.food + AMBER_FOOD);
    // Amber that bought something is amber worth taking next time.
    M.accept[to] = Number(clamp(takes + 0.05).toFixed(3));
    M.deals.sell++;
    deed.result = `${first(m.name)} took your amber for ${foodText(AMBER_FOOD)}.`;
  } else if (r.choice === "Give it for nothing" && h.hh) {
    h.hh.food = r2(h.hh.food - AMBER_FOOD);
    y.food = r2(y.food + AMBER_FOOD);
    M.deals.give++;
    deed.result = `${first(m.name)} wouldn't take your amber and gave you the food.`;
  } else {
    M.deals.refuse++;
    deed.result = `${first(m.name)} wouldn't sell. ${takes < 0.4 ? "Amber doesn't buy much with them." : ""}`.trim();
  }
  finish(world, sink, deed);
}

async function sell(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const M = moneyOf(world);
  const h = hunger(world, to);
  const has = (M.held[to] ?? 0) >= 1;
  const text = `I've ${foodText(AMBER_FOOD)} to spare. It's yours for a piece of amber.`;
  const deed = begin(world, "sell", `${y.name} offers ${m.name} food for amber`, "plain", to, text);
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} offered me ${foodText(AMBER_FOOD)} for a piece of amber`,
    f: { outcomeForSelf: h.short ? 0.2 : 0.05, intentional: 0.5, prospective: true, intensity: 0.4 },
    topics: ["stranger", "amber", "food", "trade", ...(h.short ? ["hunger"] : [])],
    request: { what: `pay a piece of amber for ${foodText(AMBER_FOOD)}`, topics: ["food", "amber"] },
    options: opts([
      { id: "pay_amber", label: "Pay amber for it", description: "Hand over a piece of amber and take the food.", prosocial: 0.3, assertive: 0, avoidant: 0, disclosure: 0, comply: true, pull: [pull(has ? "has amber to pay with" : "has no amber", has ? 0.1 : -2), pull(h.short ? "the household is short of food" : "the household has enough", h.short ? 0.6 : -0.25)] },
      { id: "not_buying", label: "Not buying", description: "You have what you need, or nothing to pay with.", prosocial: -0.1, assertive: 0.2, avoidant: 0.3, disclosure: 0 },
    ]),
  });
  const { r } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  if (r.choice === "Pay amber for it" && h.hh && has) {
    M.held[to] = (M.held[to] ?? 0) - 1;
    y.amber += 1;
    y.food = r2(y.food - AMBER_FOOD);
    h.hh.food = r2(h.hh.food + AMBER_FOOD);
    M.deals.sell++;
    deed.result = `${first(m.name)} paid you a piece of amber.`;
  } else deed.result = `${first(m.name)} isn't buying.${has ? "" : " They have no amber."}`;
  finish(world, sink, deed);
}

async function beg(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const M = moneyOf(world);
  const h = hunger(world, to);
  const amount = 2;
  const can = (h.hh?.food ?? 0) >= amount;
  const spare = pull(can && h.spare > 0 ? "has food to spare" : "has no food to spare", can ? (h.spare > 0 ? 0.25 : -0.5) : -2);
  const owes = y.debts.some((d) => d.creditor === to && !d.repaid);
  const text = "I've nothing for tonight. Could you spare me some food? I'll pay it back.";
  const deed = begin(world, "beg", `${y.name} asks ${m.name} for food`, "plain", to, text);
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} asked me for food`,
    f: { outcomeForSelf: -0.1, intentional: 0.5, prospective: true, intensity: 0.5 },
    topics: ["stranger", "food", "hunger", "debt"],
    request: { what: "spare some food", topics: ["food"] },
    options: opts([
      { id: "give", label: "Give them food", description: "Hand it over and ask for nothing back.", prosocial: 0.9, assertive: 0, avoidant: 0, disclosure: 0.1, comply: true, pull: [spare] },
      { id: "lend", label: "Lend it", description: "Hand it over, to be paid back within two days.", prosocial: 0.5, assertive: 0.1, avoidant: 0, disclosure: 0, comply: true, pull: [spare, pull(owes ? "already owed by them" : "their word is worth something", owes ? -0.8 : (regard(world, to).trust.integrity - 0.5) * 1.2, `other:${ME}`)] },
      { id: "sell", label: "Ask amber for it", description: "They can have it for a piece of amber.", prosocial: 0.05, assertive: 0.3, avoidant: 0, disclosure: 0, pull: [spare, pull("believes amber will buy food from someone else", ((M.accept[to] ?? 0.2) - 0.5) * 1.2)] },
      { id: "refuse", label: "Send them away hungry", description: "You have your own to feed.", prosocial: -0.6, assertive: 0.5, avoidant: 0.2, disclosure: 0 },
    ]),
  });
  const { r } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  const hand = () => {
    h.hh!.food = r2(h.hh!.food - amount);
    y.food = r2(y.food + amount);
  };
  if (r.choice === "Give them food" && h.hh && can) {
    hand();
    M.deals.give++;
    deed.result = `${first(m.name)} gave you ${foodText(amount)}.`;
  } else if (r.choice === "Lend it" && h.hh && can) {
    hand();
    M.deals.lend++;
    y.debts.push({ id: nextId(world, "owe"), creditor: to, amount, tick: world.tick, due: world.tick + 2 * 1440 });
    deed.result = `${first(m.name)} lent you ${foodText(amount)}. You owe it back within two days.`;
  } else if (r.choice === "Ask amber for it" && h.hh && can && y.amber >= 1) {
    hand();
    y.amber -= 1;
    M.held[to] = (M.held[to] ?? 0) + 1;
    M.deals.sell++;
    deed.result = `${first(m.name)} wanted a piece of amber for it, and you paid.`;
  } else {
    M.deals.refuse++;
    deed.result = r.choice === "Ask amber for it" ? `${first(m.name)} wants amber for it, and you have none.` : `${first(m.name)} sent you away with nothing.`;
  }
  finish(world, sink, deed);
}

async function help(world: WorldState, to: AgentId, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const a = world.agents[to]!;
  const v = world.village!;
  const job = JOBS[a.role];
  const text = "Let me give you a hand with that.";
  const deed = begin(world, "help", `${y.name} offers to work alongside ${m.name}`, "good", to, text);
  y.last[`help:${to}`] = world.tick;
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} worked alongside me for a couple of hours and asked nothing for it`,
    f: { outcomeForSelf: 0.4, intentional: 0.9, intensity: 0.5 },
    topics: ["stranger", "help", "work", ...(world.places[a.place]?.topics ?? [])],
    eventId: deed.id,
    options: opts([
      { id: "work_with", label: "Work alongside them", description: "Glad of the help. Show them what needs doing.", prosocial: 0.6, assertive: 0, avoidant: 0, disclosure: 0.2, comply: true, pull: [pull("tired", (1 - m.needs.energy) * 0.3)] },
      { id: "grudging", label: "Let them, grudgingly", description: "An extra pair of hands is an extra pair of hands.", prosocial: 0.1, assertive: 0, avoidant: 0.3, disclosure: 0, comply: true },
      { id: "wave_off", label: "Wave them off", description: "You don't need a stranger under your feet.", prosocial: -0.4, assertive: 0.4, avoidant: 0.4, disclosure: 0, pull: [pull("likes to do it their own way", (m.traits.conscientiousness - 0.5) * 0.3)] },
    ]),
  });
  const { r } = await through(world, faculties, sink, to, p, "to");
  deed.reactions.push(r);
  if (r.choice === "Wave them off") {
    deed.result = `${first(m.name)} waved you off.`;
    finish(world, sink, deed);
    return;
  }
  // Two hours of a second pair of hands, in whatever their trade makes.
  const hh = householdOf(world, to);
  let made = "";
  if (job?.makes === "food" && hh) {
    const n = r2(job.rate * 2);
    hh.food = r2(hh.food + n);
    made = `${foodText(n)} more for ${hh.name}`;
  } else if (job && (job.makes === "timber" || job.makes === "stone" || job.makes === "reeds")) {
    const n = r2(job.rate * 2);
    v.stock[job.makes] = r2(v.stock[job.makes] + n);
    made = `${n} more ${job.makes} on the village pile`;
  } else if (job?.makes === "build") {
    v.stock.timber = r2(v.stock.timber + 2);
    made = "timber carried up for the builders";
  } else made = "the work went quicker";
  m.needs.energy = clamp(m.needs.energy + 0.04);
  m.needs.relatedness = clamp(m.needs.relatedness + 0.05);
  regard(world, to).bond = clamp(regard(world, to).bond + 0.05);
  const saw = await seenBy(world, faculties, sink, deed, {
    except: [to],
    gist: (n) => `${n} put in two hours' work beside ${m.name} for nothing`,
    raw: `${y.name} works alongside ${m.name}.`,
    sign: 1,
    intensity: 0.3,
    topics: ["stranger", "help", "work"],
    about: [to],
  });
  deed.result = `Two hours beside ${first(m.name)}: ${made}.${saw.length ? ` ${saw.length} saw you at it.` : ""}`;
  finish(world, sink, deed, { event: `${y.name}'s help with ${first(m.name)}'s work`, topics: ["stranger", "help"] });
}

async function rumor(world: WorldState, to: AgentId, about: AgentId, text: string, valence: number, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const m = world.minds[to]!;
  const subject = world.agents[about]!.name;
  const story = text.replace(/\.?$/, ".");
  const id = nextId(world, "rum_you");
  world.rumors[id] = { id, subject: about, origin: ME, first: story, hops: [] };
  y.rumors.push({ id, about, tick: world.tick });
  const fond = (m.others[about]?.liking ?? 0.5) - 0.5;
  const deed = begin(world, "rumor", `${y.name} tells ${m.name} a story about ${subject}`, valence < 0 ? "bad" : "plain", to, story);
  const p = spoken(world, to, {
    text: story,
    gist: (n) => `${n} told me: ${story.replace(/\.$/, "")}`,
    f: { outcomeForSelf: 0, intentional: 0.5, intensity: 0.3 + 0.4 * Math.abs(valence) },
    topics: ["rumor", "stranger"],
    about: [about],
    claims: [{ about, topics: ["rumor"], proposition: story, valence, rumor: id }],
    options: opts([
      { id: "take_in", label: "Take it in", description: "It fits. Ask for the rest of it.", prosocial: 0.4, assertive: 0, avoidant: 0, disclosure: 0.3, pull: [pull(`fits what they think of ${subject}`, -fond * Math.sign(valence || 1) * 1.2, `other:${about}`)] },
      { id: "doubt", label: "Doubt it", description: "Maybe. You'd want to hear it from someone you know.", prosocial: 0, assertive: 0.1, avoidant: 0.3, disclosure: 0 },
      { id: "stand_up", label: "Stand up for them", description: `Tell them you won't hear that said about ${subject}.`, prosocial: -0.4, assertive: 0.6, avoidant: 0, disclosure: 0.1, pull: [pull(`fond of ${subject}`, valence < 0 ? fond * 1.6 : -0.6, `other:${about}`)] },
    ]),
  });
  const { r, tr } = await through(world, faculties, sink, to, p, "to");
  const bel = m.beliefs.find((b) => b.rumor === id);
  if (r.choice === "Stand up for them") {
    if (bel) bel.confidence = r2(bel.confidence * 0.4);
    shift(world, to, tr, `${m.name} thinks less of someone who talks like that about ${subject}`, { liking: -0.05, integ: -0.07 });
    const o = regard(world, to);
    r.liking[1] = r2(o.liking);
    r.trust[1] = r2((o.trust.benevolence + o.trust.integrity) / 2);
  } else if (r.choice === "Doubt it" && bel) bel.confidence = r2(bel.confidence * 0.75);
  hop(world, id, ME, to, story, false, tr.id);
  deed.reactions.push(r);
  deed.result = `${first(m.name)} ${r.choice === "Take it in" ? "took it in" : r.choice === "Doubt it" ? "isn't sure they believe it" : `stood up for ${first(subject)}`}.${bel ? ` They believe it ${Math.round(bel.confidence * 100)}%.` : ""}`;
  finish(world, sink, deed);
}

function gather(world: WorldState, sink: Sink): void {
  const y = world.you!;
  y.last.gather = world.tick;
  const where = placeName(world, y.place);
  const season = world.village?.season;
  const lean = season === "winter" ? 0.5 : 1;
  const n = r2((y.place === "harbour" ? 1.5 : 1) * lean);
  y.food = r2(y.food + n);
  const amber = world.village && (y.place === "harbour" || y.place === "cliffs") && rand(y) < 0.25;
  if (amber) y.amber += 1;
  const deed = begin(world, "gather", `${y.name} forages at ${where}`, "plain");
  deed.result = `${y.place === "harbour" ? "Mussels off the rocks" : y.place === "fields" ? "Gleanings from the field edge" : y.place === "woods" ? "Mushrooms and pine nuts" : "What the shore gives"}: ${foodText(n)}.${amber ? " And a piece of amber in the wrack." : ""}`;
  y.deeds.push(deed);
  if (y.deeds.length > KEEP_DEEDS) y.deeds.shift();
  void sink;
}

async function putInStore(world: WorldState, amount: number, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const v = world.village!;
  y.food = r2(y.food - amount);
  v.store.food = Number((v.store.food + amount).toFixed(1));
  const deed = begin(world, "store", `${y.name} puts ${foodText(amount)} into the common store`, "good");
  const saw = await seenBy(world, faculties, sink, deed, {
    except: [],
    gist: (n) => `${n} put ${foodText(amount)} into the common store without being asked`,
    raw: `${y.name} carries ${foodText(amount)} into the common store.`,
    sign: 1,
    intensity: 0.45,
    topics: ["stranger", "store", "food", "fairness"],
  });
  deed.result = saw.length ? `${list(saw.slice(0, 3).map((x) => first(world.agents[x]!.name)))}${saw.length > 3 ? " and others" : ""} saw you do it.` : "Nobody was there to see it.";
  finish(world, sink, deed, saw.length ? { event: `${y.name}'s share for the common store`, topics: ["stranger", "store"] } : {});
}

async function steal(world: WorldState, from: string, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const v = world.village!;
  const store = from === "store";
  const hh = store ? undefined : world.minds[from] ? householdOf(world, from)! : v.households[from]!;
  const amount = r2(Math.min(store ? 3 : 2, store ? v.store.food : hh!.food));
  if (store) v.store.food = Number((v.store.food - amount).toFixed(1));
  else hh!.food = r2(hh!.food - amount);
  y.food = r2(y.food + amount);
  const whose = store ? "the common store" : `${poss(hh!.name)} stores`;
  const deed = begin(world, "steal", `${y.name} takes ${foodText(amount)} from ${whose}`, "bad");
  const theft: Theft = { id: deed.id, tick: world.tick, from: store ? "store" : hh!.id, amount, seen: [] };
  theft.seen = await seenBy(world, faculties, sink, deed, {
    except: [],
    gist: (n) => `I saw ${low(n)} take food from ${whose}`,
    raw: `${y.name} takes food from ${whose}.`,
    sign: -1,
    norm: 0.85,
    intensity: 0.7,
    topics: ["stranger", "theft", "food", "fairness", store ? "store" : "home"],
    store,
  });
  // Seeing your own supper carried off is not a small thing.
  for (const r of deed.reactions) {
    if (hh?.members.includes(r.agent)) {
      const before = regard(world, r.agent).liking;
      shift(world, r.agent, undefined, "it was their own food", { liking: -0.12, ben: -0.1 });
      r.liking = [r2(before), r2(regard(world, r.agent).liking)];
    }
  }
  y.thefts.push(theft);
  if (y.thefts.length > 20) y.thefts.shift();
  deed.result = theft.seen.length ? `${list(theft.seen.slice(0, 3).map((x) => first(world.agents[x]!.name)))}${theft.seen.length > 3 ? " and others" : ""} saw you.` : "Nobody saw. Someone will count it sooner or later.";
  finish(world, sink, deed, theft.seen.length ? { event: `${y.name} taking from ${whose}`, topics: ["stranger", "theft"] } : {});
}

async function repay(world: WorldState, d: YouDebt, faculties: Faculties, sink: Sink, lead = ""): Promise<Reaction> {
  const y = world.you!;
  const to = d.creditor;
  const m = world.minds[to]!;
  y.place = world.agents[to]!.place;
  y.food = r2(y.food - d.amount);
  const hh = world.village ? householdOf(world, to) : undefined;
  if (hh) hh.food = r2(hh.food + d.amount);
  d.repaid = world.tick;
  const late = world.tick > d.due;
  const text = `${lead}Here's the ${foodText(d.amount)} I owe you. Thank you for it.`;
  const deed = begin(world, "repay", `${y.name} pays ${m.name} back`, "good", to, text);
  const p = spoken(world, to, {
    text,
    gist: (n) => `${n} paid back the ${foodText(d.amount)} I lent${late ? ", late" : ", as promised"}`,
    f: { outcomeForSelf: 0.3, intentional: 0.9, intensity: 0.45 },
    topics: ["stranger", "debt", "food", "fairness"],
    options: replyOptions(),
  });
  const { r, tr } = await through(world, faculties, sink, to, p, "to");
  shift(world, to, tr, `${regard(world, to).name} kept their word`, { integ: late ? 0.04 : 0.09 });
  r.trust[1] = r2((regard(world, to).trust.benevolence + regard(world, to).trust.integrity) / 2);
  deed.reactions.push(r);
  deed.result = `Paid${late ? ", late" : " on time"}. ${first(m.name)} will remember that you kept your word.`;
  finish(world, sink, deed);
  return r;
}

// ------------------------------------------------------------------ people come to you

interface Reason {
  from: AgentId;
  kind: AskKind;
  score: number;
  about?: string;
  amount?: number;
}

/** What, if anything, would bring this person over to you right now. */
function reasonFor(world: WorldState, id: AgentId): Reason | undefined {
  const y = world.you!;
  const m = world.minds[id]!;
  const o = regard(world, id);
  const child = !!world.village && isChild(world, id);
  const out: Reason[] = [];
  if (!y.met[id] && !y.known.includes(id)) out.push({ from: id, kind: "who", score: 0.2 + 0.4 * m.traits.extraversion + 0.2 * m.traits.openness });
  if (child) return out[0];
  const debt = y.debts.find((d) => d.creditor === id && !d.repaid && !d.refused && world.tick >= d.due);
  if (debt && world.tick - (y.last[`dun:${debt.id}`] ?? -1e9) > 720) out.push({ from: id, kind: "debt", score: 0.9, about: debt.id, amount: debt.amount });
  const wrong = strongest(m, -1);
  if (wrong && wrong.valence < -0.2 && !y.settled.includes(`${id}:${wrong.id}`)) out.push({ from: id, kind: "confront", score: 0.45 + 0.3 * (1 - m.traits.agreeableness) + 0.2 * m.traits.extraversion + 0.3 * m.affect.emotions.anger, about: wrong.id });
  const h = hunger(world, id);
  if (h.short && y.food >= 1 && world.tick - (y.last[`fed:${id}`] ?? -1e9) > 720) out.push({ from: id, kind: "hungry", score: 0.35 + (o.liking - 0.5) + 0.2 * m.traits.extraversion, amount: Math.min(2, Math.floor(y.food)) });
  const kind = strongest(m, 1);
  if (kind && kind.id.startsWith("ev_you") && kind.valence > 0.2 && world.tick - kind.tick < 2 * 1440 && !y.settled.includes(`${id}:${kind.id}`) && h.spare >= 1) out.push({ from: id, kind: "thanks", score: 0.3 + 0.4 * m.traits.agreeableness, about: kind.id, amount: 1 });
  if (o.liking >= 0.58) {
    const story = m.episodes
      .filter((e) => !e.id.startsWith("talk_") && e.agency !== "self" && e.about.some((s) => s in world.minds && s !== id) && Math.abs(e.valence) * (0.3 + e.arousal) > 0.15)
      .sort((a, b) => Math.abs(b.valence) - Math.abs(a.valence))[0];
    if (story) out.push({ from: id, kind: "confide", score: 0.25 + 0.3 * m.traits.extraversion + (o.liking - 0.58), about: story.id });
  }
  if (o.liking >= 0.56 && hourOf(world.tick) >= 18 && y.place !== "tavern" && world.places.tavern && world.tick - (y.last.invite ?? -1e9) > 1440) out.push({ from: id, kind: "invite", score: 0.3 + 0.3 * m.traits.extraversion });
  if (o.liking >= 0.6 && world.tick - (y.last.warn ?? -1e9) > 1440 && aggrieved(world).length >= 2) out.push({ from: id, kind: "warn", score: 0.5 });
  // Nobody comes back with the same thing twice in a day.
  return out.filter((r) => world.tick - (y.last[`${r.kind}:${id}`] ?? -1e9) > 720).sort((a, b) => b.score - a.score)[0];
}

const ASK_TEXT: Record<AskKind, { label: string; describe: (w: WorldState, r: Reason) => string; options: (w: WorldState, r: Reason) => Ask["options"] }> = {
  who: {
    label: "Size up the newcomer",
    describe: () => "Ask the stranger who they are and what brings them here.",
    options: () => [
      { id: "introduce", label: "Tell them who you are" },
      { id: "vague", label: "Keep it vague", hint: "Give nothing away" },
      { id: "rude", label: "Tell them to mind their own business" },
    ],
  },
  hungry: {
    label: "Ask the newcomer for food",
    describe: () => "Your household is short tonight. Ask the stranger whether they can spare any food.",
    options: (w, r) => [
      { id: "give", label: `Give them ${foodText(r.amount ?? 1)}` },
      { id: "sell", label: "Ask a piece of amber for it" },
      { id: "refuse", label: "Say you have none to spare" },
    ],
  },
  confront: {
    label: "Have it out with the newcomer",
    describe: (w, r) => `Tell the stranger to their face what you hold against them: ${w.minds[r.from]!.episodes.find((e) => e.id === r.about)?.gist ?? "what they did"}.`,
    options: () => [
      { id: "own_up", label: "Own up and say sorry", hint: "Pays back what you took, if you can" },
      { id: "deny", label: "Deny it" },
      { id: "laugh", label: "Laugh in their face" },
    ],
  },
  debt: {
    label: "Call in a debt",
    describe: (w, r) => `Ask the stranger for the ${foodText(r.amount ?? 1)} they owe you. It is past due.`,
    options: (w, r) => [
      { id: "pay", label: `Pay back the ${foodText(r.amount ?? 1)}` },
      { id: "later", label: "Ask for more time" },
      { id: "wont", label: "Tell them you won't pay" },
    ],
  },
  thanks: {
    label: "Thank the newcomer",
    describe: (w, r) => `Thank the stranger for what they did (${w.minds[r.from]!.episodes.find((e) => e.id === r.about)?.gist ?? "a kindness"}), and press a little food on them in return.`,
    options: () => [
      { id: "accept", label: "Take it, with thanks" },
      { id: "decline", label: "Tell them to keep it" },
    ],
  },
  confide: {
    label: "Confide in the newcomer",
    describe: () => "Tell the stranger, quietly, the story you have been carrying about someone here.",
    options: () => [
      { id: "listen", label: "Hear them out" },
      { id: "defend", label: "Say you won't talk about people behind their backs" },
    ],
  },
  invite: {
    label: "Invite the newcomer to the fire",
    describe: () => "Ask the stranger to come and sit with everyone at the fire tonight.",
    options: () => [
      { id: "come", label: "Go and sit with them" },
      { id: "not_tonight", label: "Not tonight" },
    ],
  },
  warn: {
    label: "Warn the newcomer",
    describe: () => "Tell the stranger, as a friend, that people here are starting to talk about sending them away.",
    options: () => [
      { id: "thank", label: "Thank them for telling you" },
      { id: "shrug", label: "Say you don't care what people think" },
    ],
  },
};

async function approach(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  if (world.tick - (y.last.ask ?? -1e9) < ASK_WAIT) return;
  const near = world.order.filter((x) => world.agents[x]!.place === y.place && awake(world, x) && (world.agents[x]!.talkingUntil ?? 0) <= world.tick);
  const best = near
    .map((x) => reasonFor(world, x))
    .filter((r): r is Reason => !!r)
    .sort((a, b) => b.score - a.score)[0];
  if (!best || rand(y) > clamp(best.score) * 0.7) return;
  const m = world.minds[best.from]!;
  const spec = ASK_TEXT[best.kind];
  const o = regard(world, best.from);
  const story = best.kind === "confide" || best.kind === "confront" || best.kind === "thanks" ? m.episodes.find((e) => e.id === best.about) : undefined;
  const res = await faculties.speak({
    self: identityOf(m),
    listener: { id: ME, name: o.name },
    heard: "",
    intent: { option: spec.label, description: spec.describe(world, best) },
    content: story ? [{ id: story.id, text: story.gist }] : [],
    style: {
      warmth: clamp(0.5 * m.traits.agreeableness + 0.3 * m.affect.mood.valence + 0.5 * (o.liking - 0.5) - 0.4 * m.affect.emotions.anger),
      curtness: clamp(m.affect.emotions.anger * 0.7 + m.affect.stress * 0.3 + (1 - m.traits.agreeableness) * 0.2 + (best.kind === "confront" ? 0.3 : 0)),
      hedging: clamp(m.traits.neuroticism * 0.5),
      verbosity: clamp(m.traits.extraversion * 0.6 + 0.2),
    },
    stance: [`You have walked over to ${o.name} at ${placeName(world, y.place)} to say this. One or two sentences.`],
    salience: 1,
  });
  y.last.ask = world.tick;
  y.last[`${best.kind}:${best.from}`] = world.tick;
  y.ask = { id: nextId(world, "ask"), tick: world.tick, from: best.from, kind: best.kind, line: res.utterance, options: spec.options(world, best), expires: world.tick + ASK_WAIT, about: best.about, amount: best.amount };
  if (best.kind === "debt" && best.about) y.last[`dun:${best.about}`] = world.tick;
  if (best.kind === "invite") y.last.invite = world.tick;
  if (best.kind === "warn") y.last.warn = world.tick;
  if (best.kind === "hungry") y.last[`fed:${best.from}`] = world.tick;
  setOverride(world, sink, best.from, world.agents[best.from]!.place, `talking with ${y.name}`, ASK_WAIT);
  feed(world, sink, { kind: "talk", place: world.places[y.place] ? y.place : undefined, agents: [best.from], title: `${m.name} comes over to ${y.name}`, lines: [{ speaker: best.from, text: res.utterance }] });
}

/** A plain spoken answer of yours, taken warmly, guardedly or coldly. */
async function reply(world: WorldState, faculties: Faculties, sink: Sink, deed: Deed, to: AgentId, s: Spoken): Promise<{ r: Reaction; tr: Trace }> {
  deed.said = s.text;
  const out = await through(world, faculties, sink, to, spoken(world, to, { options: replyOptions(), ...s }), "to");
  deed.reactions.push(out.r);
  return out;
}

async function answer(world: WorldState, choice: string, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const ask = y.ask!;
  y.ask = undefined;
  const to = ask.from;
  const m = world.minds[to];
  if (!m || !world.agents[to]) return;
  const name = first(m.name);
  const label = ask.options.find((o) => o.id === choice)!.label;
  const key = `${ask.kind}:${choice}`;
  const deed = begin(world, "answer", `${y.name} answers ${m.name}`, "plain", to);
  const done = (result: string, tone: Deed["tone"] = "plain", o: Parameters<typeof finish>[3] = {}) => {
    deed.result = result;
    deed.tone = tone;
    finish(world, sink, deed, o);
  };
  // Some answers are one of the ordinary acts; that act puts its own deed on the record.
  const absorb = (_r: Reaction, _label: string) => undefined;
  switch (key) {
    case "who:introduce":
      return absorb(await greet(world, to, faculties, sink), label);
    case "who:vague": {
      const { tr } = await reply(world, faculties, sink, deed, to, { text: "Just passing through. Seeing what there is to see.", gist: (n) => `I asked ${low(n)} who they were and got no real answer`, f: { outcomeForSelf: -0.05, intentional: 0.5, intensity: 0.3 }, topics: ["stranger"] });
      shift(world, to, tr, "wouldn't say who they were", { integ: -0.03 });
      return done(`${name} still doesn't know who you are.`);
    }
    case "who:rude": {
      await reply(world, faculties, sink, deed, to, { text: "That's my business, not yours.", gist: (n) => `I asked ${low(n)} who they were and was told to mind my own business`, f: { outcomeForSelf: -0.3, intentional: 0.9, normViolation: 0.3, intensity: 0.45 }, topics: ["stranger", "insult"] });
      return done(`${name} won't forget the welcome you gave them.`, "bad");
    }
    case "hungry:give":
      return absorb(await give(world, to, "food", Math.min(ask.amount ?? 1, y.food), faculties, sink, true), label);
    case "hungry:sell": {
      const M = moneyOf(world);
      const amount = Math.min(ask.amount ?? 1, y.food);
      const has = (M.held[to] ?? 0) >= 1;
      const { r } = await reply(world, faculties, sink, deed, to, {
        text: `I can let you have ${foodText(amount)} for a piece of amber.`,
        gist: (n) => `I asked ${low(n)} for food when we were short, and they wanted amber for it`,
        f: { outcomeForSelf: has ? 0.1 : -0.2, intentional: 0.6, intensity: 0.45 },
        topics: ["stranger", "food", "amber", "hunger"],
        options: opts([
          { id: "pay_amber", label: "Pay amber for it", description: "Hand over a piece of amber and take the food.", prosocial: 0.3, assertive: 0, avoidant: 0, disclosure: 0, comply: true, pull: [pull(has ? "has amber to pay with" : "has no amber", has ? 0.4 : -2), pull("the household is short of food", 0.5)] },
          { id: "not_buying", label: "Not buying", description: "Walk away. You asked for help, not a price.", prosocial: -0.3, assertive: 0.3, avoidant: 0.3, disclosure: 0 },
        ]),
      });
      const hh = householdOf(world, to);
      if (r.choice === "Pay amber for it" && has && hh) {
        M.held[to] = (M.held[to] ?? 0) - 1;
        y.amber += 1;
        y.food = r2(y.food - amount);
        hh.food = r2(hh.food + amount);
        M.deals.sell++;
        return done(`${name} paid a piece of amber for ${foodText(amount)}.`);
      }
      return done(`${name} walked away without it.`, "bad");
    }
    case "hungry:refuse": {
      await reply(world, faculties, sink, deed, to, { text: "I've none to spare. I'm sorry.", gist: (n) => `I asked ${low(n)} for food when we were short and was turned away`, f: { outcomeForSelf: -0.3, intentional: 0.7, normViolation: 0.15, intensity: 0.5 }, topics: ["stranger", "food", "hunger"] });
      return done(`${name} went away hungry.`, "bad");
    }
    case "confront:own_up":
      return absorb(await apologize(world, to, faculties, sink, "You're right. "), label);
    case "confront:deny": {
      const saw = y.thefts.some((t) => t.seen.includes(to)) || m.episodes.some((e) => e.id === ask.about && e.source.kind === "witnessed" && /insult|fool|called me/.test(e.gist));
      const { r, tr } = await reply(world, faculties, sink, deed, to, {
        text: "That wasn't me. You've got the wrong person.",
        gist: (n) => `${n} denied it to my face`,
        f: { outcomeForSelf: saw ? -0.25 : 0, intentional: 0.8, normViolation: saw ? 0.6 : 0, intensity: 0.5 },
        topics: ["stranger", "fairness", "lie"],
        options: opts([
          { id: "believe", label: "Believe the denial", description: "Perhaps you had it wrong. Let it go.", prosocial: 0.5, assertive: 0, avoidant: 0.2, disclosure: 0, pull: [pull(saw ? "saw it with their own eyes" : "only heard it, never saw it", saw ? -1.5 : 0.25), pull("whether their word is worth anything", (regard(world, to).trust.integrity - 0.5) * 1.4, `other:${ME}`)] },
          { id: "dont_buy", label: "Don't buy it", description: "You know what you know. Tell them so.", prosocial: -0.4, assertive: 0.6, avoidant: 0, disclosure: 0 },
        ]),
      });
      if (ask.about) y.settled.push(`${to}:${ask.about}`);
      if (r.choice === "Believe the denial") {
        const ep = m.episodes.find((e) => e.id === ask.about);
        if (ep) ep.valence *= 0.5;
        shift(world, to, tr, "took the denial at its word", { liking: 0.05, integ: 0.05 });
        return done(`${name} believed you.`);
      }
      return done(`${name} doesn't believe a word of it.`, "bad");
    }
    case "confront:laugh": {
      await reply(world, faculties, sink, deed, to, { text: "And what are you going to do about it?", gist: (n) => `${n} laughed in my face when I had it out with them`, f: { outcomeForSelf: -0.45, intentional: 0.95, normViolation: 0.5, intensity: 0.6 }, topics: ["stranger", "insult", "fairness"] });
      if (ask.about) y.settled.push(`${to}:${ask.about}`);
      return done(`${name} is angrier than before.`, "bad");
    }
    case "debt:pay": {
      const d = y.debts.find((x) => x.id === ask.about && !x.repaid);
      if (d && y.food >= d.amount) return absorb(await repay(world, d, faculties, sink), label);
      // Meant to pay, and couldn't: it lands as a put-off.
    }
    // falls through
    case "debt:later": {
      const d = y.debts.find((x) => x.id === ask.about);
      if (d) d.due = world.tick + 1440;
      await reply(world, faculties, sink, deed, to, { text: "I haven't got it yet. Give me another day.", gist: (n) => `${n} asked for more time to pay back what I lent`, f: { outcomeForSelf: -0.15, intentional: 0.5, normViolation: 0.2, intensity: 0.4 }, topics: ["stranger", "debt", "fairness"] });
      return done(`${name} will wait one more day.`);
    }
    case "debt:wont": {
      const d = y.debts.find((x) => x.id === ask.about);
      if (d) d.refused = world.tick;
      const { tr } = await reply(world, faculties, sink, deed, to, { text: "I'm not paying. Call it a lesson.", gist: (n) => `${n} took what I lent and refused to pay it back`, f: { outcomeForSelf: -0.5, intentional: 0.95, normViolation: 0.8, intensity: 0.65 }, topics: ["stranger", "debt", "fairness", "theft"], eventId: deed.id });
      shift(world, to, tr, "broke their word over a debt", { integ: -0.1 });
      return done(`${name} lent you food and you kept it. That will be told.`, "bad", { event: `${y.name}'s unpaid debt to ${m.name}`, topics: ["stranger", "debt"] });
    }
    case "thanks:accept": {
      const hh = world.village ? householdOf(world, to) : undefined;
      const n = ask.amount ?? 1;
      if (hh && hh.food >= n) {
        hh.food = r2(hh.food - n);
        y.food = r2(y.food + n);
      }
      if (ask.about) y.settled.push(`${to}:${ask.about}`);
      await reply(world, faculties, sink, deed, to, { text: "Thank you. That's kind.", gist: (n2) => `${n2} took the food I brought to say thanks`, f: { outcomeForSelf: 0.2, intentional: 0.7, intensity: 0.35 }, topics: ["stranger", "gift", "food"] });
      regard(world, to).bond = clamp(regard(world, to).bond + 0.05);
      return done(`${name} gave you ${foodText(n)} to say thanks.`, "good");
    }
    case "thanks:decline": {
      if (ask.about) y.settled.push(`${to}:${ask.about}`);
      await reply(world, faculties, sink, deed, to, { text: "Keep it. You need it more than I do.", gist: (n) => `${n} wouldn't take anything in return`, f: { outcomeForSelf: 0.3, intentional: 0.9, intensity: 0.4 }, topics: ["stranger", "gift", "food"] });
      return done(`${name} kept the food, and thinks the better of you.`, "good");
    }
    case "confide:listen": {
      const ep = m.episodes.find((e) => e.id === ask.about);
      await reply(world, faculties, sink, deed, to, { text: "Go on. It stays with me.", gist: (n) => `${n} heard me out and said it would go no further`, f: { outcomeForSelf: 0.25, intentional: 0.8, intensity: 0.4 }, topics: ["stranger", "trust", ...(ep?.topics.slice(0, 2) ?? [])], about: ep?.about.filter((s) => s in world.minds && s !== to) ?? [] });
      m.needs.relatedness = clamp(m.needs.relatedness + 0.06);
      regard(world, to).bond = clamp(regard(world, to).bond + 0.08);
      return done(ep ? `${name} told you: "${ep.gist}"` : `${name} told you what was on their mind.`, "good");
    }
    case "confide:defend": {
      await reply(world, faculties, sink, deed, to, { text: "I'd rather not talk about people who aren't here to answer.", gist: (n) => `${n} wouldn't hear a word against anyone behind their back`, f: { outcomeForSelf: -0.1, intentional: 0.6, intensity: 0.35 }, topics: ["stranger", "trust"] });
      shift(world, to, undefined, "wouldn't gossip", { integ: 0.04 });
      return done(`${name} was put out, but knows you don't carry tales.`);
    }
    case "invite:come": {
      y.place = "tavern";
      await reply(world, faculties, sink, deed, to, { text: "I'd like that. Lead the way.", gist: (n) => `${n} came and sat with us at the fire`, f: { outcomeForSelf: 0.25, intentional: 0.8, intensity: 0.35 }, topics: ["stranger", "fire"] });
      setOverride(world, sink, to, "tavern", `sitting at ${placeName(world, "tavern")} with ${y.name}`, 90);
      deed.place = "tavern";
      const saw = await seenBy(world, faculties, sink, deed, { except: [to], gist: (n) => `${n} sat with us at the fire, ${name}'s guest`, raw: `${y.name} sits down at the fire beside ${m.name}.`, sign: 1, intensity: 0.3, topics: ["stranger", "fire"], about: [to], place: "tavern" });
      return done(`You sat at the fire as ${name}'s guest.${saw.length ? ` ${saw.length} others were there.` : ""}`, "good");
    }
    case "invite:not_tonight": {
      await reply(world, faculties, sink, deed, to, { text: "Not tonight. Another time.", gist: (n) => `I asked ${low(n)} to the fire and they wouldn't come`, f: { outcomeForSelf: -0.08, intentional: 0.5, intensity: 0.25 }, topics: ["stranger", "fire"] });
      return done(`${name} shrugged and went on.`);
    }
    case "warn:thank": {
      await reply(world, faculties, sink, deed, to, { text: "Thank you for telling me. I mean that.", gist: (n) => `I warned ${low(n)} what people were saying, and was thanked for it`, f: { outcomeForSelf: 0.2, intentional: 0.8, intensity: 0.35 }, topics: ["stranger", "trust"] });
      return done(`${name} is on your side. ${list(aggrieved(world).slice(0, 3).map((x) => first(world.agents[x]!.name)))} are not.`, "good");
    }
    default: {
      await reply(world, faculties, sink, deed, to, { text: "I don't much care what people think.", gist: (n) => `I warned ${low(n)} and they shrugged it off`, f: { outcomeForSelf: -0.1, intentional: 0.6, intensity: 0.3 }, topics: ["stranger"] });
      return done(`${name} tried.`);
    }
  }
}

// ------------------------------------------------------------------ what follows from what you did

/** Adults who hold something against you. */
function aggrieved(world: WorldState): AgentId[] {
  return adults(world).filter((id) => {
    const o = world.minds[id]!.others[ME];
    return !!o && (o.liking < 0.34 || o.trust.integrity < 0.25);
  });
}

/** Food taken with nobody watching is missed sooner or later, and someone gets the blame. */
async function missed(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const v = world.village;
  if (!v || isNight(world.tick)) return;
  for (const t of y.thefts) {
    if (t.seen.length || t.noticed || world.tick - t.tick < 90) continue;
    const store = t.from === "store";
    const hh = store ? undefined : v.households[t.from];
    const who = store
      ? (world.order.find((x) => world.agents[x]!.role === "keeper" && !isChild(world, x)) ?? v.civic?.leader)
      : hh?.members.filter((x) => world.minds[x] && !isChild(world, x)).sort((a, b) => world.minds[b]!.traits.conscientiousness - world.minds[a]!.traits.conscientiousness)[0];
    t.noticed = world.tick;
    if (!who || !world.minds[who]) continue;
    const m = world.minds[who]!;
    t.by = who;
    // Suspicion falls on whoever they already trusted least; a stranger starts with a strike against them.
    const mine = 0.3 + (0.5 - regard(world, who).trust.integrity) * 1.4 + (1 - m.traits.openness) * 0.2;
    const others = adults(world)
      .filter((x) => x !== who && !hh?.members.includes(x) && m.others[x])
      .map((x) => ({ id: x, s: (0.5 - m.others[x]!.trust.integrity) * 1.4 + (0.5 - m.others[x]!.liking) * 0.6 }))
      .sort((a, b) => b.s - a.s)[0];
    const whose = store ? "the common store" : "our food";
    const blamed = others && others.s > mine ? others.id : mine > 0.15 ? ME : undefined;
    t.blamed = blamed;
    const where = store ? "store" : "home";
    if (!blamed) {
      record(world, sink, who, await runPercept(m, eventPercept(m, "world", "circumstance", -0.2, 0.4, [where, "food", "theft"], `Food has gone missing from ${whose} and I can't think who took it.`, `${m.name} counts ${whose} and comes up short.`, t.id), faculties));
      feed(world, sink, { kind: "event", place: store ? "store" : hh?.home, agents: [who], title: `${m.name} finds ${store ? "the store" : "the larder"} short`, text: `${foodText(t.amount)} gone, and nobody to blame.` });
      continue;
    }
    const name = blamed === ME ? calls(world, who) : world.agents[blamed]!.name;
    const p = eventPercept(m, blamed, "other", store ? -0.2 : -0.4, 0.6, [where, "food", "theft", "fairness", ...(blamed === ME ? ["stranger"] : [])], `Food went missing from ${whose}, and I think ${name} took it.`, `${m.name} counts ${whose} and comes up ${foodText(t.amount)} short.`, t.id, blamed === ME ? [] : [blamed]);
    p.features.intentional = 0.9;
    p.features.normViolation = 0.8;
    const tr = blamed === ME ? (await through(world, faculties, sink, who, p, "saw")).tr : await runPercept(m, p, faculties);
    if (blamed !== ME) record(world, sink, who, tr);
    if (store) sanction(world, who, tr);
    feed(world, sink, {
      kind: "event",
      place: store ? "store" : hh?.home,
      agents: blamed === ME ? [who] : [who, blamed],
      title: `${m.name} finds ${store ? "the store" : "the larder"} short and suspects ${blamed === ME ? y.name : name}`,
      text: blamed === ME ? `${foodText(t.amount)} gone. ${m.name} has made up their mind it was you.` : `${foodText(t.amount)} gone. It was you, but ${m.name} trusts ${name} least, so ${name} gets the blame.`,
      refs: [{ agent: who, trace: tr.id }],
    });
  }
}

/** A story you started gets back to the person it is about, with your name on it. */
async function leaks(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  for (const ru of y.rumors) {
    if (ru.leaked || world.tick - ru.tick < 120) continue;
    const S = world.minds[ru.about];
    const r = world.rumors[ru.id];
    if (!S || !r || !awake(world, ru.about)) continue;
    const place = world.agents[ru.about]!.place;
    // Someone who carries it, is standing next to its subject, and likes them more than they like you.
    const teller = world.order.find((x) => x !== ru.about && world.agents[x]!.place === place && awake(world, x) && world.minds[x]!.beliefs.some((b) => b.rumor === ru.id) && (world.minds[x]!.others[ru.about]?.liking ?? 0.5) > regard(world, x).liking);
    if (!teller || rand(y) > 0.3) continue;
    ru.leaked = world.tick;
    const T = world.minds[teller]!;
    const bel = T.beliefs.find((b) => b.rumor === ru.id)!;
    const bad = bel.valence < 0;
    const n = calls(world, ru.about);
    const p: Percept = {
      id: nextId(S, "pc"),
      tick: S.tick,
      kind: "speech",
      rawText: `${T.name}: "You should know what ${calls(world, teller)} has been saying about you. ${bel.proposition}"`,
      actor: teller,
      addressedToSelf: false,
      about: [ME],
      topics: ["rumor", "stranger", "fairness"],
      // The messenger is not to blame; what moves is how its subject holds you.
      features: { outcomeForSelf: bad ? -0.35 : 0.25, agency: "circumstance", intentional: 0, normViolation: 0, prospective: false, intensity: 0.55 },
      claims: [],
      details: [],
      gist: bad ? `${T.name} told me ${n} has been going round saying: ${bel.proposition.replace(/\.$/, "")}` : `${T.name} told me ${n} has been speaking well of me`,
      eventId: nextId(world, "ev_you"),
    };
    const o = regard(world, ru.about);
    const before = o.liking;
    const tr = await runPercept(S, p, faculties);
    shift(world, ru.about, tr, bad ? `${o.name} has been telling stories about ${S.name}` : `${o.name} has been speaking well of ${S.name}`, bad ? { liking: -0.15, ben: -0.12, integ: -0.15 } : { liking: 0.08, ben: 0.06 });
    record(world, sink, ru.about, tr);
    hop(world, ru.id, teller, ru.about, bel.proposition, false, tr.id);
    feed(world, sink, {
      kind: "talk",
      place,
      agents: [teller, ru.about],
      title: `${T.name} tells ${S.name} what ${y.name} has been saying`,
      text: `"${bel.proposition}" ${S.name}'s liking for you: ${before.toFixed(2)} to ${o.liking.toFixed(2)}.`,
      refs: [{ agent: ru.about, trace: tr.id }],
      rumor: ru.id,
    });
  }
}

/** Names travel: someone who has only heard of "the stranger" learns your name from a neighbour who knows it. */
function namesTravel(world: WorldState): void {
  const y = world.you!;
  const knows = new Set(y.known);
  for (const id of world.order) {
    if (knows.has(id)) continue;
    const m = world.minds[id]!;
    if (m.beliefs.some((b) => b.about === ME && b.source.from && knows.has(b.source.from))) learnName(world, id);
  }
}

const VOTE = (world: WorldState, id: AgentId, proposer: AgentId): ActionOption[] => {
  const m = world.minds[id]!;
  const o = regard(world, id);
  const worst = strongest(m, -1);
  const best = strongest(m, 1);
  const heard = m.beliefs.filter((b) => b.about === ME && b.valence < 0).sort((a, b) => b.confidence - a.confidence)[0];
  return opts([
    {
      id: "send",
      label: "Send them away",
      description: `Stand with ${world.agents[proposer]!.name}: ${o.name} goes on the next boat.`,
      prosocial: 0.25,
      assertive: 0.5,
      avoidant: 0,
      disclosure: 0,
      comply: true,
      act: `votes to send ${o.name} away`,
      pull: [
        pull(`what ${m.name} makes of ${o.name}`, (0.5 - o.liking) * 2.4, `other:${ME}`),
        pull(`whether ${o.name} can be trusted`, (0.5 - o.trust.integrity) * 1.6, `other:${ME}`),
        ...(worst ? [pull(`memory: ${worst.gist}`, -worst.valence * 0.7, worst.id)] : []),
        ...(heard ? [pull(`heard: ${heard.proposition}`, -heard.valence * heard.confidence * 0.6, heard.id)] : []),
        pull("wary of outsiders", (m.traits.neuroticism - 0.5) * 0.3 + (0.5 - m.traits.openness) * 0.3),
      ],
    },
    {
      id: "stay",
      label: "Let them stay",
      description: `Speak against it: ${o.name} has done you no harm worth a boat.`,
      prosocial: -0.25,
      assertive: 0.3,
      avoidant: 0,
      disclosure: 0.1,
      act: `votes to let ${o.name} stay`,
      pull: [pull("a guest is not turned out lightly", 0.3 + (m.traits.agreeableness - 0.5) * 0.4), ...(best ? [pull(`memory: ${best.gist}`, best.valence * 0.9, best.id)] : [])],
    },
  ]);
};

/** Enough people hold enough against you, and someone stands up at the fire to say so. */
async function judgement(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const h = hourOf(world.tick);
  if (h < 19.25 || h > 21.5 || world.tick - (y.last.trial ?? -1e9) < 2 * 1440) return;
  const everyone = adults(world);
  const against = aggrieved(world);
  if (against.length < Math.max(3, Math.ceil(everyone.length * 0.25))) return;
  y.last.trial = world.tick;
  const leader = world.village?.civic?.leader;
  const proposer = leader && against.includes(leader) ? leader : [...against].sort((a, b) => regard(world, a).liking - regard(world, b).liking)[0]!;
  const P = world.minds[proposer]!;
  const wrong = strongest(P, -1);
  const heard = P.beliefs.filter((b) => b.about === ME && b.valence < 0).sort((a, b) => b.confidence - a.confidence)[0];
  const grievance = wrong?.gist ?? heard?.proposition ?? "Nobody knows who they are or what they want.";
  const evId = nextId(world, "ev_you");
  const line = (
    await faculties.speak({
      self: identityOf(P),
      listener: { id: "everyone", name: "everyone at the fire" },
      heard: "",
      intent: { option: "Call for the newcomer to go", description: `Stand up at the fire and say ${regard(world, proposer).name} should be put on the next boat, and why: ${grievance}` },
      content: wrong ? [{ id: wrong.id, text: wrong.gist }] : [],
      style: { warmth: 0.2, curtness: 0.6, hedging: 0.1, verbosity: 0.5 },
      stance: ["You are standing up at the fire circle to speak to the whole village. Two or three sentences."],
      salience: 1,
    })
  ).utterance;
  world.events.push({ id: evId, tick: world.tick, kind: "you", label: `the vote on whether ${y.name} stays`, topics: ["stranger", "fairness", evId] });
  const verdict: Verdict = { tick: world.tick, proposer, grievance, send: [proposer], stay: [], traces: [], banished: false };
  // Those with a view of you speak first; a big town does not poll every hearth.
  const voters = everyone.filter((x) => x !== proposer).sort((a, b) => Math.abs(regard(world, b).liking - 0.5) - Math.abs(regard(world, a).liking - 0.5)).slice(0, 30);
  for (const id of voters) {
    const m = world.minds[id]!;
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: m.tick,
      kind: "event",
      rawText: `${P.name}, to the whole fire: "${line}"`,
      actor: proposer,
      addressedToSelf: true,
      about: [ME],
      topics: ["stranger", "fairness", evId],
      features: { outcomeForSelf: 0, agency: "other", intentional: 0.5, normViolation: 0, prospective: true, intensity: 0.6 },
      claims: [],
      details: [],
      gist: `${P.name} stood up at the fire and asked us to send ${calls(world, id)} away`,
      eventId: evId,
      options: VOTE(world, id, proposer),
    };
    const tr = await runPercept(m, p, faculties);
    record(world, sink, id, tr);
    (tr.action?.option === "send" ? verdict.send : verdict.stay).push(id);
    verdict.traces.push({ agent: id, trace: tr.id });
  }
  verdict.banished = verdict.send.length > verdict.stay.length;
  y.verdicts.push(verdict);
  if (y.verdicts.length > 6) y.verdicts.shift();
  const names = (xs: AgentId[]) => list(xs.slice(0, 6).map((x) => first(world.agents[x]!.name))) + (xs.length > 6 ? ` and ${xs.length - 6} more` : "");
  const deed = begin(world, "trial", verdict.banished ? `${world.name} sends ${y.name} away` : `${world.name} votes to let ${y.name} stay`, verdict.banished ? "bad" : "good");
  deed.result = `${P.name} stood up at the fire: "${line}" ${verdict.send.length} to send you away (${names(verdict.send)}), ${verdict.stay.length} to let you stay${verdict.stay.length ? ` (${names(verdict.stay)})` : ""}.`;
  y.deeds.push(deed);
  feed(world, sink, {
    kind: "talk",
    place: "tavern",
    agents: [proposer, ...voters].slice(0, 12),
    title: deed.title,
    lines: [{ speaker: proposer, text: line }],
    text: `${verdict.send.length} to send ${y.name} away, ${verdict.stay.length} to let them stay.`,
    refs: verdict.traces.slice(0, 20),
    chronicle: { kind: verdict.banished ? "quarrel" : "peace", why: [{ text: grievance, agent: proposer, episode: wrong?.id }] },
  });
  if (verdict.banished) {
    y.standing = "banished";
    y.here = false;
    y.ask = undefined;
    y.banishedUntil = world.tick + BANISHED_DAYS * 1440;
  }
}

/** Enough people like you, and someone asks you to stay. */
async function welcome(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you!;
  const h = hourOf(world.tick);
  if (y.standing !== "stranger" || h < 18 || h > 21.5) return;
  const everyone = adults(world);
  const met = everyone.filter((x) => y.met[x]);
  if (met.length < Math.max(3, Math.ceil(everyone.length * 0.3))) return;
  const warm = met.filter((x) => regard(world, x).liking >= 0.6);
  if (warm.length < met.length * 0.6 || aggrieved(world).length > warm.length / 3) return;
  const leader = world.village?.civic?.leader;
  const host = leader && warm.includes(leader) ? leader : [...warm].sort((a, b) => regard(world, b).liking - regard(world, a).liking)[0]!;
  const H = world.minds[host]!;
  const kind = strongest(H, 1);
  const line = (
    await faculties.speak({
      self: identityOf(H),
      listener: { id: ME, name: regard(world, host).name },
      heard: "",
      intent: { option: "Ask the newcomer to stay", description: `Tell ${regard(world, host).name}, in front of the others, that there is a place for them here for as long as they want it.` },
      content: kind ? [{ id: kind.id, text: kind.gist }] : [],
      style: { warmth: 0.8, curtness: 0.1, hedging: 0.1, verbosity: 0.5 },
      stance: ["Two sentences, said plainly, with people listening."],
      salience: 1,
    })
  ).utterance;
  y.standing = "welcome";
  y.food = r2(y.food + 3);
  for (const id of everyone) learnName(world, id);
  const deed = begin(world, "welcome", `${world.name} asks ${y.name} to stay`, "good", host);
  deed.result = `${H.name}: "${line}" ${warm.length} of the ${met.length} people you have met think well of you. Everyone knows your name now, and there is a place for you at the fire.`;
  y.deeds.push(deed);
  feed(world, sink, {
    kind: "talk",
    place: world.agents[host]!.place,
    agents: [host, ...warm].slice(0, 12),
    title: deed.title,
    lines: [{ speaker: host, text: line }],
    text: `${warm.length} of the ${met.length} people ${y.name} has met think well of them.`,
    chronicle: { kind: "peace", why: kind ? [{ text: kind.gist, agent: host, episode: kind.id }] : [] },
  });
}

/** Called by advance() once per step. */
export async function youStep(world: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const y = world.you;
  if (!y) return;
  if (y.ask && (world.tick > y.ask.expires || !world.minds[y.ask.from])) {
    // They waited, and you said nothing.
    const from = y.ask.from;
    const m = world.minds[from];
    const kind = y.ask.kind;
    if (kind === "confront" && y.ask.about) y.settled.push(`${from}:${y.ask.about}`);
    y.ask = undefined;
    if (m && (kind === "confront" || kind === "debt" || kind === "hungry")) {
      const p = eventPercept(m, ME, "other", -0.04, 0.3, ["stranger"], `I spoke to ${calls(world, from)} and got no answer at all`, `${y.name} says nothing.`, nextId(world, "ev_you"));
      p.features.intentional = 0.5;
      p.features.normViolation = 0.2;
      await through(world, faculties, sink, from, p, "saw");
    }
  }
  await missed(world, faculties, sink);
  await leaks(world, faculties, sink);
  if (world.tick % 60 < 10) namesTravel(world);
  if (isNight(world.tick) || y.standing === "banished") return;
  await judgement(world, faculties, sink);
  if (!y.here || (y.standing as string) === "banished") return;
  await welcome(world, faculties, sink);
  if (!y.ask) await approach(world, faculties, sink);
}

// ------------------------------------------------------------------ view

export interface YouView {
  name: string;
  here: boolean;
  standing: YouState["standing"];
  banishedUntil?: number;
  place: PlaceId;
  placeName: string;
  food: number;
  amber: number;
  ask?: Ask & { name: string };
  /** People standing where you are. */
  near: AgentId[];
  deeds: Deed[];
  /** Everyone who has a view of you. */
  people: { id: AgentId; name: string; liking: number; trust: number; knows: boolean; met: number; view: string; memory?: string; heard: number }[];
  summary: { met: number; adults: number; warm: number; cold: number; against: number; liking: number };
  debts: (YouDebt & { name: string; overdue: boolean })[];
  /** Stories about you that are going round, and the ones you started. */
  stories: { id: string; text: string; about: string; aboutName: string; yours: boolean; carriers: number; leaked: boolean }[];
  verdict?: Verdict;
  /** What this spot lets you do. */
  can: { gather: boolean; store: boolean; home?: { household: string; name: string; food: number } };
}

function viewWord(o: OtherModel): string {
  const t = (o.trust.benevolence + o.trust.integrity) / 2;
  const like = o.liking >= 0.72 ? "fond of you" : o.liking >= 0.58 ? "likes you" : o.liking > 0.44 ? "no strong view" : o.liking > 0.32 ? "cool toward you" : "can't stand you";
  const trust = t >= 0.62 ? ", trusts you" : t <= 0.34 ? ", doesn't trust you" : "";
  return like + trust;
}

export function youView(world: WorldState): YouView | undefined {
  const y = world.you;
  if (!y) return undefined;
  const v = world.village;
  const everyone = adults(world);
  const people = world.order
    .map((id) => {
      const m = world.minds[id]!;
      const o = m.others[ME];
      if (!o) return undefined;
      const mem = strongest(m);
      const heard = m.beliefs.filter((b) => b.about === ME).length;
      if (!y.met[id] && !mem && !heard && Math.abs(o.liking - 0.5) < 0.02) return undefined;
      return { id, name: m.name, liking: r2(o.liking), trust: r2((o.trust.benevolence + o.trust.integrity) / 2), knows: y.known.includes(id), met: y.met[id]?.n ?? 0, view: viewWord(o), memory: mem?.gist, heard };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Math.abs(b.liking - 0.5) - Math.abs(a.liking - 0.5))
    .slice(0, 60);
  const opinion = people.filter((p) => everyone.includes(p.id));
  const carriers = (id: string) => world.order.filter((x) => world.minds[x]!.beliefs.some((b) => b.rumor === id)).length;
  const stories = [
    ...Object.values(world.rumors)
      .filter((r) => r.subject === ME)
      .slice(-5)
      .map((r) => ({ id: r.id, text: r.first, about: ME, aboutName: "you", yours: false, carriers: carriers(r.id), leaked: false })),
    ...y.rumors.slice(-5).map((r) => ({ id: r.id, text: world.rumors[r.id]?.first ?? "", about: r.about, aboutName: world.agents[r.about]?.name ?? "someone gone", yours: true, carriers: carriers(r.id), leaked: !!r.leaked })),
  ];
  const home = v ? Object.values(v.households).find((h) => h.home === y.place && h.members.length) : undefined;
  return {
    name: y.name,
    here: y.here,
    standing: y.standing,
    banishedUntil: y.banishedUntil,
    place: y.place,
    placeName: placeName(world, y.place),
    food: y.food,
    amber: y.amber,
    ask: y.ask && world.agents[y.ask.from] ? { ...y.ask, name: world.agents[y.ask.from]!.name } : undefined,
    near: y.here ? world.order.filter((x) => world.agents[x]!.place === y.place && awake(world, x)) : [],
    deeds: y.deeds.slice(-12).reverse(),
    people,
    summary: {
      met: everyone.filter((x) => y.met[x]).length,
      adults: everyone.length,
      warm: opinion.filter((p) => p.liking >= 0.58).length,
      cold: opinion.filter((p) => p.liking <= 0.42).length,
      against: aggrieved(world).length,
      liking: opinion.length ? r2(opinion.reduce((s, p) => s + p.liking, 0) / opinion.length) : 0.5,
    },
    debts: y.debts.filter((d) => !d.repaid).map((d) => ({ ...d, name: world.agents[d.creditor]?.name ?? "someone gone", overdue: world.tick > d.due })),
    stories,
    verdict: y.verdicts.at(-1),
    can: {
      gather: ["woods", "fields", "harbour", "reeds", "cliffs"].includes(y.place),
      store: !!v && y.place === "store",
      home: home ? { household: home.id, name: home.name, food: r2(home.food) } : undefined,
    },
  };
}
