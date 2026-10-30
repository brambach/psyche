// Blueprints: the small building language the Architect writes. A house is a dozen fields, not
// thousands of blocks. The engine validates and repairs a design, compiles it into an ordered
// list of block placements, and prices it in raw materials and hours.

import { M, type Material, type Plot } from "./voxel.js";

export type Side = "north" | "south" | "east" | "west";
export const SIDES: Side[] = ["north", "south", "east", "west"];
export type Furniture = "bed" | "hearth" | "table" | "chest";

export interface Blueprint {
  name: string;
  /** Outer size along x (west to east) and z (north to south), walls included. 5 to 11. */
  width: number;
  depth: number;
  /** Wall courses, 3 to 5. */
  wallHeight: number;
  walls: "plank" | "cobble" | "log";
  /** The first course of the walls. */
  foundation: "cobble" | "plank" | "none";
  corners: "log" | "same";
  floor: "plank" | "cobble" | "dirt";
  roof: { shape: "flat" | "gable" | "hip"; material: "thatch" | "plank"; overhang: 0 | 1 };
  door: Side;
  /** One window per entry, spread along that wall. */
  windows: Side[];
  furniture: Furniture[];
  /** A plank deck in front of the door. */
  porch: boolean;
}

export type Part = "floor" | "walls" | "roof" | "chimney" | "furniture" | "porch";

export interface Placement {
  x: number;
  y: number;
  z: number;
  b: number;
  part: Part;
}

/** What one placed block costs, in carried items. */
export type Item = "plank" | "cobble" | "log" | "thatch";
const COST: Partial<Record<Material, [Item, number]>> = {
  plank: ["plank", 1],
  cobble: ["cobble", 1],
  log: ["log", 1],
  thatch: ["thatch", 1],
  door: ["plank", 1],
  bed: ["plank", 3],
  table: ["plank", 2],
  chest: ["plank", 2],
  hearth: ["cobble", 3],
};
export function costOf(b: number): [Item, number] | undefined {
  const name = Object.keys(M).find((k) => M[k as Material] === b) as Material;
  return COST[name];
}

/** Minutes for one person, with hand tools. Tuned so a modest house takes most of two days. */
export const PACE = {
  place: 2.5,
  /** Fell, split and saw one log (a log makes four planks). */
  chop: 8,
  quarry: 6,
  /** Cut and bundle one bed of reeds (a bed makes two thatch). */
  reeds: 3,
  /** Blocks per minute, carrying a load. */
  walk: 4,
  planksPerLog: 4,
  thatchPerReeds: 2,
};

export const DIR: Record<Side, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** Where the house sits on the plot. A porch pushes it back from the door side. */
export function siteOf(bp: Blueprint, plot: Plot): { x0: number; z0: number; x1: number; z1: number; y: number } {
  let x0 = plot.x0 + Math.floor((plot.w - bp.width) / 2);
  let z0 = plot.z0 + Math.floor((plot.d - bp.depth) / 2);
  if (bp.porch) {
    const [dx, dz] = DIR[bp.door];
    x0 -= dx;
    z0 -= dz;
  }
  return { x0, z0, x1: x0 + bp.width - 1, z1: z0 + bp.depth - 1, y: plot.y };
}

/** The ordered placements: floor, walls course by course, roof from the eaves up, chimney, furniture, porch. */
export function compile(bp: Blueprint, plot: Plot): Placement[] {
  const out: Placement[] = [];
  const { x0, z0, x1, z1, y: g } = siteOf(bp, plot);
  const put = (x: number, y: number, z: number, b: number, part: Part) => out.push({ x, y, z, b, part });
  const mat = (m: string) => M[m as Material];

  // Floor, replacing the turf.
  if (bp.floor !== "dirt") for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, g - 1, z, mat(bp.floor), "floor");

  // The door sits mid-wall; windows spread along their walls.
  const doorAt = doorCell(bp, x0, z0, x1, z1);
  const windowCells = new Set<string>();
  for (const side of SIDES) {
    const n = bp.windows.filter((w) => w === side).length;
    if (!n) continue;
    const cells = wallCells(side, x0, z0, x1, z1);
    for (let i = 0; i < n; i++) {
      let k = Math.round(((i + 1) * (cells.length - 1)) / (n + 1));
      const c = cells[k]!;
      if (bp.door === side && Math.abs(c[0] - doorAt[0]) + Math.abs(c[1] - doorAt[1]) < 2) k = Math.min(cells.length - 2, k + 2);
      windowCells.add(cells[k]!.join());
    }
  }
  for (let yy = 0; yy < bp.wallHeight; yy++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
        if (x === doorAt[0] && z === doorAt[1] && yy < 2) {
          put(x, g + yy, z, M.door, "walls");
          continue;
        }
        if (yy === 1 && !corner && windowCells.has(`${x},${z}`)) continue;
        let b = mat(bp.walls);
        if (corner && bp.corners === "log") b = M.log;
        else if (yy === 0 && bp.foundation !== "none") b = mat(bp.foundation);
        put(x, g + yy, z, b, "walls");
      }
    }
  }

  // Roof. Gables run their ridge along the longer side and close the ends with wall.
  const yr = g + bp.wallHeight;
  const oh = bp.roof.overhang;
  const rm = mat(bp.roof.material);
  const ax0 = x0 - oh, ax1 = x1 + oh, az0 = z0 - oh, az1 = z1 + oh;
  let roofTop = yr;
  if (bp.roof.shape === "flat") {
    for (let z = az0; z <= az1; z++) for (let x = ax0; x <= ax1; x++) put(x, yr, z, rm, "roof");
  } else if (bp.roof.shape === "gable") {
    const alongX = bp.width >= bp.depth;
    for (let k = 0; ; k++) {
      const lo = (alongX ? az0 : ax0) + k;
      const hi = (alongX ? az1 : ax1) - k;
      if (lo > hi) break;
      roofTop = yr + k;
      for (let t = alongX ? ax0 : az0; t <= (alongX ? ax1 : az1); t++) {
        for (const s of lo === hi ? [lo] : [lo, hi]) put(alongX ? t : s, yr + k, alongX ? s : t, rm, "roof");
      }
      // Gable ends: fill the triangle between the slopes, over the end walls.
      for (let s = lo + 1; s < hi; s++) {
        const inWall = alongX ? s >= z0 && s <= z1 : s >= x0 && s <= x1;
        if (!inWall || k === 0) continue;
        for (const e of alongX ? [x0, x1] : [z0, z1]) put(alongX ? e : s, yr + k - 1, alongX ? s : e, mat(bp.walls), "roof");
      }
    }
  } else {
    for (let k = 0; ; k++) {
      const rx0 = ax0 + k, rx1 = ax1 - k, rz0 = az0 + k, rz1 = az1 - k;
      if (rx0 > rx1 || rz0 > rz1) break;
      roofTop = yr + k;
      const last = rx0 + 1 >= rx1 || rz0 + 1 >= rz1;
      for (let z = rz0; z <= rz1; z++)
        for (let x = rx0; x <= rx1; x++) if (last || x === rx0 || x === rx1 || z === rz0 || z === rz1) put(x, yr + k, z, rm, "roof");
      if (last) break;
    }
  }

  // Furniture along the walls, clear of the doorway. The hearth gets a chimney through the roof.
  const [ddx, ddz] = DIR[bp.door];
  const inner = { x0: x0 + 1, z0: z0 + 1, x1: x1 - 1, z1: z1 - 1 };
  const taken = new Set<string>([`${doorAt[0] - ddx},${doorAt[1] - ddz}`]);
  const spots = interiorSpots(inner, bp.door);
  const free = (x: number, z: number) => !taken.has(`${x},${z}`) && x >= inner.x0 && x <= inner.x1 && z >= inner.z0 && z <= inner.z1;
  for (const f of bp.furniture) {
    if (f === "bed") {
      const spot = spots.find(([x, z, dx, dz]) => free(x, z) && free(x + dx, z + dz));
      if (!spot) continue;
      const [x, z, dx, dz] = spot;
      taken.add(`${x},${z}`).add(`${x + dx},${z + dz}`);
      put(x, g, z, M.bed, "furniture");
      put(x + dx, g, z + dz, M.bed, "furniture");
    } else if (f === "table") {
      const cx = Math.round((inner.x0 + inner.x1) / 2), cz = Math.round((inner.z0 + inner.z1) / 2);
      if (free(cx, cz)) {
        taken.add(`${cx},${cz}`);
        put(cx, g, cz, M.table, "furniture");
      }
    } else {
      const spot = spots.find(([x, z]) => free(x, z));
      if (!spot) continue;
      const [x, z] = spot;
      taken.add(`${x},${z}`);
      put(x, g, z, f === "hearth" ? M.hearth : M.chest, "furniture");
      if (f === "hearth") for (let y = g + 1; y <= roofTop + 1; y++) put(x, y, z, M.cobble, "chimney");
    }
  }

  if (bp.porch) {
    const along = bp.door === "north" || bp.door === "south";
    for (let k = 1; k <= 2; k++)
      for (let t = -1; t <= 1; t++) put(doorAt[0] + ddx * k + (along ? t : 0), g - 1, doorAt[1] + ddz * k + (along ? 0 : t), M.plank, "porch");
  }

  // Later placements win where two parts share a cell (a chimney through the roof).
  const seen = new Map<string, number>();
  out.forEach((p, i) => seen.set(`${p.x},${p.y},${p.z}`, i));
  return out.filter((p, i) => seen.get(`${p.x},${p.y},${p.z}`) === i);
}

function doorCell(bp: Blueprint, x0: number, z0: number, x1: number, z1: number): [number, number] {
  const mx = Math.floor((x0 + x1) / 2), mz = Math.floor((z0 + z1) / 2);
  return bp.door === "north" ? [mx, z0] : bp.door === "south" ? [mx, z1] : bp.door === "east" ? [x1, mz] : [x0, mz];
}

function wallCells(side: Side, x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const out: [number, number][] = [];
  if (side === "north" || side === "south") for (let x = x0 + 1; x < x1; x++) out.push([x, side === "north" ? z0 : z1]);
  else for (let z = z0 + 1; z < z1; z++) out.push([side === "west" ? x0 : x1, z]);
  return out;
}

/** Cells along the inside of the walls, back wall first, each with a direction to lay a bed along. */
function interiorSpots(r: { x0: number; z0: number; x1: number; z1: number }, door: Side): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const back: Side = door === "north" ? "south" : door === "south" ? "north" : door === "east" ? "west" : "east";
  const order: Side[] = [back, ...SIDES.filter((s) => s !== back && s !== door), door];
  for (const s of order) {
    if (s === "north" || s === "south") {
      const z = s === "north" ? r.z0 : r.z1;
      for (let x = r.x0; x <= r.x1; x++) out.push([x, z, 1, 0]);
    } else {
      const x = s === "west" ? r.x0 : r.x1;
      for (let z = r.z0; z <= r.z1; z++) out.push([x, z, 0, 1]);
    }
  }
  return out;
}

export interface Bill {
  items: Record<Item, number>;
  /** Raw materials to gather: logs to fell, stone to quarry, reed beds to cut. */
  raw: { logs: number; stone: number; reeds: number };
  blocks: number;
  hours: number;
}

export function bill(placements: Placement[]): Bill {
  const items: Record<Item, number> = { plank: 0, cobble: 0, log: 0, thatch: 0 };
  for (const p of placements) {
    const c = costOf(p.b);
    if (c) items[c[0]] += c[1];
  }
  const raw = {
    logs: items.log + Math.ceil(items.plank / PACE.planksPerLog),
    stone: items.cobble,
    reeds: Math.ceil(items.thatch / PACE.thatchPerReeds),
  };
  // Walking adds about a fifth on top of the work itself.
  const minutes = (placements.length * PACE.place + raw.logs * PACE.chop + raw.stone * PACE.quarry + raw.reeds * PACE.reeds) * 1.2;
  return { items, raw, blocks: placements.length, hours: minutes / 60 };
}

export interface Checked {
  blueprint: Blueprint;
  /** What the engine had to change to make the design buildable here. */
  repairs: string[];
  placements: Placement[];
  bill: Bill;
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
};
const oneOf = <T extends string>(v: unknown, xs: readonly T[], dflt: T): T => (xs.includes(v as T) ? (v as T) : dflt);

/**
 * Make any proposed design buildable on this plot with what the island holds. The model's design is
 * kept wherever it can be; every change is reported, so the scan can show the gap between the
 * dream and the house.
 */
export function check(proposed: Partial<Blueprint>, plot: Plot, supply: { logs: number; stone: number; reeds: number }): Checked {
  const repairs: string[] = [];
  const p = proposed as Record<string, unknown>;
  const roof = (p.roof ?? {}) as Record<string, unknown>;
  const bp: Blueprint = {
    name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 60) : "A shelter",
    width: clampInt(p.width, 5, 11, 7),
    depth: clampInt(p.depth, 5, 11, 6),
    wallHeight: clampInt(p.wallHeight, 3, 5, 3),
    walls: oneOf(p.walls, ["plank", "cobble", "log"] as const, "plank"),
    foundation: oneOf(p.foundation, ["cobble", "plank", "none"] as const, "none"),
    corners: oneOf(p.corners, ["log", "same"] as const, "same"),
    floor: oneOf(p.floor, ["plank", "cobble", "dirt"] as const, "plank"),
    roof: {
      shape: oneOf(roof.shape, ["flat", "gable", "hip"] as const, "gable"),
      material: oneOf(roof.material, ["thatch", "plank"] as const, "thatch"),
      overhang: roof.overhang === 0 ? 0 : 1,
    },
    door: oneOf(p.door, SIDES, "south"),
    windows: (Array.isArray(p.windows) ? p.windows : []).filter((w): w is Side => SIDES.includes(w as Side)).slice(0, 6),
    furniture: [...new Set((Array.isArray(p.furniture) ? p.furniture : []).filter((f): f is Furniture => ["bed", "hearth", "table", "chest"].includes(f as string)))],
    porch: p.porch === true,
  };
  if (p.width !== bp.width && p.width !== undefined) repairs.push(`width ${String(p.width)} is outside 5 to 11; built ${bp.width}`);
  if (p.depth !== bp.depth && p.depth !== undefined) repairs.push(`depth ${String(p.depth)} is outside 5 to 11; built ${bp.depth}`);
  if (!bp.furniture.includes("bed")) {
    bp.furniture.unshift("bed");
    repairs.push("added a bed: a shelter needs somewhere to sleep");
  }
  // The roof's overhang and a porch must stay on the plot.
  const room = (axisDoor: boolean) => plot.w - 2 * bp.roof.overhang - (bp.porch && axisDoor ? 2 : 0);
  const doorOnX = bp.door === "east" || bp.door === "west";
  if (bp.width > room(doorOnX)) {
    repairs.push(`narrowed from ${bp.width} to ${room(doorOnX)} to fit the plot`);
    bp.width = room(doorOnX);
  }
  if (bp.depth > room(!doorOnX)) {
    repairs.push(`shortened from ${bp.depth} to ${room(!doorOnX)} to fit the plot`);
    bp.depth = room(!doorOnX);
  }

  let placements = compile(bp, plot);
  let b = bill(placements);
  if (b.raw.stone > supply.stone && (bp.walls === "cobble" || bp.foundation === "cobble" || bp.floor === "cobble")) {
    repairs.push(`not enough stone on the island for ${b.raw.stone} blocks; walls and floor in plank instead`);
    if (bp.walls === "cobble") bp.walls = "plank";
    if (bp.foundation === "cobble" && b.raw.stone > supply.stone) bp.foundation = "none";
    if (bp.floor === "cobble") bp.floor = "plank";
    placements = compile(bp, plot);
    b = bill(placements);
  }
  if (b.raw.reeds > supply.reeds && bp.roof.material === "thatch") {
    repairs.push(`not enough reeds for a thatched roof; roofed in plank`);
    bp.roof.material = "plank";
    placements = compile(bp, plot);
    b = bill(placements);
  }
  while (b.raw.logs > supply.logs && (bp.width > 5 || bp.depth > 5 || bp.wallHeight > 3)) {
    if (bp.wallHeight > 3) bp.wallHeight -= 1;
    else if (bp.width >= bp.depth) bp.width -= 1;
    else bp.depth -= 1;
    placements = compile(bp, plot);
    b = bill(placements);
    if (!repairs.some((r) => r.startsWith("not enough timber"))) repairs.push("not enough timber on the island; made it smaller");
  }
  return { blueprint: bp, repairs, placements, bill: b };
}

/** A one-line description, for the feed and the pattern book. */
export function describe(bp: Blueprint): string {
  const shape = bp.roof.shape === "flat" ? "flat" : bp.roof.shape === "gable" ? "gabled" : "hipped";
  const extras = [
    bp.furniture.includes("hearth") ? "a hearth" : "",
    bp.windows.length ? `${bp.windows.length} window${bp.windows.length > 1 ? "s" : ""}` : "no windows",
    bp.porch ? "a porch" : "",
  ].filter(Boolean);
  return `${bp.width} by ${bp.depth}, ${bp.walls} walls ${bp.wallHeight} high, ${shape} ${bp.roof.material} roof, door to the ${bp.door}, ${extras.join(", ")}`;
}
