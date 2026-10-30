import { useEffect, useState } from "react";
import type { DivergenceEntry, SaysVsWas, VillageView } from "@psyche/engine";
import { api } from "./api";
import { clock, diffWords } from "./util";

type Open = (agent: string, trace?: string) => void;

const WEATHER: Record<string, string> = { fair: "Fair", rain: "Rain", gale: "Gale" };
const PLEDGE: Record<string, string> = { commit: "full share", token: "a little", hold: "held back" };

/** The village as a whole: the season, the larder, the houses going up, and the pledges. */
export function Village({ v, names, onOpen }: { v: VillageView; names: Record<string, string>; onOpen: Open }) {
  const [asked, setAsked] = useState<{ agent: string; trace: string }>();
  const latest = v.pledges.at(-1);
  return (
    <div className="village">
      <div className="village-stats">
        <Stat label="Season" value={`${v.season[0]!.toUpperCase()}${v.season.slice(1)}`} note={`day ${v.dayOfSeason} of ${v.seasonDays}`} />
        <Stat label="Weather" value={WEATHER[v.weather] ?? v.weather} note={v.blight ? "blight in the barley" : undefined} />
        <Stat label="Common store" value={v.store.food.toFixed(0)} note={`${v.store.put.toFixed(0)} put in, ${v.store.taken.toFixed(0)} taken`} />
        <Stat label="Timber · stone · reeds" value={`${v.stock.timber} · ${v.stock.stone} · ${v.stock.reeds}`} note="cut and waiting" />
      </div>

      <div className="grid2">
        <div className="pane">
          <h3>Households</h3>
          <div className="tbl">
            <table>
              <thead>
                <tr><th>Household</th><th>Food</th><th>Sleeping in</th><th>Pledge</th></tr>
              </thead>
              <tbody>
                {v.households.map((h) => (
                  <tr key={h.id}>
                    <td>
                      {h.members.map((m, i) => (
                        <span key={m}>{i > 0 && ", "}<button className="linkish" style={{ color: `var(--a-${m})` }} onClick={() => onOpen(m)}>{names[m]}</button></span>
                      ))}
                    </td>
                    <td className="n">{h.food.toFixed(1)}</td>
                    <td>{h.shelter === "house" ? "a house" : "tents"}</td>
                    <td className="n" title="Share of the household's surplus going into the store each evening">{Math.round(h.rate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">Food is in days of rations. It spoils in tents; what is in the common store keeps. Households short at supper draw from the store.</p>
        </div>
        <div className="pane">
          <h3>Houses</h3>
          {v.structures.length === 0 && <p className="small">Nothing started yet. The builders start at eight.</p>}
          <ul className="houses">
            {v.structures.map((s) => (
              <li key={s.id}>
                <div className="house-head">
                  <b>{s.name}</b>
                  <span className="small"> for {v.households.find((h) => h.id === s.household)?.name ?? s.household}, designed by <button className="linkish" onClick={() => onOpen(s.designer, s.trace)}>{names[s.designer]}</button></span>
                </div>
                <span className="fid" title={`${Math.round(s.progress * 100)}%`}><i style={{ width: `${Math.round(s.progress * 100)}%` }} /></span>
                <span className="small">{s.done ? "Finished." : `${Math.round(s.progress * 100)}% built. Has ${Math.floor(s.have.timber)}/${s.need.timber} timber, ${Math.floor(s.have.stone)}/${s.need.stone} stone, ${Math.floor(s.have.reeds)}/${s.need.reeds} reeds.`}</span>
                <span className="small">{s.description}. “{s.rationale}”</span>
                {s.repairs.length > 0 && <span className="small muted">Changed to fit: {s.repairs.join("; ")}.</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="pane" style={{ marginTop: 14 }}>
        <h3>The common store pledge</h3>
        {!latest ? (
          <p className="small">Not asked yet. Someone will ask at the fire on the second evening, and again each time the season turns.</p>
        ) : (
          <>
            <p className="small">Each person chose from their own state: trust in the others, how hungry they are, and old core beliefs about who shares when food runs short. Pick anyone to see what they'd say about it, against what the ledger finds.</p>
            <div className="tbl">
              <table className="pledges">
                <thead>
                  <tr>
                    <th>Person</th>
                    {v.pledges.map((p) => <th key={p.tick}>{clock(p.tick).replace(" · ", ", ")} ({p.season})</th>)}
                  </tr>
                </thead>
                <tbody>
                  {latest.answers.map((a) => (
                    <tr key={a.agent}>
                      <td style={{ color: `var(--a-${a.agent})` }}><b>{names[a.agent]}</b></td>
                      {v.pledges.map((p) => {
                        const x = p.answers.find((y) => y.agent === a.agent);
                        if (!x) return <td key={p.tick} />;
                        const on = asked?.trace === x.trace && asked.agent === x.agent;
                        return (
                          <td key={p.tick}>
                            <button className={`pledge ${x.option} ${on ? "on" : ""}`} onClick={() => setAsked(on ? undefined : { agent: x.agent, trace: x.trace })}>{PLEDGE[x.option]}</button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {asked && <Account agent={asked.agent} trace={asked.trace} names={names} onOpen={onOpen} />}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {note && <span className="small">{note}</span>}
    </div>
  );
}

const MECH: Record<string, string> = {
  "core belief": "core belief",
  "installed by": "where it began",
  "deepened by": "deepened",
  "trust coloured blame": "trust",
  "rewrote memory": "rewritten memory",
  "lingering feeling": "leftover feeling",
  "told by": "heard, source forgotten",
  "passed on": "through another head",
  "generalized from": "drawn from one memory",
};

/** Says vs was: the reasons in mind at the moment of choosing, against the causes the ledger finds. */
export function Account({ agent, trace, names, onOpen }: { agent: string; trace: string; names: Record<string, string>; onOpen: Open }) {
  const [a, setA] = useState<SaysVsWas>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setA(undefined);
    setError(undefined);
    api.account(agent, trace).then((x) => live && setA(x), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [agent, trace]);
  if (error) return <p className="small">{error}</p>;
  if (!a) return <p className="small">Reading the ledger...</p>;
  return (
    <div className="account">
      <h4>{a.decision.label}</h4>
      <div className="grid2">
        <div>
          <h5>What {names[agent]} could tell you</h5>
          <ul>
            {a.says.slice(0, 5).map((s) => <li key={s.node.id}>{s.node.label}</li>)}
          </ul>
          <p className="small">What was in mind when the choice was made.</p>
        </div>
        <div>
          <h5>What else drove it, out of sight</h5>
          {a.was.length === 0 ? (
            <p className="small">Nothing hidden that the ledger can find: the reasons in mind were the whole story.</p>
          ) : (
            <ul>
              {a.was.slice(0, 7).map((w) => (
                <li key={`${w.node.id}|${w.mechanism}`}>
                  <span className={`kind k-${w.node.kind}`}>{MECH[w.mechanism] ?? w.mechanism}</span>{" "}
                  {w.node.agent && w.node.agent !== agent && <b style={{ color: `var(--a-${w.node.agent})` }}>{names[w.node.agent]} · </b>}
                  {w.note}
                  {w.node.trace && w.node.agent && <> <button className="linkish small" onClick={() => onOpen(w.node.agent!, w.node.trace)}>open</button></>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {a.missed.length > 0 && <p className="small">Didn't come to mind: {a.missed.slice(0, 3).map((m) => `“${m.label}”`).join(", ")}.</p>}
    </div>
  );
}

/** Same event, different memories: everyone who lived through something, side by side. */
export function Divergence({ names, tick, onOpen }: { names: Record<string, string>; tick: number; onOpen: Open }) {
  const [events, setEvents] = useState<DivergenceEntry[]>();
  const day = Math.floor(tick / 1440);
  useEffect(() => {
    let live = true;
    api.divergence().then((x) => live && setEvents(x.events), () => undefined);
    return () => {
      live = false;
    };
  }, [day]);
  if (!events) return <p className="empty">Lining up memories...</p>;
  if (!events.length) return <p className="empty">Nobody shares a memory of anything yet.</p>;
  return (
    <div className="divergence">
      <p className="small">People who were there for the same thing remember it differently, and the memories keep moving: retold, rewritten by what others say, recoloured by mood. Most disputed first.</p>
      {events.map((e) => (
        <div className="pane" key={e.id}>
          <h3>{e.label} <span className="muted">· {e.accounts.length} remember it</span></h3>
          <ul className="accounts">
            {e.accounts.map((a) => (
              <li key={a.agent}>
                <button className="linkish" style={{ color: `var(--a-${a.agent})` }} onClick={() => onOpen(a.agent)}><b>{names[a.agent] ?? a.name}</b></button>
                <span className={`tone ${a.valence > 0.1 ? "good" : a.valence < -0.1 ? "bad" : ""}`} title="How it feels to them now">{a.valence > 0 ? "+" : ""}{a.valence.toFixed(2)}</span>
                <span className="memory diff">
                  {a.changes.length ? diffWords(a.original, a.text).map((d, i) => (d.kind === "same" ? <span key={i}>{d.text}</span> : d.kind === "del" ? <del key={i}>{d.text}</del> : <ins key={i}>{d.text}</ins>)) : a.text}
                </span>
                {a.changes.length > 0 && (
                  <span className="small">
                    Changed {a.changes.length} time{a.changes.length > 1 ? "s" : ""}: {a.changes.map((c) => (c.cause === "misinformation" ? `from something ${names[c.from_ ?? ""] ?? "someone"} said` : "filled in from mood and belief")).join("; ")}.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
