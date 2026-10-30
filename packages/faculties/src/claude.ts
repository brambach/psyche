// LLM faculties backed by Claude. Each faculty is one narrow, schema-constrained call.
// The stable parts (faculty instructions, the agent's identity) come first so they cache.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { Faculties, FacultyName, PerceiveResponse, StableIdentity } from "@psyche/engine";

type Effort = "low" | "medium" | "high";

export interface ClaudeFacultiesConfig {
  client?: Anthropic;
  /** Model per faculty. Defaults to claude-opus-5-5 for every faculty; override with PSYCHE_MODEL_<FACULTY>. */
  models?: Partial<Record<FacultyName, string>>;
  effort?: Partial<Record<FacultyName, Effort>>;
}

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_EFFORT: Record<FacultyName, Effort> = {
  perceive: "low",
  speak: "low",
  reconstruct: "low",
  deliberate: "medium",
  dream: "medium",
};

export class FacultyRefusal extends Error {}

const PROMPTS: Record<FacultyName, string> = {
  perceive: `You are the perception faculty of a simulated mind. Turn one thing the mind saw or heard into a structured percept.
Report what is plainly there, not what the perceiver will feel about it; appraisal happens elsewhere.
- about: ids from knownEntities that the text is about (not the speaker unless they talk about themselves).
- topics: short lowercase concept words. Prefer words from knownTopics when they fit.
- features.outcomeForSelf: -1 (clear harm to the perceiver) to 1 (clear benefit). Neutral talk is 0.
- features.intensity: 0 to 1, how big a deal this is regardless of sign.
- request: only if the speaker asks the perceiver to do or give something.
- asksRecall: only if the speaker asks the perceiver to recall a past event.
- claims: assertions about other people or past events. If a claim speaks to a detail of one of candidateSlots, set slotKey to that slot's key, value to the claimed detail as a short phrase that could replace the original, and episodeHint to its episodeId.
- details: verbatim specifics worth remembering (amounts, times, words used), each with a short key; template renders them, e.g. "Corran paid me {amount}.".
- gist: one first-person sentence from the perceiver's point of view.
Use null for absent optional fields.`,
  deliberate: `You are the deliberate, reflective thinking of a simulated person (System 2).
You can only think about what is in the workspace: these are the only memories, feelings, beliefs and goals currently in mind. Do not invent other memories or facts.
The stance lines describe this person's current state. Honour them. Do not be kinder, calmer or more reasonable than the state warrants; people under strain often choose badly.
Each option carries an impulse score: the gut reaction. You may follow it or override it.
Return the chosen option id, the workspace item ids that drove the choice with weights summing to about 1, and a short inner monologue in the person's own voice (one to three sentences, present tense).`,
  speak: `You are the speech faculty of a simulated person. Write what they say out loud, in their voice.
Say only what the intent calls for. If content is given, it is what they remember; retell it in their words without adding facts. If no content is given, they share no memories.
Style values are 0 to 1: warmth, curtness, hedging, verbosity. Match them. The stance lines are their current state; honour them, including being blunt or unkind when the state says so.
Return the utterance (no quotation marks, no stage directions) and short speech-act tags such as refuse, promise, apologize, recount, gossip.`,
  reconstruct: `You are the reconstructive process of human memory. A detail of a remembered event has faded.
Fill it back in the way a person would: from the gist, the faded trace, their current mood, their beliefs and their core beliefs. Low mood makes memories of hurt harsher; good mood softens them. Stay plausible and close to the trace. You are not trying to be accurate.
Return the detail as a short phrase that fits the same place in the sentence, and the belief ids you leaned on.`,
  dream: `You are sleep consolidation in a simulated mind. Look at tonight's replayed memories.
Propose generalizations (semantic beliefs) only where at least two replayed memories about the same entity point the same way. Each needs the entity id, a short first-person proposition, a valence from -1 to 1, and the memory ids as evidence. Propose nothing if nothing generalizes.
Then rewrite the life story in the first person, at most four sentences, keeping what still holds and folding in what tonight's memories changed.`,
};

const nullable = <T extends z.ZodType>(t: T) => t.nullable();

const PerceiveSchema = z.object({
  kind: z.enum(["speech", "event"]),
  addressedToSelf: z.boolean(),
  about: z.array(z.string()),
  topics: z.array(z.string()),
  features: z.object({
    outcomeForSelf: z.number(),
    agency: z.enum(["self", "other", "circumstance"]),
    intentional: z.number(),
    normViolation: z.number(),
    prospective: z.boolean(),
    intensity: z.number(),
  }),
  request: nullable(z.object({ what: z.string(), topics: z.array(z.string()) })),
  asksRecall: nullable(z.object({ about: z.array(z.string()), topics: z.array(z.string()) })),
  claims: z.array(
    z.object({
      about: z.string(),
      topics: z.array(z.string()),
      proposition: z.string(),
      valence: z.number(),
      slotKey: nullable(z.string()),
      value: nullable(z.string()),
      episodeHint: nullable(z.string()),
    }),
  ),
  details: z.array(z.object({ key: z.string(), value: z.string() })),
  template: nullable(z.string()),
  gist: z.string(),
});

const DeliberateSchema = z.object({
  choice: z.string(),
  because: z.array(z.object({ item: z.string(), weight: z.number() })),
  monologue: z.string(),
});
const SpeakSchema = z.object({ utterance: z.string(), acts: z.array(z.string()) });
const ReconstructSchema = z.object({ value: z.string(), usedBeliefs: z.array(z.string()) });
const DreamSchema = z.object({
  generalizations: z.array(z.object({ about: z.string(), proposition: z.string(), valence: z.number(), evidence: z.array(z.string()) })),
  lifeStory: z.string(),
});

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const undef = <T>(x: T | null): T | undefined => (x === null ? undefined : x);

export function createClaudeFaculties(config: ClaudeFacultiesConfig = {}): Faculties {
  const client = config.client ?? new Anthropic();
  const modelFor = (f: FacultyName) => config.models?.[f] ?? process.env[`PSYCHE_MODEL_${f.toUpperCase()}`] ?? DEFAULT_MODEL;
  const effortFor = (f: FacultyName) => config.effort?.[f] ?? DEFAULT_EFFORT[f];

  async function call<S extends z.ZodType>(faculty: FacultyName, schema: S, payload: unknown, identity?: StableIdentity): Promise<z.infer<S>> {
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: PROMPTS[faculty] }];
    if (identity) system.push({ type: "text", text: `You are ${identity.name}. ${identity.summary}\nVoice: ${identity.voice}` });
    system[system.length - 1]!.cache_control = { type: "ephemeral" };
    const res = await client.beta.messages.create({
      model: modelFor(faculty),
      max_tokens: faculty === "deliberate" || faculty === "dream" ? 8000 : 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      output_config: { effort: effortFor(faculty), format: zodOutputFormat(schema) },
      messages: [{ role: "user", content: JSON.stringify(payload, null, 1) }],
    });
    if (res.stop_reason === "refusal") throw new FacultyRefusal(`${faculty} was declined: ${res.stop_details?.explanation ?? "no reason given"}`);
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return schema.parse(JSON.parse(text));
  }

  return {
    async perceive(req) {
      const r = await call("perceive", PerceiveSchema, req);
      const out: PerceiveResponse = {
        ...r,
        features: {
          ...r.features,
          outcomeForSelf: clamp(r.features.outcomeForSelf, -1, 1),
          intentional: clamp(r.features.intentional, 0, 1),
          normViolation: clamp(r.features.normViolation, 0, 1),
          intensity: clamp(r.features.intensity, 0, 1),
        },
        request: undef(r.request),
        asksRecall: undef(r.asksRecall),
        claims: r.claims.map((c) => ({ ...c, valence: clamp(c.valence, -1, 1), slotKey: undef(c.slotKey), value: undef(c.value), episodeHint: undef(c.episodeHint) })),
        template: undef(r.template),
      };
      return out;
    },
    async deliberate(req) {
      const { self, ...rest } = req;
      return call("deliberate", DeliberateSchema, rest, self);
    },
    async speak(req) {
      const { self, ...rest } = req;
      return call("speak", SpeakSchema, rest, self);
    },
    async reconstruct(req) {
      return call("reconstruct", ReconstructSchema, req);
    },
    async dream(req) {
      const { self, ...rest } = req;
      const r = await call("dream", DreamSchema, rest, self);
      return { ...r, generalizations: r.generalizations.map((g) => ({ ...g, valence: clamp(g.valence, -1, 1) })) };
    },
  };
}
