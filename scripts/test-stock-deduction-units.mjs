/**
 * Regression test: a deduction must be expressed in the unit of the stock row
 * it is taken from.
 *
 * THE BUG
 *
 * A stock row is held in the unit the user measured it in, and a recipe asks
 * for its own. When those two units are different dimensions, the deduction
 * was resolved in the RECIPE's dimension and then subtracted from the stock
 * row's own base value:
 *
 *     const stkBase = toBaseUnit(it.quantity, it.unit);      // 10 tbsp -> 150 ml
 *     quantity: baseToDisplay(stkBase.value - deductedBase, it.unit);  // 150 - 100
 *
 * `deductedBase` was 100 GRAMS (the recipe asked for "100 g Oil") and
 * `stkBase.value` was 150 MILLILITRES. Subtracting one from the other is
 * subtracting two different things:
 *
 *     the shelf holds   10 tbsp Oil  =  150 ml  =  138 g of oil
 *     the recipe takes  100 g                   =  108.7 ml  =  7.25 tbsp
 *     so the row should read 2.75 tbsp
 *
 *     the app wrote    150 - 100 = 50 ml -> 50 / 15 = 3.33 tbsp
 *
 * Three and a third tablespoons of oil left on a shelf that holds two and
 * three quarters. And the row that the recipe empties is not emptied: a
 * 2 tbsp jar against a 100 g recipe is left at "0.16 tbsp", so the app keeps
 * an item the user has actually used up.
 *
 * WHY IT MATTERS MORE THAN A ROUNDING ERROR: the number on the shelf is the
 * number the user buys against, and the same household is measured in two
 * different units on two different screens — the preview says what is left in
 * grams, the row says what is left in tablespoons, and the two disagree.
 *
 * WHAT IS TESTED HERE
 *
 * The rule: the amount taken from a stock row, and the amount left on it, are
 * both in the ROW'S OWN unit — and the row that is written back says the same
 * number the preview showed.
 *
 * The test drives the REAL store, so the number on the shelf is the number
 * the app produced, not a number this file recomputed.
 *
 * Run with:  node scripts/test-stock-deduction-units.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');

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
 * and the state it loads is the one in the browser below.
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

/*
 * WHY NOTHING FROM THE FIXED CODE IS CALLED HERE: the test has to run against
 * the code BEFORE the fix as well as after it, and a test that calls a
 * function the old code does not have dies on the first assertion and takes
 * every other one with it. So the checks below read the values the app
 * produces — the deduction label the screen prints, the base amounts, and the
 * row the app writes — and nothing else.
 */
const { planRecipeDeduction } = await import(MATCH_URL);

/* -------------------------------------------------------------------------- */
console.log('\na shelf measured in spoons against a recipe in grams');
/* -------------------------------------------------------------------------- */
{
  // 10 tbsp Oil = 150 ml = 138 g. The recipe takes 100 g = 108.7 ml = 7.25 tbsp.
  const state = household(
    stockItem('s1', 'Oil', 10, 'tbsp'),
    { name: 'Oil', quantity: 100, unit: 'g', category: 'other' },
  );
  const { store, refresh } = await freshStore(state);

  const plan = planRecipeDeduction(state.recipes[0], 2, state.stock);
  const deduction = plan.deductions[0];

  check('the deduction is taken in the row\'s own unit', deduction.deductedLabel, '7.25 tbsp');
  check(
    'and what is left of the row is in that unit too',
    near(deduction.remainingBase, 41.3043),
    true,
  );

  refresh().logMealFromRecipe({ recipeId: 'r1', peopleCooked: 2 });

  const row = rowOf(store, 's1');
  check('the shelf says what is actually left', row && near(row.quantity, 2.7536), true);
  check('and it says it in the unit the row is held in', row && row.unit, 'tbsp');
}

/* -------------------------------------------------------------------------- */
console.log('\na shelf the recipe empties');
/* -------------------------------------------------------------------------- */
{
  // 2 tbsp Oil = 30 ml = 27.6 g. A 100 g recipe empties the jar.
  const state = household(
    stockItem('s1', 'Oil', 2, 'tbsp'),
    { name: 'Oil', quantity: 100, unit: 'g', category: 'other' },
  );
  const { store, refresh } = await freshStore(state);

  refresh().logMealFromRecipe({ recipeId: 'r1', peopleCooked: 2 });

  const row = rowOf(store, 's1');
  check('an emptied row is gone, not left with a remainder', row, null);
}

/* -------------------------------------------------------------------------- */
console.log('\nthe ordinary case is untouched');
/* -------------------------------------------------------------------------- */
{
  // 500 g Flour, recipe 200 g Flour -> 300 g left. The common case must not
  // move: the fix is about rows whose unit is a different DIMENSION.
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
  check('and it still says grams', row && row.unit, 'g');
}

/* -------------------------------------------------------------------------- */
console.log('\na recipe in spoons against a shelf in grams');
/* -------------------------------------------------------------------------- */
{
  // 1 cup Flour = 240 ml = 127.2 g. The shelf holds 500 g, so 372.8 g is left.
  // The preview used to print that number with NO UNIT AT ALL, because it
  // formatted the remainder in the recipe's dimension — a cup — which has no
  // name of its own.
  const state = household(
    stockItem('s1', 'Flour', 500, 'g'),
    { name: 'Flour', quantity: 1, unit: 'cup', category: 'other' },
  );
  const { store, refresh } = await freshStore(state);

  const plan = planRecipeDeduction(state.recipes[0], 2, state.stock);
  check(
    'the remainder is the grams left of the row',
    near(plan.deductions[0].remainingBase, 372.8),
    true,
  );

  refresh().logMealFromRecipe({ recipeId: 'r1', peopleCooked: 2 });

  const row = rowOf(store, 's1');
  check('and the shelf agrees with it', row && near(row.quantity, 372.8), true);
}

/* -------------------------------------------------------------------------- */
console.log('\nseveral recipes drawing on one spoon-measured row');
/* -------------------------------------------------------------------------- */
{
  // The combined path is a second implementation of the same rule, and it
  // had its own copy of the mistake.
  const state = household(
    stockItem('s1', 'Oil', 10, 'tbsp'),
    { name: 'Oil', quantity: 100, unit: 'g', category: 'other' },
  );
  state.recipes.push({
    id: 'r2',
    name: 'Second Dish',
    emoji: '🍲',
    mealType: 'lunch',
    baseServings: 2,
    ingredients: [{ name: 'Oil', quantity: 100, unit: 'g', category: 'other' }],
  });
  const { store, refresh } = await freshStore(state);

  refresh().logMealFromRecipes({ recipeIds: ['r1', 'r2'], peopleCooked: 2 });

  const row = rowOf(store, 's1');
  // 10 tbsp = 150 ml = 138 g. Two 100 g recipes take 138 g and empty the row.
  check('the row is emptied by the two recipes together', row, null);
}

/* -------------------------------------------------------------------------- */
console.log('\nthe preview says the same thing as the shelf');
/* -------------------------------------------------------------------------- */
{
  // The preview prints "−{deductedLabel}" and "→ {remaining} left". The
  // remaining is formatted in the row's unit, and the row is the thing the
  // user compares it against — so the component has to ask for the row's
  // unit, not the recipe's.
  //
  // WHY THE SOURCE IS CHECKED AND NOT THE COMPONENT: the preview lives in a
  // `.tsx` whose list is rendered inside an effect the server renderer does
  // not run, so rendering it would read an empty list and prove nothing.
  // Same reasoning as scripts/test-restore-safety-copy.mjs.
  const source = readFileSync(path.join(REPO, 'src/components/LogMealModal.tsx'), 'utf8');
  check(
    'the preview formats the remainder in the stock row\'s unit',
    source.includes('formatInUnit(d.remainingBase, d.stockItem.unit)'),
    true,
  );
  check(
    'and does not fall back to the recipe\'s unit',
    source.includes('formatBaseValue(d.remainingBase'),
    false,
  );
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
