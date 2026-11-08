import { beforeAll, describe, expect, it } from "vitest";
import { buildLedger, createVillage, intentMenu, intentOf, steer, WorldSession, type Intention } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

let s: WorldSession;
beforeAll(async () => {
  s = new WorldSession(createVillage(11), createMockFaculties());
  for (let i = 0; i < 12 * 20; i++) await s.apply({ type: "advance", minutes: 120 });
}, 120_000);

describe("seasonal intentions", () => {
  it("every adult decides what they mean to do when a season turns, thinking it through", () => {
    const v = s.world.village!;
    const all = v.intentions ?? [];
    const seasons = new Set(all.map((x) => `${x.year}:${x.season}`));
    expect(seasons.size).toBeGreaterThanOrEqual(4);
    const traces = new Map(s.traces.map((t) => [`${t.agent}:${t.trace.id}`, t.trace]));
    for (const it of all) {
      const tr = traces.get(`${it.agent}:${it.trace}`)!;
      expect(tr, it.agent).toBeDefined();
      // A considered choice: System 2, over the menu built for them.
      expect(tr.decision?.system).toBe(2);
      expect(tr.decision?.options.length).toBeGreaterThan(1);
    }
    // People don't all mean the same thing.
    expect(new Set(all.map((x) => x.kind)).size).toBeGreaterThan(2);
    expect(s.feed.some((f) => /^What Hollow Bay means to do this/.test(f.title))).toBe(true);
  });

  it("offers each person a menu built from the world and their mind", () => {
    const w = s.world;
    for (const id of w.order.slice(0, 5)) {
      const m = intentMenu(w, id);
      expect(m.at(-1)!.id).toBe("keep");
      expect(m.some((o) => o.id === "store")).toBe(true);
      for (const o of m) expect(o.label.length).toBeGreaterThan(5);
    }
  });

  it("an intention leans on later choices, and the ledger shows it as a cause", () => {
    const w = s.world;
    const id = w.order[0]!;
    const it: Intention = { agent: id, tick: w.tick, season: "winter", year: 1, kind: "store", label: "Put more by in the common store", because: [], trace: "t_x" };
    w.village!.intent = { ...(w.village!.intent ?? {}), [id]: it };
    expect(intentOf(w, id)).toBe(it);
    const opts = steer(w, id, [{ id: "commit", label: "a", verb: "a", description: "a", prosocial: 1, assertive: 0, avoidant: 0, disclosure: 0 }, { id: "hold", label: "b", verb: "b", description: "b", prosocial: -1, assertive: 0, avoidant: 0, disclosure: 0 }], { store: "commit" });
    expect(opts[0]!.pull?.[0]).toMatchObject({ ref: "intent:t_x", value: 0.35 });
    expect(opts[1]!.pull).toBeUndefined();
    const L = buildLedger({ minds: w.minds, traces: s.traces } as never);
    const meant = L.edges.filter((e) => e.mechanism === "meant to");
    expect(meant.length).toBeGreaterThan(0);
    // Each runs from a decision at the turn of a season to a later choice by the same person.
    for (const e of meant.slice(0, 10)) {
      const from = L.nodes.get(e.from)!;
      const to = L.nodes.get(e.to)!;
      expect(from.kind).toBe("decision");
      expect(to.kind).toBe("decision");
      expect(from.agent).toBe(to.agent);
      expect(to.tick).toBeGreaterThanOrEqual(from.tick);
    }
  });

  it("the town's works are asked for by someone who meant to ask", () => {
    const v = s.world.village!;
    const asked = (v.works ?? [])[0];
    expect(asked).toBeDefined();
    const meant = (v.intentions ?? []).filter((x) => x.kind === "propose" && x.agent === asked!.proposer && x.target === asked!.kind);
    expect(meant.length).toBeGreaterThan(0);
  });
});
