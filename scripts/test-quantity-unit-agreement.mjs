/**
 * Regression test: the app must write a quantity ONE way, and it must not
 * invent a word the household never wrote.
 *
 * THE BUG
 *
 * The stock unit field is free text, so the unit on a stock row can be the
 * household's own noun — "tomatoes", "potatoes", "leaves". The rule that
 * writes a quantity took the singular of that word by dropping a letter, and
 * English does not make those singular that way:
 *
 *     the shelf row                    "1 tomatoe"
 *     the shopping list it seeds       "1 tomatoe"
 *     the model's STOCK block          "  - Tomatoes: 1 tomatoe"
 *
 * A word nobody wrote, on the one list the household shops from.
 *
 * AND THE APP HAD TWO RULES FOR IT
 *
 * The rule that spells a quantity that arrives as free text — `spellQuantity`
 * — was changed to leave a word the app does not know exactly as it was
 * written, so the same quantity reached the list two ways:
 *
 *     the shelf row's line on the list      "1 tomatoe"
 *     the add-to-list form's line           "1 tomatoes"
 *
 * One list, two spellings of one quantity. This test holds the two rules
 * together: the word the app writes for a household's noun is the word the
 * household used, on every screen and in the model's copy of the shelf.
 *
 * WHAT IS TESTED HERE
 *
 *   - the app never invents a word for a word the household typed;
 *   - the two rules that write a line onto the shopping list agree;
 *   - every unit the app KNOWS still reads the way it always read — the gate
 *     only touches words the app does not know;
 *   - the bridge, which keeps its own copy of the rule, agrees with the app.
 *
 * Run with:  node scripts/test-quantity-unit-agreement.mjs
 */
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE = path.join(REPO, 'bridge', 'shift ', 'index.mjs');

const { formatQuantity } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/date.ts')).href
);
const { spellQuantity, groceryQuantityForStock } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/groceryQuantity.ts')).href
);
const { WRITABLE_UNITS } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/unitTable.ts')).href
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

/* -------------------------------------------------------------------------- */
/* The household's own words                                                    */
/* -------------------------------------------------------------------------- */

// WHY THESE: each of them is a plural whose singular is NOT the word with a
// letter dropped, so a rule that drops a letter writes a word nobody wrote.
const HOUSEHOLD_WORDS = [
  'tomatoes',
  'potatoes',
  'chillies',
  'leaves',
  'loaves',
  'berries',
];

console.log('\nthe app does not invent a word for a word the household typed');

for (const word of HOUSEHOLD_WORDS) {
  ok(
    formatQuantity(1, word) === `1 ${word}`,
    `a quantity of one reads "1 ${word}"`,
    formatQuantity(1, word),
  );
}

console.log('\nthe shelf row and the shopping list write the same line');

for (const word of HOUSEHOLD_WORDS) {
  const item = { lowStockThreshold: 1, unit: word };
  const fromTheShelf = groceryQuantityForStock(item);
  const fromTheForm = spellQuantity(`1 ${word}`);
  ok(
    fromTheShelf === fromTheForm,
    `the line the shelf writes is the line the form writes — "${fromTheShelf}"`,
    fromTheShelf === fromTheForm ? '' : `the form wrote "${fromTheForm}"`,
  );
}

/* -------------------------------------------------------------------------- */
/* The units the app knows                                                     */
/* -------------------------------------------------------------------------- */

// WHY THIS IS THE WHOLE TABLE AND NOT A HANDFUL: the gate only touches words
// the app does not know, so every unit the app KNOWS has to read exactly as
// it read before. This is the check that the fix did not cost the app a
// single word it writes on purpose.
console.log('\nevery unit the app knows still reads the way it always read');

const KNOWN_SINGULARS = [
  'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'dozen', 'dozens',
  'g', 'gram', 'grams', 'kg', 'kgs', 'kilogram', 'kilograms',
  'ounce', 'ounces', 'oz', 'lb', 'lbs', 'pound', 'pounds',
  'ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters',
  'l', 'liter', 'liters', 'litre', 'litres',
  'tsp', 'tsps', 'teaspoon', 'teaspoons',
  'tbsp', 'tbs', 'tb', 'tablespoon', 'tablespoons',
  'cup', 'cups', 'pinch', 'pinches', 'dash', 'dashes',
  'pack', 'packs', 'packet', 'packets',
  'clove', 'cloves', 'bottle', 'bottles',
  'slice', 'slices', 'bunch', 'bunches', 'handful', 'handfuls',
];

const KNOWN = new Set(KNOWN_SINGULARS.map((u) => u.toLowerCase()));

for (const unit of WRITABLE_UNITS) {
  const written = formatQuantity(1, unit);
  const word = written.slice(written.indexOf(' ') + 1);
  ok(
    KNOWN.has(word.toLowerCase()),
    `a quantity of one "${unit}" reads "${written}", and the app knows that word`,
    written,
  );
}

console.log('\na quantity of more than one keeps the unit as it was written');

for (const unit of ['pcs', 'grams', 'bottles', 'tbsp', 'dozen', 'kg']) {
  ok(
    formatQuantity(3, unit) === `3 ${unit}`,
    `three reads "3 ${unit}"`,
    formatQuantity(3, unit),
  );
}

/* -------------------------------------------------------------------------- */
/* The bridge's own copy of the rule                                            */
/* -------------------------------------------------------------------------- */

/**
 * The bridge's rule, cut out of the shipped file.
 *
 * WHY IT IS CUT OUT BY ITS BRACES AND NOT BY A LINE RANGE: the bridge is one
 * long file and its lines move. Braces are what the function actually is, so
 * they are what the test follows.
 *
 * WHY IT FAILS LOUDLY AND NOT QUIETLY: if the bridge is ever rearranged so
 * that this rule cannot be found, the test must say so. A test that quietly
 * stopped testing anything is the failure this whole file exists to end.
 *
 * @returns {(qty: number, unit?: string) => string} the bridge's formatQuantity
 */
function bridgeFormatQuantity() {
  const source = fs.readFileSync(BRIDGE, 'utf8');

  const unitsAt = source.indexOf('const ACTION_UNITS = new Set([');
  const singularAt = source.indexOf('function singularUnit(unit)');
  const formatAt = source.indexOf('function formatQuantity(qty, unit)');
  if (unitsAt < 0 || singularAt < 0 || formatAt < 0) {
    throw new Error(
      'could not find the quantity rule in bridge/shift /index.mjs — this test has to be told how the bridge is arranged now',
    );
  }

  // The list of unit words the bridge knows.
  const listOpen = source.indexOf('[', unitsAt);
  const listClose = source.indexOf(']', listOpen);
  if (listOpen < 0 || listClose < 0) throw new Error('could not read the ACTION_UNITS list');
  const list = source.slice(listOpen, listClose + 1);

  // The two functions, each cut out at its own closing brace.
  const cut = (at) => {
    let depth = 0;
    for (let i = source.indexOf('{', at); i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(at, i + 1);
      }
    }
    throw new Error('could not find the end of a function in the bridge');
  };

  const body = [
    `const ACTION_UNITS = new Set(${list});`,
    cut(singularAt),
    cut(formatAt),
    'return formatQuantity;',
  ].join('\n');

  try {
    return new Function(body)();
  } catch (err) {
    throw new Error(
      `could not run the bridge's quantity rule as it is written: ${err.message}`,
    );
  }
}

const bridge = bridgeFormatQuantity();

console.log('\nthe bridge tells the model the same word the app shows');

for (const word of HOUSEHOLD_WORDS) {
  ok(
    bridge(1, word) === `1 ${word}`,
    `the bridge's STOCK block reads "1 ${word}"`,
    bridge(1, word),
  );
}

for (const unit of ['pcs', 'grams', 'bottles', 'tbsp', 'tbs', 'dozen']) {
  const app = formatQuantity(1, unit);
  ok(
    bridge(1, unit) === app,
    `the bridge and the app agree on "${unit}" — "${app}"`,
    bridge(1, unit),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
