// Technology. The first seven crafts (knowledge.ts) are things one person can notice: when the
// tides run, which herbs break a fever. The later ones build on earlier ones and on the town itself.
//
// - They are cumulative: the plough needs fields already rested, iron needs a kiln's heat, the
//   sail needs both a keel and cloth, writing needs the habit of counting on tally sticks (accounts
//   came before letters; Schmandt-Besserat 1992).
// - They need people: a town of a dozen adults cannot keep, let alone find, what a town of fifty
//   can (Henrich 2004; Kline & Boyd 2010 on population size and toolkit complexity).
// - They answer pressure: someone works out the plough after hungry years, nursing after a plague,
//   mortar after a raid (Boserup 1965 on scarcity driving innovation). The pressure that was on the
//   town is kept as a cause, so the chronicle can say why this town found it and that one did not.
//
// Once found, a craft is a craft: it lives in people, is taught parent to child, is carried by
// traders and by households who move, and is lost when its last knower dies untaught. Unless
// someone wrote it down (records.ts).

import type { AgentId } from "../../types.js";
import { craft, knowledgeOf, knows, learn, TECHS, townCrafts, type Craft } from "../knowledge.js";
import { ageOf } from "../life.js";
import { openDebts } from "../money.js";
import { feed, luck, personName, type Sink, type Why, type WorldState } from "../world.js";
import { adultsOf, cap, civOf, note, plural, recent, trait } from "./base.js";
import { takeUp } from "./economy.js";

interface Spur {
  /** How hard the town is pressed toward it, around 1 (0.3 barely, 3 hard). */
  value: number;
  /** The pressure in words, when there is one worth naming. */
  text?: string;
}

/** What pushes a town toward each craft, read from what it has been through. */
const SPURS: Record<string, (w: WorldState) => Spur> = {
  pottery: (w) => {
    const h = recent(w, civOf(w)!.marks.hunger, 4);
    return h ? { value: 1 + 0.6 * h, text: `${w.name} had gone hungry in ${plural(h, "season")} of the last four years, with food rotting in baskets` } : { value: 0.8 };
  },
  weaving: (w) => {
    const c = recent(w, civOf(w)!.marks.cold, 4);
    return c ? { value: 1 + 0.5 * c, text: `people had wintered under canvas in ${plural(c, "winter")} of the last four` } : { value: 0.7 };
  },
  tally: (w) => {
    const debts = openDebts(w).length;
    const law = (w.village!.civic?.laws ?? []).some((l) => l.passed);
    const v = 0.3 + Math.min(1.6, debts * 0.2) + (law ? 0.6 : 0);
    return { value: v, text: debts >= 3 ? `${debts} debts were owed in ${w.name} and nobody could hold them all in mind` : law ? `the store law needed someone to count what each household put in` : undefined };
  },
  plough: (w) => {
    const h = recent(w, civOf(w)!.marks.hunger, 6);
    return h ? { value: 0.8 + 0.5 * h, text: `${plural(h, "hungry season")} in six years pushed the farmers to get more from the same ground` } : { value: 0.5 };
  },
  medicine: (w) => {
    const p = recent(w, civOf(w)!.marks.plague, 8);
    return p ? { value: 1 + p, text: `sickness had gone through ${w.name} ${p === 1 ? "once" : `${p} times`} in eight years` } : { value: 0.3 };
  },
  smelting: (w) => {
    const builders = w.order.filter((x) => ["builder", "quarrier", "woodcutter", "potter"].includes(w.agents[x]!.role)).length;
    return { value: 0.5 + Math.min(1, builders * 0.12) };
  },
  masonry: (w) => {
    const r = recent(w, civOf(w)!.marks.raided, 10);
    return r ? { value: 1 + r, text: `${w.name} had been raided ${r === 1 ? "once" : `${r} times`} in ten years and wanted walls that would hold` } : { value: 0.4 };
  },
  sails: (w) => {
    const t = recent(w, civOf(w)!.marks.trades, 3);
    return t >= 2 ? { value: 0.8 + 0.25 * t, text: `boats from ${w.name} had made ${t} trading runs in three years` } : { value: 0.4 };
  },
  writing: (w) => {
    const laws = (w.village!.civic?.laws ?? []).filter((l) => l.passed).length;
    const debts = openDebts(w).length;
    const v = 0.4 + Math.min(1.2, debts * 0.1) + Math.min(0.9, laws * 0.3);
    return { value: v, text: laws ? `${w.name} had ${plural(laws, "law")} that lived only in the mouths of those who remembered the vote` : debts >= 4 ? `the tally sticks said how much was owed but not by whom or why` : undefined };
  },
  arms: (w) => {
    const r = recent(w, civOf(w)!.marks.raided, 10) + recent(w, civOf(w)!.marks.raids, 10);
    return r ? { value: 0.8 + 0.7 * r, text: `${w.name} had been in ${plural(r, "raid")} in ten years` } : { value: 0.15 };
  },
};

/** Whose daily work puts them in the way of each craft. */
const NEAR: Record<string, string[]> = {
  pottery: ["cook", "thatcher", "forager"],
  weaving: ["thatcher", "forager", "cook"],
  tally: ["keeper", "merchant", "cook"],
  plough: ["farmer"],
  medicine: ["healer", "forager", "cook"],
  smelting: ["potter", "quarrier", "builder"],
  masonry: ["builder", "quarrier"],
  sails: ["fisher", "weaver", "merchant"],
  writing: ["keeper", "merchant", "scribe"],
  arms: ["smith", "builder", "woodcutter"],
};

/** Crafts the town could work out now: nobody has them, and everything they rest on is known here. */
export function openTechs(w: WorldState): Craft[] {
  const have = new Set(townCrafts(w));
  const adults = adultsOf(w).length;
  return TECHS.filter((t) => !have.has(t.id) && (t.needs ?? []).every((n) => have.has(n)) && adults >= (t.minAdults ?? 0));
}

/** What each later craft still waits on in this town, for the tech page. */
export function techTree(w: WorldState): { id: string; name: string; does: string; known: number; needs: { id: string; name: string; have: boolean }[]; minAdults?: number; open: boolean; lost?: number; trade?: string }[] {
  const have = new Set(townCrafts(w));
  const K = w.village!.knowledge;
  const open = new Set(openTechs(w).map((t) => t.id));
  return TECHS.map((t) => ({
    id: t.id,
    name: t.name,
    does: t.does,
    known: w.order.filter((x) => knows(w, x, t.id)).length,
    needs: (t.needs ?? []).map((n) => ({ id: n, name: craft(n).name, have: have.has(n) })),
    minAdults: t.minAdults,
    open: open.has(t.id),
    lost: K?.lost[t.id],
    trade: t.trade,
  }));
}

/**
 * Each autumn, in a town where the civilization systems run: someone may work out a later craft.
 * The curious and careful are likeliest, those whose work touches it likelier still, and the more
 * the town has been pressed toward it the likelier anyone is. One discovery a year at most.
 */
export function techTurn(w: WorldState, sink: Sink): void {
  const v = w.village!;
  if (!civOf(w) || v.season !== "autumn") return;
  const K = knowledgeOf(w);
  const open = openTechs(w);
  if (!open.length) return;
  const adults = adultsOf(w).filter((x) => ageOf(w, x) >= 16);
  // More minds, more chances: but each mind's chance is small.
  for (const t of open) {
    const spur = SPURS[t.id]?.(w) ?? { value: 1 };
    let found: AgentId | undefined;
    for (const id of adults) {
      const m = w.minds[id]!;
      const near = NEAR[t.id]?.includes(w.agents[id]!.role) ? 2.2 : 1;
      const p = 0.0016 * (0.4 + m.traits.openness) * (0.5 + m.traits.conscientiousness) * spur.value * near;
      if (luck(w, "tech", t.id, id) < p) {
        found = id;
        break;
      }
    }
    if (!found) continue;
    const m = w.minds[found]!;
    const lostAt = K.lost[t.id];
    learn(w, found, { craft: t.id, tick: w.tick, how: "worked out" });
    const why: Why[] = [{ agent: found, text: `${personName(w, found)} is curious and careful (${trait(m, "openness")}, ${trait(m, "conscientiousness")}), and ${NEAR[t.id]?.includes(w.agents[found]!.role) ? `as a ${w.agents[found]!.role} had their hands on what it grows out of` : "kept at it"}.` }];
    if (t.needs?.length) why.push({ text: `It rests on ${t.needs.map((n) => craft(n).name).join(" and ")}, which ${w.name} already knew.` });
    if (spur.text) why.push({ text: `${cap(spur.text)}.` });
    if (t.minAdults) why.push({ text: `${w.name} had ${adults.length} adults; fewer than ${t.minAdults} could not have kept it.` });
    if (lostAt !== undefined) why.push({ text: `${w.name} had known it before and lost it.` });
    const text = `${personName(w, found)} works out ${t.name}: ${t.does}.`;
    K.history.push({ tick: w.tick, craft: t.id, kind: "found", agent: found, text, why });
    feed(w, sink, { kind: "event", agents: [found], title: `${personName(w, found)} works out ${t.name}${lostAt !== undefined ? " again" : ""}`, text, chronicle: { kind: "craft", why } });
    note(w, { kind: "tech", title: `${personName(w, found)} works out ${t.name}`, text: t.does, agents: [found], why });
    // Whoever finds a trade's craft is its first practitioner, if the town can carry one.
    if (t.trade) takeUp(w, found, t.trade, sink, `${personName(w, found)} had just worked out ${t.name}`);
    break;
  }
}
