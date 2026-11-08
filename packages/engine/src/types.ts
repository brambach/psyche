// Core state types for one mind. Everything the mind "is" lives here as typed state.
// Text (memories, speech, monologue) is rendered from this state, never the other way round.

/** Simulated minutes since Day 1, 00:00. Negative ticks are backstory. */
export type Tick = number;
export type AgentId = string;

export const SELF = "self";

// ---------------------------------------------------------------- personality

/** Big Five plus HEXACO honesty-humility, each a trait mean in [0, 1]. */
export interface Traits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  honesty: number;
}
export type TraitName = keyof Traits;
export const TRAIT_NAMES: TraitName[] = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "neuroticism",
  "honesty",
];

/** Adult attachment as two continuous dimensions (Brennan, Clark & Shaver 1998). */
export interface Attachment {
  anxiety: number;
  avoidance: number;
}

// ---------------------------------------------------------------- affect

export type EmotionName =
  | "joy"
  | "distress"
  | "hope"
  | "fear"
  | "pride"
  | "shame"
  | "admiration"
  | "reproach"
  | "gratitude"
  | "anger"
  | "relief"
  | "disappointment";

export const EMOTION_NAMES: EmotionName[] = [
  "joy",
  "distress",
  "hope",
  "fear",
  "pride",
  "shame",
  "admiration",
  "reproach",
  "gratitude",
  "anger",
  "relief",
  "disappointment",
];

export const NEGATIVE_EMOTIONS: ReadonlySet<EmotionName> = new Set([
  "distress",
  "fear",
  "shame",
  "reproach",
  "anger",
  "disappointment",
]);

export interface Affect {
  /** Core affect right now (Russell 1980). valence in [-1, 1], arousal in [0, 1]. */
  valence: number;
  arousal: number;
  /** Mood: slow moving average of core affect. */
  mood: { valence: number; arousal: number };
  /** Discrete OCC emotions, each an intensity in [0, 1] that decays. */
  emotions: Record<EmotionName, number>;
  /** Demand exceeding coping, accumulated (0..1). */
  stress: number;
  /** Long-run wear from chronic stress (McEwen 1998). */
  allostaticLoad: number;
  /** Rises while awake, cleared by sleep. */
  fatigue: number;
}

// ---------------------------------------------------------------- memory

export type SourceKind = "witnessed" | "told" | "inferred" | "reconstructed";

export interface Source {
  kind: SourceKind;
  /** Who told us, for "told". */
  from?: AgentId;
  /** Which belief or episode the content came from, if known. */
  ref?: string;
}

/**
 * A verbatim detail inside an episode (fuzzy-trace theory: details decay faster than gist).
 * `original` is ground truth from encoding and never changes; `value` is what the agent now remembers.
 */
export interface DetailSlot {
  key: string;
  value: string;
  original: string;
  /** Where the current value came from. Diverges from the episode source on a source-monitoring error. */
  source: Source;
  /** Encoding salience offset: central details are remembered better than peripheral ones. */
  salience: number;
  /** Ticks at which this detail was encoded or rehearsed. */
  rehearsals: Tick[];
}

export interface SlotChange {
  key: string;
  from: string;
  to: string;
  cause: "misinformation" | "reconstruction";
  source: Source;
}

export interface MemoryVersion {
  tick: Tick;
  mood: number;
  changes: SlotChange[];
  valenceFrom: number;
  valenceTo: number;
}

export interface Episode {
  id: string;
  tick: Tick;
  gist: string;
  /** Rendering template; `{key}` placeholders are filled from detail slots. */
  template: string;
  /** People and things this memory is about. Used as retrieval cues. */
  about: string[];
  topics: string[];
  /** Affective tag for self, re-tagged on recall (affective reconsolidation). */
  valence: number;
  valenceAtEncoding: number;
  arousal: number;
  source: Source;
  details: DetailSlot[];
  /** Ticks of encoding and each retrieval (ACT-R base-level activation). */
  retrievals: Tick[];
  versions: MemoryVersion[];
  /** Times replayed in sleep (gist strengthening). */
  replays: number;
  /** Coping potential at encoding; low coping plus high arousal marks a formative event. */
  coping: number;
  agency: "self" | "other" | "circumstance";
}

export interface Belief {
  id: string;
  /** Entity or topic the belief is about. */
  about: string;
  topics: string[];
  proposition: string;
  confidence: number;
  valence: number;
  source: Source;
  formed: Tick;
  evidence: string[];
  retrievals: Tick[];
  /** A claim that can compete with an episode's detail (post-event information). */
  claim?: { slotKey: string; value: string; episodeHint?: string };
  /** Rumor lineage: beliefs passed along by gossip share the id of the story they came from. */
  rumor?: string;
}

/** Context to action link strengthened by repetition (Wood & Neal 2007). */
export interface Habit {
  id: string;
  cue: string;
  action: string;
  strength: number;
}

/** A core belief installed by high-arousal, low-coping experiences (Beck 1967; Young 1990). */
export interface Schema {
  id: string;
  text: string;
  triggers: string[];
  /** Added to blame attributions when triggered. */
  blameBias: number;
  /** Added to threat appraisal when triggered. */
  threatBias: number;
  strength: number;
  /** The formative episodes that installed this core belief, when known. */
  origin?: string[];
  /** Later episodes that deepened it in sleep, with when. */
  deepenedBy?: { episode: string; tick: Tick }[];
}

// ---------------------------------------------------------------- inner life

export interface Goal {
  id: string;
  text: string;
  tags: string[];
  priority: number;
  progress: number;
  /** Accumulated effort; makes abandoning the goal costly (commitment, sunk cost). */
  invested: number;
  /** Smoothed rate of progress; affect follows rate, not just state (Carver & Scheier 1990). */
  rate: number;
}

/** Self-Determination Theory needs plus bodily needs, as satisfaction in [0, 1]. */
export interface Needs {
  autonomy: number;
  competence: number;
  relatedness: number;
  energy: number;
}

export interface Trust {
  ability: number;
  benevolence: number;
  integrity: number;
}

/** What this mind believes about another mind. Often wrong. */
export interface OtherModel {
  id: AgentId;
  name: string;
  trust: Trust;
  liking: number;
  bond: number;
  /** Believed feeling of the other toward me, in [-1, 1]. */
  believedRegard: number;
}

export interface SelfModel {
  selfEsteem: number;
  selfEfficacy: number;
  /** Expected control over outcomes (Maier & Seligman 2016). */
  control: number;
  lifeStory: string;
}

/** A sampled expression of traits plus how it felt afterwards; integrated nightly (TESSERA). */
export interface StateExpression {
  tick: Tick;
  expressed: Traits;
  /** Core valence when the action was taken; outcome is settled at the next cycle. */
  baseline: number;
  outcome?: number;
}

// ---------------------------------------------------------------- the whole mind

export interface Ablations {
  /** Recall rewrites memories (Nader et al. 2000). */
  reconsolidation: boolean;
  /** Post-event information competes with original details (Loftus & Palmer 1974). */
  misinformation: boolean;
  /** Retrieval favours memories matching current mood (Bower 1981). */
  moodCongruence: boolean;
  /** Recall pulls a memory's emotional tag toward current mood. */
  affectiveRetagging: boolean;
  /** Trust falls faster than it rises (Slovic 1993). */
  negativityAsymmetry: boolean;
  /** Low trust inflates blame (hostile attribution). */
  motivatedAttribution: boolean;
  /** Evidence congruent with attitudes gets more weight (Kunda 1990). */
  motivatedUpdating: boolean;
  /** Hearing the same story again raises confidence in it (Hasher, Goldstein & Toppino 1977). */
  illusoryTruth: boolean;
  /** Only workspace items influence choices. Off means every retrieved item counts. */
  limitedWorkspace: boolean;
  /** Sleep consolidation, replay and emotional tempering. */
  sleepConsolidation: boolean;
  /** Nightly trait drift. */
  traitDrift: boolean;
  /** "auto", or force one system. */
  systemTwo: "auto" | "always" | "never";
}

export const DEFAULT_ABLATIONS: Ablations = {
  reconsolidation: true,
  misinformation: true,
  moodCongruence: true,
  affectiveRetagging: true,
  negativityAsymmetry: true,
  motivatedAttribution: true,
  motivatedUpdating: true,
  illusoryTruth: true,
  limitedWorkspace: true,
  sleepConsolidation: true,
  traitDrift: true,
  systemTwo: "auto",
};

export interface Pronouns {
  subject: string;
  object: string;
  possessive: string;
  reflexive: string;
}

export interface MindState {
  id: AgentId;
  name: string;
  pronouns: Pronouns;
  /** Cached identity prefix for every LLM call. */
  identity: { summary: string; voice: string };
  tick: Tick;
  /** Seeded PRNG state, part of the mind so replays are exact. */
  rng: number;
  idCounter: number;
  traits: Traits;
  traitSpread: number;
  attachment: Attachment;
  affect: Affect;
  needs: Needs;
  goals: Goal[];
  self: SelfModel;
  others: Record<AgentId, OtherModel>;
  episodes: Episode[];
  beliefs: Belief[];
  habits: Habit[];
  schemas: Schema[];
  expressions: StateExpression[];
  lastSleep: Tick;
  ablations: Ablations;
}
