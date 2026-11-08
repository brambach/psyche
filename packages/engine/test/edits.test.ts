import { describe, expect, it } from "vitest";
import { buildLedger, createVillage, influence, inheritEdits, nodeId, shapeFear, why, WorldSession, type WorldInput } from "../src/index.js";
import { createMockFaculties } from "@psyche/faculties";



async function run(s: WorldSession, days: number) {
  for (let i = 0; i < days * 24; i++) await s.apply({ type: "advance", minutes: 60 });
}

describe("changing minds", () => {
  it("records each edit as an input, so a world with edits replays exactly", async () => {
    const f = createMockFaculties();
    const s = new WorldSession(createVillage(11), f);
    await run(s, 1);
    const who = s.world.order[3]!;
    await s.apply({ type: "edit", edit: { who, edit: { kind: "trait", trait: "agreeableness", value: 0.05, lock: true } } });
    await s.apply({ type: "edit", edit: { who: "*", edit: { kind: "fear", text: "There will never be enough food", triggers: ["food", "store", "winter"], threat: 0.35, blame: 0.1, strength: 0.7 } } });
    await run(s, 2);
    const r = await WorldSession.replay(s.initial, s.inputs, s.log, f);
    expect(r.divergedAt).toBeUndefined();
    expect(r.session.world.tick).toBe(s.world.tick);
    expect(JSON.stringify(r.session.world.minds[who])).toBe(JSON.stringify(s.world.minds[who]));
    expect(s.world.edits!.map((e) => e.scope)).toEqual(["person", "town"]);
    expect(s.world.edits![1]!.label).toMatch(/^You gave everyone in Hollow Bay the core belief “There will never be enough food”/);
    expect(s.feed.some((x) => x.title === s.world.edits![0]!.label)).toBe(true);
  });

  it("holds a locked trait against nightly drift, and lets go when unlocked", async () => {
    const s = new WorldSession(createVillage(11), createMockFaculties());
    const who = s.world.order[0]!;
    await s.apply({ type: "edit", edit: { who, edit: { kind: "trait", trait: "neuroticism", value: 0.97, lock: true } } });
    await run(s, 4);
    expect(s.world.minds[who]!.traits.neuroticism).toBe(0.97);
    await s.apply({ type: "edit", edit: { who, edit: { kind: "unlock", trait: "neuroticism" } } });
    expect(s.world.minds[who]!.locks).toBeUndefined();
  });

  it("traces later choices back to the edit: because you…", async () => {
    const s = new WorldSession(createVillage(11), createMockFaculties());
    await run(s, 1);
    const who = s.world.order[2]!;
    await s.apply({ type: "edit", edit: { who, edit: { kind: "trait", trait: "agreeableness", value: 0.02 } } });
    await s.apply({ type: "edit", edit: { who, edit: { kind: "fear", text: "People only help when it suits them", triggers: ["help", "fairness", "trust", "store"], threat: 0.1, blame: 0.35, strength: 0.8 } } });
    await s.apply({ type: "edit", edit: { who, notice: true, edit: { kind: "whisper", text: "Theo keeps food back from the store", about: "theo", topics: ["food", "store"], valence: -0.6 } } });
    await run(s, 3);
    const w = s.world;
    const L = buildLedger({ minds: w.minds, traces: s.traces, rumors: w.rumors, events: w.events, village: w.village, edits: w.edits });
    const [trait, fear, whisper] = w.edits!;
    const reach = influence(L, nodeId.world(trait!.id))!;
    expect(reach.decisions.length).toBeGreaterThan(0);
    // The trait edit is a direct cause of one of their choices.
    const d = reach.decisions.find((x) => x.steps === 1)!;
    const tree = why(L, d.node.id)!;
    expect(tree.causes.some((c) => c.node.kind === "edit" && c.via?.mechanism === "you changed")).toBe(true);
    // The core belief and the whispered thought are the player's, and the person never sees where they came from.
    const schema = w.minds[who]!.schemas.find((x) => x.text === "People only help when it suits them")!;
    expect((L.into.get(nodeId.item(who, schema.id)) ?? []).some((e) => e.from === nodeId.world(fear!.id))).toBe(true);
    const thought = w.minds[who]!.beliefs.find((b) => b.proposition === "Theo keeps food back from the store")!;
    expect(thought.source.kind).toBe("inferred");
    expect((L.into.get(nodeId.item(who, thought.id)) ?? []).some((e) => e.from === nodeId.world(whisper!.id))).toBe(true);
    // They noticed: a memory that something shifted.
    expect(w.minds[who]!.episodes.some((e) => e.edit === whisper!.id && /shifted/.test(e.gist))).toBe(true);
  });

  it("implants a memory they take for their own, and erases one", async () => {
    const s = new WorldSession(createVillage(11), createMockFaculties());
    const who = s.world.order[1]!;
    const other = s.world.order[4]!;
    await s.apply({ type: "edit", edit: { who, edit: { kind: "implant", gist: `${s.world.minds[other]!.name} pushed me off the dock`, about: [other], topics: ["dock", "sea"], valence: -0.7 } } });
    const ep = s.world.minds[who]!.episodes.at(-1)!;
    expect(ep.source.kind).toBe("witnessed");
    expect(ep.edit).toBe(s.world.edits![0]!.id);
    await s.apply({ type: "edit", edit: { who, edit: { kind: "erase", episode: ep.id } } });
    expect(s.world.minds[who]!.episodes.some((e) => e.id === ep.id)).toBe(false);
  });

  it("passes heritable core beliefs and locks to children", () => {
    const w = createVillage(11);
    const [a, b, c] = w.order.map((id) => w.minds[id]!);
    a!.schemas.push({ id: "sch_x", text: "Strangers will cheat you", triggers: ["trade"], blameBias: 0.3, threatBias: 0.15, strength: 0.75, edit: "edit_1", heritable: true });
    b!.locks = [{ trait: "openness", value: 0.95, heritable: true, edit: "edit_2" }];
    inheritEdits(c!, [a!, b!]);
    expect(c!.schemas.find((s) => s.text === "Strangers will cheat you")).toMatchObject({ strength: 0.6, heritable: true, edit: "edit_1" });
    expect(c!.traits.openness).toBe(0.95);
    expect(c!.locks?.[0]?.trait).toBe("openness");
  });

  it("shapes a core belief written in plain words", () => {
    const f = shapeFear("There's never enough bread to see us through winter.");
    expect(f.triggers).toEqual(expect.arrayContaining(["food", "winter"]));
    expect(f.threat).toBeGreaterThan(0);
    const g = shapeFear("People here are good and will always help");
    expect(g.blame).toBeLessThan(0);
  });

  it("refuses an edit for someone who isn't there", async () => {
    const s = new WorldSession(createVillage(11), createMockFaculties());
    const input: WorldInput = { type: "edit", edit: { who: "nobody", edit: { kind: "trait", trait: "openness", value: 1 } } };
    await s.apply(input);
    expect(s.world.edits).toBeUndefined();
  });
});


