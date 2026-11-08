// The lab, headless: classic social psychology experiments on Psyche minds, on the offline mock.
// Writes lab.json (every run, every decisive moment) and lab.html (a self-contained report).
// Usage: npm run lab -- [seed] [outDir] [--quick]
import { mkdirSync, writeFileSync } from "node:fs";
import { lab } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";
import { renderLabReport } from "./lab-report.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const seed = Number(args[0] ?? 11);
const out = args[1] ?? "out/lab";
const quick = process.argv.includes("--quick");
mkdirSync(out, { recursive: true });
const start = Date.now();
const report = await lab.runLab(createMockFaculties(), { seed, sweeps: !quick });
writeFileSync(`${out}/lab.json`, JSON.stringify(report));
writeFileSync(`${out}/lab.html`, renderLabReport(report));
for (const e of report.experiments) {
  console.log(`\n${e.title} (${e.original})`);
  for (const c of e.conditions) console.log(`  ${c.label.padEnd(26)} ${c.valueText}${c.human ? `   | humans: ${c.human.text}` : ""}`);
}
console.log(`\nMean absolute error against the human numbers: ${(report.fit.meanAbsError * 100).toFixed(1)} points over ${report.fit.comparisons} conditions.`);
for (const o of report.fit.orderings) console.log(`  ${o.experiment}: ${o.agree} of ${o.pairs} condition pairs in the human order`);
if (report.unspoken) console.log(`Unspoken: ${(report.unspoken.meanHiddenShare * 100).toFixed(0)}% of the push behind decisive choices came from forces people never mentioned.`);
console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)} s. Report at ${out}/lab.html`);
