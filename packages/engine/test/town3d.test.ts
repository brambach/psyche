import { describe, expect, it } from "vitest";
import { compile, createVillage, get, homeOrder, homePlot, M, terrainOf, TOWN, townScene, townTerrain } from "@psyche/engine";

describe("the town in 3D", () => {
  it("builds the same land from the same seed", () => {
    expect(townTerrain(11).grid.cells).toEqual(townTerrain(11).grid.cells);
    expect(townTerrain(11).grid.cells).not.toEqual(townTerrain(12).grid.cells);
  });

  it("gives every home a flat, dry plot clear of trees", () => {
    const t = terrainOf(11);
    for (let k = 0; k < 30; k++) {
      const p = homePlot(k, t.ground);
      expect(p.y - 1).toBeGreaterThan(TOWN.sea);
      for (let z = p.z0; z < p.z0 + p.d; z++)
        for (let x = p.x0; x < p.x0 + p.w; x++) {
          expect(t.ground[x + z * TOWN.w]).toBe(p.y - 1);
          expect(get(t.grid, x, p.y, z)).toBe(M.air);
        }
    }
  });

  it("places a house's blocks in step with the work done on it", () => {
    const w = createVillage(11);
    const v = w.village!;
    const hh = Object.values(v.households)[0]!;
    v.structures.push({
      id: "house_t", name: "A test house", household: hh.id, designer: hh.members[0]!,
      blueprint: { name: "A test house", width: 7, depth: 6, wallHeight: 3, walls: "plank", foundation: "cobble", corners: "log", floor: "plank", roof: { shape: "gable", material: "thatch", overhang: 1 }, door: "south", windows: ["east"], furniture: ["bed"], porch: false },
      rationale: "", repairs: [], need: { timber: 1, stone: 1, reeds: 1 }, have: { timber: 0, stone: 0, reeds: 0 }, hours: 10, work: 4, done: false, started: 0, trace: "", builders: [],
    });
    const s = townScene(w);
    const h = s.structures[0]!;
    expect(h.total).toBe(compile(h.blueprint, h.plot).length);
    expect(h.placed).toBe(Math.floor(h.total * 0.4));
    expect(s.tents.length).toBe(Object.keys(v.households).length);
    expect(s.people.map((p) => p.id)).toEqual(w.order);
    expect(homeOrder(w)).toContain(hh.home);
  });
});
