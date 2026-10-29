/**
 * Regression test: a quantity is spelled the same way everywhere it is shown.
 *
 * THE BUG
 *
 * The app has one rule for writing a quantity — `formatQuantity` in
 * src/utils/date.ts — and the Stock screen, the Alerts screen, the shopping
 * list and the toasts all call it. Three writers did not. Each built the
 * quantity and the unit into a phrase of its own:
 *
 *     src/utils/units.ts            `unit ? `${quantity} ${unit}` : `${quantity}``
 *     src/components/EndOfDayMeals.tsx  `${ing.quantity.toFixed(2)} ${ing.unit}`
 *     src/pages/HouseBot.tsx        `${ing.quantity} ${ing.unit}`
 *
 * They all put a space between the number and the unit, so they did not run
 * the number into the unit the way the shopping list used to. What they did
 * was leave the PLURAL out of the rule, and a quantity of one with a plural
 * unit is the commonest quantity in a kitchen — "pcs" is the default unit for
 * a new item. So one stock row was written three ways at once:
 *
 *     the Stock screen                "1 pc"
 *     the Log Meal modal               "1 pcs"      <- the amount left
 *     the End-of-Day meals flow        "1.00 pcs"   <- the amount taken
 *
 * The Log Meal modal is the worst of the three, because the row it describes
 * is on the SAME SCREEN: the household is told what is left of the row in
 * one spelling, and the row itself is in another, and the two numbers are
 * the same number.
 *
 * WHY IT MATTERS: the number on the shelf is the number the household buys
 * against. "1 pc" and "1 pcs" are the same quantity and the app does not get
 * to have two opinions about it — the same rule that ended "2kg" on the
 * shopping list ends this.
 *
 * WHAT IS TESTED HERE
 *
 *   - the REAL rule, asked what a quantity should read as, so a restated rule
 *     cannot make the test agree with itself;
 *   - the REAL store, driving a real deduction, so the label is the one the
 *     screen prints and not a number this file recomputed;
 *   - the two `.tsx` writers, checked in the source, because their lists are
 *     rendered inside effects the server renderer does not run — the same
 *     reasoning as scripts/test-stock-deduction-units.mjs.
 *
 * Run with:  node scripts/test-quantity-spelling.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { createElement } = require('react');
const { renderToString } = require('react-dom/server');

const { formatQuantity } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/date.ts')).href
);
const { formatInUnit, toBaseUnit, toDisplayUnit } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/units.ts')).href
);
const { planRecipeDeduction } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/recipeMatch.ts')).href
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

/* -------------------------------------------------------------------------- */
/* The row and the label beside it                                            */
/* -------------------------------------------------------------------------- */

console.log('\nthe row and the label beside it say the same thing');

// The Stock screen writes a row with `formatQuantity`. The Log Meal modal
// writes what is LEFT of that row with `formatInUnit`, and `formatInUnit`
// takes the amount in BASE units — the row's amount converted — because the
// row may be measured in a different unit from the recipe that took from it.
// So the label is asked about the row's own base amount, and it has to come
// back reading the same as the row.

const SAME_ROW = [
  { label: 'a row of one "pc"', quantity: 1, unit: 'pcs', expected: '1 pc' },
  { label: 'a row of two "pc"', quantity: 2, unit: 'pcs', expected: '2 pcs' },
  { label: 'a row of one "dash"', quantity: 1, unit: 'dashes', expected: '1 dash' },
  { label: 'a row of one "bottle"', quantity: 1, unit: 'bottles', expected: '1 bottle' },
  { label: 'a row of grams', quantity: 200, unit: 'g', expected: '200 g' },
  { label: 'a row of a fraction of a spoon', quantity: 7.25, unit: 'tbsp', expected: '7.25 tbsp' },
  { label: 'a row with no unit', quantity: 1, unit: '', expected: '1' },
  { label: 'a row whose unit is only spaces', quantity: 1, unit: '   ', expected: '1' },
];

/**
 * The row's amount in base units — what the label is asked about.
 *
 * WHY A UNIT THE APP DOES NOT KNOW IS ITS OWN BASE: `toBaseUnit` returns
 * null for a unit it has no table for, and a row in "bottles" is measured in
 * bottles. The app's own rule for that is a factor of one, so the amount is
 * its own base.
 */
const baseOf = (quantity, unit) => toBaseUnit(quantity, unit)?.value ?? quantity;

for (const c of SAME_ROW) {
  // The row itself.
  check(
    `the row reads "${c.expected}"`,
    formatQuantity(c.quantity, c.unit),
    c.expected,
  );
  // The label beside it. This is the Log Meal modal's "-> X left".
  check(
    `the amount left on it reads "${c.expected}" too`,
    formatInUnit(baseOf(c.quantity, c.unit), c.unit),
    c.expected,
  );
}

console.log('\nand the two never drift apart');

for (const c of SAME_ROW) {
  check(
    `the row and the label beside it agree for ${c.label}`,
    formatInUnit(baseOf(c.quantity, c.unit), c.unit) === formatQuantity(c.quantity, c.unit),
    true,
  );
}

/* -------------------------------------------------------------------------- */
/* The label the app really prints                                            */
/* -------------------------------------------------------------------------- */

console.log('\nthe label the Log Meal modal prints');

/**
 * A household holding one row, cooking one dish that uses it.
 *
 * WHY THE ROW HOLDS TWO AND THE RECIPE TAKES ONE: so that the row is left
 * holding exactly one — the quantity of one is the case that was written two
 * ways, and a row that is emptied outright would not show the label beside
 * anything.
 */
const stockRow = {
  id: 's1',
  name: 'Eggs',
  quantity: 2,
  unit: 'pcs',
  category: 'other',
  location: 'pantry',
  lowStockThreshold: 0,
  createdAt: 1,
  updatedAt: 1,
};

const recipe = {
  id: 'r1',
  name: 'Test Curry',
  emoji: '🍛',
  mealType: 'dinner',
  baseServings: 2,
  ingredients: [{ name: 'Eggs', quantity: 1, unit: 'pcs', category: 'other' }],
};

const plan = planRecipeDeduction(recipe, 2, [stockRow]);
const deduction = plan.deductions[0];

// The amount TAKEN off the row.
check('the amount taken off the row reads "1 pc"', deduction.deductedLabel, '1 pc');

// The amount LEFT on the row — the same label the Log Meal modal prints.
check(
  'the amount left on the row reads "1 pc"',
  formatInUnit(deduction.remainingBase, stockRow.unit),
  '1 pc',
);

// And the row itself, as the Stock screen writes it. The remainder is a BASE
// amount — it has to be brought back into the row's own unit before the row
// can be written, which is what the Stock screen does with the row's number.
check(
  'and the row itself reads "1 pc"',
  formatQuantity(toDisplayUnit(deduction.remainingBase, stockRow.unit), stockRow.unit),
  '1 pc',
);

/* -------------------------------------------------------------------------- */
/* The two writers that are checked in the source                             */
/* -------------------------------------------------------------------------- */

console.log('\nthe two writers that cannot be rendered call the shared rule');

// WHY THE SOURCE IS CHECKED AND NOT THE COMPONENT: the deduction list lives
// inside an effect the server renderer does not run, so rendering it would
// read an empty list and prove nothing. The same reasoning as
// scripts/test-stock-deduction-units.mjs.

const endOfDaySource = readFileSync(path.join(REPO, 'src/components/EndOfDayMeals.tsx'), 'utf8');
check(
  'the End-of-Day meals flow writes its amount with the shared rule',
  endOfDaySource.includes('formatQuantity('),
  true,
);
check(
  'and does not build the amount and the unit into a phrase of its own',
  /toFixed\(2\)\}\s*\$\{/.test(endOfDaySource),
  false,
);

const houseBotSource = readFileSync(path.join(REPO, 'src/pages/HouseBot.tsx'), 'utf8');
check(
  'the House Bot bubble writes its amount with the shared rule',
  houseBotSource.includes('formatQuantity('),
  true,
);
check(
  'and does not build the amount and the unit into a phrase of its own',
  /ing\.quantity\}\s*\$\{ing\.unit\}/.test(houseBotSource),
  false,
);

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
