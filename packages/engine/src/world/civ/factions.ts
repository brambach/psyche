// Factions. Nobody founds one. A faction here is a set of households who like each other and not
// the rest, found by looking at who actually likes whom, and named afterwards for whatever its
// members turn out to share: a family, a trade, having come late, a faith, owing or being owed.
//
// Once people can be told apart as "us" and "them", they start to treat each other that way
// (Tajfel & Turner 1979: categorisation alone is enough for in-group favour), and it sharpens when
// there is something to compete for (Sherif 1961, realistic conflict): a hungry season, a debt
// across the line, a price raised on the other side, an election lost. A wrong done by one of
// them is held against all of them. It eases when both sides have a common task or a common
// enemy (Sherif's superordinate goals): raising a hall together, being raided.
//
// What factions then do: vote as blocs (polity.ts), fight at the fire, and when one has lost and
// can no longer stand the rest, leave together (migration.ts), which is how most towns are founded.

import { clamp, render } from "../../memory.js";
import type { Faculties } from "../../ports.js";
import type { AgentId, Tick } from "../../types.js";
import { ageOf, die, yearOf } from "../life.js";
import { openDebts } from "../money.js";
import type { Household } from "../village.js";
import { eventPercept, feed, luck, personName, type Sink, type Why, type WorldState } from "../world.js";
import { cap, civOf, DAY, hhOf, homesOf, mean, note, plural, recent, round, surnameOf, witness, yearTicks } from "./base.js";

export interface Grievance {
  tick: Tick;
  culprit: AgentId;
  victim: AgentId;
  text: string;
  /** The victim's own memory of it, when they have one. */
  episode?: string;
  /** The faction the culprit belonged to ("town" for the rest of the town). */
  against: string;
}

export interface Faction {
  id: string;
  name: string;
  basis: "kin" | "trade" | "latecomers" | "old families" | "faith" | "debt" | "following";
  /** What its members share, in words. */
  shares: string;
  head: AgentId;
  households: string[];
  /** Its grown members. */
  members: AgentId[];
  founded: Tick;
  ended?: Tick;
  /** How much its members like each other, and the rest of the town (0.5 is indifferent). */
  inner: number;
  outer: number;
  grievances: Grievance[];
  why: Why[];
  /** Elections lost in a row. */
  lost: number;
}

export interface FactionState {
  factions: Faction[];
  /** Which faction each household is in. */
  of: Record<string, string>;
  /** How hard two factions are set against each other, 0 to 1, keyed `a|b` in id order ("town" is everyone else). */
  rivalry: Record<string, number>;
  /** Wrongs across a line since the last reckoning, added to rivalry when the season turns. */
  bumps: Record<string, number>;
  brawls: { tick: Tick; a: AgentId; b: AgentId; factions: [string, string]; text: string; dead?: AgentId }[];
  /** A faction that means to leave, and why. */
  exit?: { faction: string; since: Tick; reason: string };
  n: number;
}

export const newFactions = (): FactionState => ({ factions: [], of: {}, rivalry: {}, bumps: {}, brawls: [], n: 0 });

const stateOf = (w: WorldState): FactionState | undefined => civOf(w)?.factions;
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const liveFactions = (w: WorldState): Faction[] => (stateOf(w)?.factions ?? []).filter((f) => !f.ended);

/** The faction someone belongs to, through their household. */
export function factionOf(w: WorldState, id: AgentId): Faction | undefined {
  const S = stateOf(w);
  const hh = S && hhOf(w, id);
  const fid = hh && S.of[hh.id];
  return fid ? S.factions.find((f) => f.id === fid && !f.ended) : undefined;
}

/** How hard two people's factions are set against each other (0 when they share one, or there are none). */
export function rivalryBetween(w: WorldState, a: AgentId, b: AgentId): number {
  const S = stateOf(w);
  if (!S) return 0;
  const fa = factionOf(w, a)?.id ?? "town";
  const fb = factionOf(w, b)?.id ?? "town";
  if (fa === fb) return 0;
  return S.rivalry[key(fa, fb)] ?? 0;
}

/** The most a faction is set against anyone. */
export function tension(w: WorldState, f: Faction): number {
  const S = stateOf(w)!;
  return Math.max(0, ...Object.entries(S.rivalry).filter(([k]) => k.split("|").includes(f.id)).map(([, v]) => v));
}

/**
 * Something one person did to another, as it bears on factions: if they stand on different sides,
 * it is held against the culprit's whole side.
 */
export function wrong(w: WorldState, victim: AgentId, culprit: AgentId, weight: number, text: string, episode?: string): void {
  const S = stateOf(w);
  if (!S) return;
  const fv = factionOf(w, victim);
  const fc = factionOf(w, culprit);
  if (!fv && !fc) return;
  if (fv?.id === fc?.id) return;
  const k = key(fv?.id ?? "town", fc?.id ?? "town");
  S.bumps[k] = (S.bumps[k] ?? 0) + weight;
  if (fv) {
    fv.grievances.push({ tick: w.tick, culprit, victim, text, episode, against: fc?.id ?? "town" });
    if (fv.grievances.length > 12) fv.grievances.splice(0, fv.grievances.length - 12);
  }
}

/** Both sides had something to pull together on: every line in town eases. */
export function ease(w: WorldState, by: number): void {
  const S = stateOf(w);
  if (!S) return;
  for (const k of Object.keys(S.rivalry)) S.rivalry[k] = round(clamp(S.rivalry[k]! - by));
}

// ---------------------------------------------------------------- finding them

const GROUP: Record<string, string> = { fisher: "sea", farmer: "land", forager: "land", woodcutter: "cut", quarrier: "cut", thatcher: "cut", builder: "cut", potter: "craft", weaver: "craft", smith: "craft", healer: "craft", merchant: "craft", scribe: "craft" };
const GROUP_NAME: Record<string, string> = { sea: "the boat crews", land: "the field hands", cut: "the cutters and builders", craft: "the craft folk" };
const LATE_YEARS = 8;

const grown = (w: WorldState, h: Household) => h.members.filter((x) => w.order.includes(x) && ageOf(w, x) >= 16);
const isLate = (w: WorldState, id: AgentId) => {
  const l = w.village!.life[id];
  return l?.arrived !== undefined && w.tick - l.arrived < LATE_YEARS * yearTicks(w);
};

/** Mutual liking between two sets of people, over the pairs who know each other; undefined when none do. */
function likingBetween(w: WorldState, as: AgentId[], bs: AgentId[]): number | undefined {
  let sum = 0;
  let n = 0;
  for (const a of as)
    for (const b of bs) {
      if (a === b) continue;
      const x = w.minds[a]!.others[b]?.liking;
      const y = w.minds[b]!.others[a]?.liking;
      if (x === undefined && y === undefined) continue;
      sum += ((x ?? y)! + (y ?? x)!) / 2;
      n++;
    }
  return n ? sum / n : undefined;
}

function affinity(w: WorldState, H: Household, G: Household, faithOf: (id: AgentId) => string | undefined): number {
  const v = w.village!;
  const hs = grown(w, H);
  const gs = grown(w, G);
  let a = (likingBetween(w, hs, gs) ?? 0.5) - 0.5;
  const kin = hs.some((x) => gs.some((y) => v.life[x]?.parents.includes(y) || v.life[y]?.parents.includes(x) || v.life[x]?.partner === y));
  if (kin) a += 0.2;
  const group = (xs: AgentId[]) => {
    const counts: Record<string, number> = {};
    for (const x of xs) counts[GROUP[w.agents[x]!.role] ?? "other"] = (counts[GROUP[w.agents[x]!.role] ?? "other"] ?? 0) + 1;
    return Object.entries(counts).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))[0]?.[0];
  };
  if (group(hs) && group(hs) === group(gs) && group(hs) !== "other") a += 0.05;
  const lateH = hs.length > 0 && hs.every((x) => isLate(w, x));
  const lateG = gs.length > 0 && gs.every((x) => isLate(w, x));
  a += lateH === lateG ? (lateH ? 0.1 : 0.02) : -0.06;
  const fh = hs.map(faithOf).find(Boolean);
  if (fh && gs.some((y) => faithOf(y) === fh)) a += 0.12;
  if (openDebts(w).some((d) => d.overdue && ((H.members.includes(d.creditor) && G.members.includes(d.debtor)) || (G.members.includes(d.creditor) && H.members.includes(d.debtor))))) a -= 0.2;
  return a;
}

/** What a set of households shares more than the town does: the faction's name. */
function nameFor(w: WorldState, members: AgentId[], head: AgentId, taken: Set<string>, faithOf: (id: AgentId) => string | undefined): { name: string; basis: Faction["basis"]; shares: string } {
  const n = members.length;
  const share = (f: (id: AgentId) => boolean) => members.filter(f).length / n;
  const out: { name: string; basis: Faction["basis"]; shares: string }[] = [];
  const surnames: Record<string, number> = {};
  for (const x of members) surnames[surnameOf(w, x)] = (surnames[surnameOf(w, x)] ?? 0) + 1;
  const [sn, sc] = Object.entries(surnames).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ["", 0];
  if (sc >= 3 && sc / n >= 0.5) out.push({ name: `the ${sn} kin`, basis: "kin", shares: `${sc} of its ${n} grown members are ${sn}s by birth` });
  const all = w.order.filter((x) => ageOf(w, x) >= 16);
  const lateTown = all.filter((x) => isLate(w, x)).length / Math.max(1, all.length);
  if (share((x) => isLate(w, x)) >= 0.6) out.push({ name: "the latecomers", basis: "latecomers", shares: `most of them came to ${w.name} within the last ${LATE_YEARS} years` });
  else if (lateTown >= 0.2 && share((x) => isLate(w, x)) === 0) out.push({ name: "the old families", basis: "old families", shares: `none of them is among the ${Math.round(lateTown * 100)}% of the town who came lately` });
  const faiths: Record<string, number> = {};
  for (const x of members) {
    const f = faithOf(x);
    if (f) faiths[f] = (faiths[f] ?? 0) + 1;
  }
  const [fid, fc] = Object.entries(faiths).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const faith = w.voice?.faiths.find((f) => f.id === fid);
  if (faith && fc / n >= 0.6) out.push({ name: `the faithful of ${faith.name}`, basis: "faith", shares: `${fc} of ${n} keep ${faith.name}` });
  for (const [g, label] of Object.entries(GROUP_NAME)) if (share((x) => GROUP[w.agents[x]!.role] === g) >= 0.65) out.push({ name: label, basis: "trade", shares: `most of them are ${label.replace(/^the /, "")}` });
  const debts = openDebts(w);
  if (share((x) => debts.some((d) => d.debtor === x)) >= 0.45) out.push({ name: "those who owe", basis: "debt", shares: "nearly half of them owe food to someone in town" });
  else if (share((x) => debts.some((d) => d.creditor === x)) >= 0.45) out.push({ name: "those who are owed", basis: "debt", shares: "nearly half of them are owed food by someone in town" });
  const hn = personName(w, head);
  out.push({ name: `${hn}'s people`, basis: "following", shares: `they look to ${hn}` });
  return out.find((o) => !taken.has(o.name)) ?? { ...out.at(-1)!, name: `${hn}'s following` };
}

/** The member the others like most, weighed a little by how readily they speak up. */
function headFor(w: WorldState, members: AgentId[]): AgentId {
  return [...members]
    .filter((x) => ageOf(w, x) >= 18)
    .map((x) => ({ x, s: mean(members.filter((o) => o !== x).map((o) => w.minds[o]!.others[x]?.liking ?? 0.5)) + 0.15 * w.minds[x]!.traits.extraversion + Math.min(ageOf(w, x), 60) / 600 }))
    .sort((a, b) => b.s - a.s || a.x.localeCompare(b.x))[0]?.x ?? members[0]!;
}

/**
 * Twice a year: read the town's factions off who likes whom. Households are the units (a household
 * stands together), each drifts toward the households it is closest to, and a group counts as a
 * faction when its members like each other clearly more than they like the rest.
 */
export function findFactions(w: WorldState, sink: Sink): void {
  const S = stateOf(w);
  if (!S) return;
  const homes = homesOf(w).filter((h) => grown(w, h).length).sort((a, b) => a.id.localeCompare(b.id));
  const adults = homes.flatMap((h) => grown(w, h));
  const faithOf = (id: AgentId) => w.voice?.faiths.find((f) => !f.ended && f.members.includes(id))?.id;
  const end = (f: Faction, text: string) => {
    f.ended = w.tick;
    for (const h of f.households) if (S.of[h] === f.id) delete S.of[h];
    for (const k of Object.keys(S.rivalry)) if (k.split("|").includes(f.id)) delete S.rivalry[k];
    if (S.exit?.faction === f.id) S.exit = undefined;
    feed(w, sink, { kind: "event", agents: [f.head], title: `${cap(f.name)} are no longer a party of their own in ${w.name}`, text });
    note(w, { kind: "faction", title: `${cap(f.name)} dissolve`, text });
  };
  if (adults.length < 12 || homes.length < 5) {
    for (const f of liveFactions(w)) end(f, `${w.name} is too small now for sides.`);
    return;
  }
  const n = homes.length;
  const A: number[][] = homes.map(() => new Array<number>(n).fill(0));
  let total = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = affinity(w, homes[i]!, homes[j]!, faithOf);
      A[i]![j] = a;
      A[j]![i] = a;
      total += a;
    }
  const avg = total / Math.max(1, (n * (n - 1)) / 2);
  const size = homes.map((h) => Math.sqrt(grown(w, h).length));
  const label = homes.map((h) => {
    const f = S.of[h.id];
    return f && S.factions.some((x) => x.id === f && !x.ended) ? f : `h:${h.id}`;
  });
  // A side that most of the town belongs to is no side at all: a group stops drawing households in
  // once it holds half the grown people, and those left outside it are left to find each other.
  const heads = homes.map((h) => grown(w, h).length);
  const most = adults.length * 0.5;
  const weight: Record<string, number> = {};
  label.forEach((l, i) => (weight[l] = (weight[l] ?? 0) + heads[i]!));
  for (let round_ = 0; round_ < 8; round_++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const scores: Record<string, number> = {};
      for (let j = 0; j < n; j++) if (j !== i) scores[label[j]!] = (scores[label[j]!] ?? 0) + (A[i]![j]! - avg) * size[j]!;
      const [best, s] = Object.entries(scores)
        .filter(([l]) => l === label[i] || (weight[l] ?? 0) + heads[i]! <= most)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ["", 0];
      const own = scores[label[i]!] ?? 0;
      if (best && best !== label[i] && s > 0.03 && s > own + 0.01) {
        weight[label[i]!] = (weight[label[i]!] ?? 0) - heads[i]!;
        weight[best] = (weight[best] ?? 0) + heads[i]!;
        label[i] = best;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const clusters = new Map<string, number[]>();
  label.forEach((l, i) => clusters.set(l, [...(clusters.get(l) ?? []), i]));
  const found: { households: string[]; members: AgentId[]; inner: number; outer: number }[] = [];
  for (const idx of clusters.values()) {
    const members = idx.flatMap((i) => grown(w, homes[i]!));
    if (idx.length < 2 || members.length < Math.max(4, adults.length * 0.15) || members.length > adults.length * 0.7) continue;
    const rest = adults.filter((x) => !members.includes(x));
    // Liking inside, across households (everyone likes their own kitchen).
    const pairs: number[] = [];
    for (let p = 0; p < idx.length; p++) for (let q = p + 1; q < idx.length; q++) pairs.push(likingBetween(w, grown(w, homes[idx[p]!]!), grown(w, homes[idx[q]!]!)) ?? 0.5);
    const inner = mean(pairs);
    const outer = likingBetween(w, members, rest) ?? 0.5;
    // A side takes a clear gap to form; once it exists, it takes less to go on being one.
    const hh = idx.map((i) => homes[i]!.id);
    const standing = liveFactions(w).some((f) => f.households.filter((h) => hh.includes(h)).length / new Set([...f.households, ...hh]).size >= 0.34);
    if (inner - outer < (standing ? 0.02 : 0.06)) continue;
    found.push({ households: hh, members, inner: round(inner), outer: round(outer) });
  }
  // Match what was found to the factions already there, by the households they share.
  const before = liveFactions(w);
  const kept = new Set<string>();
  const taken = new Set(before.map((f) => f.name));
  for (const c of found.sort((a, b) => b.members.length - a.members.length)) {
    const match = before
      .filter((f) => !kept.has(f.id))
      .map((f) => ({ f, j: f.households.filter((h) => c.households.includes(h)).length / new Set([...f.households, ...c.households]).size }))
      .sort((a, b) => b.j - a.j)[0];
    if (match && match.j >= 0.34) {
      const f = match.f;
      kept.add(f.id);
      f.households = c.households;
      f.members = c.members;
      f.inner = c.inner;
      f.outer = c.outer;
      if (!c.members.includes(f.head)) {
        const was = f.head;
        f.head = headFor(w, c.members);
        if (f.basis === "following") {
          f.name = `${personName(w, f.head)}'s people`;
          f.shares = `they look to ${personName(w, f.head)}`;
        }
        feed(w, sink, { kind: "event", agents: [f.head], title: `${cap(f.name)} now look to ${personName(w, f.head)}`, text: `${personName(w, was)} is ${w.order.includes(was) ? "no longer among them" : "gone"}.` });
      }
      continue;
    }
    const head = headFor(w, c.members);
    const nm = nameFor(w, c.members, head, taken, faithOf);
    taken.add(nm.name);
    const rest = adults.filter((x) => !c.members.includes(x));
    const why: Why[] = [{ text: `${plural(c.households.length, "household")} in ${w.name} (${c.members.length} grown people) like each other (${c.inner.toFixed(2)}, where 0.5 is indifferent) more than they like the rest (${c.outer.toFixed(2)}).` }, { agent: head, text: `What they share: ${nm.shares}. ${personName(w, head)} is the one the others like most.` }];
    // The sharpest thing anyone inside holds against anyone outside.
    let worst: { a: AgentId; b: AgentId; l: number } | undefined;
    for (const a of c.members) for (const b of rest) {
      const l = w.minds[a]!.others[b]?.liking;
      if (l !== undefined && (!worst || l < worst.l)) worst = { a, b, l };
    }
    if (worst && worst.l < 0.42) {
      const mem = w.minds[worst.a]!.episodes.filter((e) => e.about.includes(worst!.b) && e.valence < 0).sort((x, y) => x.valence - y.valence)[0];
      why.push({ agent: worst.a, episode: mem?.id, text: `${personName(w, worst.a)} thinks least of ${personName(w, worst.b)} (${worst.l.toFixed(2)})${mem ? `, remembering: “${render(mem).replace(/[.\s]+$/, "")}”` : ""}.` });
    }
    const f: Faction = { id: `fac_${++S.n}`, name: nm.name, basis: nm.basis, shares: nm.shares, head, households: c.households, members: c.members, founded: w.tick, inner: c.inner, outer: c.outer, grievances: [], why, lost: 0 };
    S.factions.push(f);
    kept.add(f.id);
    feed(w, sink, { kind: "insight", agents: [head, ...c.members.filter((x) => x !== head).slice(0, 5)], title: `${w.name} has sides now: ${f.name}`, text: why.map((x) => x.text).join(" "), chronicle: { kind: "faction", why } });
    note(w, { kind: "faction", title: `${cap(f.name)} form in ${w.name}`, agents: [head], why });
  }
  for (const f of before) if (!kept.has(f.id)) end(f, `Its households no longer like each other more than they like everyone else.`);
  S.of = {};
  for (const f of liveFactions(w)) for (const h of f.households) S.of[h] = f.id;
  if (S.factions.length > 40) S.factions = [...S.factions.filter((f) => f.ended).slice(-20), ...S.factions.filter((f) => !f.ended)];
}

// ---------------------------------------------------------------- what they do to each other

/** Each season: rivalries are reckoned, sides treat each other as sides, and sometimes it comes to blows. */
export async function factionsSeason(w: WorldState, faculties: Faculties, sink: Sink, live: boolean): Promise<void> {
  const S = stateOf(w);
  if (!S) return;
  const v = w.village!;
  if (v.season === "spring" || v.season === "autumn" || !S.factions.length) findFactions(w, sink);
  const fs = liveFactions(w);
  if (!fs.length) {
    S.rivalry = {};
    S.bumps = {};
    return;
  }
  const c = civOf(w)!;
  const season = v.seasonDays * DAY;
  // A debt that went unpaid across a line this season is a wrong done by one side to the other.
  for (const d of openDebts(w)) if (d.overdue && w.tick - d.overdue < season && w.order.includes(d.creditor) && w.order.includes(d.debtor)) wrong(w, d.creditor, d.debtor, 0.06, `${personName(w, d.debtor)} never paid ${personName(w, d.creditor)} back`, w.minds[d.creditor]!.episodes.find((e) => e.id === `ev_${d.id}_due`)?.id);
  const adults = w.order.filter((x) => ageOf(w, x) >= 16);
  const rest = adults.filter((x) => !factionOf(w, x));
  const sides: { id: string; members: AgentId[] }[] = [...fs.map((f) => ({ id: f.id, members: f.members.filter((x) => w.order.includes(x)) })), ...(rest.length >= 3 ? [{ id: "town", members: rest }] : [])];
  const lean = v.store.food / Math.max(1, w.order.length) < 2;
  const eased = recent(w, c.marks.raided, 1) > 0 ? 0.12 : 0;
  const next: Record<string, number> = {};
  for (let i = 0; i < sides.length; i++)
    for (let j = i + 1; j < sides.length; j++) {
      const a = sides[i]!;
      const b = sides[j]!;
      const k = key(a.id, b.id);
      const cross = likingBetween(w, a.members, b.members) ?? 0.5;
      const base = clamp((0.5 - cross) * 3 + 0.15);
      next[k] = round(clamp(0.6 * (S.rivalry[k] ?? base * 0.5) + 0.4 * base + (S.bumps[k] ?? 0) + (lean ? 0.04 : 0) - eased));
    }
  S.rivalry = next;
  S.bumps = {};
  // Us and them: a little warmer to one's own, a little colder to the other side, the more so the harder the line.
  for (const f of fs) {
    for (const id of f.members) {
      const m = w.minds[id];
      if (!m || !w.order.includes(id)) continue;
      const own = m.others[f.head];
      if (own && id !== f.head) own.liking = round(clamp(own.liking + 0.008), 3);
      // People on a side see more of each other, and it shows.
      for (let s = 0; s < 3; s++) {
        const mate = f.members[Math.floor(luck(w, "us", id, s) * f.members.length)]!;
        const o = mate !== id ? m.others[mate] : undefined;
        if (o) o.liking = round(clamp(o.liking + 0.03 * (0.85 - o.liking)), 3);
      }
      for (const g of sides) {
        if (g.id === f.id || !g.members.length) continue;
        const r = S.rivalry[key(f.id, g.id)] ?? 0;
        if (r < 0.3) continue;
        for (let s = 0; s < 2; s++) {
          const o = m.others[g.members[Math.floor(luck(w, "them", id, g.id, s) * g.members.length)]!];
          if (!o) continue;
          o.liking = round(clamp(o.liking - 0.015 * r), 3);
          o.trust.benevolence = round(clamp(o.trust.benevolence - 0.01 * r), 3);
        }
      }
    }
  }
  // Blows at the fire, where a line has hardened.
  const year = yearTicks(w);
  for (let i = 0; i < fs.length; i++)
    for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i]!;
      const b = fs[j]!;
      const k = key(a.id, b.id);
      const r = S.rivalry[k] ?? 0;
      if (r < 0.7 || S.brawls.some((x) => w.tick - x.tick < year && key(x.factions[0], x.factions[1]) === k)) continue;
      if (luck(w, "brawl", k) > 0.35) continue;
      await brawl(w, a, b, faculties, sink, live);
    }
  // A side that has lost and can no longer stand the rest starts to talk of leaving.
  const leader = v.civic?.leader;
  const ruling = leader && w.order.includes(leader) ? (factionOf(w, leader)?.id ?? "town") : undefined;
  if (S.exit && (!fs.some((f) => f.id === S.exit!.faction) || (S.rivalry[key(S.exit.faction, ruling ?? "town")] ?? 0) < 0.45)) S.exit = undefined;
  if (!S.exit && ruling) {
    const out = fs
      .filter((f) => f.id !== ruling && f.lost >= 1 && f.members.length >= 5 && f.members.length <= adults.length * 0.5)
      .map((f) => ({ f, r: S.rivalry[key(f.id, ruling)] ?? 0 }))
      .sort((x, y) => y.r - x.r)[0];
    if (out && out.r >= 0.6) {
      const g = out.f.grievances.at(-1);
      S.exit = { faction: out.f.id, since: w.tick, reason: g ? g.text : `they lost the choosing of a leader ${out.f.lost === 1 ? "once" : `${out.f.lost} times running`}` };
      feed(w, sink, { kind: "insight", agents: [out.f.head], title: `${cap(out.f.name)} talk of leaving ${w.name}`, text: `They have lost ${plural(out.f.lost, "election")} running and the line between them and ${ruling === "town" ? "the rest of the town" : fs.find((x) => x.id === ruling)?.name} is hard (${out.r.toFixed(2)}).${g ? ` Most on their minds: ${g.text}.` : ""}` });
    }
  }
  if (S.brawls.length > 30) S.brawls.splice(0, S.brawls.length - 30);
}

async function brawl(w: WorldState, a: Faction, b: Faction, faculties: Faculties, sink: Sink, live: boolean): Promise<void> {
  const S = stateOf(w)!;
  const v = w.village!;
  const hot = (f: Faction) =>
    f.members
      .filter((x) => w.order.includes(x) && ageOf(w, x) < 60)
      .sort((x, y) => heat(w, y) - heat(w, x) || x.localeCompare(y))[0];
  const x = hot(a);
  const y = hot(b);
  if (!x || !y) return;
  const X = w.minds[x]!;
  const Y = w.minds[y]!;
  const g = [...a.grievances, ...b.grievances].sort((p, q) => q.tick - p.tick)[0];
  const evId = `ev_brawl_${w.tick}_${x}`;
  for (const [p, q] of [[X, Y], [Y, X]] as const) {
    const o = p.others[q.id];
    if (o) {
      o.liking = round(clamp(o.liking - 0.2), 3);
      o.trust.benevolence = round(clamp(o.trust.benevolence - 0.15), 3);
    }
    p.needs.energy = clamp(p.needs.energy - 0.1);
  }
  // A blow can kill. Rarely.
  const loser = X.needs.energy + luck(w, "blow", x) * 0.4 < Y.needs.energy + luck(w, "blow", y) * 0.4 ? x : y;
  const dead = luck(w, "blow-kills", x, y) < 0.05 ? loser : undefined;
  const text = `${X.name} of ${a.name} and ${Y.name} of ${b.name} came to blows at the fire${g ? `, over this: ${g.text}` : ""}.`;
  S.brawls.push({ tick: w.tick, a: x, b: y, factions: [a.id, b.id], text, dead });
  const watchers = (live ? w.order.filter((o) => ageOf(w, o) >= 8) : [x, y, a.head, b.head]).filter((o, i, xs) => xs.indexOf(o) === i);
  await witness(
    w,
    watchers,
    (m, id) => {
      const mine = id === x || id === y;
      const side = factionOf(w, id);
      const other = id === x ? y : id === y ? x : side?.id === a.id ? y : side?.id === b.id ? x : undefined;
      const p = eventPercept(m, other ?? "world", other ? "other" : "circumstance", mine ? -0.5 : -0.25, mine ? 0.8 : 0.5, ["fight", "fairness", "trust", evId], mine ? `${personName(w, id === x ? y : x)} and I came to blows at the fire.` : `${X.name} and ${Y.name} came to blows at the fire.`, text, evId, [x, y].filter((o) => o !== id));
      p.features.intentional = 0.8;
      p.features.normViolation = 0.5;
      return p;
    },
    faculties,
    sink,
  );
  const k = key(a.id, b.id);
  S.rivalry[k] = round(clamp((S.rivalry[k] ?? 0) + (dead ? 0.25 : 0.08)));
  const why: Why[] = [{ text: `${cap(a.name)} and ${b.name} were hard set against each other (${(S.rivalry[k] ?? 0).toFixed(2)} of 1).` }, { agent: x, text: `${X.name} is the quickest to anger among ${a.name} (agreeableness ${X.traits.agreeableness.toFixed(2)}); ${Y.name} among ${b.name} (${Y.traits.agreeableness.toFixed(2)}).` }];
  if (g) why.push({ agent: g.victim, episode: g.episode, text: `The last thing between them: ${g.text}.` });
  feed(w, sink, { kind: "event", place: "tavern", agents: [x, y], title: dead ? `${personName(w, dead)} is killed in a fight at the fire in ${w.name}` : `A fight at the fire in ${w.name}`, text, chronicle: { kind: "faction", why } });
  note(w, { kind: "faction", title: dead ? `${personName(w, dead)} is killed in a fight between ${a.name} and ${b.name}` : `${cap(a.name)} and ${b.name} come to blows`, text, agents: [x, y], why });
  if (dead) {
    const killer = dead === x ? y : x;
    await die(w, dead, `a blow from ${personName(w, killer)}`, faculties, sink);
    wrong(w, (dead === x ? a : b).head, killer, 0.2, `${personName(w, killer)} killed ${personName(w, dead)} at the fire`);
    return;
  }
  // A leader people on both sides can stand may make them shake hands.
  const leader = v.civic?.leader;
  if (leader && w.order.includes(leader) && leader !== x && leader !== y) {
    const L = w.minds[leader]!;
    const heard = mean([x, y].map((o) => w.minds[o]!.others[leader]?.liking ?? 0.5));
    if (L.traits.agreeableness > 0.55 && heard > 0.5) {
      S.rivalry[k] = round(clamp((S.rivalry[k] ?? 0) - 0.15));
      feed(w, sink, { kind: "event", place: "tavern", agents: [leader, x, y], title: `${L.name} makes ${X.name} and ${Y.name} shake hands`, text: `Both will hear ${L.name} out (they like ${L.pronouns.object} ${heard.toFixed(2)} between them), and ${L.name} is the kind to try (agreeableness ${L.traits.agreeableness.toFixed(2)}).` });
    }
  }
}

const heat = (w: WorldState, id: AgentId) => {
  const m = w.minds[id]!;
  return 1 - m.traits.agreeableness + m.affect.emotions.anger + 0.3 * (1 - m.traits.conscientiousness) + 0.2 * m.traits.extraversion;
};

// ---------------------------------------------------------------- reading them

export interface FactionView {
  id: string;
  name: string;
  basis: string;
  shares: string;
  head: AgentId;
  headName: string;
  members: { id: AgentId; name: string }[];
  households: number;
  founded: number;
  inner: number;
  outer: number;
  lost: number;
  rivals: { with: string; name: string; value: number }[];
  grievances: { year: number; text: string; agent: AgentId; episode?: string }[];
  why: Why[];
}

export function factionsView(w: WorldState): { factions: FactionView[]; unaligned: number; brawls: FactionState["brawls"]; exit?: { name: string; reason: string } } | undefined {
  const S = stateOf(w);
  if (!S) return undefined;
  const fs = liveFactions(w);
  const year = (t: Tick) => yearOf({ ...w, tick: t });
  const nameOf = (id: string) => (id === "town" ? "the rest of the town" : (fs.find((f) => f.id === id)?.name ?? id));
  const exit = S.exit && fs.find((f) => f.id === S.exit!.faction);
  return {
    factions: fs.map((f) => ({
      id: f.id,
      name: f.name,
      basis: f.basis,
      shares: f.shares,
      head: f.head,
      headName: personName(w, f.head),
      members: f.members.filter((x) => w.order.includes(x)).map((id) => ({ id, name: personName(w, id) })),
      households: f.households.length,
      founded: year(f.founded),
      inner: f.inner,
      outer: f.outer,
      lost: f.lost,
      rivals: Object.entries(S.rivalry)
        .filter(([k]) => k.split("|").includes(f.id))
        .map(([k, value]) => {
          const o = k.split("|").find((x) => x !== f.id)!;
          return { with: o, name: nameOf(o), value };
        })
        .sort((a, b) => b.value - a.value),
      grievances: f.grievances.slice(-5).reverse().map((g) => ({ year: year(g.tick), text: g.text, agent: g.victim, episode: g.episode })),
      why: f.why,
    })),
    unaligned: w.order.filter((x) => ageOf(w, x) >= 16 && !factionOf(w, x)).length,
    brawls: S.brawls.slice(-5),
    exit: exit ? { name: exit.name, reason: S.exit!.reason } : undefined,
  };
}
