// An offline, deterministic stand-in for the LLM faculties. It lets the whole mind run, replay
// and be tested with no API key. Its language is deliberately plain: it exists to exercise the
// engine, not to write well. Everything it produces is visible as "mock" in the brain scan.

import type {
  DeliberateRequest,
  DeliberateResponse,
  DreamRequest,
  DreamResponse,
  Faculties,
  PerceiveRequest,
  PerceiveResponse,
  ReconstructRequest,
  ReconstructResponse,
  SpeakRequest,
  SpeakResponse,
} from "@psyche/engine";

const POSITIVE = ["thank", "kind", "good", "great", "glad", "love", "help you", "welcome", "best"];
const NEGATIVE = ["never", "bad", "ruined", "liar", "late", "cheat", "useless", "hate", "stole", "wrong"];

const count = (text: string, words: string[]) => words.filter((w) => text.includes(w)).length;

export function mockPerceive(req: PerceiveRequest): PerceiveResponse {
  const text = req.text.toLowerCase();
  const about = req.knownEntities.filter((e) => e.id !== req.speaker && text.includes(e.name.toLowerCase())).map((e) => e.id);
  const topics = req.knownTopics.filter((t) => new RegExp(`\\b${t}`, "i").test(req.text));
  const tone = count(text, POSITIVE) - count(text, NEGATIVE);
  const recall = /what happened|tell me( again)? about|do you remember|how did .* go/.test(text);
  const request = /could i|can i|could you|would you|borrow|lend|give me/.test(text);
  const speaker = req.knownEntities.find((e) => e.id === req.speaker)?.name ?? req.speaker;
  const addressed = req.speaker !== "world";
  return {
    kind: addressed ? "speech" : "event",
    addressedToSelf: addressed,
    about,
    topics,
    features: {
      outcomeForSelf: Math.max(-1, Math.min(1, tone * 0.2)),
      agency: addressed ? "other" : "circumstance",
      intentional: addressed ? 0.5 : 0,
      normViolation: 0,
      prospective: request,
      intensity: Math.min(1, 0.3 + 0.1 * Math.abs(tone) + (recall || request ? 0.15 : 0)),
    },
    request: request ? { what: req.text, topics } : undefined,
    asksRecall: recall ? { about, topics } : undefined,
    claims: [],
    details: [],
    gist: addressed ? `${cap(speaker)} said: "${req.text.length > 80 ? `${req.text.slice(0, 77)}...` : req.text}"` : req.text,
  };
}

export function mockDeliberate(req: DeliberateRequest): DeliberateResponse {
  // Deliberation starts from the gut impulse and tempers it: reasons beat curtness a little.
  const scored = req.options.map((o) => ({
    o,
    s: (o.impulse ?? 0) + (/flat|brush|deflect/i.test(o.label) ? -0.08 : 0) + (/explain|short version/i.test(o.label) ? 0.05 : 0),
  }));
  scored.sort((a, b) => b.s - a.s);
  const choice = scored[0]!.o;
  const considered = req.workspace.filter((w) => w.kind !== "percept").sort((a, b) => b.weight - a.weight).slice(0, 3);
  const total = considered.reduce((s, w) => s + w.weight, 0) || 1;
  return {
    choice: choice.id,
    because: considered.map((w) => ({ item: w.id, weight: Number((w.weight / total).toFixed(2)) })),
    monologue: considered.length
      ? `${considered.map((w) => w.label.replace(/\.$/, "")).join(". ")}. So: ${choice.label.toLowerCase()}.`
      : `${choice.label}.`,
  };
}

export function mockSpeak(req: SpeakRequest): SpeakResponse {
  const name = req.listener.name.startsWith("the ") ? "" : `, ${req.listener.name}`;
  const curt = req.style.curtness > 0.55;
  const warm = req.style.warmth > 0.55;
  const story = req.content.map((c) => c.text).join(" ");
  const heard = req.heard.toLowerCase();
  const greeting = /\b(morning|hello|hi|evening|new on the island)\b/.test(heard);
  const question = heard.includes("?");
  switch (req.intent.option) {
    case "Agree":
      return { utterance: curt ? "Fine. Bring it back how you found it." : `All right${name}. Take it. Look after her.`, acts: ["grant"] };
    case "Refuse flatly":
      return { utterance: curt ? "No." : `No${name}. Not this time.`, acts: ["refuse"] };
    case "Refuse and explain":
      return { utterance: `I can't${name}. I need her this week, and the nets are half gone.`, acts: ["refuse", "explain"] };
    case "Put it off":
      return { utterance: "Let me think on it.", acts: ["defer"] };
    case "Tell the whole story":
    case "Give the short version":
      if (!story) return { utterance: "Honestly, I don't remember much of it.", acts: ["recall_fail"] };
      return { utterance: `${curt ? "Since you ask. " : warm ? "Sit down, then. " : ""}${story}`, acts: ["recount"] };
    case "Deflect":
      return { utterance: "Long night. Ask someone else.", acts: ["deflect"] };
    case "Reply warmly":
      if (greeting) return { utterance: "Welcome, then. Ask me anything about the boats.", acts: ["greet"] };
      return { utterance: question ? "Happy to help where I can." : "Is that right? I hadn't heard.", acts: ["engage"] };
    case "Reply politely":
      if (greeting) return { utterance: "Morning.", acts: ["greet"] };
      return { utterance: question ? "Maybe. Depends." : "Hm.", acts: ["acknowledge"] };
    case "Brush off":
      return { utterance: greeting ? "I'm busy." : "Not my business.", acts: ["dismiss"] };
    default:
      return { utterance: req.intent.description, acts: [] };
  }
}

/** Mood-coloured reconstruction: in a low mood, faded details come back harsher; in a good mood, softer. */
const HARSHER: [RegExp, string][] = [
  [/was an hour late/, "was hours late"],
  [/an hour/, "hours"],
  [/was getting worse/, "was already on top of us"],
  [/I tied the boat down myself before he got there/, "I had to tie the boat down alone, in the dark"],
  [/half of them are ruined/, "most of them are ruined"],
  [/half of what he promised/, "next to nothing"],
  [/three days/, "a day or so"],
  [/he wouldn't take any money for it/, "he didn't ask for much"],
];
const SOFTER: [RegExp, string][] = [
  [/was hours late/, "was a bit late"],
  [/was an hour late/, "was a little late"],
  [/three days/, "most of a week"],
];

export function mockReconstruct(req: ReconstructRequest): ReconstructResponse {
  const rules = req.mood < -0.12 ? HARSHER : req.mood > 0.25 ? SOFTER : [];
  for (const [re, to] of rules) {
    if (re.test(req.fadedValue)) {
      return { value: req.fadedValue.replace(re, to), usedBeliefs: req.beliefs.slice(0, 1).map((b) => b.id) };
    }
  }
  return { value: req.fadedValue, usedBeliefs: [] };
}

export function mockDream(req: DreamRequest): DreamResponse {
  const byEntity = new Map<string, { id: string; valence: number }[]>();
  for (const r of req.replay) for (const a of r.about) byEntity.set(a, [...(byEntity.get(a) ?? []), { id: r.id, valence: r.valence }]);
  const generalizations: DreamResponse["generalizations"] = [];
  for (const [about, items] of byEntity) {
    for (const sign of [-1, 1]) {
      const same = items.filter((i) => Math.sign(i.valence) === sign);
      if (same.length < 2) continue;
      const name = cap(about);
      generalizations.push({
        about,
        proposition: sign < 0 ? `${name} isn't someone I can count on` : `${name} has been good to me`,
        valence: sign * 0.5,
        evidence: same.map((i) => i.id),
      });
    }
  }
  return { generalizations, lifeStory: req.lifeStory };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function createMockFaculties(): Faculties {
  return {
    perceive: async (r) => mockPerceive(r),
    deliberate: async (r) => mockDeliberate(r),
    speak: async (r) => mockSpeak(r),
    reconstruct: async (r) => mockReconstruct(r),
    dream: async (r) => mockDream(r),
  };
}
