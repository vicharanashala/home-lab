/**
 * Regression tests for a refused dish whose name carries a gloss IN THE MIDDLE.
 *
 * WHY THIS EXISTS
 *
 * A dish name reaches the refusal rule in two shapes. The dish the user SAYS
 * is a spoken fragment — "palak puri". The dish the DAY holds is a recipe's
 * own name, and a recipe's own name is written with a gloss on it. Most of
 * those glosses sit at the END of the name — "Bhindi masala (okra)" — and a
 * gloss there was already handled. But a name may carry one in the MIDDLE:
 *
 *   "Palak (Spinach) Puri"             "Vendaikai (Okra) Puli Kootu"
 *   "Hibiscus (Chembaruthi) Neer Dosa" "Ragi (Finger Millet) Chocolate Brownie"
 *
 * The rule that took a gloss off took one off the END of a name only. It
 * fired on the SPOKEN name — which has no bracket at all — and did not fire
 * on the catalogue name, whose bracket is not at the end. So the two sides
 * of the comparison were two different names:
 *
 *   day holds "Palak (Spinach) Puri"   user says "no palak puri for dinner"
 *                             -> the meal was NOT emptied
 *
 * The shopping list buys the plan, so the refused dish stayed on the list,
 * and the sheet told the user "there is no palak puri to remove from the
 * dinner" — a sentence about nothing, about a dish that was ON the dinner.
 *
 * The fix compares the dish on the plan under BOTH of its own names: the
 * plain one ("Palak Puri") and the one with the gloss spelled out ("Palak
 * Spinach Puri"). A person says one of those two, and both of them are the
 * dish on the plan.
 *
 * WHY IT MUST NOT MAKE TWO DISHES ONE: a dish that merely CONTAINS the named
 * one is still a different dish, and refusing a dal must leave a dal tadka
 * alone.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-medial-gloss.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult, namesHeldDish } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanEntries, spokenPlanClears } = await import(
  '../src/utils/spokenPlanEntries.ts'
);
const { dishCore } = await import('../src/utils/spokenRecipeMatch.ts');
const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');

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

/** A day holding the dishes it is given. */
function dayHolding(dishes) {
  const day = { mode: 'normal', guests: 0 };
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const name = dishes[slot];
    day[slot] = name
      ? { name, slot, servings: 2, createdAt: NOW }
      : null;
  }
  return day;
}

/**
 * What the day holds after a spoken day is applied — the way the page applies
 * it: the entries are written, and the meals a refusal emptied are removed.
 */
function applySpoken(said, current) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  const entries = spokenPlanEntries(plan, {}, current, HOUSEHOLD);
  const cleared = spokenPlanClears(refusals, plan, current);
  const next = { ...current };
  for (const slot of cleared) next[slot] = null;
  for (const { slot, entry } of entries) next[slot] = entry;
  const holds = {};
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    holds[slot] = next[slot] ? next[slot].name : null;
  }
  return { plan, refusals, entries, cleared, holds };
}

const EMPTY = { breakfast: null, lunch: null, dinner: null };

console.log('\na dish whose gloss sits in the middle can be refused by the name it is said');
for (const [held, said] of [
  ['Palak (Spinach) Puri', 'palak puri'],
  ['Vendaikai (Okra) Puli Kootu', 'vendaikai puli kootu'],
  ['Hibiscus (Chembaruthi) Neer Dosa', 'hibiscus neer dosa'],
  ['Ragi (Finger Millet) Chocolate Brownie', 'ragi chocolate brownie'],
  ['Dark Chocolate Sandesh (Shondesh) Dipped In Chocolate', 'dark chocolate sandesh dipped in chocolate'],
  ['Dry Fruits Suzhiyam (Boorelu) With Black Rice', 'dry fruits suzhiyam with black rice'],
]) {
  check(
    `"no ${said} for dinner" takes it out of the dinner`,
    applySpoken(`no ${said} for dinner`, dayHolding({ dinner: held })).holds,
    EMPTY,
  );
}

console.log('\nand the gloss said in words names the same dish');
for (const [held, said] of [
  ['Palak (Spinach) Puri', 'palak spinach puri'],
  ['Vendaikai (Okra) Puli Kootu', 'vendaikai okra puli kootu'],
]) {
  check(
    `"no ${said} for dinner" takes it out of the dinner`,
    applySpoken(`no ${said} for dinner`, dayHolding({ dinner: held })).holds,
    EMPTY,
  );
}

console.log('\nand a gloss at the END of a name still works');
for (const [held, said] of [
  ['Bhindi masala (okra)', 'bhindi masala'],
  ['Upma (rava upma)', 'upma'],
  ['Lemon rice (chitranna)', 'lemon rice'],
]) {
  check(
    `"no ${said} for dinner" takes it out of the dinner`,
    applySpoken(`no ${said} for dinner`, dayHolding({ dinner: held })).holds,
    EMPTY,
  );
}

console.log('\nand it does not make two dishes one');
check(
  'a dal is not a dal tadka',
  namesHeldDish('dal', 'Dal tadka'),
  false,
);
check(
  'a dal tadka is not a dal',
  namesHeldDish('dal tadka', 'Dal'),
  false,
);
check(
  'and refusing a dal leaves the dal tadka on the plan',
  applySpoken('no dal for dinner', dayHolding({ dinner: 'Dal tadka' })).holds,
  { breakfast: null, lunch: null, dinner: 'Dal tadka' },
);

console.log('\nand a refusal that names a DIFFERENT dish leaves the plan alone');
check(
  'the dinner keeps its own dish',
  applySpoken('no palak puri for dinner', dayHolding({ dinner: 'Biryani' })).holds,
  { breakfast: null, lunch: null, dinner: 'Biryani' },
);

console.log('\nand EVERY catalogue dish can be refused by the name a person would say');
{
  // What a person says for a dish: the plain words, with the gloss taken off
  // and the " - " tail off, because nobody says the bracket.
  const said = (name) =>
    dishCore(name)
      .replace(/\s*\([^)]*\)?/g, ' ')
      .replace(/\s+[-–—]\s+.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();

  const unrefusable = [];
  const seen = new Set();
  for (const recipe of catalogue) {
    const name = recipe.name || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const spoken = said(name);
    // A catalogue name that begins with "Recipe" reduces to a word that names
    // no dish at all — "Recipe - Sprouted Green Moong with Tadka" is "Recipe"
    // — and the app never holds a dish under a name that says nothing.
    if (!spoken || spoken.toLowerCase() === 'recipe') continue;
    if (!namesHeldDish(spoken.toLowerCase(), name)) unrefusable.push(name);
  }
  check('no catalogue dish is unrefusable', unrefusable, []);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
