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

console.log('\na refusal inside a dish that was captured whole');
// The refusal was only split out of the text that FOLLOWS the meal word. A
// dish captured through a connector — "rice, no dal FOR dinner" — was taken
// whole, and the refusal stayed inside it.
//
// So the dinner was filed as "rice no dal": the dal the user had refused was
// still in the plan, and "rice no dal" matches no recipe in the catalogue, so
// the shopping list bought nothing for it. The same sentence without the
// connector ("lunch rice, no dal") was split correctly, so the rule was
// working on one path and not on the others.
check('rice, no dal for dinner', { dinner: 'rice' });
check('rice no dal for dinner', { dinner: 'rice' });
check('dal for dinner, rice no dal for lunch', { dinner: 'dal', lunch: 'rice' });
check('breakfast masala dosa, rice no dal for lunch', {
  breakfast: 'masala dosa',
  lunch: 'rice',
});
check('breakfast rice no dal, butter chicken for lunch', {
  breakfast: 'rice',
  lunch: 'butter chicken',
});

console.log('\na refusal belongs to the meal it is attached to');
// The comma is what says the refusal is about the meal before it and not
// the one after it, so the lunch keeps its dish.
check('no dal, lunch rice', { lunch: 'rice' });
check('no dal lunch rice', { lunch: 'rice' });
check('dinner fish, lunch rice', { dinner: 'fish', lunch: 'rice' });
check('breakfast oats, no lunch, dal for dinner', { breakfast: 'oats', dinner: 'dal' });

console.log('\na refusal written with a contraction');
// "don't" is "do not" with the apostrophe left out. The parser strips the
// apostrophe out of every dish it builds, so the refusal reached the rules
// as "don t" — two words, and neither of them is a refusal. The user's
// refusal of the dal was filed as the dinner instead.
check("I don't want dal for dinner", {});
check("don't want dal for dinner", {});
check("lunch don't want dal", {});
check('do not dal for dinner', {});
check('I do not want dal for dinner', {});

// A refusal said with a contraction must not replace the dish the user DID
// ask for — the same rule the plain "no" already had.
check("lunch rice, don't want dal", { lunch: 'rice' });
check("lunch rice, I don't want dal", { lunch: 'rice' });

console.log('\na refusal said as "nah" or "nope"');
// "nah" and "nope" ARE refusals — they are what people say instead of "no" —
// but they sat in the set of words that carry no dish information, so the
// parser dropped them and kept the dish the user had refused.
//
// The cost was not a missing slot but a WRONG one: "nope dal for dinner"
// filed the dinner as "dal", the very dish the user had said they did not
// want, and the shopping list bought it.
check('nah dal for dinner', {});
check('nope dal for dinner', {});
check('nah lunch dal', {});
check('nope lunch dal', {});
check('lunch rice, nope dal', { lunch: 'rice' });
check('lunch rice, nah dal', { lunch: 'rice' });

console.log('\nevery word of the refusal family gives the same answer');
// The family is "no", "nope" and "nah". The same sentence said with each of
// them has to come out the same, or the same intent is parsed two ways
// depending on the word the user happened to say.
const FAMILY = ['no', 'nope', 'nah'];
const SHAPES = [
  'X dal for dinner',
  'X lunch dal',
  'lunch rice, X dal',
  'X dal, lunch rice',
  'X, lunch rice',
];
for (const shape of SHAPES) {
  const answers = FAMILY.map((w) => JSON.stringify(parseSpokenPlan(shape.replace('X', w))));
  const shown = shape.replace('X', FAMILY.join('|'));
  if (answers.every((a) => a === answers[0])) {
    passed += 1;
    console.log(`  ok   ${JSON.stringify(shown)} -> ${answers[0]}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${JSON.stringify(shown)} -> ${answers.join(' | ')}`);
  }
}

console.log('\n"nope" on its own does not swallow the meal that follows it');
// The comma is what says the refusal belongs to the meal before it, so the
// meal after it keeps its dish — the same rule "no dal, lunch rice" already
// had.
check('nope, lunch rice', { lunch: 'rice' });
check('nope dal, lunch rice', { lunch: 'rice' });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
