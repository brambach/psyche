import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { realm as R } from "@psyche/engine";
import { readRegion } from "../src/world/files.js";
import { createHost, WorkerPool, type WorldHost } from "../src/world/pool.js";
import { WorldServer, type WorldConfig } from "../src/world/server.js";

// Small towns and regions that fill at two towns: decades here show what centuries do at full size.
const REALM: Partial<R.RealmOptions> = { regionTowns: 2, splitAt: 20, maxRegions: 5, liveYears: 0 };
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "psyche-world-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function grow(host: WorldHost, years: number): Promise<string> {
  const realm = await R.Realm.create(host, REALM);
  while (realm.state.year < years || realm.state.season !== "winter") {
    await realm.step();
    // Moving regions between threads must not change anything either.
    if (realm.state.season === "winter" && realm.state.year % 8 === 0) await host.rebalance(new Map(realm.state.regions.map((r) => [r.id, r.people])));
  }
  const h = createHash("sha256");
  h.update(JSON.stringify(realm.state));
  for (const r of realm.state.regions) h.update(JSON.stringify(await host.call(r.id, "save", undefined)));
  return h.digest("hex");
}

/** A world on disk, as one hash: the realm and every region in its newest save. */
function hashDir(dir: string): string {
  const m = JSON.parse(readFileSync(join(dir, "realm.json"), "utf8")) as { realm: R.RealmState; files: { id: string; file: string }[] };
  const h = createHash("sha256");
  h.update(JSON.stringify(m.realm));
  for (const f of [...m.files].sort((a, b) => a.id.localeCompare(b.id))) h.update(JSON.stringify(readRegion(dir, f.file)));
  return h.digest("hex");
}

const quiet: Partial<WorldConfig> = { port: 0, pace: Infinity, growTo: 0, checkpointMinutes: 1e9, digestHour: 7, realm: REALM, log: () => undefined };

describe("the world on worker threads", () => {
  it("is the same world on three threads as on one", async () => {
    const inline = createHost(0);
    const pool = createHost(3);
    try {
      const [a, b] = await Promise.all([grow(inline, 24), grow(pool, 24)]);
      expect(b).toBe(a);
      const stats = await pool.stats();
      expect(stats.length).toBe(3);
      expect(stats.filter((s) => s.regions.length > 0).length).toBeGreaterThanOrEqual(2);
    } finally {
      await pool.close();
    }
  }, 600_000);
});

describe("the world server", () => {
  it("picks up from its last save exactly where an unbroken run would be", async () => {
    const straight = tmp();
    const broken = tmp();
    const a = await WorldServer.open({ ...quiet, dir: straight, threads: 2, untilYear: 22 });
    await a.run();
    const b1 = await WorldServer.open({ ...quiet, dir: broken, threads: 2, untilYear: 11 });
    await b1.run();
    expect(JSON.parse(readFileSync(join(broken, "status.json"), "utf8")).state).toBe("stopped");
    // A different number of threads the second time: it makes no difference.
    const b2 = await WorldServer.open({ ...quiet, dir: broken, threads: 3, untilYear: 22 });
    expect(b2.realm.state.year).toBe(11);
    await b2.run();
    expect(hashDir(broken)).toBe(hashDir(straight));
    // The log of events and the timeline carry on without a gap or a repeat.
    expect(readFileSync(join(broken, "events.jsonl"), "utf8")).toBe(readFileSync(join(straight, "events.jsonl"), "utf8"));
    const years = readFileSync(join(broken, "timeline.jsonl"), "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { year: number }).year);
    expect(years).toEqual(Array.from({ length: years.length }, (_, i) => years[0]! + i));
    // Two saves are kept, no more.
    const gens = new Set(readdirSync(join(broken, "regions")).map((f) => /\.g(\d+)\./.exec(f)![1]));
    expect(gens.size).toBeLessThanOrEqual(2);
    expect(existsSync(join(broken, "world.lock"))).toBe(false);
  }, 600_000);

  it("goes back to its last save when a thread dies, and carries on", async () => {
    const dir = tmp();
    const lines: string[] = [];
    const w = await WorldServer.open({ ...quiet, dir, threads: 2, untilYear: 16, checkpointMinutes: 0, log: (l) => lines.push(l) });
    const run = w.run();
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (w.realm.state.year < 6) return;
        clearInterval(t);
        (w.host as WorkerPool).crash(0);
        resolve();
      }, 5);
    });
    await run;
    const s = w.status();
    expect(s.state).toBe("stopped");
    expect(s.health.restarts).toBe(1);
    expect(s.year).toBe(16);
    expect(lines.some((l) => /from the last save/.test(l))).toBe(true);
    // Nothing was lived twice in the records.
    const years = readFileSync(join(dir, "timeline.jsonl"), "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { year: number }).year);
    expect(new Set(years).size).toBe(years.length);
    // And what it ended as is what an untroubled run ends as.
    const calm = tmp();
    const c = await WorldServer.open({ ...quiet, dir: calm, threads: 0, untilYear: 16 });
    await c.run();
    expect(hashDir(dir)).toBe(hashDir(calm));
  }, 600_000);

  it("leaves a digest, answers questions, and exports a coast the game can open", async () => {
    const dir = tmp();
    let clock = Date.parse("2026-11-12T03:00:00");
    // Each season takes ten minutes of pretend time, so a morning comes round.
    const w = await WorldServer.open({ ...quiet, dir, threads: 2, port: 8793, untilYear: 26, now: () => (clock += 150_000) });
    await w.listen();
    const get = async (p: string, method = "GET") => (await fetch(`http://localhost:8793/api/world/${p}`, { method })).json();
    const status = (await get("status")) as { people: number; regions: number; spend: string; coasts: { id: string }[] };
    expect(status.people).toBeGreaterThan(10);
    expect(status.spend).toMatch(/^\$0\.00/);
    const region = (await get("regions/r0")) as { view: { towns: { id: string; people: number }[] } };
    const town = region.view.towns[0]!;
    const people = (await get(`regions/r0/towns/${town.id}`)) as { id: string; name: string }[];
    expect(people.length).toBeGreaterThan(0);
    const person = (await get(`regions/r0/people/${people[0]!.id}`)) as { name: string; schemas: unknown[] };
    expect(person.name).toBe(people[0]!.name);
    const exported = (await get("regions/r0/export", "POST")) as { dir: string };
    const save = JSON.parse(readFileSync(join(exported.dir, "island.json"), "utf8")) as { scenario: string; region: { state: R.SavedRegion["state"]; worlds: object } };
    expect(save.scenario).toBe("region");
    expect(Object.keys(save.region.worlds)).toEqual(save.region.state.towns.map((t) => t.id));
    expect(((await (await fetch("http://localhost:8793/")).text()) as string).includes("The world")).toBe(true);
    // Asked while seasons are running, a question waits its turn and gets a whole answer.
    const run = w.run();
    const during = (await get("regions/r0")) as { report: { year: number } };
    expect(during.report.year).toBeGreaterThanOrEqual(1);
    await run;
    const digests = readdirSync(join(dir, "digests")).filter((f) => f !== "latest.md");
    expect(digests.length).toBeGreaterThanOrEqual(1);
    expect(digests[0]).toMatch(/^2026-11-12/);
    const text = readFileSync(join(dir, "digests", "latest.md"), "utf8");
    expect(text).toMatch(/^# The world on /);
    expect(text).toContain("## The coasts");
    expect(text).toContain("Spend: $0.00");
    const events = w.events({ limit: 50 });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.region && e.regionName && e.text)).toBe(true);
  }, 600_000);

  it("will not start twice on the same world", async () => {
    const dir = tmp();
    const w = await WorldServer.open({ ...quiet, dir, threads: 0, untilYear: 2 });
    // Another process holding the lock: pid 1 is always alive.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "world.lock"), "1");
    await expect(WorldServer.open({ ...quiet, dir, threads: 0 })).rejects.toThrow(/already running/);
    await w.run();
  }, 120_000);
});
