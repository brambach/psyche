// World files: a whole world packed to hand to someone else, and unpacked (carefully) when one comes
// in. On disk and on the wire a world file is gzipped JSON: the save itself plus a small header
// (format, version, name, a summary, a thumbnail). Anything that arrives from outside is size-capped
// before it is read, size-capped again as it is unzipped, and shape-checked before a world is built
// from it (see checkWorldFile in the engine).

import type { IncomingMessage } from "node:http";
import { gunzipSync, gzipSync } from "node:zlib";
import { checkWorldFile, cleanThumb, cleanWorldName, WORLD_FORMAT, WORLD_VERSION, type WorldHead, type WorldSummary } from "@psyche/engine";

/** The biggest upload taken, and the biggest it may unzip to. */
export const MAX_UPLOAD = Number(process.env.PSYCHE_IMPORT_MAX_MB ?? 200) * 1_000_000;
export const MAX_UNZIPPED = 480_000_000;

export class TooLarge extends Error {}

/** Read a request body as bytes, giving up as soon as it passes `max`. */
export async function readRaw(req: IncomingMessage, max = MAX_UPLOAD): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) {
      req.destroy();
      throw new TooLarge(`That file is over ${Math.round(max / 1_000_000)} MB.`);
    }
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/** A save, wrapped with its header and gzipped. */
export function packWorld(saved: Record<string, unknown>, head: { name: string; savedAt: number; summary?: WorldSummary; thumb?: string }): Buffer {
  const file = { ...saved, format: WORLD_FORMAT, version: WORLD_VERSION, name: cleanWorldName(head.name) || "A shared world", savedAt: head.savedAt, summary: head.summary, thumb: cleanThumb(head.thumb) };
  return gzipSync(JSON.stringify(file));
}

export type Unpacked = { ok: true; saved: Record<string, unknown>; head: WorldHead } | { ok: false; error: string };

/** Unzip (if it is zipped), parse and check a world file. Never throws: a bad file comes back as an error to show. */
export function unpackWorld(buf: Buffer): Unpacked {
  let text: string;
  try {
    const zipped = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    text = (zipped ? gunzipSync(buf, { maxOutputLength: MAX_UNZIPPED }) : buf).toString("utf8");
  } catch {
    return { ok: false, error: "That file could not be opened. It may be damaged, or too large." };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not a Psyche world." };
  }
  const check = checkWorldFile(data);
  if (!check.ok) return check;
  return { ok: true, saved: data as Record<string, unknown>, head: check.head };
}
