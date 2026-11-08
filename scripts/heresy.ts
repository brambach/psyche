// The made world, in the terminal: Hollow Bay with the heresy switched on.
// Usage: npm run heresy -- [days] [seed] [--organic] [--quiet]
//   By default the player meddles a little, the way the god voice would: on day 2 a voice from the
//   sky speaks to the most open person in the village, on day 4 it speaks to a second person and
//   names something they never told anyone, and on day 6 the player sends a gale. With --organic the
//   player does nothing, and only the seams the engine makes by itself (echoes) can start it.
import { ageOf, dayOf, hourOf, buildLedger, createVillage, enableHeresy, heresyView, nodeId, strongestChain, susceptibility, voiceFromSky, why, heresyOf, WorldSession, type WorldState } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";
import { clockText } from "./clock.js";

const days = Number(process.argv[2] ?? 12);
const seed = Number(process.argv[3] ?? 11);
const organic = process.argv.includes("--organic");
const quiet = process.argv.includes("--quiet");
const faculties = createMockFaculties();
const world = createVillage(seed);
enableHeresy(world);
const s = new WorldSession(world, faculties, { keepRecent: 4 });
const started = Date.now();

const adults = (w: WorldState) => w.order.filter((id) => ageOf(w, id) >= 12);
const openest = (w: WorldState, skip: string[] = []) => adults(w).filter((x) => !skip.includes(x)).sort((a, b) => susceptibility(w.minds[b]!) - susceptibility(w.minds[a]!))[0]!;

/** The god voice, as the voice thread will send it (an actor with no body), run inside the session's world. */
async function sky(to: string, text: string) {
  const sink = { feed: s.feed, traces: s.traces };
  await voiceFromSky(s.world, to, text, faculties, sink);
}

let first = "";
let second = "";
for (let h = 0; h < days * 24; h++) {
  const day = dayOf(s.world.tick);
  const hour = Math.floor(hourOf(s.world.tick));
  if (!organic && day === 2 && hour === 10) {
    first = openest(s.world);
    await sky(first, "I can see you. I have been watching all of you since you landed.");
  }
  if (!organic && day === 4 && hour === 15) {
    second = openest(s.world, [first]);
    const m = s.world.minds[second]!;
    // Something only they know: the memory behind one of their core beliefs.
    const secret = m.schemas[0]?.origin?.map((o) => m.episodes.find((e) => e.id === o)).find(Boolean)?.gist ?? m.schemas[0]?.text ?? "the thing you never told anyone";
    await sky(second, `I know about this: ${secret.replace(/\.$/, "")}. Nobody told me.`);
  }
  if (!organic && day === 6 && hour === 9) await s.apply({ type: "inject", event: { kind: "gale" } });
  await s.apply({ type: "advance", minutes: 60 });
}

const w = s.world;
const v = heresyView(w)!;
const name = (id: string) => w.minds[id]?.name ?? id;
if (!quiet) {
  console.log(`\n=== The made world in ${w.name} (seed ${seed}, ${days} days${organic ? ", organic" : `, voice to ${name(first)} then ${name(second)}`}) ===\n`);
  for (const f of s.feed) {
    if (!/uncanny|made|madness|watching|world|sky|denounce|core belief|confides|calls out|answered/i.test(`${f.title} ${f.text ?? ""}`)) continue;
    console.log(`${clockText(f.tick)}  ${f.title}`);
    if (f.text) console.log(`      ${f.text}`);
    for (const l of f.lines ?? []) console.log(`      ${name(l.speaker)}: ${l.text}`);
  }
}
console.log(`\n--- factions (adults) ---`);
console.log(Object.entries(v.factions).map(([k, n]) => `${k} ${n}`).join(", "));
for (const p of v.people) console.log(`  ${p.name.padEnd(8)} ${p.faction.padEnd(9)} heresy ${p.heresy.toFixed(2)} orthodoxy ${p.orthodoxy.toFixed(2)} silence ${p.silence.toFixed(2)} own doubt ${p.doubt.toFixed(2)} (susceptibility ${p.susceptibility.toFixed(2)})${p.core ? " CORE" : ""}${p.belief ? `  "${p.belief}"` : ""}`);
console.log(`\n--- leader: ${v.leader ? `${v.leader.name} (${v.leader.stance})` : "none"} ---`);
console.log(`\n--- anomalies (${v.anomalies.length}) ---`);
for (const a of [...v.anomalies].reverse()) console.log(`  ${clockText(a.tick)} ${a.name.padEnd(8)} ${a.kind.padEnd(9)} ${a.text}`);
console.log(`\n--- lines of the story ---`);
for (const l of v.lines) {
  console.log(`  ${l.id}: first ${l.originName}, "${l.first}" (${l.believers} believe it now)`);
  for (const h of l.hops) console.log(`     ${clockText(h.tick)} ${h.fromName} -> ${h.toName} ${h.overheard ? "[overheard] " : ""}(${h.confidence.toFixed(2)})`);
}
console.log(`\n--- census by morning (believers / hidden / doubters / skeptics / unaware) ---`);
console.log("  " + v.census.map((c) => `${c.believers}/${c.hidden}/${c.doubters}/${c.skeptics}/${c.unaware}`).join("  "));
console.log(`\n--- how each believer came by it ---`);
for (const p of v.people.filter((x) => x.heresy >= 0.2)) {
  console.log(`  ${p.name}:`);
  for (const c of p.chain) console.log(`     ${c.kind.padEnd(9)} ${clockText(c.tick)} ${c.anomaly ? `[${c.anomaly}] ` : ""}${c.text}`);
}

// The ledger answers the same question on its own: why does the most recent convert believe it?
const L = buildLedger({ minds: w.minds, traces: s.traces, rumors: w.rumors, events: w.events, village: w.village });
const told = v.people.find((p) => p.heresy >= 0.2 && p.chain[0]?.kind === "told") ?? v.people.find((p) => p.heresy > 0);
if (told) {
  const b = heresyOf(w.minds[told.id]!)!;
  const tree = why(L, nodeId.item(told.id, b.id), { depth: 8 });
  if (tree) {
    console.log(`\n--- the ledger: why does ${told.name} believe "${b.proposition}"? ---`);
    const show = (t: typeof tree, depth: number) => {
      console.log(`${"   ".repeat(depth + 1)}${t.via ? `<${t.via.mechanism}> ` : ""}${clockText(t.node.tick)} [${t.node.kind}${t.node.agent ? ` ${name(t.node.agent)}` : ""}] ${t.node.label.slice(0, 140)}`);
      for (const c of t.causes.slice(0, 3)) show(c, depth + 1);
    };
    show(tree, 0);
    console.log(`   strongest chain: ${strongestChain(tree).map((n) => n.label.slice(0, 50)).join("  ->  ")}`);
  }
}
console.log(`\n${w.order.length} people, ${s.log.length} faculty calls (mock, $0), ${Date.now() - started}ms`);
