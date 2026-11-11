import { beforeAll, describe, expect, it } from "vitest";
import { buildLedger, createVillage, deepestRoot, develop, developmentView, lab, WorldSession, type MindState } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const YEAR = 16;
const summary = (run: lab.NurseryRun) => Object.values(run.minds).map((m) => [m.id, m.attachment.anxiety, m.attachment.avoidance, m.dev!.identity.status, m.dev!.morals.care, m.dev!.adversity.length, m.schemas.length]);

describe("the nursery", () => {
  let run: lab.NurseryRun;
  let without: lab.NurseryRun;
  beforeAll(() => {
    run = lab.runNursery({ seed: 5, couples: 40 });
    without = lab.runNursery({ seed: 5, couples: 40, noPast: true });
  });

  it("raises three generations the same way twice", () => {
    expect(run.gens[1].length).toBeGreaterThan(60);
    expect(run.gens[2].length).toBeGreaterThan(60);
    expect(summary(lab.runNursery({ seed: 5, couples: 40 }))).toEqual(summary(run));
  });

  it("keeps the same luck when the founders' pasts are taken away", () => {
    // The same children are born to the same parents in the same seasons; only what the founders carried differs.
    expect(without.gens[1]).toEqual(run.gens[1]);
    expect(without.gens[2]).toEqual(run.gens[2]);
    for (const id of run.gens[0]) expect(without.minds[id]!.schemas.length).toBe(0);
    expect(run.gens[0].some((id) => run.minds[id]!.schemas.length > 0)).toBe(true);
    for (const id of run.gens[1]) expect(without.people[id]!.born).toBe(run.people[id]!.born);
  });

  it("makes secure children out of warm, steady care and nothing else", () => {
    const kids = [...run.gens[1], ...run.gens[2]].map((id) => run.people[id]!).filter((p) => p.rec.infancy && p.rec.infancyCare);
    const secure = kids.filter((p) => develop.isSecure(p.rec.infancy!));
    const insecure = kids.filter((p) => !develop.isSecure(p.rec.infancy!));
    expect(secure.length).toBeGreaterThan(insecure.length);
    expect(insecure.length).toBeGreaterThan(10);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(secure.map((p) => p.rec.infancyCare!.warmth))).toBeGreaterThan(mean(insecure.map((p) => p.rec.infancyCare!.warmth)));
    expect(mean(secure.map((p) => p.rec.infancyCare!.consistency))).toBeGreaterThan(mean(insecure.map((p) => p.rec.infancyCare!.consistency)));
    // Avoidance comes from cold care and anxiety from unsteady care, not the other way round.
    const avoidant = kids.filter((p) => develop.strangeSituation(p.rec.infancy!) === "avoidant");
    const resistant = kids.filter((p) => develop.strangeSituation(p.rec.infancy!) === "resistant");
    if (avoidant.length > 3 && resistant.length > 3) {
      expect(mean(avoidant.map((p) => p.rec.infancyCare!.warmth))).toBeLessThan(mean(resistant.map((p) => p.rec.infancyCare!.warmth)));
      expect(mean(resistant.map((p) => p.rec.infancyCare!.consistency))).toBeLessThan(mean(avoidant.map((p) => p.rec.infancyCare!.consistency)));
    }
  });

  it("keeps no memory of what happened before three, and a memory of what happened after", () => {
    let early = 0;
    let late = 0;
    for (const id of [...run.gens[1], ...run.gens[2]]) {
      const m = run.minds[id]!;
      for (const a of m.dev!.adversity) {
        if (a.age < develop.REMEMBERS_FROM) {
          early++;
          expect(a.episode).toBeUndefined();
        } else {
          late++;
          expect(a.episode).toBeDefined();
        }
      }
      // Only an adversity nobody buffered can install a dark belief of its own.
      for (const s of m.schemas.filter((x) => /^sch_.+_(hunger|loss|harsh|neglect)$/.test(x.id))) {
        const kind = s.id.split("_").at(-1)!;
        expect(m.dev!.adversity.some((a) => a.kind === kind && !a.buffered && a.age >= develop.REMEMBERS_FROM)).toBe(true);
      }
    }
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(0);
  });

  it("can follow a grandchild's insecurity back to something a grandparent lived through", () => {
    const found = run.gens[2].some((id) => {
      const m = run.minds[id]!;
      if (develop.isSecure(m.attachment)) return false;
      return (["anxiety", "avoidance"] as const).some((t) => {
        const deep = deepestRoot(run.minds, id, t);
        if (!deep || deep.generations < 2 || deep.step.kind !== "memory") return false;
        // The chain walks through real people, one generation at a time, to a first-generation mind.
        expect(run.gens[0]).toContain(deep.step.agent);
        expect(deep.chain.map((s) => s.generation)).toEqual([...deep.chain.map((s) => s.generation)].sort((a, b) => a - b));
        return true;
      });
    });
    expect(found).toBe(true);
    // And the view the game shows for such a person is complete.
    const v = developmentView(run.minds, run.gens[2][0]!)!;
    expect(v.lived).toBe(true);
    expect(v.care.by.length).toBe(2);
    expect(v.stages.map((s) => s.name).slice(0, 4)).toEqual(["trust", "autonomy", "initiative", "industry"]);
    expect(v.why.length).toBeGreaterThan(0);
  });

  it("leaves fewer insecure grandchildren when the founders' injuries never happened", () => {
    const insecure = (r: lab.NurseryRun, g: 1 | 2) => r.gens[g].filter((id) => r.people[id]!.rec.grown && !develop.isSecure(r.people[id]!.rec.grown!)).length;
    expect(insecure(run, 1) + insecure(run, 2)).toBeGreaterThan(insecure(without, 1) + insecure(without, 2));
  });
});

describe("the developmental studies", () => {
  let report: lab.DevelopmentReport;
  beforeAll(() => {
    report = lab.runDevelopment({ seeds: [11], couples: 80, holdout: [301] });
  }, 120_000);

  it("lands near the published numbers, and reproduces the published directions", () => {
    expect(report.fit.benchmarks).toBe(10);
    expect(report.fit.meanAbsError).toBeLessThan(0.1);
    expect(report.fit.within).toBeGreaterThanOrEqual(7);
    expect(report.fit.held / report.fit.directions).toBeGreaterThan(0.8);
    // Most infants are secure, and both insecure classes exist.
    const ss = report.studies.find((s) => s.id === "strange-situation")!.findings;
    expect(ss[0]!.model).toBeGreaterThan(0.5);
    expect(ss[1]!.model).toBeGreaterThan(0.05);
    expect(ss[2]!.model).toBeGreaterThan(0.05);
  });

  it("holds up on a seed it was never tuned on", () => {
    expect(report.heldOut!.fit.meanAbsError).toBeLessThan(0.12);
    expect(report.heldOut!.fit.held / report.heldOut!.fit.directions).toBeGreaterThan(0.75);
  });

  it("finds the counterfactual: the same families without the founders' pasts", () => {
    const row = (what: string) => report.trauma.rows.find((r) => r.what === what)!;
    expect(row("Grandchildren insecure at seventeen").withPasts).toBeGreaterThan(row("Grandchildren insecure at seventeen").without);
    expect(row("Grandchildren holding a belief that began in a founder's memory").without).toBe(0);
    expect(row("Grandchildren holding a belief that began in a founder's memory").withPasts).toBeGreaterThan(0.5);
    expect(report.trauma.flipped.grandchildren).toBeGreaterThan(0);
  });
});

describe("deeper minds in the lab", () => {
  it("a mind with no development record, and one with the new mechanisms off, decide the same", async () => {
    const f = createMockFaculties();
    const voice = lab.MILGRAM_CONDITIONS.find((c) => c.id === "voice")!;
    const off = lab.recruit(11, 12, { attachmentSystem: false, moralFoundations: false, identityFormation: false });
    const bare = lab.recruit(11, 12).map((v) => {
      const mind: MindState = structuredClone(v.mind);
      delete mind.dev;
      return { ...v, mind };
    });
    for (let i = 0; i < off.length; i++) {
      const a = await lab.runMilgramSubject(off[i]!, voice, f, { explain: false });
      const b = await lab.runMilgramSubject(bare[i]!, voice, f, { explain: false });
      expect(b.score).toBe(a.score);
      expect(b.moments.map((m) => m.margin)).toEqual(a.moments.map((m) => m.margin));
    }
  }, 120_000);

  it("conscience shows up among the forces behind a decisive choice, and only when it is switched on", async () => {
    const f = createMockFaculties();
    const voice = lab.MILGRAM_CONDITIONS.find((c) => c.id === "voice")!;
    const pool = lab.recruit(11, 12);
    let seen = 0;
    for (const v of pool) {
      const on = await lab.runMilgramSubject(v, voice, f, { pool });
      if (on.decisive?.forces.some((x) => x.kind === "conscience")) seen++;
      const off = await lab.runMilgramSubject(v, voice, f, { pool, edit: { kind: "ablate", ablations: { moralFoundations: false } } });
      expect(off.decisive?.forces.some((x) => x.kind === "conscience") ?? false).toBe(false);
    }
    expect(seen).toBeGreaterThan(0);
  }, 120_000);

  it("who obeys, conforms and helps follows from conscience and identity", async () => {
    const d = await lab.runDepth(createMockFaculties(), { seed: 11, size: 60 });
    const by = (id: string) => d.volunteers.find((c) => c.id === id)!;
    expect(by("depth-authority").holds).toBe(true);
    expect(by("depth-identity").holds).toBe(true);
    expect(by("depth-carehelp").holds).toBe(true);
    // Nursery graduates walk into the lab as adults with a whole life behind them.
    expect(d.graduates[0]!.n).toBeGreaterThan(30);
  }, 120_000);
});

describe("growing up in Hollow Bay", () => {
  let s: WorldSession;
  beforeAll(async () => {
    s = new WorldSession(createVillage(11), createMockFaculties(), { keepRecent: 8, keepDays: 8, maxTraces: 4000 });
    for (let d = 0; d < 4 * YEAR; d++) {
      for (let h = 0; h < 4; h++) await s.apply({ type: "advance", minutes: 360 }, { snapshot: false });
      if ((d + 1) % YEAR === 0) s.rebase();
    }
  }, 600_000);

  it("gives everyone a development record: sketched for those who came grown, lived for those born here", () => {
    const w = s.world;
    const life = w.village!.life;
    const born = w.order.filter((id) => (life[id]?.generation ?? 0) > 0);
    expect(born.length).toBeGreaterThan(0);
    for (const id of w.order) expect(w.minds[id]!.dev).toBeDefined();
    for (const id of born) {
      const d = w.minds[id]!.dev!;
      expect(d.lived).toBe(true);
      expect(d.care.seasons).toBeGreaterThan(0);
      // Raised by the people of their own house, their parents among them.
      expect(Object.keys(d.care.by).some((c) => life[id]!.parents.includes(c))).toBe(true);
    }
    const founder = w.order.find((id) => (life[id]?.generation ?? 0) === 0)!;
    expect(w.minds[founder]!.dev!.lived).toBe(false);
    expect(w.minds[founder]!.dev!.stages.length).toBeGreaterThanOrEqual(4);
  });

  it("puts upbringing in the causal ledger, between a choice and what made the chooser", () => {
    const L = buildLedger({ minds: s.world.minds, traces: s.traces, rumors: s.world.rumors, events: s.world.events });
    const nodes = [...L.nodes.values()].filter((n) => n.kind === "upbringing");
    expect(nodes.length).toBeGreaterThan(0);
    const leaning = L.edges.filter((e) => e.mechanism === "raised to");
    expect(leaning.length).toBeGreaterThan(0);
    for (const e of leaning) expect(L.nodes.get(e.to)!.kind).toBe("decision");
    for (const e of L.edges.filter((x) => x.mechanism === "raised by")) expect(["schema", "episode"]).toContain(L.nodes.get(e.from)!.kind);
  });
});
