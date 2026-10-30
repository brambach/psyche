import { useEffect, useState } from "react";
import type { LedgerNode, WhyTree } from "@psyche/engine";
import { api, type WhyView } from "./api";
import { clock } from "./util";

const KIND: Record<string, string> = {
  event: "event",
  conversation: "talk",
  percept: "moment",
  episode: "memory",
  belief: "belief",
  schema: "core belief",
  emotion: "feeling",
  relation: "trust",
  goal: "goal",
  need: "need",
  decision: "choice",
  utterance: "said",
  act: "did",
  sleep: "sleep",
  outside: "outside",
};

/** Ticks arrive as numbers, or null for things that were always there (JSON has no -Infinity). */
function when(t: number | null): string {
  if (t === null || !Number.isFinite(t)) return "backstory";
  if (t < 0) return `${Math.max(1, Math.round(-t / 1440))} days before`;
  return clock(t);
}

export type LineageQuery = { node?: string; agent?: string; trace?: string };

/**
 * The analysis layer, first cut. Walks the causal ledger backwards from a choice, a fear or a belief
 * to where it started, across memories, conversations and other people's heads.
 */
export function Lineage({ query, focus, names, onOpen, onClose }: { query: LineageQuery; focus: string; names: Record<string, string>; onOpen: (agent: string, trace?: string) => void; onClose: () => void }) {
  const [view, setView] = useState<WhyView>();
  const [error, setError] = useState<string>();
  const key = JSON.stringify(query);

  useEffect(() => {
    let live = true;
    setView(undefined);
    setError(undefined);
    api.why(query).then((v) => live && setView(v), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const open = (n: LedgerNode) => (n.agent && n.trace ? () => onOpen(n.agent!, n.trace) : undefined);

  return (
    <section className="lineage pane" aria-label="Lineage">
      <header className="lineage-head">
        <h3>Why</h3>
        <button className="btn" onClick={onClose}>Close</button>
      </header>
      {error && <p className="empty">{error}</p>}
      {!view && !error && <p className="empty">Following the threads back...</p>}
      {view && (
        <>
          <h2 className="lineage-title">{view.tree.node.label}</h2>
          {view.chain.length > 1 && (
            <p className="chain">
              <span className="small">Strongest thread: </span>
              {view.chain.map((n, i) => (
                <span key={n.id}>
                  {i > 0 && <span className="arrow"> → </span>}
                  <span className={`kind k-${n.kind}`}>{KIND[n.kind]}</span> {n.label}
                </span>
              ))}
            </p>
          )}
          <p className="small">{summary(view, names)}</p>
          <ul className="why-tree" role="tree">
            <Branch t={view.tree} focus={focus} names={names} open={open} />
          </ul>
          {view.influence.decisions.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>What it has shaped since</h3>
              <ul className="shaped">
                {view.influence.decisions.map((d) => (
                  <li key={d.node.id}>
                    <button className="linkish" onClick={open(d.node)} disabled={!open(d.node)}>
                      {d.node.agent && d.node.agent !== focus && <b style={{ color: `var(--a-${d.node.agent})` }}>{names[d.node.agent]} · </b>}
                      {d.node.label} <span className="small">({when(d.node.tick)}, {d.steps} step{d.steps === 1 ? "" : "s"} away)</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="small note">Shares multiply along each thread: a rough measure of how much of the choice or feeling came from there. Click anything with a moment behind it to open that brain scan.</p>
        </>
      )}
    </section>
  );
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function summary(v: WhyView, names: Record<string, string>): string {
  const g = v.genealogy;
  const inf = v.influence;
  const parts = [`${g.ancestors} ${g.ancestors === 1 ? "cause" : "causes"} upstream`];
  if (g.minds.length) parts[0] += `, through ${list(g.minds.map((m) => names[m] ?? m))}'s ${g.minds.length === 1 ? "head" : "heads"} as well`;
  let out = `${parts[0]}.`;
  if (g.roots.length) out += ` It started with ${list(g.roots.slice(0, 3).map((r) => `“${r.label.replace(/\.$/, "")}”`))}${g.roots.length > 3 ? ` and ${g.roots.length - 3} more` : ""}.`;
  if (inf.total > 0) {
    const others = inf.minds.length ? `, including ${list(inf.minds.map((m) => names[m] ?? m))}'s` : "";
    out += inf.direct > 0 ? ` Since then it has been in mind for ${inf.direct} ${inf.direct === 1 ? "choice" : "choices"} and shaped ${inf.total}${others}.` : ` It has shaped ${inf.total} later ${inf.total === 1 ? "choice" : "choices"}${others}.`;
  }
  return out;
}

function Branch({ t, focus, names, open }: { t: WhyTree; focus: string; names: Record<string, string>; open: (n: LedgerNode) => (() => void) | undefined }) {
  const n = t.node;
  const click = open(n);
  const other = n.agent && n.agent !== focus;
  return (
    <li role="treeitem" aria-expanded={t.causes.length > 0}>
      {t.via && <span className="via">{t.via.mechanism}</span>}
      <div className={`why-node k-${n.kind}`} style={other ? { borderLeftColor: `var(--a-${n.agent})` } : undefined}>
        <span className="head">
          <span className={`kind k-${n.kind}`}>{KIND[n.kind]}</span>
          {other && <b className="whose" style={{ color: `var(--a-${n.agent})` }}>{names[n.agent!] ?? n.agent}</b>}
          {click ? <button className="linkish" onClick={click}>{n.label}</button> : <span>{n.label}</span>}
        </span>
        <span className="when">{when(n.tick)}{t.repeat ? " · shown above" : ""}</span>
        {t.via && <span className="share" title={`${Math.round(t.share * 100)}% along this thread`}><i style={{ width: `${Math.max(3, Math.round(t.share * 100))}%` }} /></span>}
        {t.missed && <span className="missed small">Didn't come to mind: {t.missed.map((m) => `“${m.label}”`).join(", ")}</span>}
      </div>
      {t.causes.length > 0 && (
        <ul role="group">
          {t.causes.map((c) => <Branch key={`${c.node.id}|${c.via?.mechanism}`} t={c} focus={focus} names={names} open={open} />)}
        </ul>
      )}
    </li>
  );
}
