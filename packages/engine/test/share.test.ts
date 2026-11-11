import { beforeAll, describe, expect, it } from "vitest";
import { checkWorldFile, cleanThumb, cleanWorldName, parseWorldCode, RegionSession, WORLD_FORMAT, WORLD_VERSION, worldCode } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

type Json = Record<string, any>;

describe("world codes", () => {
  it("go out and come back the same", () => {
    for (const scenario of ["island", "village", "region"] as const) {
      for (const seed of [0, 1, 11, 4242, 999_999_999]) expect(parseWorldCode(worldCode(scenario, seed))).toEqual({ scenario, seed });
    }
    expect(worldCode("region", 11)).toBe("region-11");
    expect(worldCode("region", 11.9)).toBe("region-11");
  });

  it("are read however someone types them", () => {
    expect(parseWorldCode("  Region-11 ")).toEqual({ scenario: "region", seed: 11 });
    expect(parseWorldCode("psyche: village 7")).toEqual({ scenario: "village", seed: 7 });
    expect(parseWorldCode("island:3")).toEqual({ scenario: "island", seed: 3 });
    expect(parseWorldCode("region_42")).toEqual({ scenario: "region", seed: 42 });
    // A bare number is a region's seed.
    expect(parseWorldCode("11")).toEqual({ scenario: "region", seed: 11 });
  });

  it("turn away anything that isn't one", () => {
    for (const bad of ["", "region", "castle-11", "region-", "region-1e9", "region-12345678901", "region-11; rm -rf", "<script>", "region-1.5"]) expect(parseWorldCode(bad)).toBeUndefined();
  });
});

describe("names and thumbnails from outside", () => {
  it("keeps a name to letters, digits, spaces, dashes and underscores", () => {
    expect(cleanWorldName("  First   autumn  ")).toBe("First autumn");
    expect(cleanWorldName("../../etc/passwd")).toBe("etcpasswd");
    expect(cleanWorldName("<b>bold</b>")).toBe("bboldb");
    expect(cleanWorldName("x".repeat(200)).length).toBe(40);
    expect(cleanWorldName(42)).toBe("");
    expect(cleanWorldName(undefined)).toBe("");
  });

  it("keeps a thumbnail only if it is a small picture and nothing else", () => {
    const ok = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
    expect(cleanThumb(ok)).toBe(ok);
    expect(cleanThumb("data:image/png;base64,iVBORw0KGgo=")).toBeDefined();
    expect(cleanThumb("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined();
    expect(cleanThumb("data:text/html;base64,PHNjcmlwdD4=")).toBeUndefined();
    expect(cleanThumb("javascript:alert(1)")).toBeUndefined();
    expect(cleanThumb("https://example.com/a.jpg")).toBeUndefined();
    expect(cleanThumb(`${ok}" onerror="x`)).toBeUndefined();
    expect(cleanThumb(`data:image/jpeg;base64,${"A".repeat(400_001)}`)).toBeUndefined();
    expect(cleanThumb(7)).toBeUndefined();
  });
});

describe("checking a world file", () => {
  // A real region as the server saves it, through JSON as it would come off disk.
  let saved: Json;
  const copy = (): Json => structuredClone(saved);
  const errorOf = (x: unknown) => {
    const c = checkWorldFile(x);
    return c.ok ? undefined : c.error;
  };

  beforeAll(async () => {
    const rs = RegionSession.create(11, createMockFaculties(), { session: { keepRecent: 0, keepDays: 0, maxTraces: 200 } });
    await rs.advance(120, { snapshot: false });
    saved = JSON.parse(JSON.stringify({ scenario: "region", seed: 11, inputs: [], log: [], region: { state: rs.region, worlds: rs.worlds(), feeds: {} } }));
  }, 120_000);

  it("passes a real region and reads its header", () => {
    const c = checkWorldFile({ ...copy(), format: WORLD_FORMAT, version: WORLD_VERSION, name: "First <autumn>", savedAt: 1234, summary: { world: "Hollow Bay", tick: 120, year: 1, towns: 1, people: 16 }, thumb: "data:image/jpeg;base64,AAAA" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.head).toMatchObject({ format: WORLD_FORMAT, version: 1, name: "First autumn", savedAt: 1234, scenario: "region", seed: 11, thumb: "data:image/jpeg;base64,AAAA" });
    expect(c.head.summary).toEqual({ world: "Hollow Bay", tick: 120, year: 1, towns: 1, people: 16 });
  });

  it("passes a plain save with no header, and gives it a name", () => {
    const c = checkWorldFile(copy());
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.head).toMatchObject({ name: "A shared world", savedAt: 0, version: WORLD_VERSION });
    // An island's save is a history to replay.
    expect(checkWorldFile({ seed: 7, inputs: [], log: [] }).ok).toBe(true);
    expect(checkWorldFile({ scenario: "village", seed: 7, inputs: [], log: [] }).ok).toBe(true);
  });

  it("drops a header it can't trust instead of failing the world", () => {
    const c = checkWorldFile({ ...copy(), name: 5, savedAt: "yesterday", summary: { world: 1 }, thumb: "javascript:alert(1)" });
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.head.name).toBe("A shared world");
      expect(c.head.savedAt).toBe(0);
      expect(c.head.summary).toBeUndefined();
      expect(c.head.thumb).toBeUndefined();
    }
  });

  it("turns away things that are not worlds", () => {
    for (const x of [null, undefined, 7, "region-11", [], [copy()], {}]) expect(errorOf(x)).toBeDefined();
    expect(errorOf({ ...copy(), format: "some-other-game" })).toMatch(/not a Psyche world/);
    expect(errorOf({ ...copy(), version: WORLD_VERSION + 1 })).toMatch(/newer Psyche/);
    expect(errorOf({ ...copy(), version: "1" })).toBeDefined();
    expect(errorOf({ ...copy(), seed: "11" })).toMatch(/no seed/);
    expect(errorOf({ ...copy(), seed: 1.5 })).toMatch(/no seed/);
    expect(errorOf({ ...copy(), scenario: "castle" })).toMatch(/kind/);
    expect(errorOf({ ...copy(), ablations: [] })).toMatch(/settings/);
    expect(errorOf({ seed: 7 })).toMatch(/history/);
    expect(errorOf({ seed: 7, inputs: [], log: [], base: { tick: 0 } })).toBeDefined();
  });

  it("turns away an island whose history is damaged or would never end", () => {
    const island = (inputs: unknown[], log: unknown[] = []) => errorOf({ seed: 7, inputs, log });
    expect(island([{ type: "advance", minutes: 30 }, { type: "say", to: "mara", text: "hello" }], [{ faculty: "speak" }])).toBeUndefined();
    expect(island([null])).toMatch(/damaged/);
    expect(island([{ minutes: 30 }])).toMatch(/damaged/);
    expect(island([{ type: "advance" }])).toMatch(/damaged/);
    expect(island([{ type: "advance", minutes: -5 }])).toMatch(/damaged/);
    expect(island([{ type: "advance", minutes: Infinity }])).toMatch(/damaged/);
    expect(island([{ type: "advance", minutes: 30 }], ["speak"])).toMatch(/damaged/);
    expect(island([{ type: "advance", minutes: 1e12 }])).toMatch(/too long/);
    expect(island(Array.from({ length: 12 }, () => ({ type: "advance", minutes: 500_000 })))).toMatch(/too long/);
  });

  it("turns away a region that has been damaged, saying what is wrong", () => {
    const town = saved.region.state.towns[0];
    const cases: [string, (x: Json) => void, RegExp][] = [
      ["no region", (x) => delete x.region, /region is missing/],
      ["a region on an island", (x) => (x.scenario = "island"), /region is damaged/],
      ["no towns", (x) => (x.region.state.towns = []), /region is damaged/],
      ["no chronicle", (x) => delete x.region.state.chronicle, /region is damaged/],
      ["feeds that are not a table", (x) => (x.region.feeds = 3), /region is damaged/],
      ["a town with no name", (x) => delete x.region.state.towns[0].name, /no name/],
      ["a town with no world", (x) => delete x.region.worlds[town.id], /not a world/],
      ["no clock", (x) => (x.region.worlds[town.id].tick = "noon"), /no clock/],
      ["a clock before time", (x) => (x.region.worlds[town.id].tick = -5), /no clock/],
      ["no people", (x) => (x.region.worlds[town.id].order = "everyone"), /list of people/],
      ["no minds", (x) => (x.region.worlds[town.id].minds = null), /minds, people or places/],
      ["a village of nothing", (x) => (x.region.worlds[town.id].village = null), /village/],
      ["no village at all", (x) => delete x.region.worlds[town.id].village, /village/],
      ["no store", (x) => delete x.region.worlds[town.id].village.store, /village/],
      ["a season with no days", (x) => (x.region.worlds[town.id].village.seasonDays = 0), /village/],
      ["someone with no mind", (x) => delete x.region.worlds[town.id].minds[x.region.worlds[town.id].order[0]], /no mind or body/],
      ["someone who was never there", (x) => x.region.worlds[town.id].order.push("nobody"), /nobody/],
    ];
    for (const [what, damage, message] of cases) {
      const x = copy();
      damage(x);
      expect(errorOf(x), what).toMatch(message);
    }
    // The town's own name is used, so the message points at the right place.
    const x = copy();
    x.region.worlds[town.id].tick = null;
    expect(errorOf(x)).toContain(town.name);
  });

  it("only checks: the file is left exactly as it came", () => {
    const x = copy();
    checkWorldFile(x);
    expect(x).toEqual(saved);
  });
});
