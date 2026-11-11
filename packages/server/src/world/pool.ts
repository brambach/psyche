// Where a big realm's regions live: spread over worker threads, the heaviest shared out first. The
// pool is a RegionHost, so the realm above it runs exactly as it would on one thread; the only
// difference is that a season's regions run side by side.

import { totalmem } from "node:os";
import { Worker } from "node:worker_threads";
import { realm as R, type TownPacket } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";
import { readRegion, writeRegion, type RegionFile } from "./files.js";
import type { WorkerRequest, WorkerStats } from "./worker.js";

/** What the world server needs of wherever its regions live, on top of what the realm needs. */
export interface WorldHost extends R.RegionHost {
  /** Every region written to `dir` as generation `gen`. */
  checkpoint(dir: string, gen: number): Promise<RegionFile[]>;
  /** Take up the regions of a checkpoint. */
  restore(dir: string, files: RegionFile[]): Promise<void>;
  stats(): Promise<WorkerStats[]>;
  /** Even out the load between threads, if it has drifted. Returns how many regions moved. */
  rebalance(people: Map<string, number>): Promise<number>;
  close(): Promise<void>;
  readonly threads: number;
}

export class WorkerCrash extends Error {}

interface Slot {
  worker: Worker;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  regions: Set<string>;
  dead?: Error;
}

export class WorkerPool implements WorldHost {
  private slots: Slot[] = [];
  private where = new Map<string, Slot>();
  private load = new Map<string, number>();
  private nextId = 1;
  readonly threads: number;

  constructor(threads: number, opts: { heapMB?: number } = {}) {
    this.threads = threads;
    const url = new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);
    // A worker needs the same TypeScript loader this thread has. tsx passes it down by itself; a
    // test runner does not, so ask for it by name.
    const hasLoader = process.execArgv.some((a) => /tsx/.test(a));
    const execArgv = url.pathname.endsWith(".ts") && !hasLoader ? ["--import", "tsx", "--conditions=source"] : undefined;
    for (let i = 0; i < threads; i++) {
      const worker = new Worker(url, { execArgv, resourceLimits: opts.heapMB ? { maxOldGenerationSizeMb: opts.heapMB } : undefined });
      const slot: Slot = { worker, pending: new Map(), regions: new Set() };
      worker.on("message", (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
        const p = slot.pending.get(m.id);
        if (!p) return;
        slot.pending.delete(m.id);
        if (m.ok) p.resolve(m.result);
        else p.reject(new Error(m.error));
      });
      const died = (e: Error) => {
        if (slot.dead) return;
        slot.dead = e;
        for (const p of slot.pending.values()) p.reject(e);
        slot.pending.clear();
      };
      worker.on("error", (e) => died(new WorkerCrash(`A world thread failed: ${e.message}`)));
      worker.on("exit", (code) => died(new WorkerCrash(`A world thread stopped (code ${code}).`)));
      this.slots.push(slot);
    }
  }

  private ask<T>(slot: Slot, req: WorkerRequest): Promise<T> {
    if (slot.dead) return Promise.reject(slot.dead);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      slot.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      slot.worker.postMessage({ id, req });
    });
  }

  private weight(slot: Slot): number {
    let n = 0;
    for (const id of slot.regions) n += this.load.get(id) ?? 0;
    return n;
  }

  /** The thread carrying the fewest people. */
  private lightest(): Slot {
    return [...this.slots].sort((a, b) => this.weight(a) - this.weight(b) || a.regions.size - b.regions.size)[0]!;
  }

  private place(id: string, slot: Slot, people: number): void {
    this.where.get(id)?.regions.delete(id);
    slot.regions.add(id);
    this.where.set(id, slot);
    this.load.set(id, people);
  }

  private slotOf(id: string): Slot {
    const s = this.where.get(id);
    if (!s) throw new Error(`No region ${id}.`);
    return s;
  }

  async origin(spec: R.RegionSpec): Promise<R.RegionReport> {
    const slot = this.lightest();
    const rep = await this.ask<R.RegionReport>(slot, { op: "origin", spec });
    this.place(spec.id, slot, rep.people);
    return rep;
  }

  async colony(spec: R.RegionSpec, packet: TownPacket, from: { id: string; name: string }): Promise<R.RegionReport> {
    const slot = this.lightest();
    const rep = await this.ask<R.RegionReport>(slot, { op: "colony", spec, packet, from });
    this.place(spec.id, slot, rep.people);
    return rep;
  }

  async season(ids: string[]): Promise<R.RegionReport[]> {
    const groups = new Map<Slot, string[]>();
    for (const id of ids) {
      const s = this.slotOf(id);
      groups.set(s, [...(groups.get(s) ?? []), id]);
    }
    const done = await Promise.all([...groups].map(([slot, mine]) => this.ask<R.RegionReport[]>(slot, { op: "season", ids: mine })));
    const by = new Map(done.flat().map((r) => [r.id, r]));
    for (const r of by.values()) this.load.set(r.id, r.people);
    return ids.map((id) => by.get(id)!);
  }

  call<K extends R.RunnerOp>(region: string, op: K, arg: R.RunnerOps[K]["in"]): Promise<R.RunnerOps[K]["out"]> {
    return this.ask(this.slotOf(region), { op: "call", region, call: op, arg });
  }

  async checkpoint(dir: string, gen: number): Promise<RegionFile[]> {
    const files = await Promise.all(this.slots.map((s) => this.ask<RegionFile[]>(s, { op: "checkpoint", dir, gen })));
    return files.flat();
  }

  async restore(dir: string, files: RegionFile[]): Promise<void> {
    // Biggest first, each to whichever thread is lightest so far.
    const jobs: Promise<unknown>[] = [];
    for (const f of [...files].sort((a, b) => b.people - a.people || a.id.localeCompare(b.id))) {
      const slot = this.lightest();
      this.place(f.id, slot, f.people);
      jobs.push(this.ask(slot, { op: "loadFile", dir, file: f.file }));
    }
    await Promise.all(jobs);
  }

  stats(): Promise<WorkerStats[]> {
    return Promise.all(this.slots.map((s) => this.ask<WorkerStats>(s, { op: "stats" })));
  }

  async rebalance(people: Map<string, number>): Promise<number> {
    for (const [id, n] of people) if (this.where.has(id)) this.load.set(id, n);
    let moved = 0;
    for (let i = 0; i < 8; i++) {
      const by = [...this.slots].sort((a, b) => this.weight(b) - this.weight(a));
      const heavy = by[0]!;
      const light = by.at(-1)!;
      const gap = this.weight(heavy) - this.weight(light);
      if (heavy === light || gap < Math.max(200, this.weight(heavy) * 0.2)) break;
      // The region whose move leaves the two closest to even.
      const pick = [...heavy.regions].map((id) => ({ id, n: this.load.get(id) ?? 0 })).filter((x) => x.n < gap).sort((a, b) => Math.abs(gap - 2 * a.n) - Math.abs(gap - 2 * b.n) || a.id.localeCompare(b.id))[0];
      if (!pick) break;
      const saved = await this.ask<R.SavedRegion>(heavy, { op: "call", region: pick.id, call: "save", arg: undefined });
      await this.ask(light, { op: "load", saved });
      await this.ask(heavy, { op: "drop", region: pick.id });
      this.place(pick.id, light, pick.n);
      moved++;
    }
    return moved;
  }

  /** For tests: make one thread die mid-flight. */
  crash(i = 0): void {
    const s = this.slots[i]!;
    s.worker.postMessage({ id: this.nextId++, req: { op: "crash" } });
  }

  async close(): Promise<void> {
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
  }
}

/** The same thing with no threads: every region in this one. For small worlds and for tests. */
export class InlineHost extends R.LocalHost implements WorldHost {
  readonly threads = 0;

  constructor() {
    super(createMockFaculties());
  }

  async checkpoint(dir: string, gen: number): Promise<RegionFile[]> {
    return [...this.runners.values()].map((r) => writeRegion(dir, gen, r.save(), r.people));
  }

  async restore(dir: string, files: RegionFile[]): Promise<void> {
    for (const f of files) this.load(readRegion(dir, f.file));
  }

  async stats(): Promise<WorkerStats[]> {
    const mem = process.memoryUsage();
    return [{ regions: [...this.runners.keys()], people: [...this.runners.values()].reduce((n, r) => n + r.people, 0), heapMB: Math.round(mem.heapUsed / 1e6), rssMB: Math.round(mem.rss / 1e6) }];
  }

  async rebalance(): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {}
}

/**
 * How many coasts a world of this many people needs. A full coast of twelve towns settles at about
 * 1,700 people, so this leaves room to pass the target and not much more.
 */
export function regionsFor(people: number): number {
  return Math.max(8, Math.ceil(people / 1400));
}

/** A heap limit for each thread, in MB: three quarters of the machine's memory shared out, within reason. */
export function heapFor(threads: number): number {
  return Math.max(1024, Math.min(8192, Math.floor((totalmem() / 1e6) * 0.75 / Math.max(1, threads))));
}

export function createHost(threads: number, opts: { heapMB?: number } = {}): WorldHost {
  return threads > 0 ? new WorkerPool(threads, opts) : new InlineHost();
}
