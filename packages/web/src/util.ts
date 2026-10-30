import { dayOf, hourOf } from "@psyche/engine";

export function clock(t: number): string {
  const h = hourOf(t);
  const hh = String(Math.floor(h)).padStart(2, "0");
  const mm = String(Math.round((h % 1) * 60) % 60).padStart(2, "0");
  return `Day ${dayOf(t)} · ${hh}:${mm}`;
}

export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

/** Word-level diff (longest common subsequence), good enough for one remembered sentence. */
export function diffWords(a: string, b: string): DiffPart[] {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) push("same", x[i++]!), j++;
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push("del", x[i++]!);
    else push("ins", y[j++]!);
  }
  while (i < x.length) push("del", x[i++]!);
  while (j < y.length) push("ins", y[j++]!);
  return out;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const num = (x: number) => (x >= 0 ? " " : "") + x.toFixed(2);
