// A small HTTP server that hosts one live session for the brain scan UI.
// The session is saved as seed + inputs + recorded LLM calls, and restored by exact replay.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createMara, demoScript, Session, type Ablations, type FacultyCall, type Input } from "@psyche/engine";
import { createFaculties } from "@psyche/faculties";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = resolve(process.env.PSYCHE_DATA ?? "data");
const SAVE = join(DATA_DIR, "session.json");
const WEB_DIST = resolve(process.env.PSYCHE_WEB ?? "packages/web/dist");

const { kind, faculties } = createFaculties();

interface Saved {
  seed: number;
  ablations: Partial<Ablations>;
  inputs: Input[];
  log: FacultyCall[];
}

let seed = 52;
let ablations: Partial<Ablations> = {};
let session = new Session(createMara(seed, ablations), faculties);
let busy = false;

function save() {
  mkdirSync(DATA_DIR, { recursive: true });
  const saved: Saved = { seed, ablations, inputs: session.inputs, log: session.log };
  writeFileSync(SAVE, JSON.stringify(saved));
}

async function restore() {
  if (!existsSync(SAVE)) return;
  const saved = JSON.parse(readFileSync(SAVE, "utf8")) as Saved;
  seed = saved.seed;
  ablations = saved.ablations;
  const r = await Session.replay(createMara(seed, ablations), saved.inputs, saved.log, faculties);
  session = r.session;
  console.log(`Restored ${saved.inputs.length} inputs${r.divergedAt !== undefined ? ` (diverged at call ${r.divergedAt})` : ""}.`);
}

function view() {
  return {
    faculties: kind,
    seed,
    ablations: session.initial.ablations,
    initial: session.initial,
    frames: session.frames,
    calls: session.log.length,
  };
}

async function body<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return (chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}) as T;
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  if (!p.startsWith("/api/")) {
    const file = join(WEB_DIST, p === "/" ? "index.html" : p);
    if (file.startsWith(WEB_DIST) && existsSync(file)) {
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } else if (existsSync(join(WEB_DIST, "index.html"))) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(readFileSync(join(WEB_DIST, "index.html")));
    } else send(res, 404, { error: "Web UI not built. Run npm run dev, or npm run build first." });
    return;
  }
  if (req.method === "GET" && p === "/api/session") return send(res, 200, view());
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  if (busy) return send(res, 409, { error: "The mind is still thinking. Try again in a moment." });
  busy = true;
  try {
    if (p === "/api/input") {
      const { input } = await body<{ input: Input }>(req);
      await session.apply(input);
    } else if (p === "/api/rewind") {
      const { index } = await body<{ index: number }>(req);
      session.rewind(index);
    } else if (p === "/api/reset") {
      const b = await body<{ seed?: number; ablations?: Partial<Ablations>; demo?: boolean }>(req);
      seed = b.seed ?? seed;
      ablations = b.ablations ?? ablations;
      session = new Session(createMara(seed, ablations), faculties);
      if (b.demo) for (const input of demoScript()) await session.apply(input);
    } else if (p === "/api/rerun") {
      // Same history, different mechanisms: replay recorded calls until the mind asks for something new.
      const b = await body<{ ablations: Partial<Ablations> }>(req);
      ablations = b.ablations;
      const r = await Session.replay(createMara(seed, ablations), session.inputs, session.log, faculties);
      session = r.session;
    } else return send(res, 404, { error: `No route ${p}` });
    save();
    send(res, 200, view());
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  } finally {
    busy = false;
  }
}

await restore();
createServer((req, res) => void route(req, res)).listen(PORT, () => {
  console.log(`Psyche server on http://localhost:${PORT} (faculties: ${kind})`);
});
