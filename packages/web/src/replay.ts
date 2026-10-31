// The recorded century in 3D, for a standalone page: the same blocky coast as the live view, driven
// by a timeline instead of a server. The page sets the (fractional) year; towns appear as their
// founding boat lands, houses and tents fill in year by year, and trade boats run while towns trade.
// Bundled on its own (three.js included) so the page needs nothing else.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Timeline } from "@psyche/engine";
import { boatAt, buildCoast, D, H, hash, SEA, strHash, townsAt, W, type TownNow } from "./coastScene";
import { buildMesh, COLOR } from "./voxelMesh";

export interface ReplayHandle {
  setYear(yearF: number): void;
  dispose(): void;
}

/** Mount the 3D coast in `el` (which should be position: relative and sized). */
export function mount(el: HTMLElement, t: Timeline, seed: number): ReplayHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  el.prepend(renderer.domElement);
  renderer.domElement.style.display = "block";
  const labels = document.createElement("div");
  labels.className = "r3-labels";
  el.appendChild(labels);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#a9d3e6");
  scene.fog = new THREE.Fog("#a9d3e6", 260, 620);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 1500);
  // A narrow screen needs to stand further back to see the whole coast.
  const narrow = el.clientWidth < 600;
  camera.position.set(W / 2, narrow ? 250 : 175, D * (narrow ? 1.75 : 1.5));
  if (narrow) scene.fog = new THREE.Fog("#a9d3e6", 420, 900);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(W / 2, 4, D * 0.55);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.minDistance = 20;
  controls.maxDistance = 520;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(-100, 200, 60);
  scene.add(sun);
  const land = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const sea = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: COLOR.water }));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(W / 2, SEA - 0.2, D / 2);
  scene.add(ocean, land, sea);
  const boats = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 1, 4.4), new THREE.MeshLambertMaterial({ color: 0x7a5232 }), 200);
  boats.count = 0;
  scene.add(boats);

  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  let yearF = 1;
  let key = "";
  let towns: TownNow[] = [];
  const all = new Map<string, TownNow>();
  // Every town's final place, so a founding boat knows where it is heading before the town exists.
  for (let i = 0; i < t.years.length; i++) for (const x of townsAt(t, seed, i)) if (!all.has(x.id)) all.set(x.id, x);
  const founded = new Map(t.towns.map((x) => [x.id, x.founded]));
  const tags = new Map<string, HTMLButtonElement>();
  let fly: THREE.Vector3 | undefined;

  /** Towns standing at a fractional year: a new town appears once its boat has landed. */
  const standing = (yf: number) => {
    const i = Math.max(0, Math.min(t.years.length - 1, Math.floor(yf) - 1));
    return townsAt(t, seed, i).filter((x) => (founded.get(x.id) ?? 1) <= 1 || yf >= (founded.get(x.id) ?? 1) + 0.6);
  };

  const rebuild = () => {
    towns = standing(yearF);
    const k = towns.map((x) => `${x.id}:${x.houses}:${x.tents}`).join(",");
    if (k === key) return;
    key = k;
    const cells = buildCoast(towns, seed);
    land.geometry.dispose();
    land.geometry = buildMesh({ version: 0, w: W, d: D, h: H, cells }, false);
    sea.geometry.dispose();
    sea.geometry = buildMesh({ version: 0, w: W, d: D, h: H, cells }, true);
  };

  const year = () => Math.max(1, Math.min(t.years.length, Math.floor(yearF)));
  const updateTags = () => {
    const y = year();
    const shunned = new Map(t.shunned.filter((s) => s.year === y).map((s) => [s.town, s.refuses]));
    const here = new Set(towns.map((x) => x.id));
    for (const x of towns) {
      let b = tags.get(x.id);
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "r3-label";
        b.onclick = () => {
          const tw = all.get(x.id)!;
          fly = new THREE.Vector3(tw.x, SEA, tw.z);
        };
        labels.appendChild(b);
        tags.set(x.id, b);
      }
      b.textContent = `${x.name} · ${x.people}`;
      const refuses = shunned.get(x.id);
      b.title = `${x.people} people, ${x.houses} houses, ${x.tents} tents${refuses?.length ? `. Won't trade with ${refuses.map((r) => all.get(r)?.name ?? r).join(", ")}` : ""}`;
      if (refuses?.length) b.dataset.quarrel = "1";
      else delete b.dataset.quarrel;
    }
    for (const [id, b] of tags) b.hidden = !here.has(id);
  };

  const v = new THREE.Vector3();
  const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), big = new THREE.Vector3(1.6, 1.6, 1.6);
  let raf = 0, last = performance.now(), clock = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    const y = year();
    const byId = new Map(towns.map((x) => [x.id, x]));
    let n = 0;
    const put = (x: number, z: number, heading: number, s: THREE.Vector3) => {
      if (n >= 200) return;
      q.setFromAxisAngle(up, heading);
      boats.setMatrixAt(n++, mat.compose(v.set(x, SEA + Math.sin(now / 400 + x) * 0.1, z), q, s));
    };
    // Trade runs this year: up to three boats a route, back and forth.
    for (const r of t.routes) {
      const a = byId.get(r.from), b = byId.get(r.to);
      const runs = r.years[y] ?? 0;
      if (!a || !b || !runs) continue;
      for (let i = 0; i < Math.min(3, Math.ceil(runs / 3)); i++) {
        const ph = (clock / 14 + hash(strHash(a.id + b.id) + i) * 2) % 2;
        const u = ph < 1 ? ph : 2 - ph;
        const p = boatAt(a.quay, b.quay, u);
        put(p.x, p.z, p.heading + (ph >= 1 ? Math.PI : 0), one);
      }
    }
    // Founding boats: out from the old town's quay to the new town's shore, through the first part of the year.
    for (const tw of t.towns) {
      const f = tw.founded;
      if (!tw.from || yearF < f || yearF >= f + 0.6) continue;
      const a = all.get(tw.from), b = all.get(tw.id);
      if (!a || !b) continue;
      const p = boatAt(a.quay, { x: b.x, z: b.quay.z }, (yearF - f) / 0.6);
      put(p.x, p.z, p.heading, big);
    }
    boats.count = n;
    boats.instanceMatrix.needsUpdate = true;
    if (fly) {
      controls.target.lerp(fly, 1 - Math.pow(0.02, dt));
      camera.position.lerp(new THREE.Vector3(fly.x + 22, 40, fly.z + 46), 1 - Math.pow(0.05, dt));
      if (camera.position.distanceTo(new THREE.Vector3(fly.x + 22, 40, fly.z + 46)) < 2) fly = undefined;
    }
    for (const x of towns) {
      const b = tags.get(x.id);
      if (!b) continue;
      v.set(x.x, SEA + 9, x.z);
      v.project(camera);
      const show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      b.style.visibility = show ? "visible" : "hidden";
      if (show) b.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px) translate(-50%, -100%)`;
    }
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  rebuild();
  updateTags();
  raf = requestAnimationFrame(loop);
  // Stop dragging from also scrolling a phone page.
  renderer.domElement.style.touchAction = "none";

  return {
    setYear(yf: number) {
      yearF = yf;
      rebuild();
      updateTags();
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.remove();
    },
  };
}
