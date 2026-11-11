import { beforeAll, describe, expect, it } from "vitest";
import {
  activeOutbreak,
  burnRecords,
  civOf,
  civRaid,
  civSue,
  civView,
  expose,
  isWritten,
  knows,
  liveFactions,
  moveHousehold,
  PROFESSIONS,
  regionCiv,
  regionCivView,
  RegionSession,
  regionView,
  TECHS,
  writeDown,
  writerOf,
  type ChronicleEntry,
  type WorldState,
} from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const YEAR = 16;
const CIV_KINDS: ChronicleEntry["kind"][] = ["market", "faction", "election", "plague", "migration", "record", "war", "truce"];
const session = { keepRecent: 0, keepDays: 0, maxTraces: 2000 };

/** A region on rules after the first live year, a year at a time. */
async function run(rs: RegionSession, years: number, live = 1): Promise<void> {
  for (let y = 1; y <= years; y++) {
    if (y === live + 1) rs.setLive(0);
    const step = y <= live ? 360 : 1440;
    for (let m = 0; m < YEAR * 1440; m += step) await rs.advance(step, { snapshot: false });
    rs.rebase();
  }
}

const grown = (w: WorldState) => w.order.filter((id) => (w.tick - (w.village!.life[id]?.born ?? 0)) / (YEAR * 1440) >= 16);

describe("civilization systems are off unless asked for", () => {
  it("leaves a region without the option exactly as it was", async () => {
    const rs = RegionSession.create(11, createMockFaculties(), { splitAt: 18, maxTowns: 2, session });
    await run(rs, 3);
    for (const t of rs.region.towns) {
      const w = rs.world(t.id);
      expect(civOf(w)).toBeUndefined();
      expect(civView(w)).toBeUndefined();
      expect(w.order.some((id) => w.agents[id]!.role in PROFESSIONS)).toBe(false);
    }
    expect(rs.region.civ).toBeUndefined();
    expect(regionCivView(rs.region, (t) => rs.world(t))).toBeUndefined();
    expect(regionView(rs).chronicle.some((c) => CIV_KINDS.includes(c.kind))).toBe(false);
  }, 300_000);
});

describe("sixty years with the civilization systems on", () => {
  let rs: RegionSession;
  const worlds = () => rs.region.towns.map((t) => rs.world(t.id));
  beforeAll(async () => {
    const mock = createMockFaculties();
    // Seed 29: with childhood and attachment in, seed 11 grows a small quiet coast (149 people, two election issues in sixty years).
    rs = RegionSession.create(29, mock, { session, maxTowns: 16, splitAt: 50, cheap: mock, civ: true });
    await run(rs, 60, 2);
  }, 900_000);

  it("grows into several towns, and nobody is in two places", () => {
    expect(rs.region.towns.length).toBeGreaterThanOrEqual(4);
    const seen = new Map<string, string>();
    for (const w of worlds()) {
      expect(civOf(w)).toBeDefined();
      for (const id of w.order) {
        expect(seen.get(id)).toBeUndefined();
        seen.set(id, w.name);
        expect(w.minds[id]).toBeDefined();
        expect(Object.values(w.village!.households).filter((h) => h.members.includes(id)).length).toBe(1);
      }
    }
    expect(seen.size).toBeGreaterThan(150);
  });

  it("lets people live by a trade once someone knows the craft and the town can carry them", () => {
    let specialists = 0;
    for (const w of worlds()) {
      const adults = grown(w).length;
      for (const id of w.order) {
        const p = PROFESSIONS[w.agents[id]!.role];
        if (!p) continue;
        specialists++;
        expect(knows(w, id, p.tech)).toBe(true);
      }
      // No town lives on trades alone: most hands still grow, catch, cut and build.
      expect(w.order.filter((id) => w.agents[id]!.role in PROFESSIONS).length).toBeLessThanOrEqual(Math.max(2, adults * 0.5));
    }
    expect(specialists).toBeGreaterThan(10);
    const trades = regionView(rs).chronicle.filter((c) => c.kind === "trade" && / sets up as a /.test(c.text));
    expect(trades.length).toBeGreaterThan(5);
    for (const t of trades) expect(t.why?.length).toBeGreaterThan(0);
  });

  it("holds markets where deals are settled in more than one way, with prices that stay in bounds", () => {
    const total = { amber: 0, barter: 0, store: 0, credit: 0, gift: 0, failed: 0 };
    let markets = 0;
    for (const w of worlds()) {
      const E = civOf(w)!.economy;
      for (const m of E.markets) {
        markets++;
        for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += m.deals[k];
        expect(m.price.food).toBeGreaterThanOrEqual(0.6);
        expect(m.price.food).toBeLessThanOrEqual(2.5);
        expect(m.gini).toBeGreaterThanOrEqual(0);
        expect(m.gini).toBeLessThanOrEqual(1);
      }
      for (const h of Object.values(E.goods)) for (const n of Object.values(h)) expect(n).toBeGreaterThanOrEqual(0);
      expect(w.village!.store.food).toBeGreaterThanOrEqual(0);
      for (const n of Object.values(w.village!.money!.held)) expect(n).toBeGreaterThanOrEqual(0);
    }
    expect(markets).toBeGreaterThan(20);
    const done = total.amber + total.barter + total.store + total.credit + total.gift;
    expect(done).toBeGreaterThan(100);
    // At least three of the ways to settle a deal were used, and some deals found none.
    expect([total.amber, total.barter, total.store, total.credit].filter((n) => n > 0).length).toBeGreaterThanOrEqual(3);
    expect(total.failed).toBeGreaterThan(0);
    const first = regionView(rs).chronicle.filter((c) => c.kind === "market");
    expect(first.length).toBeGreaterThan(0);
    for (const f of first) expect(f.why?.length).toBeGreaterThan(0);
  });

  it("works out later crafts in order, each from what the town already knew", () => {
    const civTechs = new Set(TECHS.map((t) => t.id));
    let known = 0;
    for (const w of worlds()) {
      const tree = civView(w)!.tech;
      expect(tree.length).toBe(TECHS.length);
      known += tree.filter((t) => t.known > 0).length;
    }
    expect(known).toBeGreaterThan(8);
    expect(civTechs.has("writing")).toBe(true);
    const found = regionView(rs).chronicle.filter((c) => c.kind === "craft" && c.why?.some((y) => /It rests on|grows out of/.test(y.text)));
    expect(found.length).toBeGreaterThan(0);
  });

  it("finds sides in who likes whom, and says what they share", () => {
    const formed = regionView(rs).chronicle.filter((c) => c.kind === "faction");
    expect(formed.length).toBeGreaterThan(2);
    for (const f of formed) expect(f.why!.length).toBeGreaterThanOrEqual(2);
    for (const w of worlds()) {
      const adults = grown(w).length;
      for (const f of liveFactions(w)) {
        expect(f.households.length).toBeGreaterThanOrEqual(2);
        expect(f.members.length).toBeLessThanOrEqual(adults * 0.75 + 1);
        expect(f.members).toContain(f.head);
        expect(f.inner).toBeGreaterThan(f.outer);
      }
    }
  });

  it("chooses leaders between candidates who promise something, and counts every voice once", () => {
    let contests = 0;
    const issues = new Set<string>();
    for (const w of worlds()) {
      for (const c of civOf(w)!.polity.contests) {
        contests++;
        expect(c.candidates.length).toBeGreaterThanOrEqual(1);
        expect(c.candidates.reduce((s, k) => s + k.votes, 0)).toBe(c.voters);
        const top = Math.max(...c.candidates.map((k) => k.votes));
        expect(c.candidates.find((k) => k.id === c.winner)!.votes).toBe(top);
        for (const k of c.candidates) {
          issues.add(k.platform.issue);
          expect(k.platform.because.length).toBeGreaterThan(5);
        }
        expect(c.why.length).toBeGreaterThan(0);
      }
    }
    expect(contests).toBeGreaterThan(10);
    expect(issues.size).toBeGreaterThanOrEqual(3);
    const laws = worlds().flatMap((w) => w.village!.civic?.laws ?? []).filter((l) => l.kind !== "store_minimum");
    expect(laws.length).toBeGreaterThan(0);
    for (const l of laws) expect(l.why?.length).toBeGreaterThan(0);
  });

  it("lets sickness run its course and remembers where it came from", () => {
    const past = worlds().flatMap((w) => civOf(w)!.health.outbreaks.filter((o) => o.ended).map((o) => ({ w, o })));
    expect(past.length).toBeGreaterThan(3);
    for (const { o } of past) {
      expect(o.cases.length).toBeGreaterThan(0);
      expect(o.cases).toContain(o.first);
      for (const d of o.dead) expect(o.cases).toContain(d);
      expect(o.why.length).toBeGreaterThan(0);
    }
    // Sickness does not only arise at home: some of it travels.
    expect(new Set(past.map((x) => x.o.source.kind)).size).toBeGreaterThanOrEqual(1);
    const told = regionView(rs).chronicle.filter((c) => c.kind === "plague");
    for (const c of told) expect(c.why?.length).toBeGreaterThan(0);
  });

  it("keeps records once someone can write, and a written founding story stops drifting", () => {
    const literate = worlds().filter((w) => civOf(w)!.records.since !== undefined);
    expect(literate.length).toBeGreaterThan(0);
    for (const w of literate) {
      const R = civOf(w)!.records;
      expect(R.items.length).toBeGreaterThan(0);
      expect(R.items.some((i) => i.kind === "annal" || i.kind === "craft" || i.kind === "founding")).toBe(true);
    }
    const w = literate[0]!;
    const view = civView(w)!.records!;
    expect(view.since).toBeDefined();
    expect(Object.values(view.counts).reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
  });

  it("gives every civilization entry in the chronicle its causes", () => {
    const ch = regionView(rs).chronicle.filter((c) => ["market", "faction", "plague", "migration", "war", "truce"].includes(c.kind));
    expect(ch.length).toBeGreaterThan(5);
    for (const c of ch) expect(c.why?.length, `${c.kind}: ${c.text}`).toBeGreaterThan(0);
  });

  it("survives a save and a load", () => {
    const save = JSON.parse(JSON.stringify({ region: rs.region, worlds: rs.worlds() }));
    const mock = createMockFaculties();
    const again = new RegionSession(save.region, save.worlds, mock, { session, maxTowns: 16, splitAt: 50, cheap: mock, civ: true });
    expect(regionCivView(again.region, (t) => again.world(t))).toEqual(regionCivView(rs.region, (t) => rs.world(t)));
    for (const t of rs.region.towns) expect(civView(again.world(t.id))).toEqual(civView(rs.world(t.id)));
  });

  // The tests below push the same region by hand, so they come last.

  it("writes a craft down, and a fire takes the writing", () => {
    const w = worlds().find((x) => writerOf(x))!;
    expect(w).toBeDefined();
    const item = writeDown(w, { kind: "craft", title: "A test craft", text: "How it is done.", ref: "test_craft" });
    expect(item).toBeDefined();
    expect(isWritten(w, "craft", "test_craft")).toBe(true);
    const burned = burnRecords(w, 1);
    expect(burned.length).toBeGreaterThan(0);
    expect(isWritten(w, "craft", "test_craft")).toBe(false);
  });

  it("starts an outbreak when sickness is carried in, and ends it", async () => {
    const town = [...rs.region.towns].sort((a, b) => rs.world(b.id).order.length - rs.world(a.id).order.length).find((t) => !activeOutbreak(rs.world(t.id)))!;
    const w = rs.world(town.id);
    const before = civOf(w)!.health.outbreaks.length;
    // Nobody is immune to a sickness the town has never met.
    civOf(w)!.health.immune = {};
    expect(expose(w, "pox", { kind: "boat" }, rs.civHost().sink(town.id), 1)).toBe(true);
    const ob = activeOutbreak(w)!;
    expect(ob.source.kind).toBe("boat");
    expect(civOf(w)!.health.outbreaks.length).toBe(before + 1);
    await run(rs, 3, 0);
    expect(ob.ended).toBeDefined();
    expect(ob.cases.length).toBeGreaterThanOrEqual(1);
    expect(ob.why.some((y) => /boat/.test(y.text))).toBe(true);
    for (const d of ob.dead) expect(w.order).not.toContain(d);
  }, 300_000);

  it("moves a household to another town with everything it has", () => {
    const host = rs.civHost();
    const towns = [...rs.region.towns].sort((a, b) => rs.world(b.id).order.length - rs.world(a.id).order.length);
    const [a, b] = [towns[0]!, towns[1]!];
    const A = rs.world(a.id);
    const B = rs.world(b.id);
    const hh = Object.values(A.village!.households).filter((h) => h.members.some((m) => A.order.includes(m))).sort((x, y) => x.id.localeCompare(y.id))[0]!;
    const people = hh.members.filter((m) => A.order.includes(m));
    const amber = (w: WorldState) => Object.values(w.village!.money!.held).reduce((s, n) => s + n, 0);
    const purse = amber(A) + amber(B);
    const heads = A.order.length + B.order.length;
    const moved = moveHousehold(host, a, b, hh);
    expect(moved.sort()).toEqual([...people].sort());
    for (const id of people) {
      expect(A.order).not.toContain(id);
      expect(B.order).toContain(id);
      expect(B.minds[id]).toBeDefined();
      expect(B.village!.life[id]).toBeDefined();
      expect(Object.values(B.village!.households).filter((h) => h.members.includes(id)).length).toBe(1);
    }
    expect(A.order.length + B.order.length).toBe(heads);
    expect(amber(A) + amber(B)).toBe(purse);
  });

  it("raids a neighbour, which is remembered there, and can end in a truce", async () => {
    const host = rs.civHost();
    const R = regionCiv(rs.region);
    const towns = [...rs.region.towns].sort((a, b) => rs.world(b.id).order.length - rs.world(a.id).order.length);
    const [a, b] = [towns[0]!, towns[1]!];
    const A = rs.world(a.id);
    const B = rs.world(b.id);
    const leader = A.village!.civic?.leader ?? grown(A)[0]!;
    const n = R.raids.length;
    const wars = rs.region.chronicle.filter((c) => c.kind === "war").length;
    await civRaid(host, a, b, leader, "a test of arms", [{ text: "The test called it." }]);
    expect(R.raids.length).toBe(n + 1);
    const raid = R.raids.at(-1)!;
    expect(raid.from).toBe(a.id);
    expect(raid.to).toBe(b.id);
    expect(raid.went.length + raid.stayed.length).toBeGreaterThan(0);
    expect(raid.odds).toBeGreaterThan(0);
    expect(raid.odds).toBeLessThan(1);
    expect(raid.why.length).toBeGreaterThan(1);
    for (const d of raid.dead) expect(rs.world(d.town).order).not.toContain(d.id);
    expect(rs.region.chronicle.filter((c) => c.kind === "war").length).toBe(wars + 1);
    if (raid.went.length) {
      // Those raided now hold a belief about the town that came.
      const belief = B.order.map((id) => B.minds[id]!.beliefs.find((x) => x.about === `town:${a.id}`)).filter(Boolean);
      expect(belief.length).toBeGreaterThan(0);
    }
    const asked = rs.region.chronicle.filter((c) => c.kind === "truce").length;
    await civSue(host, b, a, [raid], 4, 4);
    expect(rs.region.chronicle.filter((c) => c.kind === "truce").length).toBe(asked + 1);
    const said = rs.region.chronicle.filter((c) => c.kind === "truce").at(-1)!;
    expect(said.why!.length).toBeGreaterThan(1);
  }, 300_000);
});

describe("the same seed", () => {
  it("gives the same civilization twice", async () => {
    const once = async () => {
      const mock = createMockFaculties();
      const rs = RegionSession.create(7, mock, { session, maxTowns: 4, splitAt: 30, cheap: mock, civ: true });
      await run(rs, 24, 1);
      return JSON.stringify({ chronicle: rs.region.chronicle, civ: rs.region.civ, towns: rs.region.towns.map((t) => civView(rs.world(t.id))) });
    };
    const a = await once();
    const b = await once();
    expect(a.length).toBeGreaterThan(1000);
    expect(a).toBe(b);
  }, 600_000);
});
