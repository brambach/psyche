// Names for a world too big to name by hand. Towns and regions are named from two short lists put
// together, walked in a scattered order so neighbours do not sound alike. A name is a pure function
// of which region asks and how many it has named, so regions on different threads never have to ask
// each other what is taken, and the same seed names the same world every time.

const TOWN_FIRST = [
  "Salt", "Grey", "Wick", "Thorn", "Fen", "Lark", "Seal", "Ash", "West", "Dun", "Mull", "Gannet", "Brin", "Tarn", "Kittle", "Marsh", "Stone", "Elder", "Hazel", "Otter",
  "Heron", "Rush", "Kelp", "Storm", "Whin", "Black", "White", "Red", "Long", "High", "Cold", "Barley", "Amber", "Raven", "Gull", "Pine", "Reed", "Wren", "Sedge", "Holm",
  "Cor", "Pen", "Tre", "Ald", "Bram", "Carn", "Dray", "Eller", "Garth", "Hob",
];
const TOWN_LAST = [
  "marsh", "haven", "stead", "mouth", "hollow", "point", "grove", "ford", "combe", "ness", "wick", "by", "ham", "ton", "cove", "reach", "strand", "holm", "mere", "field",
  "bridge", "gate", "water", "cliff", "head", "sands", "landing", "ferry", "moor", "well", "bank", "fold", "garth", "hythe", "rigg", "thwaite", "staithe", "wold", "ley", "end",
];
const QUALIFIERS = ["", "New ", "Upper ", "Lower ", "Little ", "Great ", "Old ", "Far ", "North ", "South ", "East ", "Nether "];

const REGION_FIRST = [
  "Marrow", "Tern", "Kiln", "Saltings", "Dray", "Whale", "Cinder", "Lantern", "Gorse", "Skerry", "Bittern", "Pilgrim", "Harrow", "Kestrel", "Samphire", "Tallow", "Anvil", "Curlew", "Driftwood", "Ember",
  "Fathom", "Gallow", "Hearth", "Iron", "Juniper", "Keel", "Loom", "Mackerel", "Nettle", "Oyster", "Plover", "Quern", "Rowan", "Shingle", "Thistle", "Umber", "Vesper", "Willow", "Yarrow", "Zephyr",
];
const REGION_FORM = ["the {} Coast", "{} Sound", "the {} Shore", "{} Reach", "the {} Isles", "{} Water", "the {} Banks", "{} Firth"];

/** No more regions than this share one sea: it is how far apart each region's names are dealt. */
export const MAX_REGIONS = 256;

const scatter = (i: number, n: number, step: number) => (((i % n) * step) % n + n) % n;

/** The nth town named by region number `region` (0 for the first coast). Never the same for two (region, n). */
export function townName(region: number, n: number): string {
  const combos = TOWN_FIRST.length * TOWN_LAST.length;
  const g = n * MAX_REGIONS + (region % MAX_REGIONS);
  // 1999 shares no factor with the number of combinations, so every pair comes up once before any repeats.
  const k = scatter(g, combos, 1999);
  const first = TOWN_FIRST[k % TOWN_FIRST.length]!;
  const last = TOWN_LAST[Math.floor(k / TOWN_FIRST.length)]!;
  const round = Math.floor(g / combos);
  const q = QUALIFIERS[round % QUALIFIERS.length]!;
  const again = Math.floor(round / QUALIFIERS.length);
  const base = first.endsWith(last[0]!) && last.length > 3 ? first + last.slice(1) : first + last;
  return `${q}${base}${again ? ` ${again + 1}` : ""}`;
}

/** The name of region number `index` (1 and up; the first coast keeps its own name). */
export function regionName(index: number): string {
  const n = REGION_FIRST.length * REGION_FORM.length;
  const k = scatter(index, n, 37);
  const first = REGION_FIRST[k % REGION_FIRST.length]!;
  const form = REGION_FORM[Math.floor(k / REGION_FIRST.length)]!;
  const round = Math.floor(index / n);
  return form.replace("{}", round ? `${QUALIFIERS[round % QUALIFIERS.length]!.trim()} ${first}`.trim() : first);
}

/** A region's mark on the ids made in it: letters only (a, b, ... z, aa, ...), so a number after it is always a count. */
export function regionTag(index: number): string {
  let s = "";
  for (let i = index; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(97 + (i % 26)) + s;
  return s;
}
