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

console.log('\n"for" in front of the meal word is how people talk, not a connector');
// These are the sentences people actually dictate. The old parser read the
// leading "for" as "the dish comes BEFORE the meal word" — which is right
// for "dal FOR dinner" and wrong for "FOR breakfast masala dosa". So the
// whole day shifted up a slot: breakfast was left empty, masala dosa went
// to lunch and butter chicken to dinner.
check('for breakfast masala dosa, for lunch butter chicken, for dinner chole bhature', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
  dinner: 'chole bhature',
});
check('for breakfast masala dosa for lunch butter chicken for dinner chole bhature', {
  breakfast: 'masala dosa',
  lunch: 'butter chicken',
  dinner: 'chole bhature',
});
check('for breakfast oats with milk, for lunch vegetable rice', {
  breakfast: 'oats with milk',
  lunch: 'vegetable rice',
});
check('for dinner chole bhature', { dinner: 'chole bhature' });
// The dish is still in front when the meal word really is at the end.
check('masala dosa for breakfast, dal for dinner', {
  breakfast: 'masala dosa',
  dinner: 'dal',
});

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

console.log('\nthe things people say before they start are not dishes');
// People acknowledge before they dictate — "yeah, for lunch rice". The
// acknowledgement sits in front of the connector, so the parser read it as
// the dish the connector belonged to: lunch became "yeah", the dish the
// user actually said was thrown away, and the shopping list went looking
// for a dish that does not exist.
//
// "okay" was already handled, which is why this went unnoticed: the set of
// words that carry no dish information had "okay" and "so" in it but not
// the words people actually use.
check('yeah for lunch rice', { lunch: 'rice' });
check('Yeah. for lunch rice', { lunch: 'rice' });
check('yes for breakfast masala dosa', { breakfast: 'masala dosa' });
check('right. for lunch rice', { lunch: 'rice' });
check('hmm. for dinner dal', { dinner: 'dal' });
check('um for lunch rice', { lunch: 'rice' });
check('yeah masala dosa for lunch', { lunch: 'masala dosa' });
check('yep for dinner chole bhature', { dinner: 'chole bhature' });
// The acknowledgement is noise, so it does not make the slot empty either.
check('yeah', {});
check('okay for lunch rice', { lunch: 'rice' });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
