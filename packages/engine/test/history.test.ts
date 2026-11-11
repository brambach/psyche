import { beforeAll, describe, expect, it } from "vitest";
import { agoText, buildBrief, CausalHistory, citedIn, find, longestThread, offlineHistorian, origins, reach, RegionSession, strongestThread, trail, whenText, type WhyTree, type WorldSession } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const YEAR = 16;
const DAY = 1440;
/** Far fewer traces than four years make, so the session forgets most of the run. */
const KEEP = 1500;

describe("the causal history", () => {
  let rs: RegionSession;
  let H: CausalHistory;
  let live: WorldSession;
  const read = new WeakMap<WorldSession, number>();
  const last = new Map<string, number>();
  const absorb = (force = false) => {
    for (const [town, s] of Object.entries(rs.towns)) {
      const total = s.traceBase + s.traces.length;
      const fresh = total - (read.get(s) ?? 0);
      if (fresh <= 0 || (!force && fresh < 300)) continue;
      H.absorb({ world: s.world, traces: s.traces, fresh, town, chronicle: rs.region.chronicle });
      read.set(s, total);
      last.set(town, fresh);
    }
  };

  beforeAll(async () => {
    const mock = createMockFaculties();
    rs = RegionSession.create(11, mock, { session: { keepRecent: 0, keepDays: 0, maxTraces: KEEP }, live: 1, cheap: mock, maxTowns: 2 });
    H = new CausalHistory();
    for (let d = 0; d < 4 * YEAR; d++) {
      for (let h = 0; h < 4; h++) await rs.advance(360, { snapshot: false });
      absorb();
      if ((d + 1) % YEAR === 0) rs.rebase();
    }
    absorb(true);
    live = Object.values(rs.towns)[0]!;
  }, 600_000);

  it("remembers choices the running town has let go, with what was behind them", () => {
    expect(live.traceBase).toBeGreaterThan(0);
    const oldestHeld = live.traces[0]!.trace.tick;
    const gone = H.moments.filter((m) => m.tick < oldestHeld - DAY);
    expect(gone.length).toBeGreaterThan(100);
    for (const m of gone.slice(0, 200)) {
      const t = trail(H, m.id)!;
      expect(t.node.kind).toBe("decision");
      expect(t.causes.length).toBeGreaterThan(0);
      expect(m.question.length).toBeGreaterThan(5);
    }
    expect(H.calendar.seasonDays).toBe(YEAR / 4);
    expect(H.size.people).toBeGreaterThan(10);
  });

  it("keeps a whole graph: every link joins two kept things", () => {
    let edges = 0;
    for (const [to, list] of H.into) {
      for (const e of list) {
        edges++;
        expect(e.to).toBe(to);
        expect(H.nodes.has(e.from)).toBe(true);
        expect(H.nodes.has(e.to)).toBe(true);
        expect(e.weight).toBeGreaterThanOrEqual(0);
        expect(e.weight).toBeLessThanOrEqual(1);
      }
    }
    expect(edges).toBe(H.size.edges);
    for (const m of H.moments) expect(H.nodes.get(m.id)?.kind).toBe("decision");
  });

  it("adds nothing when the same reading is made again", () => {
    const state = () => JSON.stringify({ ...H.toJSON(), readings: 0 });
    const before = state();
    for (const [town, s] of Object.entries(rs.towns)) {
      const r = H.absorb({ world: s.world, traces: s.traces, fresh: last.get(town), town, chronicle: rs.region.chronicle });
      expect([r.moments, r.nodes, r.edges]).toEqual([0, 0, 0]);
    }
    expect(state()).toBe(before);
  });

  it("only follows a cause that had already happened", () => {
    for (const m of H.moments.filter((_, i) => i % 7 === 0)) {
      const walk = (t: WhyTree, bound: number) => {
        for (const c of t.causes) {
          expect(c.via!.tick).toBeLessThanOrEqual(bound);
          if (Number.isFinite(c.node.tick)) expect(c.node.tick).toBeLessThanOrEqual(bound);
          expect(c.share).toBeLessThanOrEqual(t.share + 1e-9);
          walk(c, Math.min(bound, c.via!.tick));
        }
      };
      walk(trail(H, m.id)!, m.tick);
    }
  });

  it("walks a late choice back to before the story began, and names how long ago", () => {
    const late = H.moments.filter((m) => m.tick > 3 * YEAR * DAY);
    const deep = late
      .map((m) => ({ m, steps: longestThread(trail(H, m.id)!) }))
      .filter((x) => x.steps.some((s) => Number.isFinite(s.node.tick) && s.node.tick < 0));
    expect(deep.length).toBeGreaterThan(0);
    const { m, steps } = deep[0]!;
    // Oldest first, ending on the choice itself; every step but the last says how it led on.
    expect(steps[steps.length - 1]!.node.id).toBe(m.id);
    expect(steps.slice(0, -1).every((s) => !!s.mechanism)).toBe(true);
    const o = origins(H, m.id)!;
    expect(o.earliest!).toBeLessThan(0);
    expect(o.ancestors.length).toBeGreaterThanOrEqual(steps.length - 1);
    expect(whenText(H.calendar, o.earliest!)).toMatch(/before the story/);
    expect(agoText(H.calendar, o.earliest!, m.tick)).toMatch(/years? earlier/);
    expect(whenText(H.calendar, m.tick)).toMatch(/^year 4, /);
    const strong = strongestThread(trail(H, m.id)!);
    expect(strong[strong.length - 1]!.node.id).toBe(m.id);
  });

  it("follows what weighs on someone forward to the choices it shaped", () => {
    const weights = [...H.weights.values()];
    expect(weights.some((w) => w.kind === "schema")).toBe(true);
    const shaped = weights.map((w) => ({ w, r: reach(H, H.calendar, w.id)! })).filter((x) => x.r.choices.length > 0);
    expect(shaped.length).toBeGreaterThan(0);
    for (const { r } of shaped.slice(0, 20)) {
      for (const c of r.choices) {
        expect(c.node.kind).toBe("decision");
        expect(c.share).toBeGreaterThanOrEqual(0.02);
      }
      expect(r.byYear.reduce((a, y) => a + y.choices, 0)).toBe(r.choices.length);
      expect(r.minds.reduce((a, x) => a + x.choices, 0)).toBe(r.choices.length);
    }
  });

  it("saves and loads without losing a thread", () => {
    const again = CausalHistory.fromJSON(JSON.parse(JSON.stringify(H.toJSON())));
    expect(again.size).toEqual(H.size);
    expect(again.to).toBe(H.to);
    for (const m of H.moments.filter((_, i) => i % 50 === 0)) {
      expect(JSON.stringify(trail(again, m.id))).toBe(JSON.stringify(trail(H, m.id)));
      expect(again.moment(m.id)).toEqual(m);
    }
  });

  it("forgets what came after a point the world is wound back to", () => {
    const cut = 2 * YEAR * DAY;
    const back = CausalHistory.fromJSON(JSON.parse(JSON.stringify(H.toJSON())));
    back.truncate(cut);
    expect(back.to).toBe(cut);
    expect(back.moments.length).toBeGreaterThan(0);
    expect(back.moments.length).toBeLessThan(H.moments.length);
    expect(back.moments.every((m) => m.tick <= cut)).toBe(true);
    for (const n of back.nodes.values()) if (Number.isFinite(n.tick)) expect(n.tick).toBeLessThanOrEqual(cut);
    for (const list of back.into.values()) for (const e of list) expect(back.nodes.has(e.from) && back.nodes.has(e.to) && e.tick <= cut).toBe(true);
    expect(back.marks.every((k) => k.tick <= cut)).toBe(true);
    // What already weighed on people then is still there to open.
    expect(back.weights.size).toBeGreaterThan(0);
    for (const w of back.weights.values()) expect(back.nodes.has(w.id) && w.seen <= cut).toBe(true);
  });

  it("finds things by a person's name and the words of what happened", () => {
    const m = H.moments.find((x) => x.kind === "store") ?? H.moments[0]!;
    const name = H.people[m.agent]!.name;
    const found = find(H, `${name} ${m.choice}`, { limit: 10 });
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => f.node.agent === m.agent)).toBe(true);
    expect(find(H, "zzzz qqqq")).toEqual([]);
  });

  it("cuts a brief for the Historian, and the offline reader answers from it with real citations", () => {
    const m = H.moments.filter((x) => x.kind !== "talk").at(-1)!;
    const brief = buildBrief(H, "Why did they do this?", { focus: [m.id] });
    expect(brief.nodes.find((n) => n.ref === brief.focus[0]!.ref)?.id).toBe(m.id);
    expect(brief.focus[0]!.moment?.choice).toBe(m.choice);
    const refs = brief.nodes.map((n) => n.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const l of brief.links) expect(refs.includes(l.cause) && refs.includes(l.effect)).toBe(true);
    for (const n of brief.nodes) expect(brief.text).toContain(`[${n.ref}]`);
    expect(brief.text).toContain("Why did they do this?");

    const a = offlineHistorian(brief);
    expect(a.answer.length).toBeGreaterThan(80);
    expect(a.cites.length).toBeGreaterThan(0);
    expect(a.cites).toEqual(citedIn(a.answer, brief));
    for (const tag of a.answer.matchAll(/\[(n\d+)\]/g)) expect(refs).toContain(tag[1]);
    // A reader that makes up a tag does not get it counted.
    expect(citedIn(`It began here [${refs[0]}] and also here [n99999].`, brief)).toEqual([refs[0]]);

    // With no choice picked, the question's own words find the subject.
    const name = H.people[m.agent]!.name;
    const asked = buildBrief(H, `Why did ${name} choose ${m.choice}?`);
    expect(asked.focus.length).toBeGreaterThan(0);
    expect(offlineHistorian(buildBrief(H, "zzzz qqqq")).cites).toEqual([]);
  });
});
