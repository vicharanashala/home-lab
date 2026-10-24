/**
 * Tests for a refusal that empties a meal.
 *
 * WHY THIS EXISTS
 * The parser takes a refused dish out of the plan, and the shopping list buys
 * the plan — so the refusal was the one thing the user was clearest about,
 * and it was the one thing the app could not carry:
 *
 *   "no dal for dinner"     -> the plan comes back empty, and an empty plan
 *                              reads as "the user did not mention the dinner"
 *   "breakfast dal, no it"  -> the breakfast's dal is gone from the plan
 *
 * The writer takes a slot the plan does not mention as "leave it alone",
 * which is RIGHT for a meal nobody said anything about and WRONG for a meal
 * the user refused. So the dal the user had just refused stayed in the plan,
 * the shopping list bought it, and the sheet said the meal had been heard:
 *
 *   said "no dal for dinner"  ->  the dinner still held dal
 *
 * These tests are the proof: the refusal empties the meal that is holding
 * the refused dish, and leaves every other dish exactly where it was.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-clear.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanEntries, spokenPlanClears } = await import(
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
const HOUSEHOLD = { adults: 2, children: 0, guests: 0 };

/** A day holding the dishes it is given. */
function dayHolding(dishes) {
  const day = { mode: 'normal', guests: 0 };
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const name = dishes[slot];
    day[slot] = name
      ? { name, slot, servings: 2, createdAt: NOW }
      : null;
  }
  return day;
}

/**
 * What the day holds after a spoken day is applied — the way the page
 * applies it: the entries are written, and the meals a refusal emptied are
 * removed.
 */
function applySpoken(said, current) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  const entries = spokenPlanEntries(plan, {}, current, HOUSEHOLD);
  const cleared = spokenPlanClears(refusals, current);
  const next = { ...current };
  for (const { slot, entry } of entries) next[slot] = entry;
  for (const slot of cleared) next[slot] = null;
  const holds = {};
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    holds[slot] = next[slot] ? next[slot].name : null;
  }
  return { plan, refusals, entries, cleared, holds };
}

console.log('\na refusal empties the meal that is holding the refused dish');
check(
  '"no dal for dinner" takes the dal out of the dinner',
  applySpoken('no dal for dinner', dayHolding({ dinner: 'dal' })).holds,
  { breakfast: null, lunch: null, dinner: null },
);

check(
  '"no dal for dinner" leaves every other meal alone',
  applySpoken(
    'no dal for dinner',
    dayHolding({ breakfast: 'oats', lunch: 'rice', dinner: 'dal' }),
  ).holds,
  { breakfast: 'oats', lunch: 'rice', dinner: null },
);

console.log('\nand a refusal that points back empties the meal it points at');
check(
  '"breakfast dal, no it, lunch rice" takes the dal out of the breakfast',
  applySpoken(
    'breakfast dal, no it, lunch rice',
    dayHolding({ breakfast: 'dal', lunch: 'biryani', dinner: 'sambar' }),
  ).holds,
  { breakfast: null, lunch: 'rice', dinner: 'sambar' },
);

console.log('\nand a refusal that names no meal empties every meal holding it');
check(
  '"no dal" takes the dal out of every meal holding it',
  applySpoken(
    'no dal',
    dayHolding({ breakfast: 'dal', lunch: 'rice', dinner: 'dal' }),
  ).holds,
  { breakfast: null, lunch: 'rice', dinner: null },
);

console.log('\nand a dish the user did not refuse is left exactly where it was');
check(
  '"no pizza for dinner" leaves a dal dinner alone',
  applySpoken('no pizza for dinner', dayHolding({ dinner: 'dal' })).holds,
  { breakfast: null, lunch: null, dinner: 'dal' },
);

check(
  '"no dal for dinner" leaves a dal lunch alone',
  applySpoken(
    'no dal for dinner',
    dayHolding({ lunch: 'dal', dinner: 'biryani' }),
  ).holds,
  { breakfast: null, lunch: 'dal', dinner: 'biryani' },
);

console.log('\nand a refusal of a dish nobody is holding changes nothing');
check(
  '"no dal for dinner" on a day with no dal changes nothing',
  applySpoken(
    'no dal for dinner',
    dayHolding({ breakfast: 'oats', lunch: 'rice', dinner: 'biryani' }),
  ).holds,
  { breakfast: 'oats', lunch: 'rice', dinner: 'biryani' },
);

console.log('\nand the refusal is said out loud, so the sheet can show it');
const said = parseSpokenPlanResult('no dal for dinner');
check('the refusal names the dish', said.refusals, [{ slot: 'dinner', dish: 'dal' }]);
check('the plan itself is unchanged', parseSpokenPlanResult('no dal for dinner').plan, {});
check(
  'a refusal that stands alone names no meal',
  parseSpokenPlanResult('no dal').refusals,
  [{ slot: null, dish: 'dal' }],
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
