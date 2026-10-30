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
 *   - EVERY file in src/, asked whether it puts a quantity and a unit side by
 *     side in a phrase of its own. The rule used to name two files — the
 *     End-of-Day meals flow and the House Bot bubble — because those were the
 *     two that built the phrase. A named file can only be checked for the
 *     phrase it happened to have on the day, and a file written later is not
 *     checked at all. The rule is asked of every file now, and it is proved
 *     against the historical shapes before it is asked of the app, so a rule
 *     that stopped working could not pass quietly.
 *
 * Run with:  node scripts/test-quantity-spelling.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
/* The writers that are checked in the source                                 */
/* -------------------------------------------------------------------------- */

console.log('\nno page builds the amount and the unit into a phrase of its own');

// WHY THE SOURCE IS CHECKED AND NOT THE COMPONENT: the deduction list lives
// inside an effect the server renderer does not run, so rendering it would
// read an empty list and prove nothing. The same reasoning as
// scripts/test-stock-deduction-units.mjs.
//
// WHY THE RULE IS GENERAL AND DOES NOT NAME ANY FILE: it used to name two —
// the End-of-Day meals flow and the House Bot bubble — because those were the
// two that built the phrase. A named file can only be checked for the phrase
// it happened to have on the day, and a file that is added later is not
// checked at all. The rule can be asked of every file, and it is asked of
// every file now.
//
// WHY THE HOUSE BOT IS NOT A WRITER ANY MORE: it WAS one. The Indian-catalog
// card wrote `${formatQuantity(ing.quantity, ing.unit)}` — and that card could
// never render, because the state it read was always empty. The card is gone.
// The bubble that is left shows the MODEL's ingredient lines verbatim, so it
// writes no amount of its own and there is nothing there to spell. That is
// checked below, against the bubble itself rather than the whole page, so a
// writer added elsewhere on the page is not mistaken for one in the bubble.

/**
 * The rules the app spells a quantity with.
 *
 * WHY THESE TWO: `formatQuantity` in src/utils/date.ts is the rule, and
 * `spellQuantity` in src/utils/groceryQuantity.ts is the same rule applied
 * to a quantity that arrived as free text. A phrase handed to either of them
 * is a phrase the rule decides.
 */
const SHARED_RULES = new Set(['formatQuantity', 'spellQuantity']);

/** An expression that is a number of something. */
const looksLikeAQuantity = (text) => /quantity|qty|amount|count/i.test(text);
/** An expression that is the word the number is measured in. */
const looksLikeAUnit = (text) => /\bunit\b/i.test(text);

/**
 * Every place in a file where a quantity and a unit are put side by side.
 *
 * WHY THE AST AND NOT A PATTERN: the phrase can be built in a template
 * literal or by joining two strings, and the difference between a phrase of
 * the app's own making and one the rule decides is not in the characters —
 * it is in WHERE the phrase is. So the file is parsed and the question is
 * asked of the tree.
 *
 * @returns one entry per phrase, and the shared rule it is handed to (if any)
 */
function quantityPhrases(file, source) {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /**
   * The shared rule a phrase is handed to, if any.
   *
   * WHY IT WALKS UP THE TREE: the phrase is usually built INSIDE the call —
   * `spellQuantity(`${qty} ${unit}`)` — so the call is the phrase's parent,
   * not its sibling.
   */
  const ruleFor = (node) => {
    let cur = node;
    while (cur) {
      if (ts.isCallExpression(cur) && ts.isIdentifier(cur.expression)) {
        const name = cur.expression.text;
        if (SHARED_RULES.has(name)) return name;
      }
      // A phrase inside the rule ITSELF is the rule's own business — it is
      // where the phrase is allowed to be built.
      //
      // WHY THE DECLARATION IS NAMED RATHER THAN ITS TEXT SEARCHED FOR: the
      // rule is `export const formatQuantity = ...` or `function
      // formatQuantity(...)`, and asking which declaration it is by its name
      // is an exact question. Searching the text of the declaration for the
      // name would exempt any function that merely MENTIONED the rule.
      if (ts.isFunctionDeclaration(cur) && cur.name && SHARED_RULES.has(cur.name.text)) {
        return 'the rule itself';
      }
      if (ts.isVariableStatement(cur)) {
        const declared = cur.declarationList.declarations[0]?.name;
        if (declared && ts.isIdentifier(declared) && SHARED_RULES.has(declared.text)) {
          return 'the rule itself';
        }
      }
      cur = cur.parent;
    }
    return null;
  };

  /** Whether a list of expressions puts a quantity next to a unit. */
  const pairs = (texts) => {
    for (let i = 0; i < texts.length; i++) {
      if (!looksLikeAQuantity(texts[i])) continue;
      for (let j = i + 1; j < texts.length; j++) {
        if (looksLikeAUnit(texts[j])) return true;
      }
    }
    return false;
  };

  const found = [];

  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      const texts = node.templateSpans.map((span) => span.expression.getText(tree));
      if (pairs(texts)) {
        found.push({ text: node.getText(tree).replace(/\s+/g, ' ').trim(), rule: ruleFor(node) });
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = node.left.getText(tree);
      const right = node.right.getText(tree);
      if (pairs([left, right]) || pairs([right, left])) {
        found.push({ text: `${left} + ${right}`, rule: ruleFor(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

  return found;
}

// THE RULE IS PROVED AGAINST A FIXTURE FIRST, so a rule that stopped working
// could not pass quietly. The fixtures are the three shapes this rule was
// written for, and the two shapes that are allowed.

const BAD_SHAPES = [
  ['the House Bot card', 'const s = `${ing.quantity} ${ing.unit}`;'],
  ['the End-of-Day meals flow', 'const s = `${ing.quantity.toFixed(2)} ${ing.unit}`;'],
  ['the unit helper', 'const s = unit ? `${quantity} ${unit}` : `${quantity}`;'],
  ['two strings joined', "const s = ing.quantity + ' ' + ing.unit;"],
];

for (const [label, code] of BAD_SHAPES) {
  const phrases = quantityPhrases('Fixture.tsx', code);
  check(
    `a phrase of its own is caught in ${label}`,
    phrases.filter((p) => !p.rule).length > 0,
    true,
  );
}

const GOOD_SHAPES = [
  ['the shared rule', 'const s = `${formatQuantity(ing.quantity, ing.unit)}`;'],
  ['a phrase handed to the shared rule', 'const s = spellQuantity(`${qty} ${unit.toLowerCase()}`);'],
];

for (const [label, code] of GOOD_SHAPES) {
  const phrases = quantityPhrases('Fixture.tsx', code);
  check(
    `a phrase the shared rule decides is not caught in ${label}`,
    phrases.filter((p) => !p.rule).length,
    0,
  );
}

// AND THEN EVERY FILE IN src/ IS ASKED.

const sourceFiles = [];
const walkSrc = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSrc(full);
    else if (entry.isFile() && ['.ts', '.tsx'].includes(path.extname(entry.name))) {
      sourceFiles.push(full);
    }
  }
};
walkSrc(path.join(REPO, 'src'));

let phrasesFound = 0;
for (const file of sourceFiles.sort()) {
  const source = readFileSync(file, 'utf8');
  for (const phrase of quantityPhrases(file, source)) {
    phrasesFound += 1;
    if (!phrase.rule) {
      check(
        `${path.relative(REPO, file)} does not build the amount and the unit into a phrase of its own`,
        phrase.text,
        'the shared rule',
      );
    }
  }
}

check(
  'every quantity the app writes goes through the shared rule',
  phrasesFound >= 1,
  true,
);

// AND THE HOUSE BOT BUBBLE IS CHECKED AS A BUBBLE.
//
// WHY IT IS CHECKED AT ALL WHEN IT WRITES NO AMOUNT: the bubble used to be a
// writer — the Indian-catalog card beside it wrote
// `${formatQuantity(ing.quantity, ing.unit)}` — and that card could never
// render, because the state it read was always empty. The card is gone. What
// is left is the bubble that shows the MODEL's ingredient lines verbatim, and
// it must stay that way: a bubble that re-spelled the ingredients while the
// other recipe cards showed them as the model wrote them would put two
// spellings of one recipe on two screens.
//
// WHY IT IS CHECKED AGAINST THE BUBBLE AND NOT THE PAGE: a page may grow a
// writer somewhere else — the quantities House Bot puts on the SHELF go
// through the shared rule in src/utils/agentActions.ts — and a check against
// the whole page would call that a defect when it is the rule being used.

const houseBotSource = readFileSync(path.join(REPO, 'src/pages/HouseBot.tsx'), 'utf8');
const bubbleSource = houseBotSource.slice(
  houseBotSource.indexOf('function RecipeCard'),
  houseBotSource.indexOf('function formatTime'),
);

check(
  'the House Bot bubble shows the model\'s ingredient lines and does not re-spell them',
  bubbleSource.includes('formatQuantity('),
  false,
);
check(
  'and it does not build the amount and the unit into a phrase of its own',
  /ing\.quantity\}\s*\$\{ing\.unit\}/.test(bubbleSource),
  false,
);

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
