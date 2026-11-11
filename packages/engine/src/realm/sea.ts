// What crosses the water between regions. Inside a region, a trader walks from one town's store to
// another's fire in one step (region.ts). Between regions the two towns live in different places
// (often on different threads), so the same visit is cut in two: what leaves one shore is packed
// into a plain packet, and the other shore unpacks it. The packet carries what the visit needs and
// nothing else: the load, the trader as the far town will remember them, the story they tell with
// every memory that story points back to (so its lineage can still be followed on the far shore),
// and the crafts they know.
//
// Each half uses only its own region's chance, so the outcome does not depend on which thread
// either region runs on, or on how many threads there are.

import { clamp, render } from "../memory.js";
import { runPercept } from "../mind.js";
import type { Percept } from "../ports.js";
import { nextId } from "../rng.js";
import type { AgentId, Episode, MindState, Tick } from "../types.js";
import { craft, craftBonus, knows, learn, townCrafts, type Know } from "../world/knowledge.js";
import { hearStory, isChild, yearOf } from "../world/life.js";
import { carryLineage, type RegionSession, type Town } from "../world/region.js";
import { eventPercept, feed, personName, record, thirdPerson, type Why, type WorldState } from "../world/world.js";

/** A place in another region, as much of it as a packet needs to name. */
export interface Abroad {
  region: string;
  regionName: string;
  town: string;
  townName: string;
}

export interface SeaTradePacket {
  kind: "trade";
  tick: Tick;
  from: Abroad;
  to: Abroad;
  trader: { id: AgentId; name: string; conscientiousness: number; agreeableness: number };
  /** Days' food loaded, and what reaches the far shore (less, when the trader kept some back). */
  food: number;
  delivered: number;
  short: boolean;
  /** The trader's strongest story, and the remembered copies its lineage needs. */
  told?: Episode;
  story?: string;
  minds: Record<AgentId, MindState>;
  crafts: Know[];
}

export interface SeaTradeReceipt {
  kind: "trade";
  from: Abroad;
  to: Abroad;
  trader: AgentId;
  traderName: string;
  food: number;
  timber: number;
  short: boolean;
  noticed: boolean;
  /** A craft the trader showed someone on the far shore. */
  taught?: string;
}

export interface SeaGiftPacket {
  kind: "gift";
  tick: Tick;
  from: Abroad;
  to: Abroad;
  food: number;
  who: string;
}

const adultsOf = (w: WorldState) => w.order.filter((x) => !isChild(w, x));
const perHead = (w: WorldState) => w.village!.store.food / Math.max(1, w.order.length);
const charge = (e: Episode) => Math.abs(e.valence) * (0.3 + e.arousal);
const ROUTINE = /^(talk_|pc_|ev_pledge|ev_hungry|ev_tent|ev_gale|ev_design)/;

/** Remember where a town abroad is, so the chronicle and regard can name its region. */
export function noteAbroad(rs: RegionSession, a: Abroad): void {
  (rs.region.abroad ??= {})[a.town] = { name: a.townName, region: a.region, regionName: a.regionName };
}

/** The town that would send a load over the sea (most food a head in the store), and the one that would take one (most timber). */
export function ports(rs: RegionSession): { out?: { town: string; name: string; perHead: number; food: number }; in?: { town: string; name: string; perHead: number; timber: number } } {
  let out: { town: string; name: string; perHead: number; food: number } | undefined;
  let inn: { town: string; name: string; perHead: number; timber: number } | undefined;
  for (const t of rs.region.towns) {
    const w = rs.world(t.id);
    const v = w.village!;
    if (adultsOf(w).length < 2) continue;
    const ph = perHead(w);
    if (ph >= 3 && (!out || ph > out.perHead)) out = { town: t.id, name: t.name, perHead: Number(ph.toFixed(2)), food: Math.round(v.store.food) };
    if (v.stock.timber >= 20 && (!inn || v.stock.timber > inn.timber)) inn = { town: t.id, name: t.name, perHead: Number(ph.toFixed(2)), timber: Math.round(v.stock.timber) };
  }
  return { out, in: inn };
}

/** A trader loads a boat for another region. The food leaves this shore now; what comes back arrives with `settleTrade`. */
export function sendTrade(rs: RegionSession, townId: string, to: Abroad, self: { region: string; regionName: string }): SeaTradePacket | undefined {
  const a = rs.region.towns.find((t) => t.id === townId);
  if (!a) return undefined;
  const A = rs.world(a.id);
  const port = rs.port;
  const adults = adultsOf(A);
  const trader = [...adults].sort((x, y) => (A.agents[y]!.role === "keeper" ? 1 : 0) - (A.agents[x]!.role === "keeper" ? 1 : 0) || A.minds[y]!.traits.extraversion - A.minds[x]!.traits.extraversion || x.localeCompare(y))[0];
  if (!trader || A.village!.store.food < 10) return undefined;
  const T = A.minds[trader]!;
  // A sea crossing wants a bigger load than a walk along the shore; keel boats carry more still.
  const food = Number(Math.min(A.village!.store.food * 0.15, 40 * (1 + craftBonus(A, "boats"))).toFixed(1));
  const short = port.rand() < (1 - T.traits.conscientiousness) * (1 - T.traits.agreeableness) * 0.9;
  const delivered = Number((short ? food * 0.7 : food).toFixed(1));
  A.village!.store.food = Number((A.village!.store.food - food).toFixed(1));
  const told = [...T.episodes].filter((e) => !ROUTINE.test(e.id) && charge(e) > 0.2).sort((x, y) => charge(y) - charge(x) || x.id.localeCompare(y.id))[0];
  // The remembered copies the story needs on the far shore: the trader, and everyone its telling goes back through.
  const carried = { order: [] as AgentId[], minds: {} as Record<AgentId, MindState> };
  if (told) carryLineage(A.minds, carried as unknown as WorldState, [{ agent: trader, ep: told }], true);
  else carried.minds[trader] = stub(T);
  noteAbroad(rs, to);
  const from: Abroad = { ...self, town: a.id, townName: a.name };
  feed(A, port.sink(a.id), { kind: "event", place: "harbour", agents: [trader], title: `${T.name} sails for ${to.townName}`, text: `${food} days' food goes aboard for ${to.townName}, across the water in ${to.regionName}.${short ? ` ${T.name} means to keep some of it back.` : ""}` });
  return {
    kind: "trade",
    tick: A.tick,
    from,
    to,
    trader: { id: trader, name: T.name, conscientiousness: T.traits.conscientiousness, agreeableness: T.traits.agreeableness },
    food,
    delivered,
    short,
    told: told && structuredClone(told),
    story: told && thirdPerson(render(told), T.name, T.pronouns),
    minds: carried.minds,
    crafts: structuredClone(A.village!.knowledge?.known[trader] ?? []),
  };
}

/** Who someone was, without their working mind: what a far town keeps of a visitor. */
function stub(m: MindState): MindState {
  return structuredClone({ ...m, episodes: [], beliefs: [], schemas: [], goals: [], habits: [], expressions: [], others: {} }) as MindState;
}

/** Set remembered copies down in a town, adding to whatever it already remembers of the same people. */
function remember(w: WorldState, minds: Record<AgentId, MindState>): void {
  for (const [id, m] of Object.entries(minds)) {
    if (w.order.includes(id)) continue;
    const have = w.minds[id];
    if (!have) {
      w.minds[id] = structuredClone(m);
      continue;
    }
    for (const e of m.episodes) if (!have.episodes.some((x) => x.id === e.id)) have.episodes.push(structuredClone(e));
  }
}

/** The boat lands: food for timber, a story at the fire, perhaps a craft shown, and a short load noticed or not. */
export async function receiveTrade(rs: RegionSession, p: SeaTradePacket): Promise<SeaTradeReceipt | undefined> {
  const b = rs.region.towns.find((t) => t.id === p.to.town);
  if (!b) return undefined;
  const B = rs.world(b.id);
  const port = rs.port;
  noteAbroad(rs, p.from);
  const sink = port.sink(b.id);
  const fac = port.faculties(b.id);
  const timber = Math.floor(Math.min(B.village!.stock.timber * 0.3, p.food * 1.5));
  B.village!.store.food = Number((B.village!.store.food + p.delivered).toFixed(1));
  B.village!.stock.timber -= timber;
  const noticed = p.short && port.rand() < 0.75;
  remember(B, p.minds);
  const listeners = B.order.filter((x) => !isChild(B, x) || port.rand() < 0.5).slice(0, 12);
  if (p.told && p.story) {
    for (const id of listeners) {
      const m = B.minds[id]!;
      const percept: Percept = {
        id: nextId(m, "pc"),
        tick: m.tick,
        kind: "speech",
        rawText: `${p.trader.name}, a trader from ${p.from.townName} across the water, at the fire: "${p.story}"`,
        actor: p.trader.id,
        addressedToSelf: false,
        about: p.told.about.filter((x) => x !== id),
        topics: [...p.told.topics, "stories", "trade", "sea", p.from.town],
        features: { outcomeForSelf: 0, agency: "other", intentional: 0.3, normViolation: 0, prospective: false, intensity: 0.3 + Math.abs(p.told.valence) * 0.3 },
        claims: [],
        details: [],
        gist: p.story,
      };
      const tr = await runPercept(m, percept, fac);
      hearStory(B, p.trader.id, p.told, id, tr, isChild(B, id) ? 0.2 : 0);
      record(B, sink, id, tr);
    }
  }
  feed(B, sink, { kind: "event", place: "harbour", agents: listeners.slice(0, 8), title: `${p.trader.name} comes over the sea from ${p.from.townName} to trade`, text: `${p.delivered} days' food for ${timber} timber.${p.story ? ` At the fire, ${p.story.replace(/\.$/, "")}.` : ""}` });
  // A trader can show someone a craft this town doesn't know.
  let taught: string | undefined;
  const have = new Set(townCrafts(B));
  const teach = p.crafts.find((k) => !have.has(k.craft));
  if (teach && listeners.length && port.rand() < 0.3) {
    const learner = [...listeners].filter((x) => !isChild(B, x)).sort((x, y) => B.minds[y]!.traits.openness - B.minds[x]!.traits.openness || x.localeCompare(y))[0];
    if (learner && !knows(B, learner, teach.craft)) {
      learn(B, learner, { craft: teach.craft, tick: B.tick, how: "brought", from: p.trader.id, town: p.from.town });
      const C = craft(teach.craft);
      const why: Why[] = [
        { agent: p.trader.id, town: p.from.town, text: `${p.trader.name} of ${p.from.townName} (${p.from.regionName}) knew ${C.name}.` },
        { agent: learner, text: `${personName(B, learner)} was the most curious at the fire (openness ${B.minds[learner]!.traits.openness.toFixed(2)}).` },
      ];
      feed(B, sink, { kind: "event", agents: [p.trader.id, learner], title: `${p.trader.name} of ${p.from.townName} shows ${personName(B, learner)} ${C.name}`, text: `${b.name} had nobody who knew it. It came over the sea from ${p.from.regionName}. Now ${C.does}.`, chronicle: { kind: "craft", why } });
      taught = teach.craft;
    }
  }
  if (noticed) await port.grievance(b, { id: p.from.town, name: p.from.townName }, p.trader.id, `The food ${p.trader.name} brought over the sea from ${p.from.townName} came short: they kept some back.`);
  port.harvest();
  return { kind: "trade", from: p.from, to: p.to, trader: p.trader.id, traderName: p.trader.name, food: p.food, timber, short: p.short, noticed, taught };
}

/** The boat comes home with what the load fetched. */
export function settleTrade(rs: RegionSession, r: SeaTradeReceipt): void {
  const a = rs.region.towns.find((t) => t.id === r.from.town);
  if (!a) return;
  const A = rs.world(a.id);
  A.village!.stock.timber += r.timber;
  const yr = yearOf(A);
  const route = ((rs.region.routes ??= {})[`${a.id}>${r.to.town}`] ??= {});
  route[yr] = (route[yr] ?? 0) + 1;
  feed(A, rs.port.sink(a.id), { kind: "event", place: "harbour", agents: A.order.includes(r.trader) ? [r.trader] : [], title: `${r.traderName} is back from ${r.to.townName}`, text: `${r.food} days' food out, ${r.timber} timber back.${r.short ? ` ${r.traderName} kept some of the food back.` : ""}` });
  rs.port.harvest();
}

/** A town that has wronged a town abroad may send a gift to mend it; a leader who likes peace is likelier to. */
export function sendGift(rs: RegionSession, to: Abroad, self: { region: string; regionName: string }): SeaGiftPacket | undefined {
  const port = rs.port;
  // The richest town sends it, in the name of whoever leads there.
  const g = [...rs.region.towns].sort((x, y) => rs.world(y.id).village!.store.food - rs.world(x.id).village!.store.food || x.id.localeCompare(y.id))[0];
  if (!g) return undefined;
  const G = rs.world(g.id);
  const lead = G.village!.civic?.leader;
  const kind = lead && G.order.includes(lead) ? G.minds[lead]!.traits.agreeableness : 0.4;
  if (port.rand() > kind * 0.6 || G.village!.store.food < 30) return undefined;
  const food = Number(Math.min(G.village!.store.food * 0.1, 20).toFixed(1));
  G.village!.store.food = Number((G.village!.store.food - food).toFixed(1));
  const who = lead && G.order.includes(lead) ? `${G.minds[lead]!.name} of ${g.name}` : `The people of ${g.name}`;
  noteAbroad(rs, to);
  feed(G, port.sink(g.id), { kind: "event", place: "harbour", agents: lead && G.order.includes(lead) ? [lead] : [], title: `${g.name} sends a peace gift over the sea`, text: `${food} days' food for ${to.townName}, in ${to.regionName}.` });
  return { kind: "gift", tick: G.tick, from: { ...self, town: g.id, townName: g.name }, to, food, who };
}

export async function receiveGift(rs: RegionSession, p: SeaGiftPacket): Promise<boolean> {
  const b = rs.region.towns.find((t) => t.id === p.to.town) ?? rs.region.towns[0];
  if (!b) return false;
  const port = rs.port;
  noteAbroad(rs, p.from);
  // Everyone who holds it against that region hears of the gift, wherever they live here.
  const text = `${p.who} sent ${p.food} days' food over the sea from ${p.from.townName} as a peace gift.`;
  const abroad = rs.region.abroad ?? {};
  const theirs = new Set(Object.entries(abroad).filter(([, x]) => x.region === p.from.region).map(([id]) => `town:${id}`));
  for (const t of rs.region.towns) {
    const V = rs.world(t.id);
    const holders = adultsOf(V).filter((id) => V.minds[id]!.beliefs.some((x) => theirs.has(x.about) && x.valence < 0));
    if (t.id !== b.id && !holders.length) continue;
    if (t.id === b.id) V.village!.store.food = Number((V.village!.store.food + p.food).toFixed(1));
    const sink = port.sink(t.id);
    const fac = port.faculties(t.id);
    const evId = nextId(V, "ev_gift");
    for (const id of t.id === b.id ? adultsOf(V) : holders) {
      const m = V.minds[id]!;
      const tr = await runPercept(m, eventPercept(m, "world", "other", 0.3, 0.5, ["trade", "gift", "food", "sea", p.from.town, evId], text, text, evId), fac);
      record(V, sink, id, tr);
      // The gift answers for every town of theirs this person held something against.
      const against = m.beliefs.filter((x) => theirs.has(x.about) && x.valence < 0).map((x) => x.about.slice(5));
      for (const town of new Set([p.from.town, ...against])) port.believeOf(m, { id: town, name: abroad[town]?.name ?? p.from.townName }, 0.3, 0.4 + 0.3 * m.traits.agreeableness, tr.encoded ? [tr.encoded] : [], V.tick, `Folk from ${abroad[town]?.name ?? p.from.townName} make things right`);
    }
    feed(V, sink, { kind: "event", agents: [], title: `A peace gift from ${p.from.townName}, over the sea`, text });
  }
  port.touch();
  port.harvest();
  return true;
}

/**
 * How this region regards each region it has dealt with (-1 to 1): for each town here, its adults'
 * beliefs about that region's towns, averaged; the region's regard is that of its most aggrieved town.
 */
export function regardAbroad(rs: RegionSession): Record<string, number> {
  const abroad = rs.region.abroad;
  if (!abroad || !Object.keys(abroad).length) return {};
  const out: Record<string, number> = {};
  for (const t of rs.region.towns) {
    const w = rs.world(t.id);
    const adults = adultsOf(w);
    if (!adults.length) continue;
    const sum: Record<string, number> = {};
    for (const id of adults)
      for (const b of w.minds[id]!.beliefs) {
        if (!b.about.startsWith("town:")) continue;
        const where = abroad[b.about.slice(5)];
        if (where) sum[where.region] = (sum[where.region] ?? 0) + b.valence * b.confidence;
      }
    for (const [region, s] of Object.entries(sum)) {
      const v = Number(clamp(s / adults.length, -1, 1).toFixed(2));
      out[region] = Math.min(out[region] ?? 1, v);
    }
  }
  return out;
}
