/**
 * Tests for the gate that holds the spoken plan back until the recipe
 * catalogue can answer the parser's question.
 *
 * WHY THIS EXISTS
 * The parser asks the catalogue whether a phrase is a dish's OWN NAME:
 *
 *   "no onion no garlic lobia masala" — is this a dish, or a refusal?
 *
 * "no" and "without" are refusal words, and they are also parts of 40 recipe
 * names, so the words alone cannot say which is which — only the catalogue
 * can. The answer decides whether the user's dish is filed, or thrown away as
 * a refusal the user never made.
 *
 * The catalogue that answers is 5,894 recipes in a 5.4 MB download. Until it
 * arrives the app holds the 127 built-ins, and every one of those 40 names
 * lives in the part that has not arrived — so the catalogue's answer was
 * "I do not know", and "I do not know" was being read as "that is not a
 * dish", which IS a refusal:
 *
 *   said "no onion no garlic lobia masala for dinner"
 *     while the catalogue was still loading
 *       plan     -> nothing. The dish the user asked for was lost.
 *       refusals -> "onion no garlic lobia masala", "garlic lobia masala"
 *                   two refusals the user never made, and the app said so.
 *
 * The shopping list buys the plan, so that meal was bought for nothing.
 *
 * WHAT IS TESTED HERE
 * The defect itself — the same sentence, parsed against the catalogue the app
 * holds while the catalogue is loading, and against the whole catalogue — and
 * the gate that stops the sheet from parsing in that state.
 *
 * Run with:  node scripts/test-spoken-plan-catalogue-gate.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { isDishName, dishCore } = await import('../src/utils/spokenRecipeMatch.ts');
const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { catalogueGate } = await import('../src/utils/spokenPlanCatalogue.ts');

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);

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

/** The catalogue the app holds while the 5.4 MB one is still loading. */
const whileLoading = [...INDIAN_RECIPES];
/** The catalogue the app holds once it has arrived. */
const whenLoaded = [...INDIAN_RECIPES, ...csvRecipes];

const said = 'no onion no garlic lobia masala for dinner';

console.log('\nthe catalogue cannot answer while it is still loading');
{
  const knownDish = (phrase) => isDishName(phrase, whileLoading);
  const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
  check('the dish the user asked for is LOST', Object.keys(plan).length, 0);
  // The refusals themselves are named loosely on purpose: what matters is that
  // the app refused SOMETHING the user never refused, and a rule that only
  // counts them would pass while the meal was still being thrown away.
  check('and something is refused that the user never refused', refusals.length > 0, true);
}

console.log('\nand it CAN answer once it has arrived');
{
  const knownDish = (phrase) => isDishName(phrase, whenLoaded);
  const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
  check('the dish is filed', plan, { dinner: 'no onion no garlic lobia masala' });
  check('and nothing is refused', refusals, []);
}

console.log('\nand every name that carries a refusal word lives in the part that has not arrived');
{
  const REFUSAL_WORDS = [
    'no', 'not', 'without', 'skip', 'avoid', 'do not', 'nope', 'nah',
    'remove', 'cancel',
  ];
  const coreOf = (n) => dishCore(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const carriesRefusal = (core) =>
    core.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
      .some((w) => REFUSAL_WORDS.includes(w));

  const builtInCores = new Set(INDIAN_RECIPES.map((r) => coreOf(r.name)));
  const allCores = new Set(
    [...INDIAN_RECIPES, ...csvRecipes].map((r) => coreOf(r.name)).filter(Boolean),
  );
  const refusalCores = [...allCores].filter(carriesRefusal);
  const inBuiltIns = refusalCores.filter((c) => builtInCores.has(c));

  check('there are names that carry a refusal word', refusalCores.length > 30, true);
  check('and NONE of them is in the built-ins', inBuiltIns, []);
}

console.log('\nso the sheet holds the spoken plan back until the catalogue is whole');
{
  check('while it is loading the sheet may NOT parse', catalogueGate('loading').mayParse, false);
  check('and it says what it is waiting for', catalogueGate('loading').note, 'Loading the recipe catalogue…');
  check('once it has arrived the sheet may parse', catalogueGate('ready').mayParse, true);
  check('and it has nothing to say', catalogueGate('ready').note, null);
}

console.log('\nand a catalogue that never arrives is told about, not hidden');
{
  const gate = catalogueGate('failed');
  check('the sheet may still parse', gate.mayParse, true);
  check('and it says the catalogue did not load', /did not load/.test(gate.note ?? ''), true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
