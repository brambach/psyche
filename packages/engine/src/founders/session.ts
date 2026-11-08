// Event-sourced Founders sessions, like the island's: a seed, the builder, an ordered list of
// inputs and every recorded faculty call. Replaying the log rebuilds the islet block for block.

import { dayOf } from "../mind.js";
import type { Faculties } from "../ports.js";
import { recording, replaying, type FacultyCall } from "../session.js";
import type { Trace } from "../trace.js";
import type { Tick } from "../types.js";
import { advanceFounder, injectFounder, type FounderEvent, type FounderFeed, type FounderSink, type FounderState } from "./founder.js";

export type FounderInput = { type: "advance"; minutes: number } | { type: "inject"; event: FounderEvent };

export interface FounderFrame {
  index: number;
  input: FounderInput;
  tick: Tick;
  feedEnd: number;
  traceEnd: number;
  logEnd: number;
  dayStart: boolean;
  state?: FounderState;
}

const KEEP_RECENT = 80;

export class FounderSession {
  readonly initial: FounderState;
  state: FounderState;
  inputs: FounderInput[] = [];
  frames: FounderFrame[] = [];
  log: FacultyCall[] = [];
  feed: FounderFeed[] = [];
  traces: Trace[] = [];
  private faculties: Faculties;

  constructor(initial: FounderState, faculties: Faculties) {
    this.initial = structuredClone(initial);
    this.state = structuredClone(initial);
    this.faculties = faculties;
  }

  setFaculties(f: Faculties): void {
    this.faculties = f;
  }

  async apply(input: FounderInput): Promise<FounderFrame> {
    const f = recording(this.faculties, this.log);
    const sink: FounderSink = { feed: this.feed, traces: this.traces };
    const before = this.state.tick;
    if (input.type === "advance") await advanceFounder(this.state, input.minutes, f, sink);
    else await injectFounder(this.state, input.event, f, sink);
    const frame: FounderFrame = {
      index: this.frames.length,
      input,
      tick: this.state.tick,
      feedEnd: this.feed.length,
      traceEnd: this.traces.length,
      logEnd: this.log.length,
      dayStart: dayOf(this.state.tick) !== dayOf(before),
      state: structuredClone(this.state),
    };
    this.inputs.push(input);
    this.frames.push(frame);
    const old = this.frames[this.frames.length - 1 - KEEP_RECENT];
    if (old && !old.dayStart) old.state = undefined;
    return frame;
  }

  /** Keep inputs 0..index (inclusive); -1 returns to the landing. */
  rewind(index: number): void {
    const target = this.frames[index];
    if (index >= 0 && !target?.state) throw new Error("That moment is too far back to rewind to directly. Pick a morning.");
    this.inputs = this.inputs.slice(0, index + 1);
    this.frames = this.frames.slice(0, index + 1);
    this.log = this.log.slice(0, target ? target.logEnd : 0);
    this.feed = this.feed.slice(0, target ? target.feedEnd : 0);
    this.traces = this.traces.slice(0, target ? target.traceEnd : 0);
    this.state = structuredClone(target ? target.state! : this.initial);
  }

  frameOfTrace(position: number): FounderFrame | undefined {
    return this.frames.find((f) => f.traceEnd > position);
  }

  static async replay(initial: FounderState, inputs: FounderInput[], log: FacultyCall[], live?: Faculties): Promise<{ session: FounderSession; divergedAt?: number }> {
    const r = replaying(log, live);
    const s = new FounderSession(initial, r.faculties);
    for (const input of inputs) await s.apply(input);
    if (live) s.setFaculties(live);
    return { session: s, divergedAt: r.diverged() };
  }
}
