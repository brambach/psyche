// The nursery: families raised from birth, three generations deep, to test the developmental
// psychology the way lab/ tests the social psychology.
//
// The first generation are ordinary rolled settlers, paired off. Their children are born, cared for
// season by season by the same code that raises children in a town (develop/childhood.ts), told
// stories at bedtime by the same code that tells them in a town (world/life.ts hearStory), and grow
// up. Then they pair off and raise the third generation, as the parents the model made them into.
// Hard winters and deaths arrive by keyed chance, so two runs of the same seed share their luck
// exactly, and a run where the first generation's formative pasts are removed differs from the
// baseline only by what those pasts caused.
//
// No town, no economy, no language model: only the development code and its inputs. That is what
// makes several hundred childhoods a matter of seconds.

import { attachmentTargets, caregiving, isSecure, securityOf, strainOf, strangeSituation, styleOf, type Caregiving, type Stressor } from "../develop/attachment.js";
import { adultSeason, backfill, bornWith, childSeason, GROWN, meanMorals, noteParenting, type CaregiverNow, type Loss } from "../develop/childhood.js";
import { clamp, keyedGaussian, mean } from "../develop/core.js";
import type { IdentityStatus, Morals } from "../develop/types.js";
import { keyedRandom } from "../rng.js";
import type { AgentId, Attachment, Episode, MindState } from "../types.js";
import { implant } from "../world/aggregate.js";
import { baseMind } from "../world/cast.js";
import { createSettlers, FIRST_NAMES, other } from "../world/people.js";
import type { WorldState } from "../world/world.js";
import { applyEdit } from "./core.js";

const DAY = 1440;
export const SEASON = 4 * DAY;
export const YEAR = 4 * SEASON;

export interface NurseryOptions {
  seed?: number;
  /** First-generation couples. */
  couples?: number;
  /** Remove every first-generation formative memory and the core belief it installed. */
  noPast?: boolean;
}

/** What the nursery writes down about each child as they grow, for the studies. */
export interface Record_ {
  /** One parent's warmth on one afternoon at about a year old: what a home visit would see. */
  observed?: number;
  /** The same parent's warmth over that whole season, which no visitor sees. */
  observedTrue?: number;
  /** Each parent's attachment at the birth. */
  parentsAtBirth: Attachment[];
  infancy?: Attachment;
  /** The care they had had by then. */
  infancyCare?: { recent: number; warmth: number; consistency: number; control: number };
  grown?: Attachment;
  statusAt: Record<number, IdentityStatus>;
  /** A distress index at twenty-five, and how sure of themself they were then. */
  distress?: number;
  efficacy?: number;
  moralsAt17?: Morals;
  /** Their own attachment and their partner's on the day they paired off. */
  atPairing?: Attachment;
  partnerAtPairing?: Attachment;
  /** Mean strain on their parents over the hungry seasons of their childhood, and over the rest. */
  parentStrain: { hungry: number[]; fair: number[] };
}

export interface Person {
  id: AgentId;
  gen: 0 | 1 | 2;
  family: string;
  parents: AgentId[];
  partner?: AgentId;
  children: AgentId[];
  /** Season index of birth (negative for the first generation). */
  born: number;
  rec: Record_;
}

export interface NurseryRun {
  seed: number;
  noPast: boolean;
  minds: Record<AgentId, MindState>;
  people: Record<AgentId, Person>;
  gens: [AgentId[], AgentId[], AgentId[]];
  /** Last tick simulated. */
  end: number;
  seasons: number;
}

interface Family {
  id: string;
  parents: AgentId[];
  kids: AgentId[];
  /** Seasons at which a child is due. */
  due: number[];
  gen: 1 | 2;
}

/** Chance a year's winter is a hungry one, that a house has a lean season otherwise, and that a parent dies in a season. */
const BAD_WINTER = 0.045;
const LEAN_SEASON = 0.008;
const PARENT_DEATH = 0.001;

/**
 * A home visitor rates one afternoon, not a season: this is how far an afternoon's warmth strays
 * from the season's (sd). It is an assumption, and the sensitivity study's r depends on it.
 */
export const VISIT_NOISE = 0.1;

const G1_ERA = 28 * 4;
const END = G1_ERA + 28 * 4;

export function runNursery(opts: NurseryOptions = {}): NurseryRun {
  const seed = opts.seed ?? 11;
  const couples = opts.couples ?? 120;
  const { settlers } = createSettlers(seed, couples * 2, {}, []);
  const minds: Record<AgentId, MindState> = {};
  const people: Record<AgentId, Person> = {};
  const alive = new Set<AgentId>();
  const died = new Map<AgentId, number>();
  const gens: [AgentId[], AgentId[], AgentId[]] = [[], [], []];
  const luck = (season: number, key: string) => keyedRandom(seed, season, key);
  const world = { minds, tick: 0 } as unknown as WorldState;
  const families: Family[] = [];

  const bond = (a: MindState, b: MindState) => {
    a.others[b.id] = other(b.id, b.name, 0.75, 0.78, 0.75, 0.5);
    b.others[a.id] = other(a.id, a.name, 0.75, 0.78, 0.75, 0.5);
    for (const [x, y] of [[a, b], [b, a]] as const) {
      people[x.id]!.partner = y.id;
      people[x.id]!.rec.atPairing = { ...x.attachment };
      people[x.id]!.rec.partnerAtPairing = { ...y.attachment };
    }
  };
  const schedule = (id: string, from: number) => [from + 4, from + 16, ...(luck(0, `third|${id}`) < 0.5 ? [from + 28] : [])];

  for (const s of settlers) {
    const m = s.mind;
    // Only family matters here: the rolled acquaintance with every other settler is dropped.
    m.others = {};
    if (opts.noPast) {
      applyEdit(m, { kind: "no-past" });
      delete m.dev;
      backfill(m, { seed, now: 0, age: 25, role: s.role });
    }
    m.tick = 0;
    minds[m.id] = m;
    alive.add(m.id);
    gens[0].push(m.id);
    people[m.id] = { id: m.id, gen: 0, family: "", parents: [], children: [], born: -25 * 4, rec: blankRecord() };
  }
  for (let k = 0; k < couples; k++) {
    const a = settlers[2 * k]!.mind;
    const b = settlers[2 * k + 1]!.mind;
    bond(a, b);
    const id = `f${k}`;
    people[a.id]!.family = people[b.id]!.family = id;
    families.push({ id, parents: [a.id, b.id], kids: [], due: schedule(id, 0), gen: 1 });
  }

  const ageOf = (id: AgentId, season: number) => (season - people[id]!.born) / 4;
  const partnerOf = new Map<AgentId, AgentId>();
  for (const f of families) {
    partnerOf.set(f.parents[0]!, f.parents[1]!);
    partnerOf.set(f.parents[1]!, f.parents[0]!);
  }

  const birth = (f: Family, season: number, stressors: Stressor[]) => {
    const [p1, p2] = f.parents.map((p) => minds[p]!);
    const n = f.kids.length;
    const id = `g${f.gen}${f.id}k${n}`;
    const [first, pronouns] = FIRST_NAMES[Math.floor(luck(season, `name|${id}`) * FIRST_NAMES.length)]!;
    const g = (t: string) => keyedGaussian(seed, 0, `traits|${id}|${t}`);
    const traits = Object.fromEntries((Object.keys(p1!.traits) as (keyof MindState["traits"])[]).map((t) => [t, Number(clamp((p1!.traits[t] + p2!.traits[t]) / 2 + g(t) * 0.1, 0.05, 0.95).toFixed(2))])) as unknown as MindState["traits"];
    const mind = baseMind(
      {
        id,
        name: first,
        pronouns,
        identity: { summary: `${first}, child of ${p1!.name} and ${p2!.name}.`, voice: "Plain and direct." },
        traits,
        attachment: { anxiety: 0.3, avoidance: 0.3 },
        needs: { autonomy: 0.5, competence: 0.5, relatedness: 0.7, energy: 0.9 },
        goals: [],
        self: { selfEsteem: 0.55, selfEfficacy: 0.45, control: 0.5, lifeStory: "" },
        others: {},
        episodes: [],
        beliefs: [],
        habits: [],
        schemas: [],
        mood: 0.15,
        stress: 0.1,
      },
      (seed ^ Math.imul(season + 7 * n + 1, 2654435761)) >>> 0,
      {},
    );
    mind.tick = season * SEASON;
    for (const p of [p1!, p2!]) {
      mind.others[p.id] = other(p.id, p.name, 0.9, 0.92, 0.9, 0.7);
      p.others[id] = other(id, first, 0.7, 0.95, 0.95, 0.3);
    }
    bornWith(mind, f.parents.filter((p) => alive.has(p)).map((p) => minds[p]!), { now: season * SEASON, seed, stressors });
    minds[id] = mind;
    alive.add(id);
    f.kids.push(id);
    gens[f.gen].push(id);
    people[id] = { id, gen: f.gen, family: f.id, parents: [...f.parents], children: [], born: season, rec: { ...blankRecord(), parentsAtBirth: f.parents.map((p) => ({ ...minds[p]!.attachment })) } };
    for (const p of f.parents) people[p]!.children.push(id);
  };

  /** Bedtime, as in an aggregate town: the most charged story the children haven't heard from that teller. */
  const bedtime = (f: Family, season: number) => {
    const kids = f.kids.filter((k) => ageOf(k, season) >= 3 && ageOf(k, season) < 12);
    const tellers = f.parents.filter((p) => alive.has(p));
    if (!kids.length || !tellers.length) return;
    for (let night = 0; night < 2; night++) {
      if (luck(season, `bed|${f.id}|${night}`) > 0.55) continue;
      let best: { teller: AgentId; ep: Episode; score: number } | undefined;
      for (const t of tellers) {
        const m = minds[t]!;
        for (const ep of m.episodes) {
          if (kids.every((k) => heard(minds[k]!, t, ep.id))) continue;
          const score = Math.abs(ep.valence) * (0.3 + ep.arousal) * (0.5 + m.traits.extraversion) + (m.schemas.some((s) => s.origin?.includes(ep.id)) ? 0.6 : 0);
          if (!best || score > best.score) best = { teller: t, ep, score };
        }
      }
      if (!best || best.score < 0.2) continue;
      for (const k of kids) if (!heard(minds[k]!, best.teller, best.ep.id)) implant(world, best.teller, best.ep, k, 0.35);
    }
  };

  let townMorals: Morals | undefined;
  for (let season = 0; season <= END; season++) {
    const now = season * SEASON;
    world.tick = now;
    const year = Math.floor(season / 4);
    const winter = season % 4 === 2;

    if (season % 4 === 0) townMorals = meanMorals([...alive].filter((id) => ageOf(id, season) >= GROWN).map((id) => minds[id]!));

    // The second generation pairs off and starts families of its own.
    if (season === G1_ERA) {
      const pool = gens[1].filter((id) => alive.has(id)).sort((a, b) => luck(0, `pair|${a}`) - luck(0, `pair|${b}`));
      while (pool.length >= 2) {
        const a = pool.shift()!;
        const at = pool.findIndex((b) => people[b]!.family !== people[a]!.family);
        if (at < 0) break;
        const b = pool.splice(at, 1)[0]!;
        bond(minds[a]!, minds[b]!);
        partnerOf.set(a, b);
        partnerOf.set(b, a);
        const id = `h${families.length}`;
        families.push({ id, parents: [a, b], kids: [], due: schedule(id, G1_ERA), gen: 2 });
      }
    }

    for (const f of families) {
      // A first-generation family is finished once its children have families of their own.
      if (f.gen === 1 && season > G1_ERA + 8) continue;
      const stressors: Stressor[] = [];
      // Each house has its own luck: there is no town here to share a bad year.
      const badWinter = winter && luck(year, `winter|${f.id}`) < BAD_WINTER;
      const hungry = badWinter ? 0.15 + 0.8 * luck(year, `hunger|${f.id}`) : luck(season, `lean|${f.id}`) < LEAN_SEASON ? 0.4 : 0;
      if (hungry) stressors.push({ kind: "hunger", intensity: Number(hungry.toFixed(2)), topics: ["food", "hunger", "winter", "store"], text: `the house went hungry in the ${["summer", "autumn", "winter", "spring"][season % 4]} of year ${year + 1}` });
      const losses: Loss[] = [];
      for (const p of f.parents) {
        if (alive.has(p) && f.kids.length && luck(season, `death|${p}`) < PARENT_DEATH) {
          alive.delete(p);
          died.set(p, season);
          losses.push({ who: p, name: minds[p]!.name, relation: "parent", cause: "a fever" });
          stressors.push({ kind: "grief", intensity: 0.6, topics: ["death", "grief", "family"], text: `${minds[p]!.name}'s death` });
        }
      }
      const parents = f.parents.filter((p) => alive.has(p));
      if (f.due.includes(season) && parents.length === 2) birth(f, season, stressors);

      const minors = f.kids.filter((k) => ageOf(k, season) < GROWN);
      const cares = new Map<AgentId, Caregiving[]>();
      const strains: number[] = [];
      for (const k of f.kids) {
        const m = minds[k]!;
        const age = ageOf(k, season);
        const rec = people[k]!.rec;
        const base = { now, age, yearTicks: YEAR, seed, stressors, townMorals, town: "the nursery", belonging: 0.55, role: age >= 12 ? "farmer" : "child" };
        if (age < GROWN) {
          const caregivers: CaregiverNow[] = parents.map((p) => {
            const care = caregiving(minds[p]!, stressors, minors.length, keyedGaussian(seed, season, `care|${p}|${k}`), keyedGaussian(seed, 0, `fit|${p}|${k}`));
            (cares.get(p) ?? cares.set(p, []).get(p)!).push(care);
            strains.push(care.strain);
            return { mind: minds[p]!, parent: true, weight: 1, care };
          });
          childSeason(m, { ...base, caregivers, losses });
          if (season - people[k]!.born === 4 && caregivers.length) rec.observedTrue = caregivers[0]!.care.warmth;
          if (season - people[k]!.born === 4 && caregivers.length) rec.observed = caregivers[0]!.care.warmth + VISIT_NOISE * keyedGaussian(seed, season, `visit|${k}`);
          if (caregivers.length) (hungry ? rec.parentStrain.hungry : rec.parentStrain.fair).push(mean(caregivers.map((c) => c.care.strain)));
          if (!rec.infancy && m.dev!.attachmentAt.infancy) {
            rec.infancy = { ...m.dev!.attachmentAt.infancy };
            const c = m.dev!.care;
            rec.infancyCare = { recent: c.recent, warmth: c.warmth, consistency: c.consistency, control: c.control };
          }
        } else if (f.gen === 1 && season >= G1_ERA) {
          // Grown and with a family of their own: their adult seasons run there, as a parent.
        } else {
          settle(m);
          adultSeason(m, { ...base, caregivers: [], losses: [], partner: undefined, children: 0, newYear: season % 4 === 3 });
          if (!rec.grown) rec.grown = { ...m.dev!.attachmentAt.grown! };
        }
        note(m, rec, age);
      }
      for (const [p, cs] of cares) noteParenting(minds[p]!, { ...cs[0]!, warmth: mean(cs.map((c) => c.warmth)), control: mean(cs.map((c) => c.control)) });
      // The parents' own season: what they are under settles into them, and their adult development goes on.
      for (const p of parents) {
        const m = minds[p]!;
        const { strain, fresh } = strainOf(m, stressors);
        m.affect.stress = Number(clamp(0.5 * m.affect.stress + 0.5 * fresh).toFixed(3));
        m.affect.allostaticLoad = Number(clamp(strain > 0.6 ? m.affect.allostaticLoad + 0.015 : m.affect.allostaticLoad * 0.99).toFixed(3));
        const partner = partnerOf.get(p);
        const age = ageOf(p, season);
        adultSeason(m, {
          now,
          age,
          yearTicks: YEAR,
          seed,
          stressors,
          losses: losses.filter((l) => l.who !== p).map((l) => ({ ...l, relation: "partner" as const })),
          caregivers: [],
          townMorals,
          town: "the nursery",
          belonging: 0.55,
          role: "farmer",
          partner: partner && alive.has(partner) ? minds[partner] : undefined,
          children: f.kids.length,
          newYear: season % 4 === 3,
        });
        if (f.gen === 2) note(m, people[p]!.rec, age);
      }
      bedtime(f, season);
    }
  }
  return { seed, noPast: !!opts.noPast, minds, people, gens, end: END * SEASON, seasons: END };
}

const heard = (listener: MindState, teller: AgentId, ref: string) => listener.episodes.some((e) => e.source.kind === "told" && e.source.from === teller && e.source.ref === ref);

function blankRecord(): Record_ {
  return { parentsAtBirth: [], statusAt: {}, parentStrain: { hungry: [], fair: [] } };
}

/** Day-to-day stress from a hard childhood season fades once it is over; the lasting marks are elsewhere. */
function settle(m: MindState): void {
  m.affect.stress = Number((m.affect.stress * 0.6).toFixed(3));
}

const STATUS_AGES = [15, 18, 22, 26, 30, 40];

function note(m: MindState, rec: Record_, age: number): void {
  for (const a of STATUS_AGES) if (rec.statusAt[a] === undefined && age >= a) rec.statusAt[a] = m.dev!.identity.status;
  if (!rec.moralsAt17 && age >= 17) rec.moralsAt17 = { ...m.dev!.morals };
  if (rec.distress === undefined && age >= 25) {
    rec.distress = distressOf(m);
    rec.efficacy = m.self.selfEfficacy;
  }
}

/** A rough index of how a person is doing: reactive, worn, low on control and self-regard. */
export function distressOf(m: MindState): number {
  return Number((0.3 * m.traits.neuroticism + 0.25 * (1 - m.self.control) + 0.2 * (1 - m.self.selfEsteem) + 0.1 * (1 - m.self.selfEfficacy) + 1.0 * m.affect.allostaticLoad + 0.15 * (m.dev?.reactivity ?? 0.5)).toFixed(3));
}

export { attachmentTargets, isSecure, securityOf, strangeSituation, styleOf };
