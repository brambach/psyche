// Keeps the causal history for the running world: reads each live town's ledger into it before the
// session lets old traces go, saves it beside the world, and answers the explorer's questions.
//
// The world's own save holds the present. This holds the past: it lives in data/history, one file for
// the running world and one beside each named slot.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildBrief,
  CausalHistory,
  find,
  longestThread,
  MOMENT_KINDS,
  origins,
  reach,
  strongestThread,
  trail,
  yearMinutes,
  type AgentId,
  type Calendar,
  type Historian,
  type HistorianReply,
  type BriefNode,
  type HistoryNode,
  type HistorySource,
  type LedgerNode,
  type Mark,
  type Moment,
  type MomentKind,
  type PersonRecord,
  type SavedHistory,
  type ThreadStep,
  type Tick,
  type Weight,
  type WhyTree,
  type WorldSession,
} from "@psyche/engine";

/** Which world a saved history belongs to. */
export interface HistoryOwner {
  scenario: string;
  seed: number;
}

interface HistoryFile extends HistoryOwner {
  history: SavedHistory;
}

/** One live town, as the keeper reads it. */
export interface LiveTown extends Omit<HistorySource, "world" | "traces" | "fresh"> {
  session: WorldSession;
  townName?: string;
}

export interface HistoryOverview {
  calendar: Calendar;
  /** Minutes in a year, where there are years. */
  year?: number;
  from: Tick;
  to: Tick;
  size: CausalHistory["size"];
  kinds: typeof MOMENT_KINDS;
  towns: { id: string; name: string }[];
  people: (PersonRecord & { choices: number })[];
  /** Every kept choice, oldest first: id, tick, agent, kind, what they chose, weight, town. */
  moments: [string, Tick, AgentId, MomentKind, string, number, string | 0][];
  marks: Mark[];
  /** What weighs on people: core beliefs and dark beliefs, with how many later choices each has shaped. */
  weights: (Weight & { shaped: number; minds: number; since?: Tick | null })[];
  historian: { method: "claude" | "offline"; model?: string };
}

export interface HistoryWhy {
  node: HistoryNode;
  moment?: Moment;
  weight?: Weight;
  tree: WhyTree;
  strongest: ThreadStep[];
  longest: ThreadStep[];
  origins: { causes: number; roots: LedgerNode[]; minds: AgentId[]; earliest?: Tick };
  reach: { total: number; direct: number; minds: { agent: AgentId; choices: number }[]; byYear: { year: number; choices: number }[]; first?: Tick; last?: Tick; choices: { node: LedgerNode; share: number; steps: number }[] };
  /** Nodes whose moment the watched town's session still holds, so its brain scan can be opened. */
  held: string[];
}

export interface HistoryAnswer extends HistorianReply {
  question: string;
  nodes: BriefNode[];
  focus: string[];
  /** Roughly how many tokens the reader was given. */
  briefTokens: number;
}

/** New traces a town may pile up before its ledger is read again. Must stay well under what a session keeps. */
const READ_EVERY = 800;
/** A big history is not rewritten more often than this unless asked. */
const SAVE_EVERY_MS = 180_000;

export class HistoryKeeper {
  history = new CausalHistory();
  private read = new WeakMap<WorldSession, number>();
  private dirty = false;
  private savedAt = 0;
  private reachCache: { readings: number; by: Map<string, { shaped: number; minds: number }> } = { readings: -1, by: new Map() };
  private townNames = new Map<string, string>();

  constructor(
    private readonly dir: string | undefined,
    private readonly historian: Historian,
    private readonly describe: () => { method: "claude" | "offline"; model?: string },
  ) {}

  private file(slot?: string): string | undefined {
    return this.dir ? join(this.dir, slot ? `slot-${slot}.json` : "current.json") : undefined;
  }

  /** Read a town's live ledger if enough has happened since the last reading (or now, when `force`). */
  keep(town: LiveTown, force = false): void {
    const { session, townName, ...rest } = town;
    const total = session.traceBase + session.traces.length;
    const fresh = total - (this.read.get(session) ?? 0);
    if (rest.town && townName) this.townNames.set(rest.town, townName);
    if (fresh <= 0 || (!force && fresh < READ_EVERY)) return;
    const r = this.history.absorb({ ...rest, world: session.world, traces: session.traces, fresh });
    this.read.set(session, total);
    if (r.moments || r.nodes || r.edges) this.dirty = true;
  }

  /** The world was wound back: forget what came after, and read on from there. */
  rewound(session: WorldSession): void {
    this.history.truncate(session.world.tick);
    this.read.set(session, session.traceBase + session.traces.length);
    this.dirty = true;
  }

  /** Everything this session holds has been read already (it was rebuilt by replaying a save). */
  caughtUp(session: WorldSession): void {
    if (this.history.readings) this.read.set(session, session.traceBase + session.traces.length);
  }

  reset(): void {
    this.history = new CausalHistory();
    this.read = new WeakMap();
    this.townNames.clear();
    this.dirty = true;
  }

  save(owner: HistoryOwner, force = false): void {
    const file = this.file();
    if (!file || !this.dirty || (!force && Date.now() - this.savedAt < SAVE_EVERY_MS)) return;
    this.savedAt = Date.now();
    this.dirty = false;
    mkdirSync(dirname(file), { recursive: true });
    const data: HistoryFile = { ...owner, history: this.history.toJSON() };
    writeFileSync(`${file}.tmp`, JSON.stringify(data));
    renameSync(`${file}.tmp`, file);
  }

  /** Load the history of the running world (or of a slot), if it belongs to this world. Otherwise start empty. */
  load(owner: HistoryOwner, now: Tick, slot?: string): void {
    this.reset();
    const file = this.file(slot);
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as HistoryFile;
      if (saved.scenario !== owner.scenario || saved.seed !== owner.seed || saved.history?.version !== 1) return;
      this.history = CausalHistory.fromJSON(saved.history);
      // A history that runs past the world it was saved with (a crash between the two writes) is cut back to it.
      if (this.history.to > now) this.history.truncate(now);
      for (const p of Object.values(this.history.people)) if (p.town && !this.townNames.has(p.town)) this.townNames.set(p.town, p.town);
    } catch (e) {
      console.error("Could not read the saved history; starting it afresh.", e);
    }
  }

  /** Keep a copy of the history beside a named slot. */
  saveSlot(owner: HistoryOwner, slot: string): void {
    this.save(owner, true);
    const from = this.file();
    const to = this.file(slot);
    if (from && to && existsSync(from)) copyFileSync(from, to);
  }

  deleteSlot(slot: string): void {
    const file = this.file(slot);
    if (file && existsSync(file)) unlinkSync(file);
  }

  // -------------------------------------------------------------- views

  private shapedBy(id: string): { shaped: number; minds: number } {
    const H = this.history;
    if (this.reachCache.readings !== H.readings) this.reachCache = { readings: H.readings, by: new Map() };
    let v = this.reachCache.by.get(id);
    if (!v) {
      const r = reach(H, H.calendar, id);
      v = { shaped: r?.choices.length ?? 0, minds: r?.minds.length ?? 0 };
      this.reachCache.by.set(id, v);
    }
    return v;
  }

  overview(): HistoryOverview {
    const H = this.history;
    const choices = new Map<AgentId, number>();
    for (const m of H.moments) choices.set(m.agent, (choices.get(m.agent) ?? 0) + 1);
    const towns = new Map(this.townNames);
    for (const p of Object.values(H.people)) if (p.town && !towns.has(p.town)) towns.set(p.town, p.town);
    return {
      calendar: H.calendar,
      year: yearMinutes(H.calendar),
      from: Math.min(0, H.moments[0]?.tick ?? 0, H.marks[0]?.tick ?? 0),
      to: H.to,
      size: H.size,
      kinds: MOMENT_KINDS,
      towns: [...towns.entries()].map(([id, name]) => ({ id, name })),
      people: Object.values(H.people).map((p) => ({ ...p, choices: choices.get(p.id) ?? 0 })),
      moments: H.moments.map((m) => [m.id, m.tick, m.agent, m.kind, m.choice, m.weight, m.town ?? 0]),
      marks: H.marks,
      weights: [...H.weights.values()]
        .map((c) => {
          const t = H.nodes.get(c.id)?.tick;
          return { ...c, ...this.shapedBy(c.id), since: t !== undefined && Number.isFinite(t) ? t : null };
        })
        .sort((a, b) => b.shaped - a.shaped || b.strength - a.strength),
      historian: this.describe(),
    };
  }

  why(id: string, watched?: WorldSession): HistoryWhy | undefined {
    const H = this.history;
    const node = H.nodes.get(id);
    const tree = node && trail(H, id);
    if (!node || !tree) return undefined;
    const o = origins(H, id)!;
    const r = reach(H, H.calendar, id)!;
    const live = new Set((watched?.traces ?? []).map((t) => `${t.agent}/${t.trace.id}`));
    const held: string[] = [];
    const walk = (t: WhyTree) => {
      if (t.node.agent && t.node.trace && live.has(`${t.node.agent}/${t.node.trace}`)) held.push(t.node.id);
      t.causes.forEach(walk);
    };
    walk(tree);
    for (const c of r.choices.slice(0, 40)) if (c.node.agent && c.node.trace && live.has(`${c.node.agent}/${c.node.trace}`)) held.push(c.node.id);
    return {
      node,
      moment: H.moment(id),
      weight: H.weights.get(id),
      tree,
      strongest: strongestThread(tree),
      longest: longestThread(tree),
      origins: { causes: o.ancestors.length, roots: o.roots.slice(0, 8), minds: o.minds, earliest: o.earliest },
      reach: { total: r.choices.length, direct: r.direct, minds: r.minds, byYear: r.byYear, first: r.first, last: r.last, choices: r.choices.slice(0, 40) },
      held: [...new Set(held)],
    };
  }

  search(q: string, at?: Tick): { node: HistoryNode; moment?: Moment }[] {
    return find(this.history, q, { limit: 20, at }).map((f) => ({ node: f.node, moment: f.moment }));
  }

  async ask(question: string, focus?: string[], at?: Tick): Promise<HistoryAnswer> {
    const brief = buildBrief(this.history, question.slice(0, 600), { focus, at });
    const reply = await this.historian(brief);
    return { ...reply, question, nodes: brief.nodes, focus: brief.focus.map((f) => f.ref), briefTokens: Math.ceil(brief.text.length / 4) };
  }
}
