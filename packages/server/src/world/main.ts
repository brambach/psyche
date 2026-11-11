// npm run world            start (or pick up) the world in PSYCHE_WORLD_DIR and keep it living
// npm run world -- status  how it stands
// npm run world -- digest  ask the running world to write a digest now
// npm run world -- export <coast>   write a save of one coast that the game can open
//
// Settings (environment, or the repo's .env):
//   PSYCHE_WORLD_DIR             where the world lives on disk (default data/world)
//   PSYCHE_WORLD_PEOPLE          grow flat out until this many people (default 50000); it settles a little above
//   PSYCHE_WORLD_PACE            sim years a real hour after that, or "max" (default 60)
//   PSYCHE_WORLD_THREADS         worker threads (default: cores less one, at most 8)
//   PSYCHE_WORLD_REGIONS         how many coasts the sea has room for (default: enough for the people)
//   PSYCHE_WORLD_SEED            default 11
//   PSYCHE_WORLD_PORT            status page and API (default 8790; 0 for none)
//   PSYCHE_WORLD_CHECKPOINT_MIN  real minutes between saves (default 10)
//   PSYCHE_WORLD_DIGEST_HOUR     local hour of the morning digest (default 7)
//   PSYCHE_WORLD_HEAP_MB         memory limit for each thread (default: three quarters of the machine's memory, shared out)

import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { heapFor, regionsFor } from "./pool.js";
import { WorldServer, type WorldStatus } from "./server.js";

{
  const envFile = process.env.PSYCHE_ENV ?? fileURLToPath(new URL("../../../../.env", import.meta.url));
  if (existsSync(envFile)) {
    const before = { ...process.env };
    process.loadEnvFile(envFile);
    Object.assign(process.env, before);
  }
}

const env = process.env;
const dir = resolve(env.PSYCHE_WORLD_DIR ?? "data/world");
const port = Number(env.PSYCHE_WORLD_PORT ?? 8790);
const people = Number(env.PSYCHE_WORLD_PEOPLE ?? 50_000);
const [cmd, arg] = process.argv.slice(2);

async function api(path: string, method = "GET"): Promise<unknown> {
  const res = await fetch(`http://localhost:${port}/api/world/${path}`, { method });
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

if (cmd === "status") {
  const file = join(dir, "status.json");
  if (!existsSync(file)) {
    console.log(`No world in ${dir} yet. Start one with: npm run world`);
    process.exit(0);
  }
  const s = JSON.parse(readFileSync(file, "utf8")) as WorldStatus;
  const mins = Math.round((Date.now() - s.updatedAt) / 60000);
  console.log(`${s.state} (${mins < 1 ? "just now" : `${mins} min ago`}): ${s.season} of year ${s.year}. ${s.people.toLocaleString()} people in ${s.towns} towns on ${s.regions} coasts.`);
  console.log(`${s.yearsPerHour} years an hour (set to ${s.pace}) on ${s.threads || 1} threads; ${s.health.checkpoints} saves, ${s.health.restarts} restarts, ${s.health.digests} digests. Spend: ${s.spend}`);
  for (const c of [...s.coasts].sort((a, b) => b.people - a.people).slice(0, 12)) console.log(`  ${c.name.padEnd(24)} ${String(c.people).padStart(6)} people  ${String(c.towns).padStart(2)} towns  since year ${c.foundedYear}`);
} else if (cmd === "digest") {
  try {
    console.log(`Wrote ${((await api("digest", "POST")) as { file: string }).file}`);
  } catch (e) {
    const latest = join(dir, "digests", "latest.md");
    console.log(`The world is not running here (${e instanceof Error ? e.message : e}).${existsSync(latest) ? ` The last digest is at ${latest}` : ""}`);
  }
} else if (cmd === "export") {
  if (!arg) throw new Error("Which coast? e.g. npm run world -- export r0 (npm run world -- status lists them)");
  const r = (await api(`regions/${arg}/export`, "POST")) as { dir: string; open: string };
  console.log(`Saved ${arg} to ${r.dir}. To watch it live in the game:\n  ${r.open}`);
} else {
  const threads = Number(env.PSYCHE_WORLD_THREADS ?? Math.max(1, Math.min(8, availableParallelism() - 1)));
  const pace = env.PSYCHE_WORLD_PACE === "max" ? Infinity : Number(env.PSYCHE_WORLD_PACE ?? 60);
  const world = await WorldServer.open({
    dir,
    threads,
    port,
    pace,
    growTo: people,
    checkpointMinutes: Number(env.PSYCHE_WORLD_CHECKPOINT_MIN ?? 10),
    digestHour: Number(env.PSYCHE_WORLD_DIGEST_HOUR ?? 7),
    heapMB: Number(env.PSYCHE_WORLD_HEAP_MB ?? heapFor(threads)),
    untilYear: env.PSYCHE_WORLD_UNTIL_YEAR ? Number(env.PSYCHE_WORLD_UNTIL_YEAR) : undefined,
    realm: { seed: Number(env.PSYCHE_WORLD_SEED ?? 11), maxRegions: Number(env.PSYCHE_WORLD_REGIONS ?? regionsFor(people)) },
    log: (line) => console.log(`${new Date().toLocaleTimeString()}  ${line}`),
  });
  let asked = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      if (asked) process.exit(1);
      asked = true;
      console.log("\nFinishing the season and saving. Again to quit without saving.");
      world.stop();
    });
  process.on("SIGUSR2", () => void world.serial(() => world.writeDigest()));
  console.log(`The world lives in ${dir}. ${threads} threads; grows to ${people.toLocaleString()} people, then ${Number.isFinite(pace) ? `${pace} years an hour` : "full speed"}. Ctrl-C saves and stops.`);
  await world.run();
  process.exit(0);
}
