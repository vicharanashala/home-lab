/**
 * Every catalogue name that carries a refusal word is a DISH, and the
 * everyday refusals are still refusals.
 *
 * WHY THIS EXISTS
 *
 * "no" and "without" are refusal words — they are how a person says they do
 * not want a dish. They are ALSO parts of recipe names in the catalogue:
 *
 *   "No Onion No Garlic Lobia Masala Recipe In Electric Pressure Cooker"
 *   "Tomato Curry Leaf Chutney With No Onion No Garlic"
 *   "Red Lentil Curry Without Coconut"
 *   "No Onion And No Garlic Aloo Gajar Matar Ki Sabzi"
 *
 * The parser cut a dish at a refusal word, so every one of those names was
 * broken in half. The shopping list buys the plan, so a dish the user asked
 * for that arrived cut, or refused, was a meal the list bought nothing for —
 * and the sheet said the meal had been heard.
 *
 * WHY THE WHOLE CATALOGUE AND NOT A FEW EXAMPLES
 *
 * A commit claimed that "all 85 catalogue names carrying a refusal word are
 * recognised and still link to their recipe". It was true of 84. The
 * eighty-fifth —
 *
 *   "No Onion And No Garlic Aloo Gajar Matar Ki Sabzi"
 *
 * — was cut and refused, because the phrase without its front word,
 * "onion and no garlic aloo gajar matar ki sabzi", is a NEAR MISS of a
 * different dish the catalogue also holds ("No Onion No Garlic Aloo Gajar Ki
 * Sabzi"). A rule that accepts any match over the confidence bar therefore
 * read the front "no" as a refusal of that other dish, and the dish the
 * user had actually asked for was thrown away:
 *
 *   "no onion and no garlic aloo gajar matar ki sabzi for dinner"
 *     the plan held NOTHING, two refusals were raised, and the dinner the
 *     user asked for was bought for nothing.
 *
 * So this test walks EVERY name the catalogue holds that carries a refusal
 * word, and asks the app's own rule about each one. An example cannot catch
 * this: the example that was missed was missed because of a second dish
 * whose words happen to overlap.
 *
 * AND THE OTHER WAY ROUND: the rule that recognises a dish name must not
 * swallow a refusal. "no dal", "no dosa" and the rest are refusals, and they
 * name no dish the catalogue holds.
 *
 * MEASURED
 *   5 of the 9 checks fail on 3f748f7 and all 9 pass on 2466f42, which asks
 *   the catalogue whether a phrase IS a dish's name rather than whether it
 *   matches one.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-names-in-catalogue.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { matchDish, CONFIDENT_SCORE, dishCore, normalizeDish, isDishName } =
  await import('../src/utils/spokenRecipeMatch.ts');
const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');

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

const carriesRefusalWord = new RegExp(`\\b(?:${REFUSAL_WORDS.join('|')})\\b`, 'i');

console.log('\nthe catalogue really does hold names carrying a refusal word');
{
  const names = catalogue.map((r) => r.name || '');
  const carriers = names.filter((n) => carriesRefusalWord.test(n));
  check('the catalogue holds names carrying a refusal word', carriers.length > 50, true);
  check(
    'and one of them carries TWO of them',
    carriers.some((n) => /\bno\b/i.test(n) && /\bno\b/gi.test(n.replace(/\bno\b/i, ''))),
    true,
  );
}

console.log('\nand EVERY one of them is a dish the app knows by name');
{
  const carriers = catalogue.filter((r) => carriesRefusalWord.test(r.name || ''));
  const notNames = carriers
    .map((r) => dishCore(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .filter((core) => core && !knownDish(core));
  check('every refusal-word name is a dish name', notNames, []);
}

console.log('\nand the parser files every one of them WHOLE, and refuses none');
{
  const carriers = catalogue.filter((r) => carriesRefusalWord.test(r.name || ''));
  const cut = [];
  const refused = [];
  const unlinked = [];
  for (const r of carriers) {
    const core = dishCore(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!core) continue;
    const { plan, refusals } = parseSpokenPlanResult(`${core} for dinner`, knownDish);
    const filed = (plan.dinner || '').trim();
    if (normalizeDish(filed) !== normalizeDish(core)) cut.push(`${core} -> "${filed}"`);
    if (refusals.length) refused.push(`${core} -> ${JSON.stringify(refusals)}`);
    const match = matchDish(filed, catalogue);
    if (!match.best || match.best.score < CONFIDENT_SCORE) unlinked.push(`${core} -> "${filed}"`);
  }
  check('no refusal-word name is cut', cut, []);
  check('no refusal-word name raises a refusal', refused, []);
  check('every refusal-word name still links to a recipe', unlinked, []);
}

console.log('\nand an everyday refusal is STILL a refusal');
{
  const everyday = [
    'no dal for dinner',
    'no dosa for breakfast',
    'no biryani for lunch',
    'no lunch dal',
    'no rice for dinner',
    'without dal for dinner',
    'skip the biryani for lunch',
    'avoid dosa for breakfast',
  ];
  const notRefused = [];
  for (const said of everyday) {
    const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
    if (!refusals.length) notRefused.push(said);
    if (Object.keys(plan).length) notRefused.push(`${said} -> filed ${JSON.stringify(plan)}`);
  }
  check('every everyday refusal is still a refusal', notRefused, []);
}

console.log('\nand a refusal-word name the user says is still a dish, not a refusal');
{
  const said = 'no onion and no garlic aloo gajar matar ki sabzi for dinner';
  check('the dish is filed whole', parseSpokenPlanResult(said, knownDish).plan, {
    dinner: 'no onion and no garlic aloo gajar matar ki sabzi',
  });
  check('and no refusal is raised', parseSpokenPlanResult(said, knownDish).refusals, []);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
