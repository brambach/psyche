// Two more lenses for the analysis layer, built on the ledger and on the minds as they are now.
//
// Divergence: people who lived through the same event, side by side. Shared events share an
// episode id across minds, so the crossing, the storm, a story at the fire or a village meeting can
// be lined up account by account, with every change each memory has been through since.
//
// Says vs was: what a person could tell you about why they chose, against what the ledger says
// drove it. The first is what was in mind (the workspace). The second adds what worked out of
// sight: a core belief tilting the appraisal, trust colouring blame, a memory quietly rewritten by
// something heard, a feeling left over from earlier, a belief whose source has been forgotten.

import { why, type Ledger, type LedgerNode, type Mechanism, type WhyTree } from "./ledger.js";
import { render, renderOriginal } from "./memory.js";
import type { AgentId, Episode } from "./types.js";
import type { WorldState } from "./world/world.js";
import { schemaLineage } from "./world/life.js";

export interface Account {
  agent: AgentId;
  name: string;
  /** How they remember it now. */
  text: string;
  /** How it was first laid down. */
  original: string;
  valence: number;
  changes: { tick: number; from: string; to: string; cause: string; from_?: AgentId }[];
}

export interface DivergenceEntry {
  id: string;
  label: string;
  tick: number;
  accounts: Account[];
  /** 0 when everyone remembers it alike; higher when feelings or details disagree. */
  spread: number;
}

const accountOf = (world: WorldState, agent: AgentId, ep: Episode): Account => ({
  agent,
  name: world.minds[agent]!.name,
  text: render(ep),
  original: renderOriginal(ep),
  valence: Number(ep.valence.toFixed(2)),
  changes: ep.versions.flatMap((v) => v.changes.map((c) => ({ tick: v.tick, from: c.from, to: c.to, cause: c.cause, from_: c.source.from }))),
});

/** Every event two or more people remember, most disputed first. Conversations are left out unless a memory of one has changed. */
export function divergence(world: WorldState, limit = 30): DivergenceEntry[] {
  const byId = new Map<string, Account[]>();
  const ticks = new Map<string, number>();
  for (const id of world.order) {
    for (const ep of world.minds[id]!.episodes) {
      (byId.get(ep.id) ?? byId.set(ep.id, []).get(ep.id)!).push(accountOf(world, id, ep));
      ticks.set(ep.id, Math.min(ticks.get(ep.id) ?? Infinity, ep.tick));
    }
  }
  const labels = new Map(world.events.map((e) => [e.id, e.label]));
  const out: DivergenceEntry[] = [];
  for (const [id, accounts] of byId) {
    if (accounts.length < 2) continue;
    const changed = accounts.some((a) => a.changes.length);
    if (id.startsWith("talk_") && !changed) continue;
    const vs = accounts.map((a) => a.valence);
    const texts = new Set(accounts.map((a) => a.text));
    const spread = Number((Math.max(...vs) - Math.min(...vs) + (texts.size - 1) / accounts.length + (changed ? 0.3 : 0)).toFixed(2));
    out.push({ id, label: labels.get(id) ?? (id === "ep_crossing" ? "the crossing" : accounts[0]!.original), tick: ticks.get(id)!, accounts, spread });
  }
  return out.sort((a, b) => b.spread - a.spread).slice(0, limit);
}

export interface HiddenCause {
  node: LedgerNode;
  mechanism: Mechanism;
  share: number;
  /** One sentence on how it worked without being noticed. */
  note: string;
}

export interface SaysVsWas {
  decision: LedgerNode;
  /** What was in mind at the moment of choosing: what the person could report. */
  says: { node: LedgerNode; weight: number }[];
  /** What else drove it, out of sight. */
  was: HiddenCause[];
  /** What competed for attention and lost. */
  missed: LedgerNode[];
}

const HIDDEN: Partial<Record<Mechanism, (n: LedgerNode, whose: string) => string>> = {
  "core belief": (n) => `${n.label.replace(/^Core belief: /, "A core belief, “")}”, tilted how the moment felt before any thinking happened.`,
  "installed by": (n) => `That core belief goes back to a memory: “${n.label}”`,
  "deepened by": (n) => `Sleep deepened the core belief after: “${n.label}”`,
  "trust coloured blame": (n) => `${n.label} coloured the blame.`,
  "rewrote memory": (n) => `A memory that came to mind had been rewritten by something heard: “${n.label}”.`,
  "lingering feeling": (n) => `A feeling left over from earlier was still running: ${n.label}.`,
  "told by": (n) => `They hold a belief because they were told it, and may not recall who said so: “${n.label}”.`,
  expected: (n) => `What the village expects pressed on the choice: “${n.label.replace(/^Norm: /, "")}”.`,
  "passed on": (n) => `The story reached them through another head: \u201c${n.label.replace(/\.$/, "")}\u201d.`,
  "generalized from": (n) => `A belief they drew from one memory: “${n.label}”.`,
};

/** Set beside each other: the reasons in mind, and the causes the ledger finds behind the choice. */
export function saysVsWas(L: Ledger, decisionId: string): SaysVsWas | undefined {
  const tree = why(L, decisionId, { depth: 7, breadth: 5, floor: 0.005 });
  if (!tree) return undefined;
  const says = (L.into.get(decisionId) ?? [])
    .filter((e) => e.mechanism === "in mind" && !e.suppressed)
    .sort((a, b) => b.weight - a.weight)
    .map((e) => ({ node: L.nodes.get(e.from)!, weight: Number(e.weight.toFixed(2)) }));
  const was: HiddenCause[] = [];
  const seen = new Set<string>();
  const walk = (t: WhyTree) => {
    for (const c of t.causes) {
      const m = c.via?.mechanism;
      const note = m ? HIDDEN[m] : undefined;
      if (m && note && !seen.has(`${c.node.id}|${m}`)) {
        seen.add(`${c.node.id}|${m}`);
        was.push({ node: c.node, mechanism: m, share: Number(c.share.toFixed(3)), note: note(c.node, c.node.agent ?? "") });
      }
      walk(c);
    }
  };
  walk(tree);
  // A dozen people may have told them the same story; two examples of each kind of hidden cause is enough.
  const perKind = new Map<string, number>();
  const kept = was.sort((x, y) => y.share - x.share).filter((w) => {
    const n = (perKind.get(w.mechanism) ?? 0) + 1;
    perKind.set(w.mechanism, n);
    return n <= 2;
  });
  was.length = 0;
  was.push(...kept);
  // Feelings in the workspace that came from earlier moments are lingering, even if they made it into mind.
  for (const s of says) {
    if (s.node.kind === "emotion" && !s.node.id.endsWith(`@${decisionId.split("@").pop()}`) && !seen.has(`${s.node.id}|lingering feeling`)) {
      was.push({ node: s.node, mechanism: "lingering feeling", share: s.weight, note: HIDDEN["lingering feeling"]!(s.node, "") });
    }
  }
  was.sort((a, b) => b.share - a.share);
  return { decision: tree.node, says, was, missed: tree.missed ?? [] };
}

export interface AtlasHolder {
  agent: AgentId;
  /** The core belief's id in this person's mind. */
  schema: string;
  name: string;
  generation: number;
  alive: boolean;
  strength: number;
  /** How the belief reached them: each step a memory, the last the first-hand one. */
  chain: { agent: AgentId; name: string; gist: string; firstHand: boolean }[];
  inherited: boolean;
}

export interface AtlasEntry {
  text: string;
  holders: AtlasHolder[];
  /** Living holders per generation. */
  byGeneration: Record<number, number>;
  /** The first-hand memories the belief traces back to, with who lived them. */
  roots: { agent: AgentId; name: string; gist: string; alive: boolean; holders: number }[];
}

/** Fears across generations: every core belief in the village, who holds it, and where it began. */
export function atlas(world: WorldState): AtlasEntry[] {
  const life = world.village?.life ?? {};
  const living = new Set(world.order);
  const by = new Map<string, AtlasEntry>();
  for (const [id, m] of Object.entries(world.minds)) {
    for (const s of m.schemas) {
      if (s.strength < 0.05) continue;
      const e = by.get(s.text) ?? { text: s.text, holders: [], byGeneration: {}, roots: [] };
      by.set(s.text, e);
      const chain = schemaLineage(world, id, s).map((c) => ({ agent: c.agent, name: world.minds[c.agent]?.name ?? c.agent, gist: c.gist, firstHand: c.firstHand }));
      const generation = life[id]?.generation ?? 0;
      const alive = living.has(id);
      e.holders.push({ agent: id, schema: s.id, name: m.name, generation, alive, strength: s.strength, chain, inherited: chain.length > 1 });
      if (alive) e.byGeneration[generation] = (e.byGeneration[generation] ?? 0) + 1;
      const root = chain.at(-1);
      if (root?.firstHand) {
        const r = e.roots.find((x) => x.agent === root.agent && x.gist === root.gist);
        if (r) r.holders++;
        else e.roots.push({ agent: root.agent, name: root.name, gist: root.gist, alive: living.has(root.agent), holders: 1 });
      }
    }
  }
  const score = (e: AtlasEntry) => e.holders.filter((h) => h.alive && h.inherited).length;
  return [...by.values()].map((e) => ({ ...e, holders: e.holders.sort((a, b) => a.generation - b.generation || b.strength - a.strength) })).sort((a, b) => score(b) - score(a) || b.holders.length - a.holders.length);
}
