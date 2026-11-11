// Worlds you can hand to someone else. Two ways:
//
// - A world code ("region-11"): which kind of world and which seed. Anyone who starts from the same
//   code gets the same land and the same founders, and what happens after that is theirs.
// - A world file: a whole world as it stands (every mind, every memory, the chronicle), wrapped with
//   a small header saying what it is. The server gzips it; here is the header and the checking.
//
// A file from someone else is data from outside, so it is checked before anything is built from it:
// the right shape, the right kinds of values, nothing absurdly large. Checking is all this does; it
// never runs anything from the file.

export const WORLD_FORMAT = "psyche-world";
export const WORLD_VERSION = 1;
export const WORLD_SCENARIOS = ["island", "village", "region"] as const;
export type WorldScenario = (typeof WORLD_SCENARIOS)[number];

export interface WorldSummary {
  world: string;
  tick: number;
  year?: number;
  towns: number;
  people: number;
}

/** What a world file says about itself, before the world proper. */
export interface WorldHead {
  format: typeof WORLD_FORMAT;
  version: number;
  name: string;
  savedAt: number;
  scenario: WorldScenario;
  seed: number;
  summary?: WorldSummary;
  /** A small picture of the world when it was saved (a JPEG data URL). */
  thumb?: string;
}

// ------------------------------------------------------------------ world codes

/** The code for a fresh world of a kind from a seed, e.g. "region-11". */
export function worldCode(scenario: WorldScenario, seed: number): string {
  return `${scenario}-${Math.trunc(seed)}`;
}

/** Read a world code. A bare number is a region's seed. Returns undefined for anything else. */
export function parseWorldCode(text: string): { scenario: WorldScenario; seed: number } | undefined {
  const t = text.trim().toLowerCase().replace(/^psyche[:\s]+/, "");
  const m = /^(?:(island|village|region)[\s:_-]+)?(-?\d{1,9})$/.exec(t);
  if (!m) return undefined;
  const seed = Number(m[2]);
  if (!Number.isSafeInteger(seed)) return undefined;
  return { scenario: (m[1] as WorldScenario | undefined) ?? "region", seed };
}

// ------------------------------------------------------------------ world files

/** A save's name with anything that isn't a letter, digit, space, dash or underscore taken out. */
export function cleanWorldName(n: unknown): string {
  return typeof n === "string" ? n.trim().replace(/[^\w \-]/g, "").replace(/\s+/g, " ").slice(0, 40).trim() : "";
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const MAX_THUMB = 400_000;
/** The longest history taken for replay: about ten years of island days. */
const MAX_REPLAY_MINUTES = 10 * 365 * 1440;
const MAX_INPUTS = 500_000;

/** A thumbnail is kept only if it is a small JPEG or PNG data URL and nothing else. */
export function cleanThumb(x: unknown): string | undefined {
  return typeof x === "string" && x.length <= MAX_THUMB && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(x) ? x : undefined;
}

/** Does this look like one town's world: a clock, people in order, and a mind and a body for each? */
function checkTown(w: unknown, where: string, village = false): string | undefined {
  if (!isObj(w)) return `${where} is not a world.`;
  if (!isNum(w.tick) || w.tick < 0) return `${where} has no clock.`;
  if (!isNum(w.seed)) return `${where} has no seed.`;
  if (!Array.isArray(w.order) || !w.order.every((id) => typeof id === "string")) return `${where} has no list of people.`;
  if (!isObj(w.minds) || !isObj(w.agents) || !isObj(w.places)) return `${where} is missing its minds, people or places.`;
  if (village) {
    // A town of a region is a village: it has seasons, a store, households and a record of every life.
    const v = w.village;
    if (!isObj(v) || typeof v.season !== "string" || !isNum(v.seasonDays) || v.seasonDays <= 0 || !isObj(v.households) || !isObj(v.life) || !isObj(v.store) || !Array.isArray(v.structures)) return `${where} is missing its village (seasons, households, the store).`;
  } else if (w.village !== undefined && !isObj(w.village)) return `${where}'s village is damaged.`;
  for (const id of w.order as string[]) if (!isObj((w.minds as Record<string, unknown>)[id]) || !isObj((w.agents as Record<string, unknown>)[id])) return `${where} lists ${id}, who has no mind or body.`;
  return undefined;
}

export type WorldCheck = { ok: true; head: WorldHead } | { ok: false; error: string };

/**
 * Check something parsed from a world file (or a plain save) and read its header. Passing means
 * the file has the shape of a world this version can load; it does not promise the world is sane.
 */
export function checkWorldFile(x: unknown): WorldCheck {
  const bad = (error: string): WorldCheck => ({ ok: false, error });
  if (!isObj(x)) return bad("That file is not a Psyche world.");
  if (x.format !== undefined && x.format !== WORLD_FORMAT) return bad("That file is not a Psyche world.");
  if (x.version !== undefined && (!isNum(x.version) || x.version > WORLD_VERSION)) return bad("That world was saved by a newer Psyche. Update, then try again.");
  if (!isNum(x.seed) || !Number.isSafeInteger(x.seed)) return bad("That world has no seed.");
  const scenario = (x.scenario ?? "island") as WorldScenario;
  if (!WORLD_SCENARIOS.includes(scenario)) return bad("That world is of a kind this Psyche doesn't know.");
  if (x.ablations !== undefined && !isObj(x.ablations)) return bad("That world's settings are damaged.");
  if (x.region !== undefined) {
    const r = x.region;
    if (scenario !== "region" || !isObj(r) || !isObj(r.state) || !isObj(r.worlds)) return bad("That world's region is damaged.");
    const state = r.state;
    if (!isNum(state.tick) || !Array.isArray(state.towns) || !state.towns.length || !Array.isArray(state.chronicle)) return bad("That world's region is damaged.");
    if (r.feeds !== undefined && !isObj(r.feeds)) return bad("That world's region is damaged.");
    for (const t of state.towns) {
      if (!isObj(t) || typeof t.id !== "string" || typeof t.name !== "string") return bad("That world has a town with no name.");
      const err = checkTown((r.worlds as Record<string, unknown>)[t.id], t.name, true);
      if (err) return bad(err);
    }
  } else {
    if (scenario === "region") return bad("That world's region is missing.");
    if (!Array.isArray(x.inputs) || !Array.isArray(x.log)) return bad("That world has no history to replay.");
    // An island is rebuilt by living its history again, so the history has to be one that ends.
    let minutes = 0;
    if (x.inputs.length > MAX_INPUTS) return bad("That world's history is too long to replay.");
    for (const input of x.inputs) {
      if (!isObj(input) || typeof input.type !== "string") return bad("That world's history is damaged.");
      if (input.type !== "advance") continue;
      if (!isNum(input.minutes) || input.minutes <= 0) return bad("That world's history is damaged.");
      minutes += input.minutes;
      if (minutes > MAX_REPLAY_MINUTES) return bad("That world's history is too long to replay.");
    }
    if (!x.log.every(isObj)) return bad("That world's history is damaged.");
    if (x.base !== undefined) {
      const err = checkTown(x.base, "The world");
      if (err) return bad(err);
    }
  }
  const s = x.summary;
  const summary = isObj(s) && typeof s.world === "string" && isNum(s.tick) && isNum(s.towns) && isNum(s.people) ? { world: s.world.slice(0, 80), tick: s.tick, year: isNum(s.year) ? s.year : undefined, towns: s.towns, people: s.people } : undefined;
  return { ok: true, head: { format: WORLD_FORMAT, version: isNum(x.version) ? x.version : WORLD_VERSION, name: cleanWorldName(x.name) || "A shared world", savedAt: isNum(x.savedAt) ? x.savedAt : 0, scenario, seed: x.seed, summary, thumb: cleanThumb(x.thumb) } };
}
