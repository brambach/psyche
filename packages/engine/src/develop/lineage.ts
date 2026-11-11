// Following a person's roots back through the people who raised them.
//
// Each Root in a development record says what changed, by how much, and through whom. When the
// "through whom" is a caregiver and the reason was something in that caregiver (a core belief, their
// own attachment, how they were raised), the trail continues in the caregiver's mind: to the memory
// that installed the belief, to the story it was told as, to their own parents. This is the same
// kind of walk as schemaLineage, but for the things nobody ever said out loud.

import type { AgentId, Episode, MindState } from "../types.js";
import { styleOf, STYLE_TEXT } from "./attachment.js";
import { STATUS_TEXT } from "./identity.js";
import { moralPortrait } from "./morals.js";
import { FOUNDATIONS, type Adversity, type AttachmentStyle, type Development, type IdentityStatus, type Morals, type Root, type RootTarget, type Stage } from "./types.js";

export interface RootStep {
  /** Whose mind this step is in. */
  agent: AgentId;
  name: string;
  text: string;
  kind: "root" | "belief" | "memory" | "person";
  /** Share of the effect at the level above, 0 to 1. */
  share: number;
  /** A schema or episode id in that mind, when the step is one. */
  ref?: string;
  /** Generations back from the person asked about: 0 is their own life. */
  generation: number;
  /** How old that person was while it was happening, when it happened in a recorded childhood or life. */
  ages?: [number, number];
  causes: RootStep[];
}

type Minds = Record<AgentId, MindState>;

/** The episode chain behind a memory: who told whom, back to someone who was there. */
function memoryChain(minds: Minds, agent: AgentId, id: string, generation: number): RootStep | undefined {
  const m = minds[agent];
  const ep: Episode | undefined = m?.episodes.find((e) => e.id === id);
  if (!m || !ep) return undefined;
  const told = ep.source.kind === "told" && ep.source.from && ep.source.ref ? { from: ep.source.from, ref: ep.source.ref } : undefined;
  const up = told ? memoryChain(minds, told.from, told.ref, generation + 1) : undefined;
  return { agent, name: m.name, text: told ? `${m.name} was told: “${ep.gist}”` : `${m.name} lived it: “${ep.gist}”`, kind: "memory", share: 1, ref: ep.id, generation, causes: up ? [up] : [] };
}

function expand(minds: Minds, r: Root, share: number, generation: number, depth: number, seen: Set<string>): RootStep {
  const step: RootStep = { agent: r.via?.agent ?? "", name: r.via?.name ?? "", text: r.text, kind: "root", share, ref: r.ref, generation, ages: r.mechanism === "before" ? undefined : r.ages, causes: [] };
  const via = r.via;
  const parent = via ? minds[via.agent] : undefined;
  if (!via || !parent || depth <= 0) return step;
  const cause = via.cause ?? "";
  // A partner is of the same generation; everyone else it can come through raised them.
  const up = generation + (r.mechanism === "partner" ? 0 : 1);
  if (cause.startsWith("schema:")) {
    const sc = parent.schemas.find((s) => s.id === cause.slice(7));
    if (sc) {
      const belief: RootStep = { agent: parent.id, name: parent.name, text: `${parent.name} believes: “${sc.text}”`, kind: "belief", share: 1, ref: sc.id, generation: up, causes: [] };
      const mem = sc.origin?.[0] ? memoryChain(minds, parent.id, sc.origin[0], up) : undefined;
      if (mem) belief.causes.push(mem);
      step.causes.push(belief);
    }
  } else if (cause === "attachment" || cause === "upbringing") {
    const key = `${parent.id}|${cause}`;
    if (!seen.has(key) && parent.dev) {
      seen.add(key);
      const a = parent.attachment;
      const targets: RootTarget[] = cause === "attachment" ? [a.avoidance >= a.anxiety ? "avoidance" : "anxiety"] : ["avoidance", "authority", "confidence"];
      const head: RootStep = {
        agent: parent.id,
        name: parent.name,
        text: cause === "attachment" ? `${parent.name} is ${styleOf(a) === "secure" ? (a.avoidance >= a.anxiety ? "a little distant" : "a little anxious") : styleOf(a)} ${parent.pronouns.reflexive}` : `${parent.name} was raised ${raisedHow(parent.dev)}`,
        kind: "person",
        share: 1,
        generation: up,
        causes: [],
      };
      for (const t of targets) head.causes.push(...rootsOf(minds, parent.id, t, { depth: depth - 1, breadth: 2 }, up, seen));
      head.causes = head.causes.slice(0, 3);
      step.causes.push(head);
    }
  }
  return step;
}

/**
 * Why someone is the way they are on one thing (their anxiety, their sense of fairness, their
 * identity), as a tree: their own strongest roots, and under each, what lay behind it in whoever it
 * came through.
 */
export function rootsOf(minds: Minds, id: AgentId, target: RootTarget, opts: { depth?: number; breadth?: number } = {}, generation = 0, seen = new Set<string>()): RootStep[] {
  const dev = minds[id]?.dev;
  if (!dev) return [];
  const mine = dev.roots.filter((r) => r.target === target);
  if (!mine.length) return [];
  // Explain where they ended up: if the net is toward more of it, the causes that pushed that way.
  const net = mine.reduce((s, r) => s + r.delta, 0);
  const side = mine.filter((r) => Math.sign(r.delta) === Math.sign(net || 1)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const total = side.reduce((s, r) => s + Math.abs(r.delta), 0) || 1;
  return side.slice(0, opts.breadth ?? 3).map((r) => {
    const step = expand(minds, r, Math.abs(r.delta) / total, generation, opts.depth ?? 4, seen);
    if (!step.agent) {
      step.agent = id;
      step.name = minds[id]!.name;
    }
    return step;
  });
}

/** The strongest single chain under a step, flattened. */
export function strongest(step: RootStep): RootStep[] {
  const out = [step];
  let at = step;
  while (at.causes.length) {
    at = [...at.causes].sort((a, b) => b.share - a.share)[0]!;
    out.push(at);
  }
  return out;
}

/** How many generations back the deepest cause of this trait lies, and what it was. */
export function deepestRoot(minds: Minds, id: AgentId, target: RootTarget): { generations: number; step: RootStep; chain: RootStep[] } | undefined {
  let best: { generations: number; step: RootStep; chain: RootStep[] } | undefined;
  const walk = (s: RootStep, chain: RootStep[]) => {
    const here = [...chain, s];
    if (!best || s.generation > best.generations || (s.generation === best.generations && s.kind === "memory" && best.step.kind !== "memory")) best = { generations: s.generation, step: s, chain: here };
    for (const c of s.causes) walk(c, here);
  };
  for (const s of rootsOf(minds, id, target)) walk(s, []);
  return best;
}

// ---------------------------------------------------------------- for the causal ledger

const REF_TARGET: Record<string, RootTarget> = { "dev:attachment.anxiety": "anxiety", "dev:attachment.avoidance": "avoidance", "dev:attachment": "anxiety" };

/** The development target a decision term's ref points at ("dev:moral.care" is care). */
export function targetOfRef(ref: string): RootTarget | undefined {
  if (ref.startsWith("dev:moral.")) return ref.slice(10) as RootTarget;
  return REF_TARGET[ref];
}

/**
 * The memories and core beliefs, in this mind or in the minds of those who raised them, that a
 * piece of someone's upbringing goes back to. The ledger turns each into an edge, so "why did she
 * refuse?" can run through her conscience to her father's hungry winter.
 */
export function upbringingSources(minds: Minds, id: AgentId, ref: string): { agent: AgentId; kind: "schema" | "episode"; id: string; share: number }[] {
  const target = targetOfRef(ref);
  if (!target) return [];
  const out: { agent: AgentId; kind: "schema" | "episode"; id: string; share: number }[] = [];
  const walk = (s: RootStep, share: number) => {
    const here = share * s.share;
    if (s.ref && (s.kind === "belief" || s.kind === "memory" || s.kind === "root")) {
      const kind = s.kind === "belief" ? "schema" : "episode";
      const owner = s.kind === "root" ? id : s.agent;
      if (!out.some((o) => o.agent === owner && o.id === s.ref)) out.push({ agent: owner, kind, id: s.ref, share: here });
      // A belief or a memory is a node the ledger already knows how to trace further.
      if (s.kind !== "root") return;
    }
    for (const c of s.causes) walk(c, here);
  };
  for (const s of rootsOf(minds, id, target, { depth: 3, breadth: 3 })) walk(s, 1);
  return out.sort((a, b) => b.share - a.share).slice(0, 4);
}

// ---------------------------------------------------------------- the Roots view

export interface DevelopmentView {
  lived: boolean;
  attachment: { style: AttachmentStyle; text: string; anxiety: number; avoidance: number; infancy?: AttachmentStyle; grown?: AttachmentStyle };
  care: { warmth: number; consistency: number; control: number; seasons: number; by: { id: AgentId; name: string; seasons: number; warmth: number; control: number; parent: boolean }[]; summary: string };
  adversity: Adversity[];
  stages: Stage[];
  identity: { status: IdentityStatus; text: string; commitments: string[]; belonging: number; story: string; tone: number; history: Development["identity"]["history"] };
  morals: Morals;
  conscience: string[];
  parenting?: { warmth: number; control: number; seasons: number };
  /** Why they are as they are, one tree per thing worth explaining. */
  why: { target: RootTarget; label: string; steps: RootStep[] }[];
}

/** "warmly, and with a firm hand": how someone was brought up, in a phrase. */
function raisedHow(d: Development): string {
  const c = d.care;
  const hand = c.control >= 0.5 ? "a hard hand" : c.control >= 0.35 ? "a firm hand" : "a light hand";
  return c.warmth >= 0.62 ? `warmly, with ${hand}` : c.warmth >= 0.45 ? `with middling warmth and ${hand}` : `coldly, with ${hand}`;
}

function careSummary(d: Development): string {
  const c = d.care;
  const warm = c.warmth >= 0.62 ? "warm" : c.warmth >= 0.45 ? "middling" : "cold";
  const steady = c.consistency >= 0.65 ? "steady" : c.consistency >= 0.45 ? "uneven" : "unpredictable";
  const hard = c.control >= 0.55 ? ", with a hard hand" : c.control <= 0.25 ? ", and gentle" : "";
  return `${warm[0]!.toUpperCase()}${warm.slice(1)} and ${steady} care${hard}${d.lived ? "" : " (worked out backwards from the adult who arrived; nobody recorded it)"}.`;
}

/** Everything the Roots tab shows for one person. */
export function developmentView(minds: Minds, id: AgentId): DevelopmentView | undefined {
  const m = minds[id];
  const d = m?.dev;
  if (!m || !d) return undefined;
  const style = styleOf(m.attachment);
  const p = m.pronouns;
  // A child has not come to the question yet; saying they are "not looking" would be unfair.
  const identityText = d.lived && !d.attachmentAt.grown && d.identity.status === "diffused" ? "Still growing up: who to be is an open question" : STATUS_TEXT[d.identity.status];
  const why: DevelopmentView["why"] = [];
  const push = (target: RootTarget, label: string) => {
    const steps = rootsOf(minds, id, target);
    if (steps.length) why.push({ target, label, steps });
  };
  const net = (t: RootTarget) => d.roots.filter((r) => r.target === t).reduce((s, r) => s + r.delta, 0);
  push("anxiety", net("anxiety") > 0 ? `What made ${p.object} watchful of being left` : `What made ${p.object} sure of being answered`);
  push("avoidance", net("avoidance") > 0 ? `What taught ${p.object} to keep people at a distance` : `What taught ${p.object} to let people close`);
  for (const f of [...FOUNDATIONS].sort((a, b) => Math.abs(d.morals[b] - 0.5) - Math.abs(d.morals[a] - 0.5)).slice(0, 2)) {
    if (Math.abs(d.morals[f] - 0.5) >= 0.1) push(f, `Where ${p.possessive} sense of ${f} comes from`);
  }
  push("identity", `How ${p.subject} settled who to be`);
  push("confidence", net("confidence") >= 0 ? `What built ${p.possessive} confidence` : `What wore down ${p.possessive} confidence`);
  push("reactivity", `Why things hit ${p.object} as hard as they do`);
  return {
    lived: d.lived,
    attachment: { style, text: STYLE_TEXT[style], anxiety: m.attachment.anxiety, avoidance: m.attachment.avoidance, infancy: d.attachmentAt.infancy && styleOf(d.attachmentAt.infancy), grown: d.attachmentAt.grown && styleOf(d.attachmentAt.grown) },
    care: { warmth: d.care.warmth, consistency: d.care.consistency, control: d.care.control, seasons: d.care.seasons, by: Object.entries(d.care.by).map(([cid, c]) => ({ id: cid, ...c })).sort((a, b) => b.seasons - a.seasons), summary: careSummary(d) },
    adversity: d.adversity,
    stages: d.stages,
    identity: { status: d.identity.status, text: identityText, commitments: d.identity.commitments.map((c) => c.text), belonging: d.identity.belonging, story: d.identity.narrative.line, tone: d.identity.narrative.tone, history: d.identity.history },
    morals: d.morals,
    conscience: moralPortrait(d.morals),
    parenting: d.parenting,
    why,
  };
}
