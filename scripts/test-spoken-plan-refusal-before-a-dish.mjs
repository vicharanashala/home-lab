/**
 * Tests for a refusal that comes in FRONT of an ordinary dish.
 *
 * WHY THIS EXISTS
 * The rule that tells a refusal word from a word inside a dish's own name asks
 * the catalogue, and the catalogue's answer for "no dal tadka" is "Dal Tadka" —
 * with a score of 0.753, which is the bar the app calls a confident match.
 *
 * That answer is right for the recipe picker and wrong here. "no dal tadka for
 * dinner" is a REFUSAL of the dal tadka, and with the catalogue's answer taken
 * at face value the parser filed the dinner with the dish "no dal tadka" and
 * raised NO refusal at all:
 *
 *   the dal tadka the user refused stayed on the plan,
 *   the shopping list bought it,
 *   and the sheet said "Added 1 meal by voice".
 *
 * It was not a corner case. The matcher charges only 0.08 for a word the
 * catalogue does not have — the matcher expects a person to say more than the
 * dish's name — so the score for "no <dish>" only falls below the bar when
 * the dish's name is ONE word long. For every dish of two words or more the
 * refusal was swallowed, and 5,622 of the 5,894 scraped names are two words
 * or more.
 *
 * The rule that saves it asks the catalogue a second time, about the phrase
 * with the refusal word taken OFF, and when THAT phrase is a dish on its own
 * the refusal word was a refusal and not part of a name.
 *
 * WHY THE SWEEP IS OVER A SAMPLE AND NOT EVERY DISH: the matcher walks the
 * whole catalogue on every call, so one dish costs about five milliseconds
 * and the whole catalogue costs half a minute — half again as long as the
 * rest of the suite, on every commit, for every agent. A slice taken evenly
 * across the catalogue costs the same two seconds and proves the same thing
 * about the same rules, because what is being tested is a rule and not a
 * particular dish.
 *
 * WHY THE POPULATION IS "PLAIN" NAMES: a dish whose own name holds a meal
 * word ("Sooji Halwa Breakfast Bowl"), a refusal word ("No Onion No Garlic
 * Lobia Masala"), a "Recipe - " tail or a leading article is a different
 * problem — the parser reads a meal word inside a name as a meal, and the
 * spoken form carries neither the tail nor the article the catalogue has.
 * Those are named in the report this test came out of; this test is about the
 * ordinary dish in front of an ordinary refusal.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-before-a-dish.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { matchDish, CONFIDENT_SCORE } = await import('../src/utils/spokenRecipeMatch.ts');
const { parseSpokenPlanResult, namesHeldDish } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanOutcome } = await import('../src/utils/spokenPlanEntries.ts');

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
 * The catalogue's answer to "is this a dish?" — the same rule the app uses
 * everywhere else, handed to the parser.
 */
const knownDish = (phrase) => {
  const match = matchDish(phrase, catalogue);
  return !!match.best && match.best.score >= CONFIDENT_SCORE;
};

/** What the utterance did, the way the sheet asks. */
function outcome(said, day) {
  const { plan, refusals } = parseSpokenPlanResult(said, knownDish);
  return spokenPlanOutcome(plan, refusals, day);
}

/** A day holding the dishes it is given. */
function dayHolding(dishes) {
  const day = { mode: 'normal', guests: 0 };
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const name = dishes[slot];
    day[slot] = name ? { name, slot, servings: 2, createdAt: 1000 } : null;
  }
  return day;
}

/** How the name is said out loud: the words, with no punctuation. */
function said(name) {
  return name
    .replace(/,/g, '')
    .replace(/[.!?:;"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('\na refusal in front of a dish of two words is still a refusal');
{
  const utterance = 'no dal tadka for dinner';
  check(
    '"no dal tadka for dinner" refuses the dal tadka',
    parseSpokenPlanResult(utterance, knownDish).refusals,
    [{ slot: 'dinner', dish: 'dal tadka' }],
  );
  check(
    '... and files no dish at all',
    parseSpokenPlanResult(utterance, knownDish).plan,
    {},
  );
  check(
    '... and empties the dinner the app is holding',
    outcome(utterance, dayHolding({ dinner: 'Dal Tadka' })).cleared,
    ['dinner'],
  );
}

console.log('\nand the same for a dish of three words and a dish of one');
{
  check(
    '"no paneer butter masala for dinner" refuses it',
    parseSpokenPlanResult('no paneer butter masala for dinner', knownDish).refusals,
    [{ slot: 'dinner', dish: 'paneer butter masala' }],
  );
  check(
    '"no dal for dinner" refuses it',
    parseSpokenPlanResult('no dal for dinner', knownDish).refusals,
    [{ slot: 'dinner', dish: 'dal' }],
  );
}

console.log('\nand a dish whose own name carries a refusal word is still a dish');
{
  const utterance = 'no onion no garlic lobia masala for dinner';
  check(
    'it is filed whole',
    parseSpokenPlanResult(utterance, knownDish).plan,
    { dinner: 'no onion no garlic lobia masala' },
  );
  check(
    '... and raises no refusal',
    parseSpokenPlanResult(utterance, knownDish).refusals,
    [],
  );
}

console.log('\nand a plain dish in the catalogue is refused when it is named');
{
  // The population: names that hold no meal word, no refusal word, no
  // "Recipe - " tail and no leading article — the ordinary dish, said the
  // ordinary way.
  const plain = catalogue
    .map((recipe) => (recipe.name || '').trim())
    .filter(Boolean)
    .filter(
      (name) =>
        !/\b(breakfast|lunch|dinner)\b/i.test(name) &&
        !/\b(no|not|without|skip|avoid|remove|cancel|nope|nah)\b/i.test(name) &&
        !/\bRecipe\b\s*[-–—]/.test(name) &&
        !/^(the|a|an|and)\b/i.test(name),
    );
  // One dish in twenty, taken evenly across the population.
  const sample = plain.filter((_, i) => i % 20 === 0);
  console.log(`       ${plain.length} plain names in the catalogue, ${sample.length} sampled`);

  const missed = [];
  for (const name of sample) {
    const { refusals } = parseSpokenPlanResult(`no ${said(name)} for dinner`, knownDish);
    const refused = refusals.some(
      (refusal) => refusal.dish && namesHeldDish(refusal.dish, name),
    );
    if (!refused) missed.push(name);
  }
  check('every sampled dish is refused when it is named', missed.length, 0);
  if (missed.length) {
    console.log('       the ones that were not:');
    for (const name of missed.slice(0, 20)) console.log(`         ${name}`);
    if (missed.length > 20) console.log(`         ... and ${missed.length - 20} more`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
