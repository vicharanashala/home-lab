/**
 * Tests for a refusal that names a dish the plan is holding under different
 * words.
 *
 * WHY THIS EXISTS
 * The parser decides what goes into the meal plan, and a dish the user said
 * they did not want is worse than a missing one — the shopping list buys it.
 *
 * The refusal rules and the rule that files a dish did not use the SAME words
 * to work out what a dish is called:
 *
 *   - the dish a REFUSAL names has the words that carry no dish of their own
 *     taken off — "no want rice" names the rice, not the want
 *   - the dish the plan HOLDS keeps them — "lunch want rice" holds "want rice"
 *
 * So the two sides of the question "is this the dish the user refused?" could
 * never be equal, and a refusal that named the dish with the very words the
 * plan held did nothing:
 *
 *   "lunch want rice, no rice"   -> the lunch was still "want rice"
 *
 * The user said no to the rice, the refusal was ignored, the sheet said the
 * lunch had been heard, and the plan held a dish the user had refused. "lunch
 * want rice" is how people speak — "lunch, want rice" — so this is not a
 * rare shape.
 *
 * ONLY THE FILLERS ARE TAKEN OFF. A refusal that names a DIFFERENT dish has
 * to leave the plan alone — "lunch rice, no lunch dal" is the lunch rice —
 * and a dish that merely CONTAINS the named dish is a different question
 * altogether.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-filler-dish.mjs
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

console.log('\na refusal names the dish the plan holds, and the plan lets it go');
check('lunch want rice, no rice', {});
check('dinner want dal, no dal', {});
check('breakfast need upma, no upma', {});

console.log('\nand it does so even when the refusal uses the very same words');
// WHY THIS IS HERE: "lunch want rice, no rice" names the dish by the part of
// the name that carries the dish. "no want rice" says it with the whole of
// the name — the words the plan holds, word for word — and that one was
// ignored as well, because the two sides were worked out by different rules.
check('lunch want rice, no want rice', {});
check('lunch really good biryani, no really good biryani', {});

console.log('\nand the pronoun points back at it too');
check('breakfast really good biryani, no it', {});

console.log('\nbut a refusal that names a DIFFERENT dish leaves the plan alone');
check('lunch rice, no lunch dal', { lunch: 'rice' });
check('lunch rice, no dal', { lunch: 'rice' });
check('breakfast oats, lunch rice, no oats', { lunch: 'rice' });

console.log('\nand a refusal that names NO dish still removes nothing');
check('lunch dal, no', { lunch: 'dal' });
check('dal for dinner, no', { dinner: 'dal' });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
