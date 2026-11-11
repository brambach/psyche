import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { buildBrief, CausalHistory, createWorld, WorldSession, type Brief } from "@psyche/engine";
import { costOf, createClaudeHistorian, createMockFaculties, Governor, historianEstimate, OPUS, SONNET, type CallUsage, type FacultyCaller } from "@psyche/faculties";

const mock = createMockFaculties();
const noCalls = (_: (u: CallUsage) => void): FacultyCaller => ((f: string, r: unknown) => (mock as unknown as Record<string, (r: unknown) => unknown>)[f]!(r)) as FacultyCaller;

/** Two days on the island, read into a history, and a brief about its last real choice. */
async function aBrief(): Promise<Brief> {
  const s = new WorldSession(createWorld(7), mock);
  for (let h = 0; h < 48; h++) {
    if (h === 30) await s.apply({ type: "inject", event: { kind: "storm" } });
    await s.apply({ type: "advance", minutes: 60 });
  }
  const H = new CausalHistory();
  H.absorb({ world: s.world, traces: s.traces });
  expect(H.moments.length).toBeGreaterThan(0);
  return buildBrief(H, "Why did they do this?", { focus: [H.moments.at(-1)!.id] });
}

const usage = { input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };

function stubClient(seen: unknown[], reply: (b: Brief) => unknown, brief: Brief): Anthropic {
  return {
    beta: {
      messages: {
        create: async (req: unknown) => {
          seen.push(req);
          return reply(brief);
        },
      },
    },
  } as unknown as Anthropic;
}

describe("the Historian on Claude", () => {
  it("makes one Opus call with the brief, meters it, and keeps only citations that are in the brief", async () => {
    const brief = await aBrief();
    const seen: unknown[] = [];
    const g = new Governor({ mode: "claude", caller: noCalls, spendFile: null });
    const tag = brief.nodes[0]!.ref;
    const client = stubClient(seen, () => ({ stop_reason: "end_turn", model: OPUS, content: [{ type: "text", text: JSON.stringify({ answer: `It came from here [${tag}], and from nowhere [n99999].`, cites: [tag, "n99999"], gaps: null }) }], usage }), brief);
    const r = await createClaudeHistorian({ client, governor: g })(brief);

    expect(seen.length).toBe(1);
    const req = seen[0] as { model: string; system: { text: string; cache_control?: unknown }[]; messages: { content: string }[]; output_config: { format: unknown } };
    expect(req.model).toBe(OPUS);
    expect(req.messages[0]!.content).toBe(brief.text);
    expect(req.system[0]!.cache_control).toBeTruthy();
    expect(req.output_config.format).toBeTruthy();

    expect(r.method).toBe("claude");
    expect(r.cites).toEqual([tag]);
    expect(r.gaps).toBeUndefined();
    expect(r.estimated).toBe(false);
    expect(r.usd).toBeCloseTo(costOf(OPUS, { input: 3000, cacheRead: 500, cacheWrite: 0, output: 600 }), 10);
    const snap = g.snapshot();
    expect(snap.sessionUsd).toBeCloseTo(r.usd!, 10);
    expect((snap.byFaculty as Record<string, unknown>).historian).toBeTruthy();
  });

  it("reads offline for free on the mock or once the day's cap is spent, and says what Opus would have cost", async () => {
    const brief = await aBrief();
    const seen: unknown[] = [];
    const client = stubClient(seen, () => ({}), brief);
    const r = await createClaudeHistorian({ client, governor: new Governor({ mode: "mock", spendFile: null }) })(brief);
    expect(r.method).toBe("offline");
    expect(r.estimated).toBe(true);
    expect(r.usd).toBeCloseTo(historianEstimate(brief), 10);
    expect(r.usd!).toBeGreaterThan(0);
    expect(r.usd!).toBeLessThan(0.5);
    expect(r.cites.length).toBeGreaterThan(0);

    const capped = new Governor({ mode: "claude", caller: noCalls, spendFile: null, dailyCapUsd: 0.000001 });
    capped.record({ faculty: "speak", model: SONNET, input: 1000, cacheRead: 0, cacheWrite: 0, output: 1000 });
    expect((await createClaudeHistorian({ client, governor: capped })(brief)).method).toBe("offline");
    expect(seen.length).toBe(0);
  });

  it("falls back to the offline reading when Claude declines, and still meters the call", async () => {
    const brief = await aBrief();
    const seen: unknown[] = [];
    const g = new Governor({ mode: "claude", caller: noCalls, spendFile: null });
    const r = await createClaudeHistorian({ client: stubClient(seen, () => ({ stop_reason: "refusal", content: [], usage }), brief), governor: g })(brief);
    expect(seen.length).toBe(1);
    expect(r.method).toBe("offline");
    expect(r.gaps).toMatch(/declined/);
    expect(g.snapshot().sessionUsd).toBeGreaterThan(0);
  });
});
