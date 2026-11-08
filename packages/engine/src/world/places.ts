// Kettle Island: the places, and the daily rhythm that moves people between them.

import type { AgentId } from "../types.js";

/**
 * A place id. Kettle Island's are fixed (below); a village makes its own. A few ids carry meaning
 * the engine relies on in every world: "sea" (out on the water), "harbour", "tavern" (where people
 * gather in the evening) and "cliffs" (somewhere to walk off a bad mood).
 */
export type PlaceId = string;

export interface Place {
  id: PlaceId;
  name: string;
  /** Position on the map, in a 100 x 62 box. */
  x: number;
  y: number;
  /** People can meet and talk here. Nobody chats across open water. */
  social: boolean;
  outdoors: boolean;
  topics: string[];
}

export const PLACES: Record<string, Place> = {
  sea: { id: "sea", name: "the fishing grounds", x: 13, y: 12, social: false, outdoors: true, topics: ["sea", "catch"] },
  harbour: { id: "harbour", name: "the harbour", x: 31, y: 37, social: true, outdoors: true, topics: ["boat", "harbour"] },
  fishshed: { id: "fishshed", name: "Vell's fish shed", x: 40, y: 47, social: true, outdoors: false, topics: ["catch", "buyer"] },
  boatyard: { id: "boatyard", name: "the boatyard", x: 21, y: 48, social: true, outdoors: true, topics: ["hull", "boat"] },
  tavern: { id: "tavern", name: "the Gull", x: 53, y: 36, social: true, outdoors: false, topics: ["tavern"] },
  cliffs: { id: "cliffs", name: "the cliff path", x: 80, y: 18, social: true, outdoors: true, topics: ["cliffs"] },
  home_mara: { id: "home_mara", name: "Quill cottage", x: 44, y: 23, social: false, outdoors: false, topics: ["home"] },
  home_theo: { id: "home_theo", name: "Theo's house", x: 25, y: 28, social: false, outdoors: false, topics: ["home"] },
  home_jun: { id: "home_jun", name: "Jun's cottage", x: 67, y: 28, social: false, outdoors: false, topics: ["home"] },
  home_corran: { id: "home_corran", name: "the Vell house", x: 64, y: 50, social: false, outdoors: false, topics: ["home"] },
};

/** One stretch of a day. An evening entry lets the mind choose between going out and staying in. */
export interface RoutineEntry {
  from: number;
  place: PlaceId;
  activity: string;
  evening?: { place: PlaceId; activity: string };
}

export interface Want {
  id: string;
  kind: "request" | "offer" | "confide";
  target: AgentId;
  /** Verb phrase, said to the target: "lend me your boat on Thursday". */
  what: string;
  topics: string[];
  /** The asker's goal this serves. */
  goal?: string;
  /** For "confide": the episode the mind wants to explain. */
  episode?: string;
  /** Not before this tick (after a refusal, people wait a while before asking again). */
  notBefore?: number;
}
