import type { Ablations, Frame, Input, MindState } from "@psyche/engine";

export interface View {
  faculties: "claude" | "mock";
  seed: number;
  ablations: Ablations;
  initial: MindState;
  frames: Frame[];
  calls: number;
}

async function call(path: string, body?: unknown): Promise<View> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as View;
}

export const api = {
  get: () => call("/api/session"),
  input: (input: Input) => call("/api/input", { input }),
  rewind: (index: number) => call("/api/rewind", { index }),
  reset: (opts: { seed?: number; ablations?: Partial<Ablations>; demo?: boolean }) => call("/api/reset", opts),
  rerun: (ablations: Partial<Ablations>) => call("/api/rerun", { ablations }),
};
