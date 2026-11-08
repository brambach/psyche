// The offline reader: a person's mind from word patterns, with no model and no cost.
//
// It is closer-reading than it sounds. Personality shows in how people write (Pennebaker & King 1999;
// Yarkoni 2010; Schwartz et al. 2013): anxious people use more anxiety and sadness words and more "I";
// extraverts talk about people and use "we"; conscientious people plan and swear less; agreeable
// people thank and rarely snap; open people think out loud and reach for the new. Those correlations
// are small, so the mock counts word families against everyday base rates, leans on anything the
// writer says about themselves outright ("I'm such an introvert"), and shrinks toward the middle when
// there is little text. Formative memories are past-tense passages with feeling in them; core beliefs
// are the generalizations people state ("you can't count on anyone") or the lesson a memory taught.
// Every inference keeps the passages it came from, so the person can check it against what they wrote.

import { TRAIT_NAMES, type TraitName } from "../types.js";
import { clip, inWorldWords, sentences, words, worldTopics } from "./text.js";
import type { PersonaTrade, RawReading, ValueName, WritingInput } from "./types.js";

type Cat =
  | "posemo"
  | "negemo"
  | "anx"
  | "anger"
  | "sad"
  | "social"
  | "we"
  | "i"
  | "tentative"
  | "certain"
  | "achieve"
  | "plan"
  | "insight"
  | "novelty"
  | "swear"
  | "family"
  | "polite"
  | "money"
  | "informal";

/** Word families, written as exact words or prefixes ending in *. */
const LEX: Record<Cat, string> = {
  posemo: "love* lovely happy happi* glad great good nice fun laugh* proud excit* amazing awesome best beautiful grateful thank* enjoy* hope* lucky wonderful sweet yay calm relie* win won glow* cozy peace* joy* delight*",
  negemo: "hate* sad bad awful terrible worst angry mad upset hurt* cry* cried lonely alone afraid scared fear* worry* worri* anxious nervous stress* panic* ashamed embarrass* fail* guilt* miss missed lost broke broken tired exhausted annoy* frustrat* ugh disappoint* bitter jealous dread* miserable",
  anx: "afraid scared fear* worry* worri* anxious anxiety nervous stress* panic* overwhelm* uneasy dread* tense spiral* overthink*",
  anger: "hate* angry mad furious annoy* pissed rage resent* frustrat* bitter unfair livid",
  sad: "sad cry* cried lonely alone miss missed grief griev* lost hurt* depress* empty tears heartbr*",
  social: "friend* talk* told tell* people everyone everybody together party parties call* text* hang* team crew guys folks chat* meet* met visit* group",
  we: "we we're we've we'll us our ours ourselves",
  i: "i i'm i've i'd i'll me my mine myself im ive",
  tentative: "maybe perhaps guess probably might kinda sorta unsure idk possibly somehow wonder* suppose hopefully",
  certain: "always never definitely certainly absolutely totally everything nothing every completely obviously literally clearly",
  achieve: "work* goal* win won success* achiev* finish* build* built ship* launch* earn* better improv* effort grind* hustl* accomplish* progress",
  plan: "plan* schedul* list* organiz* organis* deadline* todo prepar* routine* careful* track* budget* saving* calendar early on-time spreadsheet*",
  insight: "think* thought realiz* realis* understand* know knew learn* idea* wonder* curious why because reason* meaning figur* notic* question* philosoph*",
  novelty: "new explor* travel* art music book* read* weird strange experiment* try* tried creat* design* imagin* discover* idea* curious invent* novel* tinker*",
  swear: "fuck* shit* damn* hell crap ass bitch* bullshit",
  family: "mom mum mother dad father sister brother grandma grandpa grandmother grandfather family kid* son daughter aunt uncle parents wife husband",
  polite: "thanks thank* please sorry appreciate* grateful",
  money: "money cash rent pay* paid broke bills debt afford* price cost* savings salary rich",
  informal: "lol lmao haha* omg tbh ngl idk lowkey gonna wanna kinda yeah ya u ur bc rn imo",
};

/** Everyday rates per 100 words (rounded from LIWC norms for informal writing). */
const BASE: Record<Cat, number> = { posemo: 3.5, negemo: 2, anx: 0.35, anger: 0.5, sad: 0.45, social: 6, we: 0.8, i: 6, tentative: 2.2, certain: 1.5, achieve: 1.6, plan: 0.5, insight: 2.3, novelty: 1, swear: 0.25, family: 0.45, polite: 0.4, money: 0.4, informal: 1 };

/** How each word family leans each trait. Small weights: the correlations in the literature are small. */
const WEIGHTS: Record<TraitName, Partial<Record<Cat | "questions" | "exclaim" | "longwords", number>>> = {
  openness: { insight: 0.35, novelty: 0.5, questions: 0.15, longwords: 0.2, family: -0.1 },
  conscientiousness: { plan: 0.5, achieve: 0.3, swear: -0.3, negemo: -0.1, tentative: -0.1 },
  extraversion: { social: 0.4, posemo: 0.25, we: 0.25, exclaim: 0.2, tentative: -0.15, informal: 0.1 },
  agreeableness: { posemo: 0.25, polite: 0.35, family: 0.15, we: 0.15, anger: -0.45, swear: -0.25 },
  neuroticism: { anx: 0.45, sad: 0.3, negemo: 0.25, i: 0.15, tentative: 0.1, posemo: -0.15 },
  honesty: { polite: 0.1, money: -0.3, certain: -0.05 },
};

/** Things people say about themselves outright, and what each says about a trait. */
const SELF_SAYS: [RegExp, TraitName, number][] = [
  [/\bi'?m (?:\w+ ){0,2}(?:an? )?(?:introvert(?:ed)?|shy|quiet|antisocial|homebody|hermit)\b|\bdrained by people\b|\bneed (?:my )?alone time\b/i, "extraversion", -0.25],
  [/\bi'?m (?:\w+ ){0,2}(?:an? )?(?:extrovert(?:ed)?|people person|social butterfly|outgoing|loud)\b|\blove (?:being around|meeting) (?:new )?people\b/i, "extraversion", 0.25],
  [/\bi'?m (?:\w+ ){0,2}(?:anxious|nervous|a worrier|an overthinker|neurotic|a mess)\b|\b(?:my )?anxiety\b|\bi overthink\b|\bpanic attacks?\b/i, "neuroticism", 0.25],
  [/\bi'?m (?:\w+ ){0,2}(?:chill|calm|laid[- ]back|easygoing|unbothered)\b|\bnothing (?:really )?bothers me\b/i, "neuroticism", -0.25],
  [/\bi'?m (?:\w+ ){0,2}(?:organi[sz]ed|disciplined|a planner|type a|punctual|tidy)\b|\bto-?do lists?\b/i, "conscientiousness", 0.25],
  [/\bi'?m (?:\w+ ){0,2}(?:lazy|messy|disorgani[sz]ed|a procrastinator|always late|scatterbrained)\b|\bi procrastinat/i, "conscientiousness", -0.25],
  [/\bi'?m (?:\w+ ){0,2}(?:curious|creative|a nerd|weird|into everything)\b|\bfalling down rabbit holes?\b|\brabbit hole\b/i, "openness", 0.25],
  [/\bi'?m (?:\w+ ){0,2}(?:stubborn|blunt|impatient|competitive|harsh|cold|petty)\b|\bi don'?t suffer fools\b/i, "agreeableness", -0.2],
  [/\bi'?m (?:\w+ ){0,2}(?:kind(?! of)|generous|soft|a pushover|too nice|a people[- ]pleaser)\b|\bcan'?t say no\b/i, "agreeableness", 0.2],
  [/\bi was wrong\b|\bmy fault\b|\bmy bad\b|\bi messed up\b|\bi got lucky\b|\bdidn'?t deserve\b/i, "honesty", 0.12],
  [/\bi'?m (?:\w+ ){0,2}fair\b|\b(?:always )?tell (?:you |people )?the truth\b|\bpay (?:people |you )?what i owe\b|\bcan'?t stand (?:people who|it when people) (?:lie|cheat|take more)/i, "honesty", 0.15],
  [/\bi worry (?:about \w+ )?(?:constantly|all the time|a lot|so much)\b|\bscared all the time\b|\bwant to throw up\b|\bcan'?t sleep\b|\bkeeps? me up at night\b/i, "neuroticism", 0.15],
  [/\bbetter than (?:everyone|them|him|her)\b|\bi deserve more\b|\bsmartest\b|\bflex(?:ing)?\b|\bimpress (?:them|people|everyone)\b|\bget rich\b/i, "honesty", -0.2],
];

const VALUE_WORDS: Record<ValueName, RegExp> = {
  "self-direction": /\b(freedom|free to|independen\w*|my own|own boss|on my own terms|creat\w*|build (?:my|something)|decide for myself|get to decide|it'?s mine|nobody can take|autonomy)\b/gi,
  achievement: /\b(success\w*|win|winning|best at|goals?|achiev\w*|ambitio\w*|prove|impress\w*|excel\w*|level up|ship(?:ped)? it)\b/gi,
  benevolence: /\b(help\w*|friends?|care (?:about|for)|loyal\w*|there for|look(?:ing)? after|family|show(?:ed)? up for)\b/gi,
  universalism: /\b(fair|unfair|justice|everyone deserves|equal\w*|nature|the planet|the world|community)\b/gi,
  security: /\b(safe|safety|stable|stability|secure|security|savings?|save up|rent|afford\w*|emergency fund|plan ahead|worr\w*)\b/gi,
  stimulation: /\b(adventure\w*|exciting|thrill\w*|travel\w*|explor\w*|risk\w*|bored|boring|something new|spontaneous)\b/gi,
  hedonism: /\b(fun|enjoy\w*|party|parties|relax\w*|treat myself|delicious|good food|pleasure)\b/gi,
  tradition: /\b(tradition\w*|faith|church|god|pray\w*|roots|heritage|the old ways|grandparents)\b/gi,
  conformity: /\b(should|supposed to|rules|polite|proper|fit in|what people think|embarrass\w*)\b/gi,
  power: /\b(control|power|status|in charge|leader\w*|respect|money|rich|influence)\b/gi,
};

const TRADE_WORDS: [PersonaTrade, RegExp, string][] = [
  ["builder", /\b(build\w*|built|make|made|making|fix\w*|repair\w*|carpent\w*|wood ?work\w*|design\w*|code|coding|engineer\w*|tinker\w*|construct\w*|project\w*)\b/gi, "Writes about making, fixing and building things"],
  ["farmer", /\b(garden\w*|plant\w*|grow\w*|farm\w*|cook\w*|bak\w*|kitchen|soil|harvest)\b/gi, "Writes about growing and cooking food"],
  ["fisher", /\b(fish\w*|sea|ocean|boat\w*|sail\w*|surf\w*|beach|lake|swim\w*)\b/gi, "Writes about the water"],
  ["forager", /\b(hik\w*|outdoors|woods|forest|camp\w*|trail\w*|mushroom\w*|walk\w*|wander\w*)\b/gi, "Writes about being out walking and in the woods"],
  ["woodcutter", /\b(lift\w*|gym|run|running|ran|train\w*|chop\w*|axe|strong|workout\w*)\b/gi, "Writes about hard physical work and training"],
  ["quarrier", /\b(stone|rock|climb\w*|dig\w*|mine|mining)\b/gi, "Writes about stone and climbing"],
  ["thatcher", /\b(writ\w*|read\w*|stor(?:y|ies)|teach\w*|art|paint\w*|draw\w*|music|sew\w*|knit\w*)\b/gi, "Writes about craft and patient handwork"],
];

/** The same, in their own mouth. */
const VALUE_MINE: Record<ValueName, string> = {
  "self-direction": "being free to choose my own way",
  achievement: "doing well, and being seen to",
  benevolence: "the people close to me",
  universalism: "fairness for everyone",
  security: "being safe and having enough",
  stimulation: "something new to chase",
  hedonism: "enjoying what there is",
  tradition: "where I come from",
  conformity: "doing right by what's expected",
  power: "having a say",
};

const VALUE_WHY: Record<ValueName, string> = {
  "self-direction": "Freedom to choose their own way",
  achievement: "Doing well and being seen to",
  benevolence: "The people close to them",
  universalism: "Fairness for everyone",
  security: "Safety and having enough",
  stimulation: "Novelty and excitement",
  hedonism: "Enjoying life",
  tradition: "Where they come from",
  conformity: "Doing what is expected",
  power: "Standing and control",
};

// ---------------------------------------------------------------- counting

function matcher(spec: string): (w: string) => boolean {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const t of spec.split(/\s+/)) if (t.endsWith("*")) prefixes.push(t.slice(0, -1));
    else exact.add(t);
  return (w) => exact.has(w) || prefixes.some((p) => w.startsWith(p));
}
const MATCH = Object.fromEntries(Object.entries(LEX).map(([k, v]) => [k, matcher(v)])) as Record<Cat, (w: string) => boolean>;
const CATS = Object.keys(LEX) as Cat[];

interface Counts {
  words: number;
  cats: Record<Cat, number>;
  questions: number;
  exclaim: number;
  longwords: number;
  sentences: number;
}

function count(text: string): Counts {
  const ws = words(text);
  const cats = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<Cat, number>;
  for (const w of ws) for (const c of CATS) if (MATCH[c](w)) cats[c]++;
  const ss = sentences(text);
  return { words: ws.length, cats, questions: (text.match(/\?/g) ?? []).length, exclaim: (text.match(/!/g) ?? []).length, longwords: ws.filter((w) => w.length >= 7).length, sentences: Math.max(1, ss.length) };
}

/** How far a passage's rate of one feature sits from the everyday rate, in rough standard units. */
function z(c: Counts, k: Cat | "questions" | "exclaim" | "longwords"): number {
  const per = 100 / Math.max(c.words, 1);
  if (k === "questions") return clampZ((c.questions / c.sentences - 0.12) / 0.15);
  if (k === "exclaim") return clampZ((c.exclaim / c.sentences - 0.1) / 0.15);
  if (k === "longwords") return clampZ(((c.longwords * per) - 17) / 6);
  const rate = c.cats[k] * per;
  return clampZ((rate - BASE[k]) / (BASE[k] * 0.8 + 0.3));
}
const clampZ = (x: number) => Math.max(-3, Math.min(3, x));
const r2 = (x: number) => Number(x.toFixed(2));
const clamp01 = (x: number, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, x));

const FEATURE_WORDS: Record<string, [string, string]> = {
  posemo: ["warm, upbeat words", "few warm words"],
  negemo: ["a lot of hurt and frustration", "little complaint"],
  anx: ["worry words", "almost no worry words"],
  anger: ["anger", "little anger"],
  sad: ["sadness and missing people", "little sadness"],
  social: ["talks about people a lot", "rarely mentions other people"],
  we: ["says “we” often", "rarely says “we”"],
  i: ["a lot of “I”", "little “I”"],
  tentative: ["hedges (maybe, kinda, I guess)", "doesn't hedge"],
  certain: ["absolutes (always, never)", "few absolutes"],
  achieve: ["work and goals", "little talk of goals"],
  plan: ["plans, lists and schedules", "no plans or lists"],
  insight: ["thinks out loud (realize, wonder, why)", "rarely reflects out loud"],
  novelty: ["new things, ideas and making", "little reach for the new"],
  swear: ["swearing", "never swears"],
  family: ["family", "little about family"],
  polite: ["thanks and apologies", "few thanks or apologies"],
  money: ["money", "little about money"],
  informal: ["chatty shorthand (lol, tbh)", "formal"],
  questions: ["lots of questions", "few questions"],
  exclaim: ["exclamation marks", "few exclamation marks"],
  longwords: ["long words", "short plain words"],
};

// ---------------------------------------------------------------- the reading

export function mockRead(input: WritingInput, passages: string[]): RawReading {
  const all = passages.join("\n");
  const total = count(all);
  const each = passages.map((p) => ({ p, c: count(p) }));
  const conf = Math.sqrt(Math.min(1, total.words / 500));
  const quotes = (ps: string[]) => [...new Set(ps)].slice(0, 3).map((p) => clip(p));

  // Traits: word families against base rates, plus what they say about themselves.
  const traits = {} as RawReading["traits"];
  for (const t of TRAIT_NAMES) {
    const w = WEIGHTS[t];
    let score = 0;
    const parts: { k: string; v: number }[] = [];
    for (const [k, wt] of Object.entries(w)) {
      const v = z(total, k as Cat) * wt!;
      score += v;
      parts.push({ k, v });
    }
    let said = 0;
    const saidQuotes: string[] = [];
    for (const [re, trait, d] of SELF_SAYS) {
      if (trait !== t) continue;
      for (const { p } of each) if (re.test(p)) {
        const m = re.exec(p)![0];
        said += /\b(kind of|sort of|kinda|a bit|a little|somewhat)\b/i.test(m) ? d * 0.5 : d;
        saidQuotes.push(p);
        break;
      }
    }
    const fromWords = 0.36 * Math.tanh(score * 0.8) * conf;
    const value = clamp01(0.5 + fromWords + Math.max(-0.3, Math.min(0.3, said)), 0.06, 0.94);
    const up = value >= 0.5;
    // The passages that pushed hardest in the direction the trait went.
    const ranked = each
      .filter((x) => x.c.words >= 12)
      .map((x) => ({ p: x.p, s: Object.entries(w).reduce((s, [k, wt]) => s + z(x.c, k as Cat) * wt!, 0) * (up ? 1 : -1) }))
      .filter((x) => x.s > 0.4)
      .sort((a, b) => b.s - a.s);
    const top = parts.filter((x) => Math.sign(x.v) === (up ? 1 : -1) && Math.abs(x.v) > 0.05).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 2);
    const why = [
      saidQuotes.length ? "Says so about themselves" : "",
      ...top.map((x) => {
        const zz = z(total, x.k as Cat);
        return FEATURE_WORDS[x.k]![zz >= 0 ? 0 : 1];
      }),
    ].filter(Boolean);
    traits[t] = { value: r2(value), why: why.length ? capital(why.join("; ")) : "Little in the writing either way", quotes: quotes([...saidQuotes, ...ranked.map((x) => x.p)]) };
  }

  // Formative memories: a past-tense moment with a sense of when and feeling in it, told from where
  // it starts ("When I was 12...") through the next sentence or two. At most one per passage.
  const age = ageFrom(all);
  const cands: { s: string; score: number; feel: number; when: number | undefined; helpless: number; arousal: number }[] = [];
  for (const { p } of each) {
    const ss = sentences(p);
    let best: (typeof cands)[number] | undefined;
    for (let i = 0; i < ss.length; i++) {
      const anchor = ss[i]!;
      const span = [anchor, ...ss.slice(i + 1, i + 3)].reduce((acc, x) => (acc.length + x.length < 280 && !/\?$/.test(x) ? `${acc} ${x}` : acc), "").trim() || anchor;
      const ws = words(anchor);
      if (ws.length < 5) continue;
      const past = words(span).filter((w) => PAST.has(w) || (/ed$/.test(w) && w.length > 4)).length;
      if (!past || !PAST_IN_ANCHOR.test(anchor)) continue;
      const when = whenOf(span, age);
      const timeMark = TIME_MARK.test(anchor);
      const c = count(span);
      const helpless = (span.match(HELPLESS) ?? []).length;
      const events = (span.match(BIG_EVENT) ?? []).length;
      const f = feel(span);
      const arousal = Math.abs(f.pos) + Math.abs(f.neg);
      const score = arousal * 1.1 + helpless * 0.8 + events * 1.2 + (timeMark ? 2.5 : 0) + (/\b(i|me|my|we|us)\b/i.test(span) ? 0.5 : 0) + Math.min(1, c.words / 30);
      if (score >= 3.5 && (!best || score > best.score)) best = { s: span, score, feel: f.value, when, helpless, arousal };
    }
    if (best) cands.push(best);
  }
  // The strongest four, told oldest first.
  const picked = cands
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => (b.when ?? 0) - (a.when ?? 0));
  const memories: RawReading["memories"] = picked.map((c, i) => ({
    quote: clip(c.s, 300),
    gist: inWorldWords(clip(c.s, 240)),
    // Being helped through something bad is remembered as good: the help is the point of the story.
    valence: r2(Math.max(-0.9, Math.min(0.9, HELPED.test(c.s) ? Math.max(c.feel, 0.5) : c.feel || (c.helpless ? -0.4 : 0.2)))),
    arousal: r2(Math.min(0.9, 0.45 + c.arousal * 0.06 + c.helpless * 0.05)),
    coping: r2(clamp01(0.55 - c.helpless * 0.12 + (/\b(figured|made it|got through|proud|fixed|managed|together)\b/i.test(c.s) ? 0.2 : 0), 0.1, 0.9)),
    topics: worldTopics(c.s).slice(0, 6),
    yearsAgo: Math.max(1, Math.round(c.when ?? 3 + i * 4)),
    people: peopleIn(c.s),
  }));

  // Core beliefs: generalizations they state about people, the world or themselves, then the lesson
  // a strong memory taught where they don't say it outright.
  const beliefs: RawReading["beliefs"] = [];
  const stated: { s: string; score: number }[] = [];
  for (const { p } of each)
    for (const s of sentences(p)) {
      const t = s.toLowerCase().replace(/[’]/g, "'");
      const n = words(s).length;
      if (/\?$/.test(s) || n < 3 || n > 26 || !VERB.test(t)) continue;
      const about = GENERAL.test(t);
      if (!about) continue;
      // A story about one day, or about one person, is not a belief about the world.
      if (/\b(yesterday|today|last night|this morning|tonight|this week|said|told me|asked|you say|you said|you told|you did|you were)\b/.test(t)) continue;
      // A belief has some force: an absolute, a can't, a have-to.
      if (!/\b(always|never|nobody|no one|everyone|everybody|only|anyone|nothing|every|can'?t|cant|don'?t|won'?t|doesn'?t|have to|gotta|need to|should|leave|leaves|mean well|right)\b/.test(t)) continue;
      const people = /\b(people|everyone|everybody|nobody|no one|anyone|you)\b/.test(t) ? 2 : 0;
      const specific = /\b(he|she|him|her|his|hers)\b/.test(t) || /(?<!^)\b[A-Z][a-z]{2,}\b/.test(s.slice(1)) ? 2 : 0;
      const selfDesc = /^(?:but |and |so )?i\b/.test(t) && !/\b(i can only|i can'?t trust|i can'?t count|i never ask|i can'?t stand|i always end up)\b/.test(t) ? 1.5 : 0;
      const absolute = (t.match(/\b(always|never|nobody|no one|everyone|only|anyone|nothing|every)\b/g) ?? []).length;
      const f = feel(s);
      const score = 1 + people + Math.min(2, absolute) * 0.7 + (Math.abs(f.pos) + Math.abs(f.neg)) * 0.2 + (n <= 14 ? 0.6 : 0) - specific - selfDesc;
      if (score >= 2) stated.push({ s, score });
    }
  for (const st of stated.sort((a, b) => b.score - a.score)) {
    if (beliefs.length >= 3) break;
    const text = beliefText(st.s);
    if (!text || beliefs.some((b) => b.text === text)) continue;
    const topics = worldTopics(st.s);
    const specific = topics.filter((t) => LINKING.has(t));
    // Of the memories on the same subject and of the same feeling, the most formative one.
    const fits = memories
      .map((m, i) => ({ i, w: Math.abs(m.valence) * (1.2 - m.coping) }))
      .filter(({ i }) => memories[i]!.topics.some((t) => specific.includes(t)) && !beliefs.some((b) => b.memory === i) && Math.sign(memories[i]!.valence) === (HOPEFUL.test(st.s) ? 1 : -1))
      .sort((a, b) => b.w - a.w);
    const mi = fits[0]?.i ?? -1;
    beliefs.push({ text, kind: "stated", quotes: [clip(st.s)], strength: r2(Math.min(0.75, 0.4 + st.score * 0.06)), memory: mi >= 0 ? mi : null, hopeful: HOPEFUL.test(st.s) });
  }
  // The most formative memories teach first.
  const byWeight = memories.map((m, i) => ({ m, i })).sort((a, b) => Math.abs(b.m.valence) * (1.2 - b.m.coping) - Math.abs(a.m.valence) * (1.2 - a.m.coping));
  byWeight.forEach(({ m, i }) => {
    if (beliefs.length >= 4 || beliefs.some((b) => b.memory === i) || Math.abs(m.valence) < 0.25) return;
    const lesson = lessonOf(m.valence, m.topics, m.quote);
    if (beliefs.some((b) => b.text === lesson.text)) return;
    beliefs.push({ text: lesson.text, kind: "learned", quotes: [m.quote], strength: r2(Math.min(0.7, 0.35 + m.arousal * 0.3 + (1 - m.coping) * 0.15)), memory: i, hopeful: lesson.hopeful });
  });

  // Values, by how often each family of words comes up.
  const values: RawReading["values"] = (Object.entries(VALUE_WORDS) as [ValueName, RegExp][])
    .map(([value, re]) => {
      const hits = each.filter(({ p }) => new RegExp(re.source, "i").test(p));
      const n = (all.match(re) ?? []).length;
      return { value, n, hits: hits.map((h) => h.p) };
    })
    .filter((v) => v.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((v, i, xs) => ({ value: v.value, weight: r2(Math.min(0.9, 0.4 + (v.n / (xs[0]!.n || 1)) * 0.4 - i * 0.05)), quotes: quotes(v.hits) }));

  // People in their life: names that come up more than once, and family by role.
  const people = peopleOf(each.map((x) => x.p));

  // Voice: how they write, for the speech faculty.
  const voice = voiceOf(passages, total);

  // Trade: what they spend their days on.
  const tradeScores = TRADE_WORDS.map(([role, re, why]) => ({ role, why, n: (all.match(re) ?? []).length, hits: each.filter(({ p }) => new RegExp(re.source, "i").test(p)).map((x) => x.p) })).sort((a, b) => b.n - a.n);
  const trade = tradeScores[0]!.n >= 2 ? tradeScores[0]! : { role: "builder" as PersonaTrade, why: "Nothing in the writing points to a trade; starts as a builder's hand", n: 0, hits: [] };

  // Attachment and how they see themselves.
  const find = (re: RegExp) => each.filter(({ p }) => re.test(p)).map((x) => x.p);
  const anxQ = find(/\b(do they (?:even )?like me|ignor\w*|left on read|abandon\w*|need (?:them|him|her|people)|clingy|what if (?:they|he|she)|scared (?:they|he|she)'?ll leave|miss (?:them|him|her|you)|reassur\w*)\b/i);
  const avoidQ = find(/\b(need (?:my )?space|on my own|don'?t need anyone|by myself|independent|hate asking|don'?t like asking|never ask(?:ed)? for help|rather do it myself|keep (?:people|everyone) at a distance|don'?t open up)\b/i);
  const upQ = find(/\b(proud of myself|i'?m proud of (?:it|that|what)|i'?m (?:good|great) at|i did it|nailed it|i got this|i can do|figured (?:it )?out|i'?ll figure)\b/i);
  const downQ = find(/\b(i'?m (?:bad|terrible|awful) at|i suck|not good enough|hate myself|i'?m (?:so )?stupid|i'?m a failure|can'?t do anything right|i can'?t do this|no idea what i'?m doing|imposter)\b/i);
  const noControl = find(/\b(no choice|had to|out of my hands|nothing i can do|stuck|trapped)\b/i);
  const sad = z(total, "sad") + z(total, "anx");

  const name = input.name.trim().split(/\s+/)[0] ?? input.name;
  const topBelief = beliefs[0];
  const topMem = [...memories].sort((a, b) => Math.abs(b.valence) * (1.2 - b.coping) - Math.abs(a.valence) * (1.2 - a.coping))[0];
  const goalLine = values[0] ? VALUE_WHY[values[0].value].toLowerCase().replace(/\bthem\b/, input.pronouns === "she" ? "her" : input.pronouns === "he" ? "him" : "them") : "a fresh start";

  return {
    age,
    summary: `${name} cares most about ${goalLine}${topBelief ? `, and believes “${topBelief.text}”` : ""}.`,
    voice,
    traits,
    attachment: {
      anxiety: r2(clamp01(0.4 + anxQ.length * 0.08 + Math.max(0, traits.neuroticism.value - 0.5) * 0.4, 0.1, 0.9)),
      avoidance: r2(clamp01(0.35 + avoidQ.length * 0.09 + Math.max(0, 0.5 - traits.extraversion.value) * 0.3, 0.1, 0.9)),
      why: [anxQ.length ? "Worries about being left or ignored" : "", avoidQ.length ? "Would rather manage alone than ask" : ""].filter(Boolean).join("; ") || "Nothing stands out; read from temperament",
      quotes: quotes([...avoidQ, ...anxQ]),
    },
    self: {
      selfEsteem: r2(clamp01(0.55 + upQ.length * 0.06 - downQ.length * 0.08 - Math.max(0, sad) * 0.04, 0.15, 0.9)),
      selfEfficacy: r2(clamp01(0.55 + upQ.length * 0.07 - downQ.length * 0.07, 0.15, 0.9)),
      control: r2(clamp01(0.55 - noControl.length * 0.06 + upQ.length * 0.03, 0.15, 0.85)),
      why: [upQ.length ? "Backs themselves" : "", downQ.length ? "Hard on themselves" : "", noControl.length ? "Often feels they had no choice" : ""].filter(Boolean).join("; ") || "Nothing stands out",
      quotes: quotes([...downQ, ...upQ, ...noControl]),
    },
    memories,
    beliefs,
    values,
    people,
    trade: { role: trade.role, why: trade.why, quotes: quotes(trade.hits) },
    lifeStory: [`I came to the bay to start again.`, topMem ? topMem.gist : "", values[0] ? `What matters to me is ${VALUE_MINE[values[0].value]}.` : ""].filter(Boolean).join(" "),
  };
}

// ---------------------------------------------------------------- helpers

const PAST = new Set("was were had did got went came left told said lost died took gave made felt thought knew saw found ran showed hauled cried stood started borrowed called sold bought moved broke fell won".split(" "));
const PAST_IN_ANCHOR = /\b(was|were|had|did|got|went|came|left|lost|died|took|gave|made|felt|showed|cried|started|moved|broke|fell|won|\w{3,}ed)\b/i;
const TIME_MARK = /\b(when i was|when (?:my|we|our|the)\b|years? ago|growing up|as a kid|back in|in (?:high )?school|in college|that (?:day|night|year|summer|winter)|the (?:day|night|year|time) (?:i|we|my|he|she|they)|i remember|i'll never forget|never forgot|last (?:year|summer|winter|spring)|in (?:19|20)\d\d|the first time|last time)\b/i;
const HELPLESS = /\b(couldn'?t|nothing (?:i|we) could|alone|nobody|no one|powerless|had to|no choice|didn'?t know what to do|on my own|by myself|scared)\b/gi;
const BIG_EVENT = /\b(left|died|fired|evicted|flooded|cheated|lied|stole|hit|screamed|abandoned|lost|burned|crashed|disappeared|cleared out|showed up|saved|carried|hugged|stayed up|surprised|born|married|graduated|moved)\b/gi;
/** Topics specific enough to tie a stated belief to the memory behind it. */
const LINKING = new Set(["help", "trust", "fairness", "store", "food", "hunger", "death", "grief", "sea", "storm", "trade", "house", "shelter", "love"]);
const GENERAL = /\b(people|everyone|everybody|nobody|no one|anyone|you can'?t|you cant|you have to|you gotta|you never|you always|the world|life is|i always|i never|i can'?t|i cant|i can only|never trust|if i don'?t|if i dont|if i stop|nothing ever|always end up|can'?t count on|can only count on|if you want something done|a good \w+ doesn'?t|things (?:always|never))\b/;
const VERB = /\b(is|are|was|can|can't|cant|will|won't|do|don't|does|doesn't|have|has|need|needs|mean|means|leave|leaves|take|takes|want|wants|get|gets|stay|stays|make|makes|let|lets|stand|trust|count|help|helps|work|works|say|says|end|ends)\b/;
const HOPEFUL = /\b(good|kind|work out|works out|pull through|together|got this|can do|worth it|show up|shows up)\b/i;
const POS_PHRASE = /\b(never let me down|showed up|best friend|you'?re the best|grateful|thank\w*|love\w*|proud|beautiful|together|teared up|happy|glad|good part|(?<!(?:nobody|no one|never) )helped|generous|funny|fair)\b/gi;
const HELPED = /\b(?<!(?:nobody|no one|never) )(showed up|helped|was there for|stayed with|fed us|took care of|carried)\b/i;
const NEG_PHRASE = /\b(let (?:me|us) down|never again|cleared out|disappeared|walked out|nobody helped|nobody came|no one came|left us|dad left|mom left|lost (?:almost )?everything|scared|broke|hate|cried|worry|worried|throw up|paranoid|flooded|nothing in the fridge|trouble|can'?t stand|dumb|rough)\b/gi;

/** How a sentence or two feels, from words and phrases: pos and neg counts and a value in [-1, 1]. */
function feel(s: string): { pos: number; neg: number; value: number } {
  const c = count(s);
  const pos = c.cats.posemo + (s.match(POS_PHRASE) ?? []).length;
  const neg = c.cats.negemo + c.cats.anx * 0.5 + c.cats.sad * 0.5 + c.cats.anger * 0.5 + (s.match(NEG_PHRASE) ?? []).length;
  return { pos, neg, value: pos + neg === 0 ? 0 : Math.max(-1, Math.min(1, ((pos - neg) / (pos + neg + 0.5)) * 1.2)) };
}

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

function ageFrom(text: string): number | null {
  const m = /\bi'?m (\d{2})\b(?! ?(?:%|percent|minutes|hours|days|weeks|months|dollars|k\b))|\b(\d{2}) years old\b|\bturn(?:ing|ed)? (\d{2})\b|\bmy (\d{2})(?:st|nd|rd|th) birthday\b/i.exec(text);
  const n = m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : NaN;
  return n >= 16 && n <= 90 ? n : null;
}

function whenOf(s: string, age: number | null): number | undefined {
  const t = s.toLowerCase();
  const ago = /(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten) years? ago/.exec(t);
  if (ago) return { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[ago[1]!] ?? Number(ago[1]);
  const was = /when i was (\d{1,2})|at (\d{1,2})\b/.exec(t);
  if (was && age) return Math.max(1, age - Number(was[1] ?? was[2]));
  if (/when i was (?:a kid|little|young)|growing up|as a kid/.test(t)) return age ? Math.max(5, age - 9) : 18;
  if (/high school/.test(t)) return age ? Math.max(2, age - 16) : 10;
  if (/college|university/.test(t)) return age ? Math.max(1, age - 20) : 7;
  const yr = /\bin (19\d\d|20\d\d)\b/.exec(t);
  if (yr) return Math.max(1, 2026 - Number(yr[1]));
  if (/last (?:year|summer|winter|spring|fall)/.test(t)) return 1;
  return undefined;
}

const NOT_NAMES = new Set("I Im I'm Ive I've Id I'd Ill I'll The A An And But So Then When What Why How Who Where This That These Those It Its It's My Me We Our Us You Your He She They Them His Her Their If Or Not No Yes Yeah Ok Okay Oh Also Just Like Honestly Anyway Today Tomorrow Yesterday Tonight Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Christmas God Lol Omg Tbh Ngl Idk Maybe Still Even Sometimes Every Everyone Nobody Someone Nothing Everything Because Since Hollow Bay Psyche Mom Mum Dad Grandma Grandpa People Things Thinking Started Rough Rent Feeding Freedom Surprises Notes Ok Not Mrs Mr Ms Dr".split(" "));
const KIN = /\bmy (mom|mum|mother|dad|father|sister|brother|grandma|grandpa|grandmother|grandfather|aunt|uncle|best friend|partner|boyfriend|girlfriend|wife|husband|boss|son|daughter|roommate|ex)\b(?: ([A-Z][a-z]+))?/g;

function peopleIn(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(KIN)) out.add(m[2] ? m[2] : `my ${m[1]}`);
  for (const m of s.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-z]{2,})\b/g)) if (!NOT_NAMES.has(m[1]!)) out.add(m[1]!);
  return [...out].slice(0, 4);
}

function peopleOf(passages: string[]): RawReading["people"] {
  const found = new Map<string, { relation?: string; ps: string[]; mid: boolean }>();
  const add = (name: string, p: string, relation?: string, mid = true) => {
    const e = found.get(name) ?? { ps: [], mid: false };
    if (relation) e.relation ??= relation;
    if (mid) e.mid = true;
    if (!e.ps.includes(p)) e.ps.push(p);
    found.set(name, e);
  };
  for (const p of passages) {
    const names = new Set<string>();
    for (const s of sentences(p)) {
      for (const m of s.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
        if (NOT_NAMES.has(m[1]!)) continue;
        // A capital at the start of a sentence may just be a word; it counts once seen mid-sentence too.
        add(m[1]!, p, undefined, m.index! > 0);
        names.add(m[1]!);
      }
    }
    for (const m of p.matchAll(KIN)) {
      if (m[2]) add(m[2], p, m[1]);
      // "my best friend" with exactly one name in the passage is probably that person.
      else if (names.size === 1 && /friend|partner|boyfriend|girlfriend|wife|husband/.test(m[1]!)) add([...names][0]!, p, m[1]);
      else add(`my ${m[1]}`, p, m[1]);
    }
  }
  return [...found.entries()]
    .filter(([n, e]) => (n.startsWith("my ") ? true : e.mid && (e.ps.length >= 2 || !!e.relation)))
    .sort((a, b) => b[1].ps.length + (b[1].relation ? 1 : 0) - (a[1].ps.length + (a[1].relation ? 1 : 0)))
    .slice(0, 5)
    .map(([name, e]) => {
      const key = name.startsWith("my ") ? name.slice(3) : name;
      // Sentences that name them, and in a passage about only them, the ones that say she or he.
      const near = e.ps.flatMap((p) => {
        const ss = sentences(p);
        const only = new Set((p.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter((w) => !NOT_NAMES.has(w))).size === 1;
        return ss.filter((s) => s.includes(key) || (only && /^(?:she|he|they)\b/i.test(s)));
      });
      const f = (near.length ? near : e.ps).reduce((sum, s) => sum + feel(s).value, 0) / Math.max(1, near.length || e.ps.length);
      const best = (near.length ? near : e.ps).sort((a, b) => Math.abs(feel(b).value) - Math.abs(feel(a).value));
      const prior = /best friend|partner|wife|husband|girlfriend|boyfriend/.test(e.relation ?? "") ? 0.35 : /friend/.test(e.relation ?? "") ? 0.2 : 0;
      return { name, relation: e.relation ?? null, feeling: r2(Math.max(-0.9, Math.min(0.9, f + prior))), quotes: best.slice(0, 2).map((p) => clip(p)) };
    });
}

function voiceOf(passages: string[], total: Counts): RawReading["voice"] {
  const ss = passages.flatMap((p) => sentences(p));
  const avg = total.words / Math.max(1, ss.length);
  const lower = passages.filter((p) => /^[a-z]/.test(p)).length / Math.max(1, passages.length);
  const informal = [...new Set(passages.join(" ").toLowerCase().match(/\b(lol|lmao|haha+|omg|tbh|ngl|idk|lowkey|honestly|literally|like,|kinda|gonna|wanna)\b/g) ?? [])].slice(0, 4);
  const emoji = (passages.join(" ").match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const exclaim = total.exclaim / Math.max(1, ss.length);
  const parts = [
    avg < 9 ? "Short bursts" : avg > 20 ? "Long, winding sentences" : "Medium-length sentences",
    lower > 0.5 ? "mostly lowercase" : "",
    informal.length ? `says ${informal.map((w) => `“${w.replace(/,$/, "")}”`).join(", ")}` : "",
    exclaim > 0.25 ? "lots of exclamation marks" : exclaim < 0.03 ? "rarely exclaims" : "",
    emoji > 2 ? "uses emoji" : "",
    z(total, "swear") > 1 ? "swears freely" : "",
    z(total, "tentative") > 1 ? "hedges a lot" : z(total, "certain") > 1 ? "speaks in absolutes" : "",
  ].filter(Boolean);
  const samples = passages
    .flatMap((p) => sentences(p))
    .filter((s) => {
      const n = words(s).length;
      return n >= 5 && n <= 22 && !/https?:/.test(s);
    })
    .map((s) => ({ s, score: (s.match(/\b(lol|honestly|tbh|ngl|literally|kinda|i mean|like)\b/gi) ?? []).length + (/[!?]/.test(s) ? 0.5 : 0) + (/\b(i|i'm|me)\b/i.test(s) ? 0.3 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => clip(x.s, 140));
  return { description: `${capital(parts.join("; "))}.`, samples };
}

/** A stated generalization, tidied into a core belief. */
function beliefText(s: string): string | undefined {
  let t = s.replace(/^["“'(]+|["”')]+$/g, "").trim();
  t = t.replace(/^(?:and|but|so|because|honestly|tbh|ngl|like|i mean|i think|i feel like|i guess|lol|yeah|ok|okay)[,\s]+/i, "");
  t = t.replace(/^(?:and|but|so|honestly|tbh|like|i think|i feel like)[,\s]+/i, "");
  t = t.replace(/\s*\b(?:lol|lmao|haha+|tbh|ngl)\b\s*/gi, " ").replace(/[.!…]+$/, "").replace(/\s{2,}/g, " ").trim();
  if (words(t).length < 3) return undefined;
  if (t.length > 110) t = clip(t, 110).replace(/…$/, "");
  return capital(t);
}

/** What a strong memory teaches, when the writing doesn't say it outright. */
function lessonOf(valence: number, topics: string[], quote: string): { text: string; hopeful: boolean } {
  const has = (...ts: string[]) => ts.some((t) => topics.includes(t));
  const q = quote.toLowerCase();
  if (valence < 0) {
    if (/\b(nobody|no one|alone|by myself|on my own)\b/.test(q) || has("help")) return { text: "I can only count on myself", hopeful: false };
    if (has("trust") || /\b(lied|cheat|betray|stole|behind my back)\b/.test(q)) return { text: "People will let you down when it counts", hopeful: false };
    if (has("death", "grief") || /\b(left|leave|gone)\b/.test(q)) return { text: "Everyone I love leaves", hopeful: false };
    if (has("store") || has("food")) return { text: "There's never enough, so hold on to what you have", hopeful: false };
    if (has("build", "reputation")) return { text: "If I stop working, everything falls apart", hopeful: false };
    if (has("sea", "storm")) return { text: "The sea takes what it's owed", hopeful: false };
    return { text: "Bad things come without warning", hopeful: false };
  }
  if (has("help", "trust")) return { text: "People pull together when it counts", hopeful: true };
  if (/\b(everyone said|they said|told me|proud|doubted)\b/.test(q)) return { text: "If I keep at it, I can prove them wrong", hopeful: true };
  if (has("family", "home")) return { text: "We look after our own", hopeful: true };
  if (has("build")) return { text: "Many hands make light work", hopeful: true };
  return { text: "Things work out if you keep at it", hopeful: true };
}
