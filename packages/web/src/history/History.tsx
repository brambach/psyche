// The causal history explorer (#/history): the whole run on one timeline. Scrub to a moment, pick a
// choice anyone made, and walk the why back through the years and through other people's heads to
// where it started. Pick something that weighs on someone and see where it came from and every
// choice it has bent since. Ask the Historian about any of it.
//
// Everything here reads the history the server keeps (packages/engine/src/history.ts), which outlasts
// the traces a running world lets go.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agoText, whenText, yearMinutes, type AgentId, type Calendar, type LedgerNode, type Mechanism, type NodeKind, type ThreadStep } from "@psyche/engine";
import { server, type Answer, type HistorySource, type Overview, type Why } from "./api";
import { agentColor, clean, flattenTree, groupOf, GROUPS, KIND, tickOf, type FlatNode } from "./shared";
import { Timeline } from "./Timeline";
import { Thread } from "./Thread";
import "./history.css";

/** Walking back from an effect: how its cause led to it, as the start of a sentence. */
const BACK: Record<Mechanism, string> = {
  perceived: "which was how they lived",
  heard: "which was how they heard",
  "appraised as": "stirred by",
  "core belief": "read through the core belief",
  "trust coloured blame": "coloured by",
  "moved trust": "moved by",
  "formed belief": "formed by",
  "heard again": "firmed up by hearing",
  "in mind": "with this in mind",
  "below awareness": "below awareness",
  "lingering feeling": "with this still lingering",
  said: "which came from",
  did: "which came from",
  "generalized from": "generalized from",
  "told by": "told to them by",
  "passed on": "passed on from",
  "rewrote memory": "rewritten by",
  "installed by": "installed by",
  "deepened by": "deepened by",
  sanctioned: "built from",
  expected: "with this expected of them",
  "bent by": "bent on the way by",
  "you changed": "because you changed this",
  "handed down": "handed down from",
  "meant to": "having meant to",
  "in their own words": "from their own writing",
};

function useHash(): URLSearchParams {
  const read = () => new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [p, setP] = useState(read);
  useEffect(() => {
    const on = () => setP(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return p;
}

type Tab = "choices" | "weighs" | "chronicle";

export function History({ source = server }: { source?: HistorySource }) {
  const params = useHash();
  const [ov, setOv] = useState<Overview>();
  const [error, setError] = useState<string>();
  const [town, setTown] = useState("");
  const [person, setPerson] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());
  const [at, setAt] = useState<number>();
  const [tab, setTab] = useState<Tab>("choices");
  const [open, setOpen] = useState<string | undefined>(params.get("node") ?? undefined);
  const [why, setWhy] = useState<Why>();
  const [whyError, setWhyError] = useState<string>();
  const [sel, setSel] = useState<string>();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; label: string; agent?: string; tick: number | null; kind: NodeKind }[]>();

  // The overview, refreshed while the page is in front (the world keeps running).
  useEffect(() => {
    let live = true;
    const load = () => source.overview().then((v) => live && (setOv(v), setError(undefined)), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [source]);

  // A link can open the page on a node.
  useEffect(() => {
    const n = params.get("node");
    if (n) setOpen(n);
  }, [params]);

  useEffect(() => {
    if (!open) {
      setWhy(undefined);
      return;
    }
    let live = true;
    setWhyError(undefined);
    source.why(open).then(
      (v) => {
        if (!live) return;
        setWhy(v);
        setSel(open);
        const t = tickOf(v.node.tick);
        if (t !== null && v.node.kind === "decision") setAt(t);
      },
      (e) => live && (setWhy(undefined), setWhyError(e instanceof Error ? e.message : String(e))),
    );
    const want = `#/history?node=${encodeURIComponent(open)}`;
    if (location.hash !== want) history.replaceState(null, "", want);
    return () => {
      live = false;
    };
  }, [open, source]);

  const cal: Calendar = ov?.calendar ?? {};
  const names = useMemo(() => Object.fromEntries((ov?.people ?? []).map((p) => [p.id, p.name])), [ov]);
  const people = useMemo(() => new Map((ov?.people ?? []).map((p) => [p.id, p])), [ov]);
  const moments = useMemo(
    () => (ov?.moments ?? []).filter((m) => (!town || m[6] === town) && (!person || m[2] === person) && !off.has(groupOf(m[3]).id)),
    [ov, town, person, off],
  );
  // Until it is moved, the playhead sits on the last thing kept.
  const playhead = at ?? ov?.moments[ov.moments.length - 1]?.[1] ?? ov?.to ?? 0;
  const season = ov?.year ? ov.year / 4 : 360;
  const here = useMemo(() => {
    const lo = Math.floor(playhead / season) * season;
    return moments.filter((m) => m[1] >= lo && m[1] < lo + season).sort((a, b) => b[5] - a[5] || a[1] - b[1]);
  }, [moments, playhead, season]);

  // Arrow keys move the playhead a season (a year with shift).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!ov || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = (e.shiftKey ? 4 : 1) * season * (e.key === "ArrowLeft" ? -1 : 1);
      setAt((a) => Math.max(0, Math.min(ov.to, (a ?? ov.to) + step)));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [ov, season]);

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      if (q.trim().length < 3) return setFound(undefined);
      void source.find(q, at).then((r) => setFound(r.found.map((f) => ({ id: f.node.id, label: f.node.label, agent: f.node.agent, tick: tickOf(f.node.tick), kind: f.node.kind }))), () => setFound([]));
    },
    [source, at],
  );

  const flat = useMemo(() => (why ? flattenTree(why.tree) : []), [why]);

  if (error && !ov) return <div className="hx"><p className="hx-empty">{error}</p></div>;
  if (!ov) return <div className="hx"><p className="hx-empty">Reading the record...</p></div>;
  const empty = ov.moments.length === 0;

  return (
    <div className="hx">
      <header className="hx-top">
        <a className="hx-brand" href="#/" title="Back to the game">Psyche</a>
        <h1>History</h1>
        <span className="hx-sub">
          {ov.size.moments.toLocaleString()} choices by {ov.size.people} people{ov.year ? `, ${Math.max(1, Math.round(ov.to / ov.year))} ${Math.round(ov.to / ov.year) > 1 ? "years" : "year"}` : ""}
        </span>
        <div className="hx-filters">
          {ov.towns.length > 1 && (
            <select aria-label="Town" value={town} onChange={(e) => setTown(e.target.value)}>
              <option value="">Every town</option>
              {ov.towns.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {[...ov.people].filter((p) => p.choices > 0 && (!town || p.town === town)).sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.died !== undefined ? " †" : ""} · {p.choices}</option>
            ))}
          </select>
          <input type="search" placeholder="Find a choice, a memory, a belief" value={query} onChange={(e) => search(e.target.value)} aria-label="Search the history" />
        </div>
        <a className="hx-back" href="#/">The game →</a>
      </header>

      <section className="hx-time" aria-label="Timeline">
        <div className="hx-legend" role="group" aria-label="Kinds of choice (click to hide or show)">
          {GROUPS.map((g) => (
            <button key={g.id} className={off.has(g.id) ? "off" : ""} aria-pressed={!off.has(g.id)} title={ov.kinds.filter((k) => g.kinds.includes(k.kind)).map((k) => `${k.label}: ${k.means}`).join("\n")} onClick={() => setOff((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
              <i style={{ background: g.color }} />
              {g.label}
            </button>
          ))}
          <span className="hx-hint">Drag the timeline, or use ← →. Click a choice to walk it back.</span>
        </div>
        <Timeline ov={ov} moments={moments} at={playhead} onAt={setAt} why={why} flat={flat} sel={sel} names={names} />
      </section>

      <div className="hx-body">
        <aside className="hx-side" aria-label="What happened">
          <nav className="hx-tabs" role="tablist">
            {(["choices", "weighs", "chronicle"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "choices" ? "Choices" : t === "weighs" ? "Fears and beliefs" : "Chronicle"}
              </button>
            ))}
          </nav>
          {found ? (
            <div className="hx-list">
              <p className="hx-when">{found.length ? `Found for “${query}”` : `Nothing found for “${query}”.`} <button className="hx-link" onClick={() => search("")}>clear</button></p>
              {found.map((f) => (
                <button key={f.id} className={`hx-row${open === f.id ? " on" : ""}`} onClick={() => setOpen(f.id)}>
                  <span className={`hx-k k-${f.kind}`}>{KIND[f.kind]}</span>
                  <b style={{ color: agentColor(f.agent) }}>{f.agent ? (names[f.agent] ?? f.agent) : "the world"}</b>
                  <span>{clean(f.label)}</span>
                  <small>{whenText(cal, f.tick)}</small>
                </button>
              ))}
            </div>
          ) : tab === "choices" ? (
            <div className="hx-list">
              <p className="hx-when">{whenText(cal, playhead)} · {here.length} {here.length === 1 ? "choice" : "choices"} kept</p>
              {here.slice(0, 80).map((m) => (
                <button key={m[0]} className={`hx-row${open === m[0] ? " on" : ""}`} onClick={() => setOpen(m[0])}>
                  <i className="hx-dot" style={{ background: groupOf(m[3]).color }} title={groupOf(m[3]).label} />
                  <b style={{ color: agentColor(m[2]) }}>{names[m[2]] ?? m[2]}</b>
                  <span>{m[4]}</span>
                </button>
              ))}
              {here.length > 80 && <p className="hx-small">and {here.length - 80} more. Pick a person above to narrow it.</p>}
              {!here.length && <p className="hx-small">{empty ? "Nothing kept yet. Let the world run for a while and come back." : "Nothing kept from this season with these filters."}</p>}
            </div>
          ) : tab === "weighs" ? (
            <div className="hx-list">
              <p className="hx-when">Core beliefs and dark beliefs, by how many later choices each has shaped</p>
              {ov.weights.filter((w) => (!person || w.agent === person) && (!town || people.get(w.agent)?.town === town)).slice(0, 60).map((w) => (
                <button key={w.id} className={`hx-row tall${open === w.id ? " on" : ""}`} onClick={() => setOpen(w.id)}>
                  <span className={`hx-k k-${w.kind}`}>{w.kind === "schema" ? "core belief" : "belief"}</span>
                  <b style={{ color: agentColor(w.agent) }}>{names[w.agent] ?? w.agent}</b>
                  <span>“{w.label}”</span>
                  <small>{w.shaped ? `shaped ${w.shaped} ${w.shaped === 1 ? "choice" : "choices"}${w.minds > 1 ? ` in ${w.minds} minds` : ""}` : "no choice traced to it yet"}{w.since !== null && w.since !== undefined ? ` · from ${whenText(cal, w.since)}` : ""}</small>
                </button>
              ))}
            </div>
          ) : (
            <Chronicle ov={ov} town={town} at={playhead} season={season} onAt={setAt} />
          )}
        </aside>

        <main className="hx-main">
          {whyError && <p className="hx-empty">{whyError}</p>}
          {!open && !whyError && <Welcome ov={ov} names={names} onOpen={setOpen} />}
          {open && !why && !whyError && <p className="hx-empty">Following the threads back...</p>}
          {why && <Walk why={why} flat={flat} cal={cal} names={names} people={people} sel={sel ?? why.node.id} onSel={setSel} onOpen={setOpen} />}
        </main>

        <aside className="hx-detail" aria-label="Detail">
          {why && <Detail key={sel ?? why.node.id} source={source} why={why} flat={flat} id={sel ?? why.node.id} cal={cal} names={names} people={people} onOpen={setOpen} onAt={setAt} />}
          <Ask source={source} ov={ov} why={why} sel={sel} at={playhead} names={names} cal={cal} onOpen={(id) => (flat.some((f) => f.node.id === id) ? setSel(id) : setOpen(id))} />
        </aside>
      </div>
    </div>
  );
}

function Welcome({ ov, names, onOpen }: { ov: Overview; names: Record<string, string>; onOpen: (id: string) => void }) {
  const fears = ov.weights.filter((w) => w.shaped > 0).slice(0, 3);
  const late = [...ov.moments].filter((m) => m[3] !== "talk").slice(-400).sort((a, b) => b[5] - a[5]).slice(0, 3);
  return (
    <div className="hx-welcome">
      <h2>Every choice has a history.</h2>
      <p>
        This is the record of everything anyone here chose and what was behind it, kept after the people and the moments are gone. Drag the timeline to a season and pick a choice, and the trail
        walks back from it: what was in mind, the memory behind that, who told it to them, and so on to where it started.
      </p>
      {fears.length > 0 && (
        <>
          <h3>Start with something that weighs on someone</h3>
          {fears.map((w) => (
            <button key={w.id} className="hx-start" onClick={() => onOpen(w.id)}>
              <b style={{ color: agentColor(w.agent) }}>{names[w.agent] ?? w.agent}</b> believes “{w.label}”. <span>It has shaped {w.shaped} choices. Where did it come from?</span>
            </button>
          ))}
        </>
      )}
      {late.length > 0 && (
        <>
          <h3>Or a recent choice</h3>
          {late.map((m) => (
            <button key={m[0]} className="hx-start" onClick={() => onOpen(m[0])}>
              <b style={{ color: agentColor(m[2]) }}>{names[m[2]] ?? m[2]}</b> chose: {m[4]}. <span>{whenText(ov.calendar, m[1])}. Why?</span>
            </button>
          ))}
        </>
      )}
      {!ov.moments.length && <p className="hx-small">Nothing has been kept yet. The record fills as the world runs.</p>}
    </div>
  );
}

const MARK: Record<string, string> = { founding: "A town founded", leader: "A leader", law: "A law", death: "A death", birth: "A birth", quarrel: "A quarrel", peace: "Peace", hunger: "Hunger", craft: "A craft learned", lost: "A craft lost", work: "A work", ruin: "A ruin", faith: "Faith", engine: "An engine", heresy: "Heresy", money: "Money", trade: "Trade", storm: "A storm", blight: "Blight", catch: "A catch", anomaly: "Something uncanny" };

function Chronicle({ ov, town, at, season, onAt }: { ov: Overview; town: string; at: number; season: number; onAt: (t: number) => void }) {
  const year = season * 4;
  const marks = ov.marks.filter((m) => (!town || !m.town || m.town === town) && m.kind !== "trade");
  const near = marks.filter((m) => Math.abs(m.tick - at) <= year * 1.5);
  const shown = (near.length ? near : marks.slice(-30)).slice(-60);
  const townName = (id?: string) => ov.towns.find((t) => t.id === id)?.name;
  return (
    <div className="hx-list">
      <p className="hx-when">{near.length ? `Around ${whenText(ov.calendar, at)}` : "Nothing recorded around here. The latest:"}</p>
      {shown.map((m) => (
        <div key={m.id} className="hx-mark">
          <button className="hx-link" onClick={() => onAt(m.tick)} title="Move the timeline here">{whenText(ov.calendar, m.tick)}{townName(m.town) ? ` · ${townName(m.town)}` : ""}</button>
          <span className="hx-k">{MARK[m.kind] ?? m.kind}</span>
          <p>{m.text}</p>
          {m.why && m.why.length > 0 && (
            <details>
              <summary>Why?</summary>
              <ol>{m.why.map((w, i) => <li key={i}>{w.text}</li>)}</ol>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

type People = Map<string, Overview["people"][number]>;

/** Founders' births are counted back in the village's own years, so say their age rather than a date. */
function bornText(cal: Calendar, born: number): string {
  const y = yearMinutes(cal);
  return born < 0 && y ? `${Math.round(-born / y)} when the story began` : `born ${whenText(cal, born)}`;
}

function who(people: People, names: Record<string, string>, a?: AgentId): string {
  if (!a) return "the world";
  return names[a] ?? (a === "visitor" ? "a stranger" : a);
}

/** The middle column: the choice (or belief), the thread drawn across time and minds, and the walk back step by step. */
function Walk({ why, flat, cal, names, people, sel, onSel, onOpen }: { why: Why; flat: FlatNode[]; cal: Calendar; names: Record<string, string>; people: People; sel: string; onSel: (id: string) => void; onOpen: (id: string) => void }) {
  const [which, setWhich] = useState<"longest" | "strongest">("longest");
  const n = why.node;
  const m = why.moment;
  const p = n.agent ? people.get(n.agent) : undefined;
  const end = tickOf(n.tick);
  const same = why.longest.map((s) => s.node.id).join() === why.strongest.map((s) => s.node.id).join();
  const steps = same || which === "longest" ? why.longest : why.strongest;
  // The thread being walked, the thing explained first: the graph numbers its steps to match the list below.
  const order = useMemo(() => [...steps].reverse().map((s) => s.node.id), [steps]);
  const earliest = why.origins.earliest;
  const kicker = [KIND[n.kind], p ? `${p.name}${p.role ? `, ${p.role}` : ""}${p.died !== undefined ? " †" : ""}` : undefined, whenText(cal, n.tick)].filter(Boolean).join(" · ");
  return (
    <article className="hx-walk">
      <p className="hx-kicker">{kicker}</p>
      <h2>{m ? m.question : n.kind === "schema" || n.kind === "belief" ? `Where did “${clean(n.label)}” come from?` : clean(n.label)}</h2>
      {m && <p className="hx-lede">{m.answer}</p>}
      {m && (
        <p className="hx-facts">
          <span>Chose <b>{m.choice}</b>{m.over[0] ? <> over {m.over[0].label} ({m.over[0].gap <= 0.08 ? "a close call" : `${m.over[0].gap.toFixed(2)} ahead`})</> : null}</span>
          <span>{m.thought ? "Stopped and thought it through" : "Went with the first pull"}</span>
          {m.said && <span className="said">“{m.said}”</span>}
        </p>
      )}
      <p className="hx-sum">
        {why.origins.causes
          ? <>
              <b>{why.origins.causes}</b> {why.origins.causes === 1 ? "cause" : "causes"} upstream
              {why.origins.minds.length > 0 && <>, through the {why.origins.minds.length === 1 ? "mind" : "minds"} of {why.origins.minds.slice(0, 5).map((a, i) => <span key={a}>{i > 0 && ", "}<b style={{ color: agentColor(a) }}>{who(people, names, a)}</b></span>)}{why.origins.minds.length > 5 && ` and ${why.origins.minds.length - 5} more`}</>}
              {earliest !== undefined && end !== null && earliest < end && <>. The oldest is from <b>{whenText(cal, earliest)}</b>, {agoText(cal, earliest, end)}</>}.
            </>
          : "Nothing is recorded behind this. As far as the history can see, it starts here."}
      </p>

      {flat.length > 1 && <Thread why={why} flat={flat} cal={cal} names={names} sel={sel} order={order} onSel={onSel} />}

      {steps.length > 1 && (
        <section className="hx-steps">
          <header>
            <h3>Walk it back</h3>
            {!same && (
              <div className="hx-seg" role="group" aria-label="Which thread">
                <button className={which === "longest" ? "on" : ""} onClick={() => setWhich("longest")} title="The thread that reaches furthest back in time">Furthest back</button>
                <button className={which === "strongest" ? "on" : ""} onClick={() => setWhich("strongest")} title="The thread that carries the most weight">Strongest</button>
              </div>
            )}
          </header>
          <ol>
            {[...steps].reverse().map((s, i, all) => (
              <Step key={s.node.id} s={s} via={i > 0 ? all[i]!.mechanism : undefined} prev={i > 0 ? all[i - 1]!.node : undefined} root={n} cal={cal} name={who(people, names, s.node.agent)} sel={sel === s.node.id} onSel={() => onSel(s.node.id)} onOpen={i > 0 ? () => onOpen(s.node.id) : undefined} />
            ))}
          </ol>
        </section>
      )}
      {n.kind !== "decision" && why.reach.total > 0 && (
        <section className="hx-since">
          <h3>What it went on to shape</h3>
          <p>
            <b>{why.reach.total}</b> later {why.reach.total === 1 ? "choice traces" : "choices trace"} back to this{why.reach.direct ? <>, <b>{why.reach.direct}</b> with it directly in mind</> : null}
            {why.reach.first !== undefined && why.reach.last !== undefined && why.reach.last > why.reach.first ? <>, from {whenText(cal, why.reach.first)} to {whenText(cal, why.reach.last)}</> : null}
            {why.reach.minds.length > 1 ? <>, in {why.reach.minds.length} minds</> : null}. The ones it weighed on most:
          </p>
          {why.reach.choices.slice(0, 8).map((c) => (
            <button key={c.node.id} className="hx-start" onClick={() => onOpen(c.node.id)}>
              <b style={{ color: agentColor(c.node.agent) }}>{who(people, names, c.node.agent)}</b> {c.node.label.replace(/^.*? chose: /, "chose: ")}. <span>{whenText(cal, c.node.tick)} · about {Math.max(1, Math.round(c.share * 100))}% of it. Why?</span>
            </button>
          ))}
        </section>
      )}
      {why.tree.missed && why.tree.missed.length > 0 && (
        <p className="hx-missed"><b>What didn't come to mind:</b> {why.tree.missed.map((x) => `“${clean(x.label).replace(/\.$/, "")}”`).join(", ")}.</p>
      )}
      <p className="hx-small hx-note">Shares multiply along a thread: a rough measure of how much of this came from there. A cause only counts if it had already happened.</p>
    </article>
  );
}

function Step({ s, via, prev, root, cal, name, sel, onSel, onOpen }: { s: ThreadStep; via?: Mechanism; prev?: LedgerNode; root: LedgerNode; cal: Calendar; name: string; sel: boolean; onSel: () => void; onOpen?: () => void }) {
  const n = s.node;
  const t = tickOf(n.tick);
  const before = prev ? tickOf(prev.tick) : null;
  const gap = t !== null && before !== null && before - t >= 60 ? agoText(cal, t, before) : undefined;
  return (
    <li className={sel ? "on" : ""}>
      {via && <p className="hx-via">{BACK[via]}{gap ? <em> · {gap}</em> : null}</p>}
      <div className={`hx-card k-${n.kind}`} style={{ borderLeftColor: agentColor(n.agent) }}>
        <button className="hx-card-main" onClick={onSel}>
          <span className="hx-card-head">
            <span className={`hx-k k-${n.kind}`}>{KIND[n.kind]}</span>
            <b style={{ color: agentColor(n.agent) }}>{name}</b>
            <time>{whenText(cal, n.tick)}</time>
          </span>
          <span className="hx-card-text">{clean(n.label)}</span>
        </button>
        {onOpen && n.id !== root.id && <button className="hx-link" onClick={onOpen} title="Make this the question and walk back from it">walk back from here</button>}
      </div>
    </li>
  );
}

/** The right column: the selected thing in full, and what it went on to shape. */
function Detail({ source, why, flat, id, cal, names, people, onOpen, onAt }: { source: HistorySource; why: Why; flat: FlatNode[]; id: string; cal: Calendar; names: Record<string, string>; people: People; onOpen: (id: string) => void; onAt: (t: number) => void }) {
  const f = flat.find((x) => x.node.id === id);
  const n = f?.node ?? why.node;
  const isRoot = n.id === why.node.id;
  const [own, setOwn] = useState<Why>();
  useEffect(() => {
    if (isRoot) return;
    let live = true;
    source.why(n.id).then((v) => live && setOwn(v), () => undefined);
    return () => {
      live = false;
    };
  }, [source, n.id, isRoot]);
  const w = isRoot ? why : own;
  const p = n.agent ? people.get(n.agent) : undefined;
  const end = tickOf(why.node.tick);
  const t = tickOf(n.tick);
  const held = why.held.includes(n.id) && n.agent && n.trace;
  const max = Math.max(1, ...(w?.reach.byYear.map((y) => y.choices) ?? [1]));
  return (
    <section className="hx-pane">
      <p className="hx-kicker"><span className={`hx-k k-${n.kind}`}>{KIND[n.kind]}</span> {whenText(cal, n.tick)}{t !== null && end !== null && end - t >= 60 && !isRoot ? ` · ${agoText(cal, t, end)}` : ""}</p>
      <h3 className="hx-pane-title">{clean(n.label)}</h3>
      {p && (
        <p className="hx-person">
          <b style={{ color: agentColor(p.id) }}>{p.name}</b>
          {p.role ? `, ${p.role}` : ""}
          {p.born !== undefined ? ` · ${bornText(cal, p.born)}` : ""}
          {p.died !== undefined ? ` · died ${whenText(cal, p.died)}${p.cause ? ` (${p.cause})` : ""}` : ""}
          {p.parents.length > 0 ? ` · child of ${p.parents.map((x) => names[x] ?? x).join(" and ")}` : ""}
        </p>
      )}
      {f && !isRoot && f.via && (
        <p className="hx-how">
          {f.via.mechanism === "in mind" ? "It was in mind for" : `Link: ${f.via.mechanism} →`} “{clean(f.effect?.label ?? "")}”. Along this thread it accounts for about <b>{Math.max(1, Math.round(f.share * 100))}%</b> of what is being explained.
        </p>
      )}
      <div className="hx-actions">
        {!isRoot && <button className="hx-btn" onClick={() => onOpen(n.id)}>Walk back from here</button>}
        {held && <a className="hx-btn" href={`#/?mind=${n.agent}&trace=${n.trace}`} title="The live town still holds this moment: open the brain scan">Open the brain scan</a>}
      </div>
      {w && (
        <div className="hx-reach">
          <h4>What it went on to shape</h4>
          {w.reach.total ? (
            <>
              <p>
                <b>{w.reach.total}</b> later {w.reach.total === 1 ? "choice" : "choices"}{w.reach.direct ? ` (${w.reach.direct} with it directly in mind)` : ""}:{" "}
                {w.reach.minds.slice(0, 5).map((x, i) => <span key={x.agent}>{i > 0 && ", "}<b style={{ color: agentColor(x.agent) }}>{names[x.agent] ?? x.agent}</b> {x.choices}</span>)}
                {w.reach.minds.length > 5 && ` and ${w.reach.minds.length - 5} more`}.
              </p>
              {w.reach.byYear.length > 1 && cal.seasonDays && (
                <figure className="hx-bars" aria-label="Choices shaped, by year">
                  <div>
                    {w.reach.byYear.map((y) => (
                      <button key={y.year} style={{ height: `${Math.max(6, (y.choices / max) * 100)}%` }} title={`Year ${y.year}: ${y.choices} ${y.choices === 1 ? "choice" : "choices"}`} aria-label={`Year ${y.year}: ${y.choices} choices`} onClick={() => onAt((y.year - 0.5) * cal.seasonDays! * 4 * 1440)} />
                    ))}
                  </div>
                  <figcaption><span>year {w.reach.byYear[0]!.year}</span><span>choices shaped per year (peak {max})</span><span>year {w.reach.byYear[w.reach.byYear.length - 1]!.year}</span></figcaption>
                </figure>
              )}
              <ul className="hx-shaped">
                {w.reach.choices.slice(0, 8).map((c) => (
                  <li key={c.node.id}>
                    <button className="hx-link" onClick={() => onOpen(c.node.id)}>
                      <b style={{ color: agentColor(c.node.agent) }}>{c.node.agent ? (names[c.node.agent] ?? c.node.agent) : ""}</b> {c.node.label.replace(/^.*? chose: /, "chose: ")}
                    </button>
                    <small>{whenText(cal, c.node.tick)} · {Math.max(1, Math.round(c.share * 100))}%</small>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="hx-small">No later choice in the record traces back to it.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Ask the Historian about what is open, or about anything. Citations in the answer open the record. */
function Ask({ source, ov, why, sel, at, names, cal, onOpen }: { source: HistorySource; ov: Overview; why?: Why; sel?: string; at: number; names: Record<string, string>; cal: Calendar; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<Answer>();
  const [err, setErr] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  const n = why?.node;
  const name = n?.agent ? (names[n.agent] ?? n.agent) : undefined;
  const suggestions = n
    ? n.kind === "decision"
      ? [`Why did ${name} do this?`, `What was ${name} not aware of here?`, "Where did this start?"]
      : [`Where did this come from?`, `How has it shaped what ${name ?? "people"} did since?`, "Who passed it on?"]
    : ["What has shaped this place the most?", `What happened around ${whenText(cal, at)}?`];
  const ask = (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setErr(undefined);
    setQ(question);
    source.ask(question, n ? [sel && sel !== n.id ? sel : n.id] : undefined, at).then(setAns, (e) => setErr(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  const byRef = new Map((ans?.nodes ?? []).map((x) => [x.ref, x]));
  const usd = (x?: number) => (x === undefined ? "" : x < 0.01 ? "under a cent" : `$${x.toFixed(2)}`);
  return (
    <section className="hx-pane hx-ask">
      <h4>Ask the Historian</h4>
      <p className="hx-small">
        {ov.historian.method === "claude"
          ? <>Claude Opus reads the record around your question and answers from it. About a few cents a question, inside the daily cap.</>
          : <>Offline reader: free, reads the record straight. With a key set, Claude Opus answers instead.</>}
      </p>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <textarea ref={box} value={q} rows={2} placeholder={n ? "Ask about this, or about anything in the record" : "Why did Mara refuse the hall? Where did the town's fear of hunger come from?"} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); } }} aria-label="Your question" />
        <button className="hx-btn primary" disabled={busy || !q.trim()}>{busy ? "Reading..." : "Ask"}</button>
      </form>
      <div className="hx-suggest">
        {suggestions.map((s) => <button key={s} onClick={() => ask(s)} disabled={busy}>{s}</button>)}
      </div>
      {err && <p className="hx-small">{err}</p>}
      {ans && (
        <div className="hx-answer" aria-live="polite">
          <p className="hx-q">{ans.question}</p>
          {ans.answer.split(/\n{2,}/).map((para, i) => (
            <p key={i}>
              {para.split(/(\[n\d+\])/).map((part, j) => {
                const ref = /^\[(n\d+)\]$/.exec(part)?.[1];
                const node = ref ? byRef.get(ref) : undefined;
                return node ? <button key={j} className="hx-cite" onClick={() => onOpen(node.id)} title={`${KIND[node.kind]}${node.who ? ` · ${node.who}` : ""} · ${node.when}\n${node.label}`}>{ref!.slice(1)}</button> : <span key={j}>{part}</span>;
              })}
            </p>
          ))}
          {ans.gaps && <p className="hx-gaps">{ans.gaps}</p>}
          <p className="hx-small">
            {ans.method === "claude" ? `${ans.model ?? "Claude"} · ${usd(ans.usd)}` : `Offline reader · free${ans.usd ? ` (Opus would cost about ${usd(ans.usd)})` : ""}`} · read {ans.nodes.length} records, about {ans.briefTokens.toLocaleString()} tokens
          </p>
        </div>
      )}
    </section>
  );
}
