// The worlds menu: save the world you are watching (with a picture of it), load or delete a save,
// wind back to one of the hourly copies, start a new world from a code, and share: a world file
// someone else can open in their own Psyche, or the code that grows the same land and founders.

import { useEffect, useRef, useState } from "react";
import { parseWorldCode, worldCode } from "@psyche/engine";
import { api, type GameView, type Slot, type SnapshotFile } from "../api";
import { thumbnail } from "./capture";

const size = (b?: number) => (b === undefined ? "" : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString();
};

export function Worlds({ view, busy, act, onClose }: { view: GameView; busy: boolean; act: (f: () => Promise<unknown>) => Promise<void>; onClose: () => void }) {
  const [slots, setSlots] = useState<Slot[]>();
  const [copies, setCopies] = useState<SnapshotFile[]>();
  const [name, setName] = useState("");
  const [code, setCode] = useState(() => worldCode(view.scenario, view.seed + 1));
  const [note, setNote] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.slots().then((r) => setSlots(r.slots), () => setSlots([]));
  }, []);
  const people = view.towns ? view.towns.reduce((n, t) => n + t.people, 0) : view.card?.people;
  const here = worldCode(view.scenario, view.seed);
  const parsed = parseWorldCode(code);
  const say = (text: string) => {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? undefined : n)), 5000);
  };
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => say(`Copied ${text}.`), () => say(`The code is ${text}.`)) ?? say(`The code is ${text}.`);

  return (
    <div className="g-menu g-worlds" role="dialog" aria-label="Worlds and saves">
      <div className="g-menu-head">
        <b>Worlds</b>
        <button className="g-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="g-small">
        Now: {view.name}, year {view.year ?? view.card?.year ?? "?"}, {people} people{view.towns && view.towns.length > 1 ? ` in ${view.towns.length} towns` : ""}. It saves itself every minute and keeps an hourly copy.
      </p>
      {note && <p className="g-note" role="status">{note}</p>}

      <form
        className="g-row"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (n) void act(async () => setSlots((await api.saveSlot(n, thumbnail())).slots)).then(() => (setName(""), say(`Saved "${n}".`)));
        }}
      >
        <input type="text" placeholder="Name this world to save it" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Save name" />
        <button className="g-btn primary" disabled={busy || !name.trim()}>Save</button>
      </form>

      <ul className="g-slots">
        {slots?.map((s) => (
          <li key={s.name}>
            <Thumb src={s.thumb} />
            <div>
              <b>{s.name}</b>
              <span className="g-small">
                {s.year !== undefined ? `Year ${s.year}` : s.scenario}
                {s.people !== undefined ? ` · ${s.people} people` : ""}
                {s.towns && s.towns > 1 ? ` · ${s.towns} towns` : ""}
              </span>
              <span className="g-small">saved {ago(s.savedAt)}{s.size ? ` · ${size(s.size)}` : ""}</span>
              <span className="g-slot-acts">
                <button className="g-btn" disabled={busy} onClick={() => confirm(`Load "${s.name}"? The world now running is replaced (save it first if you want to keep it).`) && void act(async () => { await api.loadSlot(s.name); onClose(); })}>Load</button>
                <a className="g-btn" href={api.exportUrl(s.name)} download title="Download this save as a world file you can send to someone">Share</a>
                <button className="g-btn" disabled={busy} onClick={() => confirm(`Delete the save "${s.name}"?`) && void act(async () => setSlots((await api.deleteSlot(s.name)).slots))} aria-label={`Delete ${s.name}`}>Delete</button>
              </span>
            </div>
          </li>
        ))}
        {slots && !slots.length && <li className="g-quiet">No saves yet. Save this world to branch it: load it later and play it out differently.</li>}
      </ul>

      <section className="g-share">
        <b>Share</b>
        <p className="g-small">
          A world file holds this whole world as it stands: every mind and memory, the chronicle, what you changed. Anyone running Psyche can open it and carry on from here.
        </p>
        <div className="g-row">
          <a className="g-btn primary" href={api.exportUrl()} download>Download this world</a>
          <button className="g-btn" disabled={busy} onClick={() => file.current?.click()}>Open a world file…</button>
          <input
            ref={file}
            type="file"
            accept=".psyche,.json,.gz,application/gzip,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void act(async () => { const r = await api.importWorld(f); setSlots(r.slots); say(`Added "${r.name}" to your saves. Load it when you are ready.`); });
            }}
          />
        </div>
        <p className="g-small">
          Or share the code. It grows the same land and the same founders; what happens after is up to whoever plays it.{" "}
          <button className="g-code" onClick={() => copy(here)} title="Copy this world's code">{here}</button>
        </p>
      </section>

      <form
        className="g-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed && confirm(`Start a new world from ${worldCode(parsed.scenario, parsed.seed)}? The world now running is replaced (save it first if you want to keep it).`)) void act(async () => { await api.reset({ scenario: parsed.scenario, seed: parsed.seed }); onClose(); });
        }}
      >
        <label className="g-small" htmlFor="g-code">New world from a code</label>
        <input id="g-code" type="text" value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 130 }} spellCheck={false} aria-invalid={!parsed} />
        <button className="g-btn" disabled={busy || !parsed}>Start</button>
      </form>

      <details className="g-copies" onToggle={(e) => (e.target as HTMLDetailsElement).open && !copies && api.snapshots().then((r) => setCopies(r.snapshots), () => setCopies([]))}>
        <summary>Wind back to an hourly copy</summary>
        <ul className="g-slots">
          {copies?.map((c) => (
            <li key={c.file}>
              <div>
                <b>{new Date(c.savedAt).toLocaleString()}</b>
                <span className="g-small">{ago(c.savedAt)} · {size(c.size)}</span>
              </div>
              <button className="g-btn" disabled={busy} onClick={() => confirm("Wind the world back to this copy? The world now running is replaced (save it first if you want to keep it).") && void act(async () => { await api.loadSnapshot(c.file); onClose(); })}>Wind back</button>
            </li>
          ))}
          {copies && !copies.length && <li className="g-quiet">No copies yet. The first is made after the world has run for an hour.</li>}
        </ul>
      </details>

      <p className="g-small">
        <a href="#/lab">The lab</a> has every analysis view, other worlds (Kettle Island, a single village) and the mechanism switches. <a href="#/founders">Founders</a> is one mind building a house.
      </p>
    </div>
  );
}

/** A save's picture, or a plain panel if it has none or the picture won't draw. */
function Thumb({ src }: { src?: string }) {
  const [bad, setBad] = useState(false);
  return src && !bad ? <img src={src} alt="" onError={() => setBad(true)} /> : <span className="g-nothumb" aria-hidden="true" />;
}
