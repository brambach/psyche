import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ABLATIONS, isNight, type Ablations, type WorldInput } from "@psyche/engine";
import { api, type WorldView } from "./api";
import { AgentPanel } from "./AgentPanel";
import { IslandMap } from "./IslandMap";
import { Cast, Feed, Relations, Rumors } from "./Panels";
import { agentColors, clock, setPlaces } from "./util";
import { Divergence, Village } from "./Village";
import { Atlas } from "./Generations";

type Tab = "feed" | "village" | "atlas" | "rumors" | "memories" | "relations" | "mind";

const SPEEDS = [
  { label: "Slow", value: 5 },
  { label: "Normal", value: 10 },
  { label: "Fast", value: 30 },
  { label: "Very fast", value: 60 },
];

const MECHANISMS: { key: keyof Ablations; label: string }[] = [
  { key: "reconsolidation", label: "Recall rewrites memories" },
  { key: "misinformation", label: "Things heard compete with things seen" },
  { key: "moodCongruence", label: "Mood steers recall" },
  { key: "affectiveRetagging", label: "Recall recolours a memory's feeling" },
  { key: "negativityAsymmetry", label: "Trust falls faster than it rises" },
  { key: "motivatedAttribution", label: "Low trust inflates blame" },
  { key: "motivatedUpdating", label: "Gossip that fits is believed more" },
  { key: "illusoryTruth", label: "Hearing a story twice makes it truer" },
  { key: "limitedWorkspace", label: "Only four things in mind at once" },
  { key: "sleepConsolidation", label: "Sleep consolidates" },
  { key: "traitDrift", label: "Traits drift nightly" },
];

export function App() {
  const [view, setView] = useState<WorldView>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("feed");
  const [agent, setAgent] = useState<string>();
  const [trace, setTrace] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"" | "events" | "talk" | "rumor" | "rewind" | "mechanisms" | "cost">("");
  const [mechs, setMechs] = useState<Ablations>(DEFAULT_ABLATIONS);
  const fetching = useRef(false);

  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      setView(await api.world());
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      fetching.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), view?.running ? 1000 : 3000);
    return () => clearInterval(t);
  }, [refresh, view?.running]);

  const act = async (f: () => Promise<WorldView>) => {
    setBusy(true);
    setError(undefined);
    try {
      const v = await f();
      setView(v);
      setMechs(v.ablations);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const send = (input: WorldInput) => act(() => api.input(input));

  // The dead keep their names: they still turn up as tellers of stories and roots of fears.
  const names = useMemo(() => Object.fromEntries([...(view?.village?.people ?? []).map((p) => [p.id, p.name]), ...(view?.agents ?? []).map((a) => [a.id, a.name])]), [view?.agents, view?.village?.people]);
  const pronouns = useMemo(() => Object.fromEntries((view?.agents ?? []).map((a) => [a.id, a.pronoun])), [view?.agents]);

  // Whoever you are looking inside speaks with the model however small the moment; everyone else
  // falls back to templates for small talk.
  const watching = tab === "mind" ? agent : undefined;
  useEffect(() => {
    void api.focus(watching ? [watching] : []).catch(() => undefined);
  }, [watching]);

  const open = (id: string, t?: string) => {
    setAgent(id);
    setTrace(t);
    setTab("mind");
  };

  if (!view) return <div className="app"><p className="empty">{error ?? "Connecting to the island..."}</p></div>;
  setPlaces(view.places);
  const isVillage = view.scenario === "village";
  const night = isNight(view.tick);
  const untilMorning = Math.round(((7 * 60 - (view.tick % 1440)) + 1440) % 1440) || 1440;

  return (
    <div className="app">
      <style>{agentColors(view.order)}</style>
      <header className="top">
        <span className="brand">Psyche<small>{view.name}</small></span>
        <select
          className="scenario"
          aria-label="World"
          value={view.scenario}
          disabled={busy}
          onChange={(e) => {
            const scenario = e.target.value as WorldView["scenario"];
            if (confirm(`Start ${scenario === "village" ? "Hollow Bay, the village" : "Kettle Island"} from the beginning? The current world is replaced.`)) {
              setAgent(undefined);
              setTab("feed");
              void act(() => api.reset({ scenario }));
            }
          }}
        >
          <option value="island">Kettle Island (5)</option>
          <option value="village">Hollow Bay village</option>
        </select>
        <span className={`chip ${view.faculties === "mock" ? "mock" : "live"}`} title={view.faculties === "mock" ? "No API key found: speech comes from the offline mock. The minds underneath are identical." : "Speech and reflection run on Claude."}>
          {view.faculties === "mock" ? "offline mock language" : "Claude"}
        </span>
        <span className="chip">{clock(view.tick)}{night ? " · night" : ""}</span>
        <span className="chip" title="Conversations so far, and language model calls">{view.conversations} conversations · {view.calls} calls</span>
        <button className={`chip cost ${view.cost.level}`} onClick={() => setPanel(panel === "cost" ? "" : "cost")} aria-expanded={panel === "cost"} title={view.cost.estimated ? "What this run would cost on Claude. Running on the offline mock, so it costs nothing." : `${view.cost.levelMeans} Today: $${view.cost.todayUsd.toFixed(2)} of $${view.cost.capUsd} cap.`}>
          {usd(view.cost.sessionUsd)}{view.cost.estimated ? " est." : ""}{view.cost.perSimDay !== undefined ? ` · ${usd(view.cost.perSimDay)}/sim day` : ""}
        </button>
        <span className="spacer" />
        <div className="transport" role="group" aria-label="Clock">
          <button className="btn primary" onClick={() => act(() => api.control({ running: !view.running }))}>{view.running ? "Pause" : "Play"}</button>
          <select aria-label="Speed" value={view.speed} onChange={(e) => act(() => api.control({ speed: Number(e.target.value) }))}>
            {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.value} min/s)</option>)}
          </select>
          <button className="btn" disabled={busy || !!view.fastForward} onClick={() => send({ type: "advance", minutes: night ? untilMorning : 60 })}>{night ? "Skip to morning" : "+1 hour"}</button>
          {isVillage && (
            <select
              aria-label="Let years pass"
              value=""
              disabled={busy || !!view.fastForward}
              title="Years pass on the offline mock, free. Births, deaths, stories and norms carry on; you can't rewind past them."
              onChange={(e) => {
                const years = Number(e.target.value);
                if (years && confirm(`Let ${years} year${years === 1 ? "" : "s"} pass? This runs on the offline mock (free), and you won't be able to rewind to before it.`)) void act(() => api.years(years));
              }}
            >
              <option value="">Let years pass...</option>
              {[1, 5, 10, 25].map((y) => <option key={y} value={y}>{y} year{y === 1 ? "" : "s"}</option>)}
            </select>
          )}
        </div>
        {view.fastForward && (
          <span className="chip live" role="status">
            Years passing: {Math.round(((view.fastForward.at - view.fastForward.from) / (view.fastForward.to - view.fastForward.from)) * 100)}%
          </span>
        )}
        <a className="btn" href="#/founders" title="One mind, an empty islet, a storm on the way: watch it design and build a house">Founders</a>
        <div className="menus">
          {(["events", "talk", "rumor", "rewind", "mechanisms"] as const).map((p) => (
            <button key={p} className={`btn ${panel === p ? "on" : ""}`} onClick={() => setPanel(panel === p ? "" : p)} aria-expanded={panel === p}>
              {p === "events" ? "Make something happen" : p === "talk" ? "Talk to someone" : p === "rumor" ? "Plant a rumor" : p === "rewind" ? "Rewind" : "Mechanisms"}
            </button>
          ))}
        </div>
      </header>
      {panel && (
        <div className="drawer">
          {panel === "events" && <Events busy={busy} names={names} village={isVillage} onSend={(i) => { void send(i); setPanel(""); }} />}
          {panel === "talk" && <Talk busy={busy} view={view} onSend={(i) => { void send(i); setPanel(""); }} />}
          {panel === "rumor" && <PlantRumor busy={busy} view={view} onSend={(i) => { void send(i); setPanel(""); setTab("rumors"); }} />}
          {panel === "rewind" && (
            <div className="row">
              <span className="small">Rewind the whole world. Everything after that point is undone, and the future can play out differently.</span>
              {view.rewind.filter((r) => r.dayStart).map((r) => (
                <button key={r.index} className="btn" disabled={busy} onClick={() => act(() => api.rewind(r.index))}>{clock(r.tick)}</button>
              ))}
              {(() => {
                const hourAgo = [...view.rewind].reverse().find((r) => r.tick <= view.tick - 60);
                return hourAgo ? <button className="btn" disabled={busy} onClick={() => act(() => api.rewind(hourAgo.index))}>Back to {clock(hourAgo.tick)}</button> : null;
              })()}
              <button className="btn" disabled={busy} onClick={() => act(() => api.rewind(-1))}>Back to the start</button>
            </div>
          )}
          {panel === "cost" && <Cost cost={view.cost} />}
          {panel === "mechanisms" && (
            <div>
              <div className="mechs">
                {MECHANISMS.map((m) => (
                  <label key={m.key}>
                    <input type="checkbox" checked={mechs[m.key] as boolean} onChange={(e) => setMechs({ ...mechs, [m.key]: e.target.checked })} /> {m.label}
                  </label>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn primary" disabled={busy} onClick={() => act(() => api.reset({ ablations: mechs }))}>Restart the world with these settings</button>
                <button className="btn" disabled={busy} onClick={() => act(() => api.reset({ seed: view.seed + 1, ablations: mechs }))}>Restart with a new seed ({view.seed + 1})</button>
                <span className="small">Seed {view.seed}. Same seed and settings, same world, every time.</span>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="island">
        <aside className="side">
          <IslandMap agents={view.agents} tick={view.tick} selected={agent} onSelect={(id) => open(id)} places={view.places} name={view.name} village={isVillage} />
          <Cast agents={view.agents} selected={agent} onSelect={(id) => open(id)} />
        </aside>
        <main className="stage">
          <div className="tabs big" role="tablist">
            <button role="tab" aria-selected={tab === "feed"} className={tab === "feed" ? "on" : ""} onClick={() => setTab("feed")}>What's happening</button>
            {view.village && <button role="tab" aria-selected={tab === "village"} className={tab === "village" ? "on" : ""} onClick={() => setTab("village")}>The village</button>}
            {view.village && <button role="tab" aria-selected={tab === "atlas"} className={tab === "atlas" ? "on" : ""} onClick={() => setTab("atlas")}>Fears across generations</button>}
            <button role="tab" aria-selected={tab === "rumors"} className={tab === "rumors" ? "on" : ""} onClick={() => setTab("rumors")}>Stories going round{view.rumors.length ? ` (${view.rumors.length})` : ""}</button>
            <button role="tab" aria-selected={tab === "memories"} className={tab === "memories" ? "on" : ""} onClick={() => setTab("memories")}>Same event, different memories</button>
            <button role="tab" aria-selected={tab === "relations"} className={tab === "relations" ? "on" : ""} onClick={() => setTab("relations")}>Who feels what</button>
            {agent && (
              <button role="tab" aria-selected={tab === "mind"} className={tab === "mind" ? "on" : ""} onClick={() => setTab("mind")} style={{ borderColor: `var(--a-${agent})` }}>
                Inside {names[agent]}'s head
              </button>
            )}
          </div>
          {tab === "feed" && <Feed feed={view.feed} names={names} onOpen={open} />}
          {tab === "village" && view.village && <Village v={view.village} names={names} onOpen={open} />}
          {tab === "atlas" && view.village && <Atlas tick={view.tick} names={names} onOpen={open} />}
          {tab === "memories" && <Divergence names={names} tick={view.tick} onOpen={open} />}
          {tab === "rumors" && <Rumors rumors={view.rumors} names={names} onOpen={open} />}
          {tab === "relations" && <Relations order={view.order} relations={view.relations} names={names} pronouns={pronouns} />}
          {tab === "mind" && agent && <AgentPanel key={agent} id={agent} tick={view.tick} names={names} trace={trace} onTrace={setTrace} onOpen={open} />}
        </main>
      </div>
    </div>
  );
}

const usd = (x: number) => `$${x < 0.1 ? x.toFixed(4) : x.toFixed(2)}`;

function Cost({ cost }: { cost: WorldView["cost"] }) {
  const rows = Object.entries(cost.byFaculty).sort((a, b) => b[1].usd - a[1].usd);
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 24 }}>
      <div className="small" style={{ maxWidth: 420 }}>
        {cost.estimated ? (
          <p style={{ margin: 0 }}>Running on the offline mock, so this costs nothing. The figures are what the same run would cost on Claude, estimated from the size of every request.</p>
        ) : (
          <p style={{ margin: 0 }}>
            Today ${cost.todayUsd.toFixed(2)} of the ${cost.capUsd} daily cap ({cost.level}). {cost.levelMeans} Cache hits {(cost.cacheHitRate * 100).toFixed(0)}%.
          </p>
        )}
        <p style={{ margin: "6px 0 0" }}>
          {cost.calls} model calls and {cost.templated} lines rendered from templates this session.{cost.perSimDay !== undefined ? ` About ${usd(cost.perSimDay)} per sim day.` : ""}
        </p>
      </div>
      <table className="cost-table">
        <thead>
          <tr><th>Faculty</th><th>Calls</th><th>Templated</th><th>Dollars</th></tr>
        </thead>
        <tbody>
          {rows.map(([f, b]) => (
            <tr key={f}><td>{f}</td><td className="n">{b.calls}</td><td className="n">{b.templated || ""}</td><td className="n">{usd(b.usd)}</td></tr>
          ))}
        </tbody>
      </table>
      <table className="cost-table">
        <thead>
          <tr><th>Model</th><th>Calls</th><th>Dollars</th></tr>
        </thead>
        <tbody>
          {Object.entries(cost.byModel).map(([m, b]) => (
            <tr key={m}><td>{m}</td><td className="n">{b.calls}</td><td className="n">{usd(b.usd)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Events({ busy, names, village, onSend }: { busy: boolean; names: Record<string, string>; village: boolean; onSend: (i: WorldInput) => void }) {
  if (village)
    return (
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "storm" } })}>A storm hits</button>
        <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "blight" } })}>Blight in the barley</button>
        <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "pledge" } })}>Ask for the store pledge now</button>
        <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "gathering" } })}>Everyone to the fire circle</button>
        <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "catch", who: "mara" } })}>{names.mara} lands a huge catch</button>
      </div>
    );
  return (
    <div className="row">
      <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "storm" } })}>A storm hits</button>
      <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "gathering" } })}>Wren calls everyone to the Gull</button>
      <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "catch", who: "mara" } })}>{names.mara} lands a huge catch</button>
      <button className="btn" disabled={busy} onClick={() => onSend({ type: "inject", event: { kind: "catch", who: "jun" } })}>{names.jun} lands a huge catch</button>
    </div>
  );
}

function Talk({ busy, view, onSend }: { busy: boolean; view: WorldView; onSend: (i: WorldInput) => void }) {
  const [to, setTo] = useState(view.order[0]!);
  const [text, setText] = useState("");
  const who = view.agents.find((a) => a.id === to)!;
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSend({ type: "say", to, text: text.trim() });
      }}
    >
      <span className="small">You are a visitor on the island.</span>
      <select aria-label="Who to talk to" value={to} onChange={(e) => setTo(e.target.value)}>
        {view.agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.activity})</option>)}
      </select>
      <input type="text" aria-label="What to say" placeholder={`Say something to ${who.name}`} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn primary" disabled={busy || !text.trim() || who.activity === "asleep"}>{who.activity === "asleep" ? "Asleep" : "Say it"}</button>
    </form>
  );
}

const RUMOR_IDEAS: { subject: string; text: string; valence: number }[] = [
  { subject: "corran", text: "Corran is selling the fish shed and leaving the island", valence: -0.5 },
  { subject: "theo", text: "Theo is sweet on Mara", valence: 0.2 },
  { subject: "wren", text: "Wren waters down the beer", valence: -0.5 },
  { subject: "jun", text: "Jun still owes the mainland bank for her skiff", valence: -0.35 },
  { subject: "mara", text: "Mara's father is worse than she lets on", valence: -0.3 },
];

function PlantRumor({ busy, view, onSend }: { busy: boolean; view: WorldView; onSend: (i: WorldInput) => void }) {
  const [teller, setTeller] = useState("corran");
  const [idea, setIdea] = useState(0);
  const [text, setText] = useState(RUMOR_IDEAS[0]!.text);
  const [subject, setSubject] = useState(RUMOR_IDEAS[0]!.subject);
  const [valence, setValence] = useState(RUMOR_IDEAS[0]!.valence);
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() && subject !== teller) onSend({ type: "inject", event: { kind: "rumor", teller, subject, text: text.trim(), valence } });
      }}
    >
      <span className="small">A stranger off the ferry tells</span>
      <select aria-label="Who hears it first" value={teller} onChange={(e) => setTeller(e.target.value)}>
        {view.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select
        aria-label="Rumor"
        value={idea}
        onChange={(e) => {
          const i = Number(e.target.value);
          setIdea(i);
          if (i >= 0) {
            setText(RUMOR_IDEAS[i]!.text);
            setSubject(RUMOR_IDEAS[i]!.subject);
            setValence(RUMOR_IDEAS[i]!.valence);
          }
        }}
      >
        {RUMOR_IDEAS.map((r, i) => <option key={i} value={i}>{r.text}</option>)}
        <option value={-1}>Write your own...</option>
      </select>
      {idea < 0 && (
        <>
          <input type="text" aria-label="Rumor text" placeholder="Theo owes Corran money" value={text} onChange={(e) => setText(e.target.value)} />
          <select aria-label="About" value={subject} onChange={(e) => setSubject(e.target.value)}>
            {view.agents.map((a) => <option key={a.id} value={a.id}>about {a.name}</option>)}
          </select>
          <select aria-label="Tone" value={valence} onChange={(e) => setValence(Number(e.target.value))}>
            <option value={-0.6}>damaging</option>
            <option value={-0.3}>unflattering</option>
            <option value={0.3}>flattering</option>
          </select>
        </>
      )}
      <button className="btn primary" disabled={busy || !text.trim() || subject === teller}>{subject === teller ? "Pick someone else to tell" : "Plant it"}</button>
    </form>
  );
}
