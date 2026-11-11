// The Historian: answering questions over the causal history.
//
// A question ("why did Ula refuse Corran in year 14?", "where did Hollow Bay's fear of hunger come
// from?") is answered in two steps. First the engine finds what the question is about and cuts the
// relevant piece out of the history: the choice or fear, the trail behind it walked back in time,
// where it started, what it went on to shape, and who the people were. That piece is the brief, and
// every line in it has a tag like [n4]. Then a reader writes the answer from the brief alone, citing
// tags, so every claim can be clicked back to the record.
//
// The reader is Claude Opus when it is connected (packages/faculties/src/historian.ts). The offline
// reader here is free and deterministic: it reads the same brief straight, strongest links first.

import { agoText, find, longestThread, origins, reach, strongestThread, trail, whenText, type CausalHistory, type HistoryNode } from "./history.js";
import type { LedgerNode, Mechanism, NodeKind, WhyTree } from "./ledger.js";
import type { AgentId, Tick } from "./types.js";

export interface BriefNode {
  /** The tag the answer cites: "n1", "n2". */
  ref: string;
  id: string;
  kind: NodeKind;
  agent?: AgentId;
  who?: string;
  town?: string;
  tick: Tick | null;
  when: string;
  label: string;
}

export interface BriefLink {
  cause: string;
  effect: string;
  how: Mechanism;
  /** How much of the focus this link accounts for along its path, 0 to 1. */
  share: number;
  ago: string;
}

export interface BriefFocus {
  ref: string;
  /** For a choice: what the engine recorded about it when it was made. */
  moment?: { question: string; answer: string; choice: string; over: { label: string; gap: number }[]; thought: boolean; said?: string };
  /** Tags, oldest cause first, ending at the focus. */
  strongest: string[];
  longest: string[];
  /** How each step on the longest thread led to the next. */
  longestHow: (Mechanism | undefined)[];
  /** How long before the subject the oldest dated step on that thread is: "31 years". */
  span?: string;
  roots: string[];
  missed: string[];
  upstream: { causes: number; minds: string[]; earliest?: string };
  downstream: { choices: number; direct: number; minds: { name: string; choices: number }[]; byYear: { year: number; choices: number }[]; examples: string[] };
}

export interface Brief {
  question: string;
  now: string;
  nodes: BriefNode[];
  links: BriefLink[];
  focus: BriefFocus[];
  /** Other things in the record whose words match the question, without their trails. */
  also: string[];
  people: { name: string; line: string }[];
  /** The brief as the reader gets it. */
  text: string;
}

export interface HistorianAnswer {
  /** Plain prose with [n1]-style tags after the claims they support. */
  answer: string;
  /** Tags the answer leans on. */
  cites: string[];
  /** What the record cannot say, if anything. */
  gaps?: string;
}

export interface HistorianReply extends HistorianAnswer {
  method: "claude" | "offline";
  model?: string;
  /** What the call cost, or would cost on Claude when it ran offline. */
  usd?: number;
  estimated?: boolean;
}

/** Reads a brief and answers its question. */
export type Historian = (brief: Brief) => Promise<HistorianReply>;

const KIND_WORD: Record<NodeKind, string> = {
  event: "event",
  conversation: "conversation",
  percept: "moment",
  episode: "memory",
  belief: "belief",
  schema: "core belief",
  emotion: "feeling",
  relation: "trust",
  goal: "goal",
  need: "need",
  decision: "choice",
  utterance: "said",
  act: "did",
  sleep: "sleep",
  outside: "from outside",
  norm: "norm",
  edit: "the player's change",
  upbringing: "upbringing",
};

export interface BriefOptions {
  /** Ledger nodes to build the brief around. Default: whatever the question's words find. */
  focus?: string[];
  /** The moment the asker is looking at, to break ties between matches. */
  at?: Tick;
  /** How many things to walk back from when the question does not name one. */
  subjects?: number;
}

/** Cut the piece of the history a question is about. */
export function buildBrief(H: CausalHistory, question: string, opts: BriefOptions = {}): Brief {
  const cal = H.calendar;
  const nodes: BriefNode[] = [];
  const refs = new Map<string, string>();
  const nameOf = (a?: AgentId) => (a ? (H.people[a]?.name ?? a) : undefined);
  const ref = (n: LedgerNode): string => {
    let r = refs.get(n.id);
    if (!r) {
      r = `n${nodes.length + 1}`;
      refs.set(n.id, r);
      const town = (n as HistoryNode).town;
      nodes.push({ ref: r, id: n.id, kind: n.kind, agent: n.agent, who: nameOf(n.agent), town, tick: Number.isFinite(n.tick) ? n.tick : null, when: whenText(cal, n.tick), label: n.label.replace(/^(Core belief|Goal|Norm): /, "") });
    }
    return r;
  };

  const found = find(H, question, { limit: 10, at: opts.at });
  const given = (opts.focus ?? []).filter((id) => H.nodes.has(id));
  const subjects = given.length ? given : found.slice(0, opts.subjects ?? 2).map((f) => f.node.id);

  const links: BriefLink[] = [];
  const linked = new Set<string>();
  const focus: BriefFocus[] = [];
  for (const id of subjects) {
    const root = H.nodes.get(id)!;
    const tree = trail(H, id, { max: 36, breadth: 3 });
    if (!tree) continue;
    const r = ref(root);
    const end = Number.isFinite(root.tick) ? root.tick : H.to;
    const walk = (t: WhyTree) => {
      for (const c of t.causes) {
        const k = `${c.node.id}>${t.node.id}>${c.via!.mechanism}`;
        if (!linked.has(k)) {
          linked.add(k);
          links.push({ cause: ref(c.node), effect: ref(t.node), how: c.via!.mechanism, share: Number(c.share.toFixed(2)), ago: agoText(cal, c.node.tick, Number.isFinite(t.node.tick) ? t.node.tick : end) });
        }
        walk(c);
      }
    };
    walk(tree);
    const strongest = strongestThread(tree);
    const longest = longestThread(tree);
    const o = origins(H, id)!;
    const d = reach(H, cal, id)!;
    const m = H.moment(id);
    const oldest = Math.min(...longest.map((s) => (Number.isFinite(s.node.tick) ? s.node.tick : Infinity)));
    const span = Number.isFinite(oldest) && end - oldest >= 1 ? agoText(cal, oldest, end).replace(/ earlier$/, "") : undefined;
    focus.push({
      ref: r,
      moment: m ? { question: m.question, answer: m.answer, choice: m.choice, over: m.over, thought: m.thought, said: m.said } : undefined,
      strongest: strongest.map((s) => ref(s.node)),
      longest: longest.map((s) => ref(s.node)),
      longestHow: longest.map((s) => s.mechanism),
      span,
      roots: o.roots.slice(0, 5).map(ref),
      missed: (tree.missed ?? []).map((n) => n.label),
      upstream: { causes: o.ancestors.length, minds: o.minds.map((a) => nameOf(a)!), earliest: o.earliest !== undefined ? whenText(cal, o.earliest) : undefined },
      downstream: {
        choices: d.choices.length,
        direct: d.direct,
        minds: d.minds.slice(0, 6).map((x) => ({ name: nameOf(x.agent)!, choices: x.choices })),
        byYear: d.byYear,
        examples: d.choices.slice(0, 5).map((c) => ref(c.node)),
      },
    });
  }

  const also = found.filter((f) => !subjects.includes(f.node.id)).slice(0, 6).map((f) => ref(f.node));

  const involved = [...new Set(nodes.map((n) => n.agent).filter((a): a is AgentId => !!a))];
  const people = involved.slice(0, 14).map((a) => {
    const p = H.people[a];
    if (!p) return { name: a, line: a };
    const born = p.born !== undefined ? `born ${whenText(cal, p.born)}` : undefined;
    const died = p.died !== undefined ? `died ${whenText(cal, p.died)}${p.cause ? ` of ${p.cause}` : ""}` : undefined;
    const parents = p.parents.length ? `child of ${p.parents.map((x) => nameOf(x)).join(" and ")}` : undefined;
    return { name: p.name, line: [p.role, p.town ? `of ${p.town}` : undefined, born, died, parents].filter(Boolean).join(", ") };
  });

  const b: Brief = { question, now: whenText(cal, H.to), nodes, links, focus, also, people, text: "" };
  b.text = renderBrief(b);
  return b;
}

/** The brief as plain text: what the reader sees, and all it sees. */
export function renderBrief(b: Brief): string {
  const node = new Map(b.nodes.map((n) => [n.ref, n]));
  const line = (n: BriefNode) => `[${n.ref}] ${KIND_WORD[n.kind]}${n.who ? ` · ${n.who}` : ""}${n.town ? ` (${n.town})` : ""} · ${n.when} · ${n.label}`;
  const out: string[] = [`QUESTION: ${b.question}`, `THE RECORD RUNS TO: ${b.now}`, ""];
  if (!b.focus.length) out.push("Nothing in the record matches this question.", "");
  if (b.people.length) out.push("PEOPLE", ...b.people.map((p) => `- ${p.name}: ${p.line}`), "");
  out.push("RECORD (one line per thing in the causal record; cite by tag)", ...b.nodes.map(line), "");
  if (b.links.length) out.push("LINKS (cause -> effect: how; share of the subject it accounts for along that path; how long before)", ...b.links.map((l) => `[${l.cause}] -> [${l.effect}]: ${l.how}; ${Math.round(l.share * 100)}%; ${l.ago}`), "");
  for (const f of b.focus) {
    out.push(`SUBJECT [${f.ref}] ${node.get(f.ref)!.label}`);
    if (f.moment) {
      out.push(`- The engine's note at the time: ${f.moment.question} ${f.moment.answer}`);
      if (f.moment.over.length) out.push(`- Turned down: ${f.moment.over.map((o) => `${o.label} (${o.gap.toFixed(2)} behind)`).join(", ")}`);
      out.push(`- ${f.moment.thought ? "Thought it through (System 2)." : "Went with the first pull (System 1)."}${f.moment.said ? ` Came out as: ${f.moment.said}` : ""}`);
    }
    out.push(`- Strongest thread, oldest first: ${f.strongest.map((r) => `[${r}]`).join(" -> ")}`);
    if (f.longest.join() !== f.strongest.join()) out.push(`- Thread reaching furthest back${f.span ? ` (${f.span})` : ""}: ${f.longest.map((r) => `[${r}]`).join(" -> ")}`);
    if (f.roots.length) out.push(`- Where it started (nothing recorded behind these): ${f.roots.map((r) => `[${r}]`).join(", ")}`);
    if (f.missed.length) out.push(`- Competed for attention and did not come to mind: ${f.missed.map((m) => `"${m}"`).join("; ")}`);
    out.push(`- Upstream in all: ${f.upstream.causes} causes${f.upstream.minds.length ? `, passing through the minds of ${f.upstream.minds.join(", ")}` : ""}${f.upstream.earliest ? `; the earliest is from ${f.upstream.earliest}` : ""}.`);
    const d = f.downstream;
    out.push(d.choices ? `- Downstream: it went on to shape ${d.choices} later choices (${d.direct} with it directly in mind): ${d.minds.map((m) => `${m.name} ${m.choices}`).join(", ")}. By year: ${d.byYear.map((y) => `y${y.year}: ${y.choices}`).join(", ")}. For example ${d.examples.map((r) => `[${r}]`).join(", ")}.` : "- Downstream: no later choice traces back to it yet.");
    out.push("");
  }
  if (b.also.length) out.push(`ALSO MATCHING THE QUESTION (not walked back): ${b.also.map((r) => `[${r}]`).join(", ")}`);
  return out.join("\n");
}

// ---------------------------------------------------------------- the offline reader

/** How a cause led to its effect, as the middle of a sentence: "<cause> ... <effect>". */
const LED: Record<Mechanism, string> = {
  perceived: "was lived as",
  heard: "was heard as",
  "appraised as": "stirred",
  "core belief": "coloured",
  "trust coloured blame": "coloured",
  "moved trust": "moved",
  "formed belief": "left behind",
  "heard again": "firmed up",
  "in mind": "was in mind for",
  "below awareness": "stayed below",
  "lingering feeling": "lingered into",
  said: "came out as",
  did: "came out as",
  "generalized from": "was generalized into",
  "told by": "was told on, and became",
  "passed on": "was passed on as",
  "rewrote memory": "rewrote",
  "installed by": "installed",
  "deepened by": "deepened",
  sanctioned: "hardened into",
  expected: "weighed on",
  "bent by": "bent",
  "you changed": "(a change you made) set",
  "handed down": "was handed down as",
  "meant to": "leaned on",
  "in their own words": "(their own writing) set",
  "raised to": "weighed on",
  "raised by": "shaped",
};

const unstop = (s: string) => s.replace(/[.\s]+$/, "");
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** A free, deterministic answer read straight off the brief: strongest links first, nothing inferred. */
export function offlineHistorian(b: Brief): HistorianAnswer {
  if (!b.focus.length) {
    return { answer: "Nothing in the record matches that yet. Try naming a person, a choice or a fear, or pick a choice on the timeline and ask about it.", cites: [], gaps: "The question's words matched nothing the history has kept." };
  }
  const node = new Map(b.nodes.map((n) => [n.ref, n]));
  const cites = new Set<string>();
  const tag = (r: string) => {
    cites.add(r);
    return `[${r}]`;
  };
  const quote = (r: string) => {
    const n = node.get(r)!;
    const whose = n.who && n.kind !== "decision" && !n.label.startsWith(n.who) ? `${n.who}'s ${KIND_WORD[n.kind]}` : KIND_WORD[n.kind];
    return `${whose} “${unstop(n.label)}” (${n.when}) ${tag(r)}`;
  };
  const wantsOrigin = /come from|came from|origin|start|began|begin|root|first|inherit/i.test(b.question);
  const wantsReach = /shape|led to|lead to|drive|drove|since|effect|consequence|change|bent|went on/i.test(b.question);
  const parts: string[] = [];

  b.focus.forEach((f, i) => {
    const n = node.get(f.ref)!;
    const direct = b.links.filter((l) => l.effect === f.ref).sort((x, y) => y.share - x.share);
    const para: string[] = [];

    // What it is, and what was closest to it.
    let lead = `${i ? "Also: " : ""}${unstop(n.label)} (${n.when}) ${tag(f.ref)}.`;
    if (f.moment?.over.length) lead += ` The nearest alternative was “${f.moment.over[0]!.label}”, ${f.moment.over[0]!.gap <= 0.08 ? "a close call" : `${f.moment.over[0]!.gap.toFixed(2)} behind`}.`;
    para.push(lead);
    if (direct.length) {
      const top = direct.slice(0, 3).map((l) => `${quote(l.cause)}, ${l.how}, about ${Math.round(l.share * 100)}%`);
      para.push(`${n.kind === "decision" ? "What carried it" : "What is directly behind it"}: ${top.join("; ")}.`);
    }
    if (f.moment) para.push(`The engine's own note at the time: ${f.moment.answer}`);

    // The long thread, told forwards from where it started.
    const thread = f.longest.length > 2 ? f.longest : f.strongest;
    const origin: string[] = [];
    if (thread.length > 1) {
      origin.push(`It goes back ${f.span && thread === f.longest ? `${f.span}, ` : ""}to ${quote(thread[0]!)}.`);
      const how = f.longest.length > 2 ? f.longestHow : [];
      const steps: string[] = [];
      for (let k = 1; k < thread.length; k++) {
        const via = how[k - 1];
        const to = node.get(thread[k]!)!;
        steps.push(`${via ? LED[via] : "led to"} ${to.who && to.agent !== node.get(thread[k - 1]!)!.agent ? `${to.who}'s ` : ""}${KIND_WORD[to.kind]} “${unstop(to.label)}” ${tag(thread[k]!)}`);
      }
      if (steps.length) origin.push(`From there it ${steps.join(", which ")}.`);
    } else origin.push("Nothing is recorded behind it: as far as the history can see, this is where it starts.");
    if (f.upstream.causes > thread.length) origin.push(`In all ${f.upstream.causes} causes sit upstream${f.upstream.minds.length ? `, some of them in the heads of ${list(f.upstream.minds.slice(0, 4))}` : ""}${f.upstream.earliest ? `, the earliest from ${f.upstream.earliest}` : ""}.`);
    if (f.missed.length) origin.push(`What did not come to mind: ${f.missed.map((m) => `“${unstop(m)}”`).join(", ")}.`);

    // What it went on to do.
    const d = f.downstream;
    const after: string[] = [];
    if (d.choices) {
      const peak = [...d.byYear].sort((x, y) => y.choices - x.choices)[0]!;
      const years = d.byYear.length > 1 ? `, from year ${d.byYear[0]!.year} to year ${d.byYear[d.byYear.length - 1]!.year} (most in year ${peak.year})` : "";
      after.push(`Since then it has shaped ${d.choices} later ${d.choices === 1 ? "choice" : "choices"}${d.direct ? `, ${d.direct} with it directly in mind` : ""}${years}: ${list(d.minds.slice(0, 4).map((m) => `${m.name} (${m.choices})`))}. For example ${list(d.examples.slice(0, 3).map((r) => `“${unstop(node.get(r)!.label)}” ${tag(r)}`))}.`);
    } else if (wantsReach) after.push("No later choice in the record traces back to it yet.");

    const body = wantsReach && !wantsOrigin ? [...after, ...origin] : [...origin, ...after];
    parts.push([...para, ...body].join(" "));
  });

  if (b.also.length) parts.push(`Other things in the record that match: ${list(b.also.slice(0, 4).map((r) => `“${unstop(node.get(r)!.label)}” ${tag(r)}`))}.`);
  return { answer: parts.join("\n\n"), cites: [...cites], gaps: "Read offline: this follows the strongest recorded links and does not weigh them against each other. Shares are approximate." };
}

/** The offline reader as a Historian. */
export const offlineReader: Historian = async (brief) => ({ ...offlineHistorian(brief), method: "offline" });

/** Tags an answer actually uses, in order, checked against the brief (a reader may cite a tag that is not there). */
export function citedIn(answer: string, b: Brief): string[] {
  const have = new Set(b.nodes.map((n) => n.ref));
  const out: string[] = [];
  for (const m of answer.matchAll(/\[(n\d+)\]/g)) if (have.has(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  return out;
}
