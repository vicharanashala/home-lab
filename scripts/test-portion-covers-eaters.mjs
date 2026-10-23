/**
 * Regression test: the planned portion must feed everyone who eats a WHOLE
 * serving.
 *
 * WHY THIS MATTERS
 * The portion ladder publishes what each size feeds — Small is "1–2 people",
 * Medium "3–4", Large "5–6", Family "7–9", Big "10+". A household where
 * everyone at the table eats a whole serving is sized by the smallest size
 * that COVERS it, so seven adults get nine servings, not six.
 *
 * A household with children is sized differently, and deliberately so: the
 * need is measured in ADULT EQUIVALENTS and lands on the NEAREST size,
 * because one child must not push a family of two adults and one child from
 * two portions to four. The share the app is allowed to come up short on is
 * the CHILD'S — that is the whole point of measuring in adult equivalents.
 *
 * But "come up short on the child's share" is not the same as "come up short
 * on anybody". The rule rounded to the nearest size of the adult-equivalent
 * need, and when enough guests were over that rounding fell BELOW the number
 * of people who eat a whole serving:
 *
 *   2 adults + 1 toddler + 5 guests = 7 people who eat a whole serving
 *   adult equivalents = 2 + 0.4 + 5 = 7.4, and the nearest size to 7.4 is 6
 *   → the plan said 6 servings for 7 people who each eat a whole serving
 *
 * The shopping list is built from the servings on each dish, so it bought
 * six people's worth of food for seven, and the meal-plan card printed two
 * numbers that disagreed with each other.
 *
 * The fix keeps the nearest-size rule for the children's own share but puts a
 * floor under it: the size must also cover the adults, the teens and the
 * guests. Nothing is bought beyond what the table needs — the floor is the
 * smallest size that covers the whole-serving eaters, which is never larger
 * than the size that covers the full adult-equivalent need.
 *
 * Run with:  node scripts/test-portion-covers-eaters.mjs
 */
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { useStore } = await import('../src/store/useStore.ts');
const { suggestedServingsForDay, suggestedServings, buildShoppingList } = await import(
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

/** A household of `adults` adults, and the other groups. */
const H = (adults, children = 0, toddlers = 0, teens = 0) => ({
  adults,
  teens,
  children,
  toddlers,
  completed: true,
});

/** A day with nothing planned on it and a given number of guests over. */
const dayWithGuests = (guests) => ({ breakfast: null, lunch: null, dinner: null, guests });

console.log('\nthe size feeds everyone who eats a whole serving');

{
  // The household, the guests, and the size the day planned.
  // Every one of these leaves a table where more people eat a whole serving
  // than the planned size feeds.
  const cases = [
    { h: H(2, 0, 1), guests: 5, want: 9 },
    { h: H(2, 0, 1, 2), guests: 3, want: 9 },
    { h: H(1, 0, 1, 1), guests: 5, want: 9 },
    { h: H(1, 0, 1), guests: 6, want: 9 },
    { h: H(3, 0, 1), guests: 4, want: 9 },
    { h: H(1, 0, 1, 1), guests: 8, want: 12 },
  ];
  for (const { h, guests, want } of cases) {
    const servings = suggestedServingsForDay(dayWithGuests(guests), h);
    const wholeEaters = h.adults + h.teens + guests;
    eq(
      servings,
      want,
      `${h.adults}a ${h.teens}t ${h.children}c ${h.toddlers}td + ${guests} guests ` +
        `(${wholeEaters} whole eaters)`,
    );
  }
}

console.log('\nand it does so for every household and guest count');

{
  // The rule itself, over the whole shape of the question: every household
  // the survey can produce, with guests from none to a full table.
  let underFed = 0;
  let checked = 0;
  for (let adults = 1; adults <= 6; adults++) {
    for (let teens = 0; teens <= 2; teens++) {
      for (let children = 0; children <= 3; children++) {
        for (let toddlers = 0; toddlers <= 2; toddlers++) {
          for (const guests of [0, 1, 2, 3, 4, 5, 6, 8]) {
            const h = H(adults, children, toddlers, teens);
            const servings = suggestedServingsForDay(dayWithGuests(guests), h);
            const wholeEaters = adults + teens + guests;
            checked += 1;
            // The ladder tops out at 12, whose blurb promises "10+ people",
            // so a table larger than that is the ladder's own limit and not
            // this rule's business.
            if (wholeEaters > 12) continue;
            if (servings < wholeEaters) {
              underFed += 1;
              if (underFed <= 5) {
                console.log(
                  `  FAIL ${adults}a ${teens}t ${children}c ${toddlers}td + ${guests} guests ` +
                    `— ${servings}pax for ${wholeEaters} whole eaters`,
                );
              }
            }
          }
        }
      }
    }
  }
  ok(underFed === 0, `no household is left short (${checked} combinations checked)`,
    underFed === 0 ? '' : `${underFed} of them under-feed the table`);
}

console.log('\nand it still does not buy more than the table needs');

{
  // The child's own share is the ONE thing the app may come up short on, so
  // the size must never go above the size that covers the full
  // adult-equivalent need. The floor must not turn into a ceiling-breaker.
  let overshot = 0;
  for (let adults = 1; adults <= 6; adults++) {
    for (let teens = 0; teens <= 2; teens++) {
      for (let children = 0; children <= 3; children++) {
        for (let toddlers = 0; toddlers <= 2; toddlers++) {
          for (const guests of [0, 1, 2, 3, 4, 5, 6, 8]) {
            const h = H(adults, children, toddlers, teens);
            const need =
              adults + teens * 0.9 + children * 0.6 + toddlers * 0.4 + guests;
            // The smallest ladder size that covers the full need.
            const coversNeed = [2, 4, 6, 9, 12].find((s) => s >= need) ?? 12;
            const servings = suggestedServingsForDay(dayWithGuests(guests), h);
            if (servings > coversNeed) overshot += 1;
          }
        }
      }
    }
  }
  ok(overshot === 0, 'no household buys more than the table needs', overshot === 0 ? '' : `${overshot} overshoot`);
}

console.log('\nthe small portions a child makes possible are left alone');

{
  // The rule that keeps the shopping list honest for a family with kids:
  // one child must not push a family of two adults and one child from two
  // portions to four.
  const h = H(2, 1);
  eq(suggestedServings(h), 2, '2 adults + 1 child — 2');
  eq(suggestedServingsForDay(dayWithGuests(0), h), 2, '2 adults + 1 child — 2');
  eq(suggestedServingsForDay(dayWithGuests(1), h), 4, '2 adults + 1 child, 1 guest — 4');
  eq(suggestedServingsForDay(dayWithGuests(2), h), 4, '2 adults + 1 child, 2 guests — 4');
  eq(suggestedServingsForDay(dayWithGuests(3), h), 6, '2 adults + 1 child, 3 guests — 6');

  const toddlers = H(1, 0, 2);
  eq(suggestedServingsForDay(dayWithGuests(0), toddlers), 2, '1 adult + 2 toddlers — 2');
  eq(suggestedServingsForDay(dayWithGuests(1), toddlers), 2, '1 adult + 2 toddlers, 1 guest — 2');
  eq(suggestedServingsForDay(dayWithGuests(2), toddlers), 4, '1 adult + 2 toddlers, 2 guests — 4');
  eq(suggestedServingsForDay(dayWithGuests(3), toddlers), 4, '1 adult + 2 toddlers, 3 guests — 4');
}

console.log('\nand the shopping list buys enough for the table');

{
  // The whole chain, driven through the real store: a household with a
  // toddler, five guests over, one dish, and the week's shopping list.
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

  const household = H(2, 0, 1);
  refresh();
  snap.clearAllData();
  snap.completeHouseholdSurvey(household);
  refresh();
  snap.setDayGuests('mon', 5);
  refresh();
  snap.setMealPlanSlot('mon', 'dinner', {
    name: 'Dal Makhani',
    recipeId: 'r1',
    slot: 'dinner',
    servings: suggestedServingsForDay(snap.mealPlan.mon, household),
    createdAt: Date.now(),
  });
  refresh();

  eq(snap.mealPlan.mon.dinner.servings, 9, 'the dish is planned for 9');

  const needs = buildShoppingList(snap.mealPlan, [recipe], []);
  const dal = needs.find((n) => n.name === 'Dal');
  eq(dal?.needed, 900, 'and the shopping list buys 900 g of dal');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
