// Your body in the 3D town. It lives outside Town3D: the town hands over a `Stage` (camera, scene,
// where everyone is, the land's heights, a per-frame hook) and this adds one figure to it, moves
// that figure from the keyboard or a click on the ground, and keeps the camera with it.
//
// Nothing here talks to the server. It only knows where you are standing and who is close; the
// page turns that into "you are at the fire circle" and "press E to talk to Mara".

import * as THREE from "three";
import { TOWN } from "@psyche/engine";
import type { Stage } from "../Town3D";

const WALK = 8;
const RUN = 14;
/** How close someone has to be before you can talk without walking over. */
export const REACH = 7;
const KEYS: Record<string, [number, number]> = {
  w: [0, 1], arrowup: [0, 1],
  s: [0, -1], arrowdown: [0, -1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

function label(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "600 56px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(8, 14, 18, 0.85)";
  g.strokeText(text, 256, 64, 490);
  g.fillStyle = "#ffd34d";
  g.fillText(text, 256, 64, 490);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(5, 1.25, 1);
  s.renderOrder = 10;
  return s;
}

/** A traveller: pale cloak, a pack on the back, a wide hat, and a gold marker overhead so you can find yourself. */
function avatar(name: string): { group: THREE.Group; marker: THREE.Mesh; parts: THREE.Mesh[] } {
  const group = new THREE.Group();
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.64, 1.1, 0.44), mat(0xece4d2));
  body.position.y = 0.55;
  const sash = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.46), mat(0xc0392b));
  sash.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), mat(0xe8c39e));
  head.position.y = 1.36;
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.86), mat(0x5a4632));
  brim.position.y = 1.62;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.22, 0.44), mat(0x5a4632));
  crown.position.y = 1.76;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), mat(0x7a4b2a));
  pack.position.set(0, 0.72, -0.36);
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
  marker.position.y = 2.9;
  const tag = label(name);
  tag.position.y = 3.9;
  const parts = [body, sash, head, brim, crown, pack];
  for (const p of parts) p.castShadow = true;
  group.add(...parts, marker, tag);
  group.scale.setScalar(1.25);
  return { group, marker, parts };
}

export class Walker {
  readonly pos: THREE.Vector3;
  private readonly group: THREE.Group;
  private readonly marker: THREE.Mesh;
  private readonly keys = new Set<string>();
  private dest?: THREE.Vector3;
  private chase?: string;
  private hold = new Set<string>();
  private company?: string;
  private glide?: { t: number; fromP: THREE.Vector3; fromT: THREE.Vector3; toP: THREE.Vector3; toT: THREE.Vector3 };
  /** Where the camera sits from the point it looks at. Yours to change by dragging or zooming. */
  private readonly offset = new THREE.Vector3();
  /** The point the camera looks at: you, a beat behind, so steps do not jolt it. */
  private readonly eye = new THREE.Vector3();
  /** The canvas size the view was last centred for. */
  private view = "";
  private readonly off: (() => void)[] = [];
  private heading = 0;

  constructor(
    private readonly stage: Stage,
    o: { name: string; x: number; z: number; onPick: (id: string) => void; onArrive?: (id: string) => void },
  ) {
    const a = avatar(o.name);
    this.group = a.group;
    this.marker = a.marker;
    const start = this.nearestLand(o.x, o.z);
    this.pos = new THREE.Vector3(start.x, 0, start.z);
    this.place();
    stage.scene.add(this.group);
    this.lookAtMe(26);
    // While you walk the camera is yours alone: it stays on you whatever else in the scene would like
    // to glide or follow, and keeps whatever angle and distance you last dragged it to. The controls
    // say "change" from inside their own update, which is after this layer has put the camera on you.
    const turned = () => {
      if (!this.glide) this.offset.copy(stage.camera.position).sub(stage.controls.target);
    };
    stage.controls.addEventListener("change", turned);
    this.off.push(() => stage.controls.removeEventListener("change", turned));

    const typing = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k in KEYS || k === "shift") {
        this.keys.add(k);
        if (k.startsWith("arrow")) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.off.push(() => window.removeEventListener("keydown", down), () => window.removeEventListener("keyup", up), () => window.removeEventListener("blur", blur));

    // A click (not a drag) on a person walks you over to them; on the ground, walks you there.
    const el = stage.controls.domElement as HTMLElement;
    const ray = new THREE.Raycaster();
    let at = { x: 0, y: 0 };
    const pd = (e: PointerEvent) => (at = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - at.x, e.clientY - at.y) > 5 || e.button !== 0) return;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
      const people = [...stage.figures.entries()].filter(([, f]) => f.group.visible);
      const hit = ray.intersectObjects(people.map(([, f]) => f.group), true)[0];
      if (hit) {
        const id = people.find(([, f]) => {
          let n: THREE.Object3D | null = hit.object;
          while (n && n !== f.group) n = n.parent;
          return !!n;
        })?.[0];
        if (id) {
          this.chase = id;
          this.dest = undefined;
          this.onArrive = o.onArrive;
          o.onPick(id);
        }
        return;
      }
      // March the ray down to the land.
      const p = ray.ray.origin.clone(), d = ray.ray.direction.clone().multiplyScalar(0.5);
      for (let i = 0; i < 900; i++) {
        p.add(d);
        if (p.x < 0 || p.z < 0 || p.x >= TOWN.w || p.z >= TOWN.d) continue;
        if (p.y <= this.standY(p.x, p.z)) {
          if (this.walkable(p.x, p.z)) {
            this.dest = new THREE.Vector3(p.x, 0, p.z);
            this.chase = undefined;
          }
          return;
        }
      }
    };
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointerup", pu);
    this.off.push(() => el.removeEventListener("pointerdown", pd), () => el.removeEventListener("pointerup", pu));

    stage.layers.add(this.frame);
    this.off.push(() => stage.layers.delete(this.frame));
  }

  private onArrive?: (id: string) => void;

  /** The land's heights, as the stage has them now. */
  private ground(): number[] {
    return this.stage.ground();
  }
  private cell(x: number, z: number): number {
    const xi = Math.max(0, Math.min(TOWN.w - 1, Math.round(x - 0.5))), zi = Math.max(0, Math.min(TOWN.d - 1, Math.round(z - 0.5)));
    return this.ground()[xi + zi * TOWN.w] ?? TOWN.sea;
  }
  private standY(x: number, z: number): number {
    return Math.max(TOWN.sea, this.cell(x, z) + 1);
  }
  private walkable(x: number, z: number): boolean {
    return x > 1 && z > 1 && x < TOWN.w - 2 && z < TOWN.d - 2 && this.cell(x, z) >= TOWN.sea;
  }
  private nearestLand(x: number, z: number): { x: number; z: number } {
    if (!this.ground().length || this.walkable(x, z)) return { x, z };
    for (let r = 1; r < 40; r++)
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r, pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (this.walkable(px, pz)) return { x: px, z: pz };
      }
    return { x, z };
  }

  private place(bob = 0): void {
    this.group.position.set(this.pos.x, this.standY(this.pos.x, this.pos.z) + bob, this.pos.z);
    this.group.rotation.y = this.heading;
  }

  /** Bring the camera round to you, from wherever it was. */
  lookAtMe(dist = 26): void {
    const { camera, controls } = this.stage;
    const cur = camera.position.clone().sub(controls.target);
    const az = Math.atan2(cur.x, cur.z);
    const el = 0.5;
    const toT = new THREE.Vector3(this.pos.x, this.standY(this.pos.x, this.pos.z) + 1.5, this.pos.z);
    const toP = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(toT);
    this.glide = { t: 0, fromP: camera.position.clone(), fromT: controls.target.clone(), toP, toT };
  }

  /** People who stay put and face you while you are talking with them. */
  setHold(ids: string[]): void {
    this.hold = new Set(ids);
  }
  /** Someone who has walked over to you. */
  setCompany(id: string | undefined): void {
    this.company = id;
  }
  stop(): void {
    this.dest = undefined;
    this.chase = undefined;
  }

  /** The closest person you could talk to from where you stand. */
  nearest(max = REACH): { id: string; dist: number } | undefined {
    let best: { id: string; dist: number } | undefined;
    for (const [id, f] of this.stage.figures) {
      if (!f.group.visible || f.p.asleep) continue;
      const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z);
      if (d <= max && (!best || d < best.dist)) best = { id, dist: d };
    }
    return best;
  }

  private frame = (dt: number, now: number): void => {
    const { camera, controls, figures } = this.stage;
    // Which way is "forward": away from the camera, along the ground.
    let fx = controls.target.x - camera.position.x, fz = controls.target.z - camera.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    let mx = 0, mz = 0;
    for (const k of this.keys) {
      const v = KEYS[k];
      if (!v) continue;
      mx += fx * v[1] - fz * v[0];
      mz += fz * v[1] + fx * v[0];
    }
    let moving = false;
    const speed = (this.keys.has("shift") ? RUN : WALK) * dt;
    if (mx || mz) {
      this.dest = undefined;
      this.chase = undefined;
      const l = Math.hypot(mx, mz);
      moving = this.step((mx / l) * speed, (mz / l) * speed);
    } else {
      const who = this.chase ? figures.get(this.chase) : undefined;
      const goal = who ? who.pos : this.dest;
      if (goal) {
        const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z, d = Math.hypot(dx, dz);
        const stopAt = who ? 2.6 : 0.3;
        if (d <= stopAt) {
          if (who && this.chase) this.onArrive?.(this.chase);
          this.dest = undefined;
          this.chase = undefined;
        } else {
          const s = Math.min((who ? RUN : WALK) * dt, d - stopAt + 0.01);
          moving = this.step((dx / d) * s, (dz / d) * s);
          if (!moving) this.stop();
        }
      } else if (this.chase) this.chase = undefined;
    }
    this.place(moving ? Math.abs(Math.sin(now / 90)) * 0.12 : 0);
    this.marker.rotation.y += dt * 2.2;
    this.marker.position.y = 2.9 + Math.sin(now / 400) * 0.08;

    // People you are talking with stay put and face you; whoever came over walks up and stops.
    for (const id of this.hold) {
      const f = figures.get(id);
      if (!f) continue;
      f.target.copy(f.pos);
      f.group.rotation.y = Math.atan2(this.pos.x - f.pos.x, this.pos.z - f.pos.z);
    }
    const c = this.company ? figures.get(this.company) : undefined;
    if (c) {
      const dx = c.pos.x - this.pos.x, dz = c.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
      c.target.set(this.pos.x + (dx / d) * 2.4, 0, this.pos.z + (dz / d) * 2.4);
      if (d < 3.2) c.group.rotation.y = Math.atan2(-dx, -dz);
    }

    // The panel on the left and the feed along the bottom cover part of the town, so the picture is
    // drawn off-centre: you stand in the middle of what is left to see.
    const el = controls.domElement as HTMLElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (`${w}x${h}` !== this.view && w && h) {
      this.view = `${w}x${h}`;
      camera.setViewOffset(w, h, w > 720 ? -Math.min(200, w * 0.14) : 0, Math.round(h * 0.1), w, h);
    }

    // The camera: a glide when you first walk in, then it slides along with you.
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / 0.9);
      const e = 1 - Math.pow(1 - g.t, 3);
      controls.target.lerpVectors(g.fromT, g.toT, e);
      camera.position.lerpVectors(g.fromP, g.toP, e);
      if (g.t >= 1) {
        this.offset.copy(g.toP).sub(g.toT);
        this.eye.copy(g.toT);
        this.glide = undefined;
      }
    } else {
      this.eye.lerp(new THREE.Vector3(this.pos.x, this.standY(this.pos.x, this.pos.z) + 1.5, this.pos.z), 1 - Math.pow(0.0005, dt));
      controls.target.copy(this.eye);
      camera.position.copy(this.eye).add(this.offset);
    }
  };

  /** Take a step, sliding along the shore or the map's edge rather than stopping dead. */
  private step(dx: number, dz: number): boolean {
    const tryMove = (x: number, z: number) => {
      if (!this.walkable(x, z)) return false;
      this.pos.set(x, 0, z);
      return true;
    };
    const ok = tryMove(this.pos.x + dx, this.pos.z + dz) || tryMove(this.pos.x + dx, this.pos.z) || tryMove(this.pos.x, this.pos.z + dz);
    if (ok) this.heading = Math.atan2(dx, dz);
    return ok;
  }

  dispose(): void {
    for (const f of this.off) f();
    this.stage.camera.clearViewOffset();
    this.stage.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose();
    });
  }
}
