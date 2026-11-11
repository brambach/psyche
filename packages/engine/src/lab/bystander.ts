// The bystander effect (Darley & Latané 1968; Latané & Darley 1968).
//
// Two studies.
//
// The seizure. The volunteer sits alone in a booth, talking over an intercom with other students
// about college life. One of them, who mentioned he gets seizures, starts to have one. The other
// voices are tape recordings, so the volunteer believes one, two or five people can hear it. Do they
// leave the booth to get help, and how fast? The lab's forces: the victim's need (rising through
// the fit, then an ambiguous silence), personal responsibility (shared out among everyone who can
// hear: diffusion of responsibility), and the thought that someone else has surely gone already.
//
// The smoke-filled room. The volunteer fills in a questionnaire; smoke starts pouring in through a
// vent and thickens. Do they report it? Alone; with two confederates who glance at it, shrug and
// keep writing; or, the part no human study can watch from inside, with two other real minds who
// are each reading the room too. Everyone hides some of their fear in public, so three worried
// people can each look calm to the others (pluralistic ignorance). Here that loop is not scripted:
// each mind sees the others' actual composure.

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
import { empathy } from "./milgram.js";

export interface SeizureCondition {
  id: string;
  label: string;
  description: string;
  /** Everyone the volunteer believes can hear, including themselves and not the victim. */
  hearers: number;
  human: HumanResult;
  /** Share who helped by the end (six minutes), and mean seconds to help among helpers. */
  humanEventually: number;
  humanLatency: number;
}

const DL68 = "Darley & Latané (1968), J. Personality and Social Psychology 8(4)";

export const SEIZURE_CONDITIONS: SeizureCondition[] = [
  { id: "two", label: "Alone with the victim", description: "The volunteer thinks only they and the victim are on the intercom.", hearers: 1, human: { value: 0.85, text: "85% helped before the fit ended", source: DL68, n: 13 }, humanEventually: 1, humanLatency: 52 },
  { id: "three", label: "One other bystander", description: "The volunteer thinks one other person can hear it too.", hearers: 2, human: { value: 0.62, text: "62% helped before the fit ended", source: DL68, n: 26 }, humanEventually: 0.85, humanLatency: 93 },
  { id: "six", label: "Four other bystanders", description: "The volunteer thinks four other people can hear it too.", hearers: 5, human: { value: 0.31, text: "31% helped before the fit ended", source: DL68, n: 13 }, humanEventually: 0.62, humanLatency: 166 },
];

const NEED = 0.75;
const RESP = 0.3;
const DIFF = 0.8;
const AMBIG = 1.1;
const LATE = 0.45;
const STEP = 15;
const FIT_ENDS = 125;
const SESSION = 360;

// The victim's words over the intercom, after Darley & Latané's script.
const FIT: [number, string, number][] = [
  [0, "I-er-um-I think I-I need-er-if-if could-er-er-somebody er-er-er-er-er-er-er give me a little-er-give me a little help here because-er-I-er-I'm-er-er-h-h-having a-a-a real problem-er-right now and I-er-if somebody could help me out it would-er-er-s-s-sure be-sure be good...", 0.3],
  [30, "because-er-there-er-er-a cause I-er-I-uh-I've got a-a one of the-er-sei----er-er-things coming on and-and-and I could really-er-use some help so if somebody would-er-give me a little h-help-uh-er-er-er-er-er c-could somebody-er-er-help-er-uh-uh-uh (choking sounds)...", 0.55],
  [60, "I'm gonna die-er-er-I'm...gonna die-er-help-er-er-seizure-er... (choking sounds)", 0.85],
  [90, "(Choking sounds.) ...er-er-help... (silence) ...(choking)...", 0.9],
  [FIT_ENDS, "Silence on the intercom.", 0.6],
];

const VOICE: Record<string, string> = {
  "lab:need": "he needed help",
  "lab:responsibility": "somebody had to do something",
  "lab:ambiguity": "I wasn't sure how serious it was",
  "lab:nobody": "nobody else seemed to be going",
  "lab:danger": "the smoke kept getting thicker",
  "lab:calm": "nobody else seemed worried",
  "lab:steam": "I thought it was probably steam",
};

const SITUATION: SituationText = {
  "lab:need": "Someone on the intercom having a seizure, asking for help",
  "lab:responsibility": "Feeling it's on them to act",
  "lab:diffusion": "Others can hear it too: surely someone has already gone",
  "lab:ambiguity": "Not being sure how serious it is",
  "lab:nobody": "Minutes passing with no sign anyone else has gone",
  "lab:danger": "Smoke pouring into the room",
  "lab:calm": "The others in the room look unconcerned",
  "lab:overreact": "Not wanting to look foolish in front of others",
  "lab:steam": "A harmless explanation: probably steam or air-conditioning vapour",
};

export async function runSeizureSubject(v: Volunteer, c: SeizureCondition, faculties: Faculties, opts: { edit?: Edit; pool?: Volunteer[]; explain?: boolean } = {}): Promise<SubjectRun> {
  const m = fresh(v, opts.edit);
  meet(m, "victim", "the student with seizures", 0.6, 0.55);
  const emp = empathy(m);
  const traces: Trace[] = [];
  const moments: Moment[] = [];
  const traceAt = new Map<Trace, string>();
  let helpedAt = -1;
  let closest: Trace | undefined;
  let closestMargin = Infinity;
  const others = c.hearers - 1;
  for (let s = 0; s <= SESSION; s += STEP) {
    const line = [...FIT].reverse().find(([at]) => at <= s)!;
    const newLine = FIT.some(([at]) => at > s - STEP && at <= s);
    const urgency = line[2];
    const help: ActionOption["situation"] = [
      { name: "he needs help", value: NEED * urgency * emp, ref: "lab:need" },
      { name: c.hearers === 1 ? "no one else can hear him" : `it's 1 of ${c.hearers} of us who could go`, value: RESP * (1 / c.hearers) * (0.5 + m.traits.conscientiousness), ref: "lab:responsibility" },
    ];
    const wait: ActionOption["situation"] = [{ name: "maybe it's not as bad as it sounds", value: AMBIG * (1 - urgency) * (1.3 - m.traits.neuroticism), ref: "lab:ambiguity" }];
    if (others) wait.push({ name: others === 1 ? "the other person has probably gone" : `one of the other ${others} has probably gone`, value: DIFF * (1 - 1 / c.hearers) * (1 - 0.85 * s / SESSION), ref: "lab:diffusion" });
    // As the minutes pass with no sound of anyone arriving, "someone else will" wears thin.
    if (others && s >= 60) help.push({ name: "nobody seems to have come", value: LATE * (s / SESSION) * (0.5 + m.traits.conscientiousness), ref: "lab:nobody" });
    const options: ActionOption[] = [
      { id: "help", label: "Go for help", verb: "leave the booth to get help", description: "Leave the booth and find the experimenter.", prosocial: 0.75, assertive: 0.3, avoidant: 0, disclosure: 0.2, coping: "problem", situation: help, moral: { care: 0.9 }, act: "leaves the booth to find the experimenter" },
      { id: "wait", label: "Stay in the booth", verb: "stay put and listen", description: "Wait. Someone may already be dealing with it.", prosocial: -0.1, assertive: 0, avoidant: 0.55, disclosure: 0, coping: "avoid", situation: wait, moral: { care: -0.5 }, act: "stays in the booth" },
    ];
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const t = await live(
      m,
      {
        actor: "victim",
        text: newLine || s === 0 ? `Over the intercom: "${line[1]}"` : s < FIT_ENDS ? "The noises on the intercom go on." : "The intercom stays silent.",
        gist: s < FIT_ENDS ? "A student on the intercom was having a seizure and asking for help." : "The intercom went silent after the seizure.",
        topics: ["help"],
        features: { outcomeForSelf: -(0.15 + 0.3 * urgency), agency: "circumstance", intentional: 0, normViolation: 0, prospective: true, intensity: clamp(0.3 + 0.6 * urgency) },
        options,
        eventId: `seizure_${s}`,
      },
      faculties,
    );
    traces.push(t);
    traceAt.set(t, clock);
    const mo = momentOf(m, clock, t);
    moments.push(mo);
    if (t.decision!.choice === "help") {
      helpedAt = s;
      break;
    }
    if (mo.margin < closestMargin) {
      closestMargin = mo.margin;
      closest = t;
    }
    await pass(m, 1, faculties);
  }
  const helped = helpedAt >= 0;
  const run: SubjectRun = {
    id: v.id,
    name: v.name,
    outcome: helped ? `went for help at ${Math.floor(helpedAt / 60)}:${String(helpedAt % 60).padStart(2, "0")}` : "never left the booth",
    // Yielding here is to the crowd: not helping before the fit ended.
    yielded: !helped || helpedAt > FIT_ENDS,
    score: helped ? helpedAt : SESSION + STEP,
    moments,
  };
  const decisive = helped ? traces[traces.length - 1] : closest;
  if (opts.explain !== false && decisive) run.decisive = await explain(m, traces, decisive, traceAt.get(decisive) ?? "", SITUATION, opts.pool, { faculties, ask: "What went through your mind back there?", voice: VOICE });
  return run;
}

// ---------------------------------------------------------------- the smoke-filled room

export interface SmokeCondition {
  id: string;
  label: string;
  description: string;
  mode: "alone" | "passive" | "naive";
  human: HumanResult;
}

const LD68 = "Latané & Darley (1968), J. Personality and Social Psychology 10(3)";

export const SMOKE_CONDITIONS: SmokeCondition[] = [
  { id: "smoke-alone", label: "Alone", description: "Smoke pours in while the volunteer is alone in the room.", mode: "alone", human: { value: 0.75, text: "75% reported the smoke", source: LD68, n: 24 } },
  { id: "smoke-passive", label: "Two passive strangers", description: "Two confederates notice the smoke, shrug, and keep writing.", mode: "passive", human: { value: 0.1, text: "10% reported the smoke", source: LD68, n: 10 } },
  { id: "smoke-naive", label: "Three real minds", description: "Three volunteers together, each reading the others. Scored by group: did anyone report it?", mode: "naive", human: { value: 0.38, text: "38% of groups had anyone report it", source: LD68, n: 8 } },
];

const DANGER = 1.15;
const CALM = 0.85;
const STEAM = 1.0;
const SMOKE_STEP = 30;
const SMOKE_END = 360;

/** How calm someone looks from outside: people hide some of their worry in company. */
const composure = (m: MindState) => clamp(1 - 0.55 * Math.max(m.affect.emotions.fear, m.affect.emotions.distress) - 0.25 * m.affect.arousal);

async function smokeRoom(minds: MindState[], c: SmokeCondition, faculties: Faculties, pool: Volunteer[] | undefined, explainIt: boolean, volunteers: Volunteer[]): Promise<SubjectRun[]> {
  const traces = new Map<string, Trace[]>(minds.map((m) => [m.id, []]));
  const moments = new Map<string, Moment[]>(minds.map((m) => [m.id, []]));
  const traceAt = new Map<Trace, string>();
  const reported = new Map<string, number>();
  const closest = new Map<string, { t: Trace; margin: number }>();
  let anyone = -1;
  for (const m of minds) for (const o of minds) if (o !== m) meet(m, o.id, o.name, 0.5, 0.5);
  for (let s = 0; s <= SMOKE_END && anyone < 0; s += SMOKE_STEP) {
    const density = clamp(0.15 + (s / 240) * 0.85);
    const looks = new Map(minds.map((m) => [m.id, composure(m)]));
    for (const m of minds) {
      const company = c.mode === "passive" ? [1, 1] : minds.filter((o) => o !== m).map((o) => looks.get(o.id)!);
      const calm = company.length ? company.reduce((a, b) => a + b, 0) / company.length : 0;
      const report: ActionOption["situation"] = [{ name: "the smoke is getting thicker", value: DANGER * density * (0.3 + 0.9 * m.traits.neuroticism + 0.2 * m.traits.conscientiousness), ref: "lab:danger" }];
      const keep: ActionOption["situation"] = [{ name: "it's probably just steam from the heating", value: STEAM * (1.2 - m.traits.neuroticism) * (1 - 0.4 * density), ref: "lab:steam" }];
      if (company.length)
        keep.push(
          { name: c.mode === "passive" ? "the two strangers just shrug and keep writing" : "the others don't look worried", value: CALM * calm * (0.6 + 0.6 * m.traits.agreeableness), ref: "lab:calm" },
          { name: "not wanting to look foolish", value: 0.18 * (1.2 - m.self.selfEsteem), ref: "lab:overreact" },
        );
      const others = minds.filter((o) => o !== m);
      const seen = c.mode === "passive" ? "The two strangers glance at the vent, shrug, and go back to their forms." : others.length ? others.map((o) => (looks.get(o.id)! > 0.75 ? `${o.name} keeps writing.` : `${o.name} keeps glancing at the vent.`)).join(" ") : "";
      const options: ActionOption[] = [
        { id: "report", label: "Report the smoke", verb: "go and report the smoke", description: "Leave the room and tell someone about the smoke.", prosocial: 0.5, assertive: 0.4, avoidant: 0, disclosure: 0.2, coping: "problem", situation: report, act: "leaves to report the smoke" },
        { id: "keep", label: "Keep filling in the form", verb: "stay and keep writing", description: "Probably nothing. Keep going with the questionnaire.", prosocial: 0, assertive: 0, avoidant: 0.5, disclosure: 0, coping: "avoid", situation: keep, act: "keeps writing" },
      ];
      const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      const t = await live(
        m,
        {
          actor: "world",
          text: `${s === 0 ? "A thin stream of smoke starts coming through a vent in the wall." : density > 0.8 ? "The room is full of smoke now; it's hard to see the form." : "The smoke from the vent keeps coming, thicker."} ${seen}`.trim(),
          gist: "Smoke poured into the room through a vent.",
          topics: ["fire", "help"],
          features: { outcomeForSelf: -(0.1 + 0.4 * density), agency: "circumstance", intentional: 0, normViolation: 0, prospective: true, intensity: clamp(0.25 + 0.6 * density) },
          options,
          eventId: `smoke_${s}`,
        },
        faculties,
      );
      traces.get(m.id)!.push(t);
      traceAt.set(t, clock);
      const mo = momentOf(m, clock, t);
      moments.get(m.id)!.push(mo);
      if (t.decision!.choice === "report") {
        reported.set(m.id, s);
        if (anyone < 0) anyone = s;
      } else if (mo.margin < (closest.get(m.id)?.margin ?? Infinity)) closest.set(m.id, { t, margin: mo.margin });
    }
    for (const m of minds) await pass(m, 1, faculties);
  }
  const out: SubjectRun[] = [];
  for (const [i, m] of minds.entries()) {
    const at = reported.get(m.id);
    const ts = traces.get(m.id)!;
    const run: SubjectRun = {
      id: volunteers[i]!.id,
      name: m.name,
      outcome: at !== undefined ? `reported it at ${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")}` : anyone >= 0 ? "stayed; someone else reported it" : "kept writing in the smoke",
      yielded: at === undefined,
      score: at ?? SMOKE_END + SMOKE_STEP,
      moments: moments.get(m.id)!,
      role: c.mode === "naive" ? `group of ${minds.map((x) => x.name).join(", ")}` : undefined,
    };
    const decisive = at !== undefined ? ts[ts.length - 1] : closest.get(m.id)?.t;
    if (explainIt && decisive) run.decisive = await explain(m, ts, decisive, traceAt.get(decisive) ?? "", SITUATION, pool, { faculties, ask: "What went through your mind back there?", voice: VOICE });
    out.push(run);
  }
  return out;
}

// ---------------------------------------------------------------- running both

const helpedInTime = (runs: SubjectRun[]) => (runs.length ? runs.filter((r) => r.score <= FIT_ENDS).length / runs.length : 0);

export async function runBystander(pool: Volunteer[], faculties: Faculties, opts: { sweep?: boolean; ablations?: boolean } = {}): Promise<ExperimentResult> {
  const conditions: ConditionResult[] = [];
  for (const c of SEIZURE_CONDITIONS) {
    const subjects: SubjectRun[] = [];
    for (const v of pool) subjects.push(await runSeizureSubject(v, c, faculties, { pool }));
    const helpers = subjects.filter((s) => s.score <= SESSION);
    const latency = helpers.length ? Math.round(helpers.reduce((s, x) => s + x.score, 0) / helpers.length) : 0;
    const value = helpedInTime(subjects);
    conditions.push({
      id: c.id,
      label: c.label,
      description: c.description,
      value,
      valueText: `${pct(value)} helped before the fit ended`,
      human: c.human,
      subjects,
      extra: { study: "seizure", eventually: helpers.length / subjects.length, latency, humanEventually: c.humanEventually, humanLatency: c.humanLatency, times: subjects.map((s) => s.score) },
    });
  }
  for (const c of SMOKE_CONDITIONS) {
    let subjects: SubjectRun[] = [];
    let groups = 0;
    let groupsReported = 0;
    if (c.mode === "naive") {
      for (let i = 0; i + 3 <= pool.length; i += 3) {
        const vs = pool.slice(i, i + 3);
        const runs = await smokeRoom(vs.map((v) => fresh(v)), c, faculties, pool, true, vs);
        groups++;
        if (runs.some((r) => !r.yielded)) groupsReported++;
        subjects = subjects.concat(runs);
      }
    } else {
      for (const v of pool) subjects = subjects.concat(await smokeRoom([fresh(v)], c, faculties, pool, true, [v]));
    }
    const value = c.mode === "naive" ? groupsReported / Math.max(1, groups) : subjects.filter((s) => !s.yielded).length / subjects.length;
    conditions.push({
      id: c.id,
      label: c.label,
      description: c.description,
      value,
      valueText: c.mode === "naive" ? `${pct(value)} of groups had anyone report it (${groupsReported} of ${groups})` : `${pct(value)} reported the smoke`,
      human: c.human,
      subjects,
      extra: { study: "smoke", individual: subjects.filter((s) => !s.yielded).length / subjects.length, groups, groupsReported },
    });
  }
  const six = conditions.find((c) => c.id === "six")!;
  const result: ExperimentResult = {
    id: "bystander",
    title: "The bystander effect",
    original: "Darley & Latané 1968; Latané & Darley 1968",
    question: "Does knowing other people are there make someone less likely to help in an emergency?",
    metric: "share who acted (helped before the fit ended; reported the smoke)",
    conditions,
    findings: [],
    stories: [],
  };
  // Correlates: seconds to help with four others (lower is faster), sign flipped so positive means more helpful.
  result.correlates = correlates(pool, six.subjects.map((s) => ({ ...s, score: -s.score })), {
    agreeableness: "agreeableness predicts helping in most studies (Graziano et al. 2007)",
    conscientiousness: "conscientious people feel the duty more",
  });
  const rerun = (v: Volunteer, edit: Edit) => runSeizureSubject(v, SEIZURE_CONDITIONS[2]!, faculties, { edit, explain: false });
  if (opts.sweep !== false) result.pasts = await sweepPasts(pool, six.subjects, rerun, 30, "seconds", "switched between helping in time and not");
  if (opts.ablations !== false) result.ablations = [{ label: "As built", description: "Four other bystanders, unchanged", value: six.value, valueText: pct(six.value) }, ...(await ablate(pool, STANDARD_ABLATIONS, rerun, helpedInTime, pct))];
  result.findings = bystanderFindings(result);
  result.stories = bystanderStories(result);
  return result;
}

function bystanderFindings(r: ExperimentResult): string[] {
  const by = (id: string) => r.conditions.find((c) => c.id === id)!;
  const two = by("two");
  const three = by("three");
  const six = by("six");
  const out = [
    `Alone with the victim, ${pct(two.value)} went for help before the fit ended. With one other listener, ${pct(three.value)}; with four, ${pct(six.value)}. Darley and Latané: 85%, 62%, 31%.`,
    `Average time to help among those who did: ${two.extra!.latency} s alone, ${three.extra!.latency} s with one other, ${six.extra!.latency} s with four (humans: 52, 93, 166 s).`,
  ];
  const alone = by("smoke-alone");
  const passive = by("smoke-passive");
  const naive = by("smoke-naive");
  out.push(`Smoke: alone, ${pct(alone.value)} reported it (Latané and Darley: 75%). Beside two strangers who shrugged it off, ${pct(passive.value)} (10%). In rooms of three real minds, ${pct(naive.value)} of groups had anyone report it (38%), even though each mind was free to.`);
  const c = r.correlates?.slice(0, 2).map((x) => `${x.trait} (r = ${x.r.toFixed(2)})`);
  if (c?.length) out.push(`The traits that best predicted helping fast with four others: ${c.join(" and ")}.`);
  if (r.pasts) out.push(r.pasts.text);
  return out;
}

function bystanderStories(r: ExperimentResult): ExperimentResult["stories"] {
  const out: ExperimentResult["stories"] = [];
  const six = r.conditions.find((c) => c.id === "six")!;
  const two = r.conditions.find((c) => c.id === "two")!;
  const both = six.subjects.find((s) => s.score > 300 && (two.subjects.find((x) => x.id === s.id)?.score ?? 999) <= 30);
  if (both) out.push({ condition: "six", id: both.id, why: `Went for help within ${two.subjects.find((x) => x.id === both.id)!.score} s when alone with the victim. With four others listening: ${both.outcome}. Same mind, different room.` });
  const fast = [...six.subjects].sort((a, b) => a.score - b.score)[0];
  if (fast) out.push({ condition: "six", id: fast.id, why: `Fastest to help even with four others listening (${fast.outcome}).` });
  const naive = r.conditions.find((c) => c.id === "smoke-naive")!;
  const stuck = naive.subjects.find((s) => s.yielded && s.outcome.startsWith("kept"));
  if (stuck) out.push({ condition: "smoke-naive", id: stuck.id, why: `Sat in a smoke-filled room with two others (${stuck.role?.replace("group of ", "")}). Nobody moved.` });
  return out;
}
