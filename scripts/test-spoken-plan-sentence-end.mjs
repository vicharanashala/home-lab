/**
 * Tests for a refusal that ends a SENTENCE rather than a comma-clause.
 *
 * WHY THIS EXISTS
 * The parser reads a comma as the end of a clause, and every rule that
 * handles a refusal looks for that comma: the rule that decides whether the
 * refusal belongs to the meal in front of it, the rule that finds the dish
 * the refusal names, and the rule that says a refusal standing alone may
 * reach for another meal.
 *
 * Whisper punctuates what it hears, and it ends a sentence with a FULL STOP
 * at least as often as with a comma. So the transcript that actually reaches
 * this parser said:
 *
 *   "breakfast dal. no it. lunch dal."
 *
 * and not:
 *
 *   "breakfast dal, no it, lunch dal"
 *
 * The full stop was not a clause end, so the refusal leaked out of its own
 * clause and into the next meal's. Both halves of that are silent, and both
 * are costly:
 *
 *   "breakfast dal, no it, lunch dal"   -> lunch dal    the dish the user asked for
 *   "breakfast dal. no it. lunch dal."  -> nothing       the dish the user asked for, DROPPED
 *
 * and in the other shape the dish the user REFUSED stayed in the plan:
 *
 *   "dal for dinner, no dal, rice for lunch"  -> nothing
 *   "dal for dinner. no dal. rice for lunch." -> dinner dal   <- the refused dal, still in the plan
 *
 * A dish the user said they did not want is the one thing the shopping list
 * buys, and a dish the user did say is the one thing the parser must never
 * lose.
 *
 * Run with:  node scripts/test-spoken-plan-sentence-end.mjs
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

console.log('\na refusal that ends a sentence is still a refusal of its own clause');
check('breakfast dal. no it. lunch dal.', { lunch: 'dal' });
check('for breakfast dal. no it. for lunch rice.', { lunch: 'rice' });
check('breakfast dal. no it, lunch dal.', { lunch: 'dal' });
check('breakfast dal, no it. lunch dal.', { lunch: 'dal' });

console.log('\nand the dish the user refused does not stay in the plan');
check('dal for dinner. no dal.', {});
check('dal for dinner! no dal!', {});
check('dal for dinner? no dal?', {});
check('breakfast oats. lunch rice. no oats.', { lunch: 'rice' });

console.log('\nthe sentence end and the comma end agree');
// The same words, punctuated the two ways a transcript can carry them, have to
// come out the same. A dish the user said must not depend on which mark the
// speech model happened to choose.
const same = [
  ['breakfast dal, no it, lunch dal', 'breakfast dal. no it. lunch dal.'],
  ['dal for dinner, no dal', 'dal for dinner. no dal.'],
  ['breakfast oats, lunch rice, no oats', 'breakfast oats. lunch rice. no oats.'],
  ['for breakfast dal, no it, for lunch rice', 'for breakfast dal. no it. for lunch rice.'],
  ['dal for dinner, no dal, rice for lunch', 'dal for dinner. no dal. rice for lunch.'],
  ['breakfast dal, lunch dal, no dal', 'breakfast dal. lunch dal. no dal.'],
  ['for breakfast dal, do not want it, for lunch rice', 'for breakfast dal. do not want it. for lunch rice.'],
];
for (const [withComma, withStop] of same) {
  const a = JSON.stringify(parseSpokenPlan(withComma));
  const b = JSON.stringify(parseSpokenPlan(withStop));
  check(withStop, JSON.parse(a), `the comma form gives ${a}`);
}

console.log('\na dot that is not a sentence end is left alone');
// A decimal is not a sentence end: the dot has a digit on either side of it,
// so the time is left whole instead of being cut in half by a clause end.
check('lunch rice at 8.30', { lunch: 'rice 30' });
// A time is not a dish, and the sentence-end rule does not change that.
check('dinner at 8 pm', {});
check('breakfast oats. lunch rice.', { breakfast: 'oats', lunch: 'rice' });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
