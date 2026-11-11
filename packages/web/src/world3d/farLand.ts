// The country beyond the town. The simulation only knows the town's own ground (a 192 by 200 grid),
// which on its own looks like a slab floating in the sea. This carries the same coast north and
// south and the same rising ground east into hills, in big steps so it reads as the same blocky
// land seen from further off, with pinewoods scattered over it. Nobody lives out here; it is
// scenery, built from the seed so it is the same every time.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { landNoise, naturalHeight, shoreAt, TOWN } from "@psyche/engine";
import { COLOR, grassAt, groundPatch } from "../voxelMesh";

/** Blocks out here are this many town blocks wide. */
const STEP = 4;
const X1 = 720, Z0 = -520, Z1 = 720;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far a point is outside the town's grid (0 inside it). */
const outside = (x: number, z: number) => Math.hypot(Math.max(0, -x, x - TOWN.w), Math.max(0, -z, z - TOWN.d));

/** The top of the land out here: the town's own slope, swelling into hills with distance. */
export function farHeight(seed: number, x: number, z: number): number {
  const base = naturalHeight(seed, x, z);
  const inland = x - shoreAt(z);
  if (inland < 0) return base;
  const away = smooth(8, 150, outside(x, z)) * smooth(10, 90, inland);
  const hills = landNoise(seed + 7, x, z, 110) * 22 + landNoise(seed + 8, x, z, 41) * 9 - 7;
  const ridge = smooth(260, 620, x) * 16 * landNoise(seed + 9, x, z, 170);
  return Math.floor(base + away * Math.max(-2, hills + ridge));
}

export class FarLand {
  readonly land: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  readonly trees: THREE.InstancedMesh;
  private cells: { x: number; z: number; h: number }[] = [];
  private heights = new Map<number, number>();
  private season = "";

  constructor(private scene: THREE.Scene, private seed: number) {
    const key = (i: number, j: number) => i * 4096 + j;
    for (let z = Z0; z < Z1; z += STEP)
      for (let x = Math.floor((shoreAt(z) - 8) / STEP) * STEP; x < X1; x += STEP) {
        // Leave out what the town's own grid covers.
        if (x >= 0 && x + STEP <= TOWN.w && z >= 0 && z + STEP <= TOWN.d) continue;
        const h = farHeight(seed, x + STEP / 2, z + STEP / 2);
        if (h < TOWN.sea - 3) continue;
        this.cells.push({ x, z, h });
        this.heights.set(key(x / STEP + 512, z / STEP + 512), h);
      }
    this.land = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.land.receiveShadow = true;

    // Pines: a trunk and three tiers, one mesh, scattered thick in some places and thin in others.
    const tier = (w: number, y: number, h: number, c: string) => {
      const g = new THREE.BoxGeometry(w, h, w).translate(0, y + h / 2, 0);
      const col = new THREE.Color(c);
      g.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position!.count }, () => [col.r, col.g, col.b]).flat(), 3));
      return g;
    };
    const pine = mergeGeometries([tier(0.9, 0, 3, COLOR.log!), tier(4.6, 2.2, 1.6, "#2c6644"), tier(3.2, 3.8, 1.6, "#317049"), tier(1.6, 5.4, 1.8, "#3a7d50")])!;
    const spots: { x: number; y: number; z: number; s: number }[] = [];
    let r = seed * 2654435761 + 97;
    const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
    for (const c of this.cells) {
      if (c.h <= TOWN.sea + 1) continue;
      const wood = landNoise(seed + 3, c.x, c.z, 60);
      const p = wood > 0.56 ? 0.42 : wood > 0.44 ? 0.07 : 0.012;
      if (rnd() > p) continue;
      spots.push({ x: c.x + 0.5 + rnd() * (STEP - 1), y: c.h + 1, z: c.z + 0.5 + rnd() * (STEP - 1), s: 0.8 + rnd() * 0.7 });
    }
    this.trees = new THREE.InstancedMesh(pine, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => this.trees.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(up, rnd() * 6.28), new THREE.Vector3(s.s, s.s * (0.9 + rnd() * 0.4), s.s))));
    this.trees.instanceMatrix.needsUpdate = true;
    this.trees.frustumCulled = false;
    scene.add(this.land, this.trees);
  }

  /** Colour the land for the season (and lay snow in winter). Cheap enough to redo when the season turns. */
  dress(season: string) {
    if (season === this.season) return;
    this.season = season;
    const key = (i: number, j: number) => i * 4096 + j;
    const at = (x: number, z: number) => this.heights.get(key(x / STEP + 512, z / STEP + 512));
    const pos: number[] = [], col: number[] = [], nor: number[] = [], index: number[] = [];
    const c = new THREE.Color(), side = new THREE.Color();
    const snow = new THREE.Color(COLOR.snow!), rock = new THREE.Color(COLOR.stone!), sand = new THREE.Color(COLOR.sand!), dirt = new THREE.Color(COLOR.dirt!);
    const quad = (v: number[][], n: number[], k: THREE.Color, shade: number) => {
      const base = pos.length / 3;
      for (const p of v) {
        pos.push(p[0]!, p[1]!, p[2]!);
        col.push(k.r * shade, k.g * shade, k.b * shade);
        nor.push(n[0]!, n[1]!, n[2]!);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const { x, z, h } of this.cells) {
      const y = h + 1;
      const beach = h <= TOWN.sea + 1 && x - shoreAt(z) < 7;
      const stony = h > 20 && groundPatch(x, z, 22, 6) > 0.45;
      if (beach) c.copy(sand).lerp(side.set("#cdb47c"), groundPatch(x, z, 11, 3) * 0.5);
      else if (stony) c.copy(rock).lerp(side.set("#7b8480"), groundPatch(x, z, 9, 4) * 0.6);
      else grassAt(x, z, season, c);
      if (season === "winter" && !beach) c.lerp(snow, 0.6 + 0.35 * groundPatch(x, z, 9, 5) + (h > 22 ? 0.2 : 0));
      else if (h > 30) c.lerp(snow, smooth(30, 40, h) * 0.8);
      c.multiplyScalar(0.94 + groundPatch(x, z, 3, 8) * 0.1);
      quad([[x, y, z + STEP], [x + STEP, y, z + STEP], [x + STEP, y, z], [x, y, z]], [0, 1, 0], c, 1);
      const walls: [number, number, number[], number[][]][] = [
        [x + STEP, z, [1, 0, 0], [[x + STEP, 0, z + STEP], [x + STEP, 0, z], [x + STEP, 1, z], [x + STEP, 1, z + STEP]]],
        [x - STEP, z, [-1, 0, 0], [[x, 0, z], [x, 0, z + STEP], [x, 1, z + STEP], [x, 1, z]]],
        [x, z + STEP, [0, 0, 1], [[x, 0, z + STEP], [x + STEP, 0, z + STEP], [x + STEP, 1, z + STEP], [x, 1, z + STEP]]],
        [x, z - STEP, [0, 0, -1], [[x + STEP, 0, z], [x, 0, z], [x, 1, z], [x + STEP, 1, z]]],
      ];
      for (const [nx, nz, n, v] of walls) {
        // Where the neighbour is the town itself (or open sea), the wall goes all the way down.
        const low = at(nx, nz) ?? -1;
        if (low >= h) continue;
        // A one-block step keeps the colour of the ground above it; a real drop shows earth or rock.
        if (h - low <= 1) side.copy(c);
        else side.copy(beach ? sand : season === "winter" || h > 14 ? rock : dirt);
        quad(v.map((p) => [p[0]!, p[1] ? y : low + 1, p[2]!]), n, side, n[0] === 1 ? 0.8 : n[0] === -1 ? 0.72 : n[2] === 1 ? 0.88 : 0.66);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(index);
    this.land.geometry.dispose();
    this.land.geometry = g;
    (this.trees.material as THREE.MeshLambertMaterial).color.set(season === "winter" ? "#dfe9ea" : "#ffffff");
  }

  dispose() {
    this.scene.remove(this.land, this.trees);
    this.land.geometry.dispose();
    this.land.material.dispose();
    this.trees.geometry.dispose();
    (this.trees.material as THREE.Material).dispose();
  }
}
