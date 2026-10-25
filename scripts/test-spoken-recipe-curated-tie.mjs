/**
 * Regression tests for the curated recipe's BONUS being a tie-break.
 *
 * WHY THIS IS ITS OWN FILE: the app's own recipes are preferred over the
 * scraped ones, and the preference was a flat 0.15 added to the score. The
 * comment on the bonus says the curated recipes are "preferred when the
 * alternatives are otherwise close" — but 0.15 is a lot more than the
 * difference between a candidate that explains all of what the user said and
 * one that explains less of it, so the bonus stopped being a tie-break and
 * became an override.
 *
 * WHAT THAT LOOKED LIKE: the curated recipes have SHORT names and the scraped
 * ones have long ones, so the curated recipe won by being shorter — it
 * explained less of what the user said, and that was worth more than the
 * words it dropped.
 *
 *   "gonguraa chicken curry"        -> "Chicken curry"
 *     (the catalogue holds "Gongura Chicken Curry"; the curated
 *      "Chicken curry" won and the "gonguraa" was dropped)
 *   "paneer butter masala biryaani" -> "Paneer butter masala"
 *     (the catalogue holds "Paneer Butter Masala Biryani"; the curated
 *      "Paneer butter masala" won and the "biryaani" was dropped)
 *   "nootty aloo paratha"            -> "Aloo paratha"
 *     (the catalogue holds "Nutty Aloo Paratha")
 *
 * A dropped word is a wrong dish. A wrong dish in a slot poisons the taste
 * model forever, and the shopping list buys what the plan holds — so this is
 * not a small thing.
 *
 * WHAT THE RULE IS NOW: the curated recipe wins a TIE and loses to a
 * candidate that explains more of what the user said. The score still carries
 * the bonus, so a curated recipe is still preferred when two candidates
 * explain the same thing.
 *
 * Run with:  node scripts/test-spoken-recipe-curated-tie.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INDIAN_RECIPES } from '../src/data/indianRecipes.ts';
import {
  matchDish, dishCore, normalizeDish, CONFIDENT_SCORE,
} from '../src/utils/spokenRecipeMatch.ts';

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);

const catalogue = [...INDIAN_RECIPES, ...csvRecipes];
const preferredIds = new Set(INDIAN_RECIPES.map((r) => r.id));

let passed = 0;
let failed = 0;

function ok(cond, label, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

/** The core of a recipe's own name, the way the app writes it down. */
const core = (name) => normalizeDish(dishCore(name));

/**
 * How people spell a vowel when they say it, and how it is written.
 *
 * Indian English doubles and undoubles vowels freely: "aalu" and "aloo" are
 * the same word, and so are "gobhi" and "gobi".
 */
const VOWEL_SPELLINGS = [
  ['oo', 'u'], ['oo', 'uu'], ['ee', 'i'], ['aa', 'a'], ['a', 'aa'],
  ['i', 'ee'], ['u', 'oo'], ['o', 'oo'],
];

/** The same dish, spelled the way a person says it. */
function saidDifferently(coreText) {
  const words = coreText.split(' ');
  const out = [];
  for (let i = 0; i < words.length; i++) {
    for (const [from, to] of VOWEL_SPELLINGS) {
      const at = words[i].indexOf(from);
      if (at < 0) continue;
      const rest = [...words];
      rest[i] = words[i].slice(0, at) + to + words[i].slice(at + from.length);
      out.push(rest.join(' '));
    }
  }
  return out;
}

console.log('\nthe dish that says more of what was said wins');
const curated = new Set(INDIAN_RECIPES.map((r) => core(r.name)));
const extended = [];
for (const recipe of csvRecipes) {
  const scraped = core(recipe.name);
  const words = scraped.split(' ');
  if (words.length < 2) continue;
  const head = words.slice(0, -1).join(' ');
  if (curated.has(head) && !curated.has(scraped)) {
    extended.push({ curated: head, scraped });
  }
}
ok(extended.length > 0, 'the catalogue really does hold scraped dishes that extend a curated one',
  `${extended.length} of them`);

for (const pair of extended) {
  // The extra word is said with a different vowel, so the phrase is one the
  // user could really have spoken and the scraped dish is the one it means.
  const extra = pair.scraped.split(' ').pop() || '';
  const said = extra.replace(/[aeiou]/, (v) =>
    v === 'a' ? 'e' : v === 'e' ? 'a' : v === 'i' ? 'e' : 'a');
  if (said === extra) continue;
  const spoken = `${pair.curated} ${said}`;
  const best = matchDish(spoken, catalogue, preferredIds).best;
  const got = best && best.score >= CONFIDENT_SCORE ? core(best.name) : '(not confident)';
  // The rule the bonus broke: the dish that drops a word the user said must
  // not win. WHICH dish wins is not claimed — "chana dal palao" is one edit
  // from both "chana dal pulao" and "palak chana dal", and a matcher that
  // says so is not wrong.
  const saidWords = spoken.split(' ').length;
  const gotWords = got === '(not confident)' ? 0 : got.split(' ').length;
  ok(gotWords >= saidWords, `"${spoken}" keeps every word it was given`,
    `matched "${got}"${best ? ` at ${best.score.toFixed(2)}` : ''}`);
}

console.log('\nacross the catalogue, a confident match keeps the words that were said');
// The rule the bonus broke, walked over the whole catalogue rather than the
// few dishes that happen to extend a curated one: a dish the user named must
// not be replaced by a SHORTER dish that drops a word they said. Every sample
// is a catalogue dish spelled the way a person says it.
const cores = new Map();
for (const recipe of catalogue) {
  const c = core(recipe.name);
  if (!c) continue;
  const words = c.split(' ');
  if (words.length < 2 || words.length > 4) continue;
  if (!cores.has(c)) cores.set(c, recipe.name);
}
const all = [...cores.keys()];
const stride = 60;
let sampled = 0;
let dropped = 0;
let confident = 0;
for (let i = 0; i < all.length; i += stride) {
  for (const spoken of saidDifferently(all[i])) {
    sampled += 1;
    const best = matchDish(spoken, catalogue, preferredIds).best;
    if (!best || best.score < CONFIDENT_SCORE) continue;
    confident += 1;
    const said = core(best.name).split(' ').length;
    const meant = all[i].split(' ').length;
    if (said < meant) {
      dropped += 1;
      if (dropped <= 5) {
        console.log(`       "${spoken}" -> "${best.name}" (${best.score.toFixed(2)}) — "${all[i]}" was meant`);
      }
    }
  }
}
ok(dropped === 0, 'no confident match drops a word the user said',
  `${confident} confident matches of ${sampled} spoken, ${dropped} dropped a word`);

console.log('\na curated recipe still wins a tie');
// The reason the bonus exists at all: the scrape holds near-duplicates and
// rubbish, and where two candidates explain the same thing the app's own
// recipe is the one to keep.
const tie = matchDish('masala dosa', catalogue, preferredIds).best;
ok(!!tie && preferredIds.has(tie.recipe.id),
  'a curated recipe is the one kept',
  tie ? `"${tie.name}" at ${tie.score.toFixed(2)}` : 'no match');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
