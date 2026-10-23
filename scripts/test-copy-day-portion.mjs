/**
 * Regression test: a copied day must take the TARGET day's portion.
 *
 * WHY THIS MATTERS
 * The shopping list is built from the servings on each planned dish, so the
 * number a dish is written with IS the number of food that gets bought. Every
 * other way of putting a dish on a day agrees on one rule — the day's
 * portion, the number the meal-plan header prints and the guest scaling
 * applies. Copying a day was the one path that did not: it carried the
 * SOURCE day's servings onto the target day.
 *
 * The copy keeps the target day's own guest count (and its way of eating and
 * its note) — copying Monday's dinners onto a vrat day must not quietly turn
 * it into an ordinary day. So the two halves disagreed: the target day said
 * "six people over, cook for six" and the dish it now held said four, and the
 * shopping list bought for four.
 *
 * Two adults and three children, with two guests over on Saturday: the day
 * wants 6 servings, Monday's dinner is written for 4, and the copy left the
 * dish at 4. The shopping list bought 400 g of dal where the day eats 600 g.
 *
 * The expected numbers are written out rather than re-implemented: the day's
 * portion is the nearest standard portion to the household's adult equivalents
 * plus one for each guest.
 *
 * Run with:  node scripts/test-copy-day-portion.mjs
 */
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { useStore } = await import('../src/store/useStore.ts');
const { suggestedServingsForDay, buildShoppingList } = await import(
  '../src/utils/portions.ts'
);

let passed = 0;
let failed = 0;

function ok(cond, label, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function eq(got, want, label) {
  ok(got === want, label, got === want ? String(got) : `got ${got}, expected ${want}`);
}

/* -------------------------------------------------------------------------- */
/* The store, driven for real                                                  */
/* -------------------------------------------------------------------------- */

let snap = null;
function Probe() {
  snap = useStore();
  return null;
}
const refresh = () => {
  renderToString(createElement(Probe));
  return snap;
};

/** Two adults and three children — 3.8 adult equivalents, so a medium day. */
const HOUSEHOLD = {
  adults: 2,
  teens: 0,
  children: 3,
  toddlers: 0,
  completed: true,
};

/** The recipe the plan points at, so the shopping list has something to buy. */
const RECIPE = {
  id: 'r-dal',
  name: 'Dal Makhani',
  emoji: '🍛',
  mealType: 'dinner',
  baseServings: 2,
  ingredients: [{ name: 'Dal', quantity: 200, unit: 'g', category: 'grain' }],
};

function planDinner(day, servings) {
  refresh();
  snap.setMealPlanSlot(day, 'dinner', {
    name: RECIPE.name,
    recipeId: RECIPE.id,
    slot: 'dinner',
    servings,
    createdAt: Date.now(),
  });
  refresh();
}

refresh();
snap.clearAllData();
snap.completeHouseholdSurvey(HOUSEHOLD);
refresh();

console.log('\na copied dish takes the portion the TARGET day wants');

{
  // Monday: the household's ordinary day — a medium portion, 4 servings.
  planDinner('mon', 4);
  // Saturday: two guests over, so that day wants 6.
  refresh();
  snap.setDayGuests('sat', 2);
  refresh();

  const satWant = suggestedServingsForDay(snap.mealPlan.sat, HOUSEHOLD);
  eq(satWant, 6, 'Saturday with two guests over wants 6 servings');

  snap.copyMealPlanDay('mon', 'sat');
  refresh();

  eq(
    snap.mealPlan.sat.dinner?.servings,
    satWant,
    'the copied dinner is written for the portion Saturday wants',
  );
  eq(snap.mealPlan.sat.guests, 2, 'the copied day keeps its own guest count');
  eq(
    snap.mealPlan.mon.dinner?.servings,
    4,
    'the day that was copied from is left alone',
  );
}

console.log('\nand the shopping list buys that much food');

{
  // Only Saturday's dinner is left, so the total is that one dish's food and
  // not the whole week's.
  refresh();
  snap.clearMealPlanDay('mon');
  refresh();

  const needs = buildShoppingList(snap.mealPlan, [RECIPE], []);
  const dal = needs.find((n) => n.name === 'Dal');
  // 200 g for 2 servings, cooked for 6 -> 600 g. A 4-serving day buys 400 g.
  eq(dal?.needed, 600, 'the shopping list buys for 6 servings, not 4');
}

console.log('\ncopying to a day that wants the same portion changes nothing');

{
  // Tuesday has no guests, so it wants the same 4 servings as Monday.
  planDinner('mon', 4);
  refresh();
  snap.copyMealPlanDay('mon', 'tue');
  refresh();
  eq(snap.mealPlan.tue.dinner?.servings, 4, 'the copied dinner stays at 4');
}

console.log('\na day with no guests wants the household\'s own portion');

{
  planDinner('mon', 4);
  refresh();
  snap.copyMealPlanDay('mon', 'wed');
  refresh();
  eq(
    snap.mealPlan.wed.dinner?.servings,
    suggestedServingsForDay(snap.mealPlan.wed, HOUSEHOLD),
    'the copied dinner matches the day it landed on',
  );
  eq(snap.mealPlan.wed.dinner?.servings, 4, 'and that is 4 for this household');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
