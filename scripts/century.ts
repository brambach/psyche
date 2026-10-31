// A century, headless. The first years run live (on the offline mock) so the founding generation
// lives through things in full; then every town drops to the aggregate tier and the region runs on
// for decades on rules. A digest is written each decade, and a timeline for the time-lapse chart.
// Usage: npm run century -- [years] [seed] [liveYears] [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { compareMyths, digest, RegionSession, regionView, timeline } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const years = Number(process.argv[2] ?? 100);
const seed = Number(process.argv[3] ?? 11);
const liveYears = Number(process.argv[4] ?? 2);
const out = process.argv[5] ?? "out/century";
mkdirSync(out, { recursive: true });
const mock = createMockFaculties();
const rs = RegionSession.create(seed, mock, { session: { keepRecent: 0, keepDays: 0, maxTraces: 2000 }, maxTowns: 16, splitAt: 50, cheap: mock });
const yearDays = 16;
const start = Date.now();
let sections = `# A century of Psyche, seed ${seed}\n\nThe first ${liveYears} years ran live (every hour, every mind); the rest on the aggregate tier.\n`;
let decade = 1;
for (let y = 1; y <= years; y++) {
  if (y === liveYears + 1) rs.setLive(0);
  const step = y <= liveYears ? 360 : 1440;
  for (let m = 0; m < yearDays * 1440; m += step) await rs.advance(step, { snapshot: false });
  rs.rebase();
  const v = regionView(rs);
  const total = v.towns.reduce((s, t) => s + t.people, 0);
  console.log(`year ${v.year}: ${total} people in ${v.towns.length} towns (${v.towns.map((t) => `${t.name} ${t.people}`).join(", ")}); heap ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB, ${Math.round((Date.now() - start) / 1000)}s`);
  if (y % 10 === 0 || y === years) {
    sections += "\n" + digest(rs, decade, v.year);
    decade = v.year + 1;
    writeFileSync(`${out}/digest.md`, sections);
    writeFileSync(`${out}/timeline.json`, JSON.stringify(timeline(rs)));
  }
}
// A save the server can open (PSYCHE_DATA=<outDir> npm run dev), so the century can be watched.
writeFileSync(`${out}/island.json`, JSON.stringify({ scenario: "region", seed, ablations: {}, inputs: [], log: [], region: { state: rs.region, worlds: rs.worlds(), feeds: {} } }));
const m = compareMyths(rs);
console.log(`\nDone in ${Math.round((Date.now() - start) / 1000)}s. ${m.towns.length} towns, ${m.splits.length} myth splits. Digest at ${out}/digest.md`);
