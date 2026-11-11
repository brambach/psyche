// Psyche Live: the game shell. The world fills the screen and runs on its own; everything else floats
// over it. A director cuts to whatever matters most until you take the camera. Notices tell you what
// happened (and what is about to), the strip at the bottom keeps the feed and the chronicle, and anyone's
// mind opens in a drawer on the right. The lab (#/lab) keeps every analysis view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isNight, worldCode } from "@psyche/engine";
import { api, type EditReach, type GameView } from "./api";
import { AgentPanel } from "./AgentPanel";
import { CivChip, CivPanel } from "./Civ";
import { HeresyChip, HeresyPanel } from "./Heresy";
import { Coast3D } from "./Coast3D";
import { MindEditor } from "./MindEditor";
import { Nested } from "./Nested";
import { Life } from "./persona/Life";
import { personaApi } from "./persona/api";
import { Studio } from "./persona/Studio";
import { useGameStream } from "./stream";
import { Town3D, type Shot, type Stage } from "./Town3D";
import { Lineage, VoicePanel } from "./Voice";
import { agentColors, clock, setPlaces } from "./util";
import { PhotoBar, type Look } from "./polish/Photo";
import { SkyDial } from "./polish/SkyDial";
import { Worlds } from "./polish/Worlds";
import "./polish/polish.css";
import { WalkIn } from "./you/Walk";

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
  const [mind, setMind] = useState<{ id: string; trace?: string; edit?: boolean; ripple?: string; life?: boolean }>();
  // Bringing someone in from their own writing, and who here came that way.
  const [studio, setStudio] = useState(false);
  const [personas, setPersonas] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"town" | "coast">("town");
  const [director, setDirector] = useState(() => localGet("psyche.director") !== "0");
  const [shot, setShot] = useState<Shot>();
  const [focusReq, setFocusReq] = useState<{ id: string; n: number }>();
  const [strip, setStrip] = useState<Strip | "">(() => (localGet("psyche.strip") as Strip | "") ?? "feed");
  const [menu, setMenu] = useState(false);
  // The town's sounds (off until asked for), and photo mode with the light and weather it is showing.
  const [sound, setSound] = useState(() => localGet("psyche.sound") === "1");
  const [photo, setPhoto] = useState(false);
  const [look, setLook] = useState<Look>({});
  const [heresy, setHeresy] = useState(false);
  const [civ, setCiv] = useState(false);
  const [nested, setNested] = useState(false);
  // Speaking into the world (voice), and the word whose lineage is open.
  const [voice, setVoice] = useState(false);
  // Walking in the town yourself (you/Walk.tsx): the director lets go of the camera and WASD moves you.
  const [walking, setWalking] = useState(false);
  const [stage, setStage] = useState<Stage>();
  const [traceWord, setTraceWord] = useState<string>();
  const [toasts, setToasts] = useState<{ id: string; text: string; kind: string; town?: string; agent?: string; at: number }[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const seenNotices = useRef<Set<string> | undefined>(undefined);
  // A town switch waits for the new town's scene before flying to someone in it.
  const pendingFocus = useRef<{ town: string; agent: string } | undefined>(undefined);

  // A link from the history explorer opens someone's brain scan at a moment: #/?mind=<id>&trace=<trace>.
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const id = q.get("mind");
    if (!id) return;
    setMind({ id, trace: q.get("trace") ?? undefined });
    history.replaceState(null, "", "#/");
  }, []);
  useEffect(() => localSet("psyche.director", director ? "1" : "0"), [director]);
  useEffect(() => localSet("psyche.strip", strip), [strip]);
  useEffect(() => localSet("psyche.sound", sound ? "1" : "0"), [sound]);

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
      else if (walking && /^[wasdeqm]$/i.test(e.key)) return; // these move you while you walk
      else if (e.key === "d" || e.key === "D") setDirector((d) => !d);
      else if ((e.key === "m" || e.key === "M") && view.towns) setMode((m) => (m === "town" ? "coast" : "town"));
      else if (e.key === "p" || e.key === "P") setPhoto((x) => !x);
      else if (e.key === "Escape") {
        if (nested) return;
        if (photo) setPhoto(false);
        else if (walking && !mind && !menu && !traceWord) return; // Esc closes the walk menu (Walk.tsx)
        else if (menu) setMenu(false);
        else if (traceWord) setTraceWord(undefined);
        else setMind(undefined);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [view, act, menu, traceWord, nested, photo, walking, mind]);

  // Looking at another town puts you back above it: your body stays where you left it.
  useEffect(() => setWalking(false), [view?.town]);

  const peopleKey = `${view?.town ?? ""}:${view?.agents?.length ?? 0}`;
  useEffect(() => {
    let live = true;
    personaApi.list().then((r) => live && setPersonas(new Set(r.personas.filter((p) => p.alive).map((p) => p.id))), () => undefined);
    return () => {
      live = false;
    };
  }, [peopleKey]);

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
  // You can only walk a town you are looking at.
  const strolling = walking && village && mode === "town" && !nested;
  const lagging = view.running && view.speed > 16 && view.pace > 0 && view.pace < view.speed * 0.6;

  return (
    <div className={`game${night ? " g-night" : ""}${photo ? " g-photo" : ""}${strolling ? " g-walking" : ""}`}>
      <style>{colors}</style>
      <div className="g-stage">
        {nested ? null : mode === "coast" && view.towns ? (
          <Coast3D game seed={view.seed} current={view.town} onVisit={(t) => { setMode("town"); void act(() => api.town(t)); }} />
        ) : village ? (
          <Town3D
            key={view.town ?? "town"}
            game
            pushed
            scene={view.scene}
            beats={view.beats}
            director={director && !photo && !strolling}
            sound={sound}
            look={photo ? look : undefined}
            onShot={setShot}
            onStage={setStage}
            focusReq={focusReq}
            onOpen={(id) => setMind({ id })}
          />
        ) : (
          <div className="g-empty">
            <p>{view.name} has no 3D view. The live game runs in a village or a region of towns.</p>
            <button className="g-btn primary" disabled={busy} onClick={() => act(() => api.reset({ scenario: "region" }))}>Start a civilization</button>
          </div>
        )}
        <div className="g-vignette" aria-hidden="true" />
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
          </span>
          {card && <SkyDial seed={view.scene?.seed ?? view.seed} tick={view.tick} season={card.season} weather={card.weather} />}
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
          {view.civ && <CivChip summary={view.civ} open={civ} onOpen={() => { setCiv(!civ); setHeresy(false); }} />}
          {view.heresy && <HeresyChip summary={view.heresy} open={heresy} onOpen={() => { setHeresy(!heresy); setCiv(false); }} />}
          {view.engines && view.engines.length > 0 && (
            <button className={`g-btn ${nested ? "on" : ""}`} onClick={() => setNested(!nested)} title="Engines the towns have built, and the worlds running inside them">
              ⊚ Worlds inside{view.engines.some((e) => e.depth > 0) ? ` · ${Math.max(...view.engines.map((e) => e.depth))} deep` : ""}
            </button>
          )}
          {village && mode === "town" && !nested && (
            <button className={`g-btn ${walking ? "on" : "primary"}`} aria-pressed={walking} onClick={() => { setVoice(false); setWalking(!walking); }} title="Step into the town yourself: walk around, talk, trade, help, make trouble, and see how each mind takes it">
              {walking ? "🚶 Walking" : view.you ? "🚶 Walk back in" : "🚶 Walk in"}
            </button>
          )}
          {village && (
            <button className={`g-btn ${voice ? "on" : ""}`} aria-pressed={voice} onClick={() => { setWalking(false); setVoice(!voice); }} title="Speak into the world: as a stranger, a prophet, a voice from the sky, or a dream">
              🗣 Speak
            </button>
          )}
          {village && (
            <button className={`g-btn ${studio ? "on" : ""}`} onClick={() => setStudio(true)} title="Bring someone into the world from their own writing">
              ＋ Someone real
            </button>
          )}
          <button className={`g-btn ${director ? "on" : ""}`} aria-pressed={director} onClick={() => setDirector(!director)} title="The director cuts to whatever matters most (D)">
            🎬 Director
          </button>
          {village && (
            <button className={`g-btn ${sound ? "on" : ""}`} aria-pressed={sound} aria-label="Sound" onClick={() => setSound(!sound)} title="The town's sounds: sea, wind, rain, the fire, birds. Made in your browser, no recordings.">
              {sound ? "🔊" : "🔈"}
            </button>
          )}
          {village && (
            <button className="g-btn" aria-label="Photo mode" onClick={() => setPhoto(true)} title="Photo mode: clear the screen, pick the light, save a picture (P)">
              📷
            </button>
          )}
          <button className={`g-btn ${menu ? "on" : ""}`} aria-expanded={menu} onClick={() => setMenu(!menu)} title="Worlds: save, load, share">
            ☰
          </button>
        </div>
      </header>

      {lagging && <div className="g-lag">Running at {Math.round(view.pace / 4)}x: the town is big, and the clock goes as fast as the minds can.</div>}
      {view.fastForward && <div className="g-lag">Years passing: {Math.round(((view.fastForward.at - view.fastForward.from) / (view.fastForward.to - view.fastForward.from)) * 100)}%</div>}
      {!connected && <div className="g-lag g-warn">Lost the connection to the world. Reconnecting...</div>}
      {error && <div className="g-lag g-warn" role="alert" onClick={() => setError(undefined)}>{error}</div>}

      {card && mode === "town" && !voice && !strolling && <TownCard view={view} onGo={(t) => goTo(undefined, t)} onLook={(id) => setFocusReq({ id: `at:${id}`, n: Date.now() })} />}
      {voice && mode === "town" && village && <VoicePanel view={view} busy={busy} act={act} onClose={() => setVoice(false)} onMind={(id, trace) => setMind({ id, trace })} onTrace={setTraceWord} />}

      <div className="g-toasts" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className={`g-toast g-${t.kind}`} onClick={() => { setToasts((xs) => xs.filter((x) => x.id !== t.id)); goTo(t.agent, t.town); }}>
            <span className="g-toast-kind">{t.kind === "warning" ? "Coming" : t.kind === "chronicle" ? "History" : "Now"}</span>
            {t.text}
          </button>
        ))}
      </div>

      {director && shot && mode === "town" && !strolling && (
        <div className={`g-caption g-${shot.kind}`}>
          {shot.name && !shot.title.startsWith(shot.name) && <b>{shot.name}</b>}
          <span>{shot.title}</span>
          {shot.text && <small>{shot.text}</small>}
          {shot.agent && <button onClick={() => setMind({ id: shot.agent! })}>Open their mind</button>}
        </div>
      )}
      {director && !shot && mode === "town" && village && !strolling && <div className="g-caption g-hands">You have the camera. The director takes it back after 20 seconds.</div>}

      {village && <WalkIn view={view} stage={strolling ? stage : undefined} walking={strolling} setWalking={setWalking} onMind={(id, trace) => setMind({ id, trace })} covered={!!mind || menu || !!traceWord} />}

      <BottomStrip view={view} strip={strip} setStrip={setStrip} names={names} onGo={goTo} onMind={(id, trace) => setMind({ id, trace })} onRipple={(id, ripple) => setMind({ id, edit: true, ripple })} />

      {heresy && <HeresyPanel tick={view.tick} onMind={(id, trace) => setMind({ id, trace })} onClose={() => setHeresy(false)} />}
      {civ && view.civ && <CivPanel tick={view.tick} onMind={(id, trace) => setMind({ id, trace })} onClose={() => setCiv(false)} />}

      {mind && (
        <aside className="g-mind" aria-label={`Inside ${names[mind.id] ?? mind.id}'s head`}>
          <div className="g-mind-bar">
            <div className="g-seg" role="tablist">
              <button role="tab" aria-selected={!mind.edit && !mind.life} className={!mind.edit && !mind.life ? "on" : ""} onClick={() => setMind({ id: mind.id, trace: mind.trace })}>Their mind</button>
              {personas.has(mind.id) && <button role="tab" aria-selected={!!mind.life} className={mind.life ? "on" : ""} onClick={() => setMind({ id: mind.id, life: true })} title="Who they were when they came, from their own writing, and what it has shaped since">Their writing</button>}
              <button role="tab" aria-selected={!!mind.edit} className={mind.edit ? "on" : ""} onClick={() => setMind({ id: mind.id, edit: true })}>Change them</button>
            </div>
            <button className="g-btn" onClick={() => goTo(mind.id)}>Find in town</button>
            <button className="g-btn" onClick={() => setMind(undefined)} aria-label="Close">✕</button>
          </div>
          {mind.edit ? (
            <MindEditor key={`${mind.id}|${mind.ripple ?? ""}`} id={mind.id} names={names} ripple={mind.ripple} />
          ) : mind.life && personas.has(mind.id) ? (
            <Life key={mind.id} id={mind.id} tick={mindTick} names={names} onOpen={(id, t) => setMind({ id, trace: t })} />
          ) : (
            <AgentPanel key={mind.id} id={mind.id} tick={mindTick} names={names} trace={mind.trace} onTrace={(t) => setMind({ id: mind.id, trace: t })} onOpen={(id, t) => setMind({ id, trace: t })} />
          )}
        </aside>
      )}

      {nested && (
        <Nested
          engines={view.engines ?? []}
          onClose={() => setNested(false)}
          onMind={(id, t) => {
            setNested(false);
            if (t !== view.town) goTo(id, t);
            setMind({ id });
          }}
        />
      )}
      {traceWord && <Lineage id={traceWord} tick={view.tick} onClose={() => setTraceWord(undefined)} onMind={(id, trace) => setMind({ id, trace })} />}

      {menu && <Worlds view={view} busy={busy} act={act} onClose={() => setMenu(false)} />}
      {photo && village && (
        <PhotoBar
          look={look}
          setLook={setLook}
          onClose={() => setPhoto(false)}
          caption={{ title: view.name, line: `${card ? `Year ${view.year ?? card.year}, ${card.season} · ` : ""}${card?.people ?? view.agents?.length ?? 0} people`, code: worldCode(view.scenario, view.seed) }}
        />
      )}
      {studio && (
        <Studio
          town={view.name}
          faculties={view.faculties}
          onClose={() => setStudio(false)}
          onArrived={(id) => {
            setStudio(false);
            setPersonas((s) => new Set([...s, id]));
            setMind({ id, life: true });
            goTo(id);
          }}
        />
      )}
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

function TownCard({ view, onGo, onLook }: { view: GameView; onGo: (town: string) => void; onLook: (structure: string) => void }) {
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
            {c.works?.length > 0 && (
              <>
                <dt>Built together</dt>
                <dd className="g-works">
                  {c.works.map((wk) => (
                    <button key={wk.id} className={`g-work w-${wk.status}`} onClick={() => onLook(wk.id)} title={`${wk.proposerName ?? "Someone"} asked for it, with ${wk.why} on their mind. ${wk.does} Click to look at it.`}>
                      {wk.status === "ruin" ? `ruins of ${wk.name}` : wk.status === "building" ? `${wk.name} ${Math.round(wk.progress * 100)}%` : wk.mending ? `${wk.name} (being mended)` : wk.condition < 0.55 ? `${wk.name} (worn)` : wk.name}
                    </button>
                  ))}
                </dd>
              </>
            )}
            {c.plans?.length > 0 && (
              <>
                <dt>This {c.season}</dt>
                <dd>{c.plans.slice(0, 4).map((p) => `${p.n} ${p.text}`).join(", ")}</dd>
              </>
            )}
            <dt>Common store</dt>
            <dd>{c.store} food put by</dd>
            {c.money && c.money.deals.give + c.money.deals.lend + c.money.deals.sell + c.money.deals.refuse > 0 && (
              <>
                <dt>Between households</dt>
                <dd>
                  {c.money.deals.give} given, {c.money.deals.lend} lent, {c.money.deals.sell} sold for {c.money.good}, {c.money.deals.refuse} turned away
                  {c.money.owed > 0 && <span className="g-sub">{c.money.owed} debts open{c.money.overdue ? `, ${c.money.overdue} past due` : ""}</span>}
                </dd>
                <dt>Money</dt>
                <dd>{c.money.established ? `${c.money.good} is money: ${Math.round(c.money.share * 100)}% take it` : `none yet; ${Math.round(c.money.share * 100)}% would take ${c.money.good}`}</dd>
              </>
            )}
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
        <span className="g-keys">Space pause · 1 to 4 speed · D director{view.towns ? " · M coast" : ""} · P photo</span>
        <a href="#/history" className="g-lab" title="The causal history: every kept choice on one timeline, and the why behind each, walked back through the years">History →</a>
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
