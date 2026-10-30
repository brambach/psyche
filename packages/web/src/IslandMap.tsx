import { PLACES, isNight, type PlaceId } from "@psyche/engine";
import type { AgentSummary } from "./api";
import { clock } from "./util";

const ISLAND =
  "M 18 34 C 16 24, 26 16, 38 16 C 50 13, 62 12, 74 14 C 84 15, 92 20, 90 30 C 89 40, 84 50, 74 55 C 62 60, 46 59, 36 56 C 26 55, 14 54, 15 46 C 15.5 41, 20 40, 25 41 C 28 38, 23 35.5, 18 34 Z";

/** Mood shows as the ring around each person: warm accent when good, feeling colour when low. */
function moodColor(v: number): string {
  if (v > 0.12) return "var(--accent)";
  if (v < -0.12) return "var(--feel)";
  return "var(--muted)";
}

export function IslandMap({ agents, tick, selected, onSelect }: { agents: AgentSummary[]; tick: number; selected?: string; onSelect: (id: string) => void }) {
  const night = isNight(tick);
  const byPlace = new Map<PlaceId, AgentSummary[]>();
  for (const a of agents) byPlace.set(a.place, [...(byPlace.get(a.place) ?? []), a]);
  const pos = (a: AgentSummary) => {
    const group = byPlace.get(a.place)!;
    const i = group.indexOf(a);
    const p = PLACES[a.place];
    // A small cluster above the place: rows of up to three, stacking upward.
    const row = Math.floor(i / 3);
    const inRow = Math.min(3, group.length - row * 3);
    return { x: p.x + ((i % 3) - (inRow - 1) / 2) * 6.6, y: p.y - 5 - row * 6.6 };
  };
  return (
    <div className="map">
      <svg viewBox="0 0 100 62" role="img" aria-label={`Map of Kettle Island at ${clock(tick)}`}>
        <rect x="0" y="0" width="100" height="62" fill="var(--sea)" />
        <path d={ISLAND} fill="var(--land)" stroke="var(--shore)" strokeWidth="0.6" />
        <path d="M 31 37 L 40 47 M 31 37 L 21 48 M 31 37 L 44 23 M 40 47 L 53 36 L 67 28 M 53 36 L 64 50 M 53 36 L 80 18 M 31 37 L 25 28" stroke="var(--path)" strokeWidth="0.45" strokeDasharray="1 1" fill="none" />
        {Object.values(PLACES).map((p) => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={p.social ? 1.3 : 0.9} fill={p.social ? "var(--ink)" : "var(--muted)"} />
            <text x={p.x} y={p.y + 3.4} textAnchor="middle" className={`place-label ${p.social ? "" : "home"}`}>
              {p.id === "sea" ? "Fishing grounds" : p.name.replace(/^the /, "")}
            </text>
          </g>
        ))}
        {night && <rect x="0" y="0" width="100" height="62" fill="var(--night)" opacity="0.45" pointerEvents="none" />}
        {agents.map((a) => {
          const { x, y } = pos(a);
          const on = a.id === selected;
          return (
            <g
              key={a.id}
              className="agent-dot"
              style={{ transform: `translate(${x}px, ${y}px)` }}
              onClick={() => onSelect(a.id)}
              role="button"
              tabIndex={0}
              aria-label={`${a.name}, ${a.activity}`}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(a.id)}
            >
              <circle r={on ? 4.4 : 3.9} fill="none" stroke={moodColor(a.mood)} strokeWidth={on ? 1.1 : 0.7} />
              <circle r="3" fill={`var(--a-${a.id})`} />
              <text y="1.05" textAnchor="middle" className="agent-initial">
                {a.name[0]}
              </text>
              {a.talking && (
                <g transform="translate(2.6 -5.6)">
                  <rect x="0" y="0" width="5" height="3" rx="1.2" fill="var(--surface)" stroke="var(--ink)" strokeWidth="0.3" />
                  <text x="2.5" y="2.1" textAnchor="middle" className="bubble">
                    ...
                  </text>
                </g>
              )}
              {a.activity === "asleep" && (
                <text x="3.6" y="-3.2" className="bubble">
                  z
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <span className="map-clock">{clock(tick)}{night ? " · night" : ""}</span>
    </div>
  );
}
