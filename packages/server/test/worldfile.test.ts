// World files: packed to hand to someone else, and unpacked with care when one comes in.

import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { WORLD_FORMAT, WORLD_VERSION } from "@psyche/engine";
import { packWorld, unpackWorld } from "../src/worldfile";

// The smallest save there is: an island's history to replay.
const saved = { scenario: "island", seed: 7, inputs: [], log: [] };
const head = { name: "Before the granary", savedAt: 1_700_000_000_000, summary: { world: "The island", tick: 480, towns: 1, people: 2 }, thumb: "data:image/jpeg;base64,AAAA" };

describe("world files", () => {
  it("packs a save with its header, gzipped, and unpacks it whole", () => {
    const file = packWorld(saved, head);
    expect(file[0]).toBe(0x1f);
    expect(file[1]).toBe(0x8b);
    const raw = JSON.parse(gunzipSync(file).toString("utf8"));
    expect(raw).toMatchObject({ ...saved, format: WORLD_FORMAT, version: WORLD_VERSION, name: "Before the granary" });

    const back = unpackWorld(file);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.head).toMatchObject({ name: "Before the granary", savedAt: head.savedAt, scenario: "island", seed: 7, thumb: head.thumb });
    expect(back.head.summary).toMatchObject({ world: "The island", tick: 480, towns: 1, people: 2 });
    expect(back.saved).toMatchObject(saved);
  });

  it("cleans the name and drops a thumbnail that isn't a picture", () => {
    const back = unpackWorld(packWorld(saved, { name: "../<My> world!", savedAt: 1, thumb: "javascript:alert(1)" }));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.head.name).toBe("My world");
      expect(back.head.thumb).toBeUndefined();
    }
    const unnamed = unpackWorld(packWorld(saved, { name: "///", savedAt: 1 }));
    expect(unnamed.ok && unnamed.head.name).toBe("A shared world");
  });

  it("opens a plain, unzipped save too", () => {
    const back = unpackWorld(Buffer.from(JSON.stringify(saved)));
    expect(back.ok).toBe(true);
  });

  it("gives a plain error for anything else, and never throws", () => {
    const bad: [Buffer, RegExp][] = [
      [Buffer.alloc(0), /not a Psyche world/],
      [Buffer.from("hello"), /not a Psyche world/],
      [Buffer.from("[1,2,3]"), /not a Psyche world/],
      [Buffer.from(JSON.stringify({ format: "another-game", seed: 1 })), /not a Psyche world/],
      [gzipSync(Buffer.from("not json")), /not a Psyche world/],
      [gzipSync(JSON.stringify({ seed: 7 })), /history/],
      [gzipSync(JSON.stringify({ ...saved, version: WORLD_VERSION + 1 })), /newer Psyche/],
      // Starts like a gzip and isn't one.
      [Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]), /could not be opened/],
      // A real gzip, cut short.
      [packWorld(saved, head).subarray(0, 40), /could not be opened/],
    ];
    for (const [buf, message] of bad) {
      const r = unpackWorld(buf);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(message);
    }
  });
});
