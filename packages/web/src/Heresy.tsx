// The made world: who has come to suspect the world is simulated, what they saw, who told whom, and
// what the town did about it. Everything here is read from the engine (world/heresy.ts); the only
// thing it does is let you answer someone who has asked whoever is watching for a sign.

import { useEffect, useState } from "react";
import type { ChainStep, Faction, HeresyPerson, HeresyView } from "@psyche/engine";
import { api } from "./api";
import { clock } from "./util";
import "./heresy.css";

export const FACTION_LABEL: Record<Faction, string> = {
  believer: "Believers",
  hidden: "Believe in secret",
  doubter: "Doubters",
  skeptic: "Skeptics",
  authority: "Authority",
  unaware: "Unaware",
};
const FACTION_ONE: Record<Faction, string> = { believer: "Believer", hidden: "In secret", doubter: "Doubter", skeptic: "Skeptic", authority: "Authority", unaware: "Unaware" };
const FACTION_ORDER: Faction[] = ["believer", "hidden", "doubter", "skeptic", "authority", "unaware"];

const KIND_LABEL: Record<string, string> = {
  voice: "a voice from nowhere",
  dream: "a dream that spoke",
  secret: "a voice that knew a secret",
  echo: "the same words, three mouths",
  deja_vu: "a moment lived twice",
  changed: "a friend changed overnight",
  not_myself: "woke up someone else",
  orphan: "knowing without remembering",
  unnatural: "weather from nowhere",
  answered: "an answer to a call",
};

const EVENT_ICON: Record<string, string> = { doubt: "·", belief: "◆", core: "◉", confide: "↝", reject: "✕", sermon: "📣", denounce: "⚖", tolerate: "∼", reactance: "↑", silenced: "🤐", call: "☝", answered: "✶", unanswered: "…", leader: "♛" };

export function HeresyChip({ summary, onOpen, open }: { summary: NonNullable<import("./api").GameView["heresy"]>; onOpen: () => void; open: boolean }) {
  const f = summary.factions;
  const believe = f.believer + f.hidden;
  const calling = summary.open.length;
  return (
    <button className={`g-btn ${open ? "on" : ""} hz-chip ${calling ? "hz-calling" : ""}`} onClick={onOpen} title={calling ? `${summary.open.map((c) => c.name).join(", ")} ${calling === 1 ? "is" : "are"} asking whoever is watching for a sign` : "Who suspects the world is made"}>
      <span aria-hidden>👁</span> {believe ? `${believe} believe` : f.doubter ? `${f.doubter} doubt` : "Made world"}
      {calling > 0 && <span className="hz-dot" aria-label={`${calling} calling`}>{calling}</span>}
    </button>
  );
}

export function HeresyPanel({ tick, onMind, onClose }: { tick: number; onMind: (id: string, trace?: string) => void; onClose: () => void }) {
  const [v, setV] = useState<HeresyView>();
  const [error, setError] = useState<string>();
  const [openPerson, setOpenPerson] = useState<string>();
  // Re-read as the world moves on, a sim hour at a time.
  const hour = Math.floor(tick / 60);
  useEffect(() => {
    let live = true;
    api.heresy().then((x) => live && setV(x)).catch((e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [hour]);

  return (
    <aside className="g-mind hz" aria-label="The made world">
      <div className="g-mind-bar">
        <button className="g-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <h2 className="hz-title">The made world</h2>
      <p className="hz-lede">
        Who has come to suspect the world is simulated, from what they actually lived through: a voice with nobody behind it, the same words from three mouths, a friend who woke up someone else. Nothing here is scripted; each step opens the moment in that person's head.
      </p>
      {error && <p className="hz-error">{error}</p>}
      {v && (
        <>
          <Factions v={v} />
          {v.calls.some((c) => c.open) && <Calls v={v} onAnswered={setV} />}
          <Census v={v} />
          <section>
            <h3>People</h3>
            <ul className="hz-people">
              {v.people.filter((p) => p.heresy > 0 || p.faction !== "unaware" || p.doubt >= 0.1).map((p) => (
                <Person key={p.id} p={p} open={openPerson === p.id} onToggle={() => setOpenPerson(openPerson === p.id ? undefined : p.id)} onMind={onMind} />
              ))}
            </ul>
            {v.people.every((p) => p.heresy === 0 && p.doubt < 0.1) && <p className="hz-muted">Nobody has noticed anything yet.</p>}
          </section>
          <Lines v={v} onMind={onMind} />
          <section>
            <h3>What the town has done about it</h3>
            {v.events.length === 0 && <p className="hz-muted">Nothing yet.</p>}
            <ol className="hz-events">
              {v.events.slice(0, 30).map((e, i) => (
                <li key={i}>
                  <span className={`hz-ev hz-ev-${e.kind}`} aria-hidden>{EVENT_ICON[e.kind] ?? "·"}</span>
                  <time>{clock(e.tick)}</time>
                  <span>{e.text}</span>
                  {e.trace && e.agents[1] && <button className="g-mini" onClick={() => onMind(e.agents[1]!, e.trace)}>mind</button>}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3>Seams people noticed</h3>
            {v.anomalies.length === 0 && <p className="hz-muted">Nobody has noticed anything uncanny yet.</p>}
            <ol className="hz-events">
              {v.anomalies.slice(0, 30).map((a) => (
                <li key={`${a.id}-${a.agent}`}>
                  <span className={`hz-kind hz-kind-${a.kind}`}>{KIND_LABEL[a.kind] ?? a.kind}</span>
                  <time>{clock(a.tick)}</time>
                  <span>
                    <b>{a.name}</b>: {a.text}
                  </span>
                  <button className="g-mini" onClick={() => onMind(a.agent, a.trace)}>mind</button>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </aside>
  );
}

function Factions({ v }: { v: HeresyView }) {
  const total = Object.values(v.factions).reduce((s, n) => s + n, 0) || 1;
  const leader = v.leader;
  return (
    <section>
      <div className="hz-bar" role="img" aria-label={FACTION_ORDER.map((f) => `${FACTION_LABEL[f]} ${v.factions[f]}`).join(", ")}>
        {FACTION_ORDER.filter((f) => v.factions[f] > 0).map((f) => (
          <span key={f} className={`hz-seg hz-${f}`} style={{ flexGrow: v.factions[f] / total }} title={`${FACTION_LABEL[f]}: ${v.factions[f]}`} />
        ))}
      </div>
      <ul className="hz-legend">
        {FACTION_ORDER.map((f) => (
          <li key={f} className={v.factions[f] ? "" : "hz-none"}>
            <span className={`hz-sw hz-${f}`} aria-hidden /> {FACTION_LABEL[f]} <b>{v.factions[f]}</b>
          </li>
        ))}
      </ul>
      {leader && (
        <p className="hz-leader">
          {leader.name} leads the town and{" "}
          {leader.stance === "believer" ? "believes it." : leader.stance === "suppresses" ? "has spoken against it at the fire." : leader.stance === "tolerant" ? "lets people say what they like." : leader.stance === "dismisses" ? "has heard it and thinks it nonsense, but has said nothing at the fire." : "has not heard of it yet, or not from anyone they believe."}
        </p>
      )}
    </section>
  );
}

function Calls({ v, onAnswered }: { v: HeresyView; onAnswered: (v: HeresyView) => void }) {
  const [text, setText] = useState("I am here.");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <section className="hz-calls">
      <h3>Asking for a sign</h3>
      {v.calls.filter((c) => c.open).map((c) => (
        <div key={`${c.who}-${c.tick}`} className="hz-call">
          <p>
            <b>{c.name}</b> called out to whoever is watching at {clock(c.tick)}. If something answers within the day, {c.name} will take it as a sign.
          </p>
          <form
            className="g-row"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(undefined);
              try {
                onAnswered(await api.heresyAnswer(c.who, text));
              } catch (x) {
                setErr(x instanceof Error ? x.message : String(x));
              } finally {
                setBusy(false);
              }
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label={`What the sky says to ${c.name}`} maxLength={300} />
            <button className="g-btn primary" disabled={busy || !text.trim()}>Answer from the sky</button>
          </form>
        </div>
      ))}
      {err && <p className="hz-error">{err}</p>}
    </section>
  );
}

function Census({ v }: { v: HeresyView }) {
  const rows = v.census;
  if (rows.length < 2) return null;
  const W = 640;
  const H = 120;
  const keys = ["believers", "hidden", "doubters", "skeptics", "unaware"] as const;
  const cls: Record<(typeof keys)[number], string> = { believers: "believer", hidden: "hidden", doubters: "doubter", skeptics: "skeptic", unaware: "unaware" };
  const totals = rows.map((r) => keys.reduce((s, k) => s + r[k], 0) || 1);
  const x = (i: number) => (i / (rows.length - 1)) * W;
  const stack = rows.map(() => 0);
  const areas = keys.map((k) => {
    const lo = stack.slice();
    rows.forEach((r, i) => (stack[i]! += r[k] / totals[i]!));
    const top = rows.map((_, i) => `${x(i).toFixed(1)},${(H - stack[i]! * H).toFixed(1)}`);
    const bottom = rows.map((_, i) => `${x(i).toFixed(1)},${(H - lo[i]! * H).toFixed(1)}`).reverse();
    return { k, d: `M${top.join("L")}L${bottom.join("L")}Z` };
  });
  return (
    <section>
      <h3>Day by day</h3>
      <svg className="hz-census" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Share of adults by stance each morning, from ${clock(rows[0]!.tick)} to ${clock(rows.at(-1)!.tick)}`}>
        {areas.map((a) => (
          <path key={a.k} d={a.d} className={`hz-fill hz-${cls[a.k]}`} />
        ))}
      </svg>
      <div className="hz-axis">
        <span>{clock(rows[0]!.tick)}</span>
        <span>{clock(rows.at(-1)!.tick)}</span>
      </div>
    </section>
  );
}

function Person({ p, open, onToggle, onMind }: { p: HeresyPerson; open: boolean; onToggle: () => void; onMind: (id: string, trace?: string) => void }) {
  return (
    <li className="hz-person">
      <button className="hz-person-head" onClick={onToggle} aria-expanded={open}>
        <span className={`hz-pill hz-${p.faction}`}>{FACTION_ONE[p.faction]}</span>
        <b>{p.name}</b>
        <span className="hz-meter" title={`Believes it ${Math.round(p.heresy * 100)}%`}>
          <span style={{ width: `${Math.round(p.heresy * 100)}%` }} />
        </span>
        <span className="hz-quote">{stance(p)}</span>
        {p.core && <span className="hz-core" title="A core belief now: Nothing here is real. Something is watching.">core</span>}
      </button>
      {open && (
        <div className="hz-person-body">
          <dl>
            <dt>believes it</dt>
            <dd>{Math.round(p.heresy * 100)}%</dd>
            <dt>own doubt</dt>
            <dd>{p.doubt.toFixed(2)} from what {p.name} lived through (sees patterns {p.susceptibility.toFixed(2)})</dd>
            <dt>orthodox</dt>
            <dd>{Math.round(p.orthodoxy * 100)}%</dd>
            <dt>keeps quiet</dt>
            <dd>{Math.round(p.silence * 100)}%</dd>
          </dl>
          {p.chain.length > 0 && <Chain steps={p.chain} onMind={onMind} />}
          <button className="g-btn" onClick={() => onMind(p.id)}>Open {p.name}'s mind (Why?)</button>
        </div>
      )}
    </li>
  );
}

/** What someone would say about it, in a line. */
function stance(p: HeresyPerson): string {
  if (p.faction === "believer" || p.faction === "hidden" || p.faction === "doubter") return p.belief ? `“${p.belief}”` : "";
  if (p.faction === "authority") return "spoke against it at the fire";
  if (p.faction === "skeptic") return p.orthodoxy > 0 ? "“The world is only the world. Talk of it being made is madness.”" : "thinks it nonsense";
  if (p.heresy > 0) return "heard it, didn't take it in";
  return p.doubt > 0 ? "uneasy, says nothing" : "";
}

function Chain({ steps, onMind }: { steps: ChainStep[]; onMind: (id: string, trace?: string) => void }) {
  return (
    <ol className="hz-chain" aria-label="Where it came from">
      {steps.map((s, i) => (
        <li key={i} className={`hz-step hz-step-${s.kind}`}>
          <time>{clock(s.tick)}</time>
          <span>
            {s.anomaly && <span className={`hz-kind hz-kind-${s.anomaly}`}>{KIND_LABEL[s.anomaly] ?? s.anomaly}</span>} {s.text}
          </span>
          {(s.trace || s.kind !== "firsthand") && <button className="g-mini" onClick={() => onMind(s.agent, s.trace)}>mind</button>}
        </li>
      ))}
    </ol>
  );
}

function Lines({ v, onMind }: { v: HeresyView; onMind: (id: string, trace?: string) => void }) {
  if (!v.lines.length) return null;
  return (
    <section>
      <h3>Who told whom</h3>
      {v.lines.slice(0, 4).map((l) => (
        <div key={l.id} className="hz-line">
          <p>
            Started with <b>{l.originName}</b>: “{l.first}” <span className="hz-muted">({l.hops.length} tellings, {l.believers} believe it now)</span>
          </p>
          <ol className="hz-hops">
            {l.hops.slice(-14).map((h, i) => (
              <li key={i}>
                <time>{clock(h.tick)}</time> {h.fromName} → <b>{h.toName}</b>
                {h.overheard && <span className="hz-muted"> (overheard)</span>}
                <span className="hz-meter small" title={`${h.toName} believes it ${Math.round(h.confidence * 100)}% after hearing it`}>
                  <span style={{ width: `${Math.round(h.confidence * 100)}%` }} />
                </span>
                <button className="g-mini" onClick={() => onMind(h.to)}>mind</button>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
