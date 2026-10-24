/**
 * Tests for a time in the speech, which is not a dish.
 *
 * WHY THIS EXISTS
 * The parser takes the words that carry no dish information off the dish
 * the user said, and a time is one of them: "dinner at 8" is a dinner with
 * no dish in it, and the plan should leave the slot alone rather than hold
 * something that matches no recipe.
 *
 * The rule that finds a time needs the dots — "p.m." is a time and a bare
 * "p" is not — but the punctuation was stripped off the text BEFORE the rule
 * ran, so the rule never found the time and what was left of it stayed in
 * the dish:
 *
 *   "dinner at 8 pm."  -> the dinner was empty       (no dots, the rule found it)
 *   "dinner at 8 p.m." -> the dinner was "p m"      (dots, the rule missed it)
 *
 * A dish called "p m" matches no recipe in the catalogue, so the plan held a
 * dish nobody could shop for and the shopping list bought nothing for that
 * dinner. The user said WHEN, not WHAT.
 *
 * Run with:  node scripts/test-spoken-plan-time.mjs
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

console.log('\na time is not a dish, however it is written');
check('dinner at 8 pm.', {});
check('dinner at 8 p.m.', {});
check('dinner at 8 p.m', {});
check('dinner at 8:30 pm.', {});
check('breakfast at 7 a.m.', {});

console.log('\nand the dish beside the time is still the dish');
check('lunch rice at 8 pm.', { lunch: 'rice' });
check('lunch rice at 8 p.m.', { lunch: 'rice' });
check('dinner dal at 9 pm.', { dinner: 'dal' });

console.log('\na number that is not a time is left alone');
// A decimal is not a time: the rule must not swallow half of it.
check('lunch rice at 8.30', { lunch: 'rice 30' });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
