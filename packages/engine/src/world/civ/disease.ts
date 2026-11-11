// Sickness that travels. A fever in the first years takes one person at a time (life.ts). A town
// that has grown, and that trades, gets something else: a sickness that passes from person to
// person, runs through the households, and comes in on boats.
//
// The spread is a plain contact model: the sick pass it to those they live with and to a few
// others each day, those who get through it cannot catch it again for some years, and so an
// outbreak burns out when it runs short of people (Kermack & McKendrick 1927). Crowding, hunger
// and bad water make one likelier to start; a well, nursing, a healer and remedies decide how many
// of the sick die; a trader, a merchant, a boat of newcomers or a household that moves can carry
// it to the next town (McNeill 1976 on trade routes as disease routes).
//
// What it does to minds matters more here than the count. A leader has to choose, through their
// own mind, whether to shut the landing and the market: fewer catch it, and nobody can trade. The
// bereaved look for someone to blame: the town the boat came from, the newcomers, the other side
// (scapegoating under threat; Girard 1982, and the behavioural immune system, Schaller 2011, on
// disease threat and wariness of outsiders). Those closest to the dead can be left with a core
// belief that strangers bring sickness, with the death as the memory behind it. Children hear it
// at bedtime like any other story, and a generation later someone stands for leader on closing
// the landing (polity.ts) and can be traced back to this.

import { clamp } from "../../memory.js";
import type { Faculties } from "../../ports.js";
import type { AgentId, Tick } from "../../types.js";
import { craftBonus, townCrafts } from "../knowledge.js";
import { ageOf, die, yearOf } from "../life.js";
import { stands } from "../works.js";
import { eventPercept, feed, luck, personName, type Sink, type Why, type WorldState } from "../world.js";
import { believe, cap, choose, civOf, formSchema, hhOf, list, mark, note, plural, recent, round, witness, yearTicks } from "./base.js";
import { takeRemedy } from "./economy.js";
import { factionOf, liveFactions, rivalryBetween, wrong } from "./factions.js";

export interface Sickness {
  id: string;
  name: string;
  /** How it passes, which decides what slows it. */
  via: "breath" | "water" | "touch";
  /** Chance a day that a sick person passes it to someone they meet. */
  spread: number;
  /** Days it lasts. */
  days: number;
  /** Share of the sick it kills, before age and care. */
  deadly: number;
  /** Years someone who got through it cannot catch it again. */
  immuneYears: number;
}

export const SICKNESSES: Sickness[] = [
  { id: "cough", name: "the coughing sickness", via: "breath", spread: 0.2, days: 3, deadly: 0.05, immuneYears: 4 },
  { id: "flux", name: "the flux", via: "water", spread: 0.17, days: 2, deadly: 0.07, immuneYears: 2 },
  { id: "pox", name: "the red pox", via: "touch", spread: 0.27, days: 4, deadly: 0.13, immuneYears: 99 },
];
const sickness = (id: string) => SICKNESSES.find((s) => s.id === id)!;

export interface Source {
  kind: "arose" | "trader" | "merchant" | "migrants" | "boat" | "raid";
  /** The town it came from, when it came from one. */
  town?: string;
  townName?: string;
  /** Who carried it in, when known. */
  carrier?: AgentId;
}

export interface Outbreak {
  id: string;
  disease: string;
  started: Tick;
  ended?: Tick;
  source: Source;
  first: AgentId;
  cases: AgentId[];
  dead: AgentId[];
  /** What the leader chose when it took hold. */
  decision?: { by: AgentId; choice: "close" | "carry"; tick: Tick; trace?: string };
  /** Whom the bereaved blamed, and who did the blaming. */
  blamed: { what: string; by: AgentId; episode?: string }[];
  /** What there was to nurse the sick with. */
  care: string[];
  why: Why[];
}

export interface Health {
  sick: Record<AgentId, { disease: string; day: number; outbreak: string }>;
  /** Until when each person cannot catch each sickness again. */
  immune: Record<AgentId, Record<string, Tick>>;
  outbreaks: Outbreak[];
  /** The landing and market are shut for a sickness. */
  closed?: { tick: Tick; by: AgentId; outbreak: string };
  n: number;
}

export const newHealth = (): Health => ({ sick: {}, immune: {}, outbreaks: [], n: 0 });

export const activeOutbreak = (w: WorldState): Outbreak | undefined => civOf(w)?.health.outbreaks.find((o) => !o.ended);
const open = (H: Health, w: WorldState, id: AgentId, d: Sickness) => !H.sick[id] && !((H.immune[id]?.[d.id] ?? -1) > w.tick);

function begin(w: WorldState, d: Sickness, first: AgentId, source: Source, sink: Sink): Outbreak {
  const c = civOf(w)!;
  const H = c.health;
  const v = w.village!;
  const tents = Object.values(v.households).filter((h) => h.shelter !== "house").length / Math.max(1, Object.keys(v.households).length);
  const why: Why[] = [];
  if (source.kind === "arose") {
    const parts = [w.order.length >= 40 ? `${w.order.length} people living close` : "", recent(w, c.marks.hunger, 1) ? "a hungry year behind them" : "", tents > 0.4 ? `${Math.round(tents * 100)}% of households still under canvas` : "", d.via === "water" && !stands(w, "well") ? "no well, so everyone drank from the stream" : ""].filter(Boolean);
    why.push({ text: `${cap(d.name)} arose in ${w.name} itself${parts.length ? `: ${list(parts)}` : ""}.` });
  } else {
    const how = { trader: "with a trader", merchant: "with a merchant's goods", migrants: "with a household that moved here", boat: "on the spring boat of newcomers", raid: "with the raiders" }[source.kind];
    why.push({ agent: source.carrier, town: source.town, text: `${cap(d.name)} came to ${w.name} ${how}${source.townName ? ` from ${source.townName}, where it was already going round` : ""}.` });
  }
  why.push({ agent: first, text: `${personName(w, first)} was the first to fall sick.` });
  const ob: Outbreak = { id: `ob_${++H.n}`, disease: d.id, started: w.tick, source, first, cases: [first], dead: [], blamed: [], care: [], why };
  H.outbreaks.push(ob);
  if (H.outbreaks.length > 30) H.outbreaks.splice(0, H.outbreaks.length - 30);
  H.sick[first] = { disease: d.id, day: 0, outbreak: ob.id };
  mark(w, "plague");
  feed(w, sink, { kind: "event", agents: [first], title: `${cap(d.name)} comes to ${w.name}`, text: why.map((x) => x.text).join(" ") });
  note(w, { kind: "plague", title: `${cap(d.name)} comes to ${w.name}`, agents: [first], why });
  return ob;
}

/**
 * Something came into town from where a sickness is going round. Returns true when it took.
 */
export function expose(w: WorldState, disease: string, source: Source, sink: Sink, chance = 0.35): boolean {
  const c = civOf(w);
  if (!c || activeOutbreak(w) || w.order.length < 8) return false;
  const d = sickness(disease);
  const H = c.health;
  const pool = w.order.filter((x) => open(H, w, x, d));
  if (pool.length < w.order.length * 0.3) return false;
  if (luck(w, "expose", disease, source.town ?? source.kind) > chance) return false;
  // Whoever meets what comes over the landing is first.
  const meets = (x: AgentId) => (x === source.carrier ? 3 : 0) + (["merchant", "keeper", "fisher"].includes(w.agents[x]!.role) ? 1 : 0);
  const first = [...pool].sort((a, b) => meets(b) - meets(a) || a.localeCompare(b))[Math.floor(luck(w, "expose-first", disease) * Math.min(3, pool.length))]!;
  begin(w, d, first, source, sink);
  return true;
}

/** Bring someone's sickness and immunities with them when they move town. */
export function carryHealth(from: WorldState, to: WorldState, id: AgentId): string | undefined {
  const a = civOf(from)?.health;
  const b = civOf(to)?.health;
  if (!a || !b) return undefined;
  if (a.immune[id]) b.immune[id] = { ...a.immune[id] };
  const s = a.sick[id];
  delete a.sick[id];
  delete a.immune[id];
  return s?.disease;
}

/**
 * One day of sickness in a town. In a live town this runs each morning; a town on rules runs its
 * season's days in a row (`step` keeps their luck apart).
 */
export async function diseaseDay(w: WorldState, faculties: Faculties, sink: Sink, live: boolean, step = 0): Promise<void> {
  const c = civOf(w);
  if (!c) return;
  const H = c.health;
  const v = w.village!;
  let ob = activeOutbreak(w);
  if (!ob) {
    for (const id of Object.keys(H.sick)) delete H.sick[id];
    if (H.closed) H.closed = undefined;
    const last = H.outbreaks.at(-1);
    if (w.order.length < 12 || (last?.ended !== undefined && w.tick - last.ended < yearTicks(w))) return;
    const tents = Object.values(v.households).filter((h) => h.shelter !== "house").length / Math.max(1, Object.keys(v.households).length);
    const p = 0.0035 * (w.order.length / 30) * (recent(w, c.marks.hunger, 1) ? 1.5 : 1) * (tents > 0.5 ? 1.3 : 1);
    if (luck(w, "outbreak", step) > p) return;
    const weights = SICKNESSES.map((d) => ({ d, x: (d.id === "pox" ? 0.5 : 1) * (d.via === "water" && stands(w, "well") ? 0.4 : 1) * (d.via === "breath" && v.season === "winter" ? 1.5 : 1) * (w.order.filter((x) => open(H, w, x, d)).length >= w.order.length * 0.3 ? 1 : 0) }));
    const total = weights.reduce((s, x) => s + x.x, 0);
    if (total <= 0) return;
    let r = luck(w, "which", step) * total;
    const d = weights.find((x) => (r -= x.x) < 0)?.d ?? weights[0]!.d;
    const pool = w.order.filter((x) => open(H, w, x, d));
    ob = begin(w, d, pool[Math.floor(luck(w, "first", step) * pool.length)]!, { kind: "arose" }, sink);
    if (live)
      await witness(w, w.order.filter((x) => ageOf(w, x) >= 12), (m) => eventPercept(m, "world", "circumstance", -0.25, 0.5, ["sickness", "fear", "health", ob!.id], `${cap(d.name)} came to ${w.name}.`, `${personName(w, ob!.first)} has ${d.name}. People keep their children in.`, `ev_${ob!.id}`), faculties, sink);
    return;
  }
  const d = sickness(ob.disease);
  const healer = w.order.find((x) => w.agents[x]!.role === "healer" && !H.sick[x]);
  const nursing = townCrafts(w).includes("medicine");
  const base = Math.min(0.5, craftBonus(w, "health") * 0.6 + (nursing ? 0.2 : 0) + (healer ? 0.12 : 0));
  for (const [k, on] of [["herb lore", craftBonus(w, "health") > 0], ["nursing the sick apart", nursing], ["a healer", !!healer]] as const) if (on && !ob.care.includes(k)) ob.care.push(k);

  // Those who have had it long enough get through it, or don't.
  for (const id of Object.keys(H.sick)) {
    const s = H.sick[id]!;
    if (!w.order.includes(id)) {
      delete H.sick[id];
      continue;
    }
    const m = w.minds[id]!;
    s.day++;
    m.needs.energy = clamp(m.needs.energy - 0.07);
    if (s.day < d.days) continue;
    delete H.sick[id];
    (H.immune[id] ??= {})[d.id] = w.tick + d.immuneYears * yearTicks(w);
    const age = ageOf(w, id);
    const remedy = takeRemedy(w, id);
    if (remedy && !ob.care.includes("remedies")) ob.care.push("remedies");
    const p = d.deadly * (age < 5 ? 2 : age > 55 ? 2.2 : age > 40 ? 1.2 : 0.7) * (m.needs.energy < 0.3 ? 1.5 : 1) * (1 - Math.min(0.75, base + (remedy ? 0.25 : 0)));
    if (luck(w, "sick-dies", id, step) >= p) continue;
    ob.dead.push(id);
    const kin = bereaved(w, id);
    await die(w, id, d.name, faculties, sink);
    for (const x of kin) if (w.order.includes(x)) blame(w, x, id, ob);
  }

  // The sick pass it on: to their own household first, then to whoever they meet.
  const shut = !!H.closed;
  const slow = (d.via === "water" && stands(w, "well") ? 0.5 : 1) * (d.via === "breath" && v.season === "winter" ? 1.25 : 1) * (nursing ? 0.8 : 1);
  const carriers = Object.keys(H.sick).filter((x) => w.order.includes(x));
  const caught: AgentId[] = [];
  for (const id of carriers) {
    const home = hhOf(w, id)?.members.filter((x) => x !== id && w.order.includes(x)) ?? [];
    for (const o of home) if (open(H, w, o, d) && !caught.includes(o) && luck(w, "catch-home", id, o, step) < Math.min(0.6, d.spread * 1.6 * slow)) caught.push(o);
    const others = w.order.filter((x) => x !== id && !home.includes(x));
    for (let k = 0; k < (shut ? 1 : 3) && others.length; k++) {
      const o = others[Math.floor(luck(w, "meets", id, k, step) * others.length)]!;
      if (open(H, w, o, d) && !caught.includes(o) && luck(w, "catch", id, o, step) < d.spread * slow) caught.push(o);
    }
  }
  for (const id of caught) {
    H.sick[id] = { disease: d.id, day: 0, outbreak: ob.id };
    if (!ob.cases.includes(id)) ob.cases.push(id);
  }

  // Once it has taken hold, the leader has to choose.
  const leader = v.civic?.leader;
  if (!ob.decision && ob.cases.length >= 3 && leader && w.order.includes(leader) && ageOf(w, leader) >= 16) {
    const L = w.minds[leader]!;
    const seen = L.episodes.find((e) => e.topics.includes("sickness") && e.valence < -0.2 && !e.topics.includes(ob!.id));
    const fear = L.schemas.filter((s) => s.threatBias > 0 && s.triggers.includes("sickness")).sort((a, b) => b.strength - a.strength)[0];
    const lean = v.store.food / Math.max(1, w.order.length) < 2;
    const evId = `ev_${ob.id}_choice`;
    const pc = eventPercept(L, "world", "circumstance", -0.3, 0.6, ["sickness", "fear", "market", "leader", evId], `${cap(d.name)} was spreading and ${w.name} looked to me.`, `${plural(ob.cases.length, "person", "people")} in ${w.name} have ${d.name}${ob.dead.length ? ` and ${ob.dead.length} ${ob.dead.length === 1 ? "has" : "have"} died` : ""}. ${L.name} leads the town. Shut the landing and the market until it passes?`, evId);
    pc.features.prospective = true;
    pc.options = [
      { id: "close", label: "Shut the landing and the market", verb: "shut the landing and the market", description: "Nobody lands, nobody trades, no market until it has passed. Fewer will catch it. Those who live by trade will go short.", prosocial: 0.3, assertive: 0.6, avoidant: 0, disclosure: 0.1, coping: "problem", act: "shuts the landing and the market", pull: [{ name: "careful by nature", value: 0.3 * (L.traits.conscientiousness - 0.5) }, { name: "afraid of it", value: 0.25 * (L.traits.neuroticism - 0.5) }, ...(seen ? [{ name: "has seen a sickness go through a town before", value: 0.2, ref: seen.id }] : []), ...(fear ? [{ name: `the core belief “${fear.text}”`, value: 0.3 * fear.strength, ref: fear.id }] : []), ...(nursing ? [{ name: "knows the sick should be kept apart", value: 0.12 }] : []), ...(ob.dead.length ? [{ name: "people have already died", value: 0.1 }] : [])] },
      { id: "carry", label: "Carry on as before", verb: "keep the landing and market open", description: "Sickness comes and goes. People still need to eat and trade.", prosocial: 0, assertive: 0, avoidant: 0.4, disclosure: 0, coping: "avoid", act: "keeps the landing and the market open", pull: [{ name: "the town has to eat", value: lean ? 0.2 : 0.05 }, ...(w.agents[leader]!.role === "merchant" ? [{ name: "lives by the landing", value: 0.2 }] : []), { name: "it will pass", value: 0.2 * (0.5 - L.traits.neuroticism) + 0.1 }] },
    ];
    const { choice, trace } = await choose(w, leader, pc, faculties, sink, live);
    ob.decision = { by: leader, choice: choice === "close" ? "close" : "carry", tick: w.tick, trace };
    if (choice === "close") {
      H.closed = { tick: w.tick, by: leader, outbreak: ob.id };
      feed(w, sink, { kind: "event", place: "harbour", agents: [leader], title: `${L.name} shuts the landing at ${w.name}`, text: `${cap(d.name)} has ${plural(ob.cases.length, "person", "people")} down. No boats, no market, until it passes.`, refs: trace ? [{ agent: leader, trace }] : undefined });
    }
  }

  // Burned out.
  if (Object.keys(H.sick).length === 0) {
    ob.ended = w.tick;
    const dec = ob.decision;
    if (dec) ob.why.push({ agent: dec.by, text: dec.choice === "close" ? `${personName(w, dec.by)}, who led, shut the landing and the market once ${d.name} had taken hold: fewer met, and fewer caught it.` : `${personName(w, dec.by)}, who led, kept the landing and the market open.` });
    ob.why.push({ text: ob.care.length ? `There was ${list(ob.care)} to help the sick.` : `Nobody in ${w.name} knew how to nurse it: no herb lore, no healer.` });
    for (const b of ob.blamed.slice(0, 2)) ob.why.push({ agent: b.by, episode: b.episode, text: `${personName(w, b.by)}, bereaved, blamed ${b.what}.` });
    if (H.closed?.outbreak === ob.id) H.closed = undefined;
    const title = `${cap(d.name)} goes through ${w.name}: ${ob.cases.length} fall sick, ${ob.dead.length ? `${ob.dead.length} die` : "none die"}`;
    const big = ob.dead.length >= 1 || ob.cases.length >= w.order.length * 0.3;
    feed(w, sink, { kind: "event", agents: [ob.first, ...ob.dead].slice(0, 6), title, text: ob.why.map((x) => x.text).join(" "), chronicle: big ? { kind: "plague", why: ob.why } : undefined });
    note(w, { kind: "plague", title, agents: ob.dead.slice(0, 6), why: ob.why });
    for (const id of Object.keys(H.immune)) if (!w.order.includes(id)) delete H.immune[id];
  }
}

/** Those a death hits hardest: partner, parents, children, and anyone bonded under the same roof. */
function bereaved(w: WorldState, dead: AgentId): AgentId[] {
  const v = w.village!;
  const l = v.life[dead];
  const home = hhOf(w, dead)?.members ?? [];
  return w.order.filter((x) => x !== dead && ageOf(w, x) >= 12 && (l?.partner === x || l?.parents.includes(x) || v.life[x]?.parents.includes(dead) || (home.includes(x) && (w.minds[x]!.others[dead]?.bond ?? 0) > 0.5)));
}

/** Someone who has just buried one of their own looks for whose doing it was. */
function blame(w: WorldState, id: AgentId, dead: AgentId, ob: Outbreak): void {
  const m = w.minds[id]!;
  const d = sickness(ob.disease);
  const mem = [...m.episodes].reverse().find((e) => e.about.includes(dead) && e.topics.includes("death"));
  const src = ob.source;
  const dn = personName(w, dead);
  if (src.kind !== "arose") {
    // It came from outside: the town it came from, whoever carried it, and strangers in general.
    if (src.town) believe(m, `town:${src.town}`, ["sickness", "trade", src.town], `Folk from ${src.townName ?? src.town} bring sickness with them`, -0.45, 0.4 + 0.3 * m.traits.neuroticism, mem ? [mem.id] : [], w.tick);
    if (m.traits.neuroticism > 0.45) formSchema(m, { text: "Strangers bring sickness", triggers: ["stranger", "newcomer", "sickness", "boat", "trade"], blameBias: 0.1, threatBias: 0.3, strength: round(0.22 + 0.22 * m.traits.neuroticism) }, mem?.id);
    const carrier = src.carrier && w.order.includes(src.carrier) && src.carrier !== id ? src.carrier : undefined;
    if (carrier) {
      const o = m.others[carrier];
      if (o) o.liking = round(clamp(o.liking - 0.15), 3);
      wrong(w, id, carrier, 0.1, `${personName(w, carrier)} brought ${d.name} that killed ${dn}`, mem?.id);
    }
    ob.blamed.push({ what: src.townName ? `the people of ${src.townName}` : src.kind === "boat" ? "the newcomers off the boat" : "the strangers who brought it", by: id, episode: mem?.id });
    return;
  }
  // It came from nowhere, and that is hard to bear: the anxious find someone anyway.
  if (m.traits.neuroticism < 0.55) return;
  const rival = liveFactions(w)
    .filter((f) => f.id !== factionOf(w, id)?.id && w.order.includes(f.head))
    .map((f) => ({ f, r: rivalryBetween(w, id, f.head) }))
    .sort((a, b) => b.r - a.r)[0];
  if (!rival || rival.r < 0.4) return;
  const o = m.others[rival.f.head];
  if (o) o.liking = round(clamp(o.liking - 0.08), 3);
  wrong(w, id, rival.f.head, 0.06, `${m.name} says ${rival.f.name} fouled the water, the season ${dn} died of ${d.name}`, mem?.id);
  ob.blamed.push({ what: rival.f.name, by: id, episode: mem?.id });
}

// ---------------------------------------------------------------- reading it

export interface HealthView {
  now?: { name: string; sick: { id: AgentId; name: string }[]; cases: number; dead: number; since: number; closed: boolean; source: string };
  closed: boolean;
  immune: { name: string; share: number }[];
  past: { id: string; name: string; year: number; cases: number; dead: { id: AgentId; name: string }[]; source: string; decision?: string; blamed: string[]; why: Why[] }[];
}

export function healthView(w: WorldState): HealthView | undefined {
  const c = civOf(w);
  if (!c) return undefined;
  const H = c.health;
  const year = (t: Tick) => yearOf({ ...w, tick: t });
  const src = (o: Outbreak) => (o.source.kind === "arose" ? "arose here" : `came with ${{ trader: "a trader", merchant: "a merchant", migrants: "a household that moved here", boat: "the spring boat", raid: "raiders" }[o.source.kind]}${o.source.townName ? ` from ${o.source.townName}` : ""}`);
  const ob = activeOutbreak(w);
  return {
    now: ob && { name: sickness(ob.disease).name, sick: Object.keys(H.sick).filter((x) => w.order.includes(x)).map((id) => ({ id, name: personName(w, id) })), cases: ob.cases.length, dead: ob.dead.length, since: year(ob.started), closed: !!H.closed, source: src(ob) },
    closed: !!H.closed,
    immune: SICKNESSES.map((d) => ({ name: d.name, share: round(w.order.filter((x) => (H.immune[x]?.[d.id] ?? -1) > w.tick).length / Math.max(1, w.order.length)) })),
    past: H.outbreaks.filter((o) => o.ended).slice(-6).reverse().map((o) => ({ id: o.id, name: sickness(o.disease).name, year: year(o.started), cases: o.cases.length, dead: o.dead.map((id) => ({ id, name: personName(w, id) })), source: src(o), decision: o.decision && `${personName(w, o.decision.by)} ${o.decision.choice === "close" ? "shut the landing" : "kept the landing open"}`, blamed: [...new Set(o.blamed.map((b) => b.what))], why: o.why })),
  };
}
