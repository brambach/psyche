// The butterfly: the town run on from the moment of a change twice, with it and without it, on the free
// mock with the same luck, set side by side. What differs is what the change did.

import { useState } from "react";
import { api, type Butterfly as B } from "./api";

/** Spans in sim days: a season is 4 days and a year 16 in Hollow Bay. */
const SPANS: [number, string][] = [
  [4, "A season"],
  [16, "A year"],
  [48, "Three years"],
];

export function ButterflyPanel({ edit, names, label }: { edit: string; names: Record<string, string>; label?: string }) {
  const [days, setDays] = useState<number>();
  const [b, setB] = useState<B>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const name = (id?: string) => (id ? b?.names[id] ?? names[id] ?? id : "nobody");

  const run = async (d: number) => {
    setDays(d);
    setBusy(true);
    setError(undefined);
    try {
      setB(await api.butterfly(edit, d));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const T = b?.town;
  const rows: [string, (s: NonNullable<typeof T>["with"]) => string][] = [
    ["People", (s) => String(s.people)],
    ["Born / died", (s) => `${s.births} / ${s.deaths}`],
    ["Common store", (s) => `${s.store} food`],
    ["Houses", (s) => String(s.houses)],
    ["Leader", (s) => name(s.leader)],
    ["Laws", (s) => String(s.laws)],
    ["Norms", (s) => String(s.norms)],
    ["Crafts known", (s) => String(s.crafts)],
    ["How warm people are", (s) => s.warmth.toFixed(2)],
    ["How they like who you changed", (s) => s.likedChanged.toFixed(2)],
    ["Mood", (s) => s.mood.toFixed(2)],
    ["Conversations", (s) => String(s.talks)],
  ];
  const peak = Math.max(1, ...(b?.spread.map((x) => x.flips) ?? [1]));

  return (
    <section className="pane bf">
      <h3>Both ways: with and without {label ? "this change" : "it"}</h3>
      <p className="small">Runs the town on from the moment of your change twice, on the free offline mock with the same luck, so every difference comes from the change. It doesn't touch the live world.</p>
      <div className="ed-presets">
        {SPANS.map(([d, l]) => (
          <button key={d} className={`btn ${days === d ? "on" : ""}`} disabled={busy} onClick={() => run(d)}>{l}</button>
        ))}
        {busy && <span className="small">Running {days} days twice…</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {b && !busy && (
        <>
          <div className="bf-story">{b.story.map((s, i) => <p key={i}>{s}</p>)}</div>
          <div className="bf-spread" aria-label="Choices that differed, day by day">
            {b.spread.map((x) => (
              <span key={x.day} title={`Day ${x.day}: ${x.flips} choices differed, by ${x.people} people`} style={{ height: `${Math.max(3, (x.flips / peak) * 100)}%` }} />
            ))}
          </div>
          <p className="small">Choices that came out differently, day by day.</p>
          {T && (
            <div className="tbl">
              <table className="bf-table">
                <thead><tr><th></th><th>With your change</th><th>Without</th></tr></thead>
                <tbody>
                  {rows.map(([k, f]) => {
                    const a = f(T.with);
                    const c = f(T.without);
                    return <tr key={k} className={a !== c ? "diff" : ""}><td>{k}</td><td className="n">{a}</td><td className="n">{c}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          {b.flips.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Choices that flipped</h3>
              <ul className="bf-flips">
                {b.flips.slice(0, 14).map((f, i) => (
                  <li key={i}>
                    <b>{name(f.agent)}</b> <span className="small">at “{f.question}”</span>
                    <span><ins>{f.with}</ins> instead of <del>{f.without}</del></span>
                    <span className={`kind ${f.traced ? "k-edit" : ""}`}>{f.traced ? "because you" : "ripple"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.liking.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Feelings that ended up different</h3>
              <ul className="bf-flips">
                {b.liking.slice(0, 8).map((l, i) => (
                  <li key={i}><span>{name(l.from)} → {name(l.to)}</span><span className="n">{l.with.toFixed(2)} instead of {l.without.toFixed(2)}</span></li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
