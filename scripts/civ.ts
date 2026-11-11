// A century with the civilization systems on, headless and on the offline mock (no model calls).
// The first years run live so the founders live through things in full; then every town runs on
// rules. Writes a report of what each system did, with the causes the engine kept for each event,
// and a save the server can open.
// Usage: npm run civ -- [years] [seed] [liveYears] [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { civView, digest, regionCiv, regionCivView, RegionSession, regionView, type ChronicleEntry, type Why } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const years = Number(process.argv[2] ?? 100);
const seed = Number(process.argv[3] ?? 11);
const liveYears = Number(process.argv[4] ?? 2);
const out = process.argv[5] ?? "out/civ";
mkdirSync(out, { recursive: true });
const mock = createMockFaculties();
const rs = RegionSession.create(seed, mock, { session: { keepRecent: 0, keepDays: 0, maxTraces: 2000 }, maxTowns: 16, splitAt: 50, cheap: mock, civ: true });
const yearDays = 16;
const start = Date.now();
const kinds: ChronicleEntry["kind"][] = ["market", "trade", "craft", "faction", "election", "leader", "law", "plague", "migration", "record", "war", "truce", "founding", "lost"];
let decade = 1;
let sections = "";
for (let y = 1; y <= years; y++) {
  if (y === liveYears + 1) rs.setLive(0);
  const step = y <= liveYears ? 360 : 1440;
  for (let m = 0; m < yearDays * 1440; m += step) await rs.advance(step, { snapshot: false });
  rs.rebase();
  const v = regionView(rs);
  const rc = regionCivView(rs.region, (t) => rs.world(t));
  const total = v.towns.reduce((s, t) => s + t.people, 0);
  const R = regionCiv(rs.region);
  const least = [...v.towns].sort((a, b) => a.people - b.people)[0]!;
  console.log(`year ${v.year}: ${total} people, ${v.towns.length} towns (least ${least.name} ${least.people}); ${rc?.towns.reduce((s, t) => s + t.specialists, 0)} in trades, ${rc?.towns.reduce((s, t) => s + t.factions, 0)} factions, ${rc?.towns.filter((t) => t.literate).length} literate, ${rc?.towns.filter((t) => t.sick).length} sick; raids ${R.raids.length}, treaties ${R.treaties.length}, moves ${R.moves.length}, runs ${R.runs.length}; ${Math.round((Date.now() - start) / 1000)}s`);
  if (y % 10 === 0 || y === years) {
    sections += "\n" + digest(rs, decade, v.year);
    decade = v.year + 1;
  }
}

const whyLines = (why?: Why[]) => (why ?? []).map((w) => `  - ${w.text}`).join("\n");
const chron = rs.region.chronicle;
const townName = (id?: string) => rs.region.towns.find((t) => t.id === id)?.name ?? id ?? "";
let report = `# A century of civilization, seed ${seed}\n\n${years} years on the offline mock: the first ${liveYears} live, the rest on rules. ${Math.round((Date.now() - start) / 1000)} s.\n\n`;
const v = regionView(rs);
report += `**${v.towns.reduce((s, t) => s + t.people, 0)} people in ${v.towns.length} towns.**\n\n| Town | People | Trades | Sides | Writes | Crafts |\n|---|---|---|---|---|---|\n`;
const rc = regionCivView(rs.region, (t) => rs.world(t))!;
for (const t of v.towns) {
  const c = rc.towns.find((x) => x.id === t.id)!;
  report += `| ${t.name} | ${t.people} | ${c.specialists} | ${c.factions} | ${c.literate ? "yes" : "no"} | ${t.crafts.length} |\n`;
}
report += `\n## What happened, by kind\n\n| Kind | Entries in the chronicle |\n|---|---|\n`;
for (const k of kinds) report += `| ${k} | ${chron.filter((e) => e.kind === k).length} |\n`;
const R = regionCiv(rs.region);
report += `\nBetween towns: ${R.raids.length} raids (${R.raids.filter((x) => x.won).length} won), ${R.treaties.length} treaties (${R.treaties.filter((t) => t.written).length} written, ${R.treaties.filter((t) => t.ended).length} ended), ${R.moves.length} households moved, ${R.runs.length} merchant runs.\n`;
report += `\n## One of each, with its causes\n`;
for (const k of kinds) {
  const withWhy = chron.filter((e) => e.kind === k && e.why?.length);
  const e = withWhy[Math.floor(withWhy.length / 2)];
  if (!e) continue;
  report += `\n### ${k}: year ${e.year}, ${townName(e.town)}\n\n${e.text}\n\n${whyLines(e.why)}\n`;
}
report += `\n## The towns at the end\n`;
for (const t of rs.region.towns) {
  const c = civView(rs.world(t.id));
  if (!c) continue;
  const e = c.economy!;
  const last = e.markets.at(-1);
  report += `\n### ${t.name}\n\n`;
  report += `- Leader: ${c.polity?.leader ? `${c.polity.leader.name}, since year ${c.polity.leader.since}${c.polity.leader.faction ? `, of ${c.polity.leader.faction}` : ""}` : "none"}${c.polity?.mandate ? `; promised that ${c.polity.mandate.text}` : ""}.\n`;
  report += `- Trades: ${e.trades.filter((x) => x.people.length).map((x) => `${x.people.length} ${x.role}${x.people.length > 1 ? "s" : ""}`).join(", ") || "none"}. Wealth spread (Gini): ${e.gini}. Amber is ${e.money.established ? "money" : `not money (${Math.round(e.money.share * 100)}% take it)`}.\n`;
  if (last) report += `- Last market (year ${last.year}, ${last.season}): ${last.deals.amber} deals for amber, ${last.deals.barter} barter, ${last.deals.store} out of the store, ${last.deals.credit} credit, ${last.deals.gift} gifts, ${last.deals.failed} fell through. Food at ${last.price.food} of its old price.\n`;
  report += `- Sides: ${c.factions?.factions.map((f) => `${f.name} (${f.members.length}, under ${f.headName})`).join("; ") || "none"}.\n`;
  report += `- Laws in force: ${c.polity?.laws.filter((l) => l.inForce).map((l) => `${l.name}${l.written ? " (written)" : ""}`).join(", ") || "none"}.\n`;
  report += `- Sickness: ${c.health?.past.length ?? 0} outbreaks remembered${c.health?.past[0] ? `, the last ${c.health.past[0].name} in year ${c.health.past[0].year} (${c.health.past[0].cases} sick, ${c.health.past[0].dead.length} dead)` : ""}.\n`;
  report += `- Records: ${c.records?.since ? `kept since year ${c.records.since} by ${c.records.scribe?.name ?? "nobody now"}; ${Object.entries(c.records.counts).map(([k, n]) => `${n} ${k}`).join(", ")}; ${c.records.readBacks} crafts read back, ${c.records.burned} burned` : "none"}.\n`;
  const left = c.records?.annals.find((a) => a.omitted?.length);
  if (left) report += `- An annal with something left out (year ${left.year}, by ${left.scribe}): “${left.text}” Left out: ${left.omitted!.map((o) => `“${o.title}” because ${o.because}`).join("; ")}.\n`;
  report += `- Later crafts known: ${c.tech.filter((x) => x.known).map((x) => x.name).join(", ") || "none"}.\n`;
}
report += `\n## Decade by decade\n${sections}`;
writeFileSync(`${out}/civ-report.md`, report);
writeFileSync(`${out}/civ.json`, JSON.stringify({ region: rc, towns: Object.fromEntries(rs.region.towns.map((t) => [t.id, civView(rs.world(t.id))])) }));
writeFileSync(`${out}/island.json`, JSON.stringify({ scenario: "region", seed, ablations: {}, inputs: [], log: [], region: { state: rs.region, worlds: rs.worlds(), feeds: {} } }));
console.log(`\nDone in ${Math.round((Date.now() - start) / 1000)}s. Report at ${out}/civ-report.md`);
