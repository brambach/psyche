// Hosts the living world. The clock runs on the server: while the world is playing, it advances
// some simulated minutes every second, and pushes what changed to everyone watching (a server-sent
// event stream of frame deltas, /api/stream). It keeps running with nobody watching, on the free
// offline mock, and tells you what happened while you were away.
// An island or village is saved as seed + inputs + recorded LLM calls, and restored by exact replay;
// a region is saved as it stands. Named save slots live in data/slots, hourly snapshots in data/snapshots.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import {
  buildLedger,
  BUILDERS,
  concerns,
  genealogy,
  influence,
  nodeId,
  strongestChain,
  why,
  divergence,
  saysVsWas,
  atlas,
  counterfactual,
  compareMyths,
  regionView,
  timeline,
  townScene,
  digest,
  RegionSession,
  frameDelta,
  deltaMemory,
  beats,
  warnings,
  momentNotices,
  chronicleNotices,
  awaySummary,
  type GameFrame,
  type Notice,
  type RegionState,
  type FeedItem,
  type CounterfactualEdit,
  type WorldState,
  type WorldSessionOptions,
  villageView,
  createVillage,
  CAST_ORDER,
  WORLD_START,
  type Ledger,
  createCast,
  createFounder,
  createWorld,
  describe,
  dryness,
  encodeGrid,
  FounderSession,
  get,
  hoursUntilStorm,
  isNight,
  progress,
  remainingHours,
  WorldSession,
  type Ablations,
  type AgentId,
  type BuilderId,
  type FacultyCall,
  type FounderInput,
  type MindState,
  type WorldInput,
} from "@psyche/engine";
import { createFaculties, createMockFaculties } from "@psyche/faculties";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = resolve(process.env.PSYCHE_DATA ?? "data");
const SAVE = join(DATA_DIR, "island.json");
const FOUNDERS_SAVE = join(DATA_DIR, "founders.json");
const WEB_DIST = resolve(process.env.PSYCHE_WEB ?? "packages/web/dist");
const FEED_SHOWN = 250;
const SLOTS_DIR = join(DATA_DIR, "slots");
const SNAP_DIR = join(DATA_DIR, "snapshots");
/** With nobody watching for this long, the world goes on with the offline mock (nobody is there to read the words). */
const AWAY_AFTER_MS = Number(process.env.PSYCHE_AWAY_AFTER ?? 120) * 1000;
/** Above this many sim minutes a real second, speech is on the offline mock: nobody can read it that fast. */
const FREE_ABOVE = 16;
/** The fastest the clock goes, in sim minutes a real second (100x). */
const MAX_SPEED = 400;

const { kind, faculties, governor } = createFaculties();

type Scenario = "island" | "village" | "region";
const SEEDS: Record<Scenario, number> = { island: 7, village: 11, region: 11 };

interface Saved {
  scenario?: Scenario;
  /** The last tick someone was watching, for "while you were away". */
  seen?: number;
  /** Named slots carry when they were saved. */
  savedAt?: number;
  seed: number;
  /** After a fast-forward the world starts again from where the years left it. */
  base?: WorldState;
  ablations: Partial<Ablations>;
  inputs: WorldInput[];
  log: FacultyCall[];
  /** A region is saved as it stands (towns change each other, so their logs alone can't replay it). */
  region?: { state: RegionState; worlds: Record<string, WorldState>; feeds: Record<string, FeedItem[]> };
}

const envScenario = process.env.PSYCHE_SCENARIO;
// The game is a civilization: a region of towns unless asked otherwise.
let scenario: Scenario = envScenario === "village" || envScenario === "island" ? envScenario : "region";
let seed = SEEDS[scenario];
let ablations: Partial<Ablations> = {};

/** Kettle Island (five minds) or Hollow Bay (the five and ten settlers, with food, houses and a common store). */
function makeWorld() {
  // In the village the Kettle five are the named characters (L0); settlers are L1 unless watched.
  governor.core.clear();
  if (scenario !== "island") for (const id of CAST_ORDER) governor.core.add(id);
  return scenario === "village" ? createVillage(seed, ablations) : createWorld(seed, ablations);
}
// A village runs for years: keep fewer snapshots and let the oldest traces go.
// A region runs unattended for years, so it keeps the least: two days of day-start snapshots and the
// newest 4000 traces (the ledger and the chronicle hold what matters from before).
const sessionOpts = (): WorldSessionOptions =>
  scenario === "island" ? {} : scenario === "region" ? { keepRecent: 24, keepDays: 2, maxTraces: 4_000 } : { keepRecent: 24, keepDays: 14, maxTraces: 15_000 };
/**
 * Towns run live (hour by hour, on Claude) only while watched: by default one at a time, the rest on
 * the aggregate tier, on rules. PSYCHE_LIVE_TOWNS raises it.
 */
const regionOpts = () => ({ session: sessionOpts(), live: Number(process.env.PSYCHE_LIVE_TOWNS) || 1, cheap: createMockFaculties(), maxTowns: Number(process.env.PSYCHE_MAX_TOWNS) || 16 });
/** In a region, the towns; `session` is the one being watched. */
let region: RegionSession | undefined;
let town = "hollow";
let session: WorldSession;
function start() {
  if (scenario === "region") {
    makeWorld();
    region = RegionSession.create(seed, faculties, regionOpts());
    town = "hollow";
    session = region.towns[town]!;
  } else {
    region = undefined;
    session = new WorldSession(makeWorld(), faculties, sessionOpts());
  }
}
start();
/** Years passing on the offline mock, in the background. */
let fastForward: { from: number; to: number; started: number } | undefined;
/** True once the session no longer starts from the seed (it was rebased after years passed). */
let base = false;
let running = process.env.PSYCHE_AUTOPLAY !== "0";
/** Simulated minutes per real second: 4 is 1x (a sim day in about four real minutes), 400 is 100x. */
let speed = 4;
let lastSaved = 0;
/** The last tick someone was watching. */
let seen = 0;

// Founders (F0): one builder on an empty islet. Its clock only runs while someone is watching.
interface FoundersSaved {
  seed: number;
  builder: BuilderId;
  inputs: FounderInput[];
  log: FacultyCall[];
}
let fSeed = 3;
let fBuilder: BuilderId = "mara";
let founders = new FounderSession(createFounder(fSeed, fBuilder), faculties);
let fRunning = process.env.PSYCHE_AUTOPLAY !== "0";
let fSpeed = 10;
let fWatched = 0;
let fSaved = 0;

// Every change to the world goes through one queue, so the clock and user actions never interleave.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

/** The world as it stands, in the form a save file keeps. */
function snapshot(): Saved {
  if (region) {
    const towns = Object.entries(region.towns);
    return { scenario, seed, ablations, seen, inputs: [], log: [], region: { state: region.region, worlds: region.worlds(), feeds: Object.fromEntries(towns.map(([id, s]) => [id, s.feed.slice(-FEED_SHOWN)])) } };
  }
  return { scenario, seed, ablations, seen, base: base ? session.initial : undefined, inputs: session.inputs, log: session.log };
}

/** Write a file whole or not at all, so a crash mid-write never leaves half a world. */
function writeJson(file: string, data: unknown) {
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data));
  renameSync(`${file}.tmp`, file);
}

let lastSnapshot = Date.now();
function save(force = false) {
  if (!force && Date.now() - lastSaved < (region ? 60_000 : 10_000)) return;
  lastSaved = Date.now();
  const saved = snapshot();
  writeJson(SAVE, saved);
  // An hourly copy, the last day of them kept, so a long unattended run can be wound back.
  if (Date.now() - lastSnapshot >= 3_600_000) {
    lastSnapshot = Date.now();
    writeJson(join(SNAP_DIR, `auto-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), saved);
    const old = readdirSync(SNAP_DIR).filter((f) => f.startsWith("auto-")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 24))) unlinkSync(join(SNAP_DIR, f));
  }
}

async function restore() {
  if (!existsSync(SAVE)) return;
  await restoreFrom(JSON.parse(readFileSync(SAVE, "utf8")) as Saved);
}

async function restoreFrom(saved: Saved) {
  resetGame();
  scenario = saved.scenario ?? "island";
  seed = saved.seed;
  ablations = saved.ablations;
  const world = makeWorld();
  if (saved.region) {
    region = new RegionSession(saved.region.state, saved.region.worlds, faculties, regionOpts());
    for (const [id, s] of Object.entries(region.towns)) {
      s.feed = saved.region.feeds[id] ?? [];
      region.region.last.feed[id] = s.feed.length;
    }
    town = Object.keys(region.towns)[0] ?? "hollow";
    session = region.focus(town);
    seen = saved.seen ?? region.region.tick;
    console.log(`Restored a region of ${region.region.towns.length} towns.`);
    return;
  }
  base = !!saved.base;
  const r = await WorldSession.replay(saved.base ?? world, saved.inputs, saved.log, faculties, sessionOpts());
  session = r.session;
  seen = saved.seen ?? session.world.tick;
  console.log(`Restored ${saved.inputs.length} inputs${r.divergedAt !== undefined ? ` (diverged at call ${r.divergedAt})` : ""}.`);
}

function saveFounders(force = false) {
  if (!force && Date.now() - fSaved < 10_000) return;
  fSaved = Date.now();
  mkdirSync(DATA_DIR, { recursive: true });
  const saved: FoundersSaved = { seed: fSeed, builder: fBuilder, inputs: founders.inputs, log: founders.log };
  writeFileSync(FOUNDERS_SAVE, JSON.stringify(saved));
}

async function restoreFounders() {
  if (!existsSync(FOUNDERS_SAVE)) return;
  const saved = JSON.parse(readFileSync(FOUNDERS_SAVE, "utf8")) as FoundersSaved;
  fSeed = saved.seed;
  fBuilder = saved.builder;
  const r = await FounderSession.replay(createFounder(fSeed, fBuilder), saved.inputs, saved.log, faculties);
  founders = r.session;
  console.log(`Restored Founders: ${saved.inputs.length} inputs${r.divergedAt !== undefined ? ` (diverged at call ${r.divergedAt})` : ""}.`);
}

async function tickFounders() {
  if (fRunning && Date.now() - fWatched < 15_000) {
    await exclusive(async () => {
      const t = founders.state.tick % 1440;
      // Nights pass quickly: nothing is built while the builder sleeps.
      const minutes = t >= 23 * 60 || t < 7 * 60 ? 60 : fSpeed;
      await founders.apply({ type: "advance", minutes });
      saveFounders();
    }).catch((e) => console.error(e));
  }
  setTimeout(() => void tickFounders(), 1000);
}

function foundersView() {
  const st = founders.state;
  const m = st.mind;
  const pr = st.project;
  const g = st.terrain.grid;
  const top = Object.entries(m.affect.emotions).sort((a, b) => b[1] - a[1])[0]!;
  return {
    faculties: kind,
    seed: fSeed,
    running: fRunning,
    speed: fSpeed,
    tick: st.tick,
    builders: createCast(fSeed).map((c) => ({ id: c.mind.id, name: c.mind.name, role: c.role, summary: c.mind.identity.summary })).filter((b) => (BUILDERS as readonly string[]).includes(b.id)),
    builder: {
      ...st.builder,
      pronouns: m.pronouns,
      summary: m.identity.summary,
      mood: m.affect.mood.valence,
      stress: m.affect.stress,
      fatigue: m.affect.fatigue,
      energy: m.needs.energy,
      emotion: top[1] > 0.12 ? { name: top[0], value: top[1] } : undefined,
      lifeStory: m.self.lifeStory,
      goals: m.goals.slice(0, 3),
    },
    plan: st.plan,
    storm: st.storm,
    hoursUntilStorm: st.storm.state === "coming" ? hoursUntilStorm(st, false) : 0,
    plot: st.terrain.plot,
    project: pr && {
      blueprint: pr.blueprint,
      proposed: pr.proposed,
      description: describe(pr.blueprint),
      proposedDescription: describe({ ...pr.blueprint, ...pr.proposed, roof: { ...pr.blueprint.roof, ...(pr.proposed.roof ?? {}) } }),
      rationale: pr.rationale,
      because: pr.because,
      repairs: pr.repairs,
      revisions: pr.revisions,
      bill: pr.bill,
      progress: progress(st),
      remainingHours: remainingHours(st),
      dryness: dryness(st),
      startedAt: pr.startedAt,
      finishedAt: pr.finishedAt,
      trace: pr.trace,
      ghost: pr.placements.filter((p) => get(g, p.x, p.y, p.z) !== p.b).map((p) => [p.x, p.y, p.z, p.b]),
    },
    grid: { version: g.version, w: g.w, d: g.d, h: g.h },
    feed: founders.feed.slice(-FEED_SHOWN),
    traces: founders.traces.map((t) => ({ id: t.id, tick: t.tick, kind: t.kind, heard: t.percept?.rawText, action: t.action?.text, system: t.decision?.system, llm: t.llmCalls })),
    rewind: founders.frames.filter((f) => f.state && (f.dayStart || f.index >= founders.frames.length - 80)).map((f) => ({ index: f.index, tick: f.tick, dayStart: f.dayStart })),
    calls: founders.log.length,
    callsBy: founders.log.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.faculty]: (acc[c.faculty] ?? 0) + 1 }), {}),
  };
}

function foundersTrace(id: string) {
  const pos = founders.traces.findIndex((t) => t.id === id);
  if (pos < 0) return undefined;
  const frame = founders.frameOfTrace(pos);
  const later = frame ? founders.frames.slice(frame.index).find((f) => f.state) : undefined;
  const state = later?.state?.mind ?? founders.state.mind;
  const upto = frame?.index ?? founders.frames.length - 1;
  const trail = founders.frames
    .slice(0, upto + 1)
    .filter((f) => f.state)
    .slice(-40)
    .map((f) => ({ v: f.state!.mind.affect.mood.valence, a: f.state!.mind.affect.mood.arousal }));
  return { trace: founders.traces[pos]!, state, trail: [{ v: founders.initial.mind.affect.mood.valence, a: founders.initial.mind.affect.mood.arousal }, ...trail] };
}

/** Run the village on for some years, free: every faculty on the offline mock (L2 for everyone). */
async function passYears(years: number) {
  const w = session.world;
  const yearDays = (w.village?.seasonDays ?? 4) * 4;
  fastForward = { from: w.tick, to: w.tick + Math.round(years * yearDays) * 1440, started: Date.now() };
  running = false;
  try {
    while (session.world.tick < fastForward.to) {
      // A day per turn of the queue, so the UI can still read the world while years go by.
      await exclusive(async () => {
        governor.quiet = true;
        try {
          for (let h = 0; h < 4; h++) {
            if (region) await region.advance(360, { snapshot: false });
            else await session.apply({ type: "advance", minutes: 360 }, { snapshot: false });
          }
        } finally {
          governor.quiet = false;
        }
        if (session.frames.length > 4 * yearDays) region ? region.rebase() : session.rebase();
        collectNotices();
      });
      broadcast();
    }
    await exclusive(async () => {
      region ? region.rebase() : session.rebase();
      base = true;
    });
    save(true);
  } finally {
    fastForward = undefined;
  }
}

/**
 * Why speech is on the free mock right now, if it is: nobody has watched for a while, or the clock is
 * running faster than anyone could read. The minds underneath run the same either way.
 */
function freeReason(): "away" | "fast" | undefined {
  if (kind === "mock") return undefined;
  if (viewers.size === 0 && Date.now() - lastViewer > AWAY_AFTER_MS) return "away";
  if (speed > FREE_ABOVE) return "fast";
  return undefined;
}

/** Sim minutes actually covered in the last real second (the clock may fall behind at 100x in a big town). */
let pace = 0;
/**
 * What watched play costs: dollars and sim days counted only while speech was on the model (not while
 * away or above 4x), so the price per hour shown is the price of watching, not diluted by free time.
 */
let paid = { usd: 0, days: 0 };

async function tickClock() {
  const started = Date.now();
  if (running && !fastForward) {
    await exclusive(async () => {
      const free = !!freeReason();
      governor.quiet = free;
      const usd0 = governor.snapshot().sessionUsd;
      try {
        // Advance in strides of up to an hour until this second's minutes are done, or the second is.
        let left = speed;
        let covered = 0;
        while (left > 0 && Date.now() - started < 850) {
          const w = session.world;
          // Nights pass in one stride: everyone is asleep, and sleep itself is one step per mind.
          const night = isNight(w.tick);
          const minutes = night ? Math.round(((7 * 60 - (w.tick % 1440)) + 1440) % 1440) || 1440 : Math.min(left, 60);
          if (region) await region.advance(minutes, { snapshot: speed <= FREE_ABOVE });
          else await session.apply({ type: "advance", minutes }, { snapshot: speed <= FREE_ABOVE });
          covered += minutes;
          if (night) break;
          left -= minutes;
        }
        pace = covered;
        if (!free) {
          paid.usd += governor.snapshot().sessionUsd - usd0;
          paid.days += covered / 1440;
        }
        // A world that runs for days piles up inputs, recorded calls and frames; keep them bounded the
        // way years passing does (you can't rewind past a rebase, as with years passing).
        if (session.frames.length > (speed > FREE_ABOVE ? 400 : 2000)) {
          if (region) region.rebase();
          else {
            session.rebase();
            base = true;
          }
        }
      } finally {
        governor.quiet = false;
      }
      save();
      collectNotices();
    }).catch((e) => console.error(e));
    broadcast();
  }
  setTimeout(() => void tickClock(), Math.max(50, 1000 - (Date.now() - started)));
}

function summary(m: MindState) {
  const top = Object.entries(m.affect.emotions).sort((a, b) => b[1] - a[1])[0]!;
  return {
    mood: m.affect.mood.valence,
    valence: m.affect.valence,
    arousal: m.affect.arousal,
    stress: m.affect.stress,
    fatigue: m.affect.fatigue,
    emotion: top[1] > 0.12 ? { name: top[0], value: top[1] } : undefined,
    needs: m.needs,
    pronoun: m.pronouns.object,
  };
}

function view() {
  const w = session.world;
  const believers = (rumor: string) =>
    w.order.flatMap((id) => {
      const b = w.minds[id]!.beliefs.find((x) => x.rumor === rumor);
      return b ? [{ agent: id, confidence: b.confidence, text: b.proposition }] : [];
    });
  return {
    faculties: kind,
    scenario,
    name: w.name,
    places: w.places,
    village: villageView(w),
    region: region && regionView(region),
    town: region ? town : undefined,
    fastForward: fastForward && { ...fastForward, at: w.tick },
    seed,
    running,
    speed,
    tick: w.tick,
    ablations: w.minds[w.order[0]!]!.ablations,
    order: w.order,
    agents: w.order.map((id) => {
      const a = w.agents[id]!;
      const household = w.village ? Object.values(w.village.households).find((h) => h.members.includes(id))?.id : undefined;
      return { id, name: a.name, role: a.role, place: a.place, activity: a.activity, household, talking: (a.talkingUntil ?? -1) > w.tick, ...summary(w.minds[id]!) };
    }),
    relations: w.order.flatMap((from) =>
      w.order
        .filter((to) => to !== from && w.minds[from]!.others[to])
        .map((to) => {
          const o = w.minds[from]!.others[to]!;
          return { from, to, liking: o.liking, benevolence: o.trust.benevolence, integrity: o.trust.integrity, believedRegard: o.believedRegard };
        }),
    ),
    feed: session.feed.slice(-FEED_SHOWN),
    rumors: Object.values(w.rumors)
      .filter((r) => r.hops.length > 0)
      .map((r) => ({ ...r, believers: believers(r.id) }))
      .sort((a, b) => b.hops[b.hops.length - 1]!.tick - a.hops[a.hops.length - 1]!.tick),
    rewind: region ? [] : session.frames.filter((f) => f.state && (f.dayStart || f.index >= session.frames.length - 80)).map((f) => ({ index: f.index, tick: f.tick, dayStart: f.dayStart })),
    calls: session.log.length,
    cost: costView(),
    conversations: session.feed.filter((f) => f.kind === "talk").length,
  };
}

// The causal ledger is rebuilt from the session when someone asks and the island has moved on.
let ledgerCache: { session: WorldSession; traces: number; ledger: Ledger } | undefined;
function ledger(): Ledger {
  if (ledgerCache?.session !== session || ledgerCache.traces !== session.traces.length) {
    const w = session.world;
    ledgerCache = { session, traces: session.traces.length, ledger: buildLedger({ minds: w.minds, traces: session.traces, rumors: w.rumors, events: w.events, village: w.village }) };
  }
  return ledgerCache.ledger;
}

// ------------------------------------------------------------------ the live game (G1)

/** Everyone watching: the open event streams. */
const viewers = new Set<ServerResponse>();
/** When the last viewer left (or now, while someone is watching). */
let lastViewer = Date.now();
/** What the stream last sent, so each tick sends only what changed. */
let memory = deltaMemory();
let notices: Notice[] = [];
let noticeIds = new Set<string>();
/** How far the notices have read the chronicle and the watched town's feed. */
let noticedChronicle = 0;
let noticedFeed = 0;

/** A new or loaded world starts with nothing noticed and a fresh stream. */
function resetGame() {
  paid = { usd: 0, days: 0 };
  notices = [];
  noticeIds = new Set();
  noticedChronicle = Number.MAX_SAFE_INTEGER;
  noticedFeed = Number.MAX_SAFE_INTEGER;
  memory = deltaMemory();
}

/** Collect what a player should be told: chronicle entries, big moments in the watched town, warnings. */
function collectNotices() {
  const w = session.world;
  if (noticedChronicle === Number.MAX_SAFE_INTEGER) noticedChronicle = w.tick;
  if (noticedFeed === Number.MAX_SAFE_INTEGER) noticedFeed = w.tick;
  const history = region ? chronicleNotices(region.region.chronicle, noticedChronicle) : [];
  // In a region the chronicle already tells a town's history; moments add the rest of what the watched
  // town lives through, without telling the same thing twice (a leader's death is both).
  const told = (n: Notice) => [...history, ...notices].some((h) => h.kind === "chronicle" && h.agent === n.agent && Math.abs(h.tick - n.tick) <= 1440);
  const moments = momentNotices(session.feed.slice(-200), noticedFeed, region ? town : undefined).filter((n) => !n.agent || !told(n));
  const fresh = [...history, ...moments, ...warnings(w, region ? town : undefined, region)];
  noticedChronicle = region?.region.tick ?? w.tick;
  noticedFeed = w.tick;
  for (const n of fresh) {
    if (noticeIds.has(n.id)) continue;
    noticeIds.add(n.id);
    notices.push(n);
  }
  if (notices.length > 40) notices = notices.slice(-40);
}

/** Sim days a real hour at the current speed: waking hours at `speed` minutes a second, each night in one second. */
function simDaysPerHour() {
  const waking = 16 * 60;
  return 3600 / (waking / Math.max(1, Math.min(speed, pace || speed)) + 1);
}

function townCard(w: WorldState) {
  const v = w.village;
  if (!v) return undefined;
  const vv = villageView(w)!;
  const adults = vv.people.filter((p) => p.alive && p.age >= 12).length;
  const homes = vv.households.filter((h) => h.members.length);
  return {
    people: w.order.length,
    adults,
    children: w.order.length - adults,
    households: homes.length,
    houses: homes.filter((h) => h.shelter === "house").length,
    tents: homes.filter((h) => h.shelter !== "house").length,
    building: vv.structures.filter((x) => !x.done).map((x) => ({ name: x.name, progress: x.progress })),
    store: Math.round(vv.store.food),
    leader: vv.leader,
    leaderName: vv.leader ? (w.agents[vv.leader]?.name ?? vv.people.find((p) => p.id === vv.leader)?.name) : undefined,
    laws: vv.laws.filter((l) => l.passed).length,
    norms: vv.norms.filter((n) => n.established !== undefined).map((n) => n.text),
    year: vv.year,
    season: vv.season,
    weather: vv.weather,
  };
}

/** Everything on a player's screen, as one frame. Keyed lists go down the wire item by item. */
function gameFrame(): GameFrame {
  const w = session.world;
  const rv = region && regionView(region);
  const cost = costView();
  const free = freeReason();
  const perSimDay = paid.days > 0.05 ? paid.usd / paid.days : undefined;
  const perHour = perSimDay !== undefined ? perSimDay * simDaysPerHour() : undefined;
  const frame: GameFrame = {
    scenario,
    name: w.name,
    seed,
    faculties: kind,
    running,
    speed,
    pace,
    free,
    tick: w.tick,
    town: region ? town : undefined,
    fastForward: fastForward && { ...fastForward, at: w.tick },
    viewers: viewers.size,
    cost: {
      sessionUsd: cost.sessionUsd,
      todayUsd: cost.todayUsd,
      capUsd: cost.capUsd,
      level: cost.level,
      estimated: cost.estimated,
      perSimDay,
      // What an hour of this costs at this speed: nothing while speech is on the mock.
      perHour: free ? 0 : perHour,
      perHourAt1x: perSimDay !== undefined ? perSimDay * (3600 / (16 * 60 / 4 + 1)) : undefined,
    },
    card: townCard(w),
    places: w.places,
    towns: rv?.towns.map((t) => ({ id: t.id, name: t.name, people: t.people, children: t.children, leaderName: t.leaderName, tier: t.tier, crafts: t.crafts, lost: t.lost, laws: t.laws, store: t.store, founded: t.founded, from: t.from })),
    year: rv?.year ?? villageView(w)?.year,
    chronicle: rv?.chronicle.slice(-30).reverse(),
    agents: w.order.map((id) => {
      const a = w.agents[id]!;
      const m = w.minds[id]!;
      const top = Object.entries(m.affect.emotions).sort((x, y) => y[1] - x[1])[0]!;
      return { id, name: a.name, role: a.role, activity: a.activity, place: a.place, mood: Number(m.affect.mood.valence.toFixed(2)), emotion: top[1] > 0.12 ? top[0] : undefined };
    }),
    feed: session.feed.slice(-40).reverse().map((f) => ({ id: f.id, tick: f.tick, kind: f.kind, title: f.title, text: f.text, agents: f.agents, refs: f.refs?.slice(0, 1), line: f.lines?.[0] })),
    beats: beats(session.feed.slice(-200), w.tick),
    notices,
  };
  if (w.village) {
    const scene = townScene(w, session.feed.slice(-120), session.feed.filter((f) => f.kind === "event" || f.kind === "insight").slice(-12));
    for (const [k, v] of Object.entries(scene)) frame[`scene.${k}`] = v;
  }
  return frame;
}

function sse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Send everyone what changed since the last frame. */
function broadcast() {
  if (!viewers.size) return;
  seen = session.world.tick;
  lastViewer = Date.now();
  const d = frameDelta(memory, gameFrame());
  if (d) for (const res of viewers) sse(res, "delta", d);
}

/** A new viewer: the whole frame, and what happened while nobody was watching. */
function openStream(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write("retry: 2000\n\n");
  const wasEmpty = viewers.size === 0;
  const since = seen;
  // Everyone shares one delta stream, so a newcomer gets the full frame that stream is now based on.
  memory = deltaMemory();
  const frame = gameFrame();
  frameDelta(memory, frame);
  for (const v of viewers) sse(v, "full", frame);
  sse(res, "full", frame);
  viewers.add(res);
  if (wasEmpty && region && region.region.tick - since >= 1440) sse(res, "away", awaySummary(region, since));
  seen = session.world.tick;
  lastViewer = Date.now();
  const beat = setInterval(() => res.write(": still here\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(beat);
    viewers.delete(res);
    lastViewer = Date.now();
  });
}

// ------------------------------------------------------------------ save slots

const slotName = (n: unknown) => (typeof n === "string" ? n.trim().replace(/[^\w \-]/g, "").replace(/\s+/g, " ").slice(0, 40) : "");
const slotFile = (name: string) => join(SLOTS_DIR, `${name.toLowerCase().replace(/ /g, "_")}.json`);

function listSlots() {
  if (!existsSync(SLOTS_DIR)) return [];
  return readdirSync(SLOTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const file = join(SLOTS_DIR, f);
      try {
        const head = JSON.parse(readFileSync(file, "utf8")) as Saved & { name?: string; summary?: { world: string; tick: number; year?: number; towns: number; people: number } };
        return { name: head.name ?? f.replace(/\.json$/, ""), savedAt: head.savedAt ?? statSync(file).mtimeMs, scenario: head.scenario ?? "island", ...head.summary };
      } catch {
        return undefined;
      }
    })
    .filter((x) => !!x)
    .sort((a, b) => b!.savedAt - a!.savedAt);
}

function saveSlot(name: string) {
  const w = session.world;
  const rv = region && regionView(region);
  const summary = { world: w.name, tick: w.tick, year: rv?.year ?? villageView(w)?.year, towns: rv?.towns.length ?? 1, people: rv ? rv.towns.reduce((n, t) => n + t.people, 0) : w.order.length };
  writeJson(slotFile(name), { ...snapshot(), name, savedAt: Date.now(), summary });
}

function costView() {
  const days = (session.world.tick - WORLD_START) / 1440;
  const snap = governor.snapshot();
  return { ...snap, perSimDay: days > 0.05 ? snap.sessionUsd / days : undefined };
}

function concernsView(id: AgentId) {
  const mind = session.world.minds[id];
  if (!mind) return undefined;
  const L = ledger();
  return {
    concerns: concerns(L, mind, session.world.tick).map((c) => {
      const inf = influence(L, c.id);
      return { ...c, decisions: inf?.decisions.length ?? 0, direct: inf?.direct ?? 0, minds: inf?.minds ?? [] };
    }),
    nodes: L.nodes.size,
    edges: L.edges.length,
  };
}

/** Why, for a node id, or for the moment a trace recorded (its decision, or the memory it made). */
function whyView(node: string | null, agent: string | null, trace: string | null) {
  const L = ledger();
  let id = node ?? undefined;
  if (!id && agent && trace) {
    id = L.nodes.has(nodeId.decision(agent, trace)) ? nodeId.decision(agent, trace) : [...L.nodes.values()].find((n) => n.agent === agent && n.trace === trace)?.id;
  }
  const tree = id ? why(L, id) : undefined;
  if (!id || !tree) return undefined;
  const g = genealogy(L, id)!;
  const inf = influence(L, id)!;
  return {
    tree,
    chain: strongestChain(tree),
    genealogy: { ancestors: g.ancestors.length, roots: g.roots, minds: g.minds },
    influence: { direct: inf.direct, decisions: inf.decisions.slice(0, 12), total: inf.decisions.length, minds: inf.minds },
  };
}

/** What the person could say about a choice, against what the ledger finds behind it. */
function accountView(agent: string, trace: string) {
  return saysVsWas(ledger(), nodeId.decision(agent, trace));
}

function agentView(id: AgentId) {
  const w = session.world;
  const mind = w.minds[id];
  if (!mind) return undefined;
  const traces = session.traces
    .filter((t) => t.agent === id)
    .slice(-200)
    .map(({ trace: t }) => ({
      id: t.id,
      tick: t.tick,
      kind: t.kind,
      question: t.headline.question,
      heard: t.percept?.rawText,
      action: t.action?.text,
      actionKind: t.action?.kind,
      system: t.decision?.system,
      changed: t.reconsolidations.some((r) => r.version.changes.length > 0),
    }));
  // How others actually feel about this person, to set against what this person believes.
  const actual = Object.fromEntries(w.order.filter((o) => o !== id).map((o) => [o, w.minds[o]!.others[id]?.liking ?? 0.5]));
  return { mind, agent: w.agents[id], traces, actual };
}

function traceView(agent: AgentId, traceId: string) {
  const pos = session.traces.findIndex((t) => t.agent === agent && t.trace.id === traceId);
  if (pos < 0) return undefined;
  const frame = session.frameOfTrace(pos);
  const later = frame ? session.frames.slice(frame.index).find((f) => f.state) : undefined;
  const state = later?.state?.minds[agent] ?? session.world.minds[agent]!;
  const upto = frame?.index ?? session.frames.length - 1;
  const trail = session.frames
    .slice(0, upto + 1)
    .filter((f) => f.state)
    .slice(-40)
    .map((f) => ({ v: f.state!.minds[agent]!.affect.mood.valence, a: f.state!.minds[agent]!.affect.mood.arousal }));
  return { trace: session.traces[pos]!.trace, state, trail: [{ v: session.initial.minds[agent]!.affect.mood.valence, a: session.initial.minds[agent]!.affect.mood.arousal }, ...trail] };
}

async function body<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return (chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}) as T;
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  if (!p.startsWith("/api/")) {
    const file = join(WEB_DIST, p === "/" ? "index.html" : p);
    if (file.startsWith(WEB_DIST) && existsSync(file)) {
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } else if (existsSync(join(WEB_DIST, "index.html"))) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(readFileSync(join(WEB_DIST, "index.html")));
    } else send(res, 404, { error: "Web UI not built. Run npm run dev, or npm run build first." });
    return;
  }
  if (req.method === "GET") {
    if (p === "/api/stream") return openStream(req, res);
    if (p === "/api/slots") return send(res, 200, { slots: listSlots() });
    if (p === "/api/divergence") return send(res, 200, { events: divergence(session.world) });
    if (p === "/api/myths") return region ? send(res, 200, compareMyths(region)) : send(res, 404, { error: "Only a region has more than one town." });
    if (p === "/api/atlas") return send(res, 200, { beliefs: atlas(session.world) });
    if (p === "/api/town3d") return session.world.village ? send(res, 200, townScene(session.world, session.feed.slice(-120), session.feed.filter((f) => f.kind === "event" || f.kind === "insight").slice(-12))) : send(res, 404, { error: "Only a village has a 3D view." });
    if (p === "/api/timeline") return region ? send(res, 200, timeline(region)) : send(res, 404, { error: "Only a region has a timeline." });
    if (p === "/api/digest") {
      if (!region) return send(res, 404, { error: "Only a region has a digest." });
      const year = regionView(region).year;
      const from = Number(url.searchParams.get("from")) || Math.max(1, year - 9);
      return send(res, 200, { from, to: year, text: digest(region, from, year) });
    }
    if (p === "/api/account") {
      const v = accountView(url.searchParams.get("agent") ?? "", url.searchParams.get("trace") ?? "");
      return v ? send(res, 200, v) : send(res, 404, { error: "No decision at that moment." });
    }
    if (p === "/api/founders") {
      fWatched = Date.now();
      return send(res, 200, foundersView());
    }
    if (p === "/api/founders/grid") {
      const g = founders.state.terrain.grid;
      return send(res, 200, { version: g.version, w: g.w, d: g.d, h: g.h, cells: encodeGrid(g) });
    }
    const ftrace = /^\/api\/founders\/trace\/(\w+)$/.exec(p);
    if (ftrace) {
      const v = foundersTrace(ftrace[1]!);
      return v ? send(res, 200, v) : send(res, 404, { error: "That moment is gone (it was rewound)." });
    }
    if (p === "/api/world") return send(res, 200, view());
    if (p === "/api/cost") return send(res, 200, costView());
    const cons = /^\/api\/concerns\/(\w+)$/.exec(p);
    if (cons) {
      const v = concernsView(cons[1]!);
      return v ? send(res, 200, v) : send(res, 404, { error: "No such islander" });
    }
    if (p === "/api/why") {
      const v = whyView(url.searchParams.get("node"), url.searchParams.get("agent"), url.searchParams.get("trace"));
      return v ? send(res, 200, v) : send(res, 404, { error: "Nothing in the ledger for that yet." });
    }
    const agent = /^\/api\/agent\/(\w+)$/.exec(p);
    if (agent) {
      const v = agentView(agent[1]!);
      return v ? send(res, 200, v) : send(res, 404, { error: "No such islander" });
    }
    const trace = /^\/api\/trace\/(\w+)\/(\w+)$/.exec(p);
    if (trace) {
      const v = traceView(trace[1]!, trace[2]!);
      return v ? send(res, 200, v) : send(res, 404, { error: "That moment is gone (it was rewound)." });
    }
    return send(res, 404, { error: `No route ${p}` });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST" });
  try {
    if (p === "/api/founders/control") {
      const b = await body<{ running?: boolean; speed?: number }>(req);
      if (b.running !== undefined) fRunning = b.running;
      if (b.speed !== undefined) fSpeed = Math.max(1, Math.min(120, Math.round(b.speed)));
      return send(res, 200, foundersView());
    }
    if (p === "/api/founders/input") {
      const { input } = await body<{ input: FounderInput }>(req);
      await exclusive(() => founders.apply(input));
      saveFounders(true);
      return send(res, 200, foundersView());
    }
    if (p === "/api/founders/rewind") {
      const { index } = await body<{ index: number }>(req);
      await exclusive(async () => founders.rewind(index));
      fRunning = false;
      saveFounders(true);
      return send(res, 200, foundersView());
    }
    if (p === "/api/founders/reset") {
      const b = await body<{ seed?: number; builder?: BuilderId }>(req);
      await exclusive(async () => {
        fSeed = b.seed ?? fSeed;
        fBuilder = b.builder && (BUILDERS as readonly string[]).includes(b.builder) ? b.builder : fBuilder;
        founders = new FounderSession(createFounder(fSeed, fBuilder), faculties);
      });
      saveFounders(true);
      return send(res, 200, foundersView());
    }
    if (p === "/api/years") {
      const b = await body<{ years?: number }>(req);
      if (!session.world.village) return send(res, 400, { error: "Only a village can pass years." });
      if (fastForward) return send(res, 409, { error: "Years are already passing." });
      void passYears(Math.max(0.25, Math.min(50, b.years ?? 1))).catch((e) => console.error(e));
      return send(res, 200, view());
    }
    if (p === "/api/counterfactual") {
      // What if not: run on from now twice on the offline mock, once without the item.
      const b = await body<CounterfactualEdit & { days?: number }>(req);
      const snapshot = structuredClone(session.world);
      const r = await counterfactual(snapshot, createMockFaculties(), { agent: b.agent, kind: b.kind, id: b.id }, Math.max(1, Math.min(16, b.days ?? 4)));
      return r ? send(res, 200, r) : send(res, 404, { error: "Nothing with that id in that mind." });
    }
    if (p === "/api/town") {
      const b = await body<{ town?: string }>(req);
      if (!region || !b.town || !region.region.towns.some((t) => t.id === b.town)) return send(res, 404, { error: "No such town." });
      if (fastForward) return send(res, 409, { error: "Years are passing. Wait for them to finish." });
      // Looking at a town brings it back to the hourly loop; the one you left drops to the aggregate tier.
      await exclusive(async () => {
        town = b.town!;
        session = region!.focus(town);
        // The town you arrive in has its own feed; notice what happens from now on.
        noticedFeed = session.world.tick;
      });
      return send(res, 200, view());
    }
    if (p === "/api/focus") {
      // Whoever you are looking at speaks with the model, however small the moment (L0 in the plan).
      const b = await body<{ agents?: string[] }>(req);
      governor.focus.clear();
      for (const a of b.agents ?? []) governor.focus.add(a);
      return send(res, 200, { focus: [...governor.focus] });
    }
    if (p === "/api/control") {
      const b = await body<{ running?: boolean; speed?: number }>(req);
      if (b.running !== undefined) running = b.running;
      if (b.speed !== undefined) speed = Math.max(1, Math.min(MAX_SPEED, Math.round(b.speed)));
      return send(res, 200, view());
    }
    if (p === "/api/slots/save") {
      const name = slotName((await body<{ name?: string }>(req)).name);
      if (!name) return send(res, 400, { error: "Give the save a name." });
      await exclusive(async () => saveSlot(name));
      return send(res, 200, { slots: listSlots() });
    }
    if (p === "/api/slots/load") {
      const name = slotName((await body<{ name?: string }>(req)).name);
      if (!name || !existsSync(slotFile(name))) return send(res, 404, { error: "No save by that name." });
      if (fastForward) return send(res, 409, { error: "Years are passing. Wait for them to finish." });
      await exclusive(async () => {
        await restoreFrom(JSON.parse(readFileSync(slotFile(name), "utf8")) as Saved);
        governor.resetSession();
      });
      save(true);
      return send(res, 200, { slots: listSlots() });
    }
    if (p === "/api/slots/delete") {
      const name = slotName((await body<{ name?: string }>(req)).name);
      if (name && existsSync(slotFile(name))) unlinkSync(slotFile(name));
      return send(res, 200, { slots: listSlots() });
    }
    if (p === "/api/input") {
      if (fastForward) return send(res, 409, { error: "Years are passing. Wait for them to finish." });
      const { input } = await body<{ input: WorldInput }>(req);
      await exclusive(() => session.apply(input));
      save(true);
      return send(res, 200, view());
    }
    if (p === "/api/rewind") {
      if (fastForward) return send(res, 409, { error: "Years are passing. Wait for them to finish." });
      if (region) return send(res, 409, { error: "Rewinding isn't available across towns yet." });
      const { index } = await body<{ index: number }>(req);
      await exclusive(async () => session.rewind(index));
      running = false;
      save(true);
      return send(res, 200, view());
    }
    if (p === "/api/reset") {
      if (fastForward) return send(res, 409, { error: "Years are passing. Wait for them to finish." });
      const b = await body<{ seed?: number; ablations?: Partial<Ablations>; scenario?: Scenario }>(req);
      await exclusive(async () => {
        if (b.scenario && b.scenario !== scenario) {
          scenario = b.scenario;
          seed = b.seed ?? SEEDS[scenario];
        } else seed = b.seed ?? seed;
        ablations = b.ablations ?? ablations;
        start();
        resetGame();
        seen = session.world.tick;
        base = false;
        governor.resetSession();
      });
      save(true);
      return send(res, 200, view());
    }
    return send(res, 404, { error: `No route ${p}` });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

await restore();
await restoreFounders();
// Anything a player does shows on every screen at once.
createServer((req, res) => void route(req, res).finally(() => req.method === "POST" && broadcast())).listen(PORT, () => {
  console.log(`Psyche (${session.world.name}) on http://localhost:${PORT} (faculties: ${kind}, ${running ? "playing" : "paused"})`);
  console.log(kind === "claude" ? `Daily cap $${governor.capUsd} (PSYCHE_DAILY_CAP). Spend so far today: $${governor.todayUsd().toFixed(4)}.` : "Offline mock: the cost meter shows what the same run would cost on Claude.");
});
void tickClock();
void tickFounders();
