import { beforeAll, describe, expect, it } from "vitest";
import { lab } from "@psyche/engine";
import { createMockFaculties } from "@psyche/faculties";

const value = (r: lab.LabReport, exp: string, cond: string) => r.experiments.find((e) => e.id === exp)!.conditions.find((c) => c.id === cond)!.value;

describe("the lab", () => {
  let report: lab.LabReport;
  beforeAll(async () => {
    report = await lab.runLab(createMockFaculties(), { seed: 11, size: 40, sweeps: false });
  }, 120_000);

  it("is deterministic for a seed", async () => {
    const again = await lab.runLab(createMockFaculties(), { seed: 11, size: 40, sweeps: false });
    expect(again.scorecard).toEqual(report.scorecard);
  }, 120_000);

  it("Milgram: closeness to the victim lowers obedience, and nobody goes far by choice", () => {
    expect(value(report, "milgram", "touch")).toBeLessThan(value(report, "milgram", "remote"));
    expect(value(report, "milgram", "proximity")).toBeLessThan(value(report, "milgram", "voice"));
    expect(value(report, "milgram", "free")).toBeLessThan(0.1);
  });

  it("Asch: one ally breaks the majority", () => {
    expect(value(report, "asch", "ally")).toBeLessThan(value(report, "asch", "standard") / 2);
    expect(value(report, "asch", "one")).toBeLessThan(value(report, "asch", "three"));
  });

  it("bystanders: more listeners, less help", () => {
    expect(value(report, "bystander", "six")).toBeLessThan(value(report, "bystander", "three"));
    expect(value(report, "bystander", "three")).toBeLessThan(value(report, "bystander", "two"));
    expect(value(report, "bystander", "smoke-passive")).toBeLessThan(value(report, "bystander", "smoke-alone"));
  });

  it("prison: the Stanford briefing makes guards harsher than no briefing", () => {
    expect(value(report, "prison", "stanford")).toBeGreaterThanOrEqual(value(report, "prison", "bbc"));
  });

  it("lines up with the human ordering of conditions", () => {
    for (const o of report.fit.orderings) expect(o.agree / o.pairs).toBeGreaterThan(0.8);
    expect(report.fit.meanAbsError).toBeLessThan(0.1);
  });

  it("can say what the volunteers left out", () => {
    expect(report.unspoken!.moments).toBeGreaterThan(50);
    expect(report.unspoken!.meanHiddenShare).toBeGreaterThan(0);
  });
});
