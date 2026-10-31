// The whole coast in 3D. Every town sits where the coastline map puts it, drawn small: its houses and
// tents as little blocks that fill in as it grows, trade boats running between towns that still
// trade, and a boat crossing to each new town as it is founded. Click a town to go there: it comes
// to life in full, and the town you left carries on by rules.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MATERIALS, type Timeline } from "@psyche/engine";
import { api } from "./api";
import { shore, sitePoint } from "./coastMap";
import { buildMesh, COLOR } from "./founders/Voxel";

const W = 360, D = 190, H = 20, SEA = 4;
const m = (name: string) => MATERIALS.indexOf(name as never);
const [GRASS, DIRT, STONE, SAND, WATER, LOG, LEAVES, PLANK, THATCH, CANVAS, COBBLE] = ["grass", "dirt", "stone", "sand", "water", "log", "leaves", "plank", "thatch", "canvas", "cobble"].map(m) as [number, number, number, number, number, number, number, number, number, number, number];

const hash = (n: number) => {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};
const strHash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

interface TownNow {
  id: string;
  name: string;
  from?: string;
  people: number;
  houses: number;
  tents: number;
  x: number;
  z: number;
  /** The water's edge below the town, where its boats put in. */
  quay: { x: number; z: number };
}

function townsAt(t: Timeline, seed: number): TownNow[] {
  const i = t.years.length - 1;
  return t.towns
    .filter((x) => x.people[i] !== null && x.people[i] !== undefined)
    .map((x) => {
      const p = sitePoint(x.site, seed);
      const tx = p.x * W, tz = p.y * D;
      return { id: x.id, name: x.name, from: x.from, people: x.people[i] ?? 0, houses: x.houses[i] ?? 0, tents: x.tents[i] ?? 0, x: tx, z: tz, quay: { x: tx, z: shore(p.x, seed) * D + 3 } };
    });
}

/** Spiral slots round a town's centre, so a town grows outward and old houses never move. */
function slot(k: number, salt: number): { dx: number; dz: number } {
  const a = k * 2.399963 + hash(salt) * 6.28;
  const r = 2.4 * Math.sqrt(k + 1.2);
  return { dx: Math.cos(a) * r * 1.2, dz: Math.sin(a) * r * 0.85 };
}

/** The coast as blocks: land rising from the shore, woods, and every town's houses and tents. */
function buildCoast(towns: TownNow[], seed: number): Uint8Array {
  const cells = new Uint8Array(W * D * H);
  const at = (x: number, y: number, z: number) => x + z * W + y * W * D;
  const put = (x: number, y: number, z: number, b: number) => {
    if (x >= 0 && z >= 0 && y >= 0 && x < W && z < D && y < H) cells[at(x, y, z)] = b;
  };
  const ground = new Int16Array(W * D);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const edge = shore(x / W, seed) * D;
      let top: number;
      if (z > edge) top = SEA - 1 - Math.min(3, Math.floor((z - edge) / 4));
      else {
        const roll = Math.sin(x * 0.05 + seed) * 1.2 + Math.sin(z * 0.08 + x * 0.02) * 1.1 + Math.sin((x - z) * 0.03) * 1.5;
        top = Math.min(H - 6, Math.floor(SEA + 1 + (edge - z) / 16 + roll));
        top = Math.max(SEA, top);
      }
      // Flat ground for each town.
      for (const t of towns) {
        const r = 7 + Math.sqrt(t.houses + t.tents) * 3;
        if (Math.hypot((x - t.x) / 1.2, (z - t.z) / 0.85) < r) top = Math.max(SEA + 1, Math.min(top, Math.floor(SEA + 1 + (shore(t.x / W, seed) * D - t.z) / 16)));
      }
      ground[x + z * W] = top;
      for (let y = 0; y <= top; y++) cells[at(x, y, z)] = y === top ? (top <= SEA ? SAND : GRASS) : y >= top - 2 ? (top <= SEA ? SAND : DIRT) : STONE;
      for (let y = top + 1; y < SEA; y++) cells[at(x, y, z)] = WATER;
    }
  // Woods inland, kept off the towns.
  for (let k = 0; k < 900; k++) {
    const x = Math.floor(hash(seed * 1000 + k) * W), z = Math.floor(hash(seed * 1000 + k + 77777) * D);
    const top = ground[x + z * W]!;
    if (top <= SEA || Math.sin(x * 0.04 + 2) + Math.cos(z * 0.06) < 0.3) continue;
    if (towns.some((t) => Math.hypot(x - t.x, z - t.z) < 10 + Math.sqrt(t.houses + t.tents) * 3.4)) continue;
    const h = 2 + (k % 2);
    for (let y = top + 1; y <= top + h; y++) put(x, y, z, LOG);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(x + dx, top + h + 1, z + dz, LEAVES);
    put(x, top + h + 2, z, LEAVES);
  }
  // Each town: a fire circle, then houses and tents in spiral slots.
  for (const t of towns) {
    const salt = strHash(t.id);
    const cx = Math.round(t.x), cz = Math.round(t.z);
    const g = ground[cx + cz * W]!;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(cx + dx, g, cz + dz, COBBLE);
    let k = 0;
    for (let n = 0; n < t.houses + t.tents; n++, k++) {
      const s = slot(k, salt);
      const x = Math.round(t.x + s.dx), z = Math.round(t.z + s.dz);
      const y = ground[x + z * W]! + 1;
      if (n < t.houses) {
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) put(x + dx, y, z + dz, PLANK);
        for (let dz = -0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) put(x + dx, y + 1, z + dz, THATCH);
      } else put(x, y, z, CANVAS);
    }
    // A jetty out from the quay.
    for (let z = Math.round(t.quay.z) - 3; z < Math.round(t.quay.z) + 4; z++) if (ground[cx + z * W]! < SEA) put(cx, SEA, z, PLANK);
  }
  return cells;
}

export function Coast3D({ seed, current, onVisit }: { seed: number; current?: string; onVisit: (town: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [tl, setTl] = useState<Timeline>();
  const [error, setError] = useState<string>();
  const three = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    land: THREE.Mesh;
    sea: THREE.Mesh;
    boats: THREE.InstancedMesh;
    towns: TownNow[];
    trips: { a: TownNow; b: TownNow; phase: number; once?: number }[];
    labels: Map<string, HTMLButtonElement>;
    fly?: { to: THREE.Vector3; t: number; town: string };
  }>();
  const onVisitRef = useRef(onVisit);
  onVisitRef.current = onVisit;

  useEffect(() => {
    let live = true;
    const get = () =>
      api
        .timeline()
        .then((t) => live && (setTl(t), setError(undefined)))
        .catch((e: Error) => live && setError(e.message));
    void get();
    const t = setInterval(get, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#a9d3e6");
    scene.fog = new THREE.Fog("#a9d3e6", 260, 620);
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 1500);
    camera.position.set(W / 2, 170, D * 1.45);
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
    const state = { scene, camera, controls, land, sea, boats, towns: [] as TownNow[], trips: [] as { a: TownNow; b: TownNow; phase: number; once?: number }[], labels: new Map<string, HTMLButtonElement>(), fly: undefined as { to: THREE.Vector3; t: number; town: string } | undefined };
    three.current = state;
    (window as unknown as { __coast3d?: unknown }).__coast3d = state;

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

    const v = new THREE.Vector3();
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Boats: out from one quay, round through open water, in to the other, and back.
      let n = 0;
      state.trips = state.trips.filter((tr) => tr.once === undefined || tr.once < 1);
      for (const tr of state.trips) {
        let u: number;
        if (tr.once !== undefined) {
          tr.once += dt / 6;
          u = Math.min(1, tr.once);
        } else {
          tr.phase = (tr.phase + dt / 14) % 2;
          u = tr.phase < 1 ? tr.phase : 2 - tr.phase;
        }
        const a = tr.a.quay, b = tr.once !== undefined ? { x: tr.b.x, z: tr.b.quay.z } : tr.b.quay;
        const out = Math.max(a.z, b.z) + 10 + Math.abs(a.x - b.x) * 0.08;
        const x = (1 - u) ** 2 * a.x + 2 * u * (1 - u) * ((a.x + b.x) / 2) + u * u * b.x;
        const z = (1 - u) ** 2 * a.z + 2 * u * (1 - u) * out + u * u * b.z;
        const dx = 2 * (1 - u) * ((a.x + b.x) / 2 - a.x) + 2 * u * (b.x - (a.x + b.x) / 2);
        const dz = 2 * (1 - u) * (out - a.z) + 2 * u * (b.z - out);
        const dir = tr.once === undefined && tr.phase >= 1 ? -1 : 1;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx * dir, dz * dir));
        mat.compose(v.set(x, SEA + Math.sin(now / 400 + x) * 0.1, z), q, tr.once !== undefined ? one.clone().multiplyScalar(1.6) : one);
        if (n < 200) state.boats.setMatrixAt(n++, mat);
      }
      state.boats.count = n;
      state.boats.instanceMatrix.needsUpdate = true;
      // Flying down to a town before going there.
      if (state.fly) {
        state.fly.t += dt;
        controls.target.lerp(state.fly.to, 1 - Math.pow(0.02, dt));
        camera.position.lerp(new THREE.Vector3(state.fly.to.x + 18, 30, state.fly.to.z + 34), 1 - Math.pow(0.05, dt));
        if (state.fly.t > 1.3) {
          const town = state.fly.town;
          state.fly = undefined;
          onVisitRef.current(town);
        }
      }
      for (const t of state.towns) {
        const lab = state.labels.get(t.id);
        if (!lab) continue;
        v.set(t.x, SEA + 9, t.z);
        const dist = v.distanceTo(camera.position);
        v.project(camera);
        const show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && dist < 700;
        lab.hidden = !show;
        if (show) lab.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px) translate(-50%, -100%)`;
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // The towns as they are now; rebuild the land only when a town grows or a new one appears.
  const towns = tl ? townsAt(tl, seed) : [];
  const key = towns.map((t) => `${t.id}:${t.houses}:${t.tents}`).join(",");
  useEffect(() => {
    const t = three.current;
    if (!t || !tl) return;
    const before = new Set(t.towns.map((x) => x.id));
    const cells = buildCoast(towns, seed);
    t.land.geometry.dispose();
    t.land.geometry = buildMesh({ version: 0, w: W, d: D, h: H, cells }, false);
    t.sea.geometry.dispose();
    t.sea.geometry = buildMesh({ version: 0, w: W, d: D, h: H, cells }, true);
    // A boat crosses to each town founded while you watch.
    if (t.towns.length)
      for (const x of towns)
        if (!before.has(x.id)) {
          const from = towns.find((y) => y.id === x.from);
          if (from) t.trips.push({ a: from, b: x, phase: 0, once: 0 });
        }
    t.towns = towns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seed]);

  // Trade boats for this year's runs, and the labels.
  useEffect(() => {
    const t = three.current;
    if (!t || !tl) return;
    const year = tl.years.at(-1) ?? 1;
    const byId = new Map(towns.map((x) => [x.id, x]));
    const kept = t.trips.filter((x) => x.once !== undefined);
    const trade = tl.routes.flatMap((r) => {
      const a = byId.get(r.from), b = byId.get(r.to);
      const runs = r.years[year] ?? r.years[year - 1] ?? 0;
      if (!a || !b || !runs) return [];
      return Array.from({ length: Math.min(3, Math.ceil(runs / 3)) }, (_, i) => {
        const old = t.trips.find((x) => x.once === undefined && x.a.id === a.id && x.b.id === b.id);
        return { a, b, phase: old ? (old.phase + i * 0.66) % 2 : hash(strHash(a.id + b.id) + i) * 2 };
      });
    });
    t.trips = [...kept, ...trade];
    const shunned = new Map<string, string[]>();
    for (const s of tl.shunned.filter((x) => x.year === year)) shunned.set(s.town, s.refuses);
    const name = (id: string) => byId.get(id)?.name ?? id;
    for (const x of towns) {
      let b = t.labels.get(x.id);
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.onclick = () => {
          const tt = three.current!;
          const town = tt.towns.find((y) => y.id === x.id)!;
          tt.fly = { to: new THREE.Vector3(town.x, SEA, town.z), t: 0, town: x.id };
        };
        labels.current!.appendChild(b);
        t.labels.set(x.id, b);
      }
      b.className = `c3-label${x.id === current ? " c3-here" : ""}`;
      const refuses = shunned.get(x.id);
      b.textContent = `${x.name} · ${x.people}`;
      b.title = `${x.people} people, ${x.houses} houses, ${x.tents} tents${refuses?.length ? `. Won't trade with ${refuses.map(name).join(", ")}` : ""}. Click to go there.`;
      if (refuses?.length) b.dataset.quarrel = "1";
      else delete b.dataset.quarrel;
    }
    for (const [id, b] of t.labels)
      if (!byId.has(id)) {
        b.remove();
        t.labels.delete(id);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl, current, key]);

  const year = tl?.years.at(-1);
  const people = towns.reduce((s, t) => s + t.people, 0);
  return (
    <div className="town3d">
      <div ref={host} className="t3-stage" role="img" aria-label="The whole coast in 3D. Drag to turn, scroll to zoom, click a town's name to go there.">
        <div ref={labels} className="t3-labels c3-labels" />
        {tl && (
          <div className="t3-hud">
            <b>Year {year}</b>
            <span>
              {people.toLocaleString()} people in {towns.length} {towns.length === 1 ? "town" : "towns"} · {three.current?.trips.filter((x) => x.once === undefined).length ?? 0} trade boats out
            </span>
          </div>
        )}
        {error && <div className="t3-hud t3-error">{error}</div>}
      </div>
      <p className="t3-help">Each little block house is a house in that town. Boats run between towns that trade; towns that have fallen out send none (their names are outlined in red). Click a town's name to fly down to it: it comes to life, and the town you left carries on by rules.</p>
    </div>
  );
}
