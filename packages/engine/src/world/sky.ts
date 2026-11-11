// The sky over a town: where the sun and moon stand, how much cloud there is, which way the wind
// blows, whether it is raining, snowing or misty. The simulation only knows three kinds of weather
// (fair, rain, gale); everything here is drawn from that, the season, the day and the seed, so the
// picture is the same for everyone watching and the same every time a world is replayed. Nothing
// here feeds back into the world: it is what the weather looks and sounds like, not what it does.

export type SkySeason = "spring" | "summer" | "autumn" | "winter";
export type SkyWeather = "fair" | "rain" | "gale";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SkyState {
  /** Hour of day, 0 to 24. */
  hour: number;
  /** When the sun comes up and goes down, in hours. */
  sunrise: number;
  sunset: number;
  /** Unit vector toward the sun. East is +x, south is +z, so the sun sets over the sea to the west. */
  sun: Vec3;
  /** Unit vector toward the moon. */
  moon: Vec3;
  /** How full the moon is: 0 new, 1 full. */
  moonFull: number;
  /** Sine of the sun's height above the horizon: 1 overhead, 0 on the horizon, negative below it. */
  height: number;
  /** How light it is, 0 (deep night) to 1 (full day), easing through twilight. */
  daylight: number;
  /** How close the sun is to the horizon, 0 to 1: the gold and pink of dawn and dusk. */
  glow: number;
  phase: "night" | "dawn" | "day" | "dusk";
  /** How much of the sky is cloud, 0 to 1. */
  cloud: number;
  /** Where the wind is going (unit vector on the ground) and how hard it blows, 0 to 1. */
  wind: { x: number; z: number; speed: number };
  precip: "none" | "rain" | "snow";
  /** How hard it is coming down, 0 to 1. */
  intensity: number;
  /** Ground mist, 0 to 1: some still mornings in spring and autumn. */
  mist: number;
  /** A gale with thunder in it. */
  thunder: boolean;
}

/** Sunrise and sunset by season, and how high the sun gets at noon (degrees). */
const DAY: Record<SkySeason, { rise: number; set: number; noon: number }> = {
  spring: { rise: 6, set: 18.5, noon: 52 },
  summer: { rise: 5, set: 20.5, noon: 66 },
  autumn: { rise: 6.5, set: 17.5, noon: 44 },
  winter: { rise: 7.5, set: 16.5, noon: 28 },
};

/** A number in [0, 1) from a seed and a few integers: the same for the same inputs, always. */
export function skyHash(seed: number, a: number, b = 0): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(a | 0, 668265263) + Math.imul(b | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const asSeason = (s: string): SkySeason => (s === "spring" || s === "summer" || s === "autumn" || s === "winter" ? s : "summer");
const asWeather = (w: string): SkyWeather => (w === "rain" || w === "gale" ? w : "fair");

/** A body's place on its arc: `t` 0 at rising in the east, 1 at setting in the west, `top` its height at the middle in degrees. */
function arc(t: number, top: number): Vec3 {
  const a = Math.PI * t;
  const el = (top * Math.PI) / 180;
  const x = Math.cos(a), y = Math.sin(a) * Math.sin(el), z = Math.sin(a) * Math.cos(el);
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * The sky at a moment. `tick` is in sim minutes; `season` and `weather` are the town's own.
 * Anything that isn't a known season or weather is read as a fair summer day.
 */
export function skyAt(seed: number, tick: number, season: string, weather: string): SkyState {
  const s = asSeason(season), w = asWeather(weather);
  const hour = (((tick % 1440) + 1440) % 1440) / 60;
  const day = Math.floor(tick / 1440);
  const { rise, set, noon } = DAY[s];

  // The sun by day; below the horizon it carries on round the far side.
  const dayLen = set - rise, nightLen = 24 - dayLen;
  const up = hour >= rise && hour <= set;
  const sinceSet = (hour - set + 24) % 24;
  const sun = up ? arc((hour - rise) / dayLen, noon) : (() => {
    const v = arc(sinceSet / nightLen, noon);
    return { x: -v.x, y: -v.y, z: -v.z };
  })();
  const height = sun.y;
  // The moon rises as the sun sets, later each night as it wanes (near enough for a village).
  const month = 28;
  const age = (((day + skyHash(seed, 91) * month) % month) + month) % month;
  const moonFull = 0.5 - 0.5 * Math.cos((age / month) * Math.PI * 2);
  const moonT = (sinceSet / nightLen + (age / month - 0.5) * 0.6 + 2) % 2;
  const moon = moonT <= 1 ? arc(moonT, 48) : (() => {
    const v = arc(moonT - 1, 48);
    return { x: -v.x, y: -v.y, z: -v.z };
  })();

  const daylight = smooth(-0.12, 0.22, height);
  const glow = clamp01(1 - Math.abs(height - 0.04) / 0.3);
  const phase: SkyState["phase"] = height > 0.2 ? "day" : height < -0.1 ? "night" : hour < 12 ? "dawn" : "dusk";

  // Cloud: thin on a fair day (and it comes and goes through the day), heavy in rain, solid in a gale.
  const block = Math.floor(hour / 6);
  const drift = skyHash(seed, day, 10 + block) * (1 - (hour / 6 - block)) + skyHash(seed, day + (block === 3 ? 1 : 0), 10 + ((block + 1) % 4)) * (hour / 6 - block);
  // Each day has its own character; late in the evening it eases into tomorrow's, so nothing jumps at midnight.
  const eve = smooth(20, 24, hour);
  const daily = (k: number) => skyHash(seed, day, k) * (1 - eve) + skyHash(seed, day + 1, k) * eve;
  const base = daily(1);
  const cloud = w === "gale" ? 1 : w === "rain" ? 0.82 + 0.14 * drift : clamp01(0.04 + 0.5 * base * base + 0.22 * (drift - 0.5));

  // Wind comes in off the sea, from the west, swinging north or south of it from day to day.
  const swing = (daily(2) - 0.5) * 1.6;
  const speed = w === "gale" ? 1 : w === "rain" ? 0.4 + 0.2 * daily(3) : 0.08 + 0.22 * daily(3);
  const wind = { x: Math.cos(swing), z: Math.sin(swing), speed };

  // What falls: rain, or snow in winter. A grey winter day can bring a few flakes on its own.
  let precip: SkyState["precip"] = "none";
  let intensity = 0;
  if (w !== "fair") {
    precip = s === "winter" ? "snow" : "rain";
    intensity = w === "gale" ? 1 : 0.45 + 0.25 * daily(4);
  } else if (s === "winter" && cloud > 0.34) {
    precip = "snow";
    intensity = 0.18;
  }
  const thunder = w === "gale" && s !== "winter" && skyHash(seed, day, 5) < 0.6;

  // Mist: a still, fair morning in spring or autumn, burning off by mid-morning.
  const misty = w === "fair" && (s === "autumn" || s === "spring") && speed < 0.2 && skyHash(seed, day, 6) < 0.45;
  const mist = misty ? smooth(rise - 2.5, rise - 0.5, hour) * (1 - smooth(rise + 1.5, rise + 3.5, hour)) : 0;

  return { hour, sunrise: rise, sunset: set, sun, moon, moonFull, height, daylight, glow, phase, cloud, wind, precip, intensity, mist, thunder };
}

/** The sky in a few plain words, for a clock or a caption: "clear night", "morning mist", "heavy snow". */
export function skyWords(sky: SkyState): string {
  if (sky.precip === "snow") return sky.intensity > 0.8 ? "blizzard" : sky.intensity > 0.3 ? "snow" : "a few flakes";
  if (sky.precip === "rain") return sky.thunder ? "thunderstorm" : sky.intensity > 0.8 ? "gale and rain" : "rain";
  if (sky.mist > 0.35) return "morning mist";
  const night = sky.phase === "night";
  if (sky.cloud > 0.6) return night ? "dark, overcast" : "overcast";
  if (sky.cloud > 0.3) return night ? "broken cloud" : "sun and cloud";
  if (sky.phase === "dawn") return "clear dawn";
  if (sky.phase === "dusk") return "clear dusk";
  return night ? (sky.moonFull > 0.85 && sky.moon.y > 0.1 ? "full moon" : "clear night") : "clear";
}
