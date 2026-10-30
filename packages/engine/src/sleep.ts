// Sleep: prioritized replay (Mattar & Daw 2018), consolidation of episodes into beliefs
// (McClelland, McNaughton & O'Reilly 1995), emotional tempering (Walker & van der Helm 2009),
// stress recovery, and nightly trait drift (TESSERA, Wrzus & Roberts 2017).

import { baseLevel, clamp, render, touchEpisode, use } from "./memory.js";
import { PARAMS } from "./params.js";
import type { Faculties } from "./ports.js";
import { nextId } from "./rng.js";
import type { Trace } from "./trace.js";
import { EMOTION_NAMES, TRAIT_NAMES, type MindState, type Tick } from "./types.js";

const S = PARAMS.sleep;

export async function sleep(mind: MindState, now: Tick, faculties: Faculties): Promise<Trace> {
  const notes: string[] = [];
  const llmCalls: string[] = [];
  const recent = (t: Tick) => t > mind.lastSleep;

  const goalTags = new Set(mind.goals.flatMap((g) => g.tags));
  const ranked = mind.episodes
    .map((e) => ({
      e,
      priority: Math.abs(e.valence) * e.arousal + (recent(e.tick) ? 0.2 : 0) + (e.topics.some((t) => goalTags.has(t)) ? 0.2 : 0),
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, S.replayCount)
    .map((x) => x.e);

  if (mind.ablations.sleepConsolidation) {
    for (const e of ranked) {
      e.replays += 1;
      touchEpisode(mind, e, now);
      e.arousal *= 1 - S.emotionalTempering;
    }
    notes.push(`Replayed ${ranked.length} memories: ${ranked.map((e) => `"${e.gist}"`).join(", ")}.`);

    const dream = await faculties.dream({
      self: { name: mind.name, ...mind.identity },
      replay: ranked.map((e) => ({ id: e.id, text: render(e), valence: Number(e.valence.toFixed(2)), about: e.about })),
      beliefs: mind.beliefs.map((b) => ({ id: b.id, text: b.proposition, about: b.about })),
      lifeStory: mind.self.lifeStory,
    });
    llmCalls.push("dream");
    for (const g of dream.generalizations) {
      // The engine, not the model, decides whether the evidence supports a generalization.
      const evidence = g.evidence
        .map((id) => mind.episodes.find((e) => e.id === id))
        .filter((e) => e && e.about[0] === g.about && Math.sign(e.valence) === Math.sign(g.valence));
      if (evidence.length < S.generalizeAt) continue;
      const existing = mind.beliefs.find((b) => b.about === g.about && b.source.kind === "inferred" && Math.sign(b.valence) === Math.sign(g.valence));
      if (existing) {
        existing.confidence = clamp(existing.confidence + 0.05);
        use(existing.retrievals, now);
        notes.push(`Strengthened belief: "${existing.proposition}".`);
      } else {
        mind.beliefs.push({
          id: nextId(mind, "bel"),
          about: g.about,
          topics: [...new Set(evidence.flatMap((e) => e!.topics))],
          proposition: g.proposition,
          confidence: clamp(0.3 + 0.1 * evidence.length),
          valence: g.valence,
          source: { kind: "inferred" },
          formed: now,
          evidence: evidence.map((e) => e!.id),
          retrievals: [now],
        });
        notes.push(`New belief from ${evidence.length} memories: "${g.proposition}".`);
      }
    }
    if (dream.lifeStory.trim()) mind.self.lifeStory = dream.lifeStory.trim();
  }

  // Formative experiences: mastery builds efficacy (Bandura 1977); uncontrollable harm erodes control (Maier & Seligman 2016).
  const D = PARAMS.development;
  for (const e of mind.episodes.filter((x) => recent(x.tick))) {
    if (e.valence > 0.4 && e.agency === "self") mind.self.selfEfficacy = clamp(mind.self.selfEfficacy + 0.02);
    if (e.valence < -0.4 && e.agency === "circumstance" && e.coping < 0.5) mind.self.control = clamp(mind.self.control - 0.03);
    if (e.arousal >= D.formativeArousal && e.valence < -0.5 && e.coping < D.formativeCoping) {
      for (const s of mind.schemas.filter((x) => x.triggers.some((t) => e.topics.includes(t)))) {
        s.strength = clamp(s.strength + 0.08);
        (s.deepenedBy ??= []).push({ episode: e.id, tick: now });
        notes.push(`Core belief deepened: "${s.text}".`);
      }
    }
  }

  if (mind.ablations.traitDrift) {
    const settled = mind.expressions.filter((x) => recent(x.tick) && x.outcome !== undefined);
    if (settled.length > 0) {
      const shifts: string[] = [];
      for (const t of TRAIT_NAMES) {
        const delta = (D.traitRate * settled.reduce((s, x) => s + (x.expressed[t] - mind.traits[t]) * x.outcome!, 0)) / settled.length;
        mind.traits[t] = clamp(mind.traits[t] + delta);
        if (Math.abs(delta) > 0.0005) shifts.push(`${t} ${delta > 0 ? "+" : ""}${delta.toFixed(4)}`);
      }
      if (shifts.length) notes.push(`Trait drift: ${shifts.join(", ")}.`);
    }
  }

  // Forgetting: past capacity, the faintest ordinary memories go (decay as in Anderson & Schooler 1991).
  const cap = PARAMS.memory.capacity;
  if (mind.episodes.length > cap) {
    const keep = new Set<string>([
      ...mind.schemas.flatMap((s) => [...(s.origin ?? []), ...(s.deepenedBy ?? []).map((d) => d.episode)]),
      ...mind.beliefs.flatMap((b) => [...b.evidence, ...(b.claim?.episodeHint ? [b.claim.episodeHint] : [])]),
    ]);
    const faint = mind.episodes
      .filter((e) => !keep.has(e.id))
      .map((e) => ({ id: e.id, a: baseLevel(e.retrievals, now, PARAMS.memory.gistDecay) + 2 * Math.abs(e.valence) * e.arousal }))
      .sort((x, y) => x.a - y.a)
      .slice(0, mind.episodes.length - cap);
    const drop = new Set(faint.map((x) => x.id));
    mind.episodes = mind.episodes.filter((e) => !drop.has(e.id));
    if (drop.size) notes.push(`Forgot ${drop.size} faint ${drop.size === 1 ? "memory" : "memories"}.`);
  }
  if (mind.expressions.length > 200) mind.expressions.splice(0, mind.expressions.length - 200);

  const af = mind.affect;
  af.stress *= 1 - S.stressRecovery;
  af.fatigue = 0;
  af.allostaticLoad *= 0.98;
  for (const k of EMOTION_NAMES) af.emotions[k] *= 0.2;
  af.arousal = af.mood.arousal * 0.6;
  mind.needs.energy = 1;
  mind.lastSleep = now;

  return {
    id: nextId(mind, "tr"),
    tick: now,
    kind: "sleep",
    retrieval: [],
    workspace: [],
    subliminal: [],
    reconsolidations: [],
    biases: [],
    llmCalls,
    headline: { question: `What happened while ${mind.name} slept?`, answer: notes.join(" ") || "A quiet night." },
    notes,
  };
}
