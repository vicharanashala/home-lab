/**
 * Regression test: a day's portion must be measured in ONE unit.
 *
 * WHY THIS MATTERS
 * The app measures a household in ADULT EQUIVALENTS — an adult counts 1, a
 * teen ~0.9, a child ~0.6, a toddler ~0.4. That is what stops "3 kids" from
 * wildly overshooting the shopping list.
 *
 * The day's portion used to measure the household TWO ways. With no guests it
 * used the adult equivalents; with guests it added them to the raw HEAD count.
 * Adding guests to the head count silently re-measured the household's
 * children as full adults, so one guest over jumped a family of two adults
 * and three children from a medium portion (4) to a large one (6) — 50% more
 * food than that family eats — and the shopping list, which is built from the
 * servings on each dish, bought it.
 *
 * The expected numbers below are written out, not re-implemented: the app's
 * model is "the nearest standard portion to the household's adult equivalents,
 * plus one for each guest".
 *
 * TWO RULES THAT LOOK LIKE ONE
 * A household where EVERYONE at the table eats a whole serving is sized by
 * COVERING the people there: seven adults get nine servings, because six
 * servings is the size whose own label says it feeds "5–6 people", and the
 * shopping list — which is built from the servings on each dish — would buy
 * six people's worth of food for seven adults.
 *
 * A household WITH children is sized by its adult equivalents, which is a
 * fraction, and lands on the NEAREST size. One child must not push a family
 * of two adults and one child from two portions to four.
 *
 * A tie goes to the LARGER size: too much food can be kept for the next day,
 * too little cannot be made up. The two numbers below that changed with that
 * rule are the two households of adults whose need sits exactly between two
 * sizes — three people, and five.
 *
 * Run with:  node scripts/test-portion-measure.mjs
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

const H = (adults, children = 0, toddlers = 0, teens = 0) => ({
  adults,
  teens,
  children,
  toddlers,
  completed: true,
});

/** A day with nothing planned on it and a given number of guests over. */
const dayWithGuests = (guests) => ({ breakfast: null, lunch: null, dinner: null, guests });

console.log('\nthe day is measured in adult equivalents, guests and all');

/* Two adults — the household the app is built around. */
{
  const h = H(2);
  eq(suggestedServingsForDay(dayWithGuests(0), h), 2, '2 adults, no guests — 2');
  // Three people at the table: three is exactly between two sizes, and the
  // tie goes to the larger one. Two portions for three adults would leave the
  // shopping list a third short.
  eq(suggestedServingsForDay(dayWithGuests(1), h), 4, '2 adults, 1 guest — 4');
  eq(suggestedServingsForDay(dayWithGuests(2), h), 4, '2 adults, 2 guests — 4');
  // Five people at the table: five is exactly between four and six, and the
  // tie goes to six.
  eq(suggestedServingsForDay(dayWithGuests(3), h), 6, '2 adults, 3 guests — 6');
}

/* Two adults and a child — the household that first exposed the old rule. */
{
  const h = H(2, 1);
  eq(suggestedServingsForDay(dayWithGuests(0), h), 2, '2 adults + 1 child — 2');
  eq(suggestedServingsForDay(dayWithGuests(1), h), 4, '2 adults + 1 child, 1 guest — 4');
  eq(suggestedServingsForDay(dayWithGuests(2), h), 4, '2 adults + 1 child, 2 guests — 4');
  eq(suggestedServingsForDay(dayWithGuests(3), h), 6, '2 adults + 1 child, 3 guests — 6');
}

/* Two adults and two children. */
{
  const h = H(2, 2);
  eq(suggestedServingsForDay(dayWithGuests(0), h), 4, '2 adults + 2 children — 4');
  eq(suggestedServingsForDay(dayWithGuests(1), h), 4, '2 adults + 2 children, 1 guest — 4');
  eq(suggestedServingsForDay(dayWithGuests(2), h), 6, '2 adults + 2 children, 2 guests — 6');
  eq(suggestedServingsForDay(dayWithGuests(3), h), 6, '2 adults + 2 children, 3 guests — 6');
}

console.log('\nthe children do not grow into adults when a guest arrives');

/* Two adults and three children: 3.8 adult-equivalents, so a medium portion.
   One guest over makes it 4.8 — still a medium. The head count would say six
   people and a large portion, which is 50% more food than the family eats. */
{
  const h = H(2, 3);
  eq(suggestedServingsForDay(dayWithGuests(0), h), 4, '2 adults + 3 children — 4');
  eq(suggestedServingsForDay(dayWithGuests(1), h), 4, '2 adults + 3 children, 1 guest — 4');
  eq(suggestedServingsForDay(dayWithGuests(2), h), 6, '2 adults + 3 children, 2 guests — 6');
  eq(suggestedServingsForDay(dayWithGuests(3), h), 6, '2 adults + 3 children, 3 guests — 6');
}

/* One adult and two toddlers: 1.8 adult-equivalents — the smallest portion.
   A guest makes it 2.8, which is still the smallest one. */
{
  const h = H(1, 0, 2);
  eq(suggestedServingsForDay(dayWithGuests(0), h), 2, '1 adult + 2 toddlers — 2');
  eq(suggestedServingsForDay(dayWithGuests(1), h), 2, '1 adult + 2 toddlers, 1 guest — 2');
  eq(suggestedServingsForDay(dayWithGuests(2), h), 4, '1 adult + 2 toddlers, 2 guests — 4');
  eq(suggestedServingsForDay(dayWithGuests(3), h), 4, '1 adult + 2 toddlers, 3 guests — 4');
}

/* One adult and three children: 2.8 adult-equivalents. */
{
  const h = H(1, 3);
  eq(suggestedServingsForDay(dayWithGuests(0), h), 2, '1 adult + 3 children — 2');
  eq(suggestedServingsForDay(dayWithGuests(1), h), 4, '1 adult + 3 children, 1 guest — 4');
  eq(suggestedServingsForDay(dayWithGuests(2), h), 4, '1 adult + 3 children, 2 guests — 4');
  eq(suggestedServingsForDay(dayWithGuests(3), h), 6, '1 adult + 3 children, 3 guests — 6');
}

console.log('\nthe dishes already on the day end up at that size');

/* The store, driven for real. */
let snap = null;
function Probe() {
  snap = useStore();
  return null;
}
const refresh = () => {
  renderToString(createElement(Probe));
  return snap;
};

{
  const household = H(2, 3);
  refresh();
  snap.clearAllData();
  snap.completeHouseholdSurvey(household);
  refresh();
  snap.setMealPlanSlot('mon', 'dinner', {
    name: 'Dal Makhani',
    recipeId: 'r1',
    slot: 'dinner',
    servings: 4,
    createdAt: Date.now(),
  });
  refresh();

  // One guest over: the family eats 4.8 adult-equivalents, which is the same
  // medium portion it already has. The dish must not be doubled.
  snap.setDayGuests('mon', 1);
  refresh();
  eq(snap.mealPlan.mon.dinner.servings, 4, 'a guest does not grow the dish beyond the day');

  // Three guests over: 6.8 adult-equivalents — a large portion, 1.5x the medium.
  snap.setDayGuests('mon', 3);
  refresh();
  eq(snap.mealPlan.mon.dinner.servings, 6, 'three guests grow the dish to 6');
}

console.log('\nand the shopping list buys that much food');

{
  const household = H(2, 3);
  const recipe = {
    id: 'r1',
    name: 'Dal Makhani',
    emoji: '🍛',
    mealType: 'dinner',
    baseServings: 2,
    ingredients: [{ name: 'Dal', quantity: 200, unit: 'g', category: 'grain' }],
  };
  const plan = {
    mon: {
      breakfast: null,
      lunch: null,
      dinner: {
        name: 'Dal Makhani',
        recipeId: 'r1',
        slot: 'dinner',
        servings: suggestedServingsForDay(dayWithGuests(1), household),
        createdAt: 1,
      },
      guests: 1,
    },
    tue: { breakfast: null, lunch: null, dinner: null },
    wed: { breakfast: null, lunch: null, dinner: null },
    thu: { breakfast: null, lunch: null, dinner: null },
    fri: { breakfast: null, lunch: null, dinner: null },
    sat: { breakfast: null, lunch: null, dinner: null },
    sun: { breakfast: null, lunch: null, dinner: null },
  };
  const needs = buildShoppingList(plan, [recipe], []);
  const dal = needs.find((n) => n.name === 'Dal');
  // 200 g for 2 servings, cooked for 4 -> 400 g. A 6-serving day would buy 600 g.
  eq(dal?.needed, 400, 'the shopping list buys for 4 servings, not 6');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
