// The butterfly: run the town on from the moment of a change twice, once with it and once without,
// with the same luck (keyed chance) and the same faculties (the offline mock), and set the two side by
// side. Every difference then comes from the change, either straight through the minds it touched
// (the ledger can trace it) or through what those people did differently (a ripple).

import { buildLedger, influence, nodeId } from "../ledger.js";
import type { Faculties } from "../ports.js";
import type { AgentId, Tick } from "../types.js";
import { applyEdit, type EditInput } from "./edits.js";
import { WorldSession } from "./session.js";
import type { WorldState, WorldTrace } from "./world.js";
import { yearOf } from "./life.js";

export interface Flip {
  agent: AgentId;
  tick: Tick;
  question: string;
  /** What they did with the change, and without it. */
  with: string;
  without: string;
  /** The ledger traces this choice back to the change itself; otherwise it came by way of a ripple. */
  traced: boolean;
  trace?: string;
}

export interface TownSide {
  people: number;
  births: number;
  deaths: number;
  store: number;
  houses: number;
  leader?: string;
  laws: number;
  norms: number;
  crafts: number;
  mood: number;
  /** How much people like each other on average. */
  warmth: number;
  /** How much the town likes the people who were changed. */
  likedChanged: number;
  talks: number;
  gossip: number;
}

export interface Butterfly {
  labels: string[];
  who: AgentId[];
  from: Tick;
  to: Tick;
  days: number;
  /** Choices both runs faced, how many came out differently, how many by the people changed, and how many the ledger traces to the change. */
  compared: number;
  flipped: number;
  flippedByChanged: number;
  traced: number;
  flips: Flip[];
  /** Moments that happened in only one run (a different encounter, a talk that never happened). */
  onlyWith: number;
  onlyWithout: number;
  /** Day by day: how many choices differed, so you can see it spread. */
  spread: { day: number; flips: number; people: number }[];
  /** People whose choices changed at least once, the changed first. */
  reached: AgentId[];
  liking: { from: AgentId; to: AgentId; with: number; without: number }[];
  town: { with: TownSide; without: TownSide };
  /** Plain-language summary, built from the numbers above. */
  story: string[];
  /** Names of everyone in either run (some are born in only one of them). */
  names: Record<AgentId, string>;
}

const choices = (traces: WorldTrace[]) => {
  const out = new Map<string, { agent: AgentId; tick: Tick; question: string; label: string; trace: string }>();
  for (const { agent, trace: t } of traces) {
    const d = t.decision;
    if (!d || d.options.length < 2) continue;
    // The question names the answer ("Why did Jun hold back?"), so the moment is keyed by the options on the table.
    const key = `${agent}|${t.tick}|${d.options.map((o) => o.id).sort().join(",")}`;
    out.set(key, { agent, tick: t.tick, question: t.percept?.gist ?? t.headline.question, label: d.options.find((o) => o.id === d.choice)?.label ?? d.choice, trace: t.id });
  }
  return out;
};

function side(w: WorldState, s: WorldSession, from: Tick, changed: AgentId[]): TownSide {
  const v = w.village;
  const living = w.order;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const life = v ? Object.values(v.life) : [];
  return {
    people: living.length,
    births: life.filter((l) => l.born >= from).length,
    deaths: life.filter((l) => l.died !== undefined && l.died >= from).length,
    store: Math.round(v?.store.food ?? 0),
    houses: v ? Object.values(v.households).filter((h) => h.shelter === "house").length : 0,
    leader: v?.civic?.leader,
    laws: v?.civic?.laws.length ?? 0,
    norms: v?.norms.filter((n) => n.established).length ?? 0,
    crafts: v?.knowledge ? new Set(Object.values(v.knowledge.known).flat().map((k) => k.craft)).size : 0,
    mood: Number(mean(living.map((id) => w.minds[id]!.affect.mood.valence)).toFixed(3)),
    warmth: Number(mean(living.flatMap((id) => living.filter((o) => o !== id && w.minds[id]!.others[o]).map((o) => w.minds[id]!.others[o]!.liking))).toFixed(3)),
    likedChanged: Number(mean(living.flatMap((id) => changed.filter((c) => c !== id && w.minds[id]!.others[c]).map((c) => w.minds[id]!.others[c]!.liking))).toFixed(3)),
    talks: s.feed.filter((f) => f.kind === "talk").length,
    gossip: s.feed.filter((f) => f.kind === "talk" && /passed on a story|told .* something/.test(f.title)).length,
  };
}

/**
 * Run `days` on from `before` twice: once with the edits applied, once without. Both runs use keyed
 * luck and the given faculties (use the mock: same answers for the same question, and free).
 */
export async function butterfly(before: WorldState, edits: EditInput[], faculties: Faculties, days = 4, step = 60, onDay?: (day: number) => void | Promise<void>): Promise<Butterfly | undefined> {
  const base = structuredClone(before);
  base.keyedLuck = true;
  const opts = { keepRecent: 0, keepDays: 0 };
  const w = new WorldSession(base, faculties, opts);
  const o = new WorldSession(base, faculties, opts);
  const records = [];
  for (const e of edits) {
    const r = applyEdit(w.world, e, { feed: w.feed, traces: w.traces });
    if (r) records.push(r);
  }
  if (!records.length) return undefined;
  const who = [...new Set(records.flatMap((r) => r.who))];
  const from = before.tick;
  const spread: Butterfly["spread"] = [];
  for (let d = 1; d <= days; d++) {
    for (let t = 0; t < 1440 / step; t++) {
      await w.apply({ type: "advance", minutes: step }, { snapshot: false });
      await o.apply({ type: "advance", minutes: step }, { snapshot: false });
    }
    const A = choices(w.traces);
    const B = choices(o.traces);
    let flips = 0;
    const people = new Set<AgentId>();
    for (const [k, x] of A) {
      const y = B.get(k);
      if (y && y.label !== x.label && x.tick > from + (d - 1) * 1440) {
        flips++;
        people.add(x.agent);
      }
    }
    spread.push({ day: d, flips, people: people.size });
    await onDay?.(d);
  }

  const A = choices(w.traces);
  const B = choices(o.traces);
  const L = buildLedger({ minds: w.world.minds, traces: w.traces, rumors: w.world.rumors, events: w.world.events, village: w.world.village, edits: w.world.edits });
  const reach = new Set<string>();
  for (const r of records) for (const d of influence(L, nodeId.world(r.id))?.decisions ?? []) reach.add(d.node.id);
  const flips: Flip[] = [];
  let compared = 0;
  for (const [k, x] of A) {
    const y = B.get(k);
    if (!y) continue;
    compared++;
    if (x.label === y.label) continue;
    flips.push({ agent: x.agent, tick: x.tick, question: x.question, with: x.label, without: y.label, traced: reach.has(nodeId.decision(x.agent, x.trace)), trace: x.trace });
  }
  flips.sort((p, q) => Number(who.includes(q.agent)) - Number(who.includes(p.agent)) || Number(q.traced) - Number(p.traced) || p.tick - q.tick);
  const reached = [...new Set(flips.map((f) => f.agent))].sort((p, q) => Number(who.includes(q)) - Number(who.includes(p)));
  const liking: Butterfly["liking"] = [];
  for (const id of w.world.order) {
    const ma = w.world.minds[id]!;
    const mb = o.world.minds[id];
    if (!mb) continue;
    for (const [x, r] of Object.entries(ma.others)) {
      const y = mb.others[x]?.liking;
      if (y !== undefined && w.world.minds[x] && Math.abs(y - r.liking) >= 0.03) liking.push({ from: id, to: x, with: Number(r.liking.toFixed(2)), without: Number(y.toFixed(2)) });
    }
  }
  liking.sort((p, q) => Math.abs(q.with - q.without) - Math.abs(p.with - p.without));
  const town = { with: side(w.world, w, from, who), without: side(o.world, o, from, who) };
  const out: Butterfly = {
    labels: records.map((r) => r.label),
    who,
    from,
    to: w.world.tick,
    days,
    compared,
    flipped: flips.length,
    flippedByChanged: flips.filter((f) => who.includes(f.agent)).length,
    traced: flips.filter((f) => f.traced).length,
    flips: flips.slice(0, 60),
    onlyWith: [...A.keys()].filter((k) => !B.has(k)).length,
    onlyWithout: [...B.keys()].filter((k) => !A.has(k)).length,
    spread,
    reached,
    liking: liking.slice(0, 16),
    town,
    story: [],
    names: Object.fromEntries([...Object.values(o.world.minds), ...Object.values(w.world.minds)].map((m) => [m.id, m.name])),
  };
  out.story = tell(out, w.world, o.world);
  return out;
}

function tell(b: Butterfly, W: WorldState, O: WorldState): string[] {
  const name = (id: AgentId) => W.minds[id]?.name ?? O.minds[id]?.name ?? id;
  const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const out: string[] = [];
  const span = b.days >= 16 && W.village ? `${yearOf(W) - yearOf({ ...W, tick: b.from })} year${yearOf(W) - yearOf({ ...W, tick: b.from }) === 1 ? "" : "s"}` : `${b.days} day${b.days === 1 ? "" : "s"}`;
  const changed = b.flipped;
  if (!changed) {
    out.push(`Over ${span}, nobody chose differently. The change hasn't come up yet: it waits for the moments it bears on.`);
  } else {
    const mine = b.flips.filter((f) => b.who.includes(f.agent));
    const others = b.reached.filter((x) => !b.who.includes(x));
    out.push(`Over ${span}, ${changed} of ${b.compared} choices came out differently${b.flippedByChanged ? `, ${b.flippedByChanged === changed ? "all" : b.flippedByChanged} of them by ${b.who.length > 3 ? "the people you changed" : list(b.who.map(name))}` : ""}.`);
    if (others.length) out.push(`It reached ${others.length} other${others.length === 1 ? "" : "s"} you never touched: ${list(others.slice(0, 5).map(name))}${others.length > 5 ? " and more" : ""}.`);
    if (b.traced) out.push(b.traced === changed ? "The ledger traces every one of them straight back to your change." : `The ledger traces ${b.traced} straight back to your change; the other ${changed - b.traced} came by way of what people did differently.`);
    const first = mine[0] ?? b.flips[0]!;
    out.push(`First difference: ${name(first.agent)}, at “${first.question.replace(/\.$/, "")}”, chose “${first.with}” instead of “${first.without}”.`);
  }
  if (b.onlyWith + b.onlyWithout > 0) out.push(`${b.onlyWith} moments happened only with your change and ${b.onlyWithout} only without it: different meetings, different talks.`);
  const T = b.town;
  const diffs: string[] = [];
  if (T.with.store !== T.without.store) diffs.push(`the common store holds ${T.with.store} food instead of ${T.without.store}`);
  if (T.with.houses !== T.without.houses) diffs.push(`${T.with.houses} houses stand instead of ${T.without.houses}`);
  if (T.with.leader !== T.without.leader) diffs.push(`${T.with.leader ? name(T.with.leader) : "nobody"} leads instead of ${T.without.leader ? name(T.without.leader) : "nobody"}`);
  if (T.with.laws !== T.without.laws) diffs.push(`${T.with.laws} laws instead of ${T.without.laws}`);
  if (T.with.people !== T.without.people) diffs.push(`${T.with.people} people live there instead of ${T.without.people}`);
  if (T.with.crafts !== T.without.crafts) diffs.push(`${T.with.crafts} crafts are known instead of ${T.without.crafts}`);
  if (Math.abs(T.with.warmth - T.without.warmth) >= 0.005) diffs.push(`people like each other ${T.with.warmth > T.without.warmth ? "more" : "less"} (${T.with.warmth.toFixed(2)} vs ${T.without.warmth.toFixed(2)})`);
  if (Math.abs(T.with.likedChanged - T.without.likedChanged) >= 0.01) diffs.push(`the town likes ${b.who.length > 3 ? "the people you changed" : list(b.who.map(name))} ${T.with.likedChanged > T.without.likedChanged ? "more" : "less"} (${T.with.likedChanged.toFixed(2)} vs ${T.without.likedChanged.toFixed(2)})`);
  if (diffs.length) out.push(`By the end, ${list(diffs)}.`);
  else out.push("The town as a whole looks the same so far.");
  return out;
}
