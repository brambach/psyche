// The simplest place for regions to live: this thread. Useful for small realms, for tests, and as
// the reference a pool of workers has to match exactly.

import type { Faculties } from "../ports.js";
import type { TownPacket } from "../world/region.js";
import type { RegionHost } from "./realm.js";
import { RegionRunner, type RegionReport, type RegionSpec, type RunnerOp, type RunnerOps, type SavedRegion } from "./runner.js";

/**
 * A packet that crossed between threads was copied on the way. Copy here too, so two regions in one
 * thread never share an object, and a realm on one thread stays the same as one on many.
 */
const copy = <T>(x: T): T => (x === undefined ? x : structuredClone(x));

export class LocalHost implements RegionHost {
  readonly runners = new Map<string, RegionRunner>();
  private faculties: Faculties;

  constructor(faculties: Faculties) {
    this.faculties = faculties;
  }

  async origin(spec: RegionSpec): Promise<RegionReport> {
    const r = RegionRunner.origin(spec, this.faculties);
    this.runners.set(spec.id, r);
    return r.report();
  }

  async colony(spec: RegionSpec, packet: TownPacket, from: { id: string; name: string }): Promise<RegionReport> {
    const r = RegionRunner.colony(spec, copy(packet), from, this.faculties);
    this.runners.set(spec.id, r);
    return r.report();
  }

  load(saved: SavedRegion): void {
    this.runners.set(saved.spec.id, RegionRunner.load(copy(saved), this.faculties));
  }

  async season(ids: string[]): Promise<RegionReport[]> {
    const out: RegionReport[] = [];
    for (const id of ids) out.push(await this.runner(id).season());
    return out;
  }

  async call<K extends RunnerOp>(region: string, op: K, arg: RunnerOps[K]["in"]): Promise<RunnerOps[K]["out"]> {
    return copy(await this.runner(region).call(op, copy(arg)));
  }

  private runner(id: string): RegionRunner {
    const r = this.runners.get(id);
    if (!r) throw new Error(`No region ${id}.`);
    return r;
  }
}
