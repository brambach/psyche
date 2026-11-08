// Psyche Live: the game shell. The world fills the screen and runs on its own; everything else floats
// over it. A director cuts to whatever matters most until you take the camera. Notices tell you what
// happened (and what is about to), the strip at the bottom keeps the feed and the chronicle, and anyone's
// mind opens in a drawer on the right. The lab (#/lab) keeps every analysis view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isNight } from "@psyche/engine";
import { api, type EditReach, type GameView, type Slot } from "./api";
import { AgentPanel } from "./AgentPanel";
import { Coast3D } from "./Coast3D";
import { MindEditor } from "./MindEditor";
import { useGameStream } from "./stream";
import { Town3D, type Shot } from "./Town3D";
import { agentColors, clock, setPlaces } from "./util";

/** The clock's speeds, in sim minutes a real second. 1x is a sim day in about four real minutes. */
export const GAME_SPEEDS = [
  { label: "1x", value: 4, title: "A sim day in about four real minutes" },
  { label: "4x", value: 16, title: "A sim day a minute" },
  { label: "10x", value: 40, title: "Speech on the free offline mock" },
  { label: "100x", value: 400, title: "Seasons fly by. Speech on the free offline mock" },
];

const usd = (x: number) => (x < 0.01 && x > 0 ? "<$0.01" : `$${x < 1 ? x.toFixed(2) : x.toFixed(x < 10 ? 2 : 0)}`);
const SEASON_ICON: Record<string, string> = { spring: "🌱", summer: "☀️", autumn: "🍂", winter: "❄️" };

type Strip = "feed" | "chronicle" | "notices" | "changes";

export function Game() {
  const { view, connected, away, dismissAway } = useGameStream();
  const [mind, setMind] = useState<{ id: string; trace?: string; edit?: boolean; ripple?: string }>();
  const [mode, setMode] = useState<"town" | "coast">("town");
  const [director, setDirector] = useState(() => localGet("psyche.director") !== "0");
  const [shot, setShot] = useState<Shot>();
  const [focusReq, setFocusReq] = useState<{ id: string; n: number }>();
  const [strip, setStrip] = useState<Strip | "">(() => (localGet("psyche.strip") as Strip | "") ?? "feed");
  const [menu, setMenu] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; text: string; kind: string; town?: string; agent?: string; at: number }[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const seenNotices = useRef<Set<string> | undefined>(undefined);
  // A town switch waits for the new town's scene before flying to someone in it.
  const pendingFocus = useRef<{ town: string; agent: string } | undefined>(undefined);

  useEffect(() => localSet("psyche.director", director ? "1" : "0"), [director]);
  useEffect(() => localSet("psyche.strip", strip), [strip]);

  const act = useCallback(async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // New notices become toasts; the ones already there when you arrived do not.
  useEffect(() => {
    if (!view?.notices) return;
    if (!seenNotices.current) {
      seenNotices.current = new Set(view.notices.map((n) => n.id));
      return;
    }
    const fresh = view.notices.filter((n) => !seenNotices.current!.has(n.id));
    if (!fresh.length) return;
    for (const n of fresh) seenNotices.current.add(n.id);
    setToasts((t) => [...fresh.slice(-3).map((n) => ({ id: n.id, text: n.text, kind: n.kind, town: n.town, agent: n.agent, at: Date.now() })), ...t].slice(0, 4));
  }, [view?.notices]);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setInterval(() => setToasts((xs) => xs.filter((x) => Date.now() - x.at < (x.kind === "warning" ? 14000 : 10000))), 1000);
    return () => clearInterval(t);
  }, [toasts.length]);

  // Whoever's mind is open speaks with the model however small the moment (L0).
  useEffect(() => {
    void api.focus(mind ? [mind.id] : []).catch(() => undefined);
  }, [mind]);

  /** Fly to someone, switching towns first if they live elsewhere. */
  const goTo = useCallback(
    (agent: string | undefined, town?: string) => {
      if (!view) return;
      if (town && view.town && town !== view.town) {
        if (agent) pendingFocus.current = { town, agent };
        setMode("town");
        void act(() => api.town(town));
        return;
      }
      setMode("town");
      if (agent) setFocusReq({ id: agent, n: Date.now() });
    },
    [view, act],
  );
  useEffect(() => {
    const p = pendingFocus.current;
    if (p && view?.town === p.town && view.scene?.people.some((x) => x.id === p.agent)) {
      pendingFocus.current = undefined;
      setFocusReq({ id: p.agent, n: Date.now() });
    }
  }, [view?.town, view?.scene]);

  // Keys: space plays and pauses, 1 to 4 set the speed, D the director, M the coast map, Esc closes.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!view || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === " ") {
        e.preventDefault();
        void act(() => api.control({ running: !view.running }));
      } else if (/^[1-4]$/.test(e.key)) void act(() => api.control({ speed: GAME_SPEEDS[Number(e.key) - 1]!.value, running: true }));
      else if (e.key === "d" || e.key === "D") setDirector((d) => !d);
      else if ((e.key === "m" || e.key === "M") && view.towns) setMode((m) => (m === "town" ? "coast" : "town"));
      else if (e.key === "Escape") {
        if (menu) setMenu(false);
        else setMind(undefined);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [view, act, menu]);

  const names = useMemo(() => Object.fromEntries((view?.agents ?? []).map((a) => [a.id, a.name])), [view?.agents]);
  const order = useMemo(() => (view?.agents ?? []).map((a) => a.id), [view?.agents]);
  const colors = useMemo(() => agentColors(order), [order]);
  // The mind drawer reads the mind again every half sim hour, not every tick.
  const mindTick = view ? Math.floor(view.tick / 30) * 30 : 0;

  if (!view) {
    return (
      <div className="game g-loading">
        <div>
          <b>Psyche</b>
          <span>{connected ? "Waking the world..." : "Connecting to the world..."}</span>
          <a href="#/lab">Open the lab instead</a>
        </div>
      </div>
    );
  }
  setPlaces(view.places);
  const card = view.card;
  const night = isNight(view.tick);
  const village = !!view.scene;
  const free = view.free ?? (view.faculties === "mock" ? "mock" : undefined);
  const lagging = view.running && view.speed > 16 && view.pace > 0 && view.pace < view.speed * 0.6;

  return (
    <div className={`game${night ? " g-night" : ""}`}>
      <style>{colors}</style>
      <div className="g-stage">
        {mode === "coast" && view.towns ? (
          <Coast3D game seed={view.seed} current={view.town} onVisit={(t) => { setMode("town"); void act(() => api.town(t)); }} />
        ) : village ? (
          <Town3D
            key={view.town ?? "town"}
            game
            pushed
            scene={view.scene}
            beats={view.beats}
            director={director}
            onShot={setShot}
            focusReq={focusReq}
            onOpen={(id) => setMind({ id })}
          />
        ) : (
          <div className="g-empty">
            <p>{view.name} has no 3D view. The live game runs in a village or a region of towns.</p>
            <button className="g-btn primary" disabled={busy} onClick={() => act(() => api.reset({ scenario: "region" }))}>Start a civilization</button>
          </div>
        )}
      </div>

      <header className="g-top">
        <div className="g-title">
          <a className="g-brand" href="#/" title="Psyche Live">Psyche</a>
          {view.towns && view.towns.length > 1 ? (
            <select className="g-select" aria-label="Town to watch" value={view.town} disabled={busy} onChange={(e) => { setMind(undefined); setMode("town"); void act(() => api.town(e.target.value)); }}>
              {view.towns.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.people}</option>)}
            </select>
          ) : (
            <span className="g-name">{view.name}</span>
          )}
          <span className="g-clock">
            {card && <>Year {view.year ?? card.year} · {SEASON_ICON[card.season] ?? ""} {card.season} · </>}
            {clock(view.tick)}
            {card && card.weather !== "fair" ? ` · ${card.weather}` : ""}
          </span>
        </div>
        <div className="g-controls">
          <div className="g-transport" role="group" aria-label="Time">
            <button className={`g-btn ${view.running ? "" : "on"}`} onClick={() => act(() => api.control({ running: !view.running }))} title="Space">
              {view.running ? "❚❚ Pause" : "▶ Play"}
            </button>
            {GAME_SPEEDS.map((s, i) => (
              <button key={s.value} className={`g-btn ${view.speed === s.value && view.running ? "on" : ""}`} aria-pressed={view.speed === s.value} title={`${s.title} (key ${i + 1})`} onClick={() => act(() => api.control({ speed: s.value, running: true }))}>
                {s.label}
              </button>
            ))}
          </div>
          <CostChip view={view} free={free} />
          {view.towns && (
            <button className={`g-btn ${mode === "coast" ? "on" : ""}`} onClick={() => setMode(mode === "town" ? "coast" : "town")} title="The whole coast (M)">
              {mode === "coast" ? "Back to town" : "Whole coast"}
            </button>
          )}
          <button className={`g-btn ${director ? "on" : ""}`} aria-pressed={director} onClick={() => setDirector(!director)} title="The director cuts to whatever matters most (D)">
            🎬 Director
          </button>
          <button className={`g-btn ${menu ? "on" : ""}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            ☰
          </button>
        </div>
      </header>

      {lagging && <div className="g-lag">Running at {Math.round(view.pace / 4)}x: the town is big, and the clock goes as fast as the minds can.</div>}
      {view.fastForward && <div className="g-lag">Years passing: {Math.round(((view.fastForward.at - view.fastForward.from) / (view.fastForward.to - view.fastForward.from)) * 100)}%</div>}
      {!connected && <div className="g-lag g-warn">Lost the connection to the world. Reconnecting...</div>}
      {error && <div className="g-lag g-warn" role="alert" onClick={() => setError(undefined)}>{error}</div>}

      {card && mode === "town" && <TownCard view={view} onGo={(t) => goTo(undefined, t)} />}

      <div className="g-toasts" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className={`g-toast g-${t.kind}`} onClick={() => { setToasts((xs) => xs.filter((x) => x.id !== t.id)); goTo(t.agent, t.town); }}>
            <span className="g-toast-kind">{t.kind === "warning" ? "Coming" : t.kind === "chronicle" ? "History" : "Now"}</span>
            {t.text}
          </button>
        ))}
      </div>

      {director && shot && mode === "town" && (
        <div className={`g-caption g-${shot.kind}`}>
          {shot.name && !shot.title.startsWith(shot.name) && <b>{shot.name}</b>}
          <span>{shot.title}</span>
          {shot.text && <small>{shot.text}</small>}
          {shot.agent && <button onClick={() => setMind({ id: shot.agent! })}>Open their mind</button>}
        </div>
      )}
      {director && !shot && mode === "town" && village && <div className="g-caption g-hands">You have the camera. The director takes it back after 20 seconds.</div>}

      <BottomStrip view={view} strip={strip} setStrip={setStrip} names={names} onGo={goTo} onMind={(id, trace) => setMind({ id, trace })} onRipple={(id, ripple) => setMind({ id, edit: true, ripple })} />

      {mind && (
        <aside className="g-mind" aria-label={`Inside ${names[mind.id] ?? mind.id}'s head`}>
          <div className="g-mind-bar">
            <div className="g-seg" role="tablist">
              <button role="tab" aria-selected={!mind.edit} className={!mind.edit ? "on" : ""} onClick={() => setMind({ id: mind.id, trace: mind.trace })}>Their mind</button>
              <button role="tab" aria-selected={!!mind.edit} className={mind.edit ? "on" : ""} onClick={() => setMind({ id: mind.id, edit: true })}>Change them</button>
            </div>
            <button className="g-btn" onClick={() => goTo(mind.id)}>Find in town</button>
            <button className="g-btn" onClick={() => setMind(undefined)} aria-label="Close">✕</button>
          </div>
          {mind.edit ? (
            <MindEditor key={`${mind.id}|${mind.ripple ?? ""}`} id={mind.id} names={names} ripple={mind.ripple} />
          ) : (
            <AgentPanel key={mind.id} id={mind.id} tick={mindTick} names={names} trace={mind.trace} onTrace={(t) => setMind({ id: mind.id, trace: t })} onOpen={(id, t) => setMind({ id, trace: t })} />
          )}
        </aside>
      )}

      {menu && <Menu view={view} busy={busy} act={act} onClose={() => setMenu(false)} />}
      {away && <Away away={away} onClose={dismissAway} />}
    </div>
  );
}

function CostChip({ view, free }: { view: GameView; free?: string }) {
  const c = view.cost;
  if (view.faculties === "mock") {
    return (
      <span className="g-chip" title="No API key here: speech comes from the offline mock, free. The minds underneath are the same. The estimate is what showcase play would cost on Claude at 1x.">
        Offline mock · free{c.perHourAt1x !== undefined ? ` · on Claude ≈${usd(c.perHourAt1x)}/hr` : ""}
      </span>
    );
  }
  return (
    <span className={`g-chip ${c.level}`} title={`Today ${usd(c.todayUsd)} of the $${c.capUsd} daily cap. ${free === "fast" ? "Above 4x, speech is on the free mock." : free === "away" ? "Nobody watching: speech is on the free mock." : ""}`}>
      {usd(c.todayUsd)} of ${c.capUsd} today · {free ? "free at this speed" : c.perHour !== undefined ? `≈${usd(c.perHour)}/hr` : "measuring..."}
    </span>
  );
}

function TownCard({ view, onGo }: { view: GameView; onGo: (town: string) => void }) {
  const c = view.card!;
  const here = view.towns?.find((t) => t.id === view.town);
  // On a phone the card starts folded, so the town has the screen.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 720);
  return (
    <aside className={`g-card ${open ? "" : "shut"}`}>
      <button className="g-card-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>{view.name}</b>
        <span>{c.people} people{c.children ? `, ${c.children} children` : ""}</span>
      </button>
      {open && (
        <div className="g-card-body">
          <dl>
            <dt>Led by</dt>
            <dd>{c.leaderName ?? "nobody yet"}</dd>
            <dt>Homes</dt>
            <dd>{c.houses} houses, {c.tents} in tents</dd>
            {c.building.length > 0 && (
              <>
                <dt>Going up</dt>
                <dd>{c.building.map((b) => `${b.name} ${Math.round(b.progress * 100)}%`).join(", ")}</dd>
              </>
            )}
            <dt>Common store</dt>
            <dd>{c.store} food put by</dd>
            {c.laws > 0 && (
              <>
                <dt>Laws</dt>
                <dd>{c.laws}</dd>
              </>
            )}
            {c.norms.length > 0 && (
              <>
                <dt>Expected</dt>
                <dd>{c.norms.join("; ")}</dd>
              </>
            )}
            {here && here.crafts.length > 0 && (
              <>
                <dt>Crafts</dt>
                <dd>{here.crafts.join(", ")}</dd>
              </>
            )}
            {here && here.lost.length > 0 && (
              <>
                <dt>Lost</dt>
                <dd className="g-lost">{here.lost.join(", ")}</dd>
              </>
            )}
          </dl>
          {view.towns && view.towns.length > 1 && (
            <div className="g-towns">
              {view.towns.map((t) => (
                <button key={t.id} className={t.id === view.town ? "on" : ""} onClick={() => onGo(t.id)} title={`${t.people} people${t.leaderName ? `, led by ${t.leaderName}` : ""}. ${t.tier === "live" ? "Running live." : "Running on rules until you go there."}`}>
                  <span>{t.name}</span>
                  <span>{t.people}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function BottomStrip({ view, strip, setStrip, names, onGo, onMind, onRipple }: { view: GameView; strip: Strip | ""; setStrip: (s: Strip | "") => void; names: Record<string, string>; onGo: (agent?: string, town?: string) => void; onMind: (id: string, trace?: string) => void; onRipple: (agent: string, edit: string) => void }) {
  const tabs: [Strip, string][] = [["feed", "What's happening"], ...(view.chronicle ? ([["chronicle", "Chronicle"]] as [Strip, string][]) : []), ["notices", `Notices${view.notices?.length ? ` (${view.notices.length})` : ""}`], ["changes", "Your changes"]];
  return (
    <section className={`g-strip ${strip ? "" : "shut"}`}>
      <div className="g-strip-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={strip === k} className={strip === k ? "on" : ""} onClick={() => setStrip(strip === k ? "" : k)}>
            {label}
          </button>
        ))}
        <span className="g-keys">Space pause · 1 to 4 speed · D director{view.towns ? " · M coast" : ""}</span>
        <a href="#/lab" className="g-lab" title="Every analysis view: stories going round, who feels what, fears across generations, how each town tells it">Lab →</a>
      </div>
      {strip === "feed" && (
        <ol className="g-feed">
          {(view.feed ?? []).filter((f) => f.kind !== "move").slice(0, 30).map((f) => (
            <li key={f.id} className={`g-feed-${f.kind}`}>
              <button className="g-feed-go" onClick={() => onGo(f.agents[0])} disabled={!f.agents[0]}>
                <time>{clock(f.tick).replace(/^Day \d+ · /, "")}</time>
                <span>{f.title}</span>
                {f.line && <q>{f.line.text}</q>}
              </button>
              {f.agents[0] && names[f.agents[0]] && <button className="g-mini" onClick={() => onMind(f.agents[0]!, f.refs?.[0]?.trace)} title={`Open ${names[f.agents[0]]}'s mind at this moment`}>mind</button>}
            </li>
          ))}
        </ol>
      )}
      {strip === "chronicle" && (
        <ol className="g-feed">
          {(view.chronicle ?? []).slice(0, 30).map((e, i) => (
            <li key={`${e.tick}-${i}`} className={`g-chron-${e.kind}`}>
              <button className="g-feed-go" onClick={() => onGo(e.agents?.[0], e.town)}>
                <time>Year {e.year}</time>
                <span>{e.text}</span>
              </button>
            </li>
          ))}
          {!view.chronicle?.length && <li className="g-quiet">Nothing for the history books yet.</li>}
        </ol>
      )}
      {strip === "notices" && (
        <ol className="g-feed">
          {[...(view.notices ?? [])].reverse().map((n) => (
            <li key={n.id} className={`g-${n.kind}`}>
              <button className="g-feed-go" onClick={() => onGo(n.agent, n.town)}>
                <time>{clock(n.tick).replace(/ · .*/, "")}</time>
                <span>{n.text}</span>
              </button>
            </li>
          ))}
          {!view.notices?.length && <li className="g-quiet">Nothing to report yet. Notices tell you when a leader is chosen, a craft is down to its last keeper, or a town is about to split.</li>}
        </ol>
      )}
      {strip === "changes" && <Changes tick={Math.floor(view.tick / 60)} onMind={onMind} onRipple={onRipple} />}
    </section>
  );
}

/** What you have changed in people here, and how many of their choices each change has bent since. */
function Changes({ tick, onMind, onRipple }: { tick: number; onMind: (id: string, trace?: string) => void; onRipple: (agent: string, edit: string) => void }) {
  const [edits, setEdits] = useState<EditReach[]>();
  useEffect(() => {
    let live = true;
    api.edits().then((r) => live && setEdits(r.edits), () => undefined);
    return () => {
      live = false;
    };
  }, [tick]);
  return (
    <ol className="g-feed">
      {(edits ?? []).map((r) => (
        <li key={r.id} className="g-change">
          <button className="g-feed-go" onClick={() => r.recent[0]?.agent && onMind(r.recent[0].agent, r.recent[0].trace)} disabled={!r.recent[0]}>
            <time>{clock(r.tick).replace(/ · .*/, "")}</time>
            <span>{r.label}</span>
            <q>{r.decisions ? `Bent ${r.decisions} choice${r.decisions === 1 ? "" : "s"} since${r.minds ? `, reaching ${r.minds} other${r.minds === 1 ? "" : "s"}` : ""}` : "Nothing traced to it yet"}</q>
          </button>
          {r.ripple && r.who[0] && <button className="g-mini" onClick={() => onRipple(r.who[0]!, r.id)} title="Run the town on from this change twice, with and without it">both ways</button>}
        </li>
      ))}
      {edits && !edits.length && <li className="g-quiet">You haven't changed anyone yet. Open someone's mind and pick "Change them": make them braver, give them a fear, make them forget, whisper a thought. Then watch what the town does with it.</li>}
    </ol>
  );
}

function Menu({ view, busy, act, onClose }: { view: GameView; busy: boolean; act: (f: () => Promise<unknown>) => Promise<void>; onClose: () => void }) {
  const [slots, setSlots] = useState<Slot[]>();
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(view.seed + 1);
  useEffect(() => {
    api.slots().then((r) => setSlots(r.slots), () => setSlots([]));
  }, []);
  const people = view.towns ? view.towns.reduce((n, t) => n + t.people, 0) : view.card?.people;
  return (
    <div className="g-menu" role="dialog" aria-label="Worlds and saves">
      <div className="g-menu-head">
        <b>Worlds</b>
        <button className="g-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="g-small">
        Now: {view.name}, year {view.year ?? "?"}, {people} people{view.towns && view.towns.length > 1 ? ` in ${view.towns.length} towns` : ""}. Seed {view.seed}. It saves itself every minute and keeps an hourly copy.
      </p>
      <form
        className="g-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void act(async () => setSlots((await api.saveSlot(name.trim())).slots)).then(() => setName(""));
        }}
      >
        <input type="text" placeholder="Name this world to save it" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Save name" />
        <button className="g-btn primary" disabled={busy || !name.trim()}>Save</button>
      </form>
      <ul className="g-slots">
        {slots?.map((s) => (
          <li key={s.name}>
            <div>
              <b>{s.name}</b>
              <span className="g-small">
                {s.year !== undefined ? `Year ${s.year}` : s.scenario}
                {s.people !== undefined ? ` · ${s.people} people` : ""}
                {s.towns && s.towns > 1 ? ` · ${s.towns} towns` : ""} · saved {new Date(s.savedAt).toLocaleString()}
              </span>
            </div>
            <button className="g-btn" disabled={busy} onClick={() => confirm(`Load "${s.name}"? The world now running is replaced (save it first if you want to keep it).`) && void act(async () => { await api.loadSlot(s.name); onClose(); })}>Load</button>
            <button className="g-btn" disabled={busy} onClick={() => confirm(`Delete the save "${s.name}"?`) && void act(async () => setSlots((await api.deleteSlot(s.name)).slots))} aria-label={`Delete ${s.name}`}>🗑</button>
          </li>
        ))}
        {slots && !slots.length && <li className="g-quiet">No saves yet. Save this world to branch it: load it later and play it out differently.</li>}
      </ul>
      <div className="g-row">
        <label className="g-small" htmlFor="g-seed">New civilization from seed</label>
        <input id="g-seed" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 90 }} />
        <button className="g-btn" disabled={busy} onClick={() => confirm(`Start a new civilization from seed ${seed}? The world now running is replaced (save it first if you want to keep it).`) && void act(async () => { await api.reset({ scenario: "region", seed }); onClose(); })}>Start</button>
      </div>
      <p className="g-small">
        <a href="#/lab">The lab</a> has every analysis view, other worlds (Kettle Island, a single village) and the mechanism switches. <a href="#/founders">Founders</a> is one mind building a house.
      </p>
    </div>
  );
}

function Away({ away, onClose }: { away: NonNullable<ReturnType<typeof useGameStream>["away"]>; onClose: () => void }) {
  const span = away.years >= 1 ? `${away.years} ${away.years === 1 ? "year" : "years"}` : `${away.days} ${away.days === 1 ? "day" : "days"}`;
  const grew = away.people.after - away.people.before;
  return (
    <div className="g-away" role="dialog" aria-label="While you were away">
      <div className="g-away-box">
        <small>While you were away</small>
        <h2>{span} went by.</h2>
        <p>
          {away.people.before} people became {away.people.after} ({grew >= 0 ? "+" : ""}
          {grew}).{" "}
          {away.towns.filter((t) => t.new).length > 0 && <>New towns: {away.towns.filter((t) => t.new).map((t) => t.name).join(", ")}. </>}
        </p>
        <ul className="g-away-towns">
          {away.towns.map((t) => (
            <li key={t.id}>
              <span>{t.name}</span>
              <span>{t.new ? "new" : t.before} → {t.after}</span>
            </li>
          ))}
        </ul>
        {away.entries.length > 0 && (
          <ol className="g-away-entries">
            {away.entries.map((e, i) => (
              <li key={i}>
                <time>Year {e.year}</time> {e.text}
              </li>
            ))}
          </ol>
        )}
        {away.total > away.entries.length && <p className="g-small">and {away.total - away.entries.length} more in the chronicle.</p>}
        <button className="g-btn primary" onClick={onClose} autoFocus>Back to the world</button>
      </div>
    </div>
  );
}

function localGet(k: string): string | undefined {
  try {
    return localStorage.getItem(k) ?? undefined;
  } catch {
    return undefined;
  }
}
function localSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window: the setting lasts until the page closes */
  }
}
