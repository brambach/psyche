// The Historian on Claude. One Opus call per question: the brief in (the piece of the causal history
// the question is about, every line tagged), an answer out that cites those tags. The engine cuts the
// brief and checks the tags, so the model reads and explains; it never searches and cannot invent a
// record.
//
// It goes through the budget governor's meter and cap like every other call. With no credentials, or
// once today's cap is spent, the free offline reader answers instead, and says what Opus would have
// cost.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { citedIn, offlineHistorian, type Brief, type FacultyName, type Historian } from "@psyche/engine";
import type { Governor } from "./governor.js";
import { costOf, OPUS } from "./pricing.js";

const PROMPT = `You are the Historian of a simulated world: a civilization of artificial minds whose psychology is real machinery (memory that fades and is rewritten, moods, trust, core beliefs, inherited stories). Someone watching that world asks you why something happened.

You are given a brief cut from the world's causal record. Every line in it is something the engine recorded as it happened: a choice, a memory, a belief, a feeling, something said, an event. Each has a tag such as [n4]. LINKS say which of them led to which, by what mechanism, and roughly what share of the subject each accounts for along its path. Shares multiply along a path and are approximate.

Answer the question from the brief alone.
- Lead with the answer in a sentence or two, then walk the cause back in time: what was in mind at the moment, where that came from, and where it started. When the trail passes through other people or other generations, say so and name them.
- If the question is about a fear or a belief, say where it came from and what it has gone on to shape since, using the downstream counts.
- Put the tag of each record you rely on right after the claim it supports, like this: "She held back [n1] because the hungry winter was in mind [n3]." Cite only tags that appear in the brief.
- Weigh the links. A 40% link matters more than a 3% one; say which thread carries the weight and which are minor. Notice what the person would not have been aware of (a core belief tilting how the moment was read, a memory rewritten by something heard, a feeling left over from earlier) and what did not come to mind.
- Do not invent memories, motives, people or events that are not in the brief. Where the record stops, say that it stops. Put anything the record cannot settle in "gaps" (null if nothing).
- Write for a curious person, in plain warm prose, the way a good historian talks: concrete, no jargon, no bullet lists, no headings. Call people by name. 120 to 260 words unless the question is simple.`;

const Answer = z.object({
  answer: z.string(),
  cites: z.array(z.string()),
  gaps: z.string().nullable(),
});

export interface ClaudeHistorianOptions {
  client?: Anthropic;
  /** Default PSYCHE_MODEL_HISTORIAN, else Opus. */
  model?: string;
  effort?: "low" | "medium" | "high";
  /** Meters the call and holds it to the day's cap; without one the call is made unmetered. */
  governor?: Governor;
}

const tokens = (chars: number) => Math.ceil(chars / 4);

/** What one question would cost on a model: the instructions and brief in, a few hundred words and some thinking out. */
export function historianEstimate(brief: Brief, model: string = OPUS): number {
  return costOf(model, { input: tokens(PROMPT.length + brief.text.length), cacheRead: 0, cacheWrite: 0, output: 1200 });
}

/** A Historian on Claude, falling back to the offline reader when there are no credentials or the cap is spent. */
export function createClaudeHistorian(opts: ClaudeHistorianOptions = {}): Historian {
  const model = opts.model ?? process.env.PSYCHE_MODEL_HISTORIAN ?? OPUS;
  let client = opts.client;
  return async (brief) => {
    const g = opts.governor;
    const offline = () => ({ ...offlineHistorian(brief), method: "offline" as const, usd: historianEstimate(brief, model), estimated: true });
    // Nothing to read: no call is worth making.
    if (!brief.focus.length) return offline();
    if (g ? g.mode !== "claude" || g.level() === "offline" : !opts.client && !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return offline();
    client ??= new Anthropic();
    const res = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // The instructions are the same for every question, so they cache.
      system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { effort: opts.effort ?? "medium", format: zodOutputFormat(Answer) },
      messages: [{ role: "user", content: brief.text }],
    });
    const usage = {
      // The meter keys its breakdown by faculty; this is its own line.
      faculty: "historian" as FacultyName,
      model,
      input: res.usage.input_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      output: res.usage.output_tokens,
    };
    g?.record(usage);
    if (res.stop_reason === "refusal") return { ...offline(), gaps: "Claude declined this one, so the record was read offline." };
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const raw = Answer.parse(JSON.parse(text));
    // Only tags that are really in the brief count as citations.
    return { answer: raw.answer, cites: citedIn(raw.answer, brief), gaps: raw.gaps ?? undefined, method: "claude", model: res.model ?? model, usd: costOf(model, usage), estimated: false };
  };
}
