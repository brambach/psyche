// Editing minds while the world runs. Each edit is a recorded session input, so a world with edits
// replays exactly, and each one leaves provenance on what it made (a core belief, a thought, a
// memory, a goal, a lock on a trait) so the ledger can answer "why" with "because you…".
//
// The person edited never learns where the change came from. With `notice`, they feel that something
// in them shifted; without it, the change is simply who they are now.

import { clamp } from "../memory.js";
import { nextId } from "../rng.js";
import { TRAIT_NAMES, type AgentId, type Episode, type MindState, type Schema, type Tick, type TraitName } from "../types.js";
import { other } from "./people.js";
import type { FeedItem, Sink, WorldState } from "./world.js";

export type MindEdit =
  /** Set a trait. With `lock`, nightly drift can't move it; with `heritable`, children are born with the lock too. */
  | { kind: "trait"; trait: TraitName; value: number; lock?: boolean; heritable?: boolean }
  | { kind: "unlock"; trait: TraitName }
  /** Give someone a core belief (a fear, or its opposite). `heritable` passes it to children born after. */
  | { kind: "fear"; text: string; triggers: string[]; threat: number; blame: number; strength: number; heritable?: boolean }
  /** Take a core belief away. */
  | { kind: "unfear"; text: string }
  | { kind: "goal"; text: string; tags: string[]; priority: number }
  | { kind: "drop-goal"; text: string }
  /** How they feel about one other person. */
  | { kind: "regard"; other: AgentId; liking?: number; trust?: number }
  /** Make them forget a memory. */
  | { kind: "erase"; episode: string }
  /** Give them a memory of something that never happened. They believe they lived it. */
  | { kind: "implant"; gist: string; about: AgentId[]; topics: string[]; valence: number }
  /** A thought they take for their own. */
  | { kind: "whisper"; text: string; about: string; topics: string[]; valence: number };

export interface EditInput {
  /** One person, or "*" for everyone living in the town. */
  who: AgentId | "*";
  edit: MindEdit;
  /** They feel the change, without knowing why. */
  notice?: boolean;
}

export interface EditRecord {
  id: string;
  tick: Tick;
  who: AgentId[];
  scope: "person" | "town";
  edit: MindEdit;
  /** In plain words, from the player's side: "You gave Mara a fear: …". */
  label: string;
  notice: boolean;
  /** Not a player's change: this piece of a mind was read from the person's own writing (see persona/). */
  source?: "writing";
  /** The words it was read from. */
  quote?: string;
  /** Whose writing. */
  persona?: AgentId;
}

/** Ready-made core beliefs, with triggers on the topics the world actually uses. */
export const FEARS: { text: string; triggers: string[]; threat: number; blame: number; hint: string }[] = [
  { text: "There will never be enough food", triggers: ["food", "store", "winter", "harvest", "hunger"], threat: 0.35, blame: 0.1, hint: "Holds back from the common store; frets before winter." },
  { text: "People only help when it suits them", triggers: ["help", "fairness", "trust", "store"], threat: 0.1, blame: 0.35, hint: "Reads kindness as a trick; slower to give." },
  { text: "Strangers will cheat you", triggers: ["trade", "market", "money", "fairness"], threat: 0.15, blame: 0.3, hint: "Wary of other towns and their traders." },
  { text: "The sea takes what it's owed", triggers: ["sea", "storm", "boat", "catch", "dock"], threat: 0.35, blame: 0, hint: "Afraid of the water and of storms." },
  { text: "Everyone I love leaves", triggers: ["love", "family", "death", "grief", "home"], threat: 0.3, blame: 0.05, hint: "Clings, then pulls away first." },
  { text: "People look down on me", triggers: ["reputation", "respect", "market", "stories"], threat: 0.1, blame: 0.3, hint: "Takes slights where none were meant." },
  { text: "People are good at heart", triggers: ["help", "fairness", "trust", "store", "trade"], threat: -0.1, blame: -0.3, hint: "Gives the benefit of the doubt, even when it costs." },
  { text: "We look after our own", triggers: ["family", "help", "home", "store"], threat: -0.15, blame: -0.15, hint: "Warm to kin and neighbours." },
];

/** Whole-personality changes, as a list of edits. */
export const PRESETS: { id: string; label: string; hint: string; edits: MindEdit[] }[] = [
  { id: "generous", label: "Generous", hint: "Agreeable and honest; believes the best of people.", edits: [{ kind: "trait", trait: "agreeableness", value: 0.9 }, { kind: "trait", trait: "honesty", value: 0.9 }, { kind: "fear", ...pick("People are good at heart"), strength: 0.6 }] },
  { id: "suspicious", label: "Suspicious", hint: "Cold and wary; sure people only help when it suits them.", edits: [{ kind: "trait", trait: "agreeableness", value: 0.15 }, { kind: "fear", ...pick("People only help when it suits them"), strength: 0.7 }] },
  { id: "anxious", label: "Anxious", hint: "Highly strung, and sure the food will run out.", edits: [{ kind: "trait", trait: "neuroticism", value: 0.92 }, { kind: "fear", ...pick("There will never be enough food"), strength: 0.7 }] },
  { id: "bold", label: "Bold", hint: "Calm, outgoing, unafraid.", edits: [{ kind: "trait", trait: "neuroticism", value: 0.1 }, { kind: "trait", trait: "extraversion", value: 0.85 }] },
  { id: "curious", label: "Curious", hint: "Open and careful: the kind who works new crafts out.", edits: [{ kind: "trait", trait: "openness", value: 0.95 }, { kind: "trait", trait: "conscientiousness", value: 0.85 }] },
  { id: "loner", label: "Loner", hint: "Keeps to themselves; rarely teaches what they know.", edits: [{ kind: "trait", trait: "extraversion", value: 0.08 }, { kind: "trait", trait: "agreeableness", value: 0.3 }] },
];

function pick(text: string) {
  const f = FEARS.find((x) => x.text === text)!;
  return { text: f.text, triggers: f.triggers, threat: f.threat, blame: f.blame };
}

const WORDS: [RegExp, string[]][] = [
  [/food|hung|starv|eat|bread|grain|barley|harvest|store/, ["food", "store", "hunger", "harvest"]],
  [/winter|cold|frost/, ["winter"]],
  [/sea|water|drown|storm|boat|wave|tide|fish/, ["sea", "storm", "boat", "catch"]],
  [/trade|stranger|outsider|market|money|cheat|sell|buy/, ["trade", "market", "money"]],
  [/help|kind|good|trust|fair|share|give/, ["help", "fairness", "trust"]],
  [/love|leave|alone|lonely|family|child|mother|father|home/, ["love", "family", "home"]],
  [/die|death|dead|grief|lose|loss/, ["death", "grief"]],
  [/respect|look down|laugh|reputation|shame|stupid|worthless/, ["reputation", "respect"]],
  [/build|house|roof|stone|timber/, ["build", "house", "roof"]],
];

/**
 * Shape a core belief someone wrote in their own words: which topics set it off, and whether it makes
 * the world look more dangerous (threat) or people more to blame (blame), or the opposite.
 */
export function shapeFear(text: string): { text: string; triggers: string[]; threat: number; blame: number } {
  const t = text.toLowerCase();
  const triggers = [...new Set(WORDS.filter(([re]) => re.test(t)).flatMap(([, ts]) => ts))];
  const hopeful = /good|kind|safe|enough|always help|trust|love me|belong|look after/.test(t) && !/never|n't|not|no one|nobody/.test(t);
  const people = /people|they|everyone|nobody|no one|stranger|folk|neighbou?r|others/.test(t);
  const sign = hopeful ? -1 : 1;
  return {
    text: text.trim().replace(/\.$/, ""),
    triggers: triggers.length ? triggers : ["help", "family", "store"],
    threat: Number((sign * (people ? 0.1 : 0.3)).toFixed(2)),
    blame: Number((sign * (people ? 0.3 : 0.05)).toFixed(2)),
  };
}

const TRAIT_WORD: Record<TraitName, [string, string]> = {
  openness: ["more curious", "less curious"],
  conscientiousness: ["more careful", "less careful"],
  extraversion: ["more outgoing", "more withdrawn"],
  agreeableness: ["kinder", "harder"],
  neuroticism: ["more anxious", "calmer"],
  honesty: ["more honest", "less honest"],
};

function describe(world: WorldState, who: AgentId[], scope: "person" | "town", e: MindEdit, before?: number): string {
  const name = (id: AgentId) => world.minds[id]?.name ?? id;
  const whom = scope === "town" ? `everyone in ${world.name}` : name(who[0]!);
  switch (e.kind) {
    case "trait": {
      const up = before === undefined || e.value >= before;
      return `You made ${whom} ${TRAIT_WORD[e.trait][up ? 0 : 1]} (${e.trait} ${e.value.toFixed(2)}${e.lock ? ", locked" : ""}${e.heritable ? ", passed to their children" : ""})`;
    }
    case "unlock":
      return `You let ${whom}'s ${e.trait} drift again`;
    case "fear":
      return `You gave ${whom} the core belief “${e.text}”${e.heritable ? ", to pass on to their children" : ""}`;
    case "unfear":
      return `You took the core belief “${e.text}” from ${whom}`;
    case "goal":
      return `You gave ${whom} a goal: ${e.text}`;
    case "drop-goal":
      return `You made ${whom} give up: ${e.text}`;
    case "regard": {
      const parts = [e.liking !== undefined ? `like ${name(e.other)} ${e.liking >= 0.5 ? "more" : "less"} (${e.liking.toFixed(2)})` : "", e.trust !== undefined ? `trust ${name(e.other)} ${e.trust >= 0.5 ? "more" : "less"} (${e.trust.toFixed(2)})` : ""].filter(Boolean);
      return `You made ${whom} ${parts.join(" and ")}`;
    }
    case "erase":
      return `You made ${whom} forget a memory`;
    case "implant":
      return `You gave ${whom} a memory that never happened: “${e.gist}”`;
    case "whisper":
      return `You whispered to ${whom}: “${e.text}”`;
  }
}

/** Apply an edit to the minds it names. Returns the record, or undefined if there was nobody to edit. */
export function applyEdit(world: WorldState, input: EditInput, sink: Sink): EditRecord | undefined {
  const scope = input.who === "*" ? "town" : "person";
  const who = input.who === "*" ? world.order.filter((id) => world.minds[id]) : world.minds[input.who] ? [input.who] : [];
  if (!who.length) return undefined;
  const e = input.edit;
  const id = nextId(world, "edit");
  const before = e.kind === "trait" ? world.minds[who[0]!]!.traits[e.trait] : undefined;
  for (const a of who) editMind(world, world.minds[a]!, e, id);
  const rec: EditRecord = { id, tick: world.tick, who, scope, edit: structuredClone(e), label: describe(world, who, scope, e, before), notice: !!input.notice };
  (world.edits ??= []).push(rec);
  if (input.notice) for (const a of who) feelIt(world, world.minds[a]!, id);
  const item: FeedItem = { id: nextId(world, "f"), tick: world.tick, kind: "insight", agents: who.slice(0, 3), title: rec.label, text: input.notice ? "They feel something in them has shifted, and can't say why." : "They don't know anything changed." };
  sink.feed.push(item);
  return rec;
}

function editMind(world: WorldState, m: MindState, e: MindEdit, edit: string): void {
  const now = world.tick;
  switch (e.kind) {
    case "trait": {
      m.traits[e.trait] = clamp(e.value);
      m.locks = (m.locks ?? []).filter((l) => l.trait !== e.trait);
      if (e.lock) m.locks.push({ trait: e.trait, value: clamp(e.value), heritable: e.heritable, edit });
      if (!m.locks.length) delete m.locks;
      return;
    }
    case "unlock":
      m.locks = (m.locks ?? []).filter((l) => l.trait !== e.trait);
      if (!m.locks.length) delete m.locks;
      return;
    case "fear": {
      const s = m.schemas.find((x) => x.text === e.text);
      if (s) {
        s.strength = clamp(Math.max(s.strength, e.strength));
        s.edit = edit;
        if (e.heritable) s.heritable = true;
        return;
      }
      m.schemas.push({ id: nextId(m, "sch"), text: e.text, triggers: [...e.triggers], blameBias: e.blame, threatBias: e.threat, strength: clamp(e.strength), edit, heritable: e.heritable || undefined });
      return;
    }
    case "unfear":
      m.schemas = m.schemas.filter((x) => x.text !== e.text);
      return;
    case "goal":
      if (!m.goals.some((g) => g.text === e.text)) m.goals.push({ id: nextId(m, "g"), text: e.text, tags: [...e.tags], priority: clamp(e.priority), progress: 0, invested: 0, rate: 0, edit });
      return;
    case "drop-goal":
      m.goals = m.goals.filter((g) => g.text !== e.text);
      return;
    case "regard": {
      if (e.other === m.id || !world.minds[e.other]) return;
      const o = (m.others[e.other] ??= other(e.other, world.minds[e.other]!.name, 0.5, 0.5, 0.1));
      if (e.liking !== undefined) o.liking = clamp(e.liking);
      if (e.trust !== undefined) {
        o.trust.benevolence = clamp(e.trust);
        o.trust.integrity = clamp(e.trust);
      }
      o.edit = edit;
      return;
    }
    case "erase":
      m.episodes = m.episodes.filter((x) => x.id !== e.episode);
      for (const b of m.beliefs) b.evidence = b.evidence.filter((x) => x !== e.episode);
      return;
    case "implant": {
      const ep: Episode = {
        id: nextId(m, "ep"),
        // Set a little in the past, as if it had always been there.
        tick: now - 30 * 1440,
        gist: e.gist,
        template: "",
        about: e.about.filter((x) => x === m.id || m.others[x]),
        topics: [...e.topics],
        valence: e.valence,
        valenceAtEncoding: e.valence,
        arousal: 0.6,
        // They believe they saw it. Only the record knows otherwise.
        source: { kind: "witnessed" },
        details: [],
        retrievals: [now - 30 * 1440, now],
        versions: [],
        replays: 1,
        coping: 0.5,
        agency: "other",
        edit,
      };
      m.episodes.push(ep);
      return;
    }
    case "whisper":
      m.beliefs.push({ id: nextId(m, "bel"), about: e.about, topics: [...e.topics], proposition: e.text, confidence: 0.7, valence: e.valence, source: { kind: "inferred" }, formed: now, evidence: [], retrievals: [now], edit });
      return;
  }
}

/** Noticing: a small unsettling moment, remembered as their own. */
function feelIt(world: WorldState, m: MindState, edit: string): void {
  m.affect.emotions.fear = clamp(m.affect.emotions.fear + 0.15);
  m.affect.arousal = clamp(m.affect.arousal + 0.15);
  m.episodes.push({
    id: nextId(m, "ep"),
    tick: world.tick,
    gist: "Something in me shifted today, and I can't say what",
    template: "",
    about: [m.id],
    topics: ["self"],
    valence: -0.2,
    valenceAtEncoding: -0.2,
    arousal: 0.5,
    source: { kind: "inferred" },
    details: [],
    retrievals: [world.tick],
    versions: [],
    replays: 0,
    coping: 0.4,
    agency: "circumstance",
    edit,
  });
}

/** What a newborn takes from parents who were edited: heritable core beliefs and heritable locks. */
export function inheritEdits(child: MindState, parents: MindState[]): void {
  const schemas: Schema[] = [];
  for (const p of parents) {
    for (const s of p.schemas) {
      if (!s.heritable || schemas.some((x) => x.text === s.text) || child.schemas.some((x) => x.text === s.text)) continue;
      schemas.push({ id: nextId(child, "sch"), text: s.text, triggers: [...s.triggers], blameBias: s.blameBias, threatBias: s.threatBias, strength: Number(clamp(s.strength * 0.8).toFixed(2)), edit: s.edit, heritable: true });
    }
  }
  child.schemas.push(...schemas);
  const locks = parents.flatMap((p) => (p.locks ?? []).filter((l) => l.heritable));
  for (const l of locks) {
    if (child.locks?.some((x) => x.trait === l.trait)) continue;
    (child.locks ??= []).push({ ...l });
    child.traits[l.trait] = l.value;
  }
}

/** For the editor: someone's editable state at a glance. */
export function editable(world: WorldState, id: AgentId) {
  const m = world.minds[id];
  if (!m) return undefined;
  return {
    id,
    name: m.name,
    traits: Object.fromEntries(TRAIT_NAMES.map((t) => [t, Number(m.traits[t].toFixed(2))])) as Record<TraitName, number>,
    locks: (m.locks ?? []).map((l) => ({ trait: l.trait, heritable: !!l.heritable })),
    schemas: m.schemas.map((s) => ({ text: s.text, strength: Number(s.strength.toFixed(2)), edited: !!s.edit, heritable: !!s.heritable })),
    goals: m.goals.map((g) => ({ text: g.text, priority: Number(g.priority.toFixed(2)), edited: !!g.edit })),
    others: Object.values(m.others)
      .filter((o) => world.minds[o.id])
      .map((o) => ({ id: o.id, name: o.name, liking: Number(o.liking.toFixed(2)), trust: Number(o.trust.benevolence.toFixed(2)), edited: !!o.edit }))
      .sort((a, b) => b.liking - a.liking),
    memories: [...m.episodes]
      .sort((a, b) => Math.abs(b.valence) * b.arousal - Math.abs(a.valence) * a.arousal)
      .slice(0, 12)
      .map((e) => ({ id: e.id, gist: e.gist, valence: Number(e.valence.toFixed(2)), implanted: !!e.edit && e.source.kind === "witnessed" })),
    edits: (world.edits ?? []).filter((r) => r.who.includes(id)).slice(-12).reverse(),
  };
}
