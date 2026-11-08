import { describe, expect, it } from "vitest";
import { aggWorks, applyEdit, civicSite, createVillage, stands, townScene, works, worksDay, worksSeason, WorldSession, type Work, type WorldState } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const sink = () => ({ traces: [] as { agent: string; trace: { id: string } }[], feed: [] as { title: string; chronicle?: { kind: string } }[] });

function standing(w: WorldState, kind: Work["kind"], condition = 1): Work {
  const work: Work = { id: `work_${kind}`, kind, name: `the ${kind}`, proposer: w.order[0]!, proposed: w.tick, why: "a test", votes: [], status: "done", slot: 0, need: { timber: 40, stone: 20, reeds: 10 }, have: { timber: 40, stone: 20, reeds: 10 }, hours: 40, work: 40, builders: [], condition, mended: 0 };
  (w.village!.works ??= []).push(work);
  return work;
}

describe("civic works", () => {
  it("a town asks for a work, votes on it person by person, designs it and raises it", async () => {
    const s = new WorldSession(createVillage(11), createMockFaculties());
    for (let i = 0; i < 34 * 12; i++) await s.apply({ type: "advance", minutes: 120 });
    const w = s.world;
    const built = works(w).filter((x) => x.status === "done");
    expect(built.length).toBeGreaterThan(0);
    const first = built[0]!;
    // Every adult voted through their own mind, and each vote is a trace on record.
    expect(first.votes.length).toBeGreaterThan(10);
    const ids = new Set(s.traces.map((t) => t.trace.id));
    expect(first.votes.every((v) => ids.has(v.trace))).toBe(true);
    expect(first.why).toMatch(/core belief|goal|memory|store|death|sea|people/);
    // Designed by the proposer's Architect call, and raised block by block over days.
    expect(first.blueprint).toBeDefined();
    expect(first.hours).toBeGreaterThan(20);
    expect(first.finished! - first.started!).toBeGreaterThan(1440);
    expect(first.builders.length).toBeGreaterThan(2);
    const titles = s.feed.map((f) => f.title);
    expect(titles.some((t) => /will build the/.test(t))).toBe(true);
    expect(titles.some((t) => /is finished/.test(t) && /granary|well|hall|jetty|memorial/.test(t))).toBe(true);
  }, 120_000);

  it("a granary halves the spoiling in every household", async () => {
    const day = async (granary: boolean) => {
      const w = createVillage(11);
      w.keyedLuck = true;
      if (granary) standing(w, "granary");
      const s = new WorldSession(w, createMockFaculties());
      for (let i = 0; i < 26; i++) await s.apply({ type: "advance", minutes: 60 });
      return Object.values(s.world.village!.households).reduce((n, h) => n + h.food, 0);
    };
    expect(await day(true)).toBeGreaterThan(await day(false));
  }, 60_000);

  it("works wear, get mended by whoever builds, and fall to ruin when nobody does", () => {
    const w = createVillage(11);
    const sk = sink();
    const hall = standing(w, "hall", 0.56);
    const before = w.minds[w.order[3]!]!.needs.relatedness;
    worksDay(w, sk as never);
    // A hall keeps people company.
    expect(w.minds[w.order[3]!]!.needs.relatedness).toBeGreaterThan(before);
    // Worn below the line: mending is under way, and builders go to it.
    expect(hall.mending).toBeDefined();
    expect(civicSite(w)).toBe(hall);
    w.village!.stock.timber = 100;
    for (let i = 0; i < 40 && hall.mending; i++) w.agents[w.order[1]!]!.place = "works", worksDayBuild(w, hall);
    expect(hall.mending).toBeUndefined();
    expect(hall.condition).toBe(1);
    expect(hall.mended).toBe(1);
    // Left alone at the end of its life, it is a ruin, and the chronicle keeps that.
    const well = standing(w, "well", 0.001);
    well.slot = 1;
    worksDay(w, sk as never);
    expect(well.status).toBe("ruin");
    expect(stands(w, "well")).toBeUndefined();
    expect(sk.feed.some((f) => f.chronicle?.kind === "ruin")).toBe(true);
  });

  it("a hard, suspicious town turns down what a warm one builds", async () => {
    const vote = async (hard: boolean) => {
      const w = createVillage(11);
      w.keyedLuck = true;
      if (hard) applyEdit(w, { who: "*", edit: { kind: "trait", trait: "agreeableness", value: 0.02, lock: true } }, sink() as never);
      if (hard) applyEdit(w, { who: "*", edit: { kind: "fear", text: "Whatever you give the town, someone else takes", triggers: ["build", "help", "fairness", "store"], threat: 0.2, blame: 0.4, strength: 0.9 } }, sink() as never);
      const work = await worksSeason(w, createMockFaculties(), sink() as never, { who: w.order[0]!, kind: "hall", why: "a test" });
      return work!;
    };
    const warm = await vote(false);
    const hard = await vote(true);
    const against = (x: Work) => x.votes.filter((v) => !v.support).length;
    expect(against(warm)).toBeLessThan(against(hard));
    expect(warm.status).toBe("building");
    expect(hard.status).toBe("rejected");
  }, 60_000);

  it("towns nobody watches build and let things fall on rules", () => {
    const w = createVillage(11);
    const sk = sink();
    for (let i = 0; i < 12 && !works(w).length; i++) {
      w.tick += 4 * 1440;
      aggWorks(w, sk as never);
    }
    expect(works(w).length).toBeGreaterThan(0);
    expect(works(w)[0]!.blueprint).toBeDefined();
    expect(works(w)[0]!.status).toBe("done");
  });

  it("shows a work going up in the 3D scene, on its own plot", () => {
    const w = createVillage(11);
    const g = standing(w, "granary");
    g.blueprint = { name: "A granary", width: 9, depth: 7, wallHeight: 3, walls: "plank", foundation: "cobble", corners: "log", floor: "plank", roof: { shape: "gable", material: "thatch", overhang: 1 }, door: "south", windows: [], furniture: [], porch: false };
    g.status = "building";
    g.work = 10;
    const sc = townScene(w);
    const st = sc.structures.find((x) => x.household === "town")!;
    expect(st.work?.kind).toBe("granary");
    expect(st.placed).toBeGreaterThan(0);
    expect(st.placed).toBeLessThan(st.total);
    expect(sc.places.some((p) => /granary \(going up\)/.test(p.name))).toBe(true);
    g.status = "ruin";
    expect(townScene(w).places.some((p) => /ruins of the granary/.test(p.name))).toBe(true);
  });
});

import { buildWork } from "../src/world/works.js";
function worksDayBuild(w: WorldState, work: Work) {
  buildWork(w, work, w.order[1]!, 1, sink() as never);
}
