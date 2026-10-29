/**
 * Regression test: the House Bot's bullet parser must read back every
 * quantity the app itself writes.
 *
 * THE BUG
 *
 * The shopping list is ONE list, and the app writes its quantities with one
 * rule — `formatQuantity` in src/utils/date.ts. That rule decides two things:
 * a quantity of ONE is written with a SINGULAR unit, and the number and the
 * unit are separated by a space:
 *
 *     formatQuantity(1, 'pcs')      ->  "1 pc"
 *     formatQuantity(2, 'pcs')      ->  "2 pcs"
 *     formatQuantity(1, 'bottles')  ->  "1 bottle"
 *
 * The House Bot writes onto that same list, and the parser that reads its
 * reply has to take a quantity OFF the front of a bullet and leave the
 * ingredient's NAME:
 *
 *     "- 1 pc of eggs"      ->  { name: "eggs", quantity: "1 pc" }
 *     "- 1 bottle of milk"  ->  { name: "milk", quantity: "1 bottle" }
 *
 * The parser recognised a list of unit WORDS, and the list was missing two
 * of the units the app writes every day:
 *
 *     "pcs"       but not "pc"      the singular the rule writes at quantity one
 *     (no "bottle" at all)         one of the nine units the add form offers
 *
 * "pcs" is the DEFAULT unit for a new stock item — every stock row in the
 * kitchen is measured in it — and the app writes "1 pc" for it. So the bullet
 * the House Bot writes back is the one the app's own rule wrote, and the
 * parser could not read it:
 *
 *     "- 1 pc of eggs"  ->  { name: "pc of eggs", quantity: "1" }
 *
 * WHAT IT LOOKS LIKE TO THE USER
 *
 * The shopping list shows an item called "pc of eggs" with the quantity "1".
 * The unit is in the NAME, and the quantity has lost the unit. Worse, stock
 * matching is EXACT, so an item called "pc of eggs" can never match the
 * kitchen's "Eggs" — the row the household buys from and the row on the shelf
 * are two different things.
 *
 * It is also the SAME shape of bug the parser had with "kg" — "- 1 kg Rice"
 * became an item called "kg Rice" — fixed for one unit and left for the one
 * that the app writes most.
 *
 * WHY THIS IS WORTH A TEST
 *
 * The parser's unit list and the app's rule are two separate pieces of
 * knowledge, and they drift: a unit added to the app's rule, to the add form
 * or to the recipe catalogue is not a unit the parser knows. So the test does
 * not restate a list of units — it takes the units the app REALLY uses, from
 * the app's own sources, and asks the app's REAL rule what each one reads
 * as, and then asks the REAL parser to read it back.
 *
 * WHY THE UNIT'S CASE IS NOT COMPARED
 *
 * The app's rule deliberately keeps the unit as the household wrote it — a
 * household that types "Glass" reads "Glass" back — so "L" and "l" are two
 * spellings the app itself allows, and the parser lower-cases the unit it
 * reads. What must match is the NUMBER and the FORM of the unit: "1 pc" and
 * "1 pcs" are two different quantities, and the parser must not turn one into
 * the other.
 *
 * WHAT IS TESTED HERE
 *
 *   - the REAL rule, asked what a quantity should read as;
 *   - the REAL parser, asked what a bullet becomes;
 *   - the app's REAL unit vocabulary — every unit in the recipe catalogue and
 *     every unit the add form offers — read out of the app's own files.
 *
 * Run with:  node scripts/test-grocery-unit-round-trip.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// The app's modules import each other without a file extension, so node's
// resolver needs the hook before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseGroceryList } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/groceryListParser.ts')).href
);
const { formatQuantity } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/date.ts')).href
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

/**
 * The units the RECIPE CATALOGUE measures its ingredients in.
 *
 * WHY THE CATALOGUE: the Meal Plan and the automatic grocery list write a
 * shopping line straight out of a recipe's ingredient, so every unit in here
 * is a unit the app puts on the shopping list. Read out of the app's own
 * data rather than written here, so a recipe that measures something in a new
 * unit is picked up without this file being edited.
 *
 * @returns {Set<string>} the units the catalogue uses
 */
function catalogueUnits() {
  const raw = fs.readFileSync(path.join(REPO, 'src/data/csvRecipes.json'), 'utf8');
  const parsed = JSON.parse(raw);
  const recipes = Array.isArray(parsed) ? parsed : (parsed.recipes ?? []);
  const units = new Set();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients ?? []) {
      const unit = String(ingredient.unit ?? '').trim();
      if (unit) units.add(unit);
    }
  }
  return units;
}

/**
 * The units the ADD FORM offers the household.
 *
 * WHY THE FORM: a stock row writes its shopping line with the household's own
 * unit, so every unit the form offers is a unit the app puts on the shopping
 * list. "pcs" is the default and "bottles" is one of the nine.
 *
 * WHY IT IS READ OUT OF THE COMPONENT: the list is the app's, and a unit
 * added to the form must reach this test without this file being edited.
 *
 * @returns {Set<string>} the units the add form offers
 */
function formUnits() {
  const src = fs.readFileSync(
    path.join(REPO, 'src/components/AddStockModal.tsx'),
    'utf8',
  );
  const match = src.match(/const COMMON_UNITS = \[([^\]]*)\]/);
  if (!match) {
    throw new Error('COMMON_UNITS was not found in src/components/AddStockModal.tsx');
  }
  const units = match[1]
    .split(',')
    .map((u) => u.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return new Set(units);
}

const VOCABULARY = new Set([...catalogueUnits(), ...formUnits()]);

console.log('\nthe app can read back every quantity the app writes');

for (const unit of [...VOCABULARY].sort()) {
  for (const qty of [1, 2]) {
    // What the app puts on the shopping list.
    const written = formatQuantity(qty, unit);
    // What the House Bot writes back when it repeats what it was given.
    const bullet = `- ${written} of Eggs`;
    const item = parseGroceryList(bullet)[0];

    ok(
      item !== undefined,
      `"${bullet}" is an item at all`,
      item ? JSON.stringify(item) : 'nothing was parsed',
    );
    ok(
      item?.name.toLowerCase() === 'eggs',
      `the unit comes off the name of "${bullet}"`,
      `the name is ${JSON.stringify(item?.name)}`,
    );
    ok(
      item?.quantity.toLowerCase() === written.toLowerCase(),
      `"${bullet}" reads back as "${written}"`,
      `the parser wrote ${JSON.stringify(item?.quantity)}`,
    );
  }
}

console.log('\nand the count unit the app writes most is one of them');

{
  // "pcs" is the DEFAULT unit for a new stock item, and the app's rule
  // writes it singular at quantity one — so "1 pc" is the string the Stock
  // row puts on the list and the string the House Bot reads back.
  const written = formatQuantity(1, 'pcs');
  ok(written === '1 pc', 'the rule writes "1 pc"', written);

  const item = parseGroceryList(`- ${written} of Eggs`)[0];
  ok(
    item?.name.toLowerCase() === 'eggs',
    'and the parser reads it back as "eggs"',
    JSON.stringify(item?.name),
  );
  ok(
    item?.quantity === '1 pc',
    'with the quantity the app wrote',
    JSON.stringify(item?.quantity),
  );
}

console.log('\nand the item it makes still matches the kitchen');

{
  // Stock matching is EXACT, so the name the parser makes has to be the name
  // the kitchen knows — an item called "pc of eggs" is a row the household
  // buys from and a row the shelf never recognises as the same thing.
  const { findCandidatesForIngredient } = await import(
    pathToFileURL(path.join(REPO, 'src/utils/recipeMatch.ts')).href
  );
  const item = parseGroceryList('- 1 pc of Eggs')[0];
  const matches = findCandidatesForIngredient(
    { name: item?.name ?? 'pc of eggs', quantity: 1, unit: 'pcs', category: 'other' },
    [{ id: 's1', name: 'Eggs', quantity: 6, unit: 'pcs', category: 'other' }],
  );
  ok(
    matches.length === 1 && matches[0].id === 's1',
    'an item the parser made is still findable on the shelf',
    `the name was ${JSON.stringify(item?.name)}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
