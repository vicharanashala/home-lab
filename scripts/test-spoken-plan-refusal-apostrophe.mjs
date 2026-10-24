/**
 * Tests for a refusal of a dish whose name carries an apostrophe the
 * recogniser did not put in.
 *
 * WHY THIS EXISTS
 * A refusal is compared with the dish the DAY is holding, and the two names
 * come from different places: the spoken one from a speech recogniser, the one
 * on the day from a recipe's own name. The rule folds the punctuation off
 * both sides, but it folds it to a SPACE — so it only matches when the
 * recogniser leaves the apostrophe as a space ("devil s"). When the
 * recogniser drops the apostrophe and keeps the letter after it, the two
 * names are different words and the refusal does nothing:
 *
 *   day holds "General Tso's Chicken"   user says "no general tsos chicken"
 *                                         -> the meal was NOT emptied
 *
 * The shopping list buys the plan, so the refused dish stayed on the plan and
 * on the shopping list — and the sheet said "there is no general tsos chicken
 * to remove from the dinner", which is false: the dinner WAS holding it.
 *
 * The same is true of an apostrophe that is not a possessive at all. "Za'atar"
 * is a spice, not a name with an "s" on it, and "zaatar" is how it is said:
 *
 *   day holds "Roasted Potatoes With Za'atar"   user says "no roasted potatoes with zaatar"
 *                                                 -> the meal was NOT emptied
 *
 * The rule already folds the CASE on both sides — see namesHeldDish — and the
 * punctuation is that argument one step further. This is the last step of it:
 * the rule must not depend on whether the apostrophe was dropped, spaced out,
 * or kept.
 *
 * These tests are the proof: a refusal of a dish whose apostrophe went
 * missing empties the meal holding it, and the dishes that were already
 * matching still match — and a dish that merely CONTAINS the named one is
 * still left alone.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-apostrophe.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult, namesHeldDish } = await import('../src/utils/spokenPlan.ts');
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
 * What the day holds after a spoken day is applied — the way the page applies
 * it: the entries are written, and the meals a refusal emptied are removed.
 */
function applySpoken(said, current) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  const entries = spokenPlanEntries(plan, {}, current, HOUSEHOLD);
  const cleared = spokenPlanClears(refusals, plan, current);
  const next = { ...current };
  for (const slot of cleared) next[slot] = null;
  for (const { slot, entry } of entries) next[slot] = entry;
  const holds = {};
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    holds[slot] = next[slot] ? next[slot].name : null;
  }
  return { plan, refusals, entries, cleared, holds };
}

const EMPTY = { breakfast: null, lunch: null, dinner: null };

console.log('\na dish whose apostrophe the recogniser dropped can be refused');
check(
  '"no general tsos chicken for dinner" takes the chicken out of the dinner',
  applySpoken(
    'no general tsos chicken for dinner',
    dayHolding({ dinner: "General Tso's Chicken" }),
  ).holds,
  EMPTY,
);

check(
  '"no eggless devils food cake for lunch" takes the cake out of the lunch',
  applySpoken(
    'no eggless devils food cake for lunch',
    dayHolding({ lunch: "Eggless Devil's Food Cake" }),
  ).holds,
  EMPTY,
);

check(
  '"no pf changs style crispy chicken lettuce wraps for dinner" takes it out',
  applySpoken(
    'no pf changs style crispy chicken lettuce wraps for dinner',
    dayHolding({ dinner: "PF Chang's Style Crispy Chicken Lettuce Wraps" }),
  ).holds,
  EMPTY,
);

console.log('\nand so can a dish whose apostrophe is not a possessive at all');
check(
  '"no roasted potatoes with zaatar for dinner" takes it out of the dinner',
  applySpoken(
    'no roasted potatoes with zaatar for dinner',
    dayHolding({ dinner: 'Roasted Potatoes With Za\'atar' }),
  ).holds,
  EMPTY,
);

console.log('\nand the rule still compares the two names the same way');
check(
  'the heard name matches the recipe name with its apostrophe',
  namesHeldDish('eggless devil s food cake', "Eggless Devil's Food Cake"),
  true,
);

check(
  'and it matches the recipe name with the apostrophe dropped',
  namesHeldDish('eggless devils food cake', "Eggless Devil's Food Cake"),
  true,
);

check(
  'and it matches a name that carries no punctuation at all',
  namesHeldDish('dal', 'Dal'),
  true,
);

check(
  'and a name that is a different dish still does not match',
  namesHeldDish('eggless devil s food cake', 'Eggless Devils Food Cakee'),
  false,
);

console.log('\nand a dish that merely CONTAINS the named one is still left alone');
check(
  '"no dal for dinner" leaves a dinner holding "Dal tadka" alone',
  applySpoken('no dal for dinner', dayHolding({ dinner: 'Dal tadka' })).holds,
  { breakfast: null, lunch: null, dinner: 'Dal tadka' },
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
