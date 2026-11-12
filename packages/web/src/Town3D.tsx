// The town in 3D: the same blocky look as Founders, now with the whole village on it. The land is
// built here in the browser from the town's seed; every second the server says how far each house
// has got and where everyone is, and the figures walk there. Unplaced blocks of a house going up
// show as a faint ghost, so you can watch the design fill in.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { compile, fellingOrder, MATERIALS, skyAt, terrainOf, TOWN, type Beat, type Placement, type Scene3D, type SkyState, type TownTerrain, type Tree } from "@psyche/engine";
import { api } from "./api";
import { Coast3D } from "./Coast3D";
import { blockMaterial, buildMesh, COLOR, WIND, type GridData } from "./voxelMesh";
import { Ambience } from "./world3d/ambience";
import { Atmosphere } from "./world3d/atmosphere";
import { Gulls, Life, Precipitation, Windows, windowsOf } from "./world3d/effects";
import { FarLand } from "./world3d/farLand";
import { disposeFigure, isWater, makeFigure, stepFigure, type Figure } from "./world3d/figures";
import { Sea } from "./world3d/water";
import { makeRenderer, NO_3D } from "./world3d/gl";

const CANVAS = MATERIALS.indexOf("canvas");
const id = (m: string) => MATERIALS.indexOf(m as never);
const AIR = id("air"), LOG = id("log"), LEAVES = id("leaves"), GRASS = id("grass"), SNOW = id("snow"), BARLEY = id("barley"), SPROUT = id("sprout");
const MAX_GHOST = 6000;

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
function compose(land: TownTerrain, wood: Tree[], scene: Scene3D, plans: Map<string, Placement[]>, before: Map<string, number>): { grid: GridData; ghost: [number, number, number, number][]; chimneys: [number, number, number][]; windows: [number, number, number][]; fresh: Placement[] } {
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
  const windows: [number, number, number][] = [];
  const fresh: Placement[] = [];
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
      if (s.placed >= s.total && s.work?.status !== "ruin") windows.push(...windowsOf(plan, s.plot.y));
    }
    // Blocks set since the last look, for a puff of dust where each went in.
    const was = before.get(key);
    if (was !== undefined && s.placed > was && s.placed - was < 60) fresh.push(...plan.slice(was, s.placed));
    before.set(key, s.placed);
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
  return { grid: { version: 0, w, d, h, cells }, ghost, chimneys, windows, fresh };
}

/**
 * The stage, for anything that wants to draw into the town from outside this file (a character you
 * walk around as, say): the camera and its controls, the scene, everyone's figure, the height of
 * the ground, and `layers`, a set of callbacks run every frame before the picture is drawn.
 */
export interface Stage {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  scene: THREE.Scene;
  figures: Map<string, Figure>;
  /** Top solid block per column of the town grid (index x + z * TOWN.w). */
  ground: () => number[];
  layers: Set<(dt: number, now: number) => void>;
}

/** What the director is showing, for the caption under it. */
export interface Shot {
  kind: "close" | "wide" | "idle";
  title: string;
  text?: string;
  agent?: string;
  name?: string;
}

/** How long a shot holds before the director looks for the next one, in real milliseconds. */
const HOLD = { close: 9000, wide: 7000, idle: 12000 };
/** After you touch the camera, the director waits this long before taking it back. */
const HANDS_OFF = 20000;

export function Town3D(props: {
  onOpen: (id: string) => void;
  /** The scene pushed by the game's stream; without it, the view polls for its own. */
  scene?: Scene3D;
  pushed?: boolean;
  /** Full-screen game mode: no HUD, moments row or help line of its own. */
  game?: boolean;
  director?: boolean;
  beats?: Beat[];
  onShot?: (s: Shot | undefined) => void;
  /** Fly to someone (a notice or a feed line was clicked). */
  focusReq?: { id: string; n: number };
  onSelect?: (id: string | undefined) => void;
  /** Called once the view is up, with the stage (and with undefined when it is taken down). */
  onStage?: (stage: Stage | undefined) => void;
  /** Show the town at another hour or in other weather, on this screen only (for taking pictures). The world itself is untouched. */
  look?: { hour?: number; weather?: string };
  /** Play the town's sounds (wind, sea, rain, the fire, birds). Off unless asked for. */
  sound?: boolean;
}) {
  const { onOpen, game } = props;
  const [focus, setFocus] = useState<{ id: string; n: number }>();
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [polled, setScene] = useState<Scene3D>();
  const scene = props.pushed ? props.scene : polled;
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [follow, setFollow] = useState(false);
  const three = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    scene: THREE.Scene;
    land: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
    ghost: THREE.InstancedMesh;
    hearth: THREE.PointLight;
    marker: THREE.Mesh;
    atmosphere: Atmosphere;
    sea: Sea;
    far?: FarLand;
    life: Life;
    windows: Windows;
    audio: Ambience;
    /** The sky as last drawn. */
    sky?: SkyState;
    /** What the simulation last said about time and weather, and how fast its clock is running (sim minutes a real second). */
    sim?: { seed: number; season: string; weather: string; tick: number; at: number; rate: number };
    sources: [number, number, number][];
    bubbles: Map<string, HTMLSpanElement>;
    figures: Map<string, Figure>;
    ground: number[];
    places: { el: HTMLSpanElement; x: number; z: number; home: boolean }[];
    hover: HTMLSpanElement;
    fire?: { x: number; z: number };
    look?: { hour?: number; weather?: string };
    hovered?: string;
    selected?: string;
    follow?: string;
    /** A camera move in progress: from where, to where, how far along (0 to 1). */
    fly?: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; t: number; dur: number };
    /** When someone last moved the camera by hand. */
    touched: number;
    flyTo: (target: THREE.Vector3, dist: number, opts?: { azimuth?: number; elevation?: number; dur?: number }) => void;
  }>();
  const plans = useRef(new Map<string, Placement[]>());
  const placedBefore = useRef(new Map<string, number>());
  const seed = scene?.seed;
  const land = useMemo(() => (seed === undefined ? undefined : terrainOf(seed)), [seed]);
  const wood = useMemo(() => (land ? fellingOrder(land) : []), [land]);

  // Poll the scene once a second, unless the game's stream is pushing it.
  useEffect(() => {
    if (props.pushed) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pushed]);

  // The renderer, built once.
  useEffect(() => {
    const el = host.current!;
    const renderer = makeRenderer({ antialias: true, preserveDrawingBuffer: true });
    if (!renderer) {
      setError(NO_3D);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.prepend(renderer.domElement);
    const sc = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1700);
    camera.position.set(128, 58, 160);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(86, 6, 92);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 10;
    controls.maxDistance = 320;

    const atmosphere = new Atmosphere(sc, renderer);
    const hearth = new THREE.PointLight(0xff9a3c, 0, 46, 1.5);
    sc.add(hearth);

    const landMesh = new THREE.Mesh(new THREE.BufferGeometry(), blockMaterial());
    landMesh.castShadow = landMesh.receiveShadow = true;
    sc.add(landMesh);
    const sea = new Sea(sc);

    const ghost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 0.96, 0.96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false }), MAX_GHOST);
    ghost.count = 0;
    sc.add(ghost);

    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.6, 4), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
    marker.rotation.x = Math.PI;
    marker.visible = false;
    sc.add(marker);

    const life = new Life(sc, hearth);
    const precipitation = new Precipitation(sc);
    const windows = new Windows(sc);
    const gulls = new Gulls(sc);
    const audio = new Ambience();
    life.onThunder = (far) => audio.thunder(far);

    const hover = document.createElement("span");
    hover.className = "t3-label t3-person";
    hover.hidden = true;
    labels.current!.appendChild(hover);

    const state = {
      camera, controls, scene: sc, land: landMesh, ghost, hearth, marker, atmosphere, sea, far: undefined as FarLand | undefined, life, windows, audio,
      sky: undefined as SkyState | undefined, sim: undefined as { seed: number; season: string; weather: string; tick: number; at: number; rate: number } | undefined,
      sources: [] as [number, number, number][], bubbles: new Map<string, HTMLSpanElement>(), figures: new Map<string, Figure>(), ground: [] as number[],
      places: [] as { el: HTMLSpanElement; x: number; z: number; home: boolean }[], hover, fire: undefined as { x: number; z: number } | undefined, look: undefined as { hour?: number; weather?: string } | undefined, hovered: undefined as string | undefined,
      selected: undefined as string | undefined, follow: undefined as string | undefined,
      fly: undefined as { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; t: number; dur: number } | undefined,
      touched: -1e9,
      /** Glide the camera to look at `target` from `dist` away, keeping the current bearing unless told otherwise. */
      flyTo: (target: THREE.Vector3, dist: number, opts: { azimuth?: number; elevation?: number; dur?: number } = {}) => {
        const cur = camera.position.clone().sub(controls.target);
        const az = opts.azimuth ?? Math.atan2(cur.x, cur.z);
        const el = opts.elevation ?? Math.max(0.35, Math.min(1.1, Math.asin(cur.y / Math.max(1e-6, cur.length()))));
        const toPos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(target);
        const far = camera.position.distanceTo(toPos);
        state.fly = { fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos, toTarget: target.clone(), t: 0, dur: opts.dur ?? Math.min(2.6, Math.max(0.9, far / 90)) };
      },
    };
    three.current = state;
    const layers = new Set<(dt: number, now: number) => void>();
    props.onStage?.({ camera, controls, scene: sc, figures: state.figures, ground: () => state.ground, layers });
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
      const groups = [...state.figures.values()].filter((f) => f.group.visible).map((f) => f.group);
      const hit = ray.intersectObjects(groups, true).find((h) => h.object.userData.id !== undefined);
      return hit?.object.userData.id as string | undefined;
    };
    let down = { x: 0, y: 0 };
    const onMove = (ev: PointerEvent) => {
      state.hovered = pick(ev);
      renderer.domElement.style.cursor = state.hovered ? "pointer" : "";
    };
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY };
      // Taking the camera: the director steps back, and any glide in progress stops where it is.
      state.touched = performance.now();
      state.fly = undefined;
      controls.autoRotate = false;
    };
    const onWheel = () => {
      state.touched = performance.now();
      state.fly = undefined;
      controls.autoRotate = false;
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: true });
    const onUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
      const id = pick(ev);
      state.selected = id;
      setSelected(id);
      if (!id) setFollow(false);
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
      // The sky: carry the simulation's clock forward between its ticks, so the sun moves smoothly.
      // When time is running too fast to watch (a day in a few seconds), hold the light at a steady afternoon.
      const sim = state.sim;
      const ahead = sim ? Math.min((now - sim.at) / 1000, 2.5) * sim.rate : 0;
      // A picture can be taken in any light: `look` holds the hour or the weather where you set it, for this screen only.
      const look = state.look;
      const at = sim ? (look?.hour !== undefined ? Math.floor(sim.tick / 1440) * 1440 + look.hour * 60 : sim.tick + ahead) : 14 * 60;
      const sky = sim ? skyAt(sim.seed, at, sim.season, look?.weather ?? sim.weather) : skyAt(1, at, "summer", "fair");
      const calm = sim && look?.hour === undefined ? Math.max(0, Math.min(1, (sim.rate - 90) / 220)) : 0;
      const steady = calm > 0 && sim ? skyAt(sim.seed, Math.floor(sim.tick / 1440) * 1440 + 15 * 60, sim.season, sim.weather) : undefined;
      state.sky = sky;
      atmosphere.update(dt, sky, camera, controls.target, steady, calm);
      const pal = atmosphere.now!;
      WIND.time.value = t;
      WIND.strength.value += (0.12 + sky.wind.speed * 1.1 - WIND.strength.value) * Math.min(1, dt);
      WIND.dir.value.set(sky.wind.x, sky.wind.z);
      // Rain darkens the ground.
      const wetness = sky.precip === "rain" ? sky.intensity : 0;
      landMesh.material.color.setScalar(1 - 0.2 * Math.min(1, wetness + pal.overcast * 0.3));
      sea.update(dt, pal, sky.wind);

      const speakers = state.bubbles;
      const env = {
        t, dt, dark: pal.dark, swell: sky.wind.speed, standY,
        wet: (x: number, z: number) => isWater(state.ground, x, z),
        fire: state.fire ?? { x: 86, z: 52 },
        speaking: (id: string) => speakers.has(id),
        near: (f: Figure) => {
          let best: Figure | undefined, bd = 36;
          for (const o of state.figures.values()) {
            if (o === f || !o.group.visible) continue;
            const d = (o.pos.x - f.pos.x) ** 2 + (o.pos.z - f.pos.z) ** 2;
            if (d < bd) (bd = d), (best = o);
          }
          return best;
        },
      };
      let atFire = 0;
      for (const f of state.figures.values()) {
        stepFigure(f, env);
        if (f.p.place === "tavern" && !f.walking && !f.p.asleep) atFire++;
      }
      // The fire burns from dusk, and whenever anyone is sitting at it.
      const scale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const fireAt = state.sources[0] && state.fire ? state.sources[0] : undefined;
      const fireLit = !!fireAt && (pal.dark > 0.12 || atFire > 0) && wetness < 0.9;
      life.update(t, dt, sky, pal, { sources: state.sources, fire: fireAt, fireLit, season: sim?.season ?? "summer", ground: (x, z) => (state.ground[Math.round(x) + Math.round(z) * TOWN.w] ?? TOWN.sea) + 1 }, scale, (k) => (atmosphere.flash = Math.max(atmosphere.flash, k)));
      precipitation.update(dt, sky, pal, controls.target);
      windows.update(t, sky, pal, scale);
      gulls.update(t, dt, sky);
      audio.update(dt, { sky, dark: pal.dark, fireLit, season: sim?.season ?? "summer", height: camera.position.y, fireDist: fireAt ? camera.position.distanceTo(hearth.position) : 999, shoreDist: Math.abs(controls.target.x - 26), people: atFire });
      // A glide in progress: ease out, along the way from where the camera was to where it is going.
      if (state.fly) {
        const fl = state.fly;
        fl.t = Math.min(1, fl.t + dt / fl.dur);
        const e = 1 - Math.pow(1 - fl.t, 3);
        controls.target.lerpVectors(fl.fromTarget, fl.toTarget, e);
        camera.position.lerpVectors(fl.fromPos, fl.toPos, e);
        // Rise a little on long glides, so the camera does not skim through the houses.
        camera.position.y += Math.sin(e * Math.PI) * Math.min(30, fl.fromPos.distanceTo(fl.toPos) * 0.15);
        if (fl.t >= 1) state.fly = undefined;
      }
      // The follow-cam keeps its angle and distance and slides along with the person.
      const fol = state.follow && !state.fly ? state.figures.get(state.follow) : undefined;
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
      for (const layer of layers) layer(dt, now);
      for (const pl of state.places) project(pl.x, standY(pl.x, pl.z) + 3, pl.z, pl.el, pl.home ? 85 : 220);
      controls.update();
      renderer.render(sc, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      props.onStage?.(undefined);
      layers.clear();
      ro.disconnect();
      renderer.domElement.removeEventListener("wheel", onWheel);
      controls.dispose();
      for (const f of state.figures.values()) disposeFigure(f);
      atmosphere.dispose();
      sea.dispose(sc);
      state.far?.dispose();
      life.dispose();
      precipitation.dispose();
      windows.dispose();
      gulls.dispose();
      audio.dispose();
      landMesh.geometry.dispose();
      landMesh.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    three.current?.audio.enable(!!props.sound);
  }, [props.sound]);
  useEffect(() => {
    if (three.current) three.current.look = props.look;
  }, [props.look]);

  useEffect(() => props.onSelect?.(selected), [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (three.current) {
      three.current.selected = selected;
      three.current.follow = follow ? selected : undefined;
    }
  }, [selected, follow]);

  // A moment picked from the list (or a notice clicked in the game): select that person and glide to them.
  useEffect(() => {
    if (props.focusReq) setFocus(props.focusReq);
  }, [props.focusReq]);
  useEffect(() => {
    if (!focus) return;
    // "at:<structure id>": look at something the town built rather than at a person.
    if (focus.id.startsWith("at:")) {
      const t = three.current;
      const st = scene?.structures.find((x) => x.id === focus.id.slice(3));
      if (t && st) {
        t.touched = performance.now();
        t.controls.autoRotate = false;
        setFollow(false);
        const c = t.camera.position.clone().set(st.plot.x0 + st.plot.w / 2, st.plot.y + 3, st.plot.z0 + st.plot.d / 2);
        t.flyTo(c, 46, { elevation: 0.55 });
      }
      return;
    }
    setSelected(focus.id);
    setFollow(true);
    const t = three.current;
    const f = t?.figures.get(focus.id);
    if (t && f) {
      // Someone asked to see this: the director leaves the camera with them for a while.
      t.touched = performance.now();
      t.controls.autoRotate = false;
      t.flyTo(new THREE.Vector3(f.group.position.x, f.group.position.y + 1, f.group.position.z), 30);
    }
  }, [focus]);

  // The director: when nobody has touched the camera for a while, cut to the best moment not yet shown,
  // hold on it, then move on. With nothing worth a cut, follow someone at work, or take in the town.
  const beatsRef = useRef<Beat[]>([]);
  beatsRef.current = props.beats ?? [];
  const sceneRef = useRef<Scene3D>();
  sceneRef.current = scene;
  const onShotRef = useRef(props.onShot);
  onShotRef.current = props.onShot;
  useEffect(() => {
    if (!props.director) {
      onShotRef.current?.(undefined);
      if (three.current) three.current.controls.autoRotate = false;
      return;
    }
    const shown = new Set<string>();
    let shot: { until: number; score: number; started: number } | undefined;
    let n = 0;
    let handsOff = false;
    const cut = () => {
      const t = three.current;
      const sc = sceneRef.current;
      if (!t || !sc || !t.ground.length) return;
      const now = performance.now();
      if (now - t.touched < HANDS_OFF) {
        if (!handsOff) onShotRef.current?.(undefined);
        handsOff = true;
        shot = undefined;
        return;
      }
      handsOff = false;
      const visible = (id: string) => {
        const f = t.figures.get(id);
        return !!f && f.group.visible;
      };
      const cands = beatsRef.current.filter((b) => !shown.has(b.id) && (b.agent ? visible(b.agent) : true));
      const best = cands[0];
      // Hold the current shot, unless something much bigger has just happened.
      if (shot && now < shot.until && !(best && best.score >= shot.score + 0.25 && now - shot.started > 3000)) return;
      const ground = (x: number, z: number) => (t.ground[Math.round(x) + Math.round(z) * TOWN.w] ?? TOWN.sea) + 1;
      const centre = sc.places.find((p) => p.id === "tavern") ?? sc.places[0];
      n++;
      const az = (n * 2.39996) % (Math.PI * 2);
      if (best) {
        shown.add(best.id);
        if (best.agent) {
          const f = t.figures.get(best.agent)!;
          t.selected = best.agent;
          setSelected(best.agent);
          setFollow(true);
          t.controls.autoRotate = false;
          // High enough to see over the pines and the roofs, close enough to read the bubbles.
          const inWoods = f.p.place === "woods";
          t.flyTo(new THREE.Vector3(f.group.position.x, f.group.position.y + 1, f.group.position.z), (inWoods ? 34 : 26) + (n % 3) * 5, { azimuth: az, elevation: inWoods ? 0.95 : 0.6 + (n % 2) * 0.15 });
          shot = { until: now + HOLD.close, score: best.score, started: now };
          onShotRef.current?.({ kind: "close", title: best.title, text: best.text, agent: best.agent, name: f.p.name });
          return;
        }
        const pl = (best.place && sc.places.find((p) => p.id === best.place)) || centre;
        setFollow(false);
        if (pl) t.flyTo(new THREE.Vector3(pl.x, ground(pl.x, pl.z), pl.z), best.wide ? 120 : 48, { azimuth: az, elevation: best.wide ? 0.7 : 0.55 });
        t.controls.autoRotate = true;
        t.controls.autoRotateSpeed = 0.35;
        shot = { until: now + HOLD.wide, score: best.score, started: now };
        onShotRef.current?.({ kind: "wide", title: best.title, text: best.text });
        return;
      }
      // Nothing new: someone at work, or the town from above.
      const working = sc.people.filter((p) => (p.working || p.building) && visible(p.id));
      const pick = working.length && n % 3 !== 0 ? working[n % working.length] : undefined;
      if (pick) {
        const f = t.figures.get(pick.id)!;
        t.selected = pick.id;
        setSelected(pick.id);
        setFollow(true);
        t.controls.autoRotate = false;
        t.flyTo(new THREE.Vector3(f.group.position.x, f.group.position.y + 1, f.group.position.z), f.p.place === "woods" ? 36 : 30, { azimuth: az, elevation: f.p.place === "woods" ? 0.95 : 0.65 });
        onShotRef.current?.({ kind: "idle", title: `${pick.name}, ${pick.activity}`, agent: pick.id, name: pick.name });
      } else {
        setFollow(false);
        setSelected(undefined);
        if (centre) t.flyTo(new THREE.Vector3(centre.x, ground(centre.x, centre.z), centre.z), 130, { azimuth: az, elevation: 0.75 });
        t.controls.autoRotate = true;
        t.controls.autoRotateSpeed = 0.3;
        onShotRef.current?.({ kind: "idle", title: `${sc.season[0]!.toUpperCase()}${sc.season.slice(1)} in the town`, text: `Day ${sc.day + 1}` });
      }
      shot = { until: now + HOLD.idle, score: 0, started: now };
    };
    const iv = setInterval(cut, 500);
    return () => clearInterval(iv);
  }, [props.director]);

  // New land when the town changes.
  useEffect(() => {
    const t = three.current;
    if (!t || !land) return;
    t.ground = land.ground;
    plans.current.clear();
    placedBefore.current.clear();
    // The country round the town, from the same seed.
    t.far?.dispose();
    t.far = seed === undefined ? undefined : new FarLand(t.scene, seed);
    t.far?.dress(sceneRef.current?.season ?? "summer");
  }, [land, seed]);

  // Houses and tents: rebuild the mesh only when a block or a tent changed.
  const buildKey = scene ? `${scene.season}:${scene.blight}:${scene.felled}|` + scene.structures.map((s) => `${s.id}:${s.placed}`).join(",") + "|" + scene.tents.map((x) => x.household).join(",") : "";
  useEffect(() => {
    const t = three.current;
    if (!t || !land || !scene) return;
    const { grid, ghost, chimneys, windows, fresh } = compose(land, wood, scene, plans.current, placedBefore.current);
    const tav = scene.places.find((p) => p.id === "tavern");
    t.fire = tav ? { x: tav.x, z: tav.z } : undefined;
    t.sources = [...(tav ? [[tav.x + 0.5, (land.ground[Math.round(tav.x) + Math.round(tav.z) * TOWN.w] ?? 6) + 2, tav.z + 0.5] as [number, number, number]] : []), ...chimneys];
    t.land.geometry.dispose();
    t.land.geometry = buildMesh(grid, false, { season: scene.season });
    t.windows.set(windows);
    t.life.dust(fresh);
    t.far?.dress(scene.season);
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
        f = makeFigure(p, personColor(p.id));
        t.scene.add(f.group);
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
        disposeFigure(f);
        t.figures.delete(id);
      }

    if (t.places.length !== scene.places.length) {
      for (const pl of t.places) pl.el.remove();
      t.places = scene.places.map((pl) => {
        const el = document.createElement("span");
        el.className = `t3-label${pl.id.startsWith("home_") ? " t3-home" : ""}`;
        el.textContent = pl.name;
        el.hidden = true;
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
        // Hidden until the render loop has placed it over someone's head.
        el.hidden = true;
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
    // Time and weather for the sky: where the clock is, and how fast it has been running.
    const tick = scene.day * 1440 + scene.hour * 60;
    const now = performance.now();
    const was = t.sim;
    const gap = was ? (now - was.at) / 1000 : 0;
    const jumped = !was || tick < was.tick || gap <= 0 || gap > 6;
    const rate = jumped ? (was?.rate ?? 4) : Math.min(600, (tick - was.tick) / gap);
    t.sim = { seed: scene.seed, season: scene.season, weather: scene.weather, tick, at: now, rate: jumped ? rate : was.rate + (rate - was.rate) * 0.5 };
  }, [scene]);

  const person = scene?.people.find((p) => p.id === selected);
  const building = scene?.structures.filter((s) => !s.done) ?? [];
  const built = scene?.structures.filter((s) => s.done && !s.work).length ?? 0;
  return (
    <div className={`town3d${game ? " t3-game" : ""}`}>
      <div ref={host} className="t3-stage" role="img" aria-label="The town in 3D. Drag to turn, scroll to zoom, click a person.">
        <div ref={labels} className="t3-labels" aria-hidden="true" />
        {scene && !game && (
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
        {error && <div className={`t3-hud t3-error${error === NO_3D ? " t3-no3d" : ""}`}>{error}</div>}
      </div>
      {!game && !!scene?.moments.length && (
        <div className="t3-moments">
          <span>Jump to</span>
          {scene.moments.map((m) => (
            <button key={m.id} onClick={() => setFocus({ id: m.agent, n: Date.now() })} title={m.text ?? m.title}>
              {m.title}
            </button>
          ))}
        </div>
      )}
      {!game && <p className="t3-help">Drag to turn, right-drag to pan, scroll to zoom. Click anyone to see who they are. Faint blocks are the parts of a house still to be built.</p>}
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
