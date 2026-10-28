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
 * spelled the unit with a one-liner of their own:
 *
 *     toast(`Used 1 ${item.unit.replace(/s$/, '')} of ${item.name}`)
 *
 * `replace(/s$/, '')` assumes an English plural is the stem plus an "s", which
 * is true for "bottles" and false for "glass", "dashes" and "pinches" — units
 * people actually type for a kitchen app. The app had already been burned by
 * this: `src/utils/date.ts` carries the rule that fixes it, and its comment
 * names these three words.
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
 * WHAT IS TESTED HERE
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
 * `singularUnit` call and the toast it raises are all the real ones.
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
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const file = path.join(tmpdir(), `hh-stockrow-unit-store.mjs`);
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
    addGrocery() {},
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
  const dir = await mkdtemp(path.join(tmpdir(), 'hh-stockrow-unit-'));
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

/* -------------------------------------------------------------------------- */
/* The units a household can actually type                                       */
/* -------------------------------------------------------------------------- */

// WHY THESE: the unit field is free text, and these are the units people
// type for a kitchen app. "pcs" and "bottles" are the ones the old one-liner
// got right — they are here so the test shows the rule, not just the failure.
const UNITS = ['glass', 'dashes', 'pinches', 'bunches', 'pcs', 'bottles'];

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
