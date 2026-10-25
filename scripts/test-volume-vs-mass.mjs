/**
 * Regression test: the same substance must give the same answer whichever unit
 * the user measured it in.
 *
 * THE BUG
 *
 * A stock row is held in the unit the user measured it in, and a recipe asks
 * for its own. When the two units were in different dimensions, the app could
 * only compare them if one of them was a SPOON measure — because the spoon
 * rule was written first, and a spoon is a volume too.
 *
 * So the app bridged:
 *
 *     a shelf in spoons   against a recipe in grams   -> compared
 *     a shelf in millilitres against a recipe in grams -> REFUSED
 *
 * And `ml` and `L` are the only volume units the app's own stock dropdown
 * offers (src/components/AddStockModal.tsx). So the case the user can actually
 * create is the case that did not work:
 *
 *     the shelf holds   150 ml Oil  =  138 g of oil
 *     the recipe takes  100 g                   =  108.7 ml
 *     so the row should read 41.3 ml left
 *
 *     the app did      nothing at all -> "150 ml", and the recipe was skipped
 *                     as a "unit mismatch"
 *
 * The same oil, measured in spoons instead, was deducted correctly. Two
 * spellings of one shelf, two different answers, and the wrong one was the one
 * the app's own dropdown produced.
 *
 * WHAT IT LOOKS LIKE TO THE USER
 *
 * The recipe empties a jar of oil and the jar is still full. The shopping list
 * says to buy the milk the user is standing next to, because a need in
 * millilitres was compared against a kilo and counted as nothing there.
 *
 * WHY IT MATTERS MORE THAN A ROUNDING ERROR: the number on the shelf is the
 * number the user buys against, and the same household is measured in two
 * different units on two different screens.
 *
 * WHAT IS TESTED HERE
 *
 * The rule: a volume and a mass are the same substance measured two ways, and
 * the ingredient's density is the honest bridge between them — whichever side
 * of the comparison the volume happens to be on.
 *
 * The test drives the REAL store and the REAL shopping list, so the numbers it
 * checks are the numbers the app produced, not numbers this file recomputed.
 *
 * WHY IT REPORTS ITS FAILURES RATHER THAN DYING ON THE OLD ANSWER: the test
 * has to run against the code BEFORE the fix as well as after it. It reads the
 * values the app produces and calls nothing that the old code does not have.
 *
 * Run with:  node scripts/test-volume-vs-mass.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { createElement } = require('react');
const { renderToString } = require('react-dom/server');

const STORE_URL = pathToFileURL(path.join(REPO, 'src/store/useStore.ts')).href;
const MATCH_URL = pathToFileURL(path.join(REPO, 'src/utils/recipeMatch.ts')).href;

/* -------------------------------------------------------------------------- */
/* A browser                                                                   */
/* -------------------------------------------------------------------------- */

/** What the browser holds. Replaced wholesale for each scenario. */
const held = {};

globalThis.window = {
  localStorage: {
    getItem: (k) => (k in held ? held[k] : null),
    setItem: (k, v) => { held[k] = v; },
    removeItem: (k) => { delete held[k]; },
  },
};
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A store with nothing in it yet, on top of the given household.
 *
 * WHY A FRESH MODULE EACH TIME: the store is a singleton, so the second
 * scenario would start with the first one's state still in it. The URL is
 * given a different query string each time so node loads a new instance —
 * and the state it loads is the one in the browser above.
 */
let scenario = 0;
async function freshStore(state) {
  held['homehub.v1'] = JSON.stringify(state);
  const store = await import(`${STORE_URL}?scenario=${scenario++}`);
  let snap = null;
  function Probe() {
    snap = store.useStore();
    return null;
  }
  renderToString(createElement(Probe));
  return { store, snap, refresh: () => { renderToString(createElement(Probe)); return snap; } };
}

/** A household holding one item and cooking one dish that uses it. */
function household(stockItem, ingredient) {
  return {
    grocery: [],
    stock: [stockItem],
    mealLogs: [],
    recipes: [{
      id: 'r1',
      name: 'Test Curry',
      emoji: '🍛',
      mealType: 'dinner',
      baseServings: 2,
      ingredients: [ingredient],
    }],
    mealPlan: {},
    settings: {
      expiringSoonDays: 3,
      hasSeenWelcome: true,
      userName: '',
      dietaryPreference: 'no-preference',
      allergies: [],
      theme: 'system',
      microphoneEnabled: false,
    },
  };
}

function stockItem(id, name, quantity, unit) {
  return {
    id, name, quantity, unit,
    category: 'other',
    location: 'pantry',
    lowStockThreshold: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

/** The row as the app left it. */
function rowOf(store, id) {
  return JSON.parse(store.exportAppData()).data.stock.find((s) => s.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

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

/** The same number, to the precision the app shows it at. */
function near(actual, expected, tolerance = 0.01) {
  return Math.abs(actual - expected) <= tolerance;
}

const { planRecipeDeduction } = await import(MATCH_URL);
const { buildShoppingList } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/portions.ts')).href
);

/* -------------------------------------------------------------------------- */
console.log('\na shelf measured in millilitres against a recipe in grams');
/* -------------------------------------------------------------------------- */
{
  // 150 ml Oil = 138 g. The recipe takes 100 g = 108.7 ml, so 41.3 ml is left.
  // 10 tbsp of the same oil leaves the same 41.3 ml.
  const state = household(
    stockItem('s1', 'Oil', 150, 'ml'),
    { name: 'Oil', quantity: 100, unit: 'g', category: 'other' },
  );
  const { store, refresh } = await freshStore(state);

  const plan = planRecipeDeduction(state.recipes[0], 2, state.stock);
  const deduction = plan.deductions[0];

  check('the recipe is not skipped as a unit mismatch', plan.skipped.length, 0);
  check('the deduction is taken in the row\'s own unit', deduction && deduction.deductedLabel, '108.7 ml');
  check(
    'and what is left of the row is in that unit too',
    deduction && near(deduction.remainingBase, 41.3043),
    true,
  );

  refresh().logMealFromRecipe({ recipeId: 'r1', peopleCooked: 2 });

  const row = rowOf(store, 's1');
  check('the shelf says what is actually left', row && near(row.quantity, 41.3043), true);
  check('and it says it in the unit the row is held in', row && row.unit, 'ml');
}

/* -------------------------------------------------------------------------- */
console.log('\nthe same oil, measured in spoons, gives the same answer');
/* -------------------------------------------------------------------------- */
{
  // 10 tbsp = 150 ml = 138 g — the same shelf, measured the other way.
  const state = household(
    stockItem('s1', 'Oil', 10, 'tbsp'),
    { name: 'Oil', quantity: 100, unit: 'g', category: 'other' },
  );
  const { store, refresh } = await freshStore(state);

  const plan = planRecipeDeduction(state.recipes[0], 2, state.stock);
  const deduction = plan.deductions[0];

  check('the recipe is not skipped as a unit mismatch', plan.skipped.length, 0);
  check(
    'and what is left is the same amount of oil',
    deduction && near(deduction.remainingBase, 41.3043),
    true,
  );

  refresh().logMealFromRecipe({ recipeId: 'r1', peopleCooked: 2 });

  const row = rowOf(store, 's1');
  check('the shelf says the same thing in spoons', row && near(row.quantity, 2.7536), true);
}

/* -------------------------------------------------------------------------- */
console.log('\nlitres are millilitres too');
/* -------------------------------------------------------------------------- */
{
  const state = household(
    stockItem('s1', 'Oil', 0.15, 'L'),
    { name: 'Oil', quantity: 100, unit: 'g', category: 'other' },
  );
  const { store, refresh } = await freshStore(state);

  const plan = planRecipeDeduction(state.recipes[0], 2, state.stock);
  check('the recipe is not skipped as a unit mismatch', plan.skipped.length, 0);

  refresh().logMealFromRecipe({ recipeId: 'r1', peopleCooked: 2 });

  const row = rowOf(store, 's1');
  check('the shelf says what is actually left', row && near(row.quantity, 0.0413043), true);
}

/* -------------------------------------------------------------------------- */
console.log('\nthe shopping list knows about the milk it is standing next to');
/* -------------------------------------------------------------------------- */
{
  // The week needs 500 ml of milk and the fridge holds 1 kg of it.
  const recipe = {
    id: 'r1',
    name: 'Porridge',
    emoji: '🥣',
    mealType: 'breakfast',
    baseServings: 2,
    ingredients: [{ name: 'Milk', quantity: 500, unit: 'ml', category: 'dairy' }],
  };
  const plan = {
    mon: {
      breakfast: { name: 'Porridge', recipeId: 'r1', slot: 'breakfast', servings: 2, createdAt: 1 },
      lunch: null,
      dinner: null,
      guests: 0,
    },
  };

  const needs = buildShoppingList(plan, [recipe], [stockItem('s1', 'Milk', 1, 'kg')]);
  const milk = needs.find((n) => n.name === 'Milk');

  check('the need is found', milk && milk.needed, 500);
  check('the kitchen is counted as having it', milk && milk.covered, true);
  // 1 kg of milk is 970.9 ml of it.
  check('and how much it has is in the need\'s own unit', milk && near(milk.have, 970.8737), true);
}

/* -------------------------------------------------------------------------- */
console.log('\na count is still not a mass');
/* -------------------------------------------------------------------------- */
{
  // Two onions is not two hundred grams of onion, and pretending it is would
  // delete the user's onions.
  const state = household(
    stockItem('s1', 'Onion', 100, 'g'),
    { name: 'Onion', quantity: 2, unit: 'pcs', category: 'other' },
  );
  const { store, refresh } = await freshStore(state);

  const plan = planRecipeDeduction(state.recipes[0], 2, state.stock);
  check('the recipe is skipped, not bridged', plan.skipped.length, 1);
  check('and nothing is taken off the shelf', plan.deductions.length, 0);

  refresh().logMealFromRecipe({ recipeId: 'r1', peopleCooked: 2 });

  const row = rowOf(store, 's1');
  check('the shelf is untouched', row && row.quantity, 100);
}

/* -------------------------------------------------------------------------- */
console.log('\nthe ordinary case is untouched');
/* -------------------------------------------------------------------------- */
{
  // 500 g Flour, recipe 200 g Flour -> 300 g left.
  const state = household(
    stockItem('s1', 'Flour', 500, 'g'),
    { name: 'Flour', quantity: 200, unit: 'g', category: 'other' },
  );
  const { store, refresh } = await freshStore(state);

  const plan = planRecipeDeduction(state.recipes[0], 2, state.stock);
  check('the deduction is unchanged', plan.deductions[0].deductedLabel, '200 g');

  refresh().logMealFromRecipe({ recipeId: 'r1', peopleCooked: 2 });

  const row = rowOf(store, 's1');
  check('the shelf is unchanged', row && near(row.quantity, 300), true);
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
