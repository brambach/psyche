// Appraisal, emotion, mood, stress and trust.
// Appraisal theory (Lazarus 1991; Scherer 2001) turns event features into personal meaning;
// the OCC model (Ortony, Clore & Collins 1988) maps that meaning to discrete emotions.

import { clamp } from "./memory.js";
import { PARAMS } from "./params.js";
import type { Percept } from "./ports.js";
import type { AppraisalTrace, Contribution } from "./trace.js";
import { EMOTION_NAMES, NEGATIVE_EMOTIONS, type EmotionName, type MindState } from "./types.js";

const A = PARAMS.affect;

export function triggeredSchemas(mind: MindState, topics: string[]) {
  return mind.schemas.filter((s) => s.triggers.some((t) => topics.includes(t)));
}

export function appraise(mind: MindState, p: Percept): AppraisalTrace {
  const f = p.features;
  const adjustments: Contribution[] = [];

  const goalMatch = Math.max(0, ...mind.goals.filter((g) => g.tags.some((t) => p.topics.includes(t))).map((g) => g.priority));
  const relevance = clamp(f.intensity * (0.55 + 0.45 * goalMatch) + (p.addressedToSelf ? 0.2 : 0));
  if (goalMatch > 0) adjustments.push({ name: "touches a goal", value: 0.45 * goalMatch * f.intensity });
  const desirability = clamp(f.outcomeForSelf * relevance, -1, 1);

  let blame = 0;
  if (f.agency === "other") {
    blame = f.intentional * 0.6 + f.normViolation * 0.4;
    const actor = mind.others[p.actor];
    if (actor && mind.ablations.motivatedAttribution && desirability < 0) {
      const hostile = PARAMS.social.hostileAttribution * (0.5 - actor.trust.benevolence);
      if (Math.abs(hostile) > 0.01) {
        adjustments.push({ name: `trust in ${actor.name} colours blame`, value: hostile, ref: `other:${actor.id}` });
        blame += hostile;
      }
    }
  }
  const schemas = triggeredSchemas(mind, p.topics);
  let threat = 0;
  for (const s of schemas) {
    if (desirability < 0) {
      blame += s.blameBias * s.strength;
      threat += s.threatBias * s.strength;
      adjustments.push({ name: `core belief: "${s.text}"`, value: s.blameBias * s.strength, ref: s.id });
    }
  }
  blame = clamp(blame);

  const coping = clamp(
    mind.self.selfEfficacy * 0.6 + mind.self.control * 0.4 - mind.affect.stress * 0.3 - mind.affect.fatigue * 0.2,
  );
  threat = clamp(threat + Math.max(0, -desirability) * (1 - coping) + (f.prospective && desirability < 0 ? 0.2 : 0));

  const negGain = 1 + A.neuroticismGain * (mind.traits.neuroticism - 0.5) * 2;
  const posGain = 1 + A.extraversionGain * (mind.traits.extraversion - 0.5) * 2;
  const e: Partial<Record<EmotionName, number>> = {};
  if (desirability > 0) {
    const m = desirability * posGain;
    if (f.prospective) e.hope = m;
    else e.joy = m;
    if (f.agency === "other") {
      e.gratitude = m * f.intentional;
      e.admiration = m * 0.5 * f.intentional;
    }
    if (f.agency === "self") e.pride = m * 0.8;
  } else if (desirability < 0) {
    const m = -desirability * negGain;
    if (f.prospective) e.fear = m * (1 - coping * 0.5);
    else e.distress = m;
    if (f.agency === "other") {
      e.anger = m * blame;
      if (f.normViolation > 0) e.reproach = f.normViolation * blame * negGain;
    }
    if (f.agency === "self") e.shame = m * 0.7;
  }
  for (const k of Object.keys(e) as EmotionName[]) e[k] = clamp(e[k]!);
  return { features: f, relevance, desirability, blame, coping, threat, adjustments, emotions: e };
}

export function applyAppraisal(mind: MindState, a: AppraisalTrace): void {
  const af = mind.affect;
  for (const [k, v] of Object.entries(a.emotions) as [EmotionName, number][]) {
    af.emotions[k] = 1 - (1 - af.emotions[k]) * (1 - v);
  }
  af.stress = clamp(af.stress + Math.max(0, -a.desirability) * (1 - a.coping) * 0.6 + a.threat * 0.1);
  settleCore(mind, 1);
}

function emotionBalance(mind: MindState): { pos: number; neg: number; peak: number } {
  let pos = 0;
  let neg = 0;
  let peak = 0;
  for (const k of EMOTION_NAMES) {
    const v = mind.affect.emotions[k];
    if (NEGATIVE_EMOTIONS.has(k)) neg += v;
    else pos += v;
    peak = Math.max(peak, v);
  }
  return { pos, neg, peak };
}

/** Core affect moves toward mood plus whatever emotions are active. */
function settleCore(mind: MindState, fraction: number): void {
  const af = mind.affect;
  const { pos, neg, peak } = emotionBalance(mind);
  const targetV = clamp(af.mood.valence + 0.6 * (pos - neg), -1, 1);
  const targetA = clamp(af.mood.arousal * 0.5 + 0.5 * peak + 0.25 * af.stress);
  af.valence += (targetV - af.valence) * fraction;
  af.arousal += (targetA - af.arousal) * fraction;
}

export function baselineValence(mind: MindState): number {
  return 0.1 + 0.15 * (mind.traits.extraversion - 0.5) * 2 - 0.2 * (mind.traits.neuroticism - 0.5) * 2;
}

const decayFactor = (minutes: number, halfLife: number) => Math.pow(0.5, minutes / halfLife);

/** Let time pass for affect: emotions fade, mood integrates core affect, stress and fatigue drift. */
export function passTime(mind: MindState, minutes: number, awake: boolean): void {
  const af = mind.affect;
  let left = minutes;
  while (left > 0) {
    const dt = Math.min(left, 30);
    left -= dt;
    for (const k of EMOTION_NAMES) af.emotions[k] *= decayFactor(dt, A.emotionHalfLife);
    settleCore(mind, 1 - decayFactor(dt, A.coreHalfLife));
    const km = 1 - decayFactor(dt, A.moodHalfLife);
    af.mood.valence += (af.valence - af.mood.valence) * km;
    af.mood.arousal += (af.arousal - af.mood.arousal) * km;
    af.mood.valence += (baselineValence(mind) - af.mood.valence) * (1 - decayFactor(dt, 60 * 72));
    af.stress *= decayFactor(dt, A.stressHalfLife);
    if (af.stress > A.allostaticThreshold) af.allostaticLoad = clamp(af.allostaticLoad + (dt / 60) * 0.01 * (af.stress - A.allostaticThreshold));
    if (awake) af.fatigue = clamp(af.fatigue + (dt / 60) * A.fatiguePerHour);
  }
}

/**
 * Trust in the actor moves with evidence about their benevolence and integrity
 * (Mayer, Davis & Schoorman 1995). Violations count more than kindnesses (Slovic 1993),
 * and attachment anxiety sharpens sensitivity to slights.
 */
export function updateTrust(mind: MindState, p: Percept): Contribution[] {
  const other = mind.others[p.actor];
  if (!other || p.features.agency !== "other") return [];
  const S = PARAMS.social;
  const step = (e: number) => {
    if (e >= 0 || !mind.ablations.negativityAsymmetry) return S.trustGain * e;
    return S.trustGain * S.negativityRatio * e * (1 + mind.attachment.anxiety * 0.5);
  };
  const ben = step(p.features.outcomeForSelf * p.features.intentional);
  const integ = step(-p.features.normViolation + (p.features.normViolation === 0 && p.features.outcomeForSelf > 0 ? 0.3 : 0));
  other.trust.benevolence = clamp(other.trust.benevolence + ben);
  other.trust.integrity = clamp(other.trust.integrity + integ);
  other.liking = clamp(other.liking + ben * 0.6);
  other.believedRegard = clamp(other.believedRegard + p.features.outcomeForSelf * p.features.intentional * 0.3, -1, 1);
  const out: Contribution[] = [];
  if (Math.abs(ben) > 0.001) out.push({ name: `benevolence trust in ${other.name}`, value: ben, ref: `other:${other.id}` });
  if (Math.abs(integ) > 0.001) out.push({ name: `integrity trust in ${other.name}`, value: integ, ref: `other:${other.id}` });
  return out;
}
