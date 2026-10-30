import { useEffect, useState } from "react";
import type { AtlasEntry, Counterfactual, CounterfactualEdit, VillageView } from "@psyche/engine";
import { api } from "./api";
import { clock } from "./util";

type Open = (agent: string, trace?: string) => void;

/** Who is alive, who they belong to, who has gone, and what the village has come to expect. */
export function People({ v, names, onOpen }: { v: VillageView; names: Record<string, string>; onOpen: Open }) {
  const living = v.people.filter((p) => p.alive);
  const dead = v.people.filter((p) => !p.alive);
  const name = (id: string) => names[id] ?? v.people.find((p) => p.id === id)?.name ?? id;
  const gens = [...new Set(living.map((p) => p.generation))].sort();
  return (
    <div className="grid2" style={{ marginTop: 14 }}>
      <div className="pane">
        <h3>Year {v.year}: {living.length} living</h3>
        <div className="tbl">
          <table>
            <thead>
              <tr><th>Person</th><th>Age</th><th>Family</th></tr>
            </thead>
            <tbody>
              {gens.flatMap((g) => [
                <tr key={`g${g}`}><td colSpan={3} className="small muted">{g === 0 ? "Came across the water" : g === 1 ? "Born here" : `Born here, generation ${g + 1}`}</td></tr>,
                ...living.filter((p) => p.generation === g).map((p) => (
                  <tr key={p.id}>
                    <td><button className="linkish" style={{ color: `var(--a-${p.id})` }} onClick={() => onOpen(p.id)}><b>{p.name}</b></button></td>
                    <td className="n">{p.age}</td>
                    <td className="small">
                      {p.parents.length > 0 && `child of ${p.parents.map(name).join(" and ")}`}
                      {p.parents.length > 0 && p.partner && "; "}
                      {p.partner && `with ${name(p.partner)}`}
                      {p.arrived !== undefined && p.parents.length === 0 && `${p.partner ? "; " : ""}arrived ${clock(p.arrived).split(" · ")[0]}`}
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>
      <div className="pane">
        <h3>What the village expects</h3>
        {v.norms.length === 0 ? (
          <p className="small">Nothing yet. A norm forms when people see it broken and hold it against the one who broke it, round after round.</p>
        ) : (
          <ul className="norms">
            {v.norms.map((n) => (
              <li key={n.text}>
                <b>{n.text}</b>
                <span className="fid" title={`strength ${n.strength}`}><i style={{ width: `${Math.round(n.strength * 100)}%` }} /></span>
                <span className="small">
                  {n.established !== undefined ? `Expected since ${clock(n.established)}.` : "Not yet expected."} Broken in sight of others and held against them {n.sanctions} times over {n.rounds} pledge{n.rounds === 1 ? "" : "s"}.
                </span>
              </li>
            ))}
          </ul>
        )}
        <h3 style={{ marginTop: 14 }}>Gone</h3>
        {dead.length === 0 ? (
          <p className="small">No one has died yet.</p>
        ) : (
          <ul className="dead">
            {dead.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b> <span className="small">died {p.died !== undefined ? clock(p.died).split(" · ")[0] : ""} at {p.age}, of {p.cause}.</span>
              </li>
            ))}
          </ul>
        )}
        <p className="small">The dead keep their memories here. Stories they told are still traced back to them.</p>
      </div>
    </div>
  );
}

/** Fears across generations: every core belief, who holds it now, and the first-hand memory it began as. */
export function Atlas({ tick, names, onOpen }: { tick: number; names: Record<string, string>; onOpen: Open }) {
  const [beliefs, setBeliefs] = useState<AtlasEntry[]>();
  const [whatIf, setWhatIf] = useState<CounterfactualEdit>();
  const day = Math.floor(tick / 1440);
  useEffect(() => {
    let live = true;
    api.atlas().then((x) => live && setBeliefs(x.beliefs), () => undefined);
    return () => {
      live = false;
    };
  }, [day]);
  if (!beliefs) return <p className="empty">Gathering everyone's core beliefs...</p>;
  return (
    <div className="atlas">
      <p className="small">
        Core beliefs are formed by what happens to someone, and passed on in stories: at bedtime, at the fire. A child who never saw the famine can still dread it. Each belief here is traced back through the people who passed it on to the first-hand memory it began as, even when that person is dead. Inherited beliefs first.
      </p>
      {beliefs.map((e) => {
        const living = e.holders.filter((h) => h.alive);
        const inherited = living.filter((h) => h.inherited);
        return (
          <div className="pane" key={e.text}>
            <h3>
              “{e.text}” <span className="muted">· {living.length} hold it{inherited.length ? `, ${inherited.length} never lived it` : ""}</span>
            </h3>
            <div className="gens">
              {Object.entries(e.byGeneration).map(([g, n]) => (
                <span key={g} className="chip">{g === "0" ? "first generation" : `generation ${Number(g) + 1}`}: {n}</span>
              ))}
            </div>
            <ul className="lineage-list">
              {e.holders.filter((h) => h.alive && h.inherited).slice(0, 6).map((h) => (
                <li key={h.agent}>
                  <button className="linkish" style={{ color: `var(--a-${h.agent})` }} onClick={() => onOpen(h.agent)}><b>{h.name}</b></button>
                  <span className="chain">
                    {h.chain.map((c, i) => (
                      <span key={i} className={c.firstHand ? "root" : ""}>
                        {i > 0 && <span className="arrow"> ← told by </span>}
                        <b style={{ color: `var(--a-${c.agent})` }}>{c.agent === h.agent ? "heard" : c.name}</b>: {c.gist}
                      </span>
                    ))}
                  </span>
                  <button className="btn small" onClick={() => setWhatIf(whatIf?.agent === h.agent && whatIf.id === h.schema ? undefined : { agent: h.agent, kind: "schema", id: h.schema })}>What if not?</button>
                  {whatIf?.agent === h.agent && whatIf.id === h.schema && <WhatIfNot edit={whatIf} names={names} />}
                </li>
              ))}
            </ul>
            <p className="small">
              Began as: {e.roots.slice(0, 4).map((r, i) => (
                <span key={i}>{i > 0 && "; "}<b>{r.name}</b>{r.alive ? "" : " (dead)"}, “{r.gist}”{r.holders > 1 ? ` (passed to ${r.holders - 1})` : ""}</span>
              ))}
              {e.roots.length > 4 && `; and ${e.roots.length - 4} more`}.
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Take one thing out of one mind, run the world on twice from now, and show what changed. */
export function WhatIfNot({ edit, names }: { edit: CounterfactualEdit; names: Record<string, string> }) {
  const [r, setR] = useState<Counterfactual>();
  const [error, setError] = useState<string>();
  const [days, setDays] = useState(4);
  useEffect(() => {
    let live = true;
    setR(undefined);
    setError(undefined);
    api.counterfactual({ ...edit, days }).then((x) => live && setR(x), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit.agent, edit.kind, edit.id, days]);
  const who = names[edit.agent] ?? edit.agent;
  if (error) return <p className="small">{error}</p>;
  if (!r) return <p className="small">Running the next {days} days twice, with and without it...</p>;
  const flips = r.choices.filter((c) => c.agent === edit.agent);
  const dm = r.mood.without - r.mood.actual;
  return (
    <div className="whatif">
      <h4>
        {who} without “{r.label}”, over the next {r.days} days
        <select aria-label="Days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[2, 4, 8, 16].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </h4>
      <p className="small">
        Both runs start from this moment, on the offline mock, with the same luck. {flips.length === 0 ? `${who} made the same ${r.compared} choices either way.` : `${who} chose differently ${flips.length} time${flips.length === 1 ? "" : "s"} out of ${r.compared}.`}{" "}
        {Math.abs(dm) > 0.02 && `Mood ended ${dm > 0 ? "higher" : "lower"} without it (${r.mood.actual.toFixed(2)} → ${r.mood.without.toFixed(2)}).`}{" "}
        {r.returned && "It came back on its own: what installed it happened again."}
        {r.ripple.length > 0 && ` It reached ${r.ripple.length} other ${r.ripple.length === 1 ? "person" : "people"}: ${r.ripple.map((x) => names[x] ?? x).join(", ")} chose differently too.`}
      </p>
      {r.choices.length > 0 && (
        <ul>
          {r.choices.slice(0, 6).map((c, i) => (
            <li key={i}>
              <span className="small">{clock(c.tick)}</span> {c.question.replace(/^Why did /, "").replace(/\?$/, "")}: <b>{c.actual}</b> → <b>{c.without}</b>
            </li>
          ))}
        </ul>
      )}
      {flips.length === 0 && r.margins.length > 0 && (
        <ul>
          {r.margins.slice(0, 4).map((m, i) => (
            <li key={i} className="small">
              {m.question.replace(/^Why did /, "").replace(/\?$/, "")}: {m.actual === m.without ? `still “${m.actual}”, but` : `“${m.actual}” became “${m.without}”;`} the lead over the next option went {m.actualMargin.toFixed(2)} → {m.withoutMargin.toFixed(2)}.
            </li>
          ))}
        </ul>
      )}
      {r.liking.length > 0 && (
        <p className="small">
          Feelings that ended up different: {r.liking.slice(0, 4).map((l) => `${names[l.from] ?? l.from} toward ${names[l.to] ?? l.to} ${l.actual.toFixed(2)} → ${l.without.toFixed(2)}`).join("; ")}.
        </p>
      )}
    </div>
  );
}
