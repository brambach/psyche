// The coast from above: each town where it was founded, a house for every household that has one
// and a tent for each that hasn't, the boat that carried a group away to found a town, trade runs
// along the shore, the towns that refuse each other, and the ones going hungry. Drawn on a canvas so
// a century can play back smoothly. Used by the app's Map tab and by the published century page.

import type { Timeline } from "@psyche/engine";

export interface CoastColors {
  sea: string;
  seaDeep: string;
  land: string;
  landDark: string;
  ink: string;
  muted: string;
  house: string;
  roof: string;
  tent: string;
  trade: string;
  quarrel: string;
  hunger: string;
}

type Site = { along: number; inland: number };

/** A small deterministic hash, so the coast and each town's lanes look the same every frame. */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** The shoreline's height at x (0 to 1 across), as a share of the canvas height. */
function shore(x: number, seed: number): number {
  let y = 0.74;
  for (let k = 1; k <= 4; k++) y += (Math.sin(x * Math.PI * (k * 2 + 1) + hash(seed * 7 + k) * 6.28) * 0.05) / k;
  return y;
}

/** Where a town sits on the canvas. */
function place(site: Site | undefined, w: number, h: number, seed: number): { x: number; y: number } {
  const s = site ?? { along: 0.5, inland: 0.15 };
  const x = s.along;
  return { x: x * w, y: (shore(x, seed) - 0.07 - s.inland * 0.6) * h };
}

/** Slots spiralling out from a town's centre: slot k is always in the same place, so a town grows outward. */
function slot(k: number, id: number): { dx: number; dy: number } {
  const a = k * 2.399963 + hash(id) * 6.28;
  const r = 5.2 * Math.sqrt(k + 0.6);
  return { dx: Math.cos(a) * r * 1.25, dy: Math.sin(a) * r * 0.8 };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Draw the coast at a (fractional) year: towns fade in, houses and tents fill in as the year turns. */
export function drawCoast(ctx: CanvasRenderingContext2D, w: number, h: number, t: Timeline, year: number, c: CoastColors, seed = 11): void {
  const yi = Math.max(0, Math.min(t.years.length - 1, Math.floor(year) - 1));
  const frac = Math.max(0, Math.min(1, year - Math.floor(year)));
  const next = Math.min(t.years.length - 1, yi + 1);

  // Sea, then land above the shore.
  ctx.fillStyle = c.sea;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, c.sea);
  g.addColorStop(1, c.seaDeep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 0; i <= 120; i++) ctx.lineTo((i / 120) * w, shore(i / 120, seed) * h);
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fillStyle = c.land;
  ctx.fill();
  // Woods and fields: a texture of dots that never moves.
  ctx.fillStyle = c.landDark;
  for (let i = 0; i < 520; i++) {
    const x = hash(i * 3 + seed) * w;
    const y = hash(i * 5 + 1 + seed) * shore(x / w, seed) * h * 0.95;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + hash(i * 11) * 1.4, 0, 6.28);
    ctx.fill();
  }
  // Surf along the shore.
  ctx.strokeStyle = c.muted;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) ctx[i ? "lineTo" : "moveTo"]((i / 120) * w, shore(i / 120, seed) * h + 4);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const at = new Map(t.towns.map((x, i) => [x.id, { ...place(x.site, w, h, seed), i }]));
  const alive = (x: Timeline["towns"][number], i: number) => x.people[i] !== null && x.people[i] !== undefined;

  // Trade runs this year: an arc out over the water, heavier with more runs.
  const year1 = yi + 1;
  for (const r of t.routes) {
    const n = r.years[year1] ?? 0;
    if (!n) continue;
    const a = at.get(r.from);
    const b = at.get(r.to);
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2;
    const my = Math.max(a.y, b.y) + 30 + Math.abs(a.x - b.x) * 0.15;
    ctx.strokeStyle = c.trade;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.min(4, 0.8 + n * 0.6);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx, my, b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  // Towns that refuse each other: a broken red line between them.
  for (const s of t.shunned.filter((x) => x.year === year1)) {
    const a = at.get(s.town);
    for (const o of s.refuses) {
      const b = at.get(o);
      if (!a || !b) continue;
      ctx.strokeStyle = c.quarrel;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.beginPath();
      ctx.moveTo(mx - 5, my - 5);
      ctx.lineTo(mx + 5, my + 5);
      ctx.moveTo(mx + 5, my - 5);
      ctx.lineTo(mx - 5, my + 5);
      ctx.stroke();
    }
  }
  // A group setting out to found a town: the boat crosses during the year it was founded.
  for (const e of t.events.filter((x) => x.kind === "founding" && x.year === year1)) {
    const town = t.towns.find((x) => x.id === e.town);
    const from = town?.from ? at.get(town.from) : undefined;
    const to = town ? at.get(town.id) : undefined;
    if (!from || !to) continue;
    const mx = (from.x + to.x) / 2;
    const my = Math.max(from.y, to.y) + 50;
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(mx, my, to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const p = Math.min(1, frac * 1.4);
    const bx = (1 - p) ** 2 * from.x + 2 * (1 - p) * p * mx + p ** 2 * to.x;
    const by = (1 - p) ** 2 * from.y + 2 * (1 - p) * p * my + p ** 2 * to.y;
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(bx - 7, by);
    ctx.lineTo(bx + 7, by);
    ctx.lineTo(bx + 4, by + 4);
    ctx.lineTo(bx - 4, by + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(bx - 0.5, by - 9, 1.2, 9);
    ctx.beginPath();
    ctx.moveTo(bx + 1, by - 9);
    ctx.lineTo(bx + 6, by - 2);
    ctx.lineTo(bx + 1, by - 2);
    ctx.fill();
  }

  // Towns: houses and tents in their slots, hunger as a glow, then each town's name and head count.
  const labels: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const hits = (b: { x0: number; x1: number; y0: number; y1: number }) => labels.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  const hungry = new Set(t.events.filter((e) => e.kind === "hunger" && e.year === year1).map((e) => e.town));
  const discs: { x: number; y: number; r: number; label: string }[] = [];
  t.towns.forEach((town, idx) => {
    if (!alive(town, yi)) return;
    const p = at.get(town.id)!;
    const houses = Math.round(lerp(town.houses[yi] ?? 0, town.houses[next] ?? town.houses[yi] ?? 0, frac));
    const tents = Math.round(lerp(town.tents[yi] ?? 0, town.tents[next] ?? town.tents[yi] ?? 0, frac));
    const people = Math.round(lerp(town.people[yi] ?? 0, town.people[next] ?? town.people[yi] ?? 0, frac));
    const n = houses + tents;
    if (hungry.has(town.id)) {
      const r = 14 + Math.sqrt(n) * 7;
      const glow = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, r);
      glow.addColorStop(0, c.hunger);
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 6.28);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (let k = 0; k < n; k++) {
      const s = slot(k, idx + 1);
      const x = p.x + s.dx;
      const y = p.y + s.dy;
      if (k < houses) {
        ctx.fillStyle = c.house;
        ctx.fillRect(x - 3, y - 1, 6, 4.5);
        ctx.strokeStyle = c.tent;
        ctx.lineWidth = 0.6;
        ctx.strokeRect(x - 3, y - 1, 6, 4.5);
        ctx.fillStyle = c.roof;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 0.5);
        ctx.lineTo(x, y - 4.5);
        ctx.lineTo(x + 4, y - 0.5);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = c.tent;
        ctx.beginPath();
        ctx.moveTo(x - 3.5, y + 3);
        ctx.lineTo(x, y - 3);
        ctx.lineTo(x + 3.5, y + 3);
        ctx.closePath();
        ctx.fill();
      }
    }
    discs.push({ x: p.x, y: p.y, r: 6 + Math.sqrt(n) * 6.5, label: `${town.name} · ${people}` });
  });
  // Names last, each where it covers no town and no other name: above, below, right, then left.
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const overlaps = (b: Box, d: { x: number; y: number; r: number }) => {
    const cx = Math.max(b.x0, Math.min(d.x, b.x1));
    const cy = Math.max(b.y0, Math.min(d.y, b.y1));
    return Math.hypot(cx - d.x, cy - d.y) < d.r;
  };
  for (const d of discs) {
    const tw = ctx.measureText(d.label).width;
    const at = (x0: number, yb: number): Box => ({ x0, x1: x0 + tw, y0: yb - 11, y1: yb + 3 });
    const tries = [at(d.x - tw / 2, d.y - d.r - 4), at(d.x - tw / 2, d.y + d.r + 13), at(d.x + d.r + 4, d.y + 4), at(d.x - d.r - 4 - tw, d.y + 4)];
    const box = tries.find((b) => b.x0 > 2 && b.x1 < w - 2 && b.y0 > 2 && !hits(b) && discs.every((o) => o === d || !overlaps(b, o))) ?? tries.find((b) => !hits(b)) ?? tries[0]!;
    labels.push(box);
    ctx.fillStyle = c.land;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(box.x0 - 3, box.y0 - 1, tw + 6, 15);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    ctx.fillText(d.label, box.x0, box.y1 - 3);
  }
}

/** Read the map's colours from CSS custom properties on an element, so it follows the page's theme. */
export function coastColors(el: Element, names: Partial<Record<keyof CoastColors, string>> = {}): CoastColors {
  const cs = getComputedStyle(el);
  const v = (k: keyof CoastColors, fallback: string) => cs.getPropertyValue(names[k] ?? `--map-${k}`).trim() || fallback;
  return {
    sea: v("sea", "#bcd4dc"),
    seaDeep: v("seaDeep", "#8fb3c1"),
    land: v("land", "#dfe3d2"),
    landDark: v("landDark", "#c4cbb2"),
    ink: v("ink", "#15211f"),
    muted: v("muted", "#566661"),
    house: v("house", "#efe7d6"),
    roof: v("roof", "#8a4b2b"),
    tent: v("tent", "#7a6f5a"),
    trade: v("trade", "#1d5f73"),
    quarrel: v("quarrel", "#b23a2a"),
    hunger: v("hunger", "#d9822b"),
  };
}
