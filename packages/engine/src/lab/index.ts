// The whole lab in one call: recruit a pool, run every experiment on it, and line the results up
// against the human studies. Everything here runs on the offline mock in under a minute.

import type { Faculties } from "../ports.js";
import { runAsch } from "./asch.js";
import { runBystander } from "./bystander.js";
import { pearson, recruit, type ExperimentResult, type SubjectRun, type Volunteer } from "./core.js";
import { runDepth, runDevelopment, type DepthReport, type DevelopmentReport } from "./development.js";
import { runMilgram } from "./milgram.js";
import { runPrison } from "./prison.js";

export interface LabOptions {
  seed?: number;
  /** Volunteers in the pool (Milgram used 40 per condition). */
  size?: number;
  experiments?: ("milgram" | "asch" | "bystander" | "prison")[];
  /** Counterfactual sweeps and ablations (they double or triple the run time). */
  sweeps?: boolean;
  /**
   * The developmental wing: raise families in the nursery and measure them against the attachment
   * and development literature, then check the deeper minds in the classic experiments. On by
   * default whenever sweeps are; pass seeds to change the sample.
   */
  development?: boolean | { seeds?: number[]; couples?: number; holdout?: number[] };
}

export interface LabReport {
  seed: number;
  createdWith: string;
  pool: Omit<Volunteer, "mind">[];
  experiments: ExperimentResult[];
  /** Every condition with a human number, side by side. */
  scorecard: { experiment: string; condition: string; psyche: number; human: number; humanText: string; source: string }[];
  /** How far off the numbers are, and whether the order of conditions matches the human ordering. */
  fit: { meanAbsError: number; comparisons: number; orderings: { experiment: string; agree: number; pairs: number }[] };
  /** One mind, four situations: does obeying predict conforming predict not helping? */
  crossover?: { rows: { id: string; name: string; milgram?: number; asch?: number; helpSeconds?: number; schema: string }[]; r: { a: string; b: string; r: number }[] };
  /** Across every decisive moment: how much of the push came from forces the person never mentioned. */
  unspoken?: { moments: number; meanHiddenShare: number; byKind: { kind: string; share: number }[] };
  /** How minds come to be: the nursery studies against the developmental literature. */
  development?: DevelopmentReport;
  /** The deeper minds (conscience, attachment, identity) in the classic experiments. */
  depth?: DepthReport;
  /** The same scorecard with conscience, the attachment system and identity switched off, for comparison. */
  shallow?: { meanAbsError: number; agree: number; pairs: number };
}

type Fit = { scorecard: LabReport["scorecard"]; fit: LabReport["fit"] };

function scoreOf(experiments: ExperimentResult[]): Fit {
  const scorecard: LabReport["scorecard"] = [];
  for (const e of experiments) {
    for (const c of e.conditions) {
      if (c.human && e.id !== "prison" && !(e.id === "asch" && c.id === "alone")) scorecard.push({ experiment: e.title, condition: c.label, psyche: c.value, human: c.human.value, humanText: c.human.text, source: c.human.source });
    }
  }
  const errs = scorecard.map((s) => Math.abs(s.psyche - s.human));
  const orderings = experiments
    .filter((e) => e.id !== "prison")
    .map((e) => {
      const cs = e.conditions.filter((c) => c.human && !(e.id === "asch" && c.id === "alone"));
      let agree = 0;
      let pairs = 0;
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          const h = cs[i]!.human!.value - cs[j]!.human!.value;
          if (Math.abs(h) < 0.03) continue;
          pairs++;
          if (Math.sign(cs[i]!.value - cs[j]!.value) === Math.sign(h)) agree++;
        }
      }
      return { experiment: e.title, agree, pairs };
    });
  return { scorecard, fit: { meanAbsError: Number((errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)).toFixed(3)), comparisons: errs.length, orderings } };
}

export async function runLab(faculties: Faculties, opts: LabOptions = {}): Promise<LabReport> {
  const seed = opts.seed ?? 11;
  const pool = recruit(seed, opts.size ?? 40);
  const want = new Set(opts.experiments ?? ["milgram", "asch", "bystander", "prison"]);
  const sweeps = opts.sweeps !== false;
  const experiments: ExperimentResult[] = [];
  if (want.has("milgram")) experiments.push(await runMilgram(pool, faculties, { sweep: sweeps, ablations: sweeps }));
  if (want.has("asch")) experiments.push(await runAsch(pool, faculties, { sweep: sweeps, ablations: sweeps }));
  if (want.has("bystander")) experiments.push(await runBystander(pool, faculties, { sweep: sweeps, ablations: sweeps }));
  if (want.has("prison")) experiments.push(await runPrison(pool, faculties, { seed: 1971, ablations: sweeps }));

  const { scorecard, fit } = scoreOf(experiments);

  const report: LabReport = {
    seed,
    createdWith: "offline mock faculties",
    pool: pool.map(({ mind: _m, ...v }) => v),
    experiments,
    scorecard,
    fit,
  };

  // The same forty minds went through Milgram, Asch and the seizure study.
  const subjectsOf = (eid: string, cid: string) => experiments.find((e) => e.id === eid)?.conditions.find((c) => c.id === cid)?.subjects ?? [];
  const mil = subjectsOf("milgram", "voice");
  const asch = subjectsOf("asch", "standard");
  const bys = subjectsOf("bystander", "six");
  if ([mil, asch, bys].filter((x) => x.length).length >= 2) {
    const by = (runs: SubjectRun[], id: string) => runs.find((r) => r.id === id)?.score;
    const rows = pool.map((v) => ({ id: v.id, name: v.name, milgram: by(mil, v.id), asch: by(asch, v.id), helpSeconds: by(bys, v.id), schema: v.past.schema }));
    const pair = (a: string, b: string, xa: (r: (typeof rows)[number]) => number | undefined, xb: (r: (typeof rows)[number]) => number | undefined) => {
      const both = rows.filter((r) => xa(r) !== undefined && xb(r) !== undefined);
      return { a, b, r: pearson(both.map((r) => xa(r)!), both.map((r) => xb(r)!)) };
    };
    report.crossover = {
      rows,
      r: [
        pair("volts given (Milgram)", "answers conformed (Asch)", (r) => r.milgram, (r) => r.asch),
        pair("volts given (Milgram)", "seconds before helping (seizure)", (r) => r.milgram, (r) => r.helpSeconds),
        pair("answers conformed (Asch)", "seconds before helping (seizure)", (r) => r.asch, (r) => r.helpSeconds),
      ],
    };
  }

  const debriefs = experiments.flatMap((e) => e.conditions.flatMap((c) => c.subjects.map((s) => s.decisive).filter((d) => d?.debrief)));
  if (debriefs.length) {
    const total = debriefs.reduce((s, d) => s + d!.forces.filter((x) => x.value > 0).reduce((t, f) => t + f.value, 0), 0);
    report.unspoken = {
      moments: debriefs.length,
      meanHiddenShare: Number((debriefs.reduce((s, d) => s + d!.debrief!.hiddenShare, 0) / debriefs.length).toFixed(3)),
      byKind: groupUnspoken(debriefs.map((d) => d!), total),
    };
  }

  const dev = opts.development ?? sweeps;
  if (dev) {
    report.development = runDevelopment(typeof dev === "object" ? dev : {});
    report.depth = await runDepth(faculties, { seed });
    // The classic scorecard again, on the same people without the new parts of the mind.
    const plain = recruit(seed, opts.size ?? 40, { moralFoundations: false, attachmentSystem: false, identityFormation: false });
    const again: ExperimentResult[] = [];
    if (want.has("milgram")) again.push(await runMilgram(plain, faculties, {}));
    if (want.has("asch")) again.push(await runAsch(plain, faculties, {}));
    if (want.has("bystander")) again.push(await runBystander(plain, faculties, {}));
    const f = scoreOf(again).fit;
    report.shallow = { meanAbsError: f.meanAbsError, agree: f.orderings.reduce((s, o) => s + o.agree, 0), pairs: f.orderings.reduce((s, o) => s + o.pairs, 0) };
  }
  return report;
}

/** Unspoken forces summed by what they were: a core belief, a trait, the sunk cost of switches pressed. */
function groupUnspoken(ds: NonNullable<SubjectRun["decisive"]>[], total: number): { kind: string; share: number }[] {
  const label: Record<string, string> = {
    "lab:commitment": "switches already pressed (sunk cost)",
    "lab:consistency": "staying consistent with earlier answers",
    "lab:record": "a guard's own record",
    "lab:diffusion": "others could act instead",
    "lab:shift": "what the other guards did",
    "lab:responsibility": "the experimenter taking responsibility",
    "lab:numbers": "prisoners as numbers",
    "lab:anonymous": "anonymity",
    "lab:overreact": "fear of looking foolish",
  };
  const sums = new Map<string, number>();
  for (const d of ds) {
    for (const f of d.debrief!.unspoken) {
      const k = f.ref && label[f.ref] ? label[f.ref]! : f.kind === "core belief" ? "core beliefs from their past" : f.kind === "trait" ? `${f.name} (trait)` : f.kind === "state" ? `${f.name} (state of mind)` : f.kind === "norm" ? "the courtesy norm" : f.kind === "chance" ? "chance (moment-to-moment noise)" : f.kind === "habit" ? "habits formed during the session" : f.kind;
      sums.set(k, (sums.get(k) ?? 0) + f.value);
    }
  }
  return [...sums.entries()].map(([kind, v]) => ({ kind, share: Number((v / (total || 1)).toFixed(3)) })).sort((a, b) => b.share - a.share).slice(0, 10);
}

export * from "./core.js";
export { runMilgram, runMilgramSubject, MILGRAM_CONDITIONS, deference, empathy, type MilgramCondition } from "./milgram.js";
export { runAsch, runAschSubject, ASCH_CONDITIONS, susceptibility, type AschCondition } from "./asch.js";
export { runBystander, runSeizureSubject, SEIZURE_CONDITIONS, SMOKE_CONDITIONS, type SeizureCondition, type SmokeCondition } from "./bystander.js";
export { runPrison, runPrisonCondition, PRISON_CONDITIONS, assignRoles, type PrisonCondition } from "./prison.js";
export { runDevelopment, runDepth, graduate, type DevelopmentReport, type DevStudy, type DevFinding, type DepthReport, type DepthCheck, type TraumaReport, type LineageCase, type DevelopmentOptions } from "./development.js";
export { runNursery, distressOf, type NurseryRun, type NurseryOptions, type Person } from "./nursery.js";
