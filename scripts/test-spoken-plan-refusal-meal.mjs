/**
 * Tests for a refusal that names a MEAL and no DISH.
 *
 * WHY THIS EXISTS
 * The refusal work taught the app to empty a meal when the user refuses the
 * dish that meal is holding. It never taught it the other half of the same
 * sentence — a refusal that names the MEAL and not the dish:
 *
 *   "no breakfast"
 *
 * The meal word was taken as the meal the utterance was about, so the refusal
 * was left naming nothing — and a refusal that names nothing was thrown
 * away. Nothing was emptied, and the sheet said the thing that is the
 * opposite of the truth:
 *
 *   said "no breakfast"
 *     -> "could not tell which meal it was for. Try saying "breakfast ..."."
 *
 * The meal WAS told. It was the breakfast. The app was telling the user to
 * say the very thing they had just said they did not want, and the
 * breakfast stayed on the plan — so the shopping list bought it.
 *
 * These tests are the proof: a refusal that names a meal empties that meal,
 * a meal the utterance FILLED is still left alone, and a refusal that names
 * a dish is unchanged.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-meal.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanClears, spokenPlanOutcome, spokenPlanError } = await import(
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

/** What the user is told, the way the sheet tells it. */
function message(said, day) {
  const result = outcome(said, day);
  return spokenPlanError(said, result);
}

/** The meals the utterance empties. */
function cleared(said, day) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  return spokenPlanClears(refusals, plan, day);
}

console.log('\na refusal that names a MEAL empties that meal');
check(
  '"no breakfast" empties the breakfast',
  cleared('no breakfast', dayHolding({ breakfast: 'Masala dosa' })),
  ['breakfast'],
);

check(
  '"skip lunch" empties the lunch',
  cleared('skip lunch', dayHolding({ lunch: 'Palak paneer' })),
  ['lunch'],
);

check(
  '"without dinner" empties the dinner',
  cleared('without dinner', dayHolding({ dinner: 'Dal makhani' })),
  ['dinner'],
);

check(
  '"remove breakfast" empties the breakfast',
  cleared('remove breakfast', dayHolding({ breakfast: 'Masala dosa' })),
  ['breakfast'],
);

check(
  '"no lunch, dal for dinner" empties the lunch',
  cleared('no lunch, dal for dinner', dayHolding({ lunch: 'Palak paneer' })),
  ['lunch'],
);

console.log('\nand the sheet opens on it, instead of saying nothing was understood');
check(
  '"no breakfast" is a plan, not nothing',
  outcome('no breakfast', dayHolding({ breakfast: 'Masala dosa' })).kind,
  'plan',
);

check(
  '... and the sheet opens on the meal it empties',
  outcome('no breakfast', dayHolding({ breakfast: 'Masala dosa' })).cleared,
  ['breakfast'],
);

console.log('\nand the plan the utterance describes is not changed by it');
check(
  '"no breakfast" files no dish',
  parseSpokenPlanResult('no breakfast').plan,
  {},
);

console.log('\nand a meal the utterance FILLED is left alone');
check(
  '"breakfast masala dosa, no breakfast" keeps the dosa',
  cleared('breakfast masala dosa, no breakfast', dayHolding({ breakfast: 'Masala dosa' })),
  [],
);

check(
  '... and the dosa is still on the plan',
  parseSpokenPlanResult('breakfast masala dosa, no breakfast').plan.breakfast,
  'masala dosa',
);

console.log('\nand a refusal that names a DISH is unchanged');
check(
  '"no dal for dinner" still empties the dinner holding dal',
  cleared('no dal for dinner', dayHolding({ dinner: 'dal' })),
  ['dinner'],
);

check(
  '"no dal for dinner" leaves the dinner holding biryani alone',
  cleared('no dal for dinner', dayHolding({ dinner: 'biryani' })),
  [],
);

check(
  '"no lunch dal" still names the dal',
  parseSpokenPlanResult('no lunch dal').refusals,
  [{ slot: 'lunch', dish: 'dal' }],
);

console.log('\nand a meal-only refusal with nothing on it says so');
check(
  '"no breakfast" on a day with no breakfast is a refusal',
  outcome('no breakfast', dayHolding({ dinner: 'dal' })).kind,
  'refused',
);

check(
  '... and says there is nothing to remove from the breakfast',
  message('no breakfast', dayHolding({ dinner: 'dal' })),
  'Heard "no breakfast" — there is nothing to remove from the breakfast.',
);

check(
  '... and does not claim the meal could not be told',
  message('no breakfast', dayHolding({ dinner: 'dal' })).includes(
    'could not tell which meal it was for',
  ),
  false,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
