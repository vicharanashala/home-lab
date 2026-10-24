/**
 * Tests for a refusal that removes the dish the meal was about to hold.
 *
 * WHY THIS EXISTS
 * The parser decides what goes into the meal plan, and a dish the user said
 * they did not want is worse than a missing one — the shopping list buys it.
 *
 * The rules that existed caught a refusal that sat IN FRONT of a dish
 * ("no dal for dinner") and one that sat in front of the MEAL WORD ("no
 * lunch dal"). What they could not catch was a refusal that came AFTER the
 * dish it refuses, because by then the dish was already filed:
 *
 *   "dal for dinner, no dal"   -> the dinner was "dal" — the very dal the
 *                                  user had just refused, and the list bought it
 *   "breakfast rice, no rice"  -> the breakfast was "rice"
 *   "rice, no rice for breakfast" -> the breakfast was "rice"
 *   "lunch rice, no lunch rice" -> the lunch was "rice"
 *
 * Nothing anywhere said so: the sheet said the meal had been heard, and the
 * shopping list bought the dish.
 *
 * A refusal that names NO dish removes nothing, and that is not a gap: "lunch
 * dal, no" is the lunch dal, and the test that says so is right. A refusal
 * that names a dish — by name, or by pointing at it with "it" — takes it out.
 *
 * Run with:  node scripts/test-spoken-plan-refused-dish.mjs
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

console.log('\na refusal after the dish it refuses takes the dish out');
check('dal for dinner, no dal', {});
check('rice for breakfast, no rice', {});
check('breakfast rice, no rice', {});
check('lunch dal, no dal', {});
check('rice, no rice for breakfast', {});
check('dal, no dal for dinner', {});
check('rice no rice for breakfast', {});

console.log('\nand it takes out the meal when the dish is the only one');
check('lunch rice, no lunch rice', {});
check('breakfast dal, no breakfast dal', {});

console.log('\nthe pronoun points back at the dish');
check('for breakfast dal, no it', {});
check('breakfast dal, no it', {});
check('for lunch rice, no it', {});

console.log('\na refusal that names a DIFFERENT dish leaves the meal alone');
check('lunch rice, no lunch dal', { lunch: 'rice' });
check('rice, no dal for breakfast', { breakfast: 'rice' });
check('rice for breakfast, no dal', { breakfast: 'rice' });
check('breakfast oats, lunch rice, no dal', { breakfast: 'oats', lunch: 'rice' });

console.log('\na refusal that names NO dish removes nothing');
// "lunch dal, no" is the lunch dal: the "no" names nothing, so there is
// nothing to take out.
check('lunch dal, no', { lunch: 'dal' });
check('dal for dinner, no', { dinner: 'dal' });

console.log('\nand a change of mind is still a change of mind');
check('lunch biryani actually no, lunch salad', { lunch: 'salad' });
check('for breakfast masala dosa, for lunch butter chicken', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('for breakfast masala dosa, for lunch butter chicken, for dinner chole bhature', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
  dinner: 'chole bhature',
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
