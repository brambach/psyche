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

export interface WorldSessionOptions {
  /** Snapshots kept for this many recent frames. Default 80. */
  keepRecent?: number;
  /** Day-start snapshots older than this many days are dropped too. Default: keep them all. */
  keepDays?: number;
  /** Only the most recent traces are kept in memory; older ones fall out of the ledger. Default: all. */
  maxTraces?: number;
}

export class WorldSession {
  initial: WorldState;
  world: WorldState;
  inputs: WorldInput[] = [];
  frames: WorldFrame[] = [];
  log: FacultyCall[] = [];
  feed: FeedItem[] = [];
  traces: WorldTrace[] = [];
  /** How many of the oldest traces have been let go; frame trace positions count from the start. */
  traceBase = 0;
  private faculties: Faculties;
  private readonly opts: WorldSessionOptions;
  /** Frames before this one have had their day-start snapshots dropped. */
  private pruned = 0;
  /** Where the feed and traces stood when the session was last rebased (rewinding to -1 returns here). */
  private baseFeed = 0;
  private baseTrace = 0;

  constructor(initial: WorldState, faculties: Faculties, opts: WorldSessionOptions = {}) {
    this.initial = structuredClone(initial);
    this.world = structuredClone(initial);
    this.faculties = faculties;
    this.opts = opts;
  }

  setFaculties(f: Faculties): void {
    this.faculties = f;
  }

  /** `snapshot: false` keeps no copy of the world for this frame (fast-forwarding, where nobody will rewind). */
  async apply(input: WorldInput, opts: { snapshot?: boolean } = {}): Promise<WorldFrame> {
    const f = recording(this.faculties, this.log);
    const sink: Sink = { feed: this.feed, traces: this.traces };
    const before = this.world.tick;
    if (input.type === "advance") await advance(this.world, input.minutes, f, sink);
    else if (input.type === "inject") await inject(this.world, input.event, f, sink);
    else await say(this.world, input.to, input.text, f, sink);
    const dayStart = dayOf(this.world.tick) !== dayOf(before);
    const keep = opts.snapshot ?? (dayStart || (this.opts.keepRecent ?? KEEP_RECENT) > 0);
    const frame: WorldFrame = {
      index: this.frames.length,
      input,
      tick: this.world.tick,
      feedEnd: this.feed.length,
      traceEnd: this.traceBase + this.traces.length,
      logEnd: this.log.length,
      dayStart,
      state: keep ? structuredClone(this.world) : undefined,
    };
    this.inputs.push(input);
    this.frames.push(frame);
    const old = this.frames[this.frames.length - 1 - (this.opts.keepRecent ?? KEEP_RECENT)];
    if (old && !old.dayStart) old.state = undefined;
    if (frame.dayStart && this.opts.keepDays !== undefined) {
      const cutoff = frame.tick - this.opts.keepDays * 1440;
      while (this.pruned < this.frames.length && this.frames[this.pruned]!.tick < cutoff) {
        const f = this.frames[this.pruned++]!;
        if (f.dayStart) f.state = undefined;
      }
    }
    const extra = this.traces.length - (this.opts.maxTraces ?? Infinity);
    if (extra > 0) {
      this.traces.splice(0, extra);
      this.traceBase += extra;
    }
    return frame;
  }

  /** Keep inputs 0..index (inclusive); -1 returns to the start. Only frames with a snapshot can be targets. */
  rewind(index: number): void {
    const target = this.frames[index];
    if (index >= 0 && !target?.state) throw new Error("That moment is too far back to rewind to directly. Pick a morning.");
    if ((target?.traceEnd ?? this.baseTrace) < this.traceBase) throw new Error("That moment is too far back: its traces have been let go.");
    this.inputs = this.inputs.slice(0, index + 1);
    this.frames = this.frames.slice(0, index + 1);
    this.pruned = Math.min(this.pruned, this.frames.length);
    this.log = this.log.slice(0, target ? target.logEnd : 0);
    this.feed = this.feed.slice(0, target ? target.feedEnd : this.baseFeed);
    this.traces = this.traces.slice(0, (target ? target.traceEnd : this.baseTrace) - this.traceBase);
    this.world = structuredClone(target ? target.state! : this.initial);
  }

  /**
   * Make the present the new starting point: the inputs, the call log and the snapshots so far are
   * let go, so a world can run for decades in bounded memory. The feed and recent traces stay, but
   * nothing before this moment can be rewound to or replayed.
   */
  rebase(): void {
    this.initial = structuredClone(this.world);
    this.inputs = [];
    this.frames = [];
    this.log = [];
    this.pruned = 0;
    this.baseFeed = this.feed.length;
    this.baseTrace = this.traceBase + this.traces.length;
  }

  /** The frame whose input produced the trace at this position in `traces`. */
  frameOfTrace(position: number): WorldFrame | undefined {
    return this.frames.find((f) => f.traceEnd > position + this.traceBase);
  }

  static async replay(initial: WorldState, inputs: WorldInput[], log: FacultyCall[], live?: Faculties, opts?: WorldSessionOptions): Promise<{ session: WorldSession; divergedAt?: number }> {
    const r = replaying(log, live);
    const s = new WorldSession(initial, r.faculties, opts);
    for (const input of inputs) await s.apply(input);
    if (live) s.setFaculties(live);
    return { session: s, divergedAt: r.diverged() };
  }
}
