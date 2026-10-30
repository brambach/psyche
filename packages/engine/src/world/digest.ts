// Reading a long run: a plain-text digest of a stretch of years, and a timeline for the time-lapse.

import { compareMyths, regionView, type ChronicleEntry, type RegionSession } from "./region.js";

export interface Timeline {
  years: number[];
  towns: { id: string; name: string; from?: string; founded: number; tier: "live" | "aggregate"; people: (number | null)[]; houses: (number | null)[]; tents: (number | null)[]; site?: { along: number; inland: number } }[];
  /** Trade runs between towns per year, and which towns each town refused to trade with that year. */
  routes: { from: string; to: string; years: Record<number, number> }[];
  shunned: { year: number; town: string; refuses: string[] }[];
  events: { year: number; town?: string; kind: ChronicleEntry["kind"]; text: string; why?: ChronicleEntry["why"] }[];
}

/** People per town per year (the last sample of each year), and the chronicle without the routine trades. */
export function timeline(rs: RegionSession): Timeline {
  const v = regionView(rs);
  const r = rs.region;
  const byTown = r.towns.map((t) => {
    const per = new Map<number, number>();
    const houses = new Map<number, number>();
    const tents = new Map<number, number>();
    for (const h of t.history) {
      per.set(h.year, h.people);
      if (h.houses !== undefined) houses.set(h.year, h.houses);
      if (h.tents !== undefined) tents.set(h.year, h.tents);
    }
    return { t, per, houses, tents };
  });
  const last = Math.max(v.year, ...byTown.flatMap((x) => [...x.per.keys()]));
  const years = Array.from({ length: last }, (_, i) => i + 1);
  return {
    years,
    towns: byTown.map(({ t, per, houses, tents }) => ({
      id: t.id,
      name: t.name,
      from: t.from,
      founded: t.history[0]?.year ?? 1,
      tier: t.agg ? "aggregate" : "live",
      people: years.map((y) => per.get(y) ?? null),
      houses: years.map((y) => houses.get(y) ?? null),
      tents: years.map((y) => tents.get(y) ?? null),
      site: t.site,
    })),
    routes: Object.entries(r.routes ?? {}).map(([k, years]) => {
      const [from, to] = k.split(">") as [string, string];
      return { from, to, years };
    }),
    shunned: r.towns.flatMap((t) => t.history.filter((h) => h.shunned?.length).map((h) => ({ year: h.year, town: t.id, refuses: h.shunned! }))),
    events: r.chronicle.filter((c) => c.kind !== "trade").map((c) => ({ year: c.year, town: c.town, kind: c.kind, text: c.text, why: c.why })),
  };
}

const BIG: ChronicleEntry["kind"][] = ["founding", "quarrel", "peace", "law", "craft", "lost", "hunger", "death"];

/** A digest of years `from` to `to`: who lives where, what happened and why, and how the crossing is told now. */
export function digest(rs: RegionSession, from: number, to: number): string {
  const v = regionView(rs);
  const r = rs.region;
  const name = (id?: string) => r.towns.find((t) => t.id === id)?.name ?? id ?? "";
  const lines: string[] = [`## Years ${from} to ${to}`, ""];
  const total = v.towns.reduce((s, t) => s + t.people, 0);
  const before = r.towns.reduce((s, t) => s + (t.history.filter((h) => h.year < from).at(-1)?.people ?? 0), 0);
  lines.push(`${total} people in ${v.towns.length} ${v.towns.length === 1 ? "town" : "towns"}${before ? ` (${total >= before ? "up" : "down"} from ${before})` : ""}.`, "");
  for (const t of v.towns) lines.push(`- **${t.name}**: ${t.people} people, ${t.children} children${t.leaderName ? `, led by ${t.leaderName}` : ""}. ${t.laws ? `${t.laws} law${t.laws > 1 ? "s" : ""}. ` : ""}Knows ${t.crafts.length ? t.crafts.join(", ") : "no crafts"}${t.lost.length ? `; has lost ${t.lost.join(", ")}` : ""}. *(${t.tier})*`);
  const events = r.chronicle.filter((c) => c.year >= from && c.year <= to && BIG.includes(c.kind));
  if (events.length) {
    lines.push("", "### What happened", "");
    for (const e of events) {
      lines.push(`- Year ${e.year}, ${name(e.town)}: ${e.text}`);
      for (const w of e.why ?? []) lines.push(`  - ${w.text}`);
    }
  }
  const quarrels = v.regard.filter((x) => x.value <= -0.35);
  if (quarrels.length) lines.push("", `Not trading: ${quarrels.map((q) => `${name(q.from)} with ${name(q.to)}`).join(", ")}.`);
  const m = compareMyths(rs);
  lines.push("", "### The crossing, as each town tells it now", "");
  for (const t of m.towns) {
    const d = t.dominant;
    lines.push(d ? `- **${t.name}** (${d.holders.length} of ${t.holders} tell it this way, from ${d.root.name}, ${d.chain.length - 1} ${d.chain.length === 2 ? "telling" : "tellings"} on): “${d.text}”` : `- **${t.name}**: nobody tells it any more.`);
  }
  return lines.join("\n") + "\n";
}
