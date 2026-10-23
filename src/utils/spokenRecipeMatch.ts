/**
 * Matching a spoken dish name against the recipe catalogue.
 *
 * WHY THIS EXISTS
 * Whisper transcribes by sound, and the catalogue is written by people. So
 * "masala dosa" arrives as "masala dosaa", "idli" as "idly", "samosa" as
 * "samusa", "paneer tikka" as "painter tikka". None of those are in the
 * catalogue, so the meal plan used to end up holding a dish that does not
 * exist — and a wrong dish is worse than a missing one, because it poisons
 * the taste model and the taste-match score forever.
 *
 * THE CATALOGUE IS NOISY
 * Most names in csvRecipes.json are auto-generated and long:
 *   "Achari Aloo Sabzi Recipe - Potatoes In Spicy Pickle Masala"
 *   "Ajwain Besan Ka Paratha Recipe (Masala Paratha)"
 * Nobody says that. They say "aloo sabzi" and "besan paratha". So every
 * name is reduced to a CORE first — the part before "Recipe", before a
 * pipe, before a bracket, before a dash — and matching happens against the
 * core. The core is also what gets written into the meal plan, so the plan
 * reads "Masala Dosa" and not the full generated title.
 *
 * HOW IT MATCHES
 * An inverted index over the words of every core, so a query only has to
 * look at recipes that contain one of the spoken words:
 *
 *   1. exact        the whole phrase is a core
 *   2. word         every spoken word appears in a core (one of them may
 *                   be a near-miss, e.g. "dosaa" -> "dosa")
 *   3. near-word    one spoken word is a near-miss of a catalogue word
 *                   ("idly" -> "idli", "painter" -> "paneer")
 *
 * Each candidate is scored on how far it is from what was actually said:
 * one edit to a word costs more than one extra word in the title, and a
 * phrase made only of words too generic to identify a dish ("dal curry")
 * is marked as less certain.
 *
 * A match is only applied automatically when it is confident. Below the
 * threshold the heard words are kept as they are and the candidates are
 * offered instead, because a wrong dish is worse than a missing one.
 */
import type { Recipe } from '../types';

/** How a match was arrived at. */
export type MatchTier = 'exact' | 'word' | 'near-word' | 'none';

export interface DishMatch {
  /** The catalogue recipe that was matched. */
  recipe: Recipe;
  /** The clean, short name to write into the meal plan. */
  name: string;
  /** 0..1. Higher is a better match. */
  score: number;
  tier: MatchTier;
}

export interface DishResolution {
  /** Exactly what was heard. */
  heard: string;
  /** The best match, or null when nothing was close enough. */
  best: DishMatch | null;
  /** Other plausible recipes, best first. */
  alternatives: DishMatch[];
}

/**
 * A match at or above this score is applied on its own. Below it the heard
 * words are kept, because a meal plan holding the wrong dish is worse than
 * one holding a rough name the user can see and fix.
 */
export const CONFIDENT_SCORE = 0.75;

/**
 * How much a curated recipe is preferred over a scraped one.
 *
 * The CSV catalogue is a bulk scrape and it contains junk: "Spinach Wada
 * Recipe (Spinach & Women's Gram Printers)" is a template with a printing
 * error in it, and it matches the word "wada" exactly, so it beat the
 * curated "Medu vada" for a bare "wada". The app's own 127 recipes are the
 * ones it supports properly, so they are preferred when the alternatives
 * are otherwise close.
 */
const PREFERRED_BONUS = 0.15;

/**
 * Words too common to identify a dish on their own. "Dal curry" could be
 * any of hundreds of recipes, so a match built only from these is treated
 * as a suggestion rather than a correction.
 */
const GENERIC_WORDS = new Set([
  'dal', 'curry', 'masala', 'rice', 'sabzi', 'soup', 'gravy', 'tandoori',
  'biryani', 'roti', 'naan', 'dosa', 'idli', 'vada', 'vadas', 'upma',
  'paratha', 'puri', 'poori', 'chapati', 'samosa', 'chutney', 'raita',
  'lassi', 'halwa', 'tikka', 'masaledar', 'dry', 'plain', 'mixed', 'vegetable',
  'style', 'kerala', 'andhra', 'south', 'north', 'indian', 'homestyle',
  'recipe', 'with', 'and', 'the', 'for', 'a', 'of',
]);

/** Normalised name -> the recipes with that core. */
interface Index {
  cores: { core: string; words: string[]; recipe: Recipe }[];
  /** Normalised word -> indices into `cores`. */
  wordToCores: Map<string, number[]>;
  /** Words bucketed by length, so a fuzzy lookup only compares plausible ones. */
  wordsByLength: Map<number, string[]>;
  /** Every distinct catalogue word. */
  words: string[];
}

/**
 * Adjectives that sit in front of a real name and change nothing about the
 * dish. The catalogue is full of them — "Delicious Dal Makhani", "Creamy
 * Dal Makhani", "Classic Chole Bhature" — and leaving them in place means
 * the dish nobody says ("dal makhani") never matches anything, because no
 * core is exactly "Dal Makhani".
 *
 * Only stripped from the FRONT, and only a short conservative list, so a
 * real word is never lost from the middle of a name.
 */
const NOISE_LEADERS = new Set([
  'delicious', 'tasty', 'yummy', 'awesome', 'best', 'perfect', 'super',
  'great', 'nice', 'easy', 'simple', 'quick', 'homemade', 'homestyle',
  'classic', 'traditional', 'authentic', 'restaurant', 'special', 'fresh',
  'my', 'favourite', 'favorite', 'gorgeous', 'mouthwatering', 'homestyle',
]);

/**
 * Reduce a catalogue name to the part a person would actually say.
 *
 * "Delicious Dal Makhani Recipe - Slow Cooked Black Lentils"
 *   -> "Dal Makhani"
 */
export function dishCore(name: string): string {
  let s = (name || '').trim();
  // "X Recipe - Y" and "X Recipe (Y)" and "X | Y" all mean the dish is X.
  s = s.split(/\s+[Rr]ecipe\b/)[0];
  s = s.split(' | ')[0];
  // "Pani puri / gol gappa" is one dish with two names.
  s = s.split(' / ')[0];
  s = s.replace(/\s*\(.*?\)\s*$/, '').trim();
  s = s.replace(/\s+[-–—]\s+.*$/, '').trim();
  // A few titles keep the word "recipe" in a different case.
  s = s.replace(/\s*\brecipes?\b\s*$/i, '').trim();
  // Drop leading noise adjectives.
  let words = s.split(/\s+/);
  while (words.length > 1 && NOISE_LEADERS.has(words[0].toLowerCase())) {
    words = words.slice(1);
  }
  s = words.join(' ').trim();
  return s || (name || '').trim();
}

/** Lower-case, strip punctuation, collapse spaces. */
export function normalizeDish(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Damerau-Levenshtein distance, with transpositions.
 *
 * Transpositions matter more than usual here: "idly" for "idli" and
 * "samusa" for "samosa" are swapped pairs, and a plain edit distance
 * counts those as two errors instead of one.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev2: number[] | null = null;
  let prev = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array<number>(lb + 1);
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2 as number[])[j - 2] + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[lb];
}

/** How many characters a word may be off and still count as the same word. */
function maxWordDistance(word: string): number {
  if (word.length <= 3) return 0;
  if (word.length <= 6) return 1;
  return 2;
}

/** Build the inverted index. Cached against the catalogue array identity. */
const indexCache = new WeakMap<Recipe[], Index>();

function buildIndex(catalogue: Recipe[]): Index {
  const cores: Index['cores'] = [];
  const wordToCores = new Map<string, number[]>();
  const wordsByLength = new Map<number, string[]>();
  const allWords = new Set<string>();

  catalogue.forEach((recipe) => {
    const core = dishCore(recipe.name);
    const key = normalizeDish(core);
    if (!key) return;
    const idx = cores.length;
    const words = key.split(' ');
    cores.push({ core, words, recipe });
    words.forEach((w) => {
      allWords.add(w);
      const list = wordToCores.get(w);
      if (list) list.push(idx);
      else wordToCores.set(w, [idx]);
    });
  });

  wordsByLength.clear();
  allWords.forEach((w) => {
    const l = w.length;
    const list = wordsByLength.get(l);
    if (list) list.push(w);
    else wordsByLength.set(l, [w]);
  });

  return { cores, wordToCores, wordsByLength, words: [...allWords] };
}

function indexFor(catalogue: Recipe[]): Index {
  const cached = indexCache.get(catalogue);
  if (cached) return cached;
  const built = buildIndex(catalogue);
  indexCache.set(catalogue, built);
  return built;
}

/**
 * Catalogue words close enough to a spoken word to be the same word.
 * Sorted cheapest first.
 *
 * The exact word is NOT short-circuited. "dose" is a real catalogue word
 * (in a pasta recipe) and "idly" is a real catalogue word (in "Idly chat"),
 * and returning only the exact match meant "masala dose" found nothing at
 * all and "idly" found a tea rather than an idli. Both the exact word and
 * its near-misses are offered, and the scoring decides between them.
 */
function nearWords(word: string, index: Index): { word: string; cost: number }[] {
  const out: { word: string; cost: number }[] = [];
  if (index.wordToCores.has(word)) out.push({ word, cost: 0 });
  const limit = maxWordDistance(word);
  if (!limit) return out;
  // Only compare words of a length that could possibly be that close.
  for (let len = word.length - limit; len <= word.length + limit; len++) {
    const bucket = index.wordsByLength.get(len);
    if (!bucket) continue;
    for (const cand of bucket) {
      if (cand === word) continue;
      const d = editDistance(word, cand);
      if (d > 0 && d <= limit) out.push({ word: cand, cost: d });
    }
  }
  out.sort((a, b) => a.cost - b.cost);
  return out;
}

/**
 * Match one spoken dish against the catalogue.
 *
 * Returns the best match plus alternatives, and never throws: an
 * unrecognised dish is a normal outcome, not an error.
 *
 * @param preferredIds  ids of the app's curated recipes. They win ties
 *                      against scraped ones, which contain near-duplicate
 *                      noise and occasional rubbish.
 */
export function matchDish(
  heard: string,
  catalogue: Recipe[],
  preferredIds?: Set<string>,
): DishResolution {
  const raw = (heard || '').trim();
  const key = normalizeDish(raw);
  if (!key || !catalogue.length) {
    return { heard: raw, best: null, alternatives: [] };
  }

  const index = indexFor(catalogue);
  const heardWords = key.split(' ');

  // 1. The whole phrase is a core.
  const exactCores: number[] = [];
  index.cores.forEach((c, i) => {
    if (normalizeDish(c.core) === key) exactCores.push(i);
  });
  if (exactCores.length) {
    const ranked = exactCores
      .map((i) => index.cores[i])
      // Curated recipes first, then the shortest core, then the shortest
      // full name: the built-in "Masala dosa" should win over the generated
      // "Masala Dosa Recipe - Spiced Lentil Crepe" for the same core.
      .sort((a, b) => {
        const pa = preferredIds?.has(a.recipe.id) ? 0 : 1;
        const pb = preferredIds?.has(b.recipe.id) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (
          a.words.length - b.words.length ||
          a.recipe.name.length - b.recipe.name.length ||
          a.core.localeCompare(b.core)
        );
      });
    const toMatch = (c: Index['cores'][number], tier: MatchTier, score: number): DishMatch => ({
      recipe: c.recipe,
      name: c.core,
      score,
      tier,
    });
    return {
      heard: raw,
      best: toMatch(ranked[0], 'exact', 1),
      alternatives: ranked.slice(1, 5).map((c) => toMatch(c, 'exact', 0.95)),
    };
  }

  // 2 & 3. Look the spoken words up in the inverted index, near-misses
  // included, and see which cores they could be describing.
  //
  // A spoken word maps to the catalogue words it could have been: itself,
  // and for a near-miss like "idly" the words one or two edits away.
  // `expMap` records, for each catalogue word, which spoken word it came
  // from and what it cost.
  const expMap = new Map<string, { heardWord: string; cost: number }[]>();
  const candidateSet = new Set<number>();
  let anyNearMiss = false;

  for (const w of heardWords) {
    for (const opt of nearWords(w, index)) {
      if (opt.cost > 0) anyNearMiss = true;
      const postings = index.wordToCores.get(opt.word);
      if (!postings) continue;
      for (const ci of postings) candidateSet.add(ci);
      const list = expMap.get(opt.word);
      if (list) list.push({ heardWord: w, cost: opt.cost });
      else expMap.set(opt.word, [{ heardWord: w, cost: opt.cost }]);
    }
  }

  if (!candidateSet.size) {
    return { heard: raw, best: null, alternatives: [] };
  }

  const scored: DishMatch[] = [];
  candidateSet.forEach((ci) => {
    const c = index.cores[ci];

    // For each word in the candidate, how much did it cost to hear it?
    let explainedCore = 0;
    let edits = 0;
    const usedHeard = new Set<string>();
    for (const cw of c.words) {
      const opts = expMap.get(cw);
      if (!opts) continue;
      let best = Infinity;
      let bestWord = '';
      for (const o of opts) {
        if (o.cost < best || (o.cost === best && o.heardWord < bestWord)) {
          best = o.cost;
          bestWord = o.heardWord;
        }
      }
      if (best === Infinity) continue;
      explainedCore += 1;
      edits += best;
      usedHeard.add(bestWord);
    }

    const coreCoverage = explainedCore / c.words.length;
    const heardCoverage = usedHeard.size / heardWords.length;

    // Neither side is a subset of the other: the words overlap only
    // partially in both directions. "chole bhatore" against "Chole Masala"
    // lands here and is rejected, which is right — there is no chole
    // bhature in the catalogue and guessing one would be worse than
    // admitting it was not understood.
    if (coreCoverage < 1 && heardCoverage < 1) return;

    const extra = c.words.length - heardWords.length;
    let score =
      0.5 * coreCoverage +
      0.5 * heardCoverage -
      edits * 0.12 -
      Math.max(0, extra) * 0.30 -
      Math.max(0, -extra) * 0.08;

    // A phrase made only of words too generic to identify a dish.
    if (heardWords.every((w) => GENERIC_WORDS.has(w))) score *= 0.7;

    if (preferredIds?.has(c.recipe.id)) score += PREFERRED_BONUS;

    score = Math.min(1, score);
    if (score <= 0) return;
    const tier: MatchTier = anyNearMiss ? 'near-word' : 'word';
    scored.push({ recipe: c.recipe, name: c.core, score, tier });
  });

  if (!scored.length) {
    return { heard: raw, best: null, alternatives: [] };
  }
  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length);

  // The catalogue holds near-duplicates — "Vada pav" and "Vada Pav" and
  // "Vada Pav" again from a second source. Showing the same dish three
  // times is noise, so alternatives are collapsed to one per core name.
  const seenCores = new Set<string>();
  const unique: DishMatch[] = [];
  for (const m of scored) {
    const key = normalizeDish(m.name);
    if (seenCores.has(key)) continue;
    seenCores.add(key);
    unique.push(m);
    if (unique.length >= 5) break;
  }

  return {
    heard: raw,
    best: unique[0],
    alternatives: unique.slice(1, 5),
  };
}

/**
 * Correct a whole spoken plan.
 *
 * Each slot is matched on its own. A slot is only rewritten when the match
 * is confident; otherwise the heard words are kept and the candidates are
 * offered, so the user can choose.
 */
export function resolveSpokenPlan<T extends object>(
  plan: T,
  catalogue: Recipe[],
  preferredIds?: Set<string>,
): {
  plan: T;
  resolutions: Record<string, DishResolution>;
} {
  const out: Record<string, string> = {};
  const resolutions: Record<string, DishResolution> = {};
  Object.entries(plan as Record<string, string | undefined>).forEach(
    ([slot, value]) => {
      const heard = (value || '').trim();
      if (!heard) return;
      const resolution = matchDish(heard, catalogue, preferredIds);
      resolutions[slot] = resolution;
      out[slot] =
        resolution.best && resolution.best.score >= CONFIDENT_SCORE
          ? resolution.best.name
          : heard;
    },
  );
  return { plan: { ...(plan as object), ...out } as T, resolutions };
}
