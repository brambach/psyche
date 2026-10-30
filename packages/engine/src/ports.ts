// The contract between the mind engine and its LLM faculties.
// Each faculty is a narrow call. None of them sees the whole mind: they get a packet the engine
// built, and they must cite the item ids they used so the brain scan's links are real.

import type { AgentId, Tick } from "./types.js";

// ---------------------------------------------------------------- percepts

export interface Claim {
  /** Who or what the claim is about. */
  about: string;
  topics: string[];
  proposition: string;
  valence: number;
  /** When the claim speaks to a detail of a remembered event. */
  slotKey?: string;
  value?: string;
  episodeHint?: string;
  /** Lineage id when the claim is a story being passed along. */
  rumor?: string;
}

/** Objective features of an event, before this particular mind appraises it. */
export interface EventFeatures {
  /** Harm (-1) to benefit (+1) to the perceiver's interests, as plainly stated. */
  outcomeForSelf: number;
  /** Who brought it about. */
  agency: "self" | "other" | "circumstance";
  /** Did the actor mean it? 0..1 */
  intentional: number;
  /** Breaks a shared norm (lying, abandoning, cheating)? 0..1 */
  normViolation: number;
  /** About something that may still happen. */
  prospective: boolean;
  /** How big a deal, regardless of sign. 0..1 */
  intensity: number;
}

export interface Percept {
  id: string;
  tick: Tick;
  kind: "speech" | "event";
  rawText: string;
  actor: AgentId | "world";
  /** True when speech is addressed to the perceiver. */
  addressedToSelf: boolean;
  about: string[];
  topics: string[];
  features: EventFeatures;
  /** Something the actor asks the perceiver to do or give. */
  request?: { what: string; topics: string[] };
  /** The actor asks the perceiver to recall something. */
  asksRecall?: { about: string[]; topics: string[] };
  claims: Claim[];
  /** Verbatim details for the episode this percept becomes. */
  details: { key: string; value: string; salience?: number }[];
  /** Rendering template for those details, e.g. "The buyer paid {amount}." */
  template?: string;
  gist: string;
  /**
   * Id for the episode this percept becomes. Minds that live through the same event share it,
   * so what one tells another about it can compete with the listener's own memory.
   */
  eventId?: string;
  /** Memories already told in this conversation, which a reply should not repeat. */
  alreadySaid?: string[];
}

// ---------------------------------------------------------------- faculty requests

export interface PerceiveRequest {
  perceiver: { id: AgentId; name: string };
  knownEntities: { id: string; name: string }[];
  /** Concepts this mind already has; the percept's topics should come from here when they fit. */
  knownTopics: string[];
  speaker: AgentId | "world";
  text: string;
  /** Slots of memories the cue activated (top-down perception). */
  candidateSlots: { episodeId: string; gist: string; slotKeys: string[] }[];
}
export type PerceiveResponse = Omit<Percept, "id" | "tick" | "rawText" | "actor">;

export interface WorkspaceItemView {
  id: string;
  kind: string;
  label: string;
  text: string;
  weight: number;
}

export interface OptionView {
  id: string;
  label: string;
  description: string;
  /** System 1's score for this option: the gut feeling deliberation starts from. */
  impulse?: number;
}

export interface DeliberateRequest {
  self: StableIdentity;
  situation: string;
  workspace: WorkspaceItemView[];
  options: OptionView[];
  stance: string[];
}
export interface DeliberateResponse {
  choice: string;
  because: { item: string; weight: number }[];
  monologue: string;
}

export interface StyleVector {
  warmth: number;
  curtness: number;
  hedging: number;
  verbosity: number;
}

export interface SpeakRequest {
  self: StableIdentity;
  listener: { id: AgentId; name: string };
  heard: string;
  intent: { option: string; description: string };
  /** Content the speaker has decided to share, already rendered from memory. */
  content: { id: string; text: string }[];
  style: StyleVector;
  stance: string[];
}
export interface SpeakResponse {
  utterance: string;
  acts: string[];
}

export interface ReconstructRequest {
  gist: string;
  slotKey: string;
  /** The faded trace: what the slot last held. */
  fadedValue: string;
  mood: number;
  beliefs: { id: string; text: string }[];
  schemas: string[];
}
export interface ReconstructResponse {
  value: string;
  usedBeliefs: string[];
}

export interface DreamRequest {
  self: StableIdentity;
  replay: { id: string; text: string; valence: number; about: string[] }[];
  beliefs: { id: string; text: string; about: string }[];
  lifeStory: string;
}
export interface DreamResponse {
  generalizations: { about: string; proposition: string; valence: number; evidence: string[] }[];
  lifeStory: string;
}

/** The cached identity prefix shared by every call for an agent. */
export interface StableIdentity {
  name: string;
  summary: string;
  voice: string;
}

export interface Faculties {
  perceive(req: PerceiveRequest): Promise<PerceiveResponse>;
  deliberate(req: DeliberateRequest): Promise<DeliberateResponse>;
  speak(req: SpeakRequest): Promise<SpeakResponse>;
  reconstruct(req: ReconstructRequest): Promise<ReconstructResponse>;
  dream(req: DreamRequest): Promise<DreamResponse>;
}

export type FacultyName = keyof Faculties;
