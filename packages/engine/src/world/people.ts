// Generated people. The Kettle five were written by hand; a village needs more minds than anyone
// wants to write, so settlers are rolled from a seed: a name, a temperament, a trade, a household,
// and a short past. The past matters most. Each settler carries one formative memory from before
// the crossing, and that memory installs a core belief that colours how they see the village's
// hard choices (who shares, who holds back). The belief keeps a pointer to the memory, so the
// analysis layer can trace a decision back to a winter years before the story starts.

import { episode } from "../seed.js";
import { nextRandom, type Rng } from "../rng.js";
import type { Ablations, AgentId, Episode, Goal, MindState, OtherModel, Pronouns, Schema } from "../types.js";
import { baseMind } from "./cast.js";
import type { PlaceId, RoutineEntry, Want } from "./places.js";

const DAY = 1440;
/** The crossing to the new village, which every founder lived through and remembers differently. */
export const CROSSING = "ep_crossing";
const CROSSING_TICK = -6 * DAY + 14 * 60;

const SHE: Pronouns = { subject: "she", object: "her", possessive: "her", reflexive: "herself" };
const HE: Pronouns = { subject: "he", object: "him", possessive: "his", reflexive: "himself" };
const THEY: Pronouns = { subject: "they", object: "them", possessive: "their", reflexive: "themself" };

const NAMES: [string, Pronouns][] = [
  ["Ada", SHE], ["Bram", HE], ["Cass", THEY], ["Della", SHE], ["Eamon", HE], ["Fen", THEY], ["Greta", SHE], ["Hal", HE],
  ["Isla", SHE], ["Joss", HE], ["Kit", THEY], ["Lorna", SHE], ["Milo", HE], ["Nell", SHE], ["Oren", HE], ["Pia", SHE],
  ["Quin", THEY], ["Rafe", HE], ["Sorrel", SHE], ["Tam", HE], ["Una", SHE], ["Vik", HE], ["Willa", SHE], ["Yorick", HE],
  ["Agnes", SHE], ["Bea", SHE], ["Colm", HE], ["Dara", THEY], ["Edie", SHE], ["Finn", HE], ["Gil", HE], ["Hester", SHE],
  ["Ivo", HE], ["Jem", THEY], ["Kenna", SHE], ["Lew", HE], ["Maud", SHE], ["Ned", HE], ["Orla", SHE], ["Perrin", HE],
  ["Rhys", HE], ["Sabine", SHE], ["Tobin", HE], ["Ula", SHE], ["Wynn", THEY], ["Ysolde", SHE], ["Zeb", HE], ["Ailsa", SHE],
];
export const FIRST_NAMES = NAMES;
const SURNAMES = ["Ashby", "Brack", "Coyle", "Dunmore", "Fenwick", "Harrow", "Kell", "Lusk", "Moss", "Pardoe", "Rook", "Tarrant", "Garvey", "Hume", "Locke", "Penhale", "Quarry", "Sallow", "Tull", "Venn"];

/** A fresh id from a name: "ada", or "ada2" if an Ada already lives (or lived) here. */
export function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  taken.add(id);
  return id;
}
const HOMETOWNS = ["Marrow", "the Saltings", "Kilnford", "Upper Dray"];

/** Trades a settler can take up, and how they describe it. */
export const TRADES: Record<string, string> = {
  fisher: "fishes the bay",
  farmer: "works the barley",
  forager: "forages the pinewood",
  woodcutter: "fells timber",
  quarrier: "cuts stone",
  builder: "builds",
  thatcher: "cuts reeds and thatches",
};
const SETTLER_TRADES = ["farmer", "woodcutter", "builder", "fisher", "quarrier", "forager", "thatcher", "farmer", "woodcutter", "forager", "builder", "fisher"];

/** One formative past each, and the core belief it left behind. */
interface Past {
  key: string;
  gist: (town: string) => string;
  valence: number;
  topics: string[];
  schema: Omit<Schema, "id" | "origin">;
  line: (town: string) => string;
}
const PASTS: Past[] = [
  {
    key: "famine",
    gist: (t) => `The hungry winter in ${t}, when the mill families hid their grain and we went without.`,
    valence: -0.75,
    topics: ["food", "hunger", "winter", "store", "fairness"],
    schema: { text: "When food runs short, people look after their own", triggers: ["food", "store", "hunger", "winter", "fairness"], blameBias: 0.25, threatBias: 0.2, strength: 0.55 },
    line: (t) => `Lived through the hungry winter in ${t} and has not forgotten who hid grain.`,
  },
  {
    key: "kindness",
    gist: (t) => `The hungry winter in ${t}, when a neighbour fed us from her own pot until spring.`,
    valence: 0.6,
    topics: ["food", "hunger", "winter", "help", "store"],
    schema: { text: "People pull together when it counts", triggers: ["food", "store", "help", "winter"], blameBias: -0.15, threatBias: -0.1, strength: 0.5 },
    line: (t) => `Was fed through a hard winter in ${t} by a neighbour, and means to repay it to someone.`,
  },
  {
    key: "cheated",
    gist: (t) => `My brother sold our share of the boat in ${t} behind my back.`,
    valence: -0.65,
    topics: ["money", "trust", "help", "fairness", "boat"],
    schema: { text: "Family or not, people will cheat you", triggers: ["money", "trust", "fairness", "store", "help"], blameBias: 0.3, threatBias: 0.15, strength: 0.5 },
    line: (t) => `Left ${t} after a brother sold the family boat out from under them.`,
  },
  {
    key: "fire",
    gist: (t) => `Our house in ${t} burned, and nobody came to help us rebuild.`,
    valence: -0.6,
    topics: ["house", "help", "fire", "shelter", "build"],
    schema: { text: "I can only count on myself", triggers: ["help", "house", "build", "shelter"], blameBias: 0.15, threatBias: 0.2, strength: 0.5 },
    line: (t) => `Rebuilt alone after a house fire in ${t}; trusts their own hands.`,
  },
  {
    key: "raising",
    gist: (t) => `The whole street in ${t} turned out to raise our roof in a single day.`,
    valence: 0.65,
    topics: ["house", "help", "build", "shelter"],
    schema: { text: "Many hands make light work", triggers: ["build", "house", "help"], blameBias: -0.1, threatBias: -0.15, strength: 0.45 },
    line: (t) => `Remembers a roof-raising in ${t} as the best day of their life.`,
  },
];

export interface Settler {
  mind: MindState;
  role: string;
  household: string;
  routine: RoutineEntry[];
  wants: Want[];
  home: PlaceId;
}

export interface HouseholdSeed {
  id: string;
  name: string;
  members: AgentId[];
}

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(nextRandom(r) * xs.length)]!;
const roll = (r: Rng, lo: number, hi: number) => Number((lo + nextRandom(r) * (hi - lo)).toFixed(2));

export function other(id: AgentId, name: string, benevolence: number, liking: number, bond: number, believedRegard = 0): OtherModel {
  return { id, name, trust: { ability: 0.6, benevolence, integrity: benevolence }, liking, bond, believedRegard };
}

/** How the crossing went, in this mind's telling. Same night, different memories. */
export function crossingMemory(m: MindState, r: Rng, id = CROSSING, tick = CROSSING_TICK): Episode {
  const n = m.traits.neuroticism;
  const sea = n > 0.6 ? "nearly swamped us in the swell" : n > 0.4 ? "was rough the whole second night" : "was choppy, nothing worse";
  const moments = [
    "I was sick over the side till dawn",
    "the children sang to keep their spirits up",
    "the water ran low on the second day",
    "I kept bailing and didn't stop to think",
    "I saw the bay for the first time at sunrise",
  ];
  const moment = pick(r, moments);
  return episode({
    id,
    tick,
    gist: `The crossing to Hollow Bay ${sea}.`,
    template: "The crossing to Hollow Bay {sea}, and {moment}.",
    details: [
      ["sea", sea, n > 0.6 ? -0.6 : -0.2],
      ["moment", moment, 0.4],
    ],
    about: [],
    topics: ["crossing", "sea", "bay"],
    valence: Number((0.25 - n * 0.6).toFixed(2)),
    arousal: Number((0.3 + n * 0.4).toFixed(2)),
    rehearsed: [tick + 3 * DAY],
  });
}

export function routineFor(role: string, home: PlaceId): RoutineEntry[] {
  const job = { fisher: "fishing the bay", farmer: "working the barley", forager: "foraging the pinewood", woodcutter: "felling pines", quarrier: "cutting stone", builder: "building", thatcher: "cutting reeds" }[role] ?? "working";
  return [
    { from: 7, place: home, activity: "waking up" },
    { from: 7.5, place: "@work", activity: job },
    { from: 12, place: "tavern", activity: "the midday meal at the fire circle" },
    { from: 13, place: "@work", activity: job },
    { from: 17.5, place: home, activity: "at home", evening: { place: "tavern", activity: "sitting by the fire circle" } },
    { from: 22, place: home, activity: "at home" },
  ];
}

/** What a settler might ask of someone in another trade. */
const ASKS: Record<string, { what: string; topics: string[] }> = {
  fisher: { what: "take me out in your boat one morning", topics: ["boat", "catch", "help"] },
  builder: { what: "help raise our roof beams before the rain", topics: ["house", "build", "help"] },
  forager: { what: "show me where the good mushrooms grow", topics: ["forage", "food", "help"] },
  farmer: { what: "spare us a sack of seed barley", topics: ["barley", "food", "help"] },
  keeper: { what: "set aside a little extra for my household this week", topics: ["store", "food", "fairness"] },
  woodcutter: { what: "fell a few pines for our house first", topics: ["timber", "house", "build"] },
  quarrier: { what: "cut us some stone for a hearth", topics: ["stone", "house", "build"] },
  thatcher: { what: "cut reeds for our roof before the others", topics: ["reeds", "house", "build"] },
};

/**
 * Roll `count` settlers in households of two or three. `known` are minds that already exist
 * (the Kettle five), with their roles, so asks can be aimed at them too.
 */
export function createSettlers(
  seed: number,
  count: number,
  ablations: Partial<Ablations>,
  known: { id: AgentId; name: string; role: string }[],
  /** For later boats: ids already in use, the crossing's episode id, and when they land. */
  /** `names` already in use (the living and the remembered dead), avoided while any are left. */
  opts: { taken?: Set<string>; names?: Set<string>; crossing?: string; now?: number } = {},
): { settlers: Settler[]; households: HouseholdSeed[] } {
  const r: Rng = { rng: (Math.imul(seed + 17, 2246822519) ^ 0x5bd1e995) >>> 0 };
  const taken = opts.taken ?? new Set(known.map((k) => k.id));
  const now = opts.now ?? 0;
  const names = NAMES.filter(([n]) => !opts.names?.has(n));
  const settlers: Settler[] = [];
  const households: HouseholdSeed[] = [];
  const surnames = [...SURNAMES];
  let made = 0;
  while (made < count) {
    const size = Math.min(count - made, count - made === 4 ? 2 : nextRandom(r) < 0.5 ? 2 : 3);
    const surname = surnames.length ? surnames.splice(Math.floor(nextRandom(r) * surnames.length), 1)[0]! : pick(r, SURNAMES);
    const hid = uniqueId(surname.toLowerCase(), taken);
    const town = pick(r, HOMETOWNS);
    const home = `home_${hid}`;
    const members: AgentId[] = [];
    const past = pick(r, PASTS);
    for (let i = 0; i < size; i++) {
      const [first, pronouns] = names.length ? names.splice(Math.floor(nextRandom(r) * names.length), 1)[0]! : pick(r, NAMES);
      const id = uniqueId(first.toLowerCase(), taken);
      const role = SETTLER_TRADES[made % SETTLER_TRADES.length]!;
      const age = Math.round(roll(r, 19, 61));
      const traits = {
        openness: roll(r, 0.25, 0.8),
        conscientiousness: roll(r, 0.3, 0.85),
        extraversion: roll(r, 0.2, 0.85),
        agreeableness: roll(r, 0.25, 0.85),
        neuroticism: roll(r, 0.2, 0.8),
        honesty: roll(r, 0.35, 0.9),
      };
      // Household members mostly share the formative past, but not always: one may have their own.
      const mine = i === 0 || nextRandom(r) < 0.7 ? past : pick(r, PASTS);
      const formative = episode({
        id: `ep_${id}_${mine.key}`,
        tick: now - Math.round(roll(r, 2, 15)) * 365 * DAY,
        gist: mine.gist(town),
        template: "",
        about: [],
        topics: mine.topics,
        valence: mine.valence,
        arousal: 0.6,
        rehearsed: [now - 400 * DAY, now - 60 * DAY],
        agency: "circumstance",
      });
      const schema: Schema = { ...mine.schema, id: `sch_${id}_${mine.key}`, origin: [formative.id] };
      const voice =
        traits.extraversion > 0.6 ? "Talkative and quick to laugh; tells things at length." : traits.extraversion < 0.35 ? "Few words, chosen carefully. Long silences." : "Plain and steady; says what needs saying.";
      const mood = Number((0.1 - traits.neuroticism * 0.15).toFixed(2));
      const goals: Goal[] = [
        { id: `g_${id}_roof`, text: "Get a roof over the household before winter", tags: ["house", "build", "winter", "shelter"], priority: 0.8, progress: 0.05, invested: 0.2, rate: 0 },
        { id: `g_${id}_fed`, text: "Keep the household fed", tags: ["food", "store", "hunger", "winter"], priority: 0.75, progress: 0.3, invested: 0.2, rate: 0 },
        { id: `g_${id}_name`, text: "Be thought well of in the new village", tags: ["reputation", "store", "help"], priority: 0.45, progress: 0.2, invested: 0.1, rate: 0 },
      ];
      const mind = baseMind(
        {
          id,
          name: first,
          pronouns,
          identity: {
            summary: `${first} ${surname}, ${age}, from ${town}. Came over to Hollow Bay with the ${surname} household and ${TRADES[role]}. ${mine.line(town)}`,
            voice,
          },
          traits,
          attachment: { anxiety: roll(r, 0.2, 0.7), avoidance: roll(r, 0.15, 0.65) },
          needs: { autonomy: 0.6, competence: 0.5, relatedness: 0.5, energy: 0.85 },
          goals,
          self: { selfEsteem: roll(r, 0.35, 0.7), selfEfficacy: roll(r, 0.4, 0.7), control: roll(r, 0.35, 0.65), lifeStory: `I came from ${town} to start again. ${mine.gist(town)}` },
          others: { visitor: other("visitor", "the visitor", 0.5, 0.5, 0) },
          episodes: [formative],
          beliefs: [],
          habits: [{ id: `hab_${id}_fire`, cue: "fire", action: "social", strength: Number((traits.extraversion * 0.6).toFixed(2)) }],
          schemas: [schema],
          mood,
          stress: 0.25,
        },
        (Math.imul(seed + 101 + made, 2654435761) ^ 0x2c1b3c6d) >>> 0,
        ablations,
      );
      mind.episodes.push(crossingMemory(mind, r, opts.crossing, now + CROSSING_TICK));
      settlers.push({ mind, role, household: hid, routine: routineFor(role, home), wants: [], home });
      members.push(id);
      made++;
    }
    households.push({ id: hid, name: `the ${/s$/.test(surname) ? `${surname}es` : `${surname}s`}`, members });
  }

  // Everyone knows everyone a little after a week at sea together; household members a lot.
  const everyone = [...known.map((k) => ({ id: k.id, name: k.name })), ...settlers.map((s) => ({ id: s.mind.id, name: s.mind.name }))];
  for (const s of settlers) {
    for (const o of everyone) {
      if (o.id === s.mind.id) continue;
      const kin = households.find((h) => h.id === s.household)!.members.includes(o.id);
      s.mind.others[o.id] = kin ? other(o.id, o.name, 0.75, roll(r, 0.65, 0.9), 0.7, 0.4) : other(o.id, o.name, roll(r, 0.42, 0.6), roll(r, 0.4, 0.6), 0.1, 0);
    }
  }

  // One grudge from the crossing: someone took more than their share of the water.
  const a = settlers[0]!;
  const b = settlers.find((s) => s.household !== a.household);
  if (b) {
    a.mind.episodes.push(
      episode({
        id: `ep_${a.mind.id}_water`,
        tick: now + CROSSING_TICK + 20 * 60,
        gist: `${b.mind.name} took more than ${b.mind.pronouns.possessive} share of the water on the crossing.`,
        template: `${b.mind.name} took {amount} of the water on the crossing.`,
        details: [["amount", "more than a fair share", 0.5]],
        about: [b.mind.id],
        topics: ["crossing", "water", "fairness", "store"],
        valence: -0.5,
        arousal: 0.55,
        rehearsed: [now - 4 * DAY, now - 1 * DAY],
      }),
    );
    a.mind.others[b.mind.id]!.liking = 0.33;
    a.mind.others[b.mind.id]!.trust.integrity = 0.35;
  }

  // Each settler wants something from someone in another household, usually someone in another trade.
  for (const s of settlers) {
    const pool = [...known.map((k) => ({ id: k.id, role: k.role })), ...settlers.filter((o) => o.household !== s.household).map((o) => ({ id: o.mind.id, role: o.role }))].filter((o) => ASKS[o.role] && o.role !== s.role);
    if (!pool.length || nextRandom(r) < 0.3) continue;
    const t = pick(r, pool);
    const ask = ASKS[t.role]!;
    s.wants.push({ id: `w_${s.mind.id}_${t.id}`, kind: "request", target: t.id, what: ask.what, topics: ask.topics, goal: ask.topics.includes("house") ? `g_${s.mind.id}_roof` : `g_${s.mind.id}_fed` });
  }
  return { settlers, households };
}
