// Reading a person from their own writing with Claude. One Sonnet call per import: the writing in,
// a structured reading out (traits, attachment, formative memories, core beliefs, values, people,
// voice), every inference citing passages word for word. The engine checks each quote against the
// writing, so a quote the model paraphrased shows up marked.
//
// It goes through the budget governor's meter and cap like every other call: when today's cap is
// spent, or there are no credentials, the free offline reader is used instead.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { mockReader, PERSONA_TRADES, VALUES, type FacultyName, type PersonaReader, type RawReading } from "@psyche/engine";
import type { Governor } from "./governor.js";
import { SONNET } from "./pricing.js";

/** About 15k tokens of writing. More than enough for a likeness; the rest is left out and the reading says so. */
export const MAX_WRITING_CHARS = 60_000;

const PROMPT = `You read a real person's own writing (messages, notes, a journal) and infer their psychology for a simulation, where a model of them will live as a villager in a small pre-industrial fishing village and make their own choices.
Be a careful, fair psychologist. Infer only what the writing supports; when it says little, stay near the middle (0.5) and say so in "why". Do not flatter and do not pathologize.
- traits: Big Five plus HEXACO honesty-humility, each 0 to 1, with a short plain "why" and up to 3 quotes.
- attachment: anxiety and avoidance, 0 to 1 (Brennan, Clark and Shaver).
- self: self-esteem, self-efficacy and sense of control, 0 to 1.
- memories: up to 4 formative experiences they describe (things that happened to them and still carry feeling). "quote" is the passage, word for word. "gist" is one or two first-person sentences of the same memory as they would remember it living in the village: same people, same feeling, but no phones, offices, cars or money amounts (a startup becomes a workshop, a text becomes word sent, an apartment becomes rooms). valence -1 to 1, arousal 0 to 1, coping 0 to 1 (how able they felt to handle it then), topics as short lowercase words, yearsAgo, people named.
- beliefs: up to 4 core beliefs about people, the world or themselves. "stated" ones they say outright (quote it); "learned" ones are what a memory taught them (set memory to that memory's index). Write each as a short first-person or general sentence. hopeful is true when the belief makes people or the world seem safer or kinder.
- values: their top 3 Schwartz values, with weight 0 to 1 and quotes.
- people: up to 5 people who matter in their life, relation, and how they feel about them (-1 to 1).
- trade: the village trade that fits how they spend their days: ${PERSONA_TRADES.join(", ")}.
- voice: how they talk, in a sentence, and up to 3 short characteristic lines quoted from the writing.
- summary: one or two plain sentences on who they are. lifeStory: up to four first-person sentences, in the village's terms, starting from arriving to start again.
All quotes must be copied exactly from the writing, at most about 40 words each.`;

const quotes = z.array(z.string()).max(3);
const trait = z.object({ value: z.number(), why: z.string(), quotes });
const Reading = z.object({
  age: z.number().nullable(),
  summary: z.string(),
  voice: z.object({ description: z.string(), samples: z.array(z.string()).max(3) }),
  traits: z.object({ openness: trait, conscientiousness: trait, extraversion: trait, agreeableness: trait, neuroticism: trait, honesty: trait }),
  attachment: z.object({ anxiety: z.number(), avoidance: z.number(), why: z.string(), quotes }),
  self: z.object({ selfEsteem: z.number(), selfEfficacy: z.number(), control: z.number(), why: z.string(), quotes }),
  memories: z.array(z.object({ quote: z.string(), gist: z.string(), valence: z.number(), arousal: z.number(), coping: z.number(), topics: z.array(z.string()), yearsAgo: z.number(), people: z.array(z.string()) })).max(5),
  beliefs: z.array(z.object({ text: z.string(), kind: z.enum(["stated", "learned"]), quotes, strength: z.number(), memory: z.number().nullable(), hopeful: z.boolean() })).max(5),
  values: z.array(z.object({ value: z.enum(VALUES), weight: z.number(), quotes })).max(3),
  people: z.array(z.object({ name: z.string(), relation: z.string().nullable(), feeling: z.number(), quotes })).max(6),
  trade: z.object({ role: z.enum(PERSONA_TRADES), why: z.string(), quotes }),
  lifeStory: z.string(),
});

export interface ClaudeReaderOptions {
  client?: Anthropic;
  model?: string;
  /** Meters the call and holds it to the day's cap; without one the call is made unmetered. */
  governor?: Governor;
}

/** A PersonaReader on Claude, falling back to the offline reader when there are no credentials or the cap is spent. */
export function createClaudeReader(opts: ClaudeReaderOptions = {}): PersonaReader {
  const model = opts.model ?? process.env.PSYCHE_MODEL_PERSONA ?? SONNET;
  let client = opts.client;
  return async (input, passages) => {
    const g = opts.governor;
    if (g && (g.mode !== "claude" || g.level() === "offline")) return mockReader(input, passages);
    client ??= new Anthropic();
    let writing = passages.join("\n\n");
    if (writing.length > MAX_WRITING_CHARS) writing = writing.slice(0, MAX_WRITING_CHARS);
    const res = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "medium", format: zodOutputFormat(Reading) },
      messages: [{ role: "user", content: `Name: ${input.name}${input.pronouns ? ` (${input.pronouns})` : ""}\n\nTheir writing:\n\n${writing}` }],
    });
    g?.record({
      // The meter keys its breakdown by faculty; this is its own line.
      faculty: "persona" as FacultyName,
      model,
      input: res.usage.input_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      output: res.usage.output_tokens,
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined to read this writing.");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const raw = Reading.parse(JSON.parse(text)) as RawReading;
    return { raw, method: "claude", model };
  };
}
