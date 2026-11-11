// A small dial beside the clock: the arc of the day, with the sun on it by day and the moon (in its
// phase) by night, and a word or two for the weather. It reads the same sky the 3D view draws.

import { skyAt, skyWords } from "@psyche/engine";

export function SkyDial({ seed, tick, season, weather }: { seed: number; tick: number; season: string; weather: string }) {
  const sky = skyAt(seed, tick, season, weather);
  const day = sky.hour >= sky.sunrise && sky.hour <= sky.sunset;
  const night = 24 - (sky.sunset - sky.sunrise);
  // How far along its arc the sun (or the moon's stand-in for the night) is, 0 to 1.
  const t = day ? (sky.hour - sky.sunrise) / (sky.sunset - sky.sunrise) : ((sky.hour - sky.sunset + 24) % 24) / night;
  const a = Math.PI * (1 - t);
  const x = 22 + Math.cos(a) * 17, y = 21 - Math.sin(a) * 15;
  const words = skyWords(sky);
  return (
    <span className={`g-sky ${day ? "day" : "night"}`} title={`Sun up ${fmt(sky.sunrise)}, down ${fmt(sky.sunset)}. ${words[0]!.toUpperCase()}${words.slice(1)}.`}>
      <svg viewBox="0 0 44 26" width="34" height="20" aria-hidden="true">
        <path d="M5 21 A17 15 0 0 1 39 21" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="1.5 2.5" />
        <line x1="2" y1="21.5" x2="42" y2="21.5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" />
        {day ? (
          <circle cx={x} cy={y} r="3.6" fill="#ffd34d" />
        ) : (
          <g>
            <clipPath id="g-moon">
              <circle cx={x} cy={y} r="3.4" />
            </clipPath>
            <circle cx={x} cy={y} r="3.4" fill="#dfe7fb" />
            <circle cx={x + 7 * sky.moonFull} cy={y} r="3.5" fill="#0c141c" clipPath="url(#g-moon)" />
          </g>
        )}
      </svg>
      <span>{words}</span>
    </span>
  );
}

const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
