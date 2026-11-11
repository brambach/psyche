// Shared pieces for the development code: a blank record, and the bookkeeping that keeps each
// change tied to its cause.

import { keyedRandom } from "../rng.js";
import type { MindState, Pronouns, Tick } from "../types.js";
import { FOUNDATIONS, type Development, type Morals, type Root } from "./types.js";

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const r2 = (x: number) => Number(x.toFixed(3));

/** Most roots a record keeps. The weakest are dropped first. */
const MAX_ROOTS = 36;

export function neutralMorals(): Morals {
  return Object.fromEntries(FOUNDATIONS.map((f) => [f, 0.5])) as Morals;
}

export function blankDevelopment(now: Tick, lived: boolean): Development {
  return {
    lived,
    reactivity: 0.5,
    care: { warmth: 0.6, consistency: 0.7, control: 0.3, recent: 0.6, wobble: 0.09, seasons: 0, by: {} },
    adversity: [],
    stages: [],
    attachmentAt: {},
    identity: {
      exploration: 0.1,
      explored: 0,
      commitment: 0.1,
      status: "diffused",
      commitments: [],
      belonging: 0.5,
      narrative: { tone: 0, redemption: 0, contamination: 0, theme: "neither", line: "" },
      history: [],
    },
    morals: neutralMorals(),
    roots: [],
    strain: 0,
    window: { warmth: 0, control: 0, consistency: 0, hunger: 0, seasons: 0, stage: 0 },
    runs: { harsh: 0, cold: 0, troubled: 0 },
    lastTurn: now,
  };
}

/** "was" or "were", to go after someone's subject pronoun. */
export const wasOf = (p: Pronouns): string => (p.subject === "they" ? "were" : "was");

/**
 * Record a cause. Seasons of the same cause (same target, mechanism, person and reason) add up into
 * one root, so twelve years of a mother's steady care is one line, not forty-eight.
 */
export function addRoot(dev: Development, r: Omit<Root, "from" | "to" | "ages"> & { tick: Tick; age: number }): void {
  if (Math.abs(r.delta) < 1e-4) return;
  const same = dev.roots.find((x) => x.target === r.target && x.mechanism === r.mechanism && x.via?.agent === r.via?.agent && x.via?.cause === r.via?.cause && x.ref === r.ref && Math.sign(x.delta) === Math.sign(r.delta));
  if (same) {
    same.delta = r2(same.delta + r.delta);
    same.to = r.tick;
    same.ages = [same.ages[0], Number(r.age.toFixed(1))];
    return;
  }
  const { tick, age, ...rest } = r;
  dev.roots.push({ ...rest, delta: r2(r.delta), from: tick, to: tick, ages: [Number(age.toFixed(1)), Number(age.toFixed(1))] });
  if (dev.roots.length > MAX_ROOTS) {
    let weakest = 0;
    for (let i = 1; i < dev.roots.length; i++) if (Math.abs(dev.roots[i]!.delta) < Math.abs(dev.roots[weakest]!.delta)) weakest = i;
    dev.roots.splice(weakest, 1);
  }
}

/** A standard normal that depends only on the seed and what it is for. Never touches a mind's or the world's own stream. */
export function keyedGaussian(seed: number, tick: number, key: string): number {
  const u = Math.max(keyedRandom(seed, tick, `${key}|u`), 1e-12);
  const v = keyedRandom(seed, tick, `${key}|v`);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Is this part of the deeper psychology switched on for this mind? Older saves have no flag: on. */
export function enabled(mind: MindState, flag: "attachmentSystem" | "moralFoundations" | "identityFormation"): boolean {
  return !!mind.dev && (mind.ablations as unknown as Record<string, unknown>)[flag] !== false;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
