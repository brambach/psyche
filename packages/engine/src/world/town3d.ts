// A town in 3D. The village map is a flat sketch (places on a 100 x 62 board); this lays the same
// places out on a block grid: a shore to the west, the fire circle in the middle, homes in rows
// below it, the pinewood, quarry and barley field to the east. The terrain depends only on the seed,
// so the browser builds it itself; what changes (houses going up, tents, where everyone is) comes
// from `townScene`, which reads the simulation and decides nothing.

import { nextRandom, type Rng } from "../rng.js";
import { compile, type Blueprint } from "../founders/blueprint.js";
import { idx, inside, M, type Grid, type Plot, type Tree } from "../founders/voxel.js";
import { hourOf } from "../mind.js";
import { isChild } from "./life.js";
import type { FeedItem, WorldState } from "./world.js";

export const TOWN = { w: 192, d: 200, h: 26, sea: 4 };
/** Home plots: five to a row, eight rows below the fire circle, each with room for a tent beside it. */
const PLOT = 13;
const SLOT_X = [46, 65, 84, 103, 122];
const SLOT_Z = [74, 89, 104, 119, 134, 149, 164, 179];

/** Where each of the village's shared places sits on the grid. */
export const SPOTS: Record<string, { x: number; z: number; r: number }> = {
  sea: { x: 15, z: 57, r: 2 },
  harbour: { x: 30, z: 57, r: 3 },
  tavern: { x: 86, z: 52, r: 5 },
  store: { x: 112, z: 38, r: 5 },
  graveyard: { x: 140, z: 22, r: 4 },
  cliffs: { x: 176, z: 14, r: 4 },
  quarry: { x: 172, z: 46, r: 4 },
  woods: { x: 168, z: 92, r: 11 },
  fields: { x: 166, z: 138, r: 9 },
  reeds: { x: 26, z: 122, r: 6 },
};

export interface TownTerrain {
  grid: Grid;
  /** Top solid block per column (before any house or tent). */
  ground: number[];
  trees: Tree[];
}

const shoreAt = (z: number) => 26 + 5 * Math.sin(z / 17) + 3 * Math.sin(z / 7 + 1);

/** Smooth value noise in [0, 1). */
function noise(seed: number, x: number, z: number, scale: number): number {
  const h = (i: number, j: number) => {
    let n = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const fx = x / scale, fz = z / scale;
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * s(u);
  const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * s(u);
  return a + (b - a) * s(v);
}

/** The plot for home number `k` (in the order homes were added). */
export function homePlot(k: number, ground?: number[]): Plot {
  const row = Math.min(SLOT_Z.length - 1, Math.floor(k / SLOT_X.length));
  const x0 = SLOT_X[k % SLOT_X.length]! + (row % 2) * 4;
  const z0 = SLOT_Z[row]!;
  const y = ground ? ground[x0 + 6 + (z0 + 6) * TOWN.w]! + 1 : 0;
  return { x0, z0, w: PLOT, d: PLOT, y };
}

/** The land, sea, trees and fixed buildings for a town. */
export function townTerrain(seed: number): TownTerrain {
  const { w, d, h, sea } = TOWN;
  const grid: Grid = { w, d, h, cells: new Uint8Array(w * d * h), version: 1 };
  const ground: number[] = new Array(w * d).fill(0);
  const r: Rng = { rng: seed * 7919 + 17 };

  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const xs = shoreAt(z);
      let top: number;
      if (x < xs) top = sea - 1 - Math.min(3, Math.floor((xs - x) / 3));
      else {
        const rise = (x - xs) / 26;
        const hill = Math.max(0, 8 - Math.hypot(x - 176, z - 28) / 4.5);
        const roll = noise(seed, x, z, 22) * 1.8 + noise(seed + 1, x, z, 9) * 0.5;
        top = Math.min(h - 8, Math.floor(sea + 1 + rise + hill + roll - 0.6));
      }
      ground[x + z * w] = top;
    }

  const level = (x0: number, z0: number, x1: number, z1: number, to?: number) => {
    let sum = 0, n = 0;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (x >= 0 && z >= 0 && x < w && z < d) (sum += ground[x + z * w]!), n++;
    const y = to ?? Math.max(sea + 1, Math.round(sum / Math.max(1, n)));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (x >= 0 && z >= 0 && x < w && z < d) ground[x + z * w] = y;
    return y;
  };
  // Flat ground for the fire circle, the store and every home plot.
  const t = SPOTS.tavern!, st = SPOTS.store!;
  level(t.x - 8, t.z - 8, t.x + 8, t.z + 8);
  level(st.x - 6, st.z - 5, st.x + 6, st.z + 5);
  for (let k = 0; k < SLOT_X.length * SLOT_Z.length; k++) {
    const p = homePlot(k);
    level(p.x0 - 5, p.z0 - 1, p.x0 + p.w, p.z0 + p.d);
  }
  const f = SPOTS.fields!;
  level(f.x - 12, f.z - 9, f.x + 12, f.z + 9);

  // Fill the columns.
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const top = ground[x + z * w]!;
      const rocky = noise(seed + 2, x, z, 6) > 0.8 && top > sea + 6;
      for (let y = 0; y <= top; y++) {
        let b = M.stone;
        if (y === top) b = top <= sea ? M.sand : rocky ? M.stone : M.grass;
        else if (y >= top - 2) b = top <= sea ? M.sand : M.dirt;
        grid.cells[idx(grid, x, y, z)] = b;
      }
      for (let y = top + 1; y <= sea - 1; y++) grid.cells[idx(grid, x, y, z)] = M.water;
      // A strip of sand along the waterline.
      if (top > sea - 1 && top <= sea + 1 && x - shoreAt(z) < 4) grid.cells[idx(grid, x, top, z)] = M.sand;
    }
  const put = (x: number, y: number, z: number, b: number) => {
    if (inside(grid, x, y, z)) grid.cells[idx(grid, x, y, z)] = b;
  };
  const surface = (x: number, z: number) => ground[x + z * w]!;

  // The landing: a plank jetty out over the water.
  const hb = SPOTS.harbour!;
  for (let x = Math.floor(shoreAt(hb.z)) - 16; x <= hb.x; x++) for (let z = hb.z - 1; z <= hb.z + 1; z++) {
    if (surface(x, z) < sea) put(x, sea, z, M.plank);
    if (z !== hb.z && x % 4 === 0 && surface(x, z) < sea) for (let y = surface(x, z) + 1; y < sea; y++) put(x, y, z, M.log);
  }
  for (let x = Math.floor(shoreAt(hb.z)) - 16; x <= hb.x; x++) for (let z = hb.z - 1; z <= hb.z + 1; z++) if (surface(x, z) < sea) ground[x + z * w] = sea;

  // The fire circle: a ring of stones, a hearth, and log benches.
  {
    const y = surface(t.x, t.z);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const dd = Math.hypot(dx, dz);
      if (dd <= 3.4) put(t.x + dx, y, t.z + dz, dd > 2.5 ? M.cobble : M.dirt);
    }
    put(t.x, y + 1, t.z, M.hearth);
    for (const [bx, bz, along] of [[0, -6, "x"], [0, 6, "x"], [-6, 0, "z"], [6, 0, "z"]] as const)
      for (let k = -1; k <= 1; k++) put(t.x + bx + (along === "x" ? k : 0), y + 1, t.z + bz + (along === "z" ? k : 0), M.log);
  }

  // The common store: a plank shed with a thatch roof, door to the south.
  {
    const y = surface(st.x, st.z) + 1;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -4; dx <= 4; dx++) {
      put(st.x + dx, y - 1, st.z + dz, M.plank);
      const edge = Math.abs(dx) === 4 || Math.abs(dz) === 3;
      if (edge) for (let k = 0; k < 3; k++) put(st.x + dx, y + k, st.z + dz, Math.abs(dx) === 4 && Math.abs(dz) === 3 ? M.log : M.plank);
    }
    put(st.x, y, st.z + 3, M.door);
    put(st.x, y + 1, st.z + 3, M.door);
    for (let k = 0; k <= 4; k++) for (let dx = -5; dx <= 5; dx++) {
      put(st.x + dx, y + 3 + k, st.z - 4 + k, M.thatch);
      put(st.x + dx, y + 3 + k, st.z + 4 - k, M.thatch);
    }
    for (let dx = -3; dx <= 3; dx += 2) put(st.x + dx, y, st.z - 2, M.chest);
  }

  // The burial ground: two rows of standing stones.
  {
    const g = SPOTS.graveyard!;
    for (let k = 0; k < 8; k++) {
      const x = g.x - 4 + (k % 4) * 3, z = g.z - 2 + Math.floor(k / 4) * 4;
      put(x, surface(x, z) + 1, z, M.cobble);
    }
  }

  // The quarry: a stepped pit of bare stone.
  {
    const q = SPOTS.quarry!;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      const dd = Math.max(Math.abs(dx), Math.abs(dz));
      const x = q.x + dx, z = q.z + dz;
      if (!inside(grid, x, 0, z)) continue;
      const top = surface(x, z);
      const cut = dd <= 3 ? 3 : dd <= 5 ? 1 : 0;
      for (let y = top - cut + 1; y <= top; y++) put(x, y, z, M.air);
      put(x, top - cut, z, M.stone);
      ground[x + z * w] = top - cut;
    }
  }

  // The barley field: furrows of turned earth and rows of barley.
  for (let dz = -8; dz <= 8; dz++) for (let dx = -11; dx <= 11; dx++) {
    const x = f.x + dx, z = f.z + dz, y = surface(x, z);
    put(x, y, z, M.dirt);
    if (dz % 2 === 0) put(x, y + 1, z, M.barley);
  }

  // Reeds in the shallows by the reedbed, and here and there along the shore.
  for (let z = 0; z < d; z++)
    for (let x = 0; x < 50; x++) {
      const top = surface(x, z);
      if (top >= sea || top < sea - 2) continue;
      const near = Math.hypot(x - SPOTS.reeds!.x, z - SPOTS.reeds!.z) < 12;
      if (nextRandom(r) < (near ? 0.75 : 0.06)) put(x, sea, z, M.reeds);
    }

  // Pines: thick in the pinewood, a few scattered elsewhere, never on a plot, path or field.
  const trees: Tree[] = [];
  const clear = (x: number, z: number) => {
    if (x < shoreAt(z) + 4 || x < 3 || z < 3 || x > w - 4 || z > d - 4) return false;
    if (Math.hypot(x - t.x, z - t.z) < 11 || Math.abs(x - st.x) < 8 && Math.abs(z - st.z) < 7) return false;
    if (x > SLOT_X[0]! - 6 && x < SLOT_X.at(-1)! + PLOT + 6 && z > SLOT_Z[0]! - 3 && z < SLOT_Z.at(-1)! + PLOT + 2) return false;
    if (Math.abs(x - f.x) < 14 && Math.abs(z - f.z) < 11) return false;
    if (Math.abs(x - SPOTS.quarry!.x) < 8 && Math.abs(z - SPOTS.quarry!.z) < 8) return false;
    if (Math.abs(x - SPOTS.graveyard!.x) < 7 && Math.abs(z - SPOTS.graveyard!.z) < 5) return false;
    if (Math.abs(z - hb.z) < 3 && x < t.x) return false;
    return true;
  };
  const plant = (x: number, z: number) => {
    const top = surface(x, z);
    const height = 4 + Math.floor(nextRandom(r) * 3);
    const tree: Tree = { id: `tree_${trees.length + 1}`, x, z, y: top + 1, height, felled: false };
    trees.push(tree);
    for (let y = tree.y; y < tree.y + height; y++) put(x, y, z, M.log);
    for (let ly = tree.y + 2; ly <= tree.y + height; ly++) {
      const rad = ly >= tree.y + height - 1 ? 1 : 2;
      for (let dz = -rad; dz <= rad; dz++)
        for (let dx = -rad; dx <= rad; dx++)
          if (Math.abs(dx) + Math.abs(dz) <= rad + 0.5 && inside(grid, x + dx, ly, z + dz) && grid.cells[idx(grid, x + dx, ly, z + dz)] === M.air) put(x + dx, ly, z + dz, M.leaves);
    }
    put(x, tree.y + height, z, M.leaves);
  };
  const wd = SPOTS.woods!;
  for (let tries = 0; tries < 2500 && trees.length < 70; tries++) {
    const inWood = tries % 3 !== 2;
    const x = Math.floor(inWood ? wd.x - 22 + nextRandom(r) * 44 : 40 + nextRandom(r) * (w - 44));
    const z = Math.floor(inWood ? wd.z - 26 + nextRandom(r) * 52 : 4 + nextRandom(r) * (d - 8));
    if (!clear(x, z) || surface(x, z) <= sea) continue;
    if (inWood && Math.hypot((x - wd.x) / 1.1, (z - wd.z) / 1.6) > 22) continue;
    if (!inWood && nextRandom(r) < 0.6) continue;
    if (trees.some((o) => Math.abs(o.x - x) < 3 && Math.abs(o.z - z) < 3)) continue;
    plant(x, z);
  }
  return { grid, ground, trees };
}

const cache = new Map<number, TownTerrain>();
/** The terrain for a seed, built once. */
export function terrainOf(seed: number): TownTerrain {
  let t = cache.get(seed);
  if (!t) {
    if (cache.size > 24) cache.clear();
    t = townTerrain(seed);
    cache.set(seed, t);
  }
  return t;
}

export interface Scene3D {
  seed: number;
  hour: number;
  day: number;
  season: string;
  weather: string;
  structures: { id: string; household: string; name: string; plot: Plot; blueprint: Blueprint; placed: number; total: number; done: boolean; builders: string[] }[];
  tents: { household: string; x: number; z: number }[];
  people: { id: string; name: string; x: number; z: number; place: string; activity: string; asleep: boolean; indoors: boolean; child: boolean; building: boolean; working: boolean }[];
  places: { id: string; name: string; x: number; z: number }[];
  /** Trees cut so far, taken from the pinewood in `fellingOrder`. */
  felled: number;
  blight: boolean;
  /** What people are saying, and the big moments on their minds, in the last sim-hour or so. */
  bubbles: { id: string; text: string; kind: "say" | "think"; tick: number }[];
}

/** Logs a felled pine gives. */
export const LOGS_PER_TREE = 4;

/** The pinewood's trees in the order they are cut: the edge nearest the village first. */
export function fellingOrder(t: TownTerrain): Tree[] {
  const wd = SPOTS.woods!;
  return t.trees.filter((tr) => Math.hypot((tr.x - wd.x) / 1.1, (tr.z - wd.z) / 1.6) <= 22).sort((a, b) => a.x - b.x || a.z - b.z);
}

const clip = (t: string) => (t.length > 110 ? t.slice(0, 107).replace(/\s+\S*$/, "") + "…" : t);

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

/** The homes people live in now, in the order they were added, so a new home never moves an old one. */
export function homeOrder(world: WorldState): string[] {
  const used = new Set(Object.values(world.village!.households).filter((h) => h.members.length).map((h) => h.home));
  return Object.keys(world.places).filter((p) => used.has(p));
}

/** Plain houses for households that have one but no design on record (a town that ran on rules). */
const STOCK: Blueprint[] = [
  { name: "A plank house", width: 7, depth: 6, wallHeight: 3, walls: "plank", foundation: "cobble", corners: "log", floor: "plank", roof: { shape: "gable", material: "thatch", overhang: 1 }, door: "south", windows: ["east", "west"], furniture: ["bed", "hearth", "table"], porch: false },
  { name: "A log house", width: 8, depth: 7, wallHeight: 3, walls: "log", foundation: "none", corners: "same", floor: "plank", roof: { shape: "gable", material: "thatch", overhang: 1 }, door: "south", windows: ["east"], furniture: ["bed", "hearth", "chest"], porch: true },
  { name: "A stone house", width: 8, depth: 7, wallHeight: 4, walls: "cobble", foundation: "cobble", corners: "same", floor: "cobble", roof: { shape: "hip", material: "plank", overhang: 0 }, door: "south", windows: ["west"], furniture: ["bed", "hearth", "table", "chest"], porch: false },
];

/** Everything that changes in the town's picture, at this moment. */
export function townScene(world: WorldState, feed: FeedItem[] = []): Scene3D {
  const v = world.village!;
  const land = terrainOf(world.seed);
  const ground = land.ground;
  const wood = fellingOrder(land);
  const timber = v.structures.reduce((n, s) => n + s.have.timber, 0);
  const felled = Math.min(Math.floor(wood.length * 0.7), Math.floor(timber / LOGS_PER_TREE));
  const homes = homeOrder(world);
  const plotOf = (home: string) => homePlot(Math.max(0, homes.indexOf(home)), ground);
  const hour = hourOf(world.tick);
  const night = hour >= 22 || hour < 6;

  const live = new Set(homes);
  const structures = v.structures
    .filter((s) => live.has(v.households[s.household]?.home ?? ""))
    .map((s) => {
      const hh = v.households[s.household]!;
      const plot = plotOf(hh.home);
      const total = compile(s.blueprint, plot).length;
      const placed = s.done ? total : Math.min(total, Math.floor((total * s.work) / Math.max(0.1, s.hours)));
      return { id: s.id, household: s.household, name: s.name, plot, blueprint: s.blueprint, placed, total, done: s.done, builders: s.builders };
    });
  for (const hh of Object.values(v.households)) {
    if (!hh.members.length || hh.shelter !== "house" || structures.some((s) => s.household === hh.id && s.done)) continue;
    const blueprint = STOCK[Math.floor(hash(hh.id) * STOCK.length)]!;
    const plot = plotOf(hh.home);
    const total = compile(blueprint, plot).length;
    structures.push({ id: `stock_${hh.id}`, household: hh.id, name: blueprint.name, plot, blueprint, placed: total, total, done: true, builders: [] });
  }
  const housed = new Set(structures.filter((s) => s.done).map((s) => s.household));
  const tents = Object.values(v.households)
    .filter((h) => h.members.length && !housed.has(h.id) && h.shelter === "tent")
    .map((h) => {
      const p = plotOf(h.home);
      return { household: h.id, x: p.x0 - 3, z: p.z0 + 6 };
    });
  const tentOf = new Map(tents.map((t) => [t.household, t]));

  const people = world.order.map((id) => {
    const a = world.agents[id]!;
    const place = a.place;
    const hh = Object.values(v.households).find((h) => h.members.includes(id));
    const r1 = hash(id), r2 = hash(id + "b");
    let x: number, z: number;
    let asleep = false, indoors = false, building = false;
    const isHome = place.startsWith("home_") || world.places[place]?.topics.includes("home");
    if (isHome) {
      const p = plotOf(place);
      const site = v.structures.find((s) => !s.done && v.households[s.household]?.home === place);
      building = !!site && /build/.test(a.activity);
      if (building) {
        // Working round the walls, moving to a new spot every sim-hour.
        const h = hash(id + Math.floor(world.tick / 60));
        const side = Math.floor(h * 4), along = 2 + ((h * 97) % 1) * (PLOT - 4);
        x = side === 0 ? p.x0 + along : side === 1 ? p.x0 + PLOT - 1 : side === 2 ? p.x0 + along : p.x0;
        z = side === 0 ? p.z0 : side === 1 ? p.z0 + along : side === 2 ? p.z0 + PLOT - 1 : p.z0 + along;
      } else if (place === hh?.home && housed.has(hh.id) && (night || /home/.test(a.activity) && hour >= 20)) {
        indoors = true;
        x = p.x0 + PLOT / 2;
        z = p.z0 + PLOT / 2;
      } else {
        const tent = hh ? tentOf.get(hh.id) : undefined;
        x = tent ? tent.x + 1 + r1 * 4 : p.x0 + 2 + r1 * (PLOT - 4);
        z = tent ? tent.z + 4 + r2 * 2 : p.z0 + PLOT + 0.5 + r2 * 1.5;
      }
      asleep = night;
    } else {
      const s = SPOTS[place] ?? { x: (world.places[place]?.x ?? 50) * 1.8, z: (world.places[place]?.y ?? 30) * 1.8, r: 3 };
      if (place === "sea") {
        // Out in the bay, each in their own boat.
        x = 4 + r1 * 12;
        z = 38 + r2 * 40;
      } else if (place === "woods" && /fell|timber|pine|wood/.test(a.activity) && wood.length) {
        // At the next trees to come down.
        const tr = wood[Math.min(wood.length - 1, felled + Math.floor(r1 * 4))]!;
        x = tr.x + (r2 < 0.5 ? -1.2 : 1.2);
        z = tr.z + 0.5;
      } else if (place === "harbour") {
        x = s.x - r1 * 10;
        z = s.z + (r2 - 0.5) * 2;
      } else {
        const ang = r1 * Math.PI * 2, rad = s.r * (0.6 + r2 * 0.5) + (place === "tavern" ? 0 : 0);
        x = s.x + Math.cos(ang) * rad;
        z = s.z + Math.sin(ang) * rad;
      }
    }
    return { id, name: world.minds[id]!.name, x: Number(x.toFixed(2)), z: Number(z.toFixed(2)), place, activity: a.activity, asleep, indoors, child: isChild(world, id), building, working: building || (["woods", "quarry", "fields", "reeds", "sea"].includes(place) && !/passed the time|talk|sitting|rest/.test(a.activity)) };
  });

  const places = Object.entries(SPOTS)
    .filter(([id]) => world.places[id])
    .map(([id, s]) => ({ id, name: world.places[id]!.name, x: s.x, z: s.z }));
  const byHome = new Map(Object.values(v.households).map((h) => [h.home, h]));
  for (const home of homes) {
    const p = plotOf(home);
    const hh = byHome.get(home);
    const name = world.places[home]!.name;
    places.push({ id: home, name: hh && housed.has(hh.id) ? name.replace(/\btents?$/, "house") : name, x: p.x0 + PLOT / 2, z: p.z0 + PLOT + 2 });
  }
  const alive = new Set(world.order);
  const bubbles: Scene3D["bubbles"] = [];
  for (const f of feed) {
    const age = world.tick - f.tick;
    if (age < 0 || age > 90) continue;
    if (f.kind === "talk" && age <= 40)
      for (const l of (f.lines ?? []).slice(0, 2)) if (alive.has(l.speaker)) bubbles.push({ id: l.speaker, text: clip(l.text), kind: "say", tick: f.tick });
    if ((f.kind === "insight" || f.kind === "event") && f.agents[0] && alive.has(f.agents[0])) bubbles.push({ id: f.agents[0], text: clip(f.title), kind: "think", tick: f.tick });
  }
  // One bubble a person: the newest.
  const latest = new Map<string, Scene3D["bubbles"][number]>();
  for (const b of bubbles) latest.set(b.id, b);
  return { seed: world.seed, hour, day: Math.floor(world.tick / 1440), season: v.season, weather: v.weather, structures, tents, people, places, felled, blight: v.blight, bubbles: [...latest.values()] };
}
