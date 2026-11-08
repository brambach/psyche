// Run Kettle Island in the terminal and print the feed. Usage: npm run island -- [days] [seed]
import { createWorld, WorldSession, PLACES } from "@psyche/engine";
import { breakdown, createFaculties, meterLine } from "@psyche/faculties";
import { clockText } from "./clock.js";

const days = Number(process.argv[2] ?? 2);
const seed = Number(process.argv[3] ?? 7);
const { kind, faculties, governor } = createFaculties();
const s = new WorldSession(createWorld(seed), faculties);
const storm = process.argv.includes("--storm");
const start = Date.now();
for (let h = 0; h < days * 24; h++) {
  if (storm && h === 30) await s.apply({ type: "inject", event: { kind: "storm" } });
  await s.apply({ type: "advance", minutes: 60 });
}
for (const f of s.feed) {
  console.log(`\n${clockText(f.tick)}  [${f.kind}] ${f.title}${f.place ? ` @ ${PLACES[f.place].name}` : ""}`);
  if (f.text) console.log(`   ${f.text}`);
  for (const l of f.lines ?? []) console.log(`   ${l.speaker}: ${l.text}`);
}
console.log(`\n--- rumors ---`);
for (const r of Object.values(s.world.rumors)) {
  console.log(`${r.id} (about ${r.subject}): ${r.first}`);
  for (const h of r.hops) console.log(`   ${clockText(h.tick)} ${h.from} -> ${h.to} ${h.mutated ? "[MUTATED] " : ""}${h.text} (${h.confidence.toFixed(2)})`);
}
console.log(`\n--- relations (liking) ---`);
for (const id of s.world.order) {
  const m = s.world.minds[id]!;
  console.log(id.padEnd(7), s.world.order.filter((o) => o !== id).map((o) => `${o}:${(m.others[o]?.liking ?? 0).toFixed(2)}`).join("  "));
}
console.log(`\n${s.feed.filter((f) => f.kind === "talk").length} conversations, ${s.log.length} faculty calls (${kind}), ${s.traces.length} traces, ${Date.now() - start}ms`);
console.log(`cost: ${meterLine(governor.snapshot(), days)}\n${breakdown(governor.snapshot())}`);
console.log(`snapshot size ~${Math.round(JSON.stringify(s.world).length / 1024)}KB`);
console.log(`\n--- memories that changed ---`);
import { render, renderOriginal } from "@psyche/engine";
for (const id of s.world.order) {
  for (const ep of s.world.minds[id]!.episodes) {
    if (ep.versions.some((v) => v.changes.length)) console.log(`${id} ${ep.id}\n   was: ${renderOriginal(ep)}\n   now: ${render(ep)}`);
  }
}
