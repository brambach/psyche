// Speak into Hollow Bay and watch what the town does with your words. Free: runs on the offline mock.
// Usage: npm run voice -- [days] [seed] [--fulfil] [--quiet]
import { createVillage, voiceLineage, voiceSummary, WorldSession, type VoiceAct } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";
import { clockText } from "./clock.js";

const days = Number(process.argv[2] ?? 8);
const seed = Number(process.argv[3] ?? 11);
const quiet = process.argv.includes("--quiet");
const s = new WorldSession(createVillage(seed), createMockFaculties());
const speak = (act: VoiceAct) => s.apply({ type: "voice", act });
const start = Date.now();

// Morning of day 1: a stranger at the landing. Midday: a voice out of the sky. Evening: a prophet at the fire.
await s.apply({ type: "advance", minutes: 3 * 60 });
const w0 = s.world;
const someone = w0.order.find((id) => w0.agents[id]!.place !== w0.agents[id]!.home) ?? w0.order[0]!;
await speak({ act: "speak", guise: "stranger", to: someone, text: "The sea is hungry. It remembers every boat it has let go." });
await s.apply({ type: "advance", minutes: 3 * 60 });
await speak({ act: "speak", guise: "sky", text: "A storm will come in three days. Leave a fish at the landing each dawn." });
await s.apply({ type: "advance", minutes: 7 * 60 });
await speak({ act: "speak", guise: "prophet", place: "tavern", text: "Perhaps you think you are alone here. You are watched, and the dead keep count of what you hold back." });

let fulfilled = false;
for (let h = 0; h < days * 24; h++) {
  await s.apply({ type: "advance", minutes: 60 });
  if (process.argv.includes("--fulfil") && !fulfilled && h === 30) {
    const word = s.world.voice!.words.find((x) => x.prophecy);
    if (word) await speak({ act: "fulfil", word: word.id });
    fulfilled = true;
  }
}
const w = s.world;
if (!quiet)
  for (const f of s.feed) {
    if (!f.rumor?.startsWith("word_") && !/faith|rite|prophecy|Schism|never comes/.test(f.title)) continue;
    console.log(`\n${clockText(f.tick)}  [${f.kind}] ${f.title}`);
    if (f.text) console.log(`   ${f.text}`);
    for (const l of f.lines ?? []) console.log(`   ${l.speaker}: ${l.text}`);
  }
const sum = voiceSummary(w)!;
console.log("\n--- your words ---");
for (const word of sum.words) {
  console.log(`\n${word.id} as ${word.guise}: "${word.text}"`);
  console.log(`   heard by ${word.heard}, believed by ${word.believe}, lapsed ${word.lapsed}, ${word.versions} versions${word.practice ? `, practice: ${word.practice}` : ""}${word.rite ? " (a rite now)" : ""}`);
  if (word.prophecy) console.log(`   prophecy of ${word.prophecy.event}: ${word.prophecy.outcome ?? "pending"}${word.prophecy.how ? ` (${word.prophecy.how})` : ""}`);
  if (word.common) console.log(`   most hold: ${word.common}`);
  if (word.furthest) console.log(`   furthest (${word.furthest.depth} tellings out, ${word.furthest.agent}): ${word.furthest.text}`);
  const L = voiceLineage(w, word.id)!;
  for (const m of L.mechanisms) console.log(`   ${m.kind} x${m.count} (most by ${m.by[0]!.name})`);
  for (const c of L.culprits) console.log(`   blames ${c.name} (${c.holders} hold it); first blamed by ${c.first?.byName}: ${c.first?.cause?.text}`);
}
console.log("\n--- faiths ---");
for (const f of sum.faiths) console.log(`${f.name}: kept by ${f.keeperName}, ${f.members} members${f.parent ? `, split from ${f.parent}: ${f.split}` : ""}${f.ended ? " (ended)" : ""}`);
console.log("\n--- what happened ---");
for (const l of sum.log) console.log(`${clockText(l.tick)} [${l.kind}] ${l.text}`);
console.log(`\n${w.order.length} people, ${s.traces.length} traces, ${Date.now() - start}ms, $0 (offline mock)`);
