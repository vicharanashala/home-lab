/**
 * Regression tests for two dishes in one stretch of text.
 *
 * The parser reads a spoken day as a series of meal words, and a dish can sit
 * on either side of its meal word: "dinner dal" puts it behind, "dal for
 * dinner" puts it in front. Both readings are real, and people use both in
 * the same sentence.
 *
 * That creates one trap the parser has to see: the text between two meal
 * words can hold TWO dishes, not one. When the meal on the left takes its
 * dish from the text on its right ("breakfast masala dosa") and the meal on
 * the right takes its dish from the text on its left ("butter chicken for
 * lunch"), both dishes sit in the same stretch of text, and the parser has
 * to know where one ends and the other begins.
 *
 * It used not to. The whole stretch went to the meal on the left, which
 * swallowed the other meal's dish:
 *
 *   "breakfast masala dosa, butter chicken for lunch"
 *     -> breakfast "masala dosa butter chicken", lunch EMPTY
 *
 * and because the left meal had taken the right meal's dish, the right meal
 * was then given the NEXT meal's dish instead:
 *
 *   "for breakfast masala dosa, butter chicken for lunch, chole for dinner"
 *     -> breakfast "masala dosa butter chicken", lunch "chole", dinner EMPTY
 *
 * The second failure is the worse one. A wrong dish in a slot poisons the
 * taste model forever, and the meal the user actually asked for is left out.
 * So these tests check both halves — the slot that must be filled, and the
 * slot that must NOT be given the neighbour's dish.
 *
 * Run with:  node scripts/test-spoken-plan-split.mjs
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

console.log('\nthe two dishes in one stretch are told apart');
check('breakfast masala dosa, butter chicken for lunch', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('breakfast oats, dal for lunch', {
  breakfast: 'oats',
  lunch: 'dal',
});
check('for breakfast masala dosa, butter chicken for lunch', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('breakfast masala dosa, dal for lunch and soup for dinner', {
  breakfast: 'masala dosa',
  lunch: 'dal',
  dinner: 'soup',
});

console.log('\nno meal is given its neighbour\'s dish');
check('for breakfast masala dosa, butter chicken for lunch, chole for dinner', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
  dinner: 'chole',
});
check('breakfast masala dosa, butter chicken for lunch, chole for dinner', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
  dinner: 'chole',
});

console.log('\nno meal is left empty');
check('breakfast masala dosa, butter chicken for lunch', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('breakfast masala dosa, dal for lunch', {
  breakfast: 'masala dosa',
  lunch: 'dal',
});

console.log('\na dish named with "and" is one dish, not two');
// The catalogue is full of them, so "and" cannot be a boundary: cutting
// "rice and dal" in half would hand the second half to a meal that was
// never spoken for.
check('breakfast rice and dal for lunch', {
  breakfast: 'rice and dal',
});
check('dinner makki and methi roti for lunch', {
  dinner: 'makki and methi roti',
});

console.log('\nthe one-dish readings are untouched');
check('breakfast masala dosa, lunch butter chicken', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('masala dosa for breakfast, butter chicken for lunch', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('for breakfast masala dosa, for lunch butter chicken', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('rice for lunch and rice for dinner', { lunch: 'rice', dinner: 'rice' });
check('dal for dinner and dal for lunch', { dinner: 'dal', lunch: 'dal' });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
