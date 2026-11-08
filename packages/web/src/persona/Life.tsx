// Someone who came from their own writing: who they were when they came ashore, who they are now,
// and how much of the life they've lived here traces back to the words they wrote. Every choice
// listed opens its moment, and Why walks it back to the sentence.

import { useEffect, useState } from "react";
import type { TraitName } from "@psyche/engine";
import { Lineage, type LineageQuery } from "../Lineage";
import { clock } from "../util";
import { personaApi, type PersonaLife } from "./api";
import "./persona.css";

const TRAIT_LABEL: Record<TraitName, string> = {
  openness: "Openness",
  conscientiousness: "Conscientiousness",
  extraversion: "Extraversion",
  agreeableness: "Agreeableness",
  neuroticism: "Neuroticism",
  honesty: "Honesty-humility",
};

export function Life({ id, tick, names, onOpen }: { id: string; tick: number; names: Record<string, string>; onOpen: (agent: string, trace?: string) => void }) {
  const [life, setLife] = useState<PersonaLife>();
  const [error, setError] = useState<string>();
  const [why, setWhy] = useState<LineageQuery>();

  useEffect(() => {
    let live = true;
    personaApi.life(id).then((v) => live && setLife(v), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [id, tick]);

  if (error) return <p className="error">{error}</p>;
  if (!life) return <p className="empty">Reading back through {names[id] ?? id}'s life...</p>;
  const r = life.reading;
  const he = r.pronouns.subject;
  const His = cap(r.pronouns.possessive);
  const pct = life.choices.total ? Math.round((life.choices.fromWriting / life.choices.total) * 100) : 0;
  const drift = life.traits.filter((t) => Math.abs(t.now - t.then) >= 0.02);

  return (
    <div className="pl">
      <section className="pl-hero">
        <small>From {r.pronouns.possessive} own writing{r.method === "claude" ? ", read by Claude" : ", read offline"}</small>
        <h2>
          {life.name} came ashore {life.days === 0 ? "today" : `${life.days} ${life.days === 1 ? "day" : "days"} ago`}
          {life.alive ? "" : " and has died"}.
        </h2>
        {life.choices.total > 0 ? (
          <p>
            Of the <b>{life.choices.total}</b> choices {he} {he === "they" ? "have" : "has"} made here, <b>{life.choices.fromWriting}</b> ({pct}%) trace back to a memory, belief or value from what {he} wrote. {His} temperament came from the writing too, and colours {life.choices.byTraits} of them.
          </p>
        ) : (
          <p>No choices yet. Let the world run: the first pledge for the common store comes on the second evening.</p>
        )}
        <p className="pl-sub">
          Works as a {life.role}{life.shelter ? `, living in ${life.shelter === "house" ? "a house" : "a tent"}` : ""}. Mood {life.mood >= 0.1 ? "good" : life.mood <= -0.1 ? "low" : "even"}.
        </p>
      </section>

      <section className="pl-sec">
        <h3>The beliefs {he} brought</h3>
        {life.beliefs.length === 0 && <p className="ps-quiet">None were read from the writing.</p>}
        {life.beliefs.map((b, bi) => {
          // Beliefs that come up around the same things often bend the same choices; list them once.
          const key = (x: typeof b) => x.recent.map((d) => `${d.tick}${d.label}`).join("|");
          const same = b.recent.length > 0 && life.beliefs.slice(0, bi).some((x) => key(x) === key(b));
          return (
          <div key={b.id} className={`pl-card ${b.now === undefined ? "gone" : ""}`}>
            <p className="ps-belief">“{b.text}”</p>
            <span className="ps-meta">
              {b.now === undefined ? "Gone: they let go of it" : `Strength ${b.then.toFixed(2)} → ${b.now.toFixed(2)}${b.deepened ? `, deepened ${b.deepened} ${b.deepened === 1 ? "time" : "times"} in sleep` : ""}`} · bent {b.choices} {b.choices === 1 ? "choice" : "choices"}
            </span>
            {b.quote && <blockquote>{b.quote}</blockquote>}
            {same && <span className="ps-meta">Came up in the same choices as the belief above.</span>}
            {b.recent.length > 0 && !same && (
              <ul className="pl-choices">
                {b.recent.map((d, i) => (
                  <li key={i}>
                    <time>{clock(d.tick).replace(/ · .*/, "")}</time>
                    {d.trace ? <button className="linkish" onClick={() => onOpen(id, d.trace)}>{d.label.replace(`${life.name} chose: `, "")}</button> : <span>{d.label}</span>}
                    {d.trace && <button className="ps-link" onClick={() => setWhy({ agent: id, trace: d.trace })}>Why?</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          );
        })}
      </section>

      {why && (
        <div className="pl-why">
          <Lineage query={why} focus={id} names={names} onOpen={onOpen} onClose={() => setWhy(undefined)} />
        </div>
      )}

      <section className="pl-sec">
        <h3>The memories {he} brought</h3>
        {life.memories.map((m) => (
          <div key={m.id} className="pl-card">
            <div className="ps-pair">
              <div>
                <small>{cap(he)} wrote</small>
                <blockquote>{m.quote}</blockquote>
              </div>
              <div>
                <small>{m.now === undefined ? "Forgotten" : m.rewritten ? `Remembers now, after ${m.rewritten} ${m.rewritten === 1 ? "retelling" : "retellings"}` : "Remembers"}</small>
                <p>{m.now ?? m.gist}</p>
              </div>
            </div>
            <span className="ps-meta">Bent {m.choices} {m.choices === 1 ? "choice" : "choices"}</span>
          </div>
        ))}
      </section>

      <section className="pl-sec ps-cols">
        <div>
          <h3>Who {he} {he === "they" ? "were" : "was"}, who {he} {he === "they" ? "are" : "is"}</h3>
          <ul className="pl-traits">
            {life.traits.map((t) => (
              <li key={t.trait}>
                <span>{TRAIT_LABEL[t.trait]}</span>
                <span className="pl-drift">
                  <span className="ps-bar"><i style={{ width: `${Math.round(t.now * 100)}%` }} /><b style={{ left: `${Math.round(t.then * 100)}%` }} title={`When ${he} came: ${t.then.toFixed(2)}`} /></span>
                  <em>{t.now.toFixed(2)}{Math.abs(t.now - t.then) >= 0.02 ? ` (${t.now > t.then ? "+" : ""}${(t.now - t.then).toFixed(2)})` : ""}</em>
                </span>
              </li>
            ))}
          </ul>
          <p className="ps-hint">{drift.length ? `Life here has moved ${drift.map((t) => TRAIT_LABEL[t.trait].toLowerCase()).join(" and ")}. The tick marks where ${he} started.` : `Nothing has drifted yet. Traits move slowly, a little each night, with how ${he} acts and how it goes.`}</p>
          <h3>What {he} {he === "they" ? "want" : "wants"}</h3>
          <ul className="pl-goals">
            {life.goals.map((g) => (
              <li key={g.value}>
                <span>{g.text}</span>
                <span className="ps-meta">{g.progress !== undefined ? `${Math.round(g.progress * 100)}% of the way` : "given up"} · bent {g.choices}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>People here</h3>
          {life.closest.length > 0 ? (
            <ul className="pl-people">
              {life.closest.map((p) => (
                <li key={p.id}>
                  <button className="linkish" onClick={() => onOpen(p.id)}>{p.name}</button> <span className="ps-meta">likes {p.liking.toFixed(2)} · trusts {p.trust.toFixed(2)}</span>
                </li>
              ))}
              {life.coldest.map((p) => (
                <li key={p.id} className="cold">
                  <button className="linkish" onClick={() => onOpen(p.id)}>{p.name}</button> <span className="ps-meta">wary: likes {p.liking.toFixed(2)} · trusts {p.trust.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ps-quiet">Nobody yet.</p>
          )}
          {life.acquired.length > 0 && (
            <>
              <h3>What the village taught {r.pronouns.object}</h3>
              <ul className="pl-goals">
                {life.acquired.map((a) => <li key={a.text}>“{a.text}” <span className="ps-meta">{a.strength.toFixed(2)}</span></li>)}
              </ul>
            </>
          )}
          <h3>{His} life so far</h3>
          <ol className="pl-moments">
            {life.moments.map((m, i) => (
              <li key={i}>
                <time>{clock(m.tick).replace(/ · .*/, "")}</time> {m.title}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="pl-sec">
        <h3>{His} story, in {r.pronouns.possessive} own head</h3>
        <div className="ps-pair">
          <div>
            <small>When {he} came</small>
            <p>{life.lifeStory.then}</p>
          </div>
          <div>
            <small>Now</small>
            <p>{life.lifeStory.now}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
