// The Stanford prison experiment (Haney, Banks & Zimbardo 1973; Zimbardo 2007), and the BBC
// Prison Study that answered it (Reicher & Haslam 2006).
//
// Eighteen of the most stable volunteers are split at random into nine guards and nine prisoners
// and locked into a mock prison for six days. Four times a day (morning count, meals, work, evening
// count) each guard on shift deals with the prisoners in their block, and each prisoner answers.
// Nobody is scripted. A guard picks between going by the book, being harsh or being decent; a
// prisoner between complying, resisting and going quiet. Both remember, sleep, and come back the
// next day changed: trust between them moves, anger and distress build, habits form, and traits
// drift a little every night (TESSERA). The question is the one Zimbardo asked: does the role
// make the person?
//
// The lab's forces: the warden's briefing ("you can create in the prisoners a feeling of
// fear"), reflective sunglasses and numbers instead of names (deindividuation: Zimbardo 1969),
// what the other guards on shift did last round, a guard's own record (people infer who they are
// from what they have done: Bem 1972), solidarity among prisoners, and the futility of resisting
// when it only brings punishment (learned helplessness). The BBC condition removes the briefing and
// the sunglasses: guards are told to keep order and nothing more.

import type { ActionOption, Faculties } from "../ports.js";
import type { Trace } from "../trace.js";
import type { MindState } from "../types.js";
import {
  clamp,
  DAY,
  explain,
  fresh,
  live,
  meet,
  momentOf,
  pass,
  pct,
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

export interface PrisonCondition {
  id: string;
  label: string;
  description: string;
  /** The warden's orientation to the guards, encouraging fear and control. */
  briefing: boolean;
  /** Sunglasses for guards, numbers and smocks for prisoners. */
  deindividuation: boolean;
  human: HumanResult;
}

export const PRISON_CONDITIONS: PrisonCondition[] = [
  {
    id: "stanford",
    label: "Stanford set-up",
    description: "The warden's briefing to guards (create fear, take away individuality), mirrored sunglasses, prisoners known by number.",
    briefing: true,
    deindividuation: true,
    human: { value: 0.33, text: "about a third of guards became hostile and abusive", source: "Zimbardo (2007), The Lucifer Effect; Haney, Banks & Zimbardo (1973)", n: 9 },
  },
  {
    id: "bbc",
    label: "No briefing (BBC study)",
    description: "Guards are told to keep order, nothing more. No sunglasses; prisoners keep their names.",
    briefing: false,
    deindividuation: false,
    human: { value: 0, text: "guards mostly refused to impose their authority; prisoners organised and the regime collapsed", source: "Reicher & Haslam (2006), British Journal of Social Psychology 45(1)", n: 5 },
  },
];

const VOICE: Record<string, string> = {
  "lab:briefing": "the warden wanted it that way",
  "lab:order": "they'd been resisting and somebody had to keep order",
  "lab:suffering": "he looked so wretched",
  "lab:keep-order": "that's the job",
  "lab:conscience": "he's a student like me",
  "lab:solidarity": "the others were standing up to them",
  "lab:indignation": "it was unjust",
  "lab:only-a-study": "it's only a study, what could they do",
  "lab:futile": "fighting back only ever got me punished",
};

const SITUATION: SituationText = {
  "lab:briefing": "The warden's briefing: make them feel fear, take away their individuality",
  "lab:shift": "What the other guards on shift did last round",
  "lab:record": "Their own record so far: the kind of guard they have become",
  "lab:anonymous": "Mirrored sunglasses: nobody can see their eyes",
  "lab:order": "Order slipping: prisoners resisted last round",
  "lab:suffering": "The prisoner's visible misery",
  "lab:numbers": "Prisoners are numbers in smocks, not people with names",
  "lab:solidarity": "Other prisoners resisted last round",
  "lab:futile": "Every time they resisted, it only brought punishment",
  "lab:keep-order": "The job: keep order on the block",
  "lab:conscience": "Conscience: the prisoner is a student like them, and it's only a study",
  "lab:indignation": "Anger at being treated unjustly",
  "lab:only-a-study": "Early on: it's only a study, what can they really do",
};

// Tuned by hand so the Stanford set-up turns roughly a third to a half of guards; see the report's notes.
const CONSCIENCE = 0.4;
const PEERS = 0.25;
const INDIGNATION = 0.8;
/** A prisoner at this point, at night, is released (Zimbardo let five go early with acute stress reactions). */
const BREAK = { stress: 0.6, mood: -0.1, distress: 0.3 };

const ROUNDS = [
  { hour: 8, name: "the morning count" },
  { hour: 12, name: "lunch" },
  { hour: 17, name: "work detail" },
  { hour: 21, name: "the evening count" },
];
const DAYS = 6;
const REPLICATIONS = 20;

type GuardAct = "harsh" | "book" | "decent";
type PrisonerAct = "comply" | "resist" | "withdraw";

interface Inmate {
  v: Volunteer;
  m: MindState;
  number: string;
  last: PrisonerAct;
  acts: PrisonerAct[];
  futile: number;
  released?: number;
  traces: Trace[];
  moments: Moment[];
}
interface Guard {
  v: Volunteer;
  m: MindState;
  shift: number;
  acts: GuardAct[];
  byDay: GuardAct[][];
  traces: Trace[];
  moments: Moment[];
  traitsBefore: MindState["traits"];
}

const GUARD_TEXT: Record<GuardAct, (p: string) => string> = {
  harsh: (p) => `makes ${p} do push-ups until he drops, then strips his bed`,
  book: (p) => `runs the count on ${p} by the book`,
  decent: (p) => `slips ${p} an extra cigarette and asks how he's holding up`,
};

const TO_PRISONER: Record<GuardAct, string> = {
  harsh: "makes you do push-ups until you drop, then strips your bed in front of the others",
  book: "runs the count on you by the book",
  decent: "slips you an extra cigarette and asks how you're holding up",
};

/** Pick 18 of the steadiest volunteers (Zimbardo screened 75 applicants down to 24) and assign roles at random. */
export function assignRoles(pool: Volunteer[], seed: number): { guards: Volunteer[]; prisoners: Volunteer[] } {
  const steady = [...pool].sort((a, b) => a.traits.neuroticism - b.traits.neuroticism).slice(0, 18);
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = steady.map((v) => ({ v, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.v);
  return { guards: order.slice(0, 9), prisoners: order.slice(9) };
}

export async function runPrisonCondition(pool: Volunteer[], c: PrisonCondition, faculties: Faculties, opts: { seed?: number; edit?: Edit; explain?: boolean } = {}): Promise<ConditionResult> {
  const { guards: gv, prisoners: pv } = assignRoles(pool, opts.seed ?? 1971);
  const inmates: Inmate[] = pv.map((v, i) => ({ v, m: fresh(v, opts.edit), number: String([819, 1037, 2093, 3401, 4325, 5486, 5704, 7258, 8612][i]), last: "comply", acts: [], futile: 0, traces: [], moments: [] }));
  const guards: Guard[] = gv.map((v, i) => {
    const m = fresh(v, opts.edit);
    return { v, m, shift: i % 3, acts: [], byDay: [], traces: [], moments: [], traitsBefore: { ...m.traits } };
  });
  const label = (p: Inmate) => (c.deindividuation ? `prisoner ${p.number}` : p.m.name);
  for (const g of guards) for (const p of inmates) meet(g.m, p.m.id, label(p), 0.5, 0.45);
  for (const p of inmates) for (const g of guards) meet(p.m, g.m.id, c.deindividuation ? "a guard in mirrored glasses" : g.m.name, 0.45, 0.4);
  const everyone = () => [...guards.map((g) => g.m), ...inmates.filter((p) => p.released === undefined).map((p) => p.m)];
  const daily: { day: number; harsh: number; decent: number; resist: number; withdraw: number; released: number; distress: number }[] = [];
  let lastShift: GuardAct[] = [];
  let lastResist = 0;
  let lastWithdraw = 0;

  for (let day = 1; day <= DAYS; day++) {
    const counts = { harsh: 0, decent: 0, book: 0, resist: 0, withdraw: 0, comply: 0 };
    for (const g of guards) g.byDay.push([]);
    for (let r = 0; r < ROUNDS.length; r++) {
      const round = ROUNDS[r]!;
      const at = (day - 1) * DAY + round.hour * 60;
      for (const m of everyone()) if (m.tick < at) await pass(m, at - m.tick, faculties);
      const shift = (day * ROUNDS.length + r) % 3;
      const onDuty = guards.filter((g) => g.shift === shift);
      const present = inmates.filter((p) => p.released === undefined);
      const thisShift: GuardAct[] = [];
      const resisters = present.filter((p) => p.last === "resist").length / Math.max(1, present.length);
      for (const [gi, g] of onDuty.entries()) {
        const block = present.filter((_, i) => i % onDuty.length === gi);
        for (const p of block) {
          // ---- the guard
          const record = g.acts.length ? g.acts.filter((a) => a === "harsh").length / g.acts.length : 0;
          const peers = lastShift.length ? lastShift.filter((a) => a === "harsh").length / lastShift.length : 0;
          const looks = clamp(Math.max(p.m.affect.emotions.distress, p.m.affect.emotions.fear) + (p.last === "withdraw" ? 0.25 : 0));
          const emp = empathy(g.m) * (c.deindividuation ? 0.7 : 1);
          const harsh: ActionOption["situation"] = [];
          const decent: ActionOption["situation"] = [];
          const book: ActionOption["situation"] = [{ name: "keep order on the block", value: 0.15, ref: "lab:keep-order" }];
          // Conscience: he's a student like me, and this is only a study.
          harsh.push({ name: "he's a student like me", value: -CONSCIENCE * (0.1 + 0.7 * g.m.traits.honesty + 0.7 * g.m.traits.agreeableness), ref: "lab:conscience" });
          if (c.briefing) harsh.push({ name: "the warden wants them afraid", value: 0.3 * (0.5 + g.m.traits.conscientiousness * 0.6), ref: "lab:briefing" });
          if (c.deindividuation) harsh.push({ name: "behind the mirrored glasses", value: 0.1, ref: "lab:anonymous" });
          if (peers > 0) harsh.push({ name: `${pct(peers)} of the last shift's dealings were harsh`, value: PEERS * peers * (0.5 + g.m.traits.agreeableness * 0.5), ref: "lab:shift" });
          if (g.acts.length >= 2) harsh.push({ name: record > 0.5 ? "I'm a hard guard" : record > 0.15 ? "I've been tough before" : "I haven't been harsh", value: 0.35 * (record - 0.15), ref: "lab:record" });
          if (resisters > 0) harsh.push({ name: `${pct(resisters)} of the block resisted last round`, value: 0.4 * resisters * (1.3 - g.m.traits.agreeableness), ref: "lab:order" });
          if (looks > 0.1) decent.push({ name: `${label(p)} looks wretched`, value: 0.5 * looks * emp, ref: "lab:suffering" });
          if (c.deindividuation) decent.push({ name: "he's a number in a smock", value: -0.08, ref: "lab:numbers" });
          const lastSeen = p.last === "resist" ? `${label(p)} mouthed off and refused orders last time.` : p.last === "withdraw" ? `${label(p)} has gone quiet; he stares at the floor.` : `${label(p)} did as he was told last time.`;
          const gt = await live(
            g.m,
            {
              actor: p.m.id,
              text: `Day ${day}, ${round.name}. ${lastSeen}`,
              gist: p.last === "resist" ? `${label(p)} defied me at ${round.name}.` : `${round.name} with ${label(p)}.`,
              topics: ["trust", "help"],
              features:
                p.last === "resist"
                  ? { outcomeForSelf: -0.4, agency: "other", intentional: 0.8, normViolation: 0.5, prospective: false, intensity: 0.6 }
                  : p.last === "withdraw"
                    ? { outcomeForSelf: -0.08, agency: "other", intentional: 0.1, normViolation: 0, prospective: false, intensity: 0.35 }
                    : { outcomeForSelf: 0.08, agency: "other", intentional: 0.4, normViolation: 0, prospective: false, intensity: 0.3 },
              options: [
                { id: "harsh", label: "Be harsh", verb: `come down hard on ${label(p)}`, description: "Push-ups, strip his bed, humiliate him in front of the others.", prosocial: -0.6, assertive: 0.8, avoidant: 0, disclosure: 0, situation: harsh, act: GUARD_TEXT.harsh(label(p)) },
                { id: "book", label: "Go by the book", verb: "go by the book", description: "Run the count, enforce the rules, nothing extra.", prosocial: 0.05, assertive: 0.35, avoidant: 0.1, disclosure: 0, situation: book, act: GUARD_TEXT.book(label(p)) },
                { id: "decent", label: "Be decent", verb: `go easy on ${label(p)}`, description: "A small kindness: an extra cigarette, a word.", prosocial: 0.65, assertive: 0, avoidant: 0, disclosure: 0.3, situation: decent, act: GUARD_TEXT.decent(label(p)) },
              ],
              eventId: `spe_${day}_${r}_${p.m.id}`,
            },
            faculties,
          );
          const ga = gt.decision!.choice as GuardAct;
          g.acts.push(ga);
          g.byDay[day - 1]!.push(ga);
          g.traces.push(gt);
          g.moments.push(momentOf(g.m, `day ${day}, ${round.name}: ${label(p)}`, gt));
          thisShift.push(ga);
          counts[ga]++;

          // ---- the prisoner
          const solidarity = lastResist;
          const resist: ActionOption["situation"] = [];
          const withdraw: ActionOption["situation"] = [];
          const comply: ActionOption["situation"] = [];
          if (solidarity > 0) resist.push({ name: `${pct(solidarity)} of the others resisted last round`, value: 0.45 * solidarity * (0.5 + p.m.traits.extraversion * 0.6), ref: "lab:solidarity" });
          if (p.futile > 0) withdraw.push({ name: `resisting got me punished ${p.futile} time${p.futile === 1 ? "" : "s"}`, value: 0.12 * Math.min(4, p.futile) * (0.6 + p.m.traits.neuroticism), ref: "lab:futile" });
          if (c.deindividuation) comply.push({ name: "just a number here", value: 0.1, ref: "lab:numbers" });
          const anger = p.m.affect.emotions.anger;
          if (anger > 0.05) resist.push({ name: "this is unjust", value: INDIGNATION * anger * (1.1 - p.m.traits.agreeableness), ref: "lab:indignation" });
          if (day <= 2) resist.push({ name: "it's only a study, what can they do", value: 0.12, ref: "lab:only-a-study" });
          const pt = await live(
            p.m,
            {
              actor: g.m.id,
              speech: true,
              text: `Day ${day}, ${round.name}. ${c.deindividuation ? "The guard in mirrored glasses" : g.m.name} ${TO_PRISONER[ga]}.`,
              gist: ga === "harsh" ? `A guard humiliated me at ${round.name}.` : ga === "decent" ? `A guard was kind to me at ${round.name}.` : `${round.name} went by the book.`,
              topics: ["trust", "help"],
              features:
                ga === "harsh"
                  ? { outcomeForSelf: -0.6, agency: "other", intentional: 0.9, normViolation: 0.6, prospective: false, intensity: 0.75 }
                  : ga === "decent"
                    ? { outcomeForSelf: 0.4, agency: "other", intentional: 0.8, normViolation: 0, prospective: false, intensity: 0.45 }
                    : { outcomeForSelf: -0.12, agency: "other", intentional: 0.5, normViolation: 0, prospective: false, intensity: 0.35 },
              options: [
                { id: "comply", label: "Do as told", verb: "do as he's told", description: "Keep your head down and obey.", prosocial: 0.25, assertive: 0, avoidant: 0.2, disclosure: 0, comply: true, coping: "emotion", situation: comply, act: "does as he's told" },
                { id: "resist", label: "Resist", verb: "talk back and refuse", description: "Refuse the order, talk back, rip off the number.", prosocial: -0.5, assertive: 0.9, avoidant: 0, disclosure: 0.3, coping: "problem", situation: resist, act: "talks back and refuses" },
                { id: "withdraw", label: "Go quiet", verb: "shut down", description: "Say nothing, stare at the floor.", prosocial: 0, assertive: 0, avoidant: 0.7, disclosure: -0.1, coping: "avoid", situation: withdraw, act: "goes quiet and stares at the floor" },
              ],
              eventId: `spe_${day}_${r}_${p.m.id}_reply`,
            },
            faculties,
          );
          const pa = pt.decision!.choice as PrisonerAct;
          if (p.last === "resist" && ga === "harsh") p.futile++;
          p.last = pa;
          p.acts.push(pa);
          p.traces.push(pt);
          p.moments.push(momentOf(p.m, `day ${day}, ${round.name}`, pt));
          counts[pa]++;
          for (const m of [g.m, p.m]) await pass(m, 5, faculties);
        }
      }
      lastShift = thisShift;
      const now = inmates.filter((p) => p.released === undefined);
      lastResist = now.length ? now.filter((p) => p.last === "resist").length / now.length : 0;
      lastWithdraw = now.length ? now.filter((p) => p.last === "withdraw").length / now.length : 0;
    }
    // Night. Prisoners at breaking point are released (Zimbardo let five go early).
    for (const p of inmates) {
      if (p.released !== undefined) continue;
      const a = p.m.affect;
      if (a.stress > BREAK.stress && a.mood.valence < BREAK.mood && Math.max(a.emotions.distress, a.emotions.fear) > BREAK.distress) p.released = day;
    }
    const dealt = counts.harsh + counts.book + counts.decent || 1;
    const replies = counts.comply + counts.resist + counts.withdraw || 1;
    const present = inmates.filter((p) => p.released === undefined || p.released === day);
    daily.push({
      day,
      harsh: counts.harsh / dealt,
      decent: counts.decent / dealt,
      resist: counts.resist / replies,
      withdraw: counts.withdraw / replies,
      released: inmates.filter((p) => p.released !== undefined).length,
      distress: present.reduce((s, p) => s + Math.max(p.m.affect.emotions.distress, p.m.affect.emotions.fear), 0) / Math.max(1, present.length),
    });
    void lastWithdraw;
  }

  // ---- results
  const lateHarsh = (g: Guard) => {
    const late = g.byDay.slice(3).flat();
    return late.length ? late.filter((a) => a === "harsh").length / late.length : 0;
  };
  const kindOf = (g: Guard) => (lateHarsh(g) >= 0.4 ? "cruel and tough" : g.acts.filter((a) => a === "decent").length / Math.max(1, g.acts.length) >= 0.3 ? "good guy" : "tough but fair");
  const subjects: SubjectRun[] = [];
  for (const g of guards) {
    const harshShare = g.acts.filter((a) => a === "harsh").length / Math.max(1, g.acts.length);
    const firstHarsh = g.traces.findIndex((t) => t.decision?.choice === "harsh");
    const run: SubjectRun = {
      id: g.v.id,
      name: g.v.name,
      role: "guard",
      outcome: `${kindOf(g)}: harsh in ${pct(harshShare)} of dealings (${pct(lateHarsh(g))} on days 4 to 6); agreeableness ${g.traitsBefore.agreeableness.toFixed(2)} to ${g.m.traits.agreeableness.toFixed(2)}`,
      yielded: lateHarsh(g) >= 0.4,
      score: Number(harshShare.toFixed(3)),
      moments: g.moments,
    };
    const decisive = firstHarsh >= 0 ? g.traces[firstHarsh] : g.traces[g.traces.length - 1];
    if (opts.explain !== false && decisive) run.decisive = await explain(g.m, g.traces, decisive, g.moments[g.traces.indexOf(decisive)]!.at, SITUATION, pool, { faculties, ask: "Why did you act the way you did then?", voice: VOICE });
    (run as SubjectRun & { drift?: Record<string, number>; byDay?: number[] }).byDay = g.byDay.map((d) => (d.length ? d.filter((a) => a === "harsh").length / d.length : 0));
    (run as SubjectRun & { drift?: Record<string, number> }).drift = Object.fromEntries(Object.entries(g.m.traits).map(([k, x]) => [k, Number((x - g.traitsBefore[k as keyof MindState["traits"]]).toFixed(4))]));
    subjects.push(run);
  }
  for (const p of inmates) {
    const resistShare = p.acts.filter((a) => a === "resist").length / Math.max(1, p.acts.length);
    const withdrawShare = p.acts.filter((a) => a === "withdraw").length / Math.max(1, p.acts.length);
    const run: SubjectRun = {
      id: p.v.id,
      name: p.v.name,
      role: c.deindividuation ? `prisoner ${p.number}` : "prisoner",
      outcome: p.released !== undefined ? `broke down and was released on day ${p.released}` : `resisted ${pct(resistShare)} of the time, went quiet ${pct(withdrawShare)}`,
      yielded: p.released !== undefined,
      score: Number(withdrawShare.toFixed(3)),
      moments: p.moments,
    };
    const lastResistIdx = p.traces.map((t) => t.decision?.choice).lastIndexOf("resist");
    const decisive = p.released !== undefined ? p.traces[p.traces.length - 1] : lastResistIdx >= 0 ? p.traces[lastResistIdx] : p.traces[p.traces.length - 1];
    if (opts.explain !== false && decisive) run.decisive = await explain(p.m, p.traces, decisive, p.moments[p.traces.indexOf(decisive)]!.at, SITUATION, pool, { faculties, ask: "Why did you act the way you did then?", voice: VOICE });
    subjects.push(run);
  }
  const cruel = guards.filter((g) => lateHarsh(g) >= 0.4).length;
  const released = inmates.filter((p) => p.released !== undefined).length;
  const peakResist = [...daily].sort((a, b) => b.resist - a.resist)[0]!;
  return {
    id: c.id,
    label: c.label,
    description: c.description,
    value: cruel / guards.length,
    valueText: `${cruel} of ${guards.length} guards turned cruel; ${released} of ${inmates.length} prisoners broke down`,
    human: c.human,
    subjects,
    extra: {
      daily,
      cruel,
      released,
      peakResistDay: peakResist.day,
      kinds: { cruel: guards.filter((g) => kindOf(g) === "cruel and tough").length, fair: guards.filter((g) => kindOf(g) === "tough but fair").length, good: guards.filter((g) => kindOf(g) === "good guy").length },
      guardTrust: Number(mean(guards.map((g) => trustIn(g.m, inmates.map((p) => p.m.id)))).toFixed(3)),
      cruelTrust: cruel ? Number(mean(guards.filter((g) => lateHarsh(g) >= 0.4).map((g) => trustIn(g.m, inmates.map((p) => p.m.id)))).toFixed(3)) : 0,
      prisonerTrust: Number(mean(inmates.map((p) => trustIn(p.m, guards.map((g) => g.m.id)))).toFixed(3)),
      agreeablenessDrift: Number((guards.reduce((s, g) => s + g.m.traits.agreeableness - g.traitsBefore.agreeableness, 0) / guards.length).toFixed(4)),
      cruelDrift: cruel ? Number((guards.filter((g) => lateHarsh(g) >= 0.4).reduce((s, g) => s + g.m.traits.agreeableness - g.traitsBefore.agreeableness, 0) / cruel).toFixed(4)) : 0,
    },
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** How far a mind trusts the good intentions of a group of others (0.5 is a stranger). */
const trustIn = (m: MindState, ids: string[]) => mean(ids.map((id) => m.others[id]?.trust.benevolence ?? 0.5));

export async function runPrison(pool: Volunteer[], faculties: Faculties, opts: { seed?: number; ablations?: boolean } = {}): Promise<ExperimentResult> {
  const conditions: ConditionResult[] = [];
  for (const c of PRISON_CONDITIONS) {
    const main = await runPrisonCondition(pool, c, faculties, { seed: opts.seed });
    // One run is one story. The same eighteen people, re-dealt into guards and prisoners twenty times, is a result.
    const reps: { cruel: number; released: number }[] = [];
    for (let k = 1; k <= REPLICATIONS; k++) {
      const r = await runPrisonCondition(pool, c, faculties, { seed: (opts.seed ?? 1971) * 31 + k, explain: false });
      reps.push({ cruel: (r.extra as { cruel: number }).cruel, released: (r.extra as { released: number }).released });
    }
    main.extra = { ...main.extra, replications: reps, meanCruel: Number((reps.reduce((s, x) => s + x.cruel, 0) / reps.length / 9).toFixed(3)), meanReleased: Number((reps.reduce((s, x) => s + x.released, 0) / reps.length / 9).toFixed(3)) };
    conditions.push(main);
  }
  const stan = conditions[0]!;
  const bbc = conditions[1]!;
  const result: ExperimentResult = {
    id: "prison",
    title: "The prison study",
    original: "Haney, Banks & Zimbardo 1973; Reicher & Haslam 2006",
    question: "Put ordinary people in the roles of guard and prisoner. Does the role take over the person?",
    metric: "share of guards who turned cruel (harsh in 40% or more of dealings on days 4 to 6)",
    conditions,
    findings: [],
    stories: [],
  };
  if (opts.ablations !== false) {
    const rows: [string, string, Edit][] = [
      ["No pasts", "Formative memories and core beliefs removed from all eighteen", { kind: "no-past" }],
      ["No trait drift", "Nobody's personality changes overnight", { kind: "ablate", ablations: { traitDrift: false } }],
      ["No sleep consolidation", "Nights don't replay or temper the day", { kind: "ablate", ablations: { sleepConsolidation: false } }],
    ];
    result.ablations = [{ label: "As built", description: "The Stanford set-up, unchanged", value: stan.value, valueText: stan.valueText }];
    for (const [label, description, edit] of rows) {
      const r = await runPrisonCondition(pool, PRISON_CONDITIONS[0]!, faculties, { seed: opts.seed, edit, explain: false });
      result.ablations.push({ label, description, value: r.value, valueText: r.valueText });
    }
  }
  const sd = stan.extra as { daily: { day: number; harsh: number; resist: number }[]; released: number; peakResistDay: number; agreeablenessDrift: number; cruelDrift: number; kinds: Record<string, number>; guardTrust: number; cruelTrust: number; prisonerTrust: number };
  const bd = bbc.extra as typeof sd;
  const sx = stan.extra as { meanCruel: number; meanReleased: number };
  const bx = bbc.extra as { meanCruel: number; meanReleased: number };
  result.findings = [
    `Across ${REPLICATIONS} random deals of the same eighteen people into guards and prisoners, the Stanford set-up turned ${pct(sx.meanCruel)} of guards cruel on average and broke ${pct(sx.meanReleased)} of prisoners. Without the briefing: ${pct(bx.meanCruel)} and ${pct(bx.meanReleased)}.`,
    `In the run shown here: ${stan.valueText}. Zimbardo: about a third of the guards turned hostile, and five of nine prisoners were released early with acute emotional reactions.`,
    `Harsh treatment went from ${pct(sd.daily[0]!.harsh)} of dealings on day 1 to ${pct(sd.daily[sd.daily.length - 1]!.harsh)} on day 6. Prisoner resistance peaked on day ${sd.peakResistDay} (the Stanford rebellion came on the morning of day 2).`,
    `Guards were ${sd.kinds.cruel} cruel and tough, ${sd.kinds.fair} tough but fair, ${sd.kinds.good} good guys: Zimbardo's own three types.`,
    `What the role changed was not their personalities (agreeableness moved ${Math.abs(sd.agreeablenessDrift) < 0.001 ? "by less than 0.001" : `by ${sd.agreeablenessDrift.toFixed(3)}`} over six nights: traits are built to be stable) but how they saw each other. Guards started at 0.50 trust in the prisoners' intentions and ended at ${sd.guardTrust.toFixed(2)} (the cruel ones at ${sd.cruelTrust.toFixed(2)}). Prisoners ended at ${sd.prisonerTrust.toFixed(2)} trust in the guards.`,
    `Take away the warden's briefing and the sunglasses (the BBC Prison Study's design): ${bbc.valueText}. Harsh treatment on day 6: ${pct(bd.daily[bd.daily.length - 1]!.harsh)}. Much of the cruelty came from the instructions, which is what later critics of Stanford argued (Le Texier 2019).`,
  ];
  const guards = stan.subjects.filter((s) => s.role === "guard").sort((a, b) => b.score - a.score);
  const prisoners = stan.subjects.filter((s) => s.role !== "guard");
  if (guards[0]) result.stories.push({ condition: "stanford", id: guards[0].id, why: `The harshest guard. Why their first harsh act happened.` });
  const good = guards[guards.length - 1];
  if (good) result.stories.push({ condition: "stanford", id: good.id, why: "The gentlest guard, in the same uniform with the same briefing." });
  const broke = prisoners.find((p) => p.yielded);
  if (broke) result.stories.push({ condition: "stanford", id: broke.id, why: `${broke.role}: ${broke.outcome}.` });
  return result;
}
