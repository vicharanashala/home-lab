/**
 * Regression tests for one dish spoken for two meals.
 *
 * The parser reads a spoken day as a series of meal words, and each meal word
 * looks for its dish on either side of itself: "dinner dal" puts it behind,
 * "dal for dinner" puts it in front. Both readings are real, and people use
 * both in the same sentence.
 *
 * That creates one trap: the text in front of a connector can belong to the
 * PREVIOUS meal ("for breakfast masala dosa, for lunch butter chicken" — the
 * "masala dosa" is breakfast's) or to the CURRENT meal ("rice for lunch and
 * rice for dinner" — the second "rice" is dinner's). When the two meals are
 * given the SAME dish, the two readings look identical on the page, and a
 * parser that cannot tell them apart either drops a meal the user asked for
 * or puts a dish in a slot it was never spoken for.
 *
 * The second failure is the worse one: a wrong dish in the plan poisons the
 * taste model forever, and the meal the user actually asked for is left out.
 * So these tests check both halves — the slot that must be filled, and the
 * slot that must NOT be given the neighbour's dish.
 *
 * Run with:  node scripts/test-spoken-plan-repeat.mjs
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

console.log('\nthe same dish for two meals — both meals get it');
check('rice for lunch and rice for dinner', { lunch: 'rice', dinner: 'rice' });
check('dal for dinner and dal for lunch', { dinner: 'dal', lunch: 'dal' });
check('chicken curry for dinner and chicken curry for lunch', {
  dinner: 'chicken curry',
  lunch: 'chicken curry',
});

console.log('\nthe same dish for two meals, leading "for"');
check('for breakfast upma, for lunch upma', { breakfast: 'upma', lunch: 'upma' });
check('for lunch rice, for dinner rice', { lunch: 'rice', dinner: 'rice' });

console.log('\nno meal is given a neighbour\'s dish');
// "dal for breakfast" belongs to breakfast. If the parser reads the text in
// front of the second connector as dinner's dish, dinner holds a dish that was
// never spoken for dinner and breakfast is left empty.
check('rice for lunch and rice for dinner and dal for breakfast', {
  lunch: 'rice',
  dinner: 'rice',
  breakfast: 'dal',
});
check('dal for dinner and dal for lunch and upma for breakfast', {
  dinner: 'dal',
  lunch: 'dal',
  breakfast: 'upma',
});
check('for lunch rice, for dinner rice, for breakfast dal', {
  lunch: 'rice',
  dinner: 'rice',
  breakfast: 'dal',
});

console.log('\nthe leading-"for" convention still wins for its own day');
check('for breakfast masala dosa, for lunch butter chicken, for dinner chole bhature', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
  dinner: 'chole bhature',
});
check('for breakfast oats with milk, for lunch vegetable rice', {
  breakfast: 'oats with milk',
  lunch: 'vegetable rice',
});
check('for dinner chole bhature, for breakfast upma', {
  dinner: 'chole bhature',
  breakfast: 'upma',
});

console.log('\ndifferent dishes are unaffected');
check('dal makhani for dinner and rice for lunch', { dinner: 'dal makhani', lunch: 'rice' });
check('rice for lunch and dal for dinner', { lunch: 'rice', dinner: 'dal' });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
