// The live game end to end: start the server on the offline mock, watch the stream, change the speed,
// save a world under a name and load it back.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDelta, type FrameDelta, type GameFrame } from "@psyche/engine";

const PORT = 8800 + Math.floor(Math.random() * 100);
const base = `http://localhost:${PORT}`;
let server: ChildProcess;
let data: string;

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/cost`)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The server did not start.");
}

const post = async (path: string, body: unknown) => {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

/** Read the event stream for a while: the frame the deltas rebuild, and every event seen. */
async function watch(ms: number): Promise<{ frame: GameFrame; events: string[] }> {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let frame: GameFrame = {};
  const events: string[] = [];
  const stop = Date.now() + ms;
  try {
    while (Date.now() < stop) {
      const r = await Promise.race([reader.read(), new Promise<undefined>((ok) => setTimeout(() => ok(undefined), stop - Date.now()))]);
      if (!r || r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (\w+)/m.exec(block)?.[1];
        const raw = /^data: (.*)$/m.exec(block)?.[1];
        if (!ev || !raw) continue;
        events.push(ev);
        if (ev === "full") frame = JSON.parse(raw) as GameFrame;
        if (ev === "delta") applyDelta(frame, JSON.parse(raw) as FrameDelta);
      }
    }
  } finally {
    ctrl.abort();
  }
  return { frame, events };
}

beforeAll(async () => {
  data = mkdtempSync(join(tmpdir(), "psyche-game-"));
  server = spawn("npx", ["tsx", "--conditions=source", "packages/server/src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), PSYCHE_DATA: data, PSYCHE_FACULTIES: "mock", PSYCHE_SCENARIO: "region", PSYCHE_SPEND_FILE: join(data, "usage.json") },
    stdio: "ignore",
    // Its own process group, so the tsx child goes when the test ends.
    detached: true,
  });
  await waitUp();
}, 60_000);

afterAll(() => {
  try {
    if (server?.pid) process.kill(-server.pid);
  } catch {
    /* already gone */
  }
  rmSync(data, { recursive: true, force: true });
});

describe("the live game", () => {
  it("streams the whole frame, then deltas that keep it current", async () => {
    const { frame, events } = await watch(4500);
    expect(events[0]).toBe("full");
    expect(events.filter((e) => e === "delta").length).toBeGreaterThanOrEqual(2);
    expect(frame.scenario).toBe("region");
    expect(frame.name).toBe("Hollow Bay");
    expect(Array.isArray(frame["scene.people"])).toBe(true);
    // The frame the deltas built is the frame the server would send a newcomer now (give or take a tick).
    const fresh = (await watch(600)).frame;
    expect(Math.abs((fresh.tick as number) - (frame.tick as number))).toBeLessThanOrEqual(60);
    expect((fresh.agents as unknown[]).length).toBe((frame.agents as unknown[]).length);
  });

  it("runs at 100x and keeps up", async () => {
    await post("/api/control", { speed: 400, running: true });
    const a = (await watch(300)).frame.tick as number;
    await new Promise((r) => setTimeout(r, 4000));
    const b = (await watch(300)).frame.tick as number;
    // Four real seconds at 100x is at least a day, nights included.
    expect(b - a).toBeGreaterThan(1000);
    await post("/api/control", { speed: 4 });
  });

  it("saves a world under a name and loads it back", async () => {
    await post("/api/control", { running: false });
    const before = (await watch(300)).frame.tick as number;
    const saved = await post("/api/slots/save", { name: "Before the storm" });
    expect((saved.body.slots as { name: string }[]).map((s) => s.name)).toContain("Before the storm");
    await post("/api/control", { running: true, speed: 400 });
    await new Promise((r) => setTimeout(r, 2500));
    await post("/api/control", { running: false });
    expect((await watch(300)).frame.tick as number).toBeGreaterThan(before);
    const loaded = await post("/api/slots/load", { name: "Before the storm" });
    expect(loaded.status).toBe(200);
    expect((await watch(300)).frame.tick).toBe(before);
    expect((await post("/api/slots/load", { name: "No such world" })).status).toBe(404);
    const gone = await post("/api/slots/delete", { name: "Before the storm" });
    expect(gone.body.slots).toEqual([]);
  });

  it("keeps the causal history, walks a choice back, and answers a question about it offline", async () => {
    const get = async (path: string) => {
      const r = await fetch(`${base}${path}`);
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };
    const ov = (await get("/api/history")).body as { size: { moments: number }; moments: [string, number, string][]; people: { id: string }[]; historian: { method: string } };
    expect(ov.size.moments).toBeGreaterThan(0);
    expect(ov.people.length).toBeGreaterThan(5);
    expect(ov.historian.method).toBe("offline");
    const id = ov.moments[ov.moments.length - 1]![0];
    const why = (await get(`/api/history/why?node=${encodeURIComponent(id)}`)).body as { node: { id: string }; tree: { causes: unknown[] }; longest: unknown[]; origins: { causes: number } };
    expect(why.node.id).toBe(id);
    expect(why.tree.causes.length).toBeGreaterThan(0);
    expect(why.longest.length).toBeGreaterThan(1);
    expect(why.origins.causes).toBeGreaterThan(0);
    expect((await get("/api/history/why?node=nobody/nothing")).status).toBe(404);
    const ans = await post("/api/history/ask", { question: "Why did they do this?", focus: [id] });
    expect(ans.status).toBe(200);
    expect(ans.body.method).toBe("offline");
    expect((ans.body.cites as string[]).length).toBeGreaterThan(0);
    expect((await post("/api/history/ask", { question: " " })).status).toBe(400);
    // It is saved beside the world.
    await post("/api/slots/save", { name: "With its past" });
    expect(existsSync(join(data, "history", "current.json"))).toBe(true);
    expect(existsSync(join(data, "history", "slot-With its past.json")) || readdirSync(join(data, "history")).some((f) => f.startsWith("slot-"))).toBe(true);
  });
});
