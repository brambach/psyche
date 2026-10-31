// Knowledge. A craft is something one person works out and others can only get by being shown:
// how to smoke fish so it keeps, when the tides run, which herbs break a fever. It lives in people,
// not in the town. It passes from teacher to apprentice (mostly parent to child, as skills mostly
// did before writing; Henrich 2004), a trader can carry it to another town, and when the last
// person who knew it dies without having taught it, it is gone (the Tasmanian loss of fishing and
// cold-weather crafts, Henrich 2004, is the classic case). Each craft does one plain thing to the
// town's economy or health, so losing one shows.

import { nextRandom } from "../rng.js";
import type { AgentId, Tick } from "../types.js";
import { ageOf, isChild } from "./life.js";
import { feed, personName, type Sink, type Why, type WorldState } from "./world.js";

export type CraftEffect = "fish" | "farm" | "keep" | "health" | "build" | "boats";

export interface Craft {
  id: string;
  name: string;
  /** What knowing it does, in plain words. */
  does: string;
  /** What changes when it is lost. */
  without: string;
  effect: CraftEffect;
  /** How much it does: a yield multiplier, a share of spoilage or fevers avoided. */
  size: number;
}

export const CRAFTS: Craft[] = [
  { id: "smoking", name: "smoking fish", does: "food keeps longer", without: "food spoils as fast as it did in the first years", effect: "keep", size: 0.4 },
  { id: "tides", name: "the tide tables", does: "the boats come back fuller", without: "the boats go out on the wrong tides again", effect: "fish", size: 0.15 },
  { id: "fallow", name: "resting the fields", does: "the barley yields more", without: "the fields are worked to exhaustion again", effect: "farm", size: 0.2 },
  { id: "herbs", name: "herb lore", does: "fewer die of fevers", without: "a fever kills as often as it did", effect: "health", size: 0.35 },
  { id: "drystone", name: "drystone walling", does: "houses go up with less timber", without: "every house costs its full weight in timber", effect: "build", size: 0.3 },
  { id: "keels", name: "keel boats", does: "traders can carry more", without: "trade loads shrink back to what an open boat holds", effect: "boats", size: 0.5 },
  { id: "weather", name: "reading the weather", does: "fewer days are lost to gales", without: "the gales catch the boats out again", effect: "fish", size: 0.08 },
];
export const craft = (id: string) => CRAFTS.find((c) => c.id === id)!;

export interface Know {
  craft: string;
  tick: Tick;
  how: "worked out" | "taught" | "brought";
  /** Who showed them. */
  from?: AgentId;
  /** For a craft brought from elsewhere: the town it came from. */
  town?: string;
}

export interface KnowledgeEvent {
  tick: Tick;
  craft: string;
  kind: "found" | "lost" | "brought";
  agent?: AgentId;
  text: string;
  why: Why[];
}

export interface Knowledge {
  /** What each person knows, the living and the dead (the dead are how a loss is explained). */
  known: Record<AgentId, Know[]>;
  /** Crafts this town once had and no longer does, with when the last knower died. */
  lost: Record<string, Tick>;
  history: KnowledgeEvent[];
}

export const knowledgeOf = (world: WorldState): Knowledge => (world.village!.knowledge ??= { known: {}, lost: {}, history: [] });

export const knows = (world: WorldState, id: AgentId, c: string) => (world.village?.knowledge?.known[id] ?? []).some((k) => k.craft === c);

/** Crafts someone living in the town knows. */
export function townCrafts(world: WorldState): string[] {
  const k = world.village?.knowledge;
  if (!k) return [];
  return [...new Set(world.order.flatMap((id) => (k.known[id] ?? []).map((x) => x.craft)))];
}

/** The summed effect of the crafts the town knows: 0 when nobody alive knows any. */
export function craftBonus(world: WorldState, effect: CraftEffect): number {
  return townCrafts(world).map(craft).filter((c) => c.effect === effect).reduce((s, c) => s + c.size, 0);
}

/** Someone learns a craft, keeping who showed them. */
export function learn(world: WorldState, id: AgentId, k: Know): void {
  const K = knowledgeOf(world);
  const mine = (K.known[id] ??= []);
  if (mine.some((x) => x.craft === k.craft)) return;
  mine.push(k);
  delete K.lost[k.craft];
}

/**
 * What the first settlers brought with them: a craft for some of those whose trade it belongs to.
 * The rest have to be worked out here.
 */
export function seedKnowledge(world: WorldState): void {
  const fits: Record<string, string[]> = { tides: ["fisher"], fallow: ["farmer"], herbs: ["forager", "cook"], drystone: ["builder", "quarrier"] };
  for (const [c, roles] of Object.entries(fits)) {
    const who = world.order.filter((id) => roles.includes(world.agents[id]!.role)).sort((a, b) => world.minds[b]!.traits.conscientiousness - world.minds[a]!.traits.conscientiousness || a.localeCompare(b))[0];
    if (who) learn(world, who, { craft: c, tick: world.tick, how: "brought" });
  }
}

/** Carry what a group knows to a new town (the leavers' own knowledge, nothing more). */
export function carryKnowledge(from: Knowledge | undefined, ids: AgentId[]): Knowledge {
  const known: Record<AgentId, Know[]> = {};
  for (const id of ids) if (from?.known[id]) known[id] = structuredClone(from.known[id]!);
  return { known, lost: {}, history: [] };
}

/** Who taught whom, back to the person who worked it out (or brought it here). */
export function craftLineage(world: WorldState, id: AgentId, c: string): { agent: AgentId; name: string; how: Know["how"]; tick: Tick; town?: string }[] {
  const K = world.village?.knowledge;
  const out: { agent: AgentId; name: string; how: Know["how"]; tick: Tick; town?: string }[] = [];
  const seen = new Set<AgentId>();
  let at: AgentId | undefined = id;
  while (at && !seen.has(at)) {
    seen.add(at);
    const k: Know | undefined = K?.known[at]?.find((x) => x.craft === c);
    if (!k) break;
    out.push({ agent: at, name: personName(world, at), how: k.how, tick: k.tick, town: k.town });
    at = k.how === "taught" ? k.from : undefined;
  }
  return out;
}

/**
 * Once a season: losses are noticed, people teach, and now and then someone works something out.
 * Uses the world's own random stream, so a town's history replays exactly.
 */
export function knowledgeTurn(world: WorldState, sink: Sink): void {
  const v = world.village!;
  const K = knowledgeOf(world);
  const living = new Set(world.order);
  const year = v.seasonDays * 4 * 1440;

  // A loss: everyone who knew it is dead (or gone), and nobody was taught in time.
  const ever = new Set(Object.values(K.known).flatMap((ks) => ks.map((k) => k.craft)));
  for (const c of ever) {
    if (K.lost[c] !== undefined || world.order.some((id) => knows(world, id, c))) continue;
    const knowers = Object.keys(K.known).filter((id) => knows(world, id, c));
    const gone = knowers.map((id) => ({ id, died: v.life[id]?.died })).filter((x) => x.died !== undefined).sort((a, b) => b.died! - a.died!);
    const last = gone[0]?.id;
    K.lost[c] = world.tick;
    const C = craft(c);
    const why: Why[] = [];
    if (last) {
      const l = v.life[last]!;
      const age = Math.floor(ageOf(world, last));
      why.push({ agent: last, text: `${personName(world, last)} was the last in ${world.name} who knew ${C.name}, and died at ${age}${l.cause && l.cause !== "old age" ? ` of ${l.cause}` : ""}.` });
      const taught = Object.entries(K.known).filter(([, ks]) => ks.some((k) => k.craft === c && k.from === last)).map(([id]) => id);
      if (taught.length === 0) why.push({ agent: last, text: `${personName(world, last)} never taught it to anyone.${world.minds[last] ? ` (Agreeableness ${world.minds[last]!.traits.agreeableness.toFixed(2)}, extraversion ${world.minds[last]!.traits.extraversion.toFixed(2)}: the less of both, the less often someone teaches.)` : ""}` });
      else why.push({ text: `Those ${personName(world, last)} taught (${taught.map((x) => personName(world, x)).join(", ")}) had died or left first.` });
    } else why.push({ text: `Everyone who knew ${C.name} left ${world.name}.` });
    why.push({ text: `Without it, ${C.without}.` });
    const text = `Nobody left in ${world.name} knows ${C.name}.`;
    K.history.push({ tick: world.tick, craft: c, kind: "lost", agent: last, text, why });
    feed(world, sink, { kind: "event", agents: last ? [last] : [], title: `${cap(C.name)} is lost to ${world.name}`, text: `${text} ${why.map((w) => w.text).join(" ")}`, chronicle: { kind: "lost", why } });
  }

  // Teaching: each who knows a craft may show one person a season, their own children first.
  const adults = world.order.filter((id) => !isChild(world, id));
  for (const t of world.order) {
    if (ageOf(world, t) < 18) continue;
    const mine = K.known[t] ?? [];
    if (!mine.length) continue;
    const m = world.minds[t]!;
    if (nextRandom(world) > 0.15 + 0.3 * (m.traits.agreeableness + m.traits.extraversion) / 2) continue;
    const kin = world.order.filter((x) => v.life[x]?.parents.includes(t) && ageOf(world, x) >= 9);
    const home = Object.values(v.households).find((h) => h.members.includes(t))?.members.filter((x) => x !== t && ageOf(world, x) >= 9) ?? [];
    for (const k of mine) {
      const pool = [kin, home, adults.filter((x) => x !== t && (m.others[x]?.liking ?? 0.5) > 0.55)].map((xs) => xs.filter((x) => !knows(world, x, k.craft)));
      const group = pool.find((xs) => xs.length);
      if (!group) continue;
      const learner = group[Math.floor(nextRandom(world) * group.length)]!;
      learn(world, learner, { craft: k.craft, tick: world.tick, how: "taught", from: t });
      break;
    }
  }

  // Discovery, rare: a curious, careful adult works something out that nobody here knows.
  if (v.season === "autumn") {
    const have = new Set(townCrafts(world));
    const open = CRAFTS.filter((c) => !have.has(c.id));
    for (const id of adults) {
      if (!open.length) break;
      const m = world.minds[id]!;
      // A craft once known here is half-remembered, so easier to work out again.
      const p = 0.01 * (0.4 + m.traits.openness) * (0.5 + m.traits.conscientiousness);
      if (nextRandom(world) > p) continue;
      const c = open[Math.floor(nextRandom(world) * open.length)]!;
      const lostAt = K.lost[c.id];
      const again = lostAt !== undefined;
      learn(world, id, { craft: c.id, tick: world.tick, how: "worked out" });
      const why: Why[] = [{ agent: id, text: `${personName(world, id)} is curious and careful (openness ${m.traits.openness.toFixed(2)}, conscientiousness ${m.traits.conscientiousness.toFixed(2)}), the kind most likely to work things out.` }];
      if (again) {
        const ago = Math.round((world.tick - lostAt!) / year);
        why.push({ text: `${world.name} had known it before and lost it ${ago < 1 ? "within the year" : `${ago} ${ago === 1 ? "year" : "years"} ago`}.` });
      }
      const text = `${personName(world, id)} works out ${c.name}: ${c.does}.`;
      K.history.push({ tick: world.tick, craft: c.id, kind: "found", agent: id, text, why });
      feed(world, sink, { kind: "event", agents: [id], title: `${personName(world, id)} works out ${c.name}${again ? " again" : ""}`, text, chronicle: { kind: "craft", why } });
      break;
    }
  }
  if (K.history.length > 200) K.history.splice(0, K.history.length - 200);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
