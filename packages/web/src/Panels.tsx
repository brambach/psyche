import { useState } from "react";
import { PLACES, type FeedItem } from "@psyche/engine";
import type { AgentSummary, Relation, RumorView } from "./api";
import { clock, diffWords } from "./util";

type Open = (agent: string, trace?: string) => void;

export function Cast({ agents, selected, onSelect }: { agents: AgentSummary[]; selected?: string; onSelect: (id: string) => void }) {
  return (
    <div className="cast">
      {agents.map((a) => (
        <button key={a.id} className={`person ${a.id === selected ? "on" : ""}`} onClick={() => onSelect(a.id)}>
          <span className="swatch" style={{ background: `var(--a-${a.id})` }}>{a.name[0]}</span>
          <span className="who">
            <b>{a.name}</b> <span className="small">{a.role}</span>
            <span className="doing">{a.activity}{a.activity !== "asleep" ? ` · ${PLACES[a.place].name}` : ""}</span>
          </span>
          <span className="vitals" aria-label={`Mood ${a.mood.toFixed(2)}, stress ${a.stress.toFixed(2)}`}>
            <Meter label="mood" value={a.mood} signed />
            <Meter label="stress" value={a.stress} />
            {a.emotion && <span className="emo">{a.emotion.name}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function Meter({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  const w = signed ? Math.min(50, Math.abs(value) * 50) : Math.min(100, value * 100);
  const left = signed ? (value >= 0 ? 50 : 50 - w) : 0;
  const color = signed ? (value >= 0 ? "var(--accent)" : "var(--feel)") : "var(--feel)";
  return (
    <span className="meter" title={`${label} ${value.toFixed(2)}`}>
      <span className="ml">{label}</span>
      <span className="mt">
        {signed && <i className="mid" />}
        <i style={{ left: `${left}%`, width: `${w}%`, background: color }} />
      </span>
    </span>
  );
}

const KIND_LABEL: Record<FeedItem["kind"], string> = {
  talk: "talk",
  event: "event",
  move: "moves",
  night: "night",
  morning: "morning",
  memory: "memory",
  insight: "insight",
};

export function Feed({ feed, names, onOpen }: { feed: FeedItem[]; names: Record<string, string>; onOpen: Open }) {
  const [quiet, setQuiet] = useState(true);
  const items = [...feed].reverse().filter((f) => !quiet || !(f.kind === "talk" && /passed the time/.test(f.title)));
  return (
    <div className="feed">
      <label className="small toggle">
        <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} /> Hide small talk
      </label>
      {items.length === 0 && <p className="empty">The island is waking up. Conversations will appear here as people run into each other.</p>}
      {items.map((f) => (
        <article key={f.id} className={`item k-${f.kind}`}>
          <header>
            <span className="when">{clock(f.tick)}</span>
            <span className="kind">{KIND_LABEL[f.kind]}</span>
            {f.place && <span className="where">{PLACES[f.place].name}</span>}
          </header>
          <h4>{f.title}</h4>
          {f.text && <p className="text">{f.text}</p>}
          {f.lines && (
            <div className="lines">
              {f.lines.map((l, i) => (
                <button key={i} className="line" disabled={!l.trace} onClick={() => l.trace && onOpen(l.speaker, l.trace)} title={l.trace ? `Open ${names[l.speaker] ?? l.speaker}'s brain scan for this moment` : undefined}>
                  <b style={{ color: l.speaker === "visitor" ? "var(--muted)" : `var(--a-${l.speaker})` }}>{l.speaker === "visitor" ? "You" : names[l.speaker]}</b> {l.text}
                  {l.trace && <span className="why">why?</span>}
                </button>
              ))}
            </div>
          )}
          {!f.lines && f.refs && f.refs.length > 0 && (
            <div className="refs">
              {f.refs.map((r) => (
                <button key={r.agent + r.trace} className="ref" onClick={() => onOpen(r.agent, r.trace)}>
                  Inside {names[r.agent]}'s head
                </button>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function Rumors({ rumors, names, onOpen }: { rumors: RumorView[]; names: Record<string, string>; onOpen: Open }) {
  if (rumors.length === 0) return <p className="empty">No stories have changed hands yet. When someone passes one on, you can follow it from mouth to mouth here, and watch it change.</p>;
  return (
    <div className="rumors">
      {rumors.map((r) => {
        const n = (id: string) => (id === "visitor" ? "a stranger" : names[id] ?? id);
        const mutations = r.hops.filter((h) => h.mutated).length;
        return (
          <article key={r.id} className="rumor">
            <header>
              <span className="kind">about {names[r.subject] ?? r.subject}</span>
              <span className="small">
                started with {n(r.origin)} · {r.hops.length} {r.hops.length === 1 ? "telling" : "tellings"}
                {mutations ? ` · changed ${mutations} ${mutations === 1 ? "time" : "times"}` : ""}
              </span>
            </header>
            <p className="first">“{r.first}”</p>
            <ol className="hops">
              {r.hops.map((h, i) => {
                const prev = i === 0 ? r.first : r.hops[i - 1]!.text;
                return (
                  <li key={i} className={h.mutated ? "mutated" : ""}>
                    <span className="when">{clock(h.tick)}</span>
                    <span className="route">
                      {n(h.from)} → {n(h.to)}
                    </span>
                    <span className="believed" title="How much the listener believed it">
                      <i style={{ width: `${Math.round(h.confidence * 100)}%` }} />
                    </span>
                    {h.text !== prev ? (
                      <span className="diff">
                        {diffWords(prev, h.text).map((d, j) => (d.kind === "same" ? <span key={j}>{d.text}</span> : d.kind === "del" ? <del key={j}>{d.text}</del> : <ins key={j}>{d.text}</ins>))}
                      </span>
                    ) : null}
                    {h.trace && h.to !== "visitor" && (
                      <button className="ref" onClick={() => onOpen(h.to, h.trace)}>
                        why {names[h.to]} believed it
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            {r.believers.length > 0 && (
              <div className="believers">
                {r.believers.map((b) => (
                  <span key={b.agent} className="chip" title={b.text}>
                    {names[b.agent]} {Math.round(b.confidence * 100)}%
                  </span>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function Relations({ order, relations, names, pronouns }: { order: string[]; relations: Relation[]; names: Record<string, string>; pronouns: Record<string, string> }) {
  const get = (from: string, to: string) => relations.find((r) => r.from === from && r.to === to)!;
  // Theory of mind gaps: what each person thinks the other feels, against what the other actually feels.
  const gaps = relations
    .map((r) => {
      const actual = (get(r.to, r.from).liking - 0.5) * 2;
      return { ...r, actual, gap: r.believedRegard - actual };
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 5);
  const feel = (x: number) => (x > 0.35 ? "likes" : x > 0.1 ? "is warm to" : x > -0.1 ? "is neutral about" : x > -0.35 ? "is cool toward" : "dislikes");
  return (
    <div className="relations">
      <div className="pane">
        <h3>How each person feels about the others</h3>
        <div className="tbl">
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col">feels about →</th>
                {order.map((id) => (
                  <th key={id} scope="col" style={{ color: `var(--a-${id})` }}>{names[id]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map((from) => (
                <tr key={from}>
                  <th scope="row" style={{ color: `var(--a-${from})` }}>{names[from]}</th>
                  {order.map((to) => {
                    if (from === to) return <td key={to} className="self">·</td>;
                    const r = get(from, to);
                    const v = (r.liking - 0.5) * 2;
                    const pctAmt = Math.round(Math.min(1, Math.abs(v)) * 55);
                    return (
                      <td key={to} style={{ background: `color-mix(in srgb, ${v >= 0 ? "var(--accent)" : "var(--feel)"} ${pctAmt}%, var(--surface))` }} title={`liking ${r.liking.toFixed(2)}, trusts intentions ${r.benevolence.toFixed(2)}, trusts word ${r.integrity.toFixed(2)}`}>
                        <span className="n">{r.liking.toFixed(2)}</span>
                        <span className="t">trust {r.benevolence.toFixed(2)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">Liking from 0 to 1. Trust is belief in their good intentions. Both move with what people do and with what they hear about each other.</p>
      </div>
      <div className="pane">
        <h3>Misreadings</h3>
        <ul className="gaps">
          {gaps.map((g) => (
            <li key={g.from + g.to}>
              <b>{names[g.from]}</b> thinks {names[g.to]} {feel(g.believedRegard)} {pronouns[g.from]} ({g.believedRegard.toFixed(2)}). In fact {names[g.to]} {feel(g.actual)} {pronouns[g.from]} ({g.actual.toFixed(2)}).
            </li>
          ))}
        </ul>
        <p className="small">Every mind keeps its own model of what others feel about it. Nobody can see inside anyone else, so these models drift from the truth.</p>
      </div>
    </div>
  );
}
