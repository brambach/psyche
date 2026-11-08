import { useEffect, useRef, useState } from "react";
import type { MythComparison, RegionView, Timeline } from "@psyche/engine";
import { api } from "./api";
import { coastColors, drawCoast } from "./coastMap";

const KIND: Record<string, string> = { founding: "founding", leader: "leader", law: "law", death: "death", trade: "trade", quarrel: "quarrel", peace: "peace", hunger: "hunger", craft: "craft", lost: "lost" };

/** The towns side by side: how many, who leads, how they regard each other, and the chronicle. */
export function Towns({ r, current, onSwitch }: { r: RegionView; current?: string; onSwitch: (town: string) => void }) {
  const [kinds, setKinds] = useState<string>("all");
  const name = (id: string) => r.towns.find((t) => t.id === id)?.name ?? id;
  const shown = [...r.chronicle].reverse().filter((c) => kinds === "all" || (kinds === "big" ? c.kind !== "trade" && c.kind !== "leader" : c.kind === kinds));
  const years = [...new Set(shown.map((c) => c.year))];
  return (
    <div className="towns">
      <div className="town-cards">
        {r.towns.map((t) => (
          <button key={t.id} className={`pane town-card ${t.id === current ? "on" : ""}`} onClick={() => onSwitch(t.id)} aria-pressed={t.id === current}>
            <h3>{t.name} <span className={`chip ${t.tier === "live" ? "live" : ""}`} title={t.tier === "live" ? "Running hour by hour" : "Nobody is watching: running a season at a time on rules. Open it to bring it back."}>{t.tier === "live" ? "live" : "on rules"}</span></h3>
            <span className="value">{t.people}</span>
            <span className="small">{t.children} children{t.leaderName ? `, led by ${t.leaderName}` : ""}</span>
            <Spark values={t.history.map((h) => h.people)} />
            <span className="small">{t.from ? `Founded from ${name(t.from)}` : "The first town"}. Store {t.store}. {t.laws ? `${t.laws} law${t.laws > 1 ? "s" : ""}.` : "No laws yet."}</span>
            <span className="small">Knows {t.crafts.length ? t.crafts.join(", ") : "no crafts"}.{t.lost.length ? ` Lost ${t.lost.join(", ")}.` : ""}</span>
          </button>
        ))}
      </div>
      {r.regard.some((x) => x.value !== 0) && (
        <div className="pane">
          <h3>How the towns regard each other</h3>
          <ul className="regard">
            {r.regard.filter((x) => x.value !== 0).sort((a, b) => a.value - b.value).map((x) => (
              <li key={`${x.from}>${x.to}`}>
                <b>{name(x.from)}</b> toward <b>{name(x.to)}</b>
                <span className={`tone ${x.value > 0.05 ? "good" : x.value < -0.05 ? "bad" : ""}`}>{x.value > 0 ? "+" : ""}{x.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <p className="small">From what each town's adults believe about the other: a short-weighted trade becomes “folk from there will cheat you”, a peace gift softens it. Below -0.35, trade stops. Towns with no feelings either way are left out.</p>
        </div>
      )}
      <div className="pane">
        <h3>
          Chronicle
          <select aria-label="Show" value={kinds} onChange={(e) => setKinds(e.target.value)} style={{ marginLeft: 10 }}>
            <option value="all">everything</option>
            <option value="big">foundings, laws, quarrels, deaths</option>
            {Object.keys(KIND).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </h3>
        {shown.length === 0 && <p className="small">Nothing yet. Let some years pass.</p>}
        {years.map((y) => (
          <div key={y} className="chron-year">
            <h4>Year {y}</h4>
            <ul>
              {shown.filter((c) => c.year === y).map((c, i) => (
                <li key={i}>
                  <span className={`kind k-${c.kind}`}>{KIND[c.kind]}</span> {c.text}
                  {c.why && c.why.length > 0 && <Why why={c.why} />}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** What led to an event, link by link. */
export function Why({ why }: { why: NonNullable<RegionView["chronicle"][number]["why"]> }) {
  return (
    <details className="why-list">
      <summary>Why?</summary>
      <ol>{why.map((w, i) => <li key={i}>{w.text}</li>)}</ol>
    </details>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 24" aria-hidden="true" />;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - (v / max) * 20}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={`People over time, from ${values[0]} to ${values.at(-1)}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The crossing as each town tells it now, whose memory each version grew from, and where they part. */
export function Myths({ tick }: { tick: number }) {
  const [m, setM] = useState<MythComparison>();
  const day = Math.floor(tick / 1440);
  useEffect(() => {
    let live = true;
    api.myths().then((x) => live && setM(x), () => undefined);
    return () => {
      live = false;
    };
  }, [day]);
  if (!m) return <p className="empty">Gathering how each town tells it...</p>;
  return (
    <div className="myths">
      <p className="small">
        Every first night of summer, the eldest who carries it tells how it all began, and everyone who wasn't there keeps that telling. Each town hears it from a different mouth, so each comes to tell the crossing its own way. Every version is followed back, teller by teller, to the person who lived it.
      </p>
      {m.splits.length > 0 && (
        <div className="pane">
          <h3>Where the versions part</h3>
          <ul>
            {m.splits.map((s, i) => (
              <li key={i}><b>{m.towns.find((t) => t.town === s.a)?.name} and {m.towns.find((t) => t.town === s.b)?.name}.</b> {s.at}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="town-myths">
        {m.towns.map((t) => (
          <div className="pane" key={t.town}>
            <h3>{t.name} <span className="muted">· {t.holders} tell it, {t.firstHand} were there</span></h3>
            {t.versions.slice(0, 4).map((v, i) => (
              <div key={i} className={`myth ${i === 0 ? "dominant" : ""}`}>
                <p>“{v.text}” <span className="small">{v.holders.length} {v.holders.length === 1 ? "person tells" : "people tell"} it this way</span></p>
                {v.chain.length > 1 && (
                  <p className="small chain">
                    {v.chain.map((c, k) => (
                      <span key={k}>{k > 0 && " ← "}<b style={{ color: `var(--a-${c.agent})` }}>{c.name}</b></span>
                    ))}
                    {" "}(lived it)
                  </p>
                )}
              </div>
            ))}
            {t.versions.length === 0 && <p className="small">Nobody here tells it yet.</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The whole run at a glance: people in the region year by year, with each town as a small chart on
 * the same scale. Play it as a time-lapse, or pick a year to read what happened then and why.
 */
export function Century({ tick }: { tick: number }) {
  const [t, setT] = useState<Timeline>();
  const [year, setYear] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [digest, setDigest] = useState<string>();
  const day = Math.floor(tick / 1440);
  useEffect(() => {
    let live = true;
    api.timeline().then((x) => live && setT(x), () => undefined);
    return () => {
      live = false;
    };
  }, [day]);
  const last = t?.years.at(-1) ?? 1;
  // Playing moves a fractional year forward every frame, so the map can grow smoothly.
  const [yearF, setYearF] = useState<number>();
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      let done = false;
      setYearF((y) => {
        const n = (y ?? 1) + dt * 2.5;
        if (n >= last) done = true;
        return Math.min(n, last);
      });
      if (done) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, last]);
  useEffect(() => {
    if (yearF !== undefined) setYear(Math.floor(yearF));
  }, [yearF]);
  if (!t) return <p className="empty">Gathering the years...</p>;
  const at = year ?? last;
  const total = t.years.map((_, i) => t.towns.reduce((s, x) => s + (x.people[i] ?? 0), 0));
  const towns = t.years.map((_, i) => t.towns.filter((x) => x.people[i] !== null).length);
  const max = Math.max(...total, 1);
  const townMax = Math.max(...t.towns.flatMap((x) => x.people.map((p) => p ?? 0)), 1);
  const events = t.events.filter((e) => e.year === at && e.kind !== "death" && e.kind !== "leader");
  const name = (id?: string) => t.towns.find((x) => x.id === id)?.name ?? "";
  return (
    <div className="century">
      <div className="pane">
        <h3>
          People in the region, year by year
          <button className="btn" style={{ marginLeft: 12 }} onClick={() => { if (!playing) setYearF(at >= last ? 1 : at); setPlaying(!playing); }}>{playing ? "Pause" : "Play the years"}</button>
        </h3>
        <Coast t={t} year={playing && yearF !== undefined ? yearF : at} />
        <Line values={total} max={max} at={at} onPick={(y) => { setPlaying(false); setYear(y); }} label={(i) => `Year ${i + 1}: ${total[i]} people in ${towns[i]} ${towns[i] === 1 ? "town" : "towns"}`} />
        <p className="small">Year {at}: <b>{total[at - 1] ?? 0}</b> people in {towns[at - 1] ?? 0} {towns[at - 1] === 1 ? "town" : "towns"}. Towns nobody is watching run on rules, a season at a time, so a century costs nothing.</p>
      </div>
      <div className="pane">
        <h3>Year {at}</h3>
        {events.length === 0 && <p className="small">A quiet year: births, deaths, harvests.</p>}
        <ul className="chron-year">
          {events.map((e, i) => (
            <li key={i}>
              <span className={`kind k-${e.kind}`}>{KIND[e.kind] ?? e.kind}</span> <b>{name(e.town)}</b> {e.text}
              {e.why && e.why.length > 0 && <Why why={e.why} />}
            </li>
          ))}
        </ul>
      </div>
      <div className="town-multiples">
        {t.towns.map((x) => (
          <div className="pane" key={x.id}>
            <h4>{x.name} <span className="muted small">{x.people[at - 1] ?? "not yet founded"}</span></h4>
            <Line values={x.people.map((p) => p ?? 0)} max={townMax} at={at} onPick={setYear} small label={(i) => `${x.name}, year ${i + 1}: ${x.people[i] ?? "not founded"}`} />
          </div>
        ))}
      </div>
      <div className="pane">
        <h3>
          Digest
          <button className="btn" style={{ marginLeft: 12 }} onClick={() => api.digest(Math.max(1, at - 9)).then((d) => setDigest(d.text), () => undefined)}>Write up the ten years to year {at}</button>
        </h3>
        {digest ? <pre className="digest">{digest}</pre> : <p className="small">A plain-text account of a decade: who lives where, what happened and why, how each town tells the crossing.</p>}
      </div>
    </div>
  );
}

/** The coast from above at a (fractional) year. */
function Coast({ t, year }: { t: Timeline; year: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCoast(ctx, w, h, t, year, coastColors(cv));
  }, [t, year]);
  return <canvas ref={ref} className="coast" role="img" aria-label={`The coast in year ${Math.floor(year)}: ${t.towns.filter((x) => x.people[Math.floor(year) - 1] != null).length} towns`} />;
}

/** One series over the years, with a crosshair that follows the pointer and a marker on the picked year. */
function Line({ values, max, at, onPick, label, small }: { values: number[]; max: number; at: number; onPick: (y: number) => void; label: (i: number) => string; small?: boolean }) {
  const [hover, setHover] = useState<number>();
  const W = 600;
  const H = small ? 60 : 180;
  const pad = small ? 4 : 24;
  const x = (i: number) => (values.length < 2 ? 0 : (i / (values.length - 1)) * W);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const pick = (e: { clientX: number; currentTarget: SVGSVGElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - r.left) / r.width) * (values.length - 1))));
  };
  const show = hover ?? at - 1;
  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label(values.length - 1)} onPointerMove={(e) => setHover(pick(e))} onPointerLeave={() => setHover(undefined)} onClick={(e) => onPick(pick(e) + 1)}>
        {!small && [0.5, 1].map((f) => <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} className="grid" vectorEffect="non-scaling-stroke" />)}
        <polyline points={pts} fill="none" className="series" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <line x1={x(show)} x2={x(show)} y1={0} y2={H} className="cursor" vectorEffect="non-scaling-stroke" />
      </svg>
      {!small && <span className="axis-max small">{Math.round(max)} people</span>}
      {hover !== undefined && <span className="tip small" style={{ left: `${(x(hover) / W) * 100}%` }}>{label(hover)}</span>}
    </div>
  );
}
