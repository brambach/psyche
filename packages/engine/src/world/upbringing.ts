// Upbringing, in a town. Once a season, after the births and deaths, every child gets a season of
// the care their household could actually give, and every adult a season of adult development. This
// file only gathers what the development code needs to know from the world (who is at home, how
// hungry the house was, who died); what that does to a person is in develop/.
//
// It runs the same in a live town and an aggregate one, and draws no numbers from the world's or
// anyone's random stream, so adding it changed nobody's luck.

import { backfill, bornWith, adultSeason, childSeason, meanMorals, noteParenting, GROWN, type CaregiverNow, type DevNote, type Loss, type SeasonContext } from "../develop/childhood.js";
import { caregiving, styleOf, STYLE_TEXT, type Caregiving, type Stressor } from "../develop/attachment.js";
import { keyedGaussian } from "../develop/core.js";
import { STATUS_TEXT } from "../develop/identity.js";
import { deepestRoot, strongest, rootsOf } from "../develop/lineage.js";
import { moralPortrait } from "../develop/morals.js";
import type { Morals } from "../develop/types.js";
import { dayOf } from "../mind.js";
import type { AgentId, MindState, Tick } from "../types.js";
import type { Household, VillageState } from "./village.js";
import { feed, type Sink, type WorldState } from "./world.js";

const DAY = 1440;
const yearTicks = (v: VillageState) => v.seasonDays * 4 * DAY;
const ageAt = (world: WorldState, id: AgentId) => {
  const l = world.village!.life[id];
  return l ? ((l.died ?? world.tick) - l.born) / yearTicks(world.village!) : 30;
};
const yearNow = (world: WorldState) => Math.floor((dayOf(world.tick) - 1) / (world.village!.seasonDays * 4)) + 1;
const houseOf = (v: VillageState, id: AgentId): Household | undefined => Object.values(v.households).find((h) => h.members.includes(id));

/** Give everyone who came grown a sketched childhood. Called when a town is founded, and lazily after. */
export function ensureDevelopment(world: WorldState): void {
  const v = world.village;
  if (!v) return;
  for (const id of world.order) {
    const m = world.minds[id]!;
    if (!m.dev) backfill(m, { seed: world.seed, now: world.tick, age: ageAt(world, id), role: world.agents[id]?.role, town: world.name });
  }
}

/** What a household has been under since `since`: hunger, a winter under canvas, a death in the house. */
export function householdStressors(world: WorldState, hh: Household | undefined, since: Tick): Stressor[] {
  const v = world.village!;
  if (!hh) return [];
  const out: Stressor[] = [];
  const when = `the ${v.season === "summer" ? "spring" : v.season === "autumn" ? "summer" : v.season === "winter" ? "autumn" : "winter"} of year ${yearNow(world)}`;
  let hunger = 0;
  if (v.aggregate) {
    const low = Math.min(1, ...hh.members.map((m) => world.minds[m]?.needs.energy ?? 1));
    hunger = Math.min(1, Math.max(0, (0.8 - low) * 1.6));
  } else {
    const nights = Math.max(0, ...hh.members.map((m) => world.minds[m]?.episodes.filter((e) => e.tick > since && e.id.startsWith("ev_hungry_")).length ?? 0));
    hunger = Math.min(1, (nights / v.seasonDays) * 1.2);
  }
  if (hunger >= 0.15) out.push({ kind: "hunger", intensity: Number(hunger.toFixed(2)), topics: ["food", "hunger", "winter", "store"], text: `the house went hungry in ${when}` });
  if (hh.shelter !== "house" && (v.season === "spring" || v.season === "winter")) out.push({ kind: "cold", intensity: 0.3, topics: ["winter", "shelter", "house"], text: "a winter under canvas" });
  for (const [id, l] of Object.entries(v.life)) {
    if (l.died === undefined || l.died <= since) continue;
    const close = l.partner && hh.members.includes(l.partner);
    const kin = hh.members.some((m) => l.parents.includes(m) || v.life[m]?.parents.includes(id));
    if (close || kin) out.push({ kind: "grief", intensity: close ? 0.6 : 0.45, topics: ["death", "grief", "family"], text: `${world.minds[id]?.name ?? world.agents[id]?.name ?? "someone"}'s death` });
  }
  return out;
}

function belongingNow(world: WorldState, id: AgentId): number {
  const v = world.village!;
  const m = world.minds[id]!;
  const l = v.life[id];
  let sum = 0;
  let n = 0;
  for (const o of world.order) {
    if (o === id) continue;
    const x = m.others[o];
    if (!x) continue;
    sum += x.liking;
    if (++n >= 40) break;
  }
  const liking = n ? sum / n : 0.5;
  const here = l ? (world.tick - Math.max(l.born, l.arrived ?? l.born)) / yearTicks(v) : 5;
  const born = !!l && l.generation > 0 && l.arrived === undefined;
  return Math.min(1, Math.max(0, 0.27 + (born ? 0.2 : 0) + 0.2 * Math.min(1, here / 10) + 0.9 * (liking - 0.5) + (l?.partner ? 0.08 : 0)));
}

/** A newborn's record: temperament, and whatever the months before the birth were like. */
export function bornInto(world: WorldState, child: MindState, parents: AgentId[]): void {
  const hh = houseOf(world.village!, parents[0]!);
  const since = world.tick - world.village!.seasonDays * DAY;
  bornWith(child, parents.map((p) => world.minds[p]!).filter(Boolean), { now: world.tick, seed: world.seed, stressors: householdStressors(world, hh, since) });
}

/** The season's development for everyone alive. */
export function upbringingTurn(world: WorldState, sink: Sink): void {
  const v = world.village;
  if (!v) return;
  ensureDevelopment(world);
  const yt = yearTicks(v);
  const live = !v.aggregate;
  const adults = world.order.filter((id) => ageAt(world, id) >= GROWN);
  const townMorals: Morals | undefined = meanMorals(adults.map((id) => world.minds[id]!));
  const dead = Object.entries(v.life).filter(([, l]) => l.died !== undefined && world.tick - l.died <= v.seasonDays * DAY * 2);
  const stress = new Map<string, Stressor[]>();
  const stressorsFor = (hh: Household | undefined, since: Tick) => {
    if (!hh) return [];
    const key = `${hh.id}|${since}`;
    let s = stress.get(key);
    if (!s) stress.set(key, (s = householdStressors(world, hh, since)));
    return s;
  };
  const parenting = new Map<AgentId, Caregiving[]>();

  for (const id of world.order) {
    const m = world.minds[id]!;
    const dev = m.dev!;
    const l = v.life[id];
    if (!l) continue;
    const age = ageAt(world, id);
    const since = dev.lastTurn;
    const hh = houseOf(v, id);
    const stressors = stressorsFor(hh, since);
    const losses: Loss[] = [];
    for (const [d, dl] of dead) {
      if (dl.died! <= since || d === id) continue;
      const name = world.minds[d]?.name ?? world.agents[d]?.name ?? d;
      const cause = dl.cause ?? "an illness";
      if (l.parents.includes(d)) losses.push({ who: d, name, relation: "parent", cause });
      else if (dl.partner === id) losses.push({ who: d, name, relation: "partner", cause });
      else if (dl.parents.includes(id)) losses.push({ who: d, name, relation: "child", cause });
      else if (dev.care.by[d] && age < GROWN) losses.push({ who: d, name, relation: "carer", cause });
      else if (l.parents.length && dl.parents.some((p) => l.parents.includes(p))) losses.push({ who: d, name, relation: "sibling", cause });
    }
    const base = { now: world.tick, age, yearTicks: yt, seed: world.seed, stressors, losses, townMorals, town: world.name, role: world.agents[id]?.role, belonging: belongingNow(world, id) };
    let notes: DevNote[];
    if (age < GROWN) {
      const kids = hh ? hh.members.filter((x) => ageAt(world, x) < GROWN).length : 1;
      const caregivers: CaregiverNow[] = [];
      for (const c of hh?.members ?? []) {
        if (c === id || ageAt(world, c) < GROWN) continue;
        const cm = world.minds[c]!;
        const care = caregiving(cm, stressors, kids, keyedGaussian(world.seed, world.tick, `care|${c}|${id}`), keyedGaussian(world.seed, 0, `fit|${c}|${id}`));
        const parent = l.parents.includes(c);
        caregivers.push({ mind: cm, parent, weight: parent ? 1 : 0.35, care });
        (parenting.get(c) ?? parenting.set(c, []).get(c)!).push(care);
      }
      const ctx: SeasonContext = { ...base, caregivers };
      notes = childSeason(m, ctx);
      if (live) {
        for (const n of notes.filter((x) => x.kind === "adversity")) feed(world, sink, { kind: "insight", agents: [id], title: `${m.name}: ${n.text}`, text: `It goes into who ${m.pronouns.subject} will be. See ${m.pronouns.possessive} Roots.` });
      }
    } else {
      const partner = l.partner && world.order.includes(l.partner) ? world.minds[l.partner] : undefined;
      const children = world.order.filter((x) => v.life[x]?.parents.includes(id)).length;
      const cameNow = l.arrived !== undefined && l.arrived > since;
      const wasChild = !dev.attachmentAt.grown && dev.lived;
      notes = adultSeason(m, { ...base, caregivers: [], partner, children, newYear: v.season === "spring", crisis: cameNow ? "came to a new town" : undefined });
      if (wasChild && live) feed(world, sink, { kind: "insight", agents: [id], title: `${m.name} is grown`, text: grownText(world, id) });
      else if (live) for (const n of notes.filter((x) => x.kind === "identity" || x.kind === "attachment")) feed(world, sink, { kind: "insight", agents: [id], title: `${m.name}: ${n.text}` });
    }
  }
  for (const [c, cares] of parenting) {
    const mean = (f: (x: Caregiving) => number) => cares.reduce((s, x) => s + f(x), 0) / cares.length;
    noteParenting(world.minds[c]!, { ...cares[0]!, warmth: mean((x) => x.warmth), control: mean((x) => x.control) });
  }
}

/** Who someone has become on coming of age, and the one thing that most made them so. */
export function grownText(world: WorldState, id: AgentId): string {
  const m = world.minds[id]!;
  const d = m.dev!;
  const style = styleOf(m.attachment);
  const parts = [`${STYLE_TEXT[style]}.`];
  const target = m.attachment.avoidance >= m.attachment.anxiety ? "avoidance" : "anxiety";
  if (style !== "secure") {
    const deep = deepestRoot(world.minds, id, target);
    const top = rootsOf(world.minds, id, target)[0];
    if (top) parts.push(top.text);
    if (deep && deep.generations > 0 && deep.step.kind === "memory") parts.push(`It goes back to something ${deep.step.name} carried: ${deep.step.text.replace(/^[^:]+: /, "")}`);
    else if (top) {
      const chain = strongest(top);
      if (chain.length > 1) parts.push(chain[chain.length - 1]!.text + ".");
    }
  } else {
    const top = rootsOf(world.minds, id, "anxiety")[0];
    if (top) parts.push(top.text);
  }
  const hard = d.adversity.filter((a) => !a.buffered).length;
  if (d.adversity.length) parts.push(`${d.adversity.length} hard thing${d.adversity.length === 1 ? "" : "s"} before seventeen${hard ? `, ${hard} with nobody warm there` : ", each with someone warm there"}.`);
  parts.push(`${STATUS_TEXT[d.identity.status]}.`);
  const c = moralPortrait(d.morals);
  if (c.length) parts.push(`${c.join(". ")}.`);
  return parts.join(" ");
}
