// Block meshing shared by every 3D view: one geometry with only the faces you can see, each face
// shaded by the way it points so the look stays flat and readable.

import * as THREE from "three";
import { MATERIALS } from "@psyche/engine";

/** A block grid as the views pass it around: index x + z*w + y*w*d. */
export interface GridData {
  version: number;
  w: number;
  d: number;
  h: number;
  cells: Uint8Array;
}

export const COLOR: Record<string, string> = {
  grass: "#6f9f4a",
  dirt: "#8a6040",
  stone: "#8d8e88",
  sand: "#dcc993",
  water: "#3f7fa8",
  log: "#6b4a2e",
  leaves: "#2f6a3e",
  plank: "#c49a5e",
  cobble: "#77776f",
  thatch: "#d2b45a",
  reeds: "#9fbb5a",
  door: "#6e4320",
  bed: "#a8423a",
  hearth: "#4e4b47",
  table: "#a06e3a",
  chest: "#82552c",
  canvas: "#efe3c2",
  barley: "#d8b84a",
  sprout: "#7fb04a",
  snow: "#eef2f4",
};
const AIR = 0;
const WATER = MATERIALS.indexOf("water");
const LEAVES = MATERIALS.indexOf("leaves");
const REEDS = MATERIALS.indexOf("reeds");
const BARLEY = MATERIALS.indexOf("barley");
const SPROUT = MATERIALS.indexOf("sprout");
const SMALL = new Set(["bed", "table", "chest", "reeds", "barley", "sprout"].map((m) => MATERIALS.indexOf(m as never)));

/** Shade per face direction: tops bright, sides mid, bottoms dark. */
const FACES: { n: [number, number, number]; shade: number; corners: [number, number, number][] }[] = [
  { n: [0, 1, 0], shade: 1, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], shade: 0.55, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [1, 0, 0], shade: 0.8, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], shade: 0.72, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 0, 1], shade: 0.88, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], shade: 0.66, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const hash = (x: number, y: number, z: number) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth noise in [0, 1) over the ground, for broad patches of colour. */
function patch(x: number, z: number, scale: number, salt: number): number {
  const fx = x / scale, fz = z / scale;
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(i, salt, j) + (hash(i + 1, salt, j) - hash(i, salt, j)) * s(u);
  const b = hash(i, salt, j + 1) + (hash(i + 1, salt, j + 1) - hash(i, salt, j + 1)) * s(u);
  return a + (b - a) * s(v);
}

export interface MeshLook {
  /** The season tints the grass, and in winter snow lies on whatever is open to the sky. */
  season?: string;
  /** Darken the corners where blocks meet (on unless switched off). */
  occlusion?: boolean;
}

/** Grass through the year, and the two colours each season's patches lean toward. */
const GRASS: Record<string, [string, string, string]> = {
  spring: ["#7cb155", "#93bf5c", "#5f9a4c"],
  summer: ["#6f9f4a", "#86a94e", "#55883f"],
  autumn: ["#93994c", "#b09a48", "#73863f"],
  winter: ["#8b9a70", "#a3a67c", "#74876a"],
};
const tmp = new THREE.Color();
/** The colour of the grass at a spot on the ground, in a season: broad patches, lighter and darker. */
export function grassAt(x: number, z: number, season: string | undefined, out: THREE.Color): THREE.Color {
  const g = GRASS[season ?? "summer"] ?? GRASS.summer!;
  const p = patch(x, z, 19, 1), q = patch(x, z, 7, 2);
  return out.set(g[0]).lerp(tmp.set(p > 0.5 ? g[1] : g[2]), Math.max(0, Math.min(1, Math.abs(p - 0.5) * 1.5 + (q - 0.5) * 0.25)));
}
/** Smooth noise over the ground, for other things that want to match the land's patches. */
export const groundPatch = patch;

/** How dark a corner gets with 0, 1, 2 or 3 of its three neighbours open. */
const OCCLUDE = [0.56, 0.72, 0.87, 1];
const SNOWED = new Set(["leaves", "thatch", "plank", "cobble", "stone", "log", "canvas", "dirt", "sand"].map((m) => MATERIALS.indexOf(m as never)));
const GRASS_ID = MATERIALS.indexOf("grass");
const SAND = MATERIALS.indexOf("sand");
const STONE = MATERIALS.indexOf("stone");
const SNOW = MATERIALS.indexOf("snow");

/**
 * One geometry for a block grid. Besides position, colour and normal, each vertex carries `sway`:
 * how much the wind moves it (leaves, and the tops of reeds and barley), for materials that use it.
 */
export function buildMesh(g: GridData, water: boolean, look: MeshLook = {}): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const sway: number[] = [];
  const index: number[] = [];
  const at = (x: number, y: number, z: number) => (x < 0 || z < 0 || y < 0 || x >= g.w || z >= g.d || y >= g.h ? AIR : g.cells[x + z * g.w + y * g.w * g.d]!);
  const solid = (x: number, y: number, z: number) => {
    const b = at(x, y, z);
    return b !== AIR && b !== WATER && !SMALL.has(b);
  };
  const occlusion = look.occlusion !== false && !water;
  const winter = look.season === "winter";
  // The highest block in each column: what the snow can reach.
  let roof: Int16Array | undefined;
  if (winter && !water) {
    roof = new Int16Array(g.w * g.d).fill(-1);
    for (let y = g.h - 1; y >= 0; y--)
      for (let z = 0; z < g.d; z++)
        for (let x = 0; x < g.w; x++) if (roof[x + z * g.w]! < 0 && g.cells[x + z * g.w + y * g.w * g.d] !== AIR) roof[x + z * g.w] = y;
  }
  const c = new THREE.Color(), c2 = new THREE.Color();
  const snow = new THREE.Color(COLOR.snow!);
  const ao = [1, 1, 1, 1];
  for (let y = 0; y < g.h; y++)
    for (let z = 0; z < g.d; z++)
      for (let x = 0; x < g.w; x++) {
        const b = at(x, y, z);
        if (b === AIR || (b === WATER) !== water) continue;
        const name = MATERIALS[b]!;
        const small = SMALL.has(b);
        const crop = b === REEDS || b === BARLEY || b === SPROUT;
        const inset = crop ? 0.3 : small ? 0.08 : 0;
        const top = b === REEDS ? 0.8 : b === BARLEY ? 0.7 : b === SPROUT ? 0.4 : b === MATERIALS.indexOf("bed") ? 0.45 : b === MATERIALS.indexOf("table") ? 0.7 : b === MATERIALS.indexOf("chest") ? 0.6 : 1;
        const jitter = 0.93 + hash(x, y, z) * 0.14;
        for (const f of FACES) {
          const nb = at(x + f.n[0], y + f.n[1], z + f.n[2]);
          if (water) {
            if (f.n[1] !== 1 || nb !== AIR) continue;
          } else if (!small && nb !== AIR && nb !== WATER && nb !== LEAVES && !SMALL.has(nb)) continue;
          // Colour: the block's own, with broad patches on open ground so a meadow is not one flat green.
          if (b === GRASS_ID) grassAt(x, z, look.season, c);
          else if (b === SAND) c.set(COLOR.sand!).lerp(c2.set("#cdb47c"), patch(x, z, 11, 3) * 0.5);
          else if (b === STONE) c.set(COLOR.stone!).lerp(c2.set("#7b8480"), patch(x + y, z - y, 6, 4) * 0.6);
          else if (b === LEAVES) c.set(COLOR.leaves!).lerp(c2.set("#3f7f4c"), hash(x >> 1, y, z >> 1) * 0.55);
          else c.set(COLOR[name] ?? "#ff00ff");
          // Winter: snow lies on roofs, boughs and bare ground, thicker in some places than others.
          if (roof && f.n[1] === 1 && roof[x + z * g.w] === y && SNOWED.has(b) && b !== SNOW) c.lerp(snow, 0.55 + 0.4 * patch(x, z, 5, 5));
          c.multiplyScalar(f.shade * jitter);
          const base = pos.length / 3;
          for (let k = 0; k < 4; k++) {
            const [cx, cy, cz] = f.corners[k]!;
            const px = cx === 0 ? inset : 1 - inset;
            const pz = cz === 0 ? inset : 1 - inset;
            pos.push(x + px, y + (cy === 1 ? (water ? 0.85 : top) : 0), z + pz);
            let shade = 1;
            if (occlusion && !small) {
              // The three blocks around this corner, on the open side of the face.
              const bx = x + f.n[0], by = y + f.n[1], bz = z + f.n[2];
              const d: [number, number, number][] = [];
              if (f.n[0] === 0) d.push([cx ? 1 : -1, 0, 0]);
              if (f.n[1] === 0) d.push([0, cy ? 1 : -1, 0]);
              if (f.n[2] === 0) d.push([0, 0, cz ? 1 : -1]);
              const s1 = solid(bx + d[0]![0], by + d[0]![1], bz + d[0]![2]);
              const s2 = solid(bx + d[1]![0], by + d[1]![1], bz + d[1]![2]);
              const sc = solid(bx + d[0]![0] + d[1]![0], by + d[0]![1] + d[1]![1], bz + d[0]![2] + d[1]![2]);
              shade = OCCLUDE[s1 && s2 ? 0 : 3 - (Number(s1) + Number(s2) + Number(sc))]!;
            }
            ao[k] = shade;
            col.push(c.r * shade, c.g * shade, c.b * shade);
            nor.push(...f.n);
            sway.push(b === LEAVES ? 1 : crop && cy === 1 ? 1.6 : 0);
          }
          // Split the face along the diagonal that keeps the shading smooth.
          if (ao[0]! + ao[2]! < ao[1]! + ao[3]!) index.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          else index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("sway", new THREE.Float32BufferAttribute(sway, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

/** Shared clock and wind for every material that sways: set `value` each frame. */
export const WIND = { time: { value: 0 }, strength: { value: 0.2 }, dir: { value: new THREE.Vector2(1, 0) } };

/** A flat-shaded block material whose leaves and crops move with the wind (it reads the `sway` attribute). */
export function blockMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WIND.time;
    shader.uniforms.uWind = WIND.strength;
    shader.uniforms.uWindDir = WIND.dir;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float sway;\nuniform float uTime;\nuniform float uWind;\nuniform vec2 uWindDir;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        if (sway > 0.0) {
          float gust = sin(uTime * 1.3 + position.x * 0.21 + position.z * 0.17) * 0.5 + 0.5;
          float flutter = sin(uTime * (2.2 + uWind * 3.0) + position.x * 1.7 + position.y * 2.3 + position.z * 1.3);
          float lean = sway * uWind * (0.10 + 0.22 * gust);
          transformed.x += uWindDir.x * lean + flutter * sway * (0.015 + 0.05 * uWind);
          transformed.z += uWindDir.y * lean + flutter * sway * (0.012 + 0.04 * uWind);
        }`,
      );
  };
  return m;
}
