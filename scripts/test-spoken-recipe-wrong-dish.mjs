/**
 * A wrong dish is worse than no dish.
 *
 * WHY THIS EXISTS
 * The matcher was taught to be loose about spelling — "dosaa" for "dosa",
 * "idly" for "idli", "painter" for "paneer" — and the rule it used to decide
 * that two words are the same one turned out to be too generous. It let two
 * words share their consonants as long as one was a SUBSEQUENCE of the other,
 * and "palak" (p-l-k) is a subsequence of "pulao" (p-l). So "Palak Chana"
 * matched "Chana Pulao" at 0.76 — over the confidence bar, which means the
 * wrong dish was written straight into the meal plan, where it poisons the
 * taste model and the taste-match score for good.
 *
 * WHY THE WRONG DISH HAS TO BE NAMED AND NOT JUST "SOMETHING ELSE"
 * The matcher is allowed to find a NEARBY dish when the recogniser dropped a
 * word — "chicken" for "chicken 65" has to come back as some chicken dish.
 * So this file does not demand a perfect match. It demands that the dish
 * found is the dish that was meant, and names the one that must not be
 * chosen instead.
 *
 * WHY THE SECOND GROUP IS IN THE SAME FILE
 * The fix for a rule that is too generous is easy to overshoot: a matcher that
 * refuses everything is not safer, it is useless. So the cases the loose rule
 * was written FOR are checked here too. If the rule is tightened so far that
 * "painter tikka" stops finding "Paneer tikka", this file goes red.
 *
 * WHY THE CONFIDENCE BAND IS CHECKED
 * A wrong dish UNDER the bar is a suggestion the user can see and refuse. A
 * wrong dish OVER the bar is written into the meal plan without asking. So
 * for the first group the bar is the thing being protected — the right dish
 * is found, but it stays a suggestion rather than becoming the plan. For the
 * second group the opposite holds: those are matches the app is meant to
 * apply, and a rule that quietly stopped applying them would be a fault of
 * its own.
 *
 * Run with:  node scripts/test-spoken-recipe-wrong-dish.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { matchDish, CONFIDENT_SCORE } = await import('../src/utils/spokenRecipeMatch.ts');

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

/**
 * The dish the user meant has to be the dish that is found, and it has to
 * stay a suggestion rather than be applied without asking.
 *
 * @param heard    what the recogniser wrote
 * @param want     the words the right dish's name contains
 * @param notWant  the wrong dish's name, which must not be chosen
 */
function findsRightDish(heard, want, notWant) {
  const r = matchDish(heard, catalogue, preferredIds);
  if (!r.best) {
    ok(false, `"${heard}"`, 'no match at all');
    return;
  }
  const name = r.best.name;
  const isRight = name.toLowerCase().includes(want.toLowerCase());
  const isWrong = name === notWant;
  ok(
    isRight && !isWrong,
    `"${heard}" -> "${name}"`,
    `score ${r.best.score.toFixed(2)} tier ${r.best.tier}` +
      (isRight ? '' : ` (wanted "${want}")`) +
      (isWrong ? ' (the wrong dish)' : ''),
  );
  if (!isRight) return;
  ok(
    r.best.score < CONFIDENT_SCORE,
    `"${heard}" stays a suggestion`,
    `score ${r.best.score.toFixed(2)} is under the ${CONFIDENT_SCORE} bar`,
  );
}

/**
 * A spelling the matcher is meant to understand has to be understood, and
 * understood well enough to be applied.
 *
 * @param heard  what the recogniser wrote
 * @param want   the words the right dish's name contains
 */
function findsAndApplies(heard, want) {
  const r = matchDish(heard, catalogue, preferredIds);
  if (!r.best) {
    ok(false, `"${heard}"`, 'no match at all');
    return;
  }
  const name = r.best.name;
  const isRight = name.toLowerCase().includes(want.toLowerCase());
  ok(
    isRight,
    `"${heard}" -> "${name}"`,
    `score ${r.best.score.toFixed(2)} tier ${r.best.tier}` +
      (isRight ? '' : ` (wanted "${want}")`),
  );
  if (!isRight) return;
  ok(
    r.best.score >= CONFIDENT_SCORE,
    `"${heard}" is confident enough to apply`,
    `score ${r.best.score.toFixed(2)} over the ${CONFIDENT_SCORE} bar`,
  );
}

console.log('\nthe right dish, not a different one');
findsRightDish('Palak Chana', 'Palak Chana Dal', 'Chana Pulao');
findsRightDish('Palak Mushroom', 'Palak Mushroom Makhani', 'Mushroom pulao');
findsRightDish('Dum Murgh Kali', 'Dum Murgh Kali Mirch', 'Dum Ka Murgh');
findsRightDish('Chana Methi', 'Chana Methi Dal', 'Methi Chaman');
findsRightDish('Potato Bodi', 'Potato Bodi Fry', 'Potato Bonda');
findsRightDish('Chicken Keema', 'Chicken Keema Samosa', 'Chicken Korma');
findsRightDish('Marghi Na', 'Marghi Na Farcha', 'Naan');
findsRightDish('Mash Ki Dal', 'Mash Ki Dal Khasgai', 'Maa Ki Dal');
findsRightDish('Methi Matar', 'Methi Malai Matar', 'Mithi Mathri');

console.log('\nand the spellings the loose rule was written for still match');
findsAndApplies('painter tikka', 'Paneer tikka');
findsAndApplies('Rogan jos', 'Rogan josh');
findsAndApplies('Nan', 'Naan');
findsAndApplies('Fis curry', 'Fish curry');
findsAndApplies('Dal fri', 'Dal fry');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
