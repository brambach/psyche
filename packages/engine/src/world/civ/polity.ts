// Contested elections, and the laws that come out of them. In the first years a town simply asks
// whoever is best liked to lead (civic.ts). Once it has sides, the choosing becomes a contest:
//
// - Candidates are the sitting leader, the head of each faction, and anyone who set out this
//   season to stand. Each stands on one promise, and the promise comes out of their own head: a
//   debtor promises a clean slate, someone who was charged double in a hungry autumn promises a
//   fair price, someone raised on a story of strangers bringing sickness promises a closed landing.
// - Every grown person names one. What weighs: whether they like and trust the candidate (Fiske,
//   Cuddy & Glick 2007), whether the candidate is one of theirs (Tajfel & Turner 1979), what the
//   promise would do for their own household (Downs 1957), and for the sitting leader, how the
//   last year went. Hungry seasons are held against whoever led through them, deserved or not
//   (retrospective voting; Fiorina 1981), and a town that was attacked closes ranks around its
//   leader (the rally effect; Mueller 1970).
// - The winner puts the promise to the town. A law binds while it stands; a clean slate wipes
//   every debt at once and is remembered by those who were owed (the Mesopotamian "clean slates";
//   Hudson 1993).
// - A law that was never written down lives in the say-so of whoever made it. When they lose the
//   lead it lapses unless the next leader wants it too (Goody & Watt 1963; records.ts).
//
// A side that loses is counted as having lost (factions.ts), and a side that keeps losing leaves.

import { clamp } from "../../memory.js";
import type { ActionOption, Faculties } from "../../ports.js";
import { nextId } from "../../rng.js";
import type { AgentId, Tick } from "../../types.js";
import { civicOf, type Law } from "../civic.js";
import { intentOf } from "../intentions.js";
import { knows } from "../knowledge.js";
import { ageOf, normHeld, storeNorm, yearOf } from "../life.js";
import { openDebts } from "../money.js";
import { eventPercept, feed, personName, type Sink, type Why, type WorldState } from "../world.js";
import { cap, choose, civOf, DAY, grownOf, hhOf, list, note, plural, recent, round, townBeliefOf, witness, yearTicks } from "./base.js";
import { factionOf, liveFactions, rivalryBetween, wrong } from "./factions.js";
import { isWritten } from "./records.js";

export type Issue = "share" | "keep" | "forgive" | "fair_price" | "close" | "open" | "war" | "peace" | "steady";

export interface Platform {
  issue: Issue;
  /** The promise, in words. */
  text: string;
  /** What in the candidate's own life it comes from. */
  because: string;
  /** The other town, for war and peace. */
  target?: string;
  /** The memory or core belief behind it, when there is one. */
  ref?: string;
}

export interface Candidate {
  id: AgentId;
  name: string;
  faction?: string;
  factionName?: string;
  incumbent?: boolean;
  platform: Platform;
  votes: number;
}

export interface Contest {
  tick: Tick;
  year: number;
  candidates: Candidate[];
  winner: AgentId;
  voters: number;
  changed: boolean;
  /** Who each grown person named. */
  ballots: Record<AgentId, AgentId>;
  /** How each side voted: the share of it that named its most-named candidate. */
  blocs: { faction: string; name: string; for: AgentId; share: number }[];
  why: Why[];
}

export interface Polity {
  contests: Contest[];
  /** What the sitting leader promised, and when it was done. */
  mandate?: { leader: AgentId; issue: Issue; text: string; tick: Tick; target?: string; done?: Tick; failed?: Tick };
  /** What the town's leader has set the town to, toward each other town. */
  stance: Record<string, "war" | "peace">;
}

export const newPolity = (): Polity => ({ contests: [], stance: {} });

const LAW_OF: Partial<Record<Issue, Law["kind"]>> = { share: "store_minimum", fair_price: "fair_price", forgive: "jubilee", close: "closed_landing" };
const REPEALS: Partial<Record<Issue, Law["kind"]>> = { keep: "store_minimum", open: "closed_landing" };
const LAW_NAME: Record<Law["kind"], string> = { store_minimum: "the store law", fair_price: "the fair price law", jubilee: "the clean slate", closed_landing: "the closed landing" };

/** A law of this kind stands in this town. */
export function lawInForce(w: WorldState, kind: Law["kind"]): boolean {
  return (w.village?.civic?.laws ?? []).some((l) => l.kind === kind && l.passed && !l.repealed);
}
const lawOf = (w: WorldState, kind: Law["kind"]) => (w.village?.civic?.laws ?? []).find((l) => l.kind === kind && l.passed && !l.repealed);

/** No strangers may settle: by law, or while a sickness has the landing shut. */
export const landingClosed = (w: WorldState): boolean => lawInForce(w, "closed_landing") || !!civOf(w)?.health.closed;

const promise = (w: WorldState, issue: Issue, target?: string): string => {
  const t = target ? (civOf(w)?.abroad[target]?.name ?? target) : "";
  return {
    share: "every household puts a quarter of what it has over into the common store",
    keep: "what a household grows is its own, and the store law goes",
    forgive: `every debt in ${w.name} is wiped clean`,
    fair_price: "nobody asks more for food in a hungry season than it has always cost",
    close: `no more strangers settle at ${w.name}`,
    open: "the landing is opened to newcomers again",
    war: `${t} answers for what it has done`,
    peace: `an end to the fighting with ${t}`,
    steady: "things go on as they are",
  }[issue];
};

const late = (w: WorldState, id: AgentId) => {
  const l = w.village!.life[id];
  return l?.arrived !== undefined && w.tick - l.arrived < 8 * yearTicks(w);
};
const household = (w: WorldState, id: AgentId) => hhOf(w, id)?.members ?? [id];
const owes = (w: WorldState, id: AgentId) => openDebts(w).some((d) => household(w, id).includes(d.debtor) && !household(w, id).includes(d.creditor));
const isOwed = (w: WorldState, id: AgentId) => openDebts(w).some((d) => household(w, id).includes(d.creditor) && !household(w, id).includes(d.debtor));
const gouged = (w: WorldState, id: AgentId) => civOf(w)!.economy.gouges.filter((g) => w.tick - g.tick < 2 * yearTicks(w) && g.buyers.some((b) => household(w, id).includes(b)));
const gouger = (w: WorldState, id: AgentId) => civOf(w)!.economy.gouges.some((g) => w.tick - g.tick < 2 * yearTicks(w) && household(w, id).includes(g.seller));
const compelled = (w: WorldState, id: AgentId) => !!lawOf(w, "store_minimum")?.compelled.some((c) => household(w, id).includes(c.agent));
/** Core beliefs that make strangers read as a danger, with how strongly each is held. */
const wary = (w: WorldState, id: AgentId) => w.minds[id]!.schemas.filter((s) => s.threatBias + s.blameBias > 0 && s.triggers.some((t) => ["stranger", "newcomer", "sickness", "raid", "boat"].includes(t)));
/** The town someone thinks worst of, among those the town knows. */
function worstTown(w: WorldState, id: AgentId): { town: string; belief: number } | undefined {
  const m = w.minds[id]!;
  return Object.keys(civOf(w)!.abroad)
    .map((town) => ({ town, belief: townBeliefOf(m, town) }))
    .sort((a, b) => a.belief - b.belief || a.town.localeCompare(b.town))[0];
}
const foughtWith = (w: WorldState) => Object.entries(civOf(w)!.abroad).filter(([, a]) => a.fought).sort((a, b) => (b[1].fought ?? 0) - (a[1].fought ?? 0))[0]?.[0];

/** The one promise this person would stand on, out of who they are and what has happened to them. */
export function platformFor(w: WorldState, id: AgentId, incumbent: boolean): Platform {
  const c = civOf(w)!;
  const m = w.minds[id]!;
  const t = m.traits;
  const role = w.agents[id]!.role;
  const out: { issue: Issue; score: number; because: string; target?: string; ref?: string }[] = [];
  const hungry = recent(w, c.marks.hunger, 2);
  const store = lawInForce(w, "store_minimum");
  if (!store && hungry) out.push({ issue: "share", score: 0.1 + 0.4 * normHeld(w, id) + 0.3 * (t.agreeableness - 0.5) + 0.08 * hungry, because: `${w.name} went hungry in ${plural(hungry, "season")} of the last two years, and ${m.name} holds that everyone should put into the store` });
  if (store) {
    const own = m.schemas.filter((s) => s.blameBias + s.threatBias > 0 && s.triggers.some((x) => ["food", "store", "hunger"].includes(x))).sort((a, b) => b.strength - a.strength)[0];
    out.push({ issue: "keep", score: 0.05 + 0.5 * (0.5 - m.needs.autonomy) + (compelled(w, id) ? 0.25 : 0) + 0.3 * (0.5 - t.agreeableness) + (own ? 0.3 * own.strength : 0), because: compelled(w, id) ? `${m.name}'s household was made to give under the store law` : own ? `${m.name} holds that “${own.text}”` : `${m.name} does not like being told what to do with what is ${m.pronouns.possessive}`, ref: own?.id });
  }
  const overdue = openDebts(w).filter((d) => d.overdue).length;
  const slate = (w.village!.civic?.laws ?? []).some((l) => l.kind === "jubilee" && l.passed && w.tick - l.tick < 12 * yearTicks(w));
  if (openDebts(w).length >= 4 && !slate) {
    const f = factionOf(w, id);
    const side = f ? f.members.filter((x) => owes(w, x)).length / Math.max(1, f.members.length) : 0;
    out.push({ issue: "forgive", score: 0.05 + (owes(w, id) ? 0.35 : 0) + 0.3 * side + 0.2 * (t.agreeableness - 0.5) - (isOwed(w, id) ? 0.4 : 0) + 0.03 * overdue, because: owes(w, id) ? `${m.name}'s own household owes` : side > 0.3 ? `${Math.round(side * 100)}% of ${f!.name} owe` : `${openDebts(w).length} debts stand open in ${w.name}, ${overdue} of them past their day` });
  }
  const g = gouged(w, id);
  const anyGouge = c.economy.gouges.filter((x) => w.tick - x.tick < 2 * yearTicks(w)).length;
  if (anyGouge && !lawInForce(w, "fair_price"))
    out.push({ issue: "fair_price", score: 0.1 + (g.length ? 0.3 : 0) + 0.2 * (t.agreeableness - 0.5) + Math.min(0.15, 0.04 * anyGouge) - (gouger(w, id) ? 0.5 : 0), because: g.length ? `${personName(w, g.at(-1)!.seller)} asked ${m.name}'s household ${Math.round((g.at(-1)!.price / g.at(-1)!.ref - 1) * 100)}% over the old price for food when it was short` : `sellers asked more for food ${anyGouge === 1 ? "once" : `${anyGouge} times`} in two hungry years`, ref: g.at(-1)?.trace });
  const fear = wary(w, id).sort((a, b) => b.strength - a.strength)[0];
  const plague = recent(w, c.marks.plague, 4);
  const raided = recent(w, c.marks.raided, 5);
  if (!lawInForce(w, "closed_landing"))
    out.push({ issue: "close", score: (fear ? 0.45 * fear.strength : 0) + (plague ? 0.12 : 0) + (raided ? 0.12 : 0) + 0.2 * (0.5 - t.openness) - (late(w, id) ? 0.3 : 0) - (role === "merchant" ? 0.3 : 0), because: fear ? `${m.name} holds that “${fear.text}”` : plague ? `sickness came to ${w.name} ${plague === 1 ? "once" : `${plague} times`} in four years` : `${m.name} is wary of what is new`, ref: fear?.id });
  else out.push({ issue: "open", score: 0.08 + 0.3 * (t.openness - 0.5) + (role === "merchant" ? 0.3 : 0) + (late(w, id) ? 0.2 : 0) - (fear ? 0.4 * fear.strength : 0), because: role === "merchant" ? `${m.name} lives by what comes over the landing` : late(w, id) ? `${m.name} came here as a stranger` : `${m.name} is curious about what the boats bring` });
  const worst = worstTown(w, id);
  const fought = foughtWith(w);
  if (worst && worst.belief <= -0.3) {
    const b = m.beliefs.filter((x) => x.about === `town:${worst.town}` && x.valence < 0).sort((x, y) => y.confidence - x.confidence)[0];
    const weary = recent(w, c.marks.raids, 3) + recent(w, c.marks.raided, 3);
    out.push({ issue: "war", score: -worst.belief * 0.45 + 0.3 * (0.5 - t.agreeableness) + (c.abroad[worst.town]?.raidedUs ? 0.2 : 0) + (knows(w, id, "arms") ? 0.08 : 0) - 0.06 * weary - 0.1, because: b ? `${m.name} believes “${b.proposition}”` : `${m.name} thinks ill of ${c.abroad[worst.town]?.name ?? worst.town}`, target: worst.town, ref: b?.evidence.at(-1) });
  }
  if (fought) out.push({ issue: "peace", score: 0.08 + 0.35 * (t.agreeableness - 0.5) + 0.05 * Math.min(4, recent(w, c.marks.raided, 5) + recent(w, c.marks.raids, 5)) + (c.polity.stance[fought] === "war" ? 0.08 : 0), because: `${w.name} and ${c.abroad[fought]!.name} have raided each other, and ${m.name} would rather mend than avenge (agreeableness ${t.agreeableness.toFixed(2)})`, target: fought });
  out.push({ issue: "steady", score: incumbent ? 0.14 + (recent(w, c.marks.hunger, 1) ? -0.08 : 0.08) : 0.04, because: incumbent ? `${m.name} has led ${w.name} and means to go on as before` : `${m.name} promises nothing new` });
  const best = out.sort((a, b) => b.score - a.score || a.issue.localeCompare(b.issue))[0]!;
  return { issue: best.issue, text: promise(w, best.issue, best.target), because: best.because, target: best.target, ref: best.ref };
}

/** What a promise would do for one voter's own household, as terms in their choice. */
export function interest(w: WorldState, id: AgentId, p: { issue: Issue; target?: string }): { name: string; value: number; ref?: string }[] {
  const m = w.minds[id]!;
  const t = m.traits;
  const out: { name: string; value: number; ref?: string }[] = [];
  const add = (name: string, value: number, ref?: string) => {
    if (Math.abs(value) >= 0.01) out.push({ name, value: round(value, 3), ref });
  };
  switch (p.issue) {
    case "share":
      add("holds that everyone should put into the store", 0.3 * (normHeld(w, id) - 0.4));
      add("has gone hungry", m.needs.energy < 0.4 ? 0.1 : 0);
      break;
    case "keep":
      add("chafes at being told", 0.4 * (0.5 - m.needs.autonomy));
      add("was made to give under the law", compelled(w, id) ? 0.15 : 0);
      add("holds that everyone should put into the store", -0.25 * normHeld(w, id));
      break;
    case "forgive":
      add("owes, and would be free of it", owes(w, id) ? 0.3 : 0);
      add("is owed, and would lose it", isOwed(w, id) ? -0.3 : 0);
      break;
    case "fair_price": {
      const g = gouged(w, id).at(-1);
      add("was charged more for food when it was short", g ? 0.25 : 0, g?.trace);
      add("sold dear in the shortage", gouger(w, id) ? -0.3 : 0);
      add("thinks it only right", 0.08 * (t.agreeableness - 0.5));
      break;
    }
    case "close":
    case "open": {
      const sign = p.issue === "close" ? 1 : -1;
      for (const s of wary(w, id)) add(`the core belief “${s.text}”`, sign * 0.35 * s.strength, s.id);
      add("came here as a stranger", late(w, id) ? -0.25 * sign : 0);
      add("curious about what the boats bring", -0.2 * sign * (t.openness - 0.5));
      add("lives by the landing", w.agents[id]!.role === "merchant" ? -0.25 * sign : 0);
      break;
    }
    case "war": {
      const b = p.target ? townBeliefOf(m, p.target) : 0;
      const ev = m.beliefs.filter((x) => x.about === `town:${p.target}` && x.valence < 0).sort((x, y) => y.confidence - x.confidence)[0];
      add(`what ${m.pronouns.subject} believes of them`, -b * 0.35, ev?.evidence.at(-1));
      add("no stomach for a fight", -0.2 * (t.agreeableness - 0.5) - 0.12 * (t.neuroticism - 0.5));
      add("small children at home", household(w, id).some((x) => ageOf(w, x) < 6) ? -0.08 : 0);
      break;
    }
    case "peace": {
      const b = p.target ? townBeliefOf(m, p.target) : 0;
      add("would rather mend than avenge", 0.25 * (t.agreeableness - 0.5));
      add(`what ${m.pronouns.subject} believes of them`, b * 0.25);
      add("tired of burying people", m.episodes.some((e) => e.topics.includes("raid") && e.topics.includes("death")) ? 0.12 : 0);
      break;
    }
    default:
      break;
  }
  return out;
}

const sum = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);

/** Each spring, in a town with civilization systems: the choosing of a leader, contested. */
export async function electCiv(w: WorldState, faculties: Faculties, sink: Sink, live: boolean): Promise<Contest | undefined> {
  const c = civOf(w);
  if (!c) return undefined;
  const v = w.village!;
  const civic = civicOf(v);
  const P = c.polity;
  const voters = grownOf(w);
  if (voters.length < 3) return undefined;
  const sitting = civic.leader && w.order.includes(civic.leader) ? civic.leader : undefined;
  // Who stands: the sitting leader, the head of each side, anyone who set out to, and failing all that the best liked.
  const standing: AgentId[] = [];
  const stand = (id: AgentId | undefined) => {
    if (id && w.order.includes(id) && ageOf(w, id) >= 18 && !standing.includes(id) && standing.length < 4) standing.push(id);
  };
  stand(sitting);
  for (const f of liveFactions(w).sort((a, b) => b.members.length - a.members.length)) stand(f.head);
  for (const id of voters) if (intentOf(w, id)?.kind === "challenge") stand(id);
  if (standing.length < 2) {
    const liked = voters
      .filter((x) => ageOf(w, x) >= 18)
      .map((x) => ({ x, s: voters.reduce((s, o) => s + (o === x ? 0 : (w.minds[o]!.others[x]?.liking ?? 0.5)), 0) / Math.max(1, voters.length - 1) + Math.min(ageOf(w, x), 60) / 600 }))
      .sort((a, b) => b.s - a.s || a.x.localeCompare(b.x));
    for (const { x } of liked.slice(0, 3)) if (standing.length < 2) stand(x);
  }
  if (!standing.length) return undefined;
  const cands: Candidate[] = standing.map((id) => {
    const f = factionOf(w, id);
    return { id, name: personName(w, id), faction: f?.id, factionName: f?.name, incumbent: id === sitting, platform: platformFor(w, id, id === sitting), votes: 0 };
  });
  // The year the sitting leader has to answer for.
  const hungry = recent(w, c.marks.hunger, 1);
  const sick = recent(w, c.marks.plague, 1);
  const attacked = recent(w, c.marks.raided, 1);
  const ballots: Record<AgentId, AgentId> = {};
  const weighed: Record<AgentId, Record<string, number>> = {};
  const evId = `ev_choosing_${yearOf(w)}`;
  for (const id of voters) {
    const m = w.minds[id]!;
    const options: ActionOption[] = cands.map((cd) => {
      const pull: { name: string; value: number; ref?: string }[] = [];
      if (cd.id === id) pull.push({ name: "it is my own name", value: 0.9 });
      else {
        const o = m.others[cd.id];
        pull.push({ name: "likes and trusts them", value: round(0.9 * ((o?.liking ?? 0.5) - 0.5) + 0.5 * ((o?.trust.benevolence ?? 0.5) - 0.5), 3) });
        const mine = factionOf(w, id);
        if (mine && mine.id === cd.faction) pull.push({ name: "one of ours", value: 0.25 });
        const r = rivalryBetween(w, id, cd.id);
        if (r > 0.05) pull.push({ name: "from the other side", value: round(-0.3 * r, 3) });
      }
      for (const x of interest(w, id, cd.platform)) pull.push({ ...x, name: `the promise: ${x.name}` });
      if (cd.incumbent) {
        pull.push({ name: "the leader they know", value: 0.06 });
        if (hungry) pull.push({ name: "the hungry seasons under them", value: -0.1 * hungry });
        if (sick) pull.push({ name: "the sickness under them", value: -0.06 });
        if (attacked) pull.push({ name: "closing ranks after the raid", value: 0.1 });
      }
      return { id: cd.id, label: `Name ${cd.name}`, verb: `name ${cd.name}`, description: `${cd.name}${cd.factionName ? `, of ${cd.factionName}` : ""}, who promises that ${cd.platform.text}.`, prosocial: 0, assertive: 0, avoidant: 0, disclosure: 0, act: `names ${cd.name}`, pull };
    });
    const pc = eventPercept(m, "world", "circumstance", 0.05, 0.4, ["leader", "choosing", "village", evId], `${w.name} chose who would lead.`, `Spring, and ${w.name} chooses who leads. Standing: ${list(cands.map((x) => `${x.name} (${x.platform.text})`))}. Whom does ${m.name} name?`, evId, cands.map((x) => x.id).filter((x) => x !== id));
    pc.features.prospective = true;
    pc.options = options;
    const { choice } = await choose(w, id, pc, faculties, sink, live);
    const picked = cands.find((x) => x.id === choice) ?? cands[0]!;
    picked.votes++;
    ballots[id] = picked.id;
    const terms = (weighed[picked.id] ??= {});
    for (const x of options.find((o) => o.id === picked.id)!.pull ?? []) terms[x.name] = (terms[x.name] ?? 0) + x.value;
  }
  const ranked = [...cands].sort((a, b) => b.votes - a.votes || Number(!!b.incumbent) - Number(!!a.incumbent) || a.id.localeCompare(b.id));
  const win = ranked[0]!;
  const changed = win.id !== sitting;
  const W = w.minds[win.id]!;
  const blocs = liveFactions(w).map((f) => {
    const mem = f.members.filter((x) => ballots[x]);
    const counts: Record<string, number> = {};
    for (const x of mem) counts[ballots[x]!] = (counts[ballots[x]!] ?? 0) + 1;
    const [who, n] = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [win.id, 0];
    return { faction: f.id, name: f.name, for: who, share: round(n / Math.max(1, mem.length)) };
  });
  // Why it went the way it did: what weighed most with those who named the winner, and what sank the rest.
  const why: Why[] = [{ agent: win.id, text: `${win.votes} of ${voters.length} named ${win.name}${ranked[1] ? `; ${list(ranked.slice(1).map((x) => `${x.votes} ${x.name}`))}` : ""}.` }];
  const top = Object.entries(weighed[win.id] ?? {}).filter(([n]) => n !== "it is my own name").sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, x]) => x > 0.05);
  if (top.length) why.push({ text: `What weighed most with those who named ${W.pronouns.object}: ${list(top.map(([n, x]) => `${n.replace(/^the promise: /, "the promise (") + (n.startsWith("the promise: ") ? ")" : "")} (${x.toFixed(2)} in all)`))}.` });
  why.push({ agent: win.id, episode: win.platform.ref?.startsWith("ep") ? win.platform.ref : undefined, text: `${win.name} promised that ${win.platform.text}. Behind the promise: ${win.platform.because}.` });
  for (const b of blocs.filter((x) => x.share >= 0.6)) why.push({ text: `${cap(b.name)} voted together: ${Math.round(b.share * 100)}% for ${personName(w, b.for)}.` });
  const out = sitting && changed ? cands.find((x) => x.id === sitting) : undefined;
  if (out && hungry) why.push({ agent: out.id, text: `${w.name} went hungry in ${plural(hungry, "season")} of the last year, and that was held against ${out.name}, who led through it.` });
  if (!changed && attacked) why.push({ text: `${w.name} had been raided within the year, and closed ranks around its leader.` });

  const contest: Contest = { tick: w.tick, year: yearOf(w), candidates: ranked, winner: win.id, voters: voters.length, changed, ballots, blocs, why };
  P.contests.push(contest);
  if (P.contests.length > 30) P.contests.splice(0, P.contests.length - 30);
  // Sides that stood and lost count it; the side that won starts again.
  for (const f of liveFactions(w)) {
    if (f.id === win.faction) f.lost = 0;
    else if (cands.some((x) => x.faction === f.id)) f.lost++;
  }
  civic.leader = win.id;
  civic.elections.push({ tick: w.tick, leader: win.id, votes: Object.fromEntries(cands.map((x) => [x.id, x.votes])) });
  if (civic.elections.length > 40) civic.elections.splice(0, civic.elections.length - 40);
  const contested = ranked.length > 1 && ranked[1]!.votes > 0;
  const title = changed ? `${win.name} is chosen to lead ${w.name}${out ? ` over ${out.name}` : ""}` : `${win.name} keeps the lead of ${w.name}`;
  feed(w, sink, { kind: "event", place: "tavern", agents: ranked.map((x) => x.id), title, text: why.map((x) => x.text).join(" "), chronicle: changed || (contested && win.votes < voters.length * 0.5) ? { kind: changed ? "leader" : "election", why } : undefined });
  note(w, { kind: "election", title, agents: ranked.map((x) => x.id), why });
  // What was never written down goes with whoever made it, unless the new leader wants it too.
  if (changed && sitting) lapse(w, sitting, win.id, sink);
  P.mandate = { leader: win.id, issue: win.platform.issue, text: win.platform.text, tick: w.tick, target: win.platform.target };
  await enact(w, win.id, win.platform, faculties, sink, live, contest);
  return contest;
}

function lapse(w: WorldState, was: AgentId, now: AgentId, sink: Sink): void {
  const issueOf: Partial<Record<Law["kind"], Issue>> = { fair_price: "fair_price", closed_landing: "close" };
  for (const law of civicOf(w.village!).laws) {
    const issue = issueOf[law.kind];
    if (!issue || !law.passed || law.repealed || law.author !== was) continue;
    if (isWritten(w, "law", law.id)) continue;
    if (sum(interest(w, now, { issue })) > 0) {
      law.author = now;
      continue;
    }
    law.passed = false;
    law.repealed = w.tick;
    const why: Why[] = [{ agent: was, text: `${cap(LAW_NAME[law.kind])} was ${personName(w, was)}'s, made in year ${yearOf({ ...w, tick: law.tick })}, and was never written down: it stood on ${w.minds[was]?.pronouns.possessive ?? "their"} say-so.` }, { agent: now, text: `${personName(w, now)}, who leads now, has no wish to keep it.` }];
    feed(w, sink, { kind: "event", place: "tavern", agents: [now, was], title: `${cap(LAW_NAME[law.kind])} is let drop in ${w.name}`, text: why.map((x) => x.text).join(" "), chronicle: { kind: "law", why } });
    note(w, { kind: "law", title: `${cap(LAW_NAME[law.kind])} is let drop`, agents: [now, was], why });
  }
}

/** The leader puts a promise to the town, and it is done or it fails. */
async function enact(w: WorldState, leader: AgentId, p: Platform, faculties: Faculties, sink: Sink, live: boolean, contest?: Contest, spur?: Why): Promise<boolean> {
  const c = civOf(w)!;
  const P = c.polity;
  const done = (ok: boolean) => {
    if (P.mandate && P.mandate.leader === leader && P.mandate.issue === p.issue) P.mandate[ok ? "done" : "failed"] = w.tick;
    return ok;
  };
  if (p.issue === "steady") return done(true);
  if (p.issue === "war" || p.issue === "peace") {
    if (p.target) P.stance[p.target] = p.issue;
    return done(true);
  }
  const L = w.minds[leader]!;
  const kind = LAW_OF[p.issue] ?? REPEALS[p.issue]!;
  const repeal = !!REPEALS[p.issue];
  const standing = lawOf(w, kind);
  if (repeal ? !standing : !!standing && kind !== "jubilee") return done(true);
  // The town votes: each with what it would do for them, how they take to the leader, and whether they named them.
  const votes = { for: [] as AgentId[], against: [] as AgentId[] };
  for (const id of grownOf(w)) {
    if (id === leader) {
      votes.for.push(id);
      continue;
    }
    const s = 0.45 * (w.minds[id]!.others[leader]?.liking ?? 0.5) + sum(interest(w, id, p)) + (contest?.ballots[id] === leader ? 0.3 : 0);
    (s > 0.42 ? votes.for : votes.against).push(id);
  }
  const passed = votes.for.length > votes.against.length;
  const text = `${cap(p.text)}.`;
  const why: Why[] = [{ agent: leader, episode: p.ref?.startsWith("ep") ? p.ref : undefined, text: contest ? `${L.name} was chosen to lead on the promise that ${p.text}. Behind the promise: ${p.because}.` : `${L.name}, who leads ${w.name}, put it to the town. ${cap(p.because)}.` }];
  if (spur) why.push(spur);
  why.push({ text: `${votes.for.length} for, ${votes.against.length} against.` });
  const name = LAW_NAME[kind];
  let title: string;
  if (repeal) {
    title = passed ? `${w.name} strikes down ${name}` : `${w.name} keeps ${name}`;
    if (passed && standing) {
      standing.passed = false;
      standing.repealed = w.tick;
    }
  } else {
    title = passed ? (kind === "jubilee" ? `${w.name} wipes every debt clean` : `${w.name} makes ${name.replace(/^the /, "a ")}${kind === "store_minimum" ? "" : " law"}`.replace("a closed landing law", "a law closing its landing")) : `${w.name} votes down ${L.name}'s ${name.replace(/^the /, "")}`;
    const law: Law = { id: nextId(w, "law"), text, kind, rate: kind === "store_minimum" ? 0.25 : 0, author: leader, tick: w.tick, votes, passed, because: { norm: kind === "store_minimum" ? storeNorm(w.village!).id : "", round: w.village!.pledges.length - 1, held: [] }, compelled: [], why };
    civicOf(w.village!).laws.push(law);
    if (passed && kind === "jubilee") await cleanSlate(w, leader, law, faculties, sink, live);
  }
  feed(w, sink, { kind: "event", place: "tavern", agents: [leader], title, lines: [{ speaker: leader, text }], text: why.map((x) => x.text).join(" "), chronicle: { kind: "law", why } });
  note(w, { kind: "law", title, text, agents: [leader], why });
  // Those on the losing side of the vote hold it a little against whoever asked for it.
  for (const id of passed ? votes.against : []) {
    const o = w.minds[id]!.others[leader];
    if (o) o.liking = round(clamp(o.liking - 0.02), 3);
  }
  return done(passed);
}

/** Every open debt is struck out. Those who owed are free; those who were owed remember who did it. */
async function cleanSlate(w: WorldState, leader: AgentId, law: Law, faculties: Faculties, sink: Sink, live: boolean): Promise<void> {
  const debts = openDebts(w);
  const L = personName(w, leader);
  const lost: Record<AgentId, number> = {};
  const freed: Record<AgentId, number> = {};
  for (const d of debts) {
    d.repaid = w.tick;
    d.forgiven = w.tick;
    lost[d.creditor] = (lost[d.creditor] ?? 0) + d.amount;
    freed[d.debtor] = (freed[d.debtor] ?? 0) + d.amount;
  }
  for (const [id, amount] of Object.entries(lost)) {
    civOf(w)!.economy.wiped[id] = w.tick;
    const m = w.minds[id];
    if (!m || !w.order.includes(id) || id === leader) continue;
    let episode: string | undefined;
    if (live) {
      const pc = eventPercept(m, leader, "other", -0.35, 0.55, ["debt", "law", "fairness", law.id], `${L}'s law wiped out the ${round(amount, 1)} food I was owed.`, `Under ${L}'s clean slate, the ${round(amount, 1)} food owed to ${m.name} will never be paid.`, `${law.id}_lost`, [leader]);
      pc.features.intentional = 0.9;
      pc.features.normViolation = 0.4;
      episode = (await witness(w, [id], () => pc, faculties, sink))[id];
    } else {
      const o = m.others[leader];
      if (o) {
        o.liking = round(clamp(o.liking - 0.1), 3);
        o.trust.integrity = round(clamp(o.trust.integrity - 0.08), 3);
      }
    }
    wrong(w, id, leader, 0.08, `${L}'s clean slate wiped out what ${m.name} was owed`, episode);
  }
  for (const id of Object.keys(freed)) {
    const o = w.minds[id]?.others[leader];
    if (o && w.order.includes(id)) o.liking = round(clamp(o.liking + 0.08), 3);
  }
  law.why?.push({ text: `${plural(debts.length, "debt")} struck out: ${Object.keys(freed).length} who owed went free, ${Object.keys(lost).length} who were owed went without.` });
}

/** Between elections: a leader may answer a hard season with a law. */
export async function politySeason(w: WorldState, faculties: Faculties, sink: Sink, live: boolean): Promise<void> {
  const c = civOf(w);
  const leader = w.village!.civic?.leader;
  if (!c || !leader || !w.order.includes(leader) || ageOf(w, leader) < 16) return;
  const season = w.village!.seasonDays * DAY;
  const fresh = c.economy.gouges.filter((g) => w.tick - g.tick < season * 1.1);
  if (fresh.length >= 2 && !lawInForce(w, "fair_price") && !gouger(w, leader)) {
    const laws = civicOf(w.village!).laws;
    if (laws.some((l) => l.kind === "fair_price" && w.tick - l.tick < 2 * yearTicks(w))) return;
    const L = w.minds[leader]!;
    const evId = `ev_dear_${w.tick}`;
    const pc = eventPercept(L, "world", "circumstance", -0.1, 0.5, ["price", "food", "market", "fairness", "law", evId], `Sellers asked more for food while ${w.name} was short.`, `${plural(fresh.length, "household")} asked more than the old price for food at the last market, with others short. ${L.name} leads ${w.name}. Does ${L.pronouns.subject} put a law to the town?`, evId, fresh.map((g) => g.seller));
    pc.features.prospective = true;
    pc.options = [
      { id: "law", label: "Put a fair price law to the town", verb: "put a fair price law to the town", description: "Nobody asks more for food in a hungry season than it has always cost.", prosocial: 0.5, assertive: 0.5, avoidant: 0, disclosure: 0.2, act: "puts a fair price law to the town", pull: interest(w, leader, { issue: "fair_price" }) },
      { id: "leave", label: "Leave the market be", verb: "leave the market be", description: "People may ask what they like for what is theirs.", prosocial: -0.1, assertive: 0, avoidant: 0.4, disclosure: 0, act: "leaves the market be", pull: [{ name: "chafes at rules", value: 0.3 * (0.5 - L.needs.autonomy) + 0.1 }] },
    ];
    const { choice, trace } = await choose(w, leader, pc, faculties, sink, live);
    if (choice !== "law") return;
    const worst = fresh.sort((a, b) => b.buyers.length - a.buyers.length)[0]!;
    await enact(w, leader, { issue: "fair_price", text: promise(w, "fair_price"), because: `${plural(fresh.length, "seller")} asked more for food at the last market`, ref: trace }, faculties, sink, live, undefined, { agent: worst.seller, text: `${personName(w, worst.seller)} asked ${Math.round((worst.price / worst.ref - 1) * 100)}% over the old price of ${plural(worst.buyers.length, "household")}.` });
  }
}

// ---------------------------------------------------------------- reading it

export interface PolityView {
  leader?: { id: AgentId; name: string; since: number; faction?: string };
  mandate?: Polity["mandate"];
  contests: (Omit<Contest, "ballots">)[];
  laws: { id: string; kind: string; name: string; text: string; author: AgentId; authorName: string; year: number; for: number; against: number; inForce: boolean; repealed?: number; written: boolean; why?: Why[] }[];
  stance: { town: string; name: string; stance: string }[];
}

export function polityView(w: WorldState): PolityView | undefined {
  const c = civOf(w);
  if (!c) return undefined;
  const civic = civicOf(w.village!);
  const year = (t: Tick) => yearOf({ ...w, tick: t });
  const leader = civic.leader;
  let since = w.tick;
  for (const e of [...civic.elections].reverse()) {
    if (e.leader !== leader) break;
    since = e.tick;
  }
  return {
    leader: leader ? { id: leader, name: personName(w, leader), since: year(since), faction: factionOf(w, leader)?.name } : undefined,
    mandate: c.polity.mandate,
    contests: c.polity.contests.slice(-6).map(({ ballots: _b, ...rest }) => rest),
    laws: civic.laws.slice(-12).map((l) => ({ id: l.id, kind: l.kind, name: LAW_NAME[l.kind], text: l.text, author: l.author, authorName: personName(w, l.author), year: year(l.tick), for: l.votes.for.length, against: l.votes.against.length, inForce: l.passed && !l.repealed && l.kind !== "jubilee", repealed: l.repealed ? year(l.repealed) : undefined, written: isWritten(w, "law", l.id), why: l.why })),
    stance: Object.entries(c.polity.stance).map(([town, stance]) => ({ town, name: c.abroad[town]?.name ?? town, stance })),
  };
}
