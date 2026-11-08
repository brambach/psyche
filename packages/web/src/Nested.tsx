// Worlds inside the world: a town's engine, the small world running inside it, and the worlds inside
// that. You zoom between levels; each world fills the lens in 3D, and the panel beside it says who is
// in there, whom each was modelled on, what they have noticed, how they read it, and why, with every
// link of the why marked by the world it happened in (W0 is the real town).

import { useEffect, useState } from "react";
import type { LevelWhy, NestedPersonView, NestedWorldView, Scene3D, Sign } from "@psyche/engine";
import { api, type EngineChip } from "./api";
import { Town3D } from "./Town3D";
import "./nested.css";

const FLAVOR: Record<string, { label: string; short: string }> = {
  dread: { label: "Something beyond the sky turns the world, and does not care", short: "dread" },
  faith: { label: "Someone made the world, and watches over us", short: "faith" },
  rules: { label: "The world runs on rules, like beads on a frame", short: "rules" },
};
const STAGE: Record<string, string> = { tally: "keeping tallies", frame: "a bead frame that works things out", building: "an engine going up", running: "an engine, running a world", stilled: "an engine standing still" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Nested({ engines, onClose, onMind }: { engines: EngineChip[]; onClose: () => void; onMind: (id: string, town: string) => void }) {
  const first = engines.find((e) => e.depth > 0) ?? engines[0];
  const [town, setTown] = useState(first?.id ?? "");
  const chip = engines.find((e) => e.id === town) ?? first;
  const [depth, setDepth] = useState(() => Math.min(1, first?.depth ?? 0));
  const [dir, setDir] = useState<"in" | "out">("in");
  const [person, setPerson] = useState<string>();
  const [view, setView] = useState<NestedWorldView>();
  const [scene, setScene] = useState<Scene3D>();
  const [error, setError] = useState<string>();

  const zoom = (d: number, p?: string) => {
    if (!chip || d < 0 || d > chip.depth) return;
    setDir(d >= depth ? "in" : "out");
    setDepth(d);
    setPerson(p);
    setScene(undefined);
  };

  useEffect(() => {
    if (!town) return;
    let live = true;
    const get = () => {
      api.nestedWorld(town, depth).then((v) => live && (setView(v), setError(undefined)), (e: Error) => live && setError(e.message));
      api.nestedScene(town, depth).then((s) => live && setScene(s), () => undefined);
    };
    get();
    const t = setInterval(get, 2500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [town, depth]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") person ? setPerson(undefined) : onClose();
      else if (e.key === "+" || e.key === "=") zoom(depth + 1);
      else if (e.key === "-") zoom(depth - 1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  if (!chip) {
    return (
      <div className="nz" role="dialog" aria-label="Worlds inside">
        <div className="nz-empty">
          <p>Nobody has started counting yet. Somewhere, a curious, careful person who keeps the tide tables will start cutting a notch for every tide. Years later, that count can become an engine with a world inside it.</p>
          <button className="g-btn" onClick={onClose}>Back to the world</button>
        </div>
      </div>
    );
  }

  const crumbs = [{ depth: 0, name: chip.townName }, ...chip.worlds.map((w, i) => ({ depth: i + 1, name: w.name }))];
  const openWhy = (w: LevelWhy) => {
    if (!w.agent) return;
    if ((w.level ?? 0) === 0) onMind(w.agent, town);
    else zoom(w.level!, w.agent);
  };

  return (
    <div className="nz" role="dialog" aria-label="Worlds inside">
      <header className="nz-top">
        <b className="nz-title">Worlds inside</b>
        {engines.length > 1 && (
          <select className="g-select" aria-label="Town" value={town} onChange={(e) => { setTown(e.target.value); setDepth(0); setPerson(undefined); setScene(undefined); }}>
            {engines.map((e) => <option key={e.id} value={e.id}>{e.townName}{e.depth ? ` · ${e.depth} deep` : ` · ${e.stage}`}</option>)}
          </select>
        )}
        <nav className="nz-crumbs" aria-label="Levels">
          {crumbs.map((c, i) => (
            <span key={c.depth} className="nz-crumb-wrap">
              {i > 0 && <span className="nz-sep" aria-hidden="true">⊃</span>}
              <button className={`nz-crumb l${c.depth}${c.depth === depth ? " on" : ""}`} onClick={() => zoom(c.depth)} aria-current={c.depth === depth}>
                <i>W{c.depth}</i> {c.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="nz-zoom">
          <button className="g-btn" disabled={depth === 0} onClick={() => zoom(depth - 1)} title="Zoom out (-)">− Out</button>
          <button className="g-btn primary" disabled={depth >= chip.depth} onClick={() => zoom(depth + 1)} title="Zoom in (+)">In +</button>
          <button className="g-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>
      <div className="nz-body">
        <div className={`nz-lens l${depth} nz-${dir}`} key={`${town}:${depth}`}>
          {scene ? <Town3D game pushed scene={scene} director={false} onOpen={(id) => (depth === 0 ? onMind(id, town) : setPerson(id))} /> : <div className="nz-wait">{error ?? "Looking through the beads..."}</div>}
          {depth > 0 && <div className="nz-beads" aria-hidden="true" />}
          <div className="nz-lens-label">
            <i>W{depth}</i> {view?.name ?? crumbs[depth]?.name}
            {view && <span> · year {view.year} · {view.season} · {view.people.length} people</span>}
          </div>
        </div>
        <aside className="nz-panel" key={`${town}:${depth}:${person ?? ""}`}>
          {view && (person ? <Person town={town} depth={depth} id={person} onBack={() => setPerson(undefined)} onWhy={openWhy} onModel={(id) => (depth - 1 === 0 ? onMind(id, town) : zoom(depth - 1, id))} /> : <World view={view} chip={chip} onPerson={setPerson} onWhy={openWhy} onZoom={() => zoom(depth + 1)} />)}
        </aside>
      </div>
    </div>
  );
}

function World({ view, chip, onPerson, onWhy, onZoom }: { view: NestedWorldView; chip: EngineChip; onPerson: (id: string) => void; onWhy: (w: LevelWhy) => void; onZoom: () => void }) {
  const adults = view.people.filter((p) => p.age >= 16);
  const by = (f: string) => adults.filter((p) => p.suspicion?.flavor === f && p.suspicion.strength >= 0.25).length;
  const mirror = view.people.filter((p) => p.mirror && p.mirror.strength >= 0.25);
  const m = view.machine;
  const inner = chip.worlds[view.depth];
  return (
    <div className="nz-world">
      {view.made ? (
        <section>
          <h2>{view.name}</h2>
          <p className="nz-lede">
            A world inside the engine in {view.made.parent}. {view.made.makerName} made its people: each one modelled on someone {view.made.makerName} knew, each waking on the shore remembering somebody else's past.
          </p>
          <h3>Do they suspect?</h3>
          <Bar parts={[["dread", by("dread")], ["faith", by("faith")], ["rules", by("rules")], ["none", adults.length - by("dread") - by("faith") - by("rules")]]} />
          <ul className="nz-guesses">
            {view.made.comparison.map((c) => (
              <li key={c.flavor} className={`f-${c.flavor}`}>
                <b>{c.holders}</b> think their maker is <em>{c.guess}</em>
              </li>
            ))}
          </ul>
          <p className="nz-truth"><span>What made them:</span> {view.made.truth}</p>
        </section>
      ) : (
        <section>
          <h2>{view.name}</h2>
          <p className="nz-lede">The real town. {m ? `Here: ${STAGE[m.stage]}.` : ""} {mirror.length ? `${mirror.length} ${mirror.length === 1 ? "person here wonders" : "people here wonder"} whether this world was made too.` : ""}</p>
          {mirror.length > 0 && (
            <ul className="nz-people">
              {mirror.map((p) => (
                <li key={p.id}>
                  <button onClick={() => onPerson(p.id)}>
                    <b>{p.name}</b> <span>{p.keeper ? "keeper" : p.role}</span>
                    <small>“{p.mirror!.text}”</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {m && (
        <section className="nz-engine">
          <h3>The engine here</h3>
          <p>
            {m.makerName} started it. {cap(STAGE[m.stage]!)}
            {m.stage === "tally" ? ` (${pct(m.progress)} of the way to a frame)` : m.stage === "building" ? ` (${pct(m.progress)} built: ${m.have.timber}/${m.need.timber} timber, ${m.have.stone}/${m.need.stone} stone)` : ""}.
            {m.keepers.length ? ` Kept by ${m.keepers.map((k) => (k.from ? `${k.name} (taught by ${k.from})` : k.name)).join(", ")}.` : " Nobody knows how to tend it."}
            {m.stage === "running" && ` ${m.slipped} of ${m.tended} seasons have slipped.`}
          </p>
          {m.asks.length > 0 && <p className="nz-small">Asked for the engine: {m.asks.map((a) => `year ${a.year}, ${a.yes} yes, ${a.no} no${a.passed ? " (agreed)" : ""}`).join("; ")}.</p>}
          {inner && (
            <button className="g-btn primary nz-dive" onClick={onZoom}>
              Zoom into {inner.name} · {inner.people} people · {inner.believers}/{inner.adults} believe it was made
            </button>
          )}
        </section>
      )}

      {view.signs.length > 0 && (
        <section>
          <h3>What they noticed</h3>
          <ol className="nz-list">
            {view.signs.slice(0, 10).map((s) => <SignItem key={s.id} s={s} onWhy={onWhy} />)}
          </ol>
        </section>
      )}

      {view.made && (
        <section>
          <h3>Who is in there</h3>
          <ul className="nz-people">
            {[...view.people].sort((a, b) => (b.suspicion?.strength ?? 0) - (a.suspicion?.strength ?? 0) || a.generation - b.generation).map((p) => (
              <li key={p.id}>
                <button onClick={() => onPerson(p.id)}>
                  <b>{p.name}</b> <span>{p.age}{p.keeper ? " · keeper" : ""}</span>
                  {p.modelledOn && <small>made in the image of {p.modelledOn.name}</small>}
                  {!p.modelledOn && p.generation > 0 && <small>born here, generation {p.generation}</small>}
                  {p.suspicion && <Meter flavor={p.suspicion.flavor} value={p.suspicion.strength} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>{view.made ? `${view.name}'s history` : "How the engine came to be"}</h3>
        <ol className="nz-list">
          {view.history.filter((e) => e.kind !== "keeper" && e.kind !== "sign").slice(0, 14).map((e) => (
            <li key={e.id}>
              <details>
                <summary><time>Year {e.year}</time> {e.title}</summary>
                {e.text && <p>{e.text}</p>}
                <Why why={e.why} onWhy={onWhy} />
              </details>
            </li>
          ))}
          {!view.history.length && <li className="nz-small">Nothing yet.</li>}
        </ol>
      </section>
    </div>
  );
}

function SignItem({ s, onWhy }: { s: Sign; onWhy: (w: LevelWhy) => void }) {
  return (
    <li className={`nz-sign k-${s.kind}`}>
      <details>
        <summary>
          <time>Year {s.year}</time> {s.title}
          <span className="nz-count">{s.noticed.length} noticed · {s.wondered.length} wondered</span>
        </summary>
        <p>{s.text}</p>
        <Why why={s.why} onWhy={onWhy} />
      </details>
    </li>
  );
}

function Why({ why, onWhy }: { why: LevelWhy[]; onWhy: (w: LevelWhy) => void }) {
  if (!why.length) return null;
  return (
    <ol className="nz-why">
      {why.map((w, i) => (
        <li key={i}>
          <i className={`nz-lv l${w.level ?? 0}`} title={w.world}>W{w.level ?? 0}</i>
          {w.agent ? <button onClick={() => onWhy(w)} title={`Open ${w.world ? `in ${w.world}` : ""}`}>{w.text}</button> : <span>{w.text}</span>}
        </li>
      ))}
    </ol>
  );
}

function Person({ town, depth, id, onBack, onWhy, onModel }: { town: string; depth: number; id: string; onBack: () => void; onWhy: (w: LevelWhy) => void; onModel: (id: string) => void }) {
  const [p, setP] = useState<NestedPersonView>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    api.nestedPerson(town, depth, id).then((v) => live && setP(v), (e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [town, depth, id]);
  if (!p) return <div className="nz-person"><button className="g-btn" onClick={onBack}>← {error ?? "Back"}</button></div>;
  return (
    <div className="nz-person">
      <button className="g-btn" onClick={onBack}>← Everyone in {p.world}</button>
      <h2>{p.name} <span>{p.age}, {p.role}{p.generation ? `, generation ${p.generation}` : ""}</span></h2>
      <p className="nz-lede">{p.summary}</p>
      {p.modelledOn && (
        <p className="nz-origin">
          <i className={`nz-lv l${depth - 1}`}>W{depth - 1}</i> Made in the image of <button onClick={() => onModel(p.modelledOn!.outer)}>{p.modelledOn.name}</button>. Nobody inside knows it.
        </p>
      )}
      {p.past && (
        <p className="nz-origin">
          <i className={`nz-lv l${depth - 1}`}>W{depth - 1}</i> Remembers “{p.past.gist.replace(/\.$/, "")}”: it is <button onClick={() => onModel(p.past!.outer)}>{p.past.name}</button>'s memory, and it carries {p.past.name}'s core belief, “{p.past.belief}”.
        </p>
      )}
      {p.suspicion && (
        <div className={`nz-callout f-${p.suspicion.flavor}`}>
          <small>Suspects the world was made ({FLAVOR[p.suspicion.flavor]!.short})</small>
          <b>“{p.suspicion.text}”</b>
          <span>Imagines the maker as {p.suspicion.maker}.</span>
        </div>
      )}
      {p.mirror && (
        <div className="nz-callout f-mirror">
          <small>Looks up, after looking in</small>
          <b>“{p.mirror.text}”</b>
        </div>
      )}
      <h3>Core beliefs, and where each came from</h3>
      <ol className="nz-beliefs">
        {p.beliefs.map((b, i) => (
          <li key={i}>
            <div className="nz-belief-head">
              <b>{b.text}</b>
              <Meter value={b.strength} />
            </div>
            {b.chain.length > 0 && (
              <p className="nz-chain">
                {b.chain.map((c, j) => (
                  <span key={j}>
                    {j > 0 && " ← "}
                    {c.name}
                    {c.given ? " (a past the maker gave)" : c.firstHand ? " (lived it)" : ""}
                  </span>
                ))}
              </p>
            )}
            {b.chain.at(-1) && <p className="nz-small">“{b.chain.at(-1)!.gist.replace(/\.$/, "")}”</p>}
            {b.sign && (
              <details>
                <summary>Why it happened: {b.sign.title}</summary>
                <Why why={b.sign.why} onWhy={onWhy} />
              </details>
            )}
          </li>
        ))}
        {!p.beliefs.length && <li className="nz-small">No core beliefs yet.</li>}
      </ol>
      <h3>What they remember</h3>
      <ul className="nz-mem">
        {p.memories.map((e) => (
          <li key={e.id} className={e.topics.includes("sign") ? "sign" : ""}>
            {e.gist}
            {e.told && <small> (told by {e.told})</small>}
          </li>
        ))}
      </ul>
      <p className="nz-small">Traits: {Object.entries(p.traits).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}.</p>
    </div>
  );
}

function Bar({ parts }: { parts: [string, number][] }) {
  const total = parts.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <div className="nz-bar" role="img" aria-label={parts.map(([k, n]) => `${n} ${k}`).join(", ")}>
      {parts.filter(([, n]) => n > 0).map(([k, n]) => (
        <span key={k} className={`f-${k}`} style={{ flexGrow: n }} title={`${n} ${k === "none" ? "see nothing strange" : FLAVOR[k]!.label}`}>
          {n / total > 0.08 ? `${n} ${k === "none" ? "unbothered" : k}` : ""}
        </span>
      ))}
    </div>
  );
}

function Meter({ value, flavor }: { value: number; flavor?: string }) {
  return (
    <span className={`nz-meter${flavor ? ` f-${flavor}` : ""}`} title={`${flavor ? `${flavor}: ` : ""}${value.toFixed(2)}`}>
      <span style={{ width: pct(Math.min(1, value)) }} />
    </span>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
