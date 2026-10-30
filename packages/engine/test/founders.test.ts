import { describe, expect, it } from "vitest";
import { check, compile, createFounder, dryness, FounderSession, generateIsland, get, M, siteOf, supply, type BuilderId, type Blueprint } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

async function run(who: BuilderId, hours = 60, early = false) {
  const s = new FounderSession(createFounder(3, who), createMockFaculties());
  for (let h = 0; h < hours; h++) {
    if (early && h === 8) await s.apply({ type: "inject", event: { kind: "storm-early" } });
    await s.apply({ type: "advance", minutes: 60 });
  }
  return s;
}

const HOUSE: Blueprint = {
  name: "Test house",
  width: 7,
  depth: 6,
  wallHeight: 3,
  walls: "plank",
  foundation: "cobble",
  corners: "log",
  floor: "plank",
  roof: { shape: "gable", material: "thatch", overhang: 1 },
  door: "south",
  windows: ["east", "west"],
  furniture: ["bed", "hearth", "table"],
  porch: true,
};

describe("Founders: the islet", () => {
  it("generates the same islet for a seed, with a level plot and materials to build with", () => {
    const a = generateIsland(5);
    const b = generateIsland(5);
    expect(Buffer.from(a.grid.cells).equals(Buffer.from(b.grid.cells))).toBe(true);
    const p = a.plot;
    for (let z = p.z0; z < p.z0 + p.d; z++) for (let x = p.x0; x < p.x0 + p.w; x++) expect(a.ground[x + z * a.grid.w]).toBe(p.y - 1);
    const s = supply(createFounder(5));
    expect(s.logs).toBeGreaterThan(30);
    expect(s.stone).toBeGreaterThan(60);
    expect(s.reeds).toBeGreaterThan(40);
  });
});

describe("Founders: blueprints", () => {
  it("compiles a house with a door, a bed and a roof over every floor cell", () => {
    const plot = generateIsland(3).plot;
    const ps = compile(HOUSE, plot);
    const { x0, z0, x1, z1, y } = siteOf(HOUSE, plot);
    expect(ps.filter((p) => p.b === M.door)).toHaveLength(2);
    expect(ps.filter((p) => p.b === M.bed)).toHaveLength(2);
    for (let z = z0 + 1; z < z1; z++)
      for (let x = x0 + 1; x < x1; x++) expect(ps.some((p) => p.x === x && p.z === z && (p.part === "roof" || p.part === "chimney") && p.y >= y + HOUSE.wallHeight)).toBe(true);
    // Walls go up before the roof that rests on them.
    const lastWall = ps.map((p) => p.part).lastIndexOf("walls");
    expect(ps.findIndex((p) => p.part === "roof")).toBeGreaterThan(lastWall);
  });

  it("repairs a design that cannot be built, and says what it changed", () => {
    const plot = generateIsland(3).plot;
    const c = check({ ...HOUSE, width: 30, furniture: [], walls: "cobble" }, plot, { logs: 200, stone: 20, reeds: 200 });
    expect(c.blueprint.width).toBeLessThanOrEqual(11);
    expect(c.blueprint.furniture).toContain("bed");
    expect(c.blueprint.walls).toBe("plank");
    expect(c.repairs.length).toBeGreaterThanOrEqual(3);
    expect(c.bill.raw.stone).toBeLessThanOrEqual(20);
  });
});

describe("Founders: one mind builds a house", () => {
  it("designs, builds and is dry when the storm hits", async () => {
    const s = await run("mara");
    const st = s.state;
    expect(st.project).toBeDefined();
    expect(st.project!.finishedAt).toBeLessThan(st.storm.at);
    expect(st.storm.dry).toBeGreaterThan(0.85);
    expect(dryness(st)).toBeGreaterThan(0.85);
    // Every planned block is in the grid.
    for (const p of st.project!.placements) expect(get(st.terrain.grid, p.x, p.y, p.z)).toBe(p.b);
    // The language model was asked for the design once; the body did the rest.
    expect(s.log.filter((c) => c.faculty === "architect")).toHaveLength(1);
    expect(s.feed.some((f) => f.kind === "storm" && /holds/.test(f.title))).toBe(true);
  });

  it("builds a different house for a different mind", async () => {
    const [a, b] = await Promise.all([run("mara", 2), run("jun", 2)]);
    expect(a.state.project!.blueprint).not.toEqual(b.state.project!.blueprint);
  });

  it("makes a real choice when the storm comes early", async () => {
    const s = await run("mara", 24, true);
    const early = s.feed.find((f) => f.title === "The storm is coming early")!;
    expect(early).toBeDefined();
    const t = s.traces.find((x) => x.id === early.trace)!;
    expect(t.decision!.options.map((o) => o.id).sort()).toEqual(["abandon", "cut", "push"]);
    expect(s.state.storm.state).not.toBe("coming");
  });

  it("replays block for block from its log", async () => {
    const s = await run("theo", 30);
    const r = await FounderSession.replay(createFounder(3, "theo"), s.inputs, s.log);
    expect(r.divergedAt).toBeUndefined();
    expect(Buffer.from(r.session.state.terrain.grid.cells).equals(Buffer.from(s.state.terrain.grid.cells))).toBe(true);
    expect(r.session.feed.map((f) => f.title)).toEqual(s.feed.map((f) => f.title));
    s.rewind(10);
    expect(s.state.tick).toBe(s.frames[10]!.tick);
  });
});
