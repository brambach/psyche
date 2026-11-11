// How a person came to be who they are. Everything here is state a mind carries (MindState.dev),
// written by the development code as the years go by, and read by decisions, appraisal and the
// analysis layer. Each change keeps a pointer to what caused it, so "why is she like this" can be
// followed back through her parents to something that happened before she was born.

import type { AgentId, Attachment, Tick } from "../types.js";

// ---------------------------------------------------------------- moral foundations

/** Moral Foundations Theory (Haidt & Joseph 2004; Graham, Haidt & Nosek 2009), plus liberty (Iyer et al. 2012). */
export const FOUNDATIONS = ["care", "fairness", "loyalty", "authority", "sanctity", "liberty"] as const;
export type Foundation = (typeof FOUNDATIONS)[number];
/** How much each foundation matters to this person, 0 to 1. 0.5 is typical. */
export type Morals = Record<Foundation, number>;

// ---------------------------------------------------------------- attachment

/** The four adult styles from the two dimensions (Bartholomew & Horowitz 1991). */
export type AttachmentStyle = "secure" | "anxious" | "avoidant" | "fearful";

// ---------------------------------------------------------------- upbringing

/** The caregiving someone received, summed up as it went. */
export interface Care {
  /** Sensitivity and responsiveness, 0 to 1 (Ainsworth et al. 1978). */
  warmth: number;
  /** How steady it was from one season to the next, 0 to 1. */
  consistency: number;
  /** Harshness and over-control, 0 to 1 (Baumrind 1971; Barber 1996). */
  control: number;
  /** The last few seasons, which matter most to a small child. */
  recent: number;
  /** Mean swing of warmth from season to season; consistency is read off this. */
  wobble: number;
  seasons: number;
  /** Who did the raising. */
  by: Record<AgentId, { name: string; seasons: number; warmth: number; control: number; parent: boolean }>;
}

export type AdversityKind = "loss" | "hunger" | "harsh" | "neglect" | "troubled-parent" | "uprooted";

/** A childhood adversity, after the ACE study (Felitti et al. 1998). */
export interface Adversity {
  kind: AdversityKind;
  tick: Tick;
  /** Age in years when it happened. */
  age: number;
  text: string;
  who?: AgentId;
  /** The memory of it, when the child was old enough to keep one (about three). */
  episode?: string;
  /** A warm caregiver was there through it: tolerable rather than toxic stress (Shonkoff et al. 2012). */
  buffered: boolean;
}

/** Erikson's psychosocial stages (1950, 1968). */
export type StageName = "trust" | "autonomy" | "initiative" | "industry" | "identity" | "intimacy" | "generativity" | "integrity";

export interface Stage {
  name: StageName;
  /** How far the positive pole won, 0 to 1. */
  outcome: number;
  tick: Tick;
  why: string;
}

// ---------------------------------------------------------------- identity

/** Marcia's identity statuses (1966): has the person explored, and have they committed? */
export type IdentityStatus = "diffused" | "foreclosed" | "moratorium" | "achieved";

export interface Commitment {
  kind: "trade" | "town" | "kin" | "values";
  text: string;
  since: Tick;
}

export interface Narrative {
  /** -1 (things go wrong after going right) to 1 (things come right after going wrong). */
  tone: number;
  /** Bad turned good (McAdams et al. 2001). */
  redemption: number;
  /** Good turned bad. */
  contamination: number;
  theme: "agency" | "communion" | "neither";
  line: string;
}

export interface Identity {
  /** How much they are trying out who to be right now. */
  exploration: number;
  /** How much exploring they have done in all (saturating). */
  explored: number;
  commitment: number;
  status: IdentityStatus;
  commitments: Commitment[];
  /** Identification with their town (Tajfel & Turner 1979), 0 to 1. */
  belonging: number;
  narrative: Narrative;
  history: { tick: Tick; age: number; status: IdentityStatus; why: string }[];
}

// ---------------------------------------------------------------- provenance

export type RootTarget = "anxiety" | "avoidance" | Foundation | "identity" | "confidence" | "reactivity";

export type RootMechanism =
  /** How they were looked after. */
  | "care"
  /** Someone they depended on died or left. */
  | "loss"
  | "hunger"
  /** Values taken on from the people who raised them. */
  | "teaching"
  /** Pushed against a controlling home. */
  | "rebellion"
  /** The people around them, growing up and after. */
  | "town"
  /** The other children: friends made and lost, being let in or left out. */
  | "peers"
  /** Conditions before and just after birth. */
  | "womb"
  /** A hardship met with support, which left them stronger. */
  | "steeling"
  /** A steady partner. */
  | "partner"
  /** Born that way. */
  | "temperament"
  /** Rolled as an adult, with a past the record only sketches. */
  | "before";

/** Why a caregiver was the way they were, in a form the lineage can follow further back. */
export type RootCause =
  /** A core belief of theirs made a hard time harder: the schema id follows the colon. */
  | `schema:${string}`
  /** A stressor that season: "strain:hunger", "strain:grief", "strain:carried". */
  | `strain:${string}`
  /** Their own attachment. */
  | "attachment"
  /** How they were raised themselves. */
  | "upbringing"
  | "temperament"
  | "values"
  | "absence"
  /** How well this caregiver and this child happened to suit each other. */
  | "fit";

/** One link in how someone became who they are. Seasons of the same cause are merged. */
export interface Root {
  target: RootTarget;
  /** Total change it accounts for (positive: more of the target). */
  delta: number;
  mechanism: RootMechanism;
  /** First and last time it acted. */
  from: Tick;
  to: Tick;
  /** Ages (years) over which it acted. */
  ages: [number, number];
  text: string;
  /** The person it came through, and what about them. */
  via?: { agent: AgentId; name: string; cause?: RootCause; label?: string };
  /** The memory or event behind it, when there is one. */
  ref?: string;
}

// ---------------------------------------------------------------- the whole record

export interface Development {
  /** True when they were raised inside the simulation, season by season. */
  lived: boolean;
  /**
   * Inborn reactivity, 0 to 1: how strongly care, good or bad, leaves its mark
   * (differential susceptibility; Belsky & Pluess 2009).
   */
  reactivity: number;
  care: Care;
  adversity: Adversity[];
  stages: Stage[];
  /** Attachment at about eighteen months (the age of the Strange Situation) and on coming of age. */
  attachmentAt: { infancy?: Attachment; grown?: Attachment };
  identity: Identity;
  morals: Morals;
  roots: Root[];
  /** How they are as a parent, summed over the seasons they have raised children. */
  parenting?: { warmth: number; control: number; seasons: number };
  /** How hard recent seasons have been on them, 0 to 1 (slow average). */
  strain: number;
  /** Accumulators for the stage they are in now. */
  window: { warmth: number; control: number; consistency: number; hunger: number; seasons: number; stage: number };
  /** Seasons in a row of harsh care, of cold care, and with a caregiver badly strained. */
  runs: { harsh: number; cold: number; troubled: number };
  /** When the development turn last ran for them. */
  lastTurn: Tick;
}
