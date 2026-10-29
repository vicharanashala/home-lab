/**
 * The shopping list is ONE list, and every quantity in the app is written by
 * ONE rule.
 *
 * THE BUG
 *
 * Four places write lines onto the shopping list — the Stock row, the Alerts
 * screen (once per item and once for all of them), the Meal Plan and the
 * automatic grocery list — and the amount on the line was worked out twice,
 * differently:
 *
 *     the Stock row and the Alerts screen   formatQuantity(threshold, unit)
 *     the Meal Plan and the automatic list  `${needed}${unit}`
 *
 * The second one spliced the number into the unit with nothing between them —
 * which is the spelling `formatQuantity` exists to prevent — so the same list
 * could carry:
 *
 *     from the Alerts screen    "2 kg"
 *     from the Meal Plan       "2kg"
 *
 * for the same two kilos of the same thing. A quantity of one with a plural
 * unit ran together as well, which is the other half of the rule:
 *
 *     from the Alerts screen    "1 pc"
 *     from the Meal Plan       "1pcs"
 *
 * And the two screens that both took the STOCK threshold disagreed about it
 * too: the Stock row rounded it up and the Alerts screen did not, so a
 * household that set "low at 2.5 kg" got "3 kg" from one screen and "2.5 kg"
 * from the other, for the same item on the same list.
 *
 * WHY IT IS WORTH A TEST: the app already has the rule — `formatQuantity` —
 * and every screen that wrote its quantity with it was right. The ones that
 * spelled the unit into a template of their own were wrong, and nothing in
 * the app could tell, because the list they all write onto is one list.
 *
 * WHAT IS TESTED HERE
 *
 *   - the REAL rule, asked what a quantity should read as, so a restated rule
 *     cannot make the test agree with itself;
 *   - the REAL Stock row and the REAL Alerts screen, rendered and tapped, so
 *     the line they write is read back out of the store they handed it to;
 *   - every file in src/, checked so that a new screen cannot quietly bring
 *     the template back.
 *
 * Run with:  node scripts/test-grocery-quantity-rule.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { symlink, writeFile, readFile, readdir } from 'node:fs/promises';
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
const { groceryQuantityForStock, groceryQuantityForNeed } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/groceryQuantity.ts')).href
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
/* The rule itself                                                               */
/* -------------------------------------------------------------------------- */

console.log('\nthe rule writes a stock item the way the app writes every quantity');

// WHY THE THRESHOLDS ARE THESE: the unit field is free text and the threshold
// is a plain number a household types, so both are whatever the household
// made them. Zero is the default threshold and one is the default for an
// item the agent added.
const STOCK_CASES = [
  { label: 'a whole threshold', threshold: 2, unit: 'kg', expected: '2 kg' },
  { label: 'a threshold of one', threshold: 1, unit: 'pcs', expected: '1 pc' },
  { label: 'a threshold of zero', threshold: 0, unit: 'pcs', expected: '1 pc' },
  { label: 'a fractional threshold', threshold: 2.5, unit: 'kg', expected: '2.5 kg' },
  { label: 'a plural unit', threshold: 3, unit: 'bottles', expected: '3 bottles' },
  { label: 'no unit at all', threshold: 2, unit: '', expected: '2' },
  { label: 'a unit of only spaces', threshold: 2, unit: '   ', expected: '2' },
];

for (const c of STOCK_CASES) {
  const got = groceryQuantityForStock({ lowStockThreshold: c.threshold, unit: c.unit });
  // THE EXPECTATION IS NOT RESTATED: it is what the app's own rule says for
  // the same amount, so the test cannot pass by agreeing with itself.
  const expected = formatQuantity(Math.max(1, c.threshold || 1), c.unit);
  ok(
    got === expected && got === c.expected,
    `${c.label} reads "${c.expected}"`,
    got === expected && got === c.expected ? got : `it read "${got}"`,
  );
}

console.log('\nthe rule writes a shopping need the way the app writes every quantity');

const NEED_CASES = [
  { label: 'a whole need', needed: 2, unit: 'kg', expected: '2 kg' },
  { label: 'a need of one', needed: 1, unit: 'pcs', expected: '1 pc' },
  { label: 'a fractional need', needed: 1.25, unit: 'kg', expected: '1.25 kg' },
  { label: 'a plural unit', needed: 2, unit: 'bottles', expected: '2 bottles' },
  { label: 'no unit at all', needed: 2, unit: '', expected: '2' },
];

for (const c of NEED_CASES) {
  const got = groceryQuantityForNeed({ needed: c.needed, unit: c.unit });
  const expected = formatQuantity(c.needed, c.unit);
  ok(
    got === expected && got === c.expected,
    `${c.label} reads "${c.expected}"`,
    got === expected && got === c.expected ? got : `it read "${got}"`,
  );
}

/* -------------------------------------------------------------------------- */
/* The screens                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The store, as a stub the screens can be handed.
 *
 * WHY THE TOASTS AND THE GROCERY GO TO GLOBALS: the screens call the store's
 * `toast` and `addGrocery`, and the store is a stub, so the stub has to put
 * what it was handed somewhere the test can read it back. A global is the
 * only channel the stub and the test share across the bundle boundary.
 *
 * WHY THE STOCK IS A GLOBAL TOO: the screens are built once and then asked
 * about a kitchen after a while, and the stub reads the kitchen when it is
 * asked — so the test can change what is in the fridge between two cases
 * without building the screen again.
 *
 * @returns {string} the path of the stub module
 */
async function stubStore() {
  const file = tmpStubFile('hh-grocery-rule-store.mjs');
  await writeFile(
    file,
    `globalThis.__hh_toasts = globalThis.__hh_toasts || [];
globalThis.__hh_grocery = globalThis.__hh_grocery || [];
globalThis.__hh_stock = globalThis.__hh_stock || [];

export function useStore() {
  return {
    stock: globalThis.__hh_stock,
    grocery: [],
    settings: {
      expiringSoonDays: 3,
      userName: '',
      dietaryPreference: 'no-preference',
      allergies: [],
    },
    updateSettings() {},
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
 * The screens' own furniture, stubbed out.
 *
 * WHY THE TOP BAR IS STUBBED: it navigates, so it needs a router around it,
 * and it opens the add-item modals, which drag in the camera and the recipe
 * catalogue. Neither has anything to do with the line a screen writes onto
 * the shopping list. The empty state is stubbed for the same reason — it is
 * only drawn when there is nothing to show.
 *
 * @returns {string} the path of the stub module
 */
async function furnitureStub() {
  const file = tmpStubFile('hh-grocery-rule-furniture.mjs');
  await writeFile(
    file,
    `export function TopBar() {
  return null;
}
export function EmptyState() {
  return null;
}
`,
  );
  return file;
}

/**
 * A screen, built from the real component with the store replaced.
 *
 * WHY THE STORE IS PULLED OUT OF THE BUNDLE: a bundle that carried its own
 * copy of the store would have its own copy of the household, and the screen
 * would be asked about a household this test is not driving.
 *
 * @param {string} entry the component to build, relative to src/
 * @param {Array<[RegExp, string]>} [extra] extra modules to stub out
 * @returns {Promise<object>} the module the screen came from
 */
async function screen(entry, extra = []) {
  const storeStub = await stubStore();
  const bundle = await build({
    entryPoints: [path.join(REPO, 'src', entry)],
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
      'react-router-dom',
      'lucide-react',
      'clsx',
    ],
    plugins: [
      {
        name: 'stub-the-store',
        setup(b) {
          b.onResolve({ filter: /^\.\.\/store\/useStore$/ }, () => ({
            path: pathToFileURL(storeStub).href,
            external: true,
          }));
          for (const [pattern, target] of extra) {
            b.onResolve({ filter: pattern }, () => ({
              path: pathToFileURL(target).href,
              external: true,
            }));
          }
        },
      },
    ],
  });
  // The bundle lives outside the checkout, so it cannot find the packages the
  // screen imports on its own.
  const dir = tmpWorkDir('hh-grocery-rule-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  const file = path.join(dir, 'screen.mjs');
  await writeFile(file, bundle.outputFiles[0].text);
  return import(pathToFileURL(file).href);
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

/**
 * Render a component and hand back the tree it built.
 *
 * WHY A TREE AND NOT MARKUP: a server render produces HTML, and HTML cannot
 * be clicked. Calling the component inside a render hands back the tree it
 * built, and the handlers on that tree are the component's own.
 *
 * @param {Function} Component the component to render
 * @param {object} [props] the props to give it
 * @returns {object} the tree
 */
function treeOf(Component, props = {}) {
  let tree = null;
  function Capture() {
    tree = Component(props);
    return null;
  }
  // The server renderer warns about useLayoutEffect, which the screens' own
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

/** A stock item that is running low, with the threshold under test. */
function lowItem(threshold, unit) {
  return {
    id: 'stk_1',
    name: 'Milk',
    quantity: 0,
    unit,
    category: 'dairy',
    expiryDate: '2026-12-01',
    location: 'fridge',
    lowStockThreshold: threshold,
    createdAt: 1,
    updatedAt: 1,
  };
}

/**
 * The line the screen wrote when its "add to grocery" button was tapped.
 *
 * @param {object} tree the screen's tree
 * @returns {object|null} the grocery item the store was handed
 */
function tapAddToGrocery(tree) {
  globalThis.__hh_grocery = [];
  const buttons = clickables(tree);
  const add = buttons.find((el) => el.props['aria-label'] === 'Add Milk to grocery list');
  if (!add) return null;
  add.props.onClick();
  return globalThis.__hh_grocery[0] ?? null;
}

const { StockRow } = await screen('components/StockRow.tsx');
const furniture = await furnitureStub();
const alerts = await screen('pages/Alerts.tsx', [
  [/^\.\.\/components\/TopBar$/, furniture],
  [/^\.\.\/components\/EmptyState$/, furniture],
]);

console.log('\nthe Stock row writes the rule');

for (const c of STOCK_CASES) {
  globalThis.__hh_stock = [lowItem(c.threshold, c.unit)];
  const tree = treeOf(StockRow, { item: lowItem(c.threshold, c.unit), showActions: true });
  const line = tapAddToGrocery(tree);
  const expected = groceryQuantityForStock({ lowStockThreshold: c.threshold, unit: c.unit });
  ok(
    line?.quantity === expected,
    `the row writes "${expected}" for ${c.label}`,
    line?.quantity ?? '(no grocery line)',
  );
}

console.log('\nthe Alerts screen writes the SAME line as the Stock row');

for (const c of STOCK_CASES) {
  globalThis.__hh_stock = [lowItem(c.threshold, c.unit)];
  const tree = treeOf(alerts.AlertsPage);
  const line = tapAddToGrocery(tree);
  const expected = groceryQuantityForStock({ lowStockThreshold: c.threshold, unit: c.unit });
  ok(
    line?.quantity === expected,
    `the Alerts screen writes "${expected}" for ${c.label}`,
    line?.quantity ?? '(no grocery line)',
  );
}

// THE POINT OF THE WHOLE TEST: the two screens wrote the same line for the
// same item. This is the case that was different — a fractional threshold,
// where the Stock row rounded up and the Alerts screen did not.
console.log('\nthe two screens do not disagree about the same item');
{
  globalThis.__hh_stock = [lowItem(2.5, 'kg')];
  const row = tapAddToGrocery(treeOf(StockRow, { item: lowItem(2.5, 'kg'), showActions: true }));
  const alert = tapAddToGrocery(treeOf(alerts.AlertsPage));
  ok(
    row?.quantity === alert?.quantity,
    'the Stock row and the Alerts screen write one line for one item',
    `the row wrote "${row?.quantity}" and the Alerts screen wrote "${alert?.quantity}"`,
  );
  ok(
    row?.quantity === '2.5 kg',
    'and the amount is the threshold the household set',
    row?.quantity ?? '(no grocery line)',
  );
}

/* -------------------------------------------------------------------------- */
/* Every writer                                                                  */
/* -------------------------------------------------------------------------- */

console.log('\nno screen spells a quantity with a template of its own');

/**
 * Every source file in src/.
 *
 * @returns {Promise<string[]>} the paths
 */
async function sources() {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
    }
  }
  await walk(path.join(REPO, 'src'));
  return found;
}

// THE TEMPLATE THAT WAS WRONG: the number run into the unit with nothing
// between them — "{n.needed}{n.unit}" and "${needed}${unit}".
//
// WHY THE PATTERN IS KEPT TO ONE LINE: a wider one matched across unrelated
// lines of JSX and reported failures that were not there.
const SPLICED = /\{[A-Za-z_$][^{}\n]*\}\s*\{[A-Za-z_$][^{}\n]*unit[^{}\n]*\}|\$\{[A-Za-z_$][^{}\n]*\}\$\{[A-Za-z_$][^{}\n]*unit[^{}\n]*\}/;

for (const file of await sources()) {
  const rel = path.relative(REPO, file);
  const text = await readFile(file, 'utf8');
  ok(!SPLICED.test(text), `${rel} does not run a number into a unit`, '');
}

// THE FOUR SCREENS THAT WORK OUT AN AMOUNT: each of them must ask the shared
// rule, so that the shopping list cannot get a second spelling of the same
// line.
const RULE_WRITERS = [
  'src/components/StockRow.tsx',
  'src/pages/Alerts.tsx',
  'src/pages/MealPlan.tsx',
  'src/hooks/useAutoGrocery.ts',
];

for (const rel of RULE_WRITERS) {
  const text = await readFile(path.join(REPO, rel), 'utf8');
  ok(
    /groceryQuantityFor(Stock|Need)\(/.test(text),
    `${rel} writes its line with the shared rule`,
    '',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
