/**
 * Tests for the rule that decides whether a phrase is a dish's own NAME.
 *
 * WHY THIS EXISTS
 * The parser has to tell two things apart, and they look exactly the same:
 *
 *   "no dal"                          the user REFUSES the dal
 *   "no onion no garlic lobia masala" the user ASKS for a dish
 *
 * The words cannot say which is which — the catalogue can, and the app asks
 * it. The rule that asks is `isDishName`, and the answer it has to give is
 * "is this phrase THE NAME of a dish", not "does this phrase MATCH a dish".
 *
 * Those are not the same question, and the looser one loses refusals:
 *
 *   "rice, no dal"
 *     matches "Dal-rice" at 0.753 — a near-word match, a hair over the
 *     confidence bar. A rule that accepts any match over the bar says
 *     "this is a dish the app knows", so the parser takes the refusal word
 *     to be part of a dish's own name. And then:
 *
 *       the plan holds "rice no dal"  — a name that matches no recipe, so
 *                                     the shopping list buys nothing for it
 *       NO refusal is raised at all   — so the dal the user had refused
 *                                     stayed on the plan, where the shopping
 *                                     list buys it
 *
 * The user said "rice, no dal for dinner". Before this rule existed the
 * parser filed the rice and refused the dal, which is right. The loose rule
 * took the refusal away and left the plan holding a phrase that buys
 * nothing.
 *
 * So the rule is the exact one — the WHOLE phrase has to be a catalogue core
 * — and these tests are the proof: the rule answers the right way about the
 * phrases that decide it, the refusals are back, and every catalogue name
 * that carries a refusal word is still filed whole.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-dish-name-rule.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { STARTER_RECIPES } = await import('../src/data/recipes.ts');
const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { isDishName, matchDish, dishCore, CONFIDENT_SCORE } = await import(
  '../src/utils/spokenRecipeMatch.ts'
);
const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanOutcome } = await import('../src/utils/spokenPlanEntries.ts');

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);

/**
 * The app's catalogue — the built-ins AND the scraped names, which is how
 * MealPlan builds it.
 */
const catalogue = [...STARTER_RECIPES, ...INDIAN_RECIPES, ...csvRecipes];

/** The rule the app hands the parser. */
const knownDish = (phrase) => isDishName(phrase, catalogue);

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

/** What the utterance did. */
function parsed(said) {
  return parseSpokenPlanResult(said, knownDish);
}

/** What the sheet would say about it. */
function outcome(said) {
  const { plan, refusals } = parsed(said);
  return spokenPlanOutcome(plan, refusals, undefined).kind;
}

console.log('\nthe rule answers "is this the NAME of a dish", not "does it match one"');
{
  check(
    '"no onion no garlic lobia masala" IS the name of a dish',
    knownDish('no onion no garlic lobia masala'),
    true,
  );
  check(
    '"garlic naan without yeast" IS the name of a dish',
    knownDish('garlic naan without yeast'),
    true,
  );
  check('"no dal" is NOT the name of a dish', knownDish('no dal'), false);
  check('"no dal tadka" is NOT the name of a dish', knownDish('no dal tadka'), false);
  check('"rice, no dal" is NOT the name of a dish', knownDish('rice, no dal'), false);
  check('"rice no dal" is NOT the name of a dish', knownDish('rice no dal'), false);

  // WHY THE NEAR-WORD MATCH IS THE TRAP: "rice, no dal" DOES match a dish,
  // and it does so just over the confidence bar. A rule that accepts any
  // match over the bar says the phrase is a dish the app knows.
  const near = matchDish('rice, no dal', catalogue);
  check(
    '"rice, no dal" does match a dish, just over the bar',
    !!near.best && near.best.score >= CONFIDENT_SCORE,
    true,
  );
  check(
    '... and that match is not an exact one',
    !!near.best && near.best.tier !== 'exact',
    true,
  );
}

console.log('\nand the refusal the loose rule swallowed is back');
{
  check(
    '"rice, no dal for dinner" files the rice',
    parsed('rice, no dal for dinner').plan,
    { dinner: 'rice' },
  );
  check(
    '"rice, no dal for dinner" still refuses the dal',
    parsed('rice, no dal for dinner').refusals,
    [{ slot: 'dinner', dish: 'dal' }],
  );
  check(
    '"dal for dinner, rice no dal for lunch" files both dishes',
    parsed('dal for dinner, rice no dal for lunch').plan,
    { dinner: 'dal', lunch: 'rice' },
  );
  check(
    '"dal for dinner, rice no dal for lunch" still refuses the dal for lunch',
    parsed('dal for dinner, rice no dal for lunch').refusals,
    [{ slot: 'lunch', dish: 'dal' }],
  );
  check(
    '"rice, no dal for dinner" is a plan, not a refusal',
    outcome('rice, no dal for dinner'),
    'plan',
  );
}

console.log('\nand the everyday refusals are untouched');
{
  const REFUSALS = [
    ['no dal for dinner', { slot: 'dinner', dish: 'dal' }],
    ['no lunch dal', { slot: 'lunch', dish: 'dal' }],
    ['no dal', { slot: null, dish: 'dal' }],
    ['no pizza for dinner', { slot: 'dinner', dish: 'pizza' }],
    ['no more dal for dinner', { slot: 'dinner', dish: 'dal' }],
    ['skip dal for dinner', { slot: 'dinner', dish: 'dal' }],
    ['avoid dal for dinner', { slot: 'dinner', dish: 'dal' }],
    ['remove dal for dinner', { slot: 'dinner', dish: 'dal' }],
    ['cancel dal for dinner', { slot: 'dinner', dish: 'dal' }],
    ['not dal for dinner', { slot: 'dinner', dish: 'dal' }],
    ['without dal for dinner', { slot: 'dinner', dish: 'dal' }],
    ['no dal tadka for dinner', { slot: 'dinner', dish: 'dal tadka' }],
    ['no palak paneer for dinner', { slot: 'dinner', dish: 'palak paneer' }],
    ['no breakfast', { slot: 'breakfast', dish: '' }],
  ];
  for (const [said, expected] of REFUSALS) {
    check(`"${said}" still refuses`, parsed(said).refusals, [expected]);
  }
}

console.log('\nand every catalogue name that carries a refusal word is still filed whole');
{
  const REFUSAL_WORD_RE =
    /\b(?:no|not|without|skip|avoid|do not|nope|nah|remove|cancel)\b/i;
  const cores = [
    ...new Set(
      catalogue
        .map((r) => dishCore(r.name || ''))
        .filter((c) => REFUSAL_WORD_RE.test(c)),
    ),
  ];
  const SHAPES = [
    (c) => `${c} for dinner`,
    (c) => `dinner ${c}`,
    (c) => `for dinner ${c}`,
    (c) => `${c} for breakfast`,
    (c) => `breakfast ${c}`,
  ];
  let cut = 0;
  let spurious = 0;
  const broken = [];
  for (const core of cores) {
    for (const shape of SHAPES) {
      const said = shape(core);
      const { plan, refusals } = parsed(said);
      const filed = Object.values(plan)[0] || '';
      if (filed !== core.toLowerCase()) {
        cut += 1;
        if (broken.length < 8) broken.push(`${said} -> ${filed}`);
      }
      if (refusals.length) {
        spurious += 1;
        if (broken.length < 8) broken.push(`${said} -> ${JSON.stringify(refusals)}`);
      }
    }
  }
  console.log(`  (${cores.length} catalogue names carry a refusal word)`);
  check('no dish is cut short', cut, 0);
  check('no refusal is raised for a dish', spurious, 0);
  for (const b of broken) console.log(`    ${b}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
