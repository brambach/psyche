// Growing up, a season at a time.
//
// A child in Psyche is a full mind from birth, but most of what makes them who they are is laid
// down by the people around them before they can choose anything. Each season this code works out
// the care the child actually got (from what their caregivers were carrying: see attachment.ts),
// and lets it do what the developmental literature says it does:
//
//   Attachment forms from how warm and how steady the care was (Ainsworth et al. 1978), fastest in
//   the first two years and never quite fixed after (Fraley 2002; Waters et al. 2000).
//
//   Erikson's early stages (1950) resolve one after another, each leaving something in the self:
//   trust, autonomy, initiative, industry.
//
//   Adversity is counted the way the ACE study counted it (Felitti et al. 1998). An adversity met
//   with a warm caregiver present is tolerable; met alone it is toxic (Shonkoff et al. 2012), and a
//   little of the first kind leaves a person stronger than none at all (Seery, Holman & Silver 2010).
//   A child old enough to remember keeps a memory of it, and an unbuffered one can install a core
//   belief, by the same machinery that gives the founders theirs. Before about three there is no
//   memory to keep (infantile amnesia), only the mark.
//
//   Conscience is taken on from the people who raise the child, more fully from warm ones (Grusec &
//   Goodnow 1994), and in adolescence from the town (Harris 1995). A cold, controlling home breeds
//   obedience in a small child and reactance in an older one (Brehm 1966).
//
// Temperament is left almost alone. Twin and adoption studies find the Big Five about half
// heritable with little effect of the shared home (Bouchard & McGue 2003), so upbringing here acts
// on attachment, the self-model, conscience and identity, and nudges traits only slightly.
//
// The same functions run in a live town, in an aggregate town, and in the lab's nursery. What they
// need to know about the world arrives in a SeasonContext.

import { episode } from "../seed.js";
import type { AgentId, Attachment, MindState, Pronouns, Schema, Tick } from "../types.js";
import { attachmentTargets, plasticity, securityOf, strainOf, styleOf, type Caregiving, type Stressor } from "./attachment.js";
import { addRoot, blankDevelopment, clamp, keyedGaussian, mean, r2, wasOf } from "./core.js";
import { identitySeason, narrate, narrativeYear, statusOf } from "./identity.js";
import { innateMorals, moralsFromSchema } from "./morals.js";
import { FOUNDATIONS, type Adversity, type AdversityKind, type Development, type Morals, type StageName } from "./types.js";

export interface CaregiverNow {
  mind: MindState;
  parent: boolean;
  /** How much of the child's care falls to them: 1 for a parent at home, less for other adults of the house. */
  weight: number;
  care: Caregiving;
}

export interface Loss {
  who: AgentId;
  name: string;
  relation: "parent" | "carer" | "sibling" | "partner" | "child";
  cause: string;
}

export interface SeasonContext {
  now: Tick;
  /** Age in years. */
  age: number;
  /** Ticks in a year, for "has this happened in the last year". */
  yearTicks: number;
  seed: number;
  caregivers: CaregiverNow[];
  /** What the household is under this season. */
  stressors: Stressor[];
  losses: Loss[];
  /** Mean conscience of the town's adults. */
  townMorals?: Morals;
  town?: string;
  role?: string;
  /** How at home they are, 0 to 1. */
  belonging?: number;
  /** For adults. */
  partner?: MindState;
  children?: number;
  /** True on the first season of a year. */
  newYear?: boolean;
  /** Something that shook the life they had settled into this season. */
  crisis?: string;
  /**
   * How things are going with the other children, -1 to 1, from about six on. Left out, it is
   * drawn by keyed chance in chapters of three years (see `outsideDraw`).
   */
  outside?: number;
}

/**
 * Life outside the home, for a child of six or more: a friend made, a falling-out, being let in or
 * left out. The model does not simulate the playground, so this is chance, in chapters of three
 * years. It is the main reason attachment at seventeen is not simply attachment at one
 * (Fraley 2002; Allen, McElhaney, Kuperminc & Jodl 2004).
 */
export function outsideDraw(seed: number, id: AgentId, age: number): number {
  return age < 6 ? 0 : clamp(0.75 * keyedGaussian(seed, 0, `outside|${id}|${Math.floor(age / 3)}`), -1, 1);
}

export interface DevNote {
  kind: "adversity" | "stage" | "identity" | "attachment";
  text: string;
}

const AGE_WORDS = ["as a baby", "at one", "at two", "at three", "at four", "at five", "at six", "at seven", "at eight", "at nine", "at ten", "at eleven", "at twelve", "at thirteen", "at fourteen", "at fifteen", "at sixteen"];
const ageWord = (age: number) => AGE_WORDS[Math.floor(age)] ?? `at ${Math.floor(age)}`;

/** The age at which children start keeping memories (infantile amnesia lifts between three and four). */
export const REMEMBERS_FROM = 3;
export const GROWN = 17;

// ---------------------------------------------------------------- birth

/**
 * A new person: an inborn reactivity, a conscience that so far is only temperament, and an
 * attachment that is nothing yet. Hardship in the months before birth leaves a child more reactive
 * (the Dutch Hunger Winter cohort: Roseboom, de Rooij & Painter 2006; Van den Bergh et al. 2005).
 */
export function bornWith(child: MindState, parents: MindState[], ctx: { now: Tick; seed: number; stressors: Stressor[] }): void {
  const dev = blankDevelopment(ctx.now, true);
  const g = (k: string) => keyedGaussian(ctx.seed, 0, `born|${child.id}|${k}`);
  const womb = Math.max(0, ...parents.map((p) => strainOf(p, ctx.stressors).strain));
  dev.reactivity = r2(clamp(0.25 + 0.5 * child.traits.neuroticism + 0.12 * g("react") + (womb >= 0.3 ? 0.3 * (womb - 0.2) : 0), 0.05, 0.95));
  dev.morals = innateMorals(child.traits, (f) => g(`moral.${f}`));
  child.attachment = { anxiety: r2(clamp(0.3 + 0.1 * (dev.reactivity - 0.5))), avoidance: 0.3 };
  child.dev = dev;
  if (womb >= 0.3) {
    const worst = [...parents].sort((a, b) => strainOf(b, ctx.stressors).strain - strainOf(a, ctx.stressors).strain)[0]!;
    const part = strainOf(worst, ctx.stressors).parts.sort((a, b) => b.amount - a.amount)[0];
    addRoot(dev, {
      target: "reactivity",
      delta: 0.3 * (womb - 0.2),
      mechanism: "womb",
      tick: ctx.now,
      age: 0,
      text: `Born into a hard season: ${worst.name} was under strain before the birth${part ? ` (${part.label})` : ""}. Children of such seasons feel things more.`,
      via: { agent: worst.id, name: worst.name, cause: part?.cause, label: part?.label },
    });
  }
}

// ---------------------------------------------------------------- one season of childhood

/** How far a good or bad run with the other children moves the pull on each dimension (tuned). */
/** How fast a child under twelve takes on a warm caregiver's conscience, per season (tuned). */
const TEACHING = 0.014;
/** A caregiver at least this warm in a hard season carries a child through it (tuned). */
const BUFFER = 0.52;
/** Control at or above this, season after season, is a hard hand. */
export const HARSH = 0.5;
const OUTSIDE_ANXIETY = 0.6;
const OUTSIDE_AVOIDANCE = 0.5;

const STAGES: [StageName, number][] = [
  ["trust", 1.5],
  ["autonomy", 3],
  ["initiative", 6],
  ["industry", 12],
];

export function childSeason(child: MindState, ctx: SeasonContext): DevNote[] {
  const dev = child.dev!;
  const notes: DevNote[] = [];
  const { age } = ctx;
  const cgs = ctx.caregivers;

  // ---- the care they got this season
  const S = cgs.reduce((s, c) => s + c.weight, 0);
  const attention = Math.min(1, 0.7 + 0.3 * Math.min(1, S / 1.6));
  const W = S > 0 ? clamp((cgs.reduce((s, c) => s + c.weight * c.care.warmth, 0) / S) * attention) : 0.12;
  const C = S > 0 ? clamp(cgs.reduce((s, c) => s + c.weight * c.care.control, 0) / S) : 0.3;
  const unsteady = S > 0 ? cgs.reduce((s, c) => s + c.weight * c.care.wobble, 0) / S : 0.3;
  const care = dev.care;
  const n = care.seasons;
  const swing = n > 0 ? 0.5 * Math.abs(W - care.recent) + 0.5 * 0.8 * unsteady : 0.8 * unsteady;
  care.wobble = r2(n > 0 ? care.wobble + Math.max(1 / (n + 1), 0.15) * (swing - care.wobble) : swing);
  care.recent = r2(n > 0 ? 0.5 * care.recent + 0.5 * W : W);
  const k = Math.max(1 / (n + 1), 0.06);
  care.warmth = r2(n > 0 ? care.warmth + k * (W - care.warmth) : W);
  care.control = r2(n > 0 ? care.control + k * (C - care.control) : C);
  care.consistency = r2(clamp(1 - 3 * care.wobble));
  care.seasons = n + 1;
  for (const c of cgs) {
    const by = (care.by[c.mind.id] ??= { name: c.mind.name, seasons: 0, warmth: c.care.warmth, control: c.care.control, parent: c.parent });
    by.warmth = r2(by.warmth + (c.care.warmth - by.warmth) / (by.seasons + 1));
    by.control = r2(by.control + (c.care.control - by.control) / (by.seasons + 1));
    by.seasons++;
  }
  const hunger = Math.max(0, ...ctx.stressors.filter((s) => s.kind === "hunger").map((s) => s.intensity));
  const win = dev.window;
  win.warmth += W;
  win.control += C;
  win.consistency += care.consistency;
  win.hunger += hunger;
  win.seasons++;

  // ---- attachment: what this care teaches about self and others
  const before = { ...child.attachment };
  const target = attachmentTargets({ recent: care.recent, consistency: care.consistency, control: 0.5 * C + 0.5 * care.control });
  const rate = plasticity(age) * (0.7 + 0.6 * dev.reactivity);
  const dAnx = rate * (target.anxiety - before.anxiety);
  const dAvo = rate * (target.avoidance - before.avoidance);
  // From about six, the other children count too.
  const outside = age >= 6 ? (ctx.outside ?? outsideDraw(ctx.seed, child.id, age)) : 0;
  const oAnx = -rate * OUTSIDE_ANXIETY * outside;
  const oAvo = -rate * OUTSIDE_AVOIDANCE * outside;
  child.attachment.anxiety = r2(clamp(before.anxiety + dAnx + oAnx));
  child.attachment.avoidance = r2(clamp(before.avoidance + dAvo + oAvo));
  if (Math.abs(outside) >= 0.15) {
    const text = outside > 0 ? "Had friends among the other children, and was let in." : `Was left out by the other children, or lost the friend ${child.pronouns.subject} had.`;
    addRoot(dev, { target: "anxiety", delta: oAnx, mechanism: "peers", tick: ctx.now, age, text });
    addRoot(dev, { target: "avoidance", delta: oAvo, mechanism: "peers", tick: ctx.now, age, text });
  }
  attribute(dev, "anxiety", dAnx, cgs, ctx, (p) => p.wobble + 0.3 * Math.max(0, -p.warmth), (name, label) => `${name}'s care came and went: ${label}.`);
  attribute(dev, "avoidance", dAvo, cgs, ctx, (p) => Math.max(0, -p.warmth) + 0.3 * Math.max(0, p.control), (name, label) => `${name} was hard to reach: ${label}.`);

  // ---- hardship
  if (hunger > 0) child.affect.stress = r2(clamp(child.affect.stress + 0.25 * hunger));
  const warmOne = cgs.some((c) => c.care.warmth >= 0.6);
  const recently = (kind: AdversityKind) => dev.adversity.some((a) => a.kind === kind && ctx.now - a.tick < ctx.yearTicks);
  if (hunger >= 0.5 && !recently("hunger")) {
    notes.push(suffer(child, ctx, { kind: "hunger", buffered: cgs.some((c) => c.care.warmth >= BUFFER), text: `Went hungry ${ageWord(age)}.` }));
  }
  for (const l of ctx.losses) {
    if (l.relation !== "parent" && l.relation !== "carer" && l.relation !== "sibling") continue;
    const close = l.relation !== "sibling";
    const buffered = close ? cgs.some((c) => c.mind.id !== l.who && c.care.warmth >= 0.55) : W >= 0.5;
    notes.push(suffer(child, ctx, { kind: "loss", buffered, who: l.who, text: `Lost ${l.relation === "sibling" ? `a ${l.relation}` : l.relation === "carer" ? `the one who was raising ${child.pronouns.object}` : "a parent"}, ${l.name}, ${ageWord(age)} (${l.cause}).` }));
    const shake = (close ? (buffered ? 0.05 : 0.12) : 0.03) * (age < 12 ? 1 : 0.6);
    child.attachment.anxiety = r2(clamp(child.attachment.anxiety + shake));
    addRoot(dev, { target: "anxiety", delta: shake, mechanism: "loss", tick: ctx.now, age, text: `${l.name} died ${ageWord(age)}${buffered ? ", with someone warm still there" : ", and nobody filled the place"}.`, via: { agent: l.who, name: l.name, cause: "absence" } });
    if (close && !buffered && age < 6) {
      child.attachment.avoidance = r2(clamp(child.attachment.avoidance + 0.05));
      addRoot(dev, { target: "avoidance", delta: 0.05, mechanism: "loss", tick: ctx.now, age, text: `${l.name} died ${ageWord(age)}, and nobody filled the place.`, via: { agent: l.who, name: l.name, cause: "absence" } });
    }
  }
  const runs = dev.runs;
  runs.harsh = C >= HARSH ? runs.harsh + 1 : Math.max(0, runs.harsh - 1);
  runs.cold = W < 0.36 ? runs.cold + 1 : Math.max(0, runs.cold - 1);
  const troubled = [...cgs].filter((c) => c.parent).sort((a, b) => b.care.strain - a.care.strain)[0];
  runs.troubled = troubled && troubled.care.strain >= 0.45 ? runs.troubled + 1 : Math.max(0, runs.troubled - 1);
  const once = (kind: AdversityKind) => !dev.adversity.some((a) => a.kind === kind);
  if (runs.harsh >= 4 && once("harsh")) {
    const hardest = [...cgs].sort((a, b) => b.care.control - a.care.control)[0]!;
    const kinder = cgs.some((c) => c !== hardest && c.care.warmth >= 0.6 && c.care.control < 0.45);
    notes.push(suffer(child, ctx, { kind: "harsh", buffered: kinder, who: hardest.mind.id, text: `Raised with a hard hand by ${hardest.mind.name}, from about ${Math.max(0, Math.floor(age - 1))}.` }));
  }
  if (runs.cold >= 4 && once("neglect")) {
    notes.push(suffer(child, ctx, { kind: "neglect", buffered: false, text: S > 0 ? `Left mostly to ${child.pronouns.reflexive} from about ${Math.max(0, Math.floor(age - 1))}: the people at home had little to give.` : `Left to ${child.pronouns.reflexive} ${ageWord(age)}, with nobody at home to raise ${child.pronouns.object}.` }));
  }
  if (runs.troubled >= 4 && once("troubled-parent") && troubled) {
    const why = strainOf(troubled.mind, ctx.stressors).parts.sort((a, b) => b.amount - a.amount)[0];
    notes.push(suffer(child, ctx, { kind: "troubled-parent", buffered: warmOne && cgs.length > 1, who: troubled.mind.id, text: `Grew up beside ${troubled.mind.name}'s troubles${why ? ` (${why.label})` : ""}.` }));
  }

  // ---- conscience
  socialize(child, ctx, W, C);

  // ---- Erikson's stages, as each one closes
  const stage = STAGES[win.stage];
  if (stage && age >= stage[1]) {
    notes.push(resolveStage(child, ctx, stage[0]));
    if (stage[0] === "trust") dev.attachmentAt.infancy = { ...child.attachment };
    dev.window = { warmth: 0, control: 0, consistency: 0, hunger: 0, seasons: 0, stage: win.stage + 1 };
  }

  // ---- adolescence: who to be
  if (age >= 12) {
    const line = identitySeason(child, { now: ctx.now, age, role: ctx.role, partnered: false, parent: false, belonging: ctx.belonging ?? dev.identity.belonging, hardship: hunger, crisis: ctx.losses.find((l) => l.relation === "parent")?.name ? `${ctx.losses.find((l) => l.relation === "parent")!.name} died` : ctx.crisis, town: ctx.town });
    if (line) notes.push({ kind: "identity", text: line });
  }
  dev.lastTurn = ctx.now;
  return notes;
}

/**
 * Split a season's change in attachment among what caused it. A move toward insecurity is shared
 * out over the caregivers' shortfalls (each with its own cause: this is where a parent's old injury
 * gets its line in the child's record). A move toward security is credited to whoever was warm.
 */
function attribute(dev: Development, target: "anxiety" | "avoidance", delta: number, cgs: CaregiverNow[], ctx: SeasonContext, blame: (p: Caregiving["parts"][number]) => number, text: (name: string, label: string) => string): void {
  if (Math.abs(delta) < 0.002) return;
  if (delta < 0) {
    const total = cgs.reduce((s, c) => s + c.weight * c.care.warmth, 0);
    for (const c of cgs) {
      const share = total > 0 ? (c.weight * c.care.warmth) / total : 0;
      addRoot(dev, { target, delta: delta * share, mechanism: "care", tick: ctx.now, age: ctx.age, text: `Steady, warm care from ${c.mind.name}.`, via: { agent: c.mind.id, name: c.mind.name } });
    }
    return;
  }
  const shares: { c: CaregiverNow; p: Caregiving["parts"][number]; w: number }[] = [];
  for (const c of cgs) for (const p of c.care.parts) {
    const w = c.weight * blame(p);
    if (w > 0.002) shares.push({ c, p, w });
  }
  if (!cgs.length) {
    addRoot(dev, { target, delta, mechanism: "care", tick: ctx.now, age: ctx.age, text: "Nobody at home to answer." });
    return;
  }
  shares.sort((a, b) => b.w - a.w);
  const top = shares.slice(0, 3);
  const total = top.reduce((s, x) => s + x.w, 0);
  if (total <= 0) {
    addRoot(dev, { target, delta, mechanism: "temperament", tick: ctx.now, age: ctx.age, text: "A child who feels things strongly, even in a steady home." });
    return;
  }
  for (const x of top) {
    addRoot(dev, { target, delta: (delta * x.w) / total, mechanism: "care", tick: ctx.now, age: ctx.age, text: text(x.c.mind.name, x.p.label), via: { agent: x.c.mind.id, name: x.c.mind.name, cause: x.p.cause, label: x.p.label } });
  }
}

// ---------------------------------------------------------------- adversity

const MARKS: Record<AdversityKind, { topics: string[]; gist: (age: string) => string; schema?: Omit<Schema, "id" | "origin">; agency: "other" | "circumstance" }> = {
  hunger: {
    topics: ["food", "hunger", "winter", "store"],
    gist: (a) => `We went hungry ${a === "as a baby" ? "when I was small" : `when I was ${a.replace("at ", "")}`}, and I remember the cold in my stomach.`,
    schema: { text: "There is never enough to go round", triggers: ["food", "store", "hunger", "winter"], blameBias: 0.1, threatBias: 0.25, strength: 0.4 },
    agency: "circumstance",
  },
  loss: {
    topics: ["death", "grief", "family", "love"],
    gist: () => "",
    schema: { text: "The people you love are taken from you", triggers: ["death", "grief", "family", "love"], blameBias: 0, threatBias: 0.25, strength: 0.4 },
    agency: "circumstance",
  },
  harsh: {
    topics: ["family", "trust", "fairness"],
    gist: () => "",
    schema: { text: "The strong do as they like with the weak", triggers: ["trust", "fairness", "law", "help"], blameBias: 0.25, threatBias: 0.15, strength: 0.4 },
    agency: "other",
  },
  neglect: {
    topics: ["family", "help", "trust"],
    gist: () => "Nobody came when I called, the years I was small.",
    schema: { text: "Nobody comes when you call", triggers: ["help", "trust", "family"], blameBias: 0.15, threatBias: 0.2, strength: 0.4 },
    agency: "other",
  },
  "troubled-parent": { topics: ["family", "help"], gist: () => "", agency: "circumstance" },
  uprooted: { topics: ["crossing", "leaving"], gist: () => "", agency: "circumstance" },
};

/** The belief a hardship can leave when someone warm carried the child through it. */
const CARRIED: Omit<Schema, "id" | "origin"> = { text: "People pull together when it counts", triggers: ["food", "store", "help", "winter"], blameBias: -0.15, threatBias: -0.1, strength: 0.3 };

function suffer(child: MindState, ctx: SeasonContext, a: { kind: AdversityKind; buffered: boolean; who?: AgentId; text: string }): DevNote {
  const dev = child.dev!;
  const age = ctx.age;
  const adv: Adversity = { kind: a.kind, tick: ctx.now, age: Number(age.toFixed(1)), text: a.text, who: a.who, buffered: a.buffered };
  const earlier = dev.adversity.length;
  const mark = MARKS[a.kind];
  // Old enough to remember: it becomes a memory like any other, to be recalled, retold and passed on.
  if (age >= REMEMBERS_FROM) {
    const id = `ep_${child.id}_${a.kind}_${earlier + 1}`;
    const gist = mark.gist(ageWord(age)) || a.text.replace(/^Lost a parent, ([^,]+), (.+?) \((.+)\)\.$/, "$1 died when I was a child ($3).").replace(/^Lost the one who was raising \w+, ([^,]+), (.+?) \((.+)\)\.$/, "$1, who was raising me, died when I was a child ($3).").replace(/^Lost a sibling, ([^,]+), (.+?) \((.+)\)\.$/, "$1 died when we were children ($3).").replace(/^Raised with a hard hand by ([^,]+),.*$/, "$1 raised me with a hard hand.").replace(/^Grew up beside ([^']+)'s troubles.*$/, "$1 was not well, the years I was growing up.");
    child.episodes.push({
      ...episode({ id, tick: ctx.now, gist, template: "", about: a.who ? [a.who] : [], topics: mark.topics, valence: a.buffered ? -0.45 : -0.75, arousal: a.buffered ? 0.6 : 0.8, rehearsed: [], agency: mark.agency }),
      coping: a.buffered ? 0.5 : 0.2,
    });
    adv.episode = id;
    if (!a.buffered && mark.schema && !child.schemas.some((s) => s.text === mark.schema!.text)) {
      child.schemas.push({ ...mark.schema, triggers: [...mark.schema.triggers], id: `sch_${child.id}_${a.kind}`, origin: [id] });
    } else if (a.buffered && a.kind === "hunger" && dev.care.recent >= 0.68 && !child.schemas.some((s) => s.text === CARRIED.text)) {
      child.schemas.push({ ...CARRIED, triggers: [...CARRIED.triggers], id: `sch_${child.id}_carried`, origin: [id] });
    }
  }
  dev.adversity.push(adv);
  // The mark it leaves whether or not it is remembered (allostatic load: McEwen 1998).
  if (a.buffered) {
    child.affect.allostaticLoad = Number(clamp(child.affect.allostaticLoad + 0.005).toFixed(3));
    if (earlier < 2) {
      child.self.selfEfficacy = r2(clamp(child.self.selfEfficacy + 0.03));
      child.self.control = r2(clamp(child.self.control + 0.02));
      addRoot(dev, { target: "confidence", delta: 0.03, mechanism: "steeling", tick: ctx.now, age, text: `${a.text} Someone warm was there, and getting through it left ${child.pronouns.object} surer of ${child.pronouns.reflexive}.`, ref: adv.episode });
    }
  } else {
    child.affect.allostaticLoad = r2(clamp(child.affect.allostaticLoad + 0.04));
    dev.reactivity = r2(clamp(dev.reactivity + 0.04));
    child.self.control = r2(clamp(child.self.control - 0.03));
    child.self.selfEsteem = r2(clamp(child.self.selfEsteem - 0.02));
    const marks = dev.adversity.filter((x) => !x.buffered).length;
    if (marks <= 5) child.traits.neuroticism = Number(clamp(child.traits.neuroticism + 0.012, 0.05, 0.95).toFixed(3));
    addRoot(dev, { target: "confidence", delta: -0.05, mechanism: a.kind === "hunger" ? "hunger" : a.kind === "loss" ? "loss" : "care", tick: ctx.now, age, text: `${a.text} Nobody warm was there to carry ${child.pronouns.object} through it.`, ref: adv.episode, via: a.who ? { agent: a.who, name: ctx.caregivers.find((c) => c.mind.id === a.who)?.mind.name ?? a.who } : undefined });
  }
  // What it does to conscience.
  const m = dev.morals;
  const shift = (f: keyof Morals, d: number, text: string) => {
    m[f] = r2(clamp(m[f] + d, 0.05, 0.95));
    addRoot(dev, { target: f, delta: d, mechanism: a.kind === "hunger" ? "hunger" : a.kind === "loss" ? "loss" : "care", tick: ctx.now, age, text, ref: adv.episode });
  };
  if (a.kind === "hunger") shift("fairness", a.buffered ? 0.02 : 0.04, `${a.text} Has kept count of who has what ever since.`);
  if (a.kind === "hunger" && a.buffered) shift("care", 0.03, `${a.text} Was fed through it, and means others to be.`);
  if (a.kind === "loss") shift("sanctity", 0.03, `${a.text} The dead and their places matter to ${child.pronouns.object}.`);
  if (a.kind === "harsh" && !a.buffered) shift("liberty", 0.03, `${a.text} Will not be made to mind again.`);
  if (a.kind === "neglect") shift("loyalty", -0.04, `${a.text} Learned not to count on a "we".`);
  return { kind: "adversity", text: `${a.text}${a.buffered ? " Someone warm was there." : ""}` };
}

/** Childhood adversities that were not buffered: the ones that leave marks. */
export const toxicCount = (dev: Development) => dev.adversity.filter((a) => !a.buffered).length;

// ---------------------------------------------------------------- conscience, taken on

function socialize(child: MindState, ctx: SeasonContext, W: number, C: number): void {
  const dev = child.dev!;
  const { age } = ctx;
  if (age < 2) return;
  const m = dev.morals;
  const young = age < 12;
  const models = ctx.caregivers.filter((c) => c.mind.dev);
  const S = models.reduce((s, c) => s + c.weight * Math.max(0.1, c.care.warmth), 0);
  for (const f of FOUNDATIONS) {
    if (S > 0) {
      const target = models.reduce((s, c) => s + c.weight * Math.max(0.1, c.care.warmth) * c.mind.dev!.morals[f], 0) / S;
      const d = (young ? TEACHING : TEACHING / 2) * (0.2 + 1.5 * W) * (target - m[f]);
      if (Math.abs(d) >= 0.001) {
        m[f] = r2(clamp(m[f] + d, 0.05, 0.95));
        const from = [...models].sort((a, b) => b.weight * b.care.warmth * Math.abs(b.mind.dev!.morals[f] - m[f]) - a.weight * a.care.warmth * Math.abs(a.mind.dev!.morals[f] - m[f]))[0]!;
        if (Math.abs(d) >= 0.003) addRoot(dev, { target: f, delta: d, mechanism: "teaching", tick: ctx.now, age, text: `Took ${d > 0 ? "on" : "after"} ${from.mind.name}, who ${describe(f, from.mind.dev!.morals[f])}.`, via: { agent: from.mind.id, name: from.mind.name, cause: "values" } });
      }
    }
    if (!young && ctx.townMorals) {
      const d = 0.02 * (ctx.townMorals[f] - m[f]);
      if (Math.abs(d) >= 0.001) {
        m[f] = r2(clamp(m[f] + d, 0.05, 0.95));
        if (Math.abs(d) >= 0.003) addRoot(dev, { target: f, delta: d, mechanism: "town", tick: ctx.now, age, text: `Grew up among people who ${describe(f, ctx.townMorals[f])}${ctx.town ? ` (${ctx.town})` : ""}.` });
      }
    }
  }
  const hardest = [...ctx.caregivers].sort((a, b) => b.care.control - a.care.control)[0];
  if (!hardest) return;
  if (young && C > 0.5) {
    const d = 0.012 * (C - 0.3) * 4;
    m.authority = r2(clamp(m.authority + d, 0.05, 0.95));
    addRoot(dev, { target: "authority", delta: d, mechanism: "care", tick: ctx.now, age, text: `Learned early, from ${hardest.mind.name}, to do as told.`, via: { agent: hardest.mind.id, name: hardest.mind.name, cause: "upbringing", label: "a hard hand" } });
  } else if (!young && C >= 0.52 && W < 0.52) {
    m.liberty = r2(clamp(m.liberty + 0.015, 0.05, 0.95));
    m.authority = r2(clamp(m.authority - 0.012, 0.05, 0.95));
    addRoot(dev, { target: "liberty", delta: 0.015, mechanism: "rebellion", tick: ctx.now, age, text: `Pushed back against ${hardest.mind.name}'s hard hand once old enough to.`, via: { agent: hardest.mind.id, name: hardest.mind.name, cause: "upbringing", label: "a hard hand" } });
    addRoot(dev, { target: "authority", delta: -0.012, mechanism: "rebellion", tick: ctx.now, age, text: `Pushed back against ${hardest.mind.name}'s hard hand once old enough to.`, via: { agent: hardest.mind.id, name: hardest.mind.name, cause: "upbringing", label: "a hard hand" } });
  }
}

function describe(f: keyof Morals, level: number): string {
  const hi = level >= 0.5;
  switch (f) {
    case "care":
      return hi ? "can't see anyone go without" : "thinks people should look to themselves";
    case "fairness":
      return hi ? "keeps a close count of who gave and who took" : "doesn't keep count";
    case "loyalty":
      return hi ? "puts the town first" : "puts the household first";
    case "authority":
      return hi ? "does as elders and the law say" : "bristles at being told";
    case "sanctity":
      return hi ? "holds some things sacred" : "holds nothing sacred";
    default:
      return hi ? "will not be pushed around" : "goes along to keep the peace";
  }
}

// ---------------------------------------------------------------- stages

/** How a stage came out, from the care over it. Used for lived childhoods and for sketched ones. */
export function stageOutcome(name: StageName, w: { warmth: number; control: number; consistency: number; hunger: number }, t: MindState["traits"]): number {
  switch (name) {
    case "trust":
      return clamp(0.12 + 0.6 * w.warmth + 0.38 * w.consistency - 0.3 * w.hunger);
    case "autonomy":
      return clamp(0.45 + 0.45 * w.warmth - 0.8 * (w.control - 0.3));
    case "initiative":
      return clamp(0.4 + 0.4 * w.warmth - 0.55 * (w.control - 0.3) + 0.15 * (t.openness - 0.5));
    default:
      return clamp(0.3 + 0.4 * w.warmth + 0.25 * t.conscientiousness - 0.3 * w.hunger - 0.2 * (w.control - 0.3));
  }
}

const stageWords = (name: string, p: Pronouns): [string, string] =>
  (({
    trust: ["came to expect the world to answer", "learned early that the world may not answer"],
    autonomy: [`was let try things for ${p.reflexive}`, `was kept on a short rein, and doubts ${p.possessive} own judgement`],
    initiative: ["was let start things without being scolded for it", "learned that starting things brings trouble"],
    industry: [`found ${p.subject} ${wasOf(p)} good at things`, `came to think ${p.subject} ${wasOf(p)} not much good at things`],
  }) as Record<string, [string, string]>)[name]!;

function resolveStage(child: MindState, ctx: SeasonContext, name: StageName): DevNote {
  const dev = child.dev!;
  const w = dev.window;
  const nn = Math.max(1, w.seasons);
  const means = { warmth: w.warmth / nn, control: w.control / nn, consistency: w.consistency / nn, hunger: w.hunger / nn };
  const o = r2(stageOutcome(name, means, child.traits));
  const d = o - 0.55;
  const self = child.self;
  if (name === "trust") {
    self.selfEsteem = r2(clamp(self.selfEsteem + 0.15 * d));
    for (const other of Object.values(child.others)) if (other.bond < 0.5) other.trust.benevolence = r2(clamp(other.trust.benevolence + 0.2 * d));
  } else if (name === "autonomy") {
    child.needs.autonomy = r2(clamp(child.needs.autonomy + 0.3 * d));
    self.control = r2(clamp(self.control + 0.2 * d));
    dev.morals.liberty = r2(clamp(dev.morals.liberty + 0.1 * d, 0.05, 0.95));
  } else if (name === "initiative") {
    self.selfEfficacy = r2(clamp(self.selfEfficacy + 0.15 * d));
    child.traits.openness = Number(clamp(child.traits.openness + 0.04 * d, 0.05, 0.95).toFixed(3));
  } else {
    self.selfEfficacy = r2(clamp(self.selfEfficacy + 0.2 * d));
    child.needs.competence = r2(clamp(child.needs.competence + 0.2 * d));
    child.traits.conscientiousness = Number(clamp(child.traits.conscientiousness + 0.04 * d, 0.05, 0.95).toFixed(3));
  }
  const words = stageWords(name, child.pronouns)[o >= 0.55 ? 0 : 1];
  const main = Object.values(dev.care.by).sort((a, b) => b.seasons - a.seasons)[0];
  const why = `${words}${main ? ` (raised mostly by ${main.name}; warmth ${means.warmth.toFixed(2)}, hard hand ${means.control.toFixed(2)}${means.hunger > 0.1 ? ", and hunger" : ""})` : ""}`;
  dev.stages.push({ name, outcome: o, tick: ctx.now, why });
  if (Math.abs(d) >= 0.08 && name !== "trust") {
    const mainId = Object.entries(dev.care.by).sort((a, b) => b[1].seasons - a[1].seasons)[0];
    addRoot(dev, { target: "confidence", delta: 0.2 * d, mechanism: "care", tick: ctx.now, age: ctx.age, text: `${cap(words)}.`, via: mainId ? { agent: mainId[0], name: mainId[1].name, cause: "upbringing" } : undefined });
  }
  return { kind: "stage", text: `${cap(name)}: ${why}.` };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- one season of adult life

/**
 * Adults keep developing, slowly. A steady partner can undo an insecure start (earned security:
 * Roisman et al. 2002), a death can shake a secure one (Waters et al. 2000), identity settles or
 * comes open again, and the later Erikson stages close: intimacy, generativity, integrity.
 */
export function adultSeason(mind: MindState, ctx: SeasonContext): DevNote[] {
  const dev = mind.dev!;
  const notes: DevNote[] = [];
  const { age } = ctx;
  if (!dev.attachmentAt.grown) dev.attachmentAt.grown = { ...mind.attachment };
  const was = styleOf(mind.attachment);

  // What this season put on them settles in, and wears off over a year or so of better ones.
  dev.strain = r2(clamp(0.55 * dev.strain + 0.45 * strainOf(mind, ctx.stressors).fresh));

  const rate = plasticity(age);
  const p = ctx.partner;
  if (p) {
    const bond = mind.others[p.id]?.bond ?? 0.5;
    const steady = securityOf(p.attachment);
    if (steady > 0.55 && bond >= 0.5) {
      const dA = -rate * bond * (steady - 0.4) * Math.max(0, mind.attachment.anxiety - 0.2);
      const dV = -rate * bond * (steady - 0.4) * Math.max(0, mind.attachment.avoidance - 0.2);
      mind.attachment.anxiety = r2(clamp(mind.attachment.anxiety + dA));
      mind.attachment.avoidance = r2(clamp(mind.attachment.avoidance + dV));
      addRoot(dev, { target: "anxiety", delta: dA, mechanism: "partner", tick: ctx.now, age, text: `Years beside ${p.name}, who stays.`, via: { agent: p.id, name: p.name, cause: "attachment" } });
      addRoot(dev, { target: "avoidance", delta: dV, mechanism: "partner", tick: ctx.now, age, text: `Years beside ${p.name}, who stays.`, via: { agent: p.id, name: p.name, cause: "attachment" } });
    } else if (p.attachment.avoidance >= 0.6 && mind.attachment.anxiety < 0.9) {
      // The anxious-avoidant trap: a partner who pulls away makes the other hold on harder.
      const dA = rate * 0.6 * (p.attachment.avoidance - 0.5);
      mind.attachment.anxiety = r2(clamp(mind.attachment.anxiety + dA));
      addRoot(dev, { target: "anxiety", delta: dA, mechanism: "partner", tick: ctx.now, age, text: `${p.name} keeps ${mind.pronouns.object} at a distance.`, via: { agent: p.id, name: p.name, cause: "attachment" } });
    }
  }
  let crisis = ctx.crisis;
  for (const l of ctx.losses) {
    if (l.relation !== "partner" && l.relation !== "child") continue;
    const shake = l.relation === "partner" ? 0.07 : 0.05;
    mind.attachment.anxiety = r2(clamp(mind.attachment.anxiety + shake));
    addRoot(dev, { target: "anxiety", delta: shake, mechanism: "loss", tick: ctx.now, age, text: `${l.name} died (${l.cause}).`, via: { agent: l.who, name: l.name, cause: "absence" } });
    crisis ??= `${l.name} died`;
  }
  const now = styleOf(mind.attachment);
  if (was !== now && now === "secure") notes.push({ kind: "attachment", text: `Has come to feel safe with people (was ${was}).` });

  const line = identitySeason(mind, { now: ctx.now, age, role: ctx.role, partnered: !!p, parent: (ctx.children ?? 0) > 0, belonging: ctx.belonging ?? dev.identity.belonging, hardship: Math.max(0, ...ctx.stressors.filter((s) => s.kind === "hunger").map((s) => s.intensity)), crisis, town: ctx.town });
  if (line) notes.push({ kind: "identity", text: line });

  // Conscience keeps drifting toward the people one lives among, slowly.
  if (ctx.townMorals) for (const f of FOUNDATIONS) dev.morals[f] = r2(clamp(dev.morals[f] + 0.008 * (ctx.townMorals[f] - dev.morals[f]), 0.05, 0.95));

  const has = (n: StageName) => dev.stages.some((s) => s.name === n);
  if (!has("intimacy") && (age >= 30 || (p && age >= 22))) {
    const bond = p ? (mind.others[p.id]?.bond ?? 0.5) : 0;
    const o = r2(clamp(p ? 0.4 + 0.5 * bond - 0.2 * mind.attachment.avoidance : 0.3 - 0.2 * mind.attachment.avoidance + 0.2 * (ctx.belonging ?? 0.5)));
    dev.stages.push({ name: "intimacy", outcome: o, tick: ctx.now, why: p ? `made a life with ${p.name}` : "has made a life alone" });
  }
  if (!has("generativity") && age >= 50) {
    const par = dev.parenting;
    const o = r2(clamp(0.3 + (par ? 0.25 + 0.3 * (par.warmth - 0.5) : 0) + 0.15 * dev.identity.belonging + 0.1 * (dev.morals.care - 0.5)));
    dev.stages.push({ name: "generativity", outcome: o, tick: ctx.now, why: par ? `raised children (${par.seasons} seasons of it)` : "raised no children" });
    mind.self.selfEsteem = r2(clamp(mind.self.selfEsteem + 0.1 * (o - 0.5)));
  }
  if (!has("integrity") && age >= 65) {
    const gen = dev.stages.find((s) => s.name === "generativity")?.outcome ?? 0.5;
    const o = r2(clamp(0.5 + 0.4 * dev.identity.narrative.tone + 0.3 * (gen - 0.5)));
    dev.stages.push({ name: "integrity", outcome: o, tick: ctx.now, why: o >= 0.5 ? "looks back on a life that adds up" : "looks back and wishes it had gone otherwise" });
    mind.self.selfEsteem = r2(clamp(mind.self.selfEsteem + 0.12 * (o - 0.5)));
  }
  if (ctx.newYear) narrativeYear(mind);
  dev.lastTurn = ctx.now;
  return notes;
}

/** A caregiver's own running record of how they parent, kept for the cycle and for the Roots view. */
export function noteParenting(caregiver: MindState, care: Caregiving): void {
  const dev = caregiver.dev;
  if (!dev) return;
  const p = (dev.parenting ??= { warmth: care.warmth, control: care.control, seasons: 0 });
  p.warmth = r2(p.warmth + (care.warmth - p.warmth) / (p.seasons + 1));
  p.control = r2(p.control + (care.control - p.control) / (p.seasons + 1));
  p.seasons++;
}

// ---------------------------------------------------------------- adults who arrive with a past

/**
 * Sketch a childhood for someone rolled as an adult (the founders, newcomers off a boat, lab
 * volunteers). Their attachment and temperament were already rolled; this works backwards to the
 * care that would have produced them, reads their conscience off temperament and what their
 * formative past taught them, and places them somewhere on the way to an identity. It draws only
 * from keyed randomness, so the roll that made the person is untouched.
 */
export function backfill(mind: MindState, o: { seed: number; now: Tick; age: number; role?: string; town?: string; belonging?: number }): void {
  if (mind.dev) return;
  const dev = blankDevelopment(o.now, false);
  const g = (k: string) => keyedGaussian(o.seed, 0, `past|${mind.id}|${k}`);
  const a: Attachment = mind.attachment;
  const t = mind.traits;
  dev.reactivity = r2(clamp(0.25 + 0.5 * t.neuroticism + 0.12 * g("react"), 0.05, 0.95));
  const consistency = clamp(1 - (a.anxiety - 0.1) / 1.15 + 0.06 * g("cons"), 0.1, 0.95);
  const warmth = clamp(0.66 + 0.25 * (0.4 - a.avoidance) - 0.5 * Math.max(0, a.avoidance - 0.35) + 0.05 * g("warm"), 0.1, 0.95);
  const control = clamp(0.27 + 0.4 * Math.max(0, a.avoidance - 0.4) + 0.1 * Math.abs(g("ctrl")), 0.05, 0.9);
  dev.care = { warmth: r2(warmth), consistency: r2(consistency), control: r2(control), recent: r2(warmth), wobble: r2((1 - consistency) / 3), seasons: 0, by: {} };
  const w = { warmth, control, consistency, hunger: 0 };
  for (const [name] of STAGES) dev.stages.push({ name, outcome: r2(stageOutcome(name, w, t)), tick: o.now, why: `from before ${mind.pronouns.subject} came, as far as the record goes` });
  dev.attachmentAt.grown = { ...a };

  dev.morals = innateMorals(t, (f) => g(`moral.${f}`), 0.1);
  for (const s of mind.schemas) {
    const origin = mind.episodes.find((e) => e.id === s.origin?.[0]);
    for (const [f, d] of Object.entries(moralsFromSchema(s)) as [keyof Morals, number][]) {
      dev.morals[f] = r2(clamp(dev.morals[f] + d, 0.05, 0.95));
      addRoot(dev, { target: f, delta: d, mechanism: "before", tick: origin?.tick ?? o.now, age: o.age, text: origin ? `After “${origin.gist}”` : `From the belief “${s.text}”`, ref: origin?.id });
    }
    // A formative blow that fell in childhood counts as one.
    if (origin && s.blameBias + s.threatBias > 0 && origin.source.kind !== "told") {
      const yearsAgo = (o.now - origin.tick) / (365 * 1440);
      const then = o.age - yearsAgo;
      if (then < GROWN) dev.adversity.push({ kind: origin.topics.includes("hunger") ? "hunger" : "harsh", tick: origin.tick, age: Number(Math.max(0, then).toFixed(1)), text: origin.gist, episode: origin.id, buffered: warmth >= 0.6 });
    }
  }
  const style = styleOf(a);
  if (style !== "secure") {
    if (a.anxiety >= 0.5) addRoot(dev, { target: "anxiety", delta: a.anxiety - 0.3, mechanism: "before", tick: o.now, age: o.age, text: "Came already watchful of being left. The record of why starts here." });
    if (a.avoidance >= 0.5) addRoot(dev, { target: "avoidance", delta: a.avoidance - 0.3, mechanism: "before", tick: o.now, age: o.age, text: "Came already keeping people at a distance. The record of why starts here." });
  }

  const i = dev.identity;
  const years = Math.max(0, Math.min(1, (o.age - 12) / 10));
  i.explored = r2(clamp((0.15 + 0.95 * t.openness - 0.5 * Math.max(0, control - 0.35)) * years + 0.12 * g("expl")));
  i.exploration = r2(clamp(o.age < 24 ? 0.18 + 0.6 * t.openness : 0.1 + 0.25 * t.openness));
  i.commitment = r2(clamp(0.2 + 0.3 * t.conscientiousness + 0.22 * Math.min(1, Math.max(0, o.age - 16) / 14) + 0.3 * Math.max(0, control - 0.35) + 0.1 * g("comm")));
  i.status = statusOf(i);
  i.belonging = r2(o.belonging ?? 0.35);
  i.history.push({ tick: o.now, age: o.age, status: i.status, why: `as ${mind.pronouns.subject} ${wasOf(mind.pronouns)} when ${mind.pronouns.subject} came` });
  if (i.commitment >= 0.5 && o.role) i.commitments.push({ kind: "trade", text: `being a ${o.role}`, since: o.now });
  mind.dev = dev;
  i.narrative = narrate(mind);
}

/** Mean conscience of a set of minds (a town's adults). */
export function meanMorals(minds: MindState[]): Morals | undefined {
  const xs = minds.filter((m) => m.dev);
  if (!xs.length) return undefined;
  return Object.fromEntries(FOUNDATIONS.map((f) => [f, r2(mean(xs.map((m) => m.dev!.morals[f])))])) as Morals;
}
