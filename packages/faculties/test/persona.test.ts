import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { readPerson, SAMPLE_PERSONA, type RawReading } from "@psyche/engine";
import { createClaudeReader, createMockFaculties, Governor, SONNET, type CallUsage, type FacultyCaller } from "@psyche/faculties";

const mock = createMockFaculties();
const noCalls = (_: (u: CallUsage) => void): FacultyCaller => ((f: string, r: unknown) => (mock as unknown as Record<string, (r: unknown) => unknown>)[f]!(r)) as FacultyCaller;

const t = (value: number, quote: string) => ({ value, why: "test", quotes: [quote] });
/** What Claude might send back for the made-up sample person, including one paraphrased quote. */
const canned: RawReading = {
  age: 31,
  summary: "A careful, independent furniture maker.",
  voice: { description: "Short and dry.", samples: ["I like knowing what's coming."] },
  traits: {
    openness: t(0.55, "Thinking a lot lately about why I build things."),
    conscientiousness: t(0.85, "I still make a to-do list every single night"),
    extraversion: t(0.35, "I'm kind of an introvert"),
    agreeableness: t(0.45, "I'm blunt and it gets me in trouble"),
    neuroticism: t(0.65, "I worry about money constantly."),
    honesty: t(0.8, "I'll always pay people what I owe them, on time, every time."),
  },
  attachment: { anxiety: 0.4, avoidance: 0.65, why: "hates asking", quotes: ["honestly I hate asking for help."] },
  self: { selfEsteem: 0.6, selfEfficacy: 0.7, control: 0.55, why: "proud of the shop", quotes: ["I'm proud of it."] },
  memories: [{ quote: "When I was 12 my dad left and my mom worked two jobs to keep the apartment.", gist: "When I was twelve my father left, and my mother worked two trades to keep our rooms.", valence: -0.8, arousal: 0.7, coping: 0.2, topics: ["family", "help"], yearsAgo: 19, people: ["dad", "mom"] }],
  beliefs: [
    { text: "You can't count on anyone when it matters", kind: "stated", quotes: ["you can't count on anyone when it actually matters"], strength: 0.7, memory: 0, hopeful: false },
    { text: "Friends show up", kind: "stated", quotes: ["My friends always show up for me no matter what"], strength: 0.4, memory: null, hopeful: true },
  ],
  values: [{ value: "self-direction", weight: 0.9, quotes: ["Freedom is the whole point."] }],
  people: [{ name: "Rosa", relation: "best friend", feeling: 0.9, quotes: ["she's the one person who has never let me down"] }],
  trade: { role: "builder", why: "furniture", quotes: ["Started the shop four years ago"] },
  lifeStory: "I came to the bay to start again.",
};

function stubClient(seen: unknown[]): Anthropic {
  return {
    beta: {
      messages: {
        create: async (req: unknown) => {
          seen.push(req);
          return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(canned) }], usage: { input_tokens: 4000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 } };
        },
      },
    },
  } as unknown as Anthropic;
}

describe("reading a person with Claude", () => {
  it("sends the writing once, meters it, and checks every quote against the writing", async () => {
    const seen: unknown[] = [];
    const g = new Governor({ mode: "claude", caller: noCalls, spendFile: null });
    const reader = createClaudeReader({ client: stubClient(seen), governor: g });
    const r = await readPerson({ text: SAMPLE_PERSONA.text, name: SAMPLE_PERSONA.name, pronouns: "she" }, reader);
    expect(seen.length).toBe(1);
    expect((seen[0] as { model: string }).model).toBe(SONNET);
    expect(r.method).toBe("claude");
    expect(r.traits.conscientiousness.value).toBe(0.85);
    expect(r.memories[0]!.gist).toMatch(/rooms/);
    expect(r.beliefs[0]!.memory).toBe("m1");
    // The paraphrase is caught and marked.
    expect(r.beliefs[1]!.evidence[0]!.found).toBe(false);
    expect(r.beliefs[0]!.evidence[0]!.found).toBe(true);
    expect(r.notes.some((n) => /could not be found/.test(n))).toBe(true);
    expect(g.snapshot().sessionUsd).toBeGreaterThan(0);
  });

  it("uses the free offline reader on the mock, or once the day's cap is spent", async () => {
    const seen: unknown[] = [];
    const offline = new Governor({ mode: "mock", spendFile: null });
    const r = await readPerson({ text: SAMPLE_PERSONA.text, name: "Juniper Vale" }, createClaudeReader({ client: stubClient(seen), governor: offline }));
    expect(r.method).toBe("mock");
    const capped = new Governor({ mode: "claude", caller: noCalls, spendFile: null, dailyCapUsd: 0.000001 });
    capped.record({ faculty: "speak", model: SONNET, input: 1000, cacheRead: 0, cacheWrite: 0, output: 1000 });
    const r2 = await readPerson({ text: SAMPLE_PERSONA.text, name: "Juniper Vale" }, createClaudeReader({ client: stubClient(seen), governor: capped }));
    expect(r2.method).toBe("mock");
    expect(seen.length).toBe(0);
  });
});
