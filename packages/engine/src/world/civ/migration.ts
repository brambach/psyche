// Households that move. A town splitting (region.ts) is one way people come to live somewhere
// else; this is the other, and the commoner one: a single household decides it would be better off
// in another town, and goes.
//
// The head of the household weighs it through their own mind. What pushes: hunger, not belonging,
// being on the side that keeps losing, debts they cannot pay, sickness in the town, a raid. What
// pulls: a town with more to eat, kin or friends who went there before, what they believe of the
// place. What holds: bonds, age, a house already built (Lee 1966, push and pull with intervening
// obstacles; Hirschman 1970: when voice has failed, exit).
//
// They take everything that is theirs: their minds and memories, what they know how to do (which
// is how a craft most often reaches a town that lacks it), what they believe, their goods and
// amber, and any sickness they are carrying. The town they come to takes them in as strangers,
// coloured by what it already believes of where they came from.
//
// A whole side that has lost and means to leave (factions.ts) goes together: to found a town of
// its own if there is room on the coast, otherwise to whichever town will have it.

import { clamp } from "../../memory.js";
import type { AgentId } from "../../types.js";
import { craft, knowledgeOf, townCrafts } from "../knowledge.js";
import { ageOf, isChild, yearOf } from "../life.js";
import { moneyOf, openDebts } from "../money.js";
import { other } from "../people.js";
import { carryLineage, type Town } from "../region.js";
import type { Household } from "../village.js";
import { carryWords } from "../voice.js";
import { eventPercept, feed, personName, type Sink, type Why, type WorldState } from "../world.js";
import { cap, choose, civOf, DAY, headOf, hhOf, homesOf, list, mean, note, plural, recent, round, townBeliefOf, witness } from "./base.js";
import { activeOutbreak, carryHealth, expose } from "./disease.js";
import { ease, factionOf, liveFactions, rivalryBetween } from "./factions.js";
import { hostile, regionCiv, type CivHost, type Move } from "./host.js";
import { landingClosed } from "./polity.js";

type Term = { name: string; value: number; ref?: string };
const total = (xs: Term[]) => xs.reduce((s, x) => s + x.value, 0);
const perHead = (w: WorldState) => (w.village!.store.food + Object.values(w.village!.households).reduce((s, h) => s + h.food, 0)) / Math.max(1, w.order.length);

/** What is pushing a household out of its town. */
function pushOf(w: WorldState, hh: Household, head: AgentId): Term[] {
  const c = civOf(w)!;
  const v = w.village!;
  const m = w.minds[head]!;
  const out: Term[] = [];
  const add = (name: string, value: number, ref?: string) => {
    if (value > 0.01) out.push({ name, value: round(value, 3), ref });
  };
  const hungry = recent(w, c.marks.hunger, 1);
  add(`${plural(hungry, "hungry season")} in the last year`, Math.min(0.24, 0.08 * hungry));
  const need = hh.members.length;
  add("little in the house", hh.food < need * 2 && hungry ? 0.08 : 0);
  const adults = w.order.filter((x) => ageOf(w, x) >= 16 && !hh.members.includes(x));
  const belonging = adults.length ? mean(adults.map((o) => m.others[o]?.liking ?? 0.5)) : 0.5;
  add(`never at home here (likes the rest ${belonging.toFixed(2)})`, (0.5 - belonging) * 1.5);
  const f = factionOf(w, head);
  if (f?.lost) add(`on the side that has lost ${plural(f.lost, "election")} running`, 0.08 * Math.min(3, f.lost));
  if (f && c.factions.exit?.faction === f.id) add(`${f.name} talk of leaving`, 0.12);
  const debt = openDebts(w).find((d) => d.overdue && hh.members.includes(d.debtor));
  add("debts past their day", debt ? 0.12 : 0);
  add("sickness in the town", activeOutbreak(w) ? 0.15 : 0);
  const life = v.life[head];
  add("years here and still under canvas", hh.shelter !== "house" && w.tick - (life?.arrived ?? 0) > 3 * v.seasonDays * 4 * DAY ? 0.08 : 0);
  const raid = [...m.episodes].reverse().find((e) => e.topics.includes("raid") && e.valence < -0.3);
  add("the raid", recent(w, c.marks.raided, 1) ? 0.14 : 0, raid?.id);
  const g = c.economy.gouges.find((x) => w.tick - x.tick < v.seasonDays * 4 * DAY && x.buyers.some((b) => hh.members.includes(b)));
  add("charged dear for food here", g ? 0.05 : 0, g?.trace);
  return out;
}

/** What draws a household's head to another town, as they see it from home. */
function pullOf(host: CivHost, a: Town, b: Town, head: AgentId): Term[] {
  const A = host.world(a.id);
  const B = host.world(b.id);
  const m = A.minds[head]!;
  const out: Term[] = [];
  const add = (name: string, value: number) => {
    if (Math.abs(value) > 0.01) out.push({ name, value: round(value, 3) });
  };
  add(`more to eat in ${b.name}`, clamp((perHead(B) - perHead(A)) / 8, -0.15, 0.25));
  const gone = Object.entries(host.region.departed).filter(([id, d]) => d.to === b.id && B.order.includes(id));
  const friend = gone.map(([id]) => id).filter((id) => (m.others[id]?.liking ?? 0) > 0.6 || A.village!.life[head]?.parents.includes(id) || A.village!.life[id]?.parents.includes(head));
  add(`${friend[0] ? personName(A, friend[0]) : "someone"} went there before`, friend.length ? 0.15 : 0);
  add(`what ${m.pronouns.subject} believes of ${b.name}`, 0.3 * townBeliefOf(m, b.id));
  add("room to build", B.order.length < 20 ? 0.05 : 0);
  add("sickness there", activeOutbreak(B) ? -0.3 : 0);
  return out;
}

function holdOf(w: WorldState, hh: Household, head: AgentId): Term[] {
  const m = w.minds[head]!;
  const others = w.order.filter((x) => !hh.members.includes(x));
  const bonds = others.map((o) => m.others[o]?.bond ?? 0).sort((x, y) => y - x).slice(0, 5);
  const out: Term[] = [{ name: "the people here", value: round(0.5 * mean(bonds) + 0.25 * (mean(others.map((o) => m.others[o]?.liking ?? 0.5)) - 0.5), 3) }, { name: "it is a long way to go on a guess", value: 0.22 }];
  if (ageOf(w, head) > 50) out.push({ name: "too old to start again", value: 0.15 });
  if (hh.shelter === "house") out.push({ name: "a house already built", value: 0.1 });
  if (hh.members.some((x) => ageOf(w, x) < 4)) out.push({ name: "small children", value: 0.06 });
  return out;
}

/**
 * Move one household from town `a` to town `b`, with everything that is theirs. Returns who went.
 */
export function moveHousehold(host: CivHost, a: Town, b: Town, hh: Household): AgentId[] {
  const A = host.world(a.id);
  const B = host.world(b.id);
  const va = A.village!;
  const vb = B.village!;
  const ids = hh.members.filter((x) => A.order.includes(x));
  if (!ids.length) return [];
  const sB = host.sink(b.id);
  const home = `home_${hh.id}`;
  const k = Object.keys(vb.households).length + Object.keys(B.places).filter((p) => p.startsWith("home_")).length;
  const row = Math.floor(k / 5);
  B.places[home] ??= { id: home, name: `${hh.name}' tents`, x: 32 + (k % 5) * 10 + (row % 2) * 5, y: 43 + (row % 3) * 8, social: false, outdoors: false, topics: ["home"] };
  vb.households[hh.id] = { ...structuredClone(hh), members: [...ids], home, shelter: "tent", rate: 0 };
  const MA = moneyOf(A);
  const MB = moneyOf(B);
  const KA = va.knowledge;
  const KB = knowledgeOf(B);
  const had = new Set(townCrafts(B));
  const here = [...B.order];
  let sickness: string | undefined;
  for (const id of ids) {
    const mind = structuredClone(A.minds[id]!);
    mind.tick = B.tick;
    B.minds[id] = mind;
    const agent = structuredClone(A.agents[id]!);
    const old = agent.home;
    agent.home = home;
    agent.place = "harbour";
    agent.activity = `just come from ${a.name}`;
    agent.override = undefined;
    agent.talkingUntil = undefined;
    agent.wants = [];
    agent.lastTalk = {};
    agent.routine = agent.routine.map((e) => ({ ...e, place: e.place === old ? home : e.place, evening: e.evening && { ...e.evening, place: e.evening.place === old ? home : e.evening.place } }));
    B.agents[id] = agent;
    const life = structuredClone(va.life[id]!);
    if (life.partner && !ids.includes(life.partner)) {
      if (va.life[life.partner]) va.life[life.partner]!.partner = undefined;
      life.partner = undefined;
    }
    vb.life[id] = { ...life, arrived: B.tick };
    if (KA?.known[id]?.length) KB.known[id] = structuredClone(KA.known[id]!);
    MB.held[id] = MA.held[id] ?? 0;
    if (MA.accept[id] !== undefined) MB.accept[id] = MA.accept[id]!;
    delete MA.held[id];
    sickness = carryHealth(A, B, id) ?? sickness;
    for (const o of here) {
      const om = B.minds[o]!;
      const warm = clamp(0.45 + 0.2 * townBeliefOf(om, a.id) - 0.25 * Math.max(0, ...om.schemas.filter((s) => s.threatBias > 0 && s.triggers.some((t) => t === "stranger" || t === "newcomer")).map((s) => s.strength)));
      om.others[id] ??= other(id, mind.name, round(warm), round(warm), 0);
      mind.others[o] ??= other(o, om.name, 0.5, 0.5, 0);
    }
  }
  for (const id of ids) B.order.push(id);
  const ca = civOf(A);
  const cb = civOf(B);
  if (ca && cb) {
    if (ca.economy.goods[hh.id]) cb.economy.goods[hh.id] = ca.economy.goods[hh.id]!;
    delete ca.economy.goods[hh.id];
    for (const id of ids) {
      if (ca.economy.was[id]) cb.economy.was[id] = ca.economy.was[id]!;
      delete ca.economy.was[id];
    }
  }
  carryLineage(A.minds, B, ids.flatMap((id) => A.minds[id]!.episodes.filter((e) => e.source.kind === "told").map((e) => ({ agent: id, ep: e }))));
  const head = headOf(B, vb.households[hh.id]!);
  if (head) carryWords(A, B, head);
  // A craft the new town lacked arrives with whoever knows it.
  for (const id of ids)
    for (const kn of KB.known[id] ?? []) {
      if (had.has(kn.craft)) continue;
      had.add(kn.craft);
      const C = craft(kn.craft);
      const why: Why[] = [{ agent: id, town: a.id, text: `${personName(B, id)} knew ${C.name} in ${a.name}, and moved to ${b.name} with ${hh.name}.` }];
      KB.history.push({ tick: B.tick, craft: kn.craft, kind: "brought", agent: id, text: `${personName(B, id)} brings ${C.name} from ${a.name}.`, why });
      feed(B, sB, { kind: "event", agents: [id], title: `${personName(B, id)} brings ${C.name} to ${b.name}`, text: `${b.name} had nobody who knew it. Now ${C.does}.`, chronicle: { kind: "craft", why } });
    }
  // Gone from the old town: remembered there, as the dead are, but no longer part of its days.
  const st = va.structures.find((x) => x.household === hh.id && !x.done);
  if (st) {
    for (const key of ["timber", "stone", "reeds"] as const) va.stock[key] += st.have[key];
    va.structures = va.structures.filter((x) => x !== st);
  }
  delete va.households[hh.id];
  A.order = A.order.filter((x) => !ids.includes(x));
  for (const id of ids) {
    A.agents[id]!.place = "harbour";
    A.agents[id]!.activity = `gone to ${b.name}`;
    host.region.departed[id] = { from: a.id, to: b.id, tick: host.region.tick };
  }
  for (const id of A.order) A.agents[id]!.wants = A.agents[id]!.wants.filter((x) => !x.target || !ids.includes(x.target));
  if (va.civic?.leader && ids.includes(va.civic.leader)) va.civic.leader = undefined;
  // What they owed at home stays owed, and unpaid.
  for (const d of openDebts(A)) if (ids.includes(d.debtor) && !ids.includes(d.creditor)) d.overdue ??= A.tick;
  if (sickness) expose(B, sickness, { kind: "migrants", town: a.id, townName: a.name, carrier: ids[0] }, sB, 0.8);
  return ids;
}

/** Each spring and autumn: the household in each town with most reason to go weighs going. */
export async function migrationSeason(host: CivHost): Promise<void> {
  const r = host.region;
  const R = regionCiv(r);
  if (r.towns.length < 2) return;
  for (const a of [...r.towns]) {
    const A = host.world(a.id);
    const c = civOf(A);
    if (!c || A.order.length < 12) continue;
    const season = A.village!.season;
    if (season === "spring" && (await factionExit(host, a))) continue;
    if (season !== "spring" && season !== "autumn") continue;
    if (c.health.closed) continue;
    const leader = A.village!.civic?.leader;
    const cands = homesOf(A)
      .map((hh) => ({ hh, head: headOf(A, hh) }))
      .filter((x): x is { hh: Household; head: AgentId } => !!x.head && !x.hh.members.includes(leader ?? "") && A.order.length - x.hh.members.length >= 8)
      .map((x) => ({ ...x, push: pushOf(A, x.hh, x.head) }))
      .filter((x) => total(x.push) >= 0.22)
      .sort((x, y) => total(y.push) - total(x.push) || x.hh.id.localeCompare(y.hh.id));
    const pick = cands[0];
    if (!pick) continue;
    const dests = r.towns
      .filter((b) => b.id !== a.id && !hostile(r, a.id, b.id) && !landingClosed(host.world(b.id)) && host.world(b.id).order.length < (host.world(b.id).village!.popCap ?? 150) - 8 && civOf(host.world(b.id)))
      .map((b) => ({ b, pull: pullOf(host, a, b, pick.head) }))
      .sort((x, y) => total(y.pull) - total(x.pull) || x.b.id.localeCompare(y.b.id));
    const dest = dests[0];
    if (!dest) continue;
    const m = A.minds[pick.head]!;
    const hold = holdOf(A, pick.hh, pick.head);
    const evId = `ev_going_${A.tick}_${pick.hh.id}`;
    const pc = eventPercept(m, "world", "circumstance", -0.15, 0.55, ["leaving", "home", a.id, dest.b.id, evId], `We thought about leaving ${A.name} for ${dest.b.name}.`, `${m.name}'s household could take a boat to ${dest.b.name} and start again there. What pushes: ${list(pick.push.map((x) => x.name))}. Go, or stay?`, evId);
    pc.features.prospective = true;
    pc.options = [
      { id: "go", label: `Go to ${dest.b.name}`, verb: `leave for ${dest.b.name}`, description: `Load the boat and take the household to ${dest.b.name}.`, prosocial: 0, assertive: 0.5, avoidant: 0.3, disclosure: 0, coping: "problem", act: `takes the household to ${dest.b.name}`, pull: [...pick.push, ...dest.pull] },
      { id: "stay", label: "Stay", verb: `stay in ${A.name}`, description: `Stay in ${A.name} and see it through.`, prosocial: 0.1, assertive: 0, avoidant: 0, disclosure: 0, act: `stays in ${A.name}`, pull: hold },
    ];
    const { choice, trace } = await choose(A, pick.head, pc, host.faculties(a.id), host.sink(a.id), host.live(a.id));
    if (choice !== "go") continue;
    const why: Why[] = [
      { agent: pick.head, town: a.id, text: `${m.name}, who speaks for ${pick.hh.name}, chose to go. What pushed: ${list(pick.push.sort((x, y) => y.value - x.value).slice(0, 3).map((x) => `${x.name} (${x.value.toFixed(2)})`))}.`, episode: pick.push.find((x) => x.ref?.startsWith("ep"))?.ref },
      { town: dest.b.id, text: dest.pull.filter((x) => x.value > 0).length ? `What drew them to ${dest.b.name}: ${list(dest.pull.filter((x) => x.value > 0).map((x) => `${x.name} (${x.value.toFixed(2)})`))}.` : `${dest.b.name} was simply the nearest town that would have them.` },
      { text: `What might have held them: ${list(hold.map((x) => `${x.name} (${x.value.toFixed(2)})`))}. It was not enough.` },
    ];
    await depart(host, a, dest.b, [pick.hh], pick.head, why, trace);
  }
  if (R.moves.length > 200) R.moves.splice(0, R.moves.length - 200);
}

/** Households go from one town to another, and both towns take note. */
async function depart(host: CivHost, a: Town, b: Town, group: Household[], head: AgentId, why: Why[], trace?: string, faction?: string): Promise<void> {
  const A = host.world(a.id);
  const B = host.world(b.id);
  const R = regionCiv(host.region);
  const names = list([...new Set(group.map((h) => h.name))]);
  const fond = A.order.filter((x) => ageOf(A, x) >= 12 && group.every((h) => !h.members.includes(x)) && group.some((h) => h.members.some((mm) => (A.minds[x]!.others[mm]?.liking ?? 0.5) > 0.65)));
  const went: AgentId[] = [];
  for (const hh of group) {
    const ids = moveHousehold(host, a, b, hh);
    went.push(...ids);
    R.moves.push({ tick: host.region.tick, year: yearOf(B), from: a.id, to: b.id, household: hh.name, head: headOf(B, B.village!.households[hh.id]!) ?? ids[0]!, people: ids, faction, why });
  }
  if (!went.length) return;
  const sA = host.sink(a.id);
  const sB = host.sink(b.id);
  const evId = `ev_moved_${host.region.tick}_${group[0]!.id}`;
  // Those who went remember the leaving; those they were close to at home miss them.
  await witness(B, went.filter((x) => !isChild(B, x)), (m) => eventPercept(m, "world", "circumstance", 0.05, 0.6, ["leaving", "home", a.id, b.id, evId], `We left ${a.name} for ${b.name}.`, `${names} come ashore at ${b.name}, from ${a.name}.`, evId), host.faculties(b.id), sB);
  if (host.live(a.id)) await witness(A, fond.slice(0, 8), (m) => eventPercept(m, "world", "circumstance", -0.25, 0.45, ["leaving", a.id, b.id, evId], `${cap(names)} left ${a.name} for ${b.name}.`, `${cap(names)} load a boat and leave for ${b.name}.`, `${evId}_seen`, went.slice(0, 3)), host.faculties(a.id), sA);
  if (host.live(b.id)) {
    const regard = host.region.regard[`${b.id}>${a.id}`] ?? 0;
    await witness(B, B.order.filter((x) => !went.includes(x) && ageOf(B, x) >= 16).slice(0, 12), (m) => eventPercept(m, went[0]!, "other", regard < -0.2 ? -0.15 : 0.05, 0.4, ["newcomer", "stranger", "landing", a.id, evId], `${cap(names)} came from ${a.name} to live in ${b.name}.`, `${cap(names)}, ${plural(went.length, "person", "people")} from ${a.name}, land at ${b.name} meaning to stay.`, `${evId}_come`, went.slice(0, 3)), host.faculties(b.id), sB);
  }
  feed(A, sA, { kind: "event", place: "harbour", agents: went.slice(0, 8), title: `${cap(names)} leave ${a.name} for ${b.name}`, text: why.map((x) => x.text).join(" "), refs: trace ? [{ agent: head, trace }] : undefined });
  feed(B, sB, { kind: "event", place: "harbour", agents: went.slice(0, 8), title: `${cap(names)} come from ${a.name} to live in ${b.name}`, text: `${plural(went.length, "person", "people")}. ${why[0]!.text}` });
  note(A, { kind: "migration", title: `${cap(names)} leave for ${b.name}`, agents: went.slice(0, 6), why });
  note(B, { kind: "migration", title: `${cap(names)} arrive from ${a.name}`, agents: went.slice(0, 6), why });
  host.chronicle({ town: a.id, kind: "migration", text: `${names} left ${a.name} for ${b.name}, ${plural(went.length, "person", "people")} in all.`, agents: [head], why });
  host.touch();
}

/** A side that has stood ready to leave for half a year decides, through its head, and goes together. */
async function factionExit(host: CivHost, a: Town): Promise<boolean> {
  const r = host.region;
  const A = host.world(a.id);
  const c = civOf(A)!;
  const exit = c.factions.exit;
  const f = exit && liveFactions(A).find((x) => x.id === exit.faction);
  if (!exit || !f || A.tick - exit.since < A.village!.seasonDays * 2 * DAY) return false;
  const head = f.head;
  if (!A.order.includes(head)) return false;
  const leader = A.village!.civic?.leader;
  const group = f.households.map((id) => A.village!.households[id]).filter((h): h is Household => !!h && !h.members.includes(leader ?? ""));
  const size = group.reduce((s, h) => s + h.members.filter((x) => A.order.includes(x)).length, 0);
  if (size < 5 || A.order.length - size < 8) return false;
  const m = A.minds[head]!;
  const rivalry = leader ? rivalryBetween(A, head, leader) : 0.5;
  const hold = holdOf(A, hhOf(A, head)!, head);
  const evId = `ev_exit_${A.tick}_${f.id}`;
  const g = f.grievances.at(-1);
  const pc = eventPercept(m, leader ?? "world", leader ? "other" : "circumstance", -0.3, 0.65, ["leaving", "home", "fairness", a.id, evId], `${cap(f.name)} looked to me to say whether we would leave ${A.name}.`, `${cap(f.name)} have lost ${plural(f.lost, "election")} running and talk of leaving ${A.name}. They look to ${m.name}.`, evId, leader ? [leader] : []);
  pc.features.prospective = true;
  pc.options = [
    { id: "go", label: "Lead them out", verb: `lead ${f.name} out of ${A.name}`, description: `Take ${f.name} and go.`, prosocial: 0.1, assertive: 0.8, avoidant: 0.2, disclosure: 0, coping: "problem", act: `leads ${f.name} out of ${A.name}`, pull: [{ name: "how hard the line is", value: round(0.5 * rivalry, 3) }, { name: `${plural(f.lost, "election")} lost`, value: 0.08 * Math.min(3, f.lost) }, ...(g ? [{ name: `what was done to them: ${g.text}`, value: 0.12, ref: g.episode }] : []), { name: "they are waiting on a word", value: 0.1 }] },
    { id: "stay", label: "Stay and stand again", verb: `keep ${f.name} in ${A.name}`, description: "Stay, and stand again next spring.", prosocial: 0.2, assertive: 0.2, avoidant: 0, disclosure: 0, act: `keeps ${f.name} in ${A.name}`, pull: hold },
  ];
  const { choice, trace } = await choose(A, head, pc, host.faculties(a.id), host.sink(a.id), host.live(a.id));
  if (choice !== "go") {
    c.factions.exit = undefined;
    feed(A, host.sink(a.id), { kind: "event", agents: [head], title: `${m.name} keeps ${f.name} in ${A.name}`, text: `They had talked of leaving. ${m.name} would not lead them out: ${list(hold.map((x) => x.name))}.`, refs: trace ? [{ agent: head, trace }] : undefined });
    return false;
  }
  const ruling = leader ? (factionOf(A, leader)?.name ?? "the rest of the town") : "the rest of the town";
  const why: Why[] = [
    { agent: head, town: a.id, text: `${cap(f.name)} (${f.shares}) had lost ${plural(f.lost, "election")} running in ${A.name}, and the line between them and ${ruling} was hard (${rivalry.toFixed(2)} of 1).` },
    ...(g ? [{ agent: g.victim, episode: g.episode, text: `Most on their minds: ${g.text}.` }] : []),
    { agent: head, text: `${m.name}, whom they look to, chose to lead them out rather than stand again.` },
  ];
  const reason = g ? `${f.name} would not live under ${ruling} after this: ${g.text}` : `${f.name} had lost ${plural(f.lost, "election")} running and would not live under ${ruling}`;
  f.ended = A.tick;
  c.factions.exit = undefined;
  if (host.canFound()) {
    const town = await host.found(a, group, head, reason, why);
    if (town) {
      note(A, { kind: "migration", title: `${cap(f.name)} leave to found ${town.name}`, agents: [head], why });
      regionCiv(r).moves.push({ tick: r.tick, year: yearOf(A), from: a.id, to: town.id, household: f.name, head, people: group.flatMap((h) => h.members), faction: f.name, why });
      ease(A, 0.15);
      return true;
    }
  }
  const dest = r.towns
    .filter((b) => b.id !== a.id && !hostile(r, a.id, b.id) && !landingClosed(host.world(b.id)) && civOf(host.world(b.id)))
    .map((b) => ({ b, pull: total(pullOf(host, a, b, head)) }))
    .sort((x, y) => y.pull - x.pull || x.b.id.localeCompare(y.b.id))[0];
  if (!dest) {
    f.ended = undefined;
    return false;
  }
  why.push({ town: dest.b.id, text: `There was no room left on the coast for a new town, so they went to ${dest.b.name}.` });
  await depart(host, a, dest.b, group, head, why, trace, f.name);
  ease(A, 0.15);
  return true;
}

// ---------------------------------------------------------------- reading it

export function movesView(host: { region: CivHost["region"] }, town?: string): Move[] {
  return regionCiv(host.region)
    .moves.filter((m) => !town || m.from === town || m.to === town)
    .slice(-20);
}

export type { Move };
