// Walking into the world yourself. The 3D body is in walker.ts; this is everything around it: giving
// yourself a name, the pack and place line at the bottom, the menu of things you can do to whoever
// you are standing with, the people who come over wanting an answer, and (the point of it all) the
// card that shows what each person made of what you just did: what they felt, what they chose and
// what tipped it, how far their liking and trust moved, and the memory they will keep.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isNight } from "@psyche/engine";
import { api, type GameView } from "../api";
import type { Stage } from "../Town3D";
import { clock } from "../util";
import { youApi, type Deed, type Reaction, type YouAct, type YouView } from "./api";
import { REACH, Walker } from "./walker";
import "./you.css";

/** The clock while you are on foot, in sim minutes a real second: a quarter of the watcher's 1x. */
const WALK_SPEED = 1;
/** And while you sleep through a night. */
const SLEEP_SPEED = 40;

const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const firstName = (n: string) => n.split(" ")[0]!;

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
    /* a private window: it lasts until the page closes */
  }
}

/** Which named place you are standing at, if any. */
function placeAt(view: GameView, x: number, z: number): string {
  let best = "away", bestD = Infinity;
  for (const p of view.scene?.places ?? []) {
    const d = Math.hypot(p.x - x, p.z - z);
    const reach = p.id.startsWith("home_") ? 10 : p.id === "woods" || p.id === "fields" ? 24 : 16;
    if (d < reach && d < bestD) {
      best = p.id;
      bestD = d;
    }
  }
  return best;
}

export function WalkIn(props: { view: GameView; stage?: Stage; walking: boolean; setWalking: (on: boolean) => void; onMind: (id: string, trace?: string) => void; /** Something is open over the town (a mind, the menu): Esc belongs to that. */ covered?: boolean }) {
  const { view, stage, walking, setWalking, onMind, covered } = props;
  const you = view.you ?? undefined;
  const [target, setTarget] = useState<string>();
  const [near, setNear] = useState<string>();
  const [tab, setTab] = useState<"now" | "people">("now");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [hidden, setHidden] = useState<string>();
  const [seenVerdict, setSeenVerdict] = useState(() => Number(localGet("psyche.you.verdict") ?? 0));
  const walker = useRef<Walker>();
  const viewRef = useRef(view);
  viewRef.current = view;
  const placeRef = useRef("");
  const targetRef = useRef<string>();
  targetRef.current = target;
  const paused = useRef(false);
  const speedBefore = useRef<number>();
  const [sleeping, setSleeping] = useState(false);
  const sleepRef = useRef(false);
  sleepRef.current = sleeping;
  const townKey = `psyche.you.at.${view.town ?? view.name}`;

  const names = useMemo(() => Object.fromEntries((view.agents ?? []).map((a) => [a.id, a.name])), [view.agents]);
  const present = !!you && you.standing !== "banished";
  const banned = you?.standing === "banished";
  const canReturn = banned && (!you!.banishedUntil || view.tick >= you!.banishedUntil);

  const run = useCallback(async (act: YouAct): Promise<Deed | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await youApi.act(act);
      if (r.deed) setHidden(undefined);
      return r.deed;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  // Your body: made when you start walking, gone when you stop.
  useEffect(() => {
    if (!walking || !stage || !present) return;
    const v = viewRef.current;
    const saved = (localGet(townKey) ?? "").split(",").map(Number);
    const spot = v.scene?.places.find((p) => p.id === v.you?.place) ?? v.scene?.places.find((p) => p.id === "harbour");
    const at = saved.length === 2 && saved.every(Number.isFinite) && saved[0]! > 0 ? { x: saved[0]!, z: saved[1]! } : { x: (spot?.x ?? 30) + 3, z: (spot?.z ?? 57) + 3 };
    const w = new Walker(stage, { name: v.you!.name, x: at.x, z: at.z, onPick: (id) => setNear(id), onArrive: (id) => setTarget(id) });
    walker.current = w;
    placeRef.current = "";
    let lastBeat = 0, lastSave = 0;
    const tick = setInterval(() => {
      const now = Date.now();
      if (sleepRef.current) return; // asleep, your body is at its camp: nothing to tell the world
      // Standing with someone, you are wherever the engine has them: the map's places overlap at the edges.
      const with_ = targetRef.current ? viewRef.current.agents?.find((a) => a.id === targetRef.current)?.place : undefined;
      const here = with_ ?? placeAt(viewRef.current, w.pos.x, w.pos.z);
      const n = w.nearest();
      setNear(n?.id);
      if (here !== placeRef.current || now - lastBeat > 5000) {
        placeRef.current = here;
        lastBeat = now;
        void youApi.beat(here).catch(() => undefined);
      }
      if (now - lastSave > 2000) {
        lastSave = now;
        localSet(townKey, `${w.pos.x.toFixed(1)},${w.pos.z.toFixed(1)}`);
      }
    }, 250);
    return () => {
      clearInterval(tick);
      w.dispose();
      walker.current = undefined;
      setTarget(undefined);
      setNear(undefined);
    };
  }, [walking, stage, present, townKey]);

  // On foot, a day at the watcher's pace would be over in four minutes: time runs at a quarter of it
  // while you walk, and goes back to what it was when you stop.
  useEffect(() => {
    if (!walking || !present) return;
    const was = viewRef.current.speed;
    if (was > WALK_SPEED) {
      speedBefore.current = was;
      void api.control({ speed: WALK_SPEED }).catch(() => undefined);
    }
  }, [walking, present]);

  // Leaving: your body rests, and time goes back to how you had it.
  useEffect(() => {
    if (walking) return;
    setSleeping(false);
    const speed = speedBefore.current;
    speedBefore.current = undefined;
    if (paused.current || speed) void api.control({ ...(paused.current ? { running: true } : {}), ...(speed ? { speed } : {}) }).catch(() => undefined);
    paused.current = false;
    if (viewRef.current.you?.here) void youApi.act({ act: "rest" }).catch(() => undefined);
  }, [walking]);

  // Sleeping through the night: the clock runs until people are up again.
  const night = isNight(view.tick);
  useEffect(() => {
    if (!sleeping) return;
    if (night) {
      void api.control({ speed: SLEEP_SPEED, running: true }).catch(() => undefined);
      return;
    }
    setSleeping(false);
    void api.control({ speed: WALK_SPEED }).catch(() => undefined);
  }, [sleeping, night]);

  // Whoever you are talking with stays put and faces you; whoever came over walks up to you.
  useEffect(() => {
    walker.current?.setHold(target ? [target] : []);
  }, [target]);
  const askId = you?.ask?.id;
  const askFrom = you?.ask?.from;
  useEffect(() => {
    walker.current?.setCompany(walking ? askFrom : undefined);
    if (!walking) return;
    // Someone is waiting on an answer: the world holds its breath until you give one.
    if (askId && viewRef.current.running) {
      paused.current = true;
      void api.control({ running: false }).catch(() => undefined);
    } else if (!askId && paused.current) {
      paused.current = false;
      void api.control({ running: true }).catch(() => undefined);
    }
  }, [askId, askFrom, walking]);

  // The person whose menu is open went to bed, or left.
  useEffect(() => {
    if (target && !view.scene?.people.some((p) => p.id === target && !p.asleep)) setTarget(undefined);
  }, [target, view.scene]);

  // E talks to whoever is nearest; Esc closes the menu.
  useEffect(() => {
    if (!walking) return;
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if ((e.key === "e" || e.key === "E") && near) {
        walker.current?.stop();
        setTarget(near);
        setTab("now");
      } else if (e.key === "Escape" && !covered) setTarget(undefined);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [walking, near, covered]);

  if (!walking) return null;

  // First time here: you need a name. Sent away: you wait.
  if (!you || banned) {
    return (
      <Arrive
        view={view}
        you={you}
        canReturn={!!canReturn}
        busy={busy}
        error={error}
        onMind={onMind}
        onCancel={() => setWalking(false)}
        onArrive={async (name) => {
          localSet("psyche.you.name", name);
          localSet(townKey, "");
          await run({ act: "arrive", name });
        }}
      />
    );
  }

  const verdict = you.verdict && you.verdict.tick > seenVerdict ? you.verdict : undefined;
  const person = target ? view.scene?.people.find((p) => p.id === target) : undefined;
  const regard = target ? you.people.find((p) => p.id === target) : undefined;
  const latest = you.deeds[0] && you.deeds[0].id !== hidden ? you.deeds[0] : undefined;
  const nearName = near && near !== target ? names[near] : undefined;

  return (
    <>
      {nearName && !you.ask && (
        <button className="y-near" onClick={() => (walker.current?.stop(), setTarget(near), setTab("now"))}>
          <kbd>E</kbd> Talk to {nearName}
        </button>
      )}

      <aside className="y-panel" aria-label="You, in the world">
        <div className="y-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "now"} className={tab === "now" ? "on" : ""} onClick={() => setTab("now")}>
            {person ? firstName(person.name) : "Here"}
          </button>
          <button role="tab" aria-selected={tab === "people"} className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>
            What they think of you
          </button>
        </div>
        {you.ask && (
          <div className="y-ask" role="dialog" aria-label={`${you.ask.name} wants an answer`}>
            <small>{you.ask.name} has come over to you. The world waits for your answer.</small>
            <q>{you.ask.line}</q>
            <div className="y-row">
              {you.ask.options.map((o) => (
                <button key={o.id} className="g-btn" disabled={busy} title={o.hint} onClick={() => void run({ act: "answer", ask: you.ask!.id, choice: o.id })}>
                  {o.label}
                </button>
              ))}
              <button className="g-mini" onClick={() => onMind(you.ask!.from)} title={`Open ${you.ask.name}'s mind`}>mind</button>
            </div>
          </div>
        )}
        {error && <p className="y-error" role="alert" onClick={() => setError(undefined)}>{error}</p>}
        {tab === "people" ? (
          <People you={you} busy={busy} run={run} onMind={onMind} onPick={(id) => (setTarget(id), setTab("now"))} />
        ) : (
          <>
            {person ? (
              <Actions key={person.id} you={you} view={view} person={person} regard={regard} busy={busy} run={run} onMind={onMind} onClose={() => setTarget(undefined)} card={latest && <DeedCard deed={latest} onMind={onMind} onClose={() => setHidden(latest.id)} />} />
            ) : (
              <Here you={you} view={view} busy={busy} run={run} near={near ? names[near] : undefined} night={night} sleeping={sleeping} onSleep={() => setSleeping(!sleeping)} />
            )}
            {latest && !person && <DeedCard deed={latest} onMind={onMind} onClose={() => setHidden(latest.id)} />}
            {!latest && !person && <p className="y-quiet">What you do here is remembered. Walk up to someone and press E, or click them. Their side of it shows up here.</p>}
          </>
        )}
      </aside>

      <div className="y-hud">
        <b>{you.name}</b>
        <span className={`y-standing s-${you.standing}`}>{you.standing === "welcome" ? `one of ${view.name}` : `a stranger in ${view.name}`}</span>
        <span title="Food in your pack">🍞 {you.food}</span>
        {view.card?.money && <span title="Amber in your pack">◆ {you.amber}</span>}
        <span className="y-where">{you.place === "away" ? "out on your own" : `at ${you.placeName}`}</span>
        <button className="g-btn" onClick={() => walker.current?.lookAtMe()} title="Bring the camera back to you">Find me</button>
        <button className="g-btn" onClick={() => setWalking(false)} title="Go back to watching from above. Your body rests at its camp.">Stop walking</button>
        <small>WASD or click to walk · Shift runs · E talks · drag to look round{view.speed === WALK_SPEED ? " · time runs slow on foot" : ""}</small>
      </div>

      {verdict && (
        <VerdictBox
          you={you}
          view={view}
          verdict={verdict}
          names={names}
          onMind={onMind}
          onClose={() => {
            setSeenVerdict(verdict.tick);
            localSet("psyche.you.verdict", String(verdict.tick));
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ arriving

function Arrive(props: { view: GameView; you?: YouView; canReturn: boolean; busy: boolean; error?: string; onArrive: (name: string) => Promise<void>; onCancel: () => void; onMind: (id: string, trace?: string) => void }) {
  const { view, you, canReturn, busy, error } = props;
  const [name, setName] = useState(() => you?.name ?? localGet("psyche.you.name") ?? "");
  const v = you?.verdict;
  return (
    <div className="y-veil" role="dialog" aria-label="Walk into the world">
      <form
        className="y-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && (!you || canReturn)) void props.onArrive(name.trim());
        }}
      >
        {you ? (
          <>
            <small>Sent away</small>
            <h2>{view.name} put you on a boat.</h2>
            {v && (
              <p>
                {v.send.length} voted to send you away, {v.stay.length} to let you stay. The reason given: “{v.grievance}”
              </p>
            )}
            <p className="g-small">{canReturn ? "Enough time has passed. You can walk back in, but nobody has forgotten." : `They won't have you back before day ${Math.floor((you.banishedUntil ?? 0) / 1440) + 1}. Let some time pass${view.towns && view.towns.length > 1 ? ", or try another town" : ""}.`}</p>
          </>
        ) : (
          <>
            <small>Walk in</small>
            <h2>Step off the boat at {view.name}.</h2>
            <p>
              You arrive as a stranger with a little food and amber in your pack. Talk to people, help them, trade, lie, steal. Nobody here is scripted: each of them takes what you do through their own mind, remembers it, and tells the others.
            </p>
            <label className="g-small" htmlFor="y-name">What do they call you?</label>
            <input id="y-name" type="text" value={name} maxLength={24} autoFocus placeholder="Your name" onChange={(e) => setName(e.target.value)} />
            <p className="g-small">{view.faculties === "mock" ? "Running on the offline mock: free." : "Each thing you do is one or two short model calls, inside your daily cap."}</p>
          </>
        )}
        {error && <p className="y-error" role="alert">{error}</p>}
        <div className="y-row">
          {(!you || canReturn) && (
            <button className="g-btn primary" disabled={busy || !name.trim()}>
              {you ? "Walk back in" : "Walk in"}
            </button>
          )}
          <button type="button" className="g-btn" onClick={props.onCancel}>
            {you ? "Back to watching" : "Not now"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ where you are

function Here({ you, view, busy, run, near, night, sleeping, onSleep }: { you: YouView; view: GameView; busy: boolean; run: (a: YouAct) => Promise<Deed | undefined>; near?: string; night: boolean; sleeping: boolean; onSleep: () => void }) {
  const s = you.summary;
  return (
    <div className="y-here">
      <p className="y-lead">
        {you.place === "away" ? "Nobody about. " : `${you.near.length ? `${you.near.length} ${you.near.length === 1 ? "person" : "people"} here` : "Nobody here"} at ${you.placeName}. `}
        {near ? `${firstName(near)} is close enough to talk to.` : "Walk up to someone to talk."}
      </p>
      <p className="g-small">
        You have met {s.met} of {s.adults} adults. {s.warm} think well of you, {s.cold} don't{s.against ? `, and ${s.against} would see you gone` : ""}.
      </p>
      <div className="y-row">
        {you.can.gather && (
          <button className="g-btn" disabled={busy} onClick={() => void run({ act: "gather" })} title="Find something to eat here. Once an hour.">
            Forage here
          </button>
        )}
        {you.can.store && (
          <>
            <button className="g-btn" disabled={busy || you.food < 1} onClick={() => void run({ act: "store", amount: 1 })} title="Anyone at the store sees you do it">
              Put 1 food in the store
            </button>
            <button className="g-btn y-bad" disabled={busy} onClick={() => void run({ act: "steal", from: "store" })} title="Anyone here will see. If nobody does, someone counts it later and decides who to blame.">
              Take from the store
            </button>
          </>
        )}
        {you.can.home && (
          <button className="g-btn y-bad" disabled={busy || you.can.home.food < 0.5} onClick={() => void run({ act: "steal", from: you.can.home!.household })} title="If nobody is home to see, they will find it gone later and decide who to blame.">
            Take from {you.can.home.name}'s food ({you.can.home.food})
          </button>
        )}
      </div>
      {(night || sleeping) && (
        <div className="y-row">
          <span className="g-small">{sleeping ? "Sleeping. The night goes by." : "It is night, and nearly everyone is asleep."}</span>
          <button className="g-btn" onClick={onSleep}>{sleeping ? "Wake up" : "Sleep until morning"}</button>
        </div>
      )}
      {view.running === false && !you.ask && <p className="g-small">The world is paused. You can still act; nobody moves until you press play.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ what you can do to someone

const STORIES: { text: (n: string) => string; valence: number; label: string }[] = [
  { label: "They steal from the store", text: (n) => `${n} has been taking from the common store at night`, valence: -0.6 },
  { label: "They talk behind your back", text: (n) => `${n} says things about you when you are not there`, valence: -0.5 },
  { label: "They cheated their last village", text: (n) => `${n} cheated people in the last place they lived, and left in the night`, valence: -0.6 },
  { label: "They did me a kindness", text: (n) => `${n} carried my pack up from the landing and would take nothing for it`, valence: 0.5 },
];

function Actions(props: {
  you: YouView;
  view: GameView;
  person: NonNullable<GameView["scene"]>["people"][number];
  regard?: YouView["people"][number];
  busy: boolean;
  run: (a: YouAct) => Promise<Deed | undefined>;
  onMind: (id: string, trace?: string) => void;
  onClose: () => void;
  /** How they took the last thing you did, shown right under their name. */
  card?: ReactNode;
}) {
  const { you, view, person, regard, busy, run, onMind } = props;
  const to = person.id;
  const [text, setText] = useState("");
  const [about, setAbout] = useState("");
  const [story, setStory] = useState("");
  const [unkind, setUnkind] = useState(true);
  const others = useMemo(() => (view.agents ?? []).filter((a) => a.id !== to).sort((a, b) => a.name.localeCompare(b.name)), [view.agents, to]);
  const agent = view.agents?.find((a) => a.id === to);
  const trade = !!view.card?.money;
  const aboutName = others.find((o) => o.id === about)?.name;
  const owed = you.debts.find((d) => d.creditor === to);
  const btn = (label: string, act: YouAct, o: { title?: string; bad?: boolean; off?: boolean } = {}) => (
    <button className={`g-btn${o.bad ? " y-bad" : ""}`} disabled={busy || o.off} title={o.title} onClick={() => void run(act)}>
      {label}
    </button>
  );
  return (
    <div className="y-actions">
      <div className="y-who">
        <div>
          <b>{person.name}</b>
          <span>
            {agent?.role ?? ""}
            {person.activity ? ` · ${person.activity}` : ""}
          </span>
        </div>
        <button className="g-mini" onClick={() => onMind(to)}>mind</button>
        <button className="g-mini" onClick={props.onClose} aria-label="Close">✕</button>
      </div>
      {regard ? (
        <div className="y-regard">
          <Meter label="Likes you" value={regard.liking} />
          <Meter label="Trusts you" value={regard.trust} />
          <p className="g-small">
            {regard.knows ? `Knows you as ${you.name}` : "Calls you the stranger"}; {regard.view}.{regard.memory ? ` Remembers: “${regard.memory}”` : ""}
          </p>
        </div>
      ) : (
        <p className="g-small">Has no view of you yet.</p>
      )}
      {props.card}

      <h4>Talk</h4>
      <div className="y-row">
        {btn("Say hello", { act: "greet", to }, { title: regard?.knows ? undefined : "Tells them your name" })}
        {btn("What do people make of me?", { act: "ask", to, about: "me" })}
      </div>
      <form
        className="y-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void run({ act: "say", to, text: text.trim() }).then((d) => d && setText(""));
        }}
      >
        <input type="text" value={text} maxLength={400} placeholder={`Say something to ${firstName(person.name)}`} aria-label="What to say" onChange={(e) => setText(e.target.value)} />
        <button className="g-btn" disabled={busy || !text.trim()}>Say</button>
      </form>
      <div className="y-row">
        <select value={about} onChange={(e) => setAbout(e.target.value)} aria-label="Someone else">
          <option value="">Someone else here...</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {btn("Ask about them", { act: "ask", to, about }, { off: !about, title: "They tell you what they remember of that person, if they feel like it" })}
      </div>

      <h4>Be kind</h4>
      <div className="y-row">
        {btn("Compliment", { act: "compliment", to })}
        {btn("Ask what's wrong", { act: "comfort", to }, { title: "Offer to listen" })}
        {btn("Give 1 food", { act: "give", to, what: "food", amount: 1 }, { off: you.food < 1 })}
        {btn("Give 2 food", { act: "give", to, what: "food", amount: 2 }, { off: you.food < 2 })}
        {trade && btn("Give amber", { act: "give", to, what: "amber", amount: 1 }, { off: you.amber < 1 })}
        {btn("Help with their work", { act: "help", to }, { title: "Two hours of a second pair of hands", off: person.child })}
        {btn("Say sorry", { act: "apologize", to }, { title: "Pays back what you took from them, if you can" })}
        {owed && btn(`Pay back ${owed.amount} food`, { act: "repay", debt: owed.id }, { off: you.food < owed.amount })}
      </div>

      {!person.child && (
        <>
          <h4>Trade</h4>
          <div className="y-row">
            {trade && btn("Buy 3 food for amber", { act: "buy", to }, { off: you.amber < 1, title: "Whether they take amber depends on whether they think anyone else will" })}
            {trade && btn("Sell 3 food for amber", { act: "sell", to }, { off: you.food < 3 })}
            {btn("Ask for food", { act: "beg", to }, { title: "They may give, lend, want amber, or send you off" })}
          </div>

          <h4>Make trouble</h4>
          <div className="y-row">{btn("Insult them", { act: "insult", to }, { bad: true, title: "Everyone close enough hears it" })}</div>
          <div className="y-row">
            <span className="g-small">{aboutName ? `A story about ${firstName(aboutName)}:` : "Pick someone above to tell a story about."}</span>
            {aboutName &&
              STORIES.map((s) => (
                <button key={s.label} className={`g-btn${s.valence < 0 ? " y-bad" : ""}`} disabled={busy} title={`“${s.text(firstName(aboutName))}.”`} onClick={() => void run({ act: "rumor", to, about, text: s.text(firstName(aboutName)), valence: s.valence })}>
                  {s.label}
                </button>
              ))}
          </div>
          {aboutName && (
            <form
              className="y-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (story.trim()) void run({ act: "rumor", to, about, text: story.trim(), valence: unkind ? -0.6 : 0.5 }).then((d) => d && setStory(""));
              }}
            >
              <input type="text" value={story} maxLength={240} placeholder={`Or your own story about ${firstName(aboutName)}`} aria-label="Your own story" onChange={(e) => setStory(e.target.value)} />
              <label className="g-small y-check">
                <input type="checkbox" checked={unkind} onChange={(e) => setUnkind(e.target.checked)} /> unkind
              </label>
              <button className="g-btn y-bad" disabled={busy || !story.trim()}>Tell</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function Meter({ label, value, was }: { label: string; value: number; was?: number }) {
  const d = was === undefined ? 0 : value - was;
  return (
    <div className="y-meter" title={`${label}: ${value.toFixed(2)} on a scale of 0 to 1; 0.5 is no view either way`}>
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.round(value * 100)}%` }} className={value >= 0.58 ? "up" : value <= 0.42 ? "down" : ""} />
      </i>
      <em className={d > 0.004 ? "up" : d < -0.004 ? "down" : ""}>{was === undefined || Math.abs(d) < 0.005 ? value.toFixed(2) : `${value.toFixed(2)} (${signed(d)})`}</em>
    </div>
  );
}

// ------------------------------------------------------------------ how they took it

const ICON: Record<string, string> = { greet: "👋", say: "💬", ask: "❓", compliment: "✨", comfort: "🫂", insult: "💢", apologize: "🙏", give: "🎁", buy: "◆", sell: "◆", beg: "🥣", help: "🛠", rumor: "🗣", gather: "🌿", store: "🏺", steal: "🫳", repay: "🤝", answer: "💬", trial: "⚖️", welcome: "🏡", arrive: "⛵" };

function ReactionRow({ r, onMind }: { r: Reaction; onMind: (id: string, trace?: string) => void }) {
  return (
    <li className="y-react">
      <div className="y-react-head">
        <b>{r.name}</b>
        {r.choice && <span className="y-choice">{r.choice}</span>}
        {r.system && <span className="y-sys" title={r.system === 2 ? "They stopped and thought about it (System 2)" : "Straight from the gut (System 1)"}>{r.system === 2 ? "thought it over" : "gut"}</span>}
        <button className="g-mini" onClick={() => onMind(r.agent, r.trace)} title={`Open ${r.name}'s mind at this moment`}>mind</button>
      </div>
      {r.said && <q>{r.said}</q>}
      {r.felt.length > 0 && (
        <p className="y-felt">
          Felt{" "}
          {r.felt.map((f) => (
            <span key={f.name} style={{ opacity: 0.55 + Math.min(0.45, f.value) }}>{f.name}</span>
          ))}
        </p>
      )}
      <Meter label="Likes you" value={r.liking[1]} was={r.liking[0]} />
      <Meter label="Trusts you" value={r.trust[1]} was={r.trust[0]} />
      {r.why.length > 0 && (
        <p className="y-why" title="The terms that weighed most in the option they chose. The engine scores every option from their state; nothing here is scripted.">
          Why:{" "}
          {r.why.map((w, i) => (
            <span key={i} className={w.value >= 0 ? "up" : "down"}>
              {w.name} {signed(w.value)}
            </span>
          ))}
        </p>
      )}
      {r.kept && <p className="y-kept">Will remember: “{r.kept}”</p>}
    </li>
  );
}

function DeedCard({ deed, onMind, onClose }: { deed: Deed; onMind: (id: string, trace?: string) => void; onClose: () => void }) {
  const to = deed.reactions.filter((r) => r.role === "to");
  const saw = deed.reactions.filter((r) => r.role === "saw");
  return (
    <section className={`y-deed t-${deed.tone}`} aria-live="polite">
      <div className="y-deed-head">
        <span aria-hidden="true">{ICON[deed.kind] ?? "•"}</span>
        <b>{deed.title}</b>
        <time>{clock(deed.tick).replace(/^Day \d+ · /, "")}</time>
        <button className="g-mini" onClick={onClose} aria-label="Dismiss">✕</button>
      </div>
      {deed.said && <p className="y-said">You: “{deed.said}”</p>}
      {to.length > 0 && <ul>{to.map((r) => <ReactionRow key={r.agent} r={r} onMind={onMind} />)}</ul>}
      {deed.result && <p className="y-result">{deed.result}</p>}
      {saw.length > 0 && (
        <div className="y-saw">
          <small>Who saw, and what it did to how they hold you</small>
          {saw.map((r) => {
            const dl = r.liking[1] - r.liking[0], dt = r.trust[1] - r.trust[0];
            return (
              <button key={r.agent} onClick={() => onMind(r.agent, r.trace)} title={`${r.kept ?? ""}${r.felt.length ? ` Felt ${r.felt.map((f) => f.name).join(", ")}.` : ""} Click to open ${r.name}'s mind at this moment.`}>
                {firstName(r.name)}
                <span className={dl + dt > 0.004 ? "up" : dl + dt < -0.004 ? "down" : ""}>
                  {Math.abs(dl) >= 0.005 ? ` liking ${signed(dl)}` : ""}
                  {Math.abs(dt) >= 0.005 ? ` trust ${signed(dt)}` : ""}
                  {Math.abs(dl) < 0.005 && Math.abs(dt) < 0.005 ? " noticed" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ what they think of you

function People({ you, busy, run, onMind, onPick }: { you: YouView; busy: boolean; run: (a: YouAct) => Promise<Deed | undefined>; onMind: (id: string, trace?: string) => void; onPick: (id: string) => void }) {
  const s = you.summary;
  return (
    <div className="y-people">
      <p className="y-lead">
        {you.standing === "welcome" ? "They asked you to stay. " : ""}
        Met {s.met} of {s.adults} adults. {s.warm} warm, {s.cold} cold{s.against ? `, ${s.against} would see you gone` : ""}. Average liking {s.liking.toFixed(2)}.
      </p>
      {s.against >= 2 && <p className="y-error">Enough people hold something against you that someone may stand up at the fire one evening and ask the village to send you away.</p>}
      {you.debts.length > 0 && (
        <>
          <h4>What you owe</h4>
          <ul className="y-list">
            {you.debts.map((d) => (
              <li key={d.id}>
                <span>
                  {d.amount} food to {d.name}
                  {d.overdue ? <em className="down"> past due</em> : ` by ${clock(d.due).replace(/ · .*/, "")}`}
                </span>
                <button className="g-mini" disabled={busy || you.food < d.amount} onClick={() => void run({ act: "repay", debt: d.id })}>pay back</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {you.stories.length > 0 && (
        <>
          <h4>Stories going round</h4>
          <ul className="y-list">
            {you.stories.map((st) => (
              <li key={st.id}>
                <span>
                  “{st.text}” <em>{st.yours ? `you started this about ${st.aboutName}` : "about you"} · {st.carriers} {st.carriers === 1 ? "person carries" : "people carry"} it{st.leaked ? ` · ${firstName(st.aboutName)} knows it came from you` : ""}</em>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Everyone with a view of you</h4>
      {you.people.length === 0 && <p className="y-quiet">Nobody has a view of you yet.</p>}
      <ul className="y-folk">
        {you.people.map((p) => (
          <li key={p.id}>
            <div className="y-react-head">
              <b>{p.name}</b>
              <span className="y-choice">{p.view}</span>
              <button className="g-mini" onClick={() => onPick(p.id)} title="Open the things you can do to them (they need to be awake and near)">act</button>
              <button className="g-mini" onClick={() => onMind(p.id)}>mind</button>
            </div>
            <Meter label="Likes you" value={p.liking} />
            <Meter label="Trusts you" value={p.trust} />
            <p className="g-small">
              {p.knows ? "Knows your name. " : "Knows you only as the stranger. "}
              {p.met ? `You have dealt with them ${p.met} ${p.met === 1 ? "time" : "times"}. ` : "You have never spoken. "}
              {p.heard ? `Has heard ${p.heard} ${p.heard === 1 ? "thing" : "things"} about you. ` : ""}
              {p.memory ? `Remembers: “${p.memory}”` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerdictBox({ you, view, verdict, names, onMind, onClose }: { you: YouView; view: GameView; verdict: NonNullable<YouView["verdict"]>; names: Record<string, string>; onMind: (id: string, trace?: string) => void; onClose: () => void }) {
  const trace = (id: string) => verdict.traces.find((t) => t.agent === id)?.trace;
  const row = (ids: string[]) =>
    ids.map((id) => (
      <button key={id} className="g-mini" onClick={() => onMind(id, trace(id))} title="Open their mind at the moment they voted">
        {firstName(names[id] ?? id)}
      </button>
    ));
  return (
    <div className="y-veil" role="dialog" aria-label="The village voted on you">
      <div className="y-box">
        <small>At the fire, {clock(verdict.tick)}</small>
        <h2>{verdict.banished ? `${view.name} voted to send you away.` : `${view.name} voted to let you stay.`}</h2>
        <p>
          {names[verdict.proposer] ?? "Someone"} stood up and asked for it. The reason: “{verdict.grievance}”
        </p>
        <h4>Send {you.name} away ({verdict.send.length})</h4>
        <div className="y-row">{row(verdict.send)}</div>
        <h4>Let them stay ({verdict.stay.length})</h4>
        <div className="y-row">{verdict.stay.length ? row(verdict.stay) : <span className="g-small">Nobody.</span>}</div>
        <p className="g-small">Click a name to see what tipped their vote.</p>
        <div className="y-row">
          <button className="g-btn primary" onClick={onClose} autoFocus>
            {verdict.banished ? "Go" : "Carry on"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { REACH };
