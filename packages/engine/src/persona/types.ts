// A mind read from someone's own writing. The reader (the offline mock, or Claude) returns a
// RawReading: what it inferred and the quotes it leaned on. finishReading() checks every quote
// against the writing, turns the inference into the engine's terms (traits, core beliefs with the
// memories that installed them, goals from values) and frames old memories for the world they are
// about to live in. The result travels with the person into the world, so the Why view can end at
// the words they actually wrote.

import type { Pronouns, TraitName } from "../types.js";

/** Schwartz (1992) basic values, the ones that turn into goals in the village. */
export const VALUES = ["self-direction", "achievement", "benevolence", "universalism", "security", "stimulation", "hedonism", "tradition", "conformity", "power"] as const;
export type ValueName = (typeof VALUES)[number];

/** Trades a newcomer can take up (the same as settlers). */
export const PERSONA_TRADES = ["builder", "farmer", "fisher", "forager", "woodcutter", "quarrier", "thatcher"] as const;
export type PersonaTrade = (typeof PERSONA_TRADES)[number];

/** What a reader returns. Every inference cites the passages it came from, word for word. */
export interface RawReading {
  age?: number | null;
  /** One or two plain sentences on who this person is. */
  summary: string;
  voice: { description: string; samples: string[] };
  traits: Record<TraitName, { value: number; why: string; quotes: string[] }>;
  attachment: { anxiety: number; avoidance: number; why: string; quotes: string[] };
  self: { selfEsteem: number; selfEfficacy: number; control: number; why: string; quotes: string[] };
  /** Formative memories: things that happened to them that still carry feeling. */
  memories: {
    quote: string;
    /** First person, as they would remember it living in the village (no phones, no offices). */
    gist: string;
    valence: number;
    arousal: number;
    /** How able they felt to deal with it at the time, 0 to 1. Low coping plus high arousal is formative. */
    coping: number;
    topics: string[];
    yearsAgo: number;
    people: string[];
  }[];
  /** Core beliefs. "stated" are said outright in the writing; "learned" are what a memory taught them. */
  beliefs: { text: string; kind: "stated" | "learned"; quotes: string[]; strength: number; memory: number | null; hopeful: boolean }[];
  values: { value: ValueName; weight: number; quotes: string[] }[];
  people: { name: string; relation: string | null; feeling: number; quotes: string[] }[];
  trade: { role: PersonaTrade; why: string; quotes: string[] };
  lifeStory: string;
}

/** A passage of the writing, quoted. `found` is false when a quote could not be matched to the writing word for word. */
export interface Quote {
  text: string;
  found: boolean;
}

export interface PersonaTrait {
  value: number;
  why: string;
  evidence: Quote[];
}

export interface PersonaMemory {
  id: string;
  /** What they wrote. */
  quote: Quote;
  /** How they remember it in the world. */
  gist: string;
  valence: number;
  arousal: number;
  coping: number;
  topics: string[];
  yearsAgo: number;
  people: string[];
}

export interface PersonaBelief {
  id: string;
  text: string;
  kind: "stated" | "learned";
  /** Topics in the world that set it off. */
  triggers: string[];
  threat: number;
  blame: number;
  strength: number;
  evidence: Quote[];
  /** The memory that installed it, when there is one. */
  memory?: string;
}

export interface PersonaValue {
  value: ValueName;
  weight: number;
  evidence: Quote[];
  goal: { text: string; tags: string[]; priority: number };
}

export interface PersonaPerson {
  name: string;
  relation?: string;
  feeling: number;
  evidence: Quote[];
}

export interface PersonaReading {
  version: 1;
  /** Who read it: word patterns on the offline mock, or a model. */
  method: "mock" | "claude";
  model?: string;
  name: string;
  pronouns: Pronouns;
  age: number;
  words: number;
  passages: number;
  /** How much the reading can be trusted, mostly from how much writing there was (0 to 1). */
  confidence: number;
  summary: string;
  voice: { description: string; samples: string[] };
  traits: Record<TraitName, PersonaTrait>;
  attachment: { anxiety: number; avoidance: number; why: string; evidence: Quote[] };
  self: { selfEsteem: number; selfEfficacy: number; control: number; why: string; evidence: Quote[] };
  memories: PersonaMemory[];
  beliefs: PersonaBelief[];
  values: PersonaValue[];
  people: PersonaPerson[];
  trade: { role: PersonaTrade; why: string; evidence: Quote[] };
  lifeStory: string;
  /** Caveats worth showing: too little writing, quotes that could not be found, and so on. */
  notes: string[];
}

/** What the person importing says about the writing. */
export interface WritingInput {
  text: string;
  name: string;
  pronouns?: "she" | "he" | "they";
  /** In a chat export, whose lines are theirs. Defaults to whoever wrote the most. */
  author?: string;
}

/** A reader turns writing into a RawReading: the mock, or a model. */
export type PersonaReader = (input: WritingInput, passages: string[]) => Promise<{ raw: RawReading; method: "mock" | "claude"; model?: string }>;
