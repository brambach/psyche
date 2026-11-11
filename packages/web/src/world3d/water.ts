// The sea: one wide sheet with moving swell, the sky mirrored at glancing angles, a path of light
// under the sun or moon, whitecaps when the wind gets up, and foam washing in and out along the
// shore. The shoreline is the same curve the terrain uses, so the foam sits exactly on the beach.

import * as THREE from "three";
import { TOWN } from "@psyche/engine";
import type { Palette } from "./atmosphere";

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec3 vWorld;
uniform float uTime, uWave, uGlint, uLight;
uniform vec3 uDeep, uShallow, uSky, uKeyDir, uKeyColor, uFoam;
uniform vec2 uWind;

float shore(float z) { return 26.0 + 5.0 * sin(z / 17.0) + 3.0 * sin(z / 7.0 + 1.0); }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float swell(vec2 p) {
  vec2 q = p * 0.16 + uWind * uTime * 0.3;
  return noise(q) * 0.6 + noise(q * 2.7 - uTime * 0.25) * 0.3 + noise(q * 6.1 + uTime * 0.4) * 0.1;
}
void main() {
  vec2 p = vWorld.xz;
  float d = shore(p.y) - p.x;
  float h = swell(p);
  float e = 0.6;
  vec3 n = normalize(vec3((h - swell(p + vec2(e, 0.0))) * uWave, 0.22, (h - swell(p + vec2(0.0, e))) * uWave));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float depth = smoothstep(0.0, 16.0, d);
  vec3 col = mix(uShallow, uDeep, depth) * uLight;
  col = mix(col, uSky, clamp(fres, 0.0, 1.0) * 0.6);
  // Light on the water.
  vec3 hv = normalize(uKeyDir + v);
  col += uKeyColor * (pow(max(dot(n, hv), 0.0), 90.0) * 0.9 + pow(max(dot(n, hv), 0.0), 14.0) * 0.08) * uGlint;
  // Whitecaps and shore foam are drawn on a half-block grid, so they read as blocks like the land.
  vec2 pq = floor(p * 2.0) / 2.0;
  float hq = swell(pq);
  float caps = smoothstep(0.76 - 0.1 * uWave, 0.82 - 0.1 * uWave, hq) * clamp((uWave - 0.8) * 1.4, 0.0, 1.0) * depth;
  float dq = shore(pq.y) - pq.x;
  float wash = sin(dq * 1.2 - uTime * 1.3 + noise(pq * 0.3) * 5.0) * 0.5 + 0.5;
  float foam = smoothstep(3.4, 0.4, dq) * smoothstep(0.55, 0.85, wash) + smoothstep(0.9, 0.2, dq);
  col = mix(col, uFoam * uLight, clamp(max(foam, caps), 0.0, 1.0) * 0.85);
  gl_FragColor = vec4(col, mix(0.55, 0.97, depth));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Sea {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly bed: THREE.Mesh;
  private time = 0;

  constructor(scene: THREE.Scene) {
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 }, uWave: { value: 0.6 }, uGlint: { value: 1 }, uLight: { value: 1 },
        uDeep: { value: new THREE.Color("#1f5f86") }, uShallow: { value: new THREE.Color("#58b7b9") }, uSky: { value: new THREE.Color("#bfe1f4") },
        uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uKeyColor: { value: new THREE.Color("#fff2dc") }, uFoam: { value: new THREE.Color("#f3f8f7") }, uWind: { value: new THREE.Vector2(1, 0) },
      },
    ]);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, fog: true }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(TOWN.w / 2, TOWN.sea - 0.15, TOWN.d / 2);
    this.mesh.renderOrder = 1;
    // The seabed far out, so deep water has something dark under it.
    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshBasicMaterial({ color: 0x1a4a66 }));
    this.bed.rotation.x = -Math.PI / 2;
    this.bed.position.set(TOWN.w / 2, 0.9, TOWN.d / 2);
    scene.add(this.bed, this.mesh);
  }

  update(dt: number, p: Palette, wind: { x: number; z: number; speed: number }) {
    this.time += dt * (0.7 + wind.speed * 1.3);
    const u = this.mesh.material.uniforms;
    u.uTime!.value = this.time;
    u.uWave!.value += (0.45 + wind.speed * 1.5 - u.uWave!.value) * Math.min(1, dt * 0.5);
    (u.uWind!.value as THREE.Vector2).set(wind.x, wind.z);
    (u.uSky!.value as THREE.Color).copy(p.horizon).lerp(p.zenith, 0.35);
    (u.uKeyDir!.value as THREE.Vector3).copy(p.keyDir);
    (u.uKeyColor!.value as THREE.Color).copy(p.key);
    u.uGlint!.value = Math.min(1.4, p.keyPower) * (1 - p.overcast * 0.8);
    // The water takes its brightness from the sky: nearly black on a moonless night, grey under cloud.
    const light = Math.min(1, 0.1 + p.fillPower * 0.42 + p.keyPower * 0.3) * (1 - p.overcast * 0.25);
    u.uLight!.value = light;
    (this.bed.material as THREE.MeshBasicMaterial).color.set(0x1a4a66).multiplyScalar(light);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh, this.bed);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.bed.geometry.dispose();
  }
}
