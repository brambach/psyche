// Decisions. The engine generates the options (including unkind ones) and scores them from state.
// System 1 takes the best-scoring option; System 2 (an LLM deliberation over the workspace)
// engages on conflict, novelty or stakes, scaled by remaining capacity (Evans & Stanovich 2013).

import { clamp } from "./memory.js";
import { PARAMS } from "./params.js";
import type { ActionOption, Faculties, Percept, StableIdentity, StyleVector } from "./ports.js";
import { gaussian, nextRandom } from "./rng.js";
import type { Contribution, DecisionTrace, OptionTrace, WorkspaceEntry } from "./trace.js";
import { TRAIT_NAMES, type MindState, type Traits } from "./types.js";

const D = PARAMS.decision;

export type OptionSpec = ActionOption;

export function nameOf(mind: MindState, id: string): string {
  if (id === "world") return "the world";
  return mind.others[id]?.name ?? id;
}

export function generateOptions(mind: MindState, p: Percept): OptionSpec[] {
  if (p.options?.length) return p.options;
  const who = nameOf(mind, p.actor);
  if (p.kind === "speech" && p.addressedToSelf && p.request) {
    const what = p.request.what;
    return [
      { id: "grant", label: "Agree", verb: `agree to ${who}'s request`, description: `Say yes and ${what}.`, prosocial: 0.9, assertive: 0, avoidant: 0, disclosure: 0.1, comply: true },
      { id: "refuse_flat", label: "Refuse flatly", verb: `refuse ${who}'s request`, description: "Say no, without explaining.", prosocial: -0.7, assertive: 0.8, avoidant: 0.1, disclosure: 0 },
      { id: "refuse_explain", label: "Refuse and explain", verb: `turn ${who} down gently`, description: "Say no, and give a reason.", prosocial: -0.1, assertive: 0.4, avoidant: 0, disclosure: 0.4 },
      { id: "put_off", label: "Put it off", verb: `put ${who} off`, description: "Avoid answering for now.", prosocial: -0.2, assertive: 0, avoidant: 0.8, disclosure: 0 },
    ];
  }
  if (p.kind === "speech" && p.addressedToSelf && p.asksRecall) {
    return [
      { id: "tell_fully", label: "Tell the whole story", verb: `tell ${who} what happened`, description: "Share the memory in full.", prosocial: 0.5, assertive: 0.1, avoidant: 0, disclosure: 0.9 },
      { id: "tell_briefly", label: "Give the short version", verb: `give ${who} the short version`, description: "Share the gist and move on.", prosocial: 0.2, assertive: 0.1, avoidant: 0.2, disclosure: 0.4 },
      { id: "deflect", label: "Deflect", verb: `dodge ${who}'s question`, description: "Change the subject.", prosocial: -0.5, assertive: 0.2, avoidant: 0.8, disclosure: -0.3 },
    ];
  }
  if (p.kind === "speech" && p.addressedToSelf) {
    return [
      { id: "warm", label: "Reply warmly", verb: `open up to ${who}`, description: "Be friendly and engaged.", prosocial: 0.7, assertive: 0, avoidant: 0, disclosure: 0.5 },
      { id: "polite", label: "Reply politely", verb: `keep ${who} at arm's length`, description: "Polite, brief, guarded.", prosocial: 0.2, assertive: 0.1, avoidant: 0.4, disclosure: 0.1 },
      { id: "cold", label: "Brush off", verb: `brush ${who} off`, description: "Curt, closes the conversation.", prosocial: -0.6, assertive: 0.6, avoidant: 0.5, disclosure: -0.2 },
    ];
  }
  if (p.features.outcomeForSelf >= 0) {
    return [
      { id: "savor", label: "Savor it", verb: "take a moment to enjoy it", description: "Pause and enjoy it.", prosocial: 0.1, assertive: 0, avoidant: 0, disclosure: 0.2, coping: "emotion", act: "takes a moment to enjoy it" },
      { id: "share", label: "Tell someone", verb: "go and tell someone", description: "Find someone to share it with.", prosocial: 0.5, assertive: 0, avoidant: 0, disclosure: 0.7, coping: "social", act: "goes to find someone to tell" },
      { id: "carry_on", label: "Carry on", verb: "carry on as usual", description: "Get back to the day's work.", prosocial: 0, assertive: 0, avoidant: 0.2, disclosure: 0, coping: "problem", act: "gets on with the day" },
    ];
  }
  return [
    { id: "tackle", label: "Tackle it", verb: "get straight to work on the problem", description: "Problem-focused coping: start fixing it.", prosocial: 0, assertive: 0.4, avoidant: 0, disclosure: 0, coping: "problem", act: "gets to work on it" },
    { id: "calm", label: "Calm down first", verb: "walk it off", description: "Emotion-focused coping: walk the cliff path.", prosocial: 0, assertive: 0, avoidant: 0.3, disclosure: 0, coping: "emotion", act: "walks the cliff path to cool off" },
    { id: "withdraw", label: "Withdraw", verb: `shut ${mind.pronouns.reflexive} away`, description: "Avoidant coping: stay in, go to bed early.", prosocial: -0.2, assertive: 0, avoidant: 0.9, disclosure: -0.3, coping: "avoid", act: "stays in and goes to bed early" },
    { id: "seek", label: "Seek company", verb: "go looking for company", description: "Social coping: find someone to talk to.", prosocial: 0.4, assertive: 0, avoidant: 0, disclosure: 0.7, coping: "social", act: "goes to the tavern to find company" },
  ];
}

/** Whole Trait Theory (Fleeson 2001): each moment expresses a draw around the trait mean, pushed by the situation. */
export function expressTraits(mind: MindState): Traits {
  const af = mind.affect;
  const out = { ...mind.traits };
  for (const t of TRAIT_NAMES) out[t] = mind.traits[t] + gaussian(mind) * mind.traitSpread;
  out.agreeableness -= 0.3 * af.emotions.anger;
  out.extraversion -= 0.15 * af.stress;
  out.neuroticism += 0.2 * af.stress;
  for (const t of TRAIT_NAMES) out[t] = clamp(out[t]);
  return out;
}

function inWorkspace(ws: WorkspaceEntry[], ref: string): WorkspaceEntry | undefined {
  return ws.find((w) => w.ref === ref);
}

export function scoreOption(mind: MindState, p: Percept, opt: OptionSpec, ws: WorkspaceEntry[], x: Traits): OptionTrace {
  const af = mind.affect;
  const terms: Contribution[] = [];
  const add = (name: string, value: number, ref?: string) => {
    if (Math.abs(value) > 1e-4) terms.push({ name, value, ref });
  };
  const other = mind.others[p.actor];
  const P = opt.prosocial;

  add("agreeableness today", P * (x.agreeableness - 0.5));
  add("extraversion today", (x.extraversion - 0.5) * (opt.disclosure * 0.5 - opt.avoidant * 0.4));
  // Everyday courtesy is a norm most people follow by default (Bicchieri 2006); anger erodes it.
  if (p.addressedToSelf) add("courtesy norm", 0.35 * P * (1 - af.emotions.anger) * (0.5 + 0.5 * x.conscientiousness));
  add("mood", P * af.mood.valence * 0.4);
  add("stress", af.stress * (opt.avoidant * 0.4 - opt.disclosure * 0.2));
  add("attachment avoidance", mind.attachment.avoidance * (opt.avoidant * 0.25 - opt.disclosure * 0.2));
  if (other) add(`trust in ${other.name}`, P * (other.trust.benevolence - 0.5) * 1.2, `other:${other.id}`);

  // Core beliefs work out of sight (Beck): a triggered one tilts how much it seems wise to give.
  for (const sc of mind.schemas) {
    if (sc.triggers.some((t) => p.topics.includes(t))) add(`core belief: ${sc.text}`, -P * (sc.blameBias + sc.threatBias) * sc.strength * 0.8, sc.id);
  }
  // Feelings and memories only count if they made it into awareness.
  const anger = inWorkspace(ws, "feeling:anger");
  if (anger) add("anger", af.emotions.anger * (opt.assertive * 0.7 - P * 0.8), anger.ref);
  const distress = inWorkspace(ws, "feeling:distress");
  if (distress) add("distress", af.emotions.distress * (opt.avoidant * 0.4 + (opt.coping === "social" ? 0.3 : 0)), distress.ref);

  const totalScore = ws.reduce((s, w) => s + w.score, 0) || 1;
  const recallCues = new Set([...(p.asksRecall?.about ?? []), ...(p.asksRecall?.topics ?? [])]);
  const shareable = ws.find((w) => {
    if (w.kind !== "memory" || !p.asksRecall) return false;
    const ep = mind.episodes.find((e) => e.id === w.ref)!;
    return ep.details.length > 0 && [...ep.about, ...ep.topics].some((k) => recallCues.has(k));
  });
  if (shareable && opt.disclosure > 0) add("has a story to tell", opt.disclosure * 0.35, shareable.ref);
  for (const w of ws) {
    if (w.kind === "memory") {
      const ep = mind.episodes.find((e) => e.id === w.ref)!;
      if (other && ep.about.includes(other.id)) add(`memory: ${ep.gist}`, P * ep.valence * 1.6 * (w.score / totalScore) * 2, ep.id);
    } else if (w.kind === "belief") {
      const b = mind.beliefs.find((e) => e.id === w.ref)!;
      if (other && b.about === other.id) add(`belief: ${b.proposition}`, P * b.valence * b.confidence * 1.4 * (w.score / totalScore) * 2, b.id);
    } else if (w.kind === "need" && w.ref === "need:relatedness") {
      add("need for connection", (1 - mind.needs.relatedness) * (0.3 * P + 0.25 * opt.disclosure), w.ref);
    } else if (w.kind === "goal") {
      const g = mind.goals.find((e) => e.id === w.ref)!;
      const reqTopics = p.request?.topics ?? [];
      if (opt.comply && g.tags.some((t) => reqTopics.includes(t))) {
        add(`cuts against goal: ${g.text}`, -(g.priority * 0.5 + g.invested * 0.5) * 0.5, g.id);
      }
      if (opt.coping === "problem" && g.tags.some((t) => p.topics.includes(t))) add(`serves goal: ${g.text}`, g.priority * 0.4, g.id);
    }
  }
  for (const h of mind.habits) {
    if (opt.coping && p.topics.includes(h.cue) && h.action === opt.coping) add(`habit: ${h.cue}`, h.strength * 0.4, h.id);
  }
  add("noise", gaussian(mind) * D.noise);
  return { id: opt.id, label: opt.label, description: opt.description, utility: terms.reduce((s, t) => s + t.value, 0), terms };
}

export function stanceFor(mind: MindState, p: Percept, x: Traits): string[] {
  const af = mind.affect;
  const other = mind.others[p.actor];
  const out: string[] = [];
  if (af.emotions.anger > 0.35) out.push(`You are angry${other ? ` and it is aimed at ${other.name}` : ""}. You may be curt, refuse, or bring up old grievances.`);
  if (other && other.trust.benevolence < 0.35) out.push(`You do not trust ${other.name}'s intentions.`);
  if (other && other.liking > 0.7) out.push(`You feel warmly toward ${other.name}.`);
  if (af.stress > 0.5) out.push("You are under strain and short on patience.");
  if (af.mood.valence < -0.25) out.push("Your mood is low; things look worse than usual.");
  if (af.mood.valence > 0.35) out.push("You are in good spirits.");
  out.push(`Agreeableness right now is ${x.agreeableness.toFixed(2)} on a 0 to 1 scale. Do not be kinder or more accommodating than that warrants.`);
  return out;
}

export function styleFor(mind: MindState, p: Percept, x: Traits, opt: OptionSpec): StyleVector {
  const af = mind.affect;
  const liking = mind.others[p.actor]?.liking ?? 0.5;
  return {
    warmth: clamp(0.5 * x.agreeableness + 0.3 * af.mood.valence + 0.3 * (liking - 0.5) - 0.4 * af.emotions.anger + 0.2 * opt.prosocial),
    curtness: clamp(af.emotions.anger * 0.7 + af.stress * 0.3 + (1 - x.agreeableness) * 0.2 + opt.assertive * 0.2),
    hedging: clamp(x.neuroticism * 0.5 * (1 - af.emotions.anger)),
    verbosity: clamp(x.extraversion * 0.6 + opt.disclosure * 0.4),
  };
}

export async function decide(
  mind: MindState,
  p: Percept,
  ws: WorkspaceEntry[],
  identity: StableIdentity,
  faculties: Faculties,
  novelty: number,
  stakes: number,
  beforeDeliberate: () => Promise<void> = async () => {},
): Promise<{ decision: DecisionTrace; option: OptionSpec; expressed: Traits; stance: string[] }> {
  const specs = generateOptions(mind, p);
  const x = expressTraits(mind);
  const scored = specs.map((o) => scoreOption(mind, p, o, ws, x));
  const ranked = [...scored].sort((a, b) => b.utility - a.utility);
  const best = ranked[0]!;
  const runnerUp = ranked[1] ?? best;

  const af = mind.affect;
  const capacity = clamp(1 - D.stressCost * af.stress - D.fatigueCost * af.fatigue - D.allostaticCost * af.allostaticLoad);
  const conflict = clamp(1 - (best.utility - runnerUp.utility) / 0.5);
  const drive = 0.45 * conflict + 0.25 * novelty + 0.5 * stakes;
  let probability = capacity / (1 + Math.exp(-(D.s2Gain * drive + D.s2Bias)));
  if (mind.ablations.systemTwo === "always") probability = 1;
  if (mind.ablations.systemTwo === "never") probability = 0;
  const useS2 = nextRandom(mind) < probability;
  const stance = stanceFor(mind, p, x);

  let choice = best.id;
  let because: { ref: string; weight: number }[] = [];
  let monologue: string | undefined;

  if (useS2) {
    await beforeDeliberate();
    const res = await faculties.deliberate({
      self: identity,
      situation: p.rawText,
      workspace: ws.map((w) => ({ id: w.ref, kind: w.kind, label: w.label, text: w.text, weight: Number(w.score.toFixed(2)) })),
      options: specs.map((o) => ({ id: o.id, label: o.label, description: o.description, impulse: Number(scored.find((x) => x.id === o.id)!.utility.toFixed(2)) })),
      stance,
    });
    if (specs.some((o) => o.id === res.choice)) choice = res.choice;
    const valid = new Set(ws.map((w) => w.ref));
    because = res.because.filter((b) => valid.has(b.item)).map((b) => ({ ref: b.item, weight: b.weight }));
    monologue = res.monologue;
  }
  if (because.length === 0) {
    // System 1: causes are the terms that most separated the chosen option from the next best.
    const chosen = scored.find((o) => o.id === choice)!;
    const rival = ranked.find((o) => o.id !== choice) ?? chosen;
    const diffs = new Map<string, number>();
    for (const t of chosen.terms) if (t.ref) diffs.set(t.ref, (diffs.get(t.ref) ?? 0) + t.value);
    for (const t of rival.terms) if (t.ref) diffs.set(t.ref, (diffs.get(t.ref) ?? 0) - t.value);
    const pos = [...diffs.entries()].filter(([, v]) => v > 0);
    const sum = pos.reduce((s, [, v]) => s + v, 0) || 1;
    because = pos.map(([ref, v]) => ({ ref, weight: v / sum })).sort((a, b) => b.weight - a.weight);
  }
  const option = specs.find((o) => o.id === choice)!;
  return {
    decision: {
      system: useS2 ? 2 : 1,
      s2: { probability, conflict, novelty, stakes, capacity },
      options: scored,
      choice,
      because,
      monologue,
    },
    option,
    expressed: x,
    stance,
  };
}
