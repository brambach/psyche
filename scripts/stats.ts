// Tallies what happens across many seeds of the demo, optionally with mechanisms switched off.
// Usage: npx tsx --conditions=source scripts/stats.ts 60 '{"misinformation":false}'
import { createMara, demoScript, Session, type Ablations } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";
const N = Number(process.argv[2] ?? 40);
const abl = process.argv[3] ? (JSON.parse(process.argv[3]) as Partial<Ablations>) : {};
const tally: Record<string, number> = {};
const inc = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
for (let seed = 1; seed <= N; seed++) {
  const s = new Session(createMara(seed, abl), createMockFaculties());
  for (const i of demoScript()) await s.apply(i);
  const dock = s.mind.episodes.find((e) => e.id === "ep_dock")!;
  for (const d of dock.details) if (d.value !== d.original) inc(`changed ${d.key} -> ${d.value}`);
  const tr = s.frames.flatMap((f) => f.traces).filter((t) => t.kind === "perceive");
  inc(`d1 recall: ${tr[1]!.decision!.choice}`);
  inc(`theo: ${tr[5]!.decision!.choice}`);
  inc(`d7 recall: ${tr[6]!.decision!.choice}`);
  if (tr[6]!.action!.text.includes("never showed")) inc("d7 tells 'never showed up'");
}
console.log(Object.entries(tally).sort());
