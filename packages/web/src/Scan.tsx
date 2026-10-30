import { useState } from "react";
import { fidelity, render, renderOriginal, type Episode, type MindState, type Trace, type WorkspaceEntry } from "@psyche/engine";
import { clock, num, pct } from "./util";

type Tab = "story" | "mind" | "raw";

export function Scan({ trace, state, trail }: { trace: Trace; state: MindState; trail: { v: number; a: number }[] }) {
  const [tab, setTab] = useState<Tab>("story");
  return (
    <div>
      <div className="scan-head">
        <span className="clock">{clock(trace.tick)} · {state.name}{trace.decision ? ` · System ${trace.decision.system}` : ""}</span>
        <div className="tabs" role="tablist">
          {(["story", "mind", "raw"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {tab === "story" && (trace.kind === "sleep" ? <SleepStory trace={trace} state={state} /> : <Story trace={trace} state={state} trail={trail} />)}
      {tab === "mind" && <Mind trace={trace} state={state} />}
      {tab === "raw" && <Raw trace={trace} state={state} />}
    </div>
  );
}

function Story({ trace, state, trail }: { trace: Trace; state: MindState; trail: { v: number; a: number }[] }) {
  const p = trace.percept!;
  const fresh = Object.entries(trace.appraisal?.emotions ?? {}).filter(([, v]) => (v ?? 0) > 0.05);
  const lingering = Object.entries(state.affect.emotions).filter(([, v]) => v > 0.15);
  const emotions = (fresh.length ? fresh : lingering).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const topMemory = trace.workspace.find((w) => w.kind === "memory");
  const topBelief = trace.workspace.find((w) => w.kind === "belief");
  const rewritten = trace.reconsolidations.find((r) => r.version.changes.length > 0);
  const focusEp = state.episodes.find((e) => e.id === (rewritten?.episodeId ?? topMemory?.ref));

  return (
    <>
      <h1 className="question">{trace.headline.question}</h1>
      <p className="answer">{trace.headline.answer}</p>
      <p className="heard">{p.rawText}</p>
      {trace.action?.text && <p className="reply">{trace.action.kind === "speech" ? `“${trace.action.text}”` : trace.action.text}</p>}

      <div className="strip">
        <div className="node"><span className="lab">Saw</span>{p.gist}</div>
        <div className="node feel">
          <span className="lab">Felt</span>
          {emotions.length ? emotions.slice(0, 2).map(([k, v]) => `${k} ${(v ?? 0).toFixed(2)}`).join(", ") : "Nothing much"}
          {!fresh.length && emotions.length ? " (still there from earlier)" : ""}
          {state.affect.mood.valence < -0.15 ? `. Mood low (${state.affect.mood.valence.toFixed(2)})` : ""}
          {trace.appraisal && trace.appraisal.blame > 0.3 ? `. Blame ${trace.appraisal.blame.toFixed(2)}` : ""}
        </div>
        <div className="node mem">
          <span className="lab">Remembered</span>
          {(focusEp ?? topMemory) ? (focusEp?.gist ?? topMemory!.label) : "Nothing came to mind"}
          {rewritten ? " (rewritten just now)" : ""}
        </div>
        <div className="node bel"><span className="lab">Believed</span>{topBelief ? topBelief.label : "No belief in play"}</div>
        <div className="node act"><span className="lab">Did</span>{trace.decision?.options.find((o) => o.id === trace.decision!.choice)?.label ?? "Let it pass"}</div>
      </div>

      <div className="grid2">
        <div className="stack">
          <Waterline winners={trace.workspace} below={trace.subliminal} because={trace.decision?.because ?? []} possessive={state.pronouns.possessive} />
          {trace.biases.length > 0 && (
            <div className="pane">
              <h3>Patterns</h3>
              <div className="patterns">
                {trace.biases.map((b) => (
                  <div className="pattern" key={b.name}>
                    <b>{b.name}</b> <span className="mono">{b.confidence.toFixed(2)}</span>
                    <div>{b.explanation}</div>
                  </div>
                ))}
              </div>
              <p className="small">Patterns are named after the fact from the trace. They describe the mechanisms; they do not drive them.</p>
            </div>
          )}
        </div>
        <div className="stack">
          {focusEp ? <MemoryPane ep={focusEp} justNow={rewritten?.episodeId === focusEp.id ? rewritten.before : undefined} /> : null}
          <Feeling state={state} trail={trail} actor={p.actor} />
        </div>
      </div>
    </>
  );
}

function Waterline({ winners, below, because, possessive }: { winners: WorkspaceEntry[]; below: WorkspaceEntry[]; because: { ref: string; weight: number }[]; possessive: string }) {
  const weight = (ref: string) => because.find((b) => b.ref === ref)?.weight;
  return (
    <div className="pane">
      <h3>What was on {possessive} mind</h3>
      <div className="slots">
        {winners.map((w) => (
          <div key={w.ref} className={`slot ${w.kind}`}>
            <span><span className="k">{w.kind}</span>{w.label}</span>
            <span className="w" title="Share of the decision this item drove">{weight(w.ref) !== undefined ? pct(weight(w.ref)!) : ""}</span>
          </div>
        ))}
      </div>
      {below.length > 0 && (
        <>
          <div className="waterline">below awareness: competed and lost</div>
          <div className="slots">
            {below.map((w) => (
              <div key={w.ref} className="slot sub"><span><span className="k">{w.kind}</span>{w.label}</span></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MemoryPane({ ep, justNow }: { ep: Episode; justNow?: string }) {
  const changed = ep.details.some((d) => d.value !== d.original);
  const parts = ep.template
    ? ep.template.split(/(\{\w+\})/).map((seg, i) => {
        const m = /^\{(\w+)\}$/.exec(seg);
        const slot = m && ep.details.find((d) => d.key === m[1]);
        if (!slot) return <span key={i}>{seg}</span>;
        if (slot.value === slot.original) return <span key={i}>{slot.value}</span>;
        return (
          <span key={i}>
            <del>{slot.original}</del> <ins>{slot.value}</ins>
          </span>
        );
      })
    : [<span key="g">{render(ep)}</span>];
  return (
    <div className="pane">
      <h3>{changed ? "How the memory changed" : "How it is remembered"}</h3>
      <div className="diff">{parts}</div>
      <p className="small">
        {changed ? "Struck through: what actually happened. Highlighted: what is remembered now. " : ""}Fidelity {pct(fidelity(ep))}, feeling {num(ep.valenceAtEncoding)} → {num(ep.valence)}, rewritten{" "}
        {ep.versions.filter((v) => v.changes.length).length} times{justNow !== undefined ? ", most recently just now" : ""}.
      </p>
      {changed && (
        <ul className="small">
          {ep.details.filter((d) => d.value !== d.original).map((d) => (
            <li key={d.key}>
              <b>{d.key}</b>: {d.source.kind === "told" ? `came from something ${d.source.from} said, now felt as a first-hand memory` : "filled in from mood and beliefs after the detail faded"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Feeling({ state, trail, actor }: { state: MindState; trail: { v: number; a: number }[]; actor: string }) {
  const af = state.affect;
  const x = (v: number) => 110 + v * 88;
  const y = (a: number) => 198 - a * 176;
  const other = state.others[actor];
  const top = Object.entries(af.emotions).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <div className="pane">
      <h3>Feeling</h3>
      <svg viewBox="0 0 220 220" style={{ width: "100%", maxWidth: 220, display: "block", margin: "0 auto" }} role="img" aria-label="Mood on a pleasant to unpleasant and calm to aroused plane, with its recent trail">
        <circle cx="110" cy="110" r="88" fill="none" stroke="var(--line)" />
        <line x1="22" y1="110" x2="198" y2="110" stroke="var(--line)" />
        <line x1="110" y1="22" x2="110" y2="198" stroke="var(--line)" />
        <text x="110" y="14" textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">aroused</text>
        <text x="110" y="214" textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">calm</text>
        <text x="4" y="104" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">unpleasant</text>
        <text x="216" y="104" textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">pleasant</text>
        {trail.length > 1 && <polyline points={trail.map((p) => `${x(p.v)},${y(p.a)}`).join(" ")} fill="none" stroke="var(--feel)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />}
        <circle cx={x(af.mood.valence)} cy={y(af.mood.arousal)} r="4" fill="var(--muted)" />
        <circle cx={x(af.valence)} cy={y(af.arousal)} r="7" fill="var(--feel)" />
      </svg>
      <p className="small" style={{ textAlign: "center" }}>Large dot: right now. Small dot: mood. Dashes: mood over the session.</p>
      <div className="bars">
        {top.map(([k, v]) => <Bar key={k} label={k} value={v} color="var(--feel)" />)}
        <Bar label="stress" value={af.stress} color="var(--feel)" />
        <Bar label="fatigue" value={af.fatigue} color="var(--muted)" />
        {other && <Bar label={`trust: ${other.name}`} value={other.trust.benevolence} color="var(--accent)" />}
        {other && <Bar label={`liking: ${other.name}`} value={other.liking} color="var(--accent)" />}
      </div>
    </div>
  );
}

function Bar({ label, value, color, signed }: { label: string; value: number; color: string; signed?: boolean }) {
  const style = signed
    ? { left: value >= 0 ? "50%" : `${50 + value * 50}%`, width: `${Math.abs(value) * 50}%`, background: color }
    : { left: 0, width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color };
  return (
    <div className="bar">
      <span>{label}</span>
      <span className="t"><i style={style} /></span>
      <span className="v">{value.toFixed(2)}</span>
    </div>
  );
}

function SleepStory({ trace, state }: { trace: Trace; state: MindState }) {
  return (
    <>
      <h1 className="question">{trace.headline.question}</h1>
      <div className="pane">
        <h3>Overnight</h3>
        <ul>{trace.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        <p className="small">Life story now: “{state.self.lifeStory}”</p>
      </div>
    </>
  );
}

function Mind({ trace, state }: { trace: Trace; state: MindState }) {
  const a = trace.appraisal;
  const d = trace.decision;
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {a && (
        <div className="pane">
          <h3>Appraisal</h3>
          <div className="bars">
            <Bar label="relevance" value={a.relevance} color="var(--accent)" />
            <Bar label="desirability" value={a.desirability} color="var(--feel)" signed />
            <Bar label="blame" value={a.blame} color="var(--feel)" />
            <Bar label="coping" value={a.coping} color="var(--accent)" />
            <Bar label="threat" value={a.threat} color="var(--feel)" />
          </div>
          {a.adjustments.length > 0 && <ul className="small">{a.adjustments.map((x, i) => <li key={i}>{x.name}: {num(x.value)}</li>)}</ul>}
        </div>
      )}
      <div className="pane tbl">
        <h3>Recall: what the cues activated</h3>
        <table>
          <thead><tr><th>Memory or belief</th><th>Base</th><th>Cues</th><th>Mood</th><th>Emotion</th><th>Noise</th><th>Total</th></tr></thead>
          <tbody>
            {trace.retrieval.slice(0, 12).map((r) => (
              <tr key={r.id} style={{ opacity: r.retrieved ? 1 : 0.5 }}>
                <td>{r.label}</td>
                <td className="n">{num(r.components.base)}</td>
                <td className="n">{num(r.components.spread)}</td>
                <td className="n">{num(r.components.mood)}</td>
                <td className="n">{num(r.components.arousal)}</td>
                <td className="n">{num(r.components.noise)}</td>
                <td className="n"><b>{num(r.activation)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">Base: how recently and often it was used (ACT-R). Cues: spreading activation from what was seen or heard. Faded rows fell below the retrieval threshold.</p>
      </div>
      {d && (
        <div className="pane tbl">
          <h3>Options and what pushed each one</h3>
          <table>
            <thead><tr><th>Option</th><th>Score</th><th>Contributions</th></tr></thead>
            <tbody>
              {d.options.map((o) => (
                <tr key={o.id} className={o.id === d.choice ? "chosen" : ""}>
                  <td>{o.label}</td>
                  <td className="n">{num(o.utility)}</td>
                  <td className="small">{o.terms.filter((t) => Math.abs(t.value) >= 0.01).sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).map((t) => `${t.name} ${num(t.value)}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">
            System 2 engaged with probability {d.s2.probability.toFixed(2)} (conflict {d.s2.conflict.toFixed(2)}, novelty {d.s2.novelty.toFixed(2)}, stakes {d.s2.stakes.toFixed(2)}, capacity {d.s2.capacity.toFixed(2)}).
            {d.system === 2 && d.monologue ? ` Inner monologue: “${d.monologue}”` : ""}
          </p>
        </div>
      )}
      {(trace.notes.length > 0 || trace.llmCalls.length > 0) && (
        <div className="pane">
          <h3>Other changes</h3>
          <ul className="small">{trace.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <p className="small">Language model calls this moment: {trace.llmCalls.join(", ") || "none"}.</p>
        </div>
      )}
      <MemoryBench state={state} />
    </div>
  );
}

function MemoryBench({ state }: { state: MindState }) {
  const [sel, setSel] = useState<string | undefined>();
  const eps = [...state.episodes].sort((a, b) => b.tick - a.tick);
  const ep = eps.find((e) => e.id === sel);
  return (
    <div className="grid2">
      <div className="pane">
        <h3>All memories</h3>
        <div className="memlist">
          {eps.map((e) => (
            <button key={e.id} className={`memrow ${sel === e.id ? "on" : ""}`} onClick={() => setSel(e.id)}>
              <span>{e.gist}</span>
              <span className="fid" title={`Fidelity ${pct(fidelity(e))}`}><i style={{ width: pct(fidelity(e)) }} /></span>
            </button>
          ))}
        </div>
      </div>
      {ep ? <MemoryPane ep={ep} /> : <div className="pane small">Pick a memory to compare what happened with what she remembers.</div>}
    </div>
  );
}

function Raw({ trace, state }: { trace: Trace; state: MindState }) {
  const [what, setWhat] = useState<"trace" | "state">("trace");
  return (
    <div style={{ marginTop: 16 }}>
      <div className="tabs" style={{ marginBottom: 8 }}>
        <button className={what === "trace" ? "on" : ""} onClick={() => setWhat("trace")}>Trace</button>
        <button className={what === "state" ? "on" : ""} onClick={() => setWhat("state")}>Mind state</button>
      </div>
      <pre>{JSON.stringify(what === "trace" ? trace : state, null, 2)}</pre>
    </div>
  );
}
