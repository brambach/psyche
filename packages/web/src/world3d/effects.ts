// The small things that make a town look lived in and the weather feel like weather: rain and snow
// that slant with the wind, smoke that bends with it, the fire and its sparks, windows lit in the
// evening, gulls over the landing, fireflies by the reedbed on summer nights, dust where a block has
// just been set.

import * as THREE from "three";
import { SPOTS, TOWN, type Placement, type SkyState } from "@psyche/engine";
import type { Palette } from "./atmosphere";
import { softDot } from "./figures";

// ------------------------------------------------------------------ rain and snow

const FALL_VERT = /* glsl */ `
attribute float aEnd;
uniform float uTime, uSpeed, uLen, uSize, uSway;
uniform vec3 uCenter, uBox;
uniform vec2 uWind;
varying float vFade;
void main() {
  vec3 b = position;
  float fall = uTime * uSpeed * (0.75 + 0.5 * fract(b.x * 7.13 + b.z * 3.7));
  float y = mod(b.y * uBox.y - fall, uBox.y);
  float fallen = uBox.y - y;
  vec2 xz = b.xz * uBox.xz + uWind * fallen;
  xz += uSway * vec2(sin(uTime * 1.1 + b.x * 40.0), cos(uTime * 0.9 + b.z * 40.0));
  xz = mod(xz - uCenter.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5 + uCenter.xz;
  vec3 p = vec3(xz.x, y + uCenter.y, xz.y) + aEnd * uLen * normalize(vec3(uWind.x, -1.0, uWind.y));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize / max(1.0, -mv.z), 1.5, 7.0);
  // Thin out toward the edge of the box and near the ground, so the rain has no hard border.
  vec2 e = abs(xz - uCenter.xz) / (uBox.xz * 0.5);
  vFade = (1.0 - smoothstep(0.7, 1.0, max(e.x, e.y))) * smoothstep(0.0, 3.0, y);
}`;
const FALL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha, uRound;
varying float vFade;
void main() {
  float a = uAlpha * vFade;
  if (uRound > 0.5) {
    vec2 c = gl_PointCoord - 0.5;
    a *= smoothstep(0.5, 0.15, length(c));
  }
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Rain as slanting streaks and snow as drifting flakes, in a box that follows where you are looking. */
export class Precipitation {
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private time = 0;
  private amount = { rain: 0, snow: 0 };
  private static RAIN = 7000;
  private static SNOW = 5000;

  constructor(private scene: THREE.Scene) {
    const uniforms = (o: Record<string, number>) => ({
      uTime: { value: 0 }, uSpeed: { value: o.speed }, uLen: { value: o.len }, uSize: { value: o.size }, uSway: { value: o.sway }, uRound: { value: o.round },
      uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(170, 70, 170) }, uWind: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color("#c4d4e4") }, uAlpha: { value: 0.5 },
    });
    const rp = new Float32Array(Precipitation.RAIN * 6), re = new Float32Array(Precipitation.RAIN * 2);
    for (let i = 0; i < Precipitation.RAIN; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      rp.set([x, y, z, x, y, z], i * 6);
      re.set([0, 1], i * 2);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    rg.setAttribute("aEnd", new THREE.BufferAttribute(re, 1));
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({ vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, uniforms: uniforms({ speed: 46, len: 1.7, size: 1, sway: 0, round: 0 }), transparent: true, depthWrite: false }));
    const sp = new Float32Array(Precipitation.SNOW * 3);
    for (let i = 0; i < sp.length; i++) sp[i] = Math.random();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    sg.setAttribute("aEnd", new THREE.BufferAttribute(new Float32Array(Precipitation.SNOW), 1));
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, uniforms: uniforms({ speed: 4.2, len: 0, size: 260, sway: 0.7, round: 1 }), transparent: true, depthWrite: false }));
    for (const o of [this.rain, this.snow]) {
      o.frustumCulled = false;
      o.visible = false;
      o.renderOrder = 5;
      scene.add(o);
    }
  }

  update(dt: number, sky: SkyState, p: Palette, center: THREE.Vector3) {
    this.time += dt;
    const want = { rain: sky.precip === "rain" ? sky.intensity : 0, snow: sky.precip === "snow" ? sky.intensity : 0 };
    for (const k of ["rain", "snow"] as const) this.amount[k] += (want[k] - this.amount[k]) * Math.min(1, dt * 1.2);
    const light = Math.min(1, 0.25 + p.fillPower * 0.6 + p.keyPower * 0.3);
    const set = (o: THREE.LineSegments | THREE.Points, amount: number, total: number, per: number, slant: number, alpha: number, tint: string) => {
      o.visible = amount > 0.02;
      if (!o.visible) return;
      const u = (o.material as THREE.ShaderMaterial).uniforms;
      u.uTime!.value = this.time;
      (u.uCenter!.value as THREE.Vector3).set(center.x, Math.max(0, center.y - 8), center.z);
      (u.uWind!.value as THREE.Vector2).set(sky.wind.x * sky.wind.speed * slant, sky.wind.z * sky.wind.speed * slant);
      (u.uColor!.value as THREE.Color).set(tint).multiplyScalar(light);
      u.uAlpha!.value = alpha;
      o.geometry.setDrawRange(0, Math.floor(total * Math.min(1, 0.15 + amount)) * per);
    };
    set(this.rain, this.amount.rain, Precipitation.RAIN, 2, 0.75, 0.3 + 0.25 * this.amount.rain, "#c9d8e8");
    set(this.snow, this.amount.snow, Precipitation.SNOW, 1, 1.6, 0.9, "#ffffff");
  }

  dispose() {
    for (const o of [this.rain, this.snow]) {
      this.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}

// ------------------------------------------------------------------ soft particles

const PUFF_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
}`;
const PUFF_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Puff {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; s0: number; s1: number; r: number; g: number; b: number; a: number;
  /** How much the wind carries it, and whether its light pulses (a firefly). */
  wind: number; blink: number;
}

/** A pool of soft round particles: smoke and dust in one (see-through), flame and sparks in another (they add light). */
export class Puffs {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private live: Puff[] = [];
  private pos: Float32Array;
  private size: Float32Array;
  private col: Float32Array;

  constructor(private scene: THREE.Scene, private max: number, additive: boolean) {
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: { uMap: { value: softDot() }, uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 7 : 6;
    scene.add(this.points);
  }

  emit(p: Partial<Puff> & { x: number; y: number; z: number }) {
    if (this.live.length >= this.max) return;
    this.live.push({ vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, wind: 0, blink: 0, ...p });
  }

  /** `scale` turns a size in blocks into pixels at a distance (the canvas height over twice the tangent of half the field of view). */
  update(dt: number, wind: { x: number; z: number; speed: number }, scale: number) {
    let n = 0;
    for (const p of this.live) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const w = p.wind * (0.6 + wind.speed * 5);
      p.x += (p.vx + wind.x * w) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + wind.z * w) * dt;
      const k = p.age / p.life;
      this.pos.set([p.x, p.y, p.z], n * 3);
      this.size[n] = p.s0 + (p.s1 - p.s0) * k;
      const fade = Math.min(1, k * 8) * (1 - k) * (p.blink ? 0.5 + 0.5 * Math.sin(p.age * p.blink) : 1);
      this.col.set([p.r, p.g, p.b, p.a * fade], n * 4);
      this.live[n++] = p;
    }
    this.live.length = n;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const a of ["position", "aSize", "aColor"]) (g.attributes[a] as THREE.BufferAttribute).needsUpdate = true;
    this.points.material.uniforms.uScale!.value = scale;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// ------------------------------------------------------------------ windows

/** Where a finished house's windows are: the gaps left in the second course of its walls. */
export function windowsOf(plan: Placement[], floor: number): [number, number, number][] {
  const walls = plan.filter((p) => p.part === "walls");
  if (!walls.length) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = -Infinity;
  for (const p of walls) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); top = Math.max(top, p.y);
  }
  if (top < floor + 2) return [];
  const have = new Set(walls.filter((p) => p.y === floor + 1).map((p) => `${p.x},${p.z}`));
  const out: [number, number, number][] = [];
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
      if (edge && !corner && !have.has(`${x},${z}`)) out.push([x, floor + 1, z]);
    }
  return out;
}

const hash3 = (x: number, y: number, z: number) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Panes in every window: dark by day, lit warm from dusk until each house goes to bed. */
export class Windows {
  private mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private halo: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private cells: [number, number, number][] = [];
  private c = new THREE.Color();
  private static MAX = 600;

  constructor(private scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshBasicMaterial({ color: 0xffffff }), Windows.MAX);
    this.mesh.count = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Windows.MAX * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(Windows.MAX), 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(Windows.MAX * 4), 4));
    this.halo = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: { uMap: { value: softDot() }, uScale: { value: 600 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending }));
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 7;
    scene.add(this.mesh, this.halo);
  }

  set(cells: [number, number, number][]) {
    this.cells = cells.slice(0, Windows.MAX);
    const m = new THREE.Matrix4();
    const pos = this.halo.geometry.attributes.position as THREE.BufferAttribute;
    this.cells.forEach(([x, y, z], i) => {
      this.mesh.setMatrixAt(i, m.makeTranslation(x + 0.5, y + 0.5, z + 0.5));
      pos.setXYZ(i, x + 0.5, y + 0.5, z + 0.5);
    });
    this.mesh.count = this.cells.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
    this.halo.geometry.setDrawRange(0, this.cells.length);
  }

  update(t: number, sky: SkyState, p: Palette, scale: number) {
    const size = this.halo.geometry.attributes.aSize as THREE.BufferAttribute;
    const col = this.halo.geometry.attributes.aColor as THREE.BufferAttribute;
    const evening = sky.hour >= 12 ? sky.hour : sky.hour + 24;
    this.cells.forEach(([x, y, z], i) => {
      // Each house keeps its own hours: lamps lit as it gets dark, out somewhere between ten and midnight, a few early risers.
      const house = hash3(Math.floor(x / 13), 7, Math.floor(z / 13));
      const bed = 22 + house * 2.2;
      const early = house > 0.7 && sky.hour > sky.sunrise - 1.6 && sky.hour < sky.sunrise + 0.5;
      const on = p.dark > 0.25 && ((evening >= 15 && evening < bed) || early) ? Math.min(1, (p.dark - 0.25) * 3) : 0;
      const flicker = 0.9 + 0.1 * Math.sin(t * (5 + house * 4) + x * 3 + z);
      this.c.setRGB(0.06, 0.08, 0.1).lerp(new THREE.Color(1.0, 0.72, 0.36), on * flicker);
      this.mesh.setColorAt(i, this.c);
      size.setX(i, 3.2);
      col.setXYZW(i, 1.0, 0.62, 0.25, on * 0.5 * flicker);
    });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    size.needsUpdate = true;
    col.needsUpdate = true;
    this.halo.material.uniforms.uScale!.value = scale;
  }

  dispose() {
    this.scene.remove(this.mesh, this.halo);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.halo.geometry.dispose();
    this.halo.material.dispose();
  }
}

// ------------------------------------------------------------------ gulls

/** A few gulls wheeling over the landing by day. They glide, flap now and then, and go to roost at dusk and in gales. */
export class Gulls {
  private birds: { group: THREE.Group; left: THREE.Mesh; right: THREE.Mesh; cx: number; cz: number; r: number; h: number; w: number; ph: number }[] = [];
  private show = 0;

  constructor(private scene: THREE.Scene, n = 7) {
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f4f3 }), grey = new THREE.MeshLambertMaterial({ color: 0xa9b3b8 });
    const hb = SPOTS.harbour!;
    for (let i = 0; i < n; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.9), white);
      const wing = () => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.42).translate(0.55, 0, 0), grey);
        return m;
      };
      const left = wing(), right = wing();
      right.scale.x = -1;
      group.add(body, left, right);
      scene.add(group);
      this.birds.push({ group, left, right, cx: hb.x - 12 + Math.random() * 40, cz: hb.z - 50 + Math.random() * 110, r: 12 + Math.random() * 22, h: TOWN.sea + 12 + Math.random() * 16, w: (0.18 + Math.random() * 0.14) * (i % 2 ? 1 : -1), ph: Math.random() * 6.28 });
    }
  }

  update(t: number, dt: number, sky: SkyState) {
    const want = sky.daylight > 0.35 && sky.wind.speed < 0.8 ? 1 : 0;
    this.show += (want - this.show) * Math.min(1, dt * 0.4);
    for (const b of this.birds) {
      b.group.visible = this.show > 0.02;
      if (!b.group.visible) continue;
      const a = t * b.w + b.ph;
      const r = b.r * (1 + 0.25 * Math.sin(t * 0.13 + b.ph));
      // They come down out of the sky to roost, and climb back up in the morning.
      b.group.position.set(b.cx + Math.cos(a) * r, TOWN.sea + (b.h - TOWN.sea) * this.show + Math.sin(t * 0.4 + b.ph) * 2, b.cz + Math.sin(a) * r);
      b.group.rotation.set(0, -a + (b.w > 0 ? 0 : Math.PI), -0.35 * Math.sign(b.w), "YXZ");
      const flap = Math.sin(t * 0.21 + b.ph) > 0.2 ? Math.sin(t * 9 + b.ph) * 0.55 : 0.12 + Math.sin(t * 1.3 + b.ph) * 0.05;
      b.left.rotation.z = flap;
      b.right.rotation.z = -flap;
    }
  }

  dispose() {
    for (const b of this.birds) this.scene.remove(b.group);
  }
}

// ------------------------------------------------------------------ fire, smoke, fireflies, dust, lightning

export interface LifeState {
  /** Smoke rises from each of these (the fire circle first, then chimneys). */
  sources: [number, number, number][];
  /** Whether the fire in the circle is burning. */
  fireLit: boolean;
  fire?: [number, number, number];
  season: string;
  /** The height of the ground at a spot. */
  ground: (x: number, z: number) => number;
}

/** Everything that drifts, glows or sparks: one object so the town view has one thing to tick. */
export class Life {
  readonly soft: Puffs;
  readonly glow: Puffs;
  private carry = { smoke: 0, flame: 0, ember: 0, fly: 0 };
  private nextBolt = 4;
  /** Called when lightning strikes, with how far off it was (0 near, 1 far). */
  onThunder?: (far: number) => void;

  constructor(scene: THREE.Scene, private hearth: THREE.PointLight) {
    this.soft = new Puffs(scene, 900, false);
    this.glow = new Puffs(scene, 700, true);
  }

  /** A puff of dust where blocks have just been set. */
  dust(cells: { x: number; y: number; z: number }[]) {
    for (const c of cells.slice(0, 14))
      for (let i = 0; i < 3; i++)
        this.soft.emit({ x: c.x + Math.random(), y: c.y + 0.3 + Math.random() * 0.6, z: c.z + Math.random(), vx: (Math.random() - 0.5) * 1.2, vy: 0.4 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.2, life: 0.9 + Math.random() * 0.6, s0: 0.5, s1: 1.8, r: 0.78, g: 0.7, b: 0.56, a: 0.5, wind: 0.3 });
  }

  update(t: number, dt: number, sky: SkyState, p: Palette, st: LifeState, scale: number, flash: (strength: number) => void) {
    const light = Math.min(1, 0.18 + p.fillPower * 0.55 + p.keyPower * 0.25);
    // Smoke: thicker in the cold, torn away faster in wind.
    this.carry.smoke += dt * st.sources.length * (st.season === "winter" ? 3.2 : 2.2);
    while (this.carry.smoke >= 1) {
      this.carry.smoke -= 1;
      const i = Math.floor(Math.random() * st.sources.length);
      const s = st.sources[i];
      if (!s || (i === 0 && st.fire && !st.fireLit)) continue;
      const g = (0.5 + Math.random() * 0.2) * light * light;
      this.soft.emit({ x: s[0] + (Math.random() - 0.5) * 0.4, y: s[1], z: s[2] + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.25, vy: 1.1 + Math.random() * 0.7, vz: (Math.random() - 0.5) * 0.25, life: 5 + Math.random() * 3, s0: 0.8, s1: 3.2 + Math.random() * 1.4, r: g, g: g, b: g * 1.03, a: 0.24, wind: 0.5 });
    }
    // The fire: flames that lick up and fade, sparks that climb into the dark, and light that will not hold still.
    const f = st.fire;
    if (f && st.fireLit) {
      this.carry.flame += dt * 34;
      while (this.carry.flame >= 1) {
        this.carry.flame -= 1;
        const hot = Math.random();
        this.glow.emit({ x: f[0] + (Math.random() - 0.5) * 0.9, y: f[1] - 0.6 + Math.random() * 0.3, z: f[2] + (Math.random() - 0.5) * 0.9, vx: (Math.random() - 0.5) * 0.4, vy: 1.6 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 0.4, life: 0.4 + Math.random() * 0.5, s0: 1.0 + Math.random() * 0.5, s1: 0.15, r: 1, g: 0.3 + hot * 0.4, b: 0.03 + hot * 0.1, a: 0.26, wind: 0.08 });
      }
      this.carry.ember += dt * (3 + p.dark * 7);
      while (this.carry.ember >= 1) {
        this.carry.ember -= 1;
        this.glow.emit({ x: f[0] + (Math.random() - 0.5) * 0.6, y: f[1], z: f[2] + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.9, vy: 2 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 0.9, life: 1.6 + Math.random() * 1.8, s0: 0.3, s1: 0.12, r: 1, g: 0.6, b: 0.2, a: 0.95, wind: 0.35 });
      }
      this.hearth.position.set(f[0], f[1] + 0.6, f[2]);
      const flicker = 0.78 + 0.14 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 23.7 + 1.3) + 0.06 * Math.sin(t * 5.1);
      this.hearth.intensity = (25 + p.dark * 95) * flicker;
    } else this.hearth.intensity *= Math.max(0, 1 - dt * 2);
    // Fireflies: warm, still nights, low over the reedbed and along the edge of the pinewood.
    if (p.dark > 0.7 && sky.precip === "none" && sky.wind.speed < 0.35 && (st.season === "summer" || st.season === "spring")) {
      this.carry.fly += dt * (st.season === "summer" ? 14 : 5);
      while (this.carry.fly >= 1) {
        this.carry.fly -= 1;
        const at = Math.random() < 0.5 ? SPOTS.reeds! : Math.random() < 0.5 ? { x: SPOTS.woods!.x - 24, z: SPOTS.woods!.z, r: 22 } : SPOTS.fields!;
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * (at.r + 8);
        const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
        this.glow.emit({ x, y: Math.max(TOWN.sea, st.ground(x, z)) + 1.2 + Math.random() * 2.5, z, vx: (Math.random() - 0.5) * 0.7, vy: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.7, life: 4 + Math.random() * 4, s0: 0.42, s1: 0.42, r: 0.8, g: 1, b: 0.4, a: 0.95, blink: 2 + Math.random() * 3 });
      }
    }
    // Lightning: a double flash, then the thunder after a pause that says how far off it was.
    if (sky.thunder) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + Math.random() * 14;
        const far = Math.random();
        flash(1 - far * 0.5);
        setTimeout(() => flash(0.7 - far * 0.3), 140);
        this.onThunder?.(far);
      }
    }
    this.soft.update(dt, sky.wind, scale);
    this.glow.update(dt, sky.wind, scale);
  }

  dispose() {
    this.soft.dispose();
    this.glow.dispose();
  }
}
