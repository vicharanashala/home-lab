/**
 * Tests for a dish's own NAME said with no meal word beside it.
 *
 * WHY THIS EXISTS
 * The parser has one rule for telling a refusal from a dish's name, and the
 * catalogue has to be asked about it — "no" and "without" are refusal words
 * and they are also parts of 85 recipe names.
 *
 * The rule was consulted in one place only: the phrase a MEAL word took its
 * dish from. A name said on its own has no meal word, so it was never
 * consulted at all, and every such name was read as a refusal:
 *
 *   "no onion no garlic lobia masala"
 *     refusals   -> "onion no garlic lobia masala", "garlic lobia masala"
 *     plan       -> nothing
 *     the sheet  -> "there is nothing to remove for onion no garlic lobia
 *                   masala or garlic lobia masala"
 *
 * The user asked for a dish. The app refused two dishes they never refused,
 * added nothing, and told them about a removal that had nothing to do with
 * their sentence. The shopping list buys the plan, so that meal was bought
 * for nothing.
 *
 * The same name with a meal word beside it worked, which is what made this
 * hard to see: "no onion no garlic lobia masala for dinner" filed the dish
 * whole and raised no refusal.
 *
 * WHY EVERY CATALOGUE NAME AND NOT A FEW EXAMPLES
 * A name is only safe when the rule reads it the way the catalogue holds it.
 * An example cannot catch a name whose shape the rule happens to get wrong,
 * so this walks every core the catalogue holds that carries a refusal word —
 * the same walk the sibling test does for the meal-word form.
 *
 * AND THE OTHER WAY ROUND
 * The rule that recognises a name must not swallow a refusal. "no dal",
 * "no dosa for breakfast" and the rest are refusals, and they name no dish
 * the catalogue holds. A rule that recognised every phrase with a refusal
 * word in it would break the thing the app is for.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-name-without-meal.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { isDishName, dishCore } = await import('../src/utils/spokenRecipeMatch.ts');
const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanOutcome, spokenPlanError } = await import('../src/utils/spokenPlanEntries.ts');

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);

/**
 * The app matches against the built-ins AND the scraped catalogue together —
 * that is how MealPlan builds its `catalogue`.
 */
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

/**
 * The catalogue's answer to "is this a dish?" — the same rule the app hands
 * the parser, so the test proves the rule the app uses.
 */
const knownDish = (phrase) => isDishName(phrase, catalogue);

/**
 * The refusal words. These are the words the parser treats as "the user does
 * not want this", and they are also parts of recipe names.
 */
const REFUSAL_WORDS = [
  'no', 'not', 'without', 'skip', 'avoid', 'do not', 'nope', 'nah',
  'remove', 'cancel',
];

/**
 * Every core the catalogue holds that carries a refusal word — the phrases a
 * person could say that the parser has to tell apart from a refusal.
 */
const refusalWordCores = [
  ...new Set(
    catalogue
      .map((r) => dishCore(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim())
      .filter((core) => {
        if (!core) return false;
        const words = core.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
        return words.some((w) => REFUSAL_WORDS.includes(w));
      }),
  ),
];

console.log('\nthe catalogue really does hold names carrying a refusal word');
{
  check('there are names to test', refusalWordCores.length > 30, true);
}

console.log('\nand a name said ON ITS OWN raises no refusal at all');
{
  const raised = [];
  const filed = [];
  for (const core of refusalWordCores) {
    const { plan, refusals } = parseSpokenPlanResult(core, knownDish);
    if (refusals.length) {
      raised.push(`${core} -> ${JSON.stringify(refusals.map((r) => r.dish))}`);
    }
    // No meal word was spoken, so no slot may be filled — the app asks which
    // meal it was for, and that is the honest answer.
    if (Object.keys(plan).length) filed.push(`${core} -> ${JSON.stringify(plan)}`);
  }
  check('no name raises a refusal', raised, []);
  check('and no name fills a slot', filed, []);
}

console.log('\nand the app says the TRUE thing about it');
{
  const said = 'no onion no garlic lobia masala';
  const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
  const outcome = spokenPlanOutcome(plan, refusals, undefined);
  check('the outcome is not a refusal', outcome.kind, 'nothing');
  check(
    'and the message asks which meal it was for',
    spokenPlanError(said, outcome),
    'Heard "no onion no garlic lobia masala" but could not tell which meal it was for. Try saying "breakfast …, lunch …, dinner …".',
  );
}

console.log('\nand a name in its own CLAUSE raises no refusal either');
{
  const raised = [];
  for (const core of refusalWordCores) {
    // The name in front of the meal, in a clause of its own.
    const said = `${core}, biryani for dinner`;
    const { refusals } = parseSpokenPlanResult(said, knownDish);
    if (refusals.length) raised.push(`${said} -> ${JSON.stringify(refusals.map((r) => r.dish))}`);
  }
  check('no name raises a refusal', raised, []);
}

console.log('\nand a name with a meal word beside it is still filed WHOLE');
{
  const cut = [];
  for (const core of refusalWordCores) {
    const { plan, refusals } = parseSpokenPlanResult(`${core} for dinner`, knownDish);
    if (refusals.length) cut.push(`${core} -> refusals ${JSON.stringify(refusals.map((r) => r.dish))}`);
    if ((plan.dinner || '').trim().toLowerCase() !== core.toLowerCase()) {
      cut.push(`${core} -> filed "${(plan.dinner || '').trim()}"`);
    }
  }
  check('every name is filed whole', cut, []);
}

console.log('\nand an everyday refusal is STILL a refusal');
{
  const everyday = [
    'no dal',
    'no dal for dinner',
    'no dosa for breakfast',
    'no lunch dal',
    'no rice for dinner',
    'without dal for dinner',
    'skip the biryani for lunch',
    'avoid dosa for breakfast',
    'do not want dal',
    'dal for dinner, no dal',
  ];
  const notRefused = [];
  for (const said of everyday) {
    const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
    if (!refusals.length) notRefused.push(said);
    if (Object.keys(plan).length) notRefused.push(`${said} -> filed ${JSON.stringify(plan)}`);
  }
  check('every everyday refusal is still a refusal', notRefused, []);
}

console.log('\nand refusing a dish whose own NAME carries a refusal word still works');
{
  // The user is refusing the dish "no onion no garlic lobia masala", and the
  // "no" in front of it is a refusal of that dish rather than part of it.
  const said = 'no no onion no garlic lobia masala for dinner';
  const { refusals } = parseSpokenPlanResult(said, knownDish);
  check('the refusal is raised', refusals.length > 0, true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
