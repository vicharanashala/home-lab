/**
 * Regression tests for the connector that stayed in the dish.
 *
 * The parser reads a spoken day as meal words, and a dish can sit on either
 * side of its meal word: "dinner dal" puts it behind, "dal for dinner" puts
 * it in front. The word that tells the two apart is the CONNECTOR, and the
 * parser knows five of them:
 *
 *     for · as · to be · will be · will have
 *
 * A connector is never part of the dish, so it has to be stripped from the
 * text the dish is taken out of. Four of the five were already noise, so
 * "dal for dinner", "dal to be dinner", "dal will be dinner" and "dal will
 * have dinner" all filed the dish as "dal". "as" was the one that was not,
 * so "dal as dinner" filed the dish as "dal as".
 *
 * That is not a cosmetic difference. "dal as" matches NO recipe in the
 * catalogue — not a weak match, none at all — so the plan held a dish that
 * could not be shopped for, and the shopping list bought nothing for it.
 * "dal" matches four. The words the user said and the words the plan shows
 * have to be the same words.
 *
 * Run with:  node scripts/test-spoken-plan-connectors.mjs
 */
import { parseSpokenPlan } from '../src/utils/spokenPlan.ts';

let passed = 0;
let failed = 0;

function check(text, expected, note = '') {
  const got = parseSpokenPlan(text);
  const want = JSON.stringify(expected);
  const have = JSON.stringify(got);
  if (have === want) {
    passed += 1;
    console.log(`  ok   ${JSON.stringify(text)} -> ${have}`);
  } else {
    failed += 1;
    console.log(
      `  FAIL ${JSON.stringify(text)} -> ${have}, expected ${want}${note ? ` (${note})` : ''}`,
    );
  }
}

console.log('\nno connector is left inside the dish');
check('dal as dinner', { dinner: 'dal' }, '"as" is a connector, not a dish');
check('dal makhani as dinner', { dinner: 'dal makhani' });
check('rice as lunch', { lunch: 'rice' });
check('idli as breakfast', { breakfast: 'idli' });

console.log('\nthe connectors that already worked still work');
check('dal for dinner', { dinner: 'dal' });
check('dal to be dinner', { dinner: 'dal' });
check('dal will be dinner', { dinner: 'dal' });
check('dal will have dinner', { dinner: 'dal' });

console.log('\nand the connector is not a dish of its own');
check('as dinner', {});
check('as', {});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
