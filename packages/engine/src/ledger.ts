// The causal ledger: one graph of what caused what, across time and across minds.
//
// The engine already records each link of "this came from that" somewhere: a percept's event, the
// episode it was encoded as, the beliefs and trust it moved, the workspace items that drove a
// decision, the teller a story came from, the belief that rewrote a memory, the formative episode
// behind a core belief. The ledger joins those pieces into nodes and weighted edges so you can walk
// backwards from any decision or fear to where it started, and forwards to what it has bent since.
//
// Nothing here causes behaviour. It is built from traces and state after the fact, like explain.ts.

import type { Rumor, WorldEventRecord, WorldTrace } from "./world/world.js";
import type { VillageState } from "./world/village.js";
import type { Trace, WorkspaceEntry } from "./trace.js";
import { EMOTION_NAMES, NEGATIVE_EMOTIONS, type AgentId, type EmotionName, type MindState, type Tick } from "./types.js";

export type NodeKind =
  | "event"
  | "conversation"
  | "percept"
  | "episode"
  | "belief"
  | "schema"
  | "emotion"
  | "relation"
  | "goal"
  | "need"
  | "decision"
  | "utterance"
  | "act"
  | "sleep"
  | "outside"
  | "norm";

export interface LedgerNode {
  id: string;
  kind: NodeKind;
  /** Whose mind it lives in; absent for world events. */
  agent?: AgentId;
  tick: Tick;
  label: string;
  /** The trace that recorded it, for opening the brain scan at that moment. */
  trace?: string;
}

export type Mechanism =
  | "perceived"
  | "heard"
  | "appraised as"
  | "core belief"
  | "trust coloured blame"
  | "moved trust"
  | "formed belief"
  | "heard again"
  | "in mind"
  | "below awareness"
  | "lingering feeling"
  | "said"
  | "did"
  | "generalized from"
  | "told by"
  | "passed on"
  | "rewrote memory"
  | "installed by"
  | "deepened by"
  | "sanctioned"
  | "expected";

export interface LedgerEdge {
  from: string;
  to: string;
  mechanism: Mechanism;
  /** How much of the effect this cause accounts for, 0 to 1 (approximate; see why()). */
  weight: number;
  tick: Tick;
  /** True for items that competed for attention and lost: they did not drive anything. */
  suppressed?: boolean;
}

export interface Ledger {
  nodes: Map<string, LedgerNode>;
  edges: LedgerEdge[];
  into: Map<string, LedgerEdge[]>;
  out: Map<string, LedgerEdge[]>;
}

export interface LedgerInput {
  minds: Record<AgentId, MindState>;
  traces: WorldTrace[];
  rumors?: Record<string, Rumor>;
  events?: WorldEventRecord[];
  /** A village's norms and pledges, when there is one. */
  village?: VillageState;
}

/** Emotions weaker than this are not given their own node. */
const EMOTION_FLOOR = 0.15;
/** How long a feeling in the workspace is traced back to the moment that stirred it, in minutes. */
const LINGER = 12 * 60;

export const nodeId = {
  world: (id: string) => `world/${id}`,
  item: (agent: AgentId, id: string) => `${agent}/${id}`,
  emotion: (agent: AgentId, k: EmotionName, trace: string) => `${agent}/emo:${k}@${trace}`,
  decision: (agent: AgentId, trace: string) => `${agent}/dec@${trace}`,
  said: (agent: AgentId, trace: string) => `${agent}/said@${trace}`,
  relation: (agent: AgentId, other: string) => `${agent}/rel:${other}`,
};

export function buildLedger(input: LedgerInput): Ledger {
  const { minds } = input;
  const L: Ledger = { nodes: new Map(), edges: [], into: new Map(), out: new Map() };
  const nameOf = (id: string) => minds[id]?.name ?? (id === "visitor" ? "you" : id === "world" ? "the world" : id);
  const events = new Map((input.events ?? []).map((e) => [e.id, e]));

  const node = (n: LedgerNode): string => {
    if (!L.nodes.has(n.id)) L.nodes.set(n.id, n);
    return n.id;
  };
  const edge = (e: LedgerEdge) => {
    if (e.from === e.to || !L.nodes.has(e.from) || !L.nodes.has(e.to)) return;
    L.edges.push(e);
    (L.into.get(e.to) ?? L.into.set(e.to, []).get(e.to)!).push(e);
    (L.out.get(e.from) ?? L.out.set(e.from, []).get(e.from)!).push(e);
  };

  const episodeNode = (a: AgentId, id: string): string | undefined => {
    const ep = minds[a]?.episodes.find((e) => e.id === id);
    return ep ? node({ id: nodeId.item(a, id), kind: "episode", agent: a, tick: ep.tick, label: ep.gist }) : undefined;
  };
  const beliefNode = (a: AgentId, id: string): string | undefined => {
    const b = minds[a]?.beliefs.find((x) => x.id === id);
    return b ? node({ id: nodeId.item(a, id), kind: "belief", agent: a, tick: b.formed, label: b.proposition }) : undefined;
  };
  const schemaNode = (a: AgentId, id: string): string | undefined => {
    const s = minds[a]?.schemas.find((x) => x.id === id);
    return s ? node({ id: nodeId.item(a, id), kind: "schema", agent: a, tick: s.origin ? Math.min(...s.origin.map((o) => minds[a]!.episodes.find((e) => e.id === o)?.tick ?? 0)) : -Infinity, label: `Core belief: ${s.text}` }) : undefined;
  };
  const relationNode = (a: AgentId, other: string) =>
    node({ id: nodeId.relation(a, other), kind: "relation", agent: a, tick: -Infinity, label: `${nameOf(a)}'s trust in ${nameOf(other)}` });

  // The latest emotion node per agent and emotion, so a feeling that lingers is traced to what stirred it.
  const lastEmotion = new Map<string, { id: string; tick: Tick }>();
  // Percepts that were encoded as episodes, to the episode's node.
  const alias = new Map<string, string>();
  // The latest thing each agent said to each listener, so the listener's percept links to it.
  const lastSaid = new Map<string, { id: string; tick: Tick }>();

  const sourceOf = (a: AgentId, t: Trace, w: WorkspaceEntry): string | undefined => {
    switch (w.kind) {
      case "percept": {
        const id = alias.get(nodeId.item(a, w.ref)) ?? nodeId.item(a, w.ref);
        return L.nodes.has(id) ? id : undefined;
      }
      case "memory":
        return episodeNode(a, w.ref);
      case "belief":
        return beliefNode(a, w.ref);
      case "goal": {
        const g = minds[a]?.goals.find((x) => x.id === w.ref);
        return g ? node({ id: nodeId.item(a, g.id), kind: "goal", agent: a, tick: -Infinity, label: `Goal: ${g.text}` }) : undefined;
      }
      case "need":
        return node({ id: nodeId.item(a, w.ref), kind: "need", agent: a, tick: -Infinity, label: w.label });
      case "feeling": {
        const k = w.ref.slice("feeling:".length) as EmotionName;
        const now = L.nodes.get(nodeId.emotion(a, k, t.id));
        if (now) return now.id;
        const last = lastEmotion.get(`${a}:${k}`);
        if (last && t.tick - last.tick <= LINGER) return last.id;
        return undefined;
      }
    }
  };

  for (const { agent: a, trace: t } of input.traces) {
    if (t.kind === "sleep") {
      node({ id: nodeId.item(a, t.id), kind: "sleep", agent: a, tick: t.tick, label: t.headline.answer, trace: t.id });
      continue;
    }
    const p = t.percept;
    if (t.kind !== "perceive" || !p) continue;

    // A moment and the memory it was encoded as are one node: the episode, stamped with its trace.
    const encoded = t.encoded ? episodeNode(a, t.encoded) : undefined;
    const P = encoded ?? node({ id: nodeId.item(a, p.id), kind: "percept", agent: a, tick: p.tick, label: p.gist, trace: t.id });
    if (encoded) {
      L.nodes.get(encoded)!.trace = t.id;
      alias.set(nodeId.item(a, p.id), encoded);
    }
    if (p.eventId) {
      const ev = events.get(p.eventId);
      const E = node({
        id: nodeId.world(p.eventId),
        kind: ev ? "event" : "conversation",
        tick: ev?.tick ?? p.tick,
        label: ev?.label ?? `${nameOf(p.actor)} and ${nameOf(a)} talk`,
      });
      edge({ from: E, to: P, mechanism: "perceived", weight: 1, tick: p.tick });
    }
    if (p.kind === "speech") {
      const said = lastSaid.get(`${p.actor}>${a}`);
      if (said && p.tick - said.tick <= 30) edge({ from: said.id, to: P, mechanism: "heard", weight: 1, tick: p.tick });
      else if (minds[p.actor] || p.actor === "visitor") {
        const U = node({ id: nodeId.item(p.actor, `line>${a}@${t.id}`), kind: p.actor === "visitor" ? "outside" : "utterance", agent: minds[p.actor] ? p.actor : undefined, tick: p.tick, label: p.rawText });
        edge({ from: U, to: P, mechanism: "heard", weight: 1, tick: p.tick });
      }
    }
    for (const c of t.changes ?? []) {
      if (!c.ref) continue;
      if (c.ref.startsWith("other:")) edge({ from: P, to: relationNode(a, c.ref.slice(6)), mechanism: "moved trust", weight: Math.min(1, Math.abs(c.value) * 5), tick: p.tick });
      else {
        const b = beliefNode(a, c.ref);
        if (b) edge({ from: P, to: b, mechanism: c.name.startsWith("heard again") ? "heard again" : "formed belief", weight: Math.min(1, Math.abs(c.value)), tick: p.tick });
      }
    }

    // Core beliefs and trust that tilted how the moment was read, whatever feelings came of it.
    for (const adj of t.appraisal?.adjustments ?? []) {
      if (!adj.ref || Math.abs(adj.value) < 0.01) continue;
      if (adj.ref.startsWith("other:")) edge({ from: relationNode(a, adj.ref.slice(6)), to: P, mechanism: "trust coloured blame", weight: Math.min(1, Math.abs(adj.value) * 3), tick: p.tick });
      else {
        const s = schemaNode(a, adj.ref);
        if (s) edge({ from: s, to: P, mechanism: "core belief", weight: Math.min(1, Math.abs(adj.value) * 3), tick: p.tick });
      }
    }

    // Feelings this moment stirred, and what coloured them.
    for (const [k, v] of Object.entries(t.appraisal?.emotions ?? {}) as [EmotionName, number][]) {
      if (v < EMOTION_FLOOR) continue;
      const Em = node({ id: nodeId.emotion(a, k, t.id), kind: "emotion", agent: a, tick: p.tick, label: `${nameOf(a)} felt ${k}`, trace: t.id });
      lastEmotion.set(`${a}:${k}`, { id: Em, tick: p.tick });
      edge({ from: P, to: Em, mechanism: "appraised as", weight: v, tick: p.tick });
      if (!NEGATIVE_EMOTIONS.has(k)) continue;
      for (const adj of t.appraisal!.adjustments) {
        if (!adj.ref) continue;
        if (adj.ref.startsWith("other:")) edge({ from: relationNode(a, adj.ref.slice(6)), to: Em, mechanism: "trust coloured blame", weight: Math.min(1, Math.abs(adj.value) * 3), tick: p.tick });
        else {
          const s = schemaNode(a, adj.ref);
          if (s) edge({ from: s, to: Em, mechanism: "core belief", weight: Math.min(1, Math.abs(adj.value) * 3), tick: p.tick });
        }
      }
    }

    // The decision, and what was in mind when it was made.
    if (t.decision) {
      const opt = t.decision.options.find((o) => o.id === t.decision!.choice);
      const D = node({ id: nodeId.decision(a, t.id), kind: "decision", agent: a, tick: p.tick, label: `${nameOf(a)} chose: ${opt?.label ?? t.decision.choice}`, trace: t.id });
      const because = new Map(t.decision.because.map((b) => [b.ref, b.weight]));
      for (const w of t.workspace) {
        const src = sourceOf(a, t, w);
        if (!src) continue;
        const weight = w.kind === "percept" ? Math.max(0.3, because.get(w.ref) ?? 0) : (because.get(w.ref) ?? 0.05);
        edge({ from: src, to: D, mechanism: "in mind", weight, tick: p.tick });
      }
      for (const w of t.subliminal) {
        const src = sourceOf(a, t, w);
        if (src) edge({ from: src, to: D, mechanism: "below awareness", weight: 0, tick: p.tick, suppressed: true });
      }
      if (t.action?.kind === "speech") {
        const U = node({ id: nodeId.said(a, t.id), kind: "utterance", agent: a, tick: p.tick, label: `${nameOf(a)}: "${t.action.text}"`, trace: t.id });
        edge({ from: D, to: U, mechanism: "said", weight: 1, tick: p.tick });
        lastSaid.set(`${a}>${p.actor}`, { id: U, tick: p.tick });
      } else if (t.action?.kind === "act") {
        const U = node({ id: nodeId.item(a, `did@${t.id}`), kind: "act", agent: a, tick: p.tick, label: t.action.text, trace: t.id });
        edge({ from: D, to: U, mechanism: "did", weight: 1, tick: p.tick });
      }
    }

    for (const r of t.reconsolidations) {
      for (const c of r.version.changes) {
        const ep = episodeNode(a, r.episodeId);
        const ref = c.source.ref ? beliefNode(a, c.source.ref) : undefined;
        if (ep && ref) edge({ from: ref, to: ep, mechanism: "rewrote memory", weight: 0.8, tick: r.version.tick });
      }
    }
  }

  // State that holds its own provenance: beliefs, rewritten memories, core beliefs.
  for (const [a, mind] of Object.entries(minds)) {
    for (const b of mind.beliefs) {
      const B = beliefNode(a, b.id)!;
      for (const ev of b.evidence) {
        const ep = episodeNode(a, ev);
        if (ep) edge({ from: ep, to: B, mechanism: b.source.kind === "told" ? "told by" : "generalized from", weight: b.source.kind === "told" ? 0.8 : 0.6, tick: b.formed });
      }
      if (b.rumor && b.source.from) {
        // Where the teller got it: their own belief in the same story, or the memory it started from.
        const from = b.source.from;
        const rumor = input.rumors?.[b.rumor];
        let src: string | undefined;
        if (minds[from]) {
          const theirs = minds[from]!.beliefs.find((x) => x.rumor === b.rumor);
          if (theirs) src = beliefNode(from, theirs.id);
          else if (rumor?.origin === from) src = episodeNode(from, b.rumor.slice(`rum_${from}_`.length)) ?? beliefNode(from, b.rumor.slice(`rum_${from}_`.length));
        } else {
          src = node({ id: nodeId.world(`teller:${from}:${b.rumor}`), kind: "outside", tick: b.formed, label: from === "visitor" ? "A stranger off the ferry told the story" : `${nameOf(from)} told the story` });
        }
        if (src) edge({ from: src, to: B, mechanism: "passed on", weight: 0.7, tick: b.formed });
      }
    }
    for (const ep of mind.episodes) {
      // A story heard keeps a pointer to the teller's own memory of it, across minds and generations.
      if (ep.source.kind === "told" && ep.source.from && ep.source.ref) {
        const src = episodeNode(ep.source.from, ep.source.ref);
        const E = episodeNode(a, ep.id);
        if (src && E) edge({ from: src, to: E, mechanism: "told by", weight: 0.7, tick: ep.tick });
      }
      for (const v of ep.versions) {
        for (const c of v.changes) {
          if (c.source.ref) {
            const src = beliefNode(a, c.source.ref);
            const E = episodeNode(a, ep.id);
            if (src && E) edge({ from: src, to: E, mechanism: "rewrote memory", weight: 0.8, tick: v.tick });
          }
        }
      }
    }
    for (const s of mind.schemas) {
      const S = schemaNode(a, s.id)!;
      for (const o of s.origin ?? []) {
        const ep = episodeNode(a, o);
        if (ep) edge({ from: ep, to: S, mechanism: "installed by", weight: 1, tick: L.nodes.get(ep)!.tick });
      }
      for (const d of s.deepenedBy ?? []) {
        const ep = episodeNode(a, d.episode);
        if (ep) edge({ from: ep, to: S, mechanism: "deepened by", weight: 0.5, tick: d.tick });
      }
    }
  }

  // Norms: built from the violations people saw and held against others; felt at later pledges.
  for (const n of input.village?.norms ?? []) {
    if (!n.established) continue;
    const N = node({ id: nodeId.world(n.id), kind: "norm", tick: n.established, label: `Norm: ${n.text}` });
    for (const c of n.cases) {
      const ep = episodeNode(c.agent, c.episode);
      if (ep) edge({ from: ep, to: N, mechanism: "sanctioned", weight: 0.15, tick: n.established });
    }
    for (const round of input.village!.pledges.filter((r) => r.tick >= n.established!)) {
      for (const ans of round.answers) {
        const held = minds[ans.agent]?.beliefs.find((b) => b.about === "village" && b.proposition === n.text)?.confidence ?? 0;
        const D = nodeId.decision(ans.agent, ans.trace);
        if (held > 0.1 && L.nodes.has(D)) edge({ from: N, to: D, mechanism: "expected", weight: Math.min(1, held * 0.6), tick: round.tick });
      }
    }
  }

  // Duplicate edges (the same link seen from a trace and from state) collapse to the strongest.
  const seen = new Map<string, LedgerEdge>();
  for (const e of L.edges) {
    const k = `${e.from}|${e.to}|${e.mechanism}`;
    const prev = seen.get(k);
    if (!prev || e.weight > prev.weight) seen.set(k, e);
  }
  L.edges = [...seen.values()];
  L.into = new Map();
  L.out = new Map();
  for (const e of L.edges) {
    (L.into.get(e.to) ?? L.into.set(e.to, []).get(e.to)!).push(e);
    (L.out.get(e.from) ?? L.out.set(e.from, []).get(e.from)!).push(e);
  }
  return L;
}

// ---------------------------------------------------------------- queries

export interface WhyTree {
  node: LedgerNode;
  /** The edge from this node to its parent in the tree (absent at the root). */
  via?: LedgerEdge;
  /** Product of edge weights from the root to here: how much this cause accounts for, roughly. */
  share: number;
  /** Already shown elsewhere in the tree; its causes are not repeated. */
  repeat?: boolean;
  causes: WhyTree[];
  /** What competed for attention at this decision and lost. */
  missed?: LedgerNode[];
}

/**
 * Walk backwards from a node: its strongest causes, their causes, and so on. Weights multiply along
 * a path, so the share at each node is a rough answer to "how much of this came from there".
 * Counterfactual replay (planned) gives the exact answer; this is the fast approximation.
 */
export function why(L: Ledger, id: string, opts: { depth?: number; breadth?: number; floor?: number } = {}): WhyTree | undefined {
  const { depth = 6, breadth = 4, floor = 0.02 } = opts;
  const root = L.nodes.get(id);
  if (!root) return undefined;
  const shown = new Set<string>([id]);
  const grow = (n: LedgerNode, share: number, d: number): WhyTree["causes"] => {
    if (d >= depth) return [];
    const incoming = (L.into.get(n.id) ?? []).filter((e) => !e.suppressed && e.weight > 0).sort((x, y) => y.weight - x.weight).slice(0, breadth);
    const out: WhyTree[] = [];
    for (const e of incoming) {
      const s = share * e.weight;
      if (s < floor) continue;
      const src = L.nodes.get(e.from)!;
      if (shown.has(src.id)) {
        out.push({ node: src, via: e, share: s, repeat: true, causes: [] });
        continue;
      }
      shown.add(src.id);
      out.push({ node: src, via: e, share: s, causes: grow(src, s, d + 1), missed: missedAt(L, src.id) });
    }
    return out;
  };
  return { node: root, share: 1, causes: grow(root, 1, 0), missed: missedAt(L, id) };
}

function missedAt(L: Ledger, id: string): LedgerNode[] | undefined {
  const m = (L.into.get(id) ?? []).filter((e) => e.suppressed).map((e) => L.nodes.get(e.from)!);
  return m.length ? m : undefined;
}

export interface Genealogy {
  node: LedgerNode;
  /** Every ancestor, oldest first, with how many steps back it is. */
  ancestors: { node: LedgerNode; steps: number }[];
  /** Ancestors with no causes of their own: where it all started (backstory, world events, outsiders). */
  roots: LedgerNode[];
  /** Ancestors in other people's heads. */
  minds: AgentId[];
}

/** Everything upstream of a node, however weak: the full family tree of a belief or fear. */
export function genealogy(L: Ledger, id: string, maxSteps = 12): Genealogy | undefined {
  const root = L.nodes.get(id);
  if (!root) return undefined;
  const steps = new Map<string, number>();
  let frontier = [id];
  for (let s = 1; s <= maxSteps && frontier.length; s++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const e of L.into.get(n) ?? []) {
        if (e.suppressed || steps.has(e.from) || e.from === id) continue;
        steps.set(e.from, s);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  const ancestors = [...steps.entries()].map(([n, s]) => ({ node: L.nodes.get(n)!, steps: s })).sort((x, y) => x.node.tick - y.node.tick || y.steps - x.steps);
  const roots = ancestors.filter((x) => !(L.into.get(x.node.id) ?? []).some((e) => !e.suppressed)).map((x) => x.node);
  const minds = [...new Set(ancestors.map((x) => x.node.agent).filter((x): x is AgentId => !!x && x !== root.agent))];
  return { node: root, ancestors, roots, minds };
}

export interface Influence {
  node: LedgerNode;
  /** Decisions downstream, with the strongest path share that reached each. */
  decisions: { node: LedgerNode; share: number; steps: number }[];
  /** Decisions where it sat directly in mind. */
  direct: number;
  /** Other minds it reached. */
  minds: AgentId[];
}

/** Everything downstream of a node: which decisions it has bent since, and whose. */
export function influence(L: Ledger, id: string, maxSteps = 10): Influence | undefined {
  const root = L.nodes.get(id);
  if (!root) return undefined;
  const best = new Map<string, { share: number; steps: number }>();
  let frontier: { id: string; share: number }[] = [{ id, share: 1 }];
  for (let s = 1; s <= maxSteps && frontier.length; s++) {
    const next: { id: string; share: number }[] = [];
    for (const f of frontier) {
      for (const e of L.out.get(f.id) ?? []) {
        if (e.suppressed || e.to === id) continue;
        const share = f.share * Math.max(e.weight, 0.05);
        const prev = best.get(e.to);
        if (prev && prev.share >= share) continue;
        best.set(e.to, { share, steps: s });
        next.push({ id: e.to, share });
      }
    }
    frontier = next;
  }
  const decisions = [...best.entries()]
    .map(([n, v]) => ({ node: L.nodes.get(n)!, ...v }))
    .filter((x) => x.node.kind === "decision")
    .sort((x, y) => y.share - x.share);
  const direct = (L.out.get(id) ?? []).filter((e) => !e.suppressed && L.nodes.get(e.to)!.kind === "decision").length;
  const minds = [...new Set([...best.keys()].map((n) => L.nodes.get(n)!.agent).filter((x): x is AgentId => !!x && x !== root.agent))];
  return { node: root, decisions, direct, minds };
}

export interface Concern {
  id: string;
  kind: "schema" | "belief" | "emotion";
  label: string;
  strength: number;
}

/**
 * What weighs on someone, as entry points into the ledger: their core beliefs, their strongest
 * dark beliefs, and the strongest recent fear, anger or distress.
 */
export function concerns(L: Ledger, mind: MindState, now: Tick): Concern[] {
  const out: Concern[] = [];
  for (const s of mind.schemas) out.push({ id: nodeId.item(mind.id, s.id), kind: "schema", label: s.text, strength: s.strength });
  for (const b of mind.beliefs.filter((x) => x.valence < -0.2).sort((x, y) => y.confidence * -y.valence - x.confidence * -x.valence).slice(0, 4)) {
    out.push({ id: nodeId.item(mind.id, b.id), kind: "belief", label: b.proposition, strength: b.confidence });
  }
  const recent = [...L.nodes.values()].filter((n) => n.kind === "emotion" && n.agent === mind.id && now - n.tick <= 3 * 1440);
  for (const k of EMOTION_NAMES.filter((e) => NEGATIVE_EMOTIONS.has(e))) {
    const strongest = recent
      .filter((n) => n.id.includes(`/emo:${k}@`))
      .map((n) => ({ n, v: Math.max(...(L.into.get(n.id) ?? []).filter((e) => e.mechanism === "appraised as").map((e) => e.weight), 0) }))
      .sort((x, y) => y.v - x.v || y.n.tick - x.n.tick)[0];
    if (strongest && strongest.v >= 0.3) out.push({ id: strongest.n.id, kind: "emotion", label: `${k} (${strongest.n.label.split(" felt ")[0]}, day ${Math.floor(strongest.n.tick / 1440) + 1})`, strength: strongest.v });
  }
  return out.filter((c) => L.nodes.has(c.id));
}

/** The single strongest chain behind a node, oldest cause first, for a one-line answer. */
export function strongestChain(tree: WhyTree): LedgerNode[] {
  const chain = [tree.node];
  let t = tree;
  while (t.causes.length) {
    t = [...t.causes].sort((x, y) => y.share - x.share)[0]!;
    chain.push(t.node);
    if (t.repeat) break;
  }
  return chain.reverse();
}
