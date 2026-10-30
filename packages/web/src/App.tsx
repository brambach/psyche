import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ABLATIONS, demoScript, hourOf, type Ablations, type Input, type Trace } from "@psyche/engine";
import { api, type View } from "./api";
import { Scan } from "./Scan";
import { clock } from "./util";

type Moment = { frame: number; trace?: Trace; input: Input };

/** Ready-made events, taken from the demo plus a few kinder ones, that happen "now" when injected. */
const PRESETS: { label: string; input: Input }[] = [
  ...demoScript()
    .filter((i) => i.type === "event")
    .map((i) => ({ label: i.text.length > 70 ? `${i.text.slice(0, 67)}...` : i.text, input: { ...i, at: undefined } as Input })),
  {
    label: "Jun brings Mara a basket of fish",
    input: {
      type: "event",
      text: "Jun turns up with a basket of fish: \"Had a good morning. Thought of you.\"",
      percept: {
        kind: "speech", actor: "jun", addressedToSelf: true, about: ["jun"], topics: ["fish", "catch", "help"],
        features: { outcomeForSelf: 0.5, agency: "other", intentional: 0.9, normViolation: 0, prospective: false, intensity: 0.5 },
        claims: [], details: [], gist: "Jun brought me a basket of fish.",
      },
    },
  },
  {
    label: "Theo returns the tools he borrowed, cleaned and oiled",
    input: {
      type: "event",
      text: "Theo leaves Mara's tools on her step, cleaned and oiled, with a note: \"Thanks. T.\"",
      percept: {
        kind: "event", actor: "theo", addressedToSelf: false, about: ["theo"], topics: ["help", "boat"],
        features: { outcomeForSelf: 0.4, agency: "other", intentional: 0.9, normViolation: 0, prospective: false, intensity: 0.4 },
        claims: [], details: [], gist: "Theo returned my tools, cleaned and oiled.",
      },
    },
  },
  {
    label: "A gale is forecast for tomorrow night",
    input: {
      type: "event",
      text: "The harbourmaster posts a warning: a gale is coming tomorrow night.",
      percept: {
        kind: "event", actor: "world", addressedToSelf: false, about: [], topics: ["storm", "boat", "dock"],
        features: { outcomeForSelf: -0.5, agency: "circumstance", intentional: 0, normViolation: 0, prospective: true, intensity: 0.6 },
        claims: [], details: [], gist: "A gale is forecast for tomorrow night.",
      },
    },
  },
];

const MECHANISMS: { key: keyof Ablations; label: string }[] = [
  { key: "reconsolidation", label: "Recall rewrites memories" },
  { key: "misinformation", label: "Things heard compete with things seen" },
  { key: "moodCongruence", label: "Mood steers recall" },
  { key: "affectiveRetagging", label: "Recall recolours a memory's feeling" },
  { key: "negativityAsymmetry", label: "Trust falls faster than it rises" },
  { key: "motivatedAttribution", label: "Low trust inflates blame" },
  { key: "motivatedUpdating", label: "Gossip that fits is believed more" },
  { key: "limitedWorkspace", label: "Only four things in mind at once" },
  { key: "sleepConsolidation", label: "Sleep consolidates" },
  { key: "traitDrift", label: "Traits drift nightly" },
];

export function App() {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<number>();
  const [text, setText] = useState("");
  const [speaker, setSpeaker] = useState("visitor");
  const [preset, setPreset] = useState(0);
  const [mechs, setMechs] = useState<Ablations>(DEFAULT_ABLATIONS);

  const run = async (f: () => Promise<View>, selectLast = true) => {
    setBusy(true);
    setError(undefined);
    try {
      const v = await f();
      setView(v);
      setMechs(v.ablations);
      if (selectLast) setSel(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => void run(api.get), []);

  const moments: Moment[] = useMemo(() => {
    if (!view) return [];
    return view.frames.flatMap((f) => (f.traces.length ? f.traces.map((t) => ({ frame: f.index, trace: t, input: f.input })) : [{ frame: f.index, input: f.input }]));
  }, [view]);

  const selectable = moments.map((m, i) => ({ m, i })).filter((x) => x.m.trace);
  const current = sel !== undefined ? moments[sel] : selectable[selectable.length - 1]?.m;
  const currentIndex = sel ?? selectable[selectable.length - 1]?.i;

  const trail = useMemo(() => {
    if (!view || !current) return [];
    return [view.initial, ...view.frames.slice(0, current.frame + 1).map((f) => f.state)].map((s) => ({ v: s.affect.mood.valence, a: s.affect.mood.arousal }));
  }, [view, current]);

  const tick = view?.frames[view.frames.length - 1]?.state.tick ?? view?.initial.tick ?? 0;
  const untilMorning = Math.round(((7 - hourOf(tick) + 24) % 24) * 60) + 1;

  return (
    <div className="app">
      <header className="top">
        <span className="brand">Psyche<small>M0 · Specimen</small></span>
        {view && <span className={`chip ${view.faculties === "mock" ? "mock" : "live"}`} title={view.faculties === "mock" ? "No API key found: language comes from the offline mock. The mind engine is identical." : "Language faculties are running on Claude."}>{view.faculties === "mock" ? "offline mock language" : "Claude"}</span>}
        {view && <span className="chip">seed {view.seed}</span>}
        {view && <span className="chip">{clock(tick)}</span>}
        <span className="spacer" />
        <button className="btn primary" disabled={busy} onClick={() => run(() => api.reset({ demo: true, ablations: mechs }))}>Run the six-day demo</button>
        <button className="btn" disabled={busy} onClick={() => run(() => api.reset({ seed: (view?.seed ?? 0) + 1, ablations: mechs }))}>New seed</button>
        <button className="btn" disabled={busy} onClick={() => run(() => api.reset({ ablations: mechs }))}>Start over</button>
      </header>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="main">
        <aside className="left">
          <div className="timeline" aria-label="Timeline">
            {moments.length === 0 && <p className="empty">Mara is at the harbour on Day 1. Say something to her, inject an event, or run the six-day demo.</p>}
            {moments.map((m, i) => {
              const t = m.trace;
              const on = i === currentIndex;
              const isLastOfFrame = moments[i + 1]?.frame !== m.frame;
              return (
                <div key={i}>
                  <button className={`moment ${t?.kind === "sleep" ? "sleep" : ""} ${on ? "on" : ""}`} onClick={() => t && setSel(i)} disabled={!t} style={{ width: "100%" }}>
                    <span className="when"><span>{t ? clock(t.tick) : "time passes"}</span><span>{t?.kind === "sleep" ? "sleep" : t?.decision ? `S${t.decision.system}` : ""}</span></span>
                    <span className="what">{t?.kind === "sleep" ? "Slept. Memories replayed and consolidated." : t?.percept?.rawText ?? ""}</span>
                    {t?.action?.text && <span className="said">{t.action.kind === "speech" ? `Mara: “${t.action.text}”` : t.action.text}</span>}
                  </button>
                  {isLastOfFrame && view && m.frame < view.frames.length - 1 && (
                    <button className="rewind" disabled={busy} onClick={() => run(() => api.rewind(m.frame))}>Rewind to here</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="composer">
            <span className="lab">Say something</span>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                const t = text.trim();
                setText("");
                void run(() => api.input({ type: "say", from: speaker, text: t }));
              }}
            >
              <select id="speaker" aria-label="Speaker" value={speaker} onChange={(e) => setSpeaker(e.target.value)} style={{ flex: "0 0 auto" }}>
                <option value="visitor">as the visitor</option>
                <option value="jun">as Jun</option>
                <option value="theo">as Theo</option>
              </select>
              <input id="say" type="text" placeholder="What happened at the dock?" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn" disabled={busy || !text.trim()}>Say</button>
            </form>
            <span className="lab">Make something happen</span>
            <div className="row">
              <select id="preset" aria-label="Event" value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
                {PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
              </select>
              <button className="btn" disabled={busy} onClick={() => run(() => api.input(PRESETS[preset]!.input))}>Inject</button>
            </div>
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => run(() => api.input({ type: "wait", minutes: 60 }))}>Wait an hour</button>
              <button className="btn" disabled={busy} onClick={() => run(() => api.input({ type: "wait", minutes: untilMorning }))}>Sleep until morning</button>
            </div>
          </div>
        </aside>
        <main className="scan">
          {current?.trace && view ? (
            <Scan trace={current.trace} state={view.frames[current.frame]!.state} trail={trail} />
          ) : (
            <p className="empty">Pick a moment on the left to see why Mara did what she did.</p>
          )}
          <div className="pane" style={{ marginTop: 24 }}>
            <h3>Mechanisms</h3>
            <div className="mechs">
              {MECHANISMS.map((m) => (
                <label key={m.key}>
                  <input id={`m-${m.key}`} type="checkbox" checked={mechs[m.key] as boolean} onChange={(e) => setMechs({ ...mechs, [m.key]: e.target.checked })} />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="small">Switch a mechanism off and re-run the same history. Recorded responses are reused until the mind asks for something new, so you can see exactly where the two histories part.</p>
            <button className="btn" disabled={busy || !view?.frames.length} onClick={() => run(() => api.rerun(mechs), false)}>Re-run this history with these settings</button>
          </div>
        </main>
      </div>
    </div>
  );
}
