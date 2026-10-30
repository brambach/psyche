// Founders, step one (F0): one mind, one empty islet, one storm on the way.
// The mind decides what to do and why; the Architect faculty designs a shelter as a blueprint;
// the body fells trees, quarries stone, cuts reeds and sets every block over sim hours.
// Only the design (and the occasional deliberation) touches a language model.

import { identityOf, runPercept, wait, hourOf, dayOf } from "../mind.js";
import { clamp } from "../memory.js";
import type { ActionOption, Faculties, Percept } from "../ports.js";
import { nextId } from "../rng.js";
import type { Trace } from "../trace.js";
import type { Ablations, MindState, Tick } from "../types.js";
import { createCast } from "../world/cast.js";
import { bill, check, compile, costOf, describe, PACE, siteOf, type Bill, type Blueprint, type Item, type Placement } from "./blueprint.js";
import { generateIsland, get, M, set, standY, type Terrain } from "./voxel.js";

export const BUILDERS = ["mara", "theo", "jun", "corran", "wren"] as const;
export type BuilderId = (typeof BUILDERS)[number];

/** Day 1, 07:30: the boat grounds on the beach. */
export const FOUNDERS_START = 7 * 60 + 30;
/** Day 2, 18:00, blowing until 03:00. */
export const STORM_AT = 1440 + 18 * 60;
const STORM_HOURS = 9;
const STEP = 10;
const WORK_FROM = 7;
const WORK_TO = 20.5;
const LATE = 23;
const ISLET = "Tern Holm";

export interface Builder {
  id: BuilderId;
  name: string;
  role: string;
  x: number;
  y: number;
  z: number;
  activity: string;
  inventory: Record<Item, number>;
  /** Minutes of work owed or banked: actions are whole, so a step can overrun into the next. */
  carry: number;
}

export interface Project {
  blueprint: Blueprint;
  /** The design as the Architect wrote it, before the engine made it buildable. */
  proposed: Partial<Blueprint>;
  rationale: string;
  because: { ref: string; label: string; weight: number }[];
  repairs: string[];
  revisions: string[];
  placements: Placement[];
  bill: Bill;
  startedAt: Tick;
  finishedAt?: Tick;
  /** The decision that led to the design. */
  trace: string;
}

export interface FounderState {
  seed: number;
  tick: Tick;
  idCounter: number;
  terrain: Terrain;
  mind: MindState;
  builder: Builder;
  project?: Project;
  storm: { at: Tick; until: Tick; state: "coming" | "raging" | "over"; dry?: number };
  plan: "arriving" | "exploring" | "waiting" | "building" | "sheltering" | "done";
  resumeAt?: Tick;
  /** Work past dark (chosen when behind, or to patch in the storm). */
  overtime: boolean;
  beats: string[];
}

export interface FounderFeed {
  id: string;
  tick: Tick;
  kind: "arrive" | "choice" | "design" | "progress" | "night" | "morning" | "storm" | "event";
  title: string;
  text?: string;
  trace?: string;
}

export interface FounderSink {
  feed: FounderFeed[];
  traces: Trace[];
}

export type FounderEvent = { kind: "storm-early" };

// ---------------------------------------------------------------- setup

export function createFounder(seed = 3, who: BuilderId = "mara", ablations: Partial<Ablations> = {}): FounderState {
  const member = createCast(seed, ablations).find((c) => c.mind.id === who)!;
  const mind = member.mind;
  mind.tick = FOUNDERS_START;
  mind.goals.unshift({ id: "g_shelter", text: `Get a roof over my head on ${ISLET} before the storm`, tags: ["shelter", "build", "storm", "home"], priority: 0.95, progress: 0, invested: 0.1, rate: 0 });
  const terrain = generateIsland(seed);
  const p = terrain.plot;
  const x = p.x0 + p.w + 3;
  const z = p.z0 + p.d + 5;
  return {
    seed,
    tick: FOUNDERS_START,
    idCounter: 0,
    terrain,
    mind,
    builder: { id: who, name: mind.name, role: member.role, x, z, y: standY(terrain, x, z), activity: "pulling the boat up the beach", inventory: { plank: 0, cobble: 0, log: 0, thatch: 0 }, carry: 0 },
    storm: { at: STORM_AT, until: STORM_AT + STORM_HOURS * 60, state: "coming" },
    plan: "arriving",
    overtime: false,
    beats: [],
  };
}

/** What the islet still holds: logs standing, stone exposed in the outcrop, beds of reeds. */
export function supply(s: FounderState): { logs: number; stone: number; reeds: number } {
  const t = s.terrain;
  const g = t.grid;
  let logs = 0;
  for (const tree of t.trees) if (!tree.felled) for (let y = tree.y; y < tree.y + tree.height; y++) if (get(g, tree.x, y, tree.z) === M.log) logs++;
  let stone = 0;
  let reeds = 0;
  for (let z = 0; z < g.d; z++)
    for (let x = 0; x < g.w; x++) {
      const top = t.ground[x + z * g.w]!;
      if (get(g, x, top, z) === M.stone && !onPlot(s, x, z)) for (let y = top; y > t.sea && get(g, x, y, z) === M.stone; y--) stone++;
      if (get(g, x, t.sea, z) === M.reeds) reeds++;
    }
  return { logs, stone, reeds };
}

const onPlot = (s: FounderState, x: number, z: number) => {
  const p = s.terrain.plot;
  return x >= p.x0 - 1 && x <= p.x0 + p.w && z >= p.z0 - 1 && z <= p.z0 + p.d;
};

// ---------------------------------------------------------------- the loop

export async function advanceFounder(s: FounderState, minutes: number, f: Faculties, sink: FounderSink): Promise<void> {
  const end = s.tick + minutes;
  while (s.tick < end) {
    await beats(s, f, sink);
    const h = hourOf(s.tick);
    const asleep = h >= LATE || h < WORK_FROM;
    const until = s.overtime ? LATE : WORK_TO;
    if (!asleep && s.plan === "building" && h < until && !(s.storm.state === "raging" && !s.overtime)) {
      work(s, STEP);
    } else if (!asleep) {
      idle(s);
    } else {
      sleepSpot(s);
    }
    const traces = await wait(s.mind, STEP, f);
    s.tick = s.mind.tick;
    for (const t of traces) {
      sink.traces.push(t);
      s.overtime = false;
      feed(s, sink, { kind: "morning", title: `${s.builder.name} wakes`, text: t.headline.answer || "Slept. The day's memories were replayed and settled.", trace: t.id });
    }
    if (s.project) {
      const g = s.mind.goals.find((x) => x.id === "g_shelter");
      if (g) g.progress = progress(s);
    }
  }
}

export async function injectFounder(s: FounderState, e: FounderEvent, f: Faculties, sink: FounderSink): Promise<void> {
  if (e.kind === "storm-early" && s.storm.state === "coming" && s.storm.at > s.tick + 180) {
    s.storm.at = s.tick + 180;
    s.storm.until = s.storm.at + STORM_HOURS * 60;
    const her = s.mind.pronouns.possessive;
    const options = s.plan === "building" ? behindOptions(s) : arrivalOptions(s, true);
    const t = await sense(s, f, sink, {
      text: `The wind has backed round to the west and the sky is closing in. The storm will be here in three hours, not tomorrow night. ${s.project ? `By ${her} reckoning the house needs ${remainingHours(s).toFixed(0)} more hours of work.` : ""}`,
      gist: "The storm turned and is coming tonight, hours early.",
      topics: ["storm", "shelter", "build"],
      outcome: -0.6,
      intensity: 0.8,
      prospective: true,
      options,
    });
    feed(s, sink, { kind: "event", title: "The storm is coming early", text: `${t.action?.text ?? ""}.`, trace: t.id });
    await act(s, f, sink, t);
  }
}

async function beats(s: FounderState, f: Faculties, sink: FounderSink): Promise<void> {
  const fired = (b: string) => s.beats.includes(b);
  const fire = (b: string) => s.beats.push(b);
  const name = s.builder.name;
  const P = s.mind.pronouns;

  if (!fired("arrive")) {
    fire("arrive");
    const t = await sense(s, f, sink, {
      text: `${name} grounds the boat on ${ISLET}: an empty islet with a pine grove, a grey stone outcrop and reeds in the shallows. ${s.mind.name === "Mara" ? "Nobody else lives here. " : ""}There is a level clearing in the middle that would take a house. The sky to the west is bruised: a storm will reach the island tomorrow at dusk.`,
      gist: `I landed on ${ISLET} with a storm due tomorrow night and nowhere to sleep.`,
      topics: ["storm", "shelter", "build", "home"],
      outcome: -0.35,
      intensity: 0.65,
      prospective: true,
      options: arrivalOptions(s, false),
    });
    feed(s, sink, { kind: "arrive", title: `${name} lands on ${ISLET}`, text: `A storm is due tomorrow at six. ${cap(t.action?.text ?? "")}.`, trace: t.id });
    await act(s, f, sink, t);
    return;
  }

  if ((s.plan === "exploring" || s.plan === "waiting") && s.resumeAt !== undefined && s.tick >= s.resumeAt) {
    const looked = s.plan === "exploring";
    const t = await sense(s, f, sink, {
      text: looked
        ? `${name} has walked the whole islet: plenty of pine, a good outcrop of stone, reeds enough for a roof. The clearing is still the best spot. The western sky is darker than it was.`
        : `The western sky has gone the colour of a bruise and the gulls have come inland. The storm is not turning.`,
      gist: looked ? "The islet has what I need for a house." : "The storm isn't turning. It's coming.",
      topics: ["storm", "shelter", "build"],
      outcome: looked ? 0.1 : -0.45,
      intensity: 0.6,
      prospective: true,
      options: arrivalOptions(s, true),
    });
    feed(s, sink, { kind: "choice", title: looked ? `${name} has seen the islet` : "The storm isn't turning", text: `${cap(t.action?.text ?? "")}.`, trace: t.id });
    s.resumeAt = undefined;
    await act(s, f, sink, t);
    return;
  }

  if (s.storm.state === "coming" && s.tick >= s.storm.at) {
    s.storm.state = "raging";
    const dry = dryness(s);
    s.storm.dry = dry;
    const hearth = s.project && placedPart(s, "furniture") && s.project.blueprint.furniture.includes("hearth");
    const t = await sense(s, f, sink, dry > 0.85
      ? {
          text: `The storm arrives. Rain drums on the roof ${name} built, and the wind leans on the walls and gets nowhere. Inside it is dry${hearth ? " and the hearth is warm" : ""}.`,
          gist: "The storm came and the house I built kept me dry.",
          topics: ["storm", "shelter", "home", "build"],
          outcome: 0.65,
          intensity: 0.85,
          agency: "self",
          options: [
            opt("listen", "Listen to it from inside", "sit and listen to the storm from inside", "Sit by the wall and listen to the storm do its worst.", { coping: "emotion", act: "sits and listens to the storm from inside" }),
            opt("check", "Check every seam", "check every seam with a lamp", "Go round with a lamp, checking for leaks.", { coping: "problem", assertive: 0.3, act: "goes round every seam with a lamp" }),
          ],
        }
      : dry > 0.3
        ? {
            text: `The storm arrives with the house half done. Rain pours through the open part of the roof and ${name} wedges ${P.reflexive} into the one dry corner.`,
            gist: "The storm came before the roof was finished.",
            topics: ["storm", "shelter", "build"],
            outcome: -0.45,
            intensity: 0.85,
            agency: "self",
            options: [
              opt("patch", "Patch it in the rain", "climb up and patch the roof in the rain", "Climb up in the wind and get more of the roof on.", { coping: "problem", assertive: 0.7, act: "climbs up into the rain to get more of the roof on" }),
              opt("huddle", "Huddle in the dry corner", "huddle in the dry corner", "Stay put in the dry corner and wait for morning.", { coping: "avoid", avoidant: 0.8, act: "huddles in the dry corner till morning" }),
            ],
          }
        : {
            text: `The storm arrives and there is no roof to speak of. Rain comes sideways through the walls ${name} started.`,
            gist: "The storm came and I had no shelter.",
            topics: ["storm", "shelter"],
            outcome: -0.8,
            intensity: 0.9,
            agency: "self",
            options: [
              opt("pines", "Run for the pines", "run for the shelter of the pines", "Take the blanket to the thickest of the pines.", { coping: "avoid", avoidant: 0.9, act: "runs for the pines with a blanket" }),
              opt("huddle", "Huddle against the wall", "huddle against the half-built wall", "Crouch in the lee of what is built.", { coping: "avoid", avoidant: 0.7, act: "crouches in the lee of the wall" }),
            ],
          });
    feed(s, sink, { kind: "storm", title: dry > 0.85 ? "The storm hits. The house holds." : dry > 0.3 ? "The storm hits a half-built house" : "The storm hits with no roof up", text: `${cap(t.action?.text ?? "")}.`, trace: t.id });
    if (t.action && /patch|check/.test(t.decision?.choice ?? "")) s.overtime = true;
    return;
  }

  if (s.storm.state === "raging" && s.tick >= s.storm.until) s.storm.state = "over";

  if (s.storm.state === "over" && !fired("after") && hourOf(s.tick) >= WORK_FROM && hourOf(s.tick) < LATE) {
    fire("after");
    const dry = s.storm.dry ?? 0;
    const done = s.plan === "done";
    const t = await sense(s, f, sink, {
      text: dry > 0.85
        ? `Morning. The storm has blown out to the east. The house stands, the thatch steaming in the sun. ${done ? "" : "There is still work to finish."}`
        : `Morning. The storm has blown out to the east, and so has some of what ${name} built. Everything is soaked.`,
      gist: dry > 0.85 ? "The house came through the storm." : "I got through the storm, barely.",
      topics: ["storm", "home", "build"],
      outcome: dry > 0.85 ? 0.5 : -0.3,
      intensity: 0.6,
      agency: "self",
      options: done
        ? [
            opt("sit", "Sit in the doorway", "sit in the doorway with the sea", "Take the morning off and look at the sea.", { coping: "emotion", act: "sits in the doorway, looking at the sea" }),
            opt("plan", "Think about what's next", "start thinking about what to add", "Pace out where a store and a garden could go.", { coping: "problem", assertive: 0.3, act: "paces out where a store and a garden could go" }),
          ]
        : [
            opt("finish", "Get back to work", "get straight back to work", "Finish the house while the weather holds.", { coping: "problem", assertive: 0.4, act: "gets straight back to work on the house" }),
            opt("rest", "Dry out first", "dry out and rest first", "Spread everything out to dry and rest a while.", { coping: "emotion", avoidant: 0.3, act: "spreads everything out to dry" }),
          ],
    });
    feed(s, sink, { kind: "morning", title: "The morning after the storm", text: `${cap(t.action?.text ?? "")}.`, trace: t.id });
    if (s.plan === "sheltering") s.plan = "building";
    return;
  }

  if (s.plan !== "building" || !s.project) return;
  const pr = s.project;

  if (!fired("walls") && placedPart(s, "walls")) {
    fire("walls");
    const t = await sense(s, f, sink, {
      text: `The walls of ${the(pr.blueprint.name)} are up, ${pr.blueprint.wallHeight} courses high. ${name} can stand inside it now.`,
      gist: "The walls are up. It looks like a house.",
      topics: ["build", "home", "shelter"],
      outcome: 0.4,
      intensity: 0.45,
      agency: "self",
      options: progressOptions("walls"),
    });
    feed(s, sink, { kind: "progress", title: "The walls are up", text: `${cap(t.action?.text ?? "")}.`, trace: t.id });
    return;
  }
  if (!fired("roof") && placedPart(s, "roof")) {
    fire("roof");
    const t = await sense(s, f, sink, {
      text: `The last of the roof goes on. Whatever else happens, ${name} has a roof now.`,
      gist: "The roof is on.",
      topics: ["build", "home", "shelter", "storm"],
      outcome: 0.55,
      intensity: 0.55,
      agency: "self",
      options: progressOptions("roof"),
    });
    feed(s, sink, { kind: "progress", title: "The roof is on", text: `${cap(t.action?.text ?? "")}.`, trace: t.id });
    return;
  }
  if (!next(s)) {
    s.plan = "done";
    pr.finishedAt = s.tick;
    const t = await sense(s, f, sink, {
      text: `The last block is in. ${cap(the(pr.blueprint.name))} is finished: ${describe(pr.blueprint)}.`,
      gist: `I built ${the(pr.blueprint.name)} with my own hands.`,
      topics: ["build", "home", "shelter"],
      outcome: 0.7,
      intensity: 0.6,
      agency: "self",
      options: progressOptions("done"),
    });
    feed(s, sink, { kind: "progress", title: `${cap(the(pr.blueprint.name))} is finished`, text: `${cap(t.action?.text ?? "")}.`, trace: t.id });
    return;
  }

  // Running behind: a real choice, once, while there is still time to act on it.
  if (!fired("behind") && s.storm.state === "coming" && s.tick > FOUNDERS_START + 600) {
    const need = remainingHours(s);
    const left = hoursUntilStorm(s, false);
    if (need > left * 0.95 && left > 1) {
      fire("behind");
      const t = await sense(s, f, sink, {
        text: `It is ${clockText(s.tick)}. The storm is due at ${clockText(s.storm.at).split(", ")[1]}, and by ${P.possessive} reckoning the house needs about ${need.toFixed(0)} more hours of work. That leaves ${left.toFixed(0)} working hours before it hits.`,
        gist: "I'm behind. The house won't be done before the storm.",
        topics: ["storm", "shelter", "build"],
        outcome: -0.5,
        intensity: 0.7,
        agency: "self",
        prospective: true,
        options: behindOptions(s),
      });
      feed(s, sink, { kind: "choice", title: `${name} is running out of time`, text: `${cap(t.action?.text ?? "")}.`, trace: t.id });
      await act(s, f, sink, t);
    }
  }
}

/** Carry out a decision's consequences in the world. */
async function act(s: FounderState, f: Faculties, sink: FounderSink, t: Trace): Promise<void> {
  const choice = t.decision?.choice;
  if (choice === "build") await design(s, f, sink, t);
  else if (choice === "explore") {
    s.plan = "exploring";
    s.resumeAt = s.tick + 120;
  } else if (choice === "hunker") {
    s.plan = "waiting";
    s.resumeAt = s.tick + 180;
  } else if (choice === "cut" && s.project) {
    cutDown(s);
  } else if (choice === "push") {
    s.overtime = true;
    s.mind.affect.stress = clamp(s.mind.affect.stress + 0.1);
    s.project?.revisions.push(`${clockText(s.tick)}: kept to the plan and worked on past dark`);
  } else if (choice === "abandon") {
    s.plan = "sheltering";
    s.project?.revisions.push(`${clockText(s.tick)}: gave up for the night and sheltered under the pines`);
  }
}

// ---------------------------------------------------------------- the design

async function design(s: FounderState, f: Faculties, sink: FounderSink, decided: Trace): Promise<void> {
  const mind = s.mind;
  const have = supply(s);
  const ws = decided.workspace;
  const af = mind.affect;
  const stance: string[] = [];
  if (af.emotions.fear > 0.15 || af.emotions.distress > 0.2) stance.push("You are uneasy about the storm.");
  if (af.stress > 0.4) stance.push("You are under strain.");
  if (af.mood.valence < -0.2) stance.push("Your mood is low.");
  if (af.mood.valence > 0.3) stance.push("You are in good spirits.");
  const res = await f.architect({
    self: identityOf(mind),
    want: `A place of my own on ${ISLET} that keeps me dry through the storm due tomorrow at dusk.`,
    site: {
      plot: { w: s.terrain.plot.w - 2, d: s.terrain.plot.d - 2 },
      weatherFrom: "west",
      seaTo: "south",
      materials: [
        { name: "timber", available: have.logs, note: "pines on the north-east slope; one log saws into 4 planks" },
        { name: "stone", available: have.stone, note: "the outcrop to the south-west; one quarried stone is one block" },
        { name: "reeds", available: have.reeds, note: "the eastern shallows; one bed of reeds makes 2 thatch" },
      ],
      hoursOfWorkLeft: Number(hoursUntilStorm(s, false).toFixed(1)),
      pace: "About 2.5 minutes to set any block, 8 to fell and saw a log, 6 to quarry a stone, 3 to cut a bed of reeds. A 7 by 6 plank house with a gabled thatch roof is about 14 hours of work; a 9 by 8 stone house with a hip roof is nearer 40.",
    },
    workspace: ws.map((w) => ({ id: w.ref, kind: w.kind, label: w.label, text: w.text, weight: Number(w.score.toFixed(2)) })),
    stance,
    temperament: { openness: mind.traits.openness, conscientiousness: mind.traits.conscientiousness, extraversion: mind.traits.extraversion, neuroticism: mind.traits.neuroticism },
    patternBook: [],
  });
  const checked = check(res.blueprint, s.terrain.plot, have);
  const labels = new Map(ws.map((w) => [w.ref, w.label]));
  s.project = {
    blueprint: checked.blueprint,
    proposed: res.blueprint,
    rationale: res.rationale,
    because: res.because.filter((b) => labels.has(b.item)).map((b) => ({ ref: b.item, label: labels.get(b.item)!, weight: b.weight })),
    repairs: checked.repairs,
    revisions: [],
    placements: checked.placements,
    bill: checked.bill,
    startedAt: s.tick,
    trace: decided.id,
  };
  s.plan = "building";
  decided.llmCalls.push("architect");
  feed(s, sink, {
    kind: "design",
    title: `${mind.name} designs ${the(checked.blueprint.name)}`,
    text: `${cap(describe(checked.blueprint))}. ${checked.bill.blocks} blocks, about ${Math.round(checked.bill.hours)} hours of work.`,
    trace: decided.id,
  });
}

/** Stop the walls one course above where they are, drop the extras, and put a flat roof on it now. */
function cutDown(s: FounderState): void {
  const pr = s.project!;
  const g = s.terrain.plot.y;
  let courses = 0;
  const walls = pr.placements.filter((p) => p.part === "walls");
  for (let yy = 0; yy < pr.blueprint.wallHeight; yy++) if (walls.filter((p) => p.y === g + yy).every((p) => get(s.terrain.grid, p.x, p.y, p.z) === p.b)) courses = yy + 1;
  const bp: Blueprint = structuredClone(pr.blueprint);
  // Two courses is a hut you stoop into, but it is a roof.
  bp.wallHeight = Math.max(2, Math.min(bp.wallHeight, courses + 1));
  bp.porch = false;
  bp.roof = { shape: "flat", material: bp.roof.material, overhang: 0 };
  bp.furniture = bp.furniture.filter((x) => x === "bed" || x === "hearth");
  const before = describe(pr.blueprint);
  pr.blueprint = bp;
  pr.placements = compile(bp, s.terrain.plot);
  pr.bill = bill(pr.placements);
  pr.revisions.push(`${clockText(s.tick)}: cut down from "${before}" to "${describe(bp)}"`);
}

// ---------------------------------------------------------------- the body

function next(s: FounderState): Placement | undefined {
  const g = s.terrain.grid;
  return s.project?.placements.find((p) => get(g, p.x, p.y, p.z) !== p.b);
}

function remaining(s: FounderState): Placement[] {
  const g = s.terrain.grid;
  return s.project ? s.project.placements.filter((p) => get(g, p.x, p.y, p.z) !== p.b) : [];
}

export function progress(s: FounderState): number {
  if (!s.project) return 0;
  return 1 - remaining(s).length / s.project.placements.length;
}

export function remainingHours(s: FounderState): number {
  const b = bill(remaining(s));
  const inv = s.builder.inventory;
  const saved = Math.min(b.raw.logs, inv.log + inv.plank / PACE.planksPerLog) * PACE.chop + Math.min(b.raw.stone, inv.cobble) * PACE.quarry + Math.min(b.raw.reeds, inv.thatch / 2) * PACE.reeds;
  return Math.max(0, b.hours - (saved * 1.2) / 60);
}

/** Working hours between now and the storm. */
export function hoursUntilStorm(s: FounderState, overtime: boolean): number {
  let mins = 0;
  for (let t = s.tick; t < s.storm.at; t += STEP) {
    const h = hourOf(t);
    if (h >= WORK_FROM && h < (overtime ? LATE : WORK_TO)) mins += STEP;
  }
  return mins / 60;
}

function placedPart(s: FounderState, part: Placement["part"]): boolean {
  const g = s.terrain.grid;
  const ps = s.project?.placements.filter((p) => p.part === part) ?? [];
  return ps.length > 0 && ps.every((p) => get(g, p.x, p.y, p.z) === p.b);
}

/** How dry the house keeps you: share of the floor under a finished roof, weighted by the walls. */
export function dryness(s: FounderState): number {
  if (!s.project) return 0;
  const g = s.terrain.grid;
  const { x0, z0, x1, z1, y } = siteOf(s.project.blueprint, s.terrain.plot);
  let covered = 0;
  let cells = 0;
  for (let z = z0 + 1; z < z1; z++)
    for (let x = x0 + 1; x < x1; x++) {
      cells++;
      for (let yy = y + 2; yy < g.h; yy++) {
        const b = get(g, x, yy, z);
        if (b !== M.air && b !== M.leaves) {
          covered++;
          break;
        }
      }
    }
  const walls = s.project.placements.filter((p) => p.part === "walls");
  const up = walls.filter((p) => get(g, p.x, p.y, p.z) === p.b).length / Math.max(1, walls.length);
  return (covered / Math.max(1, cells)) * (0.4 + 0.6 * up);
}

function work(s: FounderState, minutes: number): void {
  const b = s.builder;
  b.carry += minutes;
  while (b.carry > 0) {
    const p = next(s);
    if (!p) return;
    const cost = costOf(p.b);
    if (cost && !take(b.inventory, cost[0], cost[1], false)) {
      b.carry -= gather(s, cost[0]);
      continue;
    }
    if (cost) take(b.inventory, cost[0], cost[1], true);
    const sx = p.x + Math.sign(s.terrain.plot.x0 + s.terrain.plot.w / 2 - p.x) * 0.6;
    const sz = p.z + Math.sign(s.terrain.plot.z0 + s.terrain.plot.d / 2 - p.z) * 0.6;
    b.carry -= walk(s, sx, sz) + PACE.place;
    b.y = Math.max(standY(s.terrain, sx, sz), p.y - 1);
    set(s.terrain.grid, p.x, p.y, p.z, p.b);
    b.activity = ACTIVITY[p.part](s);
  }
}

const ACTIVITY: Record<Placement["part"], (s: FounderState) => string> = {
  floor: () => "laying the floor",
  walls: () => "raising the walls",
  roof: (s) => (s.project!.blueprint.roof.material === "thatch" ? "thatching the roof" : "boarding the roof"),
  chimney: () => "building the chimney",
  furniture: () => "making the furniture",
  porch: () => "laying the porch",
};

function take(inv: Record<Item, number>, item: Item, n: number, commit: boolean): boolean {
  if (inv[item] < n) return false;
  if (commit) inv[item] -= n;
  return true;
}

function walk(s: FounderState, x: number, z: number): number {
  const b = s.builder;
  const d = Math.hypot(x - b.x, z - b.z);
  b.x = x;
  b.z = z;
  b.y = standY(s.terrain, x, z);
  return d / PACE.walk;
}

/** Fetch more of an item: saw stored logs, or fell a pine, quarry stone, cut reeds. Returns minutes spent. */
function gather(s: FounderState, item: Item): number {
  const b = s.builder;
  const t = s.terrain;
  const g = t.grid;
  const need = bill(remaining(s)).items;
  if (item === "plank" && b.inventory.log > need.log) {
    b.inventory.log -= 1;
    b.inventory.plank += PACE.planksPerLog;
    b.activity = "sawing planks";
    return 1;
  }
  if (item === "plank" || item === "log") {
    const tree = t.trees.filter((x) => !x.felled).sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0];
    if (!tree) return stuck(s, "has run out of timber");
    let mins = walk(s, tree.x + 0.8, tree.z + 0.8);
    let logs = 0;
    for (let y = tree.y; y < tree.y + tree.height; y++) if (get(g, tree.x, y, tree.z) === M.log) {
      set(g, tree.x, y, tree.z, M.air);
      logs++;
    }
    for (let y = tree.y + 1; y <= tree.y + tree.height + 1; y++)
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (get(g, tree.x + dx, y, tree.z + dz) === M.leaves) set(g, tree.x + dx, y, tree.z + dz, M.air);
    tree.felled = true;
    b.inventory.log += logs;
    b.activity = "felling a pine";
    mins += logs * PACE.chop;
    return mins + walk(s, t.plot.x0 + t.plot.w / 2, t.plot.z0 + t.plot.d / 2);
  }
  if (item === "cobble") {
    const want = Math.min(10, Math.max(1, need.cobble - b.inventory.cobble));
    let mins = 0;
    for (let i = 0; i < want; i++) {
      let best: [number, number] | undefined;
      let bestD = Infinity;
      for (let z = 0; z < g.d; z++)
        for (let x = 0; x < g.w; x++) {
          const top = t.ground[x + z * g.w]!;
          if (top <= t.sea || get(g, x, top, z) !== M.stone || onPlot(s, x, z)) continue;
          const d = Math.hypot(x - b.x, z - b.z);
          if (d < bestD) (bestD = d), (best = [x, z]);
        }
      if (!best) return mins || stuck(s, "has run out of stone");
      const [x, z] = best;
      const top = t.ground[x + z * g.w]!;
      mins += walk(s, x + 0.6, z + 0.6) + PACE.quarry;
      set(g, x, top, z, M.air);
      t.ground[x + z * g.w] = top - 1;
      b.inventory.cobble += 1;
    }
    b.activity = "quarrying stone at the outcrop";
    return mins + walk(s, t.plot.x0 + t.plot.w / 2, t.plot.z0 + t.plot.d / 2);
  }
  const want = Math.min(8, Math.max(1, Math.ceil((need.thatch - b.inventory.thatch) / PACE.thatchPerReeds)));
  let mins = 0;
  for (let i = 0; i < want; i++) {
    let best: [number, number] | undefined;
    let bestD = Infinity;
    for (let z = 0; z < g.d; z++)
      for (let x = 0; x < g.w; x++) {
        if (get(g, x, t.sea, z) !== M.reeds) continue;
        const d = Math.hypot(x - b.x, z - b.z);
        if (d < bestD) (bestD = d), (best = [x, z]);
      }
    if (!best) return mins || stuck(s, "has run out of reeds");
    mins += walk(s, best[0], best[1]) + PACE.reeds;
    set(g, best[0], t.sea, best[1], M.air);
    b.inventory.thatch += PACE.thatchPerReeds;
  }
  b.activity = "cutting reeds in the shallows";
  return mins + walk(s, t.plot.x0 + t.plot.w / 2, t.plot.z0 + t.plot.d / 2);
}

/** Nothing left to gather: the house is as finished as the islet allows. */
function stuck(s: FounderState, why: string): number {
  const pr = s.project!;
  pr.revisions.push(`${clockText(s.tick)}: ${s.builder.name} ${why}; the house stays as it is`);
  const g = s.terrain.grid;
  pr.placements = pr.placements.filter((p) => get(g, p.x, p.y, p.z) === p.b);
  return STEP;
}

function idle(s: FounderState): void {
  const b = s.builder;
  const name = s.builder.name;
  if (s.plan === "exploring") {
    const k = (s.tick - (s.resumeAt ?? s.tick) + 120) / 120;
    const a = k * Math.PI * 2;
    walk(s, s.terrain.grid.w / 2 + Math.cos(a) * 12, s.terrain.grid.d / 2 + Math.sin(a) * 12);
    b.activity = "walking the islet";
  } else if (s.plan === "waiting" || s.plan === "sheltering") {
    const tree = s.terrain.trees.find((t) => !t.felled);
    if (tree) walk(s, tree.x + 1.2, tree.z + 1.2);
    b.activity = s.storm.state === "raging" ? "sheltering under the pines" : "sitting under the pines, watching the sky";
  } else if (s.plan === "done") {
    if (s.project) {
      const { x0, x1, z0, z1 } = siteOf(s.project.blueprint, s.terrain.plot);
      walk(s, (x0 + x1) / 2, (z0 + z1) / 2);
      b.y = s.terrain.plot.y;
    }
    b.activity = s.storm.state === "raging" ? "indoors, listening to the storm" : hourOf(s.tick) > 19 ? "by the hearth" : "sitting in the doorway, looking at the sea";
  } else if (s.plan === "building") {
    b.activity = s.storm.state === "raging" ? (dryness(s) > 0.3 ? "in the dry corner" : "in the lee of the wall") : "resting after the day's work";
  } else b.activity = `${name} looks the islet over`;
}

function sleepSpot(s: FounderState): void {
  const b = s.builder;
  if (s.project && dryness(s) > 0.85) {
    const bed = s.project.placements.find((p) => p.b === M.bed && get(s.terrain.grid, p.x, p.y, p.z) === M.bed);
    if (bed) walk(s, bed.x, bed.z);
    b.y = s.terrain.plot.y;
    b.activity = "asleep in the house";
  } else {
    const tree = s.terrain.trees.find((t) => !t.felled);
    if (tree) walk(s, tree.x + 1.2, tree.z + 1.2);
    else if (s.project) walk(s, s.terrain.plot.x0 + 1, s.terrain.plot.z0 + 1);
    b.activity = tree ? "asleep under the pines" : "asleep against the wall";
  }
}

// ---------------------------------------------------------------- percepts and options

interface Sense {
  text: string;
  gist: string;
  topics: string[];
  outcome: number;
  intensity: number;
  agency?: "self" | "other" | "circumstance";
  prospective?: boolean;
  options?: ActionOption[];
}

async function sense(s: FounderState, f: Faculties, sink: FounderSink, e: Sense): Promise<Trace> {
  const p: Percept = {
    id: nextId(s.mind, "pc"),
    tick: s.tick,
    kind: "event",
    rawText: e.text,
    actor: "world",
    addressedToSelf: false,
    about: [],
    topics: e.topics,
    features: { outcomeForSelf: e.outcome, agency: e.agency ?? "circumstance", intentional: 0, normViolation: 0, prospective: e.prospective ?? false, intensity: e.intensity },
    claims: [],
    details: [],
    gist: e.gist,
    options: e.options,
  };
  const t = await runPercept(s.mind, p, f);
  sink.traces.push(t);
  return t;
}

function opt(id: string, label: string, verb: string, description: string, o: Partial<ActionOption> = {}): ActionOption {
  return { id, label, verb, description, prosocial: 0, assertive: 0, avoidant: 0, disclosure: 0, ...o };
}

function arrivalOptions(s: FounderState, again: boolean): ActionOption[] {
  const out = [
    opt("build", "Start building now", "start building straight away", "Take the clearing and start on a shelter today.", { coping: "problem", assertive: 0.4, act: "takes the clearing and starts planning a shelter" }),
    opt("explore", "Look around first", "look the islet over first", "Walk the islet for a couple of hours to see what there is to build with.", { coping: "emotion", avoidant: 0.3, disclosure: 0.2, act: "walks the islet to see what it holds" }),
    opt("hunker", "Wait and see", "wait to see if the storm turns", "Rest under the pines and hope the weather turns.", { coping: "avoid", avoidant: 0.9, act: "sits under the pines, watching the sky" }),
  ];
  // Second time round there is no more looking: build, or keep waiting.
  return again ? out.filter((o) => o.id !== "explore") : out;
}

function behindOptions(s: FounderState): ActionOption[] {
  return [
    opt("cut", "Cut the plan down", "cut the house down to get a roof on", "Stop the walls where they are, drop the extras, and roof it now.", { coping: "problem", assertive: 0.3, avoidant: 0.2, act: "cuts the plan down to get a roof on in time" }),
    opt("push", "Push on as planned", "push on with the plan", "Keep the design and work on past dark if it takes that.", { coping: "problem", assertive: 0.7, act: "keeps to the plan and works on into the night" }),
    opt("abandon", "Give up for tonight", "give up on the house for tonight", "Stop, and sit the storm out under the pines.", { coping: "avoid", avoidant: 0.9, act: "gives up on the house for tonight" }),
  ];
}

function progressOptions(what: "walls" | "roof" | "done"): ActionOption[] {
  return [
    opt("admire", "Stop and look at it", "stop and look at what's built", "Take a minute to look at it.", { coping: "emotion", disclosure: 0.2, act: "stops a minute to look at it" }),
    opt("carry_on", what === "done" ? "Tidy up" : "Straight on", what === "done" ? "tidy up the site" : "get straight on with the next part", what === "done" ? "Clear the offcuts and stack what's left." : "No time to stand about.", { coping: "problem", act: what === "done" ? "clears up the offcuts" : "gets straight on with the next part" }),
  ];
}

// ---------------------------------------------------------------- helpers

function feed(s: FounderState, sink: FounderSink, item: Omit<FounderFeed, "id" | "tick">): void {
  s.idCounter += 1;
  sink.feed.push({ id: `ff_${s.idCounter}`, tick: s.tick, ...item });
}

export function clockText(t: Tick): string {
  const h = hourOf(t);
  return `Day ${dayOf(t)}, ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** A name mid-sentence: "A low stone house" reads as "a low stone house". */
const the = (name: string) => name.replace(/^(A|An|The) /, (m) => m.toLowerCase());
