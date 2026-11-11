// Trades and the market. In the first years every household lives off its own hands and the common
// store. Once someone knows how to fire clay or work a loom, a town that is big enough can carry a
// person who does only that (the division of labour is limited by the extent of the market; Smith
// 1776), and then there has to be a way for the potter to eat.
//
// So each season there is a market day at the landing. Households bring what they have over and
// look for what they are short of, and each deal has to be paid for somehow:
//
// - with amber, if the seller believes amber will buy something later (money.ts). Every sale for
//   amber makes the next person likelier to take it, so a market is where money takes hold;
// - by barter, which only works when each has something the other wants right now (the double
//   coincidence of wants; Jevons 1875). Many deals fall through for the lack of it;
// - on credit, when the seller trusts the buyer to pay later: a debt like any other in town;
// - out of the common store: a household that fills the store can pay a maker from its claim on
//   it. This is redistribution, the way a town without money keeps its potters (Polanyi 1957;
//   Sahlins 1972), and it is why specialists can exist before amber is money;
// - or not at all.
//
// Prices move with what was wanted and what was offered. When food is short, a seller chooses,
// through their own mind, whether to sell at the old price, ask what it will now fetch, or give.
// People remember a seller who raised the price on them in a hungry season: it reads as unfair
// even when it is only the market (Kahneman, Knetsch & Thaler 1986), and those memories feed the
// town's factions and its laws.
//
// What a household holds changes its days: pots keep its food from rotting, cloth keeps its winter
// from wearing it down, tools make its hours go further, remedies help its sick.

import { clamp } from "../../memory.js";
import { runPercept } from "../../mind.js";
import type { ActionOption, Faculties } from "../../ports.js";
import { nextId } from "../../rng.js";
import type { AgentId, Tick, Traits } from "../../types.js";
import { craft, craftBonus, craftLineage, knows, townCrafts } from "../knowledge.js";
import { ageOf, isChild, normHeld, yearOf } from "../life.js";
import { acceptedShare, moneyOf, PRICE, type Money } from "../money.js";
import { routineFor } from "../people.js";
import { JOBS, RATION, type Household, type Resource } from "../village.js";
import { eventPercept, feed, luck, personName, record, type Sink, type Why, type WorldState } from "../world.js";
import { adultsOf, cap, choose, civOf, DAY, headOf, homesOf, hhOf, list, note, plural, round } from "./base.js";
import { wrong } from "./factions.js";
import { lawInForce } from "./polity.js";

export type Good = "pots" | "cloth" | "tools" | "remedies";
export const GOOD_IDS: Good[] = ["pots", "cloth", "tools", "remedies"];

export const GOODS: Record<Good, { name: string; one: string; price: number; keeps: number; does: string }> = {
  pots: { name: "pots", one: "a pot", price: 2, keeps: 0.9, does: "a household with pots loses half as much food to rot" },
  cloth: { name: "cloth", one: "a length of cloth", price: 3, keeps: 0.88, does: "a household in cloth gets through winter without being worn down" },
  tools: { name: "iron tools", one: "an iron tool", price: 5, keeps: 0.9, does: "a worker with iron tools gets a fifth more done" },
  remedies: { name: "remedies", one: "a remedy", price: 2, keeps: 0.75, does: "a sick person with a remedy is likelier to live" },
};

export interface Profession {
  /** The craft someone must know to practise it. */
  tech: string;
  makes?: Good;
  /** Units a season at full strength. */
  rate: number;
  /** What a unit takes from the town's piles. */
  input?: Partial<Record<Resource, number>>;
  activity: string;
  does: string;
  /** How well it suits a temperament. */
  fit: (t: Traits) => number;
  /** Adults a town needs for each one it can carry. */
  per: number;
}

export const PROFESSIONS: Record<string, Profession> = {
  potter: { tech: "pottery", makes: "pots", rate: 7, input: { timber: 0.5 }, activity: "throwing and firing pots", does: "makes pots", fit: (t) => 0.3 + 0.4 * t.conscientiousness + 0.2 * t.openness, per: 14 },
  weaver: { tech: "weaving", makes: "cloth", rate: 6, input: { reeds: 0.8 }, activity: "working the loom", does: "weaves cloth", fit: (t) => 0.3 + 0.4 * t.conscientiousness + 0.2 * t.agreeableness, per: 14 },
  smith: { tech: "smelting", makes: "tools", rate: 4, input: { timber: 1.5, stone: 0.5 }, activity: "working iron at the forge", does: "makes iron tools", fit: (t) => 0.3 + 0.3 * t.conscientiousness + 0.2 * (1 - t.neuroticism), per: 18 },
  healer: { tech: "medicine", makes: "remedies", rate: 5, activity: "gathering simples and seeing to the sick", does: "nurses the sick and makes remedies", fit: (t) => 0.2 + 0.5 * t.agreeableness + 0.2 * t.openness, per: 20 },
  merchant: { tech: "tally", rate: 0, activity: "at the landing, buying and selling", does: "carries goods between towns", fit: (t) => 0.2 + 0.4 * t.extraversion + 0.2 * t.openness + 0.2 * (1 - t.agreeableness), per: 24 },
  scribe: { tech: "writing", rate: 0, activity: "writing at the store", does: "keeps the town's records", fit: (t) => 0.2 + 0.5 * t.conscientiousness + 0.2 * t.openness - 0.1 * t.extraversion, per: 30 },
};
export const isSpecialist = (role: string) => role in PROFESSIONS;

export interface MarketDay {
  tick: Tick;
  year: number;
  season: string;
  /** How each deal was settled. `store` is food paid out of the household's claim on the common store. */
  deals: { amber: number; barter: number; store: number; credit: number; gift: number; failed: number };
  /** Units that changed hands, by good (food in days' food). */
  volume: Record<string, number>;
  price: Record<string, number>;
  /** Food was short, and how many sellers asked more for it. */
  shortage?: { want: number; offer: number; raised: number; held: number; gave: number };
  /** How unevenly the town's wealth is spread, 0 (even) to 1. */
  gini: number;
  specialists: number;
}

export interface Gouge {
  tick: Tick;
  seller: AgentId;
  buyers: AgentId[];
  price: number;
  ref: number;
  trace?: string;
}

export interface Economy {
  /** What each household holds, by good. */
  goods: Record<string, Record<Good, number>>;
  /** Prices in days' food at the customary rate; `food` is how dear food itself is (1 is customary). */
  price: Record<Good | "food", number>;
  /** The price people remember as the fair one. */
  ref: Record<Good | "food", number>;
  markets: MarketDay[];
  /** Times someone asked more for food in a shortage, newest last. */
  gouges: Gouge[];
  /** The trade each specialist left, in case the town can no longer carry them. */
  was: Record<AgentId, string>;
  /** Lenders whose loans a clean slate wiped out, and when: they do not give credit again for some years. */
  wiped: Record<AgentId, Tick>;
  /** Markets in a row at which a good went unsold (below zero) or ran out with buyers waiting (above). */
  trend?: Partial<Record<Good, number>>;
  /** How many more (or fewer) of a trade the town carries than its size alone would say, from how its goods have sold. */
  room?: Record<string, number>;
  first?: Tick;
}

export function newEconomy(): Economy {
  return { goods: {}, price: { food: 1, pots: GOODS.pots.price, cloth: GOODS.cloth.price, tools: GOODS.tools.price, remedies: GOODS.remedies.price }, ref: { food: 1, pots: GOODS.pots.price, cloth: GOODS.cloth.price, tools: GOODS.tools.price, remedies: GOODS.remedies.price }, markets: [], gouges: [], was: {}, wiped: {} };
}

const economyOf = (w: WorldState): Economy => civOf(w)!.economy;
const holdings = (E: Economy, hh: string): Record<Good, number> => (E.goods[hh] ??= { pots: 0, cloth: 0, tools: 0, remedies: 0 });
const needOf = (w: WorldState, hh: Household) => RATION * hh.members.reduce((n, m) => n + (w.order.includes(m) ? (isChild(w, m) ? 0.6 : 1) : 0), 0);
const isMoney = (M: Money) => !!M.established && !(M.lost && M.lost > M.established);
const workersOf = (w: WorldState, hh: Household) => hh.members.filter((x) => w.order.includes(x) && ["food", "timber", "stone", "reeds", "build"].includes(JOBS[w.agents[x]!.role]?.makes ?? ""));

// ---------------------------------------------------------------- what goods do

/** A worker whose household has iron tools gets more done. */
export function toolBonus(w: WorldState, id: AgentId): number {
  const c = civOf(w);
  if (!c) return 0;
  const hh = hhOf(w, id);
  if (!hh) return 0;
  const have = c.economy.goods[hh.id]?.tools ?? 0;
  if (have < 0.5) return 0;
  return craftBonus(w, "tools") > 0 || have > 0 ? 0.2 * Math.min(1, have / Math.max(1, workersOf(w, hh).length)) : 0;
}

/** The share of its usual rot a household still loses, given its pots. */
export function spoilFactor(w: WorldState, hh: Household): number {
  const c = civOf(w);
  if (!c) return 1;
  const have = c.economy.goods[hh.id]?.pots ?? 0;
  const want = Math.max(1, Math.ceil(hh.members.length / 2));
  return 1 - 0.5 * Math.min(1, have / want);
}

/** How well clothed a household is, 0 to 1. */
export function warmth(w: WorldState, hh: Household): number {
  const c = civOf(w);
  if (!c) return 0;
  return Math.min(1, (c.economy.goods[hh.id]?.cloth ?? 0) / Math.max(1, hh.members.length));
}

/** Use up one remedy from a sick person's household, if it has one. */
export function takeRemedy(w: WorldState, id: AgentId): boolean {
  const c = civOf(w);
  const hh = hhOf(w, id);
  if (!c || !hh) return false;
  const g = holdings(c.economy, hh.id);
  if (g.remedies < 1) return false;
  g.remedies = round(g.remedies - 1);
  return true;
}

// ---------------------------------------------------------------- taking up a trade

const count = (w: WorldState, role: string) => w.order.filter((x) => w.agents[x]!.role === role).length;

/** How many of a trade this town can carry. */
export function capacity(w: WorldState, role: string): number {
  const P = PROFESSIONS[role];
  if (!P || !townCrafts(w).includes(P.tech)) return 0;
  const adults = adultsOf(w).length;
  if (role === "merchant") {
    // A merchant needs somewhere to sell and something to sell for: a market that has met, and boats.
    const E = civOf(w)?.economy;
    if (!E || E.markets.length < 4 || craftBonus(w, "boats") <= 0) return 0;
  }
  if (adults < P.per * 0.7) return 0;
  // Its size says how many a town could carry; whether their goods sell says how many it does.
  const base = Math.max(1, Math.floor(adults / P.per));
  return Math.max(1, Math.min(base + 2, base + (civOf(w)?.economy.room?.[role] ?? 0)));
}

function setRole(w: WorldState, id: AgentId, role: string): void {
  const a = w.agents[id]!;
  a.role = role;
  const P = PROFESSIONS[role];
  a.routine = routineFor(role, a.home).map((e) => (e.place === "@work" && P ? { ...e, activity: P.activity } : e));
}

/** Someone who knows a trade's craft sets up in it, if the town can carry another. */
export function takeUp(w: WorldState, id: AgentId, role: string, sink: Sink, because?: string): boolean {
  const c = civOf(w);
  const P = PROFESSIONS[role];
  if (!c || !P || !w.order.includes(id) || isChild(w, id)) return false;
  const a = w.agents[id]!;
  if (a.role === role || !knows(w, id, P.tech) || count(w, role) >= capacity(w, role)) return false;
  // The town still needs its cook and its keeper, and enough hands getting food.
  if (["cook", "keeper"].includes(a.role) && count(w, a.role) <= 1) return false;
  const workers = adultsOf(w).length || 1;
  const food = w.order.filter((x) => ["fisher", "farmer", "forager"].includes(w.agents[x]!.role)).length;
  if (["fisher", "farmer", "forager"].includes(a.role) && (food - 1) / workers < 0.38) return false;
  if (w.village!.civic?.leader === id && role === "merchant") return false;
  c.economy.was[id] = a.role;
  const was = a.role;
  setRole(w, id, role);
  // Whoever lives by selling has to take what buyers have to give.
  const M = moneyOf(w);
  M.accept[id] = round(clamp((M.accept[id] ?? 0.2) + 0.15), 3);
  const line = craftLineage(w, id, P.tech);
  const from = line[1];
  const why: Why[] = [{ agent: id, text: `${personName(w, id)} knows ${craft(P.tech).name}${from ? `, shown by ${from.name}` : line[0]?.how === "worked out" ? ", having worked it out" : line[0]?.how === "read" ? ", learned from the town's records" : ""}.` }, { text: `${w.name} has ${adultsOf(w).length} adults: enough to keep ${count(w, role) === 1 ? `a ${role}` : `${count(w, role)} ${role}s`} fed for what they make.` }];
  if (because) why.push({ text: `${cap(because)}.` });
  feed(w, sink, { kind: "event", place: "workshop", agents: [id], title: `${personName(w, id)} sets up as a ${role}`, text: `${personName(w, id)} leaves off being a ${was} and ${P.does}. ${why[1]!.text}`, chronicle: count(w, role) === 1 ? { kind: "trade", why } : undefined });
  note(w, { kind: "trade", title: `${personName(w, id)} sets up as a ${role}`, agents: [id], why });
  return true;
}

/** At twelve: a child who was taught a trade's craft follows it, if the town can carry another. */
export function civTrade(w: WorldState, id: AgentId): string | undefined {
  if (!civOf(w)) return undefined;
  const t = w.minds[id]!.traits;
  return Object.entries(PROFESSIONS)
    .filter(([role, P]) => role !== "merchant" && knows(w, id, P.tech) && count(w, role) < capacity(w, role))
    .sort((a, b) => b[1].fit(t) - a[1].fit(t) || a[0].localeCompare(b[0]))[0]?.[0];
}

/** After a child takes a trade by the hook above: give them its routine. */
export function settleTrade(w: WorldState, id: AgentId): void {
  if (PROFESSIONS[w.agents[id]!.role]) setRole(w, id, w.agents[id]!.role);
}

/** Each spring: empty places in a trade are taken by whoever knows it and suits it best; a town that shrank lets its specialists go. */
export function tradesTurn(w: WorldState, sink: Sink): void {
  const c = civOf(w);
  if (!c) return;
  const E = c.economy;
  for (const [role, P] of Object.entries(PROFESSIONS)) {
    // A year of pots nobody bought is one potter too many; a year of buyers going without is room
    // for one more (the division of labour is limited by the extent of the market).
    let glut = false;
    const trend = P.makes ? (E.trend?.[P.makes] ?? 0) : 0;
    if (P.makes && Math.abs(trend) >= 4) {
      const room = (E.room ??= {});
      room[role] = Math.max(-12, Math.min(2, (room[role] ?? 0) + (trend < 0 ? -1 : 1)));
      (E.trend ??= {})[P.makes] = 0;
      glut = trend < 0;
    }
    const cap_ = capacity(w, role);
    const have = w.order.filter((x) => w.agents[x]!.role === role);
    if (have.length > cap_) {
      // The newest goes back to what they did before.
      const out = have.at(-1)!;
      const back = c.economy.was[out] && JOBS[c.economy.was[out]!] ? c.economy.was[out]! : "forager";
      setRole(w, out, back);
      delete c.economy.was[out];
      feed(w, sink, { kind: "event", agents: [out], title: `${personName(w, out)} gives up being a ${role}`, text: `${glut && P.makes ? `There were more ${GOODS[P.makes].name} than buyers at four markets running` : `${w.name} is too small now to keep a ${role} fed`}. ${personName(w, out)} goes back to being a ${back}.` });
      continue;
    }
    if (have.length >= cap_) continue;
    const cands = adultsOf(w)
      .filter((x) => ageOf(w, x) >= 14 && w.agents[x]!.role !== role && !isSpecialist(w.agents[x]!.role) && knows(w, x, P.tech))
      .sort((a, b) => P.fit(w.minds[b]!.traits) - P.fit(w.minds[a]!.traits) || a.localeCompare(b));
    for (const id of cands) if (takeUp(w, id, role, sink)) break;
  }
}

// ---------------------------------------------------------------- wealth

/** What a household is worth, in days' food at customary prices. */
export function wealthOf(w: WorldState, hh: Household): number {
  const c = civOf(w);
  const M = w.village!.money;
  const E = c?.economy;
  let v = hh.food + (hh.shelter === "house" ? 20 : 0);
  for (const id of hh.members) v += (M?.held[id] ?? 0) * PRICE;
  if (E) for (const g of GOOD_IDS) v += (E.goods[hh.id]?.[g] ?? 0) * GOODS[g].price;
  for (const d of M?.debts ?? []) {
    if (d.repaid) continue;
    if (hh.members.includes(d.creditor)) v += d.amount * 0.7;
    if (hh.members.includes(d.debtor)) v -= d.amount;
  }
  return v;
}

export function gini(xs: number[]): number {
  const v = xs.map((x) => Math.max(0, x)).sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((s, x) => s + x, 0);
  if (n < 2 || sum <= 0) return 0;
  let acc = 0;
  v.forEach((x, i) => (acc += (2 * (i + 1) - n - 1) * x));
  return round(acc / (n * sum));
}

export const townGini = (w: WorldState) => gini(homesOf(w).map((h) => wealthOf(w, h) / Math.max(1, h.members.length)));

// ---------------------------------------------------------------- market day

type Medium = "amber" | "barter" | "store" | "credit";

function purse(w: WorldState, M: Money, hh: Household): number {
  return hh.members.reduce((s, x) => s + (w.order.includes(x) ? (M.held[x] ?? 0) : 0), 0);
}

function moveAmber(w: WorldState, M: Money, from: Household, to: AgentId, n: number): void {
  let left = n;
  for (const x of [...from.members].sort((a, b) => (M.held[b] ?? 0) - (M.held[a] ?? 0) || a.localeCompare(b))) {
    if (left <= 0) break;
    if (!w.order.includes(x)) continue;
    const take = Math.min(left, M.held[x] ?? 0);
    M.held[x] = (M.held[x] ?? 0) - take;
    left -= take;
  }
  M.held[to] = (M.held[to] ?? 0) + (n - left);
}

const nudge = (M: Money, id: AgentId, d: number) => (M.accept[id] = round(clamp((M.accept[id] ?? 0.2) + d), 3));

/** What a household still wants of a good. */
function wantOf(w: WorldState, E: Economy, hh: Household, g: Good, sick = 0): number {
  const have = holdings(E, hh.id)[g];
  const living = hh.members.filter((x) => w.order.includes(x)).length;
  const target = g === "pots" ? Math.ceil(living / 2) : g === "cloth" ? living : g === "tools" ? workersOf(w, hh).length : 1 + sick;
  return Math.max(0, Math.round(target - have));
}

/**
 * Settle one deal worth `value` (days' food at customary prices) between two households, by
 * whatever they can agree on. `forFood` is true when food is the thing being bought.
 */
function pay(w: WorldState, E: Economy, M: Money, buyer: Household, seller: Household, value: number, forFood: boolean, key: string, drawn: Record<string, number> = {}): Medium | undefined {
  const v = w.village!;
  const bh = headOf(w, buyer);
  const sh = headOf(w, seller);
  if (!bh || !sh) return undefined;
  // Amber, if the seller thinks it will buy something later. Someone who lives by what they sell
  // cannot be as particular: unsold pots feed nobody.
  const byTrade = seller.members.some((x) => w.order.includes(x) && isSpecialist(w.agents[x]!.role));
  const takes = isMoney(M) || (M.accept[sh] ?? 0) > (byTrade && !forFood ? 0.3 : 0.5);
  const exact = value / PRICE;
  let pieces = Math.floor(exact) + (luck(w, "change", key) < exact - Math.floor(exact) ? 1 : 0);
  if (pieces === 0 && value >= 1.5) pieces = 1;
  const have = purse(w, M, buyer);
  // A piece of amber does not break. Something worth less than a piece goes on the tally between two
  // people who deal in amber anyway, and comes out even over a few markets (the problem of small change).
  if (takes && pieces === 0 && have >= 1) return "amber";
  if (takes && pieces > 0 && have >= pieces) {
    moveAmber(w, M, buyer, sh, pieces);
    nudge(M, sh, 0.04);
    nudge(M, bh, 0.02);
    return "amber";
  }
  // The buyer had amber and the seller would not take it: amber looks a little less like money.
  if (!takes && have >= pieces && pieces > 0) nudge(M, bh, -0.01);
  // The seller would have taken amber and the buyer had none: both see what it is good for.
  if (takes && have < pieces) nudge(M, bh, 0.015);
  // Barter: food for goods, when the buyer has food over and the seller could use it.
  const pf = E.price.food;
  if (!forFood) {
    const food = value / pf;
    // With a common store to fall back on, a household can spend its own food down to a day and a half's worth.
    const floor = needOf(w, buyer) * (v.store.food / Math.max(1, w.order.length) >= 2 ? 1.5 : 4);
    if (buyer.food - food >= floor && seller.food < needOf(w, seller) * 12) {
      buyer.food = round(buyer.food - food);
      seller.food = round(seller.food + food);
      return "barter";
    }
  }
  // Barter: something the buyer makes or has over, that the seller is short of.
  for (const g of GOOD_IDS) {
    const spare = Math.floor(holdings(E, buyer.id)[g] - (PROFESSIONS[w.agents[bh]!.role]?.makes === g ? wantTarget(w, buyer, g) : wantTarget(w, buyer, g) + 0.5));
    const qty = Math.max(1, Math.round(value / E.price[g]));
    if (spare >= qty && wantOf(w, E, seller, g) >= 1) {
      holdings(E, buyer.id)[g] = round(holdings(E, buyer.id)[g] - qty);
      holdings(E, seller.id)[g] = round(holdings(E, seller.id)[g] + qty);
      return "barter";
    }
  }
  // Credit: the seller trusts the buyer to pay by the turn of the season.
  const o = w.minds[sh]!.others[bh];
  const credit = () => {
    M.debts.push({ id: nextId(w, "debt"), creditor: sh, debtor: bh, amount: round(value / pf, 1), tick: w.tick, due: w.tick + v.seasonDays * DAY, trace: "" });
    M.deals.lend = (M.deals.lend ?? 0) + 1;
    return "credit" as const;
  };
  const owing = M.debts.filter((d) => !d.repaid && d.debtor === bh);
  // Someone whose loans were wiped out by a clean slate does not lend again for some years.
  const burnt = E.wiped[sh] !== undefined && w.tick - E.wiped[sh]! < 4 * v.seasonDays * 4 * DAY;
  const good = !!o && !burnt && !owing.some((d) => d.overdue) && owing.length < 2 && value >= 1;
  if (good && o!.trust.benevolence >= 0.56 && o!.liking >= 0.54) return credit();
  // Out of the store: a household that grows or catches food has a claim on the common store it
  // fills, and can pay a maker out of that claim, down to four days a head left for the lean
  // months. This is how a town with a common store keeps its potters before it has money
  // (redistribution: Polanyi 1957; Sahlins 1972).
  if (!forFood && seller.food < needOf(w, seller) * 12 && buyer.members.some((x) => w.order.includes(x) && !isChild(w, x) && JOBS[w.agents[x]!.role]?.makes === "food")) {
    const food = value / pf;
    const living = buyer.members.filter((x) => w.order.includes(x)).length;
    const claim = (v.store.food / Math.max(1, w.order.length) - 4) * living - (drawn[buyer.id] ?? 0);
    if (claim >= food) {
      drawn[buyer.id] = (drawn[buyer.id] ?? 0) + food;
      v.store.food = round(v.store.food - food, 1);
      seller.food = round(seller.food + food);
      return "store";
    }
  }
  // Credit on a thinner footing, when there is nothing else: the seller knows the buyer and has no cause to doubt them.
  if (good && o!.trust.benevolence >= 0.5 && o!.liking >= 0.5 && luck(w, "tick", key) < 0.5) return credit();
  // No sale. A seller who turned amber down and was left holding the goods thinks again about amber.
  if (!takes && pieces > 0 && have >= pieces) nudge(M, sh, forFood ? 0.02 : 0.05);
  return undefined;
}

function wantTarget(w: WorldState, hh: Household, g: Good): number {
  const living = hh.members.filter((x) => w.order.includes(x)).length;
  return g === "pots" ? Math.ceil(living / 2) : g === "cloth" ? living : g === "tools" ? workersOf(w, hh).length : 1;
}

const PRICE_OPTIONS = (w: WorldState, seller: AgentId, hh: Household, going: number, ref: number, law: boolean): ActionOption[] => {
  const m = w.minds[seller]!;
  const lean = hh.food < needOf(w, hh) * 14;
  const out: ActionOption[] = [
    { id: "hold", label: "Sell at the old price", verb: "sell at the old price", description: `Food is short and people would pay more. Sell what the household can spare at what it has always cost.`, prosocial: 0.5, assertive: 0, avoidant: 0, disclosure: 0.1, comply: true, act: "sells at the old price", pull: [{ name: "what the town expects of a neighbour", value: 0.25 * normHeld(w, seller) }, { name: "it would not sit right", value: 0.25 * (m.traits.honesty - 0.5) }] },
  ];
  if (!law)
    out.push({
      id: "raise",
      label: "Ask what it will fetch",
      verb: "ask more for food",
      description: `Ask ${Math.round((going / ref - 1) * 100)}% more than the old price. People are short and will pay it.`,
      prosocial: -0.4,
      assertive: 0.4,
      avoidant: 0,
      disclosure: 0,
      act: "asks more for food",
      pull: [
        { name: "something put by for the household", value: 0.2 + (lean ? 0.2 : 0) },
        // Core beliefs about scarcity do their work here: "when food runs short, people look after their own".
        ...m.schemas.filter((s) => s.blameBias + s.threatBias > 0 && s.triggers.some((t) => ["food", "hunger", "store", "money"].includes(t))).map((s) => ({ name: `the core belief “${s.text}”`, value: 0.3 * s.strength, ref: s.id })),
      ],
    });
  else out.push({ id: "withhold", label: "Keep it at home", verb: "keep the food at home", description: "The law says the old price. Then keep it for the household and sell nothing.", prosocial: -0.3, assertive: 0.2, avoidant: 0.5, disclosure: 0, act: "keeps the food at home rather than sell at the law's price", pull: [{ name: "being told what to ask", value: 0.25 * m.needs.autonomy - 0.1 }, ...(lean ? [{ name: "the household's own winter", value: 0.15 }] : [])] });
  out.push({ id: "give", label: "Give to those who can't pay", verb: "give food to those who can't pay", description: "Let those with nothing to pay with have some anyway.", prosocial: 0.95, assertive: 0, avoidant: 0, disclosure: 0.2, comply: true, act: "gives food to those who can't pay", pull: [...m.schemas.filter((s) => s.blameBias + s.threatBias < 0 && s.triggers.some((t) => ["food", "help", "store"].includes(t))).map((s) => ({ name: `the core belief “${s.text}”`, value: 0.3 * s.strength, ref: s.id })), ...(lean ? [{ name: "not much to spare", value: -0.3 }] : [])] });
  return out;
};

/** Amber outlasts whoever held it: it goes to a partner or the eldest child still in town, or into the ground with them. */
function inherit(w: WorldState, M: Money): void {
  const life = w.village!.life;
  for (const [id, n] of Object.entries(M.held)) {
    if (w.order.includes(id)) continue;
    delete M.held[id];
    if (!n || life[id]?.died === undefined) continue;
    const heir = w.order.filter((x) => life[x]?.parents.includes(id)).sort((a, b) => ageOf(w, b) - ageOf(w, a) || a.localeCompare(b))[0];
    if (heir) M.held[heir] = (M.held[heir] ?? 0) + n;
  }
}

/** Specialists make what they make, from the town's piles. */
function produce(w: WorldState, E: Economy): void {
  const v = w.village!;
  for (const id of w.order) {
    const P = PROFESSIONS[w.agents[id]!.role];
    if (!P?.makes || isChild(w, id)) continue;
    const hh = hhOf(w, id);
    if (!hh) continue;
    let q = P.rate * (0.5 + 0.5 * w.minds[id]!.needs.energy) * (1 + toolBonus(w, id));
    for (const [k, per] of Object.entries(P.input ?? {}) as [Resource, number][]) q = Math.min(q, v.stock[k] / per);
    q = Math.max(0, Math.floor(q));
    const g = holdings(E, hh.id);
    // Nobody keeps making what is already piled up unsold.
    q = Math.min(q, Math.max(0, Math.round(P.rate * 2.5 - g[P.makes])));
    for (const [k, per] of Object.entries(P.input ?? {}) as [Resource, number][]) v.stock[k] = round(v.stock[k] - q * per);
    g[P.makes] = round(g[P.makes] + q);
  }
}

/**
 * Market day. Returns what happened, or undefined when the town is too small for one or is shut.
 */
export async function marketDay(w: WorldState, faculties: Faculties, sink: Sink, live: boolean): Promise<MarketDay | undefined> {
  const c = civOf(w);
  if (!c) return undefined;
  const v = w.village!;
  const E = c.economy;
  const M = moneyOf(w);
  const homes = homesOf(w).sort((a, b) => a.id.localeCompare(b.id));
  inherit(w, M);
  // Goods wear out, break and go stale whether or not there is a market.
  for (const h of homes) for (const g of GOOD_IDS) holdings(E, h.id)[g] = round(holdings(E, h.id)[g] * GOODS[g].keeps);
  for (const id of Object.keys(E.goods)) if (!v.households[id]) delete E.goods[id];
  produce(w, E);
  if (adultsOf(w).length < 10) return undefined;
  if (c.health.closed) {
    feed(w, sink, { kind: "event", place: "harbour", agents: [], title: `No market in ${w.name} this ${v.season}`, text: "The landing is shut for the sickness." });
    return undefined;
  }
  const day: MarketDay = { tick: w.tick, year: yearOf(w), season: v.season, deals: { amber: 0, barter: 0, store: 0, credit: 0, gift: 0, failed: 0 }, volume: {}, price: {}, gini: 0, specialists: w.order.filter((x) => isSpecialist(w.agents[x]!.role)).length };
  const liking = (a: Household, b: Household) => {
    const x = headOf(w, a);
    const y = headOf(w, b);
    return (x && y && w.minds[x]!.others[y]?.liking) || 0.5;
  };
  const sickIn = (h: Household) => h.members.filter((x) => c.health.sick[x]).length;
  const tally = (m: Medium | undefined) => (m ? day.deals[m]++ : day.deals.failed++);
  const drawn: Record<string, number> = {};

  // Made goods first, so those who live by making them have something to buy food with.
  for (const g of GOOD_IDS) {
    let wanted = 0;
    let offered = 0;
    const spare = (h: Household) => Math.floor(holdings(E, h.id)[g] - wantTarget(w, h, g) - (g === "remedies" ? sickIn(h) : 0));
    const sellers = homes.filter((h) => spare(h) >= 1);
    for (const s of sellers) offered += spare(s);
    const buyers = homes.map((h) => ({ h, want: wantOf(w, E, h, g, sickIn(h)) })).filter((x) => x.want >= 1);
    for (const b of buyers) wanted += b.want;
    if (offered > 0) {
      for (const { h: buyer, want } of buyers.sort((a, b) => b.want - a.want || a.h.id.localeCompare(b.h.id))) {
        let left = want;
        let tried = false;
        for (const seller of [...sellers].sort((a, b) => liking(buyer, b) - liking(buyer, a) || a.id.localeCompare(b.id)).slice(0, 6)) {
          if (left <= 0) break;
          if (seller === buyer) continue;
          // Buy what can be paid for: all of it if possible, else one.
          for (const qty of [...new Set([Math.min(left, spare(seller)), 1])]) {
            if (qty < 1 || spare(seller) < qty) continue;
            tried = true;
            const medium = pay(w, E, M, buyer, seller, qty * E.price[g], false, `${g}|${buyer.id}|${seller.id}|${qty}`, drawn);
            if (!medium) continue;
            tally(medium);
            holdings(E, seller.id)[g] = round(holdings(E, seller.id)[g] - qty);
            holdings(E, buyer.id)[g] = round(holdings(E, buyer.id)[g] + qty);
            day.volume[g] = (day.volume[g] ?? 0) + qty;
            left -= qty;
            break;
          }
        }
        // Wanted it, found it for sale, and had nothing any seller would take.
        if (tried && left === want) tally(undefined);
      }
    }
    // The price follows what the market showed, not what people wished for: goods left unsold
    // bring it down, buyers left waiting after the sellers sold out bring it up.
    const sold = day.volume[g] ?? 0;
    const unsold = Math.max(0, offered - sold);
    const unmet = Math.max(0, wanted - sold);
    const glut = offered > 0 && unsold / offered > 0.4;
    // A step down as large as the share left unsold; a step up as large as the share of buyers left waiting once the sellers had sold out.
    const push = glut ? -unsold / offered : unsold <= 1 && unmet > 0 ? unmet / (unmet + sold + 1) : 0;
    E.price[g] = round(Math.min(GOODS[g].price * 3, Math.max(GOODS[g].price * 0.4, E.price[g] * (1 + 0.2 * push))), 3);
    // Left alone, a price drifts back toward what the thing has always cost.
    E.price[g] = round(E.price[g] + 0.06 * (GOODS[g].price - E.price[g]), 3);
    const t = (E.trend ??= {});
    t[g] = glut && unsold >= 3 ? Math.min(t[g] ?? 0, 0) - 1 : unmet >= 3 && unsold <= 1 ? Math.max(t[g] ?? 0, 0) + 1 : 0;
  }

  // Food. What a household can count on from the common store is as good as food in the house,
  // so food is bought and sold in earnest only when the store runs low.
  const share = v.store.food / Math.max(1, w.order.length);
  const offers = homes.map((h) => ({ h, spare: round(h.food - needOf(w, h) * 6, 1) })).filter((x) => x.spare >= 1);
  const asks = homes.map((h) => ({ h, want: round(needOf(w, h) * 5 - h.food - share * h.members.length, 1) })).filter((x) => x.want >= 1);
  const want = asks.reduce((s, x) => s + x.want, 0);
  const offer = offers.reduce((s, x) => s + x.spare, 0);
  const short = want > 3 && offer < want * 0.8;
  const law = lawInForce(w, "fair_price");
  const going = short ? Math.min(2.5, E.price.food * 1.35) : E.price.food;
  const asking = new Map<string, { price: number; give: boolean; trace?: string }>();
  if (short) {
    day.shortage = { want: Math.round(want), offer: Math.round(offer), raised: 0, held: 0, gave: 0 };
    for (const { h } of offers) {
      const sh = headOf(w, h);
      if (!sh) continue;
      const m = w.minds[sh]!;
      const evId = `ev_price_${w.tick}`;
      const pc = eventPercept(m, "world", "circumstance", 0.05, 0.5, ["price", "food", "market", "fairness", "hunger", evId], "Food was short at the market and I had some to sell.", `Market day at the landing. ${asks.length} households are short of food and ${offers.length} have any to sell. What does ${m.name} ask for it?`, evId);
      pc.features.prospective = true;
      pc.options = PRICE_OPTIONS(w, sh, h, going, E.ref.food, law);
      const { choice, trace } = await choose(w, sh, pc, faculties, sink, live);
      if (choice === "raise") {
        day.shortage.raised++;
        asking.set(h.id, { price: going, give: false, trace });
      } else if (choice === "give") {
        day.shortage.gave++;
        asking.set(h.id, { price: E.price.food, give: true, trace });
      } else if (choice === "withhold") asking.set(h.id, { price: Infinity, give: false, trace });
      else {
        day.shortage.held++;
        asking.set(h.id, { price: Math.min(E.price.food, law ? E.ref.food : E.price.food), give: false, trace });
      }
    }
  }
  const gouged = new Map<string, { seller: AgentId; buyers: AgentId[]; trace?: string }>();
  for (const { h: buyer, want: need } of asks.sort((a, b) => b.want / needOf(w, b.h) - a.want / needOf(w, a.h) || a.h.id.localeCompare(b.h.id))) {
    let left = need;
    let tried = false;
    const bh = headOf(w, buyer);
    for (const o of [...offers].sort((a, b) => liking(buyer, b.h) - liking(buyer, a.h) || a.h.id.localeCompare(b.h.id)).slice(0, 6)) {
      if (left < 0.5) break;
      if (o.h === buyer || o.spare < 0.5) continue;
      const ask = asking.get(o.h.id) ?? { price: E.price.food, give: false };
      if (ask.price === Infinity) continue;
      const qty = round(Math.min(left, o.spare), 1);
      tried = true;
      const medium = pay(w, E, M, buyer, o.h, qty * ask.price, true, `food|${buyer.id}|${o.h.id}`);
      const gift = !medium && ask.give;
      if (!medium && !gift) continue;
      if (gift) {
        day.deals.gift++;
        M.deals.give = (M.deals.give ?? 0) + 1;
      } else day.deals[medium!]++;
      o.h.food = round(o.h.food - qty);
      buyer.food = round(buyer.food + qty);
      o.spare = round(o.spare - qty, 1);
      left = round(left - qty, 1);
      day.volume.food = round((day.volume.food ?? 0) + qty, 1);
      const sh = headOf(w, o.h)!;
      if (gift && bh) {
        const bm = w.minds[bh]!;
        const ob = bm.others[sh];
        if (ob) {
          ob.liking = round(clamp(ob.liking + 0.06), 3);
          ob.trust.benevolence = round(clamp(ob.trust.benevolence + 0.05), 3);
        }
      }
      if (!gift && short && ask.price > E.ref.food * 1.15 && bh) {
        const gz = gouged.get(o.h.id) ?? { seller: sh, buyers: [], trace: ask.trace };
        gz.buyers.push(bh);
        gouged.set(o.h.id, gz);
      }
    }
    if (tried && left === need) day.deals.failed++;
  }
  // Those who paid more in a hungry season remember who asked it.
  for (const gz of gouged.values()) {
    E.gouges.push({ tick: w.tick, seller: gz.seller, buyers: gz.buyers, price: round(going), ref: round(E.ref.food), trace: gz.trace });
    for (const b of gz.buyers) {
      const m = w.minds[b]!;
      const sn = personName(w, gz.seller);
      if (live) {
        const pc = eventPercept(m, gz.seller, "other", -0.3, 0.5, ["price", "food", "market", "fairness", "hunger"], `${sn} asked more for food when we were short.`, `${sn} wants ${Math.round((going / E.ref.food - 1) * 100)}% more than food has ever cost, with ${m.name}'s household short.`, `ev_gouge_${gz.seller}_${w.tick}`, [gz.seller]);
        pc.features.intentional = 0.9;
        pc.features.normViolation = 0.45 + 0.3 * normHeld(w, b);
        const tr = await runPercept(m, pc, faculties);
        record(w, sink, b, tr);
        wrong(w, b, gz.seller, 0.08, `${sn} asked more for food in a hungry ${v.season}`, tr.encoded);
      } else {
        const o = m.others[gz.seller];
        if (o) {
          o.liking = round(clamp(o.liking - 0.05), 3);
          o.trust.integrity = round(clamp(o.trust.integrity - 0.04), 3);
        }
        wrong(w, b, gz.seller, 0.08, `${sn} asked more for food in a hungry ${v.season}`);
      }
    }
  }
  if (E.gouges.length > 60) E.gouges.splice(0, E.gouges.length - 60);
  if (want + offer > 0) reprice(E, "food", want, offer, 0.6, 2.5);
  // Left alone, food drifts back toward what it has always cost.
  E.price.food = round(E.price.food + 0.1 * (1 - E.price.food), 3);
  for (const k of ["food", ...GOOD_IDS] as (Good | "food")[]) {
    E.ref[k] = round(0.8 * E.ref[k] + 0.2 * E.price[k], 3);
    day.price[k] = round(E.price[k]);
  }
  day.gini = townGini(w);
  E.markets.push(day);
  if (E.markets.length > 160) E.markets.splice(0, E.markets.length - 160);
  M.deals.sell = (M.deals.sell ?? 0) + day.deals.amber;

  const done = day.deals.amber + day.deals.barter + day.deals.store + day.deals.credit + day.deals.gift;
  if (done + day.deals.failed === 0) return day;
  const parts = [day.deals.amber ? `${day.deals.amber} for ${M.good}` : "", day.deals.barter ? `${day.deals.barter} by barter` : "", day.deals.store ? `${day.deals.store} out of the common store` : "", day.deals.credit ? `${day.deals.credit} on credit` : "", day.deals.gift ? `${plural(day.deals.gift, "gift")}` : ""].filter(Boolean);
  const sold = GOOD_IDS.filter((g) => day.volume[g]).map((g) => `${day.volume[g]} ${GOODS[g].name}`);
  const text = [
    `${plural(done, "deal")}${parts.length ? ` (${list(parts)})` : ""}${day.deals.failed ? `; ${day.deals.failed} fell through for want of anything the seller would take` : ""}.`,
    sold.length || day.volume.food ? `Changed hands: ${list([...(day.volume.food ? [`${Math.round(day.volume.food)} days' food`] : []), ...sold])}.` : "",
    day.shortage ? `Food was short (${day.shortage.want} wanted, ${day.shortage.offer} for sale): ${day.shortage.raised} asked more for it, ${day.shortage.held} kept to the old price, ${day.shortage.gave} gave.` : "",
  ].filter(Boolean).join(" ");
  const first = E.first === undefined && done >= 3;
  const why: Why[] | undefined = first
    ? [
        { text: `${w.name} had ${adultsOf(w).length} adults and ${day.specialists ? plural(day.specialists, "person", "people") + " living by a trade rather than by food" : "households with more of one thing than they could use"}.` },
        { text: isMoney(M) ? `Amber was already money here, so a deal needed only a buyer and a seller.` : `Amber was not yet money here (${Math.round(acceptedShare(w) * 100)}% would take it), so most deals needed each side to want what the other had.` },
      ]
    : undefined;
  if (first) E.first = w.tick;
  feed(w, sink, { kind: "event", place: "harbour", agents: [...gouged.values()].map((x) => x.seller).slice(0, 4), title: first ? `${w.name} holds its first market` : `Market day in ${w.name}`, text, chronicle: first ? { kind: "market", why } : undefined });
  if (first) note(w, { kind: "market", title: `${w.name} holds its first market`, text, why });
  if (day.shortage?.raised) note(w, { kind: "market", title: `Food is short at market: ${plural(day.shortage.raised, "seller")} ask more`, text, agents: [...gouged.values()].map((x) => x.seller) });
  return day;
}

/** Prices follow what was wanted against what was offered (a step of tâtonnement, with bounds). */
function reprice(E: Economy, k: Good | "food", wanted: number, offered: number, lo: number, hi: number): void {
  const excess = (wanted - offered) / (wanted + offered + 1e-6);
  E.price[k] = round(Math.min(hi, Math.max(lo, E.price[k] * (1 + 0.25 * excess))), 3);
}

// ---------------------------------------------------------------- merchants, between towns

/**
 * A merchant takes what is cheap and unsold at home to a town where it is dear and wanted. Returns
 * what was carried, or undefined when there was nothing worth the trip.
 */
export function merchantRun(A: WorldState, B: WorldState, merchant: AgentId): { good: Good; qty: number; profit: number; from: number; to: number } | undefined {
  const ca = civOf(A);
  const cb = civOf(B);
  const home = hhOf(A, merchant);
  if (!ca || !cb || !home) return undefined;
  const EA = ca.economy;
  const EB = cb.economy;
  const MA = moneyOf(A);
  const MB = moneyOf(B);
  const homesA = homesOf(A).filter((h) => h !== home);
  const homesB = homesOf(B);
  let best: { g: Good; gap: number; spare: number; want: number } | undefined;
  for (const g of GOOD_IDS) {
    const spare = homesA.reduce((s, h) => s + Math.max(0, Math.floor(holdings(EA, h.id)[g] - wantTarget(A, h, g))), 0);
    const want = homesB.reduce((s, h) => s + wantOf(B, EB, h, g), 0);
    // Where nobody makes a thing, what it would fetch is a guess: dearer than at home.
    const there = townCrafts(B).includes(Object.values(PROFESSIONS).find((P) => P.makes === g)!.tech) ? EB.price[g] : Math.max(EB.price[g], EA.price[g] * 1.5);
    const gap = there - EA.price[g];
    if (spare >= 2 && want >= 2 && gap > 0.2 && (!best || gap * Math.min(spare, want) > best.gap * Math.min(best.spare, best.want))) best = { g, gap, spare, want };
  }
  if (!best) return undefined;
  const g = best.g;
  const load = Math.min(best.spare, best.want, Math.round(8 * (1 + craftBonus(A, "boats"))));
  // Bought at home, from whoever has it over, paid like any other deal.
  let bought = 0;
  for (const h of homesA.sort((a, b) => holdings(EA, b.id)[g] - holdings(EA, a.id)[g] || a.id.localeCompare(b.id))) {
    if (bought >= load) break;
    const qty = Math.min(load - bought, Math.max(0, Math.floor(holdings(EA, h.id)[g] - wantTarget(A, h, g))));
    if (qty < 1) continue;
    if (!pay(A, EA, MA, home, h, qty * EA.price[g], false, `run|${merchant}|${h.id}|${g}`)) continue;
    holdings(EA, h.id)[g] = round(holdings(EA, h.id)[g] - qty);
    bought += qty;
  }
  if (!bought) return undefined;
  // Sold there to whoever is short, for amber if they have it, else for food.
  const priceB = Math.max(EB.price[g], EA.price[g] * 1.25);
  let sold = 0;
  let takings = 0;
  for (const h of homesB.map((h) => ({ h, want: wantOf(B, EB, h, g) })).filter((x) => x.want >= 1).sort((a, b) => b.want - a.want || a.h.id.localeCompare(b.h.id))) {
    if (sold >= bought) break;
    const qty = Math.min(h.want, bought - sold);
    const value = qty * priceB;
    const pieces = Math.max(1, Math.round(value / PRICE));
    const bh = headOf(B, h.h);
    if (!bh) continue;
    if (purse(B, MB, h.h) >= pieces && ((MB.accept[bh] ?? 0) > 0.35 || isMoney(MB))) {
      let left = pieces;
      for (const x of h.h.members) {
        const take = Math.min(left, MB.held[x] ?? 0);
        MB.held[x] = (MB.held[x] ?? 0) - take;
        left -= take;
      }
      MA.held[merchant] = (MA.held[merchant] ?? 0) + pieces;
      nudge(MB, bh, 0.03);
      takings += pieces * PRICE;
    } else if (h.h.food - value / EB.price.food >= needOf(B, h.h) * 4) {
      h.h.food = round(h.h.food - value / EB.price.food);
      home.food = round(home.food + value / EB.price.food);
      takings += value;
    } else continue;
    holdings(EB, h.h.id)[g] = round(holdings(EB, h.h.id)[g] + qty);
    sold += qty;
  }
  // What didn't sell comes home with the merchant.
  holdings(EA, home.id)[g] = round(holdings(EA, home.id)[g] + (bought - sold));
  if (!sold) return undefined;
  // The two markets pull toward each other.
  EB.price[g] = round(Math.max(GOODS[g].price * 0.4, EB.price[g] * (1 - 0.04 * sold)), 3);
  EA.price[g] = round(Math.min(GOODS[g].price * 3, EA.price[g] * (1 + 0.02 * sold)), 3);
  return { good: g, qty: sold, profit: round(takings - sold * EA.price[g], 1), from: round(EA.price[g]), to: round(priceB) };
}

// ---------------------------------------------------------------- reading it

export interface EconomyView {
  price: Record<string, number>;
  ref: Record<string, number>;
  markets: MarketDay[];
  money: { good: string; share: number; established: boolean };
  gini: number;
  /** `room` is how many more of the trade the town could carry now. */
  trades: { role: string; does: string; people: { id: AgentId; name: string; taughtBy?: string }[]; room: number }[];
  /** The best and worst off households, by what they are worth a head. */
  rich: { household: string; worth: number }[];
  poor: { household: string; worth: number }[];
  goods: { id: Good; good: string; price: number; usual: number; held: number; wanted: number; does: string }[];
  gouges: { tick: Tick; seller: AgentId; name: string; buyers: number; over: number }[];
}

export function economyView(w: WorldState): EconomyView | undefined {
  const c = civOf(w);
  if (!c) return undefined;
  const E = c.economy;
  const M = moneyOf(w);
  const homes = homesOf(w);
  const worth = homes.map((h) => ({ household: h.name, worth: Math.round(wealthOf(w, h) / Math.max(1, h.members.length)) })).sort((a, b) => b.worth - a.worth);
  return {
    price: { ...E.price },
    ref: { ...E.ref },
    markets: E.markets.slice(-24),
    money: { good: M.good, share: round(acceptedShare(w)), established: isMoney(M) },
    gini: townGini(w),
    trades: Object.entries(PROFESSIONS)
      .map(([role, P]) => ({
        role,
        does: P.does,
        people: w.order.filter((x) => w.agents[x]!.role === role).map((id) => ({ id, name: personName(w, id), taughtBy: craftLineage(w, id, P.tech)[1]?.name })),
        room: Math.max(0, capacity(w, role) - w.order.filter((x) => w.agents[x]!.role === role).length),
      }))
      .filter((t) => t.people.length || t.room),
    rich: worth.slice(0, 3),
    poor: worth.slice(-3).reverse(),
    goods: GOOD_IDS.map((g) => ({ id: g, good: GOODS[g].name, price: round(E.price[g]), usual: GOODS[g].price, held: Math.round(homes.reduce((s, h) => s + (E.goods[h.id]?.[g] ?? 0), 0)), wanted: homes.reduce((s, h) => s + wantOf(w, E, h, g), 0), does: GOODS[g].does })),
    gouges: E.gouges.slice(-8).map((g) => ({ tick: g.tick, seller: g.seller, name: personName(w, g.seller), buyers: g.buyers.length, over: Math.round((g.price / g.ref - 1) * 100) })),
  };
}
