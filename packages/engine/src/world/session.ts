// Event-sourced world sessions, like the single-mind Session: a seed, an ordered list of inputs,
// and every recorded faculty call. Replaying the log rebuilds the island exactly.
// The feed and traces live beside the state, append-only, so rewinding is a truncation.

import type { FacultyCall } from "../session.js";
import { recording, replaying } from "../session.js";
import type { Faculties } from "../ports.js";
import type { Tick } from "../types.js";
import { dayOf } from "../mind.js";
import { advance, inject, say, type FeedItem, type Sink, type WorldEvent, type WorldState, type WorldTrace } from "./world.js";

export type WorldInput =
  | { type: "advance"; minutes: number }
  | { type: "inject"; event: WorldEvent }
  | { type: "say"; to: string; text: string };

export interface WorldFrame {
  index: number;
  input: WorldInput;
  tick: Tick;
  feedEnd: number;
  traceEnd: number;
  logEnd: number;
  /** First frame of a new day; its snapshot is always kept so whole days can be rewound. */
  dayStart: boolean;
  /** World state after this input. Kept for recent frames and day starts only. */
  state?: WorldState;
}

/** Snapshots kept for this many recent frames (older ones are dropped except day starts). */
const KEEP_RECENT = 80;

export class WorldSession {
  readonly initial: WorldState;
  world: WorldState;
  inputs: WorldInput[] = [];
  frames: WorldFrame[] = [];
  log: FacultyCall[] = [];
  feed: FeedItem[] = [];
  traces: WorldTrace[] = [];
  private faculties: Faculties;

  constructor(initial: WorldState, faculties: Faculties) {
    this.initial = structuredClone(initial);
    this.world = structuredClone(initial);
    this.faculties = faculties;
  }

  setFaculties(f: Faculties): void {
    this.faculties = f;
  }

  async apply(input: WorldInput): Promise<WorldFrame> {
    const f = recording(this.faculties, this.log);
    const sink: Sink = { feed: this.feed, traces: this.traces };
    const before = this.world.tick;
    if (input.type === "advance") await advance(this.world, input.minutes, f, sink);
    else if (input.type === "inject") await inject(this.world, input.event, f, sink);
    else await say(this.world, input.to, input.text, f, sink);
    const frame: WorldFrame = {
      index: this.frames.length,
      input,
      tick: this.world.tick,
      feedEnd: this.feed.length,
      traceEnd: this.traces.length,
      logEnd: this.log.length,
      dayStart: dayOf(this.world.tick) !== dayOf(before),
      state: structuredClone(this.world),
    };
    this.inputs.push(input);
    this.frames.push(frame);
    const old = this.frames[this.frames.length - 1 - KEEP_RECENT];
    if (old && !old.dayStart) old.state = undefined;
    return frame;
  }

  /** Keep inputs 0..index (inclusive); -1 returns to the start. Only frames with a snapshot can be targets. */
  rewind(index: number): void {
    const target = this.frames[index];
    if (index >= 0 && !target?.state) throw new Error("That moment is too far back to rewind to directly. Pick a morning.");
    this.inputs = this.inputs.slice(0, index + 1);
    this.frames = this.frames.slice(0, index + 1);
    this.log = this.log.slice(0, target ? target.logEnd : 0);
    this.feed = this.feed.slice(0, target ? target.feedEnd : 0);
    this.traces = this.traces.slice(0, target ? target.traceEnd : 0);
    this.world = structuredClone(target ? target.state! : this.initial);
  }

  /** The frame whose input produced a given trace. */
  frameOfTrace(position: number): WorldFrame | undefined {
    return this.frames.find((f) => f.traceEnd > position);
  }

  static async replay(initial: WorldState, inputs: WorldInput[], log: FacultyCall[], live?: Faculties): Promise<{ session: WorldSession; divergedAt?: number }> {
    const r = replaying(log, live);
    const s = new WorldSession(initial, r.faculties);
    for (const input of inputs) await s.apply(input);
    if (live) s.setFaculties(live);
    return { session: s, divergedAt: r.diverged() };
  }
}
