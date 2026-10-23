/**
 * Regression test: a day's portion must stay on the app's own portion ladder.
 *
 * WHY THIS MATTERS
 * The app offers exactly five portion sizes — 2, 4, 6, 9 and 12 — and the
 * meal plan draws those five as buttons. A dish whose servings is not one of
 * them is a number the app cannot show as a chosen portion, cannot come back
 * to from the editor, and buys on the shopping list.
 *
 * The guest stepper used to scale the dishes already on a day by the RATIO
 * between the day's old size and its new one. That keeps the two in step only
 * while the dish IS the day's size — the common case, and the only case the
 * other tests covered. A dish deliberately planned at a different size drifted
 * further with every step: a 9-serving dinner became 14, then 21, then 27
 * servings for a day of ten people, and the shopping list bought five times
 * the food the day needs.
 *
 * The rule now is that a dish keeps its PLACE on the ladder and the day
 * carries it up the same number of steps.
 *
 * Run with:  node scripts/test-guest-portion-levels.mjs
 */
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { useStore } = await import('../src/store/useStore.ts');
const { PORTION_LEVELS, suggestedServingsForDay } = await import(
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

/** The sizes the app actually offers, so the test never re-implements them. */
const LEVELS = PORTION_LEVELS.map((p) => p.servings);
const BIGGEST = Math.max(...LEVELS);

let snap = null;
function Probe() {
  snap = useStore();
  return null;
}
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
 * Put one dish of the given size on Monday for this household, then walk the
 * guest count up one at a time and report what the store does to it.
 */
function walkGuests(household, startServings, upTo = 4) {
  refresh();
  snap.clearAllData();
  snap.completeHouseholdSurvey(household);
  refresh();
  snap.setMealPlanSlot('mon', 'dinner', {
    name: 'Dal Makhani',
    recipeId: 'r1',
    slot: 'dinner',
    servings: startServings,
    createdAt: Date.now(),
  });
  refresh();

  const seen = [];
  for (let g = 1; g <= upTo; g++) {
    snap.setDayGuests('mon', g);
    refresh();
    seen.push(snap.mealPlan.mon.dinner.servings);
  }
  return seen;
}

console.log('\nevery size the guest stepper produces is one the app offers');

{
  // Households whose adult-equivalents land between two portions, so the day
  // crosses a step — the case where the old ratio drifted.
  const households = [
    ['2 adults', H(2)],
    ['2 adults + 1 child', H(2, 1)],
    ['2 adults + 2 children', H(2, 2)],
    ['2 adults + 3 children', H(2, 3)],
    ['2 adults + 4 children', H(2, 4)],
    ['2 adults + 8 children', H(2, 8)],
    ['1 adult + 3 children', H(1, 3)],
    ['1 adult + 2 toddlers', H(1, 0, 2)],
  ];
  const offLadder = [];
  for (const [label, household] of households) {
    for (const start of LEVELS) {
      for (const servings of walkGuests(household, start)) {
        if (!LEVELS.includes(servings)) {
          offLadder.push(`${label}, dish ${start}pax -> ${servings}pax`);
        }
      }
    }
  }
  ok(
    offLadder.length === 0,
    'no dish ever lands on a size the app does not offer',
    offLadder.length === 0 ? '8 households x 5 sizes x 4 guests' : offLadder.join('; '),
  );
}

console.log('\nand no dish is ever bigger than the largest size offered');

{
  const tooBig = [];
  for (const [label, household] of [
    ['2 adults + 4 children', H(2, 4)],
    ['2 adults + 8 children', H(2, 8)],
  ]) {
    for (const start of LEVELS) {
      for (const servings of walkGuests(household, start, 6)) {
        if (servings > BIGGEST) tooBig.push(`${label}, dish ${start}pax -> ${servings}pax`);
      }
    }
  }
  ok(
    tooBig.length === 0,
    'a dinner does not grow past the biggest portion',
    tooBig.length === 0 ? `never above ${BIGGEST}pax` : tooBig.join('; '),
  );
}

console.log('\nthe dinner that used to run away does not');

{
  // The exact case that broke: a "Family" dinner (9) on a day that grows as
  // guests arrive. It used to read 14, then 21, then 27.
  const household = H(2, 4);
  const seen = walkGuests(household, 9);
  ok(
    seen.every((s) => s <= BIGGEST),
    'a 9-serving dinner stays within the portion sizes',
    seen.join(' -> '),
  );
  ok(
    !seen.includes(14) && !seen.includes(21),
    'the runaway sizes are gone',
    seen.join(' -> '),
  );
}

console.log('\nthe dish keeps its place on the ladder');

{
  // A dish planned bigger than the day stays bigger; one planned smaller
  // stays smaller. The day moves; the dish keeps its position.
  const household = H(2, 4);       // 4.4 adult-equivalents -> a medium day (4)
  refresh();
  snap.clearAllData();
  snap.completeHouseholdSurvey(household);
  refresh();
  snap.setMealPlanSlot('mon', 'dinner', {
    name: 'Dal Makhani', recipeId: 'r1', slot: 'dinner', servings: 9, createdAt: Date.now(),
  });
  snap.setMealPlanSlot('mon', 'lunch', {
    name: 'Roti', recipeId: 'r2', slot: 'lunch', servings: 2, createdAt: Date.now(),
  });
  refresh();

  const dayBefore = suggestedServingsForDay(snap.mealPlan.mon, household);
  snap.setDayGuests('mon', 1);
  refresh();
  const dayAfter = suggestedServingsForDay(snap.mealPlan.mon, household);

  ok(
    snap.mealPlan.mon.dinner.servings > dayAfter,
    'the bigger dinner is still bigger than the day',
    `day ${dayBefore}pax -> ${dayAfter}pax, dinner ${snap.mealPlan.mon.dinner.servings}pax`,
  );
  ok(
    snap.mealPlan.mon.lunch.servings < dayAfter,
    'the smaller lunch is still smaller than the day',
    `day ${dayBefore}pax -> ${dayAfter}pax, lunch ${snap.mealPlan.mon.lunch.servings}pax`,
  );
}

console.log('\nguests never shrink the food');

{
  const household = H(2, 4);
  for (const start of LEVELS) {
    const seen = walkGuests(household, start);
    ok(
      seen.every((s) => s >= start),
      `a ${start}pax dish never gets smaller`,
      seen.join(' -> '),
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
