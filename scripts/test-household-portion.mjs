/**
 * Regression test: a change to the HOUSEHOLD moves the dishes already on the plan.
 *
 * WHY THIS MATTERS
 * A day's portion is worked out from the household — how many people live
 * there and how much each of them eats — so a household that grows makes
 * every day want a bigger portion.
 *
 * The guest count was already handled: `setDayGuests` moves the dishes
 * already on that day when the number of guests changes, so the shopping
 * list keeps up with the people at the table. Changing the HOUSEHOLD itself
 * did not, and that is the same situation with a different cause.
 *
 * So the meal-plan card said "cooking for 4 today (4pax)" while the dish
 * beside it said 2pax, and the shopping list — which is built from the
 * servings on each dish — bought for two people.
 *
 * Run with:  node scripts/test-household-portion.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, which node's
// resolver refuses. The shared hook in scripts/lib teaches it to, so the test
// drives the REAL source rather than a copy of the maths.
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

/* ── the store, driven for real ────────────────────────────────────────────── */

let snap = null;
function Probe() {
  snap = useStore();
  return null;
}

/** Render once, so the snapshot is the state AFTER the last action. */
const refresh = () => {
  renderToString(createElement(Probe));
  return snap;
};

const H = (adults, children = 0, toddlers = 0, teens = 0) => ({
  adults,
  teens,
  children,
  toddlers,
  completed: true,
});

/**
 * Start from a clean plan for one household, with one dish planned for
 * Monday dinner at the size the day wants.
 */
function planDinner(household, servings) {
  refresh();
  snap.clearAllData();
  snap.completeHouseholdSurvey(household);
  refresh();
  const size = servings ?? suggestedServingsForDay(snap.mealPlan.mon, household);
  snap.setMealPlanSlot('mon', 'dinner', {
    name: 'Dal Makhani',
    recipeId: 'r1',
    slot: 'dinner',
    servings: size,
    createdAt: Date.now(),
  });
  refresh();
  return size;
}

console.log('\nthe household grows, and the dishes on the plan grow with it');
{
  const base = planDinner(H(2));
  eq(base, 2, 'two adults cook a small portion');

  snap.completeHouseholdSurvey(H(4));
  refresh();

  const day = snap.mealPlan.mon;
  eq(day.dinner.servings, 4, 'four adults — the dish is now a medium portion');
  eq(
    day.dinner.servings,
    suggestedServingsForDay(day, H(4)),
    'the dish matches what the day now wants',
  );
}

console.log('\nand shrinks');
{
  planDinner(H(4));
  snap.completeHouseholdSurvey(H(2));
  refresh();
  eq(snap.mealPlan.mon.dinner.servings, 2, 'back to two adults — the dish is small again');
}

console.log('\nthe children are counted too');
{
  planDinner(H(2, 1));
  snap.completeHouseholdSurvey(H(2, 3));
  refresh();
  const day = snap.mealPlan.mon;
  eq(
    day.dinner.servings,
    suggestedServingsForDay(day, H(2, 3)),
    'the dish follows the family',
    `${day.dinner.servings}pax`,
  );
}

console.log('\nthe guests on the day still count');
{
  planDinner(H(2));
  snap.setDayGuests('mon', 2);
  refresh();
  eq(snap.mealPlan.mon.dinner.servings, 4, 'the dish grew with the guests');

  snap.completeHouseholdSurvey(H(3));
  refresh();
  const day = snap.mealPlan.mon;
  eq(
    day.dinner.servings,
    suggestedServingsForDay(day, H(3)),
    'and it still matches the day after the household changes',
    `${day.dinner.servings}pax`,
  );
}

console.log('\na dish planned at its own size keeps its place on the ladder');
{
  // A deliberately large dinner on a small day.
  planDinner(H(2), 6);
  snap.completeHouseholdSurvey(H(4));
  refresh();
  // The day moved from 2 to 4 — one step up the ladder — so the dish moves one
  // step too and stays two steps above the day, exactly as it was.
  eq(snap.mealPlan.mon.dinner.servings, 9, 'the big dinner stays big');
}

console.log('\na day whose size did not change is left exactly as it was');
{
  // A dish given a size that is not on the ladder.
  planDinner(H(2), 3);
  // One toddler does not change this day's size: two adults and a toddler
  // still cook a small portion.
  snap.completeHouseholdSurvey(H(2, 0, 1));
  refresh();
  eq(snap.mealPlan.mon.dinner.servings, 3, 'the dish keeps the size the user gave it');
}

console.log('\nevery day of the week moves, not just the first');
{
  refresh();
  snap.clearAllData();
  snap.completeHouseholdSurvey(H(2));
  refresh();
  for (const day of ['mon', 'fri']) {
    snap.setMealPlanSlot(day, 'dinner', {
      name: 'Dal Makhani',
      recipeId: 'r1',
      slot: 'dinner',
      servings: 2,
      createdAt: Date.now(),
    });
  }
  refresh();
  snap.completeHouseholdSurvey(H(4));
  refresh();
  eq(snap.mealPlan.mon.dinner.servings, 4, 'Monday');
  eq(snap.mealPlan.fri.dinner.servings, 4, 'Friday');
}

console.log('\nchanging the household in Settings does the same thing');
{
  planDinner(H(2));
  // The Settings page saves the household through `updateSettings`, not
  // through the survey, so that path has to move the dishes too.
  snap.updateSettings({ household: { ...H(4), completed: true } });
  refresh();
  eq(snap.mealPlan.mon.dinner.servings, 4, 'the dish followed the household');
}

console.log('\nand the shopping list buys the bigger amount');
{
  const recipe = {
    id: 'r1',
    name: 'Dal Makhani',
    emoji: '🍛',
    mealType: 'dinner',
    baseServings: 2,
    ingredients: [{ name: 'Dal', quantity: 200, unit: 'g', category: 'grain' }],
  };

  planDinner(H(2));
  let dal = buildShoppingList(snap.mealPlan, [recipe], []).find((n) => n.name === 'Dal');
  eq(dal?.needed, 200, 'two adults buy 200 g of dal');

  snap.completeHouseholdSurvey(H(4));
  refresh();
  dal = buildShoppingList(snap.mealPlan, [recipe], []).find((n) => n.name === 'Dal');
  eq(dal?.needed, 400, 'four adults buy 400 g of dal');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
