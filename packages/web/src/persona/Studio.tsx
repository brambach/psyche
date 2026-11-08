// Bring someone into the world from their own writing. Paste what they wrote, read a mind from it,
// look over every piece beside the words it came from (and leave out anything that's wrong), then a
// boat brings them to the town you're watching. After that they live by the same engine as everyone.

import { useEffect, useMemo, useState } from "react";
import type { PersonaReading, TraitName } from "@psyche/engine";
import { personaApi } from "./api";
import "./persona.css";

const TRAITS: { key: TraitName; label: string; low: string; high: string }[] = [
  { key: "openness", label: "Openness", low: "keeps to what they know", high: "curious, reaches for the new" },
  { key: "conscientiousness", label: "Conscientiousness", low: "loose, spontaneous", high: "careful, plans ahead" },
  { key: "extraversion", label: "Extraversion", low: "quiet, keeps to themselves", high: "outgoing, draws energy from people" },
  { key: "agreeableness", label: "Agreeableness", low: "blunt, hard to move", high: "warm, accommodating" },
  { key: "neuroticism", label: "Neuroticism", low: "steady, hard to rattle", high: "worries, feels things hard" },
  { key: "honesty", label: "Honesty-humility", low: "out for themselves", high: "fair, modest, straight" },
];

const TRADE_WORDS: Record<string, string> = { builder: "builder", farmer: "farmer", fisher: "fisher", forager: "forager", woodcutter: "woodcutter", quarrier: "quarrier", thatcher: "thatcher" };

const VALUE_WORDS: Record<string, string> = {
  "self-direction": "Freedom to choose their own way",
  achievement: "Doing well, and being seen to",
  benevolence: "The people close to them",
  universalism: "Fairness for everyone",
  security: "Safety, and having enough",
  stimulation: "Novelty and excitement",
  hedonism: "Enjoying life",
  tradition: "Where they come from",
  conformity: "Doing what's expected",
  power: "Standing and a say",
};

export function Studio({ town, faculties, onClose, onArrived }: { town: string; faculties: "claude" | "mock"; onClose: () => void; onArrived: (id: string) => void }) {
  const [step, setStep] = useState<"write" | "read">("write");
  const [name, setName] = useState("");
  const [pronouns, setPronouns] = useState<"she" | "he" | "they">("they");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [sample, setSample] = useState(false);
  const [reading, setReading] = useState<PersonaReading>();
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "read" | "arrive">("");
  const [error, setError] = useState<string>();

  const words = useMemo(() => text.split(/\s+/).filter(Boolean).length, [text]);
  const chat = useMemo(() => {
    const lines = text.split("\n").filter((l) => l.trim());
    return lines.length >= 4 && lines.filter((l) => /^(?:\[[^\]]{4,40}\]\s*)?[A-Za-z][\w .'-]{0,30}?:\s/.test(l.trim())).length >= lines.length * 0.5;
  }, [text]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [busy, onClose]);

  const loadSample = async () => {
    setError(undefined);
    try {
      const s = await personaApi.sample();
      setName(s.name);
      setPronouns(s.pronouns);
      setAuthor("");
      setText(s.text);
      setSample(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const read = async () => {
    setBusy("read");
    setError(undefined);
    try {
      const r = await personaApi.read({ text, name, pronouns, author: author || undefined });
      setReading(r.reading);
      setOff(new Set());
      setStep("read");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const final = (): PersonaReading | undefined => {
    if (!reading) return undefined;
    const memories = reading.memories.filter((m) => !off.has(m.id));
    const kept = new Set(memories.map((m) => m.id));
    return {
      ...reading,
      memories,
      beliefs: reading.beliefs.filter((b) => !off.has(b.id)).map((b) => (b.memory && !kept.has(b.memory) ? { ...b, memory: undefined } : b)),
      values: reading.values.filter((v) => !off.has(v.value)),
    };
  };

  const arrive = async () => {
    const r = final();
    if (!r) return;
    setBusy("arrive");
    setError(undefined);
    try {
      const { id } = await personaApi.arrive(r);
      onArrived(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  };

  const toggle = (k: string) => setOff((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const setTrait = (t: TraitName, v: number) => reading && setReading({ ...reading, traits: { ...reading.traits, [t]: { ...reading.traits[t], value: v } } });
  const first = (reading?.name ?? name).split(/\s+/)[0] || "them";

  return (
    <div className="ps-veil" role="dialog" aria-label="Bring someone into the world" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="ps-sheet">
        <header className="ps-head">
          <div>
            <small>Bring someone into the world</small>
            <h2>{step === "write" ? "Their writing" : `${reading?.name}, as ${reading?.method === "claude" ? "Claude" : "the offline reader"} reads them`}</h2>
          </div>
          <button className="g-btn" onClick={onClose} disabled={!!busy} aria-label="Close">✕</button>
        </header>

        {step === "write" && (
          <div className="ps-body">
            <p className="ps-lede">
              Paste a person's own writing: chat messages, notes to self, a journal. A mind is read from it (temperament, the memories that formed them, what they believe about people, what they value, how they talk), and you see every piece next to the words it came from. Then a boat brings them to {town}, alone, and they live by the same engine as everyone else.
            </p>
            <div className="ps-row">
              <label>
                <span>Name</span>
                <input type="text" value={name} onChange={(e) => { setName(e.target.value); setSample(false); }} placeholder="Who is this?" maxLength={40} />
              </label>
              <label>
                <span>Pronouns</span>
                <select value={pronouns} onChange={(e) => setPronouns(e.target.value as "she" | "he" | "they")}>
                  <option value="they">they</option>
                  <option value="she">she</option>
                  <option value="he">he</option>
                </select>
              </label>
              {chat && (
                <label>
                  <span>Their name in the chat</span>
                  <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Whoever wrote most" maxLength={40} />
                </label>
              )}
            </div>
            <label className="ps-text">
              <span>
                Their writing <em>{words.toLocaleString()} words{chat ? " · looks like a chat: only their own lines are read" : ""}</em>
              </span>
              <textarea value={text} onChange={(e) => { setText(e.target.value); setSample(false); }} placeholder={"Paste messages, notes or a journal here.\n\nA chat export works too (\"Name: message\" lines, with or without timestamps): only the person's own lines are read.\n\nA few thousand words of everyday writing make a good likeness."} spellCheck={false} />
            </label>
            {sample && <p className="ps-note ps-sample">Juniper Vale is made up. Every name and event in this sample is invented, for trying the import without anyone's real writing.</p>}
            <p className="ps-note">
              {faculties === "claude"
                ? "Read by Claude (one call, a few cents, counted against today's cap). The writing is sent to Claude to be read; only the reading and the short quotes it cites are kept with the world."
                : "Read on the free offline reader, from word patterns: a rough likeness. With Claude connected the same writing gets a close reading. Nothing leaves this machine; only the reading and the short quotes it cites are kept with the world."}
            </p>
            {error && <p className="ps-error" role="alert">{error}</p>}
            <footer className="ps-foot">
              <button className="g-btn" onClick={loadSample} disabled={!!busy}>Try a made-up sample person</button>
              <button className="g-btn primary" onClick={read} disabled={!!busy || !text.trim() || !name.trim()}>{busy === "read" ? "Reading..." : "Read their mind"}</button>
            </footer>
          </div>
        )}

        {step === "read" && reading && (
          <div className="ps-body">
            <div className="ps-who">
              <p className="ps-lede">
                <b>{reading.name}</b>, {reading.age}. Will work as a {TRADE_WORDS[reading.trade.role]} in {town}{reading.trade.why ? ` (${reading.trade.why.replace(/\.$/, "").toLowerCase()})` : ""}. {reading.summary}
              </p>
              <div className="ps-chips">
                <span className={`ps-chip ${reading.method}`}>{reading.method === "claude" ? `Claude${reading.model ? ` · ${reading.model}` : ""}` : "Offline reader · free"}</span>
                <span className="ps-chip">{reading.words.toLocaleString()} words · {reading.passages} passages</span>
                <span className="ps-chip" title="How far to trust this reading, mostly from how much writing there was">Likeness {Math.round(reading.confidence * 100)}%</span>
              </div>
              {reading.notes.length > 0 && (
                <ul className="ps-notes">
                  {reading.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </div>

            <section className="ps-sec">
              <h3>Temperament</h3>
              <p className="ps-hint">Read from how they write. Drag a bar if it's wrong.</p>
              <div className="ps-traits">
                {TRAITS.map((t) => {
                  const tr = reading.traits[t.key];
                  return (
                    <div key={t.key} className="ps-trait">
                      <div className="ps-trait-top">
                        <b>{t.label}</b>
                        <span>{tr.value.toFixed(2)} · {tr.value >= 0.5 ? t.high : t.low}</span>
                      </div>
                      <input type="range" min={0.03} max={0.97} step={0.01} value={tr.value} onChange={(e) => setTrait(t.key, Number(e.target.value))} aria-label={t.label} />
                      <small>{tr.why}</small>
                      <Quotes quotes={tr.evidence} />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="ps-sec">
              <h3>The memories that formed them</h3>
              <p className="ps-hint">What happened to them, in their words, and how they'll remember it in {town}. These come before the crossing.</p>
              {reading.memories.length === 0 && <p className="ps-quiet">Nothing in the writing reads like a formative memory. More writing about their past would help.</p>}
              {reading.memories.map((m) => (
                <Card key={m.id} on={!off.has(m.id)} onToggle={() => toggle(m.id)} tone={m.valence}>
                  <div className="ps-pair">
                    <div>
                      <small>They wrote</small>
                      <blockquote className={m.quote.found ? "" : "ps-unfound"}>{m.quote.text}</blockquote>
                    </div>
                    <div>
                      <small>In {town} they remember</small>
                      <p>{m.gist}</p>
                    </div>
                  </div>
                  <span className="ps-meta">{m.valence >= 0.25 ? "a good memory" : m.valence <= -0.25 ? "a painful memory" : "mixed"} · {m.yearsAgo} {m.yearsAgo === 1 ? "year" : "years"} ago{m.coping < 0.35 ? " · they couldn't do much about it then" : ""}</span>
                </Card>
              ))}
            </section>

            <section className="ps-sec">
              <h3>Core beliefs</h3>
              <p className="ps-hint">What they hold true about people and the world. These tilt how they read every hard choice that touches them.</p>
              {reading.beliefs.length === 0 && <p className="ps-quiet">No core beliefs stand out in the writing.</p>}
              {reading.beliefs.map((b) => {
                const mem = reading.memories.find((m) => m.id === b.memory);
                return (
                  <Card key={b.id} on={!off.has(b.id)} onToggle={() => toggle(b.id)} tone={b.blame < 0 || b.threat < 0 ? 0.5 : -0.5}>
                    <p className="ps-belief">“{b.text}”</p>
                    <span className="ps-meta">
                      {b.kind === "stated" ? "Said outright" : "What a memory taught them"} · strength {b.strength.toFixed(2)} · comes up around {b.triggers.slice(0, 4).join(", ")}
                    </span>
                    {b.kind === "stated" && <Quotes quotes={b.evidence} open />}
                    {mem && <p className="ps-from">Where it began: {mem.quote.text.length > 140 ? `${mem.quote.text.slice(0, 140)}…` : mem.quote.text}{off.has(mem.id) ? " (left out)" : ""}</p>}
                  </Card>
                );
              })}
            </section>

            <section className="ps-sec ps-cols">
              <div>
                <h3>What they value</h3>
                {reading.values.length === 0 && <p className="ps-quiet">Nothing stands out.</p>}
                {reading.values.map((v) => (
                  <Card key={v.value} on={!off.has(v.value)} onToggle={() => toggle(v.value)}>
                    <b>{VALUE_WORDS[v.value] ?? v.value}</b>
                    <span className="ps-meta">Becomes a goal in {town}: {v.goal.text.toLowerCase()}</span>
                    <Quotes quotes={v.evidence} />
                  </Card>
                ))}
              </div>
              <div>
                <h3>How they talk</h3>
                <p>{reading.voice.description}</p>
                {reading.voice.samples.map((s, i) => <blockquote key={i}>{s}</blockquote>)}
                <h3>People they leave behind</h3>
                <p className="ps-hint">Nobody in {town} knows them. These people live on in their memories.</p>
                <ul className="ps-people">
                  {reading.people.map((p) => (
                    <li key={p.name}>
                      <b>{p.name}</b>
                      {p.relation && !p.name.startsWith("my ") ? <span> · {p.relation}</span> : null}
                      <i className={p.feeling >= 0.2 ? "warm" : p.feeling <= -0.2 ? "cold" : ""}>{p.feeling >= 0.2 ? "fond" : p.feeling <= -0.2 ? "hurt" : "mixed"}</i>
                    </li>
                  ))}
                  {reading.people.length === 0 && <li className="ps-quiet">Nobody named more than once.</li>}
                </ul>
                <h3>Attachment and self</h3>
                <dl className="ps-dl">
                  <dt>Fear of being left</dt>
                  <dd><Bar v={reading.attachment.anxiety} /></dd>
                  <dt>Keeps people at a distance</dt>
                  <dd><Bar v={reading.attachment.avoidance} /></dd>
                  <dt>Thinks well of themselves</dt>
                  <dd><Bar v={reading.self.selfEsteem} /></dd>
                  <dt>Believes they can manage</dt>
                  <dd><Bar v={reading.self.selfEfficacy} /></dd>
                </dl>
                {(reading.attachment.why || reading.self.why) && <small className="ps-hint">{[reading.attachment.why, reading.self.why].filter(Boolean).join(". ")}.</small>}
              </div>
            </section>

            {error && <p className="ps-error" role="alert">{error}</p>}
            <footer className="ps-foot">
              <button className="g-btn" onClick={() => setStep("write")} disabled={!!busy}>Back to the writing</button>
              <button className="g-btn primary" onClick={arrive} disabled={!!busy}>{busy === "arrive" ? "The boat is coming in..." : `Bring ${first} to ${town}`}</button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ on, onToggle, tone, children }: { on: boolean; onToggle: () => void; tone?: number; children: React.ReactNode }) {
  return (
    <div className={`ps-card ${on ? "" : "off"} ${tone === undefined ? "" : tone >= 0.25 ? "good" : tone <= -0.25 ? "hard" : ""}`}>
      <label className="ps-keep" title={on ? "Leave this out" : "Keep this"}>
        <input type="checkbox" checked={on} onChange={onToggle} />
        <span>{on ? "Keep" : "Left out"}</span>
      </label>
      <div className="ps-card-body">{children}</div>
    </div>
  );
}

function Quotes({ quotes, open: startOpen = false }: { quotes: { text: string; found: boolean }[]; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (!quotes.length) return null;
  return (
    <div className="ps-quotes">
      {open ? (
        quotes.map((q, i) => (
          <blockquote key={i} className={q.found ? "" : "ps-unfound"} title={q.found ? "Found word for word in the writing" : "Couldn't be found word for word in the writing"}>
            {q.text}
          </blockquote>
        ))
      ) : (
        <button className="ps-link" onClick={() => setOpen(true)}>Because they wrote… ({quotes.length})</button>
      )}
    </div>
  );
}

function Bar({ v }: { v: number }) {
  return (
    <span className="ps-bar" title={v.toFixed(2)}>
      <i style={{ width: `${Math.round(v * 100)}%` }} />
    </span>
  );
}
