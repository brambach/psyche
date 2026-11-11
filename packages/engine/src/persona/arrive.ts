// Bringing a real person into the world. Their reading becomes a mind like any other villager's:
// traits, attachment, how they see themselves, formative memories from before the crossing, the
// core beliefs those memories installed, goals from what they value, and a voice. Then a boat brings
// them in, alone, a stranger to everyone.
//
// Each piece that came from their writing is recorded the way a player's edit is (an EditRecord, with
// `source: "writing"` and the quote), and the mind's items point at it. So the causal ledger can walk a
// choice made years later in the village back through the core belief that tilted it, to the memory
// that installed it, to the sentence they wrote: "Juniper wrote: “When I was 12 my dad left...”".
// Nothing here decides anything; the engine runs them exactly as it runs everyone else.

import { episode } from "../seed.js";
import { nextId } from "../rng.js";
import { influence, nodeId, type Ledger } from "../ledger.js";
import { TRAIT_NAMES, type AgentId, type Episode, type Goal, type MindState, type Schema, type Tick, type TraitName } from "../types.js";
import { baseMind } from "../world/cast.js";
import type { EditRecord, MindEdit } from "../world/edits.js";
import { crossingMemory, mintBase, other, routineFor, TRADES, uniqueId } from "../world/people.js";
import type { FeedItem, Sink, WorldState } from "../world/world.js";
import type { Household } from "../world/village.js";
import type { PersonaReading } from "./types.js";

const DAY = 1440;

/** What the world keeps about someone who came from writing. */
export interface PersonaOrigin {
  id: AgentId;
  arrived: Tick;
  reading: PersonaReading;
  /** The edit records for each piece of the mind that came from the writing. */
  records: { id: string; kind: "trait" | "memory" | "belief" | "goal"; ref: string }[];
  /** Where each piece lives in the mind: reading id to mind item id. */
  items: Record<string, string>;
}

declare module "../world/world.js" {
  interface WorldState {
    /** People who came from their own writing, by id. */
    personas?: Record<AgentId, PersonaOrigin>;
  }
}

const first = (r: PersonaReading) => r.name.split(/\s+/)[0]!;
const short = (s: string, n = 110) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n)).replace(/[,;:]$/, "")}…`);

/**
 * Build the mind from a reading. `records` is filled with the provenance of each piece, to be
 * stored on the world; ids come from the world so edit ids stay unique.
 */
export function personaMind(world: WorldState, r: PersonaReading, id: AgentId, now: Tick): { mind: MindState; origin: PersonaOrigin; records: EditRecord[] } {
  const name = first(r);
  const records: EditRecord[] = [];
  const origin: PersonaOrigin = { id, arrived: now, reading: r, records: [], items: {} };
  const record = (kind: PersonaOrigin["records"][number]["kind"], ref: string, edit: MindEdit, label: string, quote?: string): string => {
    const rid = nextId(world, "edit");
    records.push({ id: rid, tick: now, who: [id], scope: "person", edit, label, notice: false, source: "writing", quote, persona: id });
    origin.records.push({ id: rid, kind, ref });
    return rid;
  };

  // Formative memories, set back in time, each remembered as lived.
  const episodes: Episode[] = r.memories.map((m) => {
    const eid = `ep_${id}_${m.id}`;
    const rid = record("memory", m.id, { kind: "implant", gist: m.gist, about: [], topics: m.topics, valence: m.valence }, `${name} wrote: “${short(m.quote.text)}”`, m.quote.text);
    const ep = episode({
      id: eid,
      tick: now - Math.round(m.yearsAgo * 365 * DAY),
      gist: m.gist,
      template: "",
      about: [],
      topics: m.topics.length ? m.topics : ["home"],
      valence: m.valence,
      arousal: m.arousal,
      rehearsed: [now - 300 * DAY, now - 40 * DAY],
      agency: /\b(i|me|my)\b/i.test(m.gist) && m.coping > 0.6 ? "self" : "circumstance",
    });
    ep.coping = m.coping;
    ep.edit = rid;
    origin.items[m.id] = eid;
    return ep;
  });

  // Core beliefs. A stated one cites the sentence; a learned one leads back through its memory.
  const schemas: Schema[] = r.beliefs.map((b) => {
    const sid = `sch_${id}_${b.id}`;
    const s: Schema = { id: sid, text: b.text, triggers: [...b.triggers], blameBias: b.blame, threatBias: b.threat, strength: b.strength };
    const ep = b.memory ? origin.items[b.memory] : undefined;
    if (ep) s.origin = [ep];
    if (b.kind === "stated" || !ep) {
      const q = b.evidence[0]?.text;
      s.edit = record("belief", b.id, { kind: "fear", text: b.text, triggers: b.triggers, threat: b.threat, blame: b.blame, strength: b.strength }, q ? `${name} wrote: “${short(q)}”` : `${name}'s writing: “${b.text}”`, q);
    }
    origin.items[b.id] = sid;
    return s;
  });

  // Goals from values, and the two every newcomer has.
  const goals: Goal[] = r.values.map((v, i) => {
    const gid = `g_${id}_v${i + 1}`;
    const q = v.evidence[0]?.text;
    const rid = record("goal", v.value, { kind: "goal", text: v.goal.text, tags: v.goal.tags, priority: v.goal.priority }, q ? `${name} wrote: “${short(q)}” (values ${v.value})` : `${name} values ${v.value}`, q);
    origin.items[v.value] = gid;
    return { id: gid, text: v.goal.text, tags: [...v.goal.tags], priority: v.goal.priority, progress: 0.05, invested: 0.1, rate: 0, edit: rid };
  });
  goals.push(
    { id: `g_${id}_roof`, text: "Get a roof over my head before winter", tags: ["house", "build", "winter", "shelter"], priority: 0.7, progress: 0.02, invested: 0.1, rate: 0 },
    { id: `g_${id}_fed`, text: "Keep myself fed", tags: ["food", "store", "hunger", "winter"], priority: 0.7, progress: 0.3, invested: 0.1, rate: 0 },
  );

  // Traits, each with the passage that showed it most.
  const traits = Object.fromEntries(TRAIT_NAMES.map((t) => [t, r.traits[t].value])) as Record<TraitName, number>;
  for (const t of TRAIT_NAMES) {
    const q = r.traits[t].evidence[0]?.text;
    record("trait", t, { kind: "trait", trait: t, value: r.traits[t].value }, `${name}'s writing reads ${t} ${r.traits[t].value.toFixed(2)}${q ? `: “${short(q, 90)}”` : ""}`, q);
  }

  const voice = [r.voice.description, r.voice.samples.length ? `Talks like this: ${r.voice.samples.map((s) => `“${s}”`).join(" ")}` : ""].filter(Boolean).join(" ");
  const trade = TRADES[r.trade.role] ?? "works where needed";
  const mind = baseMind(
    {
      id,
      name,
      pronouns: r.pronouns,
      identity: { summary: `${r.name}, ${r.age}. Came over to ${world.name} alone on a spring boat and ${trade}. ${r.summary}`, voice },
      traits,
      attachment: { anxiety: r.attachment.anxiety, avoidance: r.attachment.avoidance },
      needs: { autonomy: 0.6, competence: 0.5, relatedness: 0.45, energy: 0.85 },
      goals,
      self: { selfEsteem: r.self.selfEsteem, selfEfficacy: r.self.selfEfficacy, control: r.self.control, lifeStory: r.lifeStory },
      others: { visitor: other("visitor", "the visitor", 0.5, 0.5, 0) },
      episodes,
      beliefs: [],
      habits: [{ id: `hab_${id}_fire`, cue: "fire", action: "social", strength: Number((traits.extraversion * 0.6).toFixed(2)) }],
      schemas,
      mood: Number((0.1 - traits.neuroticism * 0.15).toFixed(2)),
      stress: 0.25,
    },
    (Math.imul(world.seed + 7919, 2654435761) ^ hash(id)) >>> 0,
    world.minds[world.order[0]!]?.ablations ?? {},
  );
  mind.tick = now;
  mind.lastSleep = now;
  mind.episodes.push(crossingMemory(mind, { rng: mind.rng ^ 0x9e3779b9 }, `ep_boat_${id}`, now - 2 * DAY));
  return { mind, origin, records };
}

/** A boat brings them in: a tent, a trade, a stranger to everyone. Returns their id. */
export function admitPersona(world: WorldState, reading: PersonaReading, sink: Sink): AgentId {
  const v = world.village;
  if (!v) throw new Error("Only a village or a town can take in a newcomer.");
  const taken = new Set([...Object.keys(world.minds), ...Object.keys(v.households), ...(v.reserved?.ids ?? [])]);
  const base = first(reading).toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "") || "newcomer";
  const id = uniqueId(mintBase(v, base), taken);
  const now = world.tick;
  const { mind, origin, records } = personaMind(world, reading, id, now);

  // A tent of their own, in the next free plot.
  const hid = uniqueId(mintBase(v, `${base}hh`), taken);
  const home = `home_${hid}`;
  const k = Object.keys(v.households).length + Object.keys(world.places).filter((p) => p.startsWith("home_")).length;
  const row = Math.floor(k / 5);
  world.places[home] = { id: home, name: `${mind.name}'s tent`, x: 32 + (k % 5) * 10 + (row % 2) * 5, y: 43 + (row % 3) * 8, social: false, outdoors: false, topics: ["home"] };
  const hh: Household = { id: hid, name: `${mind.name}'s household`, members: [id], home, food: 4, shelter: "tent", rate: 0 };
  v.households[hid] = hh;

  world.minds[id] = mind;
  world.order.push(id);
  world.agents[id] = { id, name: mind.name, role: reading.trade.role, place: "harbour", activity: "just off the boat", home, routine: routineFor(reading.trade.role, home), wants: [], lastTalk: {}, told: [] };
  const years = v.seasonDays * 4 * DAY;
  v.life[id] = { born: now - reading.age * years, parents: [], generation: 0, arrived: now };
  for (const o of world.order) {
    if (o === id) continue;
    const m = world.minds[o]!;
    m.others[id] ??= other(id, mind.name, 0.45, 0.45, 0);
    mind.others[o] = other(o, m.name, 0.45, 0.45, 0);
  }
  (world.edits ??= []).push(...records);
  (world.personas ??= {})[id] = origin;
  const item: FeedItem = { id: nextId(world, "f"), tick: now, kind: "event", place: "harbour", agents: [id], title: `A boat brings a stranger: ${mind.name}`, text: `${mind.name}, ${reading.age}, comes ashore alone at the landing and ${TRADES[reading.trade.role] ?? "looks for work"}. Nobody here knows ${mind.pronouns.object}.` };
  sink.feed.push(item);
  return id;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- their life since

export interface PersonaLife {
  id: AgentId;
  name: string;
  alive: boolean;
  arrived: Tick;
  /** Sim days since they came ashore. */
  days: number;
  role: string;
  shelter?: "tent" | "house";
  reading: PersonaReading;
  /**
   * Of the choices they've made here, how many a memory, core belief or value from their writing
   * reached. Their traits came from the writing too and touch nearly every choice, so they are
   * counted apart (`byTraits`).
   */
  choices: { total: number; fromWriting: number; byTraits: number };
  traits: { trait: TraitName; then: number; now: number; choices: number; record?: string }[];
  beliefs: { id: string; text: string; kind: "stated" | "learned"; quote?: string; then: number; now?: number; deepened: number; choices: number; record?: string; node?: string; recent: Moment[] }[];
  memories: { id: string; quote: string; gist: string; now?: string; rewritten: number; choices: number; record?: string; node?: string }[];
  goals: { text: string; value: string; progress?: number; choices: number; record?: string }[];
  /** People here they feel most and least for. */
  closest: { id: AgentId; name: string; liking: number; trust: number }[];
  coldest: { id: AgentId; name: string; liking: number; trust: number }[];
  /** New core beliefs the village gave them. */
  acquired: { text: string; strength: number }[];
  mood: number;
  lifeStory: { then: string; now: string };
  moments: { tick: Tick; title: string; text?: string }[];
}

interface Moment {
  label: string;
  tick: Tick;
  trace?: string;
  share: number;
}

/** Who they were when they came, and who they are now: what held, what drifted, and what it bent. */
export function personaLife(world: WorldState, L: Ledger, feed: FeedItem[], id: AgentId): PersonaLife | undefined {
  const o = world.personas?.[id];
  if (!o) return undefined;
  const m = world.minds[id];
  const r = o.reading;
  const rec = (kind: string, ref: string) => o.records.find((x) => x.kind === kind && x.ref === ref)?.id;
  const reach = (rid?: string) => (rid ? influence(L, nodeId.world(rid)) : undefined);
  const mine = (inf?: ReturnType<typeof influence>) => (inf?.decisions ?? []).filter((d) => d.node.agent === id);
  const reached = new Set<string>();
  const byTraits = new Set<string>();
  const count = (rid?: string, into = reached) => {
    const ds = mine(reach(rid));
    for (const d of ds) into.add(d.node.id);
    return ds;
  };
  const total = [...L.nodes.values()].filter((n) => n.kind === "decision" && n.agent === id && n.tick >= o.arrived).length;

  const traits = TRAIT_NAMES.map((t) => {
    const rid = rec("trait", t);
    return { trait: t, then: r.traits[t].value, now: Number((m?.traits[t] ?? r.traits[t].value).toFixed(2)), choices: count(rid, byTraits).length, record: rid };
  });
  const beliefs = r.beliefs.map((b) => {
    const sid = o.items[b.id]!;
    const s = m?.schemas.find((x) => x.id === sid);
    const rid = rec("belief", b.id);
    // A learned belief's reach runs through the memory that installed it.
    const via = rid ?? (b.memory ? rec("memory", b.memory) : undefined);
    const own = count(rid);
    const node = nodeId.item(id, sid);
    const fromNode = mine(influence(L, node));
    for (const d of fromNode) reached.add(d.node.id);
    const ds = fromNode.length ? fromNode : own;
    return {
      id: b.id,
      text: b.text,
      kind: b.kind,
      quote: b.evidence[0]?.text ?? r.memories.find((x) => x.id === b.memory)?.quote.text,
      then: b.strength,
      now: s ? Number(s.strength.toFixed(2)) : undefined,
      deepened: s?.deepenedBy?.length ?? 0,
      choices: ds.length,
      record: via,
      node: L.nodes.has(node) ? node : undefined,
      recent: ds.sort((x, y) => y.node.tick - x.node.tick).slice(0, 4).map((d) => ({ label: d.node.label, tick: d.node.tick, trace: d.node.trace, share: Number(d.share.toFixed(2)) })),
    };
  });
  const memories = r.memories.map((x) => {
    const eid = o.items[x.id]!;
    const ep = m?.episodes.find((e) => e.id === eid);
    const rid = rec("memory", x.id);
    const node = nodeId.item(id, eid);
    return { id: x.id, quote: x.quote.text, gist: x.gist, now: ep ? ep.gist : undefined, rewritten: ep?.versions.length ?? 0, choices: count(rid).length, record: rid, node: L.nodes.has(node) ? node : undefined };
  });
  const goals = r.values.map((v) => {
    const rid = rec("goal", v.value);
    const g = m?.goals.find((x) => x.id === o.items[v.value]);
    return { text: v.goal.text, value: v.value, progress: g ? Number(g.progress.toFixed(2)) : undefined, choices: count(rid).length, record: rid };
  });
  const people = m
    ? Object.values(m.others)
        .filter((x) => world.minds[x.id] && x.id !== id)
        .map((x) => ({ id: x.id, name: x.name, liking: Number(x.liking.toFixed(2)), trust: Number(((x.trust.benevolence + x.trust.integrity) / 2).toFixed(2)) }))
    : [];
  const fromReading = new Set(r.beliefs.map((b) => o.items[b.id]));
  const life = world.village?.life[id];
  const hh = world.village && Object.values(world.village.households).find((h) => h.members.includes(id));
  return {
    id,
    name: m?.name ?? first(r),
    alive: !!m && !life?.died,
    arrived: o.arrived,
    days: Math.max(0, Math.floor((world.tick - o.arrived) / DAY)),
    role: world.agents[id]?.role ?? r.trade.role,
    shelter: hh?.shelter,
    reading: r,
    choices: { total, fromWriting: reached.size, byTraits: byTraits.size },
    traits,
    beliefs,
    memories,
    goals,
    closest: [...people].sort((a, b) => b.liking - a.liking).slice(0, 3),
    coldest: [...people].sort((a, b) => a.liking - b.liking).slice(0, 2).filter((p) => p.liking < 0.45),
    acquired: (m?.schemas ?? []).filter((s) => !fromReading.has(s.id)).map((s) => ({ text: s.text, strength: Number(s.strength.toFixed(2)) })),
    mood: Number((m?.affect.mood.valence ?? 0).toFixed(2)),
    lifeStory: { then: r.lifeStory, now: m?.self.lifeStory ?? r.lifeStory },
    moments: feed
      .filter((f) => f.agents.includes(id) && (f.kind === "event" || f.kind === "insight") && f.tick >= o.arrived)
      .slice(-14)
      .reverse()
      .map((f) => ({ tick: f.tick, title: f.title, text: f.text })),
  };
}
