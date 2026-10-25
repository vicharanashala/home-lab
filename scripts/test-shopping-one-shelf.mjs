/**
 * Regression test: one shelf, one verdict.
 *
 * THE BUG
 *
 * The catalogue measures the same ingredient in more than one unit. Salt is in
 * teaspoons and tablespoons, milk in millilitres and litres, ginger in pieces
 * and grams. The shopping list collected the week's needs by (ingredient, unit),
 * so a week that used salt in both teaspoons and tablespoons produced TWO lines
 * for the salt — and each line was checked against the SAME shelf on its own.
 *
 * Each line therefore got its own "the kitchen has this" verdict, using the
 * WHOLE shelf:
 *
 *     the shelf holds   100 g Salt      = 83.3 ml = 16.7 tsp
 *     the week wants     15 tsp Salt    = 75 ml
 *     and                2 tbsp Salt   = 30 ml
 *                       -----------------
 *                        105 ml  <- more than the shelf holds
 *
 *     line 1  need 15 tsp  have 16.7 tsp  -> covered
 *     line 2  need 2 tbsp  have 5.6 tbsp  -> covered
 *
 * Both covered, so the salt never reached the list of things to buy, and the
 * app told the household it had everything. The second recipe was then cooked
 * from a shelf that was already 26 g short, and the cooking took the whole
 * jar.
 *
 * This is not a rounding error and it is not a unit label. It is the app
 * saying the kitchen is stocked when it is not.
 *
 * WHAT IT LOOKS LIKE TO THE USER
 *
 * The shopping list says there is nothing to buy. The salt runs out.
 *
 * THE RULE
 *
 * One shelf is one shelf. The week's needs for an ingredient are added up, and
 * the shelf is compared with the TOTAL — not with each line separately.
 *
 * WHY SOME INGREDIENTS STAY ON SEPARATE LINES
 *
 * A count is not a mass, so "2 pcs Ginger" and "50 g Ginger" cannot be added
 * up. Those stay as separate lines, and staying apart is safe: only one of
 * them can match a shelf row, because a shelf row is in one dimension too.
 *
 * THE PROOF
 *
 * The test drives the REAL shopping list, so the numbers it checks are the
 * numbers the app produced. It also drives the REAL deduction, to show that
 * the list and the cooking agree about the same shelf.
 *
 * Run with:  node scripts/test-shopping-one-shelf.mjs
 */
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

register('./lib/ts-resolve.mjs', import.meta.url);

const { buildShoppingList, missingItems } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/portions.ts')).href
);
const { planRecipeDeduction } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/recipeMatch.ts')).href
);
const { densityFor } = await import(pathToFileURL(path.join(REPO, 'src/utils/units.ts')).href);

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
  return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
}

/* -------------------------------------------------------------------------- */
/* The fixtures                                                                */
/* -------------------------------------------------------------------------- */

function stockItem(id, name, quantity, unit) {
  return {
    id,
    name,
    quantity,
    unit,
    category: 'other',
    location: 'pantry',
    lowStockThreshold: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function recipe(id, ingredient) {
  return {
    id,
    name: `Dish ${id}`,
    emoji: '🍛',
    mealType: 'dinner',
    baseServings: 2,
    ingredients: [ingredient],
  };
}

/** A plan with one dish on Monday and another on Tuesday. */
function week(...recipes) {
  const plan = {};
  recipes.forEach((r, i) => {
    const day = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][i];
    plan[day] = {
      breakfast: null,
      lunch: null,
      dinner: { recipeId: r.id, slot: 'dinner', servings: 2 },
      guests: 0,
    };
  });
  return plan;
}

function ingredient(name, quantity, unit) {
  return { name, quantity, unit, category: 'other' };
}

/* -------------------------------------------------------------------------- */
console.log('\nthe same ingredient in two units is one shelf, not two');
/* -------------------------------------------------------------------------- */
{
  // 100 g of salt = 83.3 ml = 16.7 tsp. The week wants 15 tsp + 2 tbsp = 105 ml.
  const stock = [stockItem('s1', 'Salt', 100, 'g')];
  const a = recipe('r1', ingredient('Salt', 15, 'tsp'));
  const b = recipe('r2', ingredient('Salt', 2, 'tbsp'));

  const needs = buildShoppingList(week(a, b), [a, b], stock);
  const salt = needs.filter((n) => n.name === 'Salt');
  const toBuy = missingItems(needs);

  check('the salt is one line, not two', salt.length, 1);
  check('and the line says how much the week wants', salt[0] && near(salt[0].needed, 21), true);
  check('in one unit', salt[0] && salt[0].unit, 'tsp');
  check('the shelf does NOT cover the week', salt[0] && salt[0].covered, false);
  check('so the salt is on the list to buy', toBuy.map((n) => n.name), ['Salt']);

  // AND the cooking agrees: the two dishes take more than the shelf holds.
  const shelfGrams = 100;
  let left = shelfGrams;
  for (const r of [a, b]) {
    const plan = planRecipeDeduction(
      r,
      2,
      stock.map((s) => ({ ...s, quantity: left })),
    );
    left = plan.deductions[0] ? plan.deductions[0].remainingBase : 0;
  }
  check('and cooking both dishes really does empty the shelf', near(left, 0), true);
  check('the shelf held less than the week wanted', left < shelfGrams, true);
}

/* -------------------------------------------------------------------------- */
console.log('\nthe ordinary case is untouched');
/* -------------------------------------------------------------------------- */
{
  // One ingredient, one unit, and the shelf covers it.
  const stock = [stockItem('s1', 'Rice', 1, 'kg')];
  const a = recipe('r1', ingredient('Rice', 500, 'g'));
  const needs = buildShoppingList(week(a), [a], stock);
  const rice = needs.find((n) => n.name === 'Rice');

  check('one line', needs.length, 1);
  check('the need is unchanged', rice && near(rice.needed, 500), true);
  check('the unit is unchanged', rice && rice.unit, 'g');
  check('the shelf covers it', rice && rice.covered, true);
  check('and it is not on the list to buy', missingItems(needs).length, 0);
  check('the shelf is reported in the need\'s own unit', rice && near(rice.have, 1000), true);
}
{
  // The same, with nothing on the shelf.
  const a = recipe('r1', ingredient('Rice', 500, 'g'));
  const needs = buildShoppingList(week(a), [a], []);
  const rice = needs.find((n) => n.name === 'Rice');

  check('one line', needs.length, 1);
  check('the need is unchanged', rice && near(rice.needed, 500), true);
  check('nothing is in stock', rice && rice.inStock, false);
  check('so it is on the list to buy', missingItems(needs).map((n) => n.name), ['Rice']);
}

/* -------------------------------------------------------------------------- */
console.log('\ntwo units that cannot be compared stay on separate lines');
/* -------------------------------------------------------------------------- */
{
  // A count is not a mass. "2 pcs Ginger" and "50 g Ginger" cannot be added up,
  // so they stay apart — and staying apart must not let the app claim the
  // kitchen has enough of both.
  const stock = [stockItem('s1', 'Ginger', 2, 'pcs')];
  const a = recipe('r1', ingredient('Ginger', 2, 'pcs'));
  const b = recipe('r2', ingredient('Ginger', 50, 'g'));
  const needs = buildShoppingList(week(a, b), [a, b], stock);
  const ginger = needs.filter((n) => n.name === 'Ginger');

  check('the two needs stay on two lines', ginger.length, 2);
  check('the count is covered by the shelf', ginger.find((n) => n.unit === 'pcs')?.covered, true);
  check('the mass is not — a count is not a mass', ginger.find((n) => n.unit === 'g')?.covered, false);
  check('and the ginger is on the list to buy', missingItems(needs).map((n) => n.name), ['Ginger']);
}

/* -------------------------------------------------------------------------- */
console.log('\nthe same shelf, measured the other way, gives the same verdict');
/* -------------------------------------------------------------------------- */
{
  // The shelf of salt in millilitres rather than grams.
  const ml = 100 / densityFor('Salt'); // 83.3 ml
  const stock = [stockItem('s1', 'Salt', ml, 'ml')];
  const a = recipe('r1', ingredient('Salt', 15, 'tsp'));
  const b = recipe('r2', ingredient('Salt', 2, 'tbsp'));
  const needs = buildShoppingList(week(a, b), [a, b], stock);

  check('the salt is one line', needs.filter((n) => n.name === 'Salt').length, 1);
  check('and the shelf still does not cover the week', needs.find((n) => n.name === 'Salt')?.covered, false);
  check('so the salt is still on the list to buy', missingItems(needs).map((n) => n.name), ['Salt']);
}

/* -------------------------------------------------------------------------- */
console.log('\ntwo needs in the same unit are added up, even an unknown one');
/* -------------------------------------------------------------------------- */
{
  // The catalogue has "slices" for bread, and the app has no unit for it. Two
  // recipes asking for two slices each is four slices — and that has to keep
  // working, or the list would tell the user to buy two slices twice.
  const a = recipe('r1', ingredient('Bread', 2, 'slices'));
  const b = recipe('r2', ingredient('Bread', 2, 'slices'));
  const needs = buildShoppingList(week(a, b), [a, b], []);
  const bread = needs.filter((n) => n.name === 'Bread');

  check('the bread is one line', bread.length, 1);
  check('and it is the whole of it', bread[0] && near(bread[0].needed, 4), true);
  check('in the unit the recipes asked in', bread[0] && bread[0].unit, 'slices');
}
{
  // The same, with the unit written differently.
  const a = recipe('r1', ingredient('Rice', 200, 'g'));
  const b = recipe('r2', ingredient('Rice', 300, 'g'));
  const needs = buildShoppingList(week(a, b), [a, b], []);
  const rice = needs.find((n) => n.name === 'Rice');

  check('the rice is one line', needs.length, 1);
  check('and it is the whole of it', rice && near(rice.needed, 500), true);
  check('in the unit the recipes asked in', rice && rice.unit, 'g');
}

/* -------------------------------------------------------------------------- */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
