import { describe, expect, it } from "vitest";
import type { FacultyName, SpeakRequest } from "@psyche/engine";
import { costOf, createMockFaculties, Governor, HAIKU, SONNET, type CallUsage, type FacultyCaller } from "@psyche/faculties";

const mock = createMockFaculties();

/** A stand-in for Claude: answers with the mock and reports a fixed usage for every call. */
function fake(calls: { faculty: FacultyName; model: string }[], usage = { input: 1000, cacheRead: 2000, cacheWrite: 0, output: 200 }) {
  return (onUsage: (u: CallUsage) => void): FacultyCaller =>
    ((faculty: FacultyName, req: unknown, model: string) => {
      calls.push({ faculty, model });
      onUsage({ faculty, model, ...usage });
      return (mock[faculty] as (r: unknown) => Promise<unknown>)(req);
    }) as FacultyCaller;
}

const speak = (salience: number, id = "mara"): SpeakRequest => ({
  self: { id, name: "Mara", summary: "", voice: "" },
  listener: { id: "theo", name: "Theo" },
  heard: "",
  intent: { option: "Small talk", description: "Pass the time this morning." },
  content: [],
  style: { warmth: 0.5, curtness: 0.3, hedging: 0.2, verbosity: 0.4 },
  stance: [],
  salience,
});
const deliberate = { self: { name: "Mara", summary: "", voice: "" }, situation: "", workspace: [], options: [{ id: "a", label: "A", description: "" }], stance: [] };

describe("budget governor", () => {
  it("routes each faculty to its tier and prices the usage", async () => {
    const calls: { faculty: FacultyName; model: string }[] = [];
    const g = new Governor({ mode: "claude", caller: fake(calls), spendFile: null });
    await g.faculties.speak(speak(0.9));
    await g.faculties.deliberate(deliberate);
    expect(calls).toEqual([
      { faculty: "speak", model: HAIKU },
      { faculty: "deliberate", model: SONNET },
    ]);
    const s = g.snapshot();
    const u = { input: 1000, cacheRead: 2000, cacheWrite: 0, output: 200 };
    expect(s.sessionUsd).toBeCloseTo(costOf(HAIKU, u) + costOf(SONNET, u), 10);
    expect(s.todayUsd).toBeCloseTo(s.sessionUsd, 10);
    expect(s.cacheHitRate).toBeCloseTo(2 / 3, 5);
  });

  it("renders small talk from templates unless the speaker is in focus", async () => {
    const calls: { faculty: FacultyName; model: string }[] = [];
    const g = new Governor({ mode: "claude", caller: fake(calls), spendFile: null });
    await g.faculties.speak(speak(0.2));
    expect(calls.length).toBe(0);
    expect(g.snapshot().templated).toBe(1);
    g.focus.add("mara");
    await g.faculties.speak(speak(0.2));
    expect(calls.length).toBe(1);
  });

  it("puts named characters and the watched in L0 and everyone else in the cheaper L1 tier", async () => {
    const calls: { faculty: FacultyName; model: string }[] = [];
    const g = new Governor({ mode: "claude", caller: fake(calls), spendFile: null });
    g.core.add("mara");
    const as = (id: string) => ({ ...deliberate, self: { ...deliberate.self, id } });
    await g.faculties.deliberate(as("mara"));
    await g.faculties.deliberate(as("bram"));
    await g.faculties.speak(speak(0.45, "bram"));
    g.focus.add("bram");
    await g.faculties.deliberate(as("bram"));
    expect(calls).toEqual([
      { faculty: "deliberate", model: SONNET },
      { faculty: "deliberate", model: HAIKU },
      { faculty: "deliberate", model: SONNET },
    ]);
    expect(g.snapshot().templated).toBe(1);
  });

  it("steps down as the day's spend nears the cap, and goes offline at it", async () => {
    const calls: { faculty: FacultyName; model: string }[] = [];
    // Each call costs a known amount; set the cap so a few calls cross each threshold.
    const usage = { input: 100_000, cacheRead: 0, cacheWrite: 0, output: 0 };
    const g = new Governor({ mode: "claude", caller: fake(calls, usage), spendFile: null, dailyCapUsd: costOf(SONNET, usage) / 0.85 });
    await g.faculties.deliberate(deliberate);
    expect(g.level()).toBe("economy");
    await g.faculties.deliberate(deliberate);
    expect(calls[1]!.model).toBe(HAIKU);
    while (g.level() !== "offline") await g.faculties.speak(speak(1));
    const n = calls.length;
    await g.faculties.deliberate(deliberate);
    expect(calls.length).toBe(n);
  });

  it("starts a new day at zero", async () => {
    let now = new Date("2026-10-30T23:59:00Z");
    const usage = { input: 100_000, cacheRead: 0, cacheWrite: 0, output: 0 };
    const g = new Governor({ mode: "claude", caller: fake([], usage), spendFile: null, dailyCapUsd: 0.01, now: () => now });
    await g.faculties.deliberate(deliberate);
    expect(g.level()).toBe("offline");
    now = new Date("2026-10-31T00:01:00Z");
    expect(g.level()).toBe("normal");
  });

  it("on the mock, estimates what Claude would have cost without spending", async () => {
    const g = new Governor({ mode: "mock", spendFile: null });
    await g.faculties.deliberate(deliberate);
    await g.faculties.speak(speak(0.9));
    const s = g.snapshot();
    expect(s.estimated).toBe(true);
    expect(s.sessionUsd).toBeGreaterThan(0);
    expect(s.todayUsd).toBe(0);
    expect(s.byModel[SONNET]!.calls).toBe(1);
  });

  it("sends nothing to Claude while years pass quietly (L2)", async () => {
    const calls: { faculty: FacultyName; model: string }[] = [];
    const g = new Governor({ mode: "claude", caller: fake(calls), spendFile: null });
    g.quiet = true;
    expect(g.tierOf("anyone")).toBe("L2");
    await g.faculties.deliberate(deliberate);
    await g.faculties.speak(speak(0.95));
    expect(calls.length).toBe(0);
    expect(g.snapshot().sessionUsd).toBe(0);
    g.quiet = false;
    await g.faculties.deliberate(deliberate);
    expect(calls.length).toBe(1);
  });
});
