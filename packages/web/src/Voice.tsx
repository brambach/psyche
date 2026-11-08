// Speak into the world. You can walk up to someone as a stranger, preach as a prophet where people
// gather, speak to the whole town out of the sky, or send one person a dream. Then watch what the town
// does with it: who believes, how the words change from mouth to mouth and why, whether your prophecy
// comes true, and whether it turns into a rite, a faith, and a schism.

import { useEffect, useMemo, useState } from "react";
import type { Guise, VoiceLineage, WordSummary, LineageNode, BendKind } from "@psyche/engine";
import { api, type GameView } from "./api";
import { clock, placeName } from "./util";

const GUISES: { id: Guise; icon: string; label: string; hint: string }[] = [
  { id: "stranger", icon: "🧳", label: "Stranger", hint: "Walk up to one person. Anyone close by may overhear. A stranger has little authority." },
  { id: "prophet", icon: "🕯️", label: "Prophet", hint: "Preach where people gather. If nobody's there, you wait for a crowd." },
  { id: "sky", icon: "☁️", label: "Voice from the sky", hint: "Everyone hears it at once. At night the whole town dreams it. The hard-headed explain it away." },
  { id: "dream", icon: "🌙", label: "Dream", hint: "One person dreams it tonight. A dream is easy to doubt, and hard to forget." },
];

const IDEAS: Record<Guise, string[]> = {
  stranger: ["A great storm will come before winter, and the sea will take what it is owed.", "Don't trust the one who keeps the store.", "There is a better shore to the north, for those brave enough to go."],
  prophet: ["The dead are watching. Gather at the headland each dusk, or they will come for the children.", "Share what you have at the common store each evening, and no one will go hungry this winter.", "Perhaps you think you are alone here. You are watched."],
  sky: ["A storm will come in three days. Leave a fish at the landing each dawn.", "Do not fish on the seventh day.", "I am watching you. All of you."],
  dream: ["You were chosen. Lead them.", "The sea remembers what you did.", "A child will be born before spring, and it will be special."],
};

export const BEND_LABEL: Record<BendKind, { label: string; tip: string }> = {
  source: { label: "source grew", tip: "Who said it climbed: a forgotten source gets filled with something grander (source monitoring)." },
  deflated: { label: "source shrank", tip: "A doubter made the source smaller." },
  levelled: { label: "levelled", tip: "Hedges and side details dropped away (Allport & Postman 1947)." },
  sharpened: { label: "sharpened", tip: "The core got bigger, usually from fear (Allport & Postman 1947)." },
  scapegoat: { label: "scapegoat", tip: "A bad omen picked up a culprit from the teller's grudges (Bartlett 1932; Girard)." },
  chosen: { label: "favourite", tip: "A good omen picked up someone the teller is fond of." },
  self: { label: "self-insertion", tip: "The teller put themself in it (low honesty-humility)." },
  moralized: { label: "grew a condition", tip: "A warning grew an 'unless we...', from the teller's own values. Conditions become practices." },
  rationalized: { label: "explained away", tip: "After a failed prophecy." },
};

type Props = {
  view: GameView;
  busy: boolean;
  act: (f: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
  onMind: (id: string, trace?: string) => void;
  onTrace: (word: string) => void;
};

/** The left-hand panel: how you appear, what you say, and what has become of what you said. */
export function VoicePanel({ view, busy, act, onClose, onMind, onTrace }: Props) {
  const [guise, setGuise] = useState<Guise>("stranger");
  const [text, setText] = useState("");
  const [to, setTo] = useState<string>("");
  const [place, setPlace] = useState<string>("tavern");
  const agents = view.agents ?? [];
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of agents) c[a.place] = (c[a.place] ?? 0) + 1;
    return c;
  }, [agents]);
  const social = Object.values(view.places ?? {}).filter((p) => p.social);
  const g = GUISES.find((x) => x.id === guise)!;
  const needsTo = guise === "stranger" || guise === "dream";
  const target = to || agents.find((a) => a.place !== "home")?.id || agents[0]?.id || "";
  const voice = view.voice;

  const speak = () =>
    act(async () => {
      await api.speak({ guise, text: text.trim(), to: needsTo ? target : undefined, place: guise === "prophet" ? place : undefined });
      setText("");
    });

  return (
    <aside className="v-panel" aria-label="Speak into the world">
      <div className="v-head">
        <div>
          <small>You, in the world</small>
          <b>Speak into {view.name}</b>
        </div>
        <button className="g-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="v-guises" role="radiogroup" aria-label="How you appear">
        {GUISES.map((x) => (
          <button key={x.id} role="radio" aria-checked={guise === x.id} className={guise === x.id ? "on" : ""} onClick={() => setGuise(x.id)}>
            <span aria-hidden>{x.icon}</span> {x.label}
          </button>
        ))}
      </div>
      <p className="g-small">{g.hint}</p>
      {needsTo && (
        <label className="v-field">
          <span>{guise === "dream" ? "Who dreams it" : "Who you stop"}</span>
          <select value={target} onChange={(e) => setTo(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}, {a.role}: {a.activity}
              </option>
            ))}
          </select>
        </label>
      )}
      {guise === "prophet" && (
        <label className="v-field">
          <span>Where you preach</span>
          <select value={place} onChange={(e) => setPlace(e.target.value)}>
            {social.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({counts[p.id] ?? 0} there now)
              </option>
            ))}
          </select>
        </label>
      )}
      <form
        className="v-say"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void speak();
        }}
      >
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={400} rows={3} placeholder="Say something. A prophecy (“a storm will come in three days”), a command (“leave a fish at the landing each dawn”, “do not fish on the seventh day”), a judgement on someone, or anything at all." aria-label="What you say" />
        <button className="g-btn primary" disabled={busy || !text.trim()}>
          {g.icon} Speak
        </button>
      </form>
      <div className="v-ideas">
        {IDEAS[guise].map((i) => (
          <button key={i} className="g-mini" onClick={() => setText(i)}>
            {i}
          </button>
        ))}
      </div>

      <h3 className="v-h">Your words</h3>
      {!voice?.words.length && <p className="g-quiet">Nothing yet. Once you speak, you can follow your words from mouth to mouth and see what each teller's mind did to them.</p>}
      <ol className="v-words">
        {[...(voice?.words ?? [])].reverse().map((w) => (
          <WordCard key={w.id} w={w} names={names} busy={busy} onTrace={() => onTrace(w.id)} onFulfil={() => act(() => api.fulfil(w.id))} onMind={onMind} tick={view.tick} />
        ))}
      </ol>
      {voice && voice.faiths.length > 0 && (
        <>
          <h3 className="v-h">Faiths</h3>
          <ul className="v-faiths">
            {voice.faiths.map((f) => (
              <li key={f.id} className={f.ended ? "ended" : ""}>
                <b>{f.name}</b>
                <span>
                  {f.ended ? "faded" : `${f.members} ${f.members === 1 ? "member" : "members"}`} · kept by{" "}
                  <button className="v-link" onClick={() => onMind(f.keeper)}>{f.keeperName}</button> · since {clock(f.founded).replace(/ · .*/, "")}
                </span>
                {f.split && <small>Split off: {f.split}.</small>}
              </li>
            ))}
          </ul>
        </>
      )}
      {voice && voice.log.length > 0 && (
        <>
          <h3 className="v-h">What came of it</h3>
          <ol className="v-log">
            {[...voice.log].reverse().slice(0, 12).map((l, i) => (
              <li key={`${l.tick}-${i}`} className={`v-log-${l.kind}`}>
                <time>{clock(l.tick).replace(/^Day /, "D")}</time> {l.text}
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

const GUISE_ICON: Record<Guise, string> = { stranger: "🧳", prophet: "🕯️", sky: "☁️", dream: "🌙" };

function WordCard({ w, names, busy, onTrace, onFulfil, onMind, tick }: { w: WordSummary; names: Record<string, string>; busy: boolean; onTrace: () => void; onFulfil: () => void; onMind: (id: string) => void; tick: number }) {
  const p = w.prophecy;
  const left = p && !p.outcome ? Math.max(0, p.by - tick) : 0;
  return (
    <li className="v-word">
      <div className="v-word-top">
        <span aria-hidden>{GUISE_ICON[w.guise]}</span>
        <q>{w.text}</q>
      </div>
      <div className="v-stats">
        {w.pending ? (
          <span>{w.guise === "prophet" ? `Waiting for a crowd at ${placeName(w.place ?? "")}` : "Waiting for night"}</span>
        ) : (
          <>
            <span>heard by {w.heard}</span>
            <span className="v-believe">{w.believe} believe</span>
            {w.lapsed > 0 && <span>{w.lapsed} fell away</span>}
            <span>{w.versions} {w.versions === 1 ? "version" : "versions"}</span>
          </>
        )}
      </div>
      {p && (
        <div className={`v-prophecy v-${p.outcome ?? "pending"}`}>
          {p.outcome === "fulfilled" ? `✓ Came true: ${p.how}` : p.outcome === "failed" ? "✗ Never came. Watch who keeps believing anyway." : `Foretold: ${p.event === "gale" ? "a storm" : p.event}, due in ${left >= 1440 ? `${Math.round(left / 1440)} ${Math.round(left / 1440) === 1 ? "day" : "days"}` : `${Math.max(1, Math.round(left / 60))} hours`}`}
          {p.canFulfil && (
            <button className="g-btn primary" disabled={busy} onClick={onFulfil} title="You are the weather. Make your prophecy come true now.">
              ⚡ Make it so
            </button>
          )}
        </div>
      )}
      {w.practice && <div className="v-chip">{w.rite ? "A rite now: " : "Asks: "}{w.practice}</div>}
      {w.furthest && (
        <div className="v-far">
          <small>{w.furthest.depth} tellings out, <button className="v-link" onClick={() => onMind(w.furthest!.agent)}>{names[w.furthest.agent] ?? w.furthest.agent}</button> has it as</small>
          <q>{w.furthest.text}</q>
        </div>
      )}
      <button className="g-btn v-trace" onClick={onTrace} disabled={!w.heard}>Trace it through the town →</button>
    </li>
  );
}

// ------------------------------------------------------------------ the lineage of one word

/** Word-level diff: what the listener's version has that the teller's didn't. */
function diff(before: string, after: string): { t: string; added: boolean }[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const n = a.length;
  const m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: { t: string; added: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && a[i] === b[j]) {
      out.push({ t: b[j]!, added: false });
      i++;
      j++;
    } else if (i < n && L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else {
      out.push({ t: b[j]!, added: /\S/.test(b[j]!) });
      j++;
    }
  }
  return out;
}

export function Lineage({ id, tick, onClose, onMind }: { id: string; tick: number; onClose: () => void; onMind: (id: string, trace?: string) => void }) {
  const [L, setL] = useState<VoiceLineage>();
  const [err, setErr] = useState<string>();
  const [kind, setKind] = useState<BendKind | "">("");
  // Read it again every sim hour or so while it is open.
  const hour = Math.floor(tick / 60);
  useEffect(() => {
    api.voiceWord(id).then(setL, (e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [id, hour]);
  const tree = useMemo(() => {
    if (!L) return [];
    const by = new Map<string, LineageNode[]>();
    const known = new Set(L.nodes.map((n) => n.agent));
    for (const n of L.nodes) {
      const parent = known.has(n.from) ? n.from : "";
      by.set(parent, [...(by.get(parent) ?? []), n]);
    }
    const out: { n: LineageNode; level: number; parentText: string }[] = [];
    const seen = new Set<string>();
    const walk = (parent: string, level: number, parentText: string) => {
      for (const n of by.get(parent) ?? []) {
        if (seen.has(n.agent)) continue;
        seen.add(n.agent);
        out.push({ n, level, parentText });
        walk(n.agent, level + 1, n.text);
      }
    };
    walk("", 0, "");
    return out;
  }, [L]);
  if (err) return <Shell onClose={onClose}><p>{err}</p></Shell>;
  if (!L) return <Shell onClose={onClose}><p className="g-small">Following your words...</p></Shell>;
  const w = L.word;
  return (
    <Shell onClose={onClose}>
      <header className="vl-head">
        <small>{GUISE_ICON[w.guise]} You, as {w.guise === "sky" ? "a voice from the sky" : `a ${w.guise}`}, {clock(w.tick)}</small>
        <h2>“{w.text}”</h2>
        <p className="vl-sum">
          Heard by <b>{w.heard}</b>, believed by <b>{w.believe}</b>
          {w.lapsed ? `, ${w.lapsed} fell away` : ""}. It exists in <b>{w.versions}</b> {w.versions === 1 ? "version" : "versions"}.
          {w.prophecy?.outcome === "fulfilled" ? ` The prophecy came true (${w.prophecy.how}).` : w.prophecy?.outcome === "failed" ? " The prophecy failed." : ""}
        </p>
      </header>
      <section className="vl-grid">
        <div className="vl-main">
          <h3>Mouth to mouth</h3>
          <p className="g-small">Each line is one person and the version they hold. Highlighted words are what changed on the way to them; the tags say which teller's mind changed it and why. Pick a tag to show only those.</p>
          {L.mechanisms.length > 0 && (
            <div className="vl-filter">
              <button className={kind === "" ? "on" : ""} onClick={() => setKind("")}>All</button>
              {L.mechanisms.map((m) => (
                <button key={m.kind} className={`${kind === m.kind ? "on" : ""} vb-${m.kind}`} onClick={() => setKind(kind === m.kind ? "" : m.kind)} title={BEND_LABEL[m.kind].tip}>
                  {BEND_LABEL[m.kind].label} ×{m.count}
                </button>
              ))}
            </div>
          )}
          <ol className="vl-tree">
            {tree.map(({ n, level, parentText }) => {
              const dim = kind && !n.bends.some((b) => b.kind === kind);
              return (
                <li key={n.agent} style={{ marginLeft: Math.min(level, 8) * 18 }} className={`${dim ? "dim" : ""} ${n.lapsed ? "lapsed" : ""}`}>
                  <div className="vl-who">
                    <button className="v-link" onClick={() => onMind(n.agent, n.trace)} title="Open their mind at the moment they heard it">{n.name}</button>
                    <span className="g-small">from {n.fromName} · {clock(n.tick).replace(/^Day /, "D")}</span>
                    <span className="vl-faith" title={`Believes it ${Math.round(n.faith * 100)}%`}>
                      <i style={{ width: `${Math.round(n.faith * 100)}%` }} />
                    </span>
                    {n.lapsed && <span className="vl-badge">fell away</span>}
                    {n.doubled && <span className="vl-badge hot">doubled down</span>}
                    {n.told > 0 && <span className="g-small">told {n.told}</span>}
                    {n.practiced > 0 && <span className="g-small">kept it {n.practiced}×</span>}
                    {n.faith_ && <span className="vl-badge">{n.faith_}</span>}
                  </div>
                  <p className="vl-text">
                    {parentText ? diff(parentText, n.text).map((d, i) => (d.added ? <mark key={i}>{d.t}</mark> : <span key={i}>{d.t}</span>)) : n.text}
                  </p>
                  {n.bends.length > 0 && (
                    <ul className="vl-bends">
                      {n.bends.map((b, i) => (
                        <li key={i} className={`vb-${b.kind}`}>
                          <b title={BEND_LABEL[b.kind].tip}>{BEND_LABEL[b.kind].label}</b> {b.text}
                          {b.cause && (
                            <span className="vl-cause">
                              {" "}by{" "}
                              <button className="v-link" onClick={() => onMind(b.agent)}>{L.nodes.find((x) => x.agent === b.agent)?.name ?? b.agent}</button>, because: {b.cause.text}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        <aside className="vl-side">
          <h3>How it spread</h3>
          <Curve curve={L.curve} />
          {L.culprits.length > 0 && (
            <>
              <h3>Who it blames</h3>
              <p className="g-small">You never named them. Someone's grudge did.</p>
              <ul className="vl-culprits">
                {L.culprits.map((c) => (
                  <li key={c.agent}>
                    <button className="v-link" onClick={() => onMind(c.agent)}>{c.name}</button>: {c.holders} {c.holders === 1 ? "person holds" : "people hold"} it.
                    {c.first && (
                      <small>
                        First blamed by <button className="v-link" onClick={() => onMind(c.first!.by)}>{c.first.byName}</button>
                        {c.first.cause ? `, because: ${c.first.cause.text}` : ""}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {L.mechanisms.length > 0 && (
            <>
              <h3>What bent it</h3>
              <ul className="vl-mech">
                {L.mechanisms.map((m) => (
                  <li key={m.kind}>
                    <b className={`vb-${m.kind}`} title={BEND_LABEL[m.kind].tip}>{BEND_LABEL[m.kind].label}</b> ×{m.count}
                    <small>most by {m.by.slice(0, 2).map((x) => x.name).join(", ")}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          {L.log.length > 0 && (
            <>
              <h3>What came of it</h3>
              <ol className="v-log">
                {L.log.map((l, i) => (
                  <li key={i} className={`v-log-${l.kind}`}>
                    <time>{clock(l.tick).replace(/^Day /, "D")}</time> {l.text}
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      </section>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="vl" role="dialog" aria-label="Where your words went">
      <div className="vl-box">
        <button className="g-btn vl-close" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}

/** Heard and believing over time. */
function Curve({ curve }: { curve: VoiceLineage["curve"] }) {
  if (curve.length < 2) return <p className="g-small">Give it a few hours.</p>;
  const W = 300;
  const H = 110;
  const t0 = curve[0]!.tick;
  const t1 = curve[curve.length - 1]!.tick;
  const max = Math.max(1, ...curve.map((c) => c.heard));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (W - 30) + 26;
  const y = (v: number) => H - 16 - (v / max) * (H - 26);
  const line = (k: "heard" | "believe") => curve.map((c, i) => `${i ? "L" : "M"}${x(c.tick).toFixed(1)},${y(c[k]).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="vl-curve" role="img" aria-label={`Heard by ${curve[curve.length - 1]!.heard}, believed by ${curve[curve.length - 1]!.believe}`}>
      <line x1={26} x2={W - 4} y1={H - 16} y2={H - 16} className="vl-axis" />
      <text x={22} y={y(max) + 4} textAnchor="end" className="vl-tick">{max}</text>
      <text x={22} y={H - 12} textAnchor="end" className="vl-tick">0</text>
      <text x={26} y={H - 2} className="vl-tick">{clock(t0).replace(/ · .*/, "")}</text>
      <text x={W - 4} y={H - 2} textAnchor="end" className="vl-tick">{clock(t1).replace(/ · .*/, "")}</text>
      <path d={line("heard")} className="vl-heard" />
      <path d={line("believe")} className="vl-believe" />
      <text x={W - 4} y={y(curve[curve.length - 1]!.heard) - 4} textAnchor="end" className="vl-lab heard">heard</text>
      <text x={W - 4} y={y(curve[curve.length - 1]!.believe) + 12} textAnchor="end" className="vl-lab believe">believe</text>
    </svg>
  );
}
