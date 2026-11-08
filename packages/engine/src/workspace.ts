// Global Workspace (Baars 1988; Dehaene 2014): candidates compete for about four slots
// (Cowan 2001). Only winners reach awareness, deliberation and speech.

import { render } from "./memory.js";
import { PARAMS } from "./params.js";
import type { Percept } from "./ports.js";
import type { RetrievalTrace, WorkspaceEntry } from "./trace.js";
import { EMOTION_NAMES, type MindState } from "./types.js";

const W = PARAMS.workspace;

export interface Competition {
  winners: WorkspaceEntry[];
  subliminal: WorkspaceEntry[];
  capacity: number;
}

export function compete(mind: MindState, p: Percept, retrieval: RetrievalTrace[]): Competition {
  const c: WorkspaceEntry[] = [];
  c.push({ ref: p.id, kind: "percept", label: p.gist, text: p.rawText, score: 1.2 + p.features.intensity * 0.5 });

  for (const r of retrieval) {
    if (!r.retrieved) continue;
    const score = 0.4 + 0.6 * Math.tanh((r.activation - PARAMS.memory.retrievalThreshold) / 4);
    if (r.kind === "episode") {
      const ep = mind.episodes.find((e) => e.id === r.id)!;
      // Emotionally charged memories capture attention more readily than neutral ones.
      const salience = 0.6 + 0.8 * Math.min(0.5, ep.arousal * Math.abs(ep.valence));
      c.push({ ref: ep.id, kind: "memory", label: ep.gist, text: render(ep), score: score * salience });
    } else {
      const b = mind.beliefs.find((x) => x.id === r.id)!;
      const from = b.source.kind === "told" && b.source.from ? ` (heard from ${mind.others[b.source.from]?.name ?? b.source.from})` : "";
      c.push({ ref: b.id, kind: "belief", label: b.proposition + from, text: b.proposition, score: score * (0.6 + 0.4 * b.confidence) });
    }
  }
  for (const k of EMOTION_NAMES) {
    const v = mind.affect.emotions[k];
    // Emotional states are prioritized for attention (affective prioritization).
    if (v > 0.2) c.push({ ref: `feeling:${k}`, kind: "feeling", label: `Feeling ${k}`, text: `${k} (${v.toFixed(2)})`, score: v * 1.5 });
  }
  const cueTopics = new Set([...p.topics, ...(p.request?.topics ?? [])]);
  for (const g of mind.goals) {
    if (g.tags.some((t) => cueTopics.has(t))) {
      c.push({ ref: g.id, kind: "goal", label: `Goal: ${g.text}`, text: g.text, score: g.priority * 0.85 });
    }
  }
  for (const [k, v] of Object.entries(mind.needs)) {
    if (1 - v > 0.6) c.push({ ref: `need:${k}`, kind: "need", label: `Need: ${k}`, text: `${k} is low`, score: (1 - v) * 0.6 });
  }

  c.sort((a, b) => b.score - a.score);
  let capacity: number = W.capacity;
  if (mind.affect.arousal > W.narrowingArousal) capacity -= 1;
  if (!mind.ablations.limitedWorkspace) capacity = c.length;
  return { winners: c.slice(0, capacity), subliminal: c.slice(capacity, capacity + W.subliminalShown), capacity };
}
