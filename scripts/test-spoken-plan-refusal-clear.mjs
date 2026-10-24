/**
 * Tests for a refusal that empties a meal.
 *
 * WHY THIS EXISTS
 * The parser takes a refused dish out of the plan, and the shopping list buys
 * the plan — so the refusal was the one thing the user was clearest about,
 * and it was the one thing the app could not carry:
 *
 *   "no dal for dinner"     -> the plan comes back empty, and an empty plan
 *                              reads as "the user did not mention the dinner"
 *   "breakfast dal, no it"  -> the breakfast's dal is gone from the plan
 *
 * The writer takes a slot the plan does not mention as "leave it alone",
 * which is RIGHT for a meal nobody said anything about and WRONG for a meal
 * the user refused. So the dal the user had just refused stayed in the plan,
 * the shopping list bought it, and the sheet said the meal had been heard:
 *
 *   said "no dal for dinner"  ->  the dinner still held dal
 *
 * These tests are the proof: the refusal empties the meal that is holding
 * the refused dish, and leaves every other dish exactly where it was.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-clear.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanEntries, spokenPlanClears, spokenPlanEditSlot } = await import(
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
 * What the day holds after a spoken day is applied — the way the page
 * applies it: the entries are written, and the meals a refusal emptied are
 * removed.
 */
function applySpoken(said, current) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  const entries = spokenPlanEntries(plan, {}, current, HOUSEHOLD);
  const cleared = spokenPlanClears(refusals, plan, current);
  const next = { ...current };
  // The order the page writes in: what the user refused comes off first, and
  // what the user said goes on after.
  for (const slot of cleared) next[slot] = null;
  for (const { slot, entry } of entries) next[slot] = entry;
  const holds = {};
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    holds[slot] = next[slot] ? next[slot].name : null;
  }
  return { plan, refusals, entries, cleared, holds };
}

console.log('\na refusal empties the meal that is holding the refused dish');
check(
  '"no dal for dinner" takes the dal out of the dinner',
  applySpoken('no dal for dinner', dayHolding({ dinner: 'dal' })).holds,
  { breakfast: null, lunch: null, dinner: null },
);

check(
  '"no dal for dinner" leaves every other meal alone',
  applySpoken(
    'no dal for dinner',
    dayHolding({ breakfast: 'oats', lunch: 'rice', dinner: 'dal' }),
  ).holds,
  { breakfast: 'oats', lunch: 'rice', dinner: null },
);

console.log('\nand a refusal that points back empties the meal it points at');
check(
  '"breakfast dal, no it, lunch rice" takes the dal out of the breakfast',
  applySpoken(
    'breakfast dal, no it, lunch rice',
    dayHolding({ breakfast: 'dal', lunch: 'biryani', dinner: 'sambar' }),
  ).holds,
  { breakfast: null, lunch: 'rice', dinner: 'sambar' },
);

console.log('\nand a refusal that names no meal empties every meal holding it');
check(
  '"no dal" takes the dal out of every meal holding it',
  applySpoken(
    'no dal',
    dayHolding({ breakfast: 'dal', lunch: 'rice', dinner: 'dal' }),
  ).holds,
  { breakfast: null, lunch: 'rice', dinner: null },
);

console.log('\nand a dish the user did not refuse is left exactly where it was');
check(
  '"no pizza for dinner" leaves a dal dinner alone',
  applySpoken('no pizza for dinner', dayHolding({ dinner: 'dal' })).holds,
  { breakfast: null, lunch: null, dinner: 'dal' },
);

check(
  '"no dal for dinner" leaves a dal lunch alone',
  applySpoken(
    'no dal for dinner',
    dayHolding({ lunch: 'dal', dinner: 'biryani' }),
  ).holds,
  { breakfast: null, lunch: 'dal', dinner: 'biryani' },
);

console.log('\nand a refusal of a dish nobody is holding changes nothing');
check(
  '"no dal for dinner" on a day with no dal changes nothing',
  applySpoken(
    'no dal for dinner',
    dayHolding({ breakfast: 'oats', lunch: 'rice', dinner: 'biryani' }),
  ).holds,
  { breakfast: 'oats', lunch: 'rice', dinner: 'biryani' },
);

console.log('\nand the refusal is said out loud, so the sheet can show it');
const said = parseSpokenPlanResult('no dal for dinner');
check('the refusal names the dish', said.refusals, [{ slot: 'dinner', dish: 'dal' }]);
check('the plan itself is unchanged', parseSpokenPlanResult('no dal for dinner').plan, {});
check(
  'a refusal that stands alone names no meal',
  parseSpokenPlanResult('no dal').refusals,
  [{ slot: null, dish: 'dal' }],
);

console.log('\nand a meal the utterance FILLED is not emptied by the refusal');
check(
  '"no dal for dinner, biryani for dinner" keeps the biryani',
  applySpoken(
    'no dal for dinner, biryani for dinner',
    dayHolding({ dinner: 'dal' }),
  ).holds,
  { breakfast: null, lunch: null, dinner: 'biryani' },
);
check(
  '"no dal for dinner, biryani for dinner" empties no meal',
  applySpoken(
    'no dal for dinner, biryani for dinner',
    dayHolding({ dinner: 'dal' }),
  ).cleared,
  [],
);
check(
  '"dinner biryani, no dal for dinner" keeps the biryani',
  applySpoken(
    'dinner biryani, no dal for dinner',
    dayHolding({ dinner: 'dal' }),
  ).holds,
  { breakfast: null, lunch: null, dinner: 'biryani' },
);
check(
  '"for dinner biryani, no dal" keeps the biryani and takes the other dal',
  applySpoken(
    'for dinner biryani, no dal',
    dayHolding({ breakfast: 'dal', dinner: 'dal' }),
  ).holds,
  { breakfast: null, lunch: null, dinner: 'biryani' },
);

console.log('\nand a field the user empties again does NOT take the refusal away');
{
  // The sheet as it stands after "no dal for dinner", with the day holding
  // the dal at the dinner.
  const day = dayHolding({ dinner: 'dal' });
  const { plan, refusals } = parseSpokenPlanResult('no dal for dinner');
  const draft = { plan, refusals };

  check(
    'the dinner is emptied before anything is typed',
    spokenPlanClears(draft.refusals, draft.plan, day),
    ['dinner'],
  );

  const typed = spokenPlanEditSlot(draft, 'dinner', 'biryani');
  check(
    'a dish typed over it wins, and the meal is not emptied',
    spokenPlanClears(typed.refusals, typed.plan, day),
    [],
  );

  const emptied = spokenPlanEditSlot(typed, 'dinner', '');
  check(
    'the refusal is still standing when the field is emptied again',
    spokenPlanClears(emptied.refusals, emptied.plan, day),
    ['dinner'],
  );
  check(
    'and the dal the user refused is not back on the plan',
    applySpoken('no dal for dinner', day).holds,
    { breakfast: null, lunch: null, dinner: null },
  );
}

console.log('\nand a refusal names a dish the way the RECIPE spells it');
{
  // The dish the day holds is the recipe's own name, and every recipe in the
  // catalogue begins with a capital — "Palak paneer". The dish the refusal
  // names is lowercased by the parser, so the two sides of the question "is
  // this the dish the user refused?" could never be equal for a single real
  // dish in the app.
  //
  // The refusal did nothing: the meal was not emptied, the refused dish
  // stayed on the plan, the shopping list bought it, and the sheet said
  // nothing at all because the utterance produced neither a plan nor a clear.
  const day = dayHolding({ dinner: 'Palak paneer' });
  const spoken = parseSpokenPlanResult('no palak paneer for dinner');

  check(
    'the refusal empties the meal holding the recipe by its own name',
    spokenPlanClears(spoken.refusals, spoken.plan, day),
    ['dinner'],
  );

  check(
    'and the dish the user refused is off the plan afterwards',
    applySpoken('no palak paneer for dinner', day).holds,
    { breakfast: null, lunch: null, dinner: null },
  );

  // WHY THE CASE IS FOLDED AND NOT THE MATCH LOOSENED: a dish that MERELY
  // CONTAINS the named dish is a different question, and the rule has always
  // declined to answer it. "no dal" must not take away a day holding
  // "Dal tadka" — the user named one dish and the day holds another.
  check(
    'a dish that merely contains the named one is left alone',
    applySpoken('no dal for dinner', dayHolding({ dinner: 'Dal tadka' })).holds,
    { breakfast: null, lunch: null, dinner: 'Dal tadka' },
  );

  // The other way round: the day holds a name the user would type in any
  // case, and the refusal is spoken.
  check(
    'a refusal still empties a meal the day holds in a different case',
    applySpoken('no DAL MAKHANI for dinner', dayHolding({ dinner: 'Dal makhani' }))
      .holds,
    { breakfast: null, lunch: null, dinner: null },
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
