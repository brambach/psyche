// One thread of the world. It holds some of the realm's regions and does what it is asked with
// them: run a season, hand over or take in a packet, write its regions to disk. Regions here run on
// the offline mock faculties and nothing else: a town nobody is watching never calls a model, so a
// world of any size costs nothing to keep running.

import { parentPort } from "node:worker_threads";
import { realm as R, type TownPacket } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";
import { readRegion, writeRegion, type RegionFile } from "./files.js";

export type WorkerRequest =
  | { op: "origin"; spec: R.RegionSpec }
  | { op: "colony"; spec: R.RegionSpec; packet: TownPacket; from: { id: string; name: string } }
  | { op: "load"; saved: R.SavedRegion }
  | { op: "loadFile"; dir: string; file: string }
  | { op: "season"; ids: string[] }
  | { op: "call"; region: string; call: R.RunnerOp; arg: unknown }
  | { op: "checkpoint"; dir: string; gen: number }
  | { op: "drop"; region: string }
  | { op: "stats" }
  /** For tests of what happens when a thread dies. */
  | { op: "crash" };

export interface WorkerStats {
  regions: string[];
  people: number;
  heapMB: number;
  rssMB: number;
}

const faculties = createMockFaculties();
const runners = new Map<string, R.RegionRunner>();
const runner = (id: string): R.RegionRunner => {
  const r = runners.get(id);
  if (!r) throw new Error(`This thread does not hold region ${id}.`);
  return r;
};

async function handle(m: WorkerRequest): Promise<unknown> {
  switch (m.op) {
    case "origin": {
      const r = R.RegionRunner.origin(m.spec, faculties);
      runners.set(m.spec.id, r);
      return r.report();
    }
    case "colony": {
      const r = R.RegionRunner.colony(m.spec, m.packet, m.from, faculties);
      runners.set(m.spec.id, r);
      return r.report();
    }
    case "load": {
      runners.set(m.saved.spec.id, R.RegionRunner.load(m.saved, faculties));
      return runner(m.saved.spec.id).people;
    }
    case "loadFile": {
      const saved = readRegion(m.dir, m.file);
      runners.set(saved.spec.id, R.RegionRunner.load(saved, faculties));
      return runner(saved.spec.id).people;
    }
    case "season": {
      const out: R.RegionReport[] = [];
      for (const id of m.ids) out.push(await runner(id).season());
      return out;
    }
    case "call":
      return runner(m.region).call(m.call, m.arg as never);
    case "checkpoint": {
      const out: RegionFile[] = [];
      for (const r of runners.values()) out.push(writeRegion(m.dir, m.gen, r.save(), r.people));
      return out;
    }
    case "drop":
      return runners.delete(m.region);
    case "stats": {
      const mem = process.memoryUsage();
      const s: WorkerStats = { regions: [...runners.keys()], people: [...runners.values()].reduce((n, r) => n + r.people, 0), heapMB: Math.round(mem.heapUsed / 1e6), rssMB: Math.round(mem.rss / 1e6) };
      return s;
    }
    case "crash":
      process.exit(3);
  }
}

// One request at a time, in the order they came.
let chain: Promise<void> = Promise.resolve();
parentPort!.on("message", ({ id, req }: { id: number; req: WorkerRequest }) => {
  chain = chain.then(async () => {
    try {
      parentPort!.postMessage({ id, ok: true, result: await handle(req) });
    } catch (e) {
      parentPort!.postMessage({ id, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  });
});
