// A trace records why one cognitive cycle came out the way it did. The brain scan reads only this.

import type { EventFeatures, Percept } from "./ports.js";
import type { EmotionName, MemoryVersion, Tick } from "./types.js";

export interface Contribution {
  name: string;
  value: number;
  /** Workspace or state item this term came from, when there is one. */
  ref?: string;
}

export interface AppraisalTrace {
  features: EventFeatures;
  relevance: number;
  desirability: number;
  blame: number;
  coping: number;
  threat: number;
  /** Why the appraisal differs from the plain features: trust, schemas, traits. */
  adjustments: Contribution[];
  emotions: Partial<Record<EmotionName, number>>;
}

export interface RetrievalTrace {
  id: string;
  kind: "episode" | "belief";
  label: string;
  components: { base: number; spread: number; mood: number; arousal: number; noise: number };
  activation: number;
  retrieved: boolean;
}

export type WorkspaceKind = "percept" | "memory" | "belief" | "feeling" | "goal" | "need";

export interface WorkspaceEntry {
  ref: string;
  kind: WorkspaceKind;
  label: string;
  text: string;
  score: number;
}

export interface OptionTrace {
  id: string;
  label: string;
  description: string;
  utility: number;
  terms: Contribution[];
}

export interface DecisionTrace {
  system: 1 | 2;
  /** Probability System 2 engaged, and what drove it. */
  s2: { probability: number; conflict: number; novelty: number; stakes: number; capacity: number };
  options: OptionTrace[];
  choice: string;
  because: { ref: string; weight: number }[];
  monologue?: string;
}

export interface BiasFlag {
  name: string;
  confidence: number;
  explanation: string;
  evidence: string[];
}

export interface ReconsolidationTrace {
  episodeId: string;
  before: string;
  after: string;
  version: MemoryVersion;
  fidelity: number;
}

export interface Trace {
  id: string;
  tick: Tick;
  kind: "perceive" | "sleep" | "wait";
  percept?: Percept;
  appraisal?: AppraisalTrace;
  retrieval: RetrievalTrace[];
  workspace: WorkspaceEntry[];
  /** Items that competed but did not make it into awareness. */
  subliminal: WorkspaceEntry[];
  decision?: DecisionTrace;
  reconsolidations: ReconsolidationTrace[];
  /** `content` lists the episodes a reply drew on, when it told a memory. */
  action?: { kind: "speech" | "act" | "none"; text: string; option?: string; content?: string[] };
  biases: BiasFlag[];
  llmCalls: string[];
  /** The episode this moment was encoded as. */
  encoded?: string;
  /** State this moment changed: trust shifts and beliefs formed or strengthened (refs are `other:<id>` or belief ids). */
  changes?: Contribution[];
  /** Plain-language question and answer for the Story view. Generated from this trace, not by the model. */
  headline: { question: string; answer: string };
  notes: string[];
}
