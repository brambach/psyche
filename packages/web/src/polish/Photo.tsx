// Photo mode: everything on screen steps aside so the town has the frame. You can turn the light to
// any hour and try other weather (on your screen only: the world carries on untouched), then save
// the picture, with or without a caption saying where and when it is.

import { useState } from "react";
import { download, postcard, type Caption } from "./capture";

export interface Look {
  hour?: number;
  weather?: string;
}

const WEATHER: [string | undefined, string][] = [[undefined, "As it is"], ["fair", "Fair"], ["rain", "Rain"], ["gale", "Gale"]];
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;

export function PhotoBar({ look, setLook, caption, onClose }: { look: Look; setLook: (l: Look) => void; caption: Caption; onClose: () => void }) {
  const [captioned, setCaptioned] = useState(true);
  const [saved, setSaved] = useState<string>();
  const save = async () => {
    const blob = await postcard(captioned ? caption : undefined);
    if (!blob) return setSaved("Could not read the picture.");
    const name = `${caption.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${caption.line.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}.png`;
    download(blob, name);
    setSaved("Saved.");
    setTimeout(() => setSaved(undefined), 2500);
  };
  return (
    <div className="g-photo-bar" role="group" aria-label="Photo mode">
      <label className="g-photo-time">
        <span>Light</span>
        <input type="range" min={0} max={24} step={0.25} value={look.hour ?? 12} onChange={(e) => setLook({ ...look, hour: Number(e.target.value) })} aria-label="Hour of day" />
        <b>{look.hour === undefined ? "live" : hhmm(look.hour)}</b>
        {look.hour !== undefined && (
          <button className="g-mini" onClick={() => setLook({ ...look, hour: undefined })} title="Back to the world's own time">
            live
          </button>
        )}
      </label>
      <div className="g-seg" role="group" aria-label="Weather">
        {WEATHER.map(([w, label]) => (
          <button key={label} className={look.weather === w ? "on" : ""} aria-pressed={look.weather === w} onClick={() => setLook({ ...look, weather: w })}>
            {label}
          </button>
        ))}
      </div>
      <label className="g-photo-check">
        <input type="checkbox" checked={captioned} onChange={(e) => setCaptioned(e.target.checked)} /> Caption
      </label>
      <button className="g-btn primary" onClick={() => void save()}>
        {saved ?? "Save picture"}
      </button>
      <button className="g-btn" onClick={onClose} title="Leave photo mode (P or Esc)">
        Done
      </button>
    </div>
  );
}
