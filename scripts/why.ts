// Ask the causal ledger why. Runs Kettle Island, then traces what weighs on one person back to
// where it started. Usage: npm run why -- [person] [days] [seed] [--storm]
import { buildLedger, concerns, CAST_ORDER, createWorld, genealogy, influence, strongestChain, why, WorldSession, type WhyTree } from "@psyche/engine";
import { createFaculties, meterLine } from "@psyche/faculties";
import { clockText } from "./clock.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const who = args[0] ?? "mara";
const days = Number(args[1] ?? 3);
const seed = Number(args[2] ?? 7);
if (!CAST_ORDER.includes(who)) throw new Error(`Pick one of ${CAST_ORDER.join(", ")}`);

const { faculties, governor } = createFaculties();
const s = new WorldSession(createWorld(seed), faculties);
for (let h = 0; h < days * 24; h++) {
  if (process.argv.includes("--storm") && h === 30) await s.apply({ type: "inject", event: { kind: "storm" } });
  await s.apply({ type: "advance", minutes: 60 });
}
const L = buildLedger({ minds: s.world.minds, traces: s.traces, rumors: s.world.rumors, events: s.world.events });
const mind = s.world.minds[who]!;
console.log(`Ledger: ${L.nodes.size} nodes, ${L.edges.length} edges after ${days} days (seed ${seed}).`);

const when = (t: number) => (Number.isFinite(t) ? (t < 0 ? `${Math.round(-t / 1440)} days before` : clockText(t)) : "always");
function print(t: WhyTree, indent = "") {
  const via = t.via ? `${t.via.mechanism} ` : "";
  console.log(`${indent}${via}${t.node.agent && t.node.agent !== who ? `[${t.node.agent}] ` : ""}${t.node.label}  (${when(t.node.tick)}, ${(t.share * 100).toFixed(0)}%)${t.repeat ? " ↑" : ""}`);
  for (const c of t.causes) print(c, indent + "   ");
}

const cs = concerns(L, mind, s.world.tick);
console.log(`\nWhat weighs on ${mind.name}:`);
for (const c of cs) console.log(`  ${c.kind.padEnd(7)} ${c.label} (${c.strength.toFixed(2)})`);

for (const c of cs.slice(0, 3)) {
  console.log(`\n=== Why: ${c.label}`);
  const tree = why(L, c.id)!;
  print(tree);
  console.log(`Strongest chain: ${strongestChain(tree).map((n) => n.label).join("  →  ")}`);
  const g = genealogy(L, c.id)!;
  console.log(`Genealogy: ${g.ancestors.length} ancestors, ${g.roots.length} roots${g.minds.length ? `, through ${g.minds.join(", ")}` : ""}.`);
  const inf = influence(L, c.id)!;
  console.log(`Influence: in mind for ${inf.direct} decisions directly, reaches ${inf.decisions.length} decisions${inf.minds.length ? ` across ${inf.minds.join(", ")}` : ""}.`);
}

const lastDecision = [...L.nodes.values()].filter((n) => n.kind === "decision" && n.agent === who).at(-1);
if (lastDecision) {
  console.log(`\n=== Why did ${mind.name} do the last thing she did? ${lastDecision.label}`);
  print(why(L, lastDecision.id)!);
}
console.log(`\ncost: ${meterLine(governor.snapshot(), days)}`);
