/**
 * Tests for the portion size of a dish added to the meal plan.
 *
 * WHY THIS MATTERS: the shopping list is built from each dish's servings,
 * so a dish that was written with the wrong number makes the user buy the
 * wrong amount of food. Every path that puts a dish on a day — the picker,
 * the suggestion sheet, the week filler and the spoken plan — has to agree
 * on that number, or the same household gets two different answers on the
 * same screen.
 *
 * Run with:  node scripts/test-portion-sizing.mjs
 */
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

// The app's modules import each other without a file extension, which Node
// cannot resolve on its own. The hook above teaches it to.
const { spokenPlanEntries } = await import('../src/utils/spokenPlanEntries.ts');
const { suggestedServingsForDay, suggestedServings } = await import(
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

const TWO_ADULTS = { adults: 2, teens: 0, children: 0, toddlers: 0, completed: true };
const TWO_ADULTS_TWO_KIDS = {
  adults: 2,
  teens: 0,
  children: 2,
  toddlers: 0,
  completed: true,
};

/** A day with nothing planned on it. */
const emptyDay = { breakfast: null, lunch: null, dinner: null };

console.log('\na spoken dish gets the portion size the day wants');
{
  const day = { ...emptyDay };
  const [entry] = spokenPlanEntries(
    { breakfast: 'poha' },
    {},
    day,
    TWO_ADULTS_TWO_KIDS,
  );
  eq(entry.entry.servings, suggestedServingsForDay(day, TWO_ADULTS_TWO_KIDS),
    'a new dish matches the day\'s portion');
  ok(entry.entry.servings !== 2,
    'a new dish is not stuck at a hardcoded 2 servings',
    `${entry.entry.servings} servings`);
}

console.log('\na spoken dish respects the guests that day');
{
  const day = { ...emptyDay, guests: 2 };
  const [entry] = spokenPlanEntries({ dinner: 'biryani' }, {}, day, TWO_ADULTS);
  eq(entry.entry.servings, suggestedServingsForDay(day, TWO_ADULTS),
    'a new dish matches the day\'s portion with guests');
  ok(entry.entry.servings > suggestedServings(TWO_ADULTS),
    'guests make the dish bigger than the household alone',
    `${entry.entry.servings} vs ${suggestedServings(TWO_ADULTS)}`);
}

console.log('\na spoken dish keeps the size the slot already had');
{
  const day = { ...emptyDay, breakfast: { name: 'Idli', slot: 'breakfast', servings: 6, createdAt: 1 } };
  const [entry] = spokenPlanEntries({ breakfast: 'poha' }, {}, day, TWO_ADULTS_TWO_KIDS);
  eq(entry.entry.servings, 6, 'the existing size is kept');
}

console.log('\nthe spoken path and the picker agree on the same day');
{
  // The same household, the same day, two ways of adding a dish.
  const day = { ...emptyDay, guests: 1 };
  const spoken = spokenPlanEntries({ lunch: 'dal' }, {}, day, TWO_ADULTS_TWO_KIDS)[0];
  const picker = suggestedServingsForDay(day, TWO_ADULTS_TWO_KIDS);
  eq(spoken.entry.servings, picker, 'spoken and picker agree');
}

console.log('\na meal that was never mentioned is left alone');
{
  const entries = spokenPlanEntries({ breakfast: 'poha' }, {}, emptyDay, TWO_ADULTS);
  eq(entries.length, 1, 'only the mentioned meal is returned');
  eq(entries[0].slot, 'breakfast', 'and it is the right slot');
}

console.log('\na confident match links the dish to its recipe');
{
  const recipe = { id: 'r1', name: 'Masala Dosa', emoji: '🥞' };
  const entries = spokenPlanEntries(
    { dinner: 'masala dosa' },
    { dinner: { heard: 'masala dosa', best: { recipe, name: 'Masala Dosa', score: 0.99, tier: 'exact' }, alternatives: [] } },
    emptyDay,
    TWO_ADULTS,
  );
  eq(entries[0].entry.recipeId, 'r1', 'the recipe id is carried over');
  eq(entries[0].entry.emoji, '🥞', 'the emoji is carried over');
}

console.log('\nan uncertain match keeps the heard words and links to nothing');
{
  const entries = spokenPlanEntries(
    { dinner: 'something odd' },
    { dinner: { heard: 'something odd', best: { recipe: { id: 'r2', name: 'X' }, name: 'X', score: 0.2, tier: 'word' }, alternatives: [] } },
    emptyDay,
    TWO_ADULTS,
  );
  eq(entries[0].entry.name, 'something odd', 'the heard words are kept');
  eq(entries[0].entry.recipeId, undefined, 'no recipe is linked');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
