import { useEffect, useState } from "react";
import type { MythComparison, RegionView } from "@psyche/engine";
import { api } from "./api";

const KIND: Record<string, string> = { founding: "founding", leader: "leader", law: "law", death: "death", trade: "trade", quarrel: "quarrel", peace: "peace", hunger: "hunger" };

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
            <h3>{t.name}</h3>
            <span className="value">{t.people}</span>
            <span className="small">{t.children} children{t.leaderName ? `, led by ${t.leaderName}` : ""}</span>
            <Spark values={t.history.map((h) => h.people)} />
            <span className="small">{t.from ? `Founded from ${name(t.from)}` : "The first town"}. Store {t.store}. {t.laws ? `${t.laws} law${t.laws > 1 ? "s" : ""}.` : "No laws yet."}</span>
          </button>
        ))}
      </div>
      {r.regard.length > 0 && (
        <div className="pane">
          <h3>How the towns regard each other</h3>
          <ul className="regard">
            {r.regard.map((x) => (
              <li key={`${x.from}>${x.to}`}>
                <b>{name(x.from)}</b> toward <b>{name(x.to)}</b>
                <span className={`tone ${x.value > 0.05 ? "good" : x.value < -0.05 ? "bad" : ""}`}>{x.value > 0 ? "+" : ""}{x.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <p className="small">From what each town's adults believe about the other: a short-weighted trade becomes “folk from there will cheat you”, a peace gift softens it. Below -0.35, trade stops.</p>
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
                <li key={i}><span className={`kind k-${c.kind}`}>{KIND[c.kind]}</span> {c.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
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
