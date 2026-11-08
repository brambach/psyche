// The live game's connection to the server: one event stream. The server sends the whole frame when
// you connect, then only what changed each tick; this keeps the frame and hands React a new object
// whenever it changes (lists that did not change keep their identity, so nothing redraws for them).

import { useEffect, useRef, useState } from "react";
import { applyDelta, type FrameDelta, type GameFrame, type Scene3D } from "@psyche/engine";
import type { AwaySummary, GameView } from "./api";

export interface GameStream {
  view?: GameView;
  connected: boolean;
  /** What happened while nobody was watching, sent once when you arrive. */
  away?: AwaySummary;
  dismissAway: () => void;
}

/** Put the 3D scene back together from its `scene.*` keys, reusing the last one if none of them changed. */
function withScene(frame: GameFrame, last: GameView | undefined): GameView {
  const view = { ...frame } as unknown as GameView & Record<string, unknown>;
  let changed = !last?.scene;
  const scene: Record<string, unknown> = {};
  let any = false;
  for (const [k, v] of Object.entries(frame)) {
    if (!k.startsWith("scene.")) continue;
    delete view[k];
    any = true;
    const key = k.slice(6);
    scene[key] = v;
    if (!changed && (last!.scene as unknown as Record<string, unknown>)[key] !== v) changed = true;
  }
  view.scene = any ? (changed ? (scene as unknown as Scene3D) : last!.scene) : undefined;
  return view;
}

export function useGameStream(): GameStream {
  const [view, setView] = useState<GameView>();
  const [connected, setConnected] = useState(false);
  const [away, setAway] = useState<AwaySummary>();
  const frame = useRef<GameFrame>();
  const last = useRef<GameView>();

  useEffect(() => {
    const es = new EventSource("/api/stream");
    const publish = () => {
      const v = withScene(frame.current!, last.current);
      last.current = v;
      setView(v);
    };
    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("full", (e) => {
      frame.current = JSON.parse((e as MessageEvent<string>).data) as GameFrame;
      setConnected(true);
      publish();
    });
    es.addEventListener("delta", (e) => {
      if (!frame.current) return;
      // A shallow copy, so keys that changed get new values and the rest keep theirs.
      frame.current = applyDelta({ ...frame.current }, JSON.parse((e as MessageEvent<string>).data) as FrameDelta);
      publish();
    });
    es.addEventListener("away", (e) => setAway(JSON.parse((e as MessageEvent<string>).data) as AwaySummary));
    return () => es.close();
  }, []);

  return { view, connected, away, dismissAway: () => setAway(undefined) };
}
