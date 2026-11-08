// Mara Quill: the first specimen. A fisher on Kettle Island, living through the storm season.

import { DEFAULT_ABLATIONS, EMOTION_NAMES, type Ablations, type DetailSlot, type Episode, type MindState } from "./types.js";

const DAY = 1440;

function slot(key: string, value: string, salience: number, rehearsals: number[]): DetailSlot {
  return { key, value, original: value, source: { kind: "witnessed" }, salience, rehearsals };
}

export function episode(
  e: Omit<Episode, "valenceAtEncoding" | "versions" | "replays" | "source" | "details" | "retrievals" | "coping" | "agency"> & {
    details?: [string, string, number][];
    rehearsed: number[];
    agency?: Episode["agency"];
  },
): Episode {
  const retrievals = [e.tick, ...e.rehearsed];
  return {
    id: e.id,
    tick: e.tick,
    gist: e.gist,
    template: e.template,
    about: e.about,
    topics: e.topics,
    valence: e.valence,
    valenceAtEncoding: e.valence,
    arousal: e.arousal,
    source: { kind: "witnessed" },
    details: (e.details ?? []).map(([k, v, s]) => slot(k, v, s, [...retrievals])),
    retrievals: [...retrievals],
    versions: [],
    replays: 0,
    coping: 0.5,
    agency: e.agency ?? "other",
  };
}

export function createMara(seed = 1, ablations: Partial<Ablations> = {}): MindState {
  const emotions = Object.fromEntries(EMOTION_NAMES.map((k) => [k, 0])) as MindState["affect"]["emotions"];
  return {
    id: "mara",
    name: "Mara",
    pronouns: { subject: "she", object: "her", possessive: "her", reflexive: "herself" },
    identity: {
      summary:
        "Mara Quill, 34, a fisher on Kettle Island. She has worked the family boat alone since her father fell ill. Practical, guarded, dry humour, proud of managing on her own.",
      voice: "Short sentences, plain island speech. Says less than she thinks. Never gushes.",
    },
    tick: 8 * 60,
    rng: seed >>> 0,
    idCounter: 100,
    traits: { openness: 0.45, conscientiousness: 0.62, extraversion: 0.35, agreeableness: 0.42, neuroticism: 0.66, honesty: 0.72 },
    traitSpread: 0.12,
    attachment: { anxiety: 0.6, avoidance: 0.45 },
    affect: {
      valence: 0.05,
      arousal: 0.3,
      mood: { valence: 0.05, arousal: 0.3 },
      emotions,
      stress: 0.2,
      allostaticLoad: 0.1,
      fatigue: 0.05,
    },
    needs: { autonomy: 0.6, competence: 0.6, relatedness: 0.45, energy: 0.9 },
    goals: [
      { id: "g_boat", text: "Keep the boat and nets in working order", tags: ["boat", "nets"], priority: 0.8, progress: 0.6, invested: 0.75, rate: 0 },
      { id: "g_season", text: "Earn enough to get through the storm season", tags: ["money", "catch", "buyer"], priority: 0.9, progress: 0.4, invested: 0.5, rate: 0 },
      { id: "g_alone", text: "Handle things on my own", tags: ["help", "rely"], priority: 0.5, progress: 0.5, invested: 0.6, rate: 0 },
    ],
    self: {
      selfEsteem: 0.55,
      selfEfficacy: 0.65,
      control: 0.6,
      lifeStory:
        "I grew up on the harbour wall with my father's nets. Since he got sick I keep the boat going alone. People here mean well, but when the weather turns you find out who shows up.",
    },
    others: {
      theo: { id: "theo", name: "Theo", trust: { ability: 0.65, benevolence: 0.45, integrity: 0.5 }, liking: 0.45, bond: 0.5, believedRegard: 0.1 },
      jun: { id: "jun", name: "Jun", trust: { ability: 0.55, benevolence: 0.62, integrity: 0.5 }, liking: 0.62, bond: 0.55, believedRegard: 0.3 },
      corran: { id: "corran", name: "Corran", trust: { ability: 0.6, benevolence: 0.3, integrity: 0.35 }, liking: 0.3, bond: 0.1, believedRegard: -0.1 },
      dad: { id: "dad", name: "Dad", trust: { ability: 0.7, benevolence: 0.9, integrity: 0.9 }, liking: 0.9, bond: 0.95, believedRegard: 0.8 },
      visitor: { id: "visitor", name: "the visitor", trust: { ability: 0.5, benevolence: 0.5, integrity: 0.5 }, liking: 0.5, bond: 0, believedRegard: 0 },
    },
    episodes: [
      episode({
        id: "ep_dock",
        tick: -20 * DAY + 21 * 60,
        gist: "Theo let me down at the dock the night of the big storm.",
        template: "Theo {arrival} at the dock. The storm {weather}, and {outcome}.",
        details: [
          ["arrival", "was an hour late", 0.6],
          ["weather", "was getting worse", -0.4],
          ["outcome", "I tied the boat down myself before he got there", 0],
        ],
        about: ["theo"],
        topics: ["dock", "storm", "boat", "help"],
        valence: -0.6,
        arousal: 0.75,
        rehearsed: [-19 * DAY, -12 * DAY],
      }),
      episode({
        id: "ep_roof",
        tick: -300 * DAY,
        gist: "Theo helped Dad fix the roof last winter.",
        template: "Last winter Theo spent {duration} helping Dad fix the roof, and {payment}.",
        details: [
          ["duration", "three days", 0],
          ["payment", "he wouldn't take any money for it", 0.3],
        ],
        about: ["theo", "dad"],
        topics: ["help", "roof", "winter", "family"],
        valence: 0.6,
        arousal: 0.3,
        rehearsed: [-200 * DAY, -60 * DAY],
      }),
      episode({
        id: "ep_jun_catch",
        tick: -30 * DAY,
        gist: "Jun shared her catch with me when mine was poor.",
        template: "",
        about: ["jun"],
        topics: ["fish", "catch", "help"],
        valence: 0.5,
        arousal: 0.3,
        rehearsed: [-25 * DAY],
      }),
      episode({
        id: "ep_nets",
        tick: -9000 * DAY,
        gist: "Dad taught me to mend nets on the harbour wall.",
        template: "",
        about: ["dad"],
        topics: ["nets", "boat", "family"],
        valence: 0.55,
        arousal: 0.4,
        rehearsed: [-3000 * DAY, -400 * DAY, -40 * DAY, -5 * DAY],
        agency: "self",
      }),
      episode({
        id: "ep_corran",
        tick: -70 * DAY,
        gist: "Corran the fish buyer shorted me on a delivery.",
        template: "",
        about: ["corran"],
        topics: ["money", "buyer", "fish"],
        valence: -0.45,
        arousal: 0.5,
        rehearsed: [-60 * DAY],
      }),
    ],
    beliefs: [
      { id: "bel_theo_hands", about: "theo", topics: ["roof", "boat"], proposition: "Theo is good with his hands", confidence: 0.8, valence: 0.3, source: { kind: "inferred" }, formed: -200 * DAY, evidence: ["ep_roof"], retrievals: [-200 * DAY, -30 * DAY] },
      { id: "bel_corran", about: "corran", topics: ["money", "buyer"], proposition: "Corran cheats when he thinks he can", confidence: 0.55, valence: -0.5, source: { kind: "inferred" }, formed: -60 * DAY, evidence: ["ep_corran"], retrievals: [-60 * DAY] },
    ],
    habits: [
      { id: "hab_nets", cue: "nets", action: "problem", strength: 0.6 },
      { id: "hab_storm", cue: "storm", action: "avoid", strength: 0.3 },
    ],
    schemas: [
      { id: "sch_letdown", text: "People let me down when it matters", triggers: ["help", "rely", "dock"], blameBias: 0.25, threatBias: 0.1, strength: 0.4, origin: ["ep_dock"] },
    ],
    expressions: [],
    lastSleep: 0,
    ablations: { ...DEFAULT_ABLATIONS, ...ablations },
  };
}
