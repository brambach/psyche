// The voxel world: a small island as a grid of one-metre blocks, generated from a seed.
// The grid is plain typed state, so it is cloned, replayed and rewound like everything else.

import { nextRandom, type Rng } from "../rng.js";

export const MATERIALS = [
  "air",
  "grass",
  "dirt",
  "stone",
  "sand",
  "water",
  "log",
  "leaves",
  "plank",
  "cobble",
  "thatch",
  "reeds",
  "door",
  "bed",
  "hearth",
  "table",
  "chest",
] as const;
export type Material = (typeof MATERIALS)[number];
export const M = Object.fromEntries(MATERIALS.map((m, i) => [m, i])) as Record<Material, number>;

/** Blocks you can walk through. */
const OPEN = new Set([M.air, M.water, M.reeds, M.door]);
export const isOpen = (b: number) => OPEN.has(b);

export interface Tree {
  id: string;
  x: number;
  z: number;
  /** First log block, sitting on the ground. */
  y: number;
  height: number;
  felled: boolean;
}

export interface Grid {
  w: number;
  d: number;
  h: number;
  /** Index x + z*w + y*w*d. */
  cells: Uint8Array;
  /** Bumped on every change, so a client only refetches the grid when it moved. */
  version: number;
}

export interface Plot {
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** y of the first block above the ground. */
  y: number;
}

export interface Terrain {
  grid: Grid;
  /** Top solid ground (not counting trees or buildings) per column. */
  ground: number[];
  sea: number;
  trees: Tree[];
  plot: Plot;
}

export const idx = (g: Grid, x: number, y: number, z: number) => x + z * g.w + y * g.w * g.d;
export const inside = (g: Grid, x: number, y: number, z: number) => x >= 0 && z >= 0 && y >= 0 && x < g.w && z < g.d && y < g.h;
export const get = (g: Grid, x: number, y: number, z: number) => (inside(g, x, y, z) ? g.cells[idx(g, x, y, z)]! : M.air);
export function set(g: Grid, x: number, y: number, z: number, b: number): void {
  if (!inside(g, x, y, z)) return;
  const i = idx(g, x, y, z);
  if (g.cells[i] === b) return;
  g.cells[i] = b;
  g.version += 1;
}

export const SIZE = { w: 48, d: 48, h: 24 };
const SEA = 4;
const PLOT = 13;

/**
 * An islet: sandy shore, a grassy rise, a pine grove on the north-east slope, a stone outcrop to
 * the south-west and reeds along the eastern shallows. The plot is a level clearing near the middle.
 */
export function generateIsland(seed: number): Terrain {
  const r: Rng = { rng: (seed * 2654435761) >>> 0 };
  const { w, d, h } = SIZE;
  const grid: Grid = { w, d, h, cells: new Uint8Array(w * d * h), version: 0 };
  const ground: number[] = new Array(w * d).fill(SEA - 1);
  const phase = [nextRandom(r), nextRandom(r), nextRandom(r), nextRandom(r)].map((p) => p * Math.PI * 2);
  const cx = w / 2;
  const cz = d / 2;
  const plot: Plot = { x0: Math.round(cx - PLOT / 2) - 2, z0: Math.round(cz - PLOT / 2) + 1, w: PLOT, d: PLOT, y: 0 };

  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dz = z - cz;
      const ang = Math.atan2(dz, dx);
      const radius = 17 + 2.2 * Math.sin(3 * ang + phase[0]!) + 1.4 * Math.sin(5 * ang + phase[1]!);
      const dist = Math.hypot(dx, dz);
      let top = SEA - 1 - Math.min(2, Math.max(0, Math.floor((dist - radius) / 2)));
      if (dist < radius) {
        const rise = (radius - dist) / radius;
        const hill = 1.6 * Math.sin(x / 6 + phase[2]!) + 1.2 * Math.sin(z / 5 + phase[3]!);
        top = SEA + Math.max(0, Math.round(rise * 5 + hill * rise));
      }
      // The outcrop: a rocky shoulder to the south-west.
      const ox = x - (cx - 9);
      const oz = z - (cz + 8);
      const rock = Math.hypot(ox, oz);
      if (dist < radius && rock < 5) top += Math.round((5 - rock) * 0.9);
      ground[x + z * w] = top;
      for (let y = 0; y <= top; y++) {
        let b = M.stone;
        if (y === top) b = top <= SEA ? M.sand : M.grass;
        else if (y >= top - 2) b = top <= SEA ? M.sand : M.dirt;
        if (rock < 5 && dist < radius && y >= top - 3) b = M.stone;
        grid.cells[idx(grid, x, y, z)] = b;
      }
      for (let y = top + 1; y <= SEA - 1; y++) grid.cells[idx(grid, x, y, z)] = M.water;
    }
  }

  // Level the plot: the clearing the builder has picked.
  let sum = 0;
  for (let z = plot.z0; z < plot.z0 + plot.d; z++) for (let x = plot.x0; x < plot.x0 + plot.w; x++) sum += ground[x + z * w]!;
  const level = Math.max(SEA + 1, Math.round(sum / (plot.w * plot.d)));
  plot.y = level + 1;
  for (let z = plot.z0 - 1; z <= plot.z0 + plot.d; z++) {
    for (let x = plot.x0 - 1; x <= plot.x0 + plot.w; x++) {
      for (let y = 0; y < h; y++) grid.cells[idx(grid, x, y, z)] = y < level - 2 ? M.stone : y < level ? M.dirt : y === level ? M.grass : M.air;
      ground[x + z * w] = level;
    }
  }

  // Pines on the north-east slope, kept off the plot.
  const trees: Tree[] = [];
  for (let tries = 0; trees.length < 20 && tries < 600; tries++) {
    const x = Math.floor(cx + 3 + nextRandom(r) * 13);
    const z = Math.floor(cz - 16 + nextRandom(r) * 15);
    const top = ground[x + z * w]!;
    if (top <= SEA || Math.hypot(x - cx, z - cz) > 15) continue;
    if (x >= plot.x0 - 2 && x <= plot.x0 + plot.w + 1 && z >= plot.z0 - 2 && z <= plot.z0 + plot.d + 1) continue;
    if (trees.some((t) => Math.abs(t.x - x) < 3 && Math.abs(t.z - z) < 3)) continue;
    const height = 4 + Math.floor(nextRandom(r) * 3);
    const tree: Tree = { id: `tree_${trees.length + 1}`, x, z, y: top + 1, height, felled: false };
    trees.push(tree);
    for (let y = tree.y; y < tree.y + height; y++) grid.cells[idx(grid, x, y, z)] = M.log;
    for (let ly = tree.y + 2; ly <= tree.y + height; ly++) {
      const rad = ly >= tree.y + height - 1 ? 1 : 2;
      for (let dz = -rad; dz <= rad; dz++)
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > rad + 0.5) continue;
          if (inside(grid, x + dx, ly, z + dz) && grid.cells[idx(grid, x + dx, ly, z + dz)] === M.air) grid.cells[idx(grid, x + dx, ly, z + dz)] = M.leaves;
        }
    }
    grid.cells[idx(grid, x, tree.y + height, z)] = M.leaves;
  }

  // Reeds in the eastern shallows, up to three blocks out from the shore.
  for (let z = 0; z < d; z++) {
    for (let x = Math.floor(cx - 4); x < w; x++) {
      const top = ground[x + z * w]!;
      if (top >= SEA || top < SEA - 3) continue;
      let shore = Infinity;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if ((ground[x + dx + (z + dz) * w] ?? 0) >= SEA) shore = Math.min(shore, Math.abs(dx) + Math.abs(dz));
      if (shore <= 3 && nextRandom(r) < 0.8 - shore * 0.15) grid.cells[idx(grid, x, SEA, z)] = M.reeds;
    }
  }
  return { grid, ground, sea: SEA, trees, plot };
}

/** The height a person stands at in column (x, z): on top of the highest solid block up to `ceiling`. */
export function standY(t: Terrain, x: number, z: number): number {
  const xi = Math.max(0, Math.min(t.grid.w - 1, Math.round(x)));
  const zi = Math.max(0, Math.min(t.grid.d - 1, Math.round(z)));
  return Math.max(t.sea, t.ground[xi + zi * t.grid.w]! + 1);
}

/** Counts of every material in the grid. */
export function census(g: Grid): Record<Material, number> {
  const out = Object.fromEntries(MATERIALS.map((m) => [m, 0])) as Record<Material, number>;
  for (const c of g.cells) out[MATERIALS[c]!] += 1;
  return out;
}

/** The grid as base64, for the web client. */
export function encodeGrid(g: Grid): string {
  let s = "";
  for (let i = 0; i < g.cells.length; i += 0x8000) s += String.fromCharCode(...g.cells.subarray(i, i + 0x8000));
  return btoa(s);
}
