/**
 * Regression test: the app must never write a unit word it cannot read back.
 *
 * THE BUG
 *
 * The app has one rule for writing a quantity — `formatQuantity` in
 * src/utils/date.ts — and it writes a quantity of ONE with a SINGULAR unit,
 * by stripping a trailing "s" off the unit the household wrote:
 *
 *     the unit "grams"  ->  "1 gram"
 *     the unit "tbs"    ->  "1 tb"
 *
 * The app's own unit table (src/utils/unitTable.ts) is the one place that decides
 * what the app understands, and it carries BOTH forms of every spoon unit it
 * knows — "tsp" and "tsps", "cup" and "cups", "pinch" and "pinches",
 * "tablespoon" and "tablespoons" — and both "tbsp" and "tbs".
 *
 * But it carried neither form of the singular of "tbs":
 *
 *     the table has      "tbs"   ->  15 ml, a spoon
 *     the table has NOT  "tb"    ->  the word the app WRITES at quantity one
 *
 * So the app wrote a unit word that appears NOWHERE in the app:
 *
 *     the stock row          "1 tb"
 *     the shopping list      "1 tb"
 *     the same row, at two   "2 tbs"
 *
 * ONE unit, TWO spellings, on one list — the exact failure the app's
 * single-rule-for-quantities work exists to end.
 *
 * WHY IT MATTERS BEYOND THE SPELLING: "tb" is a word the app cannot
 * CONVERT. `toBaseUnit(1, "tb")` is null and `unitDimension("tb")` is
 * "unknown", so a stock row held in "tb" is invisible to the app — it never
 * matches a recipe and nothing is ever deducted from it:
 *
 *     toBaseUnit(1, "tbs")  ->  { value: 15, dimension: "scoop" }   usable
 *     toBaseUnit(1, "tb")   ->  null                                invisible
 *
 * And the app is what puts the word "tb" in front of the household: the row
 * reads "1 tb", so "tb" is the word a household reaches for when it types
 * the unit on the next item. The app teaches the word and then cannot use
 * it.
 *
 * WHY THIS IS WORTH A TEST: the table and the rule are two separate pieces
 * of knowledge and they drift — the rule invents a singular, and the table
 * has to carry it. The rule has no way to know what the table holds, so
 * nothing in the app could tell that it had written a word of its own
 * making.
 *
 * So the test does not restate a list of units. It takes the units the app
 * REALLY uses, from the app's own table, asks the app's REAL rule what each
 * one reads as at a quantity of one, and asks the app's own table whether it
 * knows that word. A unit added to the table later is covered without this
 * file being edited.
 *
 * WHAT IS TESTED HERE
 *
 *   - the REAL rule, asked what a quantity should read as;
 *   - the REAL table, asked whether it carries that word;
 *   - the words the app writes for EVERY unit it carries, so the next unit
 *     added to the table is checked too.
 *
 * Run with:  node scripts/test-unit-word-round-trip.mjs
 */
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { formatQuantity } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/date.ts')).href
);
const { KNOWN_UNITS, unitDimension, toBaseUnit } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/units.ts')).href
);

let passed = 0;
let failed = 0;

function ok(cond, label, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('\nthe app writes only unit words it can read back');

/**
 * The word the rule writes for a unit, at a quantity.
 *
 * WHY IT IS THE REAL RULE AND NOT A RESTATEMENT: the rule decides whether
 * a quantity is singular and how it is spaced, so a test that restated it
 * could agree with a broken rule. This asks the rule itself.
 *
 * @param {number} qty the quantity
 * @param {string} unit the unit, as the household wrote it
 * @returns {string} the unit word the rule writes
 */
function writtenUnit(qty, unit) {
  const written = formatQuantity(qty, unit);
  // The rule writes "<number> <unit>", so the unit word is what follows the
  // number and its space.
  const afterNumber = written.slice(String(qty).length).trim();
  return afterNumber;
}

// EVERY unit the app carries, at a quantity of one — the count where the rule
// makes the unit singular, and so the only count where a unit can lose its
// identity.
for (const unit of KNOWN_UNITS) {
  const word = writtenUnit(1, unit);
  ok(
    KNOWN_UNITS.some((u) => u.toLowerCase() === word.toLowerCase()),
    `the unit "${unit}" reads "${word}" at a quantity of one, and the app knows that word`,
    `the app writes "${formatQuantity(1, unit)}"`,
  );
}

console.log('\nand the word it writes is one the app can convert');

for (const unit of KNOWN_UNITS) {
  const word = writtenUnit(1, unit);
  ok(
    unitDimension(word) !== 'unknown',
    `the app can convert the word it writes for "${unit}"`,
    `the word is "${word}", and its dimension is "${unitDimension(word)}"`,
  );
}

console.log('\nand the same unit is written one way at every count');

for (const unit of KNOWN_UNITS) {
  const one = writtenUnit(1, unit);
  const two = writtenUnit(2, unit);
  ok(
    toBaseUnit(1, one) !== null && toBaseUnit(1, two) !== null,
    `"${unit}" is usable at one ("${one}") and at two ("${two}")`,
    `the app converts "${one}" to ${JSON.stringify(toBaseUnit(1, one))} and "${two}" to ${JSON.stringify(toBaseUnit(1, two))}`,
  );
}

console.log('\nand the word that started this is the one the table was missing');

{
  // The unit the household wrote, and the word the app wrote for it.
  const written = formatQuantity(1, 'tbs');
  const word = writtenUnit(1, 'tbs');
  ok(
    written === '1 tb',
    'the rule writes "1 tb" for a quantity of one "tbs"',
    written,
  );
  ok(
    KNOWN_UNITS.some((u) => u.toLowerCase() === word.toLowerCase()),
    'and the app knows that word',
    `the app knows "${word}"? ${KNOWN_UNITS.some((u) => u.toLowerCase() === word.toLowerCase())}`,
  );
  ok(
    toBaseUnit(1, word) !== null,
    'so a row held in it can still be matched and deducted from',
    `toBaseUnit(1, "${word}") is ${JSON.stringify(toBaseUnit(1, word))}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
