// Civic life in one town: a leader chosen each spring, laws written when a norm keeps being
// broken, and the founding story told every summer at the fire.
//
// Leadership is chosen from liking and trust, not from any score of merit: people vote for whom
// they like and believe means well (Fiske, Cuddy & Glick 2007, warmth before competence). A law is a
// norm made explicit when informal sanctions stop working (Ostrom 1990, graduated sanctions; Bicchieri
// 2006). Being made to give by law feels different from choosing to: it costs autonomy (Deci & Ryan
// 2000) and the resentment lands on whoever wrote the law.
//
// The founding story is the town's myth. Each summer the eldest who carries a version of it tells it
// to everyone, and everyone who did not live it takes that version as theirs. Stories passed on this
// way drift and standardize, as in serial reproduction (Bartlett 1932), so towns that tell it from
// different mouths come to tell it differently.

import { clamp, render } from "../memory.js";
import { identityOf, runPercept } from "../mind.js";
import type { Faculties, Percept } from "../ports.js";
import { nextId } from "../rng.js";
import type { AgentId, Episode, MindState } from "../types.js";
import { ageOf, hearStory, isChild, normHeld, storeNorm } from "./life.js";
import { eventPercept, feed, personName, record, thirdPerson, type Sink, type WorldState } from "./world.js";
import type { Pledge, VillageState } from "./village.js";

export interface Law {
  id: string;
  /** The words, as written by whoever proposed it. */
  text: string;
  kind: "store_minimum";
  /** Share of the household's surplus that must go into the store each evening. */
  rate: number;
  author: AgentId;
  tick: number;
  votes: { for: AgentId[]; against: AgentId[] };
  passed: boolean;
  /** What it answers: the norm and the round of hold-backs that prompted it. */
  because: { norm: string; round: number; held: AgentId[] };
  /** Households made to give under it, with when. */
  compelled: { agent: AgentId; tick: number }[];
}

export interface Election {
  tick: number;
  leader: AgentId;
  votes: Record<AgentId, number>;
}

export interface Civic {
  leader?: AgentId;
  elections: Election[];
  laws: Law[];
  /** Summer days on which the founding story was told. */
  foundingDays: { tick: number; teller: AgentId; version: string }[];
}

export const civicOf = (v: VillageState): Civic => (v.civic ??= { elections: [], laws: [], foundingDays: [] });
const adults = (world: WorldState) => world.order.filter((x) => !isChild(world, x));

// ---------------------------------------------------------------- leaders

/** Each spring every adult names who they would follow: whom they like and trust to mean well. */
export function elect(world: WorldState, sink: Sink): Election | undefined {
  const v = world.village!;
  const c = civicOf(v);
  const voters = adults(world);
  if (voters.length < 3) return undefined;
  // Each adult names the three they would most willingly follow (approval voting, so a leader is
  // someone broadly liked rather than the favourite of a few).
  const votes: Record<AgentId, number> = {};
  for (const id of voters) {
    const m = world.minds[id]!;
    const ranked = voters
      .filter((o) => o !== id && m.others[o])
      .map((o) => {
        const r = m.others[o]!;
        // Elders get a little deference; the sitting leader a little more.
        return { o, s: r.liking * 0.6 + r.trust.benevolence * 0.4 + Math.min(ageOf(world, o), 60) / 600 + (o === c.leader ? 0.05 : 0) };
      })
      .sort((a, b) => b.s - a.s || a.o.localeCompare(b.o));
    for (const { o } of ranked.slice(0, 3)) votes[o] = (votes[o] ?? 0) + 1;
  }
  const leader = Object.entries(votes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (!leader) return undefined;
  const changed = leader !== c.leader;
  c.leader = leader;
  const e: Election = { tick: world.tick, leader, votes };
  c.elections.push(e);
  if (c.elections.length > 40) c.elections.splice(0, c.elections.length - 40);
  if (changed) feed(world, sink, { kind: "event", place: "tavern", agents: [leader], title: `${personName(world, leader)} is asked to lead ${world.name}`, text: `${votes[leader]} of ${voters.length} named ${personName(world, leader)} among those they would follow.` });
  return e;
}

// ---------------------------------------------------------------- laws

/**
 * After a pledge: if the store norm has taken hold and still a quarter or more held back, the leader
 * proposes making it law. Adults vote with their liking for the leader and how much they hold the norm.
 */
export async function considerLaw(world: WorldState, answers: Pledge[], faculties: Faculties, sink: Sink): Promise<Law | undefined> {
  const v = world.village!;
  const c = civicOf(v);
  const norm = storeNorm(v);
  if (!norm.established || !c.leader || !world.order.includes(c.leader)) return undefined;
  if (c.laws.some((l) => l.passed && l.kind === "store_minimum")) return undefined;
  const held = answers.filter((a) => a.option === "hold").map((a) => a.agent);
  if (held.length < Math.max(2, answers.length * 0.25)) return undefined;
  const last = c.laws.at(-1);
  if (last && world.tick - last.tick < v.seasonDays * 4 * 1440) return undefined;
  const L = world.minds[c.leader]!;
  const rate = 0.25;
  const text = (await faculties.speak({
    self: identityOf(L),
    listener: { id: "everyone", name: "everyone at the fire" },
    heard: "",
    intent: { option: "Propose a law", description: `Propose a rule for ${world.name}, in one or two plain sentences: every household puts a quarter of its surplus into the common store each evening, and the keeper sees that it does.` },
    content: [],
    style: { warmth: 0.4, curtness: 0.4, hedging: 0.1, verbosity: 0.4 },
    stance: ["You lead the village and you are putting a rule to a vote. Plain words, the rule itself."],
    salience: 0.95,
  })).utterance;
  const votes = { for: [] as AgentId[], against: [] as AgentId[] };
  for (const id of adults(world)) {
    if (id === c.leader) {
      votes.for.push(id);
      continue;
    }
    const m = world.minds[id]!;
    const lik = m.others[c.leader]?.liking ?? 0.5;
    const s = lik * 0.5 + normHeld(world, id) * 0.6 + m.traits.conscientiousness * 0.2 - (held.includes(id) ? 0.35 : 0) - m.needs.autonomy * 0.1;
    (s > 0.55 ? votes.for : votes.against).push(id);
  }
  const passed = votes.for.length > votes.against.length;
  const law: Law = { id: nextId(world, "law"), text, kind: "store_minimum", rate, author: c.leader, tick: world.tick, votes, passed, because: { norm: norm.id, round: v.pledges.length - 1, held }, compelled: [] };
  c.laws.push(law);
  feed(world, sink, {
    kind: "event",
    place: "tavern",
    agents: [c.leader, ...held.slice(0, 6)],
    title: passed ? `${world.name} makes the store a law` : `${world.name} votes down ${personName(world, c.leader)}'s law`,
    lines: [{ speaker: c.leader, text }],
    text: `${votes.for.length} for, ${votes.against.length} against.`,
  });
  // Everyone remembers the vote, and how it went for them.
  for (const id of adults(world)) {
    const m = world.minds[id]!;
    const yes = votes.for.includes(id);
    const outcome = passed === yes ? 0.15 : -0.2;
    const tr = await runPercept(m, eventPercept(m, c.leader, "other", outcome, 0.5, ["law", "store", "fairness", law.id], `${personName(world, c.leader)} put a law about the store to the vote and it ${passed ? "passed" : "failed"}.`, `${personName(world, c.leader)} proposes: "${text}" ${passed ? "It passes" : "It fails"}, ${votes.for.length} to ${votes.against.length}.`, law.id, [c.leader]), faculties);
    record(world, sink, id, tr);
  }
  return law;
}

/** Under the law, a household that pledged less than the minimum is made to put it in. */
export async function enforceLaws(world: WorldState, answers: Pledge[], faculties: Faculties, sink: Sink): Promise<AgentId[]> {
  const v = world.village!;
  const c = civicOf(v);
  const law = c.laws.find((l) => l.passed && l.kind === "store_minimum");
  if (!law) return [];
  const made: AgentId[] = [];
  for (const hh of Object.values(v.households)) {
    if (hh.rate >= law.rate) continue;
    hh.rate = law.rate;
    for (const a of answers.filter((x) => hh.members.includes(x.agent) && x.option !== "commit")) {
      made.push(a.agent);
      law.compelled.push({ agent: a.agent, tick: world.tick });
      const m = world.minds[a.agent]!;
      const by = world.order.includes(law.author) ? law.author : "world";
      const p = eventPercept(m, by, by === "world" ? "circumstance" : "other", -0.2, 0.5, ["law", "store", "food", "fairness", law.id], "I was made to put food into the store under the law.", `The keeper takes a quarter of ${personName(world, a.agent)}'s surplus for the store, under the law.`, `${law.id}_${world.tick}`, by === "world" ? [] : [by]);
      p.features.intentional = 0.7;
      m.needs.autonomy = clamp(m.needs.autonomy - 0.08);
      record(world, sink, a.agent, await runPercept(m, p, faculties));
    }
  }
  if (law.compelled.length > 200) law.compelled.splice(0, law.compelled.length - 200);
  if (made.length) feed(world, sink, { kind: "event", place: "store", agents: made.slice(0, 8), title: `The law takes its share`, text: `Made to put in a quarter: ${made.map((x) => personName(world, x)).join(", ")}.` });
  return made;
}

// ---------------------------------------------------------------- the founding story

/** Follow told-by pointers back to the first-hand memory a story began as. */
export function rootOf(minds: Record<AgentId, MindState>, agent: AgentId, ep: Episode): { agent: AgentId; episode: Episode; hops: number } {
  let at = { agent, episode: ep };
  let hops = 0;
  const seen = new Set<string>();
  while (at.episode.source.kind === "told" && at.episode.source.from && at.episode.source.ref && !seen.has(`${at.agent}/${at.episode.id}`)) {
    seen.add(`${at.agent}/${at.episode.id}`);
    const next = minds[at.episode.source.from]?.episodes.find((e) => e.id === at.episode.source.ref);
    if (!next) break;
    at = { agent: at.episode.source.from, episode: next };
    hops++;
  }
  return { ...at, hops };
}

const isVersionOf = (minds: Record<AgentId, MindState>, id: AgentId, e: Episode, founding: string) =>
  e.source.kind === "told" && (e.topics.includes("founding") || e.topics.includes("crossing") || e.topics.includes("leaving")) && rootOf(minds, id, e).episode.id === founding;

/** This person's version of the founding story: their own memory of it, or the version they were told. */
export function foundingVersion(minds: Record<AgentId, MindState>, id: AgentId, founding: string): Episode | undefined {
  const m = minds[id];
  if (!m) return undefined;
  const own = m.episodes.find((e) => e.id === founding);
  if (own) return own;
  return m.episodes.filter((e) => isVersionOf(minds, id, e, founding)).sort((a, b) => b.tick - a.tick)[0];
}

/**
 * The first evening of summer: everyone comes to the fire and the eldest who carries the story tells
 * how the town began. Those who did not live it keep only the latest telling.
 */
export async function foundingDay(world: WorldState, founding: string, faculties: Faculties, sink: Sink): Promise<boolean> {
  const v = world.village!;
  const c = civicOf(v);
  const holders = world.order.map((id) => ({ id, ep: foundingVersion(world.minds, id, founding) })).filter((x) => x.ep);
  if (holders.length === 0) return false;
  const teller = holders.sort((a, b) => ageOf(world, b.id) - ageOf(world, a.id) || a.id.localeCompare(b.id))[0]!;
  const T = world.minds[teller.id]!;
  const told = teller.ep!;
  const version = thirdPerson(render(told), T.name, T.pronouns);
  const line = (await faculties.speak({
    self: identityOf(T),
    listener: { id: "everyone", name: "everyone at the fire" },
    heard: "",
    intent: { option: "Tell a story", description: `Tell the founding of ${world.name}, as it is told every first night of summer.` },
    content: [{ id: told.id, text: render(told) }],
    style: { warmth: 0.7, curtness: 0.1, hedging: 0.1, verbosity: 0.6 },
    stance: ["It is the first night of summer and the whole village is at the fire to hear how it began. Tell it as a story everyone knows."],
    salience: 0.7,
  })).utterance;
  c.foundingDays.push({ tick: world.tick, teller: teller.id, version });
  if (c.foundingDays.length > 60) c.foundingDays.splice(0, c.foundingDays.length - 60);
  const evId = nextId(world, "ev_founding");
  const listeners = world.order.filter((x) => x !== teller.id && world.minds[x]!.episodes.every((e) => e.id !== founding));
  for (const id of world.order) {
    const a = world.agents[id]!;
    a.place = "tavern";
    a.activity = "at the fire for the founding story";
  }
  for (const id of listeners) {
    const m = world.minds[id]!;
    // One version of the founding at a time: the new telling replaces the old.
    m.episodes = m.episodes.filter((e) => !isVersionOf(world.minds, id, e, founding));
    const p: Percept = {
      id: nextId(m, "pc"),
      tick: m.tick,
      kind: "speech",
      rawText: `${T.name}, at the fire on the first night of summer: "${line}"`,
      actor: teller.id,
      addressedToSelf: false,
      about: [],
      topics: ["founding", "crossing", "stories", "fire"],
      features: { outcomeForSelf: 0.1, agency: "circumstance", intentional: 0.2, normViolation: 0, prospective: false, intensity: 0.5 },
      claims: [],
      details: [],
      gist: version,
      eventId: evId,
    };
    const tr = await runPercept(m, p, faculties);
    hearStory(world, teller.id, told, id, tr, isChild(world, id) ? 0.1 : 0);
    const heard = m.episodes.find((e) => e.id === tr.encoded);
    if (heard && !heard.topics.includes("founding")) heard.topics.push("founding");
    record(world, sink, id, tr);
  }
  feed(world, sink, { kind: "talk", place: "tavern", agents: [teller.id, ...listeners.slice(0, 20)], title: `${T.name} tells how ${world.name} began`, lines: [{ speaker: teller.id, text: line }], text: `The first night of summer. The version told: “${version}”` });
  return true;
}
