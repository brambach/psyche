// Seasonal intentions. When a season turns, each adult in a town someone is watching sits with it and
// decides what they mean to do with the next one: ask the town to build something, put more by,
// give their hours to the work going up, teach what they know, court someone, make peace with
// someone, stand against the leader, or keep to themselves. The menu is typed and built from the
// world and their mind; the choice is theirs, made through their own deliberation (System 2,
// citing what is in mind), so it lands in the ledger like any other decision.
//
// An intention then leans on what they do that season: the pledge, the vote, who they court, who
// they teach, whether they go out of an evening. Each lean is a term in a later choice, with a ref
// back to the intention, so the analysis layer can show "meant to" as a cause.

import { runPercept } from "../mind.js";
import type { ActionOption, Faculties } from "../ports.js";
import type { AgentId, Tick } from "../types.js";
import { CRAFTS, knows } from "./knowledge.js";
import { ageOf, isChild, yearOf } from "./life.js";
import { civicSite, concernFor, openKinds, WORKS, works, type WorkKind } from "./works.js";
import { eventPercept, feed, personName, record, type Sink, type WorldState } from "./world.js";

export type IntentKind = "propose" | "store" | "help" | "teach" | "court" | "amends" | "challenge" | "keep";

export interface Intention {
  agent: AgentId;
  tick: Tick;
  season: string;
  year: number;
  kind: IntentKind;
  /** A work kind, a craft id or a person, by kind. */
  target?: string;
  /** "Ask the town to build the granary" */
  label: string;
  /** Their own words, when they thought it through. */
  words?: string;
  /** What drove it, as labels of what was in mind. */
  because: string[];
  /** The decision's trace. */
  trace: string;
  /** For a proposal: what on their mind made them want it. */
  why?: string;
}

const KEEP = 300;
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** What someone means to do this season, if they decided anything. */
export const intentOf = (w: WorldState, id: AgentId): Intention | undefined => w.village?.intent?.[id];

/**
 * A lean toward the option that carries out an intention: a pull term with a ref back to the
 * decision, for a later choice's scoring. `matches` says which option ids carry it out.
 */
export function steer(w: WorldState, id: AgentId, options: ActionOption[], matches: Partial<Record<IntentKind, string>>, size = 0.35): ActionOption[] {
  const it = intentOf(w, id);
  const want = it && matches[it.kind];
  if (!it || !want) return options;
  return options.map((o) => (o.id === want ? { ...o, pull: [...(o.pull ?? []), { name: `meant to: ${it.label.replace(/^./, (c) => c.toLowerCase())}`, value: size, ref: `intent:${it.trace}` }] } : o));
}

/** The menu for one person this season, each option with what draws them to it. */
export function menu(w: WorldState, id: AgentId): ActionOption[] {
  const v = w.village!;
  const m = w.minds[id]!;
  const out: ActionOption[] = [];
  const age = ageOf(w, id);
  // A work to ask for: the one that speaks to them most, if any does.
  const asks = openKinds(w)
    .map((k) => ({ k, c: concernFor(w, id, k) }))
    .filter((x) => x.c.score >= 0.2)
    .sort((a, b) => b.c.score - a.c.score)
    .slice(0, 2);
  if (!works(w).some((x) => x.status === "proposed" || x.status === "building")) {
    for (const { k, c } of asks) {
      out.push({
        id: `propose:${k}`,
        label: `Ask the town to build ${WORKS[k].name}`,
        verb: `ask the town to build ${WORKS[k].name}`,
        description: `Stand up at the fire and ask for it. ${WORKS[k].does} It takes the town's timber and stone and weeks of hours.`,
        prosocial: 0.5,
        assertive: 0.5,
        avoidant: 0,
        disclosure: 0.4,
        coping: "problem",
        act: `means to ask the town for ${WORKS[k].name}`,
        pull: c.motives.map((x) => ({ name: x.name, value: Math.min(0.4, x.value * 0.6), ref: x.ref })),
      });
    }
  }
  const lean = v.store.food < w.order.length * 4;
  out.push({
    id: "store",
    label: "Put more by in the common store",
    verb: "put more by this season",
    description: `Give the store a full share, and more when there's a surplus. It holds ${Math.round(v.store.food)} now.`,
    prosocial: 0.75,
    assertive: 0,
    avoidant: 0,
    disclosure: 0.1,
    coping: "problem",
    act: "means to put more by this season",
    pull: [
      ...(lean ? [{ name: `a store of ${Math.round(v.store.food)} for ${w.order.length}`, value: 0.15 }] : []),
      ...m.schemas.filter((s) => s.triggers.some((t) => ["food", "winter", "hunger", "store"].includes(t)) && s.threatBias > 0).map((s) => ({ name: `the core belief “${s.text}”`, value: 0.15 * s.strength, ref: s.id })),
    ],
  });
  const site = civicSite(w);
  if (site && site.status === "building") {
    out.push({
      id: "help",
      label: `Give spare hours to ${site.name}`,
      verb: `help raise ${site.name}`,
      description: `Go to the building site after my own work and set blocks. It is ${Math.round((site.work / Math.max(0.1, site.hours)) * 100)}% done.`,
      prosocial: 0.65,
      assertive: 0,
      avoidant: 0,
      disclosure: 0.2,
      coping: "problem",
      act: `means to help raise ${site.name}`,
      pull: [{ name: "a sense of duty", value: 0.2 * (m.traits.conscientiousness - 0.5) }, ...(site.votes.find((x) => x.agent === id)?.support ? [{ name: "backed it at the vote", value: 0.1 }] : [])],
    });
  }
  // Teaching: a craft they know that someone close does not.
  const mine = (v.knowledge?.known[id] ?? []).map((k) => k.craft);
  const craft = mine.find((c) => w.order.some((x) => x !== id && ageOf(w, x) >= 9 && !knows(w, x, c)));
  if (craft && age >= 18) {
    const C = CRAFTS.find((c) => c.id === craft)!;
    const few = w.order.filter((x) => knows(w, x, craft)).length;
    out.push({
      id: `teach:${craft}`,
      label: `Teach someone ${C.name}`,
      verb: `teach someone ${C.name}`,
      description: `Take a pupil and show them ${C.name}. ${few <= 2 ? `Only ${few} here know it.` : ""}`.trim(),
      prosocial: 0.6,
      assertive: 0.1,
      avoidant: 0,
      disclosure: 0.5,
      coping: "problem",
      act: `means to teach someone ${C.name}`,
      pull: few <= 2 ? [{ name: `only ${few} know ${C.name}`, value: 0.15 }] : [],
    });
  }
  // Courting: an unpartnered adult they like, not kin.
  const life = v.life[id];
  if (life && !life.partner && age >= 18 && age < 46) {
    const kin = new Set([...life.parents, ...w.order.filter((x) => v.life[x]?.parents.some((p) => life.parents.includes(p)) || v.life[x]?.parents.includes(id))]);
    const best = w.order
      .filter((x) => x !== id && !kin.has(x) && !v.life[x]?.partner && ageOf(w, x) >= 18 && ageOf(w, x) < 46 && (m.others[x]?.liking ?? 0) > 0.58)
      .sort((a, b) => m.others[b]!.liking - m.others[a]!.liking || a.localeCompare(b))[0];
    if (best) {
      const n = personName(w, best);
      out.push({ id: `court:${best}`, label: `Court ${n}`, verb: `court ${n}`, description: `Seek ${n} out, sit with them of an evening, see if it could be more.`, prosocial: 0.3, assertive: 0.2, avoidant: 0, disclosure: 0.8, coping: "social", act: `means to court ${n}`, pull: [{ name: `liking for ${n}`, value: (m.others[best]!.liking - 0.5) * 0.8, ref: `other:${best}` }, { name: "need for connection", value: 0.2 * (1 - m.needs.relatedness) }] });
    }
  }
  // Amends: someone they have fallen out with.
  const worst = w.order.filter((x) => x !== id && m.others[x] && m.others[x]!.liking < 0.38).sort((a, b) => m.others[a]!.liking - m.others[b]!.liking || a.localeCompare(b))[0];
  if (worst) {
    const n = personName(w, worst);
    out.push({ id: `amends:${worst}`, label: `Make peace with ${n}`, verb: `make peace with ${n}`, description: `Go to ${n}, say what needs saying, and try to put it right between us.`, prosocial: 0.8, assertive: 0.1, avoidant: 0, disclosure: 0.6, coping: "social", act: `means to make peace with ${n}`, pull: [{ name: "a wish to get on with people", value: 0.25 * (m.traits.agreeableness - 0.5) }, { name: `falling out with ${n}`, value: 0.1, ref: `other:${worst}` }] });
  }
  // Challenging: a leader they don't much like.
  const leader = v.civic?.leader;
  if (leader && leader !== id && w.order.includes(leader) && age >= 18 && (m.others[leader]?.liking ?? 0.5) < 0.48) {
    const n = personName(w, leader);
    out.push({ id: "challenge", label: `Stand against ${n} in spring`, verb: `stand against ${n}`, description: `Let it be known I would lead ${w.name} better than ${n}, and ask people for their names in spring.`, prosocial: -0.1, assertive: 0.9, avoidant: 0, disclosure: 0.4, coping: "problem", act: `means to stand against ${n}`, pull: [{ name: `dislike of ${n}`, value: (0.5 - (m.others[leader]?.liking ?? 0.5)) * 1.2, ref: `other:${leader}` }] });
  }
  out.push({ id: "keep", label: "Keep to myself and my own", verb: "keep to myself", description: "Mind my own household and my own work this season, and stay in of an evening.", prosocial: -0.1, assertive: 0, avoidant: 0.8, disclosure: -0.2, coping: "avoid", act: "means to keep to themselves this season", pull: [{ name: "a habit of keeping people at a distance", value: 0.2 * m.attachment.avoidance }] });
  return out;
}

const parse = (id: string): { kind: IntentKind; target?: string } => {
  const [k, t] = id.split(":") as [IntentKind, string | undefined];
  return { kind: k, target: t };
};

/**
 * Once a season, before anything else that season: each adult decides what they mean to do with it.
 * Returns the proposal to put to the town, if anyone means to ask for a work.
 */
export async function intentionsSeason(w: WorldState, faculties: Faculties, sink: Sink): Promise<{ who: AgentId; kind: WorkKind; why: string } | undefined> {
  const v = w.village!;
  v.intent = {};
  const adults = w.order.filter((x) => !isChild(w, x) && ageOf(w, x) >= 16);
  const evId = `ev_season_${w.tick}`;
  w.events.push({ id: evId, tick: w.tick, kind: "season", label: `the turn of ${v.season}, year ${yearOf(w)}`, topics: ["season", "plans", evId] });
  const store = Math.round(v.store.food);
  const going = works(w).find((x) => x.status === "building");
  const standing = works(w).filter((x) => x.status === "done").map((x) => x.name);
  const leader = v.civic?.leader && w.order.includes(v.civic.leader) ? personName(w, v.civic.leader) : undefined;
  const scene = [
    `${cap(v.season)} has come to ${w.name}, year ${yearOf(w)}.`,
    `The common store holds ${store} days' food for ${w.order.length} people.`,
    going ? `${cap(going.name)} is going up.` : standing.length ? `The town has built ${standing.join(", ")}.` : "The town has built nothing together yet.",
    leader ? `${leader} leads.` : "Nobody leads yet.",
    "What do I mean to do with this season?",
  ].join(" ");
  const proposals: { who: AgentId; kind: WorkKind; why: string; score: number }[] = [];
  for (const id of adults) {
    const m = w.minds[id]!;
    const options = menu(w, id);
    const topics = ["season", "plans", "village", ...new Set(options.flatMap((o) => (o.id.startsWith("propose:") ? WORKS[o.id.slice(8) as WorkKind].topics : o.id === "store" ? ["store", "food", "winter"] : o.id.startsWith("court:") || o.id.startsWith("amends:") ? ["love", "trust"] : [])))];
    const pc = eventPercept(m, "world", "self", 0, 0.6, [...topics, evId], `At the turn of ${v.season} I sat and thought about what to do with the season.`, scene, evId);
    pc.features.prospective = true;
    pc.options = options;
    pc.reflect = true;
    const tr = await runPercept(m, pc, faculties);
    record(w, sink, id, tr);
    const choice = tr.decision?.choice ?? "keep";
    const opt = options.find((o) => o.id === choice) ?? options.at(-1)!;
    const { kind, target } = parse(opt.id);
    const it: Intention = {
      agent: id,
      tick: w.tick,
      season: v.season,
      year: yearOf(w),
      kind,
      target,
      label: opt.label,
      words: tr.decision?.monologue,
      // What drew them to it (the option's own pull), then what they cited when they thought it over.
      because: [...new Set([...(opt.pull ?? []).filter((x) => x.value > 0.02).sort((a, b) => b.value - a.value).map((x) => x.name), ...(tr.decision?.because ?? []).map((b) => tr.workspace.find((x) => x.ref === b.ref)?.label ?? b.ref)])].slice(0, 3),
      trace: tr.id,
    };
    if (kind === "propose") {
      const c = concernFor(w, id, target as WorkKind);
      it.why = c.why || "what the town needs";
      proposals.push({ who: id, kind: target as WorkKind, why: it.why, score: c.score });
    }
    v.intent[id] = it;
    (v.intentions ??= []).push(it);
  }
  if (v.intentions && v.intentions.length > KEEP) v.intentions.splice(0, v.intentions.length - KEEP);
  // Making peace happens now: they go and say it, and the other hears it through their own mind.
  for (const it of Object.values(v.intent)) if (it.kind === "amends" && it.target && w.order.includes(it.target)) await amends(w, it, faculties, sink);
  const said = Object.values(v.intent);
  const count = (k: IntentKind) => said.filter((x) => x.kind === k).length;
  const lines = [
    count("propose") ? `${count("propose")} mean to ask the town to build something` : "",
    count("store") ? `${count("store")} to put more by` : "",
    count("help") ? `${count("help")} to help raise ${going?.name ?? "the work"}` : "",
    count("teach") ? `${count("teach")} to teach` : "",
    count("court") ? `${count("court")} to court someone` : "",
    count("amends") ? `${count("amends")} to make peace` : "",
    count("challenge") ? `${count("challenge")} to stand against ${leader ?? "the leader"}` : "",
    count("keep") ? `${count("keep")} to keep to themselves` : "",
  ].filter(Boolean);
  if (said.length) feed(w, sink, { kind: "event", agents: said.filter((x) => x.kind !== "keep").map((x) => x.agent).slice(0, 8), title: `What ${w.name} means to do this ${v.season}`, text: `${cap(lines.join("; "))}.` });
  const best = proposals.sort((a, b) => b.score - a.score || a.who.localeCompare(b.who))[0];
  return best ? { who: best.who, kind: best.kind, why: best.why } : undefined;
}

async function amends(w: WorldState, it: Intention, faculties: Faculties, sink: Sink): Promise<void> {
  const B = w.minds[it.target!]!;
  const a = personName(w, it.agent);
  const evId = `ev_amends_${it.agent}_${w.tick}`;
  const pc = eventPercept(B, it.agent, "other", 0.35, 0.55, ["amends", "trust", "help", evId], `${a} came to make peace with me.`, `${a} comes to find ${B.name}: "I've been wrong with you. I'd like to put it right between us."`, evId, [it.agent]);
  pc.kind = "speech";
  pc.addressedToSelf = true;
  pc.features.intentional = 0.8;
  const tr = await runPercept(B, pc, faculties);
  record(w, sink, it.target!, tr);
  const warm = tr.decision?.choice === "warm";
  // Heard out, the one who came feels the quarrel ease; turned away, it sticks a little more.
  const mine = w.minds[it.agent]!.others[it.target!];
  if (mine) {
    mine.liking = Math.max(0, Math.min(1, mine.liking + (warm ? 0.1 : -0.03)));
    if (warm) mine.trust.benevolence = Math.min(1, mine.trust.benevolence + 0.05);
  }
  feed(w, sink, { kind: "event", agents: [it.agent, it.target!], title: `${a} goes to make peace with ${B.name}`, text: warm ? `${B.name} hears ${a} out.` : `${B.name} isn't ready to hear it.`, refs: [{ agent: it.agent, trace: it.trace }, { agent: it.target!, trace: tr.id }] });
}
