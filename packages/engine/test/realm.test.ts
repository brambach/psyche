import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { realm as R, schemaLineage, type Episode, type MindState } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

// Small towns that split early and regions that fill at two towns, so a few decades are enough to
// see what takes centuries at full size: coasts filling, colonies sailing, boats crossing.
const OPTS: Partial<R.RealmOptions> = { regionTowns: 2, splitAt: 20, maxRegions: 5, liveYears: 0 };

async function grow(years: number, host = new R.LocalHost(createMockFaculties()), realm?: R.Realm) {
  const r = realm ?? (await R.Realm.create(host, OPTS));
  const events: R.RealmEvent[] = [];
  while (r.state.year < years || r.state.season !== "winter") events.push(...(await r.step()).events);
  return { realm: r, host, events };
}

async function hashOf(realm: R.Realm, host: R.RegionHost): Promise<string> {
  const h = createHash("sha256");
  h.update(JSON.stringify(realm.state));
  for (const r of realm.state.regions) h.update(JSON.stringify(await host.call(r.id, "save", undefined)));
  return h.digest("hex");
}

describe("a realm of regions", () => {
  let realm: R.Realm;
  let host: R.LocalHost;
  let events: R.RealmEvent[];
  beforeAll(async () => {
    ({ realm, host, events } = await grow(34));
  }, 600_000);

  it("fills its first coast, then sends towns over the sea to found new ones", () => {
    expect(realm.state.regions.length).toBeGreaterThanOrEqual(3);
    for (const r of realm.state.regions.slice(1)) {
      expect(r.from).toBeDefined();
      expect(r.people).toBeGreaterThan(0);
    }
    const colonies = events.filter((e) => e.sea && e.kind === "founding");
    expect(colonies.length).toBe(realm.state.totals.colonies);
    // Why they sailed goes back past "there was no room" to the person who led the leaving.
    expect(colonies.some((e) => (e.why?.length ?? 0) >= 3)).toBe(true);
    expect(realm.people).toBe(realm.state.regions.reduce((n, r) => n + host.runners.get(r.id)!.people, 0));
  });

  it("never gives two living people anywhere the same id, nor two towns the same name", () => {
    const people = new Map<string, string>();
    const towns = new Set<string>();
    for (const r of realm.state.regions) {
      const rs = host.runners.get(r.id)!.rs;
      for (const t of rs.region.towns) {
        expect(towns.has(t.id), `two towns called ${t.id}`).toBe(false);
        towns.add(t.id);
        for (const id of rs.world(t.id).order) {
          expect(people.has(id), `${id} lives in ${t.id} and ${people.get(id)}`).toBe(false);
          people.set(id, t.id);
        }
      }
    }
    // Everyone born since the crossing carries the mark of the town they were born in.
    expect([...people.keys()].some((id) => /_[a-z]+\d+_\d+$/.test(id))).toBe(true);
  });

  it("carries a colony's memories with it: every fear can still be followed back to someone who lived it", () => {
    const colony = realm.state.regions[1]!;
    const rs = host.runners.get(colony.id)!.rs;
    const town = rs.region.towns[0]!;
    const w = rs.world(town.id);
    expect(town.fromRegion?.id).toBe(colony.from);
    // The founders still alive remember leaving.
    const founders = town.founders.filter((id) => w.order.includes(id));
    for (const id of founders) expect(w.minds[id]!.episodes.some((e) => e.id === w.village!.founding)).toBe(true);
    let inherited = 0;
    for (const t of rs.region.towns) {
      const tw = rs.world(t.id);
      for (const id of tw.order)
        for (const s of tw.minds[id]!.schemas) {
          const line = schemaLineage(tw, id, s);
          if (line.length > 1) {
            inherited++;
            expect(line.at(-1)!.firstHand, `${id}'s "${s.text}" loses its thread`).toBe(true);
          }
        }
    }
    expect(inherited).toBeGreaterThan(0);
  });

  it("sends boats between coasts, and a story told over the sea keeps its teller's memory behind it", () => {
    expect(realm.state.totals.boats).toBeGreaterThan(0);
    const boats = events.filter((e) => e.sea && e.kind === "trade");
    expect(boats.length).toBe(realm.state.totals.boats);
    let heard = 0;
    for (const r of realm.state.regions) {
      const rs = host.runners.get(r.id)!.rs;
      const abroad = rs.region.abroad ?? {};
      for (const t of rs.region.towns) {
        const w = rs.world(t.id);
        const local = new Set(Object.values(rs.worlds()).flatMap((x) => x.order));
        for (const id of w.order)
          for (const e of w.minds[id]!.episodes as Episode[]) {
            if (e.source.kind !== "told" || !e.source.from || !e.source.ref || !e.topics.includes("sea")) continue;
            const teller: MindState | undefined = w.minds[e.source.from];
            // Whoever told it is remembered here with the memory they told it from; when that was a
            // trader from another coast, they are remembered though they never lived here.
            expect(teller, `${e.source.from} is not remembered in ${t.id}`).toBeDefined();
            expect(teller!.episodes.some((x) => x.id === e.source.ref), `${e.source.from} no longer has ${e.source.ref}`).toBe(true);
            if (!local.has(e.source.from)) heard++;
          }
      }
      for (const a of Object.values(abroad)) expect(realm.state.regions.some((x) => x.id === a.region)).toBe(true);
    }
    expect(heard).toBeGreaterThan(0);
  });

  it("answers for a person with where their beliefs came from", async () => {
    const r = realm.state.regions.at(-1)!;
    const rs = host.runners.get(r.id)!.rs;
    const town = rs.region.towns[0]!;
    const list = await host.call(r.id, "town", { town: town.id });
    expect(list.length).toBe(rs.world(town.id).order.length);
    const p = await host.call(r.id, "person", { id: list[0]!.id });
    expect(p?.name).toBe(list[0]!.name);
    expect(p?.town).toBe(town.id);
    const myths = await host.call(r.id, "myths", undefined);
    expect(myths.length).toBe(rs.region.towns.length);
  });

  it("is the same world every time, and the same after being saved and picked up again", async () => {
    const want = await hashOf(realm, host);
    const again = await grow(34);
    expect(await hashOf(again.realm, again.host)).toBe(want);

    // Half way, save everything, throw the first world away, and carry on from the save.
    const half = await grow(17);
    const state = structuredClone(half.realm.state);
    const saves = await Promise.all(state.regions.map((r) => half.host.call(r.id, "save", undefined)));
    const host2 = new R.LocalHost(createMockFaculties());
    for (const s of JSON.parse(JSON.stringify(saves)) as R.SavedRegion[]) host2.load(s);
    const resumed = await R.Realm.resume(JSON.parse(JSON.stringify(state)) as R.RealmState, host2);
    await grow(34, host2, resumed);
    expect(await hashOf(resumed, host2)).toBe(want);
  }, 600_000);

  it("writes a digest a person can read: what mattered and why, the coasts, the oldest story", async () => {
    const start = R.digestMark([], 1, { births: 0, deaths: 0 }, 0);
    const window = R.emptyTally();
    R.tally(window, events);
    const s = realm.state;
    const first = await host.call("r0", "myths", undefined);
    const text = R.realmDigest({
      title: "The world this morning",
      from: start,
      to: R.digestMark(s.regions, s.year, s.totals, 8 * 3_600_000),
      regions: s.regions,
      window,
      myths: first.map((m) => ({ region: s.regions[0]!.name, town: m.name, text: m.text, root: m.root, tellings: m.tellings, holders: m.holders, of: m.of })),
      spend: "$0.00",
    });
    expect(text).toMatch(/It holds [\d,]+ people/);
    expect(text).toContain("## What mattered");
    expect(text).toContain("## New shores");
    expect(text).toContain("## Between the coasts");
    expect(text).toContain("The crossing to Hollow Bay");
    for (const r of s.regions) expect(text).toContain(r.name);
    expect(text).not.toContain("—");
    // However long the night, the tally stays small.
    for (let i = 0; i < 50; i++) R.tally(window, events);
    expect(window.heavy.length).toBeLessThanOrEqual(600);
    expect(window.total).toBe(events.length * 51);
  });
});

describe("names for a big world", () => {
  it("never repeat between regions, and tags are letters only", () => {
    const seen = new Set<string>();
    for (let r = 0; r < 64; r++)
      for (let n = 0; n < 100; n++) {
        const t = R.townName(r, n).toLowerCase();
        expect(seen.has(t), t).toBe(false);
        seen.add(t);
      }
    const regions = new Set(Array.from({ length: 200 }, (_, i) => R.regionName(i + 1)));
    expect(regions.size).toBe(200);
    for (const i of [0, 25, 26, 700]) expect(R.regionTag(i)).toMatch(/^[a-z]+$/);
    expect(new Set(Array.from({ length: 1000 }, (_, i) => R.regionTag(i))).size).toBe(1000);
  });
});
