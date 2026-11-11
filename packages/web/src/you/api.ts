import type { Deed, YouAct, YouView } from "@psyche/engine";
import { call } from "../api";

export type { Ask, Deed, Reaction, Verdict, YouAct, YouView } from "@psyche/engine";

export const youApi = {
  /** Do one thing in the world. The answer carries how people took it. */
  act: (act: YouAct) => call<{ you: YouView | null; deed?: Deed }>("/api/you/act", { act }),
  /** "Still here, and standing at this place." Without it your body goes to rest. */
  beat: (place: string) => call<{ you: YouView | null }>("/api/you/beat", { place }),
};
