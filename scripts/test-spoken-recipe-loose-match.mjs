/**
 * Tests for the LOOSE near-miss rule in the spoken-recipe matcher.
 *
 * WHY THIS IS ITS OWN FILE: the loose rule is what lets a short word in a
 * phrase find its dish when the words are two edits apart ("alu" for "aloo"),
 * and the rule that came with it — the doubled-vowel spelling — reaches
 * further than the rule needs it to. A rule that reaches too far writes the
 * WRONG dish into the meal plan, and a wrong dish poisons the taste model
 * forever. So the reach of the rule is pinned here, on its own.
 *
 * Run with:  node scripts/test-spoken-recipe-loose-match.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INDIAN_RECIPES } from '../src/data/indianRecipes.ts';
import { matchDish, CONFIDENT_SCORE } from '../src/utils/spokenRecipeMatch.ts';

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

/** The dish the app would WRITE into the plan, and how sure it is. */
function best(heard) {
  const r = matchDish(heard, catalogue, preferredIds);
  return r.best
    ? { name: r.best.name, score: r.best.score, written: r.best.score >= CONFIDENT_SCORE }
    : { name: '', score: 0, written: false };
}

/** The dish has to be the right one, and it has to be sure of it. */
function matches(heard, expectWord) {
  const r = best(heard);
  const hit = r.name.toLowerCase().includes(expectWord.toLowerCase());
  ok(hit && r.written, `"${heard}" -> "${r.name || '(nothing)'}"`,
    `score ${r.score.toFixed(2)}${hit ? '' : ' (WRONG DISH)'}${r.written ? '' : ' (not confident, so not written)'}`);
}

console.log('\nthe doubled vowel is the same word spelled two ways');
// "Aloo" is the catalogue's spelling. "alu", "aalu" and "allu" are how it is
// said, and the rule that finds them takes the doubling out of both sides.
matches('alu gobi', 'aloo gobi');
matches('aalu gobi', 'aloo gobi');
matches('allu gobi', 'aloo gobi');
matches('aloo gobhi', 'aloo gobi');
matches('alu gobhi', 'aloo gobi');

console.log('\nbut a doubled CONSONANT is a different word, not a spelling');
// The rule takes a repeated LETTER out of both sides before comparing them.
// A repeated consonant is not a vowel spelled two ways, so taking it out
// makes two different dishes look like one.
//
// "puddin" repeats a "d" and "pudina" does not, so with the doubling taken
// out of both they are ONE EDIT apart, and both keep the consonants "pdn".
// That is enough for "rice puddin" to be matched to "Pudina Rice" — mint
// rice, not pudding — and the wrong dish is written into the plan at full
// confidence. "Rice Pudding" is the dish the user said.
matches('rice puddin', 'rice pudding');

// "musalla" repeats an "l" and "masala" does not. Same story: "murgh
// musalla" is murgh musallam, not murgh masala.
matches('murgh musalla', 'murgh musallam');

// "tikki" repeats a "k" and "tika" does not. The user said chicken tikka.
matches('chicken tika', 'chicken tikka');

console.log('\nand a word on its own is still held to the strict rule');
// A short word alone has nothing to disambiguate it, so it must not be
// loosened. "pea" is one edit from "peda" and is still not the same word.
const pea = best('pea');
ok(!pea.written, '"pea" is not written into the plan',
  pea.name ? `matched "${pea.name}" (${pea.score.toFixed(2)})` : 'no match');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
