// You, walking around in the watched town (engine/world/you.ts). Everything you do goes into the
// world as a recorded input, through the same queue as the clock, so a town you walked through
// replays exactly. Kept apart from index.ts so the routes can grow without touching it.
//
// A body with nobody at the keyboard should not be standing in the square being talked to, so the
// page sends a heartbeat while you are walking; when it stops (the tab closed, or you went back to
// watching from above), your body goes to rest at its camp and nobody comes looking for it.

import type { IncomingMessage, ServerResponse } from "node:http";
import { youCheck, youView, type Deed, type WorldSession, type YouAct, type YouView } from "@psyche/engine";

export interface YouHost {
  session(): WorldSession;
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  save(force?: boolean): void;
  busy(): string | undefined;
  speed(): number;
  body<T>(req: IncomingMessage): Promise<T>;
  send(res: ServerResponse, status: number, data: unknown): void;
  broadcast(): void;
}

/** No heartbeat for this long, and your body goes to rest. */
const IDLE_MS = 45_000;
/** Above this speed nobody could answer a villager in time, so nobody is sent to ask. */
const TOO_FAST = 16;

const ACTS = new Set<YouAct["act"]>(["arrive", "move", "rest", "leave", "greet", "say", "ask", "compliment", "comfort", "insult", "apologize", "give", "buy", "sell", "beg", "help", "rumor", "gather", "store", "steal", "repay", "answer"]);

export function youRoutes(host: YouHost) {
  let beat = 0;

  const rest = async () => {
    await host.exclusive(async () => {
      const s = host.session();
      if (s.world.you?.here) await s.apply({ type: "you", act: { act: "rest" } }, { snapshot: false });
    });
    host.broadcast();
  };

  // Your body rests when the page stops saying you are there, or when time is flying.
  setInterval(() => {
    const y = host.session().world.you;
    if (!y?.here || host.busy()) return;
    if (Date.now() - beat > IDLE_MS || host.speed() > TOO_FAST) void rest().catch((e) => console.error(e));
  }, 5_000).unref();

  const reply = (res: ServerResponse, deed?: Deed) => host.send(res, 200, { you: youView(host.session().world) ?? null, deed } satisfies { you: YouView | null; deed?: Deed });

  /** Handles /api/you routes; false when the path is not one of them. */
  return async function handle(p: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!p.startsWith("/api/you")) return false;
    if (req.method === "GET") {
      reply(res);
      return true;
    }
    const wait = host.busy();
    if (wait) {
      host.send(res, 409, { error: wait });
      return true;
    }
    if (p === "/api/you/beat") {
      // "I am still here, and this is where I am standing."
      const b = await host.body<{ place?: string }>(req);
      beat = Date.now();
      const y = host.session().world.you;
      if (y && y.standing !== "banished" && b.place && (b.place !== y.place || !y.here)) {
        const act: YouAct = { act: "move", place: b.place };
        if (!youCheck(host.session().world, act)) await host.exclusive(() => host.session().apply({ type: "you", act }, { snapshot: false }));
      }
      reply(res);
      return true;
    }
    if (p === "/api/you/act") {
      const b = await host.body<{ act?: YouAct }>(req);
      const act = b.act;
      if (!act || !ACTS.has(act.act)) {
        host.send(res, 400, { error: "Do what?" });
        return true;
      }
      beat = Date.now();
      let refused: string | undefined;
      let deed: Deed | undefined;
      await host.exclusive(async () => {
        const s = host.session();
        // Checked inside the queue: the clock may have moved people since the page last heard.
        refused = youCheck(s.world, act);
        if (refused) return;
        const before = s.world.you?.deeds.at(-1)?.id;
        await s.apply({ type: "you", act }, { snapshot: act.act !== "move" && act.act !== "rest" });
        const last = s.world.you?.deeds.at(-1);
        if (last && last.id !== before) deed = last;
      });
      if (refused) {
        host.send(res, 400, { error: refused });
        return true;
      }
      host.save(true);
      reply(res, deed);
      return true;
    }
    host.send(res, 404, { error: `No route ${p}` });
    return true;
  };
}
