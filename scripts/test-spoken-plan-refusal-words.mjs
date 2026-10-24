/**
 * Tests for the ways people refuse a dish that the refusal words did not
 * cover.
 *
 * WHY THIS EXISTS
 * The refusal feature removes the dish the user says they do not want, and
 * the shopping list buys the plan — so a refusal the parser does not
 * understand is a dish the list still buys. Two of the commonest ways of
 * refusing were not understood at all:
 *
 *   "no more dal for dinner"
 *     The refusal named the dish "more dal", not "dal". The refusal was
 *     understood and the dish was NOT — and a refusal that names a dish
 *     nothing holds removes nothing. The dal stayed on the plan, the list
 *     bought it, and the sheet said "there is no more dal to remove from
 *     the dinner" about a dal the user had named twice.
 *
 *   "remove dal for dinner"
 *     "remove" was not a refusal word, so the refusal was not a refusal.
 *     The plan filed the dinner as "remove dal" — a name that matches no
 *     recipe in the catalogue — and the sheet said "Added 1 meal by voice".
 *     The user asked for a dish to be taken away and the app wrote the
 *     words for taking it away into the plan.
 *
 * These tests are the proof: both are refusals now, both name the dish the
 * user named, and the dish that contains a refusal word in its own name is
 * still a dish.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-words.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanOutcome, spokenPlanClears } = await import(
  '../src/utils/spokenPlanEntries.ts'
);

let passed = 0;
let failed = 0;

function check(label, got, expected) {
  const have = JSON.stringify(got);
  const want = JSON.stringify(expected);
  if (have === want) {
    passed += 1;
    console.log(`  ok   ${label} -> ${have}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label} -> ${have}, expected ${want}`);
  }
}

const NOW = 1_700_000_000_000;

/** A day holding the dishes it is given. */
function dayHolding(dishes) {
  const day = { mode: 'normal', guests: 0 };
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const name = dishes[slot];
    day[slot] = name ? { name, slot, servings: 2, createdAt: NOW } : null;
  }
  return day;
}

/** What the utterance did, the way the sheet asks. */
function outcome(said, day) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  return spokenPlanOutcome(plan, refusals, day);
}

console.log('\na quantifier between the refusal and the dish is not part of the dish');
check(
  '"no more dal for dinner" names the dish dal, not "more dal"',
  parseSpokenPlanResult('no more dal for dinner').refusals,
  [{ slot: 'dinner', dish: 'dal' }],
);

check(
  '... and it files no dish at all',
  parseSpokenPlanResult('no more dal for dinner').plan,
  {},
);

check(
  '... and it empties the dinner the app is holding',
  outcome('no more dal for dinner', dayHolding({ dinner: 'dal' })).cleared,
  ['dinner'],
);

console.log('\nand a dish the user asked to be taken away is a refusal');
check(
  '"remove dal for dinner" is a refusal',
  parseSpokenPlanResult('remove dal for dinner').refusals,
  [{ slot: 'dinner', dish: 'dal' }],
);

check(
  '... and it files no dish at all',
  parseSpokenPlanResult('remove dal for dinner').plan,
  {},
);

check(
  '... and it empties the dinner the app is holding',
  outcome('remove dal for dinner', dayHolding({ dinner: 'dal' })).cleared,
  ['dinner'],
);

check(
  '"cancel dal for dinner" is a refusal too',
  parseSpokenPlanResult('cancel dal for dinner').refusals,
  [{ slot: 'dinner', dish: 'dal' }],
);

check(
  '... and it empties the dinner the app is holding',
  outcome('cancel dal for dinner', dayHolding({ dinner: 'dal' })).cleared,
  ['dinner'],
);

console.log('\nand a refusal that names a dish nothing holds removes nothing');
check(
  '"remove dal for dinner" when the dinner holds biryani empties nothing',
  outcome('remove dal for dinner', dayHolding({ dinner: 'biryani' })).cleared,
  [],
);

check(
  '... and the sheet says so rather than claiming it did not understand',
  outcome('remove dal for dinner', dayHolding({ dinner: 'biryani' })).kind,
  'refused',
);

console.log('\nand a dish with a refusal word in its own name is still a dish');
// WHY THIS ONE IS HERE: the obvious way to widen the refusal words is to
// add every verb that sounds like taking something away, and "drop" is one
// of them — and the catalogue has "Chinese Egg Drop Soup", "Goan Egg Drop
// Curry" and "Snow Drop Cookies" in it. A refusal word that a recipe's own
// name contains takes the dish away from the plan the moment it is said.
check(
  '"goan egg drop curry for dinner" files the dish',
  parseSpokenPlanResult('goan egg drop curry for dinner').plan,
  { dinner: 'goan egg drop curry' },
);

check(
  '... and it refuses nothing',
  parseSpokenPlanResult('goan egg drop curry for dinner').refusals,
  [],
);

check(
  '"chinese egg drop soup for lunch" files the dish too',
  parseSpokenPlanResult('chinese egg drop soup for lunch').plan,
  { lunch: 'chinese egg drop soup' },
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
