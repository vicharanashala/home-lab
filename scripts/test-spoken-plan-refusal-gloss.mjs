/**
 * Regression tests for a refused dish whose NAME carries a gloss.
 *
 * WHY THIS EXISTS
 * A dish name reaches the refusal rule in two shapes. The dish the user SAYS
 * is a spoken fragment — "bhindi masala". The dish the DAY holds is a
 * recipe's own name, and a recipe's own name is written with a gloss on it:
 *
 *   "Bhindi masala (okra)"        "Lemon rice (chitranna)"
 *   "Upma (rava upma)"            "Baingan Bharta Recipe - Brinjal Bharta"
 *   "Homemade Tater Tots"         "Masala chaas (buttermilk)"
 *
 * The recipe picker and the suggestion sheet both write the recipe's own
 * name onto the day, so a day holding a gloss is the NORMAL case, not a rare
 * one. The refusal rule compared the two shapes as they stood, so the gloss
 * made the two names unequal and the refusal did nothing:
 *
 *   day holds "Bhindi masala (okra)"   user says "no bhindi masala for dinner"
 *                                             -> the meal was NOT emptied
 *
 * The shopping list buys the plan, so the refused dish stayed on the list and
 * the sheet said there was nothing to remove.
 *
 * The fix folds both sides through the rule the rest of the app already uses
 * to answer "is this the same dish?" — `dishCore`, which is what the matcher
 * matches on — so the refusal agrees with the matcher. That is the whole
 * point of a shared answer; see `sameDish`.
 *
 * And it must not make two dishes one: a dish that merely CONTAINS the named
 * one is still a different dish, and refusing a dal must leave a dal tadka
 * alone.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-gloss.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult, namesHeldDish } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanEntries, spokenPlanClears } = await import(
  '../src/utils/spokenPlanEntries.ts'
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

console.log('\na dish the day holds under its own name can be refused by the name it is said');
check(
  '"no bhindi masala for dinner" takes the bhindi out of the dinner',
  applySpoken(
    'no bhindi masala for dinner',
    dayHolding({ dinner: 'Bhindi masala (okra)' }),
  ).holds,
  EMPTY,
);

check(
  '"no lemon rice for dinner" takes the lemon rice out of the dinner',
  applySpoken(
    'no lemon rice for dinner',
    dayHolding({ dinner: 'Lemon rice (chitranna)' }),
  ).holds,
  EMPTY,
);

check(
  '"no upma for dinner" takes the upma out of the dinner',
  applySpoken(
    'no upma for dinner',
    dayHolding({ dinner: 'Upma (rava upma)' }),
  ).holds,
  EMPTY,
);

check(
  '"no masala chaas for dinner" takes the chaas out of the dinner',
  applySpoken(
    'no masala chaas for dinner',
    dayHolding({ dinner: 'Masala chaas (buttermilk)' }),
  ).holds,
  EMPTY,
);

check(
  '"no baingan bharta for dinner" takes the bharta out of the dinner',
  applySpoken(
    'no baingan bharta for dinner',
    dayHolding({ dinner: 'Baingan Bharta Recipe - Brinjal Bharta' }),
  ).holds,
  EMPTY,
);

check(
  '"no tater tots for dinner" takes the tater tots out of the dinner',
  applySpoken(
    'no tater tots for dinner',
    dayHolding({ dinner: 'Homemade Tater Tots' }),
  ).holds,
  EMPTY,
);

console.log('\nand the rule itself says the same thing');
check(
  'the spoken name matches the recipe name with its gloss',
  namesHeldDish('bhindi masala', 'Bhindi masala (okra)'),
  true,
);

check(
  'and it matches a name with a "Recipe -" tail',
  namesHeldDish('baingan bharta', 'Baingan Bharta Recipe - Brinjal Bharta'),
  true,
);

check(
  'and it matches a name the app dropped a noise word from',
  namesHeldDish('tater tots', 'Homemade Tater Tots'),
  true,
);

console.log('\nand a dish that merely CONTAINS the named one is still left alone');
check(
  '"no dal for dinner" leaves a dinner holding "Dal tadka" alone',
  applySpoken(
    'no dal for dinner',
    dayHolding({ dinner: 'Dal tadka' }),
  ).holds,
  { breakfast: null, lunch: null, dinner: 'Dal tadka' },
);

check(
  '"no dal for dinner" leaves a dinner holding "Moong dal" alone',
  applySpoken(
    'no dal for dinner',
    dayHolding({ dinner: 'Moong dal' }),
  ).holds,
  { breakfast: null, lunch: null, dinner: 'Moong dal' },
);

check(
  'the rule does not match a dish that merely contains the named one',
  namesHeldDish('dal', 'Dal tadka'),
  false,
);

console.log('\nand two dishes told apart by their gloss stay told apart');
check(
  '"no bhindi masala for dinner" leaves a dinner holding "Bhindi masala (okra) curry" alone',
  applySpoken(
    'no bhindi masala for dinner',
    dayHolding({ dinner: 'Bhindi masala (okra) curry' }),
  ).holds,
  { breakfast: null, lunch: null, dinner: 'Bhindi masala (okra) curry' },
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
