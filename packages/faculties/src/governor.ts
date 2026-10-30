// The budget governor. Every faculty call passes through here on its way to Claude or the mock.
// It routes each call to a model tier, renders low-salience speech from templates, keeps a ledger
// of tokens and dollars, and steps quality down as the day's spend nears the cap instead of
// stopping the world. With the mock it estimates what the same run would have cost on Claude.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Faculties, FacultyName, StableIdentity } from "@psyche/engine";
import { configuredModel, createClaudeCaller, promptChars, type CallUsage, type FacultyCaller } from "./claude.js";
import { createMockFaculties } from "./mock.js";
import { costOf, HAIKU } from "./pricing.js";

export type BudgetLevel = "normal" | "economy" | "thrifty" | "offline";

/** Fractions of the daily cap where each level starts (docs/civilization-plan.md, section 2.5). */
export const LEVELS: { level: BudgetLevel; from: number; means: string }[] = [
  { level: "normal", from: 0, means: "Every faculty on its own tier." },
  { level: "economy", from: 0.8, means: "Sonnet calls drop to Haiku." },
  { level: "thrifty", from: 0.9, means: "Only the most salient lines are spoken by the model." },
  { level: "offline", from: 1, means: "The day's cap is spent: everything runs on the offline mock until tomorrow." },
];

export interface GovernorOptions {
  mode: "claude" | "mock";
  /** Builds the Claude caller; the governor hands it the usage callback. */
  caller?: (onUsage: (u: CallUsage) => void) => FacultyCaller;
  models?: Partial<Record<FacultyName, string>>;
  /** US dollars per UTC day. Default PSYCHE_DAILY_CAP, else 10. */
  dailyCapUsd?: number;
  /** Speech below this salience is rendered from templates unless the speaker is in focus. */
  speechThreshold?: number;
  /** Where the day's real spend is kept across restarts; null keeps it in memory only. */
  spendFile?: string | null;
  now?: () => Date;
}

export interface FacultyStats {
  calls: number;
  templated: number;
  usd: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface MeterSnapshot {
  mode: "claude" | "mock";
  /** True when dollars are estimates of what Claude would have cost (mock mode). */
  estimated: boolean;
  level: BudgetLevel;
  levelMeans: string;
  capUsd: number;
  /** Real spend today (UTC) across every run on this machine. */
  todayUsd: number;
  /** Spend, or estimated spend, since this process started or the meter was reset. */
  sessionUsd: number;
  calls: number;
  templated: number;
  cacheHitRate: number;
  byFaculty: Partial<Record<FacultyName, FacultyStats>>;
  byModel: Record<string, { calls: number; usd: number }>;
}

const FACULTIES: FacultyName[] = ["perceive", "deliberate", "speak", "reconstruct", "dream", "architect"];

/** Thinking tokens a call tends to spend, for estimates. Adaptive thinking at low effort is often zero. */
const THINKING: Record<FacultyName, number> = { perceive: 0, speak: 0, reconstruct: 0, dream: 200, deliberate: 400, architect: 600 };

const tokens = (chars: number) => Math.ceil(chars / 4);
const day = (d: Date) => d.toISOString().slice(0, 10);
const blank = (): FacultyStats => ({ calls: 0, templated: 0, usd: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });

export class Governor {
  readonly faculties: Faculties;
  readonly mode: "claude" | "mock";
  /** Agents the user is watching. Their speech always goes to the model. */
  readonly focus = new Set<string>();
  /**
   * The world's named characters, always in the focus tier (L0) with the watched agents. When this
   * is non-empty everyone else is L1 (docs/civilization-plan.md, section 2.3): Haiku only, and only
   * their more salient lines are spoken by the model. Empty means everyone is L0.
   */
  readonly core = new Set<string>();
  capUsd: number;
  speechThreshold: number;
  private readonly mock = createMockFaculties();
  private readonly spendFile: string | null;
  private readonly now: () => Date;
  private spend: Record<string, number> = {};
  private stats: Partial<Record<FacultyName, FacultyStats>> = {};
  private models: Record<string, { calls: number; usd: number }> = {};

  constructor(opts: GovernorOptions) {
    this.mode = opts.mode;
    this.capUsd = opts.dailyCapUsd ?? (Number(process.env.PSYCHE_DAILY_CAP) || 10);
    this.speechThreshold = opts.speechThreshold ?? 0.35;
    this.spendFile = opts.spendFile === undefined ? null : opts.spendFile;
    this.now = opts.now ?? (() => new Date());
    if (this.spendFile && existsSync(this.spendFile)) {
      try {
        this.spend = JSON.parse(readFileSync(this.spendFile, "utf8")).days ?? {};
      } catch {
        this.spend = {};
      }
    }
    const caller = this.mode === "claude" ? (opts.caller ?? ((onUsage) => createClaudeCaller({ onUsage })))((u) => this.record(u)) : undefined;
    const out = {} as Record<FacultyName, (req: unknown) => Promise<unknown>>;
    for (const f of FACULTIES) out[f] = (req) => this.route(f, req, caller, opts.models);
    this.faculties = out as unknown as Faculties;
  }

  todayUsd(): number {
    return this.spend[day(this.now())] ?? 0;
  }

  level(): BudgetLevel {
    if (this.mode === "mock") return "normal";
    const used = this.todayUsd() / this.capUsd;
    let level: BudgetLevel = "normal";
    for (const l of LEVELS) if (used >= l.from) level = l.level;
    return level;
  }

  /** L0 (focus) or L1 (active, cheaper) for an agent id. */
  tierOf(id: string | undefined): "L0" | "L1" {
    if (!id || this.core.size === 0) return "L0";
    return this.focus.has(id) || this.core.has(id) ? "L0" : "L1";
  }

  private async route(f: FacultyName, req: unknown, caller: FacultyCaller | undefined, models?: Partial<Record<FacultyName, string>>): Promise<unknown> {
    const level = this.level();
    const mockCall = () => (this.mock[f] as (r: unknown) => Promise<unknown>)(req);
    const self = (req as { self?: StableIdentity }).self;
    const tier = this.tierOf(self?.id);
    if (f === "speak") {
      const r = req as { salience?: number; self: StableIdentity };
      const threshold = Math.max(level === "thrifty" ? 0.7 : this.speechThreshold, tier === "L1" ? 0.5 : 0);
      const focused = !!r.self.id && this.focus.has(r.self.id);
      if (!focused && (r.salience ?? 1) < threshold) {
        this.bucket(f).templated++;
        return mockCall();
      }
    }
    const model = level === "economy" || level === "thrifty" || (tier === "L1" && f !== "architect") ? HAIKU : configuredModel(f, models);
    if (level === "offline" || !caller) {
      const res = await mockCall();
      if (this.mode === "mock") this.estimate(f, model, req, res);
      return res;
    }
    return (caller as (f: FacultyName, r: unknown, m: string) => Promise<unknown>)(f, req, model);
  }

  private bucket(f: FacultyName): FacultyStats {
    return (this.stats[f] ??= blank());
  }

  /** Account for one real call. */
  record(u: CallUsage): void {
    const usd = costOf(u.model, u);
    this.add(u.faculty, u.model, u, usd);
    const today = day(this.now());
    this.spend[today] = (this.spend[today] ?? 0) + usd;
    if (this.spendFile) {
      mkdirSync(dirname(this.spendFile), { recursive: true });
      writeFileSync(this.spendFile, JSON.stringify({ days: this.spend }, null, 1));
      appendFileSync(this.spendFile.replace(/\.json$/, ".log"), `${this.now().toISOString()} ${u.faculty} ${u.model} in=${u.input} cached=${u.cacheRead} write=${u.cacheWrite} out=${u.output} $${usd.toFixed(5)}\n`);
    }
  }

  /** What a mock call would have cost on Claude: characters over four, system prompt uncached, plus typical thinking. */
  private estimate(f: FacultyName, model: string, req: unknown, res: unknown): void {
    const identity = (req as { self?: StableIdentity }).self;
    const t = {
      input: tokens(promptChars(f, identity) + JSON.stringify(req).length),
      cacheRead: 0,
      cacheWrite: 0,
      output: tokens(JSON.stringify(res).length) + (model === HAIKU ? Math.round(THINKING[f] / 2) : THINKING[f]),
    };
    this.add(f, model, t, costOf(model, t));
  }

  private add(f: FacultyName, model: string, t: { input: number; cacheRead: number; cacheWrite: number; output: number }, usd: number): void {
    const b = this.bucket(f);
    b.calls++;
    b.usd += usd;
    b.input += t.input;
    b.cacheRead += t.cacheRead;
    b.cacheWrite += t.cacheWrite;
    b.output += t.output;
    const m = (this.models[model] ??= { calls: 0, usd: 0 });
    m.calls++;
    m.usd += usd;
  }

  resetSession(): void {
    this.stats = {};
    this.models = {};
  }

  snapshot(): MeterSnapshot {
    const all = Object.values(this.stats);
    const sum = (k: keyof FacultyStats) => all.reduce((s, x) => s + x[k], 0);
    const level = this.level();
    const read = sum("cacheRead");
    const fresh = sum("input") + sum("cacheWrite");
    return {
      mode: this.mode,
      estimated: this.mode === "mock",
      level,
      levelMeans: LEVELS.find((l) => l.level === level)!.means,
      capUsd: this.capUsd,
      todayUsd: this.todayUsd(),
      sessionUsd: sum("usd"),
      calls: sum("calls"),
      templated: sum("templated"),
      cacheHitRate: read + fresh > 0 ? read / (read + fresh) : 0,
      byFaculty: structuredClone(this.stats),
      byModel: structuredClone(this.models),
    };
  }
}

/** One line for terminals: "$0.0123 (est.) · 41 calls, 12 templated · normal". */
export function meterLine(s: MeterSnapshot, simDays?: number): string {
  const usd = (x: number) => `$${x < 0.1 ? x.toFixed(4) : x.toFixed(2)}`;
  const parts = [`${usd(s.sessionUsd)}${s.estimated ? " estimated on Claude (running on the offline mock)" : ""}`];
  if (simDays && simDays > 0) parts.push(`${usd(s.sessionUsd / simDays)} per sim day`);
  parts.push(`${s.calls} model calls, ${s.templated} lines from templates`);
  if (!s.estimated) parts.push(`today ${usd(s.todayUsd)} of ${usd(s.capUsd)} cap (${s.level})`, `cache hits ${(s.cacheHitRate * 100).toFixed(0)}%`);
  return parts.join(" · ");
}

export function breakdown(s: MeterSnapshot): string {
  return Object.entries(s.byFaculty)
    .map(([f, b]) => `  ${f.padEnd(12)} ${String(b!.calls).padStart(5)} calls ${b!.templated ? `(+${b!.templated} templated) ` : ""}$${b!.usd.toFixed(4)}`)
    .join("\n");
}
