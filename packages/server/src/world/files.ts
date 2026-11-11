// Region saves on disk: one gzipped JSON file per region per checkpoint, written beside the old one
// and renamed into place, so a crash mid-write never leaves a half-written save where a good one was.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { realm as R } from "@psyche/engine";

export interface RegionFile {
  id: string;
  /** Relative to the data directory. */
  file: string;
  bytes: number;
  people: number;
}

export const regionFile = (id: string, gen: number) => join("regions", `${id}.g${gen}.json.gz`);

export function writeRegion(dir: string, gen: number, saved: R.SavedRegion, people: number): RegionFile {
  const file = regionFile(saved.spec.id, gen);
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  const data = gzipSync(Buffer.from(JSON.stringify(saved)), { level: 1 });
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
  return { id: saved.spec.id, file, bytes: data.length, people };
}

export function readRegion(dir: string, file: string): R.SavedRegion {
  return JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString()) as R.SavedRegion;
}
