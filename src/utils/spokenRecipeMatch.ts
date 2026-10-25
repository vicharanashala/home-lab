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
  /**
   * True when the USER picked this dish, rather than the matcher choosing it.
   *
   * A dish the user tapped is linked to its recipe even when the matcher's
   * score for it was low: the user has already said which dish they meant.
   * A low score only ever meant the matcher was unsure — never that the
   * choice was wrong.
   */
  picked?: boolean;
}

/**
 * A match at or above this score is applied on its own. Below it the heard
 * words are kept, because a meal plan holding the wrong dish is worse than
 * one holding a rough name the user can see and fix.
 */
export const CONFIDENT_SCORE = 0.75;

/**
 * The highest score a coincidence is allowed to reach.
 *
 * A single spoken word that needs two or more edits to become a catalogue
 * word is not a mis-hearing — it is a coincidence. "bhatura" is two edits
 * from "khatua" and one from "bhature"; "painter" is two from "paneer".
 * One edit is what Whisper actually produces ("idly" for "idli", "samusa"
 * for "samosa"), so one edit still applies. Two or more is offered as a
 * suggestion the user can tap, but never written into the plan on its own —
 * a wrong dish poisons the taste model and the taste-match score forever,
 * which is worse than a rough name the user can see and fix.
 *
 * 0.3 is deliberately below the weakest genuine candidate for a one-word
 * phrase (a two-word core that explains one of its words scores about 0.33),
 * so a coincidence never outranks a real near-miss.
 */
const COINCIDENCE_SCORE = 0.3;

/**
 * How much a curated recipe is preferred over a scraped one.
 *
 * The CSV catalogue is a bulk scrape and it contains junk: "Spinach Wada
 * Recipe (Spinach & Women's Gram Printers)" is a template with a printing
 * error in it, and it matches the word "wada" exactly, so it beat the
 * curated "Medu vada" for a bare "wada". The app's own 127 recipes are the
 * ones it supports properly, so they are preferred when the alternatives
 * are otherwise close.
 *
 * WHY IT IS A TIE-BREAK AND NOT A BONUS ADDED TO THE SCORE: the two kinds of
 * recipe are not the same shape. The curated ones have SHORT names and the
 * scraped ones have long ones — "Paneer butter masala" against "Paneer
 * Butter Masala Biryani" — so a bonus worth more than the difference between
 * a candidate that explains all of what was said and one that explains less
 * of it lets the curated recipe win by being SHORTER.
 *
 *   "paneer butter masala biryaani" -> "Paneer butter masala"
 *     (the catalogue holds "Paneer Butter Masala Biryani"; the curated
 *      recipe won and the "biryaani" was dropped)
 *
 * A dropped word is a wrong dish, and a wrong dish poisons the taste model
 * forever. So the preference decides between candidates that explain the
 * SAME thing and nothing else — see the sort in `matchDish`.
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
 * Whether two names are the same dish.
 *
 * WHY THIS IS A SHARED ANSWER: the sheet and the entry writer both have to
 * decide "is this still the dish the user is looking at", and they must not
 * disagree — one screen linking a recipe the other calls a different dish
 * is how a shopping list ends up buying dosa batter for a paneer tikka.
 *
 * The comparison is on the CORE of each name, so "Masala Dosa" and
 * "Masala Dosa Recipe - Spiced Lentil Crepe" are one dish, and "masala dosa"
 * typed in lower case is the same dish as the catalogue's "Masala dosa".
 */
export function sameDish(a: string, b: string): boolean {
  return normalizeDish(dishCore(a)) === normalizeDish(dishCore(b));
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

/**
 * How many characters a word may be off and still count as the same word.
 *
 * A SHORT word on its own is held to a strict rule, because there is
 * nothing to disambiguate it: a bare "dal" could be any of hundreds of
 * dishes, and loosening it made "pea" match "Peda".
 *
 * In a PHRASE the other words pin the dish down, so a short word may be
 * looser. "alu gobi" has to become "Aloo gobi", and "alu" is two edits
 * from "aloo" — a letter changed AND a letter added — because that is how
 * the dish is pronounced and how people say it.
 */
function maxWordDistance(word: string, loose: boolean): number {
  if (loose) return 2;
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
function nearWords(
  word: string,
  index: Index,
  loose: boolean,
): { word: string; cost: number }[] {
  const out: { word: string; cost: number }[] = [];
  if (index.wordToCores.has(word)) out.push({ word, cost: 0 });
  const strict = maxWordDistance(word, false);
  const limit = maxWordDistance(word, loose);

  // Only compare words of a length that could possibly be that close.
  //
  // NOTE: this loop is skipped for a short word that is allowed no edits at
  // all, and the rules BELOW it are the ones that still have to run for such
  // a word — "nan" for "naan" and "alu" for "aloo" are not edit distances at
  // all, they are spellings.
  for (let len = word.length - limit; len <= word.length + limit; len++) {
    const bucket = index.wordsByLength.get(len);
    if (!bucket) continue;
    for (const cand of bucket) {
      if (cand === word) continue;
      const d = editDistance(word, cand);
      if (d > 0 && d <= strict) {
        out.push({ word: cand, cost: d });
        continue;
      }
      // Beyond the strict distance, and only in a phrase, a word may still
      // match — but only if it keeps its CONSONANTS. "alu" and "aloo" share
      // the consonant "l" and differ only in how the vowel is spelled,
      // which is a spelling difference and not a different word.
      //
      // Without this the looseness reached for "no" too: "no" is two edits
      // from "tok", so "no dal" matched "Tok Dal", the refusal word was read
      // as the start of a dish name, and the refusal was never recognised.
      // A refusal that is not recognised is a refusal that gets bought.
      if (!loose || d > limit) continue;
      if (!sameSounds(word, cand)) continue;
      out.push({ word: cand, cost: d });
      continue;
    }
  }

  // A WORD THE RECOGNISER CUT SHORT.
  //
  // "nan" for "naan", "rab" for "rabri", "cof" for "coffee". A truncation is
  // a spelling difference and not a different word, and it is not caught by
  // the edit distance at all: "nan" and "naan" are one edit apart, but a
  // three-letter word on its own is only allowed an exact match, because
  // nothing disambiguates it.
  //
  // The rule is its own thing rather than a looser distance, because it is
  // SAFE in a way that a looser distance is not: a prefix keeps the whole
  // of the shorter word, so the consonants are all still there. It is what
  // stops a bare "dal" from matching "dalia" and "dal jeera" — no, it does
  // not, and that is why the length difference is capped at three letters
  // and the word has to be at least three letters long.
  for (const cand of index.words) {
    if (cand === word) continue;
    const shorter = word.length <= cand.length ? word : cand;
    const longer = word.length <= cand.length ? cand : word;
    const diff = longer.length - shorter.length;
    if (diff < 1 || diff > 3) continue;
    if (shorter.length < 3) continue;
    if (!longer.startsWith(shorter)) continue;
    if (!sameSounds(word, cand)) continue;
    out.push({ word: cand, cost: diff });
  }

  // A SHORT spoken word that is a longer catalogue word with one vowel
  // added. "nan" for "naan", "alu" for "aloo".
  //
  // A short word on its own is allowed no edits at all, because nothing
  // disambiguates it — a bare "dal" could be any of hundreds of dishes.
  // But a VOWEL appearing is not the word changing, it is the word being
  // spelled the other way, and this is the one case where the shorter
  // spelling is the spoken one.
  if (word.length <= 3) {
    for (const cand of index.words) {
      if (cand === word) continue;
      if (cand.length !== word.length + 1) continue;
      if (!isVowelAdded(word, cand)) continue;
      if (!sameSounds(word, cand)) continue;
      out.push({ word: cand, cost: 1 });
    }
  }

  // The doubled-vowel spelling, compared with the doubling taken out of
  // both sides. "aalu" for "aloo".
  // WHY ONE OF THE TWO HAS TO SPELL A DOUBLED VOWEL: the rule takes a
  // repeated LETTER out of both sides, and a repeated CONSONANT is not a
  // vowel spelled two ways — it is a different word. "puddin" repeats a "d"
  // and "pudina" does not, so with the doubling taken out of both they are
  // one edit apart, and they keep the same consonants ("pdn" either way).
  // That was enough for "rice puddin" to be matched to "Pudina Rice" — mint
  // rice, not pudding — and the wrong dish was written into the meal plan
  // at full confidence. "musalla" and "masala" are the same story.
  //
  // A wrong dish is worse than a missing one, so the rule fires only for
  // the case it was written for: one of the two words spells a doubled
  // VOWEL, which is how "aalu" and "aloo" are the same word.
  if (loose) {
    const wordHasDoubledVowel = hasDoubledVowel(word);
    for (const cand of index.words) {
      if (cand === word) continue;
      if (!wordHasDoubledVowel && !hasDoubledVowel(cand)) continue;
      // WHY THE COST IS CAPPED AT ONE: the rule is about a VOWEL appearing
      // or disappearing, and one vowel is the whole of it. "aalu" and "aloo"
      // are one apart with the doubling taken out, and so are "aloo" and
      // "alu". Two apart is a different thing — "paal" (milk) and "poli" (a
      // rice cake) are two apart with the doubling taken out, and matching
      // them put the wrong dish in the meal plan at full confidence.
      const du = editDistance(undouble(word), undouble(cand));
      if (du < 0 || du > 1) continue;
      if (!sameSounds(undouble(word), undouble(cand))) continue;
      out.push({ word: cand, cost: du });
    }
  }
  out.sort((a, b) => a.cost - b.cost);
  return out;
}

/**
 * The consonants of a word — the part that carries its identity.
 *
 * A loose match has to keep them. "alu" and "aloo" share the consonant "l"
 * and differ only in how the vowel is spelled, which is a spelling
 * difference and not a different word.
 */
function skeleton(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, '');
}

/** True when every character of `small` appears in `big`, in order. */
function isSubsequence(small: string, big: string): boolean {
  let i = 0;
  for (let j = 0; j < big.length && i < small.length; j++) {
    if (small[i] === big[j]) i++;
  }
  return i === small.length;
}

/** The first consonant of a word, or '' when it has none. */
function firstConsonant(word: string): string {
  const m = word.toLowerCase().match(/[bcdfghjklmnpqrstvwxyz]/);
  return m ? m[0] : '';
}

/**
 * True when two words share the same consonants, give or take one that was
 * added or dropped.
 *
 * THE WORD MUST START WITH THE SAME CONSONANT. That is what separates the
 * spellings from the different words:
 *
 *   "painter" and "paneer"  p…  the recogniser heard a "t" that is not in
 *                            the word — the same dish
 *   "alu" and "aloo"        l…  a vowel spelled two ways — the same dish
 *   "alu" and "dal"         l…d  a different consonant at the front — a
 *                            DIFFERENT dish, and "Alu Bukhara" was matched to
 *                            "Dal Bukhara" because of it
 *
 * What it must NOT allow is a different consonant altogether: "no" and "tok"
 * share nothing, and that is a refusal word, not a spelling.
 */
function sameSounds(a: string, b: string): boolean {
  const ca = firstConsonant(a);
  const cb = firstConsonant(b);
  if (ca && cb && ca !== cb) return false;
  const sa = skeleton(a);
  const sb = skeleton(b);
  if (!sa.length || !sb.length) return false;
  return sa === sb || isSubsequence(sa, sb) || isSubsequence(sb, sa);
}

/**
 * A word with any repeated letter collapsed.
 *
 * Indian English doubles and undoubles vowels freely: "aalu" and "aloo"
 * are the same word, and so are "gobhi" and "gobi". On their own "aalu" is
 * three edits from "aloo" — too far to be a near-miss — but once the
 * doubling is taken out of both it is one.
 *
 * WHY THIS IS NOT ENOUGH ON ITS OWN: the doubling it takes out is not
 * always a vowel. "puddin" repeats a "d", and taking that out makes
 * "puddin" and "pudina" one edit apart — two different dishes. So the
 * caller asks `hasDoubledVowel` first, and only compares words that
 * actually spell a doubled vowel.
 */
function undouble(word: string): string {
  let out = '';
  for (const ch of word) if (out[out.length - 1] !== ch) out += ch;
  return out;
}

/**
 * Whether a word spells a doubled vowel — "aloo" does, "pudina" does not.
 *
 * WHY THIS IS ITS OWN QUESTION: "puddin" repeats a "d" and "pudina" does
 * not, so the two are one edit apart once the doubling is taken out of
 * both, and they keep the same consonants — "pdn" either way. Without this
 * question the near-miss rule matched two DIFFERENT dishes, and
 * "rice puddin" was written into the meal plan as "Pudina Rice".
 */
function hasDoubledVowel(word: string): boolean {
  return /([aeiou])\1/.test(word);
}

/**
 * True when the longer word is the shorter one with a single VOWEL added.
 *
 * "nan" for "naan", "alu" for "aloo", "puri" for "poori". Indian English
 * spells a long vowel two ways and the recogniser hears whichever one it
 * hears, so a vowel appearing or disappearing is a spelling difference and
 * not a different word.
 *
 * A CONSONANT appearing is a different thing: "dal" and "dhal" are the same
 * dish, but "dal" and "dhal" are also two different words to a catalogue
 * that lists both, so the consonant case is left to the ordinary distance
 * rules.
 */
function isVowelAdded(shorter: string, longer: string): boolean {
  if (longer.length !== shorter.length + 1) return false;
  let i = 0;
  let j = 0;
  let extra = '';
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    extra = longer[j];
    j++;
    if (i < shorter.length && shorter[i] === longer[j]) {
      // the vowel was inserted before this letter, not after it
      i++;
      j++;
      break;
    }
  }
  if (i < shorter.length) return false;
  if (!extra) {
    // the vowel was added at the end
    extra = longer[longer.length - 1];
  }
  return 'aeiou'.includes(extra);
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
    // A phrase has other words to pin the dish down, so a short word can be
    // matched more loosely than a word on its own.
    for (const opt of nearWords(w, index, heardWords.length > 1)) {
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

  // `base` is the score WITHOUT the curated bonus — and with every other
  // guard on it — and it is what the order is decided by. See the sort below.
  const scored: (DishMatch & { base: number; preferred: boolean })[] = [];
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

    // The curated preference is kept OUT of the score that decides the order.
    //
    // WHY: the score says how much of what the user said the candidate
    // explains, and the bonus does not say that — it says where the recipe
    // came from. Added to the score it could outrank a candidate that
    // explains MORE of what was said, and a word the user said would be
    // dropped in favour of a shorter dish. See `PREFERRED_BONUS`.
    //
    // The bonus still goes into the score that is REPORTED, so the confidence
    // bar and the sheet see the same number they saw before.
    const preferred = preferredIds?.has(c.recipe.id) === true;
    let base = score;
    if (preferred) score += PREFERRED_BONUS;

    score = Math.min(1, score);

    // A single spoken word that needs two edits to become a single-word
    // catalogue core is a coincidence, not a mis-hearing. "bhatura" is two
    // edits from "khatua" and one from "bhature", so without this the
    // matcher scores the mutton dish 0.76 and the fried bread 0.33 — and
    // silently writes "Khatua" into the plan where the user said "bhatura".
    // One edit is the realistic Whisper error ("idly" for "idli") and still
    // applies; two or more is offered as a suggestion, never applied. The
    // cap goes on AFTER the curated bonus, so no bonus can lift a
    // coincidence back over the confidence bar.
    if (heardWords.length === 1 && c.words.length === 1 && edits >= 2) {
      score = Math.min(score, COINCIDENCE_SCORE);
      // The cap has to be on `base` as well, because `base` is what the
      // ORDER is decided by. Without this the order ignored the guard
      // altogether: "bhatura" was offered "Khatua" — two edits, capped at
      // 0.30 — ABOVE "Chole bhature", which is one edit away and scores
      // 0.48. The coincidence outranked the real near-miss, which is the
      // one thing this cap exists to prevent, and the sheet leads with the
      // first chip, so the wrong dish was the one the user was asked for
      // first.
      base = Math.min(base, COINCIDENCE_SCORE);
    }

    if (score <= 0) return;
    const tier: MatchTier = anyNearMiss ? 'near-word' : 'word';
    scored.push({ recipe: c.recipe, name: c.core, score, tier, base, preferred });
  });

  if (!scored.length) {
    return { heard: raw, best: null, alternatives: [] };
  }
  // The order is decided by how much of what the user said each candidate
  // explains, and only then by where the recipe came from.
  //
  // WHY THE CURATED PREFERENCE IS A TIE-BREAK: two candidates that explain
  // the SAME thing are a tie, and the curated recipe is the one to keep — the
  // scrape holds near-duplicates and rubbish. Two candidates that explain
  // DIFFERENT amounts are not a tie, and the one that explains more is the
  // one the user meant.
  scored.sort(
    (a, b) =>
      b.base - a.base ||
      Number(b.preferred) - Number(a.preferred) ||
      a.name.length - b.name.length,
  );

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
 * Whether a phrase IS the name of a dish the catalogue holds.
 *
 * WHY THIS IS NOT THE SAME QUESTION AS "DOES IT MATCH A DISH": the parser
 * asks whether a refusal word inside a phrase is part of a dish's own NAME,
 * and that is a question about the phrase BEING the name — not about the
 * phrase being CLOSE to one. The two answers are not the same, and taking the
 * looser one here loses refusals:
 *
 *   "rice, no dal"
 *     matches "Dal-rice" at 0.753 — a near-word match, one word away from a
 *     real one — so a rule that accepts any match over the confidence bar
 *     says "this is a dish the app knows". The parser then takes the refusal
 *     word to be part of that dish's own name, and the refusal of the dal is
 *     swallowed: the plan holds "rice no dal" (a name that matches no
 *     recipe, so the shopping list buys nothing for it) and NO refusal is
 *     raised at all — so the dal the user had refused stayed on the plan,
 *     where the shopping list buys it.
 *
 * So the rule here is the exact one: the WHOLE phrase has to be a catalogue
 * core. "no onion no garlic lobia masala" is a dish; "rice, no dal" is not.
 *
 * WHY IT IS A NAMED RULE AND NOT A LINE IN THE COMPONENT: the app and the
 * test that proves this have to hand the parser the SAME answer, or the test
 * proves a rule the app does not use.
 *
 * @param phrase    the phrase to ask about
 * @param catalogue the recipes the app knows
 */
export function isDishName(phrase: string, catalogue: Recipe[]): boolean {
  const match = matchDish(phrase, catalogue);
  return !!match.best && match.best.tier === 'exact';
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

/**
 * The resolution for a slot the user has typed over.
 *
 * WHY THE TEXT IS MATCHED AGAIN: the dish the slot holds is now the typed
 * text, not what was heard. A correction that names a real recipe links to
 * it; one that names nothing stays unlinked rather than being guessed at.
 *
 * The heard text becomes the typed text, because that is the text this
 * resolution was worked out from — the sheet shows it back to the user as
 * "heard … → matched …".
 */
export function retypeDish(
  text: string,
  catalogue: Recipe[],
  preferredIds?: Set<string>,
): DishResolution {
  const typed = (text || '').trim();
  if (!typed) return { heard: '', best: null, alternatives: [] };
  return matchDish(typed, catalogue, preferredIds);
}

/**
 * The resolution for a slot where the user tapped one of the alternatives.
 *
 * The dish the user tapped becomes the match, and the one that was there
 * before becomes an alternative — so the user can change their mind without
 * the sheet losing what was on offer.
 *
 * The heard text is kept: it is still what was said, and the sheet tells the
 * user what they said and what it was taken to mean.
 */
export function pickDish(
  resolution: DishResolution,
  match: DishMatch,
): DishResolution {
  const alternatives = [resolution.best, ...resolution.alternatives].filter(
    (m): m is DishMatch => !!m && m.recipe.id !== match.recipe.id,
  );
  return {
    heard: resolution.heard,
    best: match,
    alternatives,
    picked: true,
  };
}

/** What a slot holds, and whether that dish is linked to a recipe. */
export interface DishDecision {
  /**
   * The resolution still describes the dish in the slot.
   *
   * False when the slot was changed without the resolution being re-matched —
   * the two then talk about different dishes, and the slot wins.
   */
  settled: boolean;
  /**
   * The slot's dish IS linked to a recipe: either the matcher was confident,
   * or the user chose the dish themselves.
   */
  matched: boolean;
  /** The recipe to write onto the entry, or null when the dish links none. */
  recipe: Recipe | null;
}

/**
 * The ONE answer to "what does this slot hold, and is it linked to a recipe?".
 *
 * WHY THIS IS ASKED IN ONE PLACE: the sheet tells the user what is about to
 * happen and the writer decides what actually happens, so the two have to say
 * the same thing. They used to ask it separately — the sheet asked "is the
 * match confident?", the writer asked "is the match confident OR did the
 * user pick it?" — and on a dish the user CHOSE, they answered differently.
 *
 * So a user who said "bhatura", was offered "Chole bhature / Khatua /
 * Paneer Bhutuwa" and tapped "Khatua" was told "did you mean" and asked to
 * choose again, while the plan quietly wrote "Khatua" and linked the khatua
 * recipe the shopping list would buy from. The choice had been made and the
 * screen was still asking the question.
 *
 * One function, one answer: what the sheet says is what the writer writes.
 */
export function decideDish(
  resolution: DishResolution | undefined,
  name: string,
): DishDecision {
  const best = resolution?.best ?? null;
  if (!resolution || !best) {
    return { settled: false, matched: false, recipe: null };
  }

  // The resolution still describes this dish when it was worked out from
  // exactly this text, when the slot holds the name the match was written
  // under, or when the two are the same dish under different names.
  const settled =
    resolution.heard === name ||
    best.name === name ||
    sameDish(best.name, name);
  if (!settled) {
    return { settled: false, matched: false, recipe: null };
  }

  // A dish the USER picked is taken at their word, even when the matcher
  // scored it low: they have already said which dish they meant, and a low
  // score only ever meant the matcher was unsure — never that they were
  // wrong. The sheet has to honour that too, or it asks a question the user
  // has already answered.
  const matched = resolution.picked === true || best.score >= CONFIDENT_SCORE;
  return { settled: true, matched, recipe: matched ? best.recipe : null };
}
