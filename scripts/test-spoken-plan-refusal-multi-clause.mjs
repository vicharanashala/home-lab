/**
 * Tests for a refusal that shares its stretch of speech with another clause.
 *
 * WHY THIS EXISTS
 * Two shapes of the same kind of mistake, both about a refusal that has a
 * comma in it.
 *
 * The first is a stretch that holds MORE THAN ONE refusal clause:
 *
 *   "no dal, no rice, biryani for dinner"
 *
 * The dal is refused, the rice is refused, and the biryani is the dinner.
 * The app filed NOTHING. The rule that takes the dish after a refusal clause
 * stepped over the FIRST clause only, so the text it returned still began
 * with the SECOND refusal word ("no rice, biryani") — and the rule that
 * keeps a refused dish out of the plan then threw the BIRYANI out with it.
 *
 * The biryani the user said out loud vanished without a trace: the plan held
 * no biryani, the shopping list bought no biryani, and nothing anywhere said
 * the biryani had been lost. The dinner that was holding the dal was
 * emptied, so the dinner the user asked about ended up empty as well.
 *
 * The second is a refusal whose own clause ends at a comma:
 *
 *   "no dal, biryani"
 *
 * The dal is refused and the biryani was asked for. The refusal named the
 * dish as "dal biryani" — the whole rest of the sentence, comma and all —
 * so it matched no dish on the day and NOTHING was emptied. The sheet said
 * the refusal had been heard ("refused") while the dal the user had refused
 * stayed on the plan. The shopping list buys the plan, so the list bought
 * the very dish the user had refused.
 *
 * A comma ends the clause it is in, and a refusal is about the clause it was
 * said in. The rule that reads the dish a refusal names has to stop at that
 * comma, the way the rule that reads the dish a meal names already does.
 *
 * These tests are the proof: the shapes that worked before still work, the
 * refusals still name the dish they refuse, and the dishes the user asked
 * for are filed.
 *
 * Run with:  node scripts/test-spoken-plan-refusal-multi-clause.mjs
 */
import { register } from 'node:module';

// The app's modules import each other without a file extension, so the
// resolver hook has to be in place before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseSpokenPlanResult } = await import('../src/utils/spokenPlan.ts');
const { spokenPlanClears } = await import(
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

console.log('\nmore than one refusal clause, and then the dish');
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
check(
  '"no dal, no rice, biryani" names no dish to file, but still refuses both',
  parsed('no dal, no rice, biryani').refusals,
  [
    { slot: null, dish: 'dal' },
    { slot: null, dish: 'rice' },
  ],
);

console.log('\na refusal names the dish in its OWN clause');
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
  '"no dal, no rice" refuses each dish by its own name',
  parsed('no dal, no rice').refusals,
  [
    { slot: null, dish: 'dal' },
    { slot: null, dish: 'rice' },
  ],
);
check(
  '"no dal, no rice" empties the dinner holding the dal',
  cleared('no dal, no rice', dayHolding({ dinner: 'Dal' })),
  ['dinner'],
);

console.log('\nthe shapes that worked before still work');
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
  '"rice, no dal for dinner" is still the rice (a dish BEFORE the refusal)',
  parsed('rice, no dal for dinner').plan,
  { dinner: 'rice' },
);
check(
  '"dal for dinner, no dal, rice for lunch" files the rice',
  parsed('dal for dinner, no dal, rice for lunch').plan,
  { lunch: 'rice' },
);
check(
  '"no dal for dinner" refuses the dal',
  parsed('no dal for dinner').refusals,
  [{ slot: 'dinner', dish: 'dal' }],
);
check(
  '"no dal for dinner" files nothing',
  parsed('no dal for dinner').plan,
  {},
);
check(
  '"no dal" empties the dinner holding the dal',
  cleared('no dal', dayHolding({ dinner: 'Dal' })),
  ['dinner'],
);
check(
  '"dal for dinner, no dal" empties the dinner holding the dal',
  cleared('dal for dinner, no dal', dayHolding({ dinner: 'Dal' })),
  ['dinner'],
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
