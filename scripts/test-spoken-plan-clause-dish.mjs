/**
 * Regression tests for a comma parting the text in FRONT of a meal word.
 *
 * WHY THIS IS ITS OWN FILE: the parser reads a spoken day as a series of meal
 * words, and a dish can sit on either side of its meal word. The case this
 * file is about is the one where the meal word is at the END and the text in
 * front of it holds TWO dishes:
 *
 *   "masala dosa, biryani for dinner"
 *
 * There is one meal word — dinner — and two clauses in front of it. The meal
 * word belongs to the clause it sits in, which is the biryani.
 *
 * IT USED NOT TO BE. The whole stretch in front of the meal word was taken as
 * the dish:
 *
 *   "masala dosa, biryani for dinner" -> dinner "masala dosa biryani"
 *
 * and "masala dosa biryani" is a dish that is in NO catalogue. So the dinner
 * linked to no recipe, the shopping list bought nothing for it, and nothing
 * anywhere said the biryani the user had asked for was lost. The user said two
 * dishes; the app heard one dish that does not exist.
 *
 * WHY A COMMA AND NOT "AND": the catalogue is full of dishes named with it —
 * "Makki and Methi Roti", "Cabbage and Carrot Sambharo", and the everyday
 * "rice and dal". Cutting on "and" would cut those in half and hand the
 * second half to a meal that was never spoken for. A comma is the only sign
 * that two things were said where one meal word stands.
 *
 * WHY THE MEAL-LESS DISH IS DROPPED RATHER THAN GUESSED: "masala dosa" has no
 * meal word of its own, and the panel is per-day. The app cannot guess which
 * meal it was for, so it says nothing about it — the same thing it already
 * does for a dish said with no meal word at all.
 *
 * Run with:  node scripts/test-spoken-plan-clause-dish.mjs
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

console.log('\nthe meal word belongs to the clause it sits in');
check('masala dosa, biryani for dinner', { dinner: 'biryani' });
check('masala dosa, butter chicken for lunch', { lunch: 'butter chicken' });
check('dal, biryani for dinner', { dinner: 'biryani' });
check('rice, biryani for dinner', { dinner: 'biryani' });
check('masala dosa, biryani dinner', { dinner: 'biryani' });

console.log('\na connector with no dish behind it takes the clause in front of it');
// The connector is what parts the text in front of it from the meal word, so
// the comma can be the last thing in the stretch — and the dish is the one
// before it.
check('masala dosa, for dinner', { dinner: 'masala dosa' });
check('dal, for dinner', { dinner: 'dal' });

console.log('\nthe dish that is filed is one the catalogue holds');
// The cost of getting this wrong is not a wrong meal — it is a meal that
// links to no recipe, so the shopping list buys nothing for it. "masala dosa
// biryani" is in no catalogue; "biryani" is.
const catalogue = parseSpokenPlan('biryani for dinner');
check('biryani for dinner', catalogue, 'the dish alone files the same way');

console.log('\nthe shapes that worked before still work');
check('breakfast masala dosa, butter chicken for lunch', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('for breakfast masala dosa, for lunch butter chicken', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
});
check('masala dosa for breakfast, biryani for dinner', {
  breakfast: 'masala dosa',
  dinner: 'biryani',
});
check('dal for dinner', { dinner: 'dal' });
check('biryani for dinner', { dinner: 'biryani' });
check('for dinner biryani', { dinner: 'biryani' });

console.log('\nthe text BEHIND a meal word is not parted, and does not lose a dish');
// The rule above is about the text in FRONT of a meal word. The text BEHIND
// one is a different question and it is left alone — the dish nearest the
// meal word is not lost, which is what parting that text would have done.
check('dinner rice, dal, curry for lunch', { dinner: 'rice dal', lunch: 'curry' });
check('dinner rice, dal for lunch', { dinner: 'rice', lunch: 'dal' });

console.log('\na refusal is still a refusal, and the dish in front of it is still the dish');
// The refusal rules come FIRST: "dal, no biryani" is "dal" — the biryani was
// refused and the dal was asked for — and parting the stretch at the comma
// before the refusal rules have had their say would have handed the meal the
// refused dish.
check('no dal, biryani for dinner', { dinner: 'biryani' });
check('dal, no biryani for dinner', { dinner: 'dal' });
check('no dal, no rice, biryani for dinner', { dinner: 'biryani' });
check('rice, no dal', {});

console.log('\na dish said with no meal word is still not filed');
check('masala dosa, biryani', {});
check('masala dosa', {});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
