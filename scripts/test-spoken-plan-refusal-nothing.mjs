/**
 * Tests for a refusal that has nothing to remove.
 *
 * WHY THIS EXISTS
 * The sheet tells the user what it understood. When the app understood the
 * utterance perfectly and had nothing to do about it, it said the other
 * thing:
 *
 *   "no dal for dinner"   (the dinner is holding biryani)
 *     -> "could not tell which meal it was for. Try saying ..."
 *
 * The meal WAS told — it was the dinner — and the dish was told — it was the
 * dal. There was simply no dal to remove. The message claimed the app had
 * not understood, and sent the user off to say it again, more slowly, to be
 * told the same thing again.
 *
 * The refusal work fixed the half of this where the refusal DID have
 * something to remove: the sheet opens and shows the meal it empties. The
 * other half — a refusal with nothing to remove — still produced the old
 * message, because the sheet could only say two things and neither of them
 * was true.
 *
 * These tests are the proof: a refusal the app understood and cannot act on
 * says THAT, a refusal that has something to remove still opens the sheet,
 * and an utterance that was never understood still says so.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-nothing.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanOutcome, spokenPlanError, spokenPlanRefusalMessage } = await import(
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

/** A day holding the dishes it is given. */
function dayHolding(dishes) {
  const day = { mode: 'normal', guests: 0 };
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const name = dishes[slot];
    day[slot] = name ? { name, slot, servings: 2, createdAt: NOW } : null;
  }
  return day;
}

/** What the utterance did, the way the sheet asks. */
function outcome(said, day) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  return spokenPlanOutcome(plan, refusals, day);
}

/** What the user is told, the way the sheet tells it. */
function message(said, day) {
  const result = outcome(said, day);
  return spokenPlanError(said, result);
}

console.log('\na refusal with nothing to remove says so');
check(
  '"no dal for dinner" when the dinner is holding biryani is a refusal, not nothing',
  outcome('no dal for dinner', dayHolding({ dinner: 'biryani' })).kind,
  'refused',
);

check(
  '... and says the dal is not there to remove',
  message('no dal for dinner', dayHolding({ dinner: 'biryani' })),
  'Heard "no dal for dinner" — there is no dal to remove from the dinner.',
);

check(
  '... and does not claim the meal could not be told',
  message('no dal for dinner', dayHolding({ dinner: 'biryani' })).includes(
    'could not tell which meal it was for',
  ),
  false,
);

console.log('\nand a refusal that named no meal names the plan');
check(
  '"no dal" when nothing holds dal is a refusal',
  outcome('no dal', dayHolding({ dinner: 'biryani' })).kind,
  'refused',
);

check(
  '... and says there is no dal on the plan to remove',
  message('no dal', dayHolding({ dinner: 'biryani' })),
  'Heard "no dal" — there is no dal to remove from the plan.',
);

console.log('\nand a refusal that HAS something to remove still opens the sheet');
check(
  '"no dal for dinner" when the dinner holds dal is a plan',
  outcome('no dal for dinner', dayHolding({ dinner: 'dal' })).kind,
  'plan',
);

check(
  '... and empties the dinner',
  outcome('no dal for dinner', dayHolding({ dinner: 'dal' })).cleared,
  ['dinner'],
);

console.log('\nand an utterance that was never understood still says so');
check(
  'nonsense is nothing at all',
  outcome('hello there', dayHolding({ dinner: 'dal' })).kind,
  'nothing',
);

check(
  '... and says the app could not tell which meal it was for',
  message('hello there', dayHolding({ dinner: 'dal' })),
  'Heard "hello there" but could not tell which meal it was for. Try saying "breakfast …, lunch …, dinner …".',
);

check(
  'silence says nothing was picked up',
  message('', dayHolding({ dinner: 'dal' })),
  'Nothing was picked up. Hold the phone closer and speak a little louder.',
);

console.log('\nand a plan is still a plan');
check(
  '"dinner biryani" is a plan',
  outcome('dinner biryani', dayHolding({ dinner: 'dal' })).kind,
  'plan',
);

console.log('\nand several refusals with nothing to remove are all named');
check(
  'two refusals, neither with anything to remove',
  spokenPlanRefusalMessage([
    { slot: 'dinner', dish: 'dal' },
    { slot: null, dish: 'rice' },
  ]),
  'there is nothing to remove for dal or rice',
);

console.log('\nand the TYPED path says the same thing in its own words');
check(
  'a typed refusal with nothing to remove says so',
  spokenPlanError(
    'no dal for dinner',
    outcome('no dal for dinner', dayHolding({ dinner: 'biryani' })),
    'typed',
  ),
  '"no dal for dinner" — there is no dal to remove from the dinner.',
);

check(
  'a typed refusal with nothing to remove does not claim it could not tell',
  spokenPlanError(
    'no dal for dinner',
    outcome('no dal for dinner', dayHolding({ dinner: 'biryani' })),
    'typed',
  ).includes('Could not tell which meal'),
  false,
);

check(
  'a typed line that named no meal still says so',
  spokenPlanError('hello there', outcome('hello there', dayHolding({})), 'typed'),
  'Could not tell which meal that was for. Include "breakfast", "lunch" or "dinner".',
);

check(
  'an empty typed line says to type the day first',
  spokenPlanError('', outcome('', dayHolding({})), 'typed'),
  'Type the day first, or dictate into this box.',
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
