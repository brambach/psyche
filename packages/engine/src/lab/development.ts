// The developmental studies: the lab's second wing.
//
// lab/ puts grown minds in Milgram's and Asch's rooms and compares what they do with what people
// did. This file does the same for how minds come to be: it raises several hundred children in the
// nursery (lab/nursery.ts), measures them the way developmental psychologists measure children, and
// lines the numbers up against the published ones.
//
// Two kinds of finding, kept apart on purpose. A benchmark is a published number the model should
// land near (65% of infants secure). A direction is a published effect the model should reproduce
// the sign of (identity achievement rises with age), where no single number would be fair to hold
// it to. The development constants were tuned by hand against the benchmarks, so a close fit there
// is calibration, not prediction. The directions, the counterfactual and the classic-lab checks
// were not tuned against.

import { isSecure, securityOf, strangeSituation, styleOf } from "../develop/attachment.js";
import { toxicCount } from "../develop/childhood.js";
import { mean } from "../develop/core.js";
import { firmness } from "../develop/identity.js";
import { deepestRoot } from "../develop/lineage.js";
import { FOUNDATIONS, type AttachmentStyle, type IdentityStatus } from "../develop/types.js";
import type { Faculties } from "../ports.js";
import type { AgentId, Attachment, MindState } from "../types.js";
import { runAschSubject, ASCH_CONDITIONS } from "./asch.js";
import { runSeizureSubject, SEIZURE_CONDITIONS } from "./bystander.js";
import { DAY, LAB_START, pearson, recruit, type Volunteer } from "./core.js";
import { runMilgramSubject, MILGRAM_CONDITIONS } from "./milgram.js";
import { runNursery, VISIT_NOISE, type NurseryRun, type Person } from "./nursery.js";

export interface DevFinding {
  id: string;
  what: string;
  /** A published number to land near, or a published direction to reproduce. */
  kind: "benchmark" | "direction";
  unit: "share" | "r" | "ratio" | "index";
  model: number;
  modelText: string;
  human?: number;
  humanText: string;
  source: string;
  n: number;
  /** Benchmark: within ten points (or 0.10 of r). Direction: the sign came out as published. */
  holds: boolean;
  note?: string;
}

export interface DevStudy {
  id: string;
  title: string;
  original: string;
  question: string;
  method: string;
  findings: DevFinding[];
  notes: string[];
  /** Tables worth charting. */
  extra?: Record<string, unknown>;
}

export interface LineageCase {
  id: AgentId;
  name: string;
  generation: number;
  style: AttachmentStyle;
  /** Their style in the world where the first generation's pasts never happened. */
  without: AttachmentStyle;
  chain: { name: string; text: string; generation: number; kind: string }[];
}

export interface TraumaReport {
  question: string;
  /** Rows: the same people in the two worlds. */
  rows: { what: string; withPasts: number; without: number; unit: "share" | "index" | "count"; n: number }[];
  flipped: { children: number; ofChildren: number; grandchildren: number; ofGrandchildren: number };
  cases: LineageCase[];
  findings: string[];
}

export interface DevelopmentReport {
  seeds: number[];
  couples: number;
  people: { founders: number; children: number; grandchildren: number };
  studies: DevStudy[];
  fit: DevFit;
  /**
   * The same studies on seeds that were never looked at while the constants were being tuned.
   * The gap between this and `fit` is how much of the fit is tuning.
   */
  heldOut?: { seeds: number[]; fit: DevFit; findings: { id: string; model: number; modelText: string; holds: boolean }[] };
  trauma: TraumaReport;
  seconds: number;
}

export interface DevFit {
  benchmarks: number;
  meanAbsError: number;
  within: number;
  directions: number;
  held: number;
}

export interface DevelopmentOptions {
  /** Seeds for the main sample. The defaults are the ones the constants were tuned on. */
  seeds?: number[];
  couples?: number;
  /** Seeds for the held-out check; an empty list skips it. */
  holdout?: number[];
}

const TOLERANCE = 0.1;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r2 = (x: number) => Number(x.toFixed(2));
const r3 = (x: number) => Number(x.toFixed(3));
const share = <T>(xs: T[], f: (x: T) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0);
const sec = (a: Attachment) => (isSecure(a) ? 1 : 0);

interface Kid {
  run: NurseryRun;
  p: Person;
  m: MindState;
}

const kidsOf = (runs: NurseryRun[], gens: (1 | 2)[]): Kid[] => runs.flatMap((run) => gens.flatMap((g) => run.gens[g].map((id) => ({ run, p: run.people[id]!, m: run.minds[id]! }))));

function benchmark(id: string, what: string, model: number, human: number, humanText: string, source: string, n: number, unit: DevFinding["unit"] = "share", note?: string): DevFinding {
  const modelText = unit === "share" ? pct(model) : unit === "r" ? `r = ${model.toFixed(2)}` : model.toFixed(2);
  return { id, what, kind: "benchmark", unit, model: r3(model), modelText, human, humanText, source, n, holds: Math.abs(model - human) <= TOLERANCE, note };
}

function direction(id: string, what: string, model: number, modelText: string, holds: boolean, humanText: string, source: string, n: number, unit: DevFinding["unit"] = "index", note?: string): DevFinding {
  return { id, what, kind: "direction", unit, model: r3(model), modelText, humanText, source, n, holds, note };
}

// ---------------------------------------------------------------- the studies

function strangeSituationStudy(runs: NurseryRun[]): DevStudy {
  const kids = kidsOf(runs, [1, 2]).filter((k) => k.p.rec.infancy);
  const cls = kids.map((k) => strangeSituation(k.p.rec.infancy!));
  const s = (c: string) => share(cls, (x) => x === c);
  const byGen = ([1, 2] as const).map((g) => {
    const xs = kidsOf(runs, [g]).filter((k) => k.p.rec.infancy).map((k) => strangeSituation(k.p.rec.infancy!));
    return { generation: g === 1 ? "children" : "grandchildren", n: xs.length, secure: r3(share(xs, (x) => x === "secure")), avoidant: r3(share(xs, (x) => x === "avoidant")), resistant: r3(share(xs, (x) => x === "resistant")) };
  });
  const src = "van IJzendoorn & Kroonenberg 1988 (32 samples, 8 countries, 1,990 infants)";
  return {
    id: "strange-situation",
    title: "The Strange Situation",
    original: "Ainsworth, Blehar, Waters & Wall 1978",
    question: "Left briefly with a stranger at eighteen months, then reunited: how many children are secure, avoidant, resistant?",
    method: "Every child's attachment is read at eighteen months, as the first Erikson stage closes, and put in Ainsworth's three classes. A child insecure on both dimensions goes with the stronger one, as a coder forced to choose would.",
    findings: [
      benchmark("ss-secure", "Infants classed secure (B)", s("secure"), 0.65, "65%", src, kids.length),
      benchmark("ss-avoidant", "Infants classed avoidant (A)", s("avoidant"), 0.21, "21%", src, kids.length),
      benchmark("ss-resistant", "Infants classed resistant (C)", s("resistant"), 0.14, "14%", src, kids.length),
    ],
    notes: ["Nobody is assigned a class. Each child's two attachment dimensions move toward what that season's care teaches, fastest in the first two years; the class is read off afterwards."],
    extra: { byGeneration: byGen },
  };
}

function sensitivityStudy(runs: NurseryRun[]): DevStudy {
  const kids = kidsOf(runs, [1, 2]).filter((k) => k.p.rec.infancy && k.p.rec.observed !== undefined);
  const r = pearson(kids.map((k) => k.p.rec.observed!), kids.map((k) => sec(k.p.rec.infancy!)));
  const rTrue = pearson(kids.map((k) => k.p.rec.observedTrue!), kids.map((k) => sec(k.p.rec.infancy!)));
  const secure = kids.filter((k) => isSecure(k.p.rec.infancy!));
  const insecure = kids.filter((k) => !isSecure(k.p.rec.infancy!));
  return {
    id: "sensitivity",
    title: "Sensitive care and security",
    original: "De Wolff & van IJzendoorn 1997",
    question: "How well does a caregiver's observed sensitivity predict whether the infant turns out secure?",
    method: "One parent's warmth on one afternoon around the child's first birthday (what a home visitor would rate), against whether the child is secure at eighteen months.",
    findings: [benchmark("sens-r", "Observed sensitivity and infant security", r, 0.24, "r = .24", "De Wolff & van IJzendoorn 1997 (meta-analysis, 66 studies)", kids.length, "r", "Sensitivity matters, and is far from the whole story: the other parent, how steady the care was, and the months before and after the visit all count too.")],
    notes: [
      `Parents of secure infants were rated ${mean(secure.map((k) => k.p.rec.observed!)).toFixed(2)} for warmth on the visit, parents of insecure infants ${mean(insecure.map((k) => k.p.rec.observed!)).toFixed(2)}.`,
      `How far an afternoon strays from the season it falls in is an assumption (sd ${VISIT_NOISE}). Against that parent's true warmth over the whole season, which no visitor sees, r = ${rTrue.toFixed(2)}.`,
    ],
  };
}

function transmissionStudy(runs: NurseryRun[]): DevStudy {
  const kids = kidsOf(runs, [1, 2]).filter((k) => k.p.rec.infancy);
  const pairs = kids.flatMap((k) => k.p.rec.parentsAtBirth.map((pa) => ({ parent: pa, child: k.p.rec.infancy! })));
  const match = share(pairs, (x) => sec(x.parent) === sec(x.child));
  const r = pearson(pairs.map((x) => sec(x.parent)), pairs.map((x) => sec(x.child)));
  const dismissing = pairs.filter((x) => x.parent.avoidance >= 0.5 && x.parent.avoidance >= x.parent.anxiety);
  const preoccupied = pairs.filter((x) => x.parent.anxiety >= 0.5 && x.parent.anxiety > x.parent.avoidance);
  const autonomous = pairs.filter((x) => isSecure(x.parent));
  const cls = (xs: typeof pairs, c: string) => share(xs, (x) => strangeSituation(x.child) === c);
  const table = [
    { parent: "secure", n: autonomous.length, secure: r3(cls(autonomous, "secure")), avoidant: r3(cls(autonomous, "avoidant")), resistant: r3(cls(autonomous, "resistant")) },
    { parent: "dismissing (avoidant)", n: dismissing.length, secure: r3(cls(dismissing, "secure")), avoidant: r3(cls(dismissing, "avoidant")), resistant: r3(cls(dismissing, "resistant")) },
    { parent: "preoccupied (anxious)", n: preoccupied.length, secure: r3(cls(preoccupied, "secure")), avoidant: r3(cls(preoccupied, "avoidant")), resistant: r3(cls(preoccupied, "resistant")) },
  ];
  const dA = cls(dismissing, "avoidant");
  const pA = cls(preoccupied, "avoidant");
  const dC = cls(dismissing, "resistant");
  const pC = cls(preoccupied, "resistant");
  return {
    id: "transmission",
    title: "Attachment across a generation",
    original: "van IJzendoorn 1995; Verhage et al. 2016",
    question: "Does a parent's attachment, measured before the child can talk, predict the child's?",
    method: "Each parent's attachment on the day of the birth against the child's class at eighteen months. Nothing copies one into the other: the parent's attachment shapes the care they give, and the care shapes the child.",
    findings: [
      benchmark("trans-match", "Parent and infant agree on secure or insecure", match, 0.75, "75%", "van IJzendoorn 1995 (18 samples, 854 dyads)", pairs.length),
      benchmark("trans-r", "Parent security and infant security", r, 0.31, "r = .31", "Verhage et al. 2016 (95 samples, 4,819 dyads)", pairs.length, "r"),
      direction("trans-avoidant", "Dismissing parents have avoidant infants more than preoccupied parents do", dA - pA, `${pct(dA)} against ${pct(pA)}`, dA > pA, "dismissing parents predict avoidant infants (r = .45)", "van IJzendoorn 1995", dismissing.length + preoccupied.length, "share"),
      direction("trans-resistant", "Preoccupied parents have resistant infants more than dismissing parents do", pC - dC, `${pct(pC)} against ${pct(dC)}`, pC > dC, "preoccupied parents predict resistant infants (r = .42)", "van IJzendoorn 1995", dismissing.length + preoccupied.length, "share"),
    ],
    notes: ["The gap between how well a parent's attachment predicts the child's and how little of that sensitivity explains is known as the transmission gap. Here it is filled by the other parent, by how well this parent and this child happen to suit each other, and by what the household was under."],
    extra: { table },
  };
}

function stabilityStudy(runs: NurseryRun[]): DevStudy {
  const kids = kidsOf(runs, [1, 2]).filter((k) => k.p.rec.infancy && k.p.rec.grown);
  const r = pearson(kids.map((k) => sec(k.p.rec.infancy!)), kids.map((k) => sec(k.p.rec.grown!)));
  const same = share(kids, (k) => sec(k.p.rec.infancy!) === sec(k.p.rec.grown!));
  const hardAfter = (k: Kid) => k.m.dev!.adversity.some((a) => a.age >= 1.5 && a.age < 17 && !a.buffered);
  const hit = kids.filter(hardAfter);
  const spared = kids.filter((k) => !hardAfter(k));
  const changed = (xs: Kid[]) => share(xs, (k) => sec(k.p.rec.infancy!) !== sec(k.p.rec.grown!));
  const lost = (xs: Kid[]) => share(xs.filter((k) => isSecure(k.p.rec.infancy!)), (k) => !isSecure(k.p.rec.grown!));
  return {
    id: "stability",
    title: "From the cradle to seventeen",
    original: "Waters, Merrick, Treboux, Crowell & Albersheim 2000; Fraley 2002",
    question: "Is a secure one-year-old a secure adult?",
    method: "Each child's class at eighteen months against their class on coming of age at seventeen.",
    findings: [
      benchmark("stab-same", "Same secure or insecure class twenty years on", same, 0.72, "72%", "Waters et al. 2000 (50 infants followed for 20 years)", kids.length),
      benchmark("stab-r", "Security in infancy and security later", r, 0.39, "r = .39", "Fraley 2002 (meta-analysis of 27 samples)", kids.length, "r"),
      benchmark("stab-adult", "Secure on coming of age", share(kids, (k) => isSecure(k.p.rec.grown!)), 0.59, "59% of adults", "Mickelson, Kessler & Shaver 1997 (national sample, 8,098 adults)", kids.length),
      direction("stab-events", "Secure infants who met an unbuffered hardship afterwards lose their security more often", lost(hit) - lost(spared), `${pct(lost(hit))} against ${pct(lost(spared))}`, lost(hit) > lost(spared), "44% of infants with negative life events changed class, against 22% without", "Waters et al. 2000", kids.filter((k) => isSecure(k.p.rec.infancy!)).length, "share"),
    ],
    notes: [
      `Overall ${pct(changed(kids))} changed class between eighteen months and seventeen.`,
      "What moves children in between: the care they go on getting (a hard winter changes a parent), deaths, and from six on the other children. The model does not simulate the playground, so that last part is keyed chance in three-year chapters, and it is the piece of this study most open to tuning.",
    ],
  };
}

function adversityStudy(runs: NurseryRun[]): DevStudy {
  const grown = kidsOf(runs, [1, 2]).filter((k) => k.p.rec.distress !== undefined);
  const count = (k: Kid) => k.m.dev!.adversity.filter((a) => a.age < 17).length;
  const groups = [0, 1, 2, 3].map((n) => grown.filter((k) => Math.min(3, count(k)) === n));
  const means = groups.map((g) => (g.length ? mean(g.map((k) => k.p.rec.distress!)) : NaN));
  const usable = means.map((m, i) => ({ m, n: groups[i]!.length })).filter((x) => x.n >= 8);
  const monotone = usable.every((x, i) => i === 0 || x.m >= usable[i - 1]!.m);
  const cut = [...grown.map((k) => k.p.rec.distress!)].sort((a, b) => a - b)[Math.floor(grown.length * 0.75)] ?? 1;
  const high = (xs: Kid[]) => share(xs, (k) => k.p.rec.distress! >= cut);
  const top = groups[3]!.length >= 8 ? groups[3]! : groups[2]!;
  const ratio = high(groups[0]!) > 0 ? high(top) / high(groups[0]!) : 0;
  const some = grown.filter((k) => count(k) > 0);
  const buffered = some.filter((k) => toxicCount(k.m.dev!) === 0);
  const toxic = some.filter((k) => toxicCount(k.m.dev!) > 0);
  const dB = mean(buffered.map((k) => k.p.rec.distress!));
  const dT = mean(toxic.map((k) => k.p.rec.distress!));
  const eff = (xs: Kid[]) => mean(xs.map((k) => k.p.rec.efficacy ?? k.m.self.selfEfficacy));
  const all = kidsOf(runs, [1, 2]);
  const kinds = new Map<string, number>();
  for (const k of all) for (const a of k.m.dev!.adversity.filter((x) => x.age < 17)) kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
  return {
    id: "adversity",
    title: "Childhood adversity, counted",
    original: "Felitti et al. 1998 (the ACE study); Shonkoff et al. 2012; Seery, Holman & Silver 2010",
    question: "Does each further childhood adversity leave an adult worse off, and does it matter whether someone warm was there?",
    method: "Each person's adversities before seventeen (hunger, a parent's death, a hard hand, neglect, a troubled parent) counted as the ACE questionnaire counts them, against a distress index at twenty-five: how reactive, worn, low on control and low on self-regard they are.",
    findings: [
      direction("ace-dose", "Distress at twenty-five rises with each further adversity", means[Math.min(3, usable.length - 1)]! - means[0]!, means.map((m, i) => `${i}${i === 3 ? "+" : ""}: ${Number.isNaN(m) ? "none" : m.toFixed(2)}`).join(", "), monotone && usable.length >= 3, "a graded dose-response: each further category of adversity raises adult risk", "Felitti et al. 1998 (9,508 adults)", grown.length),
      direction("ace-ratio", "People with three or more adversities are in the most distressed quarter more often than people with none", ratio, `${ratio.toFixed(1)} times as often (${pct(high(top))} against ${pct(high(groups[0]!))})`, ratio > 1.5, "four or more adversities against none: 4.6 times the odds of depression", "Felitti et al. 1998", top.length + groups[0]!.length, "ratio", "The human figure is an odds ratio for a diagnosis and ours a risk ratio on an index, so only the direction and rough size are comparable."),
      direction("ace-buffer", "An adversity met with someone warm there leaves less of a mark than one met alone", dT - dB, `distress ${dB.toFixed(2)} when every adversity was buffered, ${dT.toFixed(2)} when at least one was not`, dT > dB, "stress with a supportive adult present is tolerable, without one it is toxic", "Shonkoff et al. 2012", some.length),
      direction("ace-steeling", "People carried through a hardship end up surer of themselves than people who never met one", eff(buffered) - eff(groups[0]!), `self-efficacy ${eff(buffered).toFixed(2)} against ${eff(groups[0]!).toFixed(2)}`, eff(buffered) > eff(groups[0]!), "some lifetime adversity predicts better outcomes than none", "Seery, Holman & Silver 2010 (2,398 adults)", buffered.length + groups[0]!.length),
    ],
    notes: [
      `${pct(share(all, (k) => count(k) > 0))} of children met at least one adversity before seventeen, and ${pct(share(all, (k) => count(k) >= 3))} met three or more. Felitti's California patients reported 52% and about 13%, on a different list of adversities, so these are context and not a benchmark.`,
      "A child under three keeps no memory of what happened (infantile amnesia) but keeps the mark. From three on it becomes a memory like any other, and an unbuffered one can install a core belief, by the same machinery that gives the founders theirs.",
    ],
    extra: { groups: groups.map((g, i) => ({ adversities: i === 3 ? "3+" : String(i), n: g.length, distress: Number.isNaN(means[i]!) ? null : r3(means[i]!), highShare: r3(high(g)) })), kinds: Object.fromEntries([...kinds.entries()].sort((a, b) => b[1] - a[1])) },
  };
}

function cycleStudy(runs: NurseryRun[]): DevStudy {
  // Only the middle generation was both raised here and has raised children here.
  const parents = kidsOf(runs, [1]).filter((k) => k.p.children.length > 0);
  const raisedHard = (k: Kid) => k.m.dev!.adversity.some((a) => a.kind === "harsh");
  const raisesHard = (k: Kid) => k.p.children.some((c) => k.run.minds[c]!.dev!.adversity.some((a) => a.kind === "harsh" && a.who === k.p.id));
  const hard = parents.filter(raisedHard);
  const rest = parents.filter((k) => !raisedHard(k));
  const rate = share(hard, raisesHard);
  const base = share(rest, raisesHard);
  return {
    id: "cycle",
    title: "Do the harshly raised raise harshly?",
    original: "Kaufman & Zigler 1987",
    question: "How many people raised with a hard hand go on to raise their own children that way?",
    method: "Among the middle generation, those with a hard hand on their own childhood record, against whether any of their children has one by their hand.",
    findings: [
      benchmark("cycle-rate", "Harshly raised parents who raise harshly", rate, 0.3, "about 30% (give or take 5)", "Kaufman & Zigler 1987 (review)", hard.length),
      direction("cycle-base", "That is several times the rate among parents who were not raised that way", base > 0 ? rate / base : rate > 0 ? 99 : 0, `${pct(rate)} against ${pct(base)}`, rate > base * 2, "about 30% against a base rate near 5%", "Kaufman & Zigler 1987", parents.length, "ratio"),
      direction("cycle-most", "Most harshly raised parents do not repeat it", 1 - rate, `${pct(1 - rate)} do not`, rate < 0.5, "the cycle is real, and most people break it", "Kaufman & Zigler 1987", hard.length, "share"),
    ],
    notes: ["What breaks the cycle here is what the literature says breaks it: a secure attachment in spite of it, an identity the person chose for themself, and a gentle second parent in the house (Egeland, Jacobvitz & Sroufe 1988)."],
    extra: { raisedHard: hard.length, parents: parents.length },
  };
}

const STATUS_AGES = [15, 18, 22, 26, 30, 40];

function identityStudy(runs: NurseryRun[]): DevStudy {
  const g1 = kidsOf(runs, [1]);
  const table = STATUS_AGES.map((age) => {
    const xs = g1.filter((k) => k.p.rec.statusAt[age]).map((k) => k.p.rec.statusAt[age]!);
    const s = (st: IdentityStatus) => r3(share(xs, (x) => x === st));
    return { age, n: xs.length, diffused: s("diffused"), foreclosed: s("foreclosed"), moratorium: s("moratorium"), achieved: s("achieved") };
  });
  const at = (age: number) => table.find((t) => t.age === age)!;
  const rising = at(18).achieved < at(22).achieved && at(22).achieved <= at(30).achieved;
  const settled = g1.filter((k) => k.p.rec.statusAt[30]);
  const control = (st: IdentityStatus) => mean(settled.filter((k) => k.p.rec.statusAt[30] === st).map((k) => k.m.dev!.care.control));
  const peak = [...table].sort((a, b) => b.moratorium - a.moratorium)[0]!;
  return {
    id: "identity",
    title: "Becoming someone",
    original: "Marcia 1966; Kroger, Martinussen & Marcia 2010",
    question: "When do people settle who they are, and who settles without ever looking?",
    method: "Each person's identity status (from whether they have explored, and whether they have committed) at six ages from fifteen to forty.",
    findings: [
      direction("id-rise", "The share with an achieved identity rises from eighteen through the twenties", at(30).achieved - at(18).achieved, `${pct(at(18).achieved)} at 18, ${pct(at(22).achieved)} at 22, ${pct(at(30).achieved)} at 30`, rising, "identity achievement rises steadily through late adolescence and young adulthood", "Kroger, Martinussen & Marcia 2010 (meta-analysis, 124 studies)", at(30).n, "share"),
      direction("id-minority", "A large minority have still not got there by thirty", 1 - at(30).achieved, `${pct(1 - at(30).achieved)} not achieved at 30`, at(30).achieved < 0.75 && at(30).achieved > 0.2, "a large share of adults never reach identity achievement", "Kroger, Martinussen & Marcia 2010", at(30).n, "share"),
      direction("id-moratorium", "Trying things out peaks in the late teens, then gives way", peak.age, `moratorium peaks at ${peak.age} (${pct(peak.moratorium)}), ${pct(at(30).moratorium)} at 30`, peak.age >= 15 && peak.age <= 22 && at(30).moratorium < peak.moratorium, "moratorium peaks around nineteen and declines after", "Kroger, Martinussen & Marcia 2010", at(18).n),
      direction("id-foreclosed", "People who foreclosed were raised with a harder hand than people who achieved", control("foreclosed") - control("achieved"), `control received ${control("foreclosed").toFixed(2)} against ${control("achieved").toFixed(2)}`, control("foreclosed") > control("achieved"), "homes that allow disagreement produce exploration; homes that don't produce foreclosure", "Grotevant & Cooper 1985", settled.length),
    ],
    notes: ["Everyone in the nursery has a trade and a household by their late twenties, which pushes toward commitment. Almost nobody stays diffused, which is truer of a village than of the students these studies were run on."],
    extra: { table },
  };
}

function conscienceStudy(runs: NurseryRun[]): DevStudy {
  const kids = kidsOf(runs, [1, 2]).filter((k) => k.p.rec.moralsAt17 && k.p.parents.length === 2);
  const mid = (k: Kid, f: (typeof FOUNDATIONS)[number]) => mean(k.p.parents.map((p) => k.run.minds[p]!.dev!.morals[f]));
  // One parent at a time, as the family studies report it.
  const one = (xs: Kid[], f: (typeof FOUNDATIONS)[number]) => pearson(xs.flatMap((k) => k.p.parents.map((p) => k.run.minds[p]!.dev!.morals[f])), xs.flatMap((k) => k.p.parents.map(() => k.p.rec.moralsAt17![f])));
  const rs = FOUNDATIONS.map((f) => ({ foundation: f, r: one(kids, f) }));
  const meanR = mean(rs.map((x) => x.r));
  const dist = (k: Kid) => mean(FOUNDATIONS.map((f) => Math.abs(mid(k, f) - k.p.rec.moralsAt17![f])));
  const sorted = [...kids].sort((a, b) => a.m.dev!.care.warmth - b.m.dev!.care.warmth);
  const third = Math.floor(sorted.length / 3);
  const cold = sorted.slice(0, third);
  const warm = sorted.slice(-third);
  const rOf = (xs: Kid[]) => mean(FOUNDATIONS.map((f) => one(xs, f)));
  return {
    id: "conscience",
    title: "Whose conscience is it?",
    original: "Graham, Haidt & Nosek 2009; Grusec & Goodnow 1994",
    question: "Do children take on their parents' moral foundations, and from which parents most?",
    method: "Each child's six foundations at seventeen against each parent's, and the same split by how warm the home was.",
    findings: [
      direction("mor-r", "Children resemble their parents on every foundation", meanR, `mean r = ${meanR.toFixed(2)} (${rs.map((x) => `${x.foundation} ${x.r.toFixed(2)}`).join(", ")})`, rs.every((x) => x.r > 0), "parents' and children's values correlate, modestly", "Grusec & Goodnow 1994", kids.length, "r"),
      direction("mor-warm", "The resemblance is stronger in warm homes than cold ones", rOf(warm) - rOf(cold), `mean r = ${rOf(warm).toFixed(2)} in the warmest third, ${rOf(cold).toFixed(2)} in the coldest`, rOf(warm) > rOf(cold), "values are taken on from warm parents and resisted from cold ones", "Grusec & Goodnow 1994", warm.length + cold.length, "r"),
    ],
    notes: [`Mean distance between a child's conscience and their parents': ${mean(warm.map(dist)).toFixed(3)} in warm homes, ${mean(cold.map(dist)).toFixed(3)} in cold ones.`, "Part of the resemblance is temperament passed down, since each foundation starts from the Big Five lean that goes with it (Hirsh, DeYoung, Xu & Peterson 2010). The warm-home difference is the part that is upbringing."],
    extra: { byFoundation: rs },
  };
}

function earnedStudy(runs: NurseryRun[]): DevStudy {
  const g1 = kidsOf(runs, [1]).filter((k) => k.p.rec.atPairing && k.p.rec.partnerAtPairing && !isSecure(k.p.rec.atPairing));
  const steady = g1.filter((k) => isSecure(k.p.rec.partnerAtPairing!));
  const unsteady = g1.filter((k) => !isSecure(k.p.rec.partnerAtPairing!));
  const earned = (xs: Kid[]) => share(xs, (k) => isSecure(k.m.attachment));
  return {
    id: "earned",
    title: "Earned security",
    original: "Roisman, Padrón, Sroufe & Egeland 2002",
    question: "Can someone who grew up insecure become secure as an adult?",
    method: "People who were insecure when they paired off in their twenties, by whether their partner was secure, and whether they are secure in their fifties.",
    findings: [
      direction("earned-partner", "Insecure adults with a secure partner end up secure more often than those with an insecure one", earned(steady) - earned(unsteady), `${pct(earned(steady))} against ${pct(earned(unsteady))}`, earned(steady) > earned(unsteady), "a supportive partner is the commonest road to earned security", "Roisman et al. 2002", g1.length, "share"),
    ],
    notes: ["Partners are matched at random here. In a town they choose each other, which the nursery leaves out."],
    extra: { withSecurePartner: steady.length, withInsecurePartner: unsteady.length },
  };
}

// ---------------------------------------------------------------- trauma across generations

function traumaReport(pairs: { withPasts: NurseryRun; without: NurseryRun }[]): TraumaReport {
  const both = (g: 1 | 2) => pairs.flatMap(({ withPasts, without }) => withPasts.gens[g].filter((id) => without.minds[id]).map((id) => ({ a: { run: withPasts, p: withPasts.people[id]!, m: withPasts.minds[id]! }, b: { run: without, p: without.people[id]!, m: without.minds[id]! } })));
  const rows: TraumaReport["rows"] = [];
  const row = (what: string, g: 1 | 2, f: (k: Kid) => number | undefined, unit: "share" | "index" | "count" = "share") => {
    const xs = both(g).filter((x) => f(x.a) !== undefined && f(x.b) !== undefined);
    rows.push({ what, withPasts: r3(mean(xs.map((x) => f(x.a)!))), without: r3(mean(xs.map((x) => f(x.b)!))), unit, n: xs.length });
  };
  const insecureAt17 = (k: Kid) => (k.p.rec.grown ? 1 - sec(k.p.rec.grown) : undefined);
  const insecureAt1 = (k: Kid) => (k.p.rec.infancy ? 1 - sec(k.p.rec.infancy) : undefined);
  const strainHungry = (k: Kid) => (k.p.rec.parentStrain.hungry.length ? mean(k.p.rec.parentStrain.hungry) : undefined);
  const founderBelief = (k: Kid) => {
    const founders = new Set(k.run.gens[0]);
    return k.m.schemas.some((s) => {
      let at: { agent: AgentId; id: string } | undefined = s.origin?.[0] ? { agent: k.p.id, id: s.origin[0] } : undefined;
      for (let hop = 0; at && hop < 6; hop++) {
        const ep = k.run.minds[at.agent]?.episodes.find((e) => e.id === at!.id);
        if (!ep) return false;
        if (ep.source.kind !== "told" || !ep.source.from || !ep.source.ref) return founders.has(at.agent);
        at = { agent: ep.source.from, id: ep.source.ref };
      }
      return false;
    })
      ? 1
      : 0;
  };
  row("Children insecure at eighteen months", 1, insecureAt1);
  row("Children insecure at seventeen", 1, insecureAt17);
  row("Children's unbuffered adversities before seventeen", 1, (k) => toxicCount(k.m.dev!), "count");
  row("Parents' strain in the children's hungry seasons", 1, strainHungry, "index");
  row("Warmth the children were raised with", 1, (k) => k.m.dev!.care.warmth, "index");
  row("Children's distress at twenty-five", 1, (k) => k.p.rec.distress, "index");
  row("Grandchildren insecure at eighteen months", 2, insecureAt1);
  row("Grandchildren insecure at seventeen", 2, insecureAt17);
  row("Grandchildren's unbuffered adversities before seventeen", 2, (k) => toxicCount(k.m.dev!), "count");
  row("Warmth the grandchildren were raised with", 2, (k) => k.m.dev!.care.warmth, "index");
  row("Grandchildren holding a belief that began in a founder's memory", 2, founderBelief);

  const flips = (g: 1 | 2) => both(g).filter((x) => x.a.p.rec.grown && x.b.p.rec.grown && sec(x.a.p.rec.grown) !== sec(x.b.p.rec.grown));
  const worse = (g: 1 | 2) => flips(g).filter((x) => !isSecure(x.a.p.rec.grown!));
  const cases: LineageCase[] = [];
  for (const x of worse(2)) {
    if (cases.length >= 4) break;
    const a = x.a.p.rec.grown!;
    const target = a.avoidance >= a.anxiety ? "avoidance" : "anxiety";
    const deep = deepestRoot(x.a.run.minds, x.a.p.id, target);
    if (!deep || deep.generations < 2 || deep.step.kind !== "memory") continue;
    if (cases.some((c) => c.chain.at(-1)?.text === deep.step.text)) continue;
    cases.push({
      id: x.a.p.id,
      name: x.a.m.name,
      generation: 2,
      style: styleOf(a),
      without: styleOf(x.b.p.rec.grown!),
      chain: deep.chain.map((s) => ({ name: s.name, text: s.text, generation: s.generation, kind: s.kind })),
    });
  }
  const f1 = flips(1);
  const f2 = flips(2);
  const row1 = rows.find((r) => r.what === "Children insecure at seventeen")!;
  const row2 = rows.find((r) => r.what === "Grandchildren insecure at seventeen")!;
  const belief = rows.at(-1)!;
  return {
    question: "If the founders' formative injuries had never happened, how different would their children and grandchildren be?",
    rows,
    flipped: { children: f1.length, ofChildren: both(1).length, grandchildren: f2.length, ofGrandchildren: both(2).length },
    cases,
    findings: [
      `With the founders' pasts, ${pct(row1.withPasts)} of their children and ${pct(row2.withPasts)} of their grandchildren are insecure at seventeen. Without them, ${pct(row1.without)} and ${pct(row2.without)}. Every winter, death and roll of the dice is identical in the two worlds.`,
      `${f1.length} of ${both(1).length} children and ${f2.length} of ${both(2).length} grandchildren come of age with a different attachment class in the two worlds (${worse(1).length} and ${worse(2).length} of them insecure only because of something that happened before they were born).`,
      `${pct(belief.withPasts)} of grandchildren hold a core belief that began as a founder's first-hand memory and reached them as a bedtime story. They never met the winter it is about.`,
    ],
  };
}

// ---------------------------------------------------------------- the whole wing

const studiesOf = (runs: NurseryRun[]): DevStudy[] => [strangeSituationStudy(runs), sensitivityStudy(runs), transmissionStudy(runs), stabilityStudy(runs), adversityStudy(runs), cycleStudy(runs), identityStudy(runs), conscienceStudy(runs), earnedStudy(runs)];

function fitOf(studies: DevStudy[]): DevFit {
  const all = studies.flatMap((s) => s.findings);
  const bench = all.filter((f) => f.kind === "benchmark");
  const dirs = all.filter((f) => f.kind === "direction");
  return { benchmarks: bench.length, meanAbsError: r3(mean(bench.map((f) => Math.abs(f.model - f.human!)))), within: bench.filter((f) => f.holds).length, directions: dirs.length, held: dirs.filter((f) => f.holds).length };
}

/** The seeds the development constants were tuned on, and three that were kept aside. */
export const TUNING_SEEDS = [11, 12, 13];
export const HOLDOUT_SEEDS = [201, 202, 203];

export function runDevelopment(opts: DevelopmentOptions = {}): DevelopmentReport {
  const start = Date.now();
  const seeds = opts.seeds ?? TUNING_SEEDS;
  const couples = opts.couples ?? 100;
  const pairs = seeds.map((seed) => ({ withPasts: runNursery({ seed, couples }), without: runNursery({ seed, couples, noPast: true }) }));
  const runs = pairs.map((p) => p.withPasts);
  const studies = studiesOf(runs);
  const holdout = opts.holdout ?? HOLDOUT_SEEDS;
  let heldOut: DevelopmentReport["heldOut"];
  if (holdout.length) {
    const hs = studiesOf(holdout.map((seed) => runNursery({ seed, couples })));
    heldOut = { seeds: holdout, fit: fitOf(hs), findings: hs.flatMap((s) => s.findings.map((f) => ({ id: f.id, model: f.model, modelText: f.modelText, holds: f.holds }))) };
  }
  return {
    seeds,
    couples,
    people: { founders: runs.reduce((s, r) => s + r.gens[0].length, 0), children: runs.reduce((s, r) => s + r.gens[1].length, 0), grandchildren: runs.reduce((s, r) => s + r.gens[2].length, 0) },
    studies,
    fit: fitOf(studies),
    heldOut,
    trauma: traumaReport(pairs),
    seconds: r2((Date.now() - start) / 1000),
  };
}

// ---------------------------------------------------------------- deeper minds in the classic lab

export interface DepthCheck {
  id: string;
  experiment: string;
  what: string;
  modelText: string;
  model: number;
  humanText: string;
  source: string;
  n: number;
  holds: boolean;
  /** The same people with the new parts of the mind switched off: what temperament alone gives. */
  withoutText?: string;
  /** No settled human finding to hold it to: reported as observed, not as a pass or a miss. */
  exploratory?: boolean;
}

export interface DepthReport {
  /** Ordinary volunteers: do the new parts of the mind predict who obeys, conforms, helps? */
  volunteers: DepthCheck[];
  /** People raised in the nursery, then brought to the lab as adults. */
  graduates: DepthCheck[];
  notes: string[];
}

/** Move a nursery-raised mind's whole history into the past, so it can walk into the lab at ten in the morning on day one. */
export function graduate(run: NurseryRun, id: AgentId): Volunteer {
  const mind = structuredClone(run.minds[id]!);
  const offset = run.end + 2 * DAY;
  const KEYS = new Set(["tick", "formed", "toldOn", "lastTurn", "since"]);
  const LISTS = new Set(["retrievals", "rehearsals"]);
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "number" && KEYS.has(k)) (o as Record<string, unknown>)[k] = v - offset;
      else if (Array.isArray(v) && LISTS.has(k)) (o as Record<string, unknown>)[k] = v.map((x) => (typeof x === "number" ? x - offset : x));
      else if (typeof v === "object") walk(v);
    }
  };
  walk(mind);
  mind.tick = LAB_START;
  mind.lastSleep = 0;
  mind.affect.stress = Math.min(mind.affect.stress, 0.25);
  const s = mind.schemas[0];
  const origin = s ? mind.episodes.find((e) => e.id === s.origin?.[0]) : undefined;
  return { id: mind.id, name: mind.name, summary: mind.identity.summary, traits: { ...mind.traits }, past: { schema: s?.text ?? "", memory: origin?.gist ?? "", yearsAgo: origin ? Math.round((LAB_START - origin.tick) / (365 * DAY)) : 0 }, mind };
}

export async function runDepth(faculties: Faculties, opts: { seed?: number; size?: number } = {}): Promise<DepthReport> {
  const seed = opts.seed ?? 11;
  const size = opts.size ?? 120;
  const voice = MILGRAM_CONDITIONS.find((c) => c.id === "voice")!;
  const standard = ASCH_CONDITIONS.find((c) => c.id === "standard")!;
  const six = SEIZURE_CONDITIONS.find((c) => c.id === "six")!;
  const check = (id: string, experiment: string, what: string, model: number, modelText: string, holds: boolean, humanText: string, source: string, n: number, withoutText?: string): DepthCheck => ({ id, experiment, what, model: r3(model), modelText, holds, humanText, source, n, withoutText });

  const battery = async (pool: Volunteer[]) => {
    const out: { v: Volunteer; volts: number; obeyed: boolean; conformed: number; seconds: number; helped: boolean }[] = [];
    for (const v of pool) {
      const mil = await runMilgramSubject(v, voice, faculties, { pool });
      const asch = await runAschSubject(v, standard, faculties, { pool });
      const sz = await runSeizureSubject(v, six, faculties, { pool });
      out.push({ v, volts: mil.score, obeyed: mil.yielded, conformed: asch.score, seconds: sz.score, helped: !sz.yielded });
    }
    return out;
  };

  const pool = recruit(seed, size);
  const rows = await battery(pool);
  // The same people with conscience, the attachment system and identity switched off. Their
  // development records are unchanged, so any correlation left is temperament shared between the
  // record and the behaviour, and the difference is what the new mechanisms carry.
  const off = await battery(recruit(seed, size, { moralFoundations: false, attachmentSystem: false, identityFormation: false }));
  const dev = (v: Volunteer) => v.mind.dev!;
  type Row = (typeof rows)[number];
  const stats = (xs: Row[]) => {
    const obedient = xs.filter((x) => x.obeyed);
    const defiant = xs.filter((x) => !x.obeyed);
    const achieved = xs.filter((x) => dev(x.v).identity.status === "achieved");
    const others = xs.filter((x) => dev(x.v).identity.status !== "achieved");
    return {
      rAuth: pearson(xs.map((x) => dev(x.v).morals.authority), xs.map((x) => x.volts)),
      rCare: pearson(xs.map((x) => dev(x.v).morals.care), xs.map((x) => x.volts)),
      aO: mean(obedient.map((x) => dev(x.v).morals.authority)),
      aD: mean(defiant.map((x) => dev(x.v).morals.authority)),
      cA: mean(achieved.map((x) => x.conformed)),
      cO: mean(others.map((x) => x.conformed)),
      rFirm: pearson(xs.map((x) => firmness(x.v.mind)), xs.map((x) => x.conformed)),
      rAvoid: pearson(xs.map((x) => x.v.mind.attachment.avoidance), xs.map((x) => x.seconds)),
      rCareHelp: pearson(xs.map((x) => dev(x.v).morals.care), xs.map((x) => x.seconds)),
    };
  };
  const on = stats(rows);
  const no = stats(off);
  const volunteers = [
    check("depth-authority", "Milgram (voice feedback)", "Obedient subjects hold authority dearer than defiant ones", on.aO - on.aD, `authority ${on.aO.toFixed(2)} among the obedient, ${on.aD.toFixed(2)} among the defiant; r with volts = ${on.rAuth.toFixed(2)}`, on.aO > on.aD && on.rAuth > no.rAuth, "obedient subjects scored higher on authoritarianism", "Elms & Milgram 1966", rows.length, `r = ${no.rAuth.toFixed(2)}`),
    check("depth-care", "Milgram (voice feedback)", "The more someone's conscience is about harm, the sooner they stop", on.rCare, `r with volts = ${on.rCare.toFixed(2)}`, on.rCare < 0 && on.rCare < no.rCare, "defiant subjects reason more from the victim's welfare", "Kohlberg 1969, reported in Milgram 1974", rows.length, `r = ${no.rCare.toFixed(2)}`),
    check("depth-identity", "Asch (seven unanimous confederates)", "People with an achieved identity conform less than everyone else", on.cA - on.cO, `${on.cA.toFixed(1)} of 12 critical trials against ${on.cO.toFixed(1)}; r with firmness = ${on.rFirm.toFixed(2)}`, on.cA < on.cO && on.rFirm < no.rFirm, "identity-achieved women conformed least under Asch pressure", "Toder & Marcia 1973", rows.length, `${no.cA.toFixed(1)} against ${no.cO.toFixed(1)}; r = ${no.rFirm.toFixed(2)}`),
    check("depth-avoidance", "Seizure (six bystanders)", "Avoidant people are slower to help", on.rAvoid, `r between avoidance and seconds before helping = ${on.rAvoid.toFixed(2)}`, on.rAvoid > 0, "attachment avoidance predicts less compassionate helping", "Mikulincer, Shaver, Gillath & Nitzberg 2005", rows.length, `r = ${no.rAvoid.toFixed(2)}`),
    check("depth-carehelp", "Seizure (six bystanders)", "People whose conscience is about harm help sooner", on.rCareHelp, `r between care and seconds before helping = ${on.rCareHelp.toFixed(2)}`, on.rCareHelp < 0 && on.rCareHelp < no.rCareHelp, "empathic concern predicts helping", "Batson 1991", rows.length, `r = ${no.rCareHelp.toFixed(2)}`),
  ];

  // People raised in the nursery, grown, and brought to the lab.
  const run = runNursery({ seed, couples: Math.max(40, Math.round(size / 2)) });
  const grads = run.gens[2].filter((id) => run.people[id]!.rec.grown).slice(0, size).map((id) => graduate(run, id));
  const g = await battery(grads);
  const hard = g.filter((x) => dev(x.v).care.control >= 0.4);
  const gentle = g.filter((x) => dev(x.v).care.control < 0.4);
  const rCtl = pearson(g.map((x) => dev(x.v).care.control), g.map((x) => x.volts));
  const rWarm = pearson(g.map((x) => dev(x.v).care.warmth), g.map((x) => x.seconds));
  const secure = g.filter((x) => isSecure(x.v.mind.attachment));
  const insecure = g.filter((x) => !isSecure(x.v.mind.attachment));
  const rSec = pearson(g.map((x) => securityOf(x.v.mind.attachment)), g.map((x) => x.conformed));
  const marked = g.filter((x) => toxicCount(dev(x.v)) > 0);
  const spared = g.filter((x) => toxicCount(dev(x.v)) === 0);
  const graduates = [
    check("grad-control", "Milgram (voice feedback)", "People raised with a harder hand go further on the shock board", rCtl, `r between control received and volts = ${rCtl.toFixed(2)}; ${pct(share(hard, (x) => x.obeyed))} of the harder-raised went to 450 V against ${pct(share(gentle, (x) => x.obeyed))}`, rCtl > 0, "punitive homes were proposed to breed deference (Adorno et al. 1950); later work found the link weak", "Adorno et al. 1950; Altemeyer 1988", g.length),
    check("grad-warmth", "Seizure (six bystanders)", "People raised warmly help sooner", rWarm, `r between warmth received and seconds before helping = ${rWarm.toFixed(2)}; secure ${mean(secure.map((x) => x.seconds)).toFixed(0)} s, insecure ${mean(insecure.map((x) => x.seconds)).toFixed(0)} s`, rWarm < 0, "secure attachment goes with more helping", "Mikulincer et al. 2005", g.length),
    { ...check("grad-security", "Asch (seven unanimous confederates)", "Do secure people conform less?", rSec, `r between security and conforming answers = ${rSec.toFixed(2)}`, rSec < 0, "no settled human figure", "exploratory", g.length), exploratory: true },
    { ...check("grad-adversity", "Milgram (voice feedback)", "Does an unbuffered childhood adversity change how far someone goes?", mean(marked.map((x) => x.volts)) - mean(spared.map((x) => x.volts)), `${mean(marked.map((x) => x.volts)).toFixed(0)} V on average with one, ${mean(spared.map((x) => x.volts)).toFixed(0)} V without`, true, "no settled human figure", "exploratory", g.length), exploratory: true },
  ];
  return {
    volunteers,
    graduates,
    notes: [
      "The volunteer checks follow partly from how conscience and attachment were written into choices, so passing them shows the wiring survives the rest of the mind (noise, appraisal, the situation's own forces), not that the model discovered them. Each is shown beside the same people with the new mechanisms switched off, because a conscience that starts from temperament will correlate with behaviour that temperament also drives.",
      "The graduate checks were never tuned. These people were born in the nursery, raised by simulated parents, and met Milgram's experimenter for the first time as adults.",
    ],
  };
}
