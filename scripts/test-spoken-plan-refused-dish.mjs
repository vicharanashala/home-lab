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

console.log('\nand it points back even when the user keeps dictating');
// WHY THIS IS HERE: the pronoun was only read when the refusal came after the
// LAST meal word in the sentence. "for breakfast dal, no it" refused the dal,
// and "for breakfast dal, no it, for lunch rice" did not — the same words and
// the same intent, with only the next thing the user said different.
//
// The dal stayed in the plan, the sheet said the breakfast had been heard,
// and the shopping list bought the very dish the user had refused.
//
// The pronoun points at the dish in FRONT of it, so what follows it is a
// different meal and must not swallow the refusal.
check('for breakfast dal, no it, for lunch rice', { lunch: 'rice' });
check('breakfast dal, no it, lunch rice', { lunch: 'rice' });
check('for breakfast dal, do not want it, for lunch rice', { lunch: 'rice' });
check('breakfast oats, lunch rice, no it, dinner dal', {
  breakfast: 'oats',
  dinner: 'dal',
});

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

console.log('\nand it takes the dish out of the MEAL THAT HOLDS IT');
// WHY THESE ARE HERE: the refusal names a DISH, and the dish belongs to the
// meal that holds it. The refusal was bound to the meal whose word follows it
// — or to the meal it was said after — and that is not always the meal the
// dish was filed under.
//
//   "breakfast oats, lunch rice, no oats" -> the refusal is bound to the
//   lunch, but the oats are the BREAKFAST's dish.
//
// So the refusal named oats, the breakfast was holding oats, and the oats
// stayed in the plan: the shopping list bought the very dish the user had
// just refused, and nothing anywhere said so.
check('breakfast oats, lunch rice, no oats', { lunch: 'rice' });
check('dinner dal, lunch rice, no dal', { lunch: 'rice' });
check('breakfast oats, dinner dal, no oats', { dinner: 'dal' });
check('lunch dal, dinner rice, no dal', { dinner: 'rice' });
check('breakfast oats, lunch rice, no oats, dinner dal', {
  lunch: 'rice',
  dinner: 'dal',
});

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

console.log('\nand the dish goes from EVERY meal that was holding it');
// WHY THESE ARE HERE: the refusal named a dish and no meal, so the dish was
// refused wherever the plan was holding it. The rule took it from ONE meal and
// left it in the other — and the shopping list buys the plan, so the list
// bought the very dal the user had refused while the sheet said the meal had
// been heard.
//
//   "breakfast dal, lunch dal, no dal"   -> { breakfast: 'dal' }
//
// An empty slot is honest. A dish the user refused is a dish the list buys.
check('breakfast dal, lunch dal, no dal', {});
check('breakfast dal, lunch dal, dinner dal, no dal', {});
check('dal for breakfast, dal for lunch, no dal', {});

console.log('\nand a refusal that points back takes the dish it points at');
// WHY THIS IS HERE: the pronoun points BACK, at the dish in front of it. The
// rule took the dish from the meal AFTER the refusal instead, which took the
// dal the user had asked for and left the dal they had refused.
//
//   "breakfast dal, no it, lunch dal"   -> { breakfast: 'dal' }
check('breakfast dal, no it, lunch dal', { lunch: 'dal' });
check('breakfast dal, no it, lunch rice', { lunch: 'rice' });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
