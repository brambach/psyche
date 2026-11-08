// Founders (F0): one mind, one islet, one storm. The 3D view on the left; on the right, what is
// happening, the house as designed and as built, and the brain scan for every choice.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hourOf, type FounderInput } from "@psyche/engine";
import { Scan } from "../Scan";
import { clock, pct } from "../util";
import { foundersApi, type FounderTraceView, type FoundersView, type GridData } from "./api";
import { Voxel } from "./Voxel";

type Tab = "story" | "design" | "mind";

const HUE: Record<string, string> = { mara: "#c2410c", theo: "#1d4ed8", jun: "#15803d", corran: "#7e22ce", wren: "#be185d" };
const SPEEDS = [
  { label: "Slow", value: 5 },
  { label: "Normal", value: 10 },
  { label: "Fast", value: 30 },
  { label: "Very fast", value: 60 },
];
const KIND: Record<string, string> = { arrive: "arrival", choice: "a choice", design: "the design", progress: "progress", night: "night", morning: "morning", storm: "the storm", event: "event" };

export function Founders() {
  const [view, setView] = useState<FoundersView>();
  const [grid, setGrid] = useState<GridData>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("story");
  const [trace, setTrace] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"" | "restart" | "rewind">("");
  const fetching = useRef(false);
  const gridVersion = useRef(-1);

  const take = useCallback(async (v: FoundersView) => {
    setView(v);
    if (v.grid.version !== gridVersion.current) {
      gridVersion.current = v.grid.version;
      setGrid(await foundersApi.grid());
    }
  }, []);

  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      await take(await foundersApi.view());
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      fetching.current = false;
    }
  }, [take]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), view?.running ? 1000 : 3000);
    return () => clearInterval(t);
  }, [refresh, view?.running]);

  const act = async (f: () => Promise<FoundersView>) => {
    setBusy(true);
    setError(undefined);
    try {
      gridVersion.current = -1;
      await take(await f());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const send = (input: FounderInput) => act(() => foundersApi.input(input));
  const open = (t: string) => {
    setTrace(t);
    setTab("mind");
  };

  const b = view?.builder;
  const builderProp = useMemo(() => (b ? { x: b.x, y: b.y, z: b.z, color: HUE[b.id] ?? "#c2410c", asleep: b.activity.startsWith("asleep") } : { x: 0, y: 0, z: 0, color: "#c2410c", asleep: false }), [b?.x, b?.y, b?.z, b?.id, b?.activity]);
  const focus = useMemo(() => (view ? { x: view.plot.x0 + view.plot.w / 2, z: view.plot.z0 + view.plot.d / 2 } : { x: 24, z: 24 }), [view?.plot.x0, view?.plot.z0]);
  const ghost = useMemo(() => view?.project?.ghost ?? [], [view?.project?.ghost.length, view?.grid.version]);

  if (!view || !b) return <div className="app"><p className="empty">{error ?? "Rowing out to the islet..."}</p></div>;
  const pr = view.project;
  const P = b.pronouns;
  const stormIn = view.storm.at - view.tick;

  return (
    <div className="app founders-app">
      <header className="top">
        <a className="brand" href="#/" title="Back to Kettle Island">Psyche<small>Founders · Tern Holm</small></a>
        <span className={`chip ${view.faculties === "mock" ? "mock" : "live"}`} title={view.faculties === "mock" ? "No API key found: the design and deliberation come from the offline mock. The mind underneath is identical." : "The design and deliberation run on Claude."}>
          {view.faculties === "mock" ? "offline mock language" : "Claude"}
        </span>
        <span className="chip">{clock(view.tick)}</span>
        <span className={`chip ${view.storm.state === "raging" ? "storm" : ""}`}>
          {view.storm.state === "coming" ? `storm in ${Math.floor(stormIn / 60)}h ${String(stormIn % 60).padStart(2, "0")}m` : view.storm.state === "raging" ? "storm raging" : "storm passed"}
        </span>
        <span className="chip" title="Language model calls so far, by faculty">{view.calls} calls{Object.keys(view.callsBy).length ? ` (${Object.entries(view.callsBy).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}</span>
        <span className="spacer" />
        <div className="transport" role="group" aria-label="Clock">
          <button className="btn primary" onClick={() => act(() => foundersApi.control({ running: !view.running }))}>{view.running ? "Pause" : "Play"}</button>
          <select aria-label="Speed" value={view.speed} onChange={(e) => act(() => foundersApi.control({ speed: Number(e.target.value) }))}>
            {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.value} min/s)</option>)}
          </select>
          <button className="btn" disabled={busy} onClick={() => send({ type: "advance", minutes: 60 })}>+1 hour</button>
        </div>
        <div className="menus">
          <button className="btn" disabled={busy || view.storm.state !== "coming" || stormIn <= 180} onClick={() => send({ type: "inject", event: { kind: "storm-early" } })} title="The wind backs round and the storm arrives in three hours">Bring the storm early</button>
          <button className={`btn ${panel === "rewind" ? "on" : ""}`} onClick={() => setPanel(panel === "rewind" ? "" : "rewind")} aria-expanded={panel === "rewind"}>Rewind</button>
          <button className={`btn ${panel === "restart" ? "on" : ""}`} onClick={() => setPanel(panel === "restart" ? "" : "restart")} aria-expanded={panel === "restart"}>Someone else</button>
          <a className="btn" href="#/">Kettle Island</a>
        </div>
      </header>
      {panel === "rewind" && (
        <div className="drawer">
          <div className="row">
            <span className="small">Rewind the islet. Everything after that point is undone, block by block, and can play out differently.</span>
            {view.rewind.filter((r) => r.dayStart).map((r) => (
              <button key={r.index} className="btn" disabled={busy} onClick={() => act(() => foundersApi.rewind(r.index))}>{clock(r.tick)}</button>
            ))}
            <button className="btn" disabled={busy} onClick={() => act(() => foundersApi.rewind(-1))}>Back to the landing</button>
          </div>
        </div>
      )}
      {panel === "restart" && (
        <div className="drawer">
          <div className="row">
            <span className="small">Same islet, same storm, a different mind. Each one designs and builds their own way.</span>
            {view.builders.map((x) => (
              <button key={x.id} className={`btn ${x.id === b.id ? "on" : ""}`} disabled={busy} title={x.summary} onClick={() => { void act(() => foundersApi.reset({ builder: x.id })); setPanel(""); setTab("story"); setTrace(undefined); }}>
                <b style={{ color: `var(--a-${x.id})` }}>{x.name}</b> <span className="small">{x.role}</span>
              </button>
            ))}
            <button className="btn" disabled={busy} onClick={() => { void act(() => foundersApi.reset({ seed: view.seed + 1 })); setPanel(""); }}>New islet (seed {view.seed + 1})</button>
          </div>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="founders">
        <section className="world3d">
          <Voxel grid={grid} ghost={ghost} builder={builderProp} hour={hourOf(view.tick)} storm={view.storm.state === "raging"} focus={focus} />
          <div className="hud">
            <div className="who">
              <span className="swatch" style={{ background: `var(--a-${b.id})` }}>{b.name[0]}</span>
              <div>
                <b>{b.name}</b> <span className="small">{b.activity}</span>
                <div className="small">
                  mood {b.mood >= 0 ? "+" : ""}{b.mood.toFixed(2)} · energy {pct(b.energy)}{b.emotion ? ` · ${b.emotion.name} ${b.emotion.value.toFixed(2)}` : ""}
                </div>
              </div>
            </div>
            {pr && (
              <div className="build">
                <div className="buildbar" aria-label={`${pct(pr.progress)} built`}><i style={{ width: pct(pr.progress) }} /></div>
                <span className="small">
                  {pct(pr.progress)} of {pr.bill.blocks} blocks
                  {pr.finishedAt ? ` · finished ${clock(pr.finishedAt)}` : ` · about ${pr.remainingHours.toFixed(0)}h of work left`}
                  {view.storm.state === "coming" && !pr.finishedAt ? ` · ${view.hoursUntilStorm.toFixed(0)}h of working time before the storm` : ""}
                </span>
              </div>
            )}
            <div className="inv small">
              Carrying: {Object.entries(b.inventory).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing"}
            </div>
          </div>
          <p className="hint small">Drag to orbit, scroll to zoom. Faint blocks are the plan not built yet.</p>
        </section>
        <main className="stage">
          <div className="tabs big" role="tablist">
            <button role="tab" aria-selected={tab === "story"} className={tab === "story" ? "on" : ""} onClick={() => setTab("story")}>What's happening</button>
            <button role="tab" aria-selected={tab === "design"} className={tab === "design" ? "on" : ""} onClick={() => setTab("design")}>The house{pr ? "" : " (not yet)"}</button>
            <button role="tab" aria-selected={tab === "mind"} className={tab === "mind" ? "on" : ""} onClick={() => setTab("mind")}>Inside {b.name}'s head</button>
          </div>
          {tab === "story" && (
            <div className="feed">
              {view.feed.length === 0 && <p className="empty">{b.name} is about to land. Press Play.</p>}
              {[...view.feed].reverse().map((f) => (
                <article key={f.id} className={`item k-${f.kind}`}>
                  <header>
                    <span className="when">{clock(f.tick)}</span>
                    <span className="kind">{KIND[f.kind]}</span>
                  </header>
                  <h4>{f.title}</h4>
                  {f.text && <p className="text">{f.text}</p>}
                  {f.trace && (
                    <div className="refs">
                      <button className="ref" onClick={() => open(f.trace!)}>Why? Inside {b.name}'s head</button>
                      {f.kind === "design" && <button className="ref" onClick={() => setTab("design")}>See the design</button>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          {tab === "design" && (pr ? <Design view={view} onOpen={open} /> : <p className="empty">{b.name} hasn't designed anything yet.</p>)}
          {tab === "mind" && <Mind view={view} trace={trace} onTrace={setTrace} />}
          <p className="small about">
            {P.subject === "they" ? "They" : P.subject[0]!.toUpperCase() + P.subject.slice(1)} decide{P.subject === "they" ? "" : "s"} what to do with the same mind engine as Kettle Island. The language model is asked for one thing here: the design, written as a short blueprint. Every block is placed by plain code.
          </p>
        </main>
      </div>
    </div>
  );
}

function Design({ view, onOpen }: { view: FoundersView; onOpen: (t: string) => void }) {
  const pr = view.project!;
  const b = view.builder;
  const changed = pr.description !== pr.proposedDescription;
  return (
    <div className="design">
      <h2>{pr.blueprint.name}</h2>
      <p className="lead">{pr.description}.</p>
      {changed && <p className="small">As designed: {pr.proposedDescription}.</p>}
      <blockquote>“{pr.rationale}” <span className="small">{b.name}</span></blockquote>
      <div className="grid2">
        <div className="pane">
          <h3>What was on {b.pronouns.possessive} mind</h3>
          {pr.because.length === 0 && <p className="small">The design cited nothing in particular.</p>}
          <ul className="because">
            {pr.because.map((c) => (
              <li key={c.ref}>
                <span>{c.label}</span>
                <span className="fid"><i style={{ width: pct(Math.min(1, c.weight)) }} /></span>
              </li>
            ))}
          </ul>
          <button className="ref" onClick={() => onOpen(pr.trace)}>Open the decision to build</button>
        </div>
        <div className="pane">
          <h3>The bill</h3>
          <table className="bill">
            <tbody>
              <tr><td>Blocks</td><td className="n">{pr.bill.blocks}</td></tr>
              <tr><td>Planks</td><td className="n">{pr.bill.items.plank}</td></tr>
              <tr><td>Stone</td><td className="n">{pr.bill.items.cobble}</td></tr>
              <tr><td>Thatch</td><td className="n">{pr.bill.items.thatch}</td></tr>
              <tr><td>Logs (incl. corner posts)</td><td className="n">{pr.bill.raw.logs}</td></tr>
              <tr><td>Estimated work</td><td className="n">{pr.bill.hours.toFixed(1)} h</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      {pr.repairs.length > 0 && (
        <div className="pane">
          <h3>Changed to make it buildable here</h3>
          <ul className="small">{pr.repairs.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {pr.revisions.length > 0 && (
        <div className="pane">
          <h3>Changed on site</h3>
          <ul className="small">{pr.revisions.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      <details className="pane">
        <summary>The blueprint, as the Architect wrote it</summary>
        <pre>{JSON.stringify(pr.proposed, null, 2)}</pre>
      </details>
    </div>
  );
}

function Mind({ view, trace, onTrace }: { view: FoundersView; trace?: string; onTrace: (t: string) => void }) {
  const [scan, setScan] = useState<FounderTraceView>();
  const [error, setError] = useState<string>();
  const b = view.builder;
  const shown = trace ?? view.traces[view.traces.length - 1]?.id;
  useEffect(() => {
    if (!shown) return setScan(undefined);
    let live = true;
    foundersApi.trace(shown).then((v) => live && setScan(v), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [shown]);
  return (
    <div className="agent">
      <p className="bio">{b.summary}</p>
      <div className="grid2">
        <div className="pane">
          <h3>What {b.name} wants</h3>
          <ul className="goals">
            {b.goals.map((g) => (
              <li key={g.id}>
                {g.text}
                <span className="fid" title={`progress ${g.progress.toFixed(2)}`}><i style={{ width: `${Math.round(g.progress * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
        </div>
        <div className="pane">
          <h3>Life story, as {b.pronouns.subject} tells it</h3>
          <p className="small">“{b.lifeStory}”</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="agent-body">
        <nav className="moments" aria-label={`${b.name}'s moments`}>
          <h3>Moments</h3>
          {view.traces.length === 0 && <p className="empty">Nothing has happened to {b.name} yet.</p>}
          {[...view.traces].reverse().map((t) => (
            <button key={t.id} className={`moment ${t.kind === "sleep" ? "sleep" : ""} ${t.id === shown ? "on" : ""}`} onClick={() => onTrace(t.id)}>
              <span className="when">
                <span>{clock(t.tick)}</span>
                <span>{t.kind === "sleep" ? "sleep" : t.system ? `S${t.system}` : ""}{t.llm.includes("architect") ? " · designed" : ""}</span>
              </span>
              <span className="what">{t.kind === "sleep" ? "Slept. Memories replayed and consolidated." : t.heard}</span>
              {t.action && <span className="said">{t.action}</span>}
            </button>
          ))}
        </nav>
        <section className="scan-wrap">
          {scan ? <Scan trace={scan.trace} state={scan.state} trail={scan.trail} /> : <p className="empty">Pick a moment to see why {b.name} did what {b.pronouns.subject} did.</p>}
        </section>
      </div>
    </div>
  );
}
