// The whole coast as blocks, shared by the live 3D view and the recorded century: where each town
// sits, its houses and tents in spiral slots, woods inland, and the path a boat takes between quays.

import { MATERIALS, type Timeline } from "@psyche/engine";
import { shore, sitePoint } from "./coastMap";

export const W = 360, D = 190, H = 20, SEA = 4;
const m = (name: string) => MATERIALS.indexOf(name as never);
const [GRASS, DIRT, STONE, SAND, WATER, LOG, LEAVES, PLANK, THATCH, CANVAS, COBBLE] = ["grass", "dirt", "stone", "sand", "water", "log", "leaves", "plank", "thatch", "canvas", "cobble"].map(m) as [number, number, number, number, number, number, number, number, number, number, number];

export const hash = (n: number) => {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};
export const strHash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

export interface TownNow {
  id: string;
  name: string;
  from?: string;
  people: number;
  houses: number;
  tents: number;
  x: number;
  z: number;
  /** The water's edge below the town, where its boats put in. */
  quay: { x: number; z: number };
}

/** The towns standing in year index `i` (the last year by default). */
export function townsAt(t: Timeline, seed: number, i = t.years.length - 1): TownNow[] {
  return t.towns
    .filter((x) => x.people[i] !== null && x.people[i] !== undefined)
    .map((x) => {
      const p = sitePoint(x.site, seed);
      const tx = p.x * W, tz = p.y * D;
      return { id: x.id, name: x.name, from: x.from, people: x.people[i] ?? 0, houses: x.houses[i] ?? 0, tents: x.tents[i] ?? 0, x: tx, z: tz, quay: { x: tx, z: shore(p.x, seed) * D + 3 } };
    });
}

/** Spiral slots round a town's centre, so a town grows outward and old houses never move. */
function slot(k: number, salt: number): { dx: number; dz: number } {
  const a = k * 2.399963 + hash(salt) * 6.28;
  const r = 2.4 * Math.sqrt(k + 1.2);
  return { dx: Math.cos(a) * r * 1.2, dz: Math.sin(a) * r * 0.85 };
}

/** The coast as blocks: land rising from the shore, woods, and every town's houses and tents. */
export function buildCoast(towns: TownNow[], seed: number): Uint8Array {
  const cells = new Uint8Array(W * D * H);
  const at = (x: number, y: number, z: number) => x + z * W + y * W * D;
  const put = (x: number, y: number, z: number, b: number) => {
    if (x >= 0 && z >= 0 && y >= 0 && x < W && z < D && y < H) cells[at(x, y, z)] = b;
  };
  const ground = new Int16Array(W * D);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const edge = shore(x / W, seed) * D;
      let top: number;
      if (z > edge) top = SEA - 1 - Math.min(3, Math.floor((z - edge) / 4));
      else {
        const roll = Math.sin(x * 0.05 + seed) * 1.2 + Math.sin(z * 0.08 + x * 0.02) * 1.1 + Math.sin((x - z) * 0.03) * 1.5;
        top = Math.min(H - 6, Math.floor(SEA + 1 + (edge - z) / 16 + roll));
        top = Math.max(SEA, top);
      }
      // Flat ground for each town.
      for (const t of towns) {
        const r = 7 + Math.sqrt(t.houses + t.tents) * 3;
        if (Math.hypot((x - t.x) / 1.2, (z - t.z) / 0.85) < r) top = Math.max(SEA + 1, Math.min(top, Math.floor(SEA + 1 + (shore(t.x / W, seed) * D - t.z) / 16)));
      }
      ground[x + z * W] = top;
      for (let y = 0; y <= top; y++) cells[at(x, y, z)] = y === top ? (top <= SEA ? SAND : GRASS) : y >= top - 2 ? (top <= SEA ? SAND : DIRT) : STONE;
      for (let y = top + 1; y < SEA; y++) cells[at(x, y, z)] = WATER;
    }
  // Woods inland, kept off the towns.
  for (let k = 0; k < 900; k++) {
    const x = Math.floor(hash(seed * 1000 + k) * W), z = Math.floor(hash(seed * 1000 + k + 77777) * D);
    const top = ground[x + z * W]!;
    if (top <= SEA || Math.sin(x * 0.04 + 2) + Math.cos(z * 0.06) < 0.3) continue;
    if (towns.some((t) => Math.hypot(x - t.x, z - t.z) < 10 + Math.sqrt(t.houses + t.tents) * 3.4)) continue;
    const h = 2 + (k % 2);
    for (let y = top + 1; y <= top + h; y++) put(x, y, z, LOG);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(x + dx, top + h + 1, z + dz, LEAVES);
    put(x, top + h + 2, z, LEAVES);
  }
  // Each town: a fire circle, then houses and tents in spiral slots.
  for (const t of towns) {
    const salt = strHash(t.id);
    const cx = Math.round(t.x), cz = Math.round(t.z);
    const g = ground[cx + cz * W]!;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(cx + dx, g, cz + dz, COBBLE);
    let k = 0;
    for (let n = 0; n < t.houses + t.tents; n++, k++) {
      const s = slot(k, salt);
      const x = Math.round(t.x + s.dx), z = Math.round(t.z + s.dz);
      const y = ground[x + z * W]! + 1;
      if (n < t.houses) {
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) put(x + dx, y, z + dz, PLANK);
        for (let dz = -0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) put(x + dx, y + 1, z + dz, THATCH);
      } else put(x, y, z, CANVAS);
    }
    // A jetty out from the quay.
    for (let z = Math.round(t.quay.z) - 3; z < Math.round(t.quay.z) + 4; z++) if (ground[cx + z * W]! < SEA) put(cx, SEA, z, PLANK);
  }
  return cells;
}

/** A boat's place and heading on a run from one quay to another, `u` from 0 to 1: out into open water and back in. */
export function boatAt(a: { x: number; z: number }, b: { x: number; z: number }, u: number): { x: number; z: number; heading: number } {
  const out = Math.max(a.z, b.z) + 10 + Math.abs(a.x - b.x) * 0.08;
  const mx = (a.x + b.x) / 2;
  const x = (1 - u) ** 2 * a.x + 2 * u * (1 - u) * mx + u * u * b.x;
  const z = (1 - u) ** 2 * a.z + 2 * u * (1 - u) * out + u * u * b.z;
  const dx = 2 * (1 - u) * (mx - a.x) + 2 * u * (b.x - mx);
  const dz = 2 * (1 - u) * (out - a.z) + 2 * u * (b.z - out);
  return { x, z, heading: Math.atan2(dx, dz) };
}
