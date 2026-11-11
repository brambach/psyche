// Moral foundations (Haidt & Joseph 2004; Graham, Haidt & Nosek 2009; Graham et al. 2011).
//
// People do not differ much in whether they have a conscience. They differ in what it is about:
// harm, cheating, betrayal, disobedience, defilement, being pushed around. Each foundation is a
// sensitivity, 0 to 1, and a choice that upholds or breaks one pulls on a person in proportion to
// how far they sit from the middle on it. So the terms below are zero for the typical person and
// only tell people apart; the engine's other terms (agreeableness, the courtesy norm) still carry
// what everyone shares.
//
// Where a person's foundations come from: a temperamental lean (the Big Five correlates of the
// Moral Foundations Questionnaire: Hirsh, DeYoung, Xu & Peterson 2010; Lewis & Bates 2011), then
// the people who raised them, taken on more fully from warm parents than cold ones (Grusec &
// Goodnow 1994; Kochanska 2002), then the town they grew up in (Harris 1995), then what happened
// to them.

import type { ActionOption, Percept } from "../ports.js";
import type { MindState, Schema, Traits } from "../types.js";
import { clamp } from "./core.js";
import { FOUNDATIONS, type Foundation, type Morals } from "./types.js";

/** How hard conscience pulls on a choice, at most (tuned). */
const WEIGHT = 0.3;

/** The middle of the range each trait is rolled from (world/people.ts). */
const TYPICAL: Traits = { openness: 0.525, conscientiousness: 0.575, extraversion: 0.525, agreeableness: 0.55, neuroticism: 0.5, honesty: 0.625 };

/** The lean someone is born with, from temperament. `noise` gives one standard normal per foundation. */
export function innateMorals(t: Traits, noise: (f: Foundation) => number, spread = 0.08): Morals {
  // Each trait is taken against what is typical among the people of this world (the middle of the
  // range settlers are rolled from), so the typical person comes out at 0.5 on every foundation.
  const A = t.agreeableness - TYPICAL.agreeableness;
  const C = t.conscientiousness - TYPICAL.conscientiousness;
  const E = t.extraversion - TYPICAL.extraversion;
  const O = t.openness - TYPICAL.openness;
  const N = t.neuroticism - TYPICAL.neuroticism;
  const H = t.honesty - TYPICAL.honesty;
  const base: Morals = {
    care: 0.5 + 0.55 * A + 0.15 * N + 0.1 * H,
    fairness: 0.5 + 0.4 * H + 0.2 * A + 0.1 * O,
    loyalty: 0.5 + 0.25 * E + 0.25 * C - 0.2 * O + 0.1 * A,
    authority: 0.5 + 0.4 * C - 0.4 * O + 0.1 * A,
    sanctity: 0.5 - 0.35 * O + 0.2 * C + 0.15 * N,
    liberty: 0.5 + 0.35 * O - 0.25 * A + 0.1 * E,
  };
  for (const f of FOUNDATIONS) base[f] = Number(clamp(base[f] + noise(f) * spread, 0.05, 0.95).toFixed(3));
  return base;
}

/**
 * What a core belief does to conscience. Being cheated makes a person watch for cheating and trust
 * the group less; being carried through a hard time by others does the opposite.
 */
export function moralsFromSchema(s: Schema): Partial<Morals> {
  const dark = s.blameBias + s.threatBias;
  const k = Math.abs(dark) * s.strength;
  const has = (...xs: string[]) => xs.some((x) => s.triggers.includes(x));
  const out: Partial<Morals> = {};
  if (dark > 0) {
    if (has("fairness", "money", "trust")) out.fairness = 0.5 * k;
    if (has("help", "store", "trust")) out.loyalty = -0.35 * k;
    if (has("help", "house", "build")) out.liberty = 0.3 * k;
    if (has("death", "grief")) out.sanctity = 0.25 * k;
  } else if (dark < 0) {
    out.care = 0.4 * k;
    out.loyalty = 0.5 * k;
  }
  return out;
}

// ---------------------------------------------------------------- reading a choice

const WELFARE = ["help", "hunger", "food", "grief", "child", "sick", "shelter", "death", "family"];
const FAIR = ["fairness", "debt", "trade", "money", "share"];
const GROUP = ["store", "village", "town", "founding", "crossing", "works", "norm"];
const RULE = ["law", "order", "leader", "vote", "elder"];
const SACRED = ["faith", "grave", "sacred", "rite", "heresy", "founding"];

/**
 * How far taking this option upholds (+) or breaks (-) each foundation. An option can say so itself
 * (ActionOption.moral); otherwise it is read off what the option does and what the moment is about.
 */
export function moralReading(mind: MindState, p: Percept, opt: ActionOption): Partial<Morals> {
  if (opt.moral) return opt.moral;
  const has = (xs: string[]) => xs.some((x) => p.topics.includes(x));
  const out: Partial<Morals> = {};
  const P = opt.prosocial;
  out.care = P * (has(WELFARE) ? 0.8 : 0.35);
  let fairness = has(FAIR) ? P * 0.6 : 0;
  // Someone has broken a rule: standing up to it is the fair thing, letting it pass is not.
  if (p.features.normViolation > 0.2 && p.features.agency === "other") fairness += opt.assertive * 0.5 - Math.max(0, P) * 0.3;
  if (fairness) out.fairness = fairness;
  if (has(GROUP)) out.loyalty = (opt.comply ? 0.5 : 0) + P * 0.4;
  const actor = mind.others[p.actor];
  const asked = p.addressedToSelf && (!!p.request || has(RULE));
  if (asked && (has(RULE) || (actor && actor.trust.ability >= 0.7))) out.authority = opt.comply ? 0.7 : -0.4 * Math.max(opt.assertive, opt.avoidant * 0.5);
  if (has(SACRED)) out.sanctity = P * 0.3 + (opt.comply ? 0.3 : 0);
  if (p.addressedToSelf && p.request) out.liberty = opt.comply ? -0.25 : opt.assertive * 0.5;
  return out;
}

/**
 * Conscience as terms in an option's score: one per foundation the option touches. `firmness`
 * (from identity) is how much a person's values count against the pull of the moment.
 */
export function moralTerms(mind: MindState, p: Percept, opt: ActionOption, firmness: number): { name: string; value: number; ref: string }[] {
  const m = mind.dev!.morals;
  const reading = moralReading(mind, p, opt);
  const out: { name: string; value: number; ref: string }[] = [];
  for (const f of FOUNDATIONS) {
    const r = reading[f];
    if (!r) continue;
    const value = WEIGHT * r * (m[f] - 0.5) * 2 * (0.6 + 0.8 * firmness);
    if (Math.abs(value) >= 0.004) out.push({ name: `conscience: ${f}`, value, ref: `dev:moral.${f}` });
  }
  return out;
}

/** Which foundation someone else's wrong offends, from what the moment is about. */
export function offended(p: Percept): Foundation {
  const has = (xs: string[]) => xs.some((x) => p.topics.includes(x));
  if (has(SACRED)) return "sanctity";
  if (has(FAIR)) return "fairness";
  if (has(GROUP)) return "loyalty";
  if (has(RULE)) return "authority";
  return p.features.outcomeForSelf < -0.2 ? "care" : "fairness";
}

/**
 * Moral outrage: a broken norm is blamed harder by someone who holds that foundation dear, and let
 * go more easily by someone who doesn't (Graham et al. 2009).
 */
export function moralBlame(mind: MindState, p: Percept): { value: number; foundation: Foundation } | undefined {
  if (p.features.agency !== "other" || p.features.normViolation <= 0) return undefined;
  const foundation = offended(p);
  const value = p.features.normViolation * 0.5 * (mind.dev!.morals[foundation] - 0.5) * 2;
  return Math.abs(value) > 0.01 ? { value, foundation } : undefined;
}

export const FOUNDATION_TEXT: Record<Foundation, [string, string]> = {
  care: ["Can't stand to see anyone go without", "Thinks people should look to themselves"],
  fairness: ["Keeps a close count of who gave and who took", "Doesn't keep count"],
  loyalty: ["Puts the town before the household", "Puts the household before the town"],
  authority: ["Does as elders and the law say", "Bristles at being told"],
  sanctity: ["Holds some things sacred", "Holds nothing sacred"],
  liberty: ["Will not be pushed around", "Goes along to keep the peace"],
};

/** The two or three things this person's conscience is most about, in words. */
export function moralPortrait(m: Morals): string[] {
  return [...FOUNDATIONS]
    .map((f) => ({ f, d: m[f] - 0.5 }))
    .filter((x) => Math.abs(x.d) >= 0.12)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 3)
    .map((x) => FOUNDATION_TEXT[x.f][x.d > 0 ? 0 : 1]);
}
