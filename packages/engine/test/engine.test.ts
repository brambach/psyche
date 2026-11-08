import { describe, expect, it } from "vitest";
import {
  baseLevel,
  createMara,
  demoScript,
  retrieve,
  Session,
  sleep,
  updateTrust,
  type Ablations,
  type Faculties,
  type Percept,
} from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

async function runDemo(seed: number, ablations: Partial<Ablations> = {}) {
  const s = new Session(createMara(seed, ablations), createMockFaculties());
  for (const input of demoScript()) await s.apply(input);
  return s;
}

const percept = (over: Partial<Percept>): Percept => ({
  id: "pc_test",
  tick: 0,
  kind: "event",
  rawText: "",
  actor: "theo",
  addressedToSelf: false,
  about: ["theo"],
  topics: [],
  features: { outcomeForSelf: 0, agency: "other", intentional: 1, normViolation: 0, prospective: false, intensity: 0.5 },
  claims: [],
  details: [],
  gist: "",
  ...over,
});

describe("memory", () => {
  it("forgets on a power law and benefits from retrieval", () => {
    const now = 1000 * 60;
    const once = baseLevel([0], now, 0.5);
    const later = baseLevel([0], now * 2, 0.5);
    const rehearsed = baseLevel([0, now - 60], now, 0.5);
    expect(later).toBeLessThan(once);
    expect(rehearsed).toBeGreaterThan(once);
  });

  it("favours mood-congruent memories", () => {
    const mind = createMara(1);
    mind.affect.mood.valence = -0.8;
    const r = retrieve(mind, { about: ["theo"], topics: [] }, mind.tick);
    const dock = r.find((x) => x.id === "ep_dock")!;
    const roof = r.find((x) => x.id === "ep_roof")!;
    expect(dock.components.mood).toBeGreaterThan(0);
    expect(roof.components.mood).toBeLessThan(0);
    mind.ablations.moodCongruence = false;
    expect(retrieve(mind, { about: ["theo"], topics: [] }, mind.tick).every((x) => x.components.mood === 0)).toBe(true);
  });

  it("adopts post-event misinformation in a fraction of runs, and never when the mechanism is off", async () => {
    let on = 0;
    let off = 0;
    const N = 30;
    for (let seed = 1; seed <= N; seed++) {
      const a = await runDemo(seed);
      if (a.mind.episodes.find((e) => e.id === "ep_dock")!.details.find((d) => d.key === "arrival")!.value === "never showed up") on++;
      const b = await runDemo(seed, { misinformation: false });
      if (b.mind.episodes.find((e) => e.id === "ep_dock")!.details.find((d) => d.key === "arrival")!.value === "never showed up") off++;
    }
    expect(on / N).toBeGreaterThan(0.15);
    expect(on / N).toBeLessThan(0.8);
    expect(off).toBe(0);
  });

  it("does not swap in a claim while its source is still vivid", async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = await runDemo(seed);
      const junMoment = s.frames[2]!.traces.find((t) => t.kind === "perceive")!;
      const swaps = junMoment.reconsolidations.flatMap((r) => r.version.changes).filter((c) => c.cause === "misinformation");
      expect(swaps).toHaveLength(0);
    }
  });

  it("keeps the original event intact in the world record", async () => {
    const s = await runDemo(2);
    for (const d of s.mind.episodes.find((e) => e.id === "ep_dock")!.details) {
      expect(d.original).toBe(createMara(2).episodes.find((e) => e.id === "ep_dock")!.details.find((x) => x.key === d.key)!.original);
    }
  });
});

describe("social", () => {
  it("loses trust faster than it gains it", () => {
    const up = createMara(1);
    const down = createMara(1);
    updateTrust(up, percept({ features: { outcomeForSelf: 0.5, agency: "other", intentional: 1, normViolation: 0, prospective: false, intensity: 0.5 } }));
    updateTrust(down, percept({ features: { outcomeForSelf: -0.5, agency: "other", intentional: 1, normViolation: 0, prospective: false, intensity: 0.5 } }));
    const base = createMara(1).others.theo!.trust.benevolence;
    expect(base - down.others.theo!.trust.benevolence).toBeGreaterThan(2 * (up.others.theo!.trust.benevolence - base));

    const flat = createMara(1, { negativityAsymmetry: false });
    updateTrust(flat, percept({ features: { outcomeForSelf: -0.5, agency: "other", intentional: 1, normViolation: 0, prospective: false, intensity: 0.5 } }));
    expect(base - flat.others.theo!.trust.benevolence).toBeCloseTo(up.others.theo!.trust.benevolence - base, 5);
  });
});

describe("workspace and decisions", () => {
  it("holds at most four items and only cites what is in it", async () => {
    const s = await runDemo(3);
    for (const t of s.frames.flatMap((f) => f.traces).filter((t) => t.kind === "perceive")) {
      expect(t.workspace.length).toBeLessThanOrEqual(4);
      const refs = new Set(t.workspace.map((w) => w.ref));
      if (t.decision?.system === 2) for (const b of t.decision.because) expect(refs.has(b.ref)).toBe(true);
    }
  });

  it("drops deliberation citations that point outside the workspace", async () => {
    const mock = createMockFaculties();
    const sneaky: Faculties = {
      ...mock,
      deliberate: async (req) => ({ choice: req.options[0]!.id, because: [{ item: "ep_roof_not_in_mind", weight: 1 }], monologue: "" }),
    };
    const s = new Session(createMara(1, { systemTwo: "always" }), sneaky);
    const f = await s.apply(demoScript()[5]!);
    const t = f.traces.find((x) => x.kind === "perceive")!;
    expect(t.decision!.because.some((b) => b.ref === "ep_roof_not_in_mind")).toBe(false);
  });
});

describe("sleep", () => {
  it("rejects generalizations the evidence does not support", async () => {
    const mind = createMara(1);
    const liar: Faculties = {
      ...createMockFaculties(),
      dream: async () => ({ generalizations: [{ about: "jun", proposition: "Jun is out to get me", valence: -0.9, evidence: ["ep_jun_catch"] }], lifeStory: "" }),
    };
    const before = mind.beliefs.length;
    await sleep(mind, mind.tick, liar);
    expect(mind.beliefs.length).toBe(before);
  });
});

describe("event log", () => {
  it("is deterministic for a seed", async () => {
    const a = await runDemo(5);
    const b = await runDemo(5);
    expect(JSON.stringify(b.mind)).toBe(JSON.stringify(a.mind));
  });

  it("replays exactly from the recorded calls, with no live faculties", async () => {
    const a = await runDemo(6);
    const { session, divergedAt } = await Session.replay(createMara(6), a.inputs, a.log);
    expect(divergedAt).toBeUndefined();
    expect(JSON.stringify(session.mind)).toBe(JSON.stringify(a.mind));
  });

  it("rewinds to any frame", async () => {
    const a = await runDemo(7);
    const target = JSON.stringify(a.frames[3]!.state);
    a.rewind(3);
    expect(JSON.stringify(a.mind)).toBe(target);
    expect(a.inputs).toHaveLength(4);
  });

  it("reports divergence when a mechanism changes the history", async () => {
    const a = await runDemo(2);
    const replay = Session.replay(createMara(2, { reconsolidation: false, moodCongruence: false }), a.inputs, a.log);
    await expect(replay).rejects.toThrow(/diverged/);
    const withLive = await Session.replay(createMara(2, { reconsolidation: false, moodCongruence: false }), a.inputs, a.log, createMockFaculties());
    expect(withLive.divergedAt).toBeDefined();
  });
});
