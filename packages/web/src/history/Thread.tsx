// The trail drawn across time and minds: one lane per person it passes through (the world last), time
// running left to right on a compressed scale so the same picture holds the last hour and the last
// thirty years. Shapes say what kind of thing each cause is; the thread being walked is numbered to
// match the list under it.

import { useMemo, useState, type ReactNode } from "react";
import { whenText, yearMinutes, type Calendar, type NodeKind } from "@psyche/engine";
import type { Why } from "./api";
import { agentColor, BACKSTORY_YEAR, clean, KIND, linksOf, useWidth, type FlatNode } from "./shared";

type Shape = "choice" | "moment" | "memory" | "belief" | "core" | "feeling" | "standing" | "word" | "world";

const SHAPE: Record<NodeKind, Shape> = {
  decision: "choice",
  percept: "moment",
  episode: "memory",
  belief: "belief",
  schema: "core",
  emotion: "feeling",
  relation: "standing",
  goal: "standing",
  need: "standing",
  norm: "standing",
  upbringing: "standing",
  utterance: "word",
  act: "word",
  event: "world",
  conversation: "world",
  outside: "world",
  edit: "world",
  sleep: "world",
};

const SHAPES: [Shape, string][] = [
  ["choice", "choice"],
  ["moment", "what happened"],
  ["memory", "memory"],
  ["belief", "belief"],
  ["core", "core belief"],
  ["feeling", "feeling"],
  ["standing", "trust, goal, need"],
  ["word", "said or did"],
  ["world", "the world"],
];

function Glyph({ shape, fill, r = 6 }: { shape: Shape; fill: string; r?: number }): ReactNode {
  const ring = { stroke: "var(--hx-surface)", strokeWidth: 2, paintOrder: "stroke" as const };
  switch (shape) {
    case "choice":
      return <path d={`M0,${-r - 1.5} L${r + 1.5},0 L0,${r + 1.5} L${-r - 1.5},0Z`} fill={fill} {...ring} />;
    case "moment":
      return <circle r={r * 0.6} fill={fill} {...ring} />;
    case "memory":
      return <circle r={r} fill={fill} {...ring} />;
    case "belief":
      return <rect x={-r + 0.5} y={-r + 0.5} width={r * 2 - 1} height={r * 2 - 1} rx={2} fill="var(--hx-surface)" stroke={fill} strokeWidth={2} />;
    case "core":
      return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={1.5} fill={fill} {...ring} />;
    case "feeling":
      return <path d={`M0,${-r - 1} L${r + 1},${r - 0.5} L${-r - 1},${r - 0.5}Z`} fill={fill} {...ring} />;
    case "standing":
      return <circle r={r - 1} fill="var(--hx-surface)" stroke={fill} strokeWidth={2} />;
    case "word":
      return <rect x={-r - 1} y={-r / 2} width={r * 2 + 2} height={r} rx={r / 2} fill={fill} {...ring} />;
    case "world": {
      const a = r + 0.5;
      const h = a * 0.866;
      return <path d={`M${-a},0 L${-a / 2},${-h} L${a / 2},${-h} L${a},0 L${a / 2},${h} L${-a / 2},${h}Z`} fill={fill} {...ring} />;
    }
  }
}

interface Placed extends FlatNode {
  x: number;
  y: number;
  lane: number;
  step?: number;
}

const ROW = 22;
const LANE_HEAD = 16;
const LANE_FOOT = 10;
const AXIS = 26;
const MAX_LANES = 7;
const MAX_ROWS = 9;

export function Thread({ why, flat, cal, names, sel, order, onSel }: { why: Why; flat: FlatNode[]; cal: Calendar; names: Record<string, string>; sel: string; order: string[]; onSel: (id: string) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string>();
  const W = Math.max(320, width);
  const narrow = W < 620;

  const layout = useMemo(() => {
    const root = flat[0]!;
    const Y = yearMinutes(cal);
    // One scale for both sides of the story's start: a year before it is as long as a year in it.
    const m = (t: number) => (t < 0 && Y ? t * (Y / BACKSTORY_YEAR) : t);
    const dated = flat.filter((f) => Number.isFinite(f.node.tick));
    const T0 = dated.length ? Math.max(...dated.map((f) => m(f.node.tick))) : 0;
    const L = (minutes: number) => Math.log1p(Math.max(0, minutes) / 30);
    const maxL = Math.max(L(240), ...dated.map((f) => L(T0 - m(f.node.tick))));
    // Names sit in a gutter on the left, clear of the oldest causes.
    const gutter = narrow ? 76 : 104;
    const x0 = gutter + 12;
    const x1 = W - 22;
    const gap = narrow ? 20 : 28;

    // Lanes: whose mind each thing lives in. The one being explained first, the world last.
    const stepOf = new Map(order.map((id, i) => [id, i + 1]));
    const agents: string[] = [];
    for (const f of flat) if (f.node.agent && !agents.includes(f.node.agent)) agents.push(f.node.agent);
    const own = agents.slice(0, MAX_LANES);
    const others = agents.length > own.length;
    const world = flat.some((f) => !f.node.agent);
    const lanes: { key: string; label: string; color: string }[] = own.map((a) => ({ key: a, label: names[a] ?? (a === "visitor" ? "a stranger" : a), color: agentColor(a) }));
    if (others) lanes.push({ key: "+", label: `${agents.length - own.length} others`, color: "var(--hx-muted)" });
    if (world) lanes.push({ key: "", label: "the world", color: "var(--hx-muted)" });
    const laneOf = (a?: string) => {
      if (!a) return lanes.length - 1;
      const i = own.indexOf(a);
      return i >= 0 ? i : own.length;
    };

    // Across: by time, but a cause always sits left of what it led to.
    const xs = new Map<string, number>([[root.node.id, x1]]);
    for (const f of flat.slice(1)) {
      const byTime = Number.isFinite(f.node.tick) ? x1 - (L(T0 - m(f.node.tick)) / maxL) * (x1 - x0) : Infinity;
      const effect = f.effect ? (xs.get(f.effect.id) ?? x1) : x1;
      xs.set(f.node.id, Math.min(byTime, effect - gap));
    }
    const least = Math.min(...xs.values());
    const k = least < x0 ? (x1 - x0) / (x1 - least) : 1;
    const X = (id: string) => x1 - (x1 - (xs.get(id) ?? x1)) * k;

    // Down: a row within the lane, the walked thread first so it runs along the top.
    const rows: number[][][] = lanes.map(() => []);
    const placed = new Map<string, Placed>();
    const turn = [...flat].sort((a, b) => Number(stepOf.has(b.node.id)) - Number(stepOf.has(a.node.id)) || b.share - a.share);
    const rowOf = new Map<string, number>();
    for (const f of turn) {
      const lane = laneOf(f.node.agent);
      const x = X(f.node.id);
      const taken = rows[lane]!;
      let r = taken.findIndex((row) => row.every((v) => Math.abs(v - x) >= 17));
      if (r < 0) {
        if (taken.length < MAX_ROWS) r = taken.push([]) - 1;
        else r = taken.reduce((best, row, i) => (row.filter((v) => Math.abs(v - x) < 17).length < taken[best]!.filter((v) => Math.abs(v - x) < 17).length ? i : best), 0);
      }
      taken[r]!.push(x);
      rowOf.set(f.node.id, r);
    }
    const tops: number[] = [];
    let y = 4;
    lanes.forEach((_, i) => {
      tops.push(y);
      y += LANE_HEAD + Math.max(1, rows[i]!.length) * ROW + LANE_FOOT;
    });
    for (const f of flat) {
      const lane = laneOf(f.node.agent);
      placed.set(f.node.id, { ...f, lane, x: X(f.node.id), y: tops[lane]! + LANE_HEAD + (rowOf.get(f.node.id) ?? 0) * ROW + ROW / 2, step: stepOf.get(f.node.id) });
    }

    // The time axis, in words.
    const season = Y ? Y / 4 : undefined;
    const marks: [number, string][] = Y
      ? [[60, "an hour before"], [1440, "a day"], [season!, "a season"], [Y, "a year"], [5 * Y, "5 years"], [20 * Y, "20 years"], [50 * Y, "50 years"]]
      : [[60, "an hour before"], [1440, "a day"], [10 * 1440, "10 days"], [100 * 1440, "100 days"], [BACKSTORY_YEAR, "a year"], [10 * BACKSTORY_YEAR, "10 years"], [40 * BACKSTORY_YEAR, "40 years"]];
    const ticks: { x: number; label: string }[] = [];
    let last = x1;
    for (const [minutes, label] of marks) {
      if (L(minutes) > maxL) break;
      const x = x1 - (L(minutes) / maxL) * (x1 - x0) * k;
      if (last - x < (narrow ? 58 : 74)) continue;
      ticks.push({ x, label });
      last = x;
    }
    return { placed, lanes, tops, height: y + AXIS, x0, x1, gutter, ticks, laneHeights: lanes.map((_, i) => LANE_HEAD + Math.max(1, rows[i]!.length) * ROW + LANE_FOOT) };
  }, [flat, cal, names, order, W, narrow]);

  const links = useMemo(() => linksOf(why.tree), [why]);
  const walked = useMemo(() => new Set(order.slice(1).map((id, i) => `${id}>${order[i]}`)), [order]);
  const { placed, lanes, tops, height, x1, gutter, ticks, laneHeights } = layout;
  const fit = (label: string) => (label.length > (narrow ? 9 : 13) ? `${label.slice(0, narrow ? 8 : 12)}…` : label);
  const tip = hover ? placed.get(hover) : undefined;
  const standing = why.node.kind === "schema" || why.node.kind === "belief";

  return (
    <figure className="hx-thread">
      <div className="hx-thread-scroll" ref={ref}>
        <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="group" aria-label={`The trail behind this, across ${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"}: ${flat.length} things, time running left to right`}>
          {lanes.map((l, i) => (
            <g key={l.key}>
              <rect x={0} y={tops[i]} width={W} height={laneHeights[i]! - 2} rx={6} className={`hx-lane${i % 2 ? " alt" : ""}`} />
              <rect x={0} y={tops[i]} width={gutter} height={laneHeights[i]! - 2} rx={6} className="hx-lane-gutter" />
              <circle cx={12} cy={tops[i]! + LANE_HEAD + ROW / 2} r={4} fill={l.color} />
              <text x={22} y={tops[i]! + LANE_HEAD + ROW / 2 + 4} className="hx-lane-name">{fit(l.label)}</text>
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t.label}>
              <line x1={t.x} x2={t.x} y1={4} y2={height - AXIS + 4} className="hx-grid" />
              <text x={t.x} y={height - 8} textAnchor="middle" className="hx-axis">{t.label}</text>
            </g>
          ))}
          <text x={x1} y={height - 8} textAnchor="end" className="hx-axis strong">{standing ? "latest" : "the moment"}</text>

          {[...links].sort((a, b) => Number(walked.has(`${a.from}>${a.to}`)) - Number(walked.has(`${b.from}>${b.to}`))).map((e, i) => {
            const a = placed.get(e.from);
            const b = placed.get(e.to);
            if (!a || !b) return null;
            const on = walked.has(`${e.from}>${e.to}`);
            const lit = hover === e.from || hover === e.to;
            const dx = Math.max(10, Math.abs(b.x - a.x) / 2);
            return (
              <path
                key={i}
                d={`M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`}
                className={`hx-edge${on ? " on" : ""}${lit ? " lit" : ""}`}
                strokeWidth={Math.min(4.5, 0.8 + 3.4 * Math.sqrt(e.share)) + (on ? 0.6 : 0)}
                opacity={on || lit ? 1 : 0.16 + 0.5 * Math.sqrt(e.share)}
              />
            );
          })}

          {[...placed.values()].sort((a, b) => Number(!!a.step) - Number(!!b.step)).map((p) => {
            const n = p.node;
            const isRoot = n.id === why.node.id;
            const who = n.agent ? (names[n.agent] ?? n.agent) : "the world";
            const pick = () => onSel(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className={`hx-node${p.step ? " on" : ""}${sel === n.id ? " sel" : ""}`}
                tabIndex={0}
                role="button"
                aria-label={`${KIND[n.kind]}, ${who}, ${whenText(cal, n.tick)}: ${clean(n.label)}`}
                aria-pressed={sel === n.id}
                onClick={pick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick();
                  }
                }}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? undefined : h))}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover((h) => (h === n.id ? undefined : h))}
              >
                <circle r={13} fill="transparent" />
                {sel === n.id && <circle r={11.5} className="hx-halo" />}
                <Glyph shape={SHAPE[n.kind]} fill={isRoot ? "var(--hx-accent)" : agentColor(n.agent)} r={p.step || isRoot ? 6.5 : 5.5} />
                {p.step && <text y={-11} textAnchor="middle" className="hx-step-n">{p.step}</text>}
              </g>
            );
          })}
        </svg>
        {tip && (
          <div className="hx-tip" role="status" style={{ ...(tip.x > W * 0.6 ? { right: W - tip.x + 14 } : { left: tip.x + 14 }), ...(tip.y > height * 0.55 ? { bottom: height - tip.y + 12 } : { top: tip.y + 12 }) }}>
            <small>
              {KIND[tip.node.kind]} · {tip.node.agent ? (names[tip.node.agent] ?? tip.node.agent) : "the world"} · {whenText(cal, tip.node.tick)}
            </small>
            <span>{clean(tip.node.label)}</span>
            {tip.via && <small>{tip.via.mechanism} · about {Math.max(1, Math.round(tip.share * 100))}% of this</small>}
          </div>
        )}
      </div>
      <figcaption className="hx-shapes">
        {SHAPES.filter(([s]) => flat.some((f) => SHAPE[f.node.kind] === s)).map(([s, label]) => (
          <span key={s}>
            <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true"><Glyph shape={s} fill={s === "choice" ? "var(--hx-accent)" : "var(--hx-ink2)"} r={5.5} /></svg>
            {label}
          </span>
        ))}
        <span className="hx-shapes-note">Numbers follow the walk below. Thicker lines carry more of the weight.</span>
      </figcaption>
    </figure>
  );
}
