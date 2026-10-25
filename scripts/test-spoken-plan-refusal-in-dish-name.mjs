/**
 * Tests for a dish whose own NAME carries a refusal word.
 *
 * WHY THIS EXISTS
 *
 * "no" and "without" are refusal words — they are how a person says they do
 * not want a dish. They are ALSO parts of 85 recipe names in the catalogue:
 *
 *   "No Onion No Garlic Lobia Masala Recipe In Electric Pressure Cooker"
 *   "Tomato Curry Leaf Chutney With No Onion No Garlic"
 *   "Red Lentil Curry Without Coconut"
 *   "No-Bake Tangy Lemon Pie"
 *
 * The parser cut a dish at a refusal word, so every one of those names was
 * broken in half. The shopping list buys the plan, so a dish the user asked
 * for that arrived cut, or refused, was a meal the list bought nothing for —
 * and the sheet said the meal had been heard.
 *
 *   "no onion no garlic lobia masala for dinner"
 *     the plan held NOTHING, the app said there was nothing to remove, and the
 *     user was told their dish had been refused.
 *
 *   "red lentil curry without coconut for dinner"
 *     the plan held "red lentil curry" — a different dish, which matches no
 *     recipe by that name, so the list bought nothing for the dinner.
 *
 * WHY THE CATALOGUE DECIDES AND NOT THE WORDS: "no dal" is a refusal and "no
 * onion no garlic lobia masala" is a dish, and the two differ in no way the
 * sentence alone can show. The catalogue knows, so the catalogue is asked — and
 * it is asked with the app's own rule (`matchDish`), so the sheet, the plan
 * and the shopping list cannot disagree about what a dish is called.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-in-dish-name.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { matchDish, CONFIDENT_SCORE } = await import('../src/utils/spokenRecipeMatch.ts');
const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanOutcome } = await import('../src/utils/spokenPlanEntries.ts');

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);

/**
 * The app matches against the built-ins AND the scraped catalogue together —
 * that is how MealPlan builds its `catalogue`.
 */
const catalogue = [...INDIAN_RECIPES, ...csvRecipes];

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

/**
 * The catalogue's answer to "is this a dish?" — the same rule the app uses
 * everywhere else, handed to the parser.
 */
const knownDish = (phrase) => {
  const match = matchDish(phrase, catalogue);
  return !!match.best && match.best.score >= CONFIDENT_SCORE;
};

/** What the utterance did, the way the sheet asks. */
function outcome(said, day) {
  const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
  return spokenPlanOutcome(plan, refusals, day);
}

/** A day holding the dishes it is given. */
function dayHolding(dishes) {
  const day = { mode: 'normal', guests: 0 };
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const name = dishes[slot];
    day[slot] = name ? { name, slot, servings: 2, createdAt: 1000 } : null;
  }
  return day;
}

console.log('\nthe catalogue really does hold dishes named with a refusal word');
{
  const names = catalogue.map((r) => r.name || '');
  const withNo = names.filter((n) => /\bno\b/i.test(n)).length;
  const withWithout = names.filter((n) => /\bwithout\b/i.test(n)).length;
  check('the catalogue holds names carrying "no"', withNo > 50, true);
  check('the catalogue holds names carrying "without"', withWithout > 5, true);
  check(
    '"No Onion No Garlic Lobia Masala" is one of them',
    names.some((n) => /No Onion No Garlic Lobia Masala/i.test(n)),
    true,
  );
}

console.log('\na dish whose own name carries a refusal word is a DISH');
{
  const said = 'no onion no garlic lobia masala for dinner';
  check(
    '"no onion no garlic lobia masala for dinner" files the whole dish',
    parseSpokenPlanResult(said, knownDish).plan,
    { dinner: 'no onion no garlic lobia masala' },
  );
  check(
    '... and raises no refusal at all',
    parseSpokenPlanResult(said, knownDish).refusals,
    [],
  );
  check(
    '... and the sheet says the plan is ready',
    outcome(said, undefined).kind,
    'plan',
  );
  check(
    '... and the dish the day is holding is NOT emptied',
    outcome(said, dayHolding({ dinner: 'No Onion No Garlic Lobia Masala' })).cleared,
    [],
  );
}

console.log('\nand the refusal word in the middle of a dish name does not cut it');
{
  check(
    '"tomato curry leaf chutney with no onion no garlic" is filed whole',
    parseSpokenPlanResult(
      'tomato curry leaf chutney with no onion no garlic for dinner',
      knownDish,
    ).plan,
    { dinner: 'tomato curry leaf chutney with no onion no garlic' },
  );
  check(
    '"red lentil curry without coconut" is filed whole',
    parseSpokenPlanResult('red lentil curry without coconut for dinner', knownDish).plan,
    { dinner: 'red lentil curry without coconut' },
  );
  check(
    '... and neither of them raises a refusal',
    parseSpokenPlanResult(
      'tomato curry leaf chutney with no onion no garlic for dinner',
      knownDish,
    ).refusals,
    [],
  );
}

console.log('\nand a refusal is still a refusal');
{
  const said = 'no dal for dinner';
  check(
    '"no dal for dinner" still names the dal',
    parseSpokenPlanResult(said, knownDish).refusals,
    [{ slot: 'dinner', dish: 'dal' }],
  );
  check(
    '... and still files no dish at all',
    parseSpokenPlanResult(said, knownDish).plan,
    {},
  );
  check(
    '... and still empties the dinner the app is holding',
    outcome(said, dayHolding({ dinner: 'dal' })).cleared,
    ['dinner'],
  );
  check(
    '"no lunch dal" is still a refusal',
    parseSpokenPlanResult('no lunch dal', knownDish).refusals,
    [{ slot: 'lunch', dish: 'dal' }],
  );
  check(
    '"no dal, no rice, biryani for dinner" still refuses two dishes',
    parseSpokenPlanResult('no dal, no rice, biryani for dinner', knownDish).refusals.length,
    2,
  );
  check(
    '... and still files the biryani',
    parseSpokenPlanResult('no dal, no rice, biryani for dinner', knownDish).plan,
    { dinner: 'biryani' },
  );
}

console.log('\nand two refusal words that name no dish are still two refusals');
{
  check(
    '"no onion no garlic for dinner" is not a dish the catalogue holds',
    knownDish('no onion no garlic'),
    false,
  );
  check(
    '... so both are still refused',
    parseSpokenPlanResult('no onion no garlic for dinner', knownDish).refusals.length,
    2,
  );
}

console.log('\nand a dish with a refusal word in its name can still be refused');
{
  const said = 'no no onion no garlic lobia masala for dinner';
  check(
    'the refusal names the dish the day is holding',
    outcome(said, dayHolding({ dinner: 'No Onion No Garlic Lobia Masala' })).cleared,
    ['dinner'],
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
