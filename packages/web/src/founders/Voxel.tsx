// The islet in 3D. Blocks are meshed into one geometry with only the faces you can see, each face
// shaded by the way it points so the look stays flat and readable. Planned blocks not yet placed
// show as a faint ghost, so you can watch the design turn into a house.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MATERIALS } from "@psyche/engine";
import type { GridData } from "./api";

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

export interface VoxelProps {
  grid?: GridData;
  ghost: [number, number, number, number][];
  builder: { x: number; y: number; z: number; color: string; asleep: boolean };
  /** Hour of day, 0 to 24. */
  hour: number;
  storm: boolean;
  focus: { x: number; z: number };
}

export function Voxel({ grid, ghost, builder, hour, storm, focus }: VoxelProps) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    land: THREE.Mesh;
    sea: THREE.Mesh;
    ghost: THREE.InstancedMesh;
    figure: THREE.Group;
    rain: THREE.Points;
    sun: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
    target: THREE.Vector3;
    props: VoxelProps;
  }>();

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
    camera.position.set(focus.x + 30, 36, focus.z + 42);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(focus.x, 6, focus.z);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 8;
    controls.maxDistance = 120;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 1.2);
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(-30, 50, 20);
    scene.add(hemi, sun);

    const landMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const seaMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.78 });
    const land = new THREE.Mesh(new THREE.BufferGeometry(), landMat);
    const sea = new THREE.Mesh(new THREE.BufferGeometry(), seaMat);
    // Open water beyond the grid, so the islet floats in a sea, not a void.
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: COLOR.water }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(24, 3.8, 24);
    scene.add(ocean, land, sea);

    const ghostMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 0.96, 0.96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }), 2000);
    ghostMesh.count = 0;
    scene.add(ghostMesh);

    const figure = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 0.35), new THREE.MeshLambertMaterial({ color: 0xc2410c }));
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: 0xe8c39e }));
    head.position.y = 1.25;
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
    marker.position.y = 2.1;
    marker.rotation.x = Math.PI;
    figure.add(body, head, marker);
    scene.add(figure);

    const drops = 2500;
    const rp = new Float32Array(drops * 3);
    for (let i = 0; i < drops; i++) rp.set([Math.random() * 60 - 6, Math.random() * 30, Math.random() * 60 - 6], i * 3);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xaac4dd, size: 0.12, transparent: true, opacity: 0.7 }));
    rain.visible = false;
    scene.add(rain);

    const state = { renderer, scene, camera, controls, land, sea, ghost: ghostMesh, figure, rain, sun, hemi, target: new THREE.Vector3(builder.x, builder.y, builder.z), props: { grid, ghost, builder, hour, storm, focus } };
    three.current = state;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = state.props;
      figure.position.lerp(state.target, 1 - Math.pow(0.02, dt));
      marker.rotation.y += dt * 2;
      figure.rotation.z = p.builder.asleep ? Math.PI / 2 : 0;
      if (rain.visible) {
        const a = rainGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < drops; i++) {
          let y = a.getY(i) - dt * 22;
          if (y < 3) y = 30;
          a.setY(i, y);
          a.setX(i, a.getX(i) + dt * 6);
          if (a.getX(i) > 54) a.setX(i, -6);
        }
        a.needsUpdate = true;
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
      el.removeChild(renderer.domElement);
    };
    // The scene is built once; props flow in through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = three.current;
    if (!t || !grid) return;
    t.land.geometry.dispose();
    t.land.geometry = buildMesh(grid, false);
    t.sea.geometry.dispose();
    t.sea.geometry = buildMesh(grid, true);
  }, [grid]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    t.ghost.count = Math.min(ghost.length, 2000);
    ghost.slice(0, 2000).forEach(([x, y, z, b], i) => {
      m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
      t.ghost.setMatrixAt(i, m);
      t.ghost.setColorAt(i, c.set(COLOR[MATERIALS[b]!] ?? "#ffffff"));
    });
    t.ghost.instanceMatrix.needsUpdate = true;
    if (t.ghost.instanceColor) t.ghost.instanceColor.needsUpdate = true;
  }, [ghost]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.props = { grid, ghost, builder, hour, storm, focus };
    t.target.set(builder.x + 0.5, builder.y, builder.z + 0.5);
    (t.figure.children[0] as THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>).material.color.set(builder.color);
    // Daylight follows the clock; the storm darkens everything.
    const day = Math.max(0, Math.min(1, Math.sin(((hour - 6) / 14) * Math.PI) * 1.4));
    const sky = new THREE.Color(storm ? "#4b5560" : "#0d1b2e").lerp(new THREE.Color(storm ? "#7d8a94" : "#a9d3e6"), day);
    t.scene.background = sky;
    t.scene.fog = new THREE.Fog(sky, 60, 160);
    t.hemi.intensity = 0.35 + day * (storm ? 0.6 : 1.0);
    t.sun.intensity = storm ? 0.1 : day * 0.7;
    t.rain.visible = storm;
  }, [grid, ghost, builder, hour, storm, focus]);

  return <div ref={host} className="voxel" role="img" aria-label="The islet in 3D. Drag to orbit, scroll to zoom." />;
}
