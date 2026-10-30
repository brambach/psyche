// Event-sourced sessions. A session is a seed, an ordered list of inputs, and the recorded
// responses of every LLM call. Replaying that log rebuilds every state exactly, with no new calls.
// Rewind truncates the log; a fork is a rewind followed by new inputs.

import { perceiveText, runPercept, wait } from "./mind.js";
import type { Faculties, FacultyName, Percept } from "./ports.js";
import type { Trace } from "./trace.js";
import type { MindState, Tick } from "./types.js";

export type Input =
  | { type: "say"; from: string; text: string; at?: Tick }
  | { type: "event"; text: string; actor?: string; percept?: Omit<Percept, "id" | "tick" | "rawText">; at?: Tick }
  | { type: "wait"; minutes: number };

export interface FacultyCall {
  faculty: FacultyName;
  request: unknown;
  response: unknown;
}

export interface Frame {
  index: number;
  input: Input;
  traces: Trace[];
  /** Mind state after this input. */
  state: MindState;
  /** Length of the call log after this input, for truncation on rewind. */
  logEnd: number;
}

export class DivergenceError extends Error {}

const FACULTIES: FacultyName[] = ["perceive", "deliberate", "speak", "reconstruct", "dream", "architect"];

/** Wraps faculties so every call is appended to a log. */
export function recording(inner: Faculties, log: FacultyCall[]): Faculties {
  const out = {} as Record<FacultyName, (req: unknown) => Promise<unknown>>;
  for (const name of FACULTIES) {
    out[name] = async (request: unknown) => {
      const response = await (inner[name] as (r: unknown) => Promise<unknown>)(request);
      log.push({ faculty: name, request: structuredClone(request), response: structuredClone(response) });
      return response;
    };
  }
  return out as unknown as Faculties;
}

/**
 * Serves recorded responses in order. If the mind asks for something different (because a
 * mechanism or seed changed), the history has diverged: either fail, or hand over to `live`.
 */
export function replaying(log: FacultyCall[], live?: Faculties): { faculties: Faculties; diverged: () => number | undefined } {
  let cursor = 0;
  let divergedAt: number | undefined;
  const out = {} as Record<FacultyName, (req: unknown) => Promise<unknown>>;
  for (const name of FACULTIES) {
    out[name] = async (request: unknown) => {
      const rec = log[cursor];
      if (divergedAt === undefined && rec && rec.faculty === name && JSON.stringify(rec.request) === JSON.stringify(request)) {
        cursor++;
        return structuredClone(rec.response);
      }
      if (divergedAt === undefined) divergedAt = cursor;
      if (!live) throw new DivergenceError(`Replay diverged at call ${cursor} (${name})`);
      return (live[name] as (r: unknown) => Promise<unknown>)(request);
    };
  }
  return { faculties: out as unknown as Faculties, diverged: () => divergedAt };
}

export class Session {
  readonly initial: MindState;
  mind: MindState;
  inputs: Input[] = [];
  frames: Frame[] = [];
  log: FacultyCall[] = [];
  private faculties: Faculties;

  constructor(initial: MindState, faculties: Faculties) {
    this.initial = structuredClone(initial);
    this.mind = structuredClone(initial);
    this.faculties = faculties;
  }

  setFaculties(f: Faculties): void {
    this.faculties = f;
  }

  async apply(input: Input): Promise<Frame> {
    const f = recording(this.faculties, this.log);
    const traces = await step(this.mind, input, f);
    const frame: Frame = { index: this.frames.length, input, traces, state: structuredClone(this.mind), logEnd: this.log.length };
    this.inputs.push(input);
    this.frames.push(frame);
    return frame;
  }

  /** Keep inputs 0..index (inclusive); -1 returns to the initial state. */
  rewind(index: number): void {
    this.inputs = this.inputs.slice(0, index + 1);
    this.frames = this.frames.slice(0, index + 1);
    const last = this.frames[index];
    this.log = this.log.slice(0, last ? last.logEnd : 0);
    this.mind = structuredClone(last ? last.state : this.initial);
  }

  /**
   * Rebuild a session from its seed, inputs and call log. With `live`, calls after a divergence
   * go to the live faculties (used when re-running a history with different mechanisms).
   */
  static async replay(initial: MindState, inputs: Input[], log: FacultyCall[], live?: Faculties): Promise<{ session: Session; divergedAt?: number }> {
    const r = replaying(log, live);
    const s = new Session(initial, r.faculties);
    for (const input of inputs) await s.apply(input);
    if (live) s.setFaculties(live);
    return { session: s, divergedAt: r.diverged() };
  }
}

export async function step(mind: MindState, input: Input, faculties: Faculties): Promise<Trace[]> {
  const traces: Trace[] = [];
  if (input.type === "wait") {
    traces.push(...(await wait(mind, input.minutes, faculties)));
    return traces;
  }
  if (input.at !== undefined && input.at > mind.tick) traces.push(...(await wait(mind, input.at - mind.tick, faculties)));
  let percept: Percept;
  if (input.type === "say") {
    percept = await perceiveText(mind, input.from, input.text, faculties);
  } else if (input.percept) {
    percept = { ...input.percept, id: `pc_${mind.idCounter + 1}`, tick: mind.tick, rawText: input.text };
    mind.idCounter += 1;
  } else {
    percept = await perceiveText(mind, input.actor ?? "world", input.text, faculties);
  }
  traces.push(await runPercept(mind, percept, faculties));
  mind.tick += 5;
  return traces;
}
