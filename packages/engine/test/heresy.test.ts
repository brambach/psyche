import { describe, expect, it } from "vitest";
import {
  buildLedger,
  createVillage,
  CORE_TEXT,
  dayOf,
  enableHeresy,
  factionOf,
  genealogy,
  heresyOf,
  heresyView,
  hourOf,
  nodeId,
  silenceOf,
  susceptibility,
  voiceFromSky,
  WorldSession,
  type WorldState,
} from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const faculties = createMockFaculties();
const sinkOf = (s: WorldSession) => ({ feed: s.feed, traces: s.traces });

/** Advance hour by hour until the world clock reaches a day and hour. */
async function until(s: WorldSession, day: number, hour: number) {
  while (dayOf(s.world.tick) < day || (dayOf(s.world.tick) === day && Math.floor(hourOf(s.world.tick)) < hour)) await s.apply({ type: "advance", minutes: 60 });
}

function openest(w: WorldState, skip: string[] = []): string {
  return w.order.filter((x) => !skip.includes(x)).sort((a, b) => susceptibility(w.minds[b]!) - susceptibility(w.minds[a]!))[0]!;
}

/** The secret behind someone's core belief: what a voice that knows too much would say. */
function secretOf(w: WorldState, id: string): string {
  const m = w.minds[id]!;
  const ep = m.schemas[0]?.origin?.map((o) => m.episodes.find((e) => e.id === o)).find(Boolean);
  return `I know about this: ${(ep?.gist ?? m.schemas[0]!.text).replace(/\.$/, "")}. Nobody told me.`;
}

describe("The made world", () => {
  it("is off unless switched on, and the same seed gives the same history", async () => {
    expect(createVillage(11).heresy).toBeUndefined();
    const run = async () => {
      const w = createVillage(5);
      enableHeresy(w);
      const s = new WorldSession(w, faculties, { keepRecent: 2 });
      await until(s, 2, 10);
      await voiceFromSky(s.world, openest(s.world), "You are being watched, every one of you.", faculties, sinkOf(s));
      await until(s, 6, 12);
      return JSON.stringify(heresyView(s.world)!.census) + JSON.stringify(s.world.heresy!.anomalies.map((a) => [a.kind, a.agent, a.tick]));
    };
    expect(await run()).toBe(await run());
  });

  it("turns a voice that knew a secret into an uncanny memory, and by morning a suspicion that traces back to it", async () => {
    const w = createVillage(11);
    enableHeresy(w);
    const s = new WorldSession(w, faculties, { keepRecent: 2 });
    await until(s, 2, 10);
    const who = openest(s.world, ["mara", "theo", "jun", "corran", "wren"]);
    await voiceFromSky(s.world, who, secretOf(s.world, who), faculties, sinkOf(s));
    await s.apply({ type: "advance", minutes: 10 });
    const h = s.world.heresy!;
    const a = h.anomalies.find((x) => x.agent === who);
    expect(a?.kind).toBe("secret");
    const m = s.world.minds[who]!;
    const ep = m.episodes.find((e) => e.id === a!.id)!;
    expect(ep.topics).toContain("uncanny");
    // Overnight, the evidence becomes a belief about the world, resting on that memory.
    await until(s, 3, 9);
    const H = heresyOf(m)!;
    expect(H).toBeDefined();
    expect(H.source.kind).toBe("inferred");
    expect(H.evidence).toContain(ep.id);
    expect(H.confidence).toBeGreaterThanOrEqual(0.3);
    const L = buildLedger({ minds: s.world.minds, traces: s.traces, rumors: s.world.rumors, events: s.world.events, village: s.world.village });
    const g = genealogy(L, nodeId.item(who, H.id))!;
    expect(g.ancestors.some((x) => x.node.id === nodeId.item(who, ep.id))).toBe(true);
  });

  it("spreads as a story with a lineage, and splits the town into believers, doubters and skeptics", async () => {
    const w = createVillage(5);
    enableHeresy(w);
    const s = new WorldSession(w, faculties, { keepRecent: 2, maxTraces: 20_000 });
    await until(s, 2, 10);
    const first = openest(s.world, ["mara", "theo", "jun", "corran", "wren"]);
    await voiceFromSky(s.world, first, "You are being watched, every one of you, since the day you landed.", faculties, sinkOf(s));
    await until(s, 4, 15);
    const second = openest(s.world, ["mara", "theo", "jun", "corran", "wren", first]);
    await voiceFromSky(s.world, second, secretOf(s.world, second), faculties, sinkOf(s));
    await until(s, 20, 12);
    const wv = s.world;
    const v = heresyView(wv)!;
    expect(v.lines.length).toBeGreaterThan(0);
    expect(v.lines.reduce((n, l) => n + l.hops.length, 0)).toBeGreaterThanOrEqual(3);
    // Different people end up in different places.
    expect(new Set(v.people.map((p) => p.faction)).size).toBeGreaterThanOrEqual(3);
    // Every told belief names its teller, and the ledger links it to the teller's own belief in the same story.
    const L = buildLedger({ minds: wv.minds, traces: s.traces, rumors: wv.rumors, events: wv.events, village: wv.village });
    const told = wv.order.map((id) => ({ id, b: heresyOf(wv.minds[id]!) })).filter((x) => x.b?.source.kind === "told");
    expect(told.length).toBeGreaterThan(0);
    for (const { id, b } of told) {
      const from = b!.source.from!;
      const theirs = wv.minds[from]!.beliefs.find((x) => x.rumor === b!.rumor);
      if (!theirs) continue;
      expect(L.edges.some((e) => e.from === nodeId.item(from, theirs.id) && e.to === nodeId.item(id, b!.id) && e.mechanism === "passed on")).toBe(true);
    }
    // And the chain behind someone who was told goes back to someone who saw it for themselves.
    const p = v.people.find((x) => x.chain[0]?.kind === "told");
    expect(p).toBeDefined();
    expect(p!.chain.some((c) => c.kind === "firsthand")).toBe(true);
    expect(p!.chain.some((c) => c.kind === "anomaly")).toBe(true);
  });

  it("has a closed, orderly leader denounce it: the agreeable go quiet, the defiant believe it more", async () => {
    const w = createVillage(11);
    const ids = w.order.slice(5);
    const [leader, defiant, meek] = ids as [string, string, string];
    // Temperaments set before anyone is watching for edits.
    Object.assign(w.minds[leader]!.traits, { openness: 0.15, conscientiousness: 0.9, agreeableness: 0.3 });
    Object.assign(w.minds[defiant]!.traits, { openness: 0.9, agreeableness: 0.15, neuroticism: 0.2 });
    Object.assign(w.minds[meek]!.traits, { openness: 0.6, agreeableness: 0.9, neuroticism: 0.8, extraversion: 0.1 });
    w.village!.civic = { leader, elections: [], laws: [], foundingDays: [] };
    for (const [id, c] of [[defiant, 0.62], [meek, 0.6]] as const) {
      const m = w.minds[id]!;
      m.beliefs.push({ id: `bel_test_${id}`, about: "world", topics: ["world", "uncanny", "made-world"], proposition: "The world was made, and someone is watching it.", confidence: c, valence: -0.3, source: { kind: "inferred" }, formed: w.tick, evidence: [], retrievals: [w.tick] });
    }
    // The leader has heard what the defiant one has been saying.
    const L0 = w.minds[leader]!;
    L0.beliefs.push({ id: "bel_test_scorn", about: defiant, topics: ["world", "made-world", "madness"], proposition: `${w.minds[defiant]!.name} has been saying the world is made.`, confidence: 0.7, valence: -0.45, source: { kind: "inferred" }, formed: w.tick, evidence: [], retrievals: [w.tick] });
    enableHeresy(w);
    const s = new WorldSession(w, faculties, { keepRecent: 2 });
    let before = 0;
    // Everyone at the fire each evening until the leader speaks.
    for (let day = 1; day <= 6 && !s.world.heresy!.events.some((e) => e.kind === "denounce"); day++) {
      await until(s, day + 1, 19);
      before = heresyOf(s.world.minds[defiant]!)!.confidence;
      for (const id of s.world.order) s.world.agents[id]!.override = { place: "tavern", activity: "at the fire", until: s.world.tick + 180 };
      for (let i = 0; i < 12 && !s.world.heresy!.events.some((e) => e.kind === "denounce"); i++) await s.apply({ type: "advance", minutes: 10 });
    }
    const h = s.world.heresy!;
    const d = h.events.find((e) => e.kind === "denounce");
    expect(d, "the leader denounced it").toBeDefined();
    expect(d!.agents[0]).toBe(leader);
    expect(factionOf(s.world, leader)).toBe("authority");
    expect(heresyOf(s.world.minds[defiant]!)!.confidence).toBeGreaterThan(before);
    const quiet = silenceOf(s.world.minds[meek]!);
    expect(quiet?.confidence ?? 0).toBeGreaterThan(0.2);
    expect(quiet!.evidence.length).toBeGreaterThan(0);
    expect(s.feed.some((f) => f.chronicle?.kind === "heresy" && /denounces/.test(f.title))).toBe(true);
  });

  it("notices a mind edited from outside: a certainty with no memory behind it, a friend who changed overnight", async () => {
    const w = createVillage(11);
    enableHeresy(w);
    const s = new WorldSession(w, faculties, { keepRecent: 2 });
    await until(s, 2, 8);
    const target = "jun";
    const m = s.world.minds[target]!;
    Object.assign(m.traits, { openness: Math.min(1, m.traits.openness + 0.3), agreeableness: Math.max(0, m.traits.agreeableness - 0.3) });
    m.schemas.push({ id: "sch_edit", text: "The sea will take me one day.", triggers: ["sea"], blameBias: 0, threatBias: 0.1, strength: 0.5 });
    await s.apply({ type: "advance", minutes: 10 });
    await until(s, 4, 12);
    const h = s.world.heresy!;
    expect(h.changed.some((c) => c.who === target)).toBe(true);
    expect(h.anomalies.some((a) => a.agent === target && a.kind === "orphan" && a.text.includes("The sea will take me"))).toBe(true);
  });

  it("lets a moment from a timeline that was wound back come round again as déjà vu", async () => {
    const w = createVillage(11);
    enableHeresy(w);
    const s = new WorldSession(w, faculties, { keepRecent: 200 });
    await until(s, 2, 7);
    const mark = s.frames.length - 1;
    await until(s, 3, 7);
    s.rewind(mark);
    const residue = Object.values(s.world.heresy!.residue).flat().length;
    expect(residue).toBeGreaterThan(0);
    await until(s, 3, 7);
    expect(s.world.heresy!.anomalies.some((a) => a.kind === "deja_vu")).toBe(true);
  });

  it("does not make believers out of echoes alone", async () => {
    const w = createVillage(11);
    enableHeresy(w);
    const s = new WorldSession(w, faculties, { keepRecent: 2 });
    await until(s, 10, 12);
    const h = s.world.heresy!;
    expect(h.anomalies.some((a) => a.kind === "echo")).toBe(true);
    for (const id of s.world.order) expect(heresyOf(s.world.minds[id]!)?.confidence ?? 0).toBeLessThan(0.5);
    for (const id of s.world.order) expect(s.world.minds[id]!.schemas.some((x) => x.text === CORE_TEXT)).toBe(false);
  });
});
