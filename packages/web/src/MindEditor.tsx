// Change someone's mind while the world runs: their personality, their core beliefs, how they feel
// about the others, their memories, a thought whispered in. Every change is recorded, and the Why view
// traces what it bends afterwards back to it ("because you…").

import { useEffect, useState } from "react";
import type { TraitName } from "@psyche/engine";
import { api, type Editable, type MindEdit } from "./api";

const TRAITS: [TraitName, string, string][] = [
  ["openness", "Curious", "Openness: new ideas, new crafts. The curious and careful work crafts out."],
  ["conscientiousness", "Careful", "Conscientiousness: steady work, keeping promises. Leaders and careful traders."],
  ["extraversion", "Outgoing", "Extraversion: company, talk, going out in the evening. Outgoing people teach what they know."],
  ["agreeableness", "Kind", "Agreeableness: giving, forgiving, putting into the common store, making amends."],
  ["neuroticism", "Anxious", "Neuroticism: worry, stress, reading threat into things."],
  ["honesty", "Honest", "Honesty-humility: fair dealing, no cheating on a trade."],
];

export function MindEditor({ id, names, onEdited }: { id: string; names: Record<string, string>; onEdited?: () => void }) {
  const [ed, setEd] = useState<Editable>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [town, setTown] = useState(false);
  const [notice, setNotice] = useState(false);
  const [heritable, setHeritable] = useState(false);
  const [traits, setTraits] = useState<Record<string, number>>({});
  const [lock, setLock] = useState<Record<string, boolean>>({});
  const [fear, setFear] = useState("");
  const [written, setWritten] = useState("");
  const [other, setOther] = useState("");
  const [liking, setLiking] = useState(0.5);
  const [trust, setTrust] = useState(0.5);
  const [memory, setMemory] = useState("");
  const [memAbout, setMemAbout] = useState("");
  const [memGood, setMemGood] = useState(false);
  const [thought, setThought] = useState("");
  const [thoughtAbout, setThoughtAbout] = useState("");

  useEffect(() => {
    let live = true;
    api.editable(id).then(
      (v) => {
        if (!live) return;
        setEd(v);
        setTraits(v.traits);
        setLock(Object.fromEntries(v.locks.map((l) => [l.trait, true])));
        const first = v.others[0];
        if (first) {
          setOther(first.id);
          setLiking(first.liking);
          setTrust(first.trust);
        }
      },
      (e) => live && setError(String(e instanceof Error ? e.message : e)),
    );
    return () => {
      live = false;
    };
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!ed) return <p className="empty">Reading {names[id] ?? id}...</p>;
  const name = ed.name;
  const whom = town ? "everyone in town" : name;

  const send = async (body: { edit?: MindEdit & { written?: boolean }; preset?: string }) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.edit({ who: town ? "*" : id, notice, ...body });
      if (r.editable) setEd({ ...ed, ...r.editable });
      else setEd(await api.editable(id));
      setDone(r.records.map((x) => x.label).join(". ") + ".");
      onEdited?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickOther = (o: string) => {
    setOther(o);
    const x = ed.others.find((y) => y.id === o);
    if (x) {
      setLiking(x.liking);
      setTrust(x.trust);
    }
  };

  return (
    <div className="editor">
      <p className="small">
        Change {name} and watch what follows. {name} won't know where it came from. Every change is kept, and when you ask Why about a later choice, the trail leads back to you.
      </p>
      <div className="ed-opts">
        <label><input type="checkbox" checked={town} onChange={(e) => setTown(e.target.checked)} /> Everyone in town</label>
        <label title="They feel a jolt, and remember that something shifted in them, without knowing what."><input type="checkbox" checked={notice} onChange={(e) => setNotice(e.target.checked)} /> They notice</label>
        <label title="Locked traits and core beliefs pass to children born after. (Children already take after their parents' traits.)"><input type="checkbox" checked={heritable} onChange={(e) => setHeritable(e.target.checked)} /> Children inherit</label>
      </div>
      {done && <p className="ed-done">{done} Keep watching: the Why view will say "because you…".</p>}

      <section className="pane">
        <h3>Make {town ? "them all" : name}</h3>
        <div className="ed-presets">
          {ed.presets.map((p) => (
            <button key={p.id} className="btn" disabled={busy} title={p.hint} onClick={() => send({ preset: p.id })}>{p.label}</button>
          ))}
        </div>
      </section>

      <section className="pane">
        <h3>Personality</h3>
        {TRAITS.map(([t, label, hint]) => {
          const v = traits[t] ?? ed.traits[t];
          const changed = Math.abs(v - ed.traits[t]) > 0.005 || !!lock[t] !== ed.locks.some((l) => l.trait === t);
          return (
            <div key={t} className="ed-trait" title={hint}>
              <span className="ed-label">{label}</span>
              <input type="range" min={0} max={1} step={0.01} value={v} aria-label={`${label} (${t})`} onChange={(e) => setTraits({ ...traits, [t]: Number(e.target.value) })} />
              <span className="n">{v.toFixed(2)}</span>
              <label className="ed-lock" title="Hold it here: nightly drift can't move it."><input type="checkbox" checked={!!lock[t]} onChange={(e) => setLock({ ...lock, [t]: e.target.checked })} /> lock</label>
              <button className="btn" disabled={busy || !changed} onClick={() => send({ edit: lock[t] || Math.abs(v - ed.traits[t]) > 0.005 ? { kind: "trait", trait: t, value: v, lock: !!lock[t], heritable: !!lock[t] && heritable } : { kind: "unlock", trait: t } })}>Set</button>
            </div>
          );
        })}
      </section>

      <section className="pane">
        <h3>Core beliefs</h3>
        <ul className="ed-list">
          {ed.schemas.map((s) => (
            <li key={s.text}>
              <span>“{s.text}”</span>
              <span className="small">{s.strength.toFixed(2)}{s.edited ? " · yours" : ""}{s.heritable ? " · passed on" : ""}</span>
              <button className="btn" disabled={busy} onClick={() => send({ edit: { kind: "unfear", text: s.text } })}>Take away</button>
            </li>
          ))}
          {!ed.schemas.length && <li className="small">None yet. Core beliefs form from hard, frightening moments, or you can give one.</li>}
        </ul>
        <div className="ed-row">
          <select value={fear} onChange={(e) => setFear(e.target.value)} aria-label="Pick a core belief">
            <option value="">Give a core belief…</option>
            {ed.fears.map((f) => <option key={f.text} value={f.text} title={f.hint}>{f.text}</option>)}
          </select>
          <button
            className="btn"
            disabled={busy || !fear}
            onClick={() => {
              const f = ed.fears.find((x) => x.text === fear)!;
              void send({ edit: { kind: "fear", text: f.text, triggers: f.triggers, threat: f.threat, blame: f.blame, strength: 0.6, heritable } });
            }}
          >Give</button>
        </div>
        {fear && <p className="small">{ed.fears.find((x) => x.text === fear)?.hint}</p>}
        <div className="ed-row">
          <input value={written} onChange={(e) => setWritten(e.target.value)} placeholder="Or write one: “Nobody here would share their last loaf”" maxLength={120} aria-label="Write a core belief" />
          <button className="btn" disabled={busy || !written.trim()} onClick={() => void send({ edit: { kind: "fear", text: written, triggers: [], threat: 0, blame: 0, strength: 0.6, heritable, written: true } }).then(() => setWritten(""))}>Give</button>
        </div>
      </section>

      {!town && (
        <section className="pane">
          <h3>How {name} feels about someone</h3>
          <div className="ed-row">
            <select value={other} onChange={(e) => pickOther(e.target.value)} aria-label="Who">
              {ed.others.map((o) => <option key={o.id} value={o.id}>{o.name}{o.edited ? " (changed)" : ""}</option>)}
            </select>
          </div>
          <div className="ed-trait"><span className="ed-label">Likes</span><input type="range" min={0} max={1} step={0.01} value={liking} onChange={(e) => setLiking(Number(e.target.value))} aria-label="Liking" /><span className="n">{liking.toFixed(2)}</span></div>
          <div className="ed-trait"><span className="ed-label">Trusts</span><input type="range" min={0} max={1} step={0.01} value={trust} onChange={(e) => setTrust(Number(e.target.value))} aria-label="Trust" /><span className="n">{trust.toFixed(2)}</span></div>
          <button className="btn" disabled={busy || !other} onClick={() => send({ edit: { kind: "regard", other, liking, trust } })}>Set</button>
        </section>
      )}

      {!town && (
        <section className="pane">
          <h3>Memories</h3>
          <ul className="ed-list">
            {ed.memories.map((m) => (
              <li key={m.id}>
                <span className={m.valence < -0.2 ? "neg" : m.valence > 0.2 ? "pos" : ""}>{m.gist}</span>
                <span className="small">{m.implanted ? "never happened" : ""}</span>
                <button className="btn" disabled={busy} onClick={() => send({ edit: { kind: "erase", episode: m.id } })}>Forget</button>
              </li>
            ))}
          </ul>
          <div className="ed-row">
            <input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="A memory that never happened: “Rafe pushed me off the dock”" maxLength={140} aria-label="Implant a memory" />
          </div>
          <div className="ed-row">
            <select value={memAbout} onChange={(e) => setMemAbout(e.target.value)} aria-label="About whom">
              <option value="">About nobody in particular</option>
              {ed.others.map((o) => <option key={o.id} value={o.id}>About {o.name}</option>)}
            </select>
            <label><input type="checkbox" checked={memGood} onChange={(e) => setMemGood(e.target.checked)} /> a good memory</label>
            <button className="btn" disabled={busy || !memory.trim()} onClick={() => void send({ edit: { kind: "implant", gist: memory.trim(), about: memAbout ? [memAbout] : [], topics: memAbout ? [memAbout, ...topicsOf(memory)] : topicsOf(memory), valence: memGood ? 0.6 : -0.6 } }).then(() => setMemory(""))}>Implant</button>
          </div>
        </section>
      )}

      <section className="pane">
        <h3>Whisper a thought</h3>
        <p className="small">It will feel like {town ? "everyone's" : `${name}'s`} own idea.</p>
        <div className="ed-row">
          <input value={thought} onChange={(e) => setThought(e.target.value)} placeholder="“Theo has been keeping food back from the store”" maxLength={140} aria-label="A thought" />
        </div>
        <div className="ed-row">
          <select value={thoughtAbout} onChange={(e) => setThoughtAbout(e.target.value)} aria-label="About">
            <option value="">About the town</option>
            {ed.others.map((o) => <option key={o.id} value={o.id}>About {o.name}</option>)}
          </select>
          <button className="btn" disabled={busy || !thought.trim()} onClick={() => void send({ edit: { kind: "whisper", text: thought.trim(), about: thoughtAbout || "village", topics: topicsOf(thought), valence: tone(thought) } }).then(() => setThought(""))}>Whisper to {whom}</button>
        </div>
      </section>

      {ed.edits.length > 0 && (
        <section className="pane">
          <h3>What you've changed in {name}</h3>
          <ul className="ed-list">
            {ed.edits.map((r) => <li key={r.id}><span>{r.label}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Rough topics for a line someone typed, so it comes to mind at the right moments. */
function topicsOf(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  const add = (re: RegExp, ...ts: string[]) => re.test(t) && out.push(...ts);
  add(/food|store|bread|grain|barley|eat|hungr/, "food", "store");
  add(/winter|cold/, "winter");
  add(/sea|boat|storm|dock|fish|catch/, "sea", "boat");
  add(/trade|market|money|cheat/, "trade", "market");
  add(/help|share|give|kind/, "help", "fairness");
  add(/house|roof|build|stone|timber/, "build", "house");
  add(/love|family|child|home/, "family", "home");
  add(/lead|leader|law|vote/, "law", "leader");
  return [...new Set(out.length ? out : ["village"])];
}

/** Whether a whispered thought is good news or bad. */
function tone(text: string): number {
  const t = text.toLowerCase();
  if (/keep|cheat|lie|steal|hate|hoard|back from|never|can't be trusted|against/.test(t)) return -0.6;
  if (/kind|good|help|love|honest|fair|trust/.test(t)) return 0.5;
  return -0.2;
}
