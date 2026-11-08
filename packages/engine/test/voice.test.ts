import { describe, expect, it } from "vitest";
import { buildLedger, createVillage, readWord, voiceBends, voiceLineage, voiceSummary, WorldSession, type VoiceAct } from "@psyche/engine";
import { carryWords, voiceOf } from "../src/world/voice.js";
import { dematerialize } from "../src/world/aggregate.js";
import { createMockFaculties } from "@psyche/faculties";

async function town(seed = 11, hours = 4) {
  const s = new WorldSession(createVillage(seed), createMockFaculties());
  await s.apply({ type: "advance", minutes: hours * 60 });
  return s;
}
const speak = (s: WorldSession, act: VoiceAct) => s.apply({ type: "voice", act });
const run = async (s: WorldSession, hours: number) => {
  for (let h = 0; h < hours; h++) await s.apply({ type: "advance", minutes: 60 });
};

describe("the Voice", () => {
  it("reads what you say: prophecy, rite, taboo, judgement", () => {
    const w = createVillage(11);
    const a = readWord(w, "A storm will come in three days. Leave a fish at the landing each dawn.");
    expect(a.prophecy?.event).toBe("gale");
    expect(a.prophecy!.by - w.tick).toBeGreaterThan(3 * 1440);
    expect(a.practice).toMatchObject({ kind: "rite", place: "harbour", at: "dawn", offering: true });
    const b = readWord(w, "Do not fish on the seventh day.");
    expect(b.practice).toMatchObject({ kind: "taboo", place: "sea", every: 7 });
    const c = readWord(w, "Corran is a thief and a liar.");
    expect(c.subject).toBe("corran");
    expect(c.stance).toBe("accuse");
    expect(readWord(w, "The dead are watching.").prophecy).toBeUndefined();
  });

  it("a voice from the sky reaches everyone, through the cognitive cycle, and not everyone believes it", async () => {
    const s = await town();
    await speak(s, { act: "speak", guise: "sky", text: "A storm will come in three days. Leave a fish at the landing each dawn." });
    const w = s.world;
    const word = voiceOf(w).words[0]!;
    expect(Object.keys(word.carriers).sort()).toEqual([...w.order].sort());
    const faiths = Object.values(word.carriers).map((c) => c.faith);
    expect(Math.max(...faiths) - Math.min(...faiths)).toBeGreaterThan(0.25);
    for (const c of Object.values(word.carriers)) {
      // Each hearing is a moment in that mind, with a belief that remembers where it came from.
      expect(s.traces.some((t) => t.agent === c.agent && t.trace.id === c.trace)).toBe(true);
      const bel = w.minds[c.agent]!.beliefs.find((b) => b.id === c.belief)!;
      expect(bel.rumor).toBe(word.id);
      expect(bel.source.from).toBe("sky");
    }
    expect(s.feed.some((f) => /voice speaks out of the sky/.test(f.title))).toBe(true);
  });

  it("runs the same way twice, and a world nobody speaks into is untouched", async () => {
    const go = async () => {
      const s = await town(11);
      await speak(s, { act: "speak", guise: "prophet", place: "tavern", text: "The dead keep count of what you hold back." });
      await run(s, 30);
      return JSON.stringify(voiceSummary(s.world));
    };
    expect(await go()).toBe(await go());
    const quiet = await town(11, 30);
    expect(quiet.world.voice).toBeUndefined();
  });

  it("words travel from mouth to mouth and change, and every change is pinned to something in the teller's mind", async () => {
    const s = await town(11);
    const w0 = s.world;
    const to = w0.order.find((id) => w0.agents[id]!.place !== w0.agents[id]!.home)!;
    await speak(s, { act: "speak", guise: "stranger", to, text: "A great storm will come before winter, and the sea will take what it is owed." });
    await run(s, 8 * 24);
    const w = s.world;
    const L = voiceLineage(w, "word_1")!;
    expect(L.nodes.length).toBeGreaterThan(5);
    expect(Math.max(...L.nodes.map((n) => n.depth))).toBeGreaterThanOrEqual(3);
    expect(L.word.versions).toBeGreaterThan(1);
    const bends = L.nodes.flatMap((n) => n.bends);
    expect(bends.length).toBeGreaterThan(0);
    for (const b of bends.filter((x) => x.kind === "scapegoat")) {
      const m = w.minds[b.agent]!;
      // The culprit came from a grudge the teller really holds.
      if (b.cause!.kind === "belief") expect(m.beliefs.some((x) => x.id === b.cause!.id) || m.episodes.some((e) => e.id === b.cause!.id)).toBe(true);
      else expect(b.cause!.kind).toBe("relation");
    }
    // The ledger can walk from any version back to you, and from a bent version to what bent it.
    const ledger = buildLedger({ minds: w.minds, traces: s.traces, rumors: w.rumors, events: w.events, village: w.village, bends: voiceBends(w) });
    expect(ledger.edges.some((e) => e.mechanism === "passed on")).toBe(true);
    expect([...ledger.nodes.values()].some((n) => n.kind === "outside" && /You spoke, as a stranger/.test(n.label))).toBe(true);
    if (voiceBends(w).length) expect(ledger.edges.some((e) => e.mechanism === "bent by")).toBe(true);
  });

  it("a prophecy you make come true converts doubters", async () => {
    const s = await town(11);
    await speak(s, { act: "speak", guise: "sky", text: "A storm will come in three days." });
    const word = voiceOf(s.world).words[0]!;
    const doubters = Object.values(word.carriers).filter((c) => c.faith < 0.45).map((c) => c.agent);
    expect(doubters.length).toBeGreaterThan(0);
    await speak(s, { act: "fulfil", word: word.id });
    expect(word.prophecy!.outcome).toBe("fulfilled");
    expect(s.world.village!.weather).toBe("gale");
    expect(doubters.some((id) => word.carriers[id]!.faith >= 0.45)).toBe(true);
    expect(s.feed.some((f) => f.title === "The prophecy comes true")).toBe(true);
  });

  it("when a prophecy fails, the committed with company double down and the rest fall away (Festinger 1956)", async () => {
    const s = await town(11);
    await speak(s, { act: "speak", guise: "sky", text: "Theo will die tomorrow." });
    const word = voiceOf(s.world).words[0]!;
    expect(word.prophecy).toMatchObject({ event: "death", about: "theo" });
    const believers = Object.values(word.carriers).filter((c) => c.faith >= 0.45 && c.agent !== "theo");
    expect(believers.length).toBeGreaterThanOrEqual(4);
    // Three of them have told everyone and kept the vigil: they are committed, and they have each other.
    const core = believers.slice(0, 3);
    for (const c of core) {
      c.faith = Math.max(c.faith, 0.7);
      c.told = ["a", "b", "c", "d", "e"];
      c.practiced = 4;
      for (const o of core) if (o !== c) s.world.minds[c.agent]!.others[o.agent]!.liking = 0.7;
    }
    const rest = believers.slice(3).map((c) => c.agent);
    await run(s, 48);
    expect(word.prophecy!.outcome).toBe("failed");
    for (const c of core) {
      expect(c.doubled, c.agent).toBeDefined();
      expect(c.version.held).toBe(true);
    }
    for (const id of rest) expect(word.carriers[id]!.lapsed !== undefined || word.carriers[id]!.doubled !== undefined).toBe(true);
    expect(rest.some((id) => word.carriers[id]!.lapsed !== undefined)).toBe(true);
  });

  it("a taboo keeps believing fishers off the sea", async () => {
    const s = await town(11, 1);
    await speak(s, { act: "speak", guise: "sky", text: "Never fish the bay again." });
    const word = voiceOf(s.world).words[0]!;
    expect(word.practice).toMatchObject({ kind: "taboo", place: "sea" });
    for (const c of Object.values(word.carriers)) c.faith = 0.95;
    await run(s, 26);
    const w = s.world;
    const fishers = w.order.filter((id) => w.agents[id]!.role === "fisher");
    expect(fishers.length).toBeGreaterThan(0);
    const away = fishers.filter((id) => /staying away from the bay/.test(w.agents[id]!.activity));
    expect(away.length).toBeGreaterThan(0);
    for (const id of away) expect(w.agents[id]!.place).not.toBe("sea");
  });

  it("enough belief and a sign make a faith; a drifting rival splits it", async () => {
    const s = await town(13);
    const w0 = s.world;
    const to = w0.order.find((id) => w0.agents[id]!.place !== w0.agents[id]!.home)!;
    await speak(s, { act: "speak", guise: "stranger", to, text: "A great storm will come before winter, and the sea will take what it is owed." });
    await s.apply({ type: "advance", minutes: 10 * 60 });
    await speak(s, { act: "speak", guise: "prophet", place: "tavern", text: "The dead are watching. Gather at the headland each dusk, or they will come for the children." });
    await run(s, 20 * 24);
    const v = voiceSummary(s.world)!;
    expect(v.faiths.length).toBeGreaterThanOrEqual(2);
    const sect = v.faiths.find((f) => f.parent)!;
    expect(sect.split).toBeTruthy();
    expect(v.log.some((l) => l.kind === "schism")).toBe(true);
    // A rite took hold and joined the town's norms.
    expect(s.world.village!.norms.some((n) => n.topic === "rite")).toBe(true);
  }, 120_000);

  it("a believing trader carries the words to another town, and an unwatched town keeps them", async () => {
    const s = await town(11);
    await speak(s, { act: "speak", guise: "sky", text: "A storm will come in three days. Leave a fish at the landing each dawn." });
    const from = s.world;
    const word = voiceOf(from).words[0]!;
    const trader = Object.values(word.carriers).sort((a, b) => b.faith - a.faith)[0]!.agent;
    word.carriers[trader]!.faith = 1;
    const to = createVillage(12);
    for (let i = 0; i < 30 && !to.voice?.words.length; i++) carryWords(from, to, trader);
    const there = to.voice!.words[0]!;
    expect(there.id).toBe(word.id);
    const c = Object.values(there.carriers)[0]!;
    expect(c.from).toBe(trader);
    expect(to.minds[c.agent]!.beliefs.some((b) => b.rumor === word.id)).toBe(true);
    // On the aggregate tier, minds are trimmed, but what they believe of your words stays.
    const agg = dematerialize(from);
    for (const id of Object.keys(word.carriers)) if (agg.minds[id]) expect(agg.minds[id]!.beliefs.some((b) => b.rumor === word.id)).toBe(true);
  });
});
