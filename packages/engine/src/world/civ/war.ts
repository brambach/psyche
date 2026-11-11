// Raids, truces and treaties. Towns here do not go to war because a counter crossed a line. A raid
// is a chain of choices, each made by a mind that can be opened:
//
// - Something has to be held against the other town: a belief most of the town shares (that they
//   cheat, that they brought the sickness, that they raided first), or plain hunger next to a
//   neighbour with a full store. Parochial altruism and war go together: the same bonds that make
//   a town share make it fight outsiders (Choi & Bowles 2007).
// - The leader chooses whether to call a raid, through their own temperament, what they promised
//   when they were chosen, and what the last fight cost.
// - Every grown person then chooses whether to go. People follow a leader they like, fight a town
//   they believe ill of, and stay home for small children, fear, or because the leader is from the
//   other side. A leader nobody follows has no raid.
// - The fight goes by numbers, drill, walls and luck. People die in it, by name, and those who
//   loved them remember who led them there and who killed them.
//
// What it leaves behind is the point: the raided town comes to believe the worst of the raiders,
// the bereaved can be left with a core belief that people from over the water come to take what is
// theirs (and tell it to their children), an attacked town closes ranks, and each fight makes the
// next one easier to start and harder to want. Weariness is what makes peace: a leader who has
// buried people offers a truce, and the other accepts or doesn't. A truce that was only a
// handshake lapses when either leader goes; one that was written down holds (records.ts).

import { clamp, render } from "../../memory.js";
import type { ActionOption } from "../../ports.js";
import type { AgentId } from "../../types.js";
import { craftBonus } from "../knowledge.js";
import { ageOf, die, yearOf } from "../life.js";
import { moneyOf } from "../money.js";
import type { Town } from "../region.js";
import { eventPercept, feed, personName, type Why, type WorldState } from "../world.js";
import { believe, cap, choose, civOf, formSchema, grownOf, hhOf, list, mark, mean, note, plural, recent, round, townBeliefOf, trait, witness, yearTicks } from "./base.js";
import { activeOutbreak, expose } from "./disease.js";
import { ease, factionOf, rivalryBetween, wrong } from "./factions.js";
import { regionCiv, treatyBetween, type CivHost, type Raid, type Treaty } from "./host.js";
import { burnRecords, isWritten, writeDown, writerOf } from "./records.js";

type Term = { name: string; value: number; ref?: string };
const perHead = (w: WorldState) => w.village!.store.food / Math.max(1, w.order.length);
const leaderOf = (w: WorldState): AgentId | undefined => {
  const l = w.village!.civic?.leader;
  return l && w.order.includes(l) && ageOf(w, l) >= 16 ? l : undefined;
};
const raidsBetween = (host: CivHost, from: string, to: string, years: number, w: WorldState) => regionCiv(host.region).raids.filter((x) => x.from === from && x.to === to && host.region.tick - x.tick < years * yearTicks(w));
const fighters = (w: WorldState, max: number) => grownOf(w).filter((x) => ageOf(w, x) <= max && !civOf(w)!.health.sick[x] && w.minds[x]!.needs.energy > 0.25);

/** What a town has against another: the reason a leader could give for a raid, if there is one. */
function casusOf(host: CivHost, a: Town, b: Town): { kind: string; text: string; why: Why[]; weight: number } | undefined {
  const r = host.region;
  const A = host.world(a.id);
  const B = host.world(b.id);
  const c = civOf(A)!;
  const regard = r.regard[`${a.id}>${b.id}`] ?? 0;
  const adults = grownOf(A);
  // The belief behind the regard: who holds it hardest, and the memory it rests on.
  const holders = adults
    .map((id) => ({ id, b: A.minds[id]!.beliefs.filter((x) => x.about === `town:${b.id}` && x.valence < 0).sort((x, y) => y.confidence - x.confidence)[0] }))
    .filter((x) => x.b && x.b.confidence >= 0.3)
    .sort((x, y) => y.b!.confidence - x.b!.confidence);
  const top = holders[0];
  const ev = top && top.b!.evidence.map((e) => A.minds[top.id]!.episodes.find((x) => x.id === e)).find(Boolean);
  const belief: Why[] = top ? [{ agent: top.id, episode: ev?.id, town: a.id, text: `${holders.length} of ${adults.length} grown people in ${a.name} believed “${top.b!.proposition}”. ${personName(A, top.id)} held it hardest (${top.b!.confidence.toFixed(2)})${ev ? `, remembering: “${render(ev).replace(/[.\s]+$/, "")}”` : ""}.` }] : [];
  const theirs = raidsBetween(host, b.id, a.id, 4, A);
  if (theirs.length && regard <= -0.25) return { kind: "revenge", text: `${b.name} had raided ${a.name} ${theirs.length === 1 ? "" : `${theirs.length} times `}within four years`, weight: 0.3 + 0.1 * theirs.length, why: [{ town: b.id, agent: theirs.at(-1)!.leader, text: `${b.name} raided ${a.name} in year ${theirs.at(-1)!.year}${theirs.at(-1)!.dead.filter((d) => d.town === a.id).length ? `, and killed ${list(theirs.at(-1)!.dead.filter((d) => d.town === a.id).map((d) => d.name))}` : ""}.` }, ...belief] };
  if (regard <= -0.5) return { kind: "grievance", text: `${a.name} had turned hard against ${b.name}`, weight: 0.15 + (-regard - 0.5) * 0.5, why: [{ town: a.id, text: `${a.name}'s regard for ${b.name} stood at ${regard.toFixed(2)} (from -1 to 1).` }, ...belief] };
  const hungry = recent(A, c.marks.hunger, 1);
  if (hungry >= 2 && regard <= 0.05 && perHead(B) >= perHead(A) * 2 + 2) return { kind: "hunger", text: `${a.name} was hungry and ${b.name} was not`, weight: 0.12 + 0.06 * hungry, why: [{ town: a.id, text: `${a.name} had gone hungry in ${plural(hungry, "season")} of the last year, with ${perHead(A).toFixed(1)} days' food a head in its store; ${b.name} had ${perHead(B).toFixed(1)}.` }, ...belief] };
  if (c.polity.stance[b.id] === "war" && regard <= -0.25) return { kind: "promise", text: `${a.name}'s leader had promised that ${b.name} would answer for what it had done`, weight: 0.2, why: [{ town: a.id, text: `${a.name}'s regard for ${b.name} stood at ${regard.toFixed(2)}.` }, ...belief] };
  return undefined;
}

/** In summer and autumn: each town's leader weighs whether to raid the town it has most against. */
export async function warSeason(host: CivHost): Promise<void> {
  const r = host.region;
  const R = regionCiv(r);
  const first = host.world(r.towns[0]!.id);
  const season = first.village!.season;
  const year = yearOf(first);
  await treatiesSeason(host);
  if (season === "summer" || season === "autumn") {
    for (const a of [...r.towns]) {
      const A = host.world(a.id);
      const c = civOf(A);
      const leader = c && leaderOf(A);
      if (!c || !leader || grownOf(A).length < 10 || c.health.closed || R.weighed[`raid|${a.id}`] === year) continue;
      const target = r.towns
        .filter((b) => b.id !== a.id && civOf(host.world(b.id)) && !treatyBetween(r, a.id, b.id) && !civOf(host.world(b.id))!.health.closed && host.world(b.id).order.length >= 6)
        .map((b) => ({ b, casus: casusOf(host, a, b) }))
        .filter((x) => x.casus)
        .sort((x, y) => y.casus!.weight - x.casus!.weight || x.b.id.localeCompare(y.b.id))[0];
      if (!target) continue;
      R.weighed[`raid|${a.id}`] = year;
      const b = target.b;
      const casus = target.casus!;
      const B = host.world(b.id);
      const L = A.minds[leader]!;
      const weary = recent(A, c.marks.raids, 3) + recent(A, c.marks.raided, 3);
      const lostOwn = R.raids.filter((x) => r.tick - x.tick < 4 * yearTicks(A)).flatMap((x) => x.dead).filter((d) => d.town === a.id).length;
      const worst = L.beliefs.filter((x) => x.about === `town:${b.id}` && x.valence < 0).sort((x, y) => y.confidence - x.confidence)[0];
      const evId = `ev_council_${A.tick}_${b.id}`;
      const pc = eventPercept(L, "world", "circumstance", -0.2, 0.6, ["raid", "war", "leader", b.id, evId], `${A.name} looked to me to say whether we would go against ${b.name}.`, `${cap(casus.text)}. ${L.name} leads ${A.name}. Call the town to raid ${b.name}?`, evId);
      pc.features.prospective = true;
      const raidPull: Term[] = [{ name: `the cause: ${casus.text}`, value: round(casus.weight, 3) }, { name: `what ${L.pronouns.subject} believes of ${b.name}`, value: round(-0.3 * townBeliefOf(L, b.id), 3), ref: worst?.evidence.at(-1) }];
      if (c.polity.stance[b.id] === "war") raidPull.push({ name: "promised it when chosen to lead", value: 0.25 });
      if (craftBonus(A, "arms") > 0) raidPull.push({ name: "the town is drilled", value: 0.08 });
      if (perHead(A) < 2) raidPull.push({ name: "the store is nearly empty", value: 0.12 });
      for (const s of L.schemas.filter((x) => x.threatBias + x.blameBias > 0 && x.triggers.some((t) => ["raid", "stranger", "trade", b.id].includes(t)))) raidPull.push({ name: `the core belief “${s.text}”`, value: round(0.25 * s.strength, 3), ref: s.id });
      const holdPull: Term[] = [{ name: "people will die of it", value: 0.2 }, { name: "what the last fights cost", value: round(Math.min(0.3, 0.06 * weary + 0.05 * lostOwn), 3) }];
      if (c.polity.stance[b.id] === "peace") holdPull.push({ name: "promised peace when chosen to lead", value: 0.3 });
      if (grownOf(B).length > grownOf(A).length * 1.4) holdPull.push({ name: `${b.name} is the bigger town`, value: 0.15 });
      pc.options = [
        { id: "raid", label: `Call a raid on ${b.name}`, verb: `call a raid on ${b.name}`, description: `Take the boats to ${b.name}, by night, and take what is there.`, prosocial: -0.8, assertive: 0.9, avoidant: 0, disclosure: 0, coping: "problem", act: `calls ${A.name} to raid ${b.name}`, pull: raidPull },
        { id: "hold", label: "Hold back", verb: "hold the town back", description: "No raid. Bear it, or find another way.", prosocial: 0.4, assertive: 0, avoidant: 0.2, disclosure: 0, act: "holds the town back", pull: holdPull },
      ];
      const { choice, trace } = await choose(A, leader, pc, host.faculties(a.id), host.sink(a.id), host.live(a.id));
      if (choice !== "raid") {
        feed(A, host.sink(a.id), { kind: "event", place: "tavern", agents: [leader], title: `${L.name} holds ${A.name} back from ${b.name}`, text: `${cap(casus.text)}, and there was talk of going against them. ${L.name} would not call it (${trait(L, "agreeableness")}).`, refs: trace ? [{ agent: leader, trace }] : undefined });
        continue;
      }
      const why: Why[] = [...casus.why, { agent: leader, town: a.id, text: `${L.name}, who led ${a.name}, called the raid (${trait(L, "agreeableness")}, ${trait(L, "neuroticism")}). What weighed: ${list(raidPull.filter((x) => x.value > 0.02).sort((x, y) => y.value - x.value).slice(0, 3).map((x) => `${x.name} (${x.value.toFixed(2)})`))}.` }];
      await raid(host, a, b, leader, casus.text, why, trace);
    }
  }
  if (R.raids.length > 120) R.raids.splice(0, R.raids.length - 120);
}

export async function raid(host: CivHost, a: Town, b: Town, leader: AgentId, casus: string, why: Why[], trace?: string): Promise<void> {
  const r = host.region;
  const R = regionCiv(r);
  const A = host.world(a.id);
  const B = host.world(b.id);
  const ca = civOf(A)!;
  const cb = civOf(B)!;
  const sA = host.sink(a.id);
  const sB = host.sink(b.id);
  const fA = host.faculties(a.id);
  const fB = host.faculties(b.id);
  const L = A.minds[leader]!;
  const evId = `ev_raid_${r.tick}_${a.id}_${b.id}`;

  // The muster: each who could go chooses.
  const able = fighters(A, 55);
  const went: AgentId[] = [];
  const stayed: AgentId[] = [];
  const refusals: Record<string, number> = {};
  for (const id of able) {
    if (id === leader) {
      went.push(id);
      continue;
    }
    const m = A.minds[id]!;
    const hh = hhOf(A, id);
    const rival = rivalryBetween(A, id, leader);
    const go: Term[] = [{ name: `how ${m.pronouns.subject} takes to ${L.name}`, value: round(0.6 * ((m.others[leader]?.liking ?? 0.5) - 0.5), 3) }, { name: `what ${m.pronouns.subject} believes of ${b.name}`, value: round(-0.4 * townBeliefOf(m, b.id), 3) }, { name: "everyone is going", value: 0.12 }];
    if (hh && hh.food < hh.members.length * 2) go.push({ name: "an empty house", value: 0.15 });
    if (factionOf(A, id) && factionOf(A, id)?.id === factionOf(A, leader)?.id) go.push({ name: "one of ours is leading", value: 0.1 });
    if (craftBonus(A, "arms") > 0) go.push({ name: "drilled for it", value: 0.06 });
    const stay: Term[] = [{ name: "afraid of dying there", value: round(0.15 + 0.3 * (m.traits.neuroticism - 0.5), 3) }];
    if (hh?.members.some((x) => ageOf(A, x) < 6)) stay.push({ name: "small children at home", value: 0.12 });
    if (rival > 0.05) stay.push({ name: `${L.name} is from the other side`, value: round(0.35 * rival, 3) });
    if (townBeliefOf(m, b.id) >= 0) stay.push({ name: `no quarrel with ${b.name}`, value: 0.12 });
    const pc = eventPercept(m, leader, "other", -0.15, 0.65, ["raid", "war", "fear", b.id, evId], `${L.name} called us to raid ${b.name}.`, `${L.name} calls ${A.name} to take the boats against ${b.name}: ${casus}. Does ${m.name} go?`, evId, [leader]);
    pc.features.prospective = true;
    pc.addressedToSelf = true;
    const options: ActionOption[] = [
      { id: "go", label: "Go with the boats", verb: `go on the raid against ${b.name}`, description: `Take a place in the boats.`, prosocial: -0.5, assertive: 0.8, avoidant: 0, disclosure: 0, comply: true, act: `goes on the raid against ${b.name}`, pull: go },
      { id: "stay", label: "Stay behind", verb: "stay behind", description: "Let the others go.", prosocial: 0.2, assertive: 0, avoidant: 0.6, disclosure: 0, act: "stays behind", pull: stay },
    ];
    pc.options = options;
    const { choice } = await choose(A, id, pc, fA, sA, host.live(a.id));
    if (choice === "go") went.push(id);
    else {
      stayed.push(id);
      const top = [...stay].sort((x, y) => y.value - x.value)[0]!;
      refusals[top.name.replace(L.name, "the leader").replace(b.name, "them")] = (refusals[top.name.replace(L.name, "the leader").replace(b.name, "them")] ?? 0) + 1;
    }
  }
  const said = Object.entries(refusals).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([n, k]) => `${k} for “${n}”`);
  why.push({ town: a.id, text: `${went.length} of ${able.length} who could fight went${stayed.length ? `; ${stayed.length} stayed${said.length ? ` (${list(said)})` : ""}` : ""}.` });
  if (went.length < Math.max(4, able.length * 0.2)) {
    feed(A, sA, { kind: "event", place: "harbour", agents: [leader], title: `${L.name} calls a raid on ${b.name} and it comes to nothing`, text: `Only ${went.length} would go. ${why.at(-1)!.text}`, refs: trace ? [{ agent: leader, trace }] : undefined });
    note(A, { kind: "war", title: `${L.name} calls a raid on ${b.name} and it comes to nothing`, agents: [leader], why });
    return;
  }

  // The fight: numbers, drill and walls, and luck.
  const defenders = fighters(B, 60);
  const att = went.length * (1 + 0.75 * craftBonus(A, "arms")) * (0.8 + 0.4 * mean(went.map((x) => A.minds[x]!.needs.energy)));
  const def = Math.max(1, defenders.length) * 0.6 * (1 + 0.75 * craftBonus(B, "arms")) * (1 + 0.6 * craftBonus(B, "walls"));
  const odds = att / (att + def);
  const won = host.rand() < odds;
  why.push({ text: `${went.length} raiders${craftBonus(A, "arms") > 0 ? ", drilled," : ""} against ${defenders.length} in ${b.name} caught unready${craftBonus(B, "walls") > 0 ? " behind mortared walls" : ""}${craftBonus(B, "arms") > 0 ? ", drilled themselves" : ""}: the raiders' chance was ${Math.round(odds * 100)}%.` });
  const fall = (ids: AgentId[], p: number, key: string) => ids.filter((x) => x !== leader || host.rand() < 0.5).filter(() => host.rand() < p).slice(0, 4).map((id) => ({ id, key }));
  const deadA = fall(went, won ? 0.04 : 0.1, a.id);
  const deadB = fall(defenders, won ? 0.06 : 0.025, b.id);
  const dead = [...deadA.map((d) => ({ id: d.id, name: personName(A, d.id), town: a.id })), ...deadB.map((d) => ({ id: d.id, name: personName(B, d.id), town: b.id }))];

  // What was taken.
  let loot = 0;
  let burned = 0;
  if (won) {
    const fromStore = Math.min(B.village!.store.food * 0.45, went.length * 10);
    B.village!.store.food = round(B.village!.store.food - fromStore, 1);
    loot += fromStore;
    for (const hh of Object.values(B.village!.households)) {
      const take = hh.food * 0.15;
      hh.food = round(hh.food - take);
      loot += take;
    }
    A.village!.store.food = round(A.village!.store.food + loot, 1);
    const MA = moneyOf(A);
    const MB = moneyOf(B);
    for (const id of B.order) {
      const take = Math.floor((MB.held[id] ?? 0) * 0.3);
      if (!take) continue;
      MB.held[id] = (MB.held[id] ?? 0) - take;
      const to = went[Math.floor(host.rand() * went.length)]!;
      MA.held[to] = (MA.held[to] ?? 0) + take;
    }
    if (cb.records.items.some((i) => !i.burned) && host.rand() < 0.35) burned = burnRecords(B, 0.5).length;
  }
  const title = won ? `${a.name} raids ${b.name}` : `${a.name}'s raid on ${b.name} is beaten back`;
  const text = `${went.length} from ${a.name}, led by ${L.name}, came on ${b.name} by night. ${won ? `They took ${Math.round(loot)} days' food${burned ? ` and burned ${plural(burned, "record")}` : ""}.` : `${b.name} held, and they went home with nothing.`}${dead.length ? ` Killed: ${list(dead.map((d) => `${d.name} of ${d.town === a.id ? a.name : b.name}`))}.` : " Nobody was killed."}`;
  if (dead.length) why.push({ text: `Killed: ${list(dead.map((d) => `${d.name} of ${d.town === a.id ? a.name : b.name}`))}.` });
  if (burned) why.push({ town: b.id, text: `The raiders burned ${plural(burned, "record")} in ${b.name}: what was written there is back to living in people's heads.` });
  const record: Raid = { tick: r.tick, year: yearOf(A), from: a.id, to: b.id, leader, casus, went, stayed, defenders: defenders.length, odds: round(odds), won, loot: Math.round(loot), dead, burned, trace, why };
  R.raids.push(record);
  mark(A, "raids");
  mark(B, "raided");

  // The raided town: everyone lives through it, and comes to believe the worst of the raiders.
  const seenB = host.live(b.id) ? grownOf(B) : grownOf(B).filter((x) => x === leaderOf(B) || B.minds[x]!.traits.neuroticism > 0.55 || deadB.some((d) => hhOf(B, d.id)?.members.includes(x)));
  const memB = await witness(
    B,
    seenB,
    (m) => {
      const p = eventPercept(m, "world", "other", won ? -0.7 : -0.4, 0.9, ["raid", "war", "fear", "death", a.id, evId], won ? `Raiders from ${a.name} came in the night and took our food.` : `Raiders from ${a.name} came in the night and we drove them off.`, text, evId);
      p.features.intentional = 1;
      p.features.normViolation = 0.9;
      return p;
    },
    fB,
    sB,
  );
  for (const id of grownOf(B)) {
    const m = B.minds[id]!;
    believe(m, `town:${a.id}`, ["raid", "war", "fear", a.id], `Folk from ${a.name} come to rob and kill`, -0.8, 0.6 + 0.3 * m.traits.neuroticism, memB[id] ? [memB[id]!] : [], B.tick);
    if (memB[id] && (m.traits.neuroticism > 0.55 || deadB.some((d) => hhOf(B, d.id)?.members.includes(id)))) formSchema(m, { text: "People from over the water come to take what is ours", triggers: ["stranger", "newcomer", "raid", "boat", "trade"], blameBias: 0.2, threatBias: 0.35, strength: round(0.25 + 0.2 * m.traits.neuroticism) }, memB[id]);
  }
  // The raiders: they remember it too, and a lost fight is held against the town that won it.
  const memA = host.live(a.id) ? await witness(A, went, (m) => eventPercept(m, leader, "other", won ? 0.25 : -0.5, 0.85, ["raid", "war", "death", b.id, evId], won ? `We raided ${b.name} and came home with their food.` : `We went against ${b.name} and were beaten back.`, text, `${evId}_went`, [leader]), fA, sA) : {};
  for (const id of grownOf(A)) {
    const m = A.minds[id]!;
    if (!won || deadA.length) believe(m, `town:${b.id}`, ["raid", "war", b.id], `Folk from ${b.name} have our dead to answer for`, -0.4, 0.4 + 0.2 * m.traits.neuroticism, memA[id] ? [memA[id]!] : [], A.tick);
    const o = m.others[leader];
    if (o && id !== leader) o.liking = round(clamp(o.liking + (won ? 0.03 : -0.05)), 3);
  }
  for (const d of deadA) {
    const kin = A.order.filter((x) => x !== d.id && (hhOf(A, d.id)?.members.includes(x) || A.village!.life[d.id]?.parents.includes(x)));
    await die(A, d.id, `the raid on ${b.name}`, fA, sA);
    for (const x of kin) if (A.order.includes(x) && x !== leader) wrong(A, x, leader, 0.1, `${L.name} led ${personName(A, d.id)} to ${A.minds[d.id]?.pronouns.possessive ?? "their"} death at ${b.name}`);
  }
  for (const d of deadB) await die(B, d.id, `the raid from ${a.name}`, fB, sB);
  // A town that was attacked closes ranks; one that won together pulls together a little.
  ease(B, 0.15);
  if (won) ease(A, 0.05);
  const lb = leaderOf(B);
  if (lb && !won) for (const id of grownOf(B)) if (B.minds[id]!.others[lb]) B.minds[id]!.others[lb]!.liking = round(clamp(B.minds[id]!.others[lb]!.liking + 0.03), 3);
  // Sickness goes where the boats go.
  const obA = activeOutbreak(A);
  const obB = activeOutbreak(B);
  if (obA) expose(B, obA.disease, { kind: "raid", town: a.id, townName: a.name }, sB, 0.4);
  if (obB) expose(A, obB.disease, { kind: "raid", town: b.id, townName: b.name, carrier: went[0] }, sA, 0.4);

  feed(A, sA, { kind: "event", place: "harbour", agents: [leader, ...went.slice(0, 7)], title, text: `${text} ${why.map((x) => x.text).join(" ")}`, refs: trace ? [{ agent: leader, trace }] : undefined });
  feed(B, sB, { kind: "event", place: "harbour", agents: seenB.slice(0, 8), title: won ? `Raiders from ${a.name} take the store at ${b.name}` : `${b.name} drives off raiders from ${a.name}`, text });
  note(A, { kind: "war", title, text, agents: [leader, ...deadA.map((d) => d.id)], why });
  note(B, { kind: "war", title: won ? `${a.name} raids ${b.name}` : `${b.name} beats back a raid from ${a.name}`, text, agents: deadB.map((d) => d.id), why });
  host.chronicle({ town: a.id, kind: "war", text: `${title}. ${text}`, agents: [leader, ...dead.map((d) => d.id)].slice(0, 4), why });
  host.touch();
}

// ---------------------------------------------------------------- truces and treaties

/** Each season: tribute falls due, handshakes lapse, and leaders who have had enough offer terms. */
async function treatiesSeason(host: CivHost): Promise<void> {
  const r = host.region;
  const R = regionCiv(r);
  const first = host.world(r.towns[0]!.id);
  const season = first.village!.season;
  const year = yearOf(first);
  const nameOf = (id: string) => r.towns.find((t) => t.id === id)?.name ?? id;
  for (const t of R.treaties) {
    if (t.ended) continue;
    const A = host.world(t.a);
    const B = host.world(t.b);
    if (!A || !B) continue;
    if (t.until !== undefined && r.tick >= t.until) {
      t.ended = { tick: r.tick, why: "it had run its years" };
      continue;
    }
    // A handshake is between two people. When one of them no longer leads, it may go with them.
    if (!t.written && !isWritten(A, "treaty", t.id) && !isWritten(B, "treaty", t.id)) {
      const gone = leaderOf(A) !== t.by[0] ? { town: t.a, was: t.by[0], w: A } : leaderOf(B) !== t.by[1] ? { town: t.b, was: t.by[1], w: B } : undefined;
      if (gone && host.rand() < 0.5) {
        const now = leaderOf(gone.w);
        const text = `It was a handshake between ${personName(A, t.by[0])} and ${personName(B, t.by[1])}, never written down, and ${personName(gone.w, gone.was)} no longer leads ${nameOf(gone.town)}`;
        t.ended = { tick: r.tick, why: text };
        const why: Why[] = [...t.why.slice(0, 1), { agent: gone.was, town: gone.town, text: `${text}.` }, ...(now ? [{ agent: now, town: gone.town, text: `${personName(gone.w, now)}, who leads now, was not party to it.` }] : [])];
        host.chronicle({ town: gone.town, kind: "truce", text: `The truce between ${nameOf(t.a)} and ${nameOf(t.b)} lapses.`, agents: [gone.was], why });
        for (const [w, id] of [[A, t.a], [B, t.b]] as const) feed(w, host.sink(id), { kind: "event", agents: [], title: `The truce between ${nameOf(t.a)} and ${nameOf(t.b)} lapses`, text: `${text}.` });
        continue;
      }
    } else t.written = true;
    if (t.tribute && season === "autumn") {
      const from = host.world(t.tribute.from);
      const to = host.world(t.tribute.to);
      const pay = round(Math.min(t.tribute.amount, from.village!.store.food * 0.4), 1);
      from.village!.store.food = round(from.village!.store.food - pay, 1);
      to.village!.store.food = round(to.village!.store.food + pay, 1);
      t.tribute.paid = round(t.tribute.paid + pay, 1);
      feed(from, host.sink(t.tribute.from), { kind: "event", place: "harbour", agents: [], title: `${from.name} sends its tribute to ${to.name}`, text: `${pay} days' food, under the terms of the truce.` });
    }
  }
  // Peace is offered by whoever has had enough.
  if (season !== "winter" && season !== "spring") return;
  for (let i = 0; i < r.towns.length; i++)
    for (let j = i + 1; j < r.towns.length; j++) {
      const x = r.towns[i]!;
      const y = r.towns[j]!;
      const X = host.world(x.id);
      const Y = host.world(y.id);
      if (!civOf(X) || !civOf(Y) || treatyBetween(r, x.id, y.id) || R.weighed[`peace|${x.id}|${y.id}`] === year) continue;
      const fights = R.raids.filter((q) => ((q.from === x.id && q.to === y.id) || (q.from === y.id && q.to === x.id)) && r.tick - q.tick < 6 * yearTicks(X));
      if (!fights.length) continue;
      R.weighed[`peace|${x.id}|${y.id}`] = year;
      const cost = (t: Town) => fights.flatMap((q) => q.dead).filter((d) => d.town === t.id).length + fights.filter((q) => (q.from === t.id && !q.won) || (q.to === t.id && q.won)).length;
      // The side that has lost more asks.
      const [asker, other] = cost(x) >= cost(y) ? [x, y] : [y, x];
      await sue(host, asker, other, fights, cost(asker), cost(other));
    }
}

export async function sue(host: CivHost, a: Town, b: Town, fights: Raid[], costA: number, costB: number): Promise<void> {
  const r = host.region;
  const R = regionCiv(r);
  const A = host.world(a.id);
  const B = host.world(b.id);
  const la = leaderOf(A);
  const lb = leaderOf(B);
  if (!la || !lb) return;
  const ca = civOf(A)!;
  const cb = civOf(B)!;
  const LA = A.minds[la]!;
  const LB = B.minds[lb]!;
  const last = fights.at(-1)!;
  const owed = last.to === a.id && last.won;
  const evId = `ev_terms_${r.tick}_${a.id}_${b.id}`;
  const offer: Term[] = [{ name: "what the fighting has cost", value: round(Math.min(0.35, 0.08 * costA), 3) }, { name: "would rather mend than avenge", value: round(0.35 * (LA.traits.agreeableness - 0.5), 3) }];
  if (ca.polity.stance[b.id] === "peace") offer.push({ name: "promised peace when chosen to lead", value: 0.3 });
  if (recent(A, ca.marks.hunger, 1)) offer.push({ name: "the town is hungry and cannot fight", value: 0.1 });
  const not: Term[] = [{ name: `what ${LA.pronouns.subject} believes of ${b.name}`, value: round(-0.3 * townBeliefOf(LA, b.id), 3) }];
  if (owed) not.push({ name: "they struck last, and it is not yet answered", value: 0.15 });
  if (ca.polity.stance[b.id] === "war") not.push({ name: "promised they would answer for it", value: 0.3 });
  const pa = eventPercept(LA, "world", "circumstance", -0.1, 0.55, ["peace", "war", "leader", b.id, evId], `I weighed offering ${b.name} a truce.`, `${A.name} and ${b.name} have fought ${plural(fights.length, "time")} in six years. ${LA.name} leads ${A.name}. Send to ${b.name} for a truce?`, evId);
  pa.features.prospective = true;
  pa.options = [
    { id: "offer", label: `Offer ${b.name} a truce`, verb: `offer ${b.name} a truce`, description: "Send a boat with an open hand.", prosocial: 0.7, assertive: 0.3, avoidant: 0, disclosure: 0.3, coping: "social", act: `sends to ${b.name} for a truce`, pull: offer },
    { id: "not", label: "Not yet", verb: "send no one", description: "Not while this is unanswered.", prosocial: -0.3, assertive: 0.3, avoidant: 0.2, disclosure: 0, act: "sends no one", pull: not },
  ];
  const first = await choose(A, la, pa, host.faculties(a.id), host.sink(a.id), host.live(a.id));
  if (first.choice !== "offer") return;
  // The side that came off worse may have to pay for it.
  const tribute = costA >= costB + 2 ? round(Math.min(20, Math.max(6, A.village!.store.food * 0.08)), 0) : 0;
  const accept: Term[] = [{ name: "what the fighting has cost", value: round(Math.min(0.3, 0.08 * costB), 3) }, { name: "would rather mend than avenge", value: round(0.35 * (LB.traits.agreeableness - 0.5), 3) }, { name: "they came asking", value: 0.12 }];
  if (tribute) accept.push({ name: `${tribute} days' food each autumn`, value: 0.15 });
  if (cb.polity.stance[a.id] === "peace") accept.push({ name: "promised peace when chosen to lead", value: 0.3 });
  const refuse: Term[] = [{ name: `what ${LB.pronouns.subject} believes of ${a.name}`, value: round(-0.3 * townBeliefOf(LB, a.id), 3) }];
  if (cb.polity.stance[a.id] === "war") refuse.push({ name: "promised they would answer for it", value: 0.3 });
  if (last.to === b.id && last.won) refuse.push({ name: "they struck last, and it is not yet answered", value: 0.15 });
  const pb = eventPercept(LB, la, "other", 0.1, 0.55, ["peace", "war", "leader", a.id, evId], `${LA.name} of ${a.name} sent asking for a truce.`, `A boat from ${a.name}: ${LA.name} asks ${b.name} for a truce${tribute ? `, and offers ${tribute} days' food each autumn for three years` : ""}. ${LB.name} leads ${b.name}.`, evId);
  pb.features.prospective = true;
  pb.addressedToSelf = true;
  pb.options = [
    { id: "accept", label: "Take the truce", verb: `make a truce with ${a.name}`, description: "Shake on it.", prosocial: 0.7, assertive: 0, avoidant: 0, disclosure: 0.2, comply: true, act: `makes a truce with ${a.name}`, pull: accept },
    { id: "refuse", label: "Send them home", verb: `refuse ${a.name}'s truce`, description: "Not after what they did.", prosocial: -0.5, assertive: 0.6, avoidant: 0, disclosure: 0, act: `refuses ${a.name}'s truce`, pull: refuse },
  ];
  const second = await choose(B, lb, pb, host.faculties(b.id), host.sink(b.id), host.live(b.id));
  const top = (xs: Term[]) => list(xs.filter((x) => x.value > 0.02).sort((p, q) => q.value - p.value).slice(0, 2).map((x) => `${x.name} (${x.value.toFixed(2)})`));
  const why: Why[] = [
    { text: `${a.name} and ${b.name} had fought ${plural(fights.length, "time")} in six years. It had cost ${a.name} ${costA} in dead and lost fights, and ${b.name} ${costB}.` },
    { agent: la, town: a.id, text: `${LA.name} of ${a.name} sent to ask for a truce (${trait(LA, "agreeableness")}): ${top(offer) || "it was time"}.` },
  ];
  if (second.choice !== "accept") {
    why.push({ agent: lb, town: b.id, text: `${LB.name} of ${b.name} sent the boat home (${trait(LB, "agreeableness")}): ${top(refuse) || "not yet"}.` });
    feed(A, host.sink(a.id), { kind: "event", place: "harbour", agents: [la], title: `${b.name} refuses ${a.name}'s truce`, text: why.map((x) => x.text).join(" ") });
    feed(B, host.sink(b.id), { kind: "event", place: "harbour", agents: [lb], title: `${LB.name} sends ${a.name}'s boat home`, text: why.map((x) => x.text).join(" ") });
    host.chronicle({ town: b.id, kind: "truce", text: `${a.name} asked ${b.name} for a truce and was refused.`, agents: [la, lb], why });
    return;
  }
  why.push({ agent: lb, town: b.id, text: `${LB.name} of ${b.name} took it (${trait(LB, "agreeableness")}): ${top(accept)}.` });
  const terms = `No boats against each other${tribute ? `; ${a.name} sends ${b.name} ${tribute} days' food each autumn for three years` : ""}.`;
  const t: Treaty = { id: `treaty_${++R.n}`, tick: r.tick, year: yearOf(A), a: a.id, b: b.id, kind: tribute ? "tribute" : "truce", terms, by: [la, lb], written: false, tribute: tribute ? { from: a.id, to: b.id, amount: tribute, paid: 0 } : undefined, why };
  const wroteA = writerOf(A) && writeDown(A, { kind: "treaty", title: `the truce with ${b.name}`, text: terms, ref: t.id, from: la }, host.sink(a.id));
  const wroteB = writerOf(B) && writeDown(B, { kind: "treaty", title: `the truce with ${a.name}`, text: terms, ref: t.id, from: lb }, host.sink(b.id));
  t.written = !!(wroteA || wroteB);
  t.until = t.written ? r.tick + 10 * yearTicks(A) : tribute ? r.tick + 3 * yearTicks(A) : undefined;
  why.push({ text: t.written ? `It was written down${wroteA && wroteB ? " in both towns" : ` in ${wroteA ? a.name : b.name}`}, so it holds for ten years whoever leads.` : `Neither town could write, so it was a handshake between ${LA.name} and ${LB.name}, and lasts as long as they both lead.` });
  R.treaties.push(t);
  if (R.treaties.length > 60) R.treaties.splice(0, R.treaties.length - 60);
  for (const [w, id, o, who] of [[A, a.id, b, la], [B, b.id, a, lb]] as const) {
    const mem = await witness(w, host.live(id) ? grownOf(w).slice(0, 14) : [who], (m) => eventPercept(m, "world", "other", 0.3, 0.5, ["peace", "truce", o.id, evId], `${w.name} and ${o.name} made a truce.`, `${LA.name} and ${LB.name} shake on it: ${terms}`, `${evId}_made`), host.faculties(id), host.sink(id));
    for (const x of grownOf(w)) believe(w.minds[x]!, `town:${o.id}`, ["peace", "truce", o.id], `${o.name} has made peace with us`, 0.35, 0.45 + 0.2 * w.minds[x]!.traits.agreeableness, mem[x] ? [mem[x]!] : [], w.tick);
    feed(w, host.sink(id), { kind: "event", place: "harbour", agents: [who], title: `${w.name} and ${o.name} make a truce`, text: `${terms} ${why.map((q) => q.text).join(" ")}` });
    note(w, { kind: "truce", title: `A truce with ${o.name}`, text: terms, agents: [who], why });
    civOf(w)!.polity.stance[o.id] = "peace";
  }
  host.chronicle({ town: a.id, kind: "truce", text: `${a.name} and ${b.name} make a truce. ${terms}`, agents: [la, lb], why });
  host.touch();
}
