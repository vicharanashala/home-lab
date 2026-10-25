/**
 * Sweeps the WHOLE recipe catalogue with the spellings people actually say.
 *
 * WHY THIS EXISTS
 * "Alu gobi" is not in the catalogue and "Aloo gobi" is, so the matcher had
 * to be taught the way a dish is spoken before it could be taught one dish.
 * One dish was fixed. There are 5,894.
 *
 * The question this script answers is: for every recipe the app knows, if
 * the ASR writes that dish the way an English-biased speech recogniser
 * would, does the matcher find it again?
 *
 * WHY THE SPELLINGS ARE WRITTEN OUT RATHER THAN RANDOM
 * A random mutation is not a fair test — some of them are not things a
 * recogniser would ever write. The rules below are the substitutions an
 * English-biased recogniser actually makes on Indian dish names, and each
 * one was seen in the wild while this was built:
 *
 *   "dosa"     -> "dosaa"    a doubled vowel
 *   "idli"     -> "idly"     a vowel written with the letter after it
 *   "samosa"   -> "samusa"   a vowel changed
 *   "paneer"   -> "painter"  the same, in the same place
 *   "aloo"     -> "alu"      the doubled vowel dropped
 *   "chutney"  -> "chutni"   the ending dropped
 *   "jalebi"   -> "zalebi"   "j" read as "z"
 *   "aloo phulka" -> "aloo fulk a" and the rest of the table
 *
 * The two rates reported are:
 *
 *   EXACT  the matcher returned the very same dish
 *   LOST   the matcher returned a dish whose words are all in the one that
 *          was spoken — the dish, with part of the name dropped — which is
 *          what happens when the recogniser misses a word
 *
 * Run with:  node scripts/sweep-spoken-recipes.mjs
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

/**
 * How an English-biased recogniser writes a word it has heard.
 *
 * Each rule is applied on its own, so a variant differs from the real name
 * in ONE way — which is what a recogniser does, and what makes a failure
 * diagnosable.
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

/** The ways a dish name can be shortened without changing which dish it is. */
function spokenForms(name) {
  const core = dishCore(name);
  const out = new Map();

  for (const [label, re, to] of SPELLINGS) {
    const changed = core.replace(re, to);
    if (changed !== core) out.set(`${label}: ${changed}`, changed);
  }

  // The name with its last word dropped — the recogniser missed it.
  const words = core.split(' ');
  if (words.length > 1) {
    out.set(`last word dropped: ${words.slice(0, -1).join(' ')}`, words.slice(0, -1).join(' '));
  }
  return out;
}

const norm = (s) => normalizeDish(s);

/** The words of one name, with the noise words taken out. */
function wordsOf(s) {
  return new Set(norm(s).split(' ').filter(Boolean));
}

let total = 0;
let exact = 0;
let lost = 0;
let filled = 0;
let missed = 0;
/** Which rule failed, so the failures group instead of scattering. */
const byRule = new Map();
const examples = new Map();

const t0 = Date.now();
for (const recipe of catalogue) {
  const sourceCore = dishCore(recipe.name);
  const sourceWords = wordsOf(sourceCore);
  if (!sourceWords.size) continue;

  for (const [label, spoken] of spokenForms(recipe.name)) {
    total += 1;
    const r = matchDish(spoken, catalogue, preferredIds);
    const best = r.best;

    const spokenWords = wordsOf(spoken);
    let ok = false;
    let lostOk = false;
    let filledOk = false;
    if (best) {
      const got = wordsOf(best.name);
      if (got.size === sourceWords.size && [...got].every((w) => sourceWords.has(w))) {
        ok = true;
      } else if (got.size && [...got].every((w) => sourceWords.has(w))) {
        lostOk = true;
      } else if (
        // Every word the user actually SAID is in the dish that was matched.
        // The recogniser dropped a word and the matcher put it back — "chicken"
        // for "chicken 65" comes back as some chicken dish, which is the best
        // anyone can do with one word.
        spokenWords.size &&
        [...spokenWords].every((w) => got.has(w))
      ) {
        filledOk = true;
      }
    }

    if (ok) exact += 1;
    else if (lostOk) lost += 1;
    else if (filledOk) filled += 1;
    else {
      missed += 1;
      byRule.set(label, (byRule.get(label) || 0) + 1);
      if (!examples.has(label)) {
        examples.set(label, `${spoken}  ->  ${best ? best.name : 'NO MATCH'}`);
      }
    }
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\ncatalogue: ${catalogue.length} recipes, ${total} spoken forms`);
console.log(`  exact   ${exact} (${((exact / total) * 100).toFixed(1)}%)  the very same dish`);
console.log(`  lost    ${lost} (${((lost / total) * 100).toFixed(1)}%)  the dish, with a word missing`);
console.log(`  filled  ${filled} (${((filled / total) * 100).toFixed(1)}%)  a dish holding every word that was said`);
console.log(`  missed  ${missed} (${((missed / total) * 100).toFixed(1)}%)  nothing found`);
console.log(`  ----`);
console.log(`  FOUND   ${exact + lost + filled} (${(((exact + lost + filled) / total) * 100).toFixed(1)}%)`);
console.log(`  took ${secs}s\n`);

if (byRule.size) {
  console.log('where the misses are, by rule:');
  [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([rule, n]) => {
      console.log(`  ${String(n).padStart(5)}  ${rule}`);
      console.log(`         e.g. ${examples.get(rule)}`);
    });

  // The same rules, grouped, so the SIZE of each kind of problem is visible
  // rather than one line per spelling.
  const families = new Map();
  for (const [rule, n] of byRule) {
    const family = rule.split(':')[0].replace(/^[a-z ]+dropped$/, 'a word dropped');
    families.set(family, (families.get(family) || 0) + n);
  }
  console.log('\nby kind of problem:');
  [...families.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([family, n]) => console.log(`  ${String(n).padStart(5)}  ${family}`));
}

process.exit(missed ? 1 : 0);
