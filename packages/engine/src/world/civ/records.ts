// Writing, and what it fixes in place. Until someone can write, everything a town knows lives in
// the people who know it: a law is whatever those who voted remember, a debt is two people's word,
// a craft dies with its last knower, and the founding story changes a little every time the eldest
// tells it. Writing changes each of those (Goody & Watt 1963, "The Consequences of Literacy"):
//
// - a written law outlasts the leader who made it (polity.ts lets unwritten ones lapse);
// - a written debt is harder to put off, and is still there when the lender has died;
// - a craft that was written down can be learned again from the page when everyone who knew it is
//   gone, by anyone who can still read;
// - the founding story, once written, is read out each summer instead of told, and stops drifting
//   (oral tradition keeps adjusting the past to the present; a text does not);
// - each spring the scribe writes the year down. The scribe is a person: what shames their own
//   side or someone they are fond of tends to get left out, and what was left out is kept here
//   too, so the town's written history can be read against what happened.
//
// Records are things. A raid can burn them (war.ts), and then the town is back to its memory.

import { render } from "../../memory.js";
import type { AgentId, Tick } from "../../types.js";
import { foundingVersion, rootOf } from "../civic.js";
import { craft, knowledgeOf, knows, learn, townCrafts } from "../knowledge.js";
import { ageOf, yearOf } from "../life.js";
import { openDebts } from "../money.js";
import { CROSSING } from "../people.js";
import { feed, luck, personName, thirdPerson, type Sink, type Why, type WorldState } from "../world.js";
import { cap, civOf, list, note, plural, type CivEvent } from "./base.js";
import { factionOf } from "./factions.js";

export interface RecordItem {
  id: string;
  tick: Tick;
  year: number;
  kind: "law" | "debt" | "craft" | "founding" | "annal" | "treaty";
  title: string;
  text: string;
  scribe: AgentId;
  /** What it sets down: a law, a craft, a treaty, the memory a founding story grows from. */
  ref?: string;
  /** Whose knowledge or telling it was taken from. */
  from?: AgentId;
  /** For a year's annal: what happened and was not written, and why not. */
  omitted?: { title: string; because: string; agents?: AgentId[] }[];
  burned?: Tick;
}

export interface Records {
  items: RecordItem[];
  /** When the town first kept records. */
  since?: Tick;
  /** Crafts learned again from the page. */
  readBacks: number;
  lastAnnal?: Tick;
  n: number;
}

export const newRecords = (): Records => ({ items: [], readBacks: 0, n: 0 });

const readers = (w: WorldState) => w.order.filter((x) => ageOf(w, x) >= 12 && knows(w, x, "writing"));
/** Whoever keeps the town's records: its scribe, or failing one the most careful person who can write. */
export function writerOf(w: WorldState): AgentId | undefined {
  const can = readers(w).filter((x) => ageOf(w, x) >= 14);
  return can.find((x) => w.agents[x]!.role === "scribe") ?? can.sort((a, b) => w.minds[b]!.traits.conscientiousness - w.minds[a]!.traits.conscientiousness || a.localeCompare(b))[0];
}

/** Whether something was set down and the page still exists. */
export function isWritten(w: WorldState, kind: RecordItem["kind"], ref: string): boolean {
  return !!civOf(w)?.records.items.some((i) => i.kind === kind && i.ref === ref && !i.burned);
}

/** Set something down, if anyone here can write. Returns the record. */
export function writeDown(w: WorldState, item: Omit<RecordItem, "id" | "tick" | "year" | "scribe">, sink?: Sink): RecordItem | undefined {
  const c = civOf(w);
  const scribe = c && writerOf(w);
  if (!c || !scribe) return undefined;
  const R = c.records;
  const rec: RecordItem = { id: `rec_${++R.n}`, tick: w.tick, year: yearOf(w), scribe, ...item };
  R.items.push(rec);
  if (R.items.length > 400) {
    // The oldest debt lists go first; laws, crafts and the founding are kept.
    const drop = R.items.findIndex((i) => i.kind === "debt" || i.burned);
    R.items.splice(drop >= 0 ? drop : 0, 1);
  }
  if (R.since === undefined) {
    R.since = w.tick;
    const why: Why[] = [{ agent: scribe, text: `${personName(w, scribe)} can write${w.agents[scribe]!.role === "scribe" ? `, and ${w.name} is big enough to keep a scribe` : ""}.` }, { text: `The first thing set down: ${item.title}.` }];
    if (sink) feed(w, sink, { kind: "event", place: "store", agents: [scribe], title: `${w.name} begins to keep records`, text: why.map((x) => x.text).join(" "), chronicle: { kind: "record", why } });
    note(w, { kind: "record", title: `${w.name} begins to keep records`, agents: [scribe], why });
  }
  return rec;
}

/** The founding story as it stands written, when it does and someone can still read it. */
export function writtenFounding(w: WorldState, founding: string): string | undefined {
  const c = civOf(w);
  if (!c || !readers(w).length) return undefined;
  return c.records.items.find((i) => i.kind === "founding" && i.ref === founding && !i.burned)?.text;
}

/**
 * A craft whose last knower is gone: if it was written down and someone can still read, the most
 * curious reader learns it again from the page. Returns true when it was saved.
 */
export function readBack(w: WorldState, craftId: string, sink: Sink): boolean {
  const c = civOf(w);
  if (!c) return false;
  const rec = c.records.items.find((i) => i.kind === "craft" && i.ref === craftId && !i.burned);
  const reader = readers(w)
    .filter((x) => ageOf(w, x) >= 14)
    .sort((a, b) => w.minds[b]!.traits.openness - w.minds[a]!.traits.openness || a.localeCompare(b))[0];
  if (!rec || !reader) return false;
  const C = craft(craftId);
  learn(w, reader, { craft: craftId, tick: w.tick, how: "read", from: rec.from });
  c.records.readBacks++;
  const why: Why[] = [
    { agent: rec.from, text: `Everyone in ${w.name} who knew ${C.name} was dead or gone.` },
    { agent: rec.scribe, text: `${personName(w, rec.scribe)} had written it down in year ${rec.year}${rec.from && rec.from !== rec.scribe ? `, as ${personName(w, rec.from)} explained it` : ""}.` },
    { agent: reader, text: `${personName(w, reader)} can read, and is the most curious of those who can (openness ${w.minds[reader]!.traits.openness.toFixed(2)}).` },
  ];
  const title = `${personName(w, reader)} learns ${C.name} again from the records`;
  knowledgeOf(w).history.push({ tick: w.tick, craft: craftId, kind: "found", agent: reader, text: `${title}.`, why });
  feed(w, sink, { kind: "event", place: "store", agents: [reader], title, text: why.map((x) => x.text).join(" "), chronicle: { kind: "record", why } });
  note(w, { kind: "record", title, agents: [reader], why });
  return true;
}

/** Fire takes some of the records. Returns what was lost. */
export function burnRecords(w: WorldState, share: number): RecordItem[] {
  const c = civOf(w);
  if (!c) return [];
  const lost = c.records.items.filter((i) => !i.burned && luck(w, "burn", i.id) < share);
  for (const i of lost) i.burned = w.tick;
  return lost;
}

const SHAMEFUL = /killed|ask more|beaten back|comes to nothing|blows|struck down|let drop|leave/i;
const WEIGHT: Record<CivEvent["kind"], number> = { war: 5, plague: 4, truce: 4, election: 3, law: 3, tech: 3, faction: 2, migration: 2, record: 1, trade: 1, market: 1 };

/** Each season, where someone can write: laws, debts, a craft, the founding story, and in spring the year. */
export function recordsSeason(w: WorldState, sink: Sink): void {
  const c = civOf(w);
  const scribe = c && writerOf(w);
  if (!c || !scribe) return;
  const v = w.village!;
  const R = c.records;
  const S = w.minds[scribe]!;
  // Laws that stand.
  for (const law of v.civic?.laws ?? []) {
    if (!law.passed || law.repealed || isWritten(w, "law", law.id)) continue;
    writeDown(w, { kind: "law", title: `the law that ${law.text.replace(/\.$/, "").replace(/^[A-Z]/, (x) => x.toLowerCase())}`.slice(0, 160), text: law.text, ref: law.id, from: law.author }, sink);
  }
  // What is owed, and by whom.
  const fresh = openDebts(w).filter((d) => !d.written);
  if (fresh.length) {
    for (const d of fresh) d.written = w.tick;
    writeDown(w, { kind: "debt", title: `${plural(fresh.length, "debt")} owed in ${w.name}`, text: `${list(fresh.slice(0, 6).map((d) => `${personName(w, d.debtor)} owes ${personName(w, d.creditor)} ${d.amount} days' food`))}${fresh.length > 6 ? `, and ${fresh.length - 6} more` : ""}.` }, sink);
  }
  // One craft a season, the one nearest to being lost first, if whoever knows it will sit down with the scribe.
  const K = knowledgeOf(w);
  const atRisk = townCrafts(w)
    .filter((k) => k !== "writing" && !isWritten(w, "craft", k))
    .map((k) => {
      const who = w.order.filter((x) => knows(w, x, k));
      return { k, who, oldest: Math.max(...who.map((x) => ageOf(w, x))) };
    })
    .sort((a, b) => a.who.length - b.who.length || b.oldest - a.oldest || a.k.localeCompare(b.k));
  for (const { k, who } of atRisk) {
    const from = who.includes(scribe) ? scribe : who.filter((x) => (w.minds[x]!.others[scribe]?.liking ?? 0.5) >= 0.42).sort((a, b) => ageOf(w, b) - ageOf(w, a))[0];
    if (!from) continue;
    const C = craft(k);
    writeDown(w, { kind: "craft", title: `how ${C.name} is done`, text: `${cap(C.name)}, as ${from === scribe ? "the scribe knows it" : `${personName(w, from)} explained it`}: ${C.does}.`, ref: k, from }, sink);
    void K;
    break;
  }
  // The founding story, the first summer there is someone to write it.
  if (v.season === "summer") {
    for (const founding of [...new Set([v.founding ?? CROSSING, CROSSING])]) {
      if (isWritten(w, "founding", founding)) continue;
      const ep = foundingVersion(w.minds, scribe, founding);
      if (!ep) continue;
      const text = ep.id === founding ? thirdPerson(render(ep), S.name, S.pronouns) : render(ep);
      const root = rootOf(w.minds, scribe, ep);
      const why: Why[] = [{ agent: scribe, text: `${S.name} wrote it as ${S.pronouns.subject} had it${root.hops ? `, ${plural(root.hops, "telling")} on from ${personName(w, root.agent)}'s own memory` : `, from ${S.pronouns.possessive} own memory`}: “${text.replace(/[.\s]+$/, "")}”.` }, { text: `From now on it is read out each summer, not told, so it no longer changes with the teller.` }];
      writeDown(w, { kind: "founding", title: `how ${founding === CROSSING ? "the crossing went" : `${w.name} began`}`, text, ref: founding, from: root.agent }, sink);
      feed(w, sink, { kind: "event", place: "store", agents: [scribe], title: `${S.name} writes down how ${founding === CROSSING ? "the crossing went" : `${w.name} began`}`, text: why.map((x) => x.text).join(" "), chronicle: { kind: "record", why } });
      note(w, { kind: "record", title: `${S.name} writes down the founding story`, agents: [scribe], why });
    }
  }
  // The year, as the scribe chooses to remember it.
  if (v.season === "spring") {
    const since = R.lastAnnal ?? R.since ?? w.tick;
    const all = c.events.filter((e) => e.tick > since && e.kind !== "record");
    R.lastAnnal = w.tick;
    if (!all.length) return;
    // A leader kept on is only worth the ink in a year when nothing else happened.
    const notable = all.filter((e) => !(e.kind === "election" && / keeps the lead /.test(e.title)));
    const events = notable.length ? notable : all;
    const mine = factionOf(w, scribe);
    const kept: CivEvent[] = [];
    const omitted: NonNullable<RecordItem["omitted"]> = [];
    for (const e of [...events].sort((a, b) => WEIGHT[b.kind] - WEIGHT[a.kind] || a.tick - b.tick)) {
      const shamed = SHAMEFUL.test(e.title) ? (e.agents ?? []).slice(0, 2) : [];
      const own = shamed.find((a) => a === scribe || (mine && factionOf(w, a)?.id === mine.id));
      const dear = shamed.find((a) => (S.others[a]?.liking ?? 0.5) > 0.7);
      if (own) omitted.push({ title: e.title, because: own === scribe ? `it shames ${S.name}, who holds the pen` : `it shames ${personName(w, own)}, one of ${mine!.name}, which is ${S.name}'s own side`, agents: e.agents });
      else if (dear) omitted.push({ title: e.title, because: `it shames ${personName(w, dear)}, whom ${S.name} is fond of (${(S.others[dear]?.liking ?? 0.5).toFixed(2)})`, agents: e.agents });
      else if (kept.length < 5) kept.push(e);
    }
    const year = yearOf(w);
    const text = kept.length ? `${kept.sort((a, b) => a.tick - b.tick).map((e) => e.title).join(". ")}.` : "Nothing worth the ink.";
    writeDown(w, { kind: "annal", title: `the year ${year} in ${w.name}`, text, omitted: omitted.length ? omitted : undefined }, sink);
    if (omitted.length) feed(w, sink, { kind: "insight", place: "store", agents: [scribe], title: `${S.name} writes the year down, and leaves something out`, text: `Written: ${text} Left out: ${omitted.map((o) => `“${o.title}”, because ${o.because}`).join("; ")}.` });
  }
}

// ---------------------------------------------------------------- reading them

export interface RecordsView {
  scribe?: { id: AgentId; name: string };
  since?: number;
  readers: number;
  counts: Record<string, number>;
  burned: number;
  readBacks: number;
  founding: { title: string; text: string; year: number; scribe: string }[];
  crafts: { name: string; year: number; from?: string; burned: boolean }[];
  annals: { year: number; text: string; scribe: string; omitted?: RecordItem["omitted"]; burned: boolean }[];
  latest: { year: number; kind: string; title: string; burned: boolean }[];
}

export function recordsView(w: WorldState): RecordsView | undefined {
  const c = civOf(w);
  if (!c) return undefined;
  const R = c.records;
  const scribe = writerOf(w);
  const live = R.items.filter((i) => !i.burned);
  const counts: Record<string, number> = {};
  for (const i of live) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return {
    scribe: scribe ? { id: scribe, name: personName(w, scribe) } : undefined,
    since: R.since !== undefined ? yearOf({ ...w, tick: R.since }) : undefined,
    readers: readers(w).length,
    counts,
    burned: R.items.length - live.length,
    readBacks: R.readBacks,
    founding: live.filter((i) => i.kind === "founding").map((i) => ({ title: i.title, text: i.text, year: i.year, scribe: personName(w, i.scribe) })),
    crafts: R.items.filter((i) => i.kind === "craft").map((i) => ({ name: craft(i.ref!).name, year: i.year, from: i.from ? personName(w, i.from) : undefined, burned: !!i.burned })),
    annals: R.items.filter((i) => i.kind === "annal").slice(-8).reverse().map((i) => ({ year: i.year, text: i.text, scribe: personName(w, i.scribe), omitted: i.omitted, burned: !!i.burned })),
    latest: R.items.slice(-12).reverse().map((i) => ({ year: i.year, kind: i.kind, title: i.title, burned: !!i.burned })),
  };
}
