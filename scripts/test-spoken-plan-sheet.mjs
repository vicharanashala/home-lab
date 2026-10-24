/**
 * Tests for what the voice sheet says, and whether it agrees with the plan.
 *
 * WHY THIS EXISTS
 * The sheet tells the user what is about to happen and the writer decides
 * what actually happens, so the two have to say the same thing. They used to
 * ask it separately — the sheet asked "is the match confident?", the writer
 * asked "is it confident OR did the user pick it?" — and on a dish the user
 * CHOSE they answered differently.
 *
 * So a user who said "bhatura", was offered "Chole bhature / Khatua /
 * Paneer Bhutuwa" and tapped "Khatua" was told "did you mean" and asked to
 * choose again, while the plan quietly wrote "Khatua" and linked the khatua
 * recipe the shopping list would buy from. The choice had been made and the
 * screen was still asking the question.
 *
 * The sheet is a React component and cannot be run from a script, so its
 * decisions live in utils/spokenPlanSheet.ts and are tested here. The
 * writer's live in utils/spokenPlanEntries.ts. Both are compared against
 * each other in every case below, because "the sheet says matched" and
 * "the plan links a recipe" have to be the same sentence.
 *
 * Run with:  node scripts/test-spoken-plan-sheet.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { matchDish, pickDish, retypeDish } = await import('../src/utils/spokenRecipeMatch.ts');
const { sheetNoteFor } = await import('../src/utils/spokenPlanSheet.ts');
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

/**
 * The recipe id written onto the entry for one slot, or null.
 *
 * This is the plan writer's own output, not a re-implementation of it.
 */
function linkedRecipeId(plan, resolutions, slot = 'dinner') {
  const entries = spokenPlanEntries(plan, resolutions, undefined, undefined, 1000);
  return entries.find((e) => e.slot === slot)?.entry.recipeId ?? null;
}

/**
 * The sheet and the writer, side by side, for one slot.
 *
 * Returns what the sheet would print and what the plan would write.
 */
function bothWays(resolution, current, slot = 'dinner') {
  const note = sheetNoteFor(resolution, current);
  const plan = { [slot]: current };
  const resolutions = { [slot]: resolution };
  return {
    kind: note.kind,
    matchedName: note.matchedName,
    chips: note.chips.map((m) => m.name),
    linkedId: linkedRecipeId(plan, resolutions, slot),
  };
}

console.log('\nthe dish the sheet heard and did not change');
{
  const heard = matchDish('masala dosa', catalogue, preferredIds);
  const both = bothWays(heard, heard.best.name);
  ok(both.kind === 'matched', 'the sheet says it matched', both.kind);
  ok(both.linkedId === heard.best.recipe.id, 'and the plan links that recipe', String(both.linkedId));
  ok(!both.chips.includes(heard.best.name), 'the matched dish is not offered back', both.chips.join(', '));
}

console.log('\na match the matcher was unsure of, and the user left it alone');
{
  const heard = matchDish('bhatura', catalogue, preferredIds);
  const both = bothWays(heard, 'bhatura');
  ok(both.kind === 'suggest', 'the sheet asks which dish was meant', both.kind);
  ok(both.linkedId === null, 'and the plan links no recipe', String(both.linkedId));
  ok(both.chips.length > 0, 'the alternatives are offered', both.chips.join(', '));
}

console.log('\nthe user taps a dish the matcher was unsure of');
{
  const heard = matchDish('bhatura', catalogue, preferredIds);
  const chip = heard.alternatives.find((m) => m.score < 0.75) ?? heard.best;
  const picked = pickDish(heard, chip);
  const both = bothWays(picked, chip.name);

  // The regression: the sheet used to say "did you mean" here, while the
  // plan had already linked the dish the user tapped.
  ok(both.kind === 'matched', 'the sheet says it matched', both.kind);
  ok(both.linkedId === chip.recipe.id, 'and the plan links the dish the user chose', String(both.linkedId));
  ok(
    both.matchedName === chip.name,
    'the sheet names the dish the user chose',
    String(both.matchedName),
  );
  ok(!both.chips.includes(chip.name), 'the chosen dish is not offered back', both.chips.join(', '));
}

console.log('\nthe slot changed but the resolution did not');
{
  // What the sheet holds if the resolution is NOT re-matched: the slot now
  // says one dish and the resolution still describes another.
  const heard = matchDish('masala dosa', catalogue, preferredIds);
  const both = bothWays(heard, 'Paneer Tikka');
  ok(both.kind === 'none', 'the sheet says nothing about the old dish', both.kind);
  ok(both.linkedId === null, 'and the plan links nothing', String(both.linkedId));
}

console.log('\nthe user types over the slot');
{
  const typed = retypeDish('paneer tikka', catalogue, preferredIds);
  const both = bothWays(typed, 'paneer tikka');
  ok(both.kind === 'matched', 'the sheet says it matched', both.kind);
  ok(both.linkedId === typed.best.recipe.id, 'and the plan links the typed dish', String(both.linkedId));
}

console.log('\n"did you mean" always offers the dish it means');
{
  // The regression: the chips are the OTHER dishes, so the dish the slot
  // already holds is not offered back as an alternative to itself. But the
  // slot's text and the best match are compared by DISH, and "masala dosa
  // recipe" and "Masala dosa" are ONE dish by that very comparison — so
  // the best match was dropped and the note said "did you mean" with
  // nothing at all to tap.
  //
  // The matcher KNEW the dish — "Masala dosa", at 0.68 — but the extra
  // word "recipe" is what took it under the confidence bar, and the sheet
  // then asked a question it offered no answer to.
  const heard = matchDish('masala dosa recipe', catalogue, preferredIds);
  const both = bothWays(heard, 'masala dosa recipe');
  ok(both.kind === 'suggest', 'the sheet asks which dish was meant', both.kind);
  ok(both.chips.length > 0, 'and it offers something to tap', both.chips.join(', '));
  ok(
    both.chips.includes(heard.best.name),
    'and the dish it means is on the list',
    both.chips.join(', '),
  );
  ok(
    both.linkedId === null,
    'and the plan links no recipe until the user answers',
    String(both.linkedId),
  );
}

console.log('\nno "did you mean" is ever left without an answer');
{
  // The property behind the case above, checked across the catalogue: a
  // sheet that asks which dish was meant must offer the dish it means.
  //
  // The trailing "recipe" is what a person writes when they name a dish
  // they intend to cook, and it is exactly what pushes a good match under
  // the confidence bar — so it is the shape this has to hold for.
  let asked = 0;
  let unanswered = 0;
  for (const r of INDIAN_RECIPES) {
    const heard = matchDish(`${r.name} recipe`, catalogue, preferredIds);
    if (!heard.best) continue;
    const note = sheetNoteFor(heard, `${r.name} recipe`);
    if (note.kind !== 'suggest') continue;
    asked += 1;
    if (!note.chips.length) {
      unanswered += 1;
      console.log(`    no answer for ${JSON.stringify(r.name)}`);
    }
  }
  ok(asked > 0, 'the check actually reaches the asking state', String(asked));
  ok(unanswered === 0, 'every "did you mean" offers a dish', `${unanswered} of ${asked}`);
}

console.log('\nthe sheet and the plan never disagree');
{
  // Every scenario above, checked the one way that matters: whatever the
  // sheet tells the user is what the plan does.
  const scenarios = [
    ['heard, unchanged', matchDish('masala dosa', catalogue, preferredIds), 'Masala Dosa'],
    ['heard, unsure', matchDish('bhatura', catalogue, preferredIds), 'bhatura'],
    ['typed', retypeDish('paneer tikka', catalogue, preferredIds), 'paneer tikka'],
    ['stale', matchDish('masala dosa', catalogue, preferredIds), 'Paneer Tikka'],
  ];
  const heard = matchDish('bhatura', catalogue, preferredIds);
  const chip = heard.alternatives.find((m) => m.score < 0.75) ?? heard.best;
  scenarios.push(['picked', pickDish(heard, chip), chip.name]);

  for (const [label, resolution, current] of scenarios) {
    const both = bothWays(resolution, current);
    ok(
      (both.kind === 'matched') === (both.linkedId !== null),
      `the sheet and the plan agree — ${label}`,
      `sheet "${both.kind}", linked ${String(both.linkedId)}`,
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
