import { describe, expect, it } from "vitest";
import { createVillage, ME, WorldSession, youCheck, youView, type Deed, type YouAct } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

async function town(seed = 11, hours = 3) {
  const s = new WorldSession(createVillage(seed), createMockFaculties());
  await s.apply({ type: "advance", minutes: hours * 60 });
  return s;
}
/** Do one thing as the player; it has to be allowed. */
async function act(s: WorldSession, a: YouAct): Promise<Deed> {
  expect(youCheck(s.world, a)).toBeUndefined();
  await s.apply({ type: "you", act: a });
  return s.world.you!.deeds.at(-1)!;
}
const run = async (s: WorldSession, hours: number, step = 10) => {
  for (let i = 0; i < (hours * 60) / step; i++) await s.apply({ type: "advance", minutes: step });
};
const regard = (s: WorldSession, id: string) => s.world.minds[id]!.others[ME]!;

describe("walking into the world yourself", () => {
  it("nobody is there until you arrive, and a world you never walk into is untouched", async () => {
    const s = await town();
    expect(s.world.you).toBeUndefined();
    expect(youView(s.world)).toBeUndefined();
    expect(youCheck(s.world, { act: "greet", to: "mara" })).toMatch(/not in this world/);
    expect(youCheck(s.world, { act: "arrive", name: "  " })).toMatch(/name/);

    const d = await act(s, { act: "arrive", name: "Bryce" });
    expect(d.kind).toBe("arrive");
    const v = youView(s.world)!;
    expect(v).toMatchObject({ name: "Bryce", here: true, standing: "stranger", place: "harbour", food: 6, amber: 3 });
    expect(s.feed.some((f) => /stranger walks up/.test(f.title))).toBe(true);
    // Until you say who you are, nobody has your name.
    for (const id of s.world.order) expect(s.world.minds[id]!.others[ME]?.name ?? "the stranger").toBe("the stranger");
  });

  it("a hello goes through their mind: they choose how to take it, answer, and keep it", async () => {
    const s = await town();
    await act(s, { act: "arrive", name: "Bryce" });
    const d = await act(s, { act: "greet", to: "mara" });
    const r = d.reactions.find((x) => x.agent === "mara")!;
    expect(r.role).toBe("to");
    // The reaction is a real moment in Mara's head: a recorded trace with a scored decision.
    const t = s.traces.find((x) => x.agent === "mara" && x.trace.id === r.trace)!.trace;
    expect(t.decision?.options.length).toBeGreaterThan(1);
    const chosen = t.decision!.options.find((o) => o.id === t.action!.option)!;
    expect(r.choice).toBe(chosen.label);
    expect(r.why.length).toBeGreaterThan(0);
    // Words of their own, not the engine's description of the choice.
    expect(r.said).toBeTruthy();
    expect(r.said).not.toBe(chosen.description);
    expect(r.kept).toMatch(/Bryce/);
    expect(regard(s, "mara").name).toBe("Bryce");
    expect(youView(s.world)!.people.find((p) => p.id === "mara")).toMatchObject({ knows: true, met: 1 });
    // You are standing where she is now.
    expect(s.world.you!.place).toBe(s.world.agents.mara!.place);
  });

  it("a gift moves the food and how they hold you, and a first kindness counts for more than a fifth", async () => {
    const s = await town();
    await act(s, { act: "arrive", name: "Bryce" });
    const hh = Object.values(s.world.village!.households).find((h) => h.members.includes("wren"))!;
    const before = hh.food;
    const first = await act(s, { act: "give", to: "wren", what: "food", amount: 1 });
    const r1 = first.reactions.find((x) => x.agent === "wren")!;
    expect(s.world.you!.food).toBe(5);
    if (/gladly|wonder/i.test(r1.choice ?? "")) expect(hh.food).toBeCloseTo(before + 1, 5);
    expect(r1.liking[1]).toBeGreaterThan(r1.liking[0]);
    expect(r1.trust[1]).toBeGreaterThan(r1.trust[0]);
    let last = first;
    for (let i = 0; i < 4; i++) last = await act(s, { act: "give", to: "wren", what: "food", amount: 1 });
    const r5 = last.reactions.find((x) => x.agent === "wren")!;
    expect(r5.trust[1] - r5.trust[0]).toBeLessThan(r1.trust[1] - r1.trust[0]);
    expect(youCheck(s.world, { act: "give", to: "wren", what: "food", amount: 5 })).toMatch(/don't have/);
  });

  it("an insult is heard by whoever is close, and becomes something the village knows happened", async () => {
    const s = await town(11, 13); // evening: people are at the fire
    await act(s, { act: "arrive", name: "Bryce" });
    const crowd = s.world.order.filter((id) => s.world.agents[id]!.place === "tavern");
    expect(crowd.length).toBeGreaterThan(3);
    const target = crowd[0]!;
    const d = await act(s, { act: "insult", to: target });
    expect(d.tone).toBe("bad");
    const to = d.reactions.find((r) => r.role === "to")!;
    expect(to.liking[1]).toBeLessThan(to.liking[0]);
    const saw = d.reactions.filter((r) => r.role === "saw");
    expect(saw.length).toBeGreaterThan(2);
    expect(saw.some((r) => r.trust[1] < r.trust[0])).toBe(true);
    // Onlookers lose less than the person it was said to.
    for (const r of saw) expect(r.liking[0] - r.liking[1]).toBeLessThanOrEqual(to.liking[0] - to.liking[1] + 1e-9);
    // It is an event in the world, so memories of it can be traced and talked about.
    expect(s.world.events.some((e) => e.id === d.id && e.kind === "you")).toBe(true);
    expect(s.world.minds[saw[0]!.agent]!.episodes.some((e) => e.eventId === d.id || e.id === d.id || e.gist.includes("Bryce") || e.gist.includes("stranger"))).toBe(true);
  });

  it("food taken with nobody watching is counted later, and somebody gets the blame", async () => {
    const s = await town(); // mid-morning: most people are out at work
    await act(s, { act: "arrive", name: "Bryce" });
    const v = s.world.village!;
    const [hid, hh] = Object.entries(v.households).find(([, h]) => h.food >= 1 && !s.world.order.some((id) => s.world.agents[id]!.place === h.home))!;
    await act(s, { act: "move", place: hh.home });
    const stock = hh.food;
    const d = await act(s, { act: "steal", from: hid });
    expect(hh.food).toBeLessThan(stock);
    expect(s.world.you!.food).toBeGreaterThan(6);
    expect(d.reactions).toEqual([]);
    const theft = s.world.you!.thefts[0]!;
    expect(theft.seen).toEqual([]);
    expect(theft.noticed).toBeUndefined();
    await run(s, 14);
    const found = s.world.you!.thefts[0]!;
    expect(found.noticed).toBeGreaterThan(theft.tick);
    expect(found.by).toBeTruthy();
    // Whoever found it gone picked the person they trust least: you, or one of their own.
    expect(found.blamed === ME || !!s.world.minds[found.blamed!]).toBe(true);
    expect(hh.members).toContain(found.by);
    expect(s.feed.some((f) => f.tick === found.noticed && f.agents.includes(found.by!))).toBe(true);
  });

  it("a story you tell about someone becomes a belief with you as its source", async () => {
    const s = await town();
    await act(s, { act: "arrive", name: "Bryce" });
    await act(s, { act: "greet", to: "wren" });
    const d = await act(s, { act: "rumor", to: "wren", about: "corran", text: "Corran has been taking from the common store at night", valence: -0.6 });
    expect(d.reactions[0]!.agent).toBe("wren");
    const story = youView(s.world)!.stories.find((x) => x.yours)!;
    expect(story).toMatchObject({ about: "corran", yours: true });
    expect(youCheck(s.world, { act: "rumor", to: "wren", about: "wren", text: "x", valence: -0.5 })).toMatch(/someone else/);
    const took = /take it in/i.test(d.reactions[0]!.choice ?? "");
    expect(story.carriers).toBe(took ? 1 : 0);
    if (took) expect(s.world.minds.wren!.beliefs.some((b) => b.source.from === ME && b.about === "corran")).toBe(true);
  });

  it("people come to you wanting an answer, and the answer goes through their mind too", async () => {
    const s = await town();
    await act(s, { act: "arrive", name: "Bryce" });
    await act(s, { act: "move", place: "tavern" });
    let asked = false;
    for (let i = 0; i < 12 * 6 && !asked; i++) {
      await s.apply({ type: "advance", minutes: 10 });
      // Standing in the square all day, as the page's heartbeat would keep you.
      if (!s.world.you!.here || s.world.you!.place !== "tavern") await s.apply({ type: "you", act: { act: "move", place: "tavern" } });
      asked = !!s.world.you!.ask;
    }
    expect(asked).toBe(true);
    const ask = youView(s.world)!.ask!;
    expect(ask.line).toBeTruthy();
    expect(ask.options.length).toBeGreaterThan(1);
    expect(youCheck(s.world, { act: "answer", ask: ask.id, choice: "nonsense" })).toBeTruthy();
    const d = await act(s, { act: "answer", ask: ask.id, choice: ask.options[0]!.id });
    expect(d.reactions.some((r) => r.agent === ask.from && r.role === "to")).toBe(true);
    expect(s.world.you!.ask).toBeUndefined();
  });

  it("do enough harm and the village votes at the fire; sent away, you cannot act until they will have you back", async () => {
    const s = await town(11, 13);
    await act(s, { act: "arrive", name: "Bryce" });
    for (let round = 0; round < 3; round++) {
      const there = s.world.order.filter((id) => s.world.agents[id]!.place === "tavern" && !youCheck(s.world, { act: "insult", to: id }));
      for (const id of there.slice(0, 6)) await act(s, { act: "insult", to: id });
    }
    expect(youView(s.world)!.summary.against).toBeGreaterThanOrEqual(3);
    await run(s, 36);
    const y = s.world.you!;
    expect(y.verdicts.length).toBeGreaterThan(0);
    const v = y.verdicts.at(-1)!;
    expect(v.send.length + v.stay.length).toBeGreaterThan(3);
    // Every vote is a moment in someone's head.
    for (const t of v.traces) expect(s.traces.some((x) => x.agent === t.agent && x.trace.id === t.trace)).toBe(true);
    expect(v.banished).toBe(true);
    expect(y.standing).toBe("banished");
    expect(y.here).toBe(false);
    expect(youCheck(s.world, { act: "greet", to: "mara" })).toMatch(/sent you away/);
    expect(youCheck(s.world, { act: "arrive", name: "Bryce" })).toMatch(/won't have you back/);
    await run(s, 24 * 3 + 2, 60);
    expect(youCheck(s.world, { act: "arrive", name: "Bryce" })).toBeUndefined();
    await act(s, { act: "arrive", name: "Bryce" });
    expect(s.world.you!.standing).toBe("stranger");
    // They let you back, but nobody has forgotten.
    expect(youView(s.world)!.summary.cold).toBeGreaterThan(0);
  });

  it("on the free mock, every answer is a line of their own rather than the engine's label for the choice", async () => {
    const s = await town();
    await act(s, { act: "arrive", name: "Bryce" });
    const tried: YouAct[] = [];
    for (const to of ["mara", "wren", "theo", "corran", "jun"]) {
      tried.push({ act: "greet", to }, { act: "compliment", to }, { act: "comfort", to }, { act: "give", to, what: "food", amount: 1 }, { act: "beg", to }, { act: "buy", to }, { act: "help", to });
      tried.push({ act: "ask", to, about: "me" }, { act: "ask", to, about: to === "mara" ? "wren" : "mara" }, { act: "rumor", to, about: to === "mara" ? "wren" : "mara", text: "They keep back more than their share", valence: -0.5 }, { act: "insult", to }, { act: "apologize", to });
    }
    let lines = 0;
    for (const a of tried) {
      if (youCheck(s.world, a)) continue;
      const d = await act(s, a);
      for (const r of d.reactions.filter((x) => x.role === "to" && x.said)) {
        const t = s.traces.find((x) => x.agent === r.agent && x.trace.id === r.trace)!.trace;
        const chosen = t.decision?.options.find((o) => o.id === t.action?.option);
        expect(r.said, `${a.act}: ${r.choice}`).not.toBe(chosen?.description);
        lines++;
      }
    }
    expect(lines).toBeGreaterThan(30);
  });

  it("runs the same way twice, and replays exactly from its recorded inputs", async () => {
    const go = async () => {
      const s = await town();
      await act(s, { act: "arrive", name: "Bryce" });
      await act(s, { act: "greet", to: "mara" });
      await act(s, { act: "give", to: "wren", what: "food", amount: 2 });
      await act(s, { act: "say", to: "corran", text: "That's a good store you keep. Thank you for the welcome." });
      await run(s, 3);
      await act(s, { act: "insult", to: "theo" });
      await run(s, 20, 60);
      return s;
    };
    const a = await go(), b = await go();
    expect(JSON.stringify(youView(a.world))).toBe(JSON.stringify(youView(b.world)));
    const r = await WorldSession.replay(a.initial, a.inputs, a.log, createMockFaculties());
    expect(r.divergedAt).toBeUndefined();
    expect(JSON.stringify(r.session.world.you)).toBe(JSON.stringify(a.world.you));
  });
});
