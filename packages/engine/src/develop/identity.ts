// Identity (Erikson 1968; Marcia 1966; Tajfel & Turner 1979; McAdams 2001).
//
// Three things, kept apart because they do different work:
//
//   Status. Has the person tried out who to be, and have they settled? Marcia's four statuses come
//   from those two questions. Exploring needs room: an open temperament, a home that allowed it
//   (Grotevant & Cooper 1985), a secure base to go out from, and no hunger. Commitment comes with a
//   trade, a partner, children, a place. Commitment without exploration is foreclosure: the parents'
//   answers, taken whole. A person with an achieved identity holds their own line under pressure
//   better than the others (Toder & Marcia 1973), which is what `firmness` feeds into choices.
//
//   Belonging. How much "we" means this town (social identity). It scales what loyalty asks.
//
//   The story. Whether the person's charged memories run bad-then-good (redemption) or
//   good-then-bad (contamination). People who tell their lives as redemption are better off for it
//   (McAdams, Reynolds, Lewis, Patten & Bowman 2001).

import type { MindState, Tick } from "../types.js";
import { securityOf } from "./attachment.js";
import { addRoot, clamp, r2 } from "./core.js";
import type { Identity, IdentityStatus, Narrative } from "./types.js";

export function statusOf(i: Pick<Identity, "exploration" | "explored" | "commitment">): IdentityStatus {
  if (i.commitment >= 0.5) return i.explored >= 0.5 ? "achieved" : "foreclosed";
  return i.exploration >= 0.45 ? "moratorium" : "diffused";
}

/** How much a person's own values and commitments count against the pull of the moment, 0 to 1. */
export function firmness(mind: MindState): number {
  const i = mind.dev?.identity;
  if (!i) return 0.5;
  switch (i.status) {
    case "achieved":
      return clamp(0.55 + 0.45 * i.commitment);
    case "foreclosed":
      return clamp(0.3 + 0.3 * i.commitment);
    case "moratorium":
      return 0.35;
    default:
      return 0.2;
  }
}

export const STATUS_TEXT: Record<IdentityStatus, string> = {
  diffused: "Hasn't worked out who to be, and isn't looking",
  foreclosed: "Settled early on what was handed down, without looking further",
  moratorium: "Still trying out who to be",
  achieved: "Looked around, then chose who to be",
};

export interface IdentityContext {
  now: Tick;
  /** Age in years. */
  age: number;
  /** Their trade, once they have one. */
  role?: string;
  partnered: boolean;
  parent: boolean;
  /** How at home they are in the town right now, 0 to 1. */
  belonging: number;
  /** Hunger and want this season, 0 to 1: nobody tries on selves on an empty stomach. */
  hardship: number;
  /** Something that shook them this season (a death, a move, a town splitting). */
  crisis?: string;
  town?: string;
}

/** One season of becoming someone. Returns a line when the status changes. */
export function identitySeason(mind: MindState, ctx: IdentityContext): string | undefined {
  const dev = mind.dev!;
  const i = dev.identity;
  i.belonging = r2(i.belonging + 0.2 * (ctx.belonging - i.belonging));
  if (ctx.age < 12) return undefined;
  const t = mind.traits;
  const room = 0.5 - dev.care.control;
  const young = ctx.age < 24;
  // The question opens gradually through the teens (Meeus 2011).
  const ramp = Math.min(1, Math.max(0, (ctx.age - 11) / 6));
  const exploreTo = young
    ? ramp * (0.18 + 0.6 * t.openness + 0.3 * room - 0.25 * ctx.hardship + 0.12 * (securityOf(mind.attachment) - 0.5))
    : 0.1 + 0.25 * t.openness;
  i.exploration = clamp(i.exploration + (young ? 0.18 : 0.06) * (clamp(exploreTo) - i.exploration));
  if (ctx.crisis) {
    // A blow to the life they had settled into reopens the question (Stephen, Fraser & Marcia 1992).
    i.exploration = clamp(i.exploration + 0.3);
    i.commitment = clamp(i.commitment - 0.15);
  }
  i.explored = clamp(i.explored + 0.075 * Math.max(0, i.exploration - 0.38));
  const commitTo =
    0.04 +
    (ctx.role && ctx.role !== "child" ? 0.15 : 0) +
    0.25 * t.conscientiousness +
    (ctx.partnered ? 0.14 : 0) +
    (ctx.parent ? 0.1 : 0) +
    0.18 * i.belonging +
    0.3 * Math.max(0, dev.care.control - 0.35) * (ctx.age < 22 ? 1 : 0.5) +
    0.16 * Math.min(1, Math.max(0, ctx.age - 14) / 10) -
    0.22 * Math.max(0, i.exploration - 0.55);
  i.commitment = clamp(i.commitment + 0.12 * (clamp(commitTo) - i.commitment));
  i.exploration = r2(i.exploration);
  i.explored = r2(i.explored);
  i.commitment = r2(i.commitment);

  const add = (kind: "trade" | "town" | "kin" | "values", text: string) => {
    if (!i.commitments.some((c) => c.kind === kind)) i.commitments.push({ kind, text, since: ctx.now });
  };
  if (i.commitment >= 0.5) {
    if (ctx.role && ctx.role !== "child") add("trade", `being a ${ctx.role}`);
    if (ctx.partnered || ctx.parent) add("kin", `${mind.pronouns.possessive} own household`);
    if (i.belonging >= 0.55 && ctx.town) add("town", `being of ${ctx.town}`);
  } else if (i.commitment < 0.35) i.commitments = [];

  const next = statusOf(i);
  if (next === i.status) return undefined;
  const why =
    next === "achieved"
      ? i.status === "foreclosed"
        ? `looked again at what was handed down, and chose it or something else for ${mind.pronouns.reflexive}`
        : "settled, after looking around"
      : next === "foreclosed"
        ? dev.care.control >= 0.45
          ? `the people who raised ${mind.pronouns.object} had decided it already`
          : "the first answer fitted well enough"
        : next === "moratorium"
          ? ctx.crisis
            ? `${ctx.crisis}, and what had been settled came open again`
            : "began trying out who to be"
          : ctx.crisis
            ? `${ctx.crisis}, and nothing has taken its place`
            : `let go of what ${mind.pronouns.subject} had settled on`;
  i.status = next;
  i.history.push({ tick: ctx.now, age: Number(ctx.age.toFixed(1)), status: next, why });
  if (i.history.length > 8) i.history.splice(0, i.history.length - 8);
  const delta = next === "achieved" ? 0.3 : next === "foreclosed" ? 0.15 : next === "moratorium" ? -0.05 : -0.2;
  const caregiver = Object.entries(dev.care.by).sort((a, b) => b[1].seasons - a[1].seasons)[0];
  addRoot(dev, {
    target: "identity",
    delta,
    mechanism: next === "foreclosed" && dev.care.control >= 0.45 ? "care" : ctx.crisis ? "loss" : "temperament",
    tick: ctx.now,
    age: ctx.age,
    text: `${STATUS_TEXT[next]}: ${why}.`,
    via: next === "foreclosed" && dev.care.control >= 0.45 && caregiver ? { agent: caregiver[0], name: caregiver[1].name, cause: "upbringing", label: "a home where the answers were given" } : undefined,
  });
  return `${STATUS_TEXT[next]} (${why}).`;
}

/**
 * Read the shape of a life off its charged first-hand memories, in order: each bad one followed by a
 * good one is a redemption turn, each good one followed by a bad one a contamination turn.
 */
export function narrate(mind: MindState): Narrative {
  const eps = mind.episodes.filter((e) => e.source.kind !== "told" && Math.abs(e.valenceAtEncoding || e.valence) >= 0.4).sort((a, b) => a.tick - b.tick);
  let redemption = 0;
  let contamination = 0;
  for (let k = 1; k < eps.length; k++) {
    const a = eps[k - 1]!.valence;
    const b = eps[k]!.valence;
    if (a < 0 && b > 0) redemption++;
    else if (a > 0 && b < 0) contamination++;
  }
  const good = eps.filter((e) => e.valence > 0);
  const agency = good.filter((e) => e.agency === "self").length;
  const communion = good.filter((e) => e.about.length > 0 || e.topics.some((t) => ["family", "love", "help", "child"].includes(t))).length;
  // How it stands now counts for a turn: a life whose last strong memory is a loss reads as one.
  const last = eps.at(-1)?.valence ?? 0;
  const tone = Number(clamp((redemption - contamination + Math.sign(last) * 0.5) / (redemption + contamination + 2), -1, 1).toFixed(2));
  const theme = agency > communion ? "agency" : communion > 0 ? "communion" : "neither";
  const line =
    eps.length < 2
      ? "Not much of a story yet."
      : tone > 0.2
        ? `Tells ${mind.pronouns.possessive} life as things coming right after going wrong${theme === "communion" ? ", mostly through other people" : theme === "agency" ? `, mostly by ${mind.pronouns.possessive} own doing` : ""}.`
        : tone < -0.2
          ? `Tells ${mind.pronouns.possessive} life as good things spoiled.`
          : `Tells ${mind.pronouns.possessive} life as ups and downs, with no direction to it.`;
  return { tone, redemption, contamination, theme, line };
}

/** Once a year: retell the story, and let its shape work on how they see themself. */
export function narrativeYear(mind: MindState): void {
  const dev = mind.dev!;
  dev.identity.narrative = narrate(mind);
  const tone = dev.identity.narrative.tone;
  mind.self.selfEsteem = r2(clamp(mind.self.selfEsteem + 0.02 * tone));
  mind.self.control = r2(clamp(mind.self.control + 0.01 * tone));
}
