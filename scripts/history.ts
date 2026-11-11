// The causal history over decades. Runs a region of towns for years on the offline mock the way the
// server does (one town live, hour by hour; each session keeping only its newest traces), reading the
// live ledger into the history as it goes. Then walks one late choice back as far as it goes, follows
// one old fear forward, and asks the offline Historian a question.
// Usage: npm run history -- [years] [seed] [question...]     (--save file.json keeps the history, --brief prints what the Historian reads)
import { writeFileSync } from "node:fs";
import { agoText, buildBrief, CausalHistory, longestThread, offlineHistorian, origins, reach, RegionSession, regionView, strongestThread, trail, whenText, type ThreadStep, type WorldSession } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--save");
const years = Number(args[0] ?? 30);
const seed = Number(args[1] ?? 11);
const question = args.slice(2).join(" ");
const saveTo = process.argv.includes("--save") ? process.argv[process.argv.indexOf("--save") + 1] : undefined;

const KEEP = 4000;
const mock = createMockFaculties();
const rs = RegionSession.create(seed, mock, { session: { keepRecent: 0, keepDays: 0, maxTraces: KEEP, maxFeed: 2000 }, live: 1, cheap: mock, maxTowns: 16 });
const H = new CausalHistory();
const yearDays = 16;
const read = new WeakMap<WorldSession, number>();
let spent = 0;
const absorb = (force = false) => {
  for (const [town, s] of Object.entries(rs.towns)) {
    const total = s.traceBase + s.traces.length;
    const fresh = total - (read.get(s) ?? 0);
    // Read well before the session lets its oldest traces go.
    if (fresh <= 0 || (!force && fresh < KEEP / 5)) continue;
    spent += H.absorb({ world: s.world, traces: s.traces, fresh, town, chronicle: rs.region.chronicle }).ms;
    read.set(s, total);
  }
};
const start = Date.now();
for (let d = 0; d < years * yearDays; d++) {
  for (let h = 0; h < 4; h++) await rs.advance(360, { snapshot: false });
  absorb();
  if ((d + 1) % yearDays === 0) {
    rs.rebase();
    const v = regionView(rs);
    if (v.year % 5 === 1 || d + 1 === years * yearDays) {
      const z = H.size;
      console.log(`after year ${v.year - 1}: ${v.towns.map((t) => `${t.name} ${t.people}`).join(", ")}; ${z.moments} choices kept, ${z.nodes} nodes, ${z.edges} links, heap ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB, ${Math.round((Date.now() - start) / 1000)}s`);
    }
  }
}
absorb(true);
const live = Object.values(rs.towns)[0]!;
const cal = H.calendar;
const z = H.size;
const bytes = JSON.stringify(H).length;
console.log(`\n${years} years in ${Math.round((Date.now() - start) / 1000)}s (${Math.round(spent / 100) / 10}s of it reading the ledger, ${H.readings} readings).`);
console.log(`The live town's session holds its newest ${live.traces.length} traces (from ${whenText(cal, live.traces[0]!.trace.tick)}). The history holds ${z.moments} choices by ${z.people} people, ${z.nodes} nodes and ${z.edges} links back to ${whenText(cal, Math.min(...[...H.nodes.values()].map((n) => (Number.isFinite(n.tick) ? n.tick : Infinity))))}: ${(bytes / 1e6).toFixed(1)} MB saved.`);

const name = (a?: string) => (a ? (H.people[a]?.name ?? a) : "the world");
const show = (steps: ThreadStep[]) => {
  for (const st of steps) {
    console.log(`   ${whenText(cal, st.node.tick).padEnd(28)} ${name(st.node.agent).padEnd(8)} ${st.node.kind.padEnd(9)} ${st.node.label}`);
    if (st.mechanism) console.log(`   ${"".padEnd(28)} ↓ ${st.mechanism}`);
  }
};

// The late choice whose causes reach furthest back, through the most heads.
const late = H.moments.filter((m) => m.tick > H.to - 3 * yearDays * 1440 && m.kind !== "talk");
let best: { id: string; score: number; steps: ThreadStep[] } | undefined;
for (const m of late) {
  const steps = longestThread(trail(H, m.id)!);
  const oldest = Math.min(...steps.map((x) => (Number.isFinite(x.node.tick) ? x.node.tick : Infinity)));
  if (!Number.isFinite(oldest)) continue;
  const score = (m.tick - Math.max(oldest, -20 * 365 * 1440)) / (yearDays * 1440) + 12 * (new Set(steps.map((x) => x.node.agent).filter(Boolean)).size - 1) + steps.length;
  if (!best || score > best.score) best = { id: m.id, score, steps };
}
if (best) {
  const m = H.moment(best.id)!;
  const o = origins(H, m.id)!;
  const oldest = Math.min(...best.steps.map((x) => (Number.isFinite(x.node.tick) ? x.node.tick : Infinity)));
  console.log(`\n=== A choice from ${whenText(cal, m.tick)}, walked back to something ${agoText(cal, oldest, m.tick)}`);
  console.log(`${m.question} ${m.answer}`);
  show(best.steps);
  console.log(`   Strongest thread: ${strongestThread(trail(H, m.id)!).map((x) => x.node.label).join("  →  ")}`);
  console.log(`   ${o.ancestors.length} causes upstream, through ${o.minds.map(name).join(", ") || "nobody else"}; ${o.roots.length} starting points.`);
}

// The fear that has bent the most choices.
const fears = [...H.weights.values()]
  .filter((c) => c.kind === "schema")
  .map((c) => ({ c, r: reach(H, cal, c.id)! }))
  .sort((a, b) => b.r.choices.length - a.r.choices.length);
const fear = fears[0];
if (fear) {
  console.log(`\n=== The core belief that has bent the most choices: ${name(fear.c.agent)}'s “${fear.c.label}”`);
  show(longestThread(trail(H, fear.c.id)!));
  console.log(`   It went on to shape ${fear.r.choices.length} choices: ${fear.r.minds.slice(0, 6).map((x) => `${name(x.agent)} ${x.choices}`).join(", ")}`);
  console.log(`   By year: ${fear.r.byYear.map((y) => `${y.year}:${y.choices}`).join(" ")}`);
}

const q = question || (best ? `Why did ${name(H.moment(best.id)!.agent)} do that in year ${whenText(cal, H.moment(best.id)!.tick).split(',')[0]!.replace('year ', '')}, and where did it start?` : "What happened?");
const brief = buildBrief(H, q, question ? {} : { focus: best ? [best.id] : undefined });
console.log(`\n=== Asking the Historian (offline): ${q}\n`);
console.log(offlineHistorian(brief).answer);
console.log(`\n(The brief is ${brief.text.length} characters, about ${Math.round(brief.text.length / 4)} tokens: what Opus would read to answer this.)`);
if (flags.includes("--brief")) console.log(`\n${brief.text}`);
if (saveTo) {
  writeFileSync(saveTo, JSON.stringify(H));
  console.log(`\nSaved the history to ${saveTo}.`);
}
