import { describe, expect, it } from "vitest";
import { buildLedger, createVillage, CROSSING, divergence, nodeId, saysVsWas, villageView, WorldSession } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

async function run(seed: number, days: number) {
  const s = new WorldSession(createVillage(seed), createMockFaculties());
  for (let h = 0; h < days * 24; h++) await s.apply({ type: "advance", minutes: 60 });
  return s;
}

describe("Hollow Bay", () => {
  it("founds a village of the Kettle five and generated settlers in households", () => {
    const w = createVillage(11);
    expect(w.order.length).toBe(15);
    const v = w.village!;
    const members = Object.values(v.households).flatMap((h) => h.members);
    expect(new Set(members).size).toBe(15);
    for (const id of w.order) {
      const m = w.minds[id]!;
      // Everyone has a model of everyone, so trust can move between any two people.
      for (const o of w.order) if (o !== id) expect(m.others[o], `${id} knows ${o}`).toBeDefined();
      expect(m.episodes.some((e) => e.id === CROSSING)).toBe(true);
      expect(w.places[w.agents[id]!.home]).toBeDefined();
    }
    // Every settler's core belief points back to the memory that installed it.
    for (const id of w.order.slice(5)) {
      const m = w.minds[id]!;
      expect(m.schemas.length).toBe(1);
      for (const o of m.schemas[0]!.origin!) expect(m.episodes.some((e) => e.id === o)).toBe(true);
    }
    expect(JSON.stringify(createVillage(11))).toBe(JSON.stringify(w));
  });

  it("feeds, builds and asks for a common store, deterministically", async () => {
    const a = await run(11, 3);
    const b = await run(11, 3);
    expect(a.feed.map((f) => f.title)).toEqual(b.feed.map((f) => f.title));
    const v = villageView(a.world)!;
    // The pledge was asked on the second evening, and everyone answered.
    expect(v.pledges.length).toBe(1);
    expect(v.pledges[0]!.answers.length).toBe(15);
    expect(v.households.some((h) => h.rate > 0)).toBe(true);
    expect(v.store.put).toBeGreaterThan(0);
    // Houses were designed by the Architect and work has started on them.
    expect(v.structures.length).toBeGreaterThan(0);
    expect(v.structures.some((s) => s.progress > 0)).toBe(true);
    expect(a.feed.some((f) => /tells a story at the fire/.test(f.title))).toBe(true);
    // Replaying the recorded log rebuilds the same village.
    const r = await WorldSession.replay(createVillage(11), a.inputs, a.log);
    expect(r.divergedAt).toBeUndefined();
    expect(JSON.stringify(r.session.world)).toBe(JSON.stringify(a.world));
  });

  it("makes holding back a remembered norm violation, and lets stories be overheard", async () => {
    const s = await run(11, 3);
    const round = s.world.village!.pledges[0]!;
    const held = round.answers.filter((x) => x.option !== "commit");
    expect(held.length).toBeGreaterThan(0);
    const who = held[0]!.agent;
    const witnesses = s.world.order.filter((id) => s.world.minds[id]!.episodes.some((e) => e.id.endsWith(`_${who}`) && e.about.includes(who)));
    expect(witnesses.length).toBeGreaterThan(3);
    const hops = Object.values(s.world.rumors).flatMap((r) => r.hops);
    expect(hops.some((h) => h.overheard)).toBe(true);
  });

  it("traces a pledge back to a core belief from before the crossing", async () => {
    const s = await run(11, 3);
    const L = buildLedger({ minds: s.world.minds, traces: s.traces, rumors: s.world.rumors, events: s.world.events });
    const round = s.world.village!.pledges[0]!;
    const tied = round.answers.filter((a) => s.world.minds[a.agent]!.schemas.some((x) => x.triggers.includes("store") && x.origin));
    expect(tied.length).toBeGreaterThan(0);
    let found = false;
    for (const a of tied) {
      const acc = saysVsWas(L, nodeId.decision(a.agent, a.trace))!;
      expect(acc.says.length).toBeGreaterThan(0);
      const core = acc.was.find((w) => w.mechanism === "core belief");
      const root = acc.was.find((w) => w.mechanism === "installed by");
      if (core && root) {
        const origin = s.world.minds[a.agent]!.schemas.find((x) => `${a.agent}/${x.id}` === core.node.id)!.origin![0]!;
        expect(root.node.id).toBe(`${a.agent}/${origin}`);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("lines up everyone's memory of the crossing", async () => {
    const s = await run(11, 1);
    const crossing = divergence(s.world).find((d) => d.id === CROSSING)!;
    expect(crossing.accounts.length).toBe(15);
    expect(new Set(crossing.accounts.map((a) => a.text)).size).toBeGreaterThan(3);
  });
});
