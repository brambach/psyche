import { beforeAll, describe, expect, it } from "vitest";
import { atlas, counterfactual, createVillage, schemaLineage, villageView, WorldSession } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const YEAR = 16;

async function years(n: number, seed = 11) {
  const s = new WorldSession(createVillage(seed), createMockFaculties(), { keepRecent: 8, keepDays: 8, maxTraces: 5000 });
  for (let d = 0; d < n * YEAR; d++) {
    for (let h = 0; h < 4; h++) await s.apply({ type: "advance", minutes: 360 }, { snapshot: false });
    if ((d + 1) % YEAR === 0) s.rebase();
  }
  return s;
}

describe("generations", () => {
  // One long run shared by the checks below: ten years of Hollow Bay on the mock.
  let run: WorldSession;
  beforeAll(async () => {
    run = await years(10);
  }, 600_000);

  it("is born, pairs, dies and keeps the dead", async () => {
    const s = await run;
    const v = villageView(s.world)!;
    expect(v.year).toBe(11);
    const born = v.people.filter((p) => p.generation > 0);
    expect(born.length).toBeGreaterThan(0);
    for (const p of born) expect(p.parents.length).toBe(2);
    const dead = v.people.filter((p) => !p.alive);
    expect(dead.length).toBeGreaterThan(0);
    for (const p of dead) {
      expect(s.world.order).not.toContain(p.id);
      expect(s.world.minds[p.id]).toBeDefined();
    }
    // Memory stays bounded across a decade.
    expect(s.traces.length).toBeLessThanOrEqual(5000);
    expect(s.frames.length).toBeLessThanOrEqual(4 * YEAR);
  }, 300_000);

  it("passes a fear to a child who never lived it, traced back to a first-hand memory", async () => {
    const s = await run;
    const inherited = atlas(s.world).flatMap((e) => e.holders.filter((h) => h.inherited && h.generation > 0));
    expect(inherited.length).toBeGreaterThan(0);
    for (const h of inherited) {
      const schema = s.world.minds[h.agent]!.schemas.find((x) => x.id === h.schema)!;
      const chain = schemaLineage(s.world, h.agent, schema);
      expect(chain[0]!.agent).toBe(h.agent);
      expect(chain[0]!.firstHand).toBe(false);
      const root = chain.at(-1)!;
      expect(root.agent).not.toBe(h.agent);
      expect(root.firstHand).toBe(true);
    }
  }, 300_000);

  it("establishes the store norm from sanctions, and feels it at later pledges", async () => {
    const s = await run;
    const n = s.world.village!.norms.find((x) => x.topic === "store")!;
    expect(n.established).toBeDefined();
    expect(n.rounds.length).toBeGreaterThanOrEqual(2);
    expect(n.strength).toBeGreaterThan(0);
  }, 300_000);

  it("runs years the same way twice", async () => {
    const a = await years(2);
    const b = await years(2);
    expect(JSON.stringify(b.world)).toBe(JSON.stringify(a.world));
  }, 300_000);

  it("answers what if not, and leaves the world alone", async () => {
    const s = new WorldSession(createVillage(11), createMockFaculties());
    for (let h = 0; h < 30; h++) await s.apply({ type: "advance", minutes: 60 });
    const before = JSON.stringify(s.world);
    const id = s.world.order.find((x) => s.world.minds[x]!.schemas.some((sc) => sc.triggers.includes("store") && sc.blameBias > 0))!;
    const sc = s.world.minds[id]!.schemas.find((x) => x.triggers.includes("store"))!;
    const r = (await counterfactual(s.world, createMockFaculties(), { agent: id, kind: "schema", id: sc.id }, 2))!;
    expect(r.label).toBe(sc.text);
    expect(r.compared).toBeGreaterThan(0);
    // A fear about sharing, taken away, makes giving look better at the next pledge.
    const pledge = r.margins.find((m) => /common store|token|hold/i.test(m.question));
    expect(pledge).toBeDefined();
    expect(JSON.stringify(s.world)).toBe(before);
    expect(await counterfactual(s.world, createMockFaculties(), { agent: id, kind: "schema", id: "nope" })).toBeUndefined();
  }, 60_000);
});
