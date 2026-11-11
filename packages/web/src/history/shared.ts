// What the pieces of the history explorer share: the colour groups, the names of things, and a few helpers.

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { LedgerEdge, LedgerNode, Mechanism, MomentKind, NodeKind, WhyTree } from "@psyche/engine";

/** The colour groups of the timeline: at most six, so they stay tellable apart. */
export const GROUPS: { id: string; label: string; kinds: MomentKind[]; color: string }[] = [
  { id: "plan", label: "Intentions", kinds: ["plan"], color: "var(--hx-s1)" },
  { id: "town", label: "The town's business", kinds: ["store", "works"], color: "var(--hx-s2)" },
  { id: "kin", label: "Home and family", kinds: ["home", "life"], color: "var(--hx-s3)" },
  { id: "debt", label: "Between neighbours", kinds: ["money", "peace"], color: "var(--hx-s4)" },
  { id: "talk", label: "Talk", kinds: ["talk"], color: "var(--hx-s5)" },
  { id: "world", label: "Weather, luck, the uncanny", kinds: ["world", "faith", "other"], color: "var(--hx-s6)" },
];
const GROUP_OF = new Map<MomentKind, number>(GROUPS.flatMap((g, i) => g.kinds.map((k) => [k, i] as [MomentKind, number])));
export const groupIndex = (k: MomentKind) => GROUP_OF.get(k) ?? GROUPS.length - 1;
export const groupOf = (k: MomentKind) => GROUPS[groupIndex(k)]!;

export const KIND: Record<NodeKind, string> = {
  event: "event",
  conversation: "talk",
  percept: "moment",
  episode: "memory",
  belief: "belief",
  schema: "core belief",
  emotion: "feeling",
  relation: "trust",
  goal: "goal",
  need: "need",
  decision: "choice",
  utterance: "said",
  act: "did",
  sleep: "sleep",
  outside: "from outside",
  norm: "norm",
  edit: "you",
  upbringing: "upbringing",
};

export const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
export const agentColor = (id?: string) => (id ? `hsl(${hue(id)} 62% 70%)` : "var(--hx-muted)");
export const tickOf = (t: number | null | undefined) => (t === null || t === undefined || !Number.isFinite(t) ? null : t);
export const clean = (label: string) => label.replace(/^(Core belief|Goal|Norm): /, "");

/** Backstory is dated in ordinary years, whatever the length of the village's own. */
export const BACKSTORY_YEAR = 365 * 1440;

/** One thing on the trail, once: where it sits and how it led on. */
export interface FlatNode {
  node: LedgerNode;
  /** The link from this to what it led to (absent for the thing being explained). */
  via?: LedgerEdge;
  effect?: LedgerNode;
  share: number;
  depth: number;
}

export interface FlatLink {
  from: string;
  to: string;
  mechanism: Mechanism;
  share: number;
}

/** Every node of a why-tree once, nearest the root first. */
export function flattenTree(tree: WhyTree): FlatNode[] {
  const out: FlatNode[] = [];
  const queue: { t: WhyTree; parent?: WhyTree; depth: number }[] = [{ t: tree, depth: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const { t, parent, depth } = queue[i]!;
    if (!t.repeat) out.push({ node: t.node, via: t.via, effect: parent?.node, share: t.share, depth });
    for (const c of t.causes) queue.push({ t: c, parent: t, depth: depth + 1 });
  }
  return out;
}

/** Every link of a why-tree, including the ones back to something already shown. */
export function linksOf(tree: WhyTree): FlatLink[] {
  const out: FlatLink[] = [];
  const walk = (t: WhyTree) => {
    for (const c of t.causes) {
      if (c.via) out.push({ from: c.node.id, to: t.node.id, mechanism: c.via.mechanism, share: c.share });
      walk(c);
    }
  };
  walk(tree);
  return out;
}

/** The width of an element, kept up to date. */
export function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
