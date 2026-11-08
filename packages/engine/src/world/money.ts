// Money and debt, left for people to work out. Nobody is told that anything is money.
//
// A household that runs short asks a neighbour with food to spare. The neighbour answers through
// their own mind: give it, lend it (an IOU the town remembers), take amber for it, or say no. Amber
// washes up on the beach and is found by those who work the shore; it is pretty, it keeps, and
// there is never much of it. Whether it buys anything depends on whether the person with the food
// believes someone else will take it from them later (Kiyotaki & Wright 1989: a medium of exchange
// is accepted because others accept it), so acceptance spreads by example and by who people look to.
//
// Credit and money compete. A loan needs trust: lenders weigh whether the borrower means well, and
// a debt left unpaid is a memory that does its work on trust like any other betrayal. Paying with
// amber needs no trust at all, which is why it is "memory" in a town where people don't trust each
// other's (Kocherlakota 1998, money is memory). So a warm town tends to run on favours and IOUs; a
// suspicious one is likelier to turn to amber. Whether amber ever becomes money is the town's own
// history.

import { clamp } from "../memory.js";
import { runPercept } from "../mind.js";
import type { ActionOption, Faculties, Percept } from "../ports.js";
import { nextId } from "../rng.js";
import type { AgentId, Tick } from "../types.js";
import { isChild } from "./life.js";
import { householdOf, type Household } from "./village.js";
import { eventPercept, feed, luck, personName, record, type Sink, type WorldState } from "./world.js";

export interface Debt {
  id: string;
  creditor: AgentId;
  debtor: AgentId;
  /** Food lent. */
  amount: number;
  tick: Tick;
  /** When it should be paid back by: a season on. */
  due: Tick;
  repaid?: Tick;
  /** Marked once it went unpaid past its day; it can still be paid late. */
  overdue?: Tick;
  /** When the borrower last weighed paying it back. */
  considered?: Tick;
  /** The lender's decision, and the borrower's when they paid. */
  trace: string;
  paidTrace?: string;
}

export type Deal = "give" | "lend" | "sell" | "refuse";

export interface Money {
  /** The durable good that might become money. */
  good: string;
  /** Pieces each person holds. */
  held: Record<AgentId, number>;
  /** How much each person believes the good will buy food from someone else, 0 to 1. */
  accept: Record<AgentId, number>;
  debts: Debt[];
  /** Counts of each kind of answer, since the start. */
  deals: Record<Deal, number>;
  /** When the good became money (most adults take it), and when it stopped being. */
  established?: Tick;
  lost?: Tick;
  /** Share of adults who take the good, a season at a time. */
  history: { tick: Tick; share: number; deals: Record<Deal, number> }[];
}

/** Keep every open debt and the latest settled ones. */
function prune(M: Money): void {
  const settled = M.debts.filter((d) => d.repaid);
  if (settled.length <= KEEP_DEBTS) return;
  const drop = new Set(settled.slice(0, settled.length - KEEP_DEBTS));
  M.debts = M.debts.filter((d) => !drop.has(d));
}

/** Food one piece of amber buys. */
export const PRICE = 3;
const DAY = 1440;
const KEEP_DEBTS = 300;
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function moneyOf(w: WorldState): Money {
  const v = w.village!;
  if (!v.money) {
    const m: Money = { good: "amber", held: {}, accept: {}, debts: [], deals: { give: 0, lend: 0, sell: 0, refuse: 0 }, history: [] };
    // A little amber has always washed up; a few people keep pieces. Few think of it as buying anything.
    for (const id of w.order) {
      const r = luck(w, "amber-start", id);
      m.held[id] = r < 0.35 ? 2 : r < 0.75 ? 1 : 0;
      m.accept[id] = startAccept(w, id);
    }
    v.money = m;
  }
  return v.money;
}

const startAccept = (w: WorldState, id: AgentId) => Number((0.15 + 0.2 * w.minds[id]!.traits.openness).toFixed(3));
const acceptOf = (M: Money, w: WorldState, id: AgentId) => (M.accept[id] ??= startAccept(w, id));
const nudge = (M: Money, id: AgentId, d: number) => (M.accept[id] = Number(clamp((M.accept[id] ?? 0.2) + d).toFixed(3)));

/** Share of adults who would take the good for food. */
export function acceptedShare(w: WorldState): number {
  const M = w.village?.money;
  if (!M) return 0;
  const adults = w.order.filter((x) => !isChild(w, x));
  return adults.length ? adults.filter((x) => (M.accept[x] ?? 0) > 0.5).length / adults.length : 0;
}

/** What someone owes and is owed, still open. */
export const openDebts = (w: WorldState, id?: AgentId) => (w.village?.money?.debts ?? []).filter((d) => !d.repaid && (!id || d.creditor === id || d.debtor === id));

/**
 * Each morning: amber is found on the shore by those who work it, and what people believe about it
 * drifts toward what the people they like believe (expectations spread; Bicchieri 2006).
 */
export function moneyDay(w: WorldState, sink: Sink): void {
  const M = moneyOf(w);
  for (const id of w.order) {
    // Anyone may pick a piece off the beach; those who work the shore find more.
    if (isChild(w, id)) continue;
    const shore = ["fisher", "forager", "thatcher", "reedcutter"].includes(w.agents[id]!.role);
    if (luck(w, "amber", id) < (shore ? 0.1 : 0.05)) M.held[id] = (M.held[id] ?? 0) + 1;
  }
  const before = acceptedShare(w);
  const next: Record<AgentId, number> = {};
  for (const id of w.order) {
    const m = w.minds[id]!;
    let wsum = 0;
    let sum = 0;
    for (const o of w.order) {
      if (o === id) continue;
      // Everyone's example counts a little; the example of people you like counts more.
      const lk = 0.2 + (m.others[o]?.liking ?? 0.5);
      wsum += lk;
      sum += lk * acceptOf(M, w, o);
    }
    const own = acceptOf(M, w, id);
    next[id] = wsum ? own + 0.06 * (sum / wsum - own) : own;
  }
  for (const [id, a] of Object.entries(next)) M.accept[id] = Number(a.toFixed(3));
  marks(w, sink, before);
}

/** Note when the good becomes money, or stops being. */
function marks(w: WorldState, sink: Sink, before: number): void {
  const M = moneyOf(w);
  const now = acceptedShare(w);
  if (!M.established || (M.lost && M.lost > M.established)) {
    if (now >= 0.6 && before < 0.6) {
      M.established = w.tick;
      const d = M.deals;
      feed(w, sink, {
        kind: "event",
        place: "tavern",
        agents: topHolders(w, 3),
        title: `${cap(M.good)} becomes money in ${w.name}`,
        text: `Most people now take ${M.good} for food. So far: ${d.sell} sales for ${M.good}, ${d.lend} loans, ${d.give} gifts, ${d.refuse} people turned away.`,
        chronicle: { kind: "money", why: [{ text: `${d.sell} times someone took ${M.good} for food, and each time made the next person likelier to.` }, { text: `${d.lend} loans, ${M.debts.filter((x) => x.overdue && !x.repaid).length} of them never paid back.` }] },
      });
    }
  } else if (now < 0.3 && before >= 0.3) {
    M.lost = w.tick;
    feed(w, sink, { kind: "event", agents: [], title: `${cap(M.good)} stops buying anything in ${w.name}`, text: `Too few would take it any more.`, chronicle: { kind: "money", why: [{ text: `Only ${Math.round(now * 100)}% of adults would still take ${M.good}.` }] } });
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const topHolders = (w: WorldState, n: number) => Object.entries(w.village!.money!.held).filter(([id]) => w.order.includes(id)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);

function needOf(w: WorldState, hh: Household, ration: number): number {
  return ration * hh.members.reduce((n, m) => n + (isChild(w, m) ? 0.6 : 1), 0);
}

const DEAL_OPTIONS = (w: WorldState, seller: AgentId, asker: AgentId, amount: number, pieces: number): ActionOption[] => {
  const M = moneyOf(w);
  const m = w.minds[seller]!;
  const n = personName(w, asker);
  const trust = m.others[asker]?.trust.benevolence ?? 0.5;
  const burned = M.debts.some((d) => d.creditor === seller && d.debtor === asker && d.overdue && !d.repaid);
  const owing = M.debts.filter((d) => d.debtor === asker && !d.repaid).length;
  const out: ActionOption[] = [
    { id: "give", label: "Give it", verb: `give ${n} food`, description: `Give ${n} ${amount} food, no strings.`, prosocial: 0.9, assertive: 0, avoidant: 0, disclosure: 0.2, comply: true, act: `gives ${n} food` },
    {
      id: "lend",
      label: "Lend it",
      verb: `lend ${n} food`,
      description: `Lend ${n} ${amount} food, to be paid back by the turn of the season.`,
      prosocial: 0.55,
      assertive: 0.2,
      avoidant: 0,
      disclosure: 0.1,
      comply: true,
      act: `lends ${n} food`,
      pull: [
        { name: `whether ${n} will pay it back`, value: (trust - 0.5) * 0.8, ref: `other:${asker}` },
        // Careful people would rather have it back: food is never certain.
        { name: "getting it back for the household", value: 0.1 + 0.3 * m.traits.conscientiousness },
        ...(burned ? [{ name: `${n} never paid back the last loan`, value: -0.5, ref: `other:${asker}` }] : []),
        ...(owing >= 2 ? [{ name: `${n} already owes ${owing} people`, value: -0.15 }] : []),
      ],
    },
  ];
  if (pieces > 0) {
    const a = acceptOf(M, w, seller);
    out.push({
      id: "sell",
      label: `Take ${M.good} for it`,
      verb: `take ${n}'s ${M.good} for food`,
      description: `${n} has ${pieces} piece${pieces === 1 ? "" : "s"} of ${M.good}. Take ${pieces} for ${Math.min(amount, pieces * PRICE)} food; no need to trust ${n} to pay later.`,
      // A fair exchange, not a kindness.
      prosocial: 0.1,
      assertive: 0.3,
      avoidant: 0,
      disclosure: 0.1,
      act: `takes ${M.good} from ${n} for food`,
      pull: [
        { name: `whether ${M.good} will buy anything later`, value: (a - 0.35) * 0.8 },
        // Something in hand for the household: what a less giving person weighs most.
        { name: "something in return", value: (0.15 + 0.35 * (1 - m.traits.agreeableness)) * Math.min(1, a * 2.5) },
        ...(trust < 0.5 ? [{ name: `no need to trust ${n}`, value: (0.5 - trust) * 0.8, ref: `other:${asker}` }] : []),
        ...(M.established && !(M.lost && M.lost > M.established) ? [{ name: `everyone takes ${M.good} now`, value: 0.2 }] : []),
      ],
    });
  }
  out.push({ id: "refuse", label: "Say no", verb: `turn ${n} away`, description: `Keep it for the household. ${n} can go to the store.`, prosocial: -0.35, assertive: 0.5, avoidant: 0.3, disclosure: 0, act: `turns ${n} away` });
  return out;
};

/**
 * At supper, before anyone goes to the store: households running low ask a neighbour with food to
 * spare, and the neighbour answers through their own mind.
 */
export async function market(w: WorldState, faculties: Faculties, sink: Sink, ration: number): Promise<void> {
  const v = w.village!;
  const M = moneyOf(w);
  const homes = Object.values(v.households).filter((h) => h.members.some((x) => w.order.includes(x)));
  const short = homes.filter((h) => h.food < needOf(w, h, ration) * 1.5);
  if (!short.length) return;
  const said: string[] = [];
  const refs: { agent: AgentId; trace: string }[] = [];
  const agents = new Set<AgentId>();
  const used = new Set<string>();
  for (const hh of short) {
    const asker = hh.members.filter((x) => w.order.includes(x) && !isChild(w, x)).sort((a, b) => (M.held[b] ?? 0) - (M.held[a] ?? 0) || a.localeCompare(b))[0];
    if (!asker) continue;
    const A = w.minds[asker]!;
    const spare = homes.filter((h) => h !== hh && !used.has(h.id) && h.food > needOf(w, h, ration) * 4);
    const sellers = spare.flatMap((h) => h.members.filter((x) => w.order.includes(x) && !isChild(w, x)).map((x) => ({ x, h })));
    if (!sellers.length) continue;
    // They ask the one with food to spare they like best.
    const { x: seller, h: from } = sellers.sort((a, b) => (A.others[b.x]?.liking ?? 0.5) - (A.others[a.x]?.liking ?? 0.5) || a.x.localeCompare(b.x))[0]!;
    used.add(from.id);
    const amount = Math.round(Math.min(needOf(w, hh, ration) * 2, from.food - needOf(w, from, ration) * 3) * 10) / 10;
    if (amount < 0.5) continue;
    const pieces = Math.min(M.held[asker] ?? 0, Math.ceil(amount / PRICE));
    const S = w.minds[seller]!;
    const evId = `ev_ask_${asker}_${w.tick}`;
    const p: Percept = {
      id: nextId(S, "pc"),
      tick: S.tick,
      kind: "speech",
      rawText: `${A.name} comes to the door: "We're short tonight. Could you spare some food?"${pieces ? ` ${A.name} has ${pieces} piece${pieces === 1 ? "" : "s"} of ${M.good} to offer.` : ""}`,
      actor: asker,
      addressedToSelf: true,
      about: [asker],
      topics: ["food", "help", "trust", "debt", ...(pieces ? [M.good, "money"] : []), evId],
      features: { outcomeForSelf: -0.1, agency: "other", intentional: 0.7, normViolation: 0, prospective: true, intensity: 0.45 },
      request: { what: "spare some food", topics: ["food", "help"] },
      claims: [],
      details: [{ key: "amount", value: `${amount} food`, salience: 0.3 }],
      template: "{who} asked me for {amount}.",
      gist: `${A.name} came asking for food.`,
      eventId: evId,
      options: DEAL_OPTIONS(w, seller, asker, amount, pieces),
    };
    p.details.unshift({ key: "who", value: A.name, salience: 0.2 });
    const tr = await runPercept(S, p, faculties);
    record(w, sink, seller, tr);
    refs.push({ agent: seller, trace: tr.id });
    agents.add(seller).add(asker);
    const deal = (tr.decision?.choice ?? "refuse") as Deal;
    M.deals[deal] = (M.deals[deal] ?? 0) + 1;
    const sn = personName(w, seller);
    if (deal === "refuse") {
      if (pieces) nudge(M, asker, -0.04);
      said.push(`${sn} turned ${A.name} away`);
      await heard(w, asker, seller, -0.3, `${sn} turned me away when we were short.`, `${sn} says no.`, faculties, sink);
      continue;
    }
    let got = amount;
    if (deal === "sell") {
      got = Math.min(amount, pieces * PRICE);
      M.held[asker] = (M.held[asker] ?? 0) - pieces;
      M.held[seller] = (M.held[seller] ?? 0) + pieces;
      // It worked as payment: both are likelier to think it will again.
      nudge(M, seller, 0.12);
      nudge(M, asker, 0.06);
      // Word gets round that amber bought supper: the households first, then everyone a little.
      for (const o of [...from.members, ...hh.members]) if (o !== seller && o !== asker) nudge(M, o, 0.03);
      for (const o of w.order) if (o !== seller && o !== asker) nudge(M, o, 0.01);
      said.push(`${sn} took ${pieces} ${M.good} from ${A.name} for ${got} food`);
    } else if (deal === "lend") {
      M.debts.push({ id: nextId(w, "debt"), creditor: seller, debtor: asker, amount: got, tick: w.tick, due: w.tick + v.seasonDays * DAY, trace: tr.id });
      prune(M);
      said.push(`${sn} lent ${A.name} ${got} food`);
    } else said.push(`${sn} gave ${A.name} ${got} food`);
    from.food = Number((from.food - got).toFixed(2));
    hh.food = Number((hh.food + got).toFixed(2));
    await heard(w, asker, seller, deal === "give" ? 0.45 : deal === "lend" ? 0.3 : 0.15, deal === "give" ? `${sn} gave us food when we were short.` : deal === "lend" ? `${sn} lent us food when we were short; we owe it back.` : `${sn} sold us food for ${M.good}.`, `${sn} ${deal === "give" ? "gives" : deal === "lend" ? "lends" : "sells"} ${A.name} ${got} food.`, faculties, sink);
  }
  if (said.length) feed(w, sink, { kind: "event", agents: [...agents].slice(0, 8), title: `Short at supper, ${said.length === 1 ? "one household asks" : `${said.length} households ask`} the neighbours`, text: `${cap(list(said))}.`, refs });
}

/** The asker takes in the answer, through their own mind. */
async function heard(w: WorldState, who: AgentId, from: AgentId, outcome: number, gist: string, raw: string, faculties: Faculties, sink: Sink): Promise<void> {
  const m = w.minds[who]!;
  const pc = eventPercept(m, from, "other", outcome, 0.4, ["food", "help", "trust", "debt"], gist, raw, `ev_ans_${who}_${w.tick}`, [from]);
  pc.features.intentional = 0.7;
  const tr = await runPercept(m, pc, faculties);
  record(w, sink, who, tr);
}

const REPAY: (n: string, amount: number) => ActionOption[] = (n, amount) => [
  { id: "repay", label: "Pay it back", verb: `pay ${n} back`, description: `Take ${amount} food to ${n}, as promised.`, prosocial: 0.75, assertive: 0, avoidant: 0, disclosure: 0.1, comply: true, act: `pays ${n} back` },
  { id: "put_off", label: "Put it off", verb: `put off paying ${n}`, description: `Keep it for now. ${n} can wait.`, prosocial: -0.45, assertive: 0.2, avoidant: 0.6, disclosure: 0, act: `puts off paying ${n}` },
];

/**
 * At supper too: debtors with enough to spare decide whether to pay back what they owe, and debts
 * that pass their day unpaid become a grievance in the lender's mind.
 */
export async function settle(w: WorldState, faculties: Faculties, sink: Sink, ration: number): Promise<void> {
  const M = moneyOf(w);
  const said: string[] = [];
  const agents = new Set<AgentId>();
  for (const d of M.debts) {
    if (d.repaid || !w.order.includes(d.debtor) || !w.order.includes(d.creditor)) continue;
    const hh = householdOf(w, d.debtor);
    const to = householdOf(w, d.creditor);
    if (!hh || !to) continue;
    if (hh !== to && hh.food >= d.amount + needOf(w, hh, ration) * 2 && w.tick - (d.considered ?? -Infinity) >= 2 * DAY) {
      d.considered = w.tick;
      const D = w.minds[d.debtor]!;
      const cn = personName(w, d.creditor);
      const pc = eventPercept(D, d.creditor, "other", -0.1, 0.4, ["debt", "food", "trust", "fairness", `ev_${d.id}`], `I owe ${cn} ${d.amount} food.`, `There's enough in the house to pay ${cn} back the ${d.amount} food ${D.pronouns.subject} borrowed.`, `ev_${d.id}`, [d.creditor]);
      pc.addressedToSelf = true;
      pc.request = { what: `pay back the ${d.amount} food`, topics: ["debt", "food"] };
      pc.options = REPAY(cn, d.amount);
      const tr = await runPercept(D, pc, faculties);
      record(w, sink, d.debtor, tr);
      if (tr.decision?.choice === "repay") {
        d.repaid = w.tick;
        d.paidTrace = tr.id;
        hh.food = Number((hh.food - d.amount).toFixed(2));
        to.food = Number((to.food + d.amount).toFixed(2));
        said.push(`${personName(w, d.debtor)} paid ${cn} back${d.overdue ? ", late" : ""}`);
        agents.add(d.debtor).add(d.creditor);
        const C = w.minds[d.creditor]!;
        const seen = eventPercept(C, d.debtor, "other", 0.35, 0.45, ["debt", "trust", "fairness", "help"], `${personName(w, d.debtor)} paid back what they owed me.`, `${personName(w, d.debtor)} brings back the ${d.amount} food.`, `ev_${d.id}_paid`, [d.debtor]);
        seen.features.intentional = 0.8;
        record(w, sink, d.creditor, await runPercept(C, seen, faculties));
        continue;
      }
    }
    if (!d.overdue && w.tick >= d.due) {
      d.overdue = w.tick;
      agents.add(d.debtor).add(d.creditor);
      said.push(`${personName(w, d.debtor)} hasn't paid ${personName(w, d.creditor)} back`);
      const C = w.minds[d.creditor]!;
      const pc = eventPercept(C, d.debtor, "other", -0.4, 0.55, ["debt", "trust", "fairness", "betrayal"], `${personName(w, d.debtor)} never paid back the food I lent.`, `The season has turned and ${personName(w, d.debtor)} still hasn't paid back the ${d.amount} food.`, `ev_${d.id}_due`, [d.debtor]);
      pc.features.intentional = 0.8;
      pc.features.normViolation = 0.6;
      record(w, sink, d.creditor, await runPercept(C, pc, faculties));
    }
  }
  if (said.length) feed(w, sink, { kind: "event", agents: [...agents].slice(0, 8), title: said.length === 1 ? cap(said[0]!) : `Debts at supper: ${said.length}`, text: said.length > 1 ? `${cap(list(said))}.` : undefined });
}

/** The aggregate tier, a season at a time: amber is found, beliefs drift, debts settle on rules. */
export function aggMoney(w: WorldState, sink: Sink): void {
  const M = moneyOf(w);
  const adults = w.order.filter((x) => !isChild(w, x));
  if (!adults.length) return;
  const before = acceptedShare(w);
  const trust = adults.reduce((s, a) => s + adults.filter((o) => o !== a).reduce((t, o) => t + (w.minds[a]!.others[o]?.trust.benevolence ?? 0.5), 0) / Math.max(1, adults.length - 1), 0) / adults.length;
  const amber = Object.values(M.held).reduce((s, x) => s + x, 0);
  for (const id of adults) {
    if (["fisher", "forager"].includes(w.agents[id]!.role) && luck(w, "amber-season", id) < 0.18) M.held[id] = (M.held[id] ?? 0) + 1;
    // Where people don't trust each other to pay back, payment in hand looks better, if there is any to pay with.
    nudge(M, id, amber > adults.length * 0.5 ? 0.06 * (0.55 - trust) : -0.01);
  }
  const mean = adults.reduce((s, x) => s + (M.accept[x] ?? 0), 0) / adults.length;
  for (const id of adults) M.accept[id] = Number(((M.accept[id] ?? 0) + 0.2 * (mean - (M.accept[id] ?? 0))).toFixed(3));
  for (const d of M.debts) {
    if (d.repaid) continue;
    if (!w.order.includes(d.debtor)) continue;
    if (luck(w, "repay", d.id) < 0.3 + 0.5 * w.minds[d.debtor]!.traits.conscientiousness) d.repaid = w.tick;
    else d.overdue ??= w.tick;
  }
  marks(w, sink, before);
}

/** A season's line in the history, for the region view and Both ways. */
export function moneySeason(w: WorldState): void {
  const M = moneyOf(w);
  M.history.push({ tick: w.tick, share: Number(acceptedShare(w).toFixed(2)), deals: { ...M.deals } });
  if (M.history.length > 200) M.history.splice(0, M.history.length - 200);
}
