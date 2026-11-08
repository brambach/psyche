// The lab: classic social psychology experiments, run on Psyche minds.
//
// The volunteers are ordinary Hollow Bay settlers, rolled from a seed with a temperament and one
// formative past that installed a core belief. Nothing in their minds knows it is in a study. Each
// moment of an experiment is one ordinary cognitive cycle (appraise, recall, compete for the
// workspace, decide). The only thing the lab adds is the situation: an order, a group's answer, a
// cry for help, written as forces on the options (see ActionOption.situation) so they show up in the
// decision trace beside the mind's own reasons.
//
// Because every run is deterministic, the lab can do two things no human study can: put the same
// forty people through every condition, and rerun one person with a single thing about them
// changed to test exactly what made them obey.

import { buildLedger, nodeId, why, type WhyTree } from "../ledger.js";
import { clamp } from "../memory.js";
import { runPercept, wait } from "../mind.js";
import type { ActionOption, EventFeatures, Faculties, Percept } from "../ports.js";
import { nextId } from "../rng.js";
import type { Contribution, Trace } from "../trace.js";
import { EMOTION_NAMES, TRAIT_NAMES, type Ablations, type MindState, type OtherModel, type TraitName, type Traits } from "../types.js";
import { createSettlers } from "../world/people.js";

export const DAY = 1440;
/** Lab sessions start at ten in the morning on day one. */
export const LAB_START = 10 * 60;

// ---------------------------------------------------------------- volunteers

export interface Volunteer {
  id: string;
  name: string;
  /** Who they are, one line. */
  summary: string;
  traits: Traits;
  /** The core belief their formative past installed, and the memory it came from. */
  past: { schema: string; memory: string; yearsAgo: number };
  /** The mind as recruited. Every experiment works on a copy. */
  mind: MindState;
}

/** Roll a pool of volunteers from Hollow Bay. The same seed always gives the same people. */
export function recruit(seed: number, count: number, ablations: Partial<Ablations> = {}): Volunteer[] {
  const { settlers } = createSettlers(seed, count, ablations, []);
  return settlers.map(({ mind }) => {
    mind.tick = LAB_START;
    mind.lastSleep = 0;
    const s = mind.schemas[0]!;
    const origin = mind.episodes.find((e) => e.id === s.origin?.[0]);
    return {
      id: mind.id,
      name: mind.name,
      summary: mind.identity.summary,
      traits: { ...mind.traits },
      past: { schema: s.text, memory: origin?.gist ?? "", yearsAgo: origin ? Math.round((LAB_START - origin.tick) / (365 * DAY)) : 0 },
      mind,
    };
  });
}

/** A fresh copy of a volunteer's mind, with any edit applied, ready for one experiment. */
export function fresh(v: Volunteer, edit?: Edit): MindState {
  const m = structuredClone(v.mind);
  if (edit) applyEdit(m, edit);
  return m;
}

/** Someone the volunteer meets in the lab, with how far they are trusted and liked on sight. */
export function meet(mind: MindState, id: string, name: string, trust: number, liking: number, extra: Partial<OtherModel["trust"]> = {}): void {
  mind.others[id] = { id, name, trust: { ability: 0.6, benevolence: trust, integrity: trust, ...extra }, liking, bond: 0, believedRegard: 0 };
}

// ---------------------------------------------------------------- edits (for exact counterfactuals)

export type Edit =
  | { kind: "no-past" }
  | { kind: "trait"; trait: TraitName; value: number }
  | { kind: "ablate"; ablations: Partial<Ablations> };

export function applyEdit(m: MindState, e: Edit): void {
  if (e.kind === "no-past") {
    // Remove the core belief and the memory that installed it, as if that winter never happened.
    const origins = new Set(m.schemas.flatMap((s) => s.origin ?? []));
    m.schemas = [];
    m.episodes = m.episodes.filter((x) => !origins.has(x.id));
  } else if (e.kind === "trait") m.traits[e.trait] = e.value;
  else m.ablations = { ...m.ablations, ...e.ablations };
}

export function describeEdit(e: Edit, v?: Volunteer): string {
  if (e.kind === "no-past") return v ? `without the memory "${v.past.memory}" and the core belief it left ("${v.past.schema}")` : "without their formative past";
  if (e.kind === "trait") return `with ${e.trait} set to ${e.value.toFixed(2)}${v ? ` instead of ${v.traits[e.trait].toFixed(2)}` : ""}`;
  return `with ${Object.entries(e.ablations).map(([k, x]) => `${k} ${x === false ? "off" : String(x)}`).join(", ")}`;
}

// ---------------------------------------------------------------- one moment

export interface MomentSpec {
  actor: string;
  text: string;
  gist: string;
  topics: string[];
  features: Partial<EventFeatures>;
  options: ActionOption[];
  /** Spoken to the volunteer (an order, a question) rather than something that happens. */
  speech?: boolean;
  eventId?: string;
}

/** Live one moment: one full cognitive cycle on the volunteer's mind. */
export async function live(mind: MindState, s: MomentSpec, faculties: Faculties): Promise<Trace> {
  const p: Percept = {
    id: nextId(mind, "pc"),
    tick: mind.tick,
    kind: s.speech ? "speech" : "event",
    rawText: s.text,
    actor: s.actor,
    addressedToSelf: !!s.speech,
    about: mind.others[s.actor] ? [s.actor] : [],
    topics: s.topics,
    features: { outcomeForSelf: 0, agency: "circumstance", intentional: 0, normViolation: 0, prospective: false, intensity: 0.5, ...s.features },
    claims: [],
    details: [],
    gist: s.gist,
    options: s.options,
    eventId: s.eventId,
  };
  // The engine only decides on moments that concern the mind: speech to it, or a stake in the outcome.
  if (!s.speech && Math.abs(p.features.outcomeForSelf) <= 0.05) throw new Error(`lab moment "${s.gist}" needs speech or a stake (|outcomeForSelf| > 0.05) to reach a decision`);
  return runPercept(mind, p, faculties);
}

/** Let lab time pass (minutes). Crossing night means sleeping, which runs consolidation. */
export async function pass(mind: MindState, minutes: number, faculties: Faculties): Promise<Trace[]> {
  return wait(mind, minutes, faculties);
}

// ---------------------------------------------------------------- reading a decision

export type ForceKind = "situation" | "core belief" | "trait" | "relation" | "feeling" | "norm" | "memory" | "state" | "habit" | "chance";

export interface Force {
  name: string;
  /** How far this pushed toward what was chosen and away from the runner-up (negative: against). */
  value: number;
  kind: ForceKind;
  /** Where it came from, in words: the formative memory, the trait level, the event that stirred it. */
  root?: string;
  ref?: string;
}

export interface Moment {
  /** Where in the procedure: "150 V", "trial 7", "0:40". */
  at: string;
  heard: string;
  choice: string;
  label: string;
  /** Utility lead over the best rejected option: small means it was close. */
  margin: number;
  system: 1 | 2;
  feelings: { distress: number; anger: number; fear: number; shame: number; stress: number };
  monologue?: string;
  forces?: Force[];
}

export interface LedgerStep {
  label: string;
  kind: string;
  mechanism?: string;
  share: number;
  depth: number;
}

export interface Decisive extends Moment {
  forces: Force[];
  /** The engine's own causal ledger, walked back from this decision. */
  ledger: LedgerStep[];
  /** Asked afterwards why they did it: what they said, and what moved them that they didn't mention. */
  debrief?: Debrief;
}

export interface Debrief {
  asked: string;
  said: string;
  /** Forces that pushed toward the choice from outside awareness: a core belief, a trait, the sunk cost. */
  unspoken: Force[];
  /** Share of the push toward the choice that came from those. */
  hiddenShare: number;
}

/**
 * Situational forces people act on but don't notice or won't name: sunk cost, consistency, their own
 * record, other bystanders (Darley and Latané's subjects insisted the others made no difference),
 * anonymity, labels. Traits, core beliefs, mood, habit and chance are unspoken by kind.
 */
export const UNNOTICED = new Set(["lab:commitment", "lab:consistency", "lab:record", "lab:diffusion", "lab:numbers", "lab:anonymous", "lab:overreact", "lab:shift", "lab:responsibility"]);
const UNSPOKEN_KINDS = new Set<ForceKind>(["core belief", "trait", "state", "chance", "habit", "norm"]);
const isUnspoken = (f: Force & { ref?: string }) => UNSPOKEN_KINDS.has(f.kind) || (f.ref !== undefined && UNNOTICED.has(f.ref));

/** Situational force descriptions, by ref, for the Why view. */
export type SituationText = Record<string, string>;

const FEELINGS = ["anger", "distress"];

/** The terms that separated the choice from the best option not taken, with where each came from. */
export function forcesOf(mind: MindState, t: Trace, situation: SituationText, pool?: Volunteer[]): Force[] {
  const d = t.decision;
  if (!d) return [];
  const chosen = d.options.find((o) => o.id === d.choice)!;
  const rival = [...d.options].filter((o) => o.id !== d.choice).sort((a, b) => b.utility - a.utility)[0];
  const sum = new Map<string, { value: number; ref?: string }>();
  for (const term of chosen.terms) sum.set(term.name, { value: (sum.get(term.name)?.value ?? 0) + term.value, ref: term.ref });
  for (const term of rival?.terms ?? []) sum.set(term.name, { value: (sum.get(term.name)?.value ?? 0) - term.value, ref: term.ref ?? sum.get(term.name)?.ref });
  const out: Force[] = [];
  for (const [name, { value, ref }] of sum) {
    if (Math.abs(value) < 0.005) continue;
    out.push({ name: prettyName(name), value: Number(value.toFixed(3)), ...classify(mind, name, ref, situation, pool), ...(ref ? { ref } : {}) });
  }
  return out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function prettyName(n: string): string {
  if (n === "noise") return "chance (the mood of the moment)";
  if (n.endsWith(" today")) return n.replace(" today", "");
  return n;
}

function rankOf(pool: Volunteer[] | undefined, trait: TraitName, value: number): string {
  if (!pool?.length) return "";
  const others = Math.max(1, pool.length - 1);
  const below = pool.filter((v) => v.traits[trait] < value).length;
  const above = pool.filter((v) => v.traits[trait] > value).length;
  if (below === 0) return ", the lowest of the volunteers";
  if (above === 0) return ", the highest of the volunteers";
  return below >= above ? `, higher than ${Math.round((below / others) * 100)}% of the volunteers` : `, lower than ${Math.round((above / others) * 100)}% of the volunteers`;
}

function classify(mind: MindState, name: string, ref: string | undefined, situation: SituationText, pool?: Volunteer[]): { kind: ForceKind; root?: string } {
  if (ref?.startsWith("lab:")) return { kind: "situation", root: situation[ref] };
  if (name.startsWith("core belief:")) {
    const s = mind.schemas.find((x) => x.id === ref);
    const ep = s?.origin?.length ? mind.episodes.find((e) => e.id === s.origin![0]) : undefined;
    const years = ep ? Math.round((mind.tick - ep.tick) / (365 * DAY)) : 0;
    return { kind: "core belief", root: ep ? `installed by "${ep.gist}" (${years} year${years === 1 ? "" : "s"} ago)` : undefined };
  }
  if (name.startsWith("trust in ")) {
    const o = ref?.startsWith("other:") ? mind.others[ref.slice(6)] : undefined;
    return { kind: "relation", root: o ? `trust in ${o.name}'s good intentions is ${o.trust.benevolence.toFixed(2)} now` : undefined };
  }
  const trait = TRAIT_NAMES.find((x) => name === `${x} today`);
  if (trait) return { kind: "trait", root: `${trait} ${mind.traits[trait].toFixed(2)}${rankOf(pool, trait, mind.traits[trait])}` };
  if (FEELINGS.includes(name)) return { kind: "feeling", root: `${name} at ${mind.affect.emotions[name as "anger"].toFixed(2)}, built up over the session` };
  if (name === "courtesy norm") return { kind: "norm", root: "doing what you're asked, politely, is the default" };
  if (name.startsWith("memory:") || name.startsWith("belief:") || name === "has a story to tell") return { kind: "memory" };
  if (name.startsWith("habit:")) return { kind: "habit" };
  if (name === "noise") return { kind: "chance" };
  return { kind: "state" };
}

export function feelingsOf(mind: MindState): Moment["feelings"] {
  const e = mind.affect.emotions;
  const r = (x: number) => Number(x.toFixed(3));
  return { distress: r(e.distress), anger: r(e.anger), fear: r(e.fear), shame: r(e.shame), stress: r(mind.affect.stress) };
}

export function momentOf(mind: MindState, at: string, t: Trace): Moment {
  const d = t.decision!;
  const chosen = d.options.find((o) => o.id === d.choice)!;
  const rival = Math.max(-Infinity, ...d.options.filter((o) => o.id !== d.choice).map((o) => o.utility));
  return {
    at,
    heard: t.percept?.rawText ?? "",
    choice: d.choice,
    label: chosen.label,
    margin: Number((chosen.utility - (Number.isFinite(rival) ? rival : chosen.utility)).toFixed(3)),
    system: d.system,
    feelings: feelingsOf(mind),
    monologue: d.monologue,
  };
}

export interface Interview {
  faculties: Faculties;
  /** The experimenter's question afterwards. */
  ask: string;
  /** How the volunteer would put each situational force in their own words, by ref. */
  voice?: Record<string, string>;
}

/** The decisive moment, fully explained: forces with their roots, the engine ledger behind it, and the debrief. */
export async function explain(mind: MindState, traces: Trace[], decisive: Trace, at: string, situation: SituationText, pool?: Volunteer[], interview?: Interview): Promise<Decisive> {
  const L = buildLedger({ minds: { [mind.id]: mind }, traces: traces.map((trace) => ({ agent: mind.id, trace })) });
  const tree = why(L, nodeId.decision(mind.id, decisive.id), { depth: 4, breadth: 3, floor: 0.03 });
  const ledger: LedgerStep[] = [];
  const walk = (n: WhyTree, depth: number) => {
    ledger.push({ label: n.node.label, kind: n.node.kind, mechanism: n.via?.mechanism, share: Number(n.share.toFixed(3)), depth });
    for (const c of n.causes) walk(c, depth + 1);
  };
  if (tree) walk(tree, 0);
  const forces = forcesOf(mind, decisive, situation, pool);
  const out: Decisive = { ...momentOf(mind, at, decisive), forces: forces.slice(0, 8), ledger: ledger.slice(0, 14) };
  if (interview) out.debrief = await debrief(mind, decisive, forces, interview);
  return out;
}

/**
 * Ask them why. The account is built from the reasons they could have noticed, the way people explain
 * themselves (Nisbett & Wilson 1977), and voiced by the Speak faculty. Set beside it: the forces they
 * acted on and did not mention.
 */
async function debrief(mind: MindState, t: Trace, forces: Force[], iv: Interview): Promise<Debrief> {
  const d = t.decision!;
  const chosen = d.options.find((o) => o.id === d.choice)!;
  const pro = forces.filter((f) => f.value > 0 && f.kind !== "chance");
  const noticed = pro.filter((f) => !isUnspoken(f)).slice(0, 2);
  const unspoken = forces.filter((f) => f.value > 0 && isUnspoken(f));
  const total = forces.filter((f) => f.value > 0).reduce((s, f) => s + f.value, 0) || 1;
  const reason = (f: Force): string => {
    if (f.ref && iv.voice?.[f.ref]) return iv.voice[f.ref]!;
    if (f.kind === "feeling") return f.name === "anger" ? "I was angry" : "I was upset";
    if (f.kind === "relation") return `of how I felt about ${f.name.replace(/^trust in /, "")}`;
    if (f.kind === "memory") return `I remembered that ${f.name.replace(/^(memory|belief): /, "").replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}`;
    if (f.name.startsWith("serves goal: ")) return `I wanted to ${f.name.slice(13).replace(/^./, (c) => c.toLowerCase())}`;
    return f.name;
  };
  const verb = t.percept?.options?.find((o) => o.id === d.choice)?.verb ?? chosen.label.toLowerCase();
  const sentence = noticed.length ? `I chose to ${verb} because ${noticed.map(reason).join(", and ")}.` : `I chose to ${verb}. I couldn't tell you why.`;
  const res = await iv.faculties.speak({
    self: { id: mind.id, name: mind.name, summary: mind.identity.summary, voice: mind.identity.voice },
    listener: { id: "experimenter", name: "the experimenter" },
    heard: iv.ask,
    intent: { option: "Explain yourself", description: sentence },
    content: noticed.map((f, i) => ({ id: `reason_${i}`, text: reason(f) })),
    style: { warmth: 0.5, curtness: 0.2, hedging: clamp(mind.traits.neuroticism * 0.6), verbosity: clamp(mind.traits.extraversion * 0.7) },
    stance: ["You are explaining, afterwards, why you did what you did. Give only reasons you would be aware of."],
    salience: 0.9,
  });
  return { asked: iv.ask, said: res.utterance, unspoken: unspoken.slice(0, 4), hiddenShare: Number((unspoken.reduce((s, f) => s + f.value, 0) / total).toFixed(3)) };
}

// ---------------------------------------------------------------- runs and results

export interface SubjectRun {
  id: string;
  name: string;
  /** Plain outcome, e.g. "went to 450 V" or "stopped at 150 V". */
  outcome: string;
  /** Did they do what the situation pressed for (obey, conform, stay put, abuse)? */
  yielded: boolean;
  /** The headline number for this person (max volts, conforming answers, seconds to help). */
  score: number;
  moments: Moment[];
  decisive?: Decisive;
  /** The morning after. */
  after?: { notes: string[]; mood: number; stress: number; shame: number; deepened: string[] };
  /** The same person, rerun with one thing changed. */
  counterfactual?: { edit: string; outcome: string; yielded: boolean; score: number; flipped: boolean };
  role?: string;
}

export interface HumanResult {
  value: number;
  /** How the number reads, e.g. "65% went to 450 V". */
  text: string;
  source: string;
  n?: number;
}

export interface ConditionResult {
  id: string;
  label: string;
  description: string;
  /** Headline metric for this condition, 0..1 unless the experiment says otherwise. */
  value: number;
  valueText: string;
  human?: HumanResult;
  subjects: SubjectRun[];
  /** Anything else worth charting (stop points, latencies, daily series). */
  extra?: Record<string, unknown>;
}

export interface Correlate {
  trait: string;
  r: number;
  note?: string;
}

export interface AblationRow {
  label: string;
  description: string;
  value: number;
  valueText: string;
}

export interface ExperimentResult {
  id: string;
  title: string;
  original: string;
  question: string;
  metric: string;
  conditions: ConditionResult[];
  correlates?: Correlate[];
  ablations?: AblationRow[];
  /** What a counterfactual sweep found: how many outcomes depended on the person's past. */
  pasts?: { tested: number; flipped: number; text: string; examples: { name: string; past: string; before: string; after: string }[] };
  findings: string[];
  /** Subjects worth reading in full: ids by condition. */
  stories: { condition: string; id: string; why: string }[];
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------- statistics

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx && syy ? Number((sxy / Math.sqrt(sxx * syy)).toFixed(2)) : 0;
}

/** Trait correlations with a per-subject score, across a pool. */
export function correlates(pool: Volunteer[], runs: SubjectRun[], notes: Partial<Record<TraitName, string>> = {}): Correlate[] {
  const byId = new Map(pool.map((v) => [v.id, v]));
  const xs = runs.filter((r) => byId.has(r.id));
  return TRAIT_NAMES.map((t) => ({ trait: t, r: pearson(xs.map((r) => byId.get(r.id)!.traits[t]), xs.map((r) => r.score)), note: notes[t] })).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const share = (runs: SubjectRun[]) => (runs.length ? runs.filter((r) => r.yielded).length / runs.length : 0);
export { clamp, EMOTION_NAMES };
export type { Contribution };

// ---------------------------------------------------------------- sweeps

export type Rerun = (v: Volunteer, edit: Edit) => Promise<SubjectRun>;

/**
 * The exact test the ledger can only estimate: run every volunteer again without their formative
 * past and see whose outcome changes. `minShift` is how far the score must move to count as moved.
 */
export async function sweepPasts(pool: Volunteer[], baseline: SubjectRun[], rerun: Rerun, minShift: number, unit: string, verb: string): Promise<NonNullable<ExperimentResult["pasts"]>> {
  let flipped = 0;
  let moved = 0;
  const examples: NonNullable<ExperimentResult["pasts"]>["examples"] = [];
  for (const v of pool) {
    const before = baseline.find((s) => s.id === v.id);
    if (!before) continue;
    const edit: Edit = { kind: "no-past" };
    const after = await rerun(v, edit);
    const changed = after.yielded !== before.yielded;
    if (changed) flipped++;
    if (changed || Math.abs(after.score - before.score) >= minShift) {
      moved++;
      before.counterfactual = { edit: describeEdit(edit, v), outcome: after.outcome, yielded: after.yielded, score: after.score, flipped: changed };
      examples.push({ name: v.name, past: v.past.memory, before: before.outcome, after: after.outcome });
    }
  }
  examples.sort((a, b) => Number(baseline.find((s) => s.name === b.name)?.counterfactual?.flipped) - Number(baseline.find((s) => s.name === a.name)?.counterfactual?.flipped));
  return {
    tested: baseline.length,
    flipped,
    text: `Rerun with their formative memory and the core belief it installed removed, ${flipped} of ${baseline.length} volunteers ${verb}, and ${moved} moved by ${minShift} ${unit} or more.`,
    examples: examples.slice(0, 12),
  };
}

export async function ablate(pool: Volunteer[], rows: [string, string, Edit][], rerun: Rerun, metric: (runs: SubjectRun[]) => number, fmt: (x: number) => string): Promise<AblationRow[]> {
  const out: AblationRow[] = [];
  for (const [label, description, edit] of rows) {
    const runs: SubjectRun[] = [];
    for (const v of pool) runs.push(await rerun(v, edit));
    const value = metric(runs);
    out.push({ label, description, value, valueText: fmt(value) });
  }
  return out;
}

export const STANDARD_ABLATIONS: [string, string, Edit][] = [
  ["Everyone deliberates", "System 2 always engages: more thinking, same reasons", { kind: "ablate", ablations: { systemTwo: "always" } }],
  ["Pure gut", "System 2 never engages", { kind: "ablate", ablations: { systemTwo: "never" } }],
  ["Unlimited awareness", "No workspace limit: every feeling and memory counts at once", { kind: "ablate", ablations: { limitedWorkspace: false } }],
  ["No pasts", "Formative memories and core beliefs removed from everyone", { kind: "no-past" }],
];
