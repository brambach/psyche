// Where a person's history reaches their choices.
//
// decide.ts and affect.ts each call one function here. Everything is gated on the mind having a
// development record and on the mechanism being switched on, and nothing draws a random number, so
// a mind without a record behaves exactly as it did before this code existed.

import type { ActionOption, Percept } from "../ports.js";
import type { Contribution } from "../trace.js";
import type { MindState } from "../types.js";
import { securityOf, styleOf, STYLE_TEXT } from "./attachment.js";
import { clamp, enabled } from "./core.js";
import { firmness, STATUS_TEXT } from "./identity.js";
import { moralBlame, moralTerms } from "./morals.js";
import { FOUNDATIONS, type Foundation } from "./types.js";

type Term = { name: string; value: number; ref: string };

/**
 * The attachment system switches on under threat (Bowlby 1969; Mikulincer & Shaver 2007). Anxious
 * people hyperactivate: they reach for others, and give way to the ones they are afraid of losing.
 * Avoidant people deactivate: they close up. Secure people stay on the problem. Each term is
 * centred, so it is zero for someone in the middle.
 */
function attachmentTerms(mind: MindState, p: Percept, opt: ActionOption): Term[] {
  const a = mind.attachment;
  const out: Term[] = [];
  const shaken = clamp(mind.affect.stress + 0.6 * Math.max(0, -p.features.outcomeForSelf) * p.features.intensity);
  const social = opt.coping === "social" ? 1 : 0;
  if (shaken > 0.05) {
    out.push({ name: "attachment: reaches for people when shaken", value: (a.anxiety - 0.45) * shaken * (0.5 * social + 0.25 * opt.disclosure), ref: "dev:attachment.anxiety" });
    out.push({ name: "attachment: closes up when shaken", value: (a.avoidance - 0.4) * shaken * (0.3 * opt.avoidant - 0.4 * social), ref: "dev:attachment.avoidance" });
    out.push({ name: "attachment: steady when shaken", value: (securityOf(a) - 0.5) * shaken * (opt.coping === "problem" ? 0.3 : 0), ref: "dev:attachment" });
  }
  const other = mind.others[p.actor];
  if (other && other.bond >= 0.6 && p.addressedToSelf) {
    out.push({ name: `attachment: afraid of losing ${other.name}`, value: (a.anxiety - 0.45) * other.bond * (0.35 * opt.prosocial - 0.3 * opt.assertive), ref: "dev:attachment.anxiety" });
  }
  return out.filter((t) => Math.abs(t.value) >= 0.004);
}

/** Terms a person's upbringing adds to an option's score: conscience and attachment. */
export function depthTerms(mind: MindState, p: Percept, opt: ActionOption): Term[] {
  if (!mind.dev) return [];
  const out: Term[] = [];
  if (enabled(mind, "moralFoundations")) out.push(...moralTerms(mind, p, opt, enabled(mind, "identityFormation") ? firmness(mind) : 0.5));
  if (enabled(mind, "attachmentSystem")) out.push(...attachmentTerms(mind, p, opt));
  return out;
}

export interface DepthAppraisal {
  blame: number;
  threat: number;
  /** Fraction by which felt distress and fear are muted (stress is not). */
  mute: number;
  adjustments: Contribution[];
}

/**
 * How upbringing colours the reading of a moment: outrage in proportion to the foundation offended;
 * dread when someone depended on turns cold (rejection sensitivity: Downey & Feldman 1996); and, for
 * the avoidant, feeling held at arm's length while the body keeps the score (Dozier & Kobak 1992).
 */
export function depthAppraisal(mind: MindState, p: Percept, desirability: number): DepthAppraisal {
  const out: DepthAppraisal = { blame: 0, threat: 0, mute: 0, adjustments: [] };
  if (!mind.dev) return out;
  if (enabled(mind, "moralFoundations")) {
    const b = moralBlame(mind, p);
    if (b) {
      out.blame += b.value;
      out.adjustments.push({ name: `conscience: ${b.foundation}`, value: b.value, ref: `dev:moral.${b.foundation}` });
    }
  }
  if (enabled(mind, "attachmentSystem") && desirability < 0) {
    const a = mind.attachment;
    const other = mind.others[p.actor];
    if (other && other.bond >= 0.5 && p.features.agency === "other") {
      const v = 0.35 * (a.anxiety - 0.45) * other.bond;
      if (Math.abs(v) > 0.01) {
        out.threat += v;
        out.adjustments.push({ name: `afraid of losing ${other.name}`, value: v, ref: "dev:attachment.anxiety" });
      }
    }
    const mute = 0.35 * Math.max(0, a.avoidance - 0.4);
    if (mute > 0.01) {
      out.mute = mute;
      out.adjustments.push({ name: "keeps the feeling at arm's length", value: -mute, ref: "dev:attachment.avoidance" });
    }
  }
  return out;
}

const MATTERS: Record<Foundation, string> = {
  care: "other people's suffering",
  fairness: "fairness",
  loyalty: "loyalty to the town",
  authority: "doing as one is told",
  sanctity: "what is sacred",
  liberty: "not being pushed around",
};

/** A development ref from a decision trace, in words, for the Story headline. */
export function describeDevRef(mind: MindState, ref: string): string | undefined {
  if (!mind.dev || !ref.startsWith("dev:")) return undefined;
  const s = mind.pronouns.subject;
  const plural = s === "they";
  const v = (one: string, many: string) => (plural ? many : one);
  const key = ref.slice(4);
  if (key.startsWith("moral.")) {
    const f = key.slice(6) as Foundation;
    if (!FOUNDATIONS.includes(f)) return undefined;
    return mind.dev.morals[f] >= 0.5 ? `${MATTERS[f]} matters a great deal to ${mind.pronouns.object}` : `${MATTERS[f]} doesn't weigh much with ${mind.pronouns.object}`;
  }
  if (key === "attachment.anxiety") return mind.attachment.anxiety >= 0.45 ? `${s} ${v("is", "are")} afraid of being left` : `${s} ${v("doesn't", "don't")} fear being left`;
  if (key === "attachment.avoidance") return mind.attachment.avoidance >= 0.4 ? `${s} ${v("keeps", "keep")} people at a distance` : `${s} ${v("lets", "let")} people close`;
  if (key === "attachment") return `${s} ${v("feels", "feel")} ${securityOf(mind.attachment) >= 0.5 ? "safe" : "unsafe"} with people`;
  return undefined;
}

/** One line on who they are underneath, for an identity prompt or a tooltip. */
export function depthLine(mind: MindState): string {
  const d = mind.dev;
  if (!d) return "";
  return `${STYLE_TEXT[styleOf(mind.attachment)]}. ${STATUS_TEXT[d.identity.status]}.`;
}
