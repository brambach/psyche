import { beforeAll, describe, expect, it } from "vitest";
import { compactMinds, craftLineage, forget, realm as R, rootOf, type Episode, type WorldState } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

// A world that runs for thousands of years cannot keep everyone who ever lived in it. These checks
// build twelve generations of the dead by hand (a story told down them, a craft taught down them)
// and see what a town on rules lets go of: the middle of a long line, never either end.
describe("letting go of the long dead", () => {
  let w: WorldState;
  let living: string;
  const ghost = (i: number) => `ghost_${i}`;
  const CRAFT = "a-craft-for-the-test";

  beforeAll(async () => {
    const host = new R.LocalHost(createMockFaculties());
    const realm = await R.Realm.create(host, { regionTowns: 2, splitAt: 20, maxRegions: 1, liveYears: 0 });
    while (realm.state.year < 4) await realm.step();
    const rs = host.runners.get(realm.state.regions[0]!.id)!.rs;
    w = rs.world(rs.region.towns[0]!.id);
    const v = w.village!;
    const year = v.seasonDays * 4 * 1440;
    living = w.order.find((id) => (w.minds[id]!.episodes.length ?? 0) > 0 && !v.life[id]!.parents.some((p) => !w.order.includes(p)))!;
    const base = w.minds[living]!.episodes[0]!;
    const story = (i: number): Episode => ({
      ...structuredClone(base),
      id: `ep_test_${i}`,
      gist: i === 12 ? "The night the boats came in." : `What ${ghost(i + 1)} said of the night the boats came in.`,
      topics: ["founding"],
      source: i === 12 ? { kind: "witnessed" } : { kind: "told", from: ghost(i + 1), ref: `ep_test_${i + 1}` },
    });
    for (let i = 1; i <= 12; i++) {
      w.minds[ghost(i)] = { ...structuredClone(w.minds[living]!), id: ghost(i), name: `Ghost ${i}`, episodes: [story(i)] };
      w.agents[ghost(i)] = { ...structuredClone(w.agents[living]!), id: ghost(i), name: `Ghost ${i}` };
      v.life[ghost(i)] = { born: w.tick - (160 + i * 25) * year, died: w.tick - (100 + i * 25) * year, parents: [], generation: 0 };
      v.knowledge!.known[ghost(i)] = [i === 12 ? { craft: CRAFT, tick: 0, how: "worked out" } : { craft: CRAFT, tick: 0, how: "taught", from: ghost(i + 1) }];
    }
    w.minds[living]!.episodes.push(story(0));
    (v.knowledge!.known[living] ??= []).push({ craft: CRAFT, tick: w.tick, how: "taught", from: ghost(1) });
    // Two more of the dead with no ties to anyone: one long gone, one only five years.
    for (const [id, ago] of [["ghost_old", 90], ["ghost_new", 5]] as const) {
      w.agents[id] = { ...structuredClone(w.agents[living]!), id, name: id };
      v.life[id] = { born: w.tick - (ago + 50) * year, died: w.tick - ago * year, parents: [], generation: 0 };
    }
  }, 300_000);

  const mine = () => w.minds[living]!.episodes.find((e) => e.id === "ep_test_0")!;

  it("shortens a story's line in the middle and still counts every telling", () => {
    expect(rootOf(w.minds, living, mine())).toMatchObject({ agent: ghost(12), hops: 12 });
    compactMinds(w);
    const root = rootOf(w.minds, living, mine());
    expect(root.agent).toBe(ghost(12));
    expect(root.episode.gist).toBe("The night the boats came in.");
    expect(root.hops).toBe(12);
    // The eight nearest tellers and the one who was there are kept; the three between are let go.
    for (let i = 1; i <= 8; i++) expect(w.minds[ghost(i)], ghost(i)).toBeDefined();
    for (let i = 9; i <= 11; i++) expect(w.minds[ghost(i)], ghost(i)).toBeUndefined();
    expect(w.minds[ghost(12)]).toBeDefined();
    expect(w.minds[ghost(8)]!.episodes[0]!.source).toEqual({ kind: "told", from: ghost(12), ref: "ep_test_12", elided: 3 });
  });

  it("shortens a craft's line the same way, and takes the forgotten off the town's books", () => {
    const gone = forget(w);
    expect(gone).toBeGreaterThanOrEqual(4);
    const line = craftLineage(w, living, CRAFT);
    expect(line.map((x) => x.agent)).toEqual([living, ...[1, 2, 3, 4, 5, 6, 7, 8, 12].map(ghost)]);
    expect(line.at(-1)!.how).toBe("worked out");
    expect(w.village!.knowledge!.known[ghost(8)]![0]).toMatchObject({ from: ghost(12), elided: 3 });
    for (let i = 9; i <= 11; i++) {
      expect(w.agents[ghost(i)]).toBeUndefined();
      expect(w.village!.life[ghost(i)]).toBeUndefined();
      expect(w.village!.knowledge!.known[ghost(i)]).toBeUndefined();
    }
    expect(w.agents.ghost_old).toBeUndefined();
    // The recently dead stay, and so does everyone the living still need.
    expect(w.agents.ghost_new).toBeDefined();
    for (const id of w.order) {
      expect(w.agents[id]).toBeDefined();
      for (const p of w.village!.life[id]!.parents) expect(w.village!.life[p], `${id}'s parent ${p}`).toBeDefined();
    }
  });

  it("changes nothing more when it runs again", () => {
    const before = JSON.stringify({ minds: w.minds, agents: w.agents, life: w.village!.life, known: w.village!.knowledge!.known });
    compactMinds(w);
    expect(forget(w)).toBe(0);
    expect(JSON.stringify({ minds: w.minds, agents: w.agents, life: w.village!.life, known: w.village!.knowledge!.known })).toBe(before);
    expect(rootOf(w.minds, living, mine()).hops).toBe(12);
  });
});
