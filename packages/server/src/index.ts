// Hosts the living island. The clock runs on the server: while the world is playing, it advances
// a few simulated minutes every second, and the web UI polls for what happened.
// The session is saved as seed + inputs + recorded LLM calls, and restored by exact replay.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import {
  BUILDERS,
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
import { createFaculties } from "@psyche/faculties";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = resolve(process.env.PSYCHE_DATA ?? "data");
const SAVE = join(DATA_DIR, "island.json");
const FOUNDERS_SAVE = join(DATA_DIR, "founders.json");
const WEB_DIST = resolve(process.env.PSYCHE_WEB ?? "packages/web/dist");
const FEED_SHOWN = 250;

const { kind, faculties } = createFaculties();

interface Saved {
  seed: number;
  ablations: Partial<Ablations>;
  inputs: WorldInput[];
  log: FacultyCall[];
}

let seed = 7;
let ablations: Partial<Ablations> = {};
let session = new WorldSession(createWorld(seed, ablations), faculties);
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
  if (!force && Date.now() - lastSaved < 10_000) return;
  lastSaved = Date.now();
  mkdirSync(DATA_DIR, { recursive: true });
  const saved: Saved = { seed, ablations, inputs: session.inputs, log: session.log };
  writeFileSync(SAVE, JSON.stringify(saved));
}

async function restore() {
  if (!existsSync(SAVE)) return;
  const saved = JSON.parse(readFileSync(SAVE, "utf8")) as Saved;
  seed = saved.seed;
  ablations = saved.ablations;
  const r = await WorldSession.replay(createWorld(seed, ablations), saved.inputs, saved.log, faculties);
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

async function tickClock() {
  if (running) {
    await exclusive(async () => {
      const w = session.world;
      // Nights pass in one stride: everyone is asleep, and sleep itself is one step per mind.
      const minutes = isNight(w.tick) ? Math.round(((7 * 60 - (w.tick % 1440)) + 1440) % 1440) || 1440 : speed;
      await session.apply({ type: "advance", minutes });
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
    seed,
    running,
    speed,
    tick: w.tick,
    ablations: w.minds[w.order[0]!]!.ablations,
    order: w.order,
    agents: w.order.map((id) => {
      const a = w.agents[id]!;
      return { id, name: a.name, role: a.role, place: a.place, activity: a.activity, talking: (a.talkingUntil ?? -1) > w.tick, ...summary(w.minds[id]!) };
    }),
    relations: w.order.flatMap((from) =>
      w.order
        .filter((to) => to !== from)
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
    rewind: session.frames.filter((f) => f.state && (f.dayStart || f.index >= session.frames.length - 80)).map((f) => ({ index: f.index, tick: f.tick, dayStart: f.dayStart })),
    calls: session.log.length,
    conversations: session.feed.filter((f) => f.kind === "talk").length,
  };
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
    if (p === "/api/control") {
      const b = await body<{ running?: boolean; speed?: number }>(req);
      if (b.running !== undefined) running = b.running;
      if (b.speed !== undefined) speed = Math.max(1, Math.min(120, Math.round(b.speed)));
      return send(res, 200, view());
    }
    if (p === "/api/input") {
      const { input } = await body<{ input: WorldInput }>(req);
      await exclusive(() => session.apply(input));
      save(true);
      return send(res, 200, view());
    }
    if (p === "/api/rewind") {
      const { index } = await body<{ index: number }>(req);
      await exclusive(async () => session.rewind(index));
      running = false;
      save(true);
      return send(res, 200, view());
    }
    if (p === "/api/reset") {
      const b = await body<{ seed?: number; ablations?: Partial<Ablations> }>(req);
      await exclusive(async () => {
        seed = b.seed ?? seed;
        ablations = b.ablations ?? ablations;
        session = new WorldSession(createWorld(seed, ablations), faculties);
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
  console.log(`Psyche island on http://localhost:${PORT} (faculties: ${kind}, ${running ? "playing" : "paused"})`);
});
void tickClock();
void tickFounders();
