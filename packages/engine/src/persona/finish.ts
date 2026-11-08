// From what a reader inferred to a person the engine can run: quotes checked against the writing,
// numbers clamped, beliefs given the world topics that set them off, values turned into goals.
// The same step serves the mock and the model, so both produce the same shape.

import { TRAIT_NAMES, type Pronouns, type TraitName } from "../types.js";
import { clip, parseWriting, quoteFound, shapeBelief, worldTopics } from "./text.js";
import { mockRead } from "./mock.js";
import { PERSONA_TRADES, VALUES, type PersonaReader, type PersonaReading, type Quote, type RawReading, type ValueName, type WritingInput } from "./types.js";

const SHE: Pronouns = { subject: "she", object: "her", possessive: "her", reflexive: "herself" };
const HE: Pronouns = { subject: "he", object: "him", possessive: "his", reflexive: "himself" };
const THEY: Pronouns = { subject: "they", object: "them", possessive: "their", reflexive: "themself" };
export const pronounsOf = (p?: string): Pronouns => (p === "she" ? SHE : p === "he" ? HE : THEY);

/** What each value comes to mean in a village: a goal, and the topics it is about. */
export const VALUE_GOALS: Record<ValueName, { text: string; tags: string[] }> = {
  "self-direction": { text: "Build something of my own here", tags: ["build", "house", "reputation"] },
  achievement: { text: "Become the best at my trade in the village", tags: ["build", "reputation", "catch", "harvest"] },
  benevolence: { text: "Look after the people close to me", tags: ["help", "family", "home"] },
  universalism: { text: "See that everyone gets a fair share", tags: ["fairness", "store", "help"] },
  security: { text: "Keep enough put by for the winter", tags: ["food", "store", "winter"] },
  stimulation: { text: "See what lies beyond the bay", tags: ["sea", "boat", "trade"] },
  hedonism: { text: "Enjoy the good evenings at the fire", tags: ["fire", "stories"] },
  tradition: { text: "Keep the old ways alive", tags: ["stories", "founding"] },
  conformity: { text: "Be thought well of in the new village", tags: ["reputation", "store", "help"] },
  power: { text: "Have a say in how the village is run", tags: ["leader", "reputation"] },
};

const num = (x: unknown, lo: number, hi: number, d: number) => {
  const n = typeof x === "number" && Number.isFinite(x) ? x : d;
  return Number(Math.max(lo, Math.min(hi, n)).toFixed(2));
};
const str = (x: unknown, max = 300) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** Read writing into a mind: parse it, run the reader (the mock unless one is given), and finish the reading. */
export async function readPerson(input: WritingInput, reader?: PersonaReader): Promise<PersonaReading> {
  const parsed = parseWriting(input.text, input.author);
  if (!parsed.passages.length) throw new Error("There's no writing to read.");
  const r = reader ? await reader(input, parsed.passages) : { raw: mockRead(input, parsed.passages), method: "mock" as const };
  const reading = finishReading(r.raw, input, parsed.passages, r.method, r.model);
  if (parsed.chat) reading.notes.unshift(`Read as a chat: kept ${parsed.passages.length} lines by ${parsed.author}${parsed.others.length ? `, left out ${parsed.others.map((o) => o.name).join(", ")}` : ""}.`);
  return reading;
}

/** The mock reader as a PersonaReader, for anywhere that wants one explicitly. */
export const mockReader: PersonaReader = async (input, passages) => ({ raw: mockRead(input, passages), method: "mock" });

export function finishReading(raw: RawReading, input: WritingInput, passages: string[], method: "mock" | "claude", model?: string): PersonaReading {
  const writing = passages.join("\n");
  let missing = 0;
  const q = (xs: unknown, max = 3): Quote[] =>
    arr<string>(xs)
      .map((t) => str(t, 400))
      .filter(Boolean)
      .slice(0, max)
      .map((t) => {
        const found = quoteFound(t.replace(/…$/, ""), writing);
        if (!found) missing++;
        return { text: clip(t), found };
      });
  const words = writing.split(/\s+/).filter(Boolean).length;
  const name = str(input.name, 40) || "Newcomer";
  const first = name.split(/\s+/)[0]!;

  const traits = {} as PersonaReading["traits"];
  for (const t of TRAIT_NAMES) {
    const x = raw.traits?.[t as TraitName];
    traits[t] = { value: num(x?.value, 0.03, 0.97, 0.5), why: str(x?.why, 200) || "Little in the writing either way", evidence: q(x?.quotes) };
  }

  const memories = arr<RawReading["memories"][number]>(raw.memories)
    .slice(0, 5)
    .map((m, i) => {
      const quote = q([m.quote], 1)[0] ?? { text: str(m.gist, 220), found: false };
      const gist = str(m.gist, 240) || quote.text;
      return {
        id: `m${i + 1}`,
        quote,
        gist,
        valence: num(m.valence, -1, 1, 0),
        arousal: num(m.arousal, 0.1, 1, 0.55),
        coping: num(m.coping, 0.05, 0.95, 0.5),
        topics: [...new Set([...arr<string>(m.topics).map((x) => str(x, 20).toLowerCase()).filter(Boolean), ...worldTopics(`${quote.text} ${gist}`)])].slice(0, 7),
        yearsAgo: Math.round(num(m.yearsAgo, 0.5, 80, 5)),
        people: arr<string>(m.people).map((x) => str(x, 30)).filter(Boolean).slice(0, 4),
      };
    });

  const beliefs: PersonaReading["beliefs"] = [];
  for (const b of arr<RawReading["beliefs"][number]>(raw.beliefs).slice(0, 5)) {
    const text = str(b.text, 120).replace(/[.!]+$/, "");
    if (!text || beliefs.some((x) => x.text.toLowerCase() === text.toLowerCase())) continue;
    const mem = typeof b.memory === "number" ? memories[b.memory] : undefined;
    const shaped = shapeBelief(text, typeof b.hopeful === "boolean" ? b.hopeful : undefined, mem?.topics.slice(0, 3));
    beliefs.push({ id: `b${beliefs.length + 1}`, text, kind: b.kind === "learned" ? "learned" : "stated", ...shaped, strength: num(b.strength, 0.2, 0.85, 0.5), evidence: q(b.quotes, 2), memory: mem?.id });
  }

  const values = arr<RawReading["values"][number]>(raw.values)
    .filter((v) => (VALUES as readonly string[]).includes(v.value))
    .slice(0, 3)
    .map((v, i) => {
      const weight = num(v.weight, 0.1, 1, 0.5);
      return { value: v.value, weight, evidence: q(v.quotes, 2), goal: { ...VALUE_GOALS[v.value], priority: num(0.75 - i * 0.1 + (weight - 0.5) * 0.2, 0.3, 0.85, 0.6) } };
    });

  const people = arr<RawReading["people"][number]>(raw.people)
    .slice(0, 6)
    .map((p) => ({ name: str(p.name, 40), relation: str(p.relation, 30) || undefined, feeling: num(p.feeling, -1, 1, 0), evidence: q(p.quotes, 2) }))
    .filter((p) => p.name);

  const role = (PERSONA_TRADES as readonly string[]).includes(raw.trade?.role) ? raw.trade.role : "builder";
  const age = Math.round(num(raw.age ?? undefined, 17, 90, 30));
  const confidence = num(Math.min(1, words / 1200) * (method === "claude" ? 1 : 0.8), 0, 1, 0);
  const notes: string[] = [];
  if (words < 300) notes.push(`Only ${words} words to go on. A few thousand words of everyday writing (chat messages, notes, a journal) make a far better likeness.`);
  else if (words < 1000) notes.push(`${words} words is enough for a sketch. More everyday writing sharpens it.`);
  if (method === "mock") notes.push("Read on the offline mock from word patterns: a rough likeness, free. With Claude connected the same writing gets a close reading.");
  if (missing) notes.push(`${missing} quote${missing === 1 ? "" : "s"} could not be found word for word in the writing and ${missing === 1 ? "is" : "are"} marked.`);

  return {
    version: 1,
    method,
    model,
    name,
    pronouns: pronounsOf(input.pronouns),
    age,
    words,
    passages: passages.length,
    confidence,
    summary: str(raw.summary, 300) || `${first}, ${age}.`,
    voice: { description: str(raw.voice?.description, 300) || "Plain and steady.", samples: arr<string>(raw.voice?.samples).map((s) => clip(str(s, 200), 160)).filter(Boolean).slice(0, 3) },
    traits,
    attachment: { anxiety: num(raw.attachment?.anxiety, 0.05, 0.95, 0.4), avoidance: num(raw.attachment?.avoidance, 0.05, 0.95, 0.35), why: str(raw.attachment?.why, 200), evidence: q(raw.attachment?.quotes, 2) },
    self: { selfEsteem: num(raw.self?.selfEsteem, 0.05, 0.95, 0.55), selfEfficacy: num(raw.self?.selfEfficacy, 0.05, 0.95, 0.55), control: num(raw.self?.control, 0.05, 0.95, 0.5), why: str(raw.self?.why, 200), evidence: q(raw.self?.quotes, 2) },
    memories,
    beliefs,
    values,
    people,
    trade: { role: role as PersonaReading["trade"]["role"], why: str(raw.trade?.why, 200) || "", evidence: q(raw.trade?.quotes, 2) },
    lifeStory: str(raw.lifeStory, 600) || `I came to the bay to start again.`,
    notes,
  };
}

/**
 * A reading sent back from the browser (perhaps with parts switched off or a trait moved) is checked
 * and clamped before it becomes a mind. Nothing outside the reading's shape gets through.
 */
export function sanitizeReading(x: unknown): PersonaReading {
  const r = (x ?? {}) as Partial<PersonaReading>;
  const quotes = (xs: unknown): Quote[] => arr<Quote>(xs).slice(0, 3).map((q) => ({ text: clip(str(q?.text, 400)), found: q?.found === true })).filter((q) => q.text);
  const traits = {} as PersonaReading["traits"];
  for (const t of TRAIT_NAMES) {
    const v = r.traits?.[t];
    traits[t] = { value: num(v?.value, 0.03, 0.97, 0.5), why: str(v?.why, 200), evidence: quotes(v?.evidence) };
  }
  const memories = arr<PersonaReading["memories"][number]>(r.memories)
    .slice(0, 6)
    .map((m, i) => ({
      id: /^m\d{1,2}$/.test(String(m?.id)) ? String(m.id) : `m${i + 1}`,
      quote: quotes([m?.quote])[0] ?? { text: str(m?.gist, 220), found: false },
      gist: str(m?.gist, 240),
      valence: num(m?.valence, -1, 1, 0),
      arousal: num(m?.arousal, 0.1, 1, 0.55),
      coping: num(m?.coping, 0.05, 0.95, 0.5),
      topics: arr<string>(m?.topics).map((t) => str(t, 20).toLowerCase()).filter((t) => /^[a-z]+$/.test(t)).slice(0, 7),
      yearsAgo: Math.round(num(m?.yearsAgo, 0.5, 80, 5)),
      people: arr<string>(m?.people).map((p) => str(p, 30)).filter(Boolean).slice(0, 4),
    }))
    .filter((m) => m.gist);
  const ids = new Set(memories.map((m) => m.id));
  const beliefs = arr<PersonaReading["beliefs"][number]>(r.beliefs)
    .slice(0, 6)
    .map((b, i) => ({
      id: /^b\d{1,2}$/.test(String(b?.id)) ? String(b.id) : `b${i + 1}`,
      text: str(b?.text, 120),
      kind: b?.kind === "learned" ? ("learned" as const) : ("stated" as const),
      triggers: arr<string>(b?.triggers).map((t) => str(t, 20).toLowerCase()).filter((t) => /^[a-z]+$/.test(t)).slice(0, 7),
      threat: num(b?.threat, -0.5, 0.5, 0),
      blame: num(b?.blame, -0.5, 0.5, 0),
      strength: num(b?.strength, 0.1, 0.9, 0.5),
      evidence: quotes(b?.evidence),
      memory: b?.memory && ids.has(b.memory) ? b.memory : undefined,
    }))
    .filter((b) => b.text)
    .map((b) => (b.triggers.length ? b : { ...b, ...shapeBelief(b.text) }));
  const values = arr<PersonaReading["values"][number]>(r.values)
    .filter((v) => (VALUES as readonly string[]).includes(v?.value))
    .slice(0, 4)
    .map((v) => ({ value: v.value, weight: num(v.weight, 0.1, 1, 0.5), evidence: quotes(v.evidence), goal: { ...VALUE_GOALS[v.value], priority: num(v.goal?.priority, 0.2, 0.9, 0.6) } }));
  const people = arr<PersonaReading["people"][number]>(r.people)
    .slice(0, 6)
    .map((p) => ({ name: str(p?.name, 40), relation: str(p?.relation, 30) || undefined, feeling: num(p?.feeling, -1, 1, 0), evidence: quotes(p?.evidence) }))
    .filter((p) => p.name);
  const pronouns = pronounsOf(r.pronouns?.subject);
  return {
    version: 1,
    method: r.method === "claude" ? "claude" : "mock",
    model: str(r.model, 60) || undefined,
    name: str(r.name, 40).replace(/[^\p{L}\p{N} '.-]/gu, "") || "Newcomer",
    pronouns,
    age: Math.round(num(r.age, 17, 90, 30)),
    words: Math.round(num(r.words, 0, 1e7, 0)),
    passages: Math.round(num(r.passages, 0, 1e6, 0)),
    confidence: num(r.confidence, 0, 1, 0),
    summary: str(r.summary, 300),
    voice: { description: str(r.voice?.description, 300) || "Plain and steady.", samples: arr<string>(r.voice?.samples).map((s) => str(s, 200)).filter(Boolean).slice(0, 3) },
    traits,
    attachment: { anxiety: num(r.attachment?.anxiety, 0.05, 0.95, 0.4), avoidance: num(r.attachment?.avoidance, 0.05, 0.95, 0.35), why: str(r.attachment?.why, 200), evidence: quotes(r.attachment?.evidence) },
    self: { selfEsteem: num(r.self?.selfEsteem, 0.05, 0.95, 0.55), selfEfficacy: num(r.self?.selfEfficacy, 0.05, 0.95, 0.55), control: num(r.self?.control, 0.05, 0.95, 0.5), why: str(r.self?.why, 200), evidence: quotes(r.self?.evidence) },
    memories,
    beliefs,
    values,
    people,
    trade: { role: (PERSONA_TRADES as readonly string[]).includes(r.trade?.role as string) ? r.trade!.role : "builder", why: str(r.trade?.why, 200), evidence: quotes(r.trade?.evidence) },
    lifeStory: str(r.lifeStory, 600) || "I came to the bay to start again.",
    notes: arr<string>(r.notes).map((n) => str(n, 300)).filter(Boolean).slice(0, 6),
  };
}
