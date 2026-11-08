import { describe, expect, it } from "vitest";
import { buildLedger, createVillage, influence, nodeId, parseWriting, personaLife, readPerson, sanitizeReading, why, WorldSession, SAMPLE_CHAT, SAMPLE_PERSONA, type WhyTree } from "../src/index.js";
import { createMockFaculties } from "@psyche/faculties";

async function run(s: WorldSession, days: number) {
  for (let i = 0; i < days * 24; i++) await s.apply({ type: "advance", minutes: 60 });
}

const juniper = () => readPerson({ text: SAMPLE_PERSONA.text, name: SAMPLE_PERSONA.name, pronouns: SAMPLE_PERSONA.pronouns });

describe("reading a person from their writing (offline mock)", () => {
  it("reads traits, memories, core beliefs, values and people, each citing the writing word for word", async () => {
    const r = await juniper();
    expect(r.method).toBe("mock");
    expect(r.age).toBe(31);
    expect(r.trade.role).toBe("builder");
    // She says she makes a to-do list every night and is kind of an introvert.
    expect(r.traits.conscientiousness.value).toBeGreaterThan(0.65);
    expect(r.traits.extraversion.value).toBeLessThan(0.45);
    // The night her dad left is the most formative memory, and it is where her distrust comes from.
    const dad = r.memories.find((m) => /dad left/.test(m.quote.text))!;
    expect(dad.valence).toBeLessThan(-0.5);
    const cant = r.beliefs.find((b) => /can't count on anyone/.test(b.text))!;
    expect(cant.kind).toBe("stated");
    expect(cant.memory).toBe(dad.id);
    expect(cant.triggers).toContain("help");
    expect(cant.blame).toBeGreaterThan(0);
    // The flood, when her best friend showed up, is a good memory, and taught the opposite.
    const flood = r.memories.find((m) => /flooded/.test(m.quote.text))!;
    expect(flood.valence).toBeGreaterThan(0.3);
    expect(r.beliefs.some((b) => b.memory === flood.id && b.blame < 0)).toBe(true);
    expect(r.values.map((v) => v.value)).toEqual(expect.arrayContaining(["benevolence", "security", "self-direction"]));
    expect(r.people.find((p) => p.name === "Rosa")?.relation).toBe("best friend");
    // Every quote is checked against the writing.
    const quotes = [...Object.values(r.traits).flatMap((t) => t.evidence), ...r.memories.map((m) => m.quote), ...r.beliefs.flatMap((b) => b.evidence)];
    expect(quotes.length).toBeGreaterThan(10);
    expect(quotes.every((q) => q.found)).toBe(true);
    // Memories are framed for a village: no apartments or trucks.
    expect(dad.gist).not.toMatch(/apartment/);
    expect(flood.gist).not.toMatch(/truck/);
  });

  it("keeps only the author's lines from a chat export", async () => {
    const p = parseWriting(SAMPLE_CHAT, "Dee");
    expect(p.chat).toBe(true);
    expect(p.author).toBe("Dee Park");
    expect(p.passages.every((x) => !/are you coming/.test(x))).toBe(true);
    const r = await readPerson({ text: SAMPLE_CHAT, name: "Dee Park", author: "Dee" });
    expect(r.notes[0]).toMatch(/Read as a chat/);
    expect(r.beliefs.some((b) => /say they'll help/.test(b.text))).toBe(true);
  });

  it("clamps a reading sent back from the browser", async () => {
    const r = await juniper();
    const bad = { ...r, name: "<b>Juni</b>", traits: { ...r.traits, openness: { value: 9, why: "x", evidence: [] } }, beliefs: [{ text: "x", triggers: ["<script>"], strength: 50 }], extra: "nope" };
    const s = sanitizeReading(bad);
    expect(s.name).toBe("bJunib");
    expect(s.traits.openness.value).toBe(0.97);
    expect(s.beliefs[0]!.strength).toBe(0.9);
    expect(s.beliefs[0]!.triggers.length).toBeGreaterThan(0);
    expect("extra" in s).toBe(false);
  });
});

describe("bringing them into the world", () => {
  it("lands them as a villager, replays exactly, and traces their choices back to what they wrote", async () => {
    const f = createMockFaculties();
    const s = new WorldSession(createVillage(11), f);
    await run(s, 1);
    const reading = await juniper();
    await s.apply({ type: "arrive", persona: reading });
    const w = s.world;
    const id = w.order.at(-1)!;
    expect(id).toBe("juniper");
    expect(w.agents[id]!.role).toBe("builder");
    expect(w.minds[id]!.schemas.length).toBe(reading.beliefs.length);
    expect(w.minds.wren!.others[id]).toBeDefined();
    expect(s.feed.some((x) => x.title === "A boat brings a stranger: Juniper")).toBe(true);
    // Through a pledge round (second evening) and a few days.
    await run(s, 4);

    const r = await WorldSession.replay(s.initial, s.inputs, s.log, f);
    expect(r.divergedAt).toBeUndefined();
    expect(JSON.stringify(r.session.world.minds[id])).toBe(JSON.stringify(s.world.minds[id]));

    const L = buildLedger({ minds: w.minds, traces: s.traces, rumors: w.rumors, events: w.events, village: w.village, edits: w.edits });
    const fromWriting = w.edits!.filter((e) => e.source === "writing");
    expect(fromWriting.length).toBeGreaterThan(8);
    // Some choice of hers leads back to her own words.
    const reached = fromWriting.flatMap((e) => influence(L, nodeId.world(e.id))?.decisions.filter((d) => d.node.agent === id) ?? []);
    expect(reached.length).toBeGreaterThan(0);
    const tree = why(L, reached[0]!.node.id)!;
    const flat = (t: WhyTree): WhyTree[] => [t, ...t.causes.flatMap(flat)];
    expect(flat(tree).some((t) => t.via?.mechanism === "in their own words" && /wrote|writing reads/.test(t.node.label))).toBe(true);

    const life = personaLife(w, L, s.feed, id)!;
    expect(life.alive).toBe(true);
    expect(life.choices.total).toBeGreaterThan(0);
    expect(life.choices.fromWriting).toBeGreaterThan(0);
    expect(life.beliefs.find((b) => /can't count on anyone/.test(b.text))!.quote).toMatch(/can't count on anyone/);
    expect(life.moments.some((m) => /stranger/.test(m.title))).toBe(true);
  });
});
