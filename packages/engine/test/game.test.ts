import { describe, expect, it } from "vitest";
import { applyDelta, awaySummary, beatOf, belongingOf, beats, chronicleNotices, createVillage, deltaMemory, frameDelta, leastBelonging, momentNotices, RegionSession, warnings, type FeedItem, type GameFrame } from "../src/index.js";
import { createMockFaculties } from "@psyche/faculties";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("frame deltas", () => {
  it("rebuilds every frame on the receiving side from deltas alone", () => {
    const mem = deltaMemory();
    let x = 1;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    let frame: GameFrame = { tick: 0, people: [{ id: "a", n: 1 }, { id: "b", n: 2 }], feed: [], name: "Hollow Bay", tags: ["x"] };
    const held: GameFrame = clone(frame);
    frameDelta(mem, frame);
    for (let step = 0; step < 300; step++) {
      const next = clone(frame) as { tick: number; people: { id: string; n: number }[]; feed: { id: string; t: string }[]; name?: string; tags: string[]; extra?: number };
      next.tick++;
      const r = rand();
      if (r < 0.2) next.people.push({ id: `p${step}`, n: step });
      else if (r < 0.35 && next.people.length) next.people.splice(Math.floor(rand() * next.people.length), 1);
      else if (r < 0.5 && next.people.length) next.people[Math.floor(rand() * next.people.length)]!.n += 1;
      else if (r < 0.6) next.people.reverse();
      else if (r < 0.7) next.feed = [...next.feed, { id: `f${step}`, t: "talk" }].slice(-5);
      else if (r < 0.75) delete next.name;
      else if (r < 0.8) next.name = `Town ${step}`;
      else if (r < 0.85) next.tags = [...next.tags, String(step)];
      else if (r < 0.9) next.extra = step;
      const d = frameDelta(mem, next as unknown as GameFrame);
      if (d) applyDelta(held, clone(d));
      // Keys that were never sent are the only difference allowed: an empty keyed list is never sent.
      const want = Object.fromEntries(Object.entries(next).filter(([k, v]) => !(Array.isArray(v) && v.length === 0 && held[k] === undefined)));
      expect(held).toEqual(want);
      frame = next as unknown as GameFrame;
    }
  });

  it("sends only the items that changed", () => {
    const mem = deltaMemory();
    frameDelta(mem, { people: [{ id: "a", n: 1 }, { id: "b", n: 2 }], tick: 1 });
    const d = frameDelta(mem, { people: [{ id: "a", n: 1 }, { id: "b", n: 3 }], tick: 1 });
    expect(d).toEqual({ items: { people: { up: [{ id: "b", n: 3 }] } } });
    expect(frameDelta(mem, { people: [{ id: "a", n: 1 }, { id: "b", n: 3 }], tick: 1 })).toBeUndefined();
  });
});

const item = (over: Partial<FeedItem>): FeedItem => ({ id: "f1", tick: 100, kind: "event", agents: ["mara"], title: "Something", ...over });

describe("the director's beats", () => {
  it("ranks a death over a house over small talk, and skips comings and goings", () => {
    const feed = [
      item({ id: "t", kind: "talk", title: "Jun and Theo talk", lines: [{ speaker: "jun", text: "Morning." }] as FeedItem["lines"] }),
      item({ id: "h", title: "The Quarrys' house is finished" }),
      item({ id: "d", title: "Old Greta dies", text: "She was 81." }),
      item({ id: "m", kind: "move", title: "Mara walks to the landing" }),
    ];
    const b = beats(feed, 120);
    expect(b.map((x) => x.id)).toEqual(["d", "h", "t"]);
    expect(beatOf(item({ kind: "event", agents: [], title: "Winter comes to Hollow Bay" }))?.wide).toBe(true);
    expect(beats(feed, 1000)).toEqual([]);
  });

  it("turns big moments into notices, once each", () => {
    const feed = [item({ id: "a", tick: 10, title: "Theo is asked to lead Hollow Bay" }), item({ id: "b", tick: 20, kind: "talk", title: "Small talk" })];
    expect(momentNotices(feed, 0).map((n) => n.id)).toEqual(["m:a"]);
    expect(momentNotices(feed, 10)).toEqual([]);
  });
});

describe("warnings", () => {
  it("names the last keeper of a craft once they are old", () => {
    const w = createVillage(11);
    const v = w.village!;
    const id = w.order[0]!;
    v.knowledge = { known: { [id]: [{ craft: "herbs", tick: w.tick, how: "worked out" }] }, lost: {}, history: [] };
    v.life[id]!.born = w.tick - 70 * v.seasonDays * 4 * 1440;
    const n = warnings(w, "hollow");
    expect(n.some((x) => x.agent === id && /herb lore/.test(x.text))).toBe(true);
    // A second keeper means nothing is at risk.
    v.knowledge.known[w.order[1]!] = [{ craft: "herbs", tick: w.tick, how: "taught", from: id }];
    expect(warnings(w, "hollow").some((x) => /herb lore/.test(x.text))).toBe(false);
  });

  it("picks the same person to lead a split as the split itself would", () => {
    const w = createVillage(11);
    const least = leastBelonging(w)!;
    const adults = w.order.filter((x) => Object.values(w.village!.households).some((h) => h.members.includes(x)));
    for (const o of adults) expect(least.belonging).toBeLessThanOrEqual(belongingOf(w, o) + 1e-9);
    expect(adults).toContain(least.id);
  });
});

describe("while you were away", () => {
  it("summarises what changed between two ticks", async () => {
    const f = createMockFaculties();
    const rs = RegionSession.create(11, f, { live: 1, cheap: f, session: { keepRecent: 4, keepDays: 2, maxTraces: 2000 } });
    const from = rs.region.tick;
    for (let d = 0; d < 20; d++) await rs.advance(1440, { snapshot: false });
    const s = awaySummary(rs, from);
    expect(s.days).toBeGreaterThanOrEqual(19);
    expect(s.towns[0]!.name).toBe("Hollow Bay");
    expect(s.people.after).toBe(rs.world("hollow").order.length);
    expect(s.entries.length).toBeLessThanOrEqual(12);
    expect(chronicleNotices(rs.region.chronicle, from).length).toBeLessThanOrEqual(rs.region.chronicle.length);
  });
});
