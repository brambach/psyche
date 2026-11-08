// Run Founders (F0) in the terminal: one mind, one islet, one storm. Prints the feed, the design
// and a top-down map of the house. Usage: npm run founders -- [builder] [seed] [--early]
import { BUILDERS, clockText, createFounder, describe, dryness, FounderSession, get, M, MATERIALS, progress, type BuilderId } from "@psyche/engine";
import { createFaculties, meterLine } from "@psyche/faculties";

const who = (BUILDERS.find((b) => process.argv.includes(b)) ?? "mara") as BuilderId;
const seed = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 3);
const { kind, faculties, governor } = createFaculties();
const s = new FounderSession(createFounder(seed, who), faculties);
const start = Date.now();
for (let h = 0; h < 60; h++) {
  if (process.argv.includes("--early") && h === 8) await s.apply({ type: "inject", event: { kind: "storm-early" } });
  await s.apply({ type: "advance", minutes: 60 });
}
const st = s.state;
for (const f of s.feed) {
  console.log(`\n${clockText(f.tick)}  [${f.kind}] ${f.title}`);
  if (f.text) console.log(`   ${f.text}`);
  const t = f.trace && s.traces.find((x) => x.id === f.trace);
  if (t && t.decision) {
    console.log(`   S${t.decision.system}: ${t.decision.options.map((o) => `${o.id} ${o.utility.toFixed(2)}`).join(", ")}${t.decision.monologue ? `\n   "${t.decision.monologue}"` : ""}`);
    console.log(`   in mind: ${t.workspace.map((w) => w.label).join(" | ")}`);
  }
}
const pr = st.project;
if (pr) {
  console.log(`\n--- ${pr.blueprint.name} ---\n${describe(pr.blueprint)}\n"${pr.rationale}"`);
  console.log(`because: ${pr.because.map((b) => `${b.label} (${b.weight})`).join("; ")}`);
  if (pr.repairs.length) console.log(`repairs: ${pr.repairs.join("; ")}`);
  if (pr.revisions.length) console.log(`revisions: ${pr.revisions.join("; ")}`);
  console.log(`${pr.bill.blocks} blocks, ${pr.bill.hours.toFixed(1)}h estimated; raw ${JSON.stringify(pr.bill.raw)}; progress ${(progress(st) * 100).toFixed(0)}%, dry ${dryness(st).toFixed(2)}${pr.finishedAt ? `, finished ${clockText(pr.finishedAt)}` : ""}`);
}
// Top-down: the highest block in each column around the plot.
const g = st.terrain.grid;
const CH: Record<string, string> = { air: " ", grass: ".", dirt: ",", stone: "^", sand: "_", water: "~", log: "O", leaves: "*", plank: "=", cobble: "#", thatch: "%", reeds: "|", door: "D", bed: "B", hearth: "H", table: "T", chest: "C" };
const p = st.terrain.plot;
for (let z = p.z0 - 2; z < p.z0 + p.d + 2; z++) {
  let line = "   ";
  for (let x = p.x0 - 2; x < p.x0 + p.w + 2; x++) {
    let c = " ";
    for (let y = g.h - 1; y >= 0; y--) {
      const b = get(g, x, y, z);
      if (b !== M.air) {
        c = CH[MATERIALS[b]!]!;
        break;
      }
    }
    line += c;
  }
  console.log(line);
}
console.log(`\n${st.builder.name}: ${st.builder.activity}; mood ${st.mind.affect.mood.valence.toFixed(2)}, stress ${st.mind.affect.stress.toFixed(2)}`);
console.log(`${s.log.length} faculty calls (${kind}: ${[...new Set(s.log.map((c) => c.faculty))].join(", ")}), ${s.traces.length} traces, ${Date.now() - start}ms`);
console.log(`cost: ${meterLine(governor.snapshot(), 2.5)}`);
