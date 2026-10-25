/**
 * Tests for a dish whose own name carries a refusal word, said AFTER a refusal
 * clause.
 *
 * WHY THIS EXISTS
 * "no" and "without" are refusal words — they are how a person says they do
 * not want a dish — and they are also parts of real dish names:
 *
 *   "Biryani without onion"
 *   "Dal without rice"
 *   "Red Lentil Curry Without Coconut"
 *
 * The rule that takes the dish after a refusal clause walks over the refusal
 * clauses one after another. It has to decide, at each step, whether the
 * clause it is looking at is ANOTHER refusal clause or the dish the user
 * asked for:
 *
 *   "no dal, no rice, biryani for dinner"   two refusals, then the dish
 *   "no dal, biryani without onion"          one refusal, then the dish
 *
 * The test for that question was "does this clause hold a refusal word
 * ANYWHERE", and the second one holds one — "without" — in the MIDDLE of the
 * dish. So the dish was read as another refusal clause, and the biryani was
 * thrown away with it:
 *
 *   said "no dal, biryani without onion for dinner"
 *     -> the plan held NOTHING
 *
 * The biryani the user said out loud vanished without a trace: the plan held
 * no biryani, the shopping list bought no biryani, and nothing anywhere said
 * the biryani had been lost. The dal was refused, and the biryani was asked
 * for — and the biryani was lost.
 *
 * The question is not "does the clause hold a refusal word" but "does the
 * clause OPEN with one". A refusal word further along a clause is part of a
 * dish's own name, not the start of another clause.
 *
 * These tests are the proof: the shapes that worked before still work, the
 * dish the user asked for is filed, and the dishes the user refused are still
 * refused.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-clause-dish.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanClears, spokenPlanEntries } = await import(
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

/** What the utterance filed, and what it refused. */
function parsed(said) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  return { plan, refusals };
}

/** The meals the utterance empties. */
function cleared(said, day) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  return spokenPlanClears(refusals, plan, day);
}

/**
 * What the day holds after the utterance is applied — the way the page
 * applies it: the meals a refusal emptied are removed, and the dishes the
 * user said are written.
 */
function holds(said, day) {
  const { plan, refusals } = parseSpokenPlanResult(said);
  const entries = spokenPlanEntries(plan, {}, day, {
    adults: 2,
    children: 0,
    guests: 0,
  });
  const emptied = spokenPlanClears(refusals, plan, day);
  const next = { ...day };
  for (const slot of emptied) next[slot] = null;
  for (const { slot, entry } of entries) next[slot] = entry;
  const out = {};
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    out[slot] = next[slot] ? next[slot].name : null;
  }
  return out;
}

console.log('\nthe dish after a refusal clause is filed, even when its own name carries a refusal word');
check(
  '"no dal, biryani without onion for dinner" files the biryani',
  parsed('no dal, biryani without onion for dinner').plan,
  { dinner: 'biryani without onion' },
);
check(
  '"no dal, biryani without onion for dinner" still refuses the dal',
  parsed('no dal, biryani without onion for dinner').refusals,
  [
    { slot: null, dish: 'dal' },
    { slot: 'dinner', dish: 'onion' },
  ],
);
check(
  '"no dal, dal without rice for dinner" files the dal',
  parsed('no dal, dal without rice for dinner').plan,
  { dinner: 'dal without rice' },
);

console.log('\nand the day ends up holding the dish the user asked for');
check(
  '"no dal, biryani without onion for dinner" puts the biryani on the day',
  holds('no dal, biryani without onion for dinner', dayHolding({ dinner: 'dal' })),
  { breakfast: null, lunch: null, dinner: 'biryani without onion' },
);
check(
  '"no dal, biryani without onion for dinner" takes the refused dal off the day',
  holds('no dal, biryani without onion for dinner', dayHolding({ breakfast: 'dal' })),
  { breakfast: null, lunch: null, dinner: 'biryani without onion' },
);

console.log('\nand a clause that OPENS with a refusal is still a refusal clause');
check(
  '"no dal, no rice, biryani for dinner" files the biryani',
  parsed('no dal, no rice, biryani for dinner').plan,
  { dinner: 'biryani' },
);
check(
  '"no dal, no rice, biryani for dinner" refuses both dishes',
  parsed('no dal, no rice, biryani for dinner').refusals,
  [
    { slot: null, dish: 'dal' },
    { slot: null, dish: 'rice' },
  ],
);
check(
  '"no dal, not rice, biryani for dinner" files the biryani',
  parsed('no dal, not rice, biryani for dinner').plan,
  { dinner: 'biryani' },
);

console.log('\nand the shapes that worked before still work');
check(
  '"no dal, biryani for dinner" files the biryani',
  parsed('no dal, biryani for dinner').plan,
  { dinner: 'biryani' },
);
check(
  '"no dal, biryani for dinner" refuses the dal',
  parsed('no dal, biryani for dinner').refusals,
  [{ slot: null, dish: 'dal' }],
);
check(
  '"no dal, biryani and salad for lunch" files both dishes',
  parsed('no dal, biryani and salad for lunch').plan,
  { lunch: 'biryani and salad' },
);
check(
  '"no dal, biryani" refuses the dal and not the biryani',
  parsed('no dal, biryani').refusals,
  [{ slot: null, dish: 'dal' }],
);
check(
  '"no dal, biryani" empties the dinner holding the dal',
  cleared('no dal, biryani', dayHolding({ dinner: 'Dal' })),
  ['dinner'],
);
check(
  '"no dal for dinner" files nothing',
  parsed('no dal for dinner').plan,
  {},
);
check(
  '"no dal for dinner" refuses the dal',
  parsed('no dal for dinner').refusals,
  [{ slot: 'dinner', dish: 'dal' }],
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
