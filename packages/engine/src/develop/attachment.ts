// Attachment (Bowlby 1969; Ainsworth, Blehar, Waters & Wall 1978).
//
// A small child works out two things from how they are looked after: whether they are worth
// answering (the model of self, felt later as attachment anxiety) and whether other people can be
// counted on to answer (the model of others, felt later as avoidance). Steady, warm care gives a
// secure child. Care that comes and goes gives an anxious, clinging one (Cassidy & Berlin 1994).
// Care that is reliably cool or pushes the child away gives an avoidant one (Ainsworth et al. 1978).
// Frightening or broken care gives both at once (Main & Solomon 1990).
//
// The two dimensions are the engine's existing MindState.attachment (Brennan, Clark & Shaver 1998).
// What is new is where they come from: the caregiving a child actually received, which came from
// what their caregivers were carrying that season. Nothing here copies a parent's attachment into
// the child. A parent's attachment shapes how they give care, and the care shapes the child
// (van IJzendoorn 1995; Verhage et al. 2016).

import type { Attachment, MindState, Schema } from "../types.js";
import { clamp } from "./core.js";
import type { AttachmentStyle, RootCause } from "./types.js";

/** At or above this on a dimension counts as insecure on it. */
export const INSECURE = 0.5;

export function styleOf(a: Attachment): AttachmentStyle {
  const anx = a.anxiety >= INSECURE;
  const avo = a.avoidance >= INSECURE;
  return anx && avo ? "fearful" : anx ? "anxious" : avo ? "avoidant" : "secure";
}

export const isSecure = (a: Attachment) => styleOf(a) === "secure";

/** Felt security, 0 to 1: far from both kinds of insecurity. */
export const securityOf = (a: Attachment) => clamp(1 - (Math.max(a.anxiety, a.avoidance) * 0.6 + Math.min(a.anxiety, a.avoidance) * 0.4));

/**
 * The Strange Situation's three-way call (Ainsworth et al. 1978): B secure, A avoidant, C resistant.
 * A child insecure on both dimensions is put with whichever is stronger, as coders forced to choose do.
 */
export function strangeSituation(a: Attachment): "secure" | "avoidant" | "resistant" {
  if (a.anxiety < INSECURE && a.avoidance < INSECURE) return "secure";
  return a.avoidance >= a.anxiety ? "avoidant" : "resistant";
}

export const STYLE_TEXT: Record<AttachmentStyle, string> = {
  secure: "Secure: expects to be answered, and can be alone without it meaning anything",
  anxious: "Anxious: wants closeness and watches for signs of losing it",
  avoidant: "Avoidant: leans on nobody, and keeps people at a distance",
  fearful: "Fearful: wants closeness and expects to be hurt by it",
};

// ---------------------------------------------------------------- what a caregiver is carrying

/** Something bearing down on a household this season. */
export interface Stressor {
  kind: "hunger" | "cold" | "grief" | "hardship";
  /** 0 to 1. */
  intensity: number;
  /** What it touches, matched against core-belief triggers. */
  topics: string[];
  text: string;
}

export interface StrainPart {
  cause: RootCause;
  label: string;
  amount: number;
}

const threatOf = (s: Schema) => Math.max(0, s.threatBias) * s.strength;
const darkOf = (s: Schema) => Math.max(0, s.blameBias + s.threatBias) * s.strength;

/**
 * How strained someone is this season, and from what. A hardship lands harder on someone whose
 * core beliefs it confirms: a hungry winter is worse for the one who learned, long ago, that
 * hunger means being abandoned. This is the first link by which an old injury reaches a child.
 */
export function strainOf(mind: MindState, stressors: Stressor[]): { strain: number; fresh: number; parts: StrainPart[] } {
  const parts: StrainPart[] = [];
  const carried = 0.4 * mind.affect.stress + 0.6 * mind.affect.allostaticLoad + 0.5 * (mind.dev?.strain ?? 0);
  if (carried > 0.02) parts.push({ cause: "strain:carried", label: "worn down by the seasons before", amount: carried });
  const coping = clamp(mind.self.selfEfficacy * 0.6 + mind.self.control * 0.4);
  for (const s of stressors) {
    const hit = s.intensity * 0.55 * (1.25 - coping);
    parts.push({ cause: `strain:${s.kind}`, label: s.text, amount: hit });
    for (const sc of mind.schemas) {
      const t = threatOf(sc);
      if (t <= 0 || !sc.triggers.some((x) => s.topics.includes(x))) continue;
      parts.push({ cause: `schema:${sc.id}`, label: `${s.text}, and it woke an old belief: “${sc.text}”`, amount: s.intensity * 1.6 * t * (1.25 - coping) });
    }
  }
  const fresh = parts.filter((p) => p.cause !== "strain:carried").reduce((s, p) => s + p.amount, 0);
  return { strain: clamp(parts.reduce((s, p) => s + p.amount, 0)), fresh: clamp(fresh), parts };
}

// ---------------------------------------------------------------- caregiving

/** How much warmth one standard deviation of fit between a caregiver and a child is worth (tuned). */
const FIT = 0.06;

export interface CarePart {
  cause: RootCause;
  label: string;
  /** Signed push on warmth. */
  warmth: number;
  /** Signed push on harshness and control. */
  control: number;
  /** Added unsteadiness. */
  wobble: number;
}

export interface Caregiving {
  warmth: number;
  control: number;
  /** How much this caregiver's warmth swings from season to season (sd). */
  wobble: number;
  parts: CarePart[];
  strain: number;
  /** The part of the strain that is this season's, not carried over. */
  fresh: number;
}

/**
 * How one person looks after a child this season, and why. Sensitivity comes from temperament, the
 * caregiver's own attachment (dismissing parents are less responsive, preoccupied parents less
 * steady: van IJzendoorn 1995), what they are under (the family stress model: Conger et al. 1994),
 * core beliefs they have never laid to rest (Main & Hesse 1990), and how they were raised themselves
 * (Kaufman & Zigler 1987; Belsky 1993). `draw` is a standard normal for this caregiver and season.
 * `fit` is a standard normal fixed for this caregiver and this child: some pairs suit each other and
 * some don't, for reasons nobody can name (goodness of fit: Thomas & Chess 1977). It is most of why
 * a parent's attachment predicts a child's only modestly (the transmission gap: van IJzendoorn 1995).
 */
export function caregiving(c: MindState, stressors: Stressor[], kids: number, draw: number, fit = 0): Caregiving {
  const t = c.traits;
  const a = c.attachment;
  const d = c.dev;
  const parts: CarePart[] = [];
  const part = (cause: RootCause, label: string, warmth: number, control = 0, wobble = 0) => {
    if (Math.abs(warmth) + Math.abs(control) + Math.abs(wobble) > 0.004) parts.push({ cause, label, warmth, control, wobble });
  };

  part(
    "temperament",
    t.agreeableness >= 0.5 ? "a warm temperament" : "a hard temperament",
    0.36 * (t.agreeableness - 0.5) + 0.08 * (t.conscientiousness - 0.5) - 0.12 * (t.neuroticism - 0.5),
    0.5 * (0.5 - t.agreeableness) + 0.12 * (t.conscientiousness - 0.5),
    0.1 * Math.max(0, t.neuroticism - 0.5),
  );
  const secure = a.anxiety < 0.4 && a.avoidance < 0.4;
  const self = c.pronouns.reflexive;
  const lean = a.avoidance - 0.3 >= a.anxiety - 0.3 ? "avoidance" : "anxiety";
  part(
    "attachment",
    secure
      ? `secure ${self}, and easy with a child's need`
      : lean === "avoidance"
        ? a.avoidance >= INSECURE ? `uneasy with closeness ${self}` : `a little distant ${self}`
        : a.anxiety >= INSECURE ? `anxious ${self}, and unsteady with it` : `a little anxious ${self}, and not always steady`,
    (secure ? 0.07 : 0) - 0.4 * Math.max(0, a.avoidance - 0.3) - 0.12 * Math.max(0, a.anxiety - 0.4),
    0.1 * Math.max(0, a.avoidance - 0.4),
    0.34 * Math.max(0, a.anxiety - 0.3),
  );
  const { strain, fresh, parts: strains } = strainOf(c, stressors);
  for (const s of strains) part(s.cause, s.label, -0.5 * s.amount, 0.45 * s.amount, 0.15 * s.amount);
  // Old injuries weigh a little even in a good season (unresolved loss and trauma: Main & Hesse 1990).
  for (const sc of c.schemas) {
    const dark = darkOf(sc);
    if (dark > 0.05) part(`schema:${sc.id}`, `carries the belief “${sc.text}”`, -0.14 * dark, 0.12 * dark, 0.05 * dark);
    else if (sc.blameBias + sc.threatBias < 0) part(`schema:${sc.id}`, `carries the belief “${sc.text}”`, 0.1 * -(sc.blameBias + sc.threatBias) * sc.strength, 0, 0);
  }
  if (d) {
    part("values", d.morals.care >= 0.5 ? "holds that the weak are to be cared for" : "holds that children must be made to mind", 0.16 * (d.morals.care - 0.5), 0.45 * (d.morals.authority - 0.5) - 0.14 * (d.morals.care - 0.5));
    if (d.care.seasons > 0 || !d.lived) {
      // People parent as they were parented, unless they have come to terms with it (earned security:
      // Roisman, Padrón, Sroufe & Egeland 2002; an achieved identity stands in for having thought it through).
      const worked = (secure ? 0.5 : 1) * (d.identity.status === "achieved" ? 0.6 : 1);
      const w = 0.22 * (d.care.warmth - 0.6);
      const k = 0.4 * (d.care.control - 0.3);
      part("upbringing", k > 0.05 || w < -0.03 ? `raised hard ${self}` : `raised gently ${self}`, w < 0 ? w * worked : w, k > 0 ? k * worked : k);
    }
  }
  if (kids > 2) part("absence", `${kids} children to look after`, -0.04 * (kids - 2), 0, 0);
  if (fit) part("fit", fit > 0 ? "an easy fit with this child" : "a poor fit with this child", FIT * fit, -0.4 * FIT * fit, 0);

  const wobble = clamp(0.06 + parts.reduce((s, p) => s + p.wobble, 0), 0.03, 0.4);
  return {
    warmth: clamp(0.64 + parts.reduce((s, p) => s + p.warmth, 0) + draw * wobble),
    control: clamp(0.27 + parts.reduce((s, p) => s + p.control, 0)),
    wobble,
    parts,
    strain,
    fresh,
  };
}

// ---------------------------------------------------------------- what care teaches

/** How fast attachment moves at this age, per season: fastest in the first two years, never zero (Fraley 2002). */
export function plasticity(age: number): number {
  return age < 2 ? 0.26 : age < 6 ? 0.11 : age < 12 ? 0.055 : age < 17 ? 0.035 : 0.012;
}

/**
 * Where the care a child is getting pulls their attachment. Unsteady care raises anxiety; cold or
 * controlling care raises avoidance.
 */
export function attachmentTargets(care: { recent: number; consistency: number; control: number }): Attachment {
  return {
    anxiety: clamp(0.09 + 1.1 * (1 - care.consistency) + 0.3 * Math.max(0, 0.5 - care.recent)),
    avoidance: clamp(0.1 + 3.3 * Math.max(0, 0.62 - care.recent) + 0.35 * Math.max(0, care.control - 0.45)),
  };
}
