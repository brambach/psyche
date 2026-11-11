// The civilization panel: what the town's markets, sides, leaders, sicknesses, records and crafts
// are doing, and what has passed between the towns. Everything is read from the engine (world/civ);
// each event carries the causes the engine kept for it, and a cause that points at a person opens
// that person's mind.

import { useEffect, useState } from "react";
import type { CivView, RegionCivView, Why } from "@psyche/engine";
import { api, type CivData, type GameView } from "./api";
import "./civ.css";

type Tab = "market" | "sides" | "rule" | "sickness" | "records" | "crafts" | "coast";
const TABS: [Tab, string][] = [["market", "Market"], ["sides", "Sides"], ["rule", "Leaders and laws"], ["sickness", "Sickness"], ["records", "Records"], ["crafts", "Crafts"], ["coast", "Between towns"]];

type OnMind = (id: string, trace?: string) => void;

export function CivChip({ summary, onOpen, open }: { summary: NonNullable<GameView["civ"]>; onOpen: () => void; open: boolean }) {
  const parts = [summary.specialists ? `${summary.specialists} in trades` : "", summary.factions ? `${summary.factions} ${summary.factions === 1 ? "side" : "sides"}` : ""].filter(Boolean);
  const alarm = summary.sick ? `${summary.sick} in town${summary.closed ? ", landing shut" : ""}` : undefined;
  return (
    <button className={`g-btn ${open ? "on" : ""} cv-chip ${alarm ? "cv-alarm" : ""}`} onClick={onOpen} title={alarm ?? "Markets and trades, sides, leaders and laws, sickness, records, crafts, and what passes between the towns"}>
      <span aria-hidden>⚖</span> {parts.length ? parts.join(" · ") : "Civilization"}
      {alarm && <span className="cv-dot" aria-label={alarm}>!</span>}
    </button>
  );
}

export function CivPanel({ tick, onMind, onClose }: { tick: number; onMind: OnMind; onClose: () => void }) {
  const [d, setD] = useState<CivData>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("market");
  // Re-read as the world moves on, a sim hour at a time.
  const hour = Math.floor(tick / 60);
  useEffect(() => {
    let live = true;
    api.civ().then((x) => live && (setD(x), setError(undefined))).catch((e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [hour]);
  const c = d?.civ;
  return (
    <aside className="g-mind cv" aria-label="Civilization">
      <div className="g-mind-bar">
        <div className="g-seg cv-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <button className="g-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <h2 className="cv-title">{d ? `${d.name}, year ${d.year}` : "Civilization"}</h2>
      {error && <p className="cv-error">{error}</p>}
      {c && tab === "market" && <Market c={c} onMind={onMind} />}
      {c && tab === "sides" && <Sides c={c} onMind={onMind} />}
      {c && tab === "rule" && <Rule c={c} onMind={onMind} />}
      {c && tab === "sickness" && <Sickness c={c} onMind={onMind} />}
      {c && tab === "records" && <Records c={c} />}
      {c && tab === "crafts" && <Crafts c={c} />}
      {d && c && tab === "coast" && <Coast c={c} r={d.region} onMind={onMind} />}
    </aside>
  );
}

/** The causes the engine kept. A cause that names a person opens their mind. */
function Causes({ why, onMind, open = false }: { why?: Why[]; onMind?: OnMind; open?: boolean }) {
  if (!why?.length) return null;
  return (
    <details className="cv-why" open={open}>
      <summary>Why</summary>
      <ul>
        {why.map((w, i) => (
          <li key={i}>
            {w.text}
            {w.agent && onMind && <button className="g-mini" onClick={() => onMind(w.agent!)}>mind</button>}
          </li>
        ))}
      </ul>
    </details>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const DEAL: [keyof CivMarket["deals"], string][] = [["amber", "for amber"], ["barter", "by barter"], ["store", "out of the common store"], ["credit", "on credit"], ["gift", "given"], ["failed", "fell through"]];
type CivMarket = NonNullable<CivView["economy"]>["markets"][number];

function Market({ c, onMind }: { c: CivView; onMind: OnMind }) {
  const e = c.economy;
  if (!e) return null;
  const year = e.markets.slice(-4);
  const sum = Object.fromEntries(DEAL.map(([k]) => [k, year.reduce((s, m) => s + m.deals[k], 0)])) as Record<keyof CivMarket["deals"], number>;
  const total = DEAL.reduce((s, [k]) => s + sum[k], 0);
  const specialists = e.trades.reduce((s, t) => s + t.people.length, 0);
  return (
    <>
      <p className="cv-lede">
        {specialists ? `${specialists} ${specialists === 1 ? "person lives" : "people live"} by a trade rather than by growing or catching food.` : "Everyone here still lives off their own hands and the common store."}{" "}
        {e.money.established ? `Amber is money here.` : `Amber is not yet money: ${pct(e.money.share)} would take it for food.`} Wealth is spread {e.gini < 0.25 ? "evenly" : e.gini < 0.45 ? "unevenly" : "very unevenly"} (Gini {e.gini.toFixed(2)}).
      </p>
      <section>
        <h3>How deals were settled, last four markets</h3>
        {total === 0 ? (
          <p className="cv-muted">No market yet. A town needs ten grown people and something to sell.</p>
        ) : (
          <>
            <div className="cv-bar" role="img" aria-label={DEAL.map(([k, l]) => `${sum[k]} ${l}`).join(", ")}>
              {DEAL.filter(([k]) => sum[k] > 0).map(([k, l]) => (
                <span key={k} className={`cv-seg cv-${k}`} style={{ flexGrow: sum[k] }} title={`${sum[k]} ${l} (${pct(sum[k] / total)})`} />
              ))}
            </div>
            <ul className="cv-legend">
              {DEAL.map(([k, l]) => (
                <li key={k} className={sum[k] ? "" : "cv-none"}>
                  <span className={`cv-sw cv-${k}`} aria-hidden /> <b>{sum[k]}</b> {l}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {e.markets.length > 1 && (
        <section className="cv-charts">
          <Line title="Price of food" unit="× the old price" points={e.markets.map((m) => ({ label: `year ${m.year}, ${m.season}`, value: m.price.food ?? 1 }))} base={1} />
          <Line title="How unevenly wealth is spread" unit="Gini" points={e.markets.map((m) => ({ label: `year ${m.year}, ${m.season}`, value: m.gini }))} />
        </section>
      )}
      <section>
        <h3>Trades</h3>
        {e.trades.every((t) => !t.people.length && !t.room) && <p className="cv-muted">Nobody knows a craft a person could live by yet.</p>}
        <ul className="cv-list">
          {e.trades.filter((t) => t.people.length || t.room).map((t) => (
            <li key={t.role}>
              <b className="cv-cap">{t.role}</b> <span className="cv-muted">{t.does}</span>
              <div className="cv-names">
                {t.people.length ? t.people.map((p) => <button key={p.id} className="cv-name" onClick={() => onMind(p.id)}>{p.name}</button>) : <span className="cv-muted">nobody yet</span>}
                {t.room > 0 && <span className="cv-muted">room for {t.room} more</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Goods</h3>
        <table className="cv-table">
          <thead>
            <tr><th>Good</th><th>In town</th><th>Still wanted</th><th>Price</th><th>What it does</th></tr>
          </thead>
          <tbody>
            {e.goods.map((g) => (
              <tr key={g.good}>
                <td className="cv-cap">{g.good}</td>
                <td>{Math.round(g.held)}</td>
                <td>{Math.round(g.wanted)}</td>
                <td className="cv-nowrap">{g.price.toFixed(1)} <span className="cv-muted">(usually {g.usual})</span></td>
                <td className="cv-muted">{g.does}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cv-muted">Prices are in days of food.</p>
      </section>
      {e.gouges.length > 0 && (
        <section>
          <h3>Asked more in a hungry season</h3>
          <ul className="cv-list">
            {e.gouges.slice(-8).reverse().map((g, i) => (
              <li key={i}>
                <button className="cv-name" onClick={() => onMind(g.seller)}>{g.name}</button> asked {g.over}% over the old price of {g.buyers} {g.buyers === 1 ? "household" : "households"}. They remember.
              </li>
            ))}
          </ul>
        </section>
      )}
      <Happened c={c} kinds={["market", "trade"]} onMind={onMind} />
    </>
  );
}

/** One measure over the town's markets: a 2px line, a hover readout, the last value labelled. */
function Line({ title, unit, points, base }: { title: string; unit: string; points: { label: string; value: number }[]; base?: number }) {
  const [at, setAt] = useState<number>();
  const W = 320;
  const H = 96;
  const pad = { l: 6, r: 44, t: 8, b: 6 };
  const vs = points.map((p) => p.value).concat(base ?? []);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const last = points.at(-1)!;
  const shown = at !== undefined ? points[at]! : last;
  return (
    <figure className="cv-line">
      <figcaption>
        <b>{title}</b>
        <span className="cv-read">
          {shown.value.toFixed(2)} {unit} <span className="cv-muted">· {shown.label}</span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}: ${last.value.toFixed(2)} ${unit} at the last market, between ${lo.toFixed(2)} and ${hi.toFixed(2)} over ${points.length} markets`}
        onMouseLeave={() => setAt(undefined)}
        onMouseMove={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect();
          const px = ((ev.clientX - r.left) / r.width) * W;
          setAt(Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1)))));
        }}
      >
        {base !== undefined && <line className="cv-base" x1={pad.l} x2={W - pad.r} y1={y(base)} y2={y(base)} />}
        <polyline className="cv-path" points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")} />
        {at !== undefined && <line className="cv-cross" x1={x(at)} x2={x(at)} y1={pad.t} y2={H - pad.b} />}
        <circle className="cv-pt" cx={x(at ?? points.length - 1)} cy={y(shown.value)} r={4} />
        <text className="cv-end" x={W - pad.r + 6} y={y(last.value) + 4}>{last.value.toFixed(2)}</text>
      </svg>
    </figure>
  );
}

function Sides({ c, onMind }: { c: CivView; onMind: OnMind }) {
  const f = c.factions;
  if (!f) return null;
  return (
    <>
      <p className="cv-lede">
        Sides are read off who likes whom: households that like each other clearly more than they like the rest. Nobody is assigned to one.
        {f.factions.length ? ` ${f.unaligned} grown ${f.unaligned === 1 ? "person stands" : "people stand"} with no side.` : ""}
      </p>
      {f.factions.length === 0 && <p className="cv-muted">The town has no sides now.</p>}
      {f.exit && <p className="cv-note">{f.exit.name} are talking of leaving: {f.exit.reason}.</p>}
      {f.factions.map((x) => (
        <section key={x.id} className="cv-card">
          <h3>{x.name}</h3>
          <p>
            {x.members.length} grown people in {x.households} households, under <button className="cv-name" onClick={() => onMind(x.head)}>{x.headName}</button> since year {x.founded}. What they share: {x.shares}.
          </p>
          <dl className="cv-facts">
            <dt>Like each other</dt>
            <dd><Meter value={x.inner} /> {x.inner.toFixed(2)}</dd>
            <dt>Like the rest</dt>
            <dd><Meter value={x.outer} /> {x.outer.toFixed(2)}</dd>
            {x.lost > 0 && (
              <>
                <dt>Elections lost</dt>
                <dd>{x.lost} in a row</dd>
              </>
            )}
            {x.rivals.map((r) => (
              <RivalRow key={r.with} name={r.name} value={r.value} />
            ))}
          </dl>
          {x.grievances.length > 0 && (
            <ul className="cv-list">
              {x.grievances.slice(-4).reverse().map((g, i) => (
                <li key={i}>
                  <span className="cv-year">year {g.year}</span> {g.text} <button className="g-mini" onClick={() => onMind(g.agent)}>mind</button>
                </li>
              ))}
            </ul>
          )}
          <Causes why={x.why} onMind={onMind} />
        </section>
      ))}
      {f.brawls.length > 0 && (
        <section>
          <h3>Blows</h3>
          <ul className="cv-list">
            {f.brawls.slice(-6).reverse().map((b, i) => (
              <li key={i}>{b.text}</li>
            ))}
          </ul>
        </section>
      )}
      <Happened c={c} kinds={["faction"]} onMind={onMind} />
    </>
  );
}

function RivalRow({ name, value }: { name: string; value: number }) {
  return (
    <>
      <dt>Against {name}</dt>
      <dd><Meter value={value} hot /> {value < 0.3 ? "easy" : value < 0.6 ? "strained" : "bitter"}</dd>
    </>
  );
}

function Meter({ value, hot }: { value: number; hot?: boolean }) {
  return (
    <span className={`cv-meter ${hot ? "cv-hot" : ""}`} aria-hidden>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

function Rule({ c, onMind }: { c: CivView; onMind: OnMind }) {
  const p = c.polity;
  if (!p) return null;
  return (
    <>
      <p className="cv-lede">
        {p.leader ? (
          <>
            <button className="cv-name" onClick={() => onMind(p.leader!.id)}>{p.leader.name}</button> has led since year {p.leader.since}{p.leader.faction ? `, of ${p.leader.faction}` : ""}.
          </>
        ) : (
          "Nobody leads yet."
        )}{" "}
        {p.mandate && `Promised that ${p.mandate.text}${p.mandate.done ? " (kept)" : p.mandate.failed ? " (the town voted it down)" : ""}.`}
      </p>
      <section>
        <h3>Laws</h3>
        {p.laws.length === 0 && <p className="cv-muted">No laws yet.</p>}
        <ul className="cv-list">
          {p.laws.slice().reverse().map((l) => (
            <li key={l.id} className={l.inForce ? "" : "cv-gone"}>
              <b>{l.name}</b> <span className="cv-year">year {l.year}</span> {l.written && <span className="cv-tag">written</span>} {!l.inForce && <span className="cv-tag cv-tag-off">{l.repealed ? `repealed year ${l.repealed}` : l.against >= l.for ? "voted down" : l.kind === "jubilee" ? "done" : "lapsed"}</span>}
              <div className="cv-muted">
                {l.text} Put by <button className="cv-name" onClick={() => onMind(l.author)}>{l.authorName}</button>: {l.for} for, {l.against} against.
              </div>
              <Causes why={l.why} onMind={onMind} />
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Elections</h3>
        {p.contests.length === 0 && <p className="cv-muted">No election yet.</p>}
        {p.contests.slice().reverse().slice(0, 8).map((k) => (
          <div key={k.tick} className="cv-card">
            <p>
              <span className="cv-year">year {k.year}</span> <b>{k.candidates.find((x) => x.id === k.winner)?.name}</b> {k.changed ? "is chosen" : "keeps the lead"}, {k.voters} voices.
            </p>
            <ul className="cv-votes">
              {k.candidates.slice().sort((a, b) => b.votes - a.votes).map((x) => (
                <li key={x.id}>
                  <button className="cv-name" onClick={() => onMind(x.id)}>{x.name}</button>
                  <span className="cv-meter cv-wide" aria-hidden><span style={{ width: `${(x.votes / Math.max(1, k.voters)) * 100}%` }} /></span>
                  <b>{x.votes}</b>
                  <span className="cv-muted cv-promise">
                    {x.factionName ? `${x.factionName}. ` : ""}Promised that {x.platform.text}. {x.platform.because}.
                  </span>
                </li>
              ))}
            </ul>
            {k.blocs.length > 0 && <p className="cv-muted">{k.blocs.map((b) => `${pct(b.share)} of ${b.name} named ${k.candidates.find((x) => x.id === b.for)?.name ?? "one of their own"}`).join("; ")}.</p>}
            <Causes why={k.why} onMind={onMind} />
          </div>
        ))}
      </section>
      <Happened c={c} kinds={["election", "law"]} onMind={onMind} />
    </>
  );
}

function Sickness({ c, onMind }: { c: CivView; onMind: OnMind }) {
  const h = c.health;
  if (!h) return null;
  return (
    <>
      <p className="cv-lede">
        {h.now ? `${h.now.name} is in the town: ${h.now.sick.length} sick now, ${h.now.cases} since it began in year ${h.now.since}, ${h.now.dead} dead. It ${h.now.source}.` : "Nobody is sick."}{" "}
        {h.closed && "The landing and the market are shut."}
      </p>
      {h.now && h.now.sick.length > 0 && (
        <p className="cv-names">
          {h.now.sick.map((s) => <button key={s.id} className="cv-name" onClick={() => onMind(s.id)}>{s.name}</button>)}
        </p>
      )}
      <section>
        <h3>Who has had what</h3>
        <dl className="cv-facts">
          {h.immune.map((i) => (
            <ImmuneRow key={i.name} name={i.name} share={i.share} />
          ))}
        </dl>
      </section>
      <section>
        <h3>Outbreaks remembered</h3>
        {h.past.length === 0 && <p className="cv-muted">None yet.</p>}
        {h.past.map((o) => (
          <div key={o.id} className="cv-card">
            <p>
              <span className="cv-year">year {o.year}</span> <b className="cv-cap">{o.name}</b>: {o.cases} sick, {o.dead.length} dead. It {o.source}.{o.decision ? ` ${o.decision}.` : ""}
            </p>
            {o.blamed.length > 0 && <p className="cv-muted">Blamed: {o.blamed.join("; ")}.</p>}
            <Causes why={o.why} onMind={onMind} />
          </div>
        ))}
      </section>
    </>
  );
}

function ImmuneRow({ name, share }: { name: string; share: number }) {
  return (
    <>
      <dt className="cv-cap">{name}</dt>
      <dd><Meter value={share} /> {pct(share)} cannot catch it again for now</dd>
    </>
  );
}

function Records({ c }: { c: CivView }) {
  const r = c.records;
  if (!r) return null;
  if (!r.since) return <p className="cv-lede">Nobody here can write. What the town knows lives in people's heads, and goes when they go.</p>;
  return (
    <>
      <p className="cv-lede">
        Records kept since year {r.since}{r.scribe ? `, now by ${r.scribe.name}` : ", though nobody keeps them now"}. {r.readers} can read. {Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(", ")}.
        {r.readBacks > 0 && ` ${r.readBacks} ${r.readBacks === 1 ? "craft has" : "crafts have"} been read back after the last person who knew it died.`}
        {r.burned > 0 && ` ${r.burned} burned.`}
      </p>
      {r.founding.length > 0 && (
        <section>
          <h3>The founding, as written</h3>
          {r.founding.map((f, i) => (
            <blockquote key={i} className="cv-quote">
              {f.text}
              <footer>{f.title}, set down by {f.scribe} in year {f.year}. A written story no longer changes in the telling.</footer>
            </blockquote>
          ))}
        </section>
      )}
      <section>
        <h3>The annals, and what they leave out</h3>
        {r.annals.length === 0 && <p className="cv-muted">No year has been written up yet.</p>}
        <ul className="cv-list">
          {r.annals.slice(0, 10).map((a, i) => (
            <li key={i} className={a.burned ? "cv-gone" : ""}>
              <span className="cv-year">year {a.year}</span> {a.text} <span className="cv-muted">({a.scribe})</span>
              {a.omitted && a.omitted.length > 0 && (
                <details className="cv-why">
                  <summary>Left out ({a.omitted.length})</summary>
                  <ul>
                    {a.omitted.map((o, j) => (
                      <li key={j}>{o.title}: {o.because}.</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
      {r.crafts.length > 0 && (
        <section>
          <h3>Crafts written down</h3>
          <ul className="cv-chips">
            {r.crafts.map((k, i) => (
              <li key={i} className={k.burned ? "cv-gone" : ""} title={`year ${k.year}${k.from ? `, from ${k.from}` : ""}${k.burned ? ", burned" : ""}`}>{k.name}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Crafts({ c }: { c: CivView }) {
  return (
    <>
      <p className="cv-lede">Later crafts are worked out by someone curious and careful whose own work touches what the craft grows out of. A town too small to keep one cannot work it out, and can lose it.</p>
      <ul className="cv-tree">
        {c.tech.map((t) => (
          <li key={t.id} className={t.known ? "cv-known" : t.open ? "cv-open" : "cv-shut"}>
            <div>
              <b>{t.name}</b> <span className="cv-tag">{t.known ? `${t.known} know it` : t.lost ? `lost in year ${Math.floor(t.lost / (16 * 1440)) + 1}` : t.open ? "within reach" : "out of reach"}</span>
              {t.trade && <span className="cv-tag">makes a {t.trade}</span>}
            </div>
            <div className="cv-muted">{t.does}</div>
            {(t.needs.length > 0 || t.minAdults) && (
              <div className="cv-needs">
                {t.needs.map((n) => (
                  <span key={n.id} className={n.have ? "cv-have" : "cv-lack"}>{n.have ? "✓" : "✗"} {n.name}</span>
                ))}
                {t.minAdults && <span className="cv-muted">needs {t.minAdults} grown people</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Coast({ c, r, onMind }: { c: CivView; r?: RegionCivView; onMind: OnMind }) {
  return (
    <>
      <p className="cv-lede">What passes between the towns: merchants, households that move, raids, and the truces that end them.</p>
      {c.abroad.length > 0 && (
        <section>
          <h3>How this town sees the others</h3>
          <table className="cv-table">
            <thead>
              <tr><th>Town</th><th>Regard</th><th>Raided us</th><th>Standing</th></tr>
            </thead>
            <tbody>
              {c.abroad.map((a) => (
                <tr key={a.town}>
                  <td>{a.name}</td>
                  <td>{a.regard > 0.15 ? "warm" : a.regard < -0.35 ? "hostile" : a.regard < -0.1 ? "wary" : "neutral"} ({a.regard.toFixed(2)})</td>
                  <td>{a.raidedUs || ""}</td>
                  <td>{[a.treaty, a.stance && `leader promised ${a.stance}`, a.sick && `${a.sick} there`].filter(Boolean).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {r && (
        <>
          <section>
            <h3>Raids</h3>
            {r.raids.length === 0 && <p className="cv-muted">No town has raided another.</p>}
            {r.raids.map((x, i) => (
              <div key={i} className="cv-card">
                <p>
                  <span className="cv-year">year {x.year}</span> <b>{x.fromName}</b> raided <b>{x.toName}</b> under <button className="cv-name" onClick={() => onMind(x.leader)}>{x.leaderName}</button>: {x.went} went, {x.stayed} stayed home. {x.won ? `They took ${Math.round(x.loot)} days' food.` : "They were driven off."} {x.dead.length ? `${x.dead.length} killed.` : "Nobody was killed."}
                </p>
                <Causes why={x.why} onMind={onMind} />
              </div>
            ))}
          </section>
          <section>
            <h3>Truces</h3>
            {r.treaties.length === 0 && <p className="cv-muted">None.</p>}
            {r.treaties.map((t) => (
              <div key={t.id} className={`cv-card ${t.inForce ? "" : "cv-gone"}`}>
                <p>
                  <span className="cv-year">year {t.year}</span> <b>{t.aName}</b> and <b>{t.bName}</b>: {t.terms} {t.written && <span className="cv-tag">written</span>} {t.ended && <span className="cv-tag cv-tag-off">ended: {t.ended.why}</span>}
                </p>
                <Causes why={t.why} onMind={onMind} />
              </div>
            ))}
          </section>
          <section>
            <h3>Households that moved</h3>
            {r.moves.length === 0 && <p className="cv-muted">None.</p>}
            {r.moves.map((m, i) => (
              <div key={i} className="cv-card">
                <p>
                  <span className="cv-year">year {m.year}</span> <button className="cv-name" onClick={() => onMind(m.head)}>{m.headName}</button>'s household, {m.people.length} in all, left <b>{m.fromName}</b> for <b>{m.toName}</b>.
                </p>
                <Causes why={m.why} onMind={onMind} />
              </div>
            ))}
          </section>
          <section>
            <h3>Merchant runs</h3>
            {r.runs.length === 0 && <p className="cv-muted">No merchant has carried goods between towns yet.</p>}
            <ul className="cv-list">
              {r.runs.slice(0, 12).map((x, i) => (
                <li key={i}>
                  <span className="cv-year">year {x.year}</span> {x.merchantName} carried {x.qty} {x.good} from {x.fromName} to {x.toName}, {x.profit >= 0 ? `${x.profit.toFixed(1)} days' food ahead` : `${Math.abs(x.profit).toFixed(1)} behind`}.
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

/** The town's own record of what its systems did, newest first, each with its causes. */
function Happened({ c, kinds, onMind }: { c: CivView; kinds: string[]; onMind: OnMind }) {
  const ev = c.events.filter((e) => kinds.includes(e.kind)).slice(0, 12);
  if (!ev.length) return null;
  return (
    <section>
      <h3>What happened</h3>
      <ul className="cv-list">
        {ev.map((e, i) => (
          <li key={i}>
            <span className="cv-year">year {e.year}</span> <b>{e.title}.</b> {e.text}
            <Causes why={e.why} onMind={onMind} />
          </li>
        ))}
      </ul>
    </section>
  );
}
