/**
 * Regression tests for how the spoken-plan parser handles a REFUSAL.
 *
 * WHY THIS EXISTS
 * The parser decides what goes into the meal plan, and a dish the user said
 * they did not want is worse than a missing one — the shopping list buys it.
 *
 * The rule that used to exist only looked for a refusal at the FRONT of a
 * dish, so it caught "no dal for dinner" and "lunch no dal" and missed
 * "no lunch dal", where the refusal sits in front of the MEAL WORD. That
 * miss was not harmless once the parser started keeping the LAST mention of
 * a meal: "lunch rice, no lunch dal" filed lunch as "dal" — the dish the
 * user had refused — and threw away the rice they had asked for.
 *
 * Run with:  node scripts/test-spoken-plan-refusal.mjs
 */
import { parseSpokenPlan } from '../src/utils/spokenPlan.ts';

let passed = 0;
let failed = 0;

function check(text, expected, note = '') {
  const got = parseSpokenPlan(text);
  const want = JSON.stringify(expected);
  const have = JSON.stringify(got);
  if (have === want) {
    passed += 1;
    console.log(`  ok   ${JSON.stringify(text)} -> ${have}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${JSON.stringify(text)} -> ${have}, expected ${want}${note ? ` (${note})` : ''}`);
  }
}

console.log('\nthe refusals that were already caught');
check('no dal for dinner', {});
check('not dal for dinner', {});
check('without dal for dinner', {});
check('skip dal for dinner', {});
check('avoid dal for dinner', {});
check('lunch no dal', {});
check('no lunch, dal for dinner', { dinner: 'dal' });
check('lunch rice, no salad for lunch', { lunch: 'rice' });

console.log('\na refusal in front of the MEAL WORD refuses the meal');
// "no lunch dal" is "no dal for lunch": the dal is not a lunch. The refusal
// sits between the "no" and the dish, which is the one place the old rule
// could not see it — and so the refused dal was written into the plan.
check('no lunch dal', {});
check('not lunch dal', {});
check('skip lunch dal', {});
check('without lunch dal', {});
check('avoid lunch dal', {});

console.log('\na refused dish never replaces the dish the user asked for');
// The regression: the parser keeps the LAST mention of a meal, so a refusal
// the old rule could not see became the winning mention. The rice the user
// actually said was gone and the dal they refused was in the plan.
check('lunch rice, no lunch dal', { lunch: 'rice' });
check('breakfast oats, no lunch dal', { breakfast: 'oats' });
check('lunch rice, dinner fish, no lunch dal', { lunch: 'rice', dinner: 'fish' });

console.log('\na refusal inside a stretch of speech splits it');
// "rice, no dal" is rice — the dal was refused, not eaten. Without the
// split the refusal was swallowed as part of the dish and the plan held
// "rice no dal", which matches no recipe in the catalogue.
check('lunch rice, no dal', { lunch: 'rice' });
check('lunch dal, no', { lunch: 'dal' });
check('breakfast oats, lunch rice, no dal', { breakfast: 'oats', lunch: 'rice' });

console.log('\na refusal belongs to the meal it is attached to');
// The comma is what says the refusal is about the meal before it and not
// the one after it, so the lunch keeps its dish.
check('no dal, lunch rice', { lunch: 'rice' });
check('no dal lunch rice', { lunch: 'rice' });
check('dinner fish, lunch rice', { dinner: 'fish', lunch: 'rice' });
check('breakfast oats, no lunch, dal for dinner', { breakfast: 'oats', dinner: 'dal' });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
