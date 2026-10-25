/**
 * Tests for a dish whose own NAME carries a refusal word, in a sentence that
 * holds ANOTHER clause.
 *
 * WHY THIS IS ITS OWN FILE
 * "no" and "without" are refusal words — they are how a person says they do
 * not want a dish — and they are ALSO parts of 85 recipe names:
 *
 *   "Red Lentil Curry Without Coconut"
 *   "No Onion No Garlic Lobia Masala"
 *   "Garlic Naan Without Yeast"
 *
 * The parser now asks the catalogue about a dish's name, so a name that
 * carries a refusal word is a DISH and the word in it is not a refusal. That
 * works when the name is the only clause:
 *
 *   "red lentil curry without coconut for dinner"
 *     -> dinner "red lentil curry without coconut"
 *
 * It does not work when another clause follows, because the rule that takes a
 * dish OUT of a stretch still cut the stretch at the FIRST refusal word it
 * found — and the first refusal word in "red lentil curry without coconut, dal"
 * is the "without" in the middle of the dish's own name:
 *
 *   "red lentil curry without coconut, dal for dinner"
 *     -> dinner "red lentil curry"
 *
 * That is a dish that is in no catalogue, so the shopping list bought nothing
 * for that meal, and nothing anywhere said the dish the user had asked for was
 * lost. In two cases the cut landed on a name the catalogue DOES hold, and the
 * shopping list bought the WRONG dish:
 *
 *   "tomato curry leaf chutney with no onion no garlic, dal for dinner"
 *     -> dinner "tomato curry leaf chutney"  (a different recipe)
 *
 * So the rule that cuts the stretch and the rule that raises the refusal have
 * to ask the SAME question about the same word: is this clause the name of a
 * dish the catalogue holds? The refusal rule already asks it — see `clauseOf`
 * in src/utils/spokenPlan.ts — and the cut did not, so the two disagreed: the
 * refusal rule left the word alone and the cut broke the name in half.
 *
 * WHICH DISH THE MEAL WORD BELONGS TO
 * The rule the app already uses is that the meal word belongs to the clause
 * it sits in — "masala dosa, biryani for dinner" files the biryani, and the
 * dosa is dropped because no meal word was said for it. These tests keep that
 * rule:
 *
 *   "red lentil curry without coconut, dal for dinner"
 *     -> dinner "dal"                       (the meal word sits with the dal)
 *
 *   "red lentil curry without coconut, no dal for dinner"
 *     -> dinner "red lentil curry without coconut"
 *                                           (the last clause is a refusal, so
 *                                            the dish is the one before it)
 *
 * Run with:  node scripts/test-spoken-plan-refusal-word-clause-dish.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { isDishName, dishCore, normalizeDish } = await import(
  '../src/utils/spokenRecipeMatch.ts'
);
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

/**
 * The catalogue's answer to "is this a dish?" — the app's OWN rule, the one
 * `isDishName` is. The rule that recognises a dish name has to be the rule the
 * app uses, or the test proves a rule the app does not run.
 */
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

/** What the utterance filed, and what it refused. */
function parsed(said) {
  const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
  return { plan, refusals };
}

console.log('\nthe dish keeps its name when it is the only clause');
check(
  '"red lentil curry without coconut for dinner" files the whole dish',
  parsed('red lentil curry without coconut for dinner').plan,
  { dinner: 'red lentil curry without coconut' },
);
check(
  '"garlic naan without yeast for dinner" files the whole dish',
  parsed('garlic naan without yeast for dinner').plan,
  { dinner: 'garlic naan without yeast' },
);

console.log('\nand it keeps its name when ANOTHER clause follows it');
check(
  '"red lentil curry without coconut, dal for dinner" files the dal',
  parsed('red lentil curry without coconut, dal for dinner').plan,
  { dinner: 'dal' },
);
check(
  '"garlic naan without yeast, dal for dinner" files the dal',
  parsed('garlic naan without yeast, dal for dinner').plan,
  { dinner: 'dal' },
);
check(
  '"tomato curry leaf chutney with no onion no garlic, dal for dinner" files the dal',
  parsed('tomato curry leaf chutney with no onion no garlic, dal for dinner').plan,
  { dinner: 'dal' },
);

console.log('\nand the refusal clause after it still names the dish it refuses');
check(
  '"red lentil curry without coconut, no dal for dinner" files the dish',
  parsed('red lentil curry without coconut, no dal for dinner').plan,
  { dinner: 'red lentil curry without coconut' },
);
check(
  '"red lentil curry without coconut, no dal for dinner" refuses the dal',
  parsed('red lentil curry without coconut, no dal for dinner').refusals,
  [{ slot: 'dinner', dish: 'dal' }],
);

console.log('\nand the shapes that worked before still work');
check(
  '"no dal, red lentil curry without coconut for dinner" files the dish',
  parsed('no dal, red lentil curry without coconut for dinner').plan,
  { dinner: 'red lentil curry without coconut' },
);
check(
  '"no dal, red lentil curry without coconut for dinner" refuses the dal',
  parsed('no dal, red lentil curry without coconut for dinner').refusals,
  [{ slot: null, dish: 'dal' }],
);
check(
  '"no onion no garlic lobia masala, dal for dinner" files the dal',
  parsed('no onion no garlic lobia masala, dal for dinner').plan,
  { dinner: 'dal' },
);
check(
  '"no dal, biryani for dinner" files the biryani',
  parsed('no dal, biryani for dinner').plan,
  { dinner: 'biryani' },
);
check(
  '"dal, no biryani for dinner" files the dal',
  parsed('dal, no biryani for dinner').plan,
  { dinner: 'dal' },
);
check(
  '"no dal, no rice, biryani for dinner" files the biryani',
  parsed('no dal, no rice, biryani for dinner').plan,
  { dinner: 'biryani' },
);
check(
  '"rice, no dal" refuses the dal and files nothing',
  parsed('rice, no dal').plan,
  {},
);

console.log('\nand EVERY catalogue name carrying a refusal word survives a second clause');
{
  const REFUSAL_WORDS = [
    'no', 'not', 'without', 'skip', 'avoid', 'do not', 'nope', 'nah',
    'remove', 'cancel',
  ];
  const carriesRefusalWord = new RegExp(`\\b(?:${REFUSAL_WORDS.join('|')})\\b`, 'i');
  const carriers = catalogue.filter((r) => carriesRefusalWord.test(r.name || ''));

  // A name with a comma in it holds more than one clause, so the clause the
  // refusal word is in is not the whole name and the catalogue cannot answer
  // for it. Those names are not what this rule is about.
  const withComma = [];
  const cut = [];
  for (const r of carriers) {
    const core = dishCore(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!core) continue;
    if (core.includes(',')) {
      withComma.push(core);
      continue;
    }
    const { plan } = parseSpokenPlanResult(`${core}, dal for dinner`, knownDish);
    const filed = (plan.dinner || '').trim();
    if (normalizeDish(filed) !== normalizeDish('dal')) {
      cut.push(`${core} -> "${filed}"`);
    }
  }
  check('every refusal-word name survives a second clause', cut, []);
  console.log(
    `       (${carriers.length - withComma.length} names checked, ${withComma.length} hold a comma and are not this rule)`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
