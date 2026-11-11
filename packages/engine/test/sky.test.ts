import { describe, expect, it } from "vitest";
import { skyAt, skyHash, skyWords } from "@psyche/engine";

const at = (hour: number, season = "summer", weather = "fair", day = 3, seed = 11) => skyAt(seed, day * 1440 + Math.round(hour * 60), season, weather);
const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe("the sky over a town", () => {
  it("is the same for the same moment, and differs between worlds", () => {
    expect(at(9.5, "autumn", "rain")).toEqual(at(9.5, "autumn", "rain"));
    const days = Array.from({ length: 40 }, (_, d) => d);
    const a = days.map((d) => at(12, "summer", "fair", d, 11).cloud);
    const b = days.map((d) => at(12, "summer", "fair", d, 12).cloud);
    expect(a).not.toEqual(b);
    expect(skyHash(11, 3, 4)).toBe(skyHash(11, 3, 4));
    for (let i = 0; i < 200; i++) {
      const h = skyHash(7, i, i * 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it("puts the sun up at noon and down at midnight, in every season", () => {
    for (const season of ["spring", "summer", "autumn", "winter"]) {
      const noon = at(12, season), midnight = at(0, season);
      expect(noon.height).toBeGreaterThan(0.3);
      expect(noon.daylight).toBe(1);
      expect(noon.phase).toBe("day");
      expect(midnight.height).toBeLessThan(-0.3);
      expect(midnight.daylight).toBe(0);
      expect(midnight.phase).toBe("night");
    }
    // The summer sun stands higher than the winter one, and the summer day is longer.
    expect(at(12, "summer").height).toBeGreaterThan(at(12, "winter").height);
    expect(at(19, "summer").daylight).toBeGreaterThan(at(19, "winter").daylight);
  });

  it("rises in the east and sets in the west, over the sea", () => {
    const s = at(12, "spring");
    expect(at(s.sunrise + 0.5, "spring").sun.x).toBeGreaterThan(0.8);
    expect(at(s.sunset - 0.5, "spring").sun.x).toBeLessThan(-0.8);
    expect(at(s.sunrise + 0.3, "spring").phase).toBe("dawn");
    expect(at(s.sunset - 0.3, "spring").phase).toBe("dusk");
    expect(at(s.sunset - 0.2, "spring").glow).toBeGreaterThan(0.5);
    expect(at(12, "spring").glow).toBe(0);
  });

  it("keeps its directions as unit vectors and its measures in range, all day and all year", () => {
    for (const season of ["spring", "summer", "autumn", "winter"]) {
      for (const weather of ["fair", "rain", "gale"]) {
        for (let d = 0; d < 30; d++) {
          for (let h = 0; h < 24; h += 1.5) {
            const s = at(h, season, weather, d);
            expect(len(s.sun)).toBeCloseTo(1, 6);
            expect(len(s.moon)).toBeCloseTo(1, 6);
            expect(Math.hypot(s.wind.x, s.wind.z)).toBeCloseTo(1, 6);
            for (const v of [s.daylight, s.glow, s.cloud, s.wind.speed, s.intensity, s.mist, s.moonFull]) {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it("does not jump from one minute to the next", () => {
    for (let m = 0; m < 3 * 1440; m++) {
      const a = skyAt(11, m, "autumn", "fair"), b = skyAt(11, m + 1, "autumn", "fair");
      expect(Math.abs(a.daylight - b.daylight)).toBeLessThan(0.02);
      expect(Math.abs(a.cloud - b.cloud)).toBeLessThan(0.02);
      expect(Math.abs(a.sun.y - b.sun.y)).toBeLessThan(0.02);
      expect(Math.abs(a.wind.speed - b.wind.speed)).toBeLessThan(0.02);
      expect(Math.hypot(a.wind.x - b.wind.x, a.wind.z - b.wind.z)).toBeLessThan(0.02);
    }
  });

  it("draws the weather the town is having", () => {
    const gale = at(14, "summer", "gale"), rain = at(14, "summer", "rain"), fair = at(14, "summer", "fair");
    expect(gale.cloud).toBe(1);
    expect(gale.wind.speed).toBe(1);
    expect(gale.precip).toBe("rain");
    expect(gale.intensity).toBe(1);
    expect(rain.cloud).toBeGreaterThan(0.8);
    expect(rain.precip).toBe("rain");
    expect(rain.wind.speed).toBeGreaterThan(fair.wind.speed);
    expect(fair.precip).toBe("none");
    expect(fair.cloud).toBeLessThan(0.7);
    // In winter what falls is snow, and there is no thunder in it.
    expect(at(14, "winter", "rain").precip).toBe("snow");
    expect(at(14, "winter", "gale").precip).toBe("snow");
    for (let d = 0; d < 40; d++) expect(at(14, "winter", "gale", d).thunder).toBe(false);
    // Some summer gales carry thunder, and some don't.
    const thunder = Array.from({ length: 40 }, (_, d) => at(14, "summer", "gale", d).thunder);
    expect(thunder.includes(true)).toBe(true);
    expect(thunder.includes(false)).toBe(true);
  });

  it("brings mist only to still spring and autumn mornings", () => {
    let misty = 0;
    for (let d = 0; d < 60; d++) {
      const s = at(6.5, "autumn", "fair", d);
      if (s.mist > 0.35) misty++;
      expect(at(13, "autumn", "fair", d).mist).toBe(0);
      expect(at(5, "summer", "fair", d).mist).toBe(0);
      expect(at(6.5, "autumn", "rain", d).mist).toBe(0);
    }
    expect(misty).toBeGreaterThan(0);
    expect(misty).toBeLessThan(60);
  });

  it("turns the moon through its month", () => {
    const full = Array.from({ length: 28 }, (_, d) => at(0, "summer", "fair", d).moonFull);
    expect(Math.max(...full)).toBeGreaterThan(0.95);
    expect(Math.min(...full)).toBeLessThan(0.05);
    expect(at(0, "summer", "fair", 5).moonFull).toBeCloseTo(at(0, "summer", "fair", 33).moonFull, 6);
  });

  it("reads anything it doesn't know as a fair summer day", () => {
    expect(skyAt(11, 720, "monsoon", "hail")).toEqual(skyAt(11, 720, "summer", "fair"));
    expect(skyAt(11, -30, "summer", "fair").hour).toBe(23.5);
  });

  it("says what the sky is in a few plain words", () => {
    expect(skyWords(at(14, "summer", "rain"))).toBe("rain");
    expect(skyWords(at(14, "winter", "gale"))).toBe("blizzard");
    expect(skyWords(at(14, "winter", "rain"))).toBe("snow");
    const storms = new Set(Array.from({ length: 40 }, (_, d) => skyWords(at(14, "summer", "gale", d))));
    expect([...storms].sort()).toEqual(["gale and rain", "thunderstorm"]);
    const words = new Set<string>();
    for (let d = 0; d < 120; d++) for (const h of [1, 6.3, 12, 19.8]) words.add(skyWords(at(h, d % 2 ? "summer" : "autumn", "fair", d)));
    for (const w of ["clear", "clear night", "sun and cloud", "morning mist"]) expect(words.has(w)).toBe(true);
    for (const w of words) expect(w.length).toBeLessThan(20);
  });
});
