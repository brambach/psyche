// How big, how fast. Grows a realm from one crossing on worker threads until it holds a target
// number of people, then measures what a year costs at that size. All on the offline mock: $0.
// Usage: npm run scale -- [people] [threads] [maxYears] [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { realm as R } from "@psyche/engine";
import { createHost } from "../packages/server/src/world/pool.ts";

const target = Number(process.argv[2] ?? 50000);
const threads = Number(process.argv[3] ?? Math.max(1, Math.min(8, availableParallelism() - 1)));
const maxYears = Number(process.argv[4] ?? 1200);
const out = process.argv[5] ?? "out/scale";
const maxRegions = Number(process.env.PSYCHE_WORLD_REGIONS ?? Math.max(8, Math.ceil(target / 1100)));
mkdirSync(out, { recursive: true });

const host = createHost(threads, { heapMB: Number(process.env.PSYCHE_WORLD_HEAP_MB ?? 6144) });
const realm = await R.Realm.create(host, { seed: Number(process.env.PSYCHE_WORLD_SEED ?? 11), maxRegions });
const start = Date.now();
const rows: { year: number; people: number; minds: number; regions: number; towns: number; seconds: number; secPerYear: number }[] = [];
let lastYear = Date.now();
let reached: number | undefined;
let measure: number[] = [];
console.log(`Growing to ${target.toLocaleString()} people on ${threads} thread${threads === 1 ? "" : "s"} (up to ${maxRegions} regions).`);
for (;;) {
  const res = await realm.step();
  if (res.season !== "winter") continue;
  const secPerYear = (Date.now() - lastYear) / 1000;
  lastYear = Date.now();
  if (reached !== undefined) measure.push(secPerYear);
  if (res.year % 10 === 0 || reached !== undefined) {
    const moved = await host.rebalance(new Map(realm.state.regions.map((r) => [r.id, r.people])));
    const stats = await host.stats();
    const row = { year: res.year, people: res.people, minds: res.minds, regions: res.regions, towns: res.towns, seconds: Math.round((Date.now() - start) / 1000), secPerYear: Number(secPerYear.toFixed(2)) };
    rows.push(row);
    console.log(`year ${row.year}: ${row.people.toLocaleString()} people (${row.minds.toLocaleString()} minds held) in ${row.towns} towns, ${row.regions} regions; ${row.secPerYear}s a year; threads ${stats.map((s) => `${s.people}p ${s.heapMB}MB`).join(", ")}${moved ? `; moved ${moved}` : ""}; ${row.seconds}s`);
    lastYear = Date.now();
  }
  if (reached === undefined && res.people >= target) reached = res.year;
  if ((reached !== undefined && measure.length >= 5) || res.year >= maxYears) break;
}
const stats = await host.stats();
const perYear = measure.length ? measure.reduce((a, b) => a + b, 0) / measure.length : NaN;
const summary = {
  target,
  threads,
  reachedYear: reached,
  people: realm.people,
  minds: realm.state.regions.reduce((n, r) => n + r.minds, 0),
  regions: realm.state.regions.length,
  towns: realm.state.regions.reduce((n, r) => n + r.towns, 0),
  secondsToGrow: Math.round((Date.now() - start) / 1000),
  secondsPerYearAtSize: Number(perYear.toFixed(2)),
  yearsPerHourAtSize: Math.round(3600 / perYear),
  heapMB: stats.reduce((n, s) => n + s.heapMB, 0),
  rssMB: Math.round(process.memoryUsage().rss / 1e6),
  totals: realm.state.totals,
  rows,
};
writeFileSync(`${out}/scale.json`, JSON.stringify(summary, null, 1));
console.log(`\n${summary.people.toLocaleString()} people in ${summary.towns} towns and ${summary.regions} regions by year ${reached ?? "?"}, grown in ${summary.secondsToGrow}s. At this size a year takes ${summary.secondsPerYearAtSize}s on ${threads} threads (${summary.yearsPerHourAtSize} years an hour). Heap ${summary.heapMB}MB across threads. Cost: $0.`);
await host.close();
