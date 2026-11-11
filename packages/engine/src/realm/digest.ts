// Reading a big world after a night away. A realm of tens of thousands writes thousands of chronicle
// lines a night; nobody reads those. The digest picks the few that mattered, keeps what led to each
// (the chronicle's own `why`, which goes back to people and their memories), and puts them beside
// the plain numbers: how many people, where, what was founded, who fell out with whom over the sea,
// and how the oldest story is being told on each coast now. Pure: it reads what it is given.

import type { RealmRegion } from "./realm.js";
import type { RealmEvent } from "./runner.js";

export interface DigestMark {
  year: number;
  people: number;
  regions: number;
  towns: number;
  /** People in each region, by id. */
  byRegion: Record<string, number>;
  births: number;
  deaths: number;
  /** Real time, in milliseconds since 1970. */
  at: number;
}

export interface DigestMyth {
  region: string;
  town: string;
  text?: string;
  root?: string;
  tellings: number;
  holders: number;
  of: number;
}

export interface DigestInput {
  /** Heads the page, e.g. the date. */
  title: string;
  from: DigestMark;
  to: DigestMark;
  regions: RealmRegion[];
  /** What was chronicled between the two marks (see DigestWindow). */
  window: DigestTally;
  myths?: DigestMyth[];
  eldest?: { name: string; age: number; town: string; region: string }[];
  health?: { yearsPerHour: number; threads: number; checkpoints: number; restarts: number; heapMB: number; lastSeasonMs: number; note?: string };
  /** What the run cost in model calls, as text. */
  spend?: string;
}

/**
 * What a digest keeps of the events between two marks: every count, and the events heavy enough to
 * be worth a line. A night can chronicle hundreds of thousands of lines; this stays small whatever
 * the night held, and it is plain data, so it is saved with the world and survives a restart.
 */
export interface DigestTally {
  total: number;
  kinds: Record<string, number>;
  /** Lines chronicled in each region, trades aside. */
  byRegion: Record<string, number>;
  sea: { boats: number; short: number; crafts: number; quarrels: number; gifts: number };
  /** The heaviest events, heaviest first. */
  heavy: RealmEvent[];
  /** Coasts that turned on each other over the sea, newest last. */
  quarrels: RealmEvent[];
}

const KEEP_HEAVY = 300;

export function emptyTally(): DigestTally {
  return { total: 0, kinds: {}, byRegion: {}, sea: { boats: 0, short: 0, crafts: 0, quarrels: 0, gifts: 0 }, heavy: [], quarrels: [] };
}

/** Add a season's events to a tally. */
export function tally(t: DigestTally, events: RealmEvent[]): void {
  for (const e of events) {
    t.total++;
    t.kinds[e.kind] = (t.kinds[e.kind] ?? 0) + 1;
    if (e.kind !== "trade") t.byRegion[e.region] = (t.byRegion[e.region] ?? 0) + 1;
    if (e.sea) {
      if (e.kind === "trade") {
        t.sea.boats++;
        if (/found the load short/.test(e.text)) t.sea.short++;
        if (/learned a craft/.test(e.text)) t.sea.crafts++;
      } else if (e.kind === "quarrel") {
        t.sea.quarrels++;
        t.quarrels.push(e);
        if (t.quarrels.length > 8) t.quarrels.shift();
      } else if (e.kind === "peace") t.sea.gifts++;
    }
    if (weigh(e) >= 5) t.heavy.push(e);
  }
  if (t.heavy.length > KEEP_HEAVY * 2) {
    t.heavy.sort((a, b) => weigh(b) - weigh(a) || a.tick - b.tick);
    t.heavy.length = KEEP_HEAVY;
  }
}

const WEIGHT: Record<string, number> = { founding: 6, quarrel: 8, peace: 5, hunger: 6, law: 4, craft: 3, lost: 6, faith: 6, heresy: 7, engine: 7, money: 6, ruin: 4, work: 2, leader: 1, death: 2, trade: 0 };

/** How much an event matters to someone reading a night's worth: its kind, how many it touched, whether it crossed the sea, how far back its causes go. */
export function weigh(e: RealmEvent): number {
  let s = WEIGHT[e.kind] ?? 2;
  const n = Number(/^(\d+) go hungry/.exec(e.text)?.[1] ?? 0);
  if (n) s += Math.min(6, n / 8);
  if (e.sea) s += 3;
  if (e.why?.length) s += Math.min(2, e.why.length * 0.4);
  if (e.kind === "trade" && / short\b/.test(e.text)) s += 3;
  return s;
}

const num = (n: number) => n.toLocaleString("en-US");
const change = (now: number, before: number) => (now === before ? "no change" : `${now > before ? "up" : "down"} ${num(Math.abs(now - before))}`);
const where = (e: RealmEvent) => [e.townName, e.regionName].filter(Boolean).join(", ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The digest of a stretch of the realm's life, as markdown. */
export function realmDigest(d: DigestInput): string {
  const { from, to } = d;
  const years = to.year - from.year;
  const hours = (to.at - from.at) / 3_600_000;
  const out: string[] = [`# ${d.title}`, ""];
  out.push(
    `The world lived ${years === 1 ? "a year" : `${num(years)} years`} (year ${num(from.year)} to year ${num(to.year)})${hours >= 0.05 ? ` in ${hours >= 1 ? `${hours.toFixed(1)} hours` : `${Math.round(hours * 60)} minutes`}` : ""}. It holds ${num(to.people)} people (${change(to.people, from.people)}) in ${num(to.towns)} towns on ${to.regions} ${to.regions === 1 ? "coast" : "coasts"}. ${num(to.births - from.births)} were born and ${num(to.deaths - from.deaths)} died.`,
    "",
  );

  // The few things that mattered: the heaviest events, no more than three of a kind.
  const t = d.window;
  const ranked = t.heavy.map((e) => ({ e, w: weigh(e) })).sort((a, b) => b.w - a.w || a.e.tick - b.e.tick);
  const per = new Map<string, number>();
  const top: RealmEvent[] = [];
  for (const { e } of ranked) {
    const k = per.get(e.kind) ?? 0;
    if (k >= 3) continue;
    per.set(e.kind, k + 1);
    top.push(e);
    if (top.length >= 12) break;
  }
  if (top.length) {
    out.push("## What mattered", "");
    for (const e of top.sort((a, b) => a.tick - b.tick)) {
      out.push(`- **Year ${num(e.year)}, ${where(e)}.** ${cap(e.text)}`);
      for (const w of (e.why ?? []).slice(0, 4)) out.push(`  - ${cap(w.text)}`);
    }
    out.push("");
  }

  const shores = d.regions.filter((r) => r.foundedYear > from.year && r.foundedYear <= to.year);
  if (shores.length) {
    out.push("## New shores", "");
    for (const r of shores) {
      const parent = d.regions.find((x) => x.id === r.from);
      out.push(`- **${cap(r.name)}**, first settled in year ${num(r.foundedYear)}${parent ? ` from ${parent.name}` : ""}: now ${num(r.people)} people in ${r.towns} ${r.towns === 1 ? "town" : "towns"}.`);
    }
    out.push("");
  }

  const sea = t.sea;
  if (sea.boats + sea.quarrels + sea.gifts > 0) {
    out.push("## Between the coasts", "");
    out.push(`${num(sea.boats)} ${sea.boats === 1 ? "boat" : "boats"} crossed with food and timber${sea.boats ? `; ${num(sea.short)} ${sea.short === 1 ? "load was" : "loads were"} found short, and ${num(sea.crafts)} carried a craft to a shore that lacked it` : ""}. ${sea.quarrels ? `${sea.quarrels} ${sea.quarrels === 1 ? "time a coast" : "times a coast"} turned against another` : "No coast turned against another"}, and ${sea.gifts ? `${sea.gifts} peace ${sea.gifts === 1 ? "gift was" : "gifts were"} sent` : "no peace gifts were sent"}.`, "");
    for (const e of t.quarrels.slice(-5)) out.push(`- Year ${num(e.year)}: ${cap(e.text)}`);
    if (t.quarrels.length) out.push("");
  }

  out.push("## The coasts", "", "| Coast | People | Since last | Towns | Settled | Chronicled |", "| --- | ---: | ---: | ---: | --- | ---: |");
  for (const r of [...d.regions].sort((a, b) => b.people - a.people || a.index - b.index)) {
    const before = from.byRegion[r.id];
    const parent = d.regions.find((x) => x.id === r.from);
    out.push(`| ${cap(r.name)} | ${num(r.people)} | ${before === undefined ? "new" : r.people === before ? "0" : `${r.people > before ? "+" : "-"}${num(Math.abs(r.people - before))}`} | ${r.towns} | year ${num(r.foundedYear)}${parent ? `, from ${parent.name}` : ""} | ${num(t.byRegion[r.id] ?? 0)} |`);
  }
  out.push("");

  const kinds = Object.entries(t.kinds);
  if (kinds.length) out.push(`In all, the chronicle wrote ${num(t.total)} lines: ${kinds.sort((a, b) => b[1] - a[1]).map(([k, n]) => `${num(n)} ${k}`).join(", ")}.`, "");

  if (d.eldest?.length) {
    out.push("## The oldest alive", "");
    for (const e of d.eldest.slice(0, 5)) out.push(`- ${e.name}, ${e.age}, of ${e.town} (${e.region})`);
    out.push("");
  }

  const myths = (d.myths ?? []).filter((m) => m.text);
  if (myths.length) {
    out.push("## The oldest story, as it is told now", "");
    const same = myths.length > 1 && myths.every((m) => m.text === myths[0]!.text);
    // When every coast asked has worn it down to the same words, say so once.
    if (same) out.push(`Every coast asked tells it in the same words now: “${myths[0]!.text}”`, "");
    for (const m of myths) out.push(`- **${m.town}** (${m.region}; ${m.holders} of ${m.of} tell it this way${m.root ? `, from ${m.root}, ${m.tellings} ${m.tellings === 1 ? "telling" : "tellings"} on` : ""})${same ? "" : `: “${m.text}”`}`);
    const gone = (d.myths ?? []).filter((m) => !m.text);
    if (gone.length) out.push(`- Nobody tells it any more in ${gone.map((m) => m.town).join(", ")}.`);
    out.push("");
  }

  if (d.health || d.spend) {
    out.push("## The engine", "");
    const h = d.health;
    if (h) out.push(`Running at ${num(Math.round(h.yearsPerHour))} years an hour on ${h.threads || 1} ${h.threads === 1 || !h.threads ? "thread" : "threads"}; the last season took ${(h.lastSeasonMs / 1000).toFixed(1)}s. ${num(h.checkpoints)} ${h.checkpoints === 1 ? "save" : "saves"} written, ${h.restarts} ${h.restarts === 1 ? "restart" : "restarts"}, ${num(h.heapMB)} MB of memory in use.${h.note ? ` ${h.note}` : ""}`);
    if (d.spend) out.push("", `Spend: ${d.spend}`);
    out.push("");
  }
  return out.join("\n");
}

/** A mark to measure the next digest from. */
export function digestMark(regions: RealmRegion[], year: number, totals: { births: number; deaths: number }, at: number): DigestMark {
  return { year, people: regions.reduce((n, r) => n + r.people, 0), regions: regions.length, towns: regions.reduce((n, r) => n + r.towns, 0), byRegion: Object.fromEntries(regions.map((r) => [r.id, r.people])), births: totals.births, deaths: totals.deaths, at };
}
