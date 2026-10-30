// Seeded PRNG (mulberry32). Its 32-bit state lives inside the state it drives (a mind, or the world)
// so replays reproduce every draw.

export interface Rng {
  rng: number;
}

export function nextRandom(mind: Rng): number {
  let t = (mind.rng = (mind.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Standard normal via Box-Muller. */
export function gaussian(mind: Rng): number {
  const u = Math.max(nextRandom(mind), 1e-12);
  const v = nextRandom(mind);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Logistic noise with scale s, as ACT-R uses for activation noise. */
export function logisticNoise(mind: Rng, s: number): number {
  const u = Math.min(Math.max(nextRandom(mind), 1e-9), 1 - 1e-9);
  return s * Math.log(u / (1 - u));
}

export function nextId(mind: { idCounter: number }, prefix: string): string {
  mind.idCounter += 1;
  return `${prefix}_${mind.idCounter}`;
}
