// The whole run on one line: how many choices were kept each season, by kind, with what the chronicle
// recorded above them. Drag anywhere to move the playhead. When a trail is open, its causes sit on a
// line across the top with arcs joining each to what it led to, so you can see how far back it reaches.

import { useMemo, useRef, useState } from "react";
import { whenText, yearAt, type Mark } from "@psyche/engine";
import type { Overview, Why } from "./api";
import { agentColor, BACKSTORY_YEAR, clean, groupIndex, GROUPS, KIND, linksOf, tickOf, useWidth, type FlatNode } from "./shared";

const H = 156;
const TRAIL = 40; // the line the open trail sits on
const MARKS = 52; // chronicle marks
const TOP = 60; // top of the bars
const BASE = H - 20;

/** Chronicle marks worth a dot on the timeline (births, deaths and trade would bury the rest). */
const QUIET = new Set(["trade", "birth", "death", "money"]);

export function Timeline({ ov, moments, at, onAt, why, flat, sel, names }: { ov: Overview; moments: Overview["moments"]; at: number; onAt: (t: number) => void; why?: Why; flat: FlatNode[]; sel?: string; names: Record<string, string> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const drag = useRef(false);
  const W = Math.max(300, width);
  const cal = ov.calendar;
  const pre = W < 560 ? 30 : 54;
  const x0 = 8 + pre;
  const x1 = W - 12;
  const span = Math.max(ov.to, 1);
  const X = (t: number) => x0 + (Math.max(0, Math.min(span, t)) / span) * (x1 - x0);
  // Before the story: squeezed into a short stretch on the left, sixty years deep.
  const unit = ov.year ? BACKSTORY_YEAR : 1440;
  const preX = (t: number) => 8 + (pre - 6) * (1 - Math.min(1, Math.log1p(-t / unit) / Math.log1p(60)));
  const xOf = (t: number) => (t < 0 ? preX(t) : X(t));

  const bin = useMemo(() => {
    const most = Math.max(6, Math.floor((x1 - x0) / 4));
    const sizes = ov.year ? [ov.year / 4, ov.year, ov.year * 2, ov.year * 5, ov.year * 10, ov.year * 25] : [60, 180, 360, 720, 1440, 2880, 7200, 14400, 43200, 129600];
    return sizes.find((s) => span / s <= most) ?? sizes[sizes.length - 1]!;
  }, [ov.year, span, x0, x1]);

  const { counts, peak, marks } = useMemo(() => {
    const n = Math.max(1, Math.ceil(span / bin));
    const counts = Array.from({ length: n }, () => new Array<number>(GROUPS.length).fill(0));
    const at = (t: number) => Math.min(n - 1, Math.max(0, Math.floor(t / bin)));
    for (const m of moments) counts[at(m[1])]![groupIndex(m[3])]!++;
    const marks: Mark[][] = Array.from({ length: n }, () => []);
    for (const m of ov.marks) if (!QUIET.has(m.kind) && m.tick >= 0) marks[at(m.tick)]!.push(m);
    return { counts, peak: Math.max(1, ...counts.map((c) => c.reduce((a, b) => a + b, 0))), marks };
  }, [moments, ov.marks, bin, span]);

  const binW = ((x1 - x0) * bin) / span;
  const gap = binW >= 9 ? 2 : binW >= 3 ? 1 : 0;
  const tickAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(ov.to, ((clientX - box.left - x0) / (x1 - x0)) * span)));
  };

  // Year labels, spaced so they never touch.
  const labels = useMemo(() => {
    const out: { x: number; text: string }[] = [];
    if (ov.year) {
      const years = Math.ceil(span / ov.year);
      const step = [1, 2, 5, 10, 20, 50, 100].find((s) => ((x1 - x0) / years) * s >= 58) ?? 100;
      for (let y = 1; y <= years; y += y === 1 && step > 1 ? step - 1 : step) out.push({ x: X((y - 1) * ov.year), text: `year ${y}` });
    } else {
      const days = Math.ceil(span / 1440);
      const step = [1, 2, 5, 10, 20, 50, 100].find((s) => ((x1 - x0) / days) * s >= 52) ?? 100;
      for (let d = 1; d <= days; d += d === 1 && step > 1 ? step - 1 : step) out.push({ x: X((d - 1) * 1440), text: `day ${d}` });
    }
    return out.filter((l) => l.x <= x1 - 40);
  }, [ov.year, span, x0, x1]);

  // Towns founded along the way get a flag with a name; the labels are dropped where they would collide.
  const flags = useMemo(() => {
    const out: { x: number; name: string }[] = [];
    let last = -Infinity;
    for (const m of ov.marks) {
      if (m.kind !== "founding" || m.tick <= 0) continue;
      const x = X(m.tick);
      const name = ov.towns.find((t) => t.id === m.town)?.name;
      if (!name) continue;
      out.push({ x, name: x - last >= 78 ? name : "" });
      if (x - last >= 78) last = x;
    }
    return out;
  }, [ov.marks, ov.towns, span, x0, x1]);

  const trail = useMemo(() => {
    if (!why) return undefined;
    const pos = new Map<string, number>();
    for (const f of flat) {
      const t = tickOf(f.node.tick);
      if (t !== null) pos.set(f.node.id, xOf(t));
    }
    // A belief sits where the latest thing behind it does: it is the sum of them, not a date.
    const rootX = why.node.kind === "decision" ? pos.get(why.node.id) : Math.max(...pos.values());
    if (rootX !== undefined && Number.isFinite(rootX)) pos.set(why.node.id, rootX);
    const arcs = linksOf(why.tree)
      .map((l) => ({ a: pos.get(l.from), b: pos.get(l.to), share: l.share }))
      .filter((l): l is { a: number; b: number; share: number } => l.a !== undefined && l.b !== undefined && Math.abs(l.a - l.b) > 5);
    return { pos, arcs };
  }, [why, flat, span, x0, x1, pre]);

  const shapedPeak = Math.max(1, ...(why?.reach.byYear.map((y) => y.choices) ?? []));
  const season = ov.year ? ov.year / 4 : 360;
  const lo = Math.floor(at / season) * season;
  const px = X(at);
  const head = whenText(cal, at);
  const headW = head.length * 6.4 + 14;
  const headX = Math.max(headW / 2 + 2, Math.min(W - headW / 2 - 2, px));
  const hb = hover !== undefined ? counts[hover] : undefined;
  const hx = hover !== undefined ? X((hover + 0.5) * bin) : 0;
  const binName = (i: number) => (ov.year && bin >= ov.year ? (bin === ov.year ? `year ${yearAt(cal, i * bin)}` : `years ${yearAt(cal, i * bin)} to ${yearAt(cal, (i + 1) * bin - 1)}`) : whenText(cal, i * bin));

  return (
    <div
      className="hx-tl"
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Moment in time"
      aria-valuemin={0}
      aria-valuemax={ov.to}
      aria-valuenow={Math.round(at)}
      aria-valuetext={head}
      onPointerDown={(e) => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onAt(tickAt(e.clientX));
      }}
      onPointerMove={(e) => {
        const t = tickAt(e.clientX);
        if (drag.current) onAt(t);
        const box = e.currentTarget.getBoundingClientRect();
        setHover(e.clientX - box.left < x0 - 2 ? undefined : Math.min(counts.length - 1, Math.floor(t / bin)));
      }}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
      onPointerLeave={() => !drag.current && setHover(undefined)}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <rect x={8} y={TOP - 14} width={pre - 6} height={BASE - TOP + 14} rx={4} className="hx-pre" />
        <text x={8 + (pre - 6) / 2} y={H - 6} textAnchor="middle" className="hx-axis">before</text>
        <line x1={x0} x2={x1} y1={BASE + 0.5} y2={BASE + 0.5} className="hx-base" />
        {labels.map((l) => (
          <g key={l.text}>
            <line x1={l.x} x2={l.x} y1={BASE} y2={BASE + 4} className="hx-base" />
            <text x={l.x + 3} y={H - 6} className="hx-axis">{l.text}</text>
          </g>
        ))}
        <rect x={X(lo)} y={TOP - 14} width={Math.max(2, X(lo + season) - X(lo))} height={BASE - TOP + 14} className="hx-here" />
        {hover !== undefined && <rect x={X(hover * bin)} y={TOP - 14} width={Math.max(1, binW)} height={BASE - TOP + 14} className="hx-hover" />}

        {counts.map((c, i) => {
          let y = BASE;
          const x = X(i * bin);
          const w = Math.max(1, binW - gap);
          return c.map((v, g) => {
            if (!v) return null;
            const h = (v / peak) * (BASE - TOP);
            y -= h;
            return <rect key={`${i}.${g}`} x={x} y={y} width={w} height={Math.max(0.75, h - (h > 4 ? 1 : 0))} rx={w >= 4 && h >= 4 ? 1.5 : 0} fill={GROUPS[g]!.color} />;
          });
        })}

        {marks.map((ms, i) => ms.length > 0 && <circle key={i} cx={X((i + 0.5) * bin)} cy={MARKS} r={Math.min(3, 1.4 + ms.length * 0.25)} className="hx-markdot" />)}
        {flags.map((f, i) => (
          <g key={i} transform={`translate(${f.x},${MARKS})`}>
            <path d="M0,5 L0,-7 L7,-4 L0,-1" className="hx-flag" />
            {f.name && <text x={10} y={-1} className="hx-axis strong">{f.name}</text>}
          </g>
        ))}

        {trail && (
          <g>
            <line x1={8} x2={x1} y1={TRAIL} y2={TRAIL} className="hx-trail-line" />
            {ov.year !== undefined && why!.reach.byYear.map((y) => (
              <rect key={y.year} x={X((y.year - 1) * ov.year!)} y={TRAIL + 5} width={Math.max(1.5, X(y.year * ov.year!) - X((y.year - 1) * ov.year!) - 1)} height={4} rx={1} className="hx-shaped-year" opacity={0.25 + 0.75 * (y.choices / shapedPeak)}>
                <title>{`Year ${y.year}: shaped ${y.choices} ${y.choices === 1 ? "choice" : "choices"}`}</title>
              </rect>
            ))}
            {trail.arcs.map((l, i) => (
              <path key={i} d={`M${l.a},${TRAIL} Q${(l.a + l.b) / 2},${TRAIL - Math.min(30, 7 + Math.abs(l.b - l.a) * 0.22)} ${l.b},${TRAIL}`} className="hx-arc" strokeWidth={Math.min(3.5, 0.8 + 3 * Math.sqrt(l.share))} opacity={0.3 + 0.6 * Math.sqrt(l.share)} />
            ))}
            {flat.map((f) => {
              const x = trail.pos.get(f.node.id);
              if (x === undefined || f.node.id === why!.node.id) return null;
              return <circle key={f.node.id} cx={x} cy={TRAIL} r={sel === f.node.id ? 4.5 : 3} fill={agentColor(f.node.agent)} className={`hx-trail-dot${sel === f.node.id ? " sel" : ""}`} />;
            })}
            {trail.pos.has(why!.node.id) && <path transform={`translate(${trail.pos.get(why!.node.id)},${TRAIL})`} d="M0,-7 L7,0 L0,7 L-7,0Z" className="hx-trail-root" />}
          </g>
        )}

        <line x1={px} x2={px} y1={16} y2={BASE + 4} className="hx-playhead" />
        <rect x={headX - headW / 2} y={1} width={headW} height={16} rx={8} className="hx-head" />
        <text x={headX} y={12.5} textAnchor="middle" className="hx-head-text">{head}</text>
      </svg>
      {hb && hover !== undefined && (
        <div className="hx-tip" style={{ top: TOP - 8, ...(hx > W * 0.62 ? { right: W - hx + Math.max(8, binW / 2 + 6) } : { left: hx + Math.max(8, binW / 2 + 6) }) }}>
          <small>{binName(hover)} · {hb.reduce((a, b) => a + b, 0)} choices kept</small>
          {GROUPS.map((g, i) => hb[i]! > 0 && (
            <span key={g.id} className="hx-tip-row"><i style={{ background: g.color }} />{g.label}<b>{hb[i]}</b></span>
          ))}
          {marks[hover]!.slice(0, 2).map((m) => <span key={m.id} className="hx-tip-mark">{m.text}</span>)}
          {marks[hover]!.length > 2 && <small>and {marks[hover]!.length - 2} more in the chronicle</small>}
        </div>
      )}
      {why && trail && (
        <p className="hx-tl-note">
          <i /> {KIND[why.node.kind]}: {clean(why.moment?.choice ?? why.node.label).slice(0, 80)}
          {why.node.agent ? ` (${names[why.node.agent] ?? why.node.agent})` : ""}. Dots on the top line are what lay behind it; arcs join each to what it led to.{why.reach.total > 0 && ov.year ? " The strip under the line marks the years it went on to shape choices." : ""}
        </p>
      )}
    </div>
  );
}
