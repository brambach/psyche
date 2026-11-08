// Run a region of towns for years on the offline mock: Hollow Bay grows, splits, trades and
// quarrels, and each town comes to tell the crossing its own way.
// Usage: npm run region -- [years] [seed]
import { compareMyths, RegionSession, regionView } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";
import { clockText } from "./clock.js";

const years = Number(process.argv[2] ?? 20);
const seed = Number(process.argv[3] ?? 11);
const rs = RegionSession.create(seed, createMockFaculties(), { session: { keepRecent: 0, keepDays: 0, maxTraces: 4000 } });
const yearDays = 16;
const start = Date.now();
for (let d = 0; d < years * yearDays; d++) {
  for (let h = 0; h < 4; h++) await rs.advance(360, { snapshot: false });
  if ((d + 1) % yearDays === 0) {
    rs.rebase();
    const v = regionView(rs);
    console.log(`year ${v.year}: ${v.towns.map((t) => `${t.name} ${t.people}${t.leaderName ? ` (led by ${t.leaderName})` : ""}`).join(", ")}; heap ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB, ${Math.round((Date.now() - start) / 1000)}s`);
  }
}
const v = regionView(rs);
console.log("\n--- chronicle ---");
for (const c of v.chronicle) if (c.kind !== "trade" || /short/.test(c.text)) console.log(`Year ${c.year}  [${c.kind}] ${c.text}`);
console.log(`\n${v.trades.length} recent trades; regard:`, v.regard.map((r) => `${r.from}>${r.to} ${r.value}`).join(", "));
const m = compareMyths(rs);
console.log("\n--- the crossing, as each town tells it ---");
for (const t of m.towns) {
  console.log(`\n${t.name}: ${t.holders} tell it (${t.firstHand} were there)`);
  for (const x of t.versions.slice(0, 3)) console.log(`   ${x.holders.length} × "${x.text}"  [from ${x.root.name}, ${x.chain.length - 1} tellings]`);
}
console.log("\n--- where they split ---");
for (const s of m.splits) console.log(`${s.a} / ${s.b}: ${s.at}`);
void clockText;
