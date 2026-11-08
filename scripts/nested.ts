// Worlds inside the world, headless. A region runs on the aggregate tier (free, on the offline mock)
// until someone starts counting, builds a bead frame, gets the town to build an engine, and the world
// inside wakes; then it prints every level: who was made in whose image, what they noticed, how they
// read it, and whether the keepers outside began to wonder about their own world.
// Usage: npm run nested -- [years] [seed] [outDir]
// With an outDir it also writes a save the server can open: PSYCHE_DATA=<outDir> npm run dev
import { mkdirSync, writeFileSync } from "node:fs";
import { engines, nestedPersonView, nestedWorldView, RegionSession, regionView, type WorldState } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const years = Number(process.argv[2] ?? 30);
const seed = Number(process.argv[3] ?? 11);
const out = process.argv[4];
const mock = createMockFaculties();
const rs = RegionSession.create(seed, mock, { session: { keepRecent: 0, keepDays: 0, maxTraces: 2000 }, maxTowns: 16, cheap: mock });
rs.setLive(0);
const yearDays = 16;
const start = Date.now();
const said = new Set<string>();
const towns = () => rs.region.towns.map((t) => ({ id: t.id, world: rs.world(t.id) }));
const store = () => rs.region.nested ?? {};

function report(): void {
  for (const t of rs.region.towns) {
    for (let d = 0; d <= 3; d++) {
      const v = nestedWorldView(rs.world(t.id), t.id, store(), d);
      if (!v) break;
      for (const e of [...v.history].reverse()) {
        const k = `${t.id}/${d}/${e.id}`;
        if (said.has(k) || e.kind === "keeper") continue;
        said.add(k);
        console.log(`  ${"  ".repeat(d)}[${d === 0 ? t.id : v.name}, year ${e.year}] ${e.title}`);
      }
    }
  }
}

for (let y = 1; y <= years; y++) {
  for (let m = 0; m < yearDays * 1440; m += 1440) await rs.advance(1440, { snapshot: false });
  rs.rebase();
  const v = regionView(rs);
  const chains = engines(towns(), store());
  const deepest = Math.max(0, ...chains.map((c) => c.levels.length - 1));
  console.log(`year ${v.year}: ${v.towns.reduce((s, t) => s + t.people, 0)} people in ${v.towns.length} towns; ${chains.length} counting, deepest world ${deepest}; ${Math.round((Date.now() - start) / 1000)}s`);
  report();
}

console.log("\n=== the engines ===");
for (const c of engines(towns(), store())) {
  console.log(`\n${c.townName}:`);
  for (const l of c.levels) {
    const m = l.machine;
    console.log(`${"  ".repeat(l.depth)}depth ${l.depth} ${l.name}, year ${l.year}: ${l.people} people, ${l.believers}/${l.adults} adults believe${m ? `; engine ${m.stage} (maker ${m.makerName}, keepers ${m.keepers.map((k) => k.name).join(", ") || "none"}${m.stage === "running" ? `, ${m.slipped}/${m.tended} seasons slipped` : ""})` : ""}`);
  }
  for (let d = 1; d < c.levels.length; d++) {
    const w = nestedWorldView(rs.world(c.town), c.town, store(), d)!;
    console.log(`\n  -- inside, depth ${d}: ${w.name} --`);
    if (w.made) {
      console.log(`  made by ${w.made.makerName} in ${w.made.parent}. ${w.made.truth}`);
      for (const x of w.made.comparison) console.log(`    ${x.holders} think their maker ${x.guess}`);
    }
    for (const p of w.people.filter((p) => p.suspicion || p.modelledOn).slice(0, 8))
      console.log(`    ${p.name} (${p.age})${p.modelledOn ? ` modelled on ${p.modelledOn.name}` : ""}${p.past ? `, remembers ${p.past.name}'s past` : ""}${p.suspicion ? `: "${p.suspicion.text}" ${p.suspicion.strength.toFixed(2)}` : ""}`);
    for (const s of w.signs.slice(0, 5)) console.log(`    sign, year ${s.year}: ${s.title} (${s.noticed.length} noticed, ${s.wondered.length} wondered)\n      why: ${s.why.map((x) => `[${x.level}] ${x.text}`).join(" ")}`);
    const b = w.people.find((p) => p.suspicion && p.generation > 0) ?? w.people.find((p) => p.suspicion);
    if (b) {
      const pv = nestedPersonView(rs.world(c.town), store(), d, b.id)!;
      const s = pv.beliefs.find((x) => x.text === b.suspicion!.text)!;
      console.log(`    ${b.name}'s "${s.text}": ${s.chain.map((x) => `${x.name}${x.firstHand ? " (saw it)" : ""}`).join(" <- ")}`);
    }
  }
}
const size = JSON.stringify(rs.region.nested ?? {}).length;
console.log(`\nInner worlds: ${Math.round(size / 1024)} KB in the save. Done in ${Math.round((Date.now() - start) / 1000)}s.`);
if (out) {
  mkdirSync(out, { recursive: true });
  const worlds: Record<string, WorldState> = rs.worlds();
  writeFileSync(`${out}/island.json`, JSON.stringify({ scenario: "region", seed, ablations: {}, inputs: [], log: [], region: { state: rs.region, worlds, feeds: {} } }));
  console.log(`Save written: PSYCHE_DATA=${out} npm run dev`);
}
