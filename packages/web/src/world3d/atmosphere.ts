// The sky and the light. One `Atmosphere` owns the dome (a gradient with the sun, the moon and its
// phase painted in), the stars, the clouds, the sun's light and its shadows, the fill light and the
// fog. Each frame it is told what the sky is (`SkyState`, from the engine) and blends toward it, so
// dawn comes up gradually and a storm rolls in rather than switching on.

import * as THREE from "three";
import type { SkyState } from "@psyche/engine";

/** Everything the sky decides about colour and light at one moment. */
export interface Palette {
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** The colour and strength of the one light that casts shadows: the sun by day, the moon by night. */
  key: THREE.Color;
  keyPower: number;
  keyDir: THREE.Vector3;
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** How strongly the sun's disc and halo show, and the moon's. */
  sunShow: number;
  moonShow: number;
  moonFull: number;
  fillSky: THREE.Color;
  fillGround: THREE.Color;
  fillPower: number;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  cloud: THREE.Color;
  cloudCover: number;
  stars: number;
  /** 0 by day, 1 at night: for lit windows, lanterns and fireflies. */
  dark: number;
  /** How wet and grey everything is, 0 to 1. */
  overcast: number;
}

const C = (hex: string) => new THREE.Color(hex);
const K = {
  nightZenith: C("#050a1c"), dayZenith: C("#3a82d6"), duskZenith: C("#3b3f86"),
  nightHorizon: C("#0f1a36"), dayHorizon: C("#bfe1f4"), dawnGlow: C("#ffb38f"), duskGlow: C("#ff9659"),
  greyNight: C("#161b26"), greyDay: C("#98a2ab"), greyDayHorizon: C("#b7bfc6"),
  sunLow: C("#ff8f4d"), sunHigh: C("#fff2dc"), moon: C("#9fb6ee"),
  fillSkyNight: C("#3d5391"), fillSkyDay: C("#cfe2ff"), fillGroundNight: C("#161d2e"), fillGroundDay: C("#7d775a"),
  cloudNight: C("#1b2238"), cloudDay: C("#ffffff"), cloudRain: C("#5e6873"), cloudGlow: C("#ffb590"),
  mist: C("#d5dbde"),
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The palette for a sky. Pure: the same sky always gives the same light. */
export function paletteOf(sky: SkyState): Palette {
  const d = sky.daylight, g = sky.glow * (1 - 0.6 * smooth(0.4, 0.9, sky.cloud));
  const overcast = smooth(0.45, 0.95, sky.cloud);
  const wet = sky.precip === "none" ? 0 : sky.intensity;
  const morning = sky.hour < 12;

  const zenith = K.nightZenith.clone().lerp(K.dayZenith, d).lerp(K.duskZenith, g * 0.45 * (1 - d * 0.6));
  const horizon = K.nightHorizon.clone().lerp(K.dayHorizon, d).lerp(morning ? K.dawnGlow : K.duskGlow, g * 0.8);
  const grey = K.greyNight.clone().lerp(K.greyDay, d).multiplyScalar(1 - 0.35 * wet);
  const greyH = K.greyNight.clone().lerp(K.greyDayHorizon, d).multiplyScalar(1 - 0.3 * wet);
  zenith.lerp(grey, overcast * 0.92);
  horizon.lerp(greyH, overcast * 0.88);

  const sunDir = new THREE.Vector3(sky.sun.x, sky.sun.y, sky.sun.z);
  const moonDir = new THREE.Vector3(sky.moon.x, sky.moon.y, sky.moon.z);
  const sunPower = 2.2 * smooth(-0.06, 0.3, sky.height) * (1 - 0.86 * overcast);
  const moonPower = 1.3 * (0.25 + 0.75 * sky.moonFull) * (1 - d) * smooth(0.0, 0.18, sky.moon.y) * (1 - 0.75 * overcast);
  const bySun = sunPower >= moonPower;
  const key = bySun ? K.sunLow.clone().lerp(K.sunHigh, smooth(0.02, 0.5, sky.height)) : K.moon.clone();
  // Keep the shadow light off the horizon, where shadows would stretch forever.
  const keyDir = (bySun ? sunDir : moonDir).clone();
  keyDir.y = Math.max(keyDir.y, 0.16);
  keyDir.normalize();

  const fillSky = K.fillSkyNight.clone().lerp(K.fillSkyDay, d).lerp(morning ? K.dawnGlow : K.duskGlow, g * 0.25);
  const fillGround = K.fillGroundNight.clone().lerp(K.fillGroundDay, d);
  // Night needs a strong fill to read at all (dark ground gives little back); snow takes care of itself.
  const fillPower = lerp(2.1, 1.0, d) + overcast * 0.35 * d + 0.5 * sky.moonFull * (1 - d) + g * 1.1 * (1 - d);

  const fog = horizon.clone().lerp(K.mist.clone().multiplyScalar(lerp(0.25, 1, d)), sky.mist * 0.8);
  let fogNear = lerp(240, 110, wet), fogFar = lerp(760, 360, wet);
  fogNear = lerp(fogNear, 22, sky.mist);
  fogFar = lerp(fogFar, 200, sky.mist);

  const cloud = K.cloudNight.clone().lerp(K.cloudDay, d).lerp(K.cloudGlow, g * 0.55).lerp(K.cloudRain.clone().multiplyScalar(lerp(0.35, 1, d)), overcast * 0.8);
  return {
    zenith, horizon, key, keyPower: Math.max(sunPower, moonPower), keyDir, sunDir, moonDir,
    sunShow: (1 - overcast) * smooth(-0.12, 0.02, sky.height), moonShow: (1 - overcast) * (1 - d * 0.85) * smooth(-0.05, 0.05, sky.moon.y), moonFull: sky.moonFull,
    fillSky, fillGround, fillPower, fog, fogNear, fogFar, cloud, cloudCover: sky.cloud,
    stars: (1 - d) * (1 - d) * (1 - overcast) * (1 - 0.85 * g), dark: 1 - smooth(0.05, 0.6, d), overcast: Math.max(overcast, wet * 0.8),
  };
}

/** Move `a` toward `b` by `k` (0 to 1), in place. */
function ease(a: Palette, b: Palette, k: number) {
  for (const key of ["zenith", "horizon", "key", "fillSky", "fillGround", "fog", "cloud"] as const) a[key].lerp(b[key], k);
  for (const key of ["keyPower", "sunShow", "moonShow", "moonFull", "fillPower", "fogNear", "fogFar", "cloudCover", "stars", "dark", "overcast"] as const) a[key] = lerp(a[key], b[key], k);
  for (const key of ["keyDir", "sunDir", "moonDir"] as const) a[key].lerp(b[key], k).normalize();
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoonDir;
uniform float uSun, uMoon, uMoonFull, uFlash;
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-up * 4.5));
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.2, d.y));
  // The sun: a wide warm wash, a tight halo, the disc.
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * uSun * (pow(sd, 6.0) * 0.12 + pow(sd, 60.0) * 0.3 + pow(sd, 700.0) * 0.9);
  col = mix(col, uSunColor * 3.0, smoothstep(0.99972, 0.99982, sd) * uSun);
  // The moon, with its phase: the lit part is everything to one side of the terminator.
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
  vec3 top = cross(uMoonDir, right);
  vec2 m = vec2(dot(d, right), dot(d, top)) / 0.026;
  float inside = step(length(m), 1.0) * step(0.0, dot(d, uMoonDir));
  float edge = (1.0 - 2.0 * uMoonFull) * sqrt(max(0.0, 1.0 - m.y * m.y));
  float lit = smoothstep(edge - 0.06, edge + 0.06, m.x);
  vec3 moonCol = vec3(0.93, 0.95, 1.0) * (0.86 + 0.14 * sin(m.x * 5.0 + 1.0) * sin(m.y * 4.0));
  col = mix(col, mix(col * 1.15 + 0.01, moonCol, lit), inside * uMoon);
  col += vec3(0.45, 0.55, 0.85) * pow(max(dot(d, uMoonDir), 0.0), 220.0) * 0.22 * uMoon * uMoonFull;
  col += uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CLOUDS = 34;
const FIELD = 1100;

export class Atmosphere {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly fill = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly fog = new THREE.Fog(0xaaccee, 200, 700);
  /** What is on screen now (eased toward the sky it was last given). */
  now: Palette | undefined;
  /** A lightning flash in progress, 0 to 1. */
  flash = 0;
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private clouds: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  private puffs: { cloud: number; ox: number; oy: number; oz: number; sx: number; sy: number; sz: number }[] = [];
  private cloudAt: { x: number; z: number; y: number; when: number }[] = [];
  private drift = new THREE.Vector2();
  private m = new THREE.Matrix4();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, seed = 1) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
        uniforms: {
          uZenith: { value: C("#3a82d6") }, uHorizon: { value: C("#bfe1f4") }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: C("#fff2dc") },
          uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uSun: { value: 1 }, uMoon: { value: 0 }, uMoonFull: { value: 1 }, uFlash: { value: 0 },
        },
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;

    // Stars: a fixed scatter, a few bright ones, turning slowly through the night.
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const N = 900;
    const sp = new Float32Array(N * 3), sc = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp.set([r * Math.cos(a) * 780, Math.abs(u) * 780, r * Math.sin(a) * 780], i * 3);
      const b = 0.35 + Math.pow(rnd(), 3) * 0.65, warm = rnd();
      sc.set([b * (0.85 + warm * 0.15), b * 0.92, b * (1 - warm * 0.2)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    sg.setAttribute("color", new THREE.BufferAttribute(sc, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;

    // Clouds: flat-bottomed heaps of slabs, each cloud a few of them.
    for (let c = 0; c < CLOUDS; c++) {
      this.cloudAt.push({ x: rnd() * FIELD, z: rnd() * FIELD, y: 120 + rnd() * 40, when: (c + rnd()) / CLOUDS });
      const n = 3 + Math.floor(rnd() * 4);
      const w = 26 + rnd() * 30;
      for (let i = 0; i < n; i++) {
        const k = i === 0 ? 1 : 0.45 + rnd() * 0.45;
        this.puffs.push({ cloud: c, ox: i === 0 ? 0 : (rnd() - 0.5) * w * 1.3, oy: i === 0 ? 0 : 2 + rnd() * 5, oz: i === 0 ? 0 : (rnd() - 0.5) * w * 0.8, sx: w * k, sy: 5 + rnd() * 5 * k, sz: w * k * (0.5 + rnd() * 0.3) });
      }
    }
    this.clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true }), this.puffs.length);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -8;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.45;
    this.group.add(this.dome, this.stars, this.clouds);
    scene.add(this.group, this.sun, this.sun.target, this.fill);
    scene.fog = this.fog;
  }

  /**
   * Blend toward `sky` and place everything round the camera. `calm` (0 to 1) holds the light at a
   * steady afternoon when time is running too fast to watch days flick by.
   */
  update(dt: number, sky: SkyState, camera: THREE.PerspectiveCamera, target: THREE.Vector3, steady?: SkyState, calm = 0) {
    const want = paletteOf(sky);
    if (steady && calm > 0) ease(want, paletteOf(steady), calm);
    if (!this.now) this.now = want;
    else ease(this.now, want, 1 - Math.pow(0.02, dt));
    const p = this.now;
    this.flash = Math.max(0, this.flash - dt * 5);
    const flash = this.flash * this.flash;

    const u = this.dome.material.uniforms;
    u.uZenith!.value.copy(p.zenith);
    u.uHorizon!.value.copy(p.horizon);
    u.uSunDir!.value.copy(p.sunDir);
    u.uMoonDir!.value.copy(p.moonDir);
    u.uSunColor!.value.copy(K.sunLow).lerp(K.sunHigh, smooth(0.0, 0.4, p.sunDir.y));
    u.uSun!.value = p.sunShow;
    u.uMoon!.value = p.moonShow;
    u.uMoonFull!.value = p.moonFull;
    u.uFlash!.value = flash * 0.6;
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.9);

    this.stars.position.copy(camera.position);
    this.stars.material.opacity = p.stars;
    this.stars.visible = p.stars > 0.01;
    this.stars.rotation.z = sky.hour * 0.02;

    this.fog.color.copy(p.fog).addScalar(flash * 0.3);
    this.fog.near = p.fogNear;
    this.fog.far = p.fogFar;
    this.scene.background = this.fog.color;

    this.fill.color.copy(p.fillSky);
    this.fill.groundColor.copy(p.fillGround);
    this.fill.intensity = p.fillPower + flash * 2.5;
    this.sun.color.copy(p.key);
    this.sun.intensity = p.keyPower;

    // The shadow box follows where you are looking, sized to how far out you are, and moves in whole
    // texels so shadow edges do not crawl as the camera glides.
    const reach = Math.max(70, Math.min(230, camera.position.distanceTo(target) * 0.95));
    const cam = this.sun.shadow.camera;
    if (cam.right !== reach) {
      cam.left = -reach; cam.right = reach; cam.top = reach; cam.bottom = -reach; cam.near = 1; cam.far = 700;
      cam.updateProjectionMatrix();
    }
    const texel = (reach * 2) / this.sun.shadow.mapSize.x * 4;
    const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, 6, tz);
    this.sun.position.set(tx, 6, tz).addScaledVector(p.keyDir, 320);
    this.sun.castShadow = p.keyPower > 0.06;

    // Clouds ride the wind and wrap round a wide field centred on the camera.
    this.drift.x += sky.wind.x * (2 + sky.wind.speed * 22) * dt;
    this.drift.y += sky.wind.z * (2 + sky.wind.speed * 22) * dt;
    const mat = this.clouds.material;
    mat.color.copy(p.cloud);
    mat.emissive.copy(p.cloud).multiplyScalar(0.45 + flash);
    const half = FIELD / 2;
    // From high above, the clouds thin away so they never sit between you and the town.
    const below = 1 - smooth(70, 108, camera.position.y);
    this.puffs.forEach((pf, i) => {
      const c = this.cloudAt[pf.cloud]!;
      const show = smooth(c.when - 0.02, c.when + 0.1, p.cloudCover * 1.12);
      const x = ((((c.x + this.drift.x - camera.position.x + half) % FIELD) + FIELD) % FIELD) - half + camera.position.x;
      const z = ((((c.z + this.drift.y - camera.position.z + half) % FIELD) + FIELD) % FIELD) - half + camera.position.z;
      // Fade out toward the edge of the field so nothing pops when a cloud wraps.
      const edge = 1 - smooth(half * 0.72, half * 0.98, Math.max(Math.abs(x - camera.position.x), Math.abs(z - camera.position.z)));
      const grow = show * edge * below * (1 + p.overcast * 0.7);
      this.m.makeScale(Math.max(0.001, pf.sx * grow), Math.max(0.001, pf.sy * show * edge * below), Math.max(0.001, pf.sz * grow));
      this.m.setPosition(x + pf.ox, c.y + pf.oy + (pf.sy * show) / 2 - p.overcast * 14, z + pf.oz);
      this.clouds.setMatrixAt(i, this.m);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group, this.sun, this.sun.target, this.fill);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.clouds.geometry.dispose();
    this.clouds.material.dispose();
    this.sun.shadow.map?.dispose();
  }
}
