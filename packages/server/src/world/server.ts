// The world server: a realm that keeps living for days. It runs the seasons on worker threads at a
// steady pace (or flat out, while the world is still growing), saves the whole world to disk every
// few minutes so that a crash or a restart loses minutes and not days, writes every chronicled
// event to an append-only log, and each morning leaves a digest of the night.
//
// Everything it runs is on the aggregate tier, which never calls a model: keeping the world alive
// costs nothing. Spending starts only when someone opens a region in the game to watch it, and
// that goes through the game server's budget governor, not through here.
//
// On disk (PSYCHE_WORLD_DIR, default data/world):
//   realm.json            the manifest: the realm's state and which region files make up the save
//   regions/<id>.g<n>.json.gz   one file per region per save; the last two saves are kept
//   events.jsonl          every chronicled event, one a line, with where it happened and why
//   timeline.jsonl        one line a year: people, towns and regions
//   digests/<date>.md     the morning digests; digests/latest.md is the newest
//   status.json           how the world stands right now, for anything that wants to look

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { realm as R } from "@psyche/engine";
import type { RegionFile } from "./files.js";
import { createHost, type WorldHost } from "./pool.js";
import { statusPage } from "./page.js";

export interface WorldConfig {
  dir: string;
  /** Worker threads; 0 runs everything in this one. */
  threads: number;
  /** Port for the status page and API; 0 for none. */
  port: number;
  realm: Partial<R.RealmOptions>;
  /** Sim years a real hour once the world has grown; Infinity for flat out. */
  pace: number;
  /** Run flat out until the world first holds this many people. 0: keep to the pace from the start. */
  growTo: number;
  /** Real minutes between saves. */
  checkpointMinutes: number;
  /** The local hour (0 to 23) the morning digest is written. */
  digestHour: number;
  /** Write a digest every this many real hours instead of once a morning. */
  digestEveryHours?: number;
  /** Old-generation heap limit for each worker thread, in MB. */
  heapMB?: number;
  /** Stop by itself at this sim year (for tests and timed runs). */
  untilYear?: number;
  /** Once the event log passes this size it is put away under events/ at the next save, and a new one begun. Default 128. */
  eventsMB?: number;
  log?: (line: string) => void;
  now?: () => number;
}

export const WORLD_DEFAULTS: WorldConfig = { dir: "data/world", threads: 4, port: 8790, realm: {}, pace: 60, growTo: 50_000, checkpointMinutes: 10, digestHour: 7 };

/** The first few hundred bytes of a file, as text. */
function readHead(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(400);
    return buf.toString("utf8", 0, readSync(fd, buf, 0, 400, 0));
  } finally {
    closeSync(fd);
  }
}

interface Manifest {
  v: 1;
  gen: number;
  savedAt: number;
  realm: R.RealmState;
  files: RegionFile[];
  /** How long the event log and timeline were at this save; anything after is from a run that did not finish. */
  eventsBytes: number;
  timelineBytes: number;
  mark: R.DigestMark;
  window: R.DigestTally;
  grown: boolean;
  health: Health;
  lastDigestAt: number;
}

interface Health {
  createdAt: number;
  checkpoints: number;
  restarts: number;
  digests: number;
  /** Real milliseconds spent running seasons, and seasons run, over the life of the world. */
  busyMs: number;
  seasons: number;
}

export interface WorldStatus {
  state: "starting" | "growing" | "running" | "saving" | "stopping" | "stopped" | "failed";
  year: number;
  season: string;
  people: number;
  minds: number;
  towns: number;
  regions: number;
  threads: number;
  /** Years an hour: what it is set to, and what it is doing. */
  pace: number | "max";
  yearsPerHour: number;
  lastSeasonMs: number;
  totals: R.RealmState["totals"];
  health: Health & { heapMB: number; startedAt: number; lastCheckpointAt: number; lastDigestAt: number; nextDigestAt: number; error?: string };
  spend: string;
  coasts: { id: string; name: string; people: number; towns: number; foundedYear: number; from?: string; site: { x: number; y: number } }[];
  updatedAt: number;
}

const SPEND = "$0.00. Every town here runs on rules; no model is called until someone opens a region in the game.";

export class WorldServer {
  readonly config: WorldConfig;
  realm!: R.Realm;
  host!: WorldHost;
  private gen = 0;
  private files: RegionFile[] = [];
  private mark!: R.DigestMark;
  private window: R.DigestTally = R.emptyTally();
  private grown = false;
  private health: Health;
  private state: WorldStatus["state"] = "starting";
  private stopping = false;
  private wake?: () => void;
  private lastCheckpointAt = 0;
  private lastDigestAt = 0;
  private startedAt: number;
  private lastSeasonMs = 0;
  private recent: { at: number; year: number }[] = [];
  private heapMB = 0;
  private error?: string;
  private recentEvents: R.RealmEvent[] = [];
  private http?: Server;
  private crashes: number[] = [];
  /** One thing at a time touches the regions: a season, a save, a digest, or someone looking in. */
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(config: WorldConfig) {
    this.config = config;
    this.startedAt = this.now();
    this.health = { createdAt: this.startedAt, checkpoints: 0, restarts: 0, digests: 0, busyMs: 0, seasons: 0 };
  }

  private now(): number {
    return this.config.now?.() ?? Date.now();
  }

  private log(line: string): void {
    (this.config.log ?? console.log)(line);
  }

  private path(...parts: string[]): string {
    return join(this.config.dir, ...parts);
  }

  /** Open the world in `dir`: pick up where its last save left off, or begin a new one from the crossing. */
  static async open(config: Partial<WorldConfig> = {}): Promise<WorldServer> {
    const s = new WorldServer({ ...WORLD_DEFAULTS, ...config });
    mkdirSync(s.path("regions"), { recursive: true });
    mkdirSync(s.path("digests"), { recursive: true });
    mkdirSync(s.path("events"), { recursive: true });
    s.lock();
    await s.load();
    return s;
  }

  private lock(): void {
    const file = this.path("world.lock");
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, "utf8"));
      let alive = false;
      try {
        alive = pid > 0 && pid !== process.pid && (process.kill(pid, 0), true);
      } catch (e) {
        // Not allowed to signal it means it is there, and someone else's.
        alive = (e as NodeJS.ErrnoException).code === "EPERM";
      }
      if (alive) throw new Error(`Another world server (pid ${pid}) is already running on ${this.config.dir}.`);
    }
    writeFileSync(file, String(process.pid));
  }

  private manifest(): Manifest | undefined {
    const file = this.path("realm.json");
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Manifest) : undefined;
  }

  private async load(): Promise<void> {
    this.host = createHost(this.config.threads, { heapMB: this.config.heapMB });
    const m = this.manifest();
    if (m) {
      await this.host.restore(this.config.dir, m.files);
      this.realm = await R.Realm.resume(m.realm, this.host);
      this.gen = m.gen;
      this.files = m.files;
      this.mark = m.mark;
      this.window = m.window;
      this.grown = m.grown;
      this.health = { ...m.health, restarts: Math.max(this.health.restarts, m.health.restarts) };
      this.lastDigestAt = m.lastDigestAt;
      this.lastCheckpointAt = this.now();
      // Whatever was logged after that save belongs to seasons that will now be lived again.
      for (const [name, bytes] of [["events.jsonl", m.eventsBytes], ["timeline.jsonl", m.timelineBytes]] as const) {
        if (!existsSync(this.path(name))) writeFileSync(this.path(name), "");
        else if (statSync(this.path(name)).size > bytes) truncateSync(this.path(name), bytes);
      }
      this.log(`Picked up the world at year ${m.realm.year}: ${this.realm.people.toLocaleString()} people on ${m.realm.regions.length} coasts (save ${m.gen}).`);
    } else {
      this.realm = await R.Realm.create(this.host, this.config.realm);
      this.mark = R.digestMark(this.realm.state.regions, this.realm.state.year, this.realm.state.totals, this.now());
      this.lastDigestAt = this.now();
      this.lastCheckpointAt = this.now();
      for (const name of ["events.jsonl", "timeline.jsonl"]) writeFileSync(this.path(name), "");
      this.log(`A new world: ${this.realm.people} people at Hollow Bay, the summer after the crossing (seed ${this.realm.state.opts.seed}).`);
    }
    this.writeStatus();
  }

  // ------------------------------------------------------------ the loop

  /** Run until stopped (or until `untilYear`). Saves on the way out. */
  async run(): Promise<void> {
    await this.listen();
    while (!this.stopping) {
      const growing = !this.grown && this.config.growTo > 0;
      this.state = growing ? "growing" : "running";
      const t0 = this.now();
      try {
        await this.serial(async () => this.record(await this.realm.step(), this.now() - t0));
        if (this.now() - this.lastCheckpointAt >= this.config.checkpointMinutes * 60_000) await this.serial(() => this.checkpoint());
        if (this.now() >= this.nextDigestAt()) await this.serial(() => this.writeDigest());
      } catch (e) {
        await this.recover(e);
        continue;
      }
      this.writeStatus();
      if (this.config.untilYear && this.realm.state.year >= this.config.untilYear) break;
      if (!growing && Number.isFinite(this.config.pace) && this.config.pace > 0) {
        const budget = 3_600_000 / (this.config.pace * 4);
        const rest = budget - (this.now() - t0);
        if (rest > 0) await this.sleep(rest);
      }
    }
    await this.close();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(t);
        self.wake = undefined;
        resolve();
      }
      this.wake = done;
    });
  }

  /** Finish the season in flight, save, and stop. */
  stop(): void {
    this.stopping = true;
    this.state = "stopping";
    this.wake?.();
  }

  private async close(): Promise<void> {
    this.state = "stopping";
    try {
      if (!this.error) await this.serial(() => this.checkpoint());
    } finally {
      await this.host.close();
      this.http?.close();
      this.http?.closeAllConnections?.();
      this.state = this.error ? "failed" : "stopped";
      this.writeStatus();
      try {
        unlinkSync(this.path("world.lock"));
      } catch {
        // Already gone.
      }
      this.log(`Stopped at year ${this.realm.state.year} with ${this.realm.people.toLocaleString()} people. Saved.`);
    }
  }

  private record(res: R.SeasonResult, ms: number): void {
    this.lastSeasonMs = ms;
    this.health.busyMs += ms;
    this.health.seasons++;
    // Routine trades inside a region stay in that region's own chronicle; the log keeps what a reader would look for.
    const kept = res.events.filter((e) => e.kind !== "trade" || e.sea || / short\b/.test(e.text));
    if (kept.length) appendFileSync(this.path("events.jsonl"), kept.map((e) => JSON.stringify(e)).join("\n") + "\n");
    R.tally(this.window, res.events);
    this.recentEvents.push(...kept.filter((e) => R.weigh(e) >= 5));
    if (this.recentEvents.length > 200) this.recentEvents.splice(0, this.recentEvents.length - 200);
    if (res.season === "winter") {
      appendFileSync(this.path("timeline.jsonl"), JSON.stringify({ year: res.year, people: res.people, minds: res.minds, towns: res.towns, regions: res.regions, births: this.realm.state.totals.births, deaths: this.realm.state.totals.deaths, at: this.now() }) + "\n");
      this.recent.push({ at: this.now(), year: res.year });
      if (this.recent.length > 40) this.recent.shift();
    }
    if (!this.grown && this.config.growTo > 0 && res.people >= this.config.growTo) {
      this.grown = true;
      this.log(`The world has grown to ${res.people.toLocaleString()} people (year ${res.year}). From here it keeps to ${Number.isFinite(this.config.pace) ? `${this.config.pace} years an hour` : "full speed"}.`);
    }
    if (res.season === "winter" && res.year % 10 === 0) {
      const slow = Object.entries(res.regionMs).sort((a, b) => b[1] - a[1])[0];
      const coast = slow && this.realm.state.regions.find((r) => r.id === slow[0]);
      this.log(`Year ${res.year}: ${res.people.toLocaleString()} people in ${res.towns} towns on ${res.regions} coasts; ${(ms / 1000).toFixed(1)}s a season${coast ? ` (slowest coast: ${coast.name}, ${coast.people} people, ${(slow![1] / 1000).toFixed(1)}s)` : ""}.`);
    }
  }

  /** Years an hour over the last stretch of real time. */
  private speed(): number {
    const a = this.recent[0];
    const b = this.recent.at(-1);
    if (!a || !b || b.at <= a.at) return 0;
    return ((b.year - a.year) / (b.at - a.at)) * 3_600_000;
  }

  // ------------------------------------------------------------ saving

  /** Write the whole world to disk as a new save, then let the save before last go. */
  async checkpoint(): Promise<void> {
    const before = this.state;
    this.state = "saving";
    const t0 = this.now();
    const gen = this.gen + 1;
    const files = await this.host.checkpoint(this.config.dir, gen);
    const stats = await this.host.stats();
    this.heapMB = stats.reduce((n, s) => n + s.heapMB, 0);
    this.health.checkpoints++;
    const m: Manifest = {
      v: 1,
      gen,
      savedAt: this.now(),
      realm: this.realm.state,
      files,
      eventsBytes: statSync(this.path("events.jsonl")).size,
      timelineBytes: statSync(this.path("timeline.jsonl")).size,
      mark: this.mark,
      window: this.window,
      grown: this.grown,
      health: this.health,
      lastDigestAt: this.lastDigestAt,
    };
    // The manifest is what makes a save real: written whole beside the old one, then swapped in.
    const commit = () => {
      writeFileSync(this.path("realm.json.tmp"), JSON.stringify(m));
      renameSync(this.path("realm.json.tmp"), this.path("realm.json"));
    };
    commit();
    // A long life writes a long log. Everything in it so far belongs to this save, so a full one
    // can be put away whole (events/, gzipped, named for the years it covers) and a new one begun.
    if (m.eventsBytes > (this.config.eventsMB ?? 128) * 1e6) {
      const first = /"year":(\d+)/.exec(readHead(this.path("events.jsonl")))?.[1] ?? "0";
      writeFileSync(this.path("events", `years-${first.padStart(6, "0")}-${String(this.realm.state.year).padStart(6, "0")}.jsonl.gz`), gzipSync(readFileSync(this.path("events.jsonl"))));
      writeFileSync(this.path("events.jsonl"), "");
      m.eventsBytes = 0;
      commit();
    }
    const keep = new Set([...files, ...this.files].map((f) => f.file.split("/").pop()!));
    for (const f of readdirSync(this.path("regions"))) if (!keep.has(f)) unlinkSync(this.path("regions", f));
    this.gen = gen;
    this.files = files;
    this.lastCheckpointAt = this.now();
    await this.host.rebalance(new Map(this.realm.state.regions.map((r) => [r.id, r.people])));
    this.state = before;
    const mb = files.reduce((n, f) => n + f.bytes, 0) / 1e6;
    this.log(`Saved year ${this.realm.state.year} (${mb.toFixed(0)} MB in ${((this.now() - t0) / 1000).toFixed(1)}s).`);
  }

  /** A thread died or a season failed: go back to the last save and carry on from there. */
  private async recover(e: unknown): Promise<void> {
    const msg = e instanceof Error ? e.message : String(e);
    this.log(`Something went wrong mid-season: ${msg.split("\n")[0]}`);
    this.health.restarts++;
    const now = this.now();
    this.crashes = [...this.crashes.filter((t) => now - t < 10 * 60_000), now];
    await this.host.close().catch(() => undefined);
    if (this.crashes.length > 3) {
      this.error = `Stopped after ${this.crashes.length} failures in ten minutes. The last: ${msg}`;
      this.state = "failed";
      this.stopping = true;
      this.writeStatus();
      throw new Error(this.error);
    }
    const restarts = this.health.restarts;
    this.window = R.emptyTally();
    this.recentEvents = [];
    await this.load();
    this.health.restarts = restarts;
    this.log(`Back at year ${this.realm.state.year}, from the last save.`);
  }

  // ------------------------------------------------------------ the morning digest

  private nextDigestAt(): number {
    if (this.config.digestEveryHours) return this.lastDigestAt + this.config.digestEveryHours * 3_600_000;
    // The next time the clock reads the digest hour after the last digest.
    const d = new Date(this.lastDigestAt);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), this.config.digestHour, 0, 0, 0);
    if (next.getTime() <= this.lastDigestAt) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  /** Write what happened since the last digest, save the world, and start counting afresh. */
  async writeDigest(): Promise<string> {
    const s = this.realm.state;
    const at = this.now();
    const to = R.digestMark(s.regions, s.year, s.totals, at);
    // The oldest story, from the first coast and the coasts furthest from it.
    const first = s.regions[0]!;
    const far = [...s.regions.slice(1)].sort((a, b) => Math.hypot(b.site.x - first.site.x, b.site.y - first.site.y) - Math.hypot(a.site.x - first.site.x, a.site.y - first.site.y)).slice(0, 4);
    const myths: R.DigestMyth[] = [];
    for (const r of [first, ...far]) {
      const all = await this.host.call(r.id, "myths", undefined);
      // The biggest town there, or the biggest that tells it differently from those already picked.
      const told = new Set(myths.map((x) => x.text));
      const bySize = [...all].sort((a, b) => b.of - a.of);
      const m = bySize.find((x) => x.text && !told.has(x.text)) ?? bySize[0];
      if (m) myths.push({ region: r.name, town: m.name, text: m.text, root: m.root, tellings: m.tellings, holders: m.holders, of: m.of });
    }
    const eldest = [...this.realm.reports.values()]
      .filter((r) => r.eldest)
      .map((r) => ({ name: r.eldest!.name, age: r.eldest!.age, town: r.towns.find((t) => t.id === r.eldest!.town)?.name ?? r.eldest!.town, region: r.name }))
      .sort((a, b) => b.age - a.age);
    const stats = await this.host.stats();
    this.heapMB = stats.reduce((n, x) => n + x.heapMB, 0);
    const date = new Date(at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const text = R.realmDigest({
      title: `The world on ${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`,
      from: this.mark,
      to,
      regions: s.regions,
      window: this.window,
      myths,
      eldest,
      health: { yearsPerHour: this.speed() || (this.health.busyMs ? (this.health.seasons / 4 / this.health.busyMs) * 3_600_000 : 0), threads: this.host.threads, checkpoints: this.health.checkpoints, restarts: this.health.restarts, heapMB: this.heapMB, lastSeasonMs: this.lastSeasonMs },
      spend: SPEND,
    });
    let name = `${day}.md`;
    if (existsSync(this.path("digests", name))) name = `${day}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.md`;
    writeFileSync(this.path("digests", name), text);
    writeFileSync(this.path("digests", "latest.md"), text);
    this.mark = to;
    this.window = R.emptyTally();
    this.lastDigestAt = at;
    this.health.digests++;
    this.log(`Wrote the digest: ${this.path("digests", name)}`);
    // The digest and the save go together, so a restart never writes the same morning twice.
    await this.checkpoint();
    return this.path("digests", name);
  }

  // ------------------------------------------------------------ looking in

  status(): WorldStatus {
    const s = this.realm.state;
    return {
      state: this.state,
      year: s.year,
      season: s.season,
      people: this.realm.people,
      minds: s.regions.reduce((n, r) => n + r.minds, 0),
      towns: s.regions.reduce((n, r) => n + r.towns, 0),
      regions: s.regions.length,
      threads: this.host.threads,
      pace: Number.isFinite(this.config.pace) ? this.config.pace : "max",
      yearsPerHour: Math.round(this.speed()),
      lastSeasonMs: this.lastSeasonMs,
      totals: s.totals,
      health: { ...this.health, heapMB: this.heapMB, startedAt: this.startedAt, lastCheckpointAt: this.lastCheckpointAt, lastDigestAt: this.lastDigestAt, nextDigestAt: this.nextDigestAt(), error: this.error },
      spend: SPEND,
      coasts: s.regions.map((r) => ({ id: r.id, name: r.name, people: r.people, towns: r.towns, foundedYear: r.foundedYear, from: r.from, site: r.site })),
      updatedAt: this.now(),
    };
  }

  private writeStatus(): void {
    if (!this.realm) return;
    writeFileSync(this.path("status.json.tmp"), JSON.stringify(this.status()));
    renameSync(this.path("status.json.tmp"), this.path("status.json"));
  }

  /** Run something that touches the regions once whatever is in flight (a season, a save) is done. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** The last `limit` events in the log that match, newest last. Reads the tail of the file. */
  events(q: { limit?: number; kind?: string; region?: string; since?: number; bytes?: number } = {}): R.RealmEvent[] {
    const file = this.path("events.jsonl");
    const size = statSync(file).size;
    const span = Math.min(size, q.bytes ?? 8_000_000);
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(span);
    try {
      readSync(fd, buf, 0, span, size - span);
    } finally {
      closeSync(fd);
    }
    const lines = buf.toString("utf8").split("\n");
    if (span < size) lines.shift();
    const out: R.RealmEvent[] = [];
    for (const line of lines) {
      if (!line) continue;
      const e = JSON.parse(line) as R.RealmEvent;
      if (q.kind && e.kind !== q.kind) continue;
      if (q.region && e.region !== q.region) continue;
      if (q.since !== undefined && e.year < q.since) continue;
      out.push(e);
    }
    return out.slice(-(q.limit ?? 200));
  }

  timeline(): unknown[] {
    return readFileSync(this.path("timeline.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }

  digests(): string[] {
    return readdirSync(this.path("digests")).filter((f) => f.endsWith(".md") && f !== "latest.md").sort();
  }

  /** Write a save of one region that the game server can open, to watch it live. */
  async exportRegion(id: string): Promise<string> {
    if (!this.realm.state.regions.some((r) => r.id === id)) throw new Error(`No coast ${id}.`);
    const save = await this.serial(() => this.host.call(id, "export", undefined));
    const dir = this.path("exports", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "island.json"), JSON.stringify(save));
    return dir;
  }

  /** Open the status page and API (run() does this by itself when a port is set). */
  async listen(): Promise<void> {
    if (this.http || !this.config.port) return;
    this.http = createServer((req, res) => {
      this.route(req, res).catch((e) => {
        res.writeHead(/^No /.test(String(e?.message)) ? 404 : 500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.http!.once("error", reject);
      this.http!.listen(this.config.port, "127.0.0.1", () => resolve());
    });
    this.log(`Looking in: http://localhost:${this.config.port}`);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    const json = (x: unknown) => {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(x));
    };
    const text = (x: string, type = "text/markdown; charset=utf-8") => {
      res.writeHead(200, { "content-type": type });
      res.end(x);
    };
    if (parts.length === 0) return text(statusPage(), "text/html; charset=utf-8");
    if (parts[0] !== "api" || parts[1] !== "world") throw new Error("No such page.");
    const [, , what, a, b, c] = parts;
    const post = req.method === "POST";
    if (!what || what === "status") return json(this.status());
    if (what === "timeline") return json(this.timeline());
    if (what === "recent") return json(this.recentEvents.slice(-Number(url.searchParams.get("limit") ?? 50)));
    if (what === "events") return json(this.events({ limit: Number(url.searchParams.get("limit") ?? 200), kind: url.searchParams.get("kind") ?? undefined, region: url.searchParams.get("region") ?? undefined, since: url.searchParams.has("since") ? Number(url.searchParams.get("since")) : undefined }));
    if (what === "digests" && !a) return json(this.digests());
    if (what === "digests" && a) {
      if (!/^[\w-]+(\.md)?$/.test(a)) throw new Error("No such digest.");
      const file = this.path("digests", a.endsWith(".md") ? a : `${a}.md`);
      if (!existsSync(file)) throw new Error("No such digest.");
      return text(readFileSync(file, "utf8"));
    }
    if (what === "digest" && post) return json({ file: await this.serial(() => this.writeDigest()) });
    if (what === "checkpoint" && post) return json({ ok: await this.serial(() => this.checkpoint()).then(() => true) });
    if (what === "pace" && post) {
      const v = url.searchParams.get("years");
      this.config.pace = v === "max" ? Infinity : Math.max(0.1, Number(v));
      if (!Number.isFinite(this.config.pace) && v !== "max") throw new Error("Give the pace as years an hour, or max.");
      this.wake?.();
      return json({ pace: Number.isFinite(this.config.pace) ? this.config.pace : "max" });
    }
    if (what === "regions" && !a) return json(this.realm.state.regions);
    if (what === "regions" && a) {
      if (!this.realm.state.regions.some((r) => r.id === a)) throw new Error(`No coast ${a}.`);
      if (!b) return json({ region: this.realm.state.regions.find((r) => r.id === a), report: this.realm.reports.get(a), view: await this.serial(() => this.host.call(a, "view", undefined)) });
      if (b === "myths") return json(await this.serial(() => this.host.call(a, "myths", undefined)));
      if (b === "export" && post) return json({ dir: await this.exportRegion(a), open: `PSYCHE_DATA=${this.path("exports", a)} npm run dev` });
      if (b === "towns" && c) return json(await this.serial(() => this.host.call(a, "town", { town: c })));
      if (b === "people" && c) {
        const p = await this.serial(() => this.host.call(a, "person", { id: c }));
        if (!p) throw new Error(`No one called ${c} lives on that coast.`);
        return json(p);
      }
    }
    throw new Error("No such page.");
  }
}
