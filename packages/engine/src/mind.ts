// One cognitive cycle (after the LIDA cycle, Franklin et al. 2014):
// perceive, appraise, cue recall, compete for the workspace, decide, act, learn.

import { applyAppraisal, appraise, passTime, updateTrust } from "./affect.js";
import { decide, nameOf, styleFor } from "./decide.js";
import { detectBiases, headline } from "./explain.js";
import { clamp, reconsolidate, render, retrieve, use } from "./memory.js";
import { PARAMS } from "./params.js";
import type { Faculties, Percept, PerceiveResponse, StableIdentity } from "./ports.js";
import { nextId } from "./rng.js";
import { sleep } from "./sleep.js";
import type { Contribution, ReconsolidationTrace, Trace } from "./trace.js";
import type { Episode, MindState, Tick } from "./types.js";
import { compete } from "./workspace.js";

export function identityOf(mind: MindState): StableIdentity {
  return { id: mind.id, name: mind.name, summary: mind.identity.summary, voice: mind.identity.voice };
}

export const hourOf = (t: Tick) => (((t % 1440) + 1440) % 1440) / 60;
export const dayOf = (t: Tick) => Math.floor(t / 1440) + 1;

/** Turn raw text into a percept with the Perceive faculty, primed by what the words call to mind. */
export async function perceiveText(
  mind: MindState,
  speaker: string,
  text: string,
  faculties: Faculties,
): Promise<Percept> {
  const lower = text.toLowerCase();
  const about = Object.values(mind.others)
    .filter((o) => lower.includes(o.name.toLowerCase()))
    .map((o) => o.id);
  const allTopics = new Set([...mind.episodes.flatMap((e) => e.topics), ...mind.beliefs.flatMap((b) => b.topics)]);
  const topics = [...allTopics].filter((t) => new RegExp(`\\b${t}`, "i").test(text));
  const primed = retrieve({ ...mind, rng: mind.rng }, { about, topics }, mind.tick)
    .filter((r) => r.kind === "episode")
    .slice(0, 3)
    .map((r) => mind.episodes.find((e) => e.id === r.id)!)
    .filter((e) => e.details.length > 0);
  const res: PerceiveResponse = await faculties.perceive({
    perceiver: { id: mind.id, name: mind.name },
    knownEntities: Object.values(mind.others).map((o) => ({ id: o.id, name: o.name })),
    knownTopics: [...allTopics].sort(),
    speaker,
    text,
    candidateSlots: primed.map((e) => ({ episodeId: e.id, gist: e.gist, slotKeys: e.details.map((d) => d.key) })),
  });
  return { ...res, id: nextId(mind, "pc"), tick: mind.tick, rawText: text, actor: speaker };
}

/** A reply matters when it answers you, tells a memory, comes out of deliberation, or the moment is big. */
export function speechSalience(p: Percept, relevance: number, shared: number, system: 1 | 2): number {
  if (p.actor === "visitor") return 1;
  return clamp(Math.max(relevance * 0.8, shared > 0 ? 0.6 : 0, system === 2 ? 0.6 : 0, p.features.intensity >= 0.6 ? 0.6 : 0));
}

function settleExpressions(mind: MindState): void {
  for (const x of mind.expressions) if (x.outcome === undefined) x.outcome = mind.affect.valence - x.baseline;
}

/** Gossip and claims become beliefs tagged with their source. Credibility and attitude set confidence. */
function absorbClaims(mind: MindState, p: Percept, episodeId: string): Contribution[] {
  const out: Contribution[] = [];
  const teller = mind.others[p.actor];
  for (const c of p.claims) {
    const credibility = teller ? teller.trust.integrity : 0.5;
    const known = c.rumor ? mind.beliefs.find((b) => b.rumor === c.rumor) : undefined;
    if (known) {
      // A story heard again, from someone new, feels truer (illusory truth; Hasher, Goldstein & Toppino 1977).
      if (known.source.from !== p.actor && mind.ablations.illusoryTruth) {
        const gain = PARAMS.social.illusoryTruth * credibility * (1 - known.confidence);
        known.confidence = clamp(known.confidence + gain);
        out.push({ name: `heard again: ${known.proposition}`, value: gain, ref: known.id });
      }
      use(known.retrievals, p.tick);
      known.evidence.push(episodeId);
      if (known.evidence.length > 8) known.evidence.splice(0, known.evidence.length - 8);
      continue;
    }
    let confidence = credibility * 0.9;
    const subject = mind.others[c.about];
    if (subject && mind.ablations.motivatedUpdating) {
      const attitude = subject.liking - 0.5 + (subject.trust.benevolence - 0.5);
      // Claims that fit the existing attitude are believed more readily (Kunda 1990).
      const shift = PARAMS.social.motivatedUpdating * attitude * Math.sign(c.valence);
      confidence = clamp(confidence + shift);
      if (Math.abs(shift) > 0.01) out.push({ name: `fits how ${mind.name} feels about ${subject.name}`, value: shift });
    }
    const id = nextId(mind, "bel");
    mind.beliefs.push({
      id,
      about: c.about,
      topics: c.topics,
      proposition: c.proposition,
      confidence,
      valence: c.valence,
      source: { kind: "told", from: p.actor },
      formed: p.tick,
      evidence: [episodeId],
      retrievals: [p.tick],
      claim: c.slotKey && c.value ? { slotKey: c.slotKey, value: c.value, episodeHint: c.episodeHint } : undefined,
      rumor: c.rumor,
    });
    if (subject) subject.liking = clamp(subject.liking + c.valence * confidence * 0.12);
    out.push({ name: `new belief: ${c.proposition}`, value: confidence, ref: id });
  }
  return out;
}

export async function runPercept(mind: MindState, p: Percept, faculties: Faculties): Promise<Trace> {
  const llmCalls: string[] = [];
  const notes: string[] = [];
  settleExpressions(mind);

  const appraisal = appraise(mind, p);
  applyAppraisal(mind, appraisal);
  const trustChanges = updateTrust(mind, p);
  // The episode for this moment is encoded at the end of the cycle; claims heard now rest on it.
  const episodeId = p.eventId && !mind.episodes.some((e) => e.id === p.eventId) ? p.eventId : nextId(mind, "ep");
  const claimChanges = absorbClaims(mind, p, episodeId);
  for (const c of [...trustChanges, ...claimChanges]) notes.push(`${c.name} (${c.value > 0 ? "+" : ""}${c.value.toFixed(2)})`);

  const cues = {
    about: [...p.about, ...(mind.others[p.actor] ? [p.actor] : []), ...(p.asksRecall?.about ?? [])],
    topics: [...p.topics, ...(p.request?.topics ?? []), ...(p.asksRecall?.topics ?? [])],
  };
  const retrieval = retrieve(mind, cues, p.tick);
  const { winners, subliminal } = compete(mind, p, retrieval);

  const reconsolidations: ReconsolidationTrace[] = [];
  const recalledInFull = new Set<string>();
  /** Recall a memory. In full (told, or laid out for deliberation) it re-retrieves every detail. */
  const recall = async (ref: string, detail: boolean) => {
    if (detail && recalledInFull.has(ref)) return;
    if (detail) recalledInFull.add(ref);
    const ep = mind.episodes.find((e) => e.id === ref)!;
    const r = await reconsolidate(mind, ep, p.tick, faculties, detail);
    if (r) {
      const prev = reconsolidations.findIndex((x) => x.episodeId === ref);
      if (prev >= 0) {
        const merged = { ...r, before: reconsolidations[prev]!.before };
        merged.version = { ...r.version, valenceFrom: reconsolidations[prev]!.version.valenceFrom, changes: [...reconsolidations[prev]!.version.changes, ...r.version.changes] };
        reconsolidations[prev] = merged;
      } else reconsolidations.push(r);
      if (r.version.changes.some((c) => c.cause === "reconstruction")) llmCalls.push("reconstruct");
    }
    const w = winners.find((x) => x.ref === ref);
    if (w) w.text = render(ep);
  };
  for (const w of winners) {
    if (w.kind === "belief") use(mind.beliefs.find((b) => b.id === w.ref)!.retrievals, p.tick);
    if (w.kind === "memory") await recall(w.ref, false);
  }

  const trace: Trace = {
    id: nextId(mind, "tr"),
    tick: p.tick,
    kind: "perceive",
    percept: p,
    appraisal,
    // Everything retrieved, and the strongest of what was not: a long life has hundreds of candidates.
    retrieval: [...retrieval.filter((r) => r.retrieved), ...retrieval.filter((r) => !r.retrieved).sort((x, y) => y.activation - x.activation).slice(0, 12)],
    workspace: winners,
    subliminal,
    reconsolidations,
    biases: [],
    llmCalls,
    headline: { question: "", answer: "" },
    notes,
    encoded: episodeId,
    changes: [...trustChanges, ...claimChanges],
  };

  const concernsSelf = p.addressedToSelf || Math.abs(p.features.outcomeForSelf) > 0.05;
  let optionSpec;
  if (concernsSelf) {
    const novelty = retrieval.some((r) => r.retrieved && r.kind === "episode") ? 0.4 : 1;
    const stakes = appraisal.relevance * p.features.intensity;
    const identity = identityOf(mind);
    const beforeDeliberate = async () => {
      for (const w of winners) if (w.kind === "memory") await recall(w.ref, true);
    };
    const { decision, option, expressed, stance } = await decide(mind, p, winners, identity, faculties, novelty, stakes, beforeDeliberate);
    if (decision.system === 2) llmCalls.push("deliberate");
    trace.decision = decision;
    optionSpec = option;

    if (p.kind === "speech" && p.addressedToSelf) {
      // What to share: the memories in mind that answer the question, recalled in full if told in full.
      // Unprompted, a memory is only shared if it bears on what was just said, and not one about the
      // person you are talking to.
      const asked = !!p.asksRecall;
      const recallTopics = asked
        ? new Set([...p.asksRecall!.topics, ...p.asksRecall!.about])
        : new Set([...p.topics, ...p.about.filter((a) => a !== p.actor)]);
      const overlap = (ep: Episode) => [...ep.topics, ...ep.about].filter((t) => recallTopics.has(t)).length;
      const candidates = winners
        .filter((w) => w.kind === "memory")
        .map((w) => mind.episodes.find((e) => e.id === w.ref)!)
        .filter((ep) => ep.id !== episodeId && !p.alreadySaid?.includes(ep.id) && (asked ? recallTopics.size === 0 || overlap(ep) > 0 : ep.details.length > 0 && overlap(ep) > 0 && !ep.about.includes(p.actor)))
        .filter((ep) => !asked || ep.details.length > 0 || ep.tick > mind.lastSleep - 1440 * 3);
      const best = Math.max(0, ...candidates.map(overlap));
      const answering = option.disclosure > 0.3 ? candidates.filter((ep) => overlap(ep) === best).slice(0, 1) : [];
      const content: { id: string; text: string }[] = [];
      for (const ep of answering) {
        if (option.id !== "tell_briefly") await recall(ep.id, true);
        content.push({ id: ep.id, text: option.id === "tell_briefly" ? ep.gist : render(ep) });
      }
      const res = await faculties.speak({
        self: identity,
        listener: { id: p.actor, name: nameOf(mind, p.actor) },
        heard: p.rawText,
        intent: { option: option.label, description: option.description },
        content,
        style: styleFor(mind, p, expressed, option),
        stance,
        salience: speechSalience(p, appraisal.relevance, content.length, decision.system),
      });
      llmCalls.push("speak");
      trace.action = { kind: "speech", text: res.utterance, option: option.id, content: content.map((c) => c.id) };
      mind.needs.relatedness = clamp(mind.needs.relatedness + 0.04 * option.prosocial);
    } else {
      trace.action = { kind: "act", text: `${mind.name} ${option.act ?? option.description.toLowerCase()}`, option: option.id };
    }

    mind.expressions.push({ tick: p.tick, expressed, baseline: mind.affect.valence });
    if (option.coping) {
      const habit = mind.habits.find((h) => p.topics.includes(h.cue) && h.action === option.coping);
      if (habit) habit.strength = clamp(habit.strength + 0.05 * (1 - habit.strength));
      else if (decision.system === 1 && p.topics[0]) {
        mind.habits.push({ id: nextId(mind, "hab"), cue: p.topics[0], action: option.coping, strength: 0.1 });
      }
      if (option.coping === "problem") {
        for (const g of mind.goals.filter((g) => g.tags.some((t) => p.topics.includes(t)))) {
          g.invested = clamp(g.invested + 0.05);
          g.progress = clamp(g.progress + 0.05);
          g.rate = g.rate * 0.7 + 0.05 * 0.3;
        }
      }
    }
  } else {
    trace.action = { kind: "none", text: "" };
  }

  // Encode what happened as a new episode.
  mind.episodes.push({
    id: episodeId,
    tick: p.tick,
    gist: p.gist,
    template: p.template ?? "",
    about: [...new Set([...p.about, ...(mind.others[p.actor] ? [p.actor] : [])])],
    topics: p.topics,
    valence: appraisal.desirability !== 0 ? appraisal.desirability : p.features.outcomeForSelf * 0.3,
    valenceAtEncoding: appraisal.desirability,
    arousal: mind.affect.arousal,
    source: { kind: "witnessed" },
    details: p.details.map((d) => ({
      key: d.key,
      value: d.value,
      original: d.value,
      source: { kind: "witnessed" },
      salience: d.salience ?? 0,
      rehearsals: [p.tick],
    })),
    retrievals: [p.tick],
    versions: [],
    replays: 0,
    coping: appraisal.coping,
    agency: p.features.agency,
  });

  trace.biases = detectBiases(mind, trace);
  trace.headline = headline(mind, trace, optionSpec);
  return trace;
}

/** Let time pass. Crossing night means sleeping (23:00 to 07:00), and waking runs consolidation. */
export async function wait(mind: MindState, minutes: number, faculties: Faculties): Promise<Trace[]> {
  const traces: Trace[] = [];
  const end = mind.tick + minutes;
  while (mind.tick < end) {
    const h = hourOf(mind.tick);
    const asleep = h >= 23 || h < 7;
    const nextBoundary = asleep
      ? mind.tick + ((7 - h + 24) % 24) * 60
      : mind.tick + (23 - h) * 60;
    const step = Math.max(1, Math.min(end, Math.round(nextBoundary)) - mind.tick);
    passTime(mind, step, !asleep);
    if (!asleep) mind.needs.energy = clamp(mind.needs.energy - (step / 60) * 0.04);
    const wasAsleep = asleep;
    mind.tick += step;
    const nowAsleep = hourOf(mind.tick) >= 23 || hourOf(mind.tick) < 7;
    if (wasAsleep && !nowAsleep) traces.push(await sleep(mind, mind.tick, faculties));
  }
  return traces;
}
