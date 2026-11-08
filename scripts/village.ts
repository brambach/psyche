// Run Hollow Bay in the terminal. Usage: npm run village -- [days] [seed] [--blight]
import { CAST_ORDER, createVillage, render, renderOriginal, villageView, WorldSession } from "@psyche/engine";
import { breakdown, createFaculties, meterLine } from "@psyche/faculties";
import { clockText } from "./clock.js";

const days = Number(process.argv[2] ?? 4);
const seed = Number(process.argv[3] ?? 11);
const quiet = process.argv.includes("--quiet");
const { kind, faculties, governor } = createFaculties();
// The Kettle five are the named characters (L0); the settlers are L1 unless watched.
for (const id of CAST_ORDER) governor.core.add(id);
const s = new WorldSession(createVillage(seed), faculties);
const start = Date.now();
for (let h = 0; h < days * 24; h++) {
  if (process.argv.includes("--blight") && h === 24 * 5 + 3) await s.apply({ type: "inject", event: { kind: "blight" } });
  await s.apply({ type: "advance", minutes: 60 });
}
const w = s.world;
if (!quiet)
  for (const f of s.feed) {
    if (f.kind === "move" && !/overhears/.test(f.title)) continue;
    console.log(`\n${clockText(f.tick)}  [${f.kind}] ${f.title}${f.place ? ` @ ${w.places[f.place]?.name}` : ""}`);
    if (f.text) console.log(`   ${f.text}`);
    for (const l of f.lines ?? []) console.log(`   ${l.speaker}: ${l.text}`);
  }
const v = villageView(w)!;
console.log(`\n--- ${w.name}, day ${v.day} (${v.season} ${v.dayOfSeason}/${v.seasonDays}), ${v.weather} ---`);
console.log(`store ${v.store.food} (in ${v.store.put}, out ${v.store.taken}); stock`, v.stock);
for (const h of v.households) console.log(`  ${h.name.padEnd(14)} ${h.members.join(",").padEnd(22)} food ${String(h.food).padStart(5)} ${h.shelter.padEnd(5)} pledge rate ${h.rate}`);
for (const st of v.structures) console.log(`  ${st.done ? "done" : `${Math.round(st.progress * 100)}%`.padStart(4)} ${st.name} for ${st.household} by ${st.designer}: ${st.description}`);
for (const p of v.pledges) console.log(`  pledge ${clockText(p.tick)}: ${p.answers.map((a) => `${a.agent}=${a.option}`).join(" ")}`);
console.log(`\n--- rumors ---`);
for (const r of Object.values(w.rumors)) {
  if (!r.hops.length) continue;
  console.log(`${r.id} (about ${r.subject}): ${r.first}`);
  for (const h of r.hops) console.log(`   ${clockText(h.tick)} ${h.from} -> ${h.to} ${h.overheard ? "[overheard] " : ""}${h.mutated ? "[MUTATED] " : ""}${h.text} (${h.confidence.toFixed(2)})`);
}
console.log(`\n--- memories that changed ---`);
for (const id of w.order) for (const ep of w.minds[id]!.episodes) if (ep.versions.some((x) => x.changes.length)) console.log(`${id} ${ep.id}\n   was: ${renderOriginal(ep)}\n   now: ${render(ep)}`);
console.log(`\n${w.order.length} people, ${s.feed.filter((f) => f.kind === "talk").length} conversations, ${s.log.length} faculty calls (${kind}), ${s.traces.length} traces, ${Date.now() - start}ms`);
console.log(`cost: ${meterLine(governor.snapshot(), days)}\n${breakdown(governor.snapshot())}`);
console.log(`snapshot size ~${Math.round(JSON.stringify(w).length / 1024)}KB`);
