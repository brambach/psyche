// Runs the six-day demo offline and prints what happened and why.
// Usage: npm run demo -- [seed]

import { createMara, dayOf, demoScript, hourOf, Session, type Trace } from "@psyche/engine";
import { createFaculties } from "@psyche/faculties";

const seed = Number(process.argv[2] ?? 52);
const { kind, faculties } = createFaculties();
const session = new Session(createMara(seed), faculties);

const clock = (t: number) => `Day ${dayOf(t)} ${String(Math.floor(hourOf(t))).padStart(2, "0")}:${String(Math.round((hourOf(t) % 1) * 60)).padStart(2, "0")}`;

function show(t: Trace) {
  if (t.kind === "sleep") {
    console.log(`\n${clock(t.tick)}  [sleep] ${t.headline.answer}`);
    return;
  }
  console.log(`\n${clock(t.tick)}  ${t.percept?.rawText}`);
  if (t.action?.text) console.log(`   -> ${t.action.kind === "speech" ? `Mara: "${t.action.text}"` : t.action.text}`);
  console.log(`   ${t.headline.question}\n   ${t.headline.answer}`);
  console.log(`   in mind: ${t.workspace.map((w) => w.label).join(" | ")}`);
  if (t.subliminal.length) console.log(`   below the waterline: ${t.subliminal.map((w) => w.label).join(" | ")}`);
  if (t.decision) console.log(`   system ${t.decision.system} (p=${t.decision.s2.probability.toFixed(2)}, capacity ${t.decision.s2.capacity.toFixed(2)})`);
  for (const r of t.reconsolidations) {
    console.log(`   memory rewritten (fidelity ${(r.fidelity * 100).toFixed(0)}%):\n     before: ${r.before}\n     after:  ${r.after}`);
  }
  for (const b of t.biases) console.log(`   pattern: ${b.name} (${b.confidence.toFixed(2)}) ${b.explanation}`);
}

console.log(`Psyche M0 demo, seed ${seed}, faculties: ${kind}`);
for (const input of demoScript()) {
  const frame = await session.apply(input);
  frame.traces.forEach(show);
}
const m = session.mind;
console.log(`\nEnd state: mood ${m.affect.mood.valence.toFixed(2)}, stress ${m.affect.stress.toFixed(2)}, trust in Theo ${m.others.theo!.trust.benevolence.toFixed(2)}`);
