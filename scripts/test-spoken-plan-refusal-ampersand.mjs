/**
 * Regression tests for a refused dish whose name carries an ampersand.
 *
 * WHY THIS EXISTS
 * A dish name reaches the refusal rule in two shapes. The dish the user SAYS
 * is a spoken fragment — "asian style sweet and spicy green beans". The dish
 * the DAY holds is a recipe's own name, and a recipe's own name writes "and"
 * with a symbol:
 *
 *   "Asian Style Sweet & Spicy Green Beans"
 *   "Eggless Chocolate Cupcakes With Raspberry & Cheese Frosting"
 *
 * The rule that folds the punctuation off a name did not fold the ampersand
 * off, and the rule that takes the letters of a name does not count a symbol,
 * so the symbol simply vanished from one side of the comparison and not the
 * other:
 *
 *   day holds "Asian Style Sweet & Spicy Green Beans"
 *   user says "no asian style sweet and spicy green beans for dinner"
 *                                             -> the meal was NOT emptied
 *
 * The shopping list buys the plan, so the refused dish stayed on the list and
 * the sheet said there was nothing to remove.
 *
 * 469 of the 5,894 scraped names carry an ampersand, and 239 of them could not
 * be refused by the name a person would say them by.
 *
 * WHY IT IS "AND" AND NOT NOTHING: the rest of the app already has ONE rule
 * for "is this the same dish?" — `sameDish`, which folds the ampersand to
 * "and" before it compares. This rule and that one have to give the same
 * answer about the same pair of names, or the sheet and the plan disagree
 * about which dish the user refused.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-ampersand.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult, namesHeldDish } = await import('../src/utils/spokenPlan.ts');
const { sameDish } = await import('../src/utils/spokenRecipeMatch.ts');
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

console.log('\na dish the day holds under a name with an ampersand can be refused');
check(
  '"no asian style sweet and spicy green beans for dinner" empties the dinner',
  applySpoken(
    'no asian style sweet and spicy green beans for dinner',
    dayHolding({ dinner: 'Asian Style Sweet & Spicy Green Beans' }),
  ).holds,
  EMPTY,
);

check(
  '"no eggless chocolate cupcakes with raspberry and cheese frosting for dinner" empties the dinner',
  applySpoken(
    'no eggless chocolate cupcakes with raspberry and cheese frosting for dinner',
    dayHolding({
      dinner: 'Eggless Chocolate Cupcakes With Raspberry & Cheese Frosting',
    }),
  ).holds,
  EMPTY,
);

console.log('\nand the rule itself says the same thing');
check(
  'the spoken name matches the recipe name with an ampersand',
  namesHeldDish(
    'asian style sweet and spicy green beans',
    'Asian Style Sweet & Spicy Green Beans',
  ),
  true,
);

console.log('\nand the refusal rule agrees with the rule the matcher uses');
check(
  'the refusal rule and sameDish give the same answer',
  namesHeldDish(
    'asian style sweet and spicy green beans',
    'Asian Style Sweet & Spicy Green Beans',
  ) ===
    sameDish(
      'asian style sweet and spicy green beans',
      'Asian Style Sweet & Spicy Green Beans',
    ),
  true,
);

console.log('\nand an ampersand does not make two dishes one');
check(
  '"no dal for dinner" leaves a dinner holding "Dal tadka" alone',
  applySpoken(
    'no dal for dinner',
    dayHolding({ dinner: 'Dal tadka' }),
  ).holds,
  { breakfast: null, lunch: null, dinner: 'Dal tadka' },
);

check(
  'the rule does not match a dish that merely contains the named one',
  namesHeldDish('dal', 'Dal tadka'),
  false,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
