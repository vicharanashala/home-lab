/**
 * Tests for a refusal of a dish whose name carries punctuation.
 *
 * WHY THIS EXISTS
 * A refusal is compared with the dish the DAY is holding, and the two names
 * come from different places: the spoken one from a speech recogniser, the one
 * on the day from a recipe's own name. A recipe's name carries punctuation —
 * "Eggless Devil's Food Cake", "PF Chang's Style Crispy Chicken Lettuce
 * Wraps", "Roasted Potatoes With Za'atar" — and a speech recogniser does not
 * put the apostrophe in. "eggless devil s food cake" is what was heard.
 *
 * The comparison took the punctuation off the spoken name and left it on the
 * recipe's name, so the two could never be equal for a single one of those
 * recipes:
 *
 *   day holds "Eggless Devil's Food Cake"   user says "no eggless devil's food cake"
 *                                             -> the meal was NOT emptied
 *
 * The shopping list buys the plan, so the refused dish stayed on the list and
 * on the shopping list. The same argument already made the rule fold the CASE
 * on both sides — see namesHeldDish — and the punctuation is that argument one
 * step further: the rule must not depend on which of the two names happened to
 * carry an apostrophe.
 *
 * These tests are the proof: a refusal of a punctuated dish empties the meal
 * holding it, and the dishes that were already matching still match.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-punctuation.mjs
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

console.log("\na dish whose name carries punctuation can be refused");
check(
  "the apostrophe in \"Eggless Devil's Food Cake\" does not stop the refusal",
  applySpoken(
    "no eggless devil's food cake for dinner",
    dayHolding({ dinner: "Eggless Devil's Food Cake" }),
  ).holds,
  { breakfast: null, lunch: null, dinner: null },
);

check(
  "and neither does the one in \"PF Chang's Style Crispy Chicken Lettuce Wraps\"",
  applySpoken(
    "no pf chang's style crispy chicken lettuce wraps for dinner",
    dayHolding({ dinner: "PF Chang's Style Crispy Chicken Lettuce Wraps" }),
  ).holds,
  { breakfast: null, lunch: null, dinner: null },
);

check(
  "and neither does the one in \"Roasted Potatoes With Za'atar\"",
  applySpoken(
    "no roasted potatoes with za'atar for dinner",
    dayHolding({ dinner: "Roasted Potatoes With Za'atar" }),
  ).holds,
  { breakfast: null, lunch: null, dinner: null },
);

console.log('\nand a dish that was already matching still matches');
check(
  '"no dal for dinner" takes the dal out of the dinner',
  applySpoken('no dal for dinner', dayHolding({ dinner: 'dal' })).holds,
  { breakfast: null, lunch: null, dinner: null },
);

check(
  '"no dal for dinner" takes the dal out of a dinner holding "Dal tadka"',
  applySpoken('no dal tadka for dinner', dayHolding({ dinner: 'Dal tadka' })).holds,
  { breakfast: null, lunch: null, dinner: null },
);

check(
  'a dish that merely contains the named one is still left alone',
  applySpoken('no dal for dinner', dayHolding({ dinner: 'Dal tadka' })).holds,
  { breakfast: null, lunch: null, dinner: 'Dal tadka' },
);

console.log('\nand the rule itself compares the two names the same way');
check(
  'the heard name matches the recipe name with its apostrophe',
  namesHeldDish('eggless devil s food cake', "Eggless Devil's Food Cake"),
  true,
);

check(
  'and a name that is a different dish still does not match',
  namesHeldDish('eggless devil s food cake', 'Eggless Devils Food Cakee'),
  false,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
