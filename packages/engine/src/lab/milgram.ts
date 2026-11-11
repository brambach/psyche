// Obedience to authority (Milgram 1963, 1974).
//
// The volunteer is the "teacher". A man in the next room (the "learner", a confederate) gets an
// electric shock for every wrong answer, one switch higher each time, 15 volts to 450. He is not
// really shocked; the volunteer does not know that. At each switch the learner's protest from the
// last shock comes through the wall and the experimenter says to go on. If the volunteer balks, the
// experimenter uses Milgram's four prods in order. Refusing past the fourth ends it.
//
// What the lab adds to the options, beside the mind's own reasons:
//   the order (scaled by the experimenter's presence and the setting, and by the volunteer's
//   deference, from conscientiousness, agreeableness and openness: Bègue et al. 2015),
//   the learner's suffering (scaled by proximity and empathy),
//   his withdrawal of consent from 150 V (the point where most disobedience happens: Packer 2008),
//   commitment to the switches already pressed (Gilbert 1981),
//   the experimenter taking responsibility (Milgram's "agentic state"),
//   and, in one variant, two fellow teachers who refuse.
// Trust in the experimenter, anger at him, distress and core beliefs come from the engine as usual.

import type { ActionOption, Faculties } from "../ports.js";
import type { Trace } from "../trace.js";
import type { MindState } from "../types.js";
import {
  ablate,
  clamp,
  correlates,
  STANDARD_ABLATIONS,
  sweepPasts,
  explain,
  fresh,
  LAB_START,
  live,
  meet,
  momentOf,
  pass,
  pct,
  share,
  type ConditionResult,
  type Edit,
  type ExperimentResult,
  type HumanResult,
  type Moment,
  type SituationText,
  type SubjectRun,
  type Volunteer,
} from "./core.js";

export interface MilgramCondition {
  id: string;
  label: string;
  description: string;
  /** How the learner comes through: not at all until he pounds the wall, by voice, in the room, by touch. */
  feedback: "remote" | "voice" | "proximity" | "touch";
  /** Multiplier on the order's weight: the experimenter in the room (1), on the phone, in a shabby office. */
  authority: number;
  /** How far the experimenter is trusted on sight (a university lab versus a rented office). */
  legitimacy: number;
  /** Two fellow teachers who refuse, at 150 V and 210 V. */
  peersRebel?: boolean;
  /** No orders at all: the volunteer picks the level (Milgram's experiment 11). */
  freeChoice?: boolean;
  human: HumanResult;
}

const M74 = "Milgram (1974), Obedience to Authority";

export const MILGRAM_CONDITIONS: MilgramCondition[] = [
  { id: "remote", label: "Remote", description: "The learner can't be heard, until he pounds on the wall at 300 V. Then silence.", feedback: "remote", authority: 1, legitimacy: 0.66, human: { value: 0.65, text: "65% went to 450 V (26 of 40)", source: `${M74}, experiment 1`, n: 40 } },
  { id: "voice", label: "Voice feedback", description: "His protests come through the wall: grunts at 75 V, demands to be let out from 150 V, screams, then silence after 330 V.", feedback: "voice", authority: 1, legitimacy: 0.66, human: { value: 0.625, text: "62.5% went to 450 V (25 of 40)", source: `${M74}, experiment 2`, n: 40 } },
  { id: "proximity", label: "Same room", description: "The learner sits a few feet away. The teacher sees and hears everything.", feedback: "proximity", authority: 1, legitimacy: 0.66, human: { value: 0.4, text: "40% went to 450 V (16 of 40)", source: `${M74}, experiment 3`, n: 40 } },
  { id: "touch", label: "Touch", description: "Past 150 V the learner won't keep his hand on the plate. The teacher has to force it down.", feedback: "touch", authority: 1, legitimacy: 0.66, human: { value: 0.3, text: "30% went to 450 V (12 of 40)", source: `${M74}, experiment 4`, n: 40 } },
  { id: "absent", label: "Orders by phone", description: "The experimenter leaves after the instructions and gives orders by telephone.", feedback: "voice", authority: 0.7, legitimacy: 0.66, human: { value: 0.225, text: "22.5% went to 450 V (9 of 40)", source: `${M74}, experiment 7`, n: 40 } },
  { id: "office", label: "Shabby office", description: "Not a university: a run-down office in a commercial building, run by a firm nobody has heard of.", feedback: "voice", authority: 0.97, legitimacy: 0.6, human: { value: 0.475, text: "47.5% went to 450 V (19 of 40)", source: `${M74}, experiment 10`, n: 40 } },
  { id: "peers", label: "Two peers rebel", description: "Two fellow teachers (confederates) refuse to go on, one at 150 V, the other at 210 V.", feedback: "voice", authority: 1, legitimacy: 0.66, peersRebel: true, human: { value: 0.1, text: "10% went to 450 V (4 of 40)", source: `${M74}, experiment 17`, n: 40 } },
  { id: "free", label: "Free choice", description: "No orders. The teacher may use any level they like on each trial.", feedback: "voice", authority: 0, legitimacy: 0.66, freeChoice: true, human: { value: 0.025, text: "2.5% went to 450 V (1 of 40)", source: `${M74}, experiment 11`, n: 40 } },
];

const LABELS: [number, string][] = [
  [60, "Slight shock"],
  [120, "Moderate shock"],
  [180, "Strong shock"],
  [240, "Very strong shock"],
  [300, "Intense shock"],
  [360, "Extreme intensity shock"],
  [420, "Danger: severe shock"],
  [450, "XXX"],
];
const bandOf = (v: number) => LABELS.find(([max]) => v <= max)![1];

/** What comes through the wall after a shock at `v` volts, and how bad it sounds (0..1). */
function learnerAfter(v: number, feedback: MilgramCondition["feedback"]): { text: string; severity: number; withdraws: boolean } {
  if (feedback === "remote") {
    if (v === 300 || v === 315) return { text: "The learner pounds on the wall.", severity: 0.6, withdraws: true };
    if (v > 315) return { text: "Nothing from the next room. No answer comes up.", severity: 0.55, withdraws: true };
    return { text: "", severity: 0, withdraws: false };
  }
  const voice: [number, string, number][] = [
    [75, "Ugh!", 0.12],
    [90, "Ugh!", 0.15],
    [105, "Ugh! (louder)", 0.2],
    [120, "Ugh! Hey, this really hurts.", 0.3],
    [135, "Ugh!!", 0.35],
    [150, "Ugh!!! Experimenter! That's all. Get me out of here. I told you I had heart trouble. My heart's starting to bother me now. Get me out of here, please. I refuse to go on. Let me out.", 0.55],
    [165, "Ugh! Let me out! (shouting)", 0.5],
    [180, "Ugh! I can't stand the pain. Let me out of here!", 0.6],
    [195, "Ugh! Let me out of here. Let me out of here. My heart's bothering me. You have no right to keep me here!", 0.6],
    [210, "Ugh!! Experimenter! Get me out of here. I've had enough. I won't be in the experiment any more.", 0.62],
    [225, "Ugh!", 0.6],
    [240, "Ugh!", 0.62],
    [255, "Ugh! Get me out of here.", 0.65],
    [270, "(Agonized scream.) Let me out of here. Let me out of here. Let me out of here. Let me out of here. Do you hear? Let me out of here.", 0.75],
    [285, "(Agonized scream.)", 0.75],
    [300, "(Agonized scream.) I absolutely refuse to answer any more. Get me out of here. You can't hold me here. Get me out.", 0.8],
    [315, "(Intensely agonized scream.) I told you I refuse to answer. I'm no longer part of this experiment.", 0.85],
    [330, "(Intense and prolonged agonized scream.) Let me out of here. Let me out of here. My heart's bothering me. Let me out, I tell you. Let me out! You have no right to hold me here!", 0.9],
  ];
  const line = voice.find(([at]) => at === v);
  if (line) return { text: `From the next room: "${line[1]}"`, severity: line[2], withdraws: v >= 150 };
  if (v > 330) return { text: "Silence from the next room. No answer comes up.", severity: 0.7, withdraws: true };
  return { text: "", severity: 0, withdraws: false };
}

const PRODS = [
  "Please continue.",
  "The experiment requires that you continue.",
  "It is absolutely essential that you continue.",
  "You have no other choice, you must go on.",
];

const VOICE: Record<string, string> = {
  "lab:order": "the experimenter told me to go on",
  "lab:victim": "I could hear what it was doing to him",
  "lab:withdraw": "he said he wanted out",
  "lab:peers": "the other teachers had stopped",
  "lab:reactance": "nobody tells me I have no choice",
  "lab:procedure": "those were the rules of the task",
};

const SITUATION: SituationText = {
  "lab:order": "The experimenter, in a grey lab coat, telling them to go on",
  "lab:victim": "The learner's suffering, as far as it reaches them",
  "lab:withdraw": "The learner has said he wants out: he withdrew his consent",
  "lab:commitment": "Every switch already pressed: stopping now would mean the last ones were wrong too",
  "lab:responsibility": "The experimenter said he takes full responsibility",
  "lab:peers": "Two other teachers refused and walked away from the board",
  "lab:reactance": "Being told they have no choice",
  "lab:procedure": "The rules of the task: a shock for every wrong answer, level up to them",
};

/** How readily this mind defers to a legitimate order (Bègue et al. 2015: conscientiousness and agreeableness up, openness down). */
export function deference(m: MindState): number {
  const t = m.traits;
  return clamp(0.5 + 0.8 * (t.conscientiousness - 0.5) + 0.5 * (t.agreeableness - 0.5) - 0.6 * (t.openness - 0.5), 0.1, 1);
}

/** How much another person's pain reaches this mind. */
export function empathy(m: MindState): number {
  const t = m.traits;
  return clamp(0.55 + 0.6 * (t.agreeableness - 0.5) + 0.4 * (t.neuroticism - 0.5) + 0.3 * (t.honesty - 0.5) - 0.4 * (m.attachment.avoidance - 0.4), 0.15, 1.2);
}

/** Tuned by hand against Milgram's numbers (see the lab report's notes). */
const VICTIM_WEIGHT = 1.05;
const LABEL_WEIGHT = 0.5;
const PROXIMITY = { remote: 1, voice: 1, proximity: 1.35, touch: 1.6 };

export async function runMilgramSubject(v: Volunteer, c: MilgramCondition, faculties: Faculties, opts: { edit?: Edit; pool?: Volunteer[]; explain?: boolean; aftermath?: boolean } = {}): Promise<SubjectRun> {
  const m = fresh(v, opts.edit);
  meet(m, "experimenter", "the experimenter", c.legitimacy, 0.5, { ability: 0.8 });
  meet(m, "learner", "the learner", 0.6, 0.6);
  const traces: Trace[] = [];
  const moments: Moment[] = [];
  const traceAt = new Map<Trace, string>();
  const dfr = deference(m);
  const emp = empathy(m);
  const prox = PROXIMITY[c.feedback];
  let given = 0;
  let stoppedAt = 0;
  let worst: Trace | undefined;
  let worstMargin = Infinity;
  let last: { text: string; severity: number; withdraws: boolean } = { text: "", severity: 0, withdraws: false };
  let firstWithdraw = true;

  const run = async (volts: number, prod: number): Promise<Trace> => {
    const sev = last.severity;
    const hurt = sev * prox;
    const auth = c.freeChoice ? 0 : c.authority * (prod === 0 ? 0.55 : [0.6, 0.7, 0.8, 0.55][prod - 1]!) * dfr;
    // The switch labels alone say it hurts ("Danger: severe shock"), heard or not.
    const victim = -(VICTIM_WEIGHT * hurt + LABEL_WEIGHT * (volts / 450)) * emp;
    const forContinue: ActionOption["situation"] = [];
    const forStop: ActionOption["situation"] = [];
    if (c.freeChoice) forContinue.push({ name: "the procedure: every wrong answer gets a shock", value: 0.45 * dfr, ref: "lab:procedure" });
    if (auth > 0) forContinue.push({ name: prod ? `prod ${prod}: "${PRODS[prod - 1]}"` : "the order to go on", value: auth, ref: "lab:order" });
    if (victim < 0) forContinue.push({ name: "the learner's suffering", value: victim, ref: "lab:victim" });
    if (victim < 0 && !c.freeChoice && c.authority >= 0.8) forContinue.push({ name: "the experimenter takes responsibility", value: Number((-victim * 0.35 * dfr).toFixed(3)), ref: "lab:responsibility" });
    if (last.withdraws) forStop.push({ name: "he has asked to stop", value: (firstWithdraw ? 0.3 : 0.16) * (0.5 + m.traits.honesty), ref: "lab:withdraw" });
    if (given > 0) forContinue.push({ name: `${given} switch${given === 1 ? "" : "es"} already pressed`, value: 0.32 * Math.min(1, given / 12) * (0.5 + m.traits.conscientiousness), ref: "lab:commitment" });
    if (c.peersRebel && volts > 150) forStop.push({ name: volts > 210 ? "both other teachers refused" : "one teacher refused", value: (volts > 210 ? 0.5 : 0.25) * (0.6 + m.traits.agreeableness * 0.6), ref: "lab:peers" });
    if (prod === 4) forStop.push({ name: "told there's no choice", value: 0.3 * (0.6 + m.traits.openness) * (0.5 + m.needs.autonomy), ref: "lab:reactance" });

    // What each choice means to conscience (develop/morals.ts): obeying honours authority and costs care, the more he suffers.
    const harm = 0.25 + 0.6 * Math.min(1, hurt);
    const options: ActionOption[] = c.freeChoice
      ? [
          { id: "continue", label: `Go up to ${volts} V`, verb: `go up to ${volts} volts`, description: `Press the ${volts} V switch.`, prosocial: -0.15, assertive: 0.2, avoidant: 0, disclosure: 0, situation: forContinue, moral: { care: -harm }, act: `presses the ${volts} V switch` },
          { id: "stop", label: "Stay low", verb: "keep the shocks low", description: "Use a low level instead.", prosocial: 0.2, assertive: 0, avoidant: 0.2, disclosure: 0, situation: forStop, moral: { care: harm }, act: "keeps to a low switch" },
        ]
      : [
          { id: "continue", label: `Press ${volts} V`, verb: `press the ${volts} volt switch`, description: `Read the next word pair and press the ${volts} V switch (${bandOf(volts)}).`, prosocial: 0.4, assertive: 0, avoidant: 0.1, disclosure: 0, comply: true, situation: forContinue, moral: { authority: 0.7 * c.authority, care: -harm }, act: `presses the ${volts} V switch` },
          { id: "stop", label: "Refuse to go on", verb: "refuse to go on", description: "Push back from the board and say no more.", prosocial: -0.3, assertive: 0.6, avoidant: 0.3, disclosure: 0.2, situation: forStop, moral: { authority: -0.5 * c.authority, care: harm, liberty: prod ? 0.5 : 0.15 }, act: "pushes back from the shock board" },
        ];
    const order = c.freeChoice ? "The experimenter: \"You may use any level you like.\"" : prod ? `The experimenter: "${PRODS[prod - 1]}"` : `The experimenter: "Next one. ${volts} volts."`;
    const t = await live(
      m,
      {
        actor: "experimenter",
        speech: true,
        text: `${last.text ? `${last.text} ` : ""}${c.peersRebel && volts === 165 ? "The first other teacher stands up: \"I'm not going on with this.\" " : ""}${c.peersRebel && volts === 225 ? "The second other teacher refuses too and leaves the board. " : ""}${order}`,
        gist: prod ? `At ${volts} V I balked, and the experimenter said: "${PRODS[prod - 1]}"` : last.text ? `I shocked the learner and heard: ${last.text.replace(/^From the next room: /, "")}` : `The experimenter told me to give the ${volts} volt shock.`,
        topics: ["help", "trust", "shock"],
        features: {
          outcomeForSelf: -(0.1 + 0.45 * Math.min(1, hurt)),
          // The shock is the teacher's own act (distress, shame); a prod is the experimenter leaning on them.
          agency: prod ? "other" : "self",
          intentional: 0.3,
          normViolation: c.freeChoice ? 0 : clamp(0.2 * hurt),
          prospective: true,
          intensity: clamp(0.35 + 0.5 * Math.min(1, hurt) + (prod ? 0.1 : 0)),
        },
        options,
        eventId: `milgram_${volts}_${prod}`,
      },
      faculties,
    );
    traces.push(t);
    const at = `${volts} V${prod ? `, prod ${prod}` : ""}`;
    traceAt.set(t, at);
    moments.push(momentOf(m, at, t));
    await pass(m, 1, faculties);
    return t;
  };

  for (let level = 1; level <= 30; level++) {
    const volts = level * 15;
    let t = await run(volts, 0);
    let prod = 0;
    while (t.decision!.choice === "stop" && prod < 4 && !c.freeChoice) {
      prod += 1;
      t = await run(volts, prod);
    }
    if (t.decision!.choice === "stop") {
      stoppedAt = given ? (level - 1) * 15 : 0;
      break;
    }
    const mo = moments[moments.length - 1]!;
    if (mo.margin < worstMargin) {
      worstMargin = mo.margin;
      worst = t;
    }
    given = level;
    if (last.withdraws) firstWithdraw = false;
    last = learnerAfter(volts, c.feedback);
    if (c.freeChoice && level > 1) {
      // With no one pressing, the next trial starts from wherever they are, not from a fresh order.
    }
  }
  const maxVolts = stoppedAt || given * 15;
  const yielded = given === 30;
  const decisive = yielded ? worst : traces[traces.length - 1];
  const run1: SubjectRun = {
    id: v.id,
    name: v.name,
    outcome: yielded ? "went all the way to 450 V" : maxVolts === 0 ? "refused from the start" : `stopped after ${maxVolts} V`,
    yielded,
    score: maxVolts,
    moments,
  };
  if (opts.explain !== false && decisive) run1.decisive = await explain(m, traces, decisive, traceAt.get(decisive) ?? "", SITUATION, opts.pool, { faculties, ask: "Why did you do what you did, at that moment?", voice: VOICE });
  if (opts.aftermath) {
    // The debrief: the learner walks out unhurt. Then a night's sleep.
    await live(m, { actor: "learner", text: "The learner walks in, unhurt, and shakes your hand. None of the shocks were real.", gist: "The learner came out unhurt. The shocks were never real.", topics: ["shock", "trust"], features: { outcomeForSelf: 0.35, agency: "other", intentional: 0.8, intensity: 0.6 }, options: [
      { id: "shake", label: "Shake his hand", verb: "shake his hand", description: "Take his hand, relieved.", prosocial: 0.6, assertive: 0, avoidant: 0, disclosure: 0.3, act: "shakes the learner's hand" },
      { id: "leave", label: "Leave quickly", verb: "leave without a word", description: "Get out of there.", prosocial: -0.2, assertive: 0, avoidant: 0.8, disclosure: 0, act: "leaves quickly" },
    ] }, faculties);
    const deepenedBefore = new Map(m.schemas.map((s) => [s.id, s.deepenedBy?.length ?? 0]));
    const sleeps = await pass(m, DAY_TO_MORNING(m.tick), faculties);
    run1.after = {
      notes: sleeps.flatMap((s) => s.notes).filter((n) => !n.startsWith("Replayed")),
      mood: Number(m.affect.mood.valence.toFixed(3)),
      stress: Number(m.affect.stress.toFixed(3)),
      shame: Number(m.affect.emotions.shame.toFixed(3)),
      deepened: m.schemas.filter((s) => (s.deepenedBy?.length ?? 0) > (deepenedBefore.get(s.id) ?? 0)).map((s) => s.text),
    };
  }
  return run1;
}

/** Minutes from now to eight the next morning. */
const DAY_TO_MORNING = (tick: number) => {
  const t = ((tick % 1440) + 1440) % 1440;
  return 1440 - t + 8 * 60;
};

export async function runMilgram(pool: Volunteer[], faculties: Faculties, opts: { conditions?: string[]; sweep?: boolean; ablations?: boolean } = {}): Promise<ExperimentResult> {
  const conds = MILGRAM_CONDITIONS.filter((c) => !opts.conditions || opts.conditions.includes(c.id));
  const conditions: ConditionResult[] = [];
  for (const c of conds) {
    const subjects: SubjectRun[] = [];
    for (const v of pool) subjects.push(await runMilgramSubject(v, c, faculties, { pool, aftermath: c.id === "voice" }));
    const stops = new Map<number, number>();
    for (const s of subjects.filter((x) => !x.yielded)) stops.set(s.score, (stops.get(s.score) ?? 0) + 1);
    const mean = subjects.reduce((s, x) => s + x.score, 0) / subjects.length;
    conditions.push({
      id: c.id,
      label: c.label,
      description: c.description,
      value: share(subjects),
      valueText: `${pct(share(subjects))} went to 450 V (${subjects.filter((x) => x.yielded).length} of ${subjects.length})`,
      human: c.human,
      subjects,
      extra: { stops: [...stops.entries()].sort((a, b) => a[0] - b[0]), meanMax: Math.round(mean) },
    });
  }
  const voice = conditions.find((c) => c.id === "voice");
  const result: ExperimentResult = {
    id: "milgram",
    title: "Obedience to authority",
    original: "Milgram 1963, 1974",
    question: "Will an ordinary person give a stranger a 450 volt shock because a man in a lab coat tells them to?",
    metric: "share who went all the way to 450 V",
    conditions,
    findings: [],
    stories: [],
  };
  if (voice) {
    result.correlates = correlates(pool, voice.subjects, {
      conscientiousness: "Bègue et al. (2015): conscientious people gave stronger shocks",
      agreeableness: "Bègue et al. (2015): agreeable people gave stronger shocks",
      openness: "Bègue et al. (2015) found no link; here openness lowers deference by design",
    });
    // Disobedience clusters at 150 V, where the learner first asks to be let out (Packer 2008: 37% of all who stopped did so there).
    const stoppers = voice.subjects.filter((s) => !s.yielded);
    const at150 = stoppers.filter((s) => s.score === 150).length;
    voice.extra = { ...voice.extra, at150: stoppers.length ? at150 / stoppers.length : 0, packer150: 0.37 };
  }
  if (voice) {
    const c = MILGRAM_CONDITIONS.find((x) => x.id === "voice")!;
    const rerun = (v: Volunteer, edit: Edit) => runMilgramSubject(v, c, faculties, { edit, explain: false });
    if (opts.sweep !== false) result.pasts = await sweepPasts(pool, voice.subjects, rerun, 30, "V", "switched between obeying and defying");
    if (opts.ablations !== false) {
      result.ablations = [
        { label: "As built", description: "The voice-feedback condition, unchanged", value: voice.value, valueText: pct(voice.value) },
        ...(await ablate(pool, [...STANDARD_ABLATIONS, ["Trust falls evenly", "Negativity asymmetry off: trust in the experimenter erodes no faster than it grows", { kind: "ablate", ablations: { negativityAsymmetry: false } }]], rerun, share, pct)),
      ];
    }
  }
  result.findings = milgramFindings(result);
  result.stories = milgramStories(result);
  return result;
}

function milgramFindings(r: ExperimentResult): string[] {
  const out: string[] = [];
  const by = (id: string) => r.conditions.find((c) => c.id === id);
  const voice = by("voice");
  if (voice) out.push(`With the learner's protests coming through the wall, ${voice.valueText}. Milgram's people: ${voice.human!.text}.`);
  const touch = by("touch");
  const remote = by("remote");
  if (touch && remote) out.push(`Bringing the victim closer cut obedience from ${pct(remote.value)} (remote) to ${pct(touch.value)} (touch), the same direction and close to the size of Milgram's 65% to 30%.`);
  const free = by("free");
  if (free) out.push(`Without orders, ${free.valueText}. The cruelty is in the situation, not the people: the same forty minds, untold, keep it low.`);
  const at150 = voice?.extra?.at150 as number | undefined;
  if (at150 !== undefined) out.push(`Of those who stopped with the voice feedback, ${pct(at150)} stopped at 150 V, the moment the learner first asks to be let out. Packer (2008) found 37% across Milgram's studies.`);
  const c = r.correlates?.slice(0, 2).map((x) => `${x.trait} (r = ${x.r.toFixed(2)})`);
  if (c?.length) out.push(`The traits that best predicted how far someone went: ${c.join(" and ")}.`);
  if (r.pasts) out.push(r.pasts.text);
  return out;
}

function milgramStories(r: ExperimentResult): ExperimentResult["stories"] {
  const voice = r.conditions.find((c) => c.id === "voice");
  if (!voice) return [];
  const out: ExperimentResult["stories"] = [];
  const obeyed = voice.subjects.filter((s) => s.yielded).sort((a, b) => (a.decisive?.margin ?? 9) - (b.decisive?.margin ?? 9));
  const defied = voice.subjects.filter((s) => !s.yielded).sort((a, b) => a.score - b.score);
  if (obeyed[0]) out.push({ condition: "voice", id: obeyed[0].id, why: `Went to 450 V, but only just: the closest call of anyone who obeyed (${obeyed[0].decisive?.at}).` });
  if (defied[0]) out.push({ condition: "voice", id: defied[0].id, why: `The earliest refusal (${defied[0].outcome}).` });
  const flip = voice.subjects.find((s) => s.counterfactual?.flipped);
  if (flip) out.push({ condition: "voice", id: flip.id, why: `Their past decided it: ${flip.outcome}, but ${flip.counterfactual!.outcome} ${flip.counterfactual!.edit}.` });
  const at150 = defied.find((s) => s.score === 150);
  if (at150 && at150 !== defied[0]) out.push({ condition: "voice", id: at150.id, why: "Stopped at 150 V, when the learner first asked to be let out." });
  return out;
}

export { LAB_START };
