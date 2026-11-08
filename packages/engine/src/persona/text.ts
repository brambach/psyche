// Plain text handling for reading a person: splitting writing into passages (a chat export keeps only
// the author's own lines), sentences and words, checking a quote against the writing, mapping what a
// belief is about onto the topics the world's choices actually use, and framing a modern memory in
// the words of a village with no phones or offices.

const CHAT_LINE = /^(?:\[[^\]]{4,40}\]\s*|\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?\s*[-–]\s*|\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?\s*[-–]?\s*)?([A-Za-z][\w .'-]{0,30}?):\s+(.+)$/;

export interface Parsed {
  /** The author's own passages, in order. */
  passages: string[];
  /** Whether this looked like a chat export. */
  chat: boolean;
  /** In a chat, whose lines were kept. */
  author?: string;
  /** In a chat, the other people talking, by how many lines each wrote. */
  others: { name: string; lines: number }[];
}

/** Split writing into passages. A chat export ("Name: message", with or without timestamps) keeps only the author's lines. */
export function parseWriting(text: string, author?: string): Parsed {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const chatLines = lines.map((l) => CHAT_LINE.exec(l)).filter((m): m is RegExpExecArray => !!m && m[1]!.split(" ").length <= 3);
  if (lines.length >= 4 && chatLines.length >= lines.length * 0.5) {
    const counts = new Map<string, number>();
    for (const m of chatLines) counts.set(m[1]!.trim(), (counts.get(m[1]!.trim()) ?? 0) + 1);
    const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const want = author?.trim().toLowerCase();
    const who = (want && byCount.find(([n]) => n.toLowerCase() === want || n.toLowerCase().split(" ")[0] === want.split(" ")[0])?.[0]) || byCount[0]![0];
    const passages = chatLines.filter((m) => m[1]!.trim() === who).map((m) => m[2]!.trim()).filter((p) => !/^<media omitted>$|^image omitted$/i.test(p));
    return { passages, chat: true, author: who, others: byCount.filter(([n]) => n !== who).map(([name, lines]) => ({ name, lines })) };
  }
  // Notes, a journal, an essay: paragraphs, with very long ones cut at sentence ends.
  const paragraphs = text.replace(/\r/g, "").split(/\n\s*\n|\n(?=[-*•] )/).map((p) => p.replace(/\s*\n\s*/g, " ").replace(/^[-*•]\s+/, "").trim()).filter(Boolean);
  const passages: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= 600) {
      passages.push(p);
      continue;
    }
    let cur = "";
    for (const s of sentences(p)) {
      if (cur && cur.length + s.length > 500) {
        passages.push(cur.trim());
        cur = "";
      }
      cur += `${s} `;
    }
    if (cur.trim()) passages.push(cur.trim());
  }
  return { passages, chat: false, others: [] };
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=["'“(]?[A-Za-z0-9])|\s+[-–—]\s+(?=[a-z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function words(text: string): string[] {
  return text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z][a-z']*|\d+/g) ?? [];
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9']+/g, " ").trim();

/** Whether a quote appears in the writing word for word (ignoring case and punctuation). */
export function quoteFound(quote: string, writing: string): boolean {
  const q = norm(quote);
  return q.length > 0 && norm(writing).includes(q);
}

/** Tidy a quote for display: one line, at most `max` characters, cut at a word. */
export function clip(s: string, max = 220): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).replace(/[,;:.!?\s]+$/, "")}…`;
}

// ---------------------------------------------------------------- what things are about, in the world's terms

/**
 * Word patterns and the world topics they stand for. The village decides things about food and the
 * common store, help, houses, trade, the sea and the people in it, so a belief like "if I stop working
 * everything falls apart" has to land on topics those choices carry, or it would never come up.
 */
const TOPICS: [RegExp, string[]][] = [
  [/\b(food|hungry|hunger|starv\w*|eat\w*|ate|cook\w*|bak\w*|bread|dinner|lunch|meal\w*|grocer\w*|fridge|kitchen)\b/, ["food", "hunger"]],
  [/\b(money|rent|broke|bills?|debt|pay\w*|paid|afford\w*|cash|savings?|saved|account|salary|paycheck|poor|expensive|cost\w*)\b/, ["store", "food", "fairness"]],
  [/\b(winter|cold|snow\w*|freez\w*|frost)\b/, ["winter"]],
  [/\b(help\w*|support\w*|showed up|show up|there for|lean on|rely|relied|count on|asked for)\b/, ["help"]],
  [/\b(alone|lonely|loneliness|nobody|no one|by myself|on my own|isolated|left out)\b/, ["help", "family"]],
  [/\b(mom|mum|mother|dad|father|parents?|sister|brother|siblings?|family|grandm\w*|grandp\w*|aunt|uncle|kids?|son|daughter|wife|husband|partner)\b/, ["family", "home"]],
  [/\b(house|home|apartment|flat|moved|moving|roof|room|landlord|evicted|fire|burn\w*)\b/, ["house", "home", "shelter"]],
  [/\b(work\w*|job|jobs|boss|office|company|startup|project\w*|career|ship\w*|build\w*|built|make|made|making|fix\w*|craft\w*|business)\b/, ["build", "reputation"]],
  [/\b(fail\w*|failure|quit|fired|laid off|lost my|stupid|worthless|useless|not good enough|embarrass\w*|ashamed|judg\w*|respect\w*|proud|prove)\b/, ["reputation", "respect"]],
  [/\b(friends?|team\w*|crew|together|we)\b/, ["help", "trust"]],
  [/\b(lie|lied|lying|cheat\w*|betray\w*|stole|steal\w*|behind my back|used me|trust\w*|promis\w*|backstab\w*|cleared out|ran off|disappeared|screwed (?:me|us) over|count on|let (?:me|us) down)\b/, ["trust", "fairness"]],
  [/\b(fair|unfair|justice|deserve\w*|share|sharing|equal\w*|greed\w*|selfish)\b/, ["fairness", "store"]],
  [/\b(die|died|death|dead|funeral|sick|illness|hospital|cancer|grief|griev\w*|passed away|lost (?:him|her|them))\b/, ["death", "grief"]],
  [/\b(sea|ocean|boat\w*|sail\w*|beach|lake|swim\w*|drown\w*|storm\w*|waves?|fish\w*)\b/, ["sea", "boat", "storm"]],
  [/\b(trade|sell\w*|sold|buy\w*|bought|market|customers?|deal\w*|clients?|strangers?|outsiders?|negotiat\w*)\b/, ["trade", "market"]],
  [/\b(stor(?:y|ies)|tell\w*|told|talk\w*|party|parties|bar|drinks?|hang\w*)\b/, ["stories", "fire"]],
  [/\b(leave|left|leaving|abandon\w*|gone|walked out|ghost\w*|break ?up|broke up|divorc\w*)\b/, ["family", "love", "grief"]],
  [/\b(plan\w*|control\w*|ready|prepar\w*|safe|secure|security|stable|uncertain\w*|worry\w*|worried)\b/, ["store", "winter"]],
];

/** World topics a piece of text is about. */
export function worldTopics(text: string): string[] {
  const t = text.toLowerCase();
  return [...new Set(TOPICS.filter(([re]) => re.test(t)).flatMap(([, ts]) => ts))];
}

/**
 * Shape a core belief: which world topics set it off, and whether it makes the world look more
 * dangerous (threat) or other people more to blame (blame), or the opposite for a hopeful one.
 * Same idea as shapeFear() in edits.ts, with a wider net for things people write about their lives.
 */
export function shapeBelief(text: string, hopeful?: boolean, extra: string[] = []): { triggers: string[]; threat: number; blame: number } {
  const t = text.toLowerCase();
  const triggers = [...new Set([...worldTopics(t), ...extra])].slice(0, 7);
  const good = hopeful ?? (/\b(good|kind|safe|enough|work out|works out|help|trust|love|belong|look after|together|pull through|got this|can do)\b/.test(t) && !/\b(never|n't|not|no one|nobody|can't|cant|won't|nothing)\b/.test(t));
  const people = /\b(people|they|everyone|everybody|nobody|no one|strangers?|folks?|neighbou?rs?|others|friends?|anyone|someone|family)\b/.test(t);
  const sign = good ? -1 : 1;
  return {
    triggers: triggers.length ? triggers : ["help", "family", "store"],
    threat: Number((sign * (people ? 0.1 : 0.3)).toFixed(2)),
    blame: Number((sign * (people ? 0.3 : 0.05)).toFixed(2)),
  };
}

// ---------------------------------------------------------------- the world's words

/** Modern words and what the village would call them. Order matters: longer phrases first. */
const WORLD_WORDS: [RegExp, string][] = [
  [/\b(?:my|our|the) (?:startup|company|business)\b/gi, "the workshop"],
  [/\bstartups?\b/gi, "workshop"],
  [/\b(?:office|workplace|factory|warehouse|store)\b/gi, "workshop"],
  [/\bco-?workers?\b|\bcolleagues?\b/gi, "the crew"],
  [/\bmy team\b/gi, "my crew"],
  [/\bthe team\b/gi, "the crew"],
  [/\bboss\b/gi, "master"],
  [/\bmanager\b/gi, "foreman"],
  [/\bclients?\b|\bcustomers?\b/gi, "buyers"],
  [/\b(?:college|university|grad school|uni)\b/gi, "my apprenticeship"],
  [/\bhigh school\b/gi, "school"],
  [/\bapartment\b|\bflat\b/gi, "rooms"],
  [/\blandlord\b/gi, "the man who owned our rooms"],
  [/\bcars?\b|\btrucks?\b/gi, "cart"],
  [/\bdrove\b/gi, "rode"],
  [/\b(?:texted|messaged|dm'?d|emailed|called)\b/gi, "sent word to"],
  [/\b(?:texts?|messages?|emails?|dms?)\b/gi, "word"],
  [/\b(?:phone|cell|iphone)\b/gi, "letters"],
  [/\b(?:laptop|computer|pc)\b/gi, "workbench"],
  [/\b(?:coding|code|programming|software|apps?|website|the product)\b/gi, "the work"],
  [/\b(?:shipped|launched|deployed)\b/gi, "finished"],
  [/\b(?:online|on the internet|on twitter|on instagram|on tiktok|on social media)\b/gi, "in the square"],
  [/\b(?:hospital|er|icu)\b/gi, "the infirmary"],
  [/\b(?:doctors?)\b/gi, "the healer"],
  [/\bbank\b/gi, "moneylender"],
  [/\$\s?\d[\d,.]*k?\b/gi, "a fair bit of coin"],
  [/\b\d[\d,]* (?:dollars|bucks|euros|pounds)\b/gi, "a fair bit of coin"],
  [/\b(?:dollars|bucks)\b/gi, "coin"],
  [/\b(?:paycheck|salary)\b/gi, "wages"],
  [/\bbills\b/gi, "debts"],
  [/\b(?:bar|pub|club)\b/gi, "tavern"],
  [/\bcoffee\b/gi, "tea"],
  [/\b(?:pizza|takeout|fast food)\b/gi, "bread"],
  [/\b(?:flights?|planes?)\b/gi, "passage"],
  [/\bflew\b/gi, "sailed"],
  [/\b(?:tv|netflix|video games?|games)\b/gi, "the fire"],
  [/\b(?:the |a )?(?:gym|parking lot)\b/gi, "the yard"],
  [/\btable saw\b/gi, "saw"],
  [/\b(?:a )?wet vac\b/gi, "buckets"],
  [/\binvoic\w*\b/gi, "bill"],
  [/\bgroceries\b/gi, "supplies"],
  [/\b(?:city|downtown)\b/gi, "town"],
  [/\b(?:lol|lmao|haha+|omg|tbh|ngl|idk|lowkey)\b/gi, ""],
  [/\b(?:fucking|freaking|fking)\s/gi, ""],
];

/** A memory in the words of a village: no phones, no offices. The gist stays theirs. */
export function inWorldWords(text: string): string {
  let s = text;
  for (const [re, to] of WORLD_WORDS) s = s.replace(re, to);
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/^[,.\s]+/, "").trim();
  if (!s) return text.trim();
  s = s[0]!.toUpperCase() + s.slice(1);
  // "i" alone as a word is "I".
  s = s.replace(/\bi\b/g, "I").replace(/\bi'(m|ve|d|ll)\b/g, "I'$1");
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}
