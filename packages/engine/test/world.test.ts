import { describe, expect, it } from "vitest";
import { createWorld, WorldSession, type Ablations } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

async function run(seed: number, days: number, opts: { storm?: boolean; ablations?: Partial<Ablations>; rumor?: boolean } = {}) {
  const s = new WorldSession(createWorld(seed, opts.ablations), createMockFaculties());
  for (let h = 0; h < days * 24; h++) {
    if (opts.storm && h === 30) await s.apply({ type: "inject", event: { kind: "storm" } });
    if (opts.rumor && h === 3) await s.apply({ type: "inject", event: { kind: "rumor", teller: "corran", subject: "wren", text: "Wren waters down the beer", valence: -0.5 } });
    await s.apply({ type: "advance", minutes: 60 });
  }
  return s;
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe("Kettle Island", () => {
  it("is deterministic for a seed", async () => {
    const a = await run(7, 2, { storm: true });
    const b = await run(7, 2, { storm: true });
    expect(JSON.stringify(a.feed)).toBe(JSON.stringify(b.feed));
    expect(JSON.stringify(a.world)).toBe(JSON.stringify(b.world));
  });

  it("replays exactly from its log, and rewinds to a morning", async () => {
    const a = await run(11, 3, { storm: true });
    const { session: b, divergedAt } = await WorldSession.replay(a.initial, a.inputs, a.log);
    expect(divergedAt).toBeUndefined();
    expect(JSON.stringify(b.world)).toBe(JSON.stringify(a.world));
    const morning = a.frames.find((f) => f.dayStart && f.index > 10)!;
    a.rewind(morning.index);
    expect(JSON.stringify(a.world)).toBe(JSON.stringify(morning.state));
    expect(a.feed.length).toBe(morning.feedEnd);
  });

  it("people talk, and every night all five sleep", async () => {
    const s = await run(3, 3);
    const talks = s.feed.filter((f) => f.kind === "talk").length;
    expect(talks).toBeGreaterThan(15);
    const sleeps = s.traces.filter((t) => t.trace.kind === "sleep").length;
    expect(sleeps).toBe(5 * 3);
  });

  it("stories spread beyond the person who first told them", async () => {
    let spread = 0;
    for (const seed of SEEDS) {
      const s = await run(seed, 3);
      if (Object.values(s.world.rumors).some((r) => new Set(r.hops.map((h) => h.from)).size >= 2)) spread++;
    }
    expect(spread).toBeGreaterThanOrEqual(SEEDS.length - 2);
  });

  it("a planted rumor travels on its own", async () => {
    let travelled = 0;
    for (const seed of SEEDS) {
      const s = await run(seed, 3, { rumor: true });
      const r = Object.values(s.world.rumors).find((x) => x.id.startsWith("rum_planted"))!;
      if (r.hops.some((h) => h.from !== "visitor")) travelled++;
    }
    expect(travelled).toBeGreaterThanOrEqual(SEEDS.length / 2);
  });

  it("what people are told can overwrite what they remember, and only when that mechanism is on", async () => {
    const borrowed = async (ablations: Partial<Ablations>) => {
      let n = 0;
      for (const seed of SEEDS) {
        const s = await run(seed, 7, { storm: true, ablations });
        for (const m of Object.values(s.world.minds))
          for (const ep of m.episodes) n += ep.versions.flatMap((v) => v.changes).filter((c) => c.cause === "misinformation").length;
      }
      return n;
    };
    expect(await borrowed({ misinformation: false })).toBe(0);
    expect(await borrowed({})).toBeGreaterThan(0);
  }, 60_000);
});
