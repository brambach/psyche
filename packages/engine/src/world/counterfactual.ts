// What if not? Take one thing out of one mind (a memory, a belief, a core belief), run the world on
// from the same moment twice, once as it is and once without it, and set the two side by side.
// Both runs use the same faculties (the offline mock, normally) and the same random state, so every
// difference traces back to the one thing removed.

import type { Faculties } from "../ports.js";
import type { AgentId, Tick } from "../types.js";
import { WorldSession } from "./session.js";
import type { WorldState, WorldTrace } from "./world.js";

export interface CounterfactualEdit {
  agent: AgentId;
  kind: "episode" | "belief" | "schema";
  id: string;
}

export interface ChoiceDiff {
  agent: AgentId;
  tick: Tick;
  question: string;
  actual: string;
  without: string;
}

export interface Counterfactual {
  edit: CounterfactualEdit;
  label: string;
  days: number;
  /** Choices made differently, the edited person's first. */
  choices: ChoiceDiff[];
  /** Choices the edited person made in both runs, for scale. */
  compared: number;
  /** The edited person's choices that moved most, flipped or not: how far the chosen option led the next best. */
  margins: { tick: Tick; question: string; actual: string; without: string; actualMargin: number; withoutMargin: number }[];
  /** Feelings toward others that ended up different (liking), largest first. */
  liking: { from: AgentId; to: AgentId; actual: number; without: number }[];
  mood: { actual: number; without: number };
  /** Whether the removed item came back on its own (a belief re-formed, a fear re-installed). */
  returned: boolean;
  /** How many other people chose differently at least once. */
  ripple: AgentId[];
}

function remove(world: WorldState, e: CounterfactualEdit): string | undefined {
  const m = world.minds[e.agent];
  if (!m) return undefined;
  const list = e.kind === "episode" ? m.episodes : e.kind === "belief" ? m.beliefs : m.schemas;
  const i = list.findIndex((x) => x.id === e.id);
  if (i < 0) return undefined;
  const [gone] = list.splice(i, 1) as { gist?: string; proposition?: string; text?: string }[];
  return gone!.gist ?? gone!.proposition ?? gone!.text;
}

function present(world: WorldState, e: CounterfactualEdit, label: string): boolean {
  const m = world.minds[e.agent]!;
  if (e.kind === "schema") return m.schemas.some((s) => s.text === label);
  if (e.kind === "belief") return m.beliefs.some((b) => b.proposition === label);
  return m.episodes.some((x) => x.id === e.id);
}

const choicesOf = (traces: WorldTrace[]) =>
  new Map(
    traces
      .filter((t) => t.trace.decision && t.trace.decision.options.length > 1)
      .map((t) => {
        const d = t.trace.decision!;
        const label = d.options.find((o) => o.id === d.choice)?.label ?? d.choice;
        const chosen = d.options.find((o) => o.id === d.choice)?.utility ?? 0;
        const margin = chosen - Math.max(...d.options.filter((o) => o.id !== d.choice).map((o) => o.utility));
        return [`${t.agent}|${t.trace.tick}|${t.trace.headline.question}`, { agent: t.agent, tick: t.trace.tick, question: t.trace.headline.question, label, margin }];
      }),
  );

export async function counterfactual(world: WorldState, faculties: Faculties, edit: CounterfactualEdit, days = 4, step = 60): Promise<Counterfactual | undefined> {
  const without = structuredClone(world);
  const label = remove(without, edit);
  if (label === undefined) return undefined;
  const opts = { keepRecent: 1, keepDays: 0 };
  const a = new WorldSession(world, faculties, opts);
  const b = new WorldSession(without, faculties, opts);
  for (let t = 0; t < (days * 1440) / step; t++) {
    await a.apply({ type: "advance", minutes: step });
    await b.apply({ type: "advance", minutes: step });
  }
  const A = choicesOf(a.traces);
  const B = choicesOf(b.traces);
  const choices: ChoiceDiff[] = [];
  let compared = 0;
  const margins: Counterfactual["margins"] = [];
  for (const [k, x] of A) {
    const y = B.get(k);
    if (!y) continue;
    if (x.agent === edit.agent) {
      compared++;
      // Signed so that positive means the run's own choice led; compare against the actual choice.
      const withoutMargin = x.label === y.label ? y.margin : -y.margin;
      if (Math.abs(withoutMargin - x.margin) > 0.005) margins.push({ tick: x.tick, question: x.question, actual: x.label, without: y.label, actualMargin: x.margin, withoutMargin });
    }
    if (x.label !== y.label) choices.push({ agent: x.agent, tick: x.tick, question: x.question, actual: x.label, without: y.label });
  }
  choices.sort((x, y) => Number(y.agent === edit.agent) - Number(x.agent === edit.agent) || x.tick - y.tick);
  const liking: Counterfactual["liking"] = [];
  for (const id of a.world.order) {
    const ma = a.world.minds[id]!;
    const mb = b.world.minds[id];
    if (!mb) continue;
    for (const [o, r] of Object.entries(ma.others)) {
      const w = mb.others[o]?.liking;
      if (w !== undefined && Math.abs(w - r.liking) >= 0.03) liking.push({ from: id, to: o, actual: r.liking, without: w });
    }
  }
  liking.sort((x, y) => Math.abs(y.without - y.actual) - Math.abs(x.without - x.actual));
  return {
    edit,
    label,
    days,
    choices,
    compared,
    margins: margins.sort((p, q) => Math.abs(q.withoutMargin - q.actualMargin) - Math.abs(p.withoutMargin - p.actualMargin)).slice(0, 8),
    liking: liking.slice(0, 12),
    mood: { actual: a.world.minds[edit.agent]!.affect.mood.valence, without: b.world.minds[edit.agent]?.affect.mood.valence ?? 0 },
    returned: present(b.world, edit, label),
    ripple: [...new Set(choices.map((c) => c.agent).filter((x) => x !== edit.agent))],
  };
}
