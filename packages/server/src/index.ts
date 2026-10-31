// Hosts the living island. The clock runs on the server: while the world is playing, it advances
// a few simulated minutes every second, and the web UI polls for what happened.
// The session is saved as seed + inputs + recorded LLM calls, and restored by exact replay.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const { kind, faculties, governor } = createFaculties();

type Scenario = "island" | "village" | "region";
const SEEDS: Record<Scenario, number> = { island: 7, village: 11, region: 11 };

interface Saved {
  scenario?: Scenario;
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
let scenario: Scenario = envScenario === "village" || envScenario === "region" ? envScenario : "island";
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
const sessionOpts = (): WorldSessionOptions => (scenario === "island" ? {} : { keepRecent: 24, keepDays: 14, maxTraces: scenario === "region" ? 8_000 : 15_000 });
/**
 * Towns run live (hour by hour, on Claude) only while watched: by default one at a time, the rest on
 * the aggregate tier, on rules. PSYCHE_LIVE_TOWNS raises it.
 */
const regionOpts = () => ({ session: sessionOpts(), live: Number(process.env.PSYCHE_LIVE_TOWNS) || 1, cheap: createMockFaculties() });
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
/** Simulated minutes per real second. */
let speed = 10;
let lastSaved = 0;

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

function save(force = false) {
  if (!force && Date.now() - lastSaved < (region ? 60_000 : 10_000)) return;
  lastSaved = Date.now();
  mkdirSync(DATA_DIR, { recursive: true });
  if (region) {
    const towns = Object.entries(region.towns);
    const saved: Saved = { scenario, seed, ablations, inputs: [], log: [], region: { state: region.region, worlds: region.worlds(), feeds: Object.fromEntries(towns.map(([id, s]) => [id, s.feed.slice(-FEED_SHOWN)])) } };
    writeFileSync(SAVE, JSON.stringify(saved));
    return;
  }
  const saved: Saved = { scenario, seed, ablations, base: base ? session.initial : undefined, inputs: session.inputs, log: session.log };
  writeFileSync(SAVE, JSON.stringify(saved));
}

async function restore() {
  if (!existsSync(SAVE)) return;
  const saved = JSON.parse(readFileSync(SAVE, "utf8")) as Saved;
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
    console.log(`Restored a region of ${region.region.towns.length} towns.`);
    return;
  }
  base = !!saved.base;
  const r = await WorldSession.replay(saved.base ?? world, saved.inputs, saved.log, faculties, sessionOpts());
  session = r.session;
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
      });
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

async function tickClock() {
  if (running && !fastForward) {
    await exclusive(async () => {
      const w = session.world;
      // Nights pass in one stride: everyone is asleep, and sleep itself is one step per mind.
      const minutes = isNight(w.tick) ? Math.round(((7 * 60 - (w.tick % 1440)) + 1440) % 1440) || 1440 : speed;
      if (region) await region.advance(minutes);
      else await session.apply({ type: "advance", minutes });
      save();
    }).catch((e) => console.error(e));
  }
  setTimeout(() => void tickClock(), 1000);
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
    if (p === "/api/divergence") return send(res, 200, { events: divergence(session.world) });
    if (p === "/api/myths") return region ? send(res, 200, compareMyths(region)) : send(res, 404, { error: "Only a region has more than one town." });
    if (p === "/api/atlas") return send(res, 200, { beliefs: atlas(session.world) });
    if (p === "/api/town3d") return session.world.village ? send(res, 200, townScene(session.world)) : send(res, 404, { error: "Only a village has a 3D view." });
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
      if (b.speed !== undefined) speed = Math.max(1, Math.min(120, Math.round(b.speed)));
      return send(res, 200, view());
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
createServer((req, res) => void route(req, res)).listen(PORT, () => {
  console.log(`Psyche (${session.world.name}) on http://localhost:${PORT} (faculties: ${kind}, ${running ? "playing" : "paused"})`);
  console.log(kind === "claude" ? `Daily cap $${governor.capUsd} (PSYCHE_DAILY_CAP). Spend so far today: $${governor.todayUsd().toFixed(4)}.` : "Offline mock: the cost meter shows what the same run would cost on Claude.");
});
void tickClock();
void tickFounders();
