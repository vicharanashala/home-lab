/**
 * Tests for the entries a spoken plan writes into the meal plan.
 *
 * WHY THIS EXISTS: the sheet lets the user change a dish AFTER it was heard
 * — by tapping another suggestion, or by typing over it. The resolution is
 * what the matcher worked out from what it heard; the name is what the slot
 * holds now. When the two disagreed, the plan held the NAME of one dish and
 * the RECIPE of another, and the shopping list — which is built from the
 * recipe — bought the wrong food for it.
 *
 * A wrong dish is worse than a missing one, so the rule is: the recipe is
 * only linked when the resolution still describes the dish being written.
 *
 * Run with:  node scripts/test-spoken-plan-entries.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const {
  matchDish,
  pickDish,
  retypeDish,
  CONFIDENT_SCORE,
} = await import('../src/utils/spokenRecipeMatch.ts');
const { spokenPlanEntries } = await import('../src/utils/spokenPlanEntries.ts');

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);

/**
 * The app matches against the built-ins AND the scraped catalogue together —
 * that is how MealPlan builds its `catalogue`, and the scraped names are
 * where a confident match has to earn itself.
 */
const catalogue = [...INDIAN_RECIPES, ...csvRecipes];
/** The app's curated recipes, which win ties against the scraped ones. */
const preferredIds = new Set(INDIAN_RECIPES.map((r) => r.id));

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

/** The recipe id written onto the entry for one slot, or null. */
function linkedRecipeId(plan, resolutions, slot = 'dinner') {
  const entries = spokenPlanEntries(plan, resolutions, undefined, undefined, 1000);
  return entries.find((e) => e.slot === slot)?.entry.recipeId ?? null;
}

const DOSA = 'in-masala-dosa';
const TIKKA = 'in-paneer-tikka';

/** The resolution the sheet holds after hearing "masala dosa". */
const heardDosa = matchDish('masala dosa', catalogue, preferredIds);

console.log('\nthe dish the sheet heard');
{
  ok(heardDosa.best?.recipe.id === DOSA, '"masala dosa" matches the dosa recipe',
    heardDosa.best?.recipe.id);
  ok(heardDosa.best?.score >= CONFIDENT_SCORE, 'and matches it confidently',
    `score ${heardDosa.best?.score.toFixed(2)}`);
}

console.log('\nthe dish nobody changed still links its recipe');
{
  const id = linkedRecipeId(
    { dinner: 'Masala dosa' },
    { dinner: heardDosa },
  );
  ok(id === DOSA, 'the entry carries the recipe it was matched to', String(id));
}

console.log('\nthe user taps a different dish');
{
  // What the sheet holds if the resolution is NOT changed with the slot:
  // the slot now says one dish and the resolution still describes another.
  const id = linkedRecipeId(
    { dinner: 'Paneer tikka' },
    { dinner: heardDosa },
  );
  ok(id === null, 'a stale resolution links nothing', String(id));

  // What the sheet holds once the choice is recorded.
  const tikka = matchDish('paneer tikka', catalogue, preferredIds).best;
  const chosen = pickDish(heardDosa, tikka);
  const chosenId = linkedRecipeId(
    { dinner: 'Paneer tikka' },
    { dinner: chosen },
  );
  ok(chosenId === TIKKA, "the user's own choice links ITS recipe", String(chosenId));
}

console.log('\nthe user types over the slot');
{
  const id = linkedRecipeId(
    { dinner: 'something else entirely' },
    { dinner: heardDosa },
  );
  ok(id === null, 'a stale resolution links nothing', String(id));

  // The sheet re-matches what was typed.
  const typed = retypeDish('paneer tikka', catalogue, preferredIds);
  const typedId = linkedRecipeId(
    { dinner: 'paneer tikka' },
    { dinner: typed },
  );
  ok(typedId === TIKKA, 'the typed dish links the recipe it names', String(typedId));
}

console.log('\na dish the user picked is taken at their word');
{
  // The score is low because the matcher was unsure — not because the user
  // was. A tapped suggestion must still link its recipe.
  const weak = matchDish('paneer tikka', catalogue, preferredIds).best;
  const chosen = pickDish(heardDosa, weak);
  chosen.best = { ...chosen.best, score: 0.2 };
  const id = linkedRecipeId({ dinner: 'Paneer tikka' }, { dinner: chosen });
  ok(id === TIKKA, 'a low-scoring but chosen dish still links', String(id));
}

console.log('\na match the matcher was unsure of links nothing');
{
  const unsure = matchDish('dal', catalogue, preferredIds);
  ok(!unsure.best || unsure.best.score < CONFIDENT_SCORE,
    '"dal" alone is not a certain dish',
    unsure.best ? `score ${unsure.best.score.toFixed(2)}` : 'no match');
  const id = linkedRecipeId({ dinner: 'dal' }, { dinner: unsure });
  ok(id === null, 'and it links no recipe', String(id));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
