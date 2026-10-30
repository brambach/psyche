import { useEffect, useState } from "react";
import { PLACES } from "@psyche/engine";
import { api, type AgentView, type TraceView } from "./api";
import { Scan } from "./Scan";
import { clock } from "./util";

/** One islander: who they are, how they read everyone else, and every moment of theirs you can open up. */
export function AgentPanel({ id, tick, names, trace, onTrace }: { id: string; tick: number; names: Record<string, string>; trace?: string; onTrace: (t?: string) => void }) {
  const [view, setView] = useState<AgentView>();
  const [scan, setScan] = useState<TraceView>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    api.agent(id).then((v) => live && setView(v), (e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [id, tick]);

  const latest = view?.traces[view.traces.length - 1]?.id;
  const shown = trace ?? latest;
  useEffect(() => {
    if (!shown) return setScan(undefined);
    let live = true;
    api.trace(id, shown).then((v) => live && setScan(v), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [id, shown]);

  if (error) return <p className="error">{error}</p>;
  if (!view) return <p className="empty">Opening {names[id]}'s mind...</p>;
  const m = view.mind;
  const others = Object.values(m.others).filter((o) => o.id in names);

  return (
    <div className="agent">
      <header className="agent-head">
        <span className="swatch big" style={{ background: `var(--a-${id})` }}>{m.name[0]}</span>
        <div>
          <h2>{m.name} <span className="small">{view.agent.role}</span></h2>
          <p className="small">{view.agent.activity}{view.agent.activity !== "asleep" ? ` at ${PLACES[view.agent.place].name}` : ""}</p>
        </div>
      </header>
      <p className="bio">{m.identity.summary}</p>
      <div className="grid2">
        <div className="pane">
          <h3>How {m.name} reads the others</h3>
          <div className="tbl">
            <table>
              <thead>
                <tr><th>Person</th><th>Likes</th><th>Trusts</th><th>Thinks they feel</th><th>Actually feel</th></tr>
              </thead>
              <tbody>
                {others.map((o) => {
                  const actual = ((view.actual[o.id] ?? 0.5) - 0.5) * 2;
                  const off = Math.abs(o.believedRegard - actual) > 0.4;
                  return (
                    <tr key={o.id}>
                      <td style={{ color: `var(--a-${o.id})` }}><b>{o.name}</b></td>
                      <td className="n">{o.liking.toFixed(2)}</td>
                      <td className="n">{o.trust.benevolence.toFixed(2)}</td>
                      <td className="n">{o.believedRegard.toFixed(2)}</td>
                      <td className={`n ${off ? "gap" : ""}`}>{actual.toFixed(2)}{off ? " ✱" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small">✱ marks a big misreading: {m.name} has the wrong idea of how that person feels.</p>
        </div>
        <div className="pane">
          <h3>What {m.name} wants</h3>
          <ul className="goals">
            {m.goals.map((g) => (
              <li key={g.id}>
                {g.text}
                <span className="fid" title={`progress ${g.progress.toFixed(2)}`}><i style={{ width: `${Math.round(g.progress * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
          <h3 style={{ marginTop: 14 }}>Life story, as {m.pronouns.subject} tells it</h3>
          <p className="small">“{m.self.lifeStory}”</p>
        </div>
      </div>

      <div className="agent-body">
        <nav className="moments" aria-label={`${m.name}'s moments`}>
          <h3>Moments</h3>
          {view.traces.length === 0 && <p className="empty">Nothing has happened to {m.name} yet.</p>}
          {[...view.traces].reverse().map((t) => (
            <button key={t.id} className={`moment ${t.kind === "sleep" ? "sleep" : ""} ${t.id === shown ? "on" : ""}`} onClick={() => onTrace(t.id)}>
              <span className="when">
                <span>{clock(t.tick)}</span>
                <span>{t.kind === "sleep" ? "sleep" : t.system ? `S${t.system}` : ""}{t.changed ? " · memory changed" : ""}</span>
              </span>
              <span className="what">{t.kind === "sleep" ? "Slept. Memories replayed and consolidated." : t.heard}</span>
              {t.action && <span className="said">{t.actionKind === "speech" ? `“${t.action}”` : t.action}</span>}
            </button>
          ))}
        </nav>
        <section className="scan-wrap">
          {scan ? <Scan trace={scan.trace} state={scan.state} trail={scan.trail} /> : <p className="empty">Pick a moment to see why {m.name} did what {m.pronouns.subject} did.</p>}
        </section>
      </div>
    </div>
  );
}
