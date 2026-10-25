/**
 * Every recipe, in the way people actually say it.
 *
 * WHY THIS EXISTS
 * "Alu gobi" is not in the catalogue and "Aloo gobi" is, so the matcher had
 * to be taught the way a dish is spoken before it could be taught one dish.
 * One dish was fixed. There are 6,021.
 *
 * This test asks, of a slice of the whole catalogue: if the speech
 * recogniser writes that dish the way an English-biased recogniser would,
 * does the matcher find it again?
 *
 * WHY A SLICE AND NOT EVERYTHING: the matcher walks the whole catalogue on
 * every call, so a dish costs about seventeen milliseconds and the whole
 * catalogue costs a minute and a half — a minute and a half on every commit,
 * for every agent, to test a rule. The slice is taken evenly across the
 * catalogue, so it covers the same range of names as the whole thing does,
 * and it is the SAME slice every time, so the numbers it prints are
 * comparable and a failure is a real change rather than a sampling wobble.
 *
 * WHAT THE THREE NUMBERS MEAN
 *
 *   exact   the matcher returned the very same dish
 *   filled  a dish holding every word that was said — the recogniser dropped
 *           a word and the matcher put it back. "chicken" for "chicken 65"
 *           comes back as some chicken dish, which is the best anyone can do
 *           with one word.
 *   lost    the dish, with part of the name missing
 *
 * A wrong dish is worse than a missing one: it poisons the taste model and
 * the taste-match score forever. So the floor that matters is the FOUND
 * rate — a dish that holds everything the user said — and the EXACT rate is
 * held to a floor of its own.
 *
 * Run with:  node scripts/test-spoken-recipes-spoken-form.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { matchDish, dishCore, normalizeDish } = await import('../src/utils/spokenRecipeMatch.ts');

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);
const catalogue = [...INDIAN_RECIPES, ...csvRecipes];
const preferredIds = new Set(INDIAN_RECIPES.map((r) => r.id));

/** How many of the catalogue to look at. The same slice every time. */
const SAMPLE = 400;
/** The floors. Measured rates are far above these; they catch a regression. */
const FOUND_FLOOR = 0.97;
const EXACT_FLOOR = 0.9;

/**
 * How an English-biased recogniser writes a word it has heard.
 *
 * Each rule is applied on its own, so a variant differs from the real name
 * in ONE way — which is what a recogniser does, and what makes a failure
 * diagnosable. Every one of these was seen in the wild while this was
 * built: "dosaa", "idly", "samusa", "painter", "alu", "chutni", "zalebi".
 */
const SPELLINGS = [
  ['a doubled vowel', /([aeiou])\1/g, (m) => m[0]],
  ['ph read as f', /ph/g, 'f'],
  ['bh read as b', /bh/g, 'b'],
  ['sh read as s', /sh/g, 's'],
  ['th read as t', /th/g, 't'],
  ['ch read as chh', /ch/g, 'chh'],
  ['kh read as k', /kh/g, 'k'],
  ['gh read as g', /gh/g, 'g'],
  ['dh read as d', /dh/g, 'd'],
  ['j read as z', /j(?=[aeiou])/g, 'z'],
  ['w read as v', /w(?=a)/g, 'v'],
  ['ee read as i', /ee/g, 'i'],
  ['oo read as u', /oo/g, 'u'],
  ['aa read as a', /aa/g, 'a'],
  ['ai read as e', /ai/g, 'e'],
  ['the ending dropped', /y(?=$)/g, 'i'],
  ['the second vowel doubled', /([aeiou])(?=[aeiou])/g, '$1$1'],
];

function spokenForms(name) {
  const core = dishCore(name);
  const out = new Map();
  for (const [label, re, to] of SPELLINGS) {
    const changed = core.replace(re, to);
    if (changed !== core) out.set(`${label}: ${changed}`, changed);
  }
  const words = core.split(' ');
  if (words.length > 1) {
    out.set(`last word dropped: ${words.slice(0, -1).join(' ')}`, words.slice(0, -1).join(' '));
  }
  return out;
}

const wordsOf = (s) => new Set(normalizeDish(s).split(' ').filter(Boolean));

/** The slice: every Nth recipe, so the range of names is the same each run. */
const stride = Math.max(1, Math.floor(catalogue.length / SAMPLE));
const sample = catalogue.filter((_, i) => i % stride === 0).slice(0, SAMPLE);

let total = 0;
let exact = 0;
let filled = 0;
let lost = 0;
let missed = 0;
const misses = [];

for (const recipe of sample) {
  const sourceWords = wordsOf(dishCore(recipe.name));
  if (!sourceWords.size) continue;
  for (const [label, spoken] of spokenForms(recipe.name)) {
    total += 1;
    const best = matchDish(spoken, catalogue, preferredIds).best;
    if (!best) {
      missed += 1;
      misses.push(`${spoken} -> NO MATCH  (${label})`);
      continue;
    }
    const got = wordsOf(best.name);
    const sameSize = got.size === sourceWords.size;
    if (sameSize && [...got].every((w) => sourceWords.has(w))) {
      exact += 1;
    } else if ([...got].every((w) => sourceWords.has(w))) {
      lost += 1;
    } else if ([...wordsOf(spoken)].every((w) => got.has(w))) {
      filled += 1;
    } else {
      missed += 1;
      misses.push(`${spoken} -> ${best.name}  (${label})`);
    }
  }
}

const foundRate = (exact + filled + lost) / total;
const exactRate = exact / total;

console.log(`\nsample: ${sample.length} of ${catalogue.length} recipes, ${total} spoken forms`);
console.log(`  exact   ${exact} (${(exactRate * 100).toFixed(1)}%)  the very same dish`);
console.log(`  filled  ${filled} (${((filled / total) * 100).toFixed(1)}%)  a dish holding every word that was said`);
console.log(`  lost    ${lost} (${((lost / total) * 100).toFixed(1)}%)  the dish, with a word missing`);
console.log(`  missed  ${missed} (${((missed / total) * 100).toFixed(1)}%)  nothing found`);
console.log(`  FOUND   ${(foundRate * 100).toFixed(1)}%`);

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

console.log('\nthe floors');
ok(
  foundRate >= FOUND_FLOOR,
  `a dish is found for at least ${(FOUND_FLOOR * 100).toFixed(0)}% of the ways a dish is said`,
  `${(foundRate * 100).toFixed(1)}%`,
);
ok(
  exactRate >= EXACT_FLOOR,
  `the very same dish comes back for at least ${(EXACT_FLOOR * 100).toFixed(0)}%`,
  `${(exactRate * 100).toFixed(1)}%`,
);

console.log('\nthe dishes that were found by hand');
for (const [spoken, want] of [
  ['alu gobi', 'aloo gobi'],
  ['aalu gobi', 'aloo gobi'],
  ['aloo gobhi', 'aloo gobi'],
  ['masala dosaa', 'masala dosa'],
  ['idly', 'idli'],
  ['samusa', 'samosa'],
  ['painter tikka', 'paneer tikka'],
  ['chole bhatore', 'chole bhature'],
  ['nan', 'naan'],
  ['butter chicken', 'butter chicken'],
  ['dal makhani', 'dal makhani'],
]) {
  const best = matchDish(spoken, catalogue, preferredIds).best;
  ok(
    !!best && best.name.toLowerCase().includes(want.toLowerCase()),
    `"${spoken}"`,
    best ? `-> "${best.name}" (${best.score.toFixed(2)})` : 'NO MATCH',
  );
}

if (misses.length) {
  console.log('\nthe ones that were not found:');
  misses.slice(0, 20).forEach((m) => console.log('  ' + m));
  if (misses.length > 20) console.log(`  ... and ${misses.length - 20} more`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
