import { useState } from "react";
import { FOUNDATIONS, FOUNDATION_TEXT, type DevelopmentView, type RootStep } from "@psyche/engine";
import "./roots.css";

const STAGE_NAMES: Record<string, string> = {
  trust: "Trust",
  autonomy: "Autonomy",
  initiative: "Initiative",
  industry: "Industry",
  intimacy: "Intimacy",
  generativity: "Generativity",
  integrity: "Integrity",
};

const STATUS_NAMES: Record<string, string> = {
  diffused: "Not looking",
  foreclosed: "Settled early",
  moratorium: "Trying things out",
  achieved: "Chose",
};

const ADVERSITY_NAMES: Record<string, string> = {
  loss: "A death",
  hunger: "Hunger",
  harsh: "A hard hand",
  neglect: "Neglect",
  "troubled-parent": "A troubled parent",
  uprooted: "Uprooted",
};

/** Where a person comes from: the care they had, what it left, and why, back through the people who raised them. */
export function Roots({ view, name, subject, names, onOpen }: { view: DevelopmentView; name: string; subject: string; names: Record<string, string>; onOpen: (agent: string) => void }) {
  const [open, setOpen] = useState<string>();
  const a = view.attachment;
  const was = [a.infancy && `${a.infancy} at eighteen months`, a.grown && `${a.grown} at seventeen`].filter(Boolean).join(", ");
  return (
    <div className="pane roots">
      <h3>Where {name} comes from</h3>
      <p className="roots-lede">
        <b>{a.text}.</b> {view.care.summary}
        {was ? <span className="small"> Was {was}.</span> : null}
      </p>

      <div className="roots-grid">
        <section>
          <h4>How {subject} attaches</h4>
          <Dim label="Fear of being left" value={a.anxiety} />
          <Dim label="Keeps a distance" value={a.avoidance} />
          <p className="small">Past the mark on either one counts as insecure.</p>
          {view.care.by.length > 0 && (
            <table className="roots-care">
              <thead>
                <tr><th>Raised by</th><th>Seasons</th><th>Warmth</th><th>Hard hand</th></tr>
              </thead>
              <tbody>
                {view.care.by.slice(0, 4).map((c) => (
                  <tr key={c.id}>
                    <td>{c.id in names ? <button className="linkish" onClick={() => onOpen(c.id)}>{c.name}</button> : c.name}{c.parent ? "" : " (not a parent)"}</td>
                    <td className="n">{c.seasons}</td>
                    <td className="n">{c.warmth.toFixed(2)}</td>
                    <td className="n">{c.control.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view.parenting && (
            <p className="small">As a parent {subject} has been {view.parenting.warmth >= 0.62 ? "warm" : view.parenting.warmth >= 0.45 ? "middling" : "cold"}{view.parenting.control >= 0.5 ? ", with a hard hand" : ""} (warmth {view.parenting.warmth.toFixed(2)}, hard hand {view.parenting.control.toFixed(2)}, over {view.parenting.seasons} seasons).</p>
          )}
        </section>

        <section>
          <h4>What {subject} met before seventeen</h4>
          {view.adversity.length === 0 ? (
            <p className="small">Nothing on record.</p>
          ) : (
            <ul className="roots-adv">
              {view.adversity.map((x, i) => (
                <li key={i} className={x.buffered ? "buffered" : "toxic"}>
                  <span className="kind">{ADVERSITY_NAMES[x.kind] ?? x.kind}</span>
                  <span>{x.text}</span>
                  <span className="small">{x.buffered ? "Someone warm was there." : "Nobody warm was there."}</span>
                </li>
              ))}
            </ul>
          )}
          {view.stages.length > 0 && (
            <>
              <h4>How each stage went</h4>
              <div className="roots-stages">
                {view.stages.map((s) => (
                  <div key={s.name} className="roots-stage" title={s.why}>
                    <span>{STAGE_NAMES[s.name] ?? s.name}</span>
                    <span className="t"><i style={{ width: `${Math.round(s.outcome * 100)}%` }} className={s.outcome >= 0.55 ? "good" : "poor"} /></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section>
          <h4>Who {subject} is</h4>
          <p className="roots-line"><b>{view.identity.text}.</b></p>
          {view.identity.commitments.length > 0 && <p className="small">Stands on: {view.identity.commitments.join(", ")}.</p>}
          <p className="small">{view.identity.story}</p>
          {view.identity.history.length > 1 && (
            <ul className="roots-history">
              {view.identity.history.slice(-4).map((h, i) => (
                <li key={i}><span className="mono">at {Math.round(h.age)}</span> {STATUS_NAMES[h.status] ?? h.status}: {h.why}</li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4>What {subject} holds to</h4>
          <div className="roots-morals">
            {FOUNDATIONS.map((f) => {
              const d = view.morals[f] - 0.5;
              const w = Math.min(50, Math.abs(d) * 100);
              return (
                <div key={f} className="roots-moral" title={FOUNDATION_TEXT[f][d >= 0 ? 0 : 1]}>
                  <span>{f[0]!.toUpperCase() + f.slice(1)}</span>
                  <span className="t"><i style={{ left: d >= 0 ? "50%" : `${50 - w}%`, width: `${w}%` }} className={d >= 0 ? "more" : "less"} /></span>
                  <span className="v">{view.morals[f].toFixed(2)}</span>
                </div>
              );
            })}
          </div>
          <p className="small">{view.conscience.length ? `${view.conscience.join(". ")}.` : "Close to the middle on all six: nothing stands out."}</p>
        </section>
      </div>

      {view.why.length > 0 && (
        <div className="roots-why">
          <h4>Why, and how far back it goes</h4>
          <div className="roots-tabs" role="tablist">
            {view.why.map((w) => (
              <button key={w.target} role="tab" aria-selected={open === w.target} className={open === w.target ? "on" : ""} onClick={() => setOpen(open === w.target ? undefined : w.target)}>
                {w.label}
              </button>
            ))}
          </div>
          {view.why.filter((w) => w.target === open).map((w) => (
            <ul key={w.target} className="roots-tree">
              {w.steps.map((s, i) => <Step key={i} step={s} names={names} onOpen={onOpen} />)}
            </ul>
          ))}
          {!open && <p className="small">Pick one to follow it back through the people who raised {name}.</p>}
        </div>
      )}
    </div>
  );
}

function Dim({ label, value }: { label: string; value: number }) {
  return (
    <div className="roots-dim">
      <span>{label}</span>
      <span className="t"><i style={{ width: `${Math.round(value * 100)}%` }} className={value >= 0.5 ? "over" : ""} /><em /></span>
      <span className="v">{value.toFixed(2)}</span>
    </div>
  );
}

const agesText = ([from, to]: [number, number]) => (Math.floor(from) === Math.floor(to) ? `at ${Math.floor(from)}` : `from ${Math.floor(from)} to ${Math.floor(to)}`);

const GENERATION = ["", "one generation back", "two generations back", "three generations back"];

function Step({ step, names, onOpen }: { step: RootStep; names: Record<string, string>; onOpen: (agent: string) => void }) {
  const here = step.agent in names;
  const back = [GENERATION[Math.min(3, step.generation)], here ? "" : "no longer here"].filter(Boolean).join(", ");
  return (
    <li className={`roots-step is-${step.kind}`}>
      <div>
        <span className="kind">{step.kind === "root" ? `${Math.round(step.share * 100)}%` : step.kind}</span>
        <span>{step.text}</span>
        {step.ages && <span className="small mono">{agesText(step.ages)}</span>}
        {step.kind !== "root" && back && <span className="small">{back}</span>}
        {step.kind !== "root" && here && <button className="linkish" onClick={() => onOpen(step.agent)}>open {step.name}</button>}
      </div>
      {step.causes.length > 0 && (
        <ul>
          {step.causes.map((c, i) => <Step key={i} step={c} names={names} onOpen={onOpen} />)}
        </ul>
      )}
    </li>
  );
}
