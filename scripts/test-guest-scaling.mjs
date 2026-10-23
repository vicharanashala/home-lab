/**
 * Regression tests for how the guest count on a day changes the portions.
 *
 * WHY THIS MATTERS
 * The shopping list is built from the servings on each planned dish, so the
 * number of servings a day holds is the number of shopping. Two rules must
 * never disagree:
 *
 *   1. What the day says it needs — `suggestedServingsForDay`, which is what
 *      the meal-plan header shows and what every path that FILLS a slot
 *      uses.
 *   2. What the store does to the dishes ALREADY on that day when the guest
 *      count changes.
 *
 * When those two disagreed, the same household got two different answers on
 * the same day: a dish picked after the guests were set got one size, and
 * the dish that was already on the plan got a smaller one. The shopping list
 * then bought too little for the people actually at the table.
 *
 * Run with:  node scripts/test-guest-scaling.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, which node's
// resolver refuses. The shared hook in scripts/lib teaches it to, so the test
// drives the REAL source rather than a copy of the maths.
register('./lib/ts-resolve.mjs', import.meta.url);

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { useStore } = await import('../src/store/useStore.ts');
const { suggestedServings, suggestedServingsForDay } = await import(
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

const TWO_ADULTS = { adults: 2, teens: 0, children: 0, toddlers: 0, completed: true };
const TWO_ADULTS_ONE_CHILD = {
  adults: 2,
  teens: 0,
  children: 1,
  toddlers: 0,
  completed: true,
};
const TWO_ADULTS_TWO_KIDS = {
  adults: 2,
  teens: 0,
  children: 2,
  toddlers: 0,
  completed: true,
};

/**
 * Start from a clean plan for one household, with one dish planned for dinner
 * at the household's usual portion size.
 */
function planDinner(household) {
  refresh();
  snap.clearAllData();
  snap.completeHouseholdSurvey(household);
  refresh();
  const base = suggestedServings(household);
  snap.setMealPlanSlot('mon', 'dinner', {
    name: 'Dal Makhani',
    recipeId: 'r1',
    slot: 'dinner',
    servings: base,
    createdAt: Date.now(),
  });
  refresh();
  return base;
}

console.log('\nthe dishes already on a day grow to the size the day needs');
{
  const household = TWO_ADULTS_ONE_CHILD;
  const base = planDinner(household);
  snap.setDayGuests('mon', 1);
  refresh();

  const day = snap.mealPlan.mon;
  const want = suggestedServingsForDay(day, household);
  eq(
    day.dinner.servings,
    want,
    'a dish planned before the guests were set is resized to what the day wants',
  );
  ok(
    day.dinner.servings > base,
    'the dish is bigger than it was without guests',
    `${base} -> ${day.dinner.servings}`,
  );
}

console.log('\nno household is left behind: every one of them agrees');
{
  const households = [
    ['2 adults', TWO_ADULTS],
    ['2 adults + 1 child', TWO_ADULTS_ONE_CHILD],
    ['2 adults + 2 children', TWO_ADULTS_TWO_KIDS],
  ];
  for (const [label, household] of households) {
    for (const guests of [1, 2, 3]) {
      planDinner(household);
      snap.setDayGuests('mon', guests);
      refresh();
      const day = snap.mealPlan.mon;
      const want = suggestedServingsForDay(day, household);
      eq(
        day.dinner.servings,
        want,
        `${label}, ${guests} guest${guests === 1 ? '' : 's'}`,
      );
    }
  }
}

console.log('\nremoving the guests puts the portions back');
{
  const household = TWO_ADULTS_ONE_CHILD;
  const base = planDinner(household);
  snap.setDayGuests('mon', 1);
  refresh();
  snap.setDayGuests('mon', 0);
  refresh();
  eq(snap.mealPlan.mon.dinner.servings, base, '0 -> 1 -> 0 guests leaves the dish as it was');
}

console.log('\nguests never shrink the food');
{
  const household = TWO_ADULTS;
  const base = planDinner(household);
  snap.setDayGuests('mon', 2);
  refresh();
  ok(
    snap.mealPlan.mon.dinner.servings >= base,
    'adding guests does not reduce the portion',
    `${base} -> ${snap.mealPlan.mon.dinner.servings}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
