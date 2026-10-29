/**
 * Regression test: a stock row's quantity toast must spell the unit the way
 * the app spells it everywhere else.
 *
 * THE BUG
 *
 * A stock row prints its own quantity with the app's shared rule:
 *
 *     {formatQuantity(item.quantity, item.unit)}      // "2 glass"
 *
 * but its two quantity toasts — the ones that say how much was used or added —
 * built their own phrase, with the unit spliced into a template of their own:
 *
 *     toast(`Used 1 ${singularUnit(item.unit) || ''} of ${item.name}`)
 *
 * The first version of that one-liner was `item.unit.replace(/s$/, '')`, which
 * assumes an English plural is the stem plus an "s" — true for "bottles" and
 * false for "glass", "dashes" and "pinches", units people actually type for a
 * kitchen app.
 *
 * WHAT IT LOOKS LIKE TO THE USER
 *
 * A household that typed "glass" as the unit for its milk:
 *
 *     the row's quantity beside the buttons says   "2 glass"
 *     the toast after tapping "+" says             "Added 1 glas of Milk"
 *
 * One row, two spellings of the same unit, seconds apart. And the mangled
 * word is the one the user reads back as the confirmation that the tap did
 * what they meant.
 *
 * THE SAME BUG, WITH NO UNIT AT ALL
 *
 * Spelling the unit better did not fix the shape of the phrase. The unit field
 * is free text and the add form only insists on a name, so a household can
 * save an item with no unit — or with a unit of nothing but spaces. A unit
 * that is not there left a hole where it should have been:
 *
 *     the row's quantity beside the buttons says   "2"
 *     the toast after tapping "+" says             "Added 1  of Milk"
 *
 * Two spaces where a word should be, in the one line the person reads back as
 * proof the tap did what they meant. And the same hole appeared in the
 * quantity itself when the unit was typed with a stray space around it:
 *
 *     the row's quantity beside the buttons says   "2  Glass "
 *
 * WHICH IS TESTED HERE
 *
 * The rule: the toast writes the quantity with the app's own rule, so it
 * agrees with the quantity printed beside the buttons it belongs to.
 *
 * The test drives the REAL component — `StockRow.tsx` bundled with esbuild,
 * the same way `test-stock-row-expiry-window.mjs` bundles a `.tsx` — clicks
 * the real buttons and reads the toast the real component raised.
 *
 * WHY THE STORE IS A STUB AND NOT THE REAL ONE: `renderToStaticMarkup` reads
 * the store's SERVER snapshot, which is frozen seed state, so a household
 * could never reach the component through it. The stub stands in for the
 * store and hands the component the household under test. The component, its
 * `formatQuantity` call and the toast it raises are all the real ones.
 *
 * WHY THE EXPECTED ANSWER IS NOT RESTATED: the test asks the app's own
 * `formatQuantity` what one unit should read as, and demands that the toast
 * says that. A restated rule would only prove that the restatement agrees
 * with itself.
 *
 * Run with:  node scripts/test-stock-row-unit-wording.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpWorkDir, tmpStubFile } from './lib/tmp-work.mjs';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

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

/* -------------------------------------------------------------------------- */
/* The row, built from the real component                                       */
/* -------------------------------------------------------------------------- */

/**
 * The store, as a stub the component can be handed.
 *
 * WHY THE TOASTS GO TO A GLOBAL: the component calls the store's `toast`, and
 * the store is a stub, so the stub has to put the message somewhere the test
 * can read it back. A global is the only channel the stub and the test share
 * across the bundle boundary.
 *
 * @returns {string} the path of the stub module
 */
async function stubStore() {
  const file = tmpStubFile('hh-stockrow-unit-store.mjs');
  await writeFile(
    file,
    `export function useStore() {
  return {
    stock: [],
    grocery: [],
    settings: {
      expiringSoonDays: 3,
      userName: '',
      dietaryPreference: 'no-preference',
      allergies: [],
    },
    incrementStock() {},
    removeStock() {},
    toast(msg) { globalThis.__hh_toasts.push(msg); },
    addGrocery(item) { globalThis.__hh_grocery.push(item); },
  };
}
`,
  );
  return file;
}

/**
 * The real `StockRow`, with the store replaced by the stub.
 *
 * @returns {Promise<Function>} the component
 */
async function stockRow() {
  const storeStub = await stubStore();
  const bundle = await build({
    entryPoints: [path.join(REPO, 'src/components/StockRow.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/server',
      'lucide-react',
      'clsx',
    ],
    plugins: [
      {
        // WHY THE STORE IS PULLED OUT OF THE BUNDLE: a bundle that carried its
        // own copy of the store would have its own copy of the household, and
        // the row would be asked about a household this test is not driving.
        name: 'stub-the-store',
        setup(b) {
          b.onResolve({ filter: /^\.\.\/store\/useStore$/ }, () => ({
            path: pathToFileURL(storeStub).href,
            external: true,
          }));
        },
      },
    ],
  });
  // The bundle lives outside the checkout, so it cannot find the packages the
  // row imports on its own.
  const dir = tmpWorkDir('hh-stockrow-unit-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  const file = path.join(dir, 'StockRow.mjs');
  await writeFile(file, bundle.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return mod.StockRow;
}

/** A row of kitchen stock, measured in the given unit. */
function stockItem(unit) {
  return {
    id: 'stk_1',
    name: 'Milk',
    quantity: 2,
    unit,
    category: 'dairy',
    expiryDate: '2026-12-01',
    location: 'fridge',
    lowStockThreshold: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

/** Every element in the tree that has a click handler. */
function clickables(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) clickables(child, out);
    return out;
  }
  if (node.props?.onClick) out.push(node);
  clickables(node.props?.children, out);
  return out;
}

const StockRow = await stockRow();

/**
 * The row's element tree, with its real handlers still on it.
 *
 * WHY A TREE AND NOT MARKUP: a server render produces HTML, and HTML cannot
 * be clicked. Calling the component inside a render hands back the tree it
 * built, and the handlers on that tree are the component's own.
 *
 * @param {string} unit the unit the item is measured in
 * @returns {object} the tree
 */
function treeFor(unit) {
  let tree = null;
  function Capture() {
    tree = StockRow({ item: stockItem(unit), showActions: true });
    return null;
  }
  // The server renderer warns about useLayoutEffect, which the row's own
  // components use for a scroll fade. It says nothing about what is tested.
  const realError = console.error;
  console.error = (...args) => {
    if (String(args[0] ?? '').includes('useLayoutEffect does nothing on the server')) return;
    realError(...args);
  };
  try {
    renderToStaticMarkup(createElement(Capture));
  } finally {
    console.error = realError;
  }
  return tree;
}

/**
 * The two toasts the row raises when its buttons are tapped.
 *
 * @param {string} unit the unit the item is measured in
 * @returns {string[]} the toast messages, in the order they were raised
 */
function toastsFor(unit) {
  globalThis.__hh_toasts = [];
  const tree = treeFor(unit);
  const buttons = clickables(tree);
  const plus = buttons.find((el) => el.props['aria-label'] === 'Increase quantity');
  const minus = buttons.find((el) => el.props['aria-label'] === 'Decrease quantity');
  plus?.props.onClick();
  minus?.props.onClick();
  return globalThis.__hh_toasts;
}

/**
 * The grocery line the row writes when its "add to grocery" button is tapped.
 *
 * WHY THIS MATTERS AS MUCH AS THE TOAST: the shopping list is ONE list, and
 * two screens write lines onto it — this row and the Alerts screen. They have
 * to write the same line, and the Alerts screen writes its quantity with the
 * app's shared rule while this one spelled the unit into a template of its
 * own.
 *
 * @param {string} unit the unit the item is measured in
 * @returns {object|null} the grocery item the store was handed
 */
function groceryLineFor(unit) {
  globalThis.__hh_grocery = [];
  const tree = treeFor(unit);
  const buttons = clickables(tree);
  const add = buttons.find((el) => el.props['aria-label'] === 'Add Milk to grocery list');
  add?.props.onClick();
  return globalThis.__hh_grocery[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* The units a household can actually type                                       */
/* -------------------------------------------------------------------------- */

// WHY THESE: the unit field is free text, and these are the units people
// type for a kitchen app. "pcs" and "bottles" are the ones the old one-liner
// got right — they are here so the test shows the rule, not just the failure.
const UNITS = ['glass', 'dashes', 'pinches', 'bunches', 'pcs', 'bottles'];

// WHY THESE TOO: the unit field is free text and the add form only insists on
// a name, so an item with no unit is one field-clearing away. A unit of
// nothing but spaces is the same thing written differently.
const BLANK_UNITS = ['', '   '];

console.log('\nthe quantity toast spells the unit the way the app spells it');

for (const unit of UNITS) {
  const toasts = toastsFor(unit);
  // WHAT THE APP'S OWN RULE SAYS: one of this unit, written by the rule the
  // row's own quantity label uses.
  const expected = formatQuantity(1, unit);

  const added = toasts.find((t) => t.startsWith('Added'));
  const used = toasts.find((t) => t.startsWith('Used'));

  ok(
    added === `Added ${expected} of Milk`,
    `the "+" toast says "Added ${expected} of Milk"`,
    added ?? '(no toast)',
  );
  ok(
    used === `Used ${expected} of Milk`,
    `the "-" toast says "Used ${expected} of Milk"`,
    used ?? '(no toast)',
  );
}

console.log('\na missing unit leaves no hole in the toast');
for (const unit of BLANK_UNITS) {
  const toasts = toastsFor(unit);
  // WHAT THE APP'S OWN RULE SAYS: the same rule, asked about an item with no
  // unit. "2" is a whole quantity on its own — there is nothing for the unit
  // to be.
  const expected = formatQuantity(1, unit);

  const added = toasts.find((t) => t.startsWith('Added'));
  const used = toasts.find((t) => t.startsWith('Used'));

  ok(
    added === `Added ${expected} of Milk`,
    `the "+" toast says "Added ${expected} of Milk"`,
    added ?? '(no toast)',
  );
  ok(
    used === `Used ${expected} of Milk`,
    `the "-" toast says "Used ${expected} of Milk"`,
    used ?? '(no toast)',
  );
  // THE GAP ITSELF: the toast used to splice the unit into a template, so a
  // missing unit left the space where the unit would have been — "Added 1  of
  // Milk". The sentence above catches it, but this says what it is: a gap.
  ok(
    !/\s{2,}/.test(added ?? ''),
    'the "+" toast has no run of spaces where a unit would be',
    added ?? '(no toast)',
  );
}

console.log('\na unit typed with a stray space reads as the unit');
// WHY THIS IS ABOUT THE QUANTITY AND NOT THE TOAST: the singular branch of
// the rule trimmed the unit and the plural branch did not, so the row's own
// quantity read "2  Glass " — the same gap, in the number beside the
// buttons. The toast only ever counts one, so it never saw it.
ok(
  formatQuantity(2, ' Glass ') === '2 Glass',
  'the quantity reads "2 Glass" for a unit typed with a stray space',
  formatQuantity(2, ' Glass '),
);
ok(
  formatQuantity(1, ' Glass ') === '1 Glass',
  'the quantity reads "1 Glass" for a unit typed with a stray space',
  formatQuantity(1, ' Glass '),
);
ok(
  formatQuantity(2, '') === '2',
  'the quantity reads "2" for an item with no unit',
  formatQuantity(2, ''),
);

console.log('\nno toast mangles a unit into a word nobody wrote');
for (const unit of UNITS) {
  // WHAT THE OLD ONE-LINER WOULD HAVE WRITTEN: the stem plus an "s" removed.
  // For most units that is the right singular ("bottles" -> "bottle"), so it
  // is only a defect where it differs from the rule the app actually uses.
  const mangled = unit.replace(/s$/, '');
  const expected = formatQuantity(1, unit);
  if (mangled === expected.split(' ')[1]) continue;

  for (const message of toastsFor(unit)) {
    ok(
      !message.includes(` ${mangled} `),
      `the toast does not say "${mangled}" for the unit "${unit}"`,
      message,
    );
  }
}

console.log('\nthe grocery line the row writes is the one the Alerts screen writes');
for (const unit of [...UNITS, ...BLANK_UNITS]) {
  const line = groceryLineFor(unit);
  // THE QUANTITY THE ROW SEEDS: enough to replace what is on hand, which is
  // the low-stock threshold — one, when the threshold is zero, which is the
  // default for a new item.
  const expected = formatQuantity(1, unit);
  ok(
    line?.quantity === expected,
    `the grocery line says "${expected}" for the unit "${unit}"`,
    line?.quantity ?? '(no grocery line)',
  );
}

// THE ONE THE HOUSEHOLD SEES MOST: "pcs" is the default unit for a new item
// and a threshold of zero is the default threshold, so this is the quantity
// the shopping list usually carried — and it said "1 pcs" while the Alerts
// screen said "1 pc" for the very same item.
const pcsLine = groceryLineFor('pcs');
ok(
  pcsLine?.quantity === '1 pc',
  'the grocery line says "1 pc", not "1 pcs"',
  pcsLine?.quantity ?? '(no grocery line)',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
