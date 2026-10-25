/**
 * Tests for a refusal that is followed by a dish in a clause of its own.
 *
 * WHY THIS EXISTS
 * The refusal work taught the app to empty a meal when the user refuses the
 * dish that meal is holding. It never taught it what to do when the user
 * refuses one dish and asks for another in the same breath:
 *
 *   "no dal, biryani for dinner"
 *
 * The dal is refused and the biryani is the dinner. The app filed NEITHER:
 * the stretch of speech in front of the dinner was "no dal, biryani", and
 * with the refusal's own clause left in, the dish began with a refusal word
 * — so the rule that keeps a refused dish out of the plan threw the BIRYANI
 * out with it.
 *
 * The biryani the user said out loud vanished without a trace. The plan held
 * no biryani, the shopping list bought no biryani, and nothing anywhere said
 * the biryani had been lost. The user was told the dal had been removed,
 * which was true, and nothing at all about the biryani they had asked for.
 *
 * These tests are the proof: a dish said after a refusal clause is filed, the
 * refused dish is still refused, and the shapes that worked before still
 * work.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-then-dish.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanClears, spokenPlanOutcome } = await import(
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

console.log('\na dish said AFTER a refusal clause is filed');
check(
  '"no dal, biryani for dinner" files the biryani',
  parsed('no dal, biryani for dinner').plan,
  { dinner: 'biryani' },
);
check(
  '"no dal, biryani for dinner" still refuses the dal',
  parsed('no dal, biryani for dinner').refusals,
  [{ slot: null, dish: 'dal' }],
);
check(
  '"no dal, biryani dinner" files the biryani (no connector)',
  parsed('no dal, biryani dinner').plan,
  { dinner: 'biryani' },
);
check(
  '"dal for dinner, no dal, rice for lunch" files the rice',
  parsed('dal for dinner, no dal, rice for lunch').plan,
  { lunch: 'rice' },
);
check(
  '"dal for dinner, no dal, rice for lunch" refuses the dal',
  parsed('dal for dinner, no dal, rice for lunch').refusals,
  [{ slot: null, dish: 'dal' }],
);
check(
  '"no dal, biryani for dinner, rice for lunch" files both dishes',
  parsed('no dal, biryani for dinner, rice for lunch').plan,
  { dinner: 'biryani', lunch: 'rice' },
);

console.log('\nthe refused dish is taken away, and the other one is kept');
check(
  '"dal for dinner, no dal, rice for lunch" empties the dinner holding the dal',
  cleared('dal for dinner, no dal, rice for lunch', dayHolding({ dinner: 'Dal' })),
  ['dinner'],
);
check(
  '"no dal, biryani for dinner" does NOT empty the dinner — the biryani replaces the dal',
  cleared('no dal, biryani for dinner', dayHolding({ dinner: 'Dal' })),
  [],
);
check(
  'the utterance is still a plan, and the sheet opens',
  spokenPlanOutcome(
    parsed('no dal, biryani for dinner').plan,
    parsed('no dal, biryani for dinner').refusals,
    dayHolding({ dinner: 'Dal' }),
  ).kind,
  'plan',
);

console.log('\nthe shapes that worked before still work');
check('"no dal for dinner" refuses the dal', parsed('no dal for dinner').refusals, [
  { slot: 'dinner', dish: 'dal' },
]);
check('"no dal for dinner" files nothing', parsed('no dal for dinner').plan, {});
check(
  '"dal for dinner, biryani for lunch" files both',
  parsed('dal for dinner, biryani for lunch').plan,
  { dinner: 'dal', lunch: 'biryani' },
);
check(
  '"no dal for dinner, biryani for dinner" files the biryani',
  parsed('no dal for dinner, biryani for dinner').plan,
  { dinner: 'biryani' },
);
check(
  '"rice, no dal for dinner" is still the rice (a dish BEFORE the refusal)',
  parsed('rice, no dal for dinner').plan,
  { dinner: 'rice' },
);
check(
  '"lunch rice, no dal" is still the rice',
  parsed('lunch rice, no dal').plan,
  { lunch: 'rice' },
);
check('"no breakfast" refuses the meal', parsed('no breakfast').refusals, [
  { slot: 'breakfast', dish: '' },
]);
check('"biryani dinner" files the biryani', parsed('biryani dinner').plan, {
  dinner: 'biryani',
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
