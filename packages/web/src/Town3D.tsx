// The town in 3D: the same blocky look as Founders, now with the whole village on it. The land is
// built here in the browser from the town's seed; every second the server says how far each house
// has got and where everyone is, and the figures walk there. Unplaced blocks of a house going up
// show as a faint ghost, so you can watch the design fill in.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { compile, fellingOrder, MATERIALS, terrainOf, TOWN, type Placement, type Scene3D, type TownTerrain, type Tree } from "@psyche/engine";
import { api } from "./api";
import { Coast3D } from "./Coast3D";
import { buildMesh, COLOR } from "./founders/Voxel";
import type { GridData } from "./founders/api";

type Person = Scene3D["people"][number];
const CANVAS = MATERIALS.indexOf("canvas");
const id = (m: string) => MATERIALS.indexOf(m as never);
const AIR = id("air"), LOG = id("log"), LEAVES = id("leaves"), GRASS = id("grass"), SNOW = id("snow"), BARLEY = id("barley"), SPROUT = id("sprout");
/** What someone carries home from each place. */
const LOAD: Record<string, string> = { woods: "#6b4a2e", quarry: "#8d8e88", reeds: "#9fbb5a", fields: "#d8b84a", sea: "#b8c4cc" };
const MAX_GHOST = 6000;

interface Figure {
  group: THREE.Group;
  body: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  boat: THREE.Mesh;
  load: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  p: Person;
  /** The place they last left, so they can be seen carrying something back. */
  from?: string;
}

/** The person's colour from the page's palette, normalised through a canvas so three.js can read it. */
const swatch = document.createElement("canvas").getContext("2d");
function personColor(id: string): string {
  const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--a-${id}`).trim() || `hsl(${hue}, 55%, 45%)`;
  if (!swatch) return "#888888";
  swatch.fillStyle = "#888888";
  swatch.fillStyle = v;
  return swatch.fillStyle;
}

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

/** Lay the season, the cut trees, the houses (as far as they have got) and the tents onto a copy of the land. */
function compose(land: TownTerrain, wood: Tree[], scene: Scene3D, plans: Map<string, Placement[]>): { grid: GridData; ghost: [number, number, number, number][]; chimneys: [number, number, number][] } {
  const { w, d, h } = TOWN;
  const ground = land.ground;
  const cells = land.grid.cells.slice();
  const at = (x: number, y: number, z: number) => x + z * w + y * w * d;
  // Cut pines leave a stump.
  for (const tr of wood.slice(0, scene.felled))
    for (let y = tr.y + 1; y <= tr.y + tr.height + 1 && y < h; y++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = tr.x + dx, z = tr.z + dz;
          if (x < 0 || z < 0 || x >= w || z >= d) continue;
          const c = cells[at(x, y, z)];
          if ((c === LOG && !dx && !dz) || (c === LEAVES && Math.abs(dx) + Math.abs(dz) <= 2.5)) cells[at(x, y, z)] = AIR;
        }
  // The season: snow in winter, barley that sprouts, ripens and is cut.
  const crop = scene.season === "autumn" ? (scene.blight ? SPROUT : BARLEY) : scene.season === "winter" ? AIR : SPROUT;
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const top = ground[x + z * w]!;
      if (scene.season === "winter" && cells[at(x, top, z)] === GRASS && Math.sin(x * 0.21) + Math.sin(z * 0.17 + 1) + Math.sin((x + z) * 0.07) > -0.9) cells[at(x, top, z)] = SNOW;
      if (top + 1 < h && cells[at(x, top + 1, z)] === BARLEY) cells[at(x, top + 1, z)] = crop;
    }
  const put = (x: number, y: number, z: number, b: number) => {
    if (x >= 0 && z >= 0 && y >= 0 && x < w && z < d && y < h) cells[x + z * w + y * w * d] = b;
  };
  const ghost: [number, number, number, number][] = [];
  const chimneys: [number, number, number][] = [];
  for (const s of scene.structures) {
    const key = `${s.id}:${s.plot.x0},${s.plot.z0},${s.plot.y}`;
    let plan = plans.get(key);
    if (!plan) plans.set(key, (plan = compile(s.blueprint, s.plot)));
    plan.forEach((pl, i) => {
      if (i < s.placed) put(pl.x, pl.y, pl.z, pl.b);
      else if (!s.done && ghost.length < MAX_GHOST) ghost.push([pl.x, pl.y, pl.z, pl.b]);
    });
    if (s.done) {
      const top = plan.filter((pl) => pl.part === "chimney").sort((a, b) => b.y - a.y)[0];
      if (top) chimneys.push([top.x + 0.5, top.y + 1, top.z + 0.5]);
    }
  }
  for (const t of scene.tents) {
    const x = Math.round(t.x), z = Math.round(t.z);
    const y = ground[x + z * w]! + 1;
    // A ridge tent, five blocks wide and four deep, open at the front.
    for (let dz = -2; dz <= 1; dz++) {
      put(x - 2, y, z + dz, CANVAS);
      put(x + 2, y, z + dz, CANVAS);
      put(x - 1, y + 1, z + dz, CANVAS);
      put(x + 1, y + 1, z + dz, CANVAS);
      put(x, y + 2, z + dz, CANVAS);
    }
    put(x - 1, y, z - 2, CANVAS);
    put(x + 1, y, z - 2, CANVAS);
    put(x, y + 1, z - 2, CANVAS);
  }
  return { grid: { version: 0, w, d, h, cells }, ghost, chimneys };
}

export function Town3D({ onOpen }: { onOpen: (id: string) => void }) {
  const [focus, setFocus] = useState<{ id: string; n: number }>();
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<Scene3D>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [follow, setFollow] = useState(false);
  const three = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    scene: THREE.Scene;
    land: THREE.Mesh;
    sea: THREE.Mesh;
    ghost: THREE.InstancedMesh;
    hearth: THREE.PointLight;
    sun: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
    marker: THREE.Mesh;
    smoke: THREE.Points;
    rain: THREE.Points;
    sources: [number, number, number][];
    bubbles: Map<string, HTMLSpanElement>;
    figures: Map<string, Figure>;
    ground: number[];
    places: { el: HTMLSpanElement; x: number; z: number; home: boolean }[];
    hover: HTMLSpanElement;
    hovered?: string;
    selected?: string;
    follow?: string;
  }>();
  const plans = useRef(new Map<string, Placement[]>());
  const seed = scene?.seed;
  const land = useMemo(() => (seed === undefined ? undefined : terrainOf(seed)), [seed]);
  const wood = useMemo(() => (land ? fellingOrder(land) : []), [land]);

  // Poll the scene once a second.
  useEffect(() => {
    let live = true;
    const get = () =>
      api
        .town3d()
        .then((s) => live && (setScene(s), setError(undefined)))
        .catch((e: Error) => live && setError(e.message));
    void get();
    const t = setInterval(get, 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  // The renderer, built once.
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.prepend(renderer.domElement);
    const sc = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
    camera.position.set(128, 58, 160);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(86, 6, 92);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 10;
    controls.maxDistance = 320;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 1.2);
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(-60, 120, 40);
    const hearth = new THREE.PointLight(0xff9a3c, 0, 40, 1.6);
    sc.add(hemi, sun, hearth);

    const landMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    const seaMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: COLOR.water }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(TOWN.w / 2, TOWN.sea - 0.2, TOWN.d / 2);
    sc.add(ocean, landMesh, seaMesh);

    const ghost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 0.96, 0.96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }), MAX_GHOST);
    ghost.count = 0;
    sc.add(ghost);

    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.6, 4), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
    marker.rotation.x = Math.PI;
    marker.visible = false;
    sc.add(marker);

    // Smoke from the fire circle and the chimneys: particles that rise, drift and fade round again.
    const PUFFS = 260;
    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3));
    const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ color: 0xcfcfcf, size: 1.1, transparent: true, opacity: 0.35, depthWrite: false }));
    const ages = Float32Array.from({ length: PUFFS }, () => Math.random() * 5);
    const from = new Uint16Array(PUFFS);
    sc.add(smoke);
    const DROPS = 4000;
    const rainGeo = new THREE.BufferGeometry();
    const rp = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) rp.set([Math.random() * 140 - 70, Math.random() * 50, Math.random() * 140 - 70], i * 3);
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xaac4dd, size: 0.18, transparent: true, opacity: 0.7 }));
    rain.visible = false;
    sc.add(rain);

    const hover = document.createElement("span");
    hover.className = "t3-label t3-person";
    hover.hidden = true;
    labels.current!.appendChild(hover);

    const state = { camera, controls, scene: sc, land: landMesh, sea: seaMesh, ghost, hearth, sun, hemi, marker, smoke, rain, sources: [] as [number, number, number][], bubbles: new Map<string, HTMLSpanElement>(), figures: new Map<string, Figure>(), ground: [] as number[], places: [] as { el: HTMLSpanElement; x: number; z: number; home: boolean }[], hover, hovered: undefined as string | undefined, selected: undefined as string | undefined, follow: undefined as string | undefined };
    three.current = state;
    // A handle for screenshots and debugging: lets a script point the camera.
    (window as unknown as { __town3d?: unknown }).__town3d = state;

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

    // Hover and click pick a person.
    const ray = new THREE.Raycaster();
    const pick = (ev: PointerEvent): string | undefined => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      const meshes = [...state.figures.values()].filter((f) => f.group.visible).flatMap((f) => f.group.children);
      const hit = ray.intersectObjects(meshes, false)[0];
      return hit?.object.userData.id as string | undefined;
    };
    let down = { x: 0, y: 0 };
    const onMove = (ev: PointerEvent) => {
      state.hovered = pick(ev);
      renderer.domElement.style.cursor = state.hovered ? "pointer" : "";
    };
    const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY });
    const onUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
      const id = pick(ev);
      state.selected = id;
      setSelected(id);
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const v = new THREE.Vector3();
    const project = (x: number, y: number, z: number, span: HTMLElement, maxDist: number) => {
      v.set(x, y, z);
      const dist = v.distanceTo(camera.position);
      v.project(camera);
      const show = v.z < 1 && dist < maxDist && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      span.hidden = !show;
      if (show) span.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px) translate(-50%, -100%)`;
    };
    const standY = (x: number, z: number) => {
      const xi = Math.max(0, Math.min(TOWN.w - 1, Math.round(x - 0.5))), zi = Math.max(0, Math.min(TOWN.d - 1, Math.round(z - 0.5)));
      return Math.max(TOWN.sea, (state.ground[xi + zi * TOWN.w] ?? TOWN.sea) + 1);
    };

    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      for (const f of state.figures.values()) {
        const dx = f.target.x - f.pos.x, dz = f.target.z - f.pos.z, dist = Math.hypot(dx, dz);
        const step = 9 * dt;
        if (dist > 120) f.pos.copy(f.target);
        else if (dist > step) {
          f.pos.x += (dx / dist) * step;
          f.pos.z += (dz / dist) * step;
          f.group.rotation.y = Math.atan2(dx, dz);
        } else f.pos.set(f.target.x, 0, f.target.z);
        const walking = dist > step;
        const y = standY(f.pos.x, f.pos.z);
        const afloat = (state.ground[Math.round(f.pos.x - 0.5) + Math.round(f.pos.z - 0.5) * TOWN.w] ?? TOWN.sea) < TOWN.sea;
        f.boat.visible = afloat;
        const carry = walking && !afloat && f.from !== undefined && LOAD[f.from] !== undefined && !(f.p.place in LOAD);
        f.load.visible = carry;
        if (carry) f.load.material.color.set(LOAD[f.from!]!);
        const bob = afloat ? Math.sin(t * 2 + f.pos.z) * 0.08 : walking ? Math.abs(Math.sin(t * 10 + f.pos.x)) * 0.12 : f.p.working ? Math.abs(Math.sin(t * 7 + f.pos.z)) * 0.18 : 0;
        f.group.position.set(f.pos.x, y + bob + (f.p.asleep && !walking ? 0.15 : 0), f.pos.z);
        f.group.rotation.z = f.p.asleep && !walking ? Math.PI / 2 : 0;
        f.group.visible = !(f.p.indoors && !walking);
      }
      // The follow-cam keeps its angle and distance and slides along with the person.
      const fol = state.follow ? state.figures.get(state.follow) : undefined;
      if (fol) {
        const want = new THREE.Vector3(fol.group.position.x, fol.group.position.y + 1, fol.group.position.z);
        const shift = want.sub(controls.target).multiplyScalar(1 - Math.pow(0.03, dt));
        controls.target.add(shift);
        camera.position.add(shift);
      }
      const sel = state.selected ? state.figures.get(state.selected) : undefined;
      state.marker.visible = !!sel?.group.visible;
      if (sel) {
        state.marker.position.set(sel.group.position.x, sel.group.position.y + (sel.p.child ? 2.4 : 3.1), sel.group.position.z);
        state.marker.rotation.y += dt * 2;
      }
      const hv = state.hovered ? state.figures.get(state.hovered) : sel;
      if (hv && hv.group.visible) {
        state.hover.textContent = hv.p.name;
        project(hv.group.position.x, hv.group.position.y + 2.9, hv.group.position.z, state.hover, 400);
      } else state.hover.hidden = true;
      // Speech bubbles over heads, nudged up where they would overlap one another.
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const shown: { el: HTMLSpanElement; x: number; y: number; w: number; h: number }[] = [];
      for (const [id, el] of state.bubbles) {
        const f = state.figures.get(id);
        if (!f || !f.group.visible) {
          el.hidden = true;
          continue;
        }
        v.set(f.group.position.x, f.group.position.y + (f.p.child ? 3 : 3.6), f.group.position.z);
        const dist = v.distanceTo(camera.position);
        v.project(camera);
        el.hidden = !(v.z < 1 && dist < 150 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05);
        if (!el.hidden) shown.push({ el, x: ((v.x + 1) / 2) * el.parentElement!.clientWidth, y: ((1 - v.y) / 2) * el.parentElement!.clientHeight, w: el.offsetWidth, h: el.offsetHeight });
      }
      shown.sort((a, b) => b.y - a.y);
      for (const b of shown) {
        let y = b.y;
        for (let moved = true, n = 0; moved && n < 12; n++) {
          moved = false;
          for (const o of placed)
            if (Math.abs(o.x - b.x) < (o.w + b.w) / 2 + 4 && y > o.y - o.h - 4 && y - b.h < o.y + 4) {
              y = o.y - o.h - 6;
              moved = true;
            }
        }
        placed.push({ x: b.x, y, w: b.w, h: b.h });
        b.el.style.transform = `translate(${b.x}px, ${y}px) translate(-50%, -100%)`;
      }
      // Smoke rises from whichever sources there are.
      const srcs = [...state.sources];
      const sp = smokeGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < PUFFS; i++) {
        ages[i]! += dt;
        if (ages[i]! > 5 || from[i]! >= srcs.length) {
          ages[i] = Math.random() * 0.5;
          from[i] = Math.floor(Math.random() * Math.max(1, srcs.length));
        }
        const s = srcs[from[i]!];
        if (!s) {
          sp.setXYZ(i, 0, -50, 0);
          continue;
        }
        const a = ages[i]!;
        sp.setXYZ(i, s[0] + a * 0.5 + Math.sin(a * 2 + i) * 0.3, s[1] + a * 1.3, s[2] + Math.cos(a + i) * 0.3);
      }
      sp.needsUpdate = true;
      if (rain.visible) {
        const ra = rainGeo.attributes.position as THREE.BufferAttribute;
        const cx = controls.target.x, cz = controls.target.z;
        for (let i = 0; i < DROPS; i++) {
          let y = ra.getY(i) - dt * 26;
          if (y < 0) y = 50;
          ra.setY(i, y);
        }
        rain.position.set(cx, 0, cz);
        ra.needsUpdate = true;
      }
      for (const pl of state.places) project(pl.x, standY(pl.x, pl.z) + 3, pl.z, pl.el, pl.home ? 85 : 220);
      controls.update();
      renderer.render(sc, camera);
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

  useEffect(() => {
    if (three.current) {
      three.current.selected = selected;
      three.current.follow = follow ? selected : undefined;
    }
  }, [selected, follow]);

  // A moment picked from the list: select that person and follow them there.
  useEffect(() => {
    if (!focus) return;
    setSelected(focus.id);
    setFollow(true);
    const t = three.current;
    const f = t?.figures.get(focus.id);
    if (t && f) {
      // Drop in close, from the side the camera is already on.
      const dir = t.camera.position.clone().sub(t.controls.target).normalize().multiplyScalar(34);
      t.controls.target.set(f.group.position.x, f.group.position.y + 1, f.group.position.z);
      t.camera.position.copy(t.controls.target).add(dir);
    }
  }, [focus]);

  useEffect(() => {
  }, [selected]);

  // New land when the town changes.
  useEffect(() => {
    const t = three.current;
    if (!t || !land) return;
    t.ground = land.ground;
    t.sea.geometry.dispose();
    t.sea.geometry = buildMesh({ version: 0, w: TOWN.w, d: TOWN.d, h: TOWN.h, cells: land.grid.cells }, true);
    plans.current.clear();
  }, [land]);

  // Houses and tents: rebuild the mesh only when a block or a tent changed.
  const buildKey = scene ? `${scene.season}:${scene.blight}:${scene.felled}|` + scene.structures.map((s) => `${s.id}:${s.placed}`).join(",") + "|" + scene.tents.map((x) => x.household).join(",") : "";
  useEffect(() => {
    const t = three.current;
    if (!t || !land || !scene) return;
    const { grid, ghost, chimneys } = compose(land, wood, scene, plans.current);
    const tav = scene.places.find((p) => p.id === "tavern");
    t.sources = [...(tav ? [[tav.x + 0.5, (land.ground[Math.round(tav.x) + Math.round(tav.z) * TOWN.w] ?? 6) + 2, tav.z + 0.5] as [number, number, number]] : []), ...chimneys];
    t.land.geometry.dispose();
    t.land.geometry = buildMesh(grid, false);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    t.ghost.count = ghost.length;
    ghost.forEach(([x, y, z, b], i) => {
      t.ghost.setMatrixAt(i, m.makeTranslation(x + 0.5, y + 0.5, z + 0.5));
      t.ghost.setColorAt(i, c.set(COLOR[MATERIALS[b]!] ?? "#ffffff"));
    });
    t.ghost.instanceMatrix.needsUpdate = true;
    if (t.ghost.instanceColor) t.ghost.instanceColor.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [land, buildKey]);

  // People, place names, light.
  useEffect(() => {
    const t = three.current;
    if (!t || !scene) return;
    const seen = new Set<string>();
    for (const p of scene.people) {
      seen.add(p.id);
      let f = t.figures.get(p.id);
      if (!f) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.42), new THREE.MeshLambertMaterial({ color: personColor(p.id) }));
        body.position.y = 0.55;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), new THREE.MeshLambertMaterial({ color: 0xe8c39e }));
        head.position.y = 1.36;
        body.userData.id = head.userData.id = p.id;
        // A rowing boat: a floor, two sides and the ends, all one mesh.
        const hull = new THREE.MeshLambertMaterial({ color: 0x7a5232 });
        const boat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 2.6), hull);
        for (const [w, h, d, x, y, z] of [[0.14, 0.5, 2.6, 0.7, 0.2, 0], [0.14, 0.5, 2.6, -0.7, 0.2, 0], [1.4, 0.5, 0.14, 0, 0.2, 1.3], [1.0, 0.5, 0.14, 0, 0.2, -1.3]] as const) {
          const side = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hull);
          side.position.set(x, y, z);
          side.userData.id = p.id;
          boat.add(side);
        }
        boat.position.y = -0.05;
        boat.visible = false;
        const load = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 1), new THREE.MeshLambertMaterial({ color: 0x6b4a2e }));
        load.position.set(0.42, 1.25, 0);
        load.visible = false;
        group.add(body, head, boat, load);
        t.scene.add(group);
        f = { group, body, boat, load, pos: new THREE.Vector3(p.x, 0, p.z), target: new THREE.Vector3(p.x, 0, p.z), p };
        t.figures.set(p.id, f);
      }
      if (f.p.place !== p.place) f.from = f.p.place;
      f.p = p;
      f.target.set(p.x, 0, p.z);
      f.group.scale.setScalar(p.child ? 0.85 : 1.25);
    }
    for (const [id, f] of t.figures)
      if (!seen.has(id)) {
        t.scene.remove(f.group);
        t.figures.delete(id);
      }

    if (t.places.length !== scene.places.length) {
      for (const pl of t.places) pl.el.remove();
      t.places = scene.places.map((pl) => {
        const el = document.createElement("span");
        el.className = `t3-label${pl.id.startsWith("home_") ? " t3-home" : ""}`;
        el.textContent = pl.name;
        labels.current!.appendChild(el);
        return { el, x: pl.x, z: pl.z, home: pl.id.startsWith("home_") };
      });
    } else scene.places.forEach((pl, i) => (t.places[i]!.el.textContent = pl.name));

    const active = new Set<string>();
    for (const b of scene.bubbles) {
      active.add(b.id);
      let el = t.bubbles.get(b.id);
      if (!el) {
        el = document.createElement("span");
        labels.current!.appendChild(el);
        t.bubbles.set(b.id, el);
      }
      el.className = `t3-bubble t3-${b.kind}`;
      el.textContent = b.text;
    }
    for (const [id, el] of t.bubbles)
      if (!active.has(id)) {
        el.remove();
        t.bubbles.delete(id);
      }
    t.rain.visible = scene.weather !== "fair" && scene.season !== "winter";
    (t.rain.material as THREE.PointsMaterial).color.set(scene.season === "winter" ? 0xffffff : 0xaac4dd);
    if (scene.weather !== "fair" && scene.season === "winter") t.rain.visible = true;

    const hour = scene.hour;
    const day = Math.max(0, Math.min(1, Math.sin(((hour - 6) / 14) * Math.PI) * 1.4));
    const wet = scene.weather !== "fair";
    const sky = new THREE.Color(wet ? "#4b5560" : "#0d1b2e").lerp(new THREE.Color(wet ? "#8d99a3" : "#a9d3e6"), day);
    t.scene.background = sky;
    t.scene.fog = new THREE.Fog(sky, 180, 480);
    t.hemi.intensity = 0.3 + day * (wet ? 0.7 : 1.0);
    t.sun.intensity = wet ? 0.12 : day * 0.7;
    const tav = scene.places.find((p) => p.id === "tavern");
    if (tav && t.ground.length) t.hearth.position.set(tav.x + 0.5, (t.ground[Math.round(tav.x) + Math.round(tav.z) * TOWN.w] ?? 6) + 2.5, tav.z + 0.5);
    t.hearth.intensity = (1 - day) * 60;
  }, [scene]);

  const person = scene?.people.find((p) => p.id === selected);
  const building = scene?.structures.filter((s) => !s.done) ?? [];
  const built = scene?.structures.filter((s) => s.done).length ?? 0;
  return (
    <div className="town3d">
      <div ref={host} className="t3-stage" role="img" aria-label="The town in 3D. Drag to turn, scroll to zoom, click a person.">
        <div ref={labels} className="t3-labels" aria-hidden="true" />
        {scene && (
          <div className="t3-hud">
            <b>{hhmm(scene.hour)}</b> · day {scene.day + 1} · {scene.season}
            {scene.weather !== "fair" ? ` · ${scene.weather}` : ""}
            <span>
              {built} {built === 1 ? "house" : "houses"} built · {scene.felled} {scene.felled === 1 ? "pine" : "pines"} cut · {scene.tents.length} {scene.tents.length === 1 ? "household" : "households"} in tents
              {building.map((s) => ` · ${s.name} ${Math.round((s.placed / Math.max(1, s.total)) * 100)}%`).join("")}
            </span>
          </div>
        )}
        {person && (
          <div className="t3-card">
            <b>{person.name}</b>
            <span>{person.asleep ? "asleep" : person.activity}</span>
            <div>
              <button onClick={() => onOpen(person.id)}>Open their mind</button>
              <button className={follow ? "on" : "ghost"} aria-pressed={follow} onClick={() => setFollow(!follow)}>
                {follow ? "Following" : "Follow"}
              </button>
              <button className="ghost" onClick={() => (setSelected(undefined), setFollow(false))} aria-label="Close">
                ×
              </button>
            </div>
          </div>
        )}
        {error && <div className="t3-hud t3-error">{error}</div>}
      </div>
      {!!scene?.moments.length && (
        <div className="t3-moments">
          <span>Jump to</span>
          {scene.moments.map((m) => (
            <button key={m.id} onClick={() => setFocus({ id: m.agent, n: Date.now() })} title={m.text ?? m.title}>
              {m.title}
            </button>
          ))}
        </div>
      )}
      <p className="t3-help">Drag to turn, right-drag to pan, scroll to zoom. Click anyone to see who they are. Faint blocks are the parts of a house still to be built.</p>
    </div>
  );
}

/** The 3D tab: the town you are watching, or (in a region) the whole coast, with a switch between them. */
const SPEEDS = [
  { label: "Slow", value: 5 },
  { label: "Normal", value: 10 },
  { label: "Fast", value: 30 },
  { label: "Very fast", value: 60 },
];

export function World3D(props: {
  town?: string;
  townName: string;
  seed: number;
  region: boolean;
  running: boolean;
  speed: number;
  onControl: (c: { running?: boolean; speed?: number }) => void;
  onOpen: (id: string) => void;
  onVisit: (town: string) => void;
}) {
  const { town, townName, seed, region, running, speed, onControl, onOpen, onVisit } = props;
  const [mode, setMode] = useState<"town" | "coast">("town");
  return (
    <div className="world3d">
      <div className="t3-modes">
        {region && (
          <div role="tablist" aria-label="View">
            <button role="tab" aria-selected={mode === "town"} className={mode === "town" ? "on" : ""} onClick={() => setMode("town")}>
              {townName}
            </button>
            <button role="tab" aria-selected={mode === "coast"} className={mode === "coast" ? "on" : ""} onClick={() => setMode("coast")}>
              The whole coast
            </button>
          </div>
        )}
        <div className="t3-speed" aria-label="Time">
          <button className={running ? "" : "on"} onClick={() => onControl({ running: !running })}>
            {running ? "Pause" : "Play"}
          </button>
          {SPEEDS.map((s) => (
            <button key={s.value} className={speed === s.value ? "on" : ""} aria-pressed={speed === s.value} title={`${s.value} town minutes a second`} onClick={() => onControl({ speed: s.value, running: true })}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {mode === "coast" && region ? (
        <Coast3D
          seed={seed}
          current={town}
          onVisit={(t) => {
            onVisit(t);
            setMode("town");
          }}
        />
      ) : (
        <Town3D key={town ?? "town"} onOpen={onOpen} />
      )}

    </div>
  );
}
