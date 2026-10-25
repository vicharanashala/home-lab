/**
 * A refusal that says how to NOT put a dish on the plan.
 *
 * WHY THIS EXISTS
 *
 * "do not add dal for dinner" is one of the most ordinary ways a person says
 * they do not want a dish. The refusal was understood perfectly — the meal and
 * the dish were both there — but the word that carries no dish of its own was
 * left in the dish the refusal names:
 *
 *   "do not add dal for dinner"
 *     the refusal named "add dal", not "dal"
 *
 * A refusal names the dish it refuses, and "add dal" is not a dish the plan
 * holds. So the refusal matched nothing, the dal stayed on the plan, and the
 * shopping list — which buys the plan — bought the very dish the user had
 * said they did not want. The sheet, meanwhile, told the user there was
 * "no add dal to remove from the dinner", which is a sentence about nothing.
 *
 *   "no add dal for dinner"     the same, with the shorter refusal
 *   "dont add dal for dinner"    the same, with the contraction
 *
 * The words that carry no dish of their own are already taken off the dish a
 * refusal names — "want", "need", "really", "more" — so the instruction verbs
 * belong in the same place. They are words about WHAT TO DO with the dish, not
 * words that name one.
 *
 * WHY THESE FOUR WORDS AND NO MORE
 *
 * The rule is used on BOTH sides of the comparison — the dish the refusal
 * names and the dish the plan holds — so a word in this set must not be part
 * of any dish the catalogue holds. The whole catalogue was checked:
 *
 *   add      0 names
 *   include  0 names
 *   serve    0 names
 *   put      0 names
 *
 * Words that DO occur are left alone for exactly that reason: "make" is in
 * six names ("How to Make Tutty Fruity"), "using" is in sixteen, and
 * stripping those would change a dish the user genuinely named.
 *
 * AND WHY "AND" IS NOT TREATED THE SAME WAY
 *
 * "no dal and no rice" refuses two dishes, and the first refusal swallowed
 * "and no rice". That is a real gap — but "and" is in 658 catalogue names
 * ("Makki and Methi Roti", "Paneer and Green Peas Paratha"), and in this app
 * "dal rice" IS a single dish. Splitting a refusal clause on "and" would
 * break those dishes to fix one phrasing, so it needs a decision about which
 * of the two the app should believe, not a word in a list.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-verb.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanClears } = await import('../src/utils/spokenPlanEntries.ts');
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

/**
 * The day as it stands: dal at dinner.
 */
const day = {
  breakfast: { name: 'Poha' },
  lunch: { name: 'Dal-rice' },
  dinner: { name: 'Dal' },
};

console.log('\nthe refusal names the dish, and the instruction verb is not part of it');
{
  for (const verb of ['add', 'include', 'serve', 'put']) {
    const said = `do not ${verb} dal for dinner`;
    const { refusals } = parseSpokenPlanResult(said);
    check(
      `"${said}" names the dal`,
      refusals.map((r) => r.dish),
      ['dal'],
    );
  }
}

console.log('\nand the dal actually LEAVES the plan, which is what the list buys');
{
  for (const verb of ['add', 'include', 'serve', 'put']) {
    const said = `do not ${verb} dal for dinner`;
    const { plan, refusals } = parseSpokenPlanResult(said);
    check(`"${said}" empties the dinner`, spokenPlanClears(refusals, plan, day), ['dinner']);
  }
}

console.log('\nand the shorter ways of saying it are the same refusal');
{
  for (const said of [
    'no add dal for dinner',
    'dont add dal for dinner',
    "don't add dal for dinner",
  ]) {
    const { plan, refusals } = parseSpokenPlanResult(said);
    check(`"${said}" empties the dinner`, spokenPlanClears(refusals, plan, day), ['dinner']);
  }
}

console.log('\nand the refusal that names NO dish still removes nothing');
{
  const { plan, refusals } = parseSpokenPlanResult('lunch dal, no');
  check('the lunch is kept', spokenPlanClears(refusals, plan, day), []);
  check('and the lunch still holds its dish', plan, { lunch: 'dal' });
}

console.log('\nand the everyday refusals still refuse');
{
  for (const said of ['no dal for dinner', 'without dal for dinner', 'skip the biryani for lunch']) {
    const { refusals } = parseSpokenPlanResult(said);
    check(`"${said}" raises a refusal`, refusals.length > 0, true);
  }
}

console.log('\nand a refusal that names a DIFFERENT dish leaves the plan alone');
{
  const { plan, refusals } = parseSpokenPlanResult('lunch rice, no lunch dal');
  check('the lunch keeps its rice', plan, { lunch: 'rice' });
  check('and the dinner keeps its dal', spokenPlanClears(refusals, plan, day), []);
}

console.log('\nand no dish in the catalogue carries one of these words');
{
  const names = catalogue.map((r) => r.name || '');
  for (const verb of ['add', 'include', 'serve', 'put']) {
    const hits = names.filter((n) => new RegExp(`\\b${verb}\\b`, 'i').test(n));
    check(`no catalogue name carries "${verb}"`, hits, []);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
