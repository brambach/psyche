import { useEffect, useRef, useState } from "react";
import { api, type AgentView, type ConcernView, type TraceView } from "./api";
import { Lineage, type LineageQuery } from "./Lineage";
import { Scan } from "./Scan";
import { Account } from "./Village";
import { clock, placeName } from "./util";

/** One islander: who they are, how they read everyone else, and every moment of theirs you can open up. */
export function AgentPanel({ id, tick, names, trace, onTrace, onOpen }: { id: string; tick: number; names: Record<string, string>; trace?: string; onTrace: (t?: string) => void; onOpen: (agent: string, trace?: string) => void }) {
  const [view, setView] = useState<AgentView>();
  const [scan, setScan] = useState<TraceView>();
  const [error, setError] = useState<string>();
  const [worries, setWorries] = useState<ConcernView[]>([]);
  const [lineage, setLineage] = useState<LineageQuery>();
  const [account, setAccount] = useState(false);
  const lineageRef = useRef<HTMLDivElement>(null);

  const trace_ = (q: LineageQuery) => {
    setLineage(q);
    requestAnimationFrame(() => lineageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  useEffect(() => {
    let live = true;
    api.agent(id).then((v) => live && setView(v), (e) => live && setError(String(e)));
    api.concerns(id).then((v) => live && setWorries(v.concerns), () => undefined);
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
          <p className="small">{view.agent.activity}{view.agent.activity !== "asleep" ? ` at ${placeName(view.agent.place)}` : ""}</p>
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

      <div className="pane" style={{ marginTop: 14 }}>
        <h3>What weighs on {m.name}, and where it came from</h3>
        {worries.length === 0 ? (
          <p className="small">Nothing dark yet. Fears and grudges show up here once something stirs them.</p>
        ) : (
          <ul className="concerns">
            {worries.map((c) => (
              <li key={c.id}>
                <span className={`kind k-${c.kind === "emotion" ? "emotion" : c.kind}`}>{c.kind === "schema" ? "core belief" : c.kind === "emotion" ? "feeling" : "belief"}</span>
                <span>{c.label}</span>
                <span className="small">{c.direct > 0 ? `in mind for ${c.direct} choice${c.direct === 1 ? "" : "s"}` : "not acted on yet"}{c.minds.length ? `, reached ${c.minds.map((x) => names[x] ?? x).join(", ")}` : ""}</span>
                <button className="btn" onClick={() => trace_({ node: c.id })}>Trace it</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={lineageRef}>
        {lineage && <Lineage query={lineage} focus={id} names={names} onOpen={(a, t) => (a === id ? onTrace(t) : onOpen(a, t))} onClose={() => setLineage(undefined)} />}
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
          {scan && scan.trace.kind === "perceive" && (
            <div className="scan-tools">
              <button className="btn" onClick={() => trace_({ agent: id, trace: scan.trace.id })}>Why? Trace this moment back</button>
              {scan.trace.decision && <button className={`btn ${account ? "on" : ""}`} onClick={() => setAccount(!account)}>What {m.name} would say vs what drove it</button>}
            </div>
          )}
          {account && scan?.trace.decision && <Account key={scan.trace.id} agent={id} trace={scan.trace.id} names={names} onOpen={(a, t) => (a === id ? onTrace(t) : onOpen(a, t))} />}
          {scan ? <Scan trace={scan.trace} state={scan.state} trail={scan.trail} /> : <p className="empty">Pick a moment to see why {m.name} did what {m.pronouns.subject} did.</p>}
        </section>
      </div>
    </div>
  );
}
