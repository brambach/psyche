// The people of Kettle Island. Five minds who share a past and remember it differently.
//
// The night of the big storm, twenty days ago, sits at the centre. Mara remembers Theo arriving
// late to help her and holds it against him. Theo remembers why he was late: he was pulling Jun's
// skiff off the rocks. Jun remembers being rescued. Wren remembers Theo coming in soaked and saying
// nothing. Corran wasn't there, but he has his own stories about all of them.

import { episode, createMara } from "../seed.js";
import { DEFAULT_ABLATIONS, EMOTION_NAMES, type Ablations, type AgentId, type MindState, type OtherModel } from "../types.js";
import type { RoutineEntry, Want } from "./places.js";

const DAY = 1440;
export const WORLD_START = 7 * 60;

export interface CastMember {
  mind: MindState;
  home: RoutineEntry["place"];
  routine: RoutineEntry[];
  wants: Want[];
  /** Short role shown on the map. */
  role: string;
}

function other(id: AgentId, name: string, benevolence: number, liking: number, bond: number, believedRegard: number, extra: Partial<OtherModel["trust"]> = {}): OtherModel {
  return { id, name, trust: { ability: 0.6, benevolence, integrity: benevolence, ...extra }, liking, bond, believedRegard };
}

const visitor = (): OtherModel => other("visitor", "the visitor", 0.5, 0.5, 0, 0);

export function baseMind(m: Omit<MindState, "tick" | "rng" | "idCounter" | "traitSpread" | "affect" | "expressions" | "lastSleep" | "ablations"> & { mood?: number; stress?: number }, seed: number, ablations: Partial<Ablations>): MindState {
  const emotions = Object.fromEntries(EMOTION_NAMES.map((k) => [k, 0])) as MindState["affect"]["emotions"];
  const { mood = 0.05, stress = 0.2, ...rest } = m;
  return {
    ...rest,
    tick: WORLD_START,
    rng: seed >>> 0,
    idCounter: 100,
    traitSpread: 0.12,
    affect: { valence: mood, arousal: 0.3, mood: { valence: mood, arousal: 0.3 }, emotions, stress, allostaticLoad: 0.1, fatigue: 0.05 },
    expressions: [],
    lastSleep: 0,
    ablations: { ...DEFAULT_ABLATIONS, ...ablations },
  };
}

const STORM_NIGHT = -20 * DAY + 21 * 60;

function mara(seed: number, ablations: Partial<Ablations>): CastMember {
  const mind = createMara(seed, ablations);
  mind.tick = WORLD_START;
  mind.others.wren = other("wren", "Wren", 0.65, 0.6, 0.4, 0.2);
  return {
    mind,
    role: "fisher",
    home: "home_mara",
    routine: [
      { from: 7, place: "harbour", activity: "readying the boat" },
      { from: 8, place: "sea", activity: "out fishing" },
      { from: 12, place: "fishshed", activity: "selling the catch" },
      { from: 13, place: "harbour", activity: "mending nets" },
      { from: 16, place: "home_mara", activity: "looking after Dad" },
      { from: 19, place: "home_mara", activity: "at home with Dad", evening: { place: "tavern", activity: "having a drink at the Gull" } },
      { from: 22, place: "home_mara", activity: "at home" },
    ],
    wants: [],
  };
}

function theo(seed: number, ablations: Partial<Ablations>): CastMember {
  const mind = baseMind(
    {
      id: "theo",
      name: "Theo",
      pronouns: { subject: "he", object: "him", possessive: "his", reflexive: "himself" },
      identity: {
        summary:
          "Theo Barra, 38, the island's boatwright. Big, easygoing, always running late. He feels he let Mara down the night of the big storm and has never found a way to say so.",
        voice: "Warm, rambling, self-deprecating. Jokes when he is nervous.",
      },
      traits: { openness: 0.6, conscientiousness: 0.38, extraversion: 0.58, agreeableness: 0.74, neuroticism: 0.5, honesty: 0.7 },
      attachment: { anxiety: 0.5, avoidance: 0.25 },
      needs: { autonomy: 0.6, competence: 0.55, relatedness: 0.5, energy: 0.9 },
      goals: [
        { id: "g_hull", text: "Finish the new hull before winter", tags: ["hull", "timber", "boat"], priority: 0.8, progress: 0.4, invested: 0.6, rate: 0 },
        { id: "g_amends", text: "Make things right with Mara", tags: ["dock", "amends"], priority: 0.6, progress: 0.1, invested: 0.3, rate: 0 },
        { id: "g_name", text: "Keep my name good on the island", tags: ["reputation", "hull"], priority: 0.5, progress: 0.5, invested: 0.4, rate: 0 },
      ],
      self: {
        selfEsteem: 0.5,
        selfEfficacy: 0.6,
        control: 0.55,
        lifeStory: "I build boats and I'm good at it. I'm less good at turning up when I said I would. The night of the storm I chose Jun's skiff over Mara's dock, and she's barely looked at me since.",
      },
      others: {
        mara: other("mara", "Mara", 0.6, 0.72, 0.6, -0.3),
        jun: other("jun", "Jun", 0.7, 0.7, 0.55, 0.4),
        corran: other("corran", "Corran", 0.3, 0.3, 0.1, -0.2, { integrity: 0.25 }),
        wren: other("wren", "Wren", 0.75, 0.7, 0.5, 0.4),
        visitor: visitor(),
      },
      episodes: [
        episode({
          id: "ep_dock",
          tick: STORM_NIGHT,
          gist: "I got to Mara's dock late the night of the big storm, and she'd already done it alone.",
          template: "I {arrival} at Mara's dock. The storm {weather}, and {outcome}.",
          details: [
            ["arrival", "was late, pulling Jun's skiff off the rocks first", 0.7],
            ["weather", "was getting worse", -0.4],
            ["outcome", "she had already tied the boat down herself", 0],
          ],
          about: ["mara", "jun"],
          topics: ["dock", "storm", "boat", "help"],
          valence: -0.5,
          arousal: 0.7,
          rehearsed: [-18 * DAY, -9 * DAY, -2 * DAY],
          agency: "self",
        }),
        episode({
          id: "ep_theo_roof",
          tick: -300 * DAY,
          gist: "I spent three days helping Mara's dad fix his roof.",
          template: "",
          about: ["mara"],
          topics: ["roof", "help", "family"],
          valence: 0.5,
          arousal: 0.3,
          rehearsed: [-100 * DAY],
          agency: "self",
        }),
        episode({
          id: "ep_hull_rumor",
          tick: -15 * DAY,
          gist: "Corran told the mainland buyers my last hull leaked.",
          template: "",
          about: ["corran"],
          topics: ["hull", "reputation", "buyer"],
          valence: -0.6,
          arousal: 0.6,
          rehearsed: [-14 * DAY, -6 * DAY],
        }),
        episode({
          id: "ep_theo_beam",
          tick: -40 * DAY,
          gist: "Wren slipped me a free supper after I fixed the Gull's roof beam.",
          template: "",
          about: ["wren"],
          topics: ["tavern", "help"],
          valence: 0.5,
          arousal: 0.3,
          rehearsed: [-20 * DAY],
        }),
      ],
      beliefs: [
        { id: "bel_theo_mara", about: "mara", topics: ["dock", "storm"], proposition: "Mara hasn't forgiven me for the storm night", confidence: 0.7, valence: -0.3, source: { kind: "inferred" }, formed: -15 * DAY, evidence: ["ep_dock"], retrievals: [-15 * DAY, -3 * DAY] },
        { id: "bel_theo_corran", about: "corran", topics: ["buyer", "money", "reputation"], proposition: "Corran will say anything to get a better price", confidence: 0.6, valence: -0.5, source: { kind: "inferred" }, formed: -14 * DAY, evidence: ["ep_hull_rumor"], retrievals: [-14 * DAY] },
      ],
      habits: [{ id: "hab_theo_tavern", cue: "tavern", action: "social", strength: 0.5 }],
      schemas: [{ id: "sch_theo_late", text: "I always show up too late", triggers: ["help", "dock"], blameBias: 0, threatBias: 0.15, strength: 0.35, origin: ["ep_dock"] }],
      mood: 0.08,
    },
    seed,
    ablations,
  );
  return {
    mind,
    role: "boatwright",
    home: "home_theo",
    routine: [
      { from: 7, place: "boatyard", activity: "working on the hull" },
      { from: 12, place: "tavern", activity: "lunch at the Gull" },
      { from: 13, place: "boatyard", activity: "working on the hull" },
      { from: 15, place: "harbour", activity: "checking the moorings" },
      { from: 16, place: "boatyard", activity: "working on the hull" },
      { from: 18, place: "home_theo", activity: "at home", evening: { place: "tavern", activity: "a pint at the Gull" } },
      { from: 22.5, place: "home_theo", activity: "at home" },
    ],
    wants: [
      { id: "w_theo_boat", kind: "request", target: "mara", what: "lend me your boat on Thursday to fetch timber from the point", topics: ["boat", "help"], goal: "g_hull" },
      { id: "w_theo_confide", kind: "confide", target: "mara", what: "explain why he was late the night of the storm", topics: ["dock", "storm", "help"], goal: "g_amends", episode: "ep_dock" },
    ],
  };
}

function jun(seed: number, ablations: Partial<Ablations>): CastMember {
  const mind = baseMind(
    {
      id: "jun",
      name: "Jun",
      pronouns: { subject: "she", object: "her", possessive: "her", reflexive: "herself" },
      identity: {
        summary:
          "Jun Sato, 29, fishes the north side in a small skiff. Talks to everyone, hears everything, and passes most of it on. Fiercely loyal to Theo since he saved her skiff.",
        voice: "Quick, chatty, full of asides. Loves a story. Says 'you know' a lot.",
      },
      traits: { openness: 0.7, conscientiousness: 0.5, extraversion: 0.8, agreeableness: 0.62, neuroticism: 0.45, honesty: 0.5 },
      attachment: { anxiety: 0.4, avoidance: 0.2 },
      needs: { autonomy: 0.6, competence: 0.55, relatedness: 0.55, energy: 0.9 },
      goals: [
        { id: "g_skiff", text: "Pay off the skiff by spring", tags: ["catch", "money", "buyer"], priority: 0.8, progress: 0.3, invested: 0.4, rate: 0 },
        { id: "g_crew", text: "Find someone to crew the long lines with", tags: ["crew", "boat"], priority: 0.5, progress: 0.1, invested: 0.2, rate: 0 },
      ],
      self: {
        selfEsteem: 0.6,
        selfEfficacy: 0.6,
        control: 0.6,
        lifeStory: "I came to the island with a borrowed skiff and a lot of nerve. People here took me in, mostly. I'd have lost everything the night of the storm if Theo hadn't come.",
      },
      others: {
        mara: other("mara", "Mara", 0.6, 0.6, 0.5, 0.1),
        theo: other("theo", "Theo", 0.85, 0.8, 0.6, 0.5),
        corran: other("corran", "Corran", 0.35, 0.35, 0.2, 0, { integrity: 0.3 }),
        wren: other("wren", "Wren", 0.75, 0.75, 0.6, 0.5),
        visitor: visitor(),
      },
      episodes: [
        episode({
          id: "ep_skiff",
          tick: STORM_NIGHT - 40,
          gist: "Theo pulled my skiff off the rocks the night of the big storm.",
          template: "Theo {rescue} the night of the big storm, {cost}.",
          details: [
            ["rescue", "waded out and pulled my skiff off the rocks", 0.6],
            ["cost", "and it made him late for Mara", -0.2],
          ],
          about: ["theo", "mara"],
          topics: ["storm", "boat", "help"],
          valence: 0.8,
          arousal: 0.8,
          rehearsed: [-19 * DAY, -10 * DAY, -4 * DAY],
        }),
        episode({
          id: "ep_jun_crew",
          tick: -10 * DAY,
          gist: "Mara turned me down when I asked her to crew the long lines.",
          template: "",
          about: ["mara"],
          topics: ["crew", "boat", "rely"],
          valence: -0.35,
          arousal: 0.4,
          rehearsed: [-8 * DAY],
        }),
        episode({
          id: "ep_jun_price",
          tick: -25 * DAY,
          gist: "Corran paid me less than the mainland price again.",
          template: "",
          about: ["corran"],
          topics: ["money", "buyer", "catch"],
          valence: -0.4,
          arousal: 0.45,
          rehearsed: [-20 * DAY],
        }),
        episode({
          id: "ep_jun_wren",
          tick: -5 * DAY,
          gist: "Wren let me sleep at the Gull when my roof leaked.",
          template: "",
          about: ["wren"],
          topics: ["tavern", "help"],
          valence: 0.5,
          arousal: 0.3,
          rehearsed: [],
        }),
      ],
      beliefs: [
        { id: "bel_jun_corran", about: "corran", topics: ["money", "buyer"], proposition: "Corran skims every catch he buys", confidence: 0.55, valence: -0.5, source: { kind: "inferred" }, formed: -20 * DAY, evidence: ["ep_jun_price"], retrievals: [-20 * DAY] },
        { id: "bel_jun_theo", about: "theo", topics: ["help", "boat"], proposition: "Theo is the kindest man on the island", confidence: 0.7, valence: 0.6, source: { kind: "inferred" }, formed: -18 * DAY, evidence: ["ep_skiff"], retrievals: [-18 * DAY, -4 * DAY] },
      ],
      habits: [{ id: "hab_jun_talk", cue: "tavern", action: "social", strength: 0.6 }],
      schemas: [],
      mood: 0.15,
      stress: 0.15,
    },
    seed,
    ablations,
  );
  return {
    mind,
    role: "fisher",
    home: "home_jun",
    routine: [
      { from: 7, place: "harbour", activity: "baiting lines" },
      { from: 8, place: "sea", activity: "out fishing" },
      { from: 12, place: "fishshed", activity: "selling the catch" },
      { from: 13, place: "harbour", activity: "fixing gear" },
      { from: 15, place: "tavern", activity: "an afternoon cup at the Gull" },
      { from: 16.5, place: "harbour", activity: "coiling lines" },
      { from: 18.5, place: "home_jun", activity: "at home", evening: { place: "tavern", activity: "holding court at the Gull" } },
      { from: 22.5, place: "home_jun", activity: "at home" },
    ],
    wants: [{ id: "w_jun_crew", kind: "request", target: "mara", what: "crew the long lines with me this week", topics: ["crew", "boat", "help", "rely"], goal: "g_crew" }],
  };
}

function corran(seed: number, ablations: Partial<Ablations>): CastMember {
  const mind = baseMind(
    {
      id: "corran",
      name: "Corran",
      pronouns: { subject: "he", object: "him", possessive: "his", reflexive: "himself" },
      identity: {
        summary:
          "Corran Vell, 52, buys the island's fish and sells it on the mainland. Shrewd, thin-skinned, keeps score. Believes the fishers think they're better than him.",
        voice: "Clipped, sardonic, always angling. Calls people 'friend' when he doesn't mean it.",
      },
      traits: { openness: 0.35, conscientiousness: 0.7, extraversion: 0.45, agreeableness: 0.3, neuroticism: 0.55, honesty: 0.28 },
      attachment: { anxiety: 0.35, avoidance: 0.65 },
      needs: { autonomy: 0.6, competence: 0.6, relatedness: 0.35, energy: 0.9 },
      goals: [
        { id: "g_margin", text: "Buy cheap and sell dear before the season closes", tags: ["money", "buyer", "catch", "price"], priority: 0.9, progress: 0.5, invested: 0.7, rate: 0 },
        { id: "g_respect", text: "Get the island to respect me", tags: ["reputation", "respect", "market"], priority: 0.6, progress: 0.2, invested: 0.4, rate: 0 },
      ],
      self: {
        selfEsteem: 0.45,
        selfEfficacy: 0.7,
        control: 0.65,
        lifeStory: "Without me their fish rots on the quay. They take my money and talk behind my back. Fine. I know a few things about them too.",
      },
      others: {
        mara: other("mara", "Mara", 0.3, 0.25, 0.1, -0.5, { integrity: 0.4 }),
        theo: other("theo", "Theo", 0.35, 0.3, 0.15, -0.2),
        jun: other("jun", "Jun", 0.5, 0.5, 0.3, 0.1),
        wren: other("wren", "Wren", 0.6, 0.55, 0.35, 0.2),
        visitor: visitor(),
      },
      episodes: [
        episode({
          id: "ep_market_row",
          tick: -70 * DAY + 10 * 60,
          gist: "Mara called me a cheat in front of the whole market.",
          template: "Mara {accusation} in front of the whole market over {amount}.",
          details: [
            ["accusation", "called me a cheat", 0.5],
            ["amount", "four crates of hake", -0.3],
          ],
          about: ["mara"],
          topics: ["money", "buyer", "market", "reputation"],
          valence: -0.6,
          arousal: 0.6,
          rehearsed: [-60 * DAY, -30 * DAY, -7 * DAY],
        }),
        episode({
          id: "ep_theo_drink",
          tick: -6 * DAY + 30,
          gist: "I saw Theo stagger out of the Gull past midnight.",
          template: "I saw Theo {state} out of the Gull {when}.",
          details: [
            ["state", "stagger", 0.2],
            ["when", "past midnight", -0.2],
          ],
          about: ["theo"],
          topics: ["tavern", "drink"],
          valence: -0.25,
          arousal: 0.4,
          rehearsed: [-5 * DAY],
        }),
        episode({
          id: "ep_cor_wren",
          tick: -30 * DAY,
          gist: "Wren kept my usual seat for me when the Gull was full.",
          template: "",
          about: ["wren"],
          topics: ["tavern"],
          valence: 0.35,
          arousal: 0.3,
          rehearsed: [],
        }),
        episode({
          id: "ep_cor_jun",
          tick: -12 * DAY,
          gist: "Jun sold me her whole catch when the mainland boat didn't come.",
          template: "",
          about: ["jun"],
          topics: ["catch", "buyer", "money"],
          valence: 0.3,
          arousal: 0.3,
          rehearsed: [],
        }),
      ],
      beliefs: [
        { id: "bel_cor_theo", about: "theo", topics: ["tavern", "drink"], proposition: "Theo drinks more than he lets on", confidence: 0.55, valence: -0.4, source: { kind: "inferred" }, formed: -5 * DAY, evidence: ["ep_theo_drink"], retrievals: [-5 * DAY] },
        { id: "bel_cor_mara", about: "mara", topics: ["reputation", "market"], proposition: "Mara thinks she's better than everyone", confidence: 0.65, valence: -0.5, source: { kind: "inferred" }, formed: -60 * DAY, evidence: ["ep_market_row"], retrievals: [-60 * DAY, -7 * DAY] },
      ],
      habits: [],
      schemas: [{ id: "sch_cor_looked_down", text: "People look down on me", triggers: ["reputation", "respect", "market"], blameBias: 0.3, threatBias: 0.1, strength: 0.5, origin: ["ep_market_row"] }],
      mood: -0.02,
      stress: 0.25,
    },
    seed,
    ablations,
  );
  return {
    mind,
    role: "fish buyer",
    home: "home_corran",
    routine: [
      { from: 7, place: "home_corran", activity: "doing the accounts" },
      { from: 9, place: "fishshed", activity: "buying fish" },
      { from: 14, place: "harbour", activity: "waiting on the mainland boat" },
      { from: 15.5, place: "fishshed", activity: "packing ice" },
      { from: 18, place: "home_corran", activity: "at home", evening: { place: "tavern", activity: "nursing a drink at the Gull" } },
      { from: 22, place: "home_corran", activity: "at home" },
    ],
    wants: [{ id: "w_cor_price", kind: "request", target: "jun", what: "sell me your catch at last week's price", topics: ["catch", "money", "buyer", "price"], goal: "g_margin" }],
  };
}

function wren(seed: number, ablations: Partial<Ablations>): CastMember {
  const mind = baseMind(
    {
      id: "wren",
      name: "Wren",
      pronouns: { subject: "she", object: "her", possessive: "her", reflexive: "herself" },
      identity: {
        summary:
          "Wren Hale, 45, keeps the Gull, the island's only tavern. Everyone's confidant. Remembers who drinks what and who isn't speaking to whom. Kind, but likes to be the one who knows.",
        voice: "Easy, motherly, teasing. Asks questions and lets people talk.",
      },
      traits: { openness: 0.6, conscientiousness: 0.55, extraversion: 0.72, agreeableness: 0.72, neuroticism: 0.35, honesty: 0.66 },
      attachment: { anxiety: 0.3, avoidance: 0.25 },
      needs: { autonomy: 0.6, competence: 0.65, relatedness: 0.65, energy: 0.9 },
      goals: [
        { id: "g_gull", text: "Keep the Gull full and the peace kept", tags: ["tavern", "peace"], priority: 0.8, progress: 0.6, invested: 0.8, rate: 0 },
        { id: "g_shutters", text: "Get the shutters fixed before the next storm", tags: ["shutters", "storm"], priority: 0.55, progress: 0.1, invested: 0.1, rate: 0 },
      ],
      self: {
        selfEsteem: 0.65,
        selfEfficacy: 0.65,
        control: 0.6,
        lifeStory: "Twenty years behind this bar. I've watched this island fall out and make up a hundred times. Most of it comes through my door sooner or later.",
      },
      others: {
        mara: other("mara", "Mara", 0.7, 0.65, 0.5, 0.2),
        theo: other("theo", "Theo", 0.75, 0.75, 0.55, 0.5),
        jun: other("jun", "Jun", 0.75, 0.75, 0.5, 0.5),
        corran: other("corran", "Corran", 0.4, 0.4, 0.3, 0.1, { integrity: 0.35 }),
        visitor: visitor(),
      },
      episodes: [
        episode({
          id: "ep_wren_beam",
          tick: -40 * DAY,
          gist: "Theo fixed the Gull's roof beam and wouldn't take money for it.",
          template: "",
          about: ["theo"],
          topics: ["tavern", "help", "roof"],
          valence: 0.55,
          arousal: 0.35,
          rehearsed: [-20 * DAY],
        }),
        episode({
          id: "ep_wren_tab",
          tick: -45 * DAY,
          gist: "Corran ran up a tab and only paid half of it.",
          template: "Corran ran up {amount} on his tab and {paid}.",
          details: [
            ["amount", "eleven shillings", 0],
            ["paid", "only paid half of it", 0.3],
          ],
          about: ["corran"],
          topics: ["money", "tavern"],
          valence: -0.4,
          arousal: 0.4,
          rehearsed: [-30 * DAY],
        }),
        episode({
          id: "ep_wren_mara",
          tick: -120 * DAY,
          gist: "Mara stopped coming to the Gull after her dad got sick.",
          template: "",
          about: ["mara"],
          topics: ["tavern", "family"],
          valence: -0.2,
          arousal: 0.3,
          rehearsed: [-40 * DAY],
        }),
        episode({
          id: "ep_wren_soaked",
          tick: STORM_NIGHT + 120,
          gist: "Theo came into the Gull soaked after the big storm and wouldn't say why.",
          template: "",
          about: ["theo"],
          topics: ["storm", "tavern", "dock"],
          valence: -0.05,
          arousal: 0.5,
          rehearsed: [-15 * DAY],
        }),
      ],
      beliefs: [
        { id: "bel_wren_theo", about: "theo", topics: ["love"], proposition: "Theo has a soft spot for Mara", confidence: 0.6, valence: 0.3, source: { kind: "inferred" }, formed: -30 * DAY, evidence: [], retrievals: [-30 * DAY, -10 * DAY] },
        { id: "bel_wren_corran", about: "corran", topics: ["money"], proposition: "Corran only pays when he's pushed", confidence: 0.5, valence: -0.3, source: { kind: "inferred" }, formed: -30 * DAY, evidence: ["ep_wren_tab"], retrievals: [-30 * DAY] },
      ],
      habits: [],
      schemas: [],
      mood: 0.15,
      stress: 0.15,
    },
    seed,
    ablations,
  );
  return {
    mind,
    role: "keeps the Gull",
    home: "tavern",
    routine: [
      { from: 7, place: "tavern", activity: "cleaning up" },
      { from: 10, place: "fishshed", activity: "buying for the kitchen" },
      { from: 11, place: "tavern", activity: "running the bar" },
    ],
    wants: [{ id: "w_wren_shutters", kind: "request", target: "theo", what: "fix the Gull's shutters before the next storm", topics: ["shutters", "storm", "help"], goal: "g_shutters" }],
  };
}

export const CAST_ORDER = ["mara", "theo", "jun", "corran", "wren"] as const;

export function createCast(seed: number, ablations: Partial<Ablations> = {}): CastMember[] {
  // Each mind gets its own stream of randomness derived from the world seed.
  const s = (i: number) => (Math.imul(seed + 1, 2654435761) ^ Math.imul(i + 1, 40503)) >>> 0;
  return [mara(s(0), ablations), theo(s(1), ablations), jun(s(2), ablations), corran(s(3), ablations), wren(s(4), ablations)];
}
