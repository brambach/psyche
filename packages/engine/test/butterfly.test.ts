import { describe, expect, it } from "vitest";
import { butterfly, createVillage, WorldSession } from "../src/index.js";
import { createMockFaculties } from "@psyche/faculties";

async function town() {
  const s = new WorldSession(createVillage(11), createMockFaculties());
  for (let i = 0; i < 24; i++) await s.apply({ type: "advance", minutes: 60 });
  return s.world;
}

describe("the butterfly", () => {
  it("finds nothing when nothing really changed: the two runs share their luck", async () => {
    const w = await town();
    const who = w.order[2]!;
    const b = (await butterfly(w, [{ who, edit: { kind: "trait", trait: "openness", value: w.minds[who]!.traits.openness } }], createMockFaculties(), 3))!;
    expect(b.compared).toBeGreaterThan(20);
    expect(b.flips).toEqual([]);
    expect(b.onlyWith + b.onlyWithout).toBe(0);
    expect(b.town.with).toEqual(b.town.without);
  });

  it("shows a hard heart changing choices, its own first, and spreading", async () => {
    const w = await town();
    const who = w.order[2]!;
    const b = (await butterfly(w, [
      { who, edit: { kind: "trait", trait: "agreeableness", value: 0.02, lock: true } },
      { who, edit: { kind: "fear", text: "People only help when it suits them", triggers: ["help", "fairness", "trust", "store"], threat: 0.1, blame: 0.35, strength: 0.9 } },
    ], createMockFaculties(), 4))!;
    expect(b.flips.length).toBeGreaterThan(0);
    expect(b.flips[0]!.agent).toBe(who);
    expect(b.flips.some((f) => f.traced)).toBe(true);
    expect(b.spread).toHaveLength(4);
    expect(b.story[0]).toMatch(/choices came out differently/);
  });

  it("can change a whole town for years", async () => {
    const w = await town();
    const b = (await butterfly(w, [{ who: "*", edit: { kind: "trait", trait: "agreeableness", value: 0.05, lock: true } }], createMockFaculties(), 16, 120))!;
    expect(b.reached.length).toBeGreaterThan(5);
    expect(b.story.at(-1)).toMatch(/^By the end|looks the same/);
  }, 120_000);
});
