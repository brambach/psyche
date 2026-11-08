// The aggregate tier (L3). A town nobody is watching does not need every hour of every day: it can
// run a season at a time on rules, and nobody's memories need writing out in words. The people stay
// themselves (their minds are kept, trimmed to what matters: core beliefs and the memories that
// formed them, the founding story as they tell it, what they think of the other towns, the people
// they are closest to), and the things that shape a town still happen to them: food, births and
// deaths, pairing, leaders, pledges and laws, crafts taught and lost, bedtime stories and the
// founding story every summer. When someone looks at the town again it is materialized: the same
// people, back on the hourly loop, carrying whatever the years gave them.
//
// Nothing here calls the model on its own. Deaths, births and pairings go through the same code as
// the live town (so the people around them remember them), with whatever cheap faculties the region
// gives an aggregated town; stories are passed on by rule, keeping who told whom, so a fear a child
// picks up here can be followed back exactly as it could be in a live town.
//
// Retelling drift follows Allport and Postman (1947): a story told again tends to be levelled (a
// detail dropped) or sharpened (a detail made bigger).

import { clamp, render } from "../memory.js";
import { dayOf } from "../mind.js";
import type { Faculties } from "../ports.js";
import { nextId, nextRandom } from "../rng.js";
import type { Trace } from "../trace.js";
import type { AgentId, Episode, MindState } from "../types.js";
import { civicOf, considerLaw, elect, enforceLaws, foundingVersion, rootOf, toldFrom } from "./civic.js";
import { craftBonus, knowledgeTurn } from "./knowledge.js";
import { ageOf, CHILDHOOD, hearStory, isChild, lifeTurn, normHeld, settleNorms, storeNorm, yearOf } from "./life.js";
import { CROSSING, other } from "./people.js";
import { GALE_CHANCE, JOBS, RATE, RATION, SEASON_YIELD, SPOIL, seasonOf, type Pledge } from "./village.js";
import { feed, thirdPerson, type Sink, type Why, type WorldState } from "./world.js";

const DAY = 1440;
/** Hours of real work a day, once walking, meals and talk are taken out. */
const WORK_HOURS = 6;
const HOUSE = { timber: 30, stone: 12, reeds: 15 };

// ---------------------------------------------------------------- in and out of the aggregate tier

/** A town's world, trimmed for the aggregate tier. The live world is left as it was. */
export function dematerialize(live: WorldState): WorldState {
  const w = structuredClone(live);
  const v = w.village!;
  v.aggregate = { since: w.tick };
  w.events = [];
  w.rumors = {};
  v.pending = [];
  v.told = [];
  v.pledges = v.pledges.slice(-2);
  const f = (v.store.folded ??= { put: 0, take: 0 });
  for (const e of v.store.log.splice(0)) f[e.kind] = Number((f[e.kind] + e.amount).toFixed(1));
  // Half-built houses go back to the piles; finished ones stay as the household's shelter.
  for (const s of v.structures.filter((x) => !x.done)) for (const k of ["timber", "stone", "reeds"] as const) v.stock[k] += s.have[k];
  v.structures = v.structures.filter((s) => s.done && v.households[s.household]);
  for (const id of Object.keys(w.agents)) {
    const a = w.agents[id]!;
    a.wants = [];
    a.lastTalk = {};
    a.told = [];
    a.override = undefined;
    a.talkingUntil = undefined;
    a.evening = undefined;
    if (!w.order.includes(id)) a.routine = [];
  }
  compactMinds(w);
  return w;
}

/** Back on the hourly loop: everyone at home, the day's routines picked up from here. */
export function materialize(agg: WorldState): WorldState {
  const w = structuredClone(agg);
  const v = w.village!;
  delete v.aggregate;
  const day = dayOf(w.tick);
  v.season = seasonOf(v, w.tick);
  v.last = { ...v.last, meal: day - 1, fireside: day - 1, bedtime: day - 1, tentNight: day - 1, weather: day - 1 };
  for (const id of w.order) {
    const a = w.agents[id]!;
    a.place = a.home;
    a.activity = "at home";
    const m = w.minds[id]!;
    m.tick = w.tick;
    m.lastSleep = w.tick;
    // The live loop expects everyone to have some view of everyone in town: strangers they're not.
    for (const o of w.order) if (o !== id) m.others[o] ??= other(o, w.agents[o]!.name, 0.5, 0.5, 0.05);
  }
  return w;
}

/**
 * Trim every mind to what the aggregate tier (and the analysis layer) needs, and keep of the dead and
 * remembered only the memories someone living still traces a story back to.
 */
export function compactMinds(w: WorldState): void {
  const living = new Set(w.order);
  for (const id of w.order) compactMind(w, w.minds[id]!);
  // Follow every kept memory's told-by pointer, so the chains stay whole.
  const needed = new Map<AgentId, Set<string>>();
  const queue: { agent: AgentId; ep: Episode }[] = w.order.flatMap((id) => w.minds[id]!.episodes.map((ep) => ({ agent: id, ep })));
  while (queue.length) {
    const { ep } = queue.pop()!;
    const s = ep.source;
    if (s.kind !== "told" || !s.from || !s.ref) continue;
    const set = needed.get(s.from) ?? new Set<string>();
    if (set.has(s.ref)) continue;
    set.add(s.ref);
    needed.set(s.from, set);
    const next = w.minds[s.from]?.episodes.find((e) => e.id === s.ref);
    if (next) queue.push({ agent: s.from, ep: next });
  }
  for (const [id, m] of Object.entries(w.minds)) {
    if (living.has(id)) continue;
    const keep = needed.get(id);
    if (!keep) {
      delete w.minds[id];
      continue;
    }
    m.episodes = m.episodes.filter((e) => keep.has(e.id));
    m.beliefs = [];
    m.goals = [];
    m.habits = [];
    m.expressions = [];
    m.others = {};
  }
}

const charge = (e: Episode) => Math.abs(e.valence) * (0.3 + e.arousal);
const FOUNDING_TOPICS = ["founding", "crossing", "leaving"];

function compactMind(w: WorldState, m: MindState): void {
  const v = w.village!;
  const l = v.life[m.id];
  for (const s of m.schemas) if (s.deepenedBy && s.deepenedBy.length > 4) s.deepenedBy.splice(0, s.deepenedBy.length - 4);
  // Beliefs: everything about the town and the other towns, and the most confident of the rest.
  const civic = m.beliefs.filter((b) => b.about === "village" || b.about.startsWith("town:"));
  const rest = m.beliefs.filter((b) => !civic.includes(b)).sort((a, b) => b.confidence - a.confidence).slice(0, 15);
  m.beliefs = [...civic, ...rest];
  for (const b of m.beliefs) {
    b.evidence = b.evidence.slice(-4);
    b.retrievals = b.retrievals.slice(-3);
  }
  // Memories: what formed a core belief, the founding as they have it, what a belief rests on, and
  // the most strongly felt of the rest.
  const keep = new Set<string>([
    ...m.schemas.flatMap((s) => [...(s.origin ?? []), ...(s.deepenedBy ?? []).map((d) => d.episode)]),
    ...m.beliefs.flatMap((b) => b.evidence.slice(-2)),
    ...m.episodes.filter((e) => e.topics.some((t) => FOUNDING_TOPICS.includes(t))).map((e) => e.id),
  ]);
  const others = m.episodes.filter((e) => !keep.has(e.id)).sort((a, b) => charge(b) - charge(a) || b.tick - a.tick);
  for (const e of others.slice(0, 10)) keep.add(e.id);
  for (const e of [...m.episodes].sort((a, b) => b.tick - a.tick).slice(0, 4)) keep.add(e.id);
  m.episodes = m.episodes.filter((e) => keep.has(e.id));
  for (const e of m.episodes) {
    e.retrievals = e.retrievals.slice(-3);
    e.versions = e.versions.slice(-2);
  }
  // The people they are closest to, or feel most strongly about, and family.
  const kin = new Set<AgentId>([...(l?.parents ?? []), ...(l?.partner ? [l.partner] : []), ...w.order.filter((x) => v.life[x]?.parents.includes(m.id)), ...(Object.values(v.households).find((h) => h.members.includes(m.id))?.members ?? [])]);
  const ranked = Object.entries(m.others)
    .filter(([id]) => id !== "visitor")
    .sort((a, b) => b[1].bond + Math.abs(b[1].liking - 0.5) - (a[1].bond + Math.abs(a[1].liking - 0.5)));
  const keepOthers = new Set([...ranked.slice(0, 20).map(([id]) => id), ...kin, "visitor"]);
  for (const id of Object.keys(m.others)) if (!keepOthers.has(id)) delete m.others[id];
  m.expressions = [];
}

// ---------------------------------------------------------------- running a season on rules

/** Move an aggregated town on by some minutes; each new season runs as one step. */
export async function aggAdvance(w: WorldState, minutes: number, faculties: Faculties, sink: Sink): Promise<void> {
  const v = w.village!;
  const end = w.tick + minutes;
  while (w.tick < end) {
    w.tick = Math.min(end, w.tick + DAY);
    const s = seasonOf(v, w.tick);
    if (s === v.season) continue;
    v.season = s;
    await aggSeason(w, faculties, sink);
  }
  v.last.weather = dayOf(w.tick);
}

export async function aggSeason(w: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = w.village!;
  for (const id of w.order) {
    w.minds[id]!.tick = w.tick;
    w.minds[id]!.lastSleep = w.tick;
  }
  v.blight = v.season === "autumn" && nextRandom(w) < 0.08;
  economy(w, sink);
  acquaint(w);
  await lifeTurn(w, faculties, sink);
  knowledgeTurn(w, sink);
  if (v.season === "spring") elect(w, sink);
  await pledgeRound(w, faculties, sink);
  if (v.season === "summer" && yearOf(w) > 1) for (const f of [...new Set([v.founding ?? CROSSING, CROSSING])]) tellFounding(w, f);
  bedtimes(w);
  if (v.season === "spring") compactMinds(w);
}

/** A season of work and meals, household by household, a day at a time. */
function economy(w: WorldState, sink: Sink): void {
  const v = w.village!;
  const sd = v.seasonDays;
  const skill: Record<string, number> = { fisher: 1 + craftBonus(w, "fish"), farmer: 1 + craftBonus(w, "farm") };
  const spoil = SPOIL * (1 - craftBonus(w, "keep"));
  const gale = GALE_CHANCE[v.season];
  const ration = w.order.some((x) => w.agents[x]!.role === "cook") ? RATION * 0.85 : RATION;
  let hungryDays = 0;
  const hungry = new Set<AgentId>();
  for (const hh of Object.values(v.households)) {
    let made = 0;
    for (const id of hh.members) {
      const a = w.agents[id]!;
      const job = JOBS[a.role];
      if (!job || isChild(w, id)) continue;
      const pace = WORK_HOURS * (0.5 + 0.5 * w.minds[id]!.needs.energy);
      if (job.makes === "food") {
        let y = SEASON_YIELD[v.season][a.role] ?? 1;
        if (a.role === "farmer" && v.blight) y *= 0.4;
        if (a.role === "fisher") y *= 1 - gale;
        made += job.rate * y * (skill[a.role] ?? 1) * pace * 0.9;
      } else if (job.makes === "timber" || job.makes === "stone" || job.makes === "reeds") v.stock[job.makes] = Number((v.stock[job.makes] + job.rate * pace * 0.9 * sd).toFixed(1));
    }
    const need = ration * hh.members.reduce((n, m) => n + (isChild(w, m) ? 0.6 : 1), 0);
    let short = 0;
    for (let d = 0; d < sd; d++) {
      hh.food += made;
      const surplus = hh.food - need * 3;
      if (hh.rate > 0 && surplus > 0) {
        const put = surplus * hh.rate;
        hh.food -= put;
        v.store.food += put;
        (v.store.folded ??= { put: 0, take: 0 }).put += put;
      }
      if (hh.food >= need) hh.food -= need;
      else {
        let gap = need - hh.food;
        hh.food = 0;
        const take = Math.min(gap, v.store.food);
        v.store.food -= take;
        (v.store.folded ??= { put: 0, take: 0 }).take += take;
        gap -= take;
        if (gap > 0.05) short += gap / need;
      }
      hh.food *= 1 - spoil;
    }
    hh.food = Number(hh.food.toFixed(2));
    // Those who went short lose strength (the oldest and youngest last to be fed least).
    const n = Math.min(hh.members.length, Math.round((short / sd) * hh.members.length));
    const order = [...hh.members].sort((a, b) => Number(isChild(w, a)) - Number(isChild(w, b)));
    order.forEach((id, i) => {
      const m = w.minds[id]!;
      if (i < n) {
        m.needs.energy = clamp(m.needs.energy - 0.12 * Math.min(sd, short * 2));
        hungry.add(id);
      } else m.needs.energy = clamp(m.needs.energy + 0.3);
    });
    hungryDays += short * hh.members.length;
  }
  v.store.food = Number(v.store.food.toFixed(1));
  build(w);
  if (hungry.size >= Math.max(3, w.order.length * 0.15)) {
    const growers = w.order.filter((x) => JOBS[w.agents[x]!.role]?.makes === "food" && !isChild(w, x)).length;
    const adults = w.order.filter((x) => !isChild(w, x)).length;
    const why: Why[] = [
      { text: `It was ${v.season}: ${v.season === "winter" ? "nothing grows and the fish go deep" : v.season === "spring" ? "the barley is only planted" : v.blight ? "blight took the barley" : "a lean season"}.` },
      { text: `${growers} of ${adults} adults fish, farm or forage.` },
      { text: `The common store held ${Math.round(v.store.food)} days' food when it ran out${normHeld(w, w.order[0]!) > 0 ? "" : ", and nobody yet felt bound to put into it"}.` },
    ];
    const lost = Object.entries(v.knowledge?.lost ?? {}).map(([c]) => c);
    if (lost.length) why.push({ text: `${w.name} had lost ${lost.join(", ")}.` });
    feed(w, sink, { kind: "event", agents: [...hungry].slice(0, 8), title: `${hungry.size} go hungry in ${w.name} this ${v.season}`, text: why.map((x) => x.text).join(" "), chronicle: { kind: "hunger", why } });
  }
  void hungryDays;
}

/**
 * A season of living side by side: everyone spends time with a few others, and comes to like them
 * more the more alike they are (similarity and attraction, Byrne 1971) and the kinder the other is.
 * In a live town this happens through every conversation; here, by rule.
 */
function acquaint(w: WorldState): void {
  const v = w.village!;
  const ids = w.order.filter((x) => ageOf(w, x) >= 10);
  // The unpartnered young seek each other out (at the fire, at the harvest, at the landing).
  const single = ids.filter((x) => !v.life[x]?.partner && ageOf(w, x) >= 16 && ageOf(w, x) < 40);
  for (const a of ids) {
    const A = w.minds[a]!;
    const pool = single.includes(a) && single.length > 1 ? single : ids;
    for (let k = 0; k < 4; k++) {
      const b = pool[Math.floor(nextRandom(w) * pool.length)]!;
      if (b === a) continue;
      const B = w.minds[b]!;
      const gap = (["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"] as const).reduce((s, t) => s + Math.abs(A.traits[t] - B.traits[t]), 0) / 5;
      const fit = clamp(0.5 + 0.35 * (1 - gap * 3) + 0.25 * (B.traits.agreeableness - 0.5));
      const o = (A.others[b] ??= other(b, B.name, 0.5, 0.5, 0));
      o.liking = Number((o.liking + 0.2 * (fit - o.liking)).toFixed(3));
      o.bond = Number(clamp(o.bond + 0.02).toFixed(3));
    }
  }
}

/** Households in tents get a house when the piles allow and someone can build. */
function build(w: WorldState): void {
  const v = w.village!;
  const builders = w.order.filter((x) => w.agents[x]!.role === "builder").length;
  const timber = HOUSE.timber * (1 - craftBonus(w, "build"));
  for (const hh of Object.values(v.households).filter((h) => h.shelter === "tent").slice(0, builders)) {
    if (v.stock.timber < timber || v.stock.stone < HOUSE.stone || v.stock.reeds < HOUSE.reeds) break;
    v.stock.timber = Number((v.stock.timber - timber).toFixed(1));
    v.stock.stone -= HOUSE.stone;
    v.stock.reeds -= HOUSE.reeds;
    hh.shelter = "house";
  }
}

/** Each season's pledge, by rule: what each adult would likely give, from what they believe and are. */
async function pledgeRound(w: WorldState, faculties: Faculties, sink: Sink): Promise<void> {
  const v = w.village!;
  const adults = w.order.filter((x) => !isChild(w, x));
  if (adults.length < 2) return;
  const perHead = v.store.food / Math.max(1, w.order.length);
  const answers: Pledge[] = adults.map((id) => {
    const m = w.minds[id]!;
    const s = 0.3 + 0.5 * normHeld(w, id) + 0.3 * (m.traits.agreeableness - 0.5) + 0.2 * (m.traits.conscientiousness - 0.5) - 0.15 * m.traits.neuroticism * (perHead < 2 ? 1 : 0) + (nextRandom(w) - 0.5) * 0.3;
    return { agent: id, option: s > 0.5 ? "commit" : s > 0.3 ? "token" : "hold", trace: "" };
  });
  for (const hh of Object.values(v.households)) {
    const mine = answers.filter((a) => hh.members.includes(a.agent));
    hh.rate = mine.length ? Number((mine.reduce((s, a) => s + RATE[a.option], 0) / mine.length).toFixed(2)) : hh.rate;
  }
  // Holding back is seen, and held against people, as at the fire.
  const n = storeNorm(v);
  const held = answers.filter((a) => a.option === "hold").length;
  n.sanctions += Math.round(held * (0.5 + nextRandom(w)));
  const round = v.pledges.length;
  if (held && !n.rounds.includes(round)) n.rounds.push(round);
  if (n.established) n.strength = clamp(n.sanctions / 80);
  v.pledges.push({ tick: w.tick, season: v.season, proposer: civicOf(v).leader ?? adults[0]!, answers });
  if (v.pledges.length > 4) v.pledges.splice(0, v.pledges.length - 4);
  await enforceLaws(w, answers, faculties, sink);
  settleNorms(w, sink);
  await considerLaw(w, answers, faculties, sink);
}

// ---------------------------------------------------------------- stories, by rule

/**
 * Give a listener a memory of being told something, then let hearStory do what it does in a live
 * town: keep the teller's pointer and feeling, and maybe pass on a core belief.
 */
export function implant(w: WorldState, teller: AgentId, told: Episode, listener: AgentId, gain: number, topics: string[] = []): Episode | undefined {
  const L = w.minds[listener]!;
  const ep: Episode = {
    id: nextId(L, "ep_heard"),
    tick: w.tick,
    gist: "",
    template: "",
    about: [],
    topics: ["stories", ...topics],
    valence: 0,
    valenceAtEncoding: 0,
    arousal: 0.3,
    source: { kind: "told", from: teller },
    details: [],
    retrievals: [w.tick],
    versions: [],
    replays: 0,
    coping: 0.5,
    agency: "other",
  };
  L.episodes.push(ep);
  hearStory(w, teller, told, listener, { encoded: ep.id } as unknown as Trace, gain);
  for (const t of topics) if (!ep.topics.includes(t)) ep.topics.push(t);
  return ep;
}

const isVersion = (w: WorldState, id: AgentId, e: Episode, founding: string) =>
  e.source.kind === "told" && e.topics.some((t) => FOUNDING_TOPICS.includes(t)) && rootOf(w.minds, id, e).episode.id === founding;

/** The first summer: the eldest who carries the founding story tells it, by rule, to everyone else. */
export function tellFounding(w: WorldState, founding: string): boolean {
  const v = w.village!;
  const c = civicOf(v);
  const holders = w.order.map((id) => ({ id, ep: foundingVersion(w.minds, id, founding) })).filter((x) => x.ep);
  if (!holders.length) return false;
  const teller = holders.sort((a, b) => ageOf(w, b.id) - ageOf(w, a.id) || a.id.localeCompare(b.id))[0]!;
  const T = w.minds[teller.id]!;
  const told = teller.ep!;
  // Told again, a story drifts a little: this year's telling may level or sharpen it.
  const base = thirdPerson(render(told), T.name, T.pronouns);
  const version = nextRandom(w) < 0.2 ? drift(base, w) : base;
  c.foundingDays.push({ tick: w.tick, teller: teller.id, version });
  if (c.foundingDays.length > 60) c.foundingDays.splice(0, c.foundingDays.length - 60);
  const toldOn = toldFrom(w);
  for (const id of w.order) {
    if (id === teller.id) continue;
    const m = w.minds[id]!;
    if (m.episodes.some((e) => e.id === founding)) continue;
    // The new telling replaces the old, unless someone else's version was told from it.
    m.episodes = m.episodes.filter((e) => toldOn.has(`${id}/${e.id}`) || !isVersion(w, id, e, founding));
    const heard = implant(w, teller.id, told, id, isChild(w, id) ? 0.1 : 0, ["founding"]);
    if (heard) heard.gist = version;
  }
  return true;
}

/** Bedtime, a season's worth: in homes with children, the most charged story they haven't heard yet. */
function bedtimes(w: WorldState): void {
  const v = w.village!;
  for (const hh of Object.values(v.households)) {
    const kids = hh.members.filter((m) => ageOf(w, m) >= 3 && ageOf(w, m) < CHILDHOOD);
    const adults = hh.members.filter((m) => !isChild(w, m));
    if (!kids.length || !adults.length) continue;
    for (let night = 0; night < 2; night++) {
      if (nextRandom(w) > 0.55) continue;
      let best: { teller: AgentId; ep: Episode; score: number } | undefined;
      for (const t of adults) {
        const m = w.minds[t]!;
        for (const ep of m.episodes) {
          if (/^(talk_|pc_|ev_pledge|ev_hungry|ev_tent|ev_gale|ev_design|ev_birth|ev_pair)/.test(ep.id)) continue;
          if (kids.every((k) => heardFrom(w, k, t, ep.id))) continue;
          const score = charge(ep) * (0.5 + m.traits.extraversion) + (m.schemas.some((s) => s.origin?.includes(ep.id)) ? 0.6 : 0);
          if (!best || score > best.score) best = { teller: t, ep, score };
        }
      }
      if (!best || best.score < 0.2) continue;
      for (const k of kids) if (!heardFrom(w, k, best.teller, best.ep.id)) implant(w, best.teller, best.ep, k, 0.35);
    }
  }
}

const heardFrom = (w: WorldState, listener: AgentId, teller: AgentId, ref: string) => w.minds[listener]!.episodes.some((e) => e.source.kind === "told" && e.source.from === teller && e.source.ref === ref);

const SHARPEN: [RegExp, string][] = [
  [/\bthe storm\b/, "the great storm"],
  [/\bthe sea\b/, "the black sea"],
  [/\bthe cold\b/, "the bitter cold"],
  [/\bthe boats?\b/, "the little boats"],
  [/\bthe wind\b/, "the howling wind"],
  [/\bthe swell\b/, "the great swell"],
  [/\bthe waves?\b/, "waves as high as houses"],
  [/\bhungry\b/, "starving"],
  [/\bafraid\b/, "terrified"],
  [/\bran low\b/, "all but ran out"],
  [/\bchoppy\b/, "rough"],
  [/\bat sunrise\b/, "at the first light, like a promise"],
];

/** Level (drop the last detail) or sharpen (make one bigger): the two ways a retold story drifts. */
export function drift(text: string, w: { rng: number }): string {
  const level = nextRandom(w) < 0.5;
  if (level) {
    const body = text.replace(/\.$/, "");
    const cut = Math.max(body.lastIndexOf(", "), body.lastIndexOf(" and "));
    const kept = body.slice(0, cut).replace(/[,;:\s]+$/, "");
    if (cut > 0 && kept.split(/\s+/).length >= 6) return `${kept}.`;
  }
  const open = SHARPEN.filter(([re, to]) => re.test(text) && !text.includes(to));
  if (!open.length) return text;
  const [re, to] = open[Math.floor(nextRandom(w) * open.length)]!;
  return text.replace(re, to);
}
