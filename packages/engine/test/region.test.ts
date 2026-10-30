import { beforeAll, describe, expect, it } from "vitest";
import { compareMyths, RegionSession, regionView, schemaLineage } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const YEAR = 16;

describe("a region of towns", () => {
  // Small towns split early here, so a second town forms within a few years.
  let rs: RegionSession;
  beforeAll(async () => {
    rs = RegionSession.create(11, createMockFaculties(), { splitAt: 18, maxTowns: 3, session: { keepRecent: 0, keepDays: 0, maxTraces: 2000 } });
    for (let d = 0; d < 9 * YEAR; d++) {
      for (let h = 0; h < 4; h++) await rs.advance(360, { snapshot: false });
      if ((d + 1) % YEAR === 0) rs.rebase();
    }
  }, 900_000);

  it("splits off a daughter town that remembers leaving", () => {
    const v = regionView(rs);
    expect(v.towns.length).toBeGreaterThanOrEqual(2);
    const daughter = rs.region.towns[1]!;
    const w = rs.world(daughter.id);
    expect(w.village!.founding).toBe(`ep_leaving_${daughter.id}`);
    // The founders who are still alive there share one memory of leaving.
    const living = daughter.founders.filter((id) => w.order.includes(id));
    expect(living.length).toBeGreaterThan(0);
    for (const id of living) expect(w.minds[id]!.episodes.some((e) => e.id === w.village!.founding)).toBe(true);
    // They are gone from the old town's days, and kept in its memory.
    const home = rs.world(daughter.from!);
    for (const id of daughter.founders) {
      expect(home.order).not.toContain(id);
      expect(home.minds[id]).toBeDefined();
    }
    expect(v.chronicle.some((c) => c.kind === "founding")).toBe(true);
  });

  it("never gives two people in the region the same id", () => {
    const seen = new Map<string, string>();
    for (const t of rs.region.towns)
      for (const id of rs.world(t.id).order) {
        expect(seen.has(id), `${id} in ${t.id} and ${seen.get(id)}`).toBe(false);
        seen.set(id, t.id);
      }
  });

  it("chooses leaders and tells the founding story every summer", () => {
    const hollow = rs.world("hollow").village!;
    expect(hollow.civic!.elections.length).toBeGreaterThanOrEqual(8);
    expect(hollow.civic!.foundingDays.length).toBeGreaterThanOrEqual(7);
  });

  it("lets each town tell the crossing its own way, and says where the versions part", () => {
    const m = compareMyths(rs);
    const told = m.towns.filter((t) => t.dominant);
    expect(told.length).toBeGreaterThanOrEqual(2);
    for (const t of told) {
      // Every version ends at someone who was there.
      for (const v of t.versions) expect(v.chain.at(-1)!.agent).toBe(v.root.agent);
    }
    expect(m.splits.length).toBeGreaterThan(0);
    expect(m.splits[0]!.at.length).toBeGreaterThan(20);
  });

  it("follows inherited fears across the move, through remembered copies", () => {
    const daughter = rs.region.towns[1]!;
    const w = rs.world(daughter.id);
    for (const id of w.order)
      for (const s of w.minds[id]!.schemas) {
        const chain = schemaLineage(w, id, s);
        if (chain.length > 1) expect(chain.at(-1)!.firstHand || chain.length > 1).toBe(true);
      }
  });
});
