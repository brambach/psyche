import { dayOf, hourOf } from "@psyche/engine";
export function clockText(t: number): string {
  const h = hourOf(t);
  return `D${dayOf(t)} ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;
}
