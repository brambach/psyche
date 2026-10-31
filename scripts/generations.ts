// Run Hollow Bay for years on the offline mock and print who was born, who died, what the
// village came to expect, and which fears outlived the people who first felt them.
// Usage: npm run generations -- [years] [seed]
import { atlas, createVillage, villageView, WorldSession, yearOf } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";
import { clockText } from "./clock.js";

const years = Number(process.argv[2] ?? 10);
const seed = Number(process.argv[3] ?? 11);
const w0 = createVillage(seed);
const s = new WorldSession(w0, createMockFaculties(), { keepRecent: 8, keepDays: 8, maxTraces: 20000 });
const days = years * w0.village!.seasonDays * 4;
const start = Date.now();
for (let d = 0; d < days; d++) {
  for (let h = 0; h < 4; h++) await s.apply({ type: "advance", minutes: 360 }, { snapshot: false });
  if ((d + 1) % (w0.village!.seasonDays * 4) === 0) {
    // A year at a time is plenty to keep: let the inputs, the call log and old snapshots go.
    s.rebase();
    const mb = Math.round(process.memoryUsage().heapUsed / 1e6);
    console.log(`year ${yearOf(s.world)}: ${s.world.order.length} living, ${Object.keys(s.world.minds).length} ever, ${s.traces.length} traces, ${s.log.length} calls, heap ${mb}MB, ${Math.round((Date.now() - start) / 1000)}s`);
  }
}
const w = s.world;
console.log("\n--- lives ---");
for (const f of s.feed) if (/born|dies|died|pair|move in|arrive|comes of age|grown/i.test(f.title)) console.log(`${clockText(f.tick)}  ${f.title}`);
console.log("\n--- norms ---");
for (const n of w.village!.norms) console.log(`${n.text}: ${n.sanctions} sanctions over ${n.rounds.length} rounds, ${n.established ? `established ${clockText(n.established)}` : "not established"}, strength ${n.strength.toFixed(2)}`);
console.log("\n--- fears across generations ---");
for (const e of atlas(w).slice(0, 8)) {
  const inh = e.holders.filter((h) => h.alive && h.inherited);
  console.log(`\n"${e.text}"  living by generation ${JSON.stringify(e.byGeneration)}, ${inh.length} inherited`);
  for (const r of e.roots) console.log(`   root: ${r.name}${r.alive ? "" : " (dead)"}: ${r.gist} [${r.holders} holders]`);
  for (const h of inh.slice(0, 3)) console.log(`   ${h.name} (gen ${h.generation}): ${h.chain.map((c) => `${c.name}: ${c.gist}`).join("  <=  ")}`);
}
const v = villageView(w)!;
console.log(`\nday ${v.day}, store ${v.store.food}, ${v.structures.filter((x) => x.done).length} houses done, ${Date.now() - start}ms`);
