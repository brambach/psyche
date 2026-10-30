import { beforeAll, describe, expect, it } from "vitest";
import { compareMyths, craftLineage, CROSSING, dematerialize, drift, foundingVersion, materialize, RegionSession, regionView, rootOf, timeline, digest, createVillage, schemaLineage } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const YEAR = 16 * 1440;

describe("the aggregate tier", () => {
  let rs: RegionSession;
  beforeAll(async () => {
    const mock = createMockFaculties();
    rs = RegionSession.create(11, mock, { session: { keepRecent: 0, keepDays: 0, maxTraces: 1000 }, maxTowns: 6, splitAt: 40, cheap: mock });
    rs.setLive(0);
    for (let t = 0; t < 40 * YEAR; t += 1440) await rs.advance(1440, { snapshot: false });
  }, 300_000);

  it("keeps a town's people, core beliefs, crafts and founding story through dematerialize and back", () => {
    const w = createVillage(11);
    const agg = dematerialize(w);
    const back = materialize(agg);
    expect(back.order).toEqual(w.order);
    for (const id of w.order) {
      expect(back.minds[id]!.schemas.map((s) => s.text)).toEqual(w.minds[id]!.schemas.map((s) => s.text));
      expect(foundingVersion(back.minds, id, CROSSING)?.id).toBe(foundingVersion(w.minds, id, CROSSING)?.id);
    }
    expect(back.village!.knowledge).toEqual(w.village!.knowledge);
    expect(back.village!.aggregate).toBeUndefined();
  });

  it("runs decades on rules: the region grows and splits", () => {
    const v = regionView(rs);
    expect(v.year).toBeGreaterThanOrEqual(40);
    expect(v.towns.length).toBeGreaterThanOrEqual(3);
    expect(v.towns.every((t) => t.tier === "aggregate")).toBe(true);
    expect(v.towns.reduce((s, t) => s + t.people, 0)).toBeGreaterThan(100);
    const seen = new Set<string>();
    for (const t of rs.region.towns)
      for (const id of rs.world(t.id).order) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
  });

  it("still follows every town's founding story back to someone who was there", () => {
    const m = compareMyths(rs);
    for (const t of m.towns) {
      expect(t.dominant, `${t.name} has lost the story`).toBeDefined();
      for (const v of t.versions) expect(v.chain.at(-1)!.agent).toBe(v.root.agent);
    }
    // And fears passed down at bedtime by rule still have a lineage.
    const w = rs.world(rs.region.towns.at(-1)!.id);
    const inherited = w.order.flatMap((id) => w.minds[id]!.schemas.map((s) => schemaLineage(w, id, s))).filter((c) => c.length > 1);
    for (const c of inherited) expect(c.at(-1)!.firstHand).toBe(true);
  });

  it("explains why each group left, from first causes", () => {
    const f = rs.region.chronicle.filter((c) => c.kind === "founding");
    expect(f.length).toBeGreaterThanOrEqual(2);
    for (const c of f) {
      expect(c.why!.length).toBeGreaterThanOrEqual(2);
      expect(c.why![0]!.text).toMatch(/grown to \d+ people/);
    }
  });

  it("keeps who taught whom each craft, and says why one was lost", () => {
    for (const t of rs.region.towns) {
      const w = rs.world(t.id);
      const k = w.village!.knowledge!;
      for (const id of w.order)
        for (const x of k.known[id] ?? []) {
          const line = craftLineage(w, id, x.craft);
          expect(line[0]!.agent).toBe(id);
          // The chain ends where someone worked it out, brought it, or the teacher's record left with them.
          expect(line.length).toBeGreaterThanOrEqual(1);
        }
    }
    const lost = rs.region.chronicle.filter((c) => c.kind === "lost");
    for (const c of lost) expect(c.why!.some((w) => /last|left/.test(w.text))).toBe(true);
  });

  it("writes a digest and a timeline", () => {
    const t = timeline(rs);
    expect(t.years.length).toBeGreaterThanOrEqual(40);
    expect(t.towns[0]!.people.filter((p) => p !== null).length).toBeGreaterThan(30);
    const d = digest(rs, 1, 40);
    expect(d).toMatch(/## Years 1 to 40/);
    expect(d).toMatch(/The crossing, as each town tells it now/);
  });

  it("gives every town its own place on the coast and records its houses", () => {
    const t = timeline(rs);
    const sites = t.towns.map((x) => x.site!);
    for (const s of sites) expect(s.inland).toBeGreaterThanOrEqual(0.05);
    for (let i = 0; i < sites.length; i++)
      for (let j = i + 1; j < sites.length; j++) expect(Math.hypot(sites[i]!.along - sites[j]!.along, sites[i]!.inland - sites[j]!.inland)).toBeGreaterThan(0.06);
    expect(t.towns[0]!.houses.some((h) => (h ?? 0) > 0)).toBe(true);
    expect(t.routes.length).toBeGreaterThan(0);
  });

  it("brings a town back to life when someone looks, and lets the old one go", async () => {
    rs.setLive(1);
    const target = rs.region.towns[1]!.id;
    const s = rs.focus(target);
    expect(rs.region.towns.find((t) => t.id === target)!.agg).toBe(false);
    expect(Object.keys(rs.towns)).toEqual([target]);
    const people = s.world.order.length;
    await rs.advance(1440, { snapshot: false });
    expect(rs.towns[target]!.world.order.length).toBeGreaterThan(people - 5);
    rs.focus(rs.region.towns[0]!.id);
    expect(rs.region.towns.find((t) => t.id === target)!.agg).toBe(true);
    // The founding story survives the trip back and forth.
    const w = rs.world(target);
    const holder = w.order.find((id) => foundingVersion(w.minds, id, CROSSING));
    expect(holder).toBeDefined();
    expect(rootOf(w.minds, holder!, foundingVersion(w.minds, holder!, CROSSING)!).episode.id).toBe(CROSSING);
  }, 120_000);

  it("drifts a retold story by levelling or sharpening it", () => {
    const r = { rng: 7 };
    const text = "The crossing to Hollow Bay was rough the whole second night, and the water ran low on the second day.";
    const outs = new Set(Array.from({ length: 20 }, () => drift(text, r)));
    expect([...outs].some((x) => x.length < text.length)).toBe(true);
    expect([...outs].some((x) => x.length > text.length)).toBe(true);
  });
});
