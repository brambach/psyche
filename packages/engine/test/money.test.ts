import { beforeAll, describe, expect, it } from "vitest";
import { acceptedShare, aggMoney, applyEdit, buildLedger, createVillage, moneyOf, WorldSession, type Money } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const sink = () => ({ traces: [], feed: [] as { title: string; chronicle?: { kind: string } }[] });

async function run(hard: boolean, days: number) {
  const w = createVillage(11);
  w.keyedLuck = true;
  if (hard) {
    applyEdit(w, { who: "*", edit: { kind: "trait", trait: "agreeableness", value: 0.05, lock: true } }, sink() as never);
    applyEdit(w, { who: "*", edit: { kind: "fear", text: "People only help when it suits them", triggers: ["help", "trust", "food", "debt"], threat: 0.1, blame: 0.4, strength: 0.9 } }, sink() as never);
  }
  const s = new WorldSession(w, createMockFaculties());
  for (let i = 0; i < 12 * days; i++) await s.apply({ type: "advance", minutes: 120 });
  return s;
}

let warm: WorldSession;
let hard: WorldSession;
beforeAll(async () => {
  [warm, hard] = await Promise.all([run(false, 40), run(true, 40)]);
}, 180_000);
const M = (s: WorldSession): Money => s.world.village!.money!;

describe("money and debt", () => {
  it("households that run short ask the neighbours, who answer through their own minds", () => {
    const d = M(warm).deals;
    expect(d.give + d.lend + d.sell + d.refuse).toBeGreaterThan(10);
    const asks = warm.traces.filter((t) => t.trace.decision?.options.some((o) => o.id === "lend"));
    expect(asks.length).toBe(d.give + d.lend + d.sell + d.refuse);
    expect(warm.feed.some((f) => /^Short at supper/.test(f.title))).toBe(true);
  });

  it("a warm town feeds and lends; a hard, suspicious one turns people away or asks for amber", () => {
    const w = M(warm).deals;
    const h = M(hard).deals;
    expect(w.give + w.lend).toBeGreaterThan(h.give + h.lend);
    expect(h.refuse).toBeGreaterThan(w.refuse);
    expect(h.sell).toBeGreaterThan(w.sell);
    // And it is the hard town where amber starts to look like money.
    expect(acceptedShare(hard.world)).toBeGreaterThan(acceptedShare(warm.world));
  });

  it("loans are remembered: some are paid back, and the unpaid ones become a grievance", () => {
    const debts = M(warm).debts;
    expect(debts.length).toBeGreaterThan(3);
    const late = debts.filter((d) => d.overdue);
    expect(late.length + debts.filter((d) => d.repaid).length).toBeGreaterThan(0);
    // The lender's own mind recorded the unpaid debt, and the ledger can trace it.
    if (late.length) {
      const d = late[0]!;
      const felt = warm.traces.filter((t) => t.agent === d.creditor && /never paid back/.test(t.trace.percept?.gist ?? ""));
      expect(felt.length).toBeGreaterThan(0);
      expect(felt[0]!.trace.appraisal).toBeDefined();
    }
    const L = buildLedger({ minds: warm.world.minds, traces: warm.traces } as never);
    const lendDecisions = [...L.nodes.values()].filter((n) => n.kind === "decision" && /chose: Lend it/.test(n.label));
    expect(lendDecisions.length).toBeGreaterThan(0);
  });

  it("amber that most adults take becomes money, and the chronicle keeps the day", () => {
    const w = createVillage(11);
    const m = moneyOf(w);
    for (const id of w.order) m.accept[id] = 0.45;
    const sk = sink();
    // Unwatched, a town that doesn't trust itself drifts toward payment in hand.
    for (const a of w.order) for (const o of w.order) if (w.minds[a]!.others[o]) w.minds[a]!.others[o]!.trust.benevolence = 0.15;
    for (let i = 0; i < 12 && !m.established; i++) {
      w.tick += 4 * 1440;
      aggMoney(w, sk as never);
    }
    expect(m.established).toBeDefined();
    expect(acceptedShare(w)).toBeGreaterThanOrEqual(0.6);
    expect(sk.feed.some((f) => f.chronicle?.kind === "money" && /becomes money/.test(f.title))).toBe(true);
  });
});
