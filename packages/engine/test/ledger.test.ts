import { describe, expect, it } from "vitest";
import { buildLedger, concerns, createWorld, genealogy, influence, nodeId, why, WorldSession } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

async function run(seed: number, days: number, rumor = false) {
  const s = new WorldSession(createWorld(seed), createMockFaculties());
  for (let h = 0; h < days * 24; h++) {
    if (rumor && h === 3) await s.apply({ type: "inject", event: { kind: "rumor", teller: "corran", subject: "wren", text: "Wren waters down the beer", valence: -0.5 } });
    if (h === 30) await s.apply({ type: "inject", event: { kind: "storm" } });
    await s.apply({ type: "advance", minutes: 60 });
  }
  return s;
}
const ledgerOf = (s: WorldSession) => buildLedger({ minds: s.world.minds, traces: s.traces, rumors: s.world.rumors, events: s.world.events });

describe("causal ledger", () => {
  it("is well formed, deterministic, and does not touch the world", async () => {
    const s = await run(7, 2);
    const before = JSON.stringify(s.world);
    const a = ledgerOf(s);
    const b = ledgerOf(s);
    expect(JSON.stringify(s.world)).toBe(before);
    expect(JSON.stringify([...a.nodes.values()])).toBe(JSON.stringify([...b.nodes.values()]));
    expect(a.edges.length).toBeGreaterThan(100);
    for (const e of a.edges) {
      expect(a.nodes.has(e.from)).toBe(true);
      expect(a.nodes.has(e.to)).toBe(true);
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
    }
  });

  it("traces every decision back to what was in mind", async () => {
    const s = await run(3, 2);
    const L = ledgerOf(s);
    const decisions = [...L.nodes.values()].filter((n) => n.kind === "decision");
    expect(decisions.length).toBeGreaterThan(10);
    for (const d of decisions) {
      const t = why(L, d.id)!;
      expect(t.causes.length).toBeGreaterThan(0);
      expect(t.causes.every((c) => c.via!.mechanism === "in mind")).toBe(true);
    }
  });

  it("traces a core belief to the night that installed it", async () => {
    const s = await run(7, 1);
    const L = ledgerOf(s);
    const g = genealogy(L, nodeId.item("mara", "sch_letdown"))!;
    expect(g.roots.map((r) => r.id)).toContain(nodeId.item("mara", "ep_dock"));
    expect(concerns(L, s.world.minds.mara!, s.world.tick).some((c) => c.id === nodeId.item("mara", "sch_letdown"))).toBe(true);
  });

  it("follows a planted rumor through other people's heads to the stranger who started it", async () => {
    let crossed = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = await run(seed, 3, true);
      const L = ledgerOf(s);
      const rumor = Object.values(s.world.rumors).find((r) => r.origin === "corran" && r.first.includes("beer"))!;
      for (const id of s.world.order.filter((x) => x !== "corran")) {
        const b = s.world.minds[id]!.beliefs.find((x) => x.rumor === rumor.id);
        if (!b) continue;
        const g = genealogy(L, nodeId.item(id, b.id))!;
        expect(g.minds).toContain(b.source.from);
        expect(g.roots.some((r) => r.kind === "outside")).toBe(true);
        crossed++;
      }
      // Corran's own belief reaches the decisions of the people he told.
      const cb = s.world.minds.corran!.beliefs.find((x) => x.rumor === rumor.id)!;
      const inf = influence(L, nodeId.item("corran", cb.id))!;
      if (rumor.hops.length > 1) expect(inf.minds.length).toBeGreaterThan(0);
    }
    expect(crossed).toBeGreaterThan(0);
  });
});
