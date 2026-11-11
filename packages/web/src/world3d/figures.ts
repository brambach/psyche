// The people. Each is a small jointed figure (legs, arms, a head that turns) built from a handful of
// boxes, with their own skin, hair and clothes drawn from their id, so the same person always looks
// the same. What they do in the simulation picks a pose: walking, felling, hammering, bending to the
// barley, rowing, sitting by the fire, talking with their hands, lying asleep. Joints ease from one
// pose to the next, so nobody snaps.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TOWN, type Scene3D } from "@psyche/engine";

export type Person = Scene3D["people"][number];

export interface Figure {
  id: string;
  group: THREE.Group;
  rig: THREE.Group;
  upper: THREE.Group;
  head: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  tool: THREE.Mesh;
  rod: THREE.Mesh;
  boat: THREE.Mesh;
  load: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  lantern: THREE.Group;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  p: Person;
  /** The place they last left, so they can be seen carrying something back. */
  from?: string;
  heading: number;
  /** Where they are in their stride. */
  stride: number;
  speed: number;
  /** Their own offset into every cycle, so a crowd is not in step. */
  seed: number;
  /** True while they are on the move (set each frame). */
  walking: boolean;
  afloat: boolean;
}

/** What someone carries home from each place. */
const LOAD: Record<string, string> = { woods: "#6b4a2e", quarry: "#8d8e88", reeds: "#9fbb5a", fields: "#d8b84a", sea: "#b8c4cc" };

const SKIN = ["#f3d9c0", "#ecc8a6", "#dcb089", "#c1906a", "#99694a", "#734c36"];
const HAIR = ["#2b1d14", "#4a3222", "#6b4a2e", "#a8743a", "#c9a45c", "#8c8c88", "#d8d6cf", "#7a2e1c"];
const CLOTH = ["#4a4034", "#5c5346", "#3d4a52", "#6b5a3c", "#57433a", "#44503f"];
const STRAW = "#d9be6a";

const hashStr = (s: string, salt = 0) => {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

const tint = new THREE.Color();
/** A box with one colour baked into its vertices, placed where it belongs in its part. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string | THREE.Color, shade = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  tint.set(color).multiplyScalar(shade);
  const n = g.attributes.position!.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([tint.r, tint.g, tint.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
const merge = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
};

/** One material for every figure: all the colour is in the vertices. */
const CLOTH_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const GLOW_MAT = new THREE.MeshBasicMaterial({ color: 0xffc46b });
let glowTex: THREE.Texture | undefined;
/** A soft round dot, for lantern light, embers, smoke and fireflies. */
export function softDot(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

let BOAT: THREE.BufferGeometry | undefined;
/** A rowing boat: a floor, two strakes a side, a pointed bow, a thwart to sit on and a pair of oars. */
function boatGeometry(): THREE.BufferGeometry {
  if (BOAT) return BOAT;
  const wood = "#7a5232", dark = "#5c3d25", pale = "#b08a58";
  BOAT = merge([
    box(1.3, 0.14, 2.7, 0, 0, 0, dark),
    box(0.14, 0.42, 2.7, 0.68, 0.24, 0, wood), box(0.14, 0.42, 2.7, -0.68, 0.24, 0, wood),
    box(0.12, 0.14, 2.9, 0.74, 0.5, 0, pale), box(0.12, 0.14, 2.9, -0.74, 0.5, 0, pale),
    box(1.3, 0.42, 0.14, 0, 0.24, -1.35, wood),
    box(0.9, 0.42, 0.3, 0, 0.24, 1.45, wood), box(0.5, 0.42, 0.3, 0, 0.28, 1.72, wood), box(0.16, 0.5, 0.22, 0, 0.36, 1.95, dark),
    box(1.3, 0.1, 0.34, 0, 0.36, -0.25, pale),
    box(0.07, 0.07, 1.7, 1.05, 0.5, -0.1, pale), box(0.07, 0.07, 1.7, -1.05, 0.5, -0.1, pale),
  ]);
  return BOAT;
}

/** Build someone. `color` is their colour on the page (their tunic); the rest comes from their id. */
export function makeFigure(p: Person, color: string): Figure {
  const id = p.id;
  const skin = SKIN[Math.floor(hashStr(id, 1) * SKIN.length)]!;
  const hair = HAIR[Math.floor(hashStr(id, 2) * HAIR.length)]!;
  const style = Math.floor(hashStr(id, 3) * 6);
  const legs = CLOTH[Math.floor(hashStr(id, 4) * CLOTH.length)]!;
  // Their own colour, knocked back a little so it reads as dyed cloth rather than paint.
  const tunic = new THREE.Color(color).lerp(new THREE.Color("#7d7264"), 0.22);
  const trim = tunic.clone().multiplyScalar(0.62);

  const group = new THREE.Group();
  const rig = new THREE.Group();
  const upper = new THREE.Group();
  upper.position.y = 0.55;
  const mesh = (g: THREE.BufferGeometry, shadow = false) => {
    const m = new THREE.Mesh(g, CLOTH_MAT);
    m.userData.id = id;
    m.castShadow = shadow;
    return m;
  };

  // Torso: tunic, a belt, a darker hem.
  const torso = mesh(merge([box(0.56, 0.6, 0.32, 0, 0.32, 0, tunic), box(0.6, 0.08, 0.36, 0, 0.1, 0, "#3a2c20"), box(0.58, 0.1, 0.34, 0, 0, 0, trim)]), true);

  // Head: face, eyes, and hair or a hat.
  const parts = [box(0.42, 0.42, 0.42, 0, 0.21, 0, skin), box(0.06, 0.07, 0.03, -0.1, 0.24, 0.215, "#1d1612"), box(0.06, 0.07, 0.03, 0.1, 0.24, 0.215, "#1d1612")];
  if (style === 0) parts.push(box(0.46, 0.14, 0.46, 0, 0.42, 0, hair), box(0.46, 0.16, 0.1, 0, 0.3, -0.2, hair));
  else if (style === 1) parts.push(box(0.46, 0.14, 0.46, 0, 0.42, 0, hair), box(0.46, 0.5, 0.12, 0, 0.14, -0.21, hair), box(0.08, 0.34, 0.3, -0.21, 0.24, -0.06, hair), box(0.08, 0.34, 0.3, 0.21, 0.24, -0.06, hair));
  else if (style === 2) parts.push(box(0.46, 0.12, 0.46, 0, 0.42, 0, hair), box(0.2, 0.2, 0.2, 0, 0.5, -0.16, hair));
  else if (style === 3) parts.push(box(0.44, 0.06, 0.3, 0, 0.42, -0.07, hair, 0.9));
  else if (style === 4) parts.push(box(0.8, 0.05, 0.8, 0, 0.43, 0, STRAW), box(0.4, 0.16, 0.4, 0, 0.52, 0, STRAW, 0.92));
  else parts.push(box(0.48, 0.2, 0.48, 0, 0.36, -0.02, trim), box(0.48, 0.44, 0.12, 0, 0.14, -0.22, trim));
  const head = mesh(merge(parts), true);
  head.position.y = 0.62;

  const limb = (x: number, y: number, geo: THREE.BufferGeometry) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(mesh(geo));
    return pivot;
  };
  const arm = () => merge([box(0.16, 0.36, 0.18, 0, -0.16, 0, tunic), box(0.14, 0.2, 0.16, 0, -0.44, 0, skin)]);
  const leg = () => merge([box(0.22, 0.44, 0.24, 0, -0.22, 0, legs), box(0.22, 0.12, 0.3, 0, -0.49, 0.03, "#2e241c")]);
  const armL = limb(-0.37, 0.56, arm()), armR = limb(0.37, 0.56, arm());
  const legL = limb(-0.15, 0.55, leg()), legR = limb(0.15, 0.55, leg());

  // In the right hand: a tool (an axe, a pick or a hammer, by where they are working) or a fishing rod.
  const tool = mesh(merge([box(0.07, 0.07, 0.8, 0, 0, 0.3, "#6b4a2e"), box(0.1, 0.3, 0.16, 0, 0.02, 0.68, "#9aa0a2")]));
  tool.position.set(0, -0.5, 0);
  tool.visible = false;
  const rod = mesh(merge([box(0.05, 0.05, 2.4, 0, 0, 1.1, "#8a6a3e"), box(0.02, 1.2, 0.02, 0, -0.6, 2.3, "#e8e8e0")]));
  rod.position.set(0, -0.5, 0);
  rod.rotation.x = -0.5;
  rod.visible = false;
  armR.add(tool, rod);

  // In the left hand at night: a lantern.
  const lantern = new THREE.Group();
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), GLOW_MAT);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffb04a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(2.6);
  lantern.add(lamp, halo);
  lantern.position.set(0, -0.68, 0.05);
  lantern.visible = false;
  armL.add(lantern);

  upper.add(torso, head, armL, armR);
  rig.add(upper, legL, legR);

  const boat = mesh(boatGeometry(), true);
  boat.position.y = -0.1;
  boat.visible = false;
  const load = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 1), new THREE.MeshLambertMaterial({ color: 0x6b4a2e }));
  load.position.set(0.34, 1.34, 0);
  load.userData.id = id;
  load.visible = false;
  group.add(rig, boat, load);
  return {
    id, group, rig, upper, head, armL, armR, legL, legR, tool, rod, boat, load, lantern,
    pos: new THREE.Vector3(p.x, 0, p.z), target: new THREE.Vector3(p.x, 0, p.z), p,
    heading: hashStr(id, 5) * Math.PI * 2, stride: 0, speed: 0, seed: hashStr(id, 6) * 100, walking: false, afloat: false,
  };
}

export interface FigureEnv {
  /** Seconds since the view started, and since the last frame. */
  t: number;
  dt: number;
  /** The height to stand at over a spot, and whether that spot is water. */
  standY: (x: number, z: number) => number;
  wet: (x: number, z: number) => boolean;
  /** 0 by day, 1 at night. */
  dark: number;
  /** The fire circle, which people sitting round it face. */
  fire: { x: number; z: number };
  /** Who has something to say right now. */
  speaking: (id: string) => boolean;
  /** Who is near enough to be talking to. */
  near: (f: Figure) => Figure | undefined;
  /** How rough the water is, 0 to 1. */
  swell: number;
}

const turn = (from: number, to: number, k: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * k;
};

/** Move one person a frame's worth toward where the simulation says they are, and pose them. */
export function stepFigure(f: Figure, env: FigureEnv) {
  const { t, dt } = env;
  const p = f.p;
  const dx = f.target.x - f.pos.x, dz = f.target.z - f.pos.z, dist = Math.hypot(dx, dz);
  // They set off gently and slow as they arrive.
  const want = dist > 120 ? 0 : Math.min(9, 1.2 + dist * 1.6);
  f.speed += (want - f.speed) * Math.min(1, dt * 6);
  const step = f.speed * dt;
  let moved = 0;
  if (dist > 120) f.pos.set(f.target.x, 0, f.target.z);
  else if (dist > Math.max(step, 0.03)) {
    f.pos.x += (dx / dist) * step;
    f.pos.z += (dz / dist) * step;
    moved = step;
  } else f.pos.set(f.target.x, 0, f.target.z);
  const walking = moved > 0;
  f.walking = walking;
  const afloat = env.wet(f.pos.x, f.pos.z);
  f.afloat = afloat;
  f.stride += moved * 1.55;

  const asleep = p.asleep && !walking;
  const atFire = p.place === "tavern" && !walking && !asleep;
  const speaking = !asleep && env.speaking(p.id);
  const work = !walking && !asleep && p.working ? (p.building ? "build" : p.place === "woods" ? "chop" : p.place === "quarry" ? "chop" : p.place === "fields" || p.place === "reeds" ? "bend" : p.place === "sea" ? "fish" : "build") : undefined;
  const carry = walking && !afloat && f.from !== undefined && LOAD[f.from] !== undefined && !(p.place in LOAD);

  // Which way they face: along their path, toward the fire, toward whoever they are talking to.
  let face = f.heading;
  if (walking) face = Math.atan2(dx, dz);
  else if (speaking) {
    const o = env.near(f);
    if (o) face = Math.atan2(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
    else if (atFire) face = Math.atan2(env.fire.x + 0.5 - f.pos.x, env.fire.z + 0.5 - f.pos.z);
  } else if (atFire) face = Math.atan2(env.fire.x + 0.5 - f.pos.x, env.fire.z + 0.5 - f.pos.z);
  f.heading = turn(f.heading, face, 1 - Math.pow(0.0005, dt));

  // The pose: a target angle for each joint, then ease toward it.
  const s = t + f.seed;
  let legL = 0, legR = 0, armL = 0, armR = 0, armRz = 0, armLz = 0, lean = 0, headX = 0, headY = Math.sin(s * 0.45) * 0.3, rigY = 0, rigX = 0, bob = 0;
  const sit = afloat || atFire;
  if (walking && !afloat) {
    const sw = Math.sin(f.stride), amp = Math.min(1, f.speed / 5);
    legL = sw * 0.8 * amp;
    legR = -sw * 0.8 * amp;
    armL = -sw * 0.6 * amp;
    armR = sw * 0.6 * amp;
    lean = 0.08 * amp;
    bob = Math.abs(Math.cos(f.stride)) * 0.06 * amp + (p.child ? Math.abs(Math.sin(f.stride * 0.5)) * 0.1 : 0);
    headY = 0;
  }
  if (sit) {
    legL = legR = -1.45;
    rigY = afloat ? -0.2 : -0.46;
    lean = 0.06;
    armL = armR = -0.5;
    if (afloat && walking) {
      // Rowing: both arms out and back together, leaning into it.
      const pull = Math.sin(t * 3.2 + f.seed);
      armL = armR = -1.0 + pull * 0.45;
      lean = 0.1 + pull * 0.16;
      headY = 0;
    }
  }
  if (work === "chop") {
    const c = (s * 0.9) % 1;
    const raise = c < 0.62 ? Math.sin((c / 0.62) * Math.PI * 0.5) : Math.pow(1 - (c - 0.62) / 0.38, 3);
    armR = -0.5 - 2.3 * raise;
    armL = -0.5 - 1.9 * raise;
    armLz = -0.3;
    lean = 0.32 - 0.42 * raise;
    headY = 0;
  } else if (work === "build") {
    armR = -1.25 + Math.sin(s * 9) * 0.5;
    armL = -0.7;
    lean = 0.12;
    headY = 0;
    headX = 0.15;
  } else if (work === "bend") {
    lean = 0.85 + Math.sin(s * 1.8) * 0.08;
    armL = -1.0 + Math.sin(s * 3.6) * 0.35;
    armR = -1.0 - Math.sin(s * 3.6) * 0.35;
    headX = -0.3;
    headY = 0;
  } else if (work === "fish") {
    armR = -1.15 + Math.max(0, Math.sin(s * 0.7)) * Math.sin(s * 9) * 0.12;
    armL = -0.4;
    headY = Math.sin(s * 0.3) * 0.2;
  }
  if (carry) {
    armR = -2.75;
    armRz = 0.2;
  }
  if (speaking && !walking && !work) {
    armR = (sit ? -0.9 : -0.55) + Math.sin(s * 4.7) * 0.4;
    armRz = -0.25 + Math.sin(s * 3.1) * 0.15;
    headX = Math.sin(s * 6.3) * 0.08;
    headY = Math.sin(s * 1.9) * 0.12;
  }
  if (asleep) {
    // Lying on their back, breathing.
    rigX = -Math.PI / 2;
    rigY = 0.24;
    legL = legR = 0;
    armL = armR = 0;
    lean = 0;
    headY = 0;
  }
  const k = 1 - Math.pow(0.0008, dt);
  f.legL.rotation.x += (legL - f.legL.rotation.x) * k;
  f.legR.rotation.x += (legR - f.legR.rotation.x) * k;
  f.armL.rotation.x += (armL - f.armL.rotation.x) * k;
  f.armR.rotation.x += (armR - f.armR.rotation.x) * k;
  f.armL.rotation.z += (armLz - f.armL.rotation.z) * k;
  f.armR.rotation.z += (armRz - f.armR.rotation.z) * k;
  f.upper.rotation.x += (lean - f.upper.rotation.x) * k;
  f.head.rotation.x += (headX - f.head.rotation.x) * k;
  f.head.rotation.y += (headY - f.head.rotation.y) * k;
  f.rig.rotation.x += (rigX - f.rig.rotation.x) * k;
  f.rig.position.y += (rigY - f.rig.position.y) * k;
  f.upper.scale.y = 1 + Math.sin(s * (asleep ? 1.1 : 1.9)) * 0.012;

  // Tools, the rod, the load on the shoulder, the lantern, the boat.
  f.tool.visible = work === "chop" || work === "build";
  f.rod.visible = work === "fish";
  f.load.visible = carry;
  if (carry) f.load.material.color.set(LOAD[f.from!]!);
  f.lantern.visible = env.dark > 0.55 && !asleep && !p.indoors && !atFire && !work && !carry;
  f.boat.visible = afloat;
  const y = env.standY(f.pos.x, f.pos.z);
  if (afloat) {
    const rock = 0.5 + env.swell;
    f.group.position.set(f.pos.x, y + 0.1 + Math.sin(t * 1.7 + f.pos.z * 0.4 + f.seed) * 0.07 * rock, f.pos.z);
    f.group.rotation.set(Math.sin(t * 1.3 + f.seed) * 0.05 * rock, f.heading, Math.sin(t * 1.9 + f.seed * 2) * 0.07 * rock);
  } else {
    f.group.position.set(f.pos.x, y + bob, f.pos.z);
    f.group.rotation.set(0, f.heading, 0);
  }
  f.group.visible = !(p.indoors && !walking);
}

/** Free what a figure owns (its shared material and the boat's geometry stay). */
export function disposeFigure(f: Figure) {
  f.group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry !== BOAT) o.geometry.dispose();
  });
  f.load.material.dispose();
}

/** Whether a spot on the town's ground is water. */
export const isWater = (ground: number[], x: number, z: number) => (ground[Math.round(x - 0.5) + Math.round(z - 0.5) * TOWN.w] ?? TOWN.sea) < TOWN.sea;
