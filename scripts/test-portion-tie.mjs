/**
 * Regression test: a need that lands exactly BETWEEN two portion sizes.
 *
 * WHY THIS MATTERS
 * The portion ladder is the app's published promise about how many people a
 * size feeds — Small is "1–2 people", Medium is "3–4 people", Large is "5–6",
 * Family is "7–9", Big is "10+".
 *
 * A household of three adults sits exactly between Small and Medium, and so
 * does a household of two adults with one guest over. The tie used to go to
 * the SMALLER size, which made the app cook two portions for three people —
 * and because the shopping list is built from the servings on each dish, it
 * bought two portions' worth of food for three adults. The same day also
 * printed two numbers that disagreed with each other: the meal-plan card
 * said "cooking for 3 today (2pax)".
 *
 * The tie now goes to the LARGER size. That is what the ladder's own blurb
 * says — three people is a "3–4 people" size — and it is what the reason
 * for the rule always was: too much food can be kept for the next day, too
 * little cannot be made up.
 *
 * The numbers below are written out, not re-implemented from the app's own
 * maths, so the test fails if the rule changes.
 *
 * Run with:  node scripts/test-portion-tie.mjs
 */
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { useStore } = await import('../src/store/useStore.ts');
const { suggestedServings, suggestedServingsForDay, dayHeadCount, buildShoppingList } =
  await import('../src/utils/portions.ts');

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

/** A household of `adults` adults, and nothing else. */
const H = (adults) => ({
  adults,
  teens: 0,
  children: 0,
  toddlers: 0,
  completed: true,
});

/** A day with nothing planned on it and a given number of guests over. */
const dayWithGuests = (guests) => ({ breakfast: null, lunch: null, dinner: null, guests });

console.log('\nevery people-count lands on the size whose blurb covers it');

{
  // The ladder, as the app publishes it:
  //   2 serves 1–2 people · 4 serves 3–4 · 6 serves 5–6 · 9 serves 7–9 · 12 serves 10+
  const expected = [
    [1, 2], [2, 2], [3, 4], [4, 4], [5, 6], [6, 6],
    [7, 9], [8, 9], [9, 9], [10, 12], [11, 12], [12, 12],
  ];
  for (const [people, servings] of expected) {
    eq(suggestedServings(H(people)), servings, `${people} ${people === 1 ? 'adult' : 'adults'}`);
  }
}

console.log('\nthe day feeds everyone at the table');

{
  // Everyone at the table is an adult, so the head count and the need are the
  // same number — and the portion must cover it.
  for (const adults of [1, 2, 3, 4, 5, 6]) {
    for (const guests of [0, 1, 2, 3, 4]) {
      const h = H(adults);
      const day = dayWithGuests(guests);
      const heads = dayHeadCount(day, h);
      const servings = suggestedServingsForDay(day, h);
      ok(
        servings >= heads,
        `${adults} adults + ${guests} guest${guests === 1 ? '' : 's'} — ${heads} at the table, ${servings} servings`,
        servings >= heads ? '' : `${servings} servings cannot feed ${heads} people`,
      );
    }
  }
}

console.log('\na guest over bumps the day, not just the label');

{
  const h = H(2);
  const base = suggestedServings(h);
  eq(base, 2, 'two adults cook for 2 to begin with');
  eq(suggestedServingsForDay(dayWithGuests(1), h), 4, 'one guest over cooks for 4');
  eq(suggestedServingsForDay(dayWithGuests(2), h), 4, 'two guests over cook for 4');
  eq(suggestedServingsForDay(dayWithGuests(3), h), 6, 'three guests over cook for 6');
}

console.log('\nand the shopping list buys food for everyone at the table');

{
  // The whole chain, driven through the real store: three adults, one dish,
  // and the week's shopping list.
  let snap = null;
  function Probe() {
    snap = useStore();
    return null;
  }
  const refresh = () => {
    renderToString(createElement(Probe));
    return snap;
  };

  const recipe = {
    id: 'r1',
    name: 'Dal Makhani',
    emoji: '🍛',
    mealType: 'dinner',
    baseServings: 2,
    ingredients: [{ name: 'Dal', quantity: 200, unit: 'g', category: 'grain' }],
  };

  const household = H(3);
  refresh();
  snap.clearAllData();
  snap.completeHouseholdSurvey(household);
  refresh();
  snap.setMealPlanSlot('mon', 'dinner', {
    name: 'Dal Makhani',
    recipeId: 'r1',
    slot: 'dinner',
    servings: suggestedServingsForDay(dayWithGuests(0), household),
    createdAt: Date.now(),
  });
  refresh();

  eq(snap.mealPlan.mon.dinner.servings, 4, 'the dish is planned for 4 — three adults eat');

  const needs = buildShoppingList(snap.mealPlan, [recipe], []);
  const dal = needs.find((n) => n.name === 'Dal');
  // 200 g for 2 servings, cooked for 4 -> 400 g. Two servings would be 200 g,
  // which is two thirds of what three adults eat.
  eq(dal?.needed, 400, 'the shopping list buys for four servings');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
