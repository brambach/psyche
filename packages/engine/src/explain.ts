// Explanation layer: names biases from trace patterns and writes the Story headline.
// Nothing here causes behaviour. It only describes what the mechanisms already did.

import type { BiasFlag, Trace } from "./trace.js";
import { nameOf, type OptionSpec } from "./decide.js";
import type { MindState } from "./types.js";

export function detectBiases(mind: MindState, t: Trace): BiasFlag[] {
  const out: BiasFlag[] = [];
  const p = t.percept;
  if (!p) return out;
  const actor = mind.others[p.actor];
  const wsMemories = t.workspace.filter((w) => w.kind === "memory").map((w) => mind.episodes.find((e) => e.id === w.ref)!);
  const wsBeliefs = t.workspace.filter((w) => w.kind === "belief").map((w) => mind.beliefs.find((b) => b.id === w.ref)!);

  if (actor) {
    const old = wsMemories.filter((e) => e.about.includes(actor.id) && e.valence < -0.2 && t.tick - e.tick > 60 * 48);
    if (old.length > 0 && actor.trust.benevolence < 0.4) {
      out.push({
        name: "Grudge",
        confidence: Math.min(0.95, 0.5 + (0.4 - actor.trust.benevolence) + 0.1 * old.length),
        explanation: `An old hurt involving ${actor.name} came to mind and low trust kept it charged.`,
        evidence: old.map((e) => e.id),
      });
    }
    const attitude = actor.liking - 0.5;
    const congruent = [...wsMemories.filter((e) => e.about.includes(actor.id)), ...wsBeliefs.filter((b) => b.about === actor.id)].filter(
      (x) => Math.sign(x.valence) === Math.sign(attitude) && Math.abs(attitude) > 0.05,
    );
    const missed = t.subliminal.filter((s) => {
      const ep = mind.episodes.find((e) => e.id === s.ref);
      return ep && ep.about.includes(actor.id) && Math.sign(ep.valence) !== Math.sign(attitude);
    });
    if (congruent.length >= 2 || (congruent.length >= 1 && missed.length >= 1)) {
      out.push({
        name: "Confirmation bias",
        confidence: Math.min(0.9, 0.4 + 0.15 * congruent.length + 0.15 * missed.length),
        explanation: `What surfaced about ${actor.name} fit what ${mind.pronouns.subject} already felt${missed.length ? ", while the counter-evidence stayed below awareness" : ""}.`,
        evidence: [...congruent.map((x) => x.id), ...missed.map((m) => m.ref)],
      });
    }
  }
  const blameAdj = t.appraisal?.adjustments.find((a) => a.name.startsWith("trust in"));
  if (blameAdj && blameAdj.value > 0.05) {
    out.push({
      name: "Hostile attribution",
      confidence: Math.min(0.9, 0.4 + blameAdj.value * 2),
      explanation: "Low trust made the act look more deliberate than the facts alone suggest.",
      evidence: blameAdj.ref ? [blameAdj.ref] : [],
    });
  }
  const moodRecall = t.retrieval.filter((r) => r.retrieved && Math.abs(r.components.mood) > 0.15 && t.workspace.some((w) => w.ref === r.id));
  if (moodRecall.length > 0) {
    out.push({
      name: "Mood-congruent recall",
      confidence: Math.min(0.85, 0.4 + Math.max(...moodRecall.map((r) => Math.abs(r.components.mood)))),
      explanation: `${mind.pronouns.possessive[0]!.toUpperCase() + mind.pronouns.possessive.slice(1)} mood made matching memories easier to reach.`,
      evidence: moodRecall.map((r) => r.id),
    });
  }
  const misinfo = t.reconsolidations.flatMap((r) => r.version.changes.filter((c) => c.cause === "misinformation").map((c) => ({ r, c })));
  if (misinfo.length > 0) {
    out.push({
      name: "Source confusion",
      confidence: 0.9,
      explanation: `Something ${mind.pronouns.subject} was told has merged into ${mind.pronouns.possessive} own memory of the event.`,
      evidence: misinfo.map((m) => m.r.episodeId),
    });
  }
  const d = t.decision;
  if (d) {
    const ranked = [...d.options].sort((a, b) => b.utility - a.utility);
    const grant = d.options.find((o) => o.id === "grant");
    if (grant && d.choice !== "grant") {
      const cost = grant.terms.find((x) => x.name.startsWith("cuts against goal"));
      const g = cost?.ref ? mind.goals.find((x) => x.id === cost.ref) : undefined;
      if (cost && g && g.invested > 0.5 && grant.utility - cost.value > ranked[0]!.utility) {
        out.push({
          name: "Sunk cost",
          confidence: 0.7,
          explanation: `Past effort sunk into "${g.text}" tipped the decision.`,
          evidence: [g.id],
        });
      }
    }
    if (d.system === 1 && d.s2.capacity < 0.6 && d.s2.conflict > 0.5) {
      out.push({
        name: "Autopilot under strain",
        confidence: 0.75,
        explanation: `The choice was close, but stress and fatigue left too little capacity to think it through.`,
        evidence: ["feeling:stress"],
      });
    }
  }
  return out;
}

function describeRef(mind: MindState, ref: string): string | undefined {
  const s = mind.pronouns.subject;
  if (ref.startsWith("feeling:")) return `${s} was feeling ${ref.slice(8)}`;
  if (ref.startsWith("other:")) {
    const o = mind.others[ref.slice(6)];
    return o ? `${s} ${o.trust.benevolence < 0.5 ? "doesn't fully trust" : "trusts"} ${o.name}` : undefined;
  }
  const ep = mind.episodes.find((e) => e.id === ref);
  if (ep) return `it brought back "${ep.gist.replace(/\.$/, "")}"`;
  const b = mind.beliefs.find((x) => x.id === ref);
  if (b) {
    const from = b.source.kind === "told" && b.source.from ? `, something ${nameOf(mind, b.source.from)} told ${mind.pronouns.object}` : "";
    return `${s} believed "${b.proposition}"${from}`;
  }
  const g = mind.goals.find((x) => x.id === ref);
  if (g) return `it cut against ${mind.pronouns.possessive} goal to ${g.text.charAt(0).toLowerCase() + g.text.slice(1)}`;
  return undefined;
}

export function headline(mind: MindState, t: Trace, option?: OptionSpec): { question: string; answer: string } {
  const name = mind.name;
  if (!t.percept || !option || !t.decision) return { question: `What was ${name} thinking?`, answer: t.notes.join(" ") };
  const question = `Why did ${name} ${option.verb}?`;
  const reasons = t.decision.because
    .slice(0, 3)
    .map((b) => describeRef(mind, b.ref))
    .filter((x): x is string => !!x);
  let answer = reasons.length
    ? `${cap(joinList(reasons))}.`
    : `Nothing in particular pulled hard; ${mind.pronouns.subject} went with ${mind.pronouns.possessive} temperament.`;
  const actor = mind.others[t.percept.actor];
  // The most telling absence: a charged memory about the same person, pointing the other way, that lost the competition.
  const inMind = t.workspace.flatMap((w) => mind.episodes.filter((e) => e.id === w.ref));
  const lean = inMind.reduce((s, e) => s + e.valence, 0) + (actor ? actor.liking - 0.5 : 0);
  const missed = t.subliminal
    .map((s) => mind.episodes.find((e) => e.id === s.ref))
    .find((e) => e && Math.abs(e.valence) >= 0.3 && Math.sign(e.valence) !== Math.sign(lean) && (!actor || e.about.includes(actor.id)));
  if (missed) answer += ` ${cap(mind.pronouns.subject)} didn't think of "${missed.gist.replace(/\.$/, "")}".`;
  if (t.decision.system === 1 && t.decision.s2.capacity < 0.6) answer += ` ${cap(mind.pronouns.subject)} was too strained to think it through.`;
  if (t.reconsolidations.some((r) => r.version.changes.length > 0)) answer += ` Recalling it changed the memory.`;
  return { question, answer };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}
