import { PLACES, isNight, type Place, type PlaceId } from "@psyche/engine";
import type { AgentSummary } from "./api";
import { clock } from "./util";

const ISLAND =
  "M 18 34 C 16 24, 26 16, 38 16 C 50 13, 62 12, 74 14 C 84 15, 92 20, 90 30 C 89 40, 84 50, 74 55 C 62 60, 46 59, 36 56 C 26 55, 14 54, 15 46 C 15.5 41, 20 40, 25 41 C 28 38, 23 35.5, 18 34 Z";

/** Hollow Bay: the bay opens to the west and north; the pinewood and quarry rise to the east. */
const BAY =
  "M 30 62 C 26 52, 14 50, 10 42 C 6 34, 18 30, 22 24 C 26 18, 30 10, 44 8 C 56 4, 70 0, 100 0 L 100 62 Z";

/** Mood shows as the ring around each person: warm accent when good, feeling colour when low. */
function moodColor(v: number): string {
  if (v > 0.12) return "var(--accent)";
  if (v < -0.12) return "var(--feel)";
  return "var(--muted)";
}

export function IslandMap({ agents, tick, selected, onSelect, places = PLACES, name = "Kettle Island", village = false }: { agents: AgentSummary[]; tick: number; selected?: string; onSelect: (id: string) => void; places?: Record<PlaceId, Place>; name?: string; village?: boolean }) {
  const night = isNight(tick);
  // A village has three times the people: smaller dots, wider rows.
  const perRow = village ? 4 : 3;
  const gap = village ? 4.6 : 6.6;
  const r = village ? 2.1 : 3;
  const byPlace = new Map<PlaceId, AgentSummary[]>();
  for (const a of agents) byPlace.set(a.place, [...(byPlace.get(a.place) ?? []), a]);
  const pos = (a: AgentSummary) => {
    const group = byPlace.get(a.place)!;
    const i = group.indexOf(a);
    const p = places[a.place] ?? { x: 50, y: 31 };
    // A small cluster above the place: short rows, stacking upward.
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, group.length - row * perRow);
    return { x: p.x + ((i % perRow) - (inRow - 1) / 2) * gap, y: p.y - (village ? 3.6 : 5) - row * gap };
  };
  return (
    <div className="map">
      <svg viewBox="0 0 100 62" role="img" aria-label={`Map of ${name} at ${clock(tick)}`}>
        <rect x="0" y="0" width="100" height="62" fill="var(--sea)" />
        <path d={village ? BAY : ISLAND} fill="var(--land)" stroke="var(--shore)" strokeWidth="0.6" />
        {village ? (
          <path d={Object.values(places).filter((p) => p.id !== "tavern" && p.id !== "sea").map((p) => `M ${places.tavern!.x} ${places.tavern!.y} L ${p.x} ${p.y}`).join(" ")} stroke="var(--path)" strokeWidth="0.4" strokeDasharray="1 1" fill="none" />
        ) : (
          <path d="M 31 37 L 40 47 M 31 37 L 21 48 M 31 37 L 44 23 M 40 47 L 53 36 L 67 28 M 53 36 L 64 50 M 53 36 L 80 18 M 31 37 L 25 28" stroke="var(--path)" strokeWidth="0.45" strokeDasharray="1 1" fill="none" />
        )}
        {Object.values(places).map((p) => {
          const home = village && p.id.startsWith("home_");
          const house = home && / house$/.test(p.name);
          return (
            <g key={p.id}>
              {!home && <circle cx={p.x} cy={p.y} r={p.social ? 1.3 : 0.9} fill={p.social ? "var(--ink)" : "var(--muted)"} />}
              {house && <path d={`M ${p.x - 1.4} ${p.y + 1} V ${p.y - 0.6} L ${p.x} ${p.y - 1.8} L ${p.x + 1.4} ${p.y - 0.6} V ${p.y + 1} Z`} fill="var(--ink)" />}
              {home && !house && <path d={`M ${p.x - 1.3} ${p.y + 1} L ${p.x} ${p.y - 1.4} L ${p.x + 1.3} ${p.y + 1} Z`} fill="none" stroke="var(--muted)" strokeWidth="0.4" />}
              <text x={p.x} y={p.y + 3.4} textAnchor="middle" className={`place-label ${p.social ? "" : "home"}`}>
                {p.id === "sea" ? (village ? "The bay" : "Fishing grounds") : home ? p.name.replace(/^the /, "").replace(/'s? (house|tents?)$/, "") : p.name.replace(/^the /, "")}
              </text>
            </g>
          );
        })}
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
              <circle r={on ? r + 1.4 : r + 0.9} fill="none" stroke={moodColor(a.mood)} strokeWidth={on ? 1.1 : 0.6} />
              <circle r={r} fill={`var(--a-${a.id})`} />
              <text y={village ? 0.75 : 1.05} textAnchor="middle" className="agent-initial" style={village ? { fontSize: "2.2px" } : undefined}>
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
