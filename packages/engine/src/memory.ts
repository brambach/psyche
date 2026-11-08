// Memory: ACT-R activation, cue-driven retrieval, rendering from gist and detail slots,
// and reconsolidation (recall rewrites the memory).

import { PARAMS } from "./params.js";
import type { Faculties } from "./ports.js";
import { logisticNoise, nextRandom } from "./rng.js";
import type { ReconsolidationTrace, RetrievalTrace } from "./trace.js";
import type { Belief, DetailSlot, Episode, MindState, SlotChange, Tick } from "./types.js";

const M = PARAMS.memory;

export function hoursBetween(from: Tick, to: Tick): number {
  return Math.max((to - from) / 60, 0.1);
}

/** ACT-R base-level learning: B = ln(sum over uses of age^-d). */
export function baseLevel(uses: Tick[], now: Tick, decay: number): number {
  let sum = 0;
  for (const t of uses) if (t <= now) sum += Math.pow(hoursBetween(t, now), -decay);
  return sum > 0 ? Math.log(sum) : -Infinity;
}

export function slotActivation(slot: DetailSlot, now: Tick): number {
  return baseLevel(slot.rehearsals, now, M.detailDecay) + slot.salience;
}

export function render(ep: Episode): string {
  if (!ep.template) return ep.gist;
  return ep.template.replace(/\{(\w+)\}/g, (_, key: string) => ep.details.find((d) => d.key === key)?.value ?? "...");
}

export function renderOriginal(ep: Episode): string {
  if (!ep.template) return ep.gist;
  return ep.template.replace(/\{(\w+)\}/g, (_, key: string) => ep.details.find((d) => d.key === key)?.original ?? "...");
}

/** Share of details that still match what actually happened. */
export function fidelity(ep: Episode): number {
  if (ep.details.length === 0) return 1;
  return ep.details.filter((d) => d.value === d.original).length / ep.details.length;
}

function cueSet(item: { about: string[] | string; topics: string[] }): string[] {
  const about = Array.isArray(item.about) ? item.about : [item.about];
  return [...about, ...item.topics];
}

export interface Cues {
  about: string[];
  topics: string[];
}

/**
 * Cue-driven retrieval with spreading activation and the fan effect.
 * Every associated memory and belief is scored; those above a noisy threshold are retrieved.
 */
export function retrieve(mind: MindState, cues: Cues, now: Tick): RetrievalTrace[] {
  const cueList = [...new Set([...cues.about, ...cues.topics])];
  const items: { kind: "episode" | "belief"; id: string; label: string; keys: string[]; valence: number; base: number; arousal: number }[] = [];
  for (const ep of mind.episodes) {
    items.push({
      kind: "episode",
      id: ep.id,
      label: ep.gist,
      keys: cueSet(ep),
      valence: ep.valence,
      base: baseLevel(ep.retrievals, now, M.gistDecay) + 0.15 * ep.replays,
      arousal: ep.arousal,
    });
  }
  for (const b of mind.beliefs) {
    items.push({
      kind: "belief",
      id: b.id,
      label: b.proposition,
      keys: cueSet(b),
      valence: b.valence,
      base: baseLevel(b.retrievals, now, M.gistDecay) + M.beliefOffset * (b.confidence - 0.5) * 2,
      arousal: 0,
    });
  }
  const fan = new Map<string, number>();
  for (const it of items) for (const k of it.keys) fan.set(k, (fan.get(k) ?? 0) + 1);

  const out: RetrievalTrace[] = [];
  for (const it of items) {
    let spread = 0;
    for (const c of cueList) {
      if (it.keys.includes(c)) spread += M.cueWeight * Math.max(M.spreadFloor, M.spreadMax - Math.log(fan.get(c) ?? 1));
    }
    if (spread === 0) continue;
    const mood = mind.ablations.moodCongruence ? M.moodCongruence * mind.affect.mood.valence * it.valence : 0;
    const arousal = M.arousalBonus * it.arousal * Math.abs(it.valence);
    const noise = logisticNoise(mind, M.noise);
    const activation = it.base + spread + mood + arousal + noise;
    out.push({
      id: it.id,
      kind: it.kind,
      label: it.label,
      components: { base: it.base, spread, mood, arousal, noise },
      activation,
      retrieved: activation > M.retrievalThreshold,
    });
  }
  return out.sort((a, b) => b.activation - a.activation);
}

function claimMatches(belief: Belief, ep: Episode, slot: DetailSlot): boolean {
  const c = belief.claim;
  if (!c || c.slotKey !== slot.key || c.value === slot.value) return false;
  if (belief.formed <= ep.tick) return false;
  if (c.episodeHint) return c.episodeHint === ep.id;
  return ep.about.includes(belief.about) && belief.topics.some((t) => ep.topics.includes(t));
}

/**
 * Recall opens a labile window (Nader, Schafe & LeDoux 2000). Each detail is re-retrieved:
 * if post-event information competes, the stronger trace tends to win (Loftus & Palmer 1974),
 * with the winner's source silently attached (Johnson et al. 1993). Faded details with no
 * competitor are filled in by the Reconstruct faculty from gist, mood and beliefs.
 */
export async function reconsolidate(
  mind: MindState,
  ep: Episode,
  now: Tick,
  faculties: Faculties,
  detail: boolean,
): Promise<ReconsolidationTrace | undefined> {
  touchEpisode(mind, ep, now);
  if (!mind.ablations.reconsolidation) {
    if (detail) for (const slot of ep.details) slot.rehearsals.push(now);
    return undefined;
  }
  const before = render(ep);
  const changes: SlotChange[] = [];
  const mood = mind.affect.mood.valence;

  // Verbatim details are only re-retrieved when the memory is recalled in full (told, or
  // laid out for deliberation). Coming to mind as gist touches only gist and feeling.
  for (const slot of detail ? ep.details : []) {
    const original = slotActivation(slot, now);
    const competitors = mind.ablations.misinformation ? mind.beliefs.filter((b) => claimMatches(b, ep, slot)) : [];
    if (competitors.length > 0) {
      const scored = [
        { value: slot.value, source: slot.source, activation: original, belief: undefined as Belief | undefined },
        ...competitors.map((b) => ({
          value: b.claim!.value,
          source: { kind: "told" as const, from: b.source.from, ref: b.id },
          belief: b,
          activation:
            baseLevel(b.retrievals, now, M.detailDecay) +
            M.credibilityWeight * (b.confidence - 0.5) * 2 +
            (mind.ablations.moodCongruence ? M.moodCongruence * mood * b.valence : 0),
        })),
      ];
      const weights = scored.map((s) => Math.exp(s.activation / M.competitionTemperature));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = nextRandom(mind) * total;
      let winner = scored[0]!;
      for (let i = 0; i < scored.length; i++) {
        r -= weights[i]!;
        if (r <= 0) {
          winner = scored[i]!;
          break;
        }
      }
      // A claim that wins on strength still loses if the agent remembers where it came from.
      const sourceVivid = winner.belief ? Math.pow(0.5, hoursBetween(winner.belief.formed, now) / M.sourceHalfLife) : 0;
      if (winner.belief && nextRandom(mind) >= sourceVivid) {
        changes.push({ key: slot.key, from: slot.value, to: winner.value, cause: "misinformation", source: winner.source });
        slot.value = winner.value;
        slot.source = winner.source;
        winner.belief.retrievals.push(now);
      }
    } else if (original < M.detailThreshold) {
      const beliefs = mind.beliefs
        .filter((b) => ep.about.includes(b.about))
        .map((b) => ({ id: b.id, text: b.proposition }));
      const schemas = mind.schemas.filter((s) => s.triggers.some((t) => ep.topics.includes(t))).map((s) => s.text);
      const res = await faculties.reconstruct({ gist: ep.gist, slotKey: slot.key, fadedValue: slot.value, mood, beliefs, schemas });
      const value = res.value.trim();
      if (value && value !== slot.value) {
        const source = { kind: "reconstructed" as const, ref: res.usedBeliefs[0] };
        changes.push({ key: slot.key, from: slot.value, to: value, cause: "reconstruction", source });
        slot.value = value;
        slot.source = source;
      }
    }
    slot.rehearsals.push(now);
  }

  const valenceFrom = ep.valence;
  if (mind.ablations.affectiveRetagging) {
    ep.valence = clamp(ep.valence + M.retagRate * (mood - ep.valence), -1, 1);
  }
  if (changes.length === 0 && Math.abs(ep.valence - valenceFrom) < 0.02) return undefined;
  const version = { tick: now, mood, changes, valenceFrom, valenceTo: ep.valence };
  ep.versions.push(version);
  return { episodeId: ep.id, before, after: render(ep), version, fidelity: fidelity(ep) };
}

/** Retrieving or replaying an episode also rehearses beliefs that rest on it (e.g. what someone told me then). */
export function touchEpisode(mind: MindState, ep: Episode, now: Tick): void {
  ep.retrievals.push(now);
  for (const b of mind.beliefs) if (b.evidence.includes(ep.id)) b.retrievals.push(now);
}

export function clamp(x: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, x));
}
