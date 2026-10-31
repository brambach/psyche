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
  canvas: "#e6dcc3",
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

export function buildMesh(g: GridData, water: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const index: number[] = [];
  const at = (x: number, y: number, z: number) => (x < 0 || z < 0 || y < 0 || x >= g.w || z >= g.d || y >= g.h ? AIR : g.cells[x + z * g.w + y * g.w * g.d]!);
  const c = new THREE.Color();
  for (let y = 0; y < g.h; y++)
    for (let z = 0; z < g.d; z++)
      for (let x = 0; x < g.w; x++) {
        const b = at(x, y, z);
        if (b === AIR || (b === WATER) !== water) continue;
        const name = MATERIALS[b]!;
        const small = SMALL.has(b);
        const inset = b === REEDS || b === BARLEY || b === SPROUT ? 0.3 : small ? 0.08 : 0;
        const top = b === REEDS ? 0.8 : b === BARLEY ? 0.7 : b === SPROUT ? 0.4 : b === MATERIALS.indexOf("bed") ? 0.45 : b === MATERIALS.indexOf("table") ? 0.7 : b === MATERIALS.indexOf("chest") ? 0.6 : 1;
        for (const f of FACES) {
          const nb = at(x + f.n[0], y + f.n[1], z + f.n[2]);
          if (water) {
            if (f.n[1] !== 1 || nb !== AIR) continue;
          } else if (!small && nb !== AIR && nb !== WATER && nb !== LEAVES && !SMALL.has(nb)) continue;
          const jitter = 0.92 + hash(x, y, z) * 0.16;
          c.set(COLOR[name] ?? "#ff00ff").multiplyScalar(f.shade * jitter);
          const base = pos.length / 3;
          for (const [cx, cy, cz] of f.corners) {
            const px = cx === 0 ? inset : 1 - inset;
            const pz = cz === 0 ? inset : 1 - inset;
            pos.push(x + px, y + (cy === 1 ? (water ? 0.85 : top) : 0), z + pz);
            col.push(c.r, c.g, c.b);
            nor.push(...f.n);
          }
          index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}
