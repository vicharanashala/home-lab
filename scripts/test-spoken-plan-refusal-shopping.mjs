/**
 * Tests for a refusal reaching the SHOPPING LIST.
 *
 * WHY THIS EXISTS
 * Every other refusal test stops one link short. They check what the DAY
 * holds after the utterance is applied — the meal comes back empty, the dish
 * the user did not refuse is still there. That is the plan, and the plan is
 * not what the user buys.
 *
 * The shopping list is built from the plan, so the chain the refusal has to
 * travel is:
 *
 *   spoken refusal -> the meal it empties -> the plan slot set to null
 *                   -> the shopping list -> the dish is NOT bought
 *
 * The last link is the one the owner sees. The list is what goes to the
 * shop: a refused dal that is still on the list is a dal that is bought, and
 * the sheet can say "the refusal had nothing to remove" while the dal goes
 * into the basket anyway. The plan-level tests cannot see that at all — they
 * never build a list.
 *
 * So this file builds the list and checks what is ON it.
 *
 * WHY THE PLAN IS WRITTEN THROUGH THE REAL STORE: the refusal empties a meal
 * by setting that meal's slot to null, and the shopping list reads the plan
 * the store holds. A test that wrote its own plan object would be testing two
 * halves that never touch, and the link between them — the same state, read
 * by the list — is exactly the link that can rot. Here the meal is emptied
 * with the store's own `setMealPlanSlot(day, slot, null)`, which is what the
 * page calls, and the list is built from `snap.mealPlan`, which is what the
 * list is built from.
 *
 * WHY A DISH THE USER DID NOT REFUSE IS CHECKED TOO: a rule that emptied
 * every meal would pass a test that only asks "is the refused dish gone?".
 * The control is the other half of the promise — the dishes the user did not
 * refuse are still bought.
 *
 * WHY THE RECIPE IS A FIXTURE AND NOT A CATALOGUE DISH: the test is about the
 * chain, not about the catalogue. A scraped recipe's ingredients change
 * whenever the scrape is redone, and a test that breaks on a re-scrape
 * teaches people to ignore it. The fixture has ONE ingredient with a name
 * nothing else uses, so the list says plainly whether it was bought.
 *
 * WHY THE REAL CATALOGUE IS STILL USED FOR THE PARSER: the parser decides
 * whether a refusal word is a refusal or part of a dish's own NAME by asking
 * the catalogue, and the page hands it the real one. A test that answered
 * that question with a fixture would be testing a parser the app does not
 * run.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-shopping.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { useStore } = await import('../src/store/useStore.ts');
const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanEntries, spokenPlanClears } = await import('../src/utils/spokenPlanEntries.ts');
const { isDishName } = await import('../src/utils/spokenRecipeMatch.ts');
const { buildShoppingList } = await import('../src/utils/portions.ts');

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);

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

const NOW = 1_700_000_000_000;
const HOUSEHOLD = { adults: 2, children: 0, guests: 0 };

/**
 * The two dishes this test uses, each with ONE ingredient whose name nothing
 * else uses, so the list says plainly whether it was bought.
 */
const DAL = {
  id: 'refusal-shopping-dal',
  name: 'Dal',
  emoji: '🍲',
  mealType: 'dinner',
  baseServings: 2,
  ingredients: [{ name: 'Refusal probe dal', quantity: 200, unit: 'g', category: 'grain' }],
  cuisine: 'Indian',
  totalTime: 30,
  source: 'test',
};
const BIRYANI = {
  id: 'refusal-shopping-biryani',
  name: 'Biryani',
  emoji: '🍛',
  mealType: 'lunch',
  baseServings: 2,
  ingredients: [{ name: 'Refusal probe rice', quantity: 300, unit: 'g', category: 'grain' }],
  cuisine: 'Indian',
  totalTime: 45,
  source: 'test',
};

const shopCatalogue = [...catalogue, DAL, BIRYANI];

/** The page's own answer to "is this phrase a dish the app knows?". */
const knownDish = (phrase) => isDishName(phrase, shopCatalogue);

// The store, the way the page sees it.
let snap = null;
function Probe() {
  snap = useStore();
  return null;
}
const refresh = () => {
  renderToString(createElement(Probe));
  return snap;
};

/** A day holding the dishes it is given. */
function dayHolding(dishes) {
  const day = { mode: 'normal', guests: 0 };
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const name = dishes[slot];
    day[slot] = name
      ? {
          name,
          slot,
          recipeId: name === 'dal' ? DAL.id : BIRYANI.id,
          servings: 2,
          createdAt: NOW,
        }
      : null;
  }
  return day;
}

/**
 * Put a day on the plan, the way the page does, through the store.
 */
function planDay(dishes) {
  const day = dayHolding(dishes);
  refresh();
  snap.clearAllData();
  refresh();
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    if (day[slot]) snap.setMealPlanSlot('mon', slot, day[slot]);
  }
  refresh();
  return day;
}

/**
 * The shopping list after the utterance is applied, the way the page applies
 * it: the meals a refusal emptied come off the plan, and the dishes the user
 * said go on after.
 */
function shoppingListAfter(said, current) {
  const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
  const entries = spokenPlanEntries(plan, {}, current, HOUSEHOLD);
  const cleared = spokenPlanClears(refusals, plan, current);
  for (const slot of cleared) snap.setMealPlanSlot('mon', slot, null);
  for (const { slot, entry } of entries) snap.setMealPlanSlot('mon', slot, entry);
  refresh();
  const needs = buildShoppingList(snap.mealPlan, shopCatalogue, []);
  return {
    cleared,
    holds: {
      breakfast: snap.mealPlan.mon.breakfast ? snap.mealPlan.mon.breakfast.name : null,
      lunch: snap.mealPlan.mon.lunch ? snap.mealPlan.mon.lunch.name : null,
      dinner: snap.mealPlan.mon.dinner ? snap.mealPlan.mon.dinner.name : null,
    },
    bought: needs.map((n) => n.name).sort(),
  };
}

console.log('\nthe list buys the dal to begin with');
{
  planDay({ dinner: 'dal' });
  const needs = buildShoppingList(snap.mealPlan, shopCatalogue, []);
  check(
    'the dal is on the list while the day holds it',
    needs.map((n) => n.name).includes('Refusal probe dal'),
    true,
  );
}

console.log('\nand a refused dish is NOT bought');
{
  const day = planDay({ dinner: 'dal' });
  const result = shoppingListAfter('no dal for dinner', day);
  check('the dinner is emptied', result.cleared, ['dinner']);
  check('the dal is off the plan', result.holds, {
    breakfast: null,
    lunch: null,
    dinner: null,
  });
  check('and the shopping list buys no dal', result.bought, []);
}

console.log('\nwhile the dishes the user did NOT refuse are still bought');
{
  const day = planDay({ lunch: 'biryani', dinner: 'dal' });
  const result = shoppingListAfter('no dal for dinner', day);
  check('only the dinner is emptied', result.cleared, ['dinner']);
  check('the biryani is still on the plan', result.holds, {
    breakfast: null,
    lunch: 'biryani',
    dinner: null,
  });
  check(
    'and the shopping list still buys the biryani',
    result.bought,
    ['Refusal probe rice'],
  );
}

console.log('\na refusal that names no meal empties every meal holding the dish');
{
  const day = planDay({ breakfast: 'dal', lunch: 'biryani', dinner: 'dal' });
  const result = shoppingListAfter('no dal', day);
  check('both dals are emptied', result.cleared, ['breakfast', 'dinner']);
  check('and the shopping list buys no dal', result.bought, ['Refusal probe rice']);
}

console.log('\na refusal of a meal empties that meal whatever it holds');
{
  const day = planDay({ lunch: 'biryani', dinner: 'dal' });
  const result = shoppingListAfter('no dinner', day);
  check('the dinner is emptied', result.cleared, ['dinner']);
  check('and the shopping list buys no dal', result.bought, ['Refusal probe rice']);
}

console.log('\nand a refusal of a dish nothing holds changes nothing');
{
  const day = planDay({ lunch: 'biryani', dinner: 'biryani' });
  const result = shoppingListAfter('no dal for dinner', day);
  check('no meal is emptied', result.cleared, []);
  check('the list still buys both dishes', result.bought, ['Refusal probe rice']);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
