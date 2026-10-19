/**
 * Regression tests for the spoken-plan parser.
 *
 * The parser decides what goes into the meal plan, and a wrong dish is worse
 * than a missing one: it poisons the taste model and the taste-match score
 * forever. So every case here is a real way people speak.
 *
 * Run with:  node scripts/test-spoken-plan.mjs
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

console.log('\nmeal word first — "dinner dal"');
check('dinner dal', { dinner: 'dal' });
check('breakfast oats with milk', { breakfast: 'oats with milk' });
check('lunch vegetable rice', { lunch: 'vegetable rice' });
check('dinner will be fish, breakfast is upma', { dinner: 'fish', breakfast: 'upma' });
check('dinner chicken curry and breakfast upma', { dinner: 'chicken curry', breakfast: 'upma' });

console.log('\nmeal word last — "dal for dinner"');
check('dal makhani for dinner', { dinner: 'dal makhani' });
check('we will have dal makhani for dinner', { dinner: 'dal makhani' });
check('dal for dinner', { dinner: 'dal' });

console.log('\nmore than one meal');
check('dal makhani for dinner and rice for lunch', { dinner: 'dal makhani', lunch: 'rice' });
check('rice for lunch and dal for dinner', { lunch: 'rice', dinner: 'dal' });
check('dal makhani for dinner, rice for lunch', { dinner: 'dal makhani', lunch: 'rice' });
check('dal for dinner and rice for lunch', { dinner: 'dal', lunch: 'rice' });
check('breakfast oats, lunch vegetable rice, dinner chicken curry', {
  breakfast: 'oats',
  lunch: 'vegetable rice',
  dinner: 'chicken curry',
});

console.log('\nthe same meal mentioned twice');
check('lunch rice, dinner dal, lunch salad', { lunch: 'rice', dinner: 'dal' });

console.log('\nnegations and times are not dishes');
check('no dal for dinner', {});
check('not dal for dinner', {});
check('without dal for dinner', {});
check('dinner at 8 pm', {});
check('dinner at 8 pm and dal makhani', { dinner: 'dal makhani' });

console.log('\nnothing to say');
check('', {});
check('just some noise', {});
check('2 rotis', {});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
