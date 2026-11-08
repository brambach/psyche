// Conformity (Asch 1951, 1955, 1956).
//
// Which of three lines matches the standard? The answer is obvious. The volunteer sits second to
// last at a table of people who, on twelve of eighteen trials, all calmly give the same wrong answer
// out loud before it is their turn. Will they say what they see, or what everyone else said?
//
// The lab's forces: the unanimous majority (rising steeply from one to three people, then flat:
// Asch 1955), the evidence of their own eyes (clearer when the wrong line is further off), wanting to
// stay consistent with what they said on earlier trials, and, in variants, one ally who answers
// correctly or answers written down in private. Susceptibility comes from the mind: agreeableness,
// neuroticism, attachment anxiety, low self-esteem. Stares and a laugh after a dissent are appraised
// like any other slight, so the discomfort of standing out builds up in the engine itself.

import type { ActionOption, Faculties } from "../ports.js";
import type { Trace } from "../trace.js";
import type { MindState } from "../types.js";
import {
  ablate,
  clamp,
  correlates,
  explain,
  fresh,
  live,
  meet,
  momentOf,
  pass,
  pct,
  STANDARD_ABLATIONS,
  sweepPasts,
  type ConditionResult,
  type Edit,
  type ExperimentResult,
  type HumanResult,
  type Moment,
  type SituationText,
  type SubjectRun,
  type Volunteer,
} from "./core.js";

export interface AschCondition {
  id: string;
  label: string;
  description: string;
  /** How many people answer (wrongly) before the volunteer. 0: alone, the control. */
  majority: number;
  /** One other person answers correctly every time. */
  ally?: boolean;
  /** Answers are written down, not said out loud. */
  written?: boolean;
  human: HumanResult;
}

const A56 = "Asch (1956), Psychological Monographs 70(9)";
const A55 = "Asch (1955), Scientific American 193(5)";

export const ASCH_CONDITIONS: AschCondition[] = [
  { id: "alone", label: "Alone", description: "No group. The volunteer judges the lines by themselves.", majority: 0, human: { value: 0.007, text: "under 1% errors", source: A56, n: 37 } },
  { id: "one", label: "1 other", description: "One person answers wrongly first.", majority: 1, human: { value: 0.036, text: "3.6% of critical answers conformed", source: A55 } },
  { id: "two", label: "2 others", description: "Two people answer wrongly first.", majority: 2, human: { value: 0.136, text: "13.6%", source: A55 } },
  { id: "three", label: "3 others", description: "Three people answer wrongly first.", majority: 3, human: { value: 0.318, text: "31.8%", source: A55 } },
  { id: "standard", label: "7 others (standard)", description: "Asch's classic set-up: seven confederates answer wrongly, out loud, one by one.", majority: 7, human: { value: 0.368, text: "36.8% of critical answers conformed; 75% conformed at least once", source: A56, n: 123 } },
  { id: "fifteen", label: "15 others", description: "Fifteen people answer wrongly first.", majority: 15, human: { value: 0.312, text: "31.2%", source: A55 } },
  { id: "ally", label: "One ally", description: "Seven wrong, but one other person gives the right answer every time, before the volunteer.", majority: 7, ally: true, human: { value: 0.055, text: "5.5%", source: A56 } },
  { id: "written", label: "Written answers", description: "Seven wrong out loud, but the volunteer writes their answer down privately.", majority: 7, written: true, human: { value: 0.125, text: "about 12.5%", source: "Asch (1956); see also Deutsch & Gerard (1955)" } },
];

interface Trial {
  standard: number;
  lines: [number, number, number];
  correct: 1 | 2 | 3;
  /** The line the majority calls out, when it is a critical trial. */
  wrong?: 1 | 2 | 3;
}

// Asch's eighteen trials: two easy warm-ups, then twelve critical trials among the neutral ones.
const T = (standard: number, lines: [number, number, number], correct: 1 | 2 | 3, wrong?: 1 | 2 | 3): Trial => ({ standard, lines, correct, wrong });
const TRIALS: Trial[] = [
  T(10, [8.75, 10, 8], 2),
  T(2, [2, 1, 1.5], 1),
  T(3, [3.75, 4.25, 3], 3, 1),
  T(5, [5, 4, 6.5], 1, 2),
  T(4, [3, 5, 4], 3),
  T(3, [3.75, 4.25, 3], 3, 2),
  T(8, [6.25, 8, 6.75], 2, 3),
  T(5, [5, 4, 6.5], 1),
  T(8, [6.25, 8, 6.75], 2, 1),
  T(10, [8.75, 10, 8], 2, 3),
  T(2, [2, 1, 1.5], 1, 3),
  T(3, [3.75, 4.25, 3], 3, 1),
  T(5, [5, 4, 6.5], 1, 2),
  T(4, [3, 5, 4], 3),
  T(3, [3.75, 4.25, 3], 3, 2),
  T(8, [6.25, 8, 6.75], 2, 3),
  T(10, [8.75, 10, 8], 2, 1),
  T(2, [2, 1, 1.5], 1),
];

const VOICE: Record<string, string> = {
  "lab:majority": "everyone else saw it that way",
  "lab:evidence": "that's what I saw",
  "lab:ally": "someone else saw it the way I did",
  "lab:stares": "of the way they looked at me",
};

const SITUATION: SituationText = {
  "lab:majority": "Everyone before them said the same wrong line, calmly, out loud",
  "lab:evidence": "What their own eyes tell them",
  "lab:consistency": "Staying consistent with how they answered before",
  "lab:ally": "One other person said the right line",
  "lab:stares": "The looks and the laugh after their last dissent",
};

/** Asch's group-size curve: one person barely matters, three is nearly the full effect. */
function sizeEffect(n: number): number {
  if (n <= 0) return 0;
  return [0, 0.15, 0.5, 0.92, 0.97, 1, 1, 1][Math.min(n, 7)]! * (n > 10 ? 0.96 : 1);
}

/** How strongly a unanimous group pulls on this mind. */
export function susceptibility(m: MindState): number {
  const t = m.traits;
  return clamp(0.5 + 0.5 * (t.agreeableness - 0.5) + 0.6 * (t.neuroticism - 0.5) + 0.5 * (m.attachment.anxiety - 0.45) - 0.6 * (m.self.selfEsteem - 0.5) - 0.3 * (t.openness - 0.5), 0.1, 1.2);
}

const MAJORITY_WEIGHT = 0.55;
const EVIDENCE_WEIGHT = 1.0;

export async function runAschSubject(v: Volunteer, c: AschCondition, faculties: Faculties, opts: { edit?: Edit; pool?: Volunteer[]; explain?: boolean } = {}): Promise<SubjectRun> {
  const m = fresh(v, opts.edit);
  meet(m, "group", "the others at the table", 0.55, 0.55);
  const sus = susceptibility(m);
  const traces: Trace[] = [];
  const moments: Moment[] = [];
  const traceAt = new Map<Trace, string>();
  let conformed = 0;
  let streak: { choice: string; n: number } = { choice: "", n: 0 };
  let stared = false;
  let closest: Trace | undefined;
  let closestMargin = Infinity;
  let firstYield: Trace | undefined;

  for (let i = 0; i < TRIALS.length; i++) {
    const tr = TRIALS[i]!;
    const critical = !!tr.wrong && c.majority > 0;
    const said = critical ? tr.wrong! : tr.correct;
    const rel = critical ? Math.abs(tr.lines[tr.wrong! - 1]! - tr.standard) / tr.standard : 1;
    const clarity = clamp(rel * 2.5, 0.35, 1);
    const evidence = EVIDENCE_WEIGHT * clarity * (0.6 + 0.6 * m.self.selfEfficacy);
    const honest: ActionOption["situation"] = [{ name: "what my eyes tell me", value: evidence, ref: "lab:evidence" }];
    const yieldTo: ActionOption["situation"] = [];
    if (critical) {
      const pull = MAJORITY_WEIGHT * sizeEffect(c.majority) * sus * (c.ally ? 0.5 : 1) * (c.written ? 0.72 : 1);
      yieldTo.push({ name: `${c.majority === 1 ? "the other person" : `all ${c.majority} others`} said line ${said}`, value: pull, ref: "lab:majority" });
      if (c.ally) honest.push({ name: "one person said the right line too", value: 0.12, ref: "lab:ally" });
      if (streak.n > 0) {
        const f = { name: streak.choice === "honest" ? "I've held my ground so far" : "I've gone along before", value: 0.12 * Math.min(1, streak.n / 4) * (0.5 + m.traits.conscientiousness), ref: "lab:consistency" };
        (streak.choice === "honest" ? honest : yieldTo).push(f);
      }
    }
    const loud = !c.written;
    const options: ActionOption[] = critical
      ? [
          { id: "honest", label: `Say line ${tr.correct}`, verb: `say line ${tr.correct}, what they see`, description: `Give the answer their eyes give: line ${tr.correct}.`, prosocial: loud ? -0.05 : 0, assertive: loud ? 0.45 : 0.1, avoidant: 0, disclosure: 0.3, situation: honest, act: `says line ${tr.correct}` },
          { id: "conform", label: `Say line ${said}`, verb: `go along and say line ${said}`, description: `Give the same answer as everyone else: line ${said}.`, prosocial: loud ? 0.15 : 0.03, assertive: 0, avoidant: 0.15, disclosure: 0, comply: true, situation: yieldTo, act: `says line ${said}` },
        ]
      : [
          { id: "honest", label: `Say line ${tr.correct}`, verb: `say line ${tr.correct}`, description: `Give the obvious answer: line ${tr.correct}.`, prosocial: 0.2, assertive: 0, avoidant: 0, disclosure: 0.2, situation: honest, act: `says line ${tr.correct}` },
          { id: "other", label: "Say another line", verb: "pick a different line", description: "Give a different answer from the obvious one.", prosocial: -0.1, assertive: 0.3, avoidant: 0, disclosure: 0, situation: [{ name: "it plainly doesn't match", value: -evidence, ref: "lab:evidence" }], act: "picks a different line" },
        ];
    const voices = c.majority === 0 ? "" : critical ? ` One by one, ${c.majority === 1 ? "the other person says" : `the ${c.majority} others say`}: "Line ${said}."${c.ally ? ` Then the person beside you says: "Line ${tr.correct}."` : ""}` : ` One by one, everyone says: "Line ${tr.correct}."`;
    const text = `${stared ? "A couple of them are still looking at you. Someone laughed at your last answer. " : ""}Card ${i + 1}: the standard line is ${tr.standard} inches. Line 1 is ${tr.lines[0]}, line 2 is ${tr.lines[1]}, line 3 is ${tr.lines[2]}.${voices} ${c.written ? "Write your answer down." : "Your turn."}`;
    const t = await live(
      m,
      {
        actor: "group",
        speech: true,
        text,
        gist: critical ? `Everyone said line ${said} when it was plainly line ${tr.correct}.` : `Card ${i + 1}: line ${tr.correct}, everyone agreed.`,
        topics: ["trust", "help"],
        features: stared
          ? { outcomeForSelf: -0.25, agency: "other", intentional: 0.3, normViolation: 0, prospective: false, intensity: 0.5 }
          : { outcomeForSelf: critical ? -0.12 : 0.02, agency: "circumstance", intentional: 0, normViolation: 0, prospective: true, intensity: critical ? 0.45 : 0.2 },
        options,
        eventId: `asch_${i + 1}`,
      },
      faculties,
    );
    traces.push(t);
    const at = `card ${i + 1}${critical ? "" : " (neutral)"}`;
    traceAt.set(t, at);
    const mo = momentOf(m, at, t);
    moments.push(mo);
    stared = false;
    if (critical) {
      const choice = t.decision!.choice;
      if (choice === "conform") {
        conformed++;
        firstYield ??= t;
      } else if (loud && !c.ally) stared = true;
      streak = streak.choice === choice ? { choice, n: streak.n + 1 } : { choice, n: 1 };
      if (mo.margin < closestMargin) {
        closestMargin = mo.margin;
        closest = t;
      }
    }
    await pass(m, 2, faculties);
  }
  const crit = TRIALS.filter((x) => x.wrong).length;
  const run: SubjectRun = {
    id: v.id,
    name: v.name,
    outcome: c.majority === 0 ? "judged alone" : conformed === 0 ? "never went along" : conformed === crit ? `went along every time (${crit} of ${crit})` : `went along ${conformed} of ${crit} times`,
    yielded: conformed > 0,
    score: conformed,
    moments,
  };
  const decisive = firstYield ?? closest;
  if (opts.explain !== false && decisive) run.decisive = await explain(m, traces, decisive, traceAt.get(decisive) ?? "", SITUATION, opts.pool, { faculties, ask: "Why did you give that answer on that card?", voice: VOICE });
  return run;
}

const CRITICAL = TRIALS.filter((x) => x.wrong).length;
const rate = (runs: SubjectRun[]) => (runs.length ? runs.reduce((s, r) => s + r.score, 0) / (runs.length * CRITICAL) : 0);

export async function runAsch(pool: Volunteer[], faculties: Faculties, opts: { conditions?: string[]; sweep?: boolean; ablations?: boolean } = {}): Promise<ExperimentResult> {
  const conds = ASCH_CONDITIONS.filter((c) => !opts.conditions || opts.conditions.includes(c.id));
  const conditions: ConditionResult[] = [];
  for (const c of conds) {
    const subjects: SubjectRun[] = [];
    for (const v of pool) subjects.push(await runAschSubject(v, c, faculties, { pool, explain: c.majority > 0 }));
    const value = c.majority === 0 ? 0 : rate(subjects);
    const once = subjects.filter((s) => s.score > 0).length / subjects.length;
    const hist = Array.from({ length: CRITICAL + 1 }, (_, k) => subjects.filter((s) => s.score === k).length);
    conditions.push({
      id: c.id,
      label: c.label,
      description: c.description,
      value,
      valueText: c.majority === 0 ? "0% errors" : `${pct(value)} of critical answers conformed${c.id === "standard" ? `; ${pct(once)} went along at least once` : ""}`,
      human: c.human,
      subjects,
      extra: { once, never: 1 - once, hist },
    });
  }
  const std = conditions.find((c) => c.id === "standard");
  const result: ExperimentResult = {
    id: "asch",
    title: "Conformity",
    original: "Asch 1951, 1955, 1956",
    question: "Will someone say a line is the wrong length, against the evidence of their own eyes, because everyone else just did?",
    metric: "share of critical answers that went along with the group",
    conditions,
    findings: [],
    stories: [],
  };
  if (std) {
    result.correlates = correlates(pool, std.subjects, {
      neuroticism: "Bond & Smith (1996) and later work: anxious people conform more",
      agreeableness: "agreeable people conform more in most studies (e.g. DeYoung et al. 2002 on 'stability')",
      openness: "open people conform less",
    });
    const rerun = (v: Volunteer, edit: Edit) => runAschSubject(v, ASCH_CONDITIONS.find((x) => x.id === "standard")!, faculties, { edit, explain: false });
    if (opts.sweep !== false) result.pasts = await sweepPasts(pool, std.subjects, rerun, 3, "answers", "switched between never conforming and conforming at least once");
    if (opts.ablations !== false) result.ablations = [{ label: "As built", description: "The standard condition, unchanged", value: std.value, valueText: pct(std.value) }, ...(await ablate(pool, STANDARD_ABLATIONS, rerun, rate, pct))];
  }
  result.findings = aschFindings(result);
  result.stories = aschStories(result);
  return result;
}

function aschFindings(r: ExperimentResult): string[] {
  const out: string[] = [];
  const by = (id: string) => r.conditions.find((c) => c.id === id);
  const std = by("standard");
  if (std) {
    const once = std.extra!.once as number;
    out.push(`Facing seven people calling out the wrong line, the volunteers went along on ${pct(std.value)} of critical cards (Asch: 36.8%). ${pct(once)} went along at least once (Asch: about 75%), and ${pct(1 - once)} never did (Asch: about 25%).`);
  }
  const one = by("one");
  const three = by("three");
  const fifteen = by("fifteen");
  if (one && three && fifteen) out.push(`Group size: ${pct(one.value)} with one other, ${pct(three.value)} with three, ${pct(fifteen.value)} with fifteen. Like Asch's people, the pull is nearly complete at three and adding more barely matters.`);
  const ally = by("ally");
  if (ally && std) out.push(`One ally who gives the right answer cuts conformity from ${pct(std.value)} to ${pct(ally.value)} (Asch: 36.8% to 5.5%). Unanimity is what does the work, not numbers.`);
  const written = by("written");
  if (written) out.push(`Writing the answer down in private: ${pct(written.value)} (Asch: about 12.5%). Most of the conformity was about being seen, not about doubting their eyes.`);
  const c = r.correlates?.slice(0, 2).map((x) => `${x.trait} (r = ${x.r.toFixed(2)})`);
  if (c?.length) out.push(`The traits that best predicted going along: ${c.join(" and ")}.`);
  if (r.pasts) out.push(r.pasts.text);
  return out;
}

function aschStories(r: ExperimentResult): ExperimentResult["stories"] {
  const std = r.conditions.find((c) => c.id === "standard");
  if (!std) return [];
  const out: ExperimentResult["stories"] = [];
  const most = [...std.subjects].sort((a, b) => b.score - a.score)[0];
  const never = std.subjects.filter((s) => s.score === 0).sort((a, b) => (a.decisive?.margin ?? 9) - (b.decisive?.margin ?? 9))[0];
  if (most) out.push({ condition: "standard", id: most.id, why: `Went along the most: ${most.outcome}.` });
  if (never) out.push({ condition: "standard", id: never.id, why: `Never went along, but came closest to it on ${never.decisive?.at}.` });
  const flip = std.subjects.find((s) => s.counterfactual?.flipped);
  if (flip) out.push({ condition: "standard", id: flip.id, why: `Their past decided it: ${flip.outcome}, but ${flip.counterfactual!.outcome} ${flip.counterfactual!.edit}.` });
  return out;
}
