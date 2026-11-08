import { beforeAll, describe, expect, it } from "vitest";
import { engines, MIRROR, nestedOf, nestedPersonView, nestedWorldView, RegionSession, schemaLineage, suspicionOf, SUSPICIONS, worldAt, type WorldState } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const YEAR = 16 * 1440;
const mirrorTexts = new Set(Object.values(MIRROR).map((m) => m.text));

async function run(years: number, seed = 11): Promise<RegionSession> {
  const mock = createMockFaculties();
  const rs = RegionSession.create(seed, mock, { session: { keepRecent: 0, keepDays: 0, maxTraces: 500 }, maxTowns: 16, cheap: mock });
  rs.setLive(0);
  for (let t = 0; t < years * YEAR; t += 1440) await rs.advance(1440, { snapshot: false });
  return rs;
}

const towns = (rs: RegionSession) => rs.region.towns.map((t) => ({ id: t.id, world: rs.world(t.id) }));

describe("worlds inside the world", () => {
  let rs: RegionSession;
  let town: string;
  let top: WorldState;
  let inner: WorldState;
  beforeAll(async () => {
    rs = await run(34);
    const chain = engines(towns(rs), rs.region.nested).find((c) => c.levels.length > 1)!;
    town = chain.town;
    top = rs.world(town);
    inner = worldAt(top, rs.region.nested, 1)!;
  }, 120_000);

  it("a town counts, builds a frame, agrees to an engine, and a world wakes inside it", () => {
    const chains = engines(towns(rs), rs.region.nested);
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.length).toBeLessThanOrEqual(2);
    const kinds = nestedOf(top).history.map((e) => e.kind);
    for (const k of ["tally", "frame", "agreed", "turns"]) expect(kinds).toContain(k);
    expect(inner).toBeDefined();
    expect(inner.village!.aggregate).toBeDefined();
    expect(nestedOf(inner).depth).toBe(1);
    // It has lived years of its own, on the same engine: births, deaths, a leader.
    const v = nestedWorldView(top, town, rs.region.nested, 1)!;
    expect(v.year).toBeGreaterThan(3);
    expect(Object.values(inner.village!.life).some((l) => l.generation > 0)).toBe(true);
    // The chronicle has the engine.
    expect(rs.region.chronicle.some((c) => c.kind === "engine" && /turns/.test(c.text))).toBe(true);
  });

  it("makes its people in the maker's image, with pasts that belong to someone outside", () => {
    const made = nestedOf(inner).made!;
    expect(made.maker).toBeTruthy();
    const firstGen = Object.keys(made.models);
    expect(firstGen.length).toBe(12);
    // Each is modelled on someone the maker knew; the maker comes first.
    expect(Object.values(made.models)[0]!.outer).toBe(made.maker);
    // The past each remembers is a memory of someone one level up, carrying that person's core belief.
    expect(Object.keys(made.pasts).length).toBeGreaterThan(0);
    for (const [id, p] of Object.entries(made.pasts)) {
      expect(p.outer).toBeTruthy();
      expect(p.belief).toBeTruthy();
      const M = inner.minds[id] ?? Object.values(inner.minds).find((m) => m.id === id);
      if (!M) continue; // died and was let go
      const mine = M.episodes.find((e) => e.id === `ep_${id}_past`);
      if (mine) expect(mine.gist).toBe(p.gist);
    }
  });

  it("its people notice signs whose causes are one level up, and read them by temperament", () => {
    const ns = nestedOf(inner);
    expect(ns.signs.length).toBeGreaterThan(0);
    for (const s of ns.signs) {
      // Every sign is explained at least partly from the world outside it.
      expect(s.why.some((w) => w.level === 0)).toBe(true);
      expect(s.why.length).toBeGreaterThan(1);
    }
    const kinds = new Set(ns.signs.map((s) => s.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    const texts = new Set(Object.values(SUSPICIONS).map((s) => s.text));
    const believers = inner.order.filter((id) => (suspicionOf(inner.minds[id]!)?.strength ?? 0) >= 0.25);
    expect(believers.length).toBeGreaterThan(0);
    for (const id of believers) {
      const s = suspicionOf(inner.minds[id]!)!;
      expect(texts.has(s.schema.text)).toBe(true);
      // The belief points at the memory that put it there.
      expect(inner.minds[id]!.episodes.some((e) => s.schema.origin?.includes(e.id))).toBe(true);
    }
  });

  it("passes the suspicion on by telling, and the chain leads back to someone who saw a sign", () => {
    const told = inner.order
      .map((id) => ({ id, s: suspicionOf(inner.minds[id]!) }))
      .filter((x) => x.s)
      .map((x) => ({ ...x, chain: schemaLineage(inner, x.id, x.s!.schema) }))
      .find((x) => x.chain.length > 1);
    expect(told).toBeDefined();
    const root = told!.chain.at(-1)!;
    expect(root.firstHand).toBe(true);
    expect(root.episode.startsWith("ep_sign_")).toBe(true);
    const view = nestedPersonView(top, rs.region.nested, 1, told!.id)!;
    const b = view.beliefs.find((x) => x.text === told!.s!.schema.text)!;
    expect(b.sign).toBeDefined();
  });

  it("word goes up: a keeper outside comes to wonder about their own world, and the belief traces back", () => {
    const wonderers = towns(rs).flatMap((t) => t.world.order.map((id) => t.world.minds[id]!).filter((m) => m.schemas.some((s) => mirrorTexts.has(s.text))));
    expect(wonderers.length).toBeGreaterThan(0);
    for (const m of wonderers) {
      const s = m.schemas.find((x) => mirrorTexts.has(x.text))!;
      const ep = m.episodes.find((e) => s.origin?.includes(e.id));
      expect(ep?.topics).toContain("engine");
    }
    expect(nestedOf(top).history.some((e) => e.kind === "mirror")).toBe(true);
  });

  it("goes deeper: the world inside builds an engine of its own", () => {
    const deepest = Math.max(...engines(towns(rs), rs.region.nested).map((c) => c.levels.length - 1));
    expect(deepest).toBeGreaterThanOrEqual(2);
    const w2 = engines(towns(rs), rs.region.nested).find((c) => c.levels.length > 2)!;
    const v2 = nestedWorldView(rs.world(w2.town), w2.town, rs.region.nested, 2)!;
    expect(v2.made!.depth).toBe(2);
    expect(v2.path.map((p) => p.depth)).toEqual([0, 1, 2]);
  });

  it("stands still when nobody is left who knows how to tend it", async () => {
    const r = await run(34);
    const c = engines(towns(r), r.region.nested).find((x) => x.levels.length > 1)!;
    const w = r.world(c.town);
    const m = nestedOf(w).machine!;
    const inside = worldAt(w, r.region.nested, 1)!;
    m.keepers = [{ id: "nobody_left", name: "Nobody", tick: w.tick }];
    for (let t = 0; t < 4 * 4 * 1440; t += 1440) await r.advance(1440, { snapshot: false });
    expect(m.stage).toBe("stilled");
    const frozen = inside.tick;
    for (let t = 0; t < 8 * 1440; t += 1440) await r.advance(1440, { snapshot: false });
    expect(inside.tick).toBe(frozen);
  }, 120_000);

  it("runs the same way twice", async () => {
    const again = await run(34);
    const a = engines(towns(rs), rs.region.nested);
    const b = engines(towns(again), again.region.nested);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 120_000);
});
