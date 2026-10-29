/**
 * The Stock screen's status chips must mean what they say.
 *
 * THE BUG
 *
 * The screen has a status chip that reads "Expiring (N)" and, when the filter
 * it selects has nothing to show, an empty state that says "Nothing expiring
 * soon". The list behind that chip was:
 *
 *     src/pages/Stock.tsx
 *       const days = daysUntil(it.expiryDate);
 *       return days !== null && days <= soon;   // <- a NEGATIVE day passes too
 *
 * `days <= soon` is true for a day that has ALREADY PASSED. So the chip
 * counted food that has gone off as "expiring", and tapping it listed that
 * food under a heading that says it is not expiring:
 *
 *     the Stock screen's chip   "Expiring (3)"   (one of them expired last week)
 *     the Dashboard's card      "2 items need attention"        (commit 892ffce)
 *     House Bot's context       "EXPIRING SOON (within 7 days): ..."  (commit 3bec8ed)
 *     the Alerts screen         "Expired (1)" and "Within 7 days (2)"
 *
 * Four screens, four answers to one question, and the Stock screen was the
 * one that called gone-off food "expiring". The other three had already been
 * fixed; this one was left behind.
 *
 * WHY THE EXPIRED FOOD NEEDS A CHIP OF ITS OWN: taking it out of the
 * "Expiring" filter without giving it somewhere to go would take it off the
 * screen the person opens to find it. The Alerts screen already splits its
 * list the same way, into "Expired (n)" and "Within n days (n)".
 *
 * WHAT IS TESTED HERE
 *
 * The REAL `Stock.tsx`, bundled with esbuild and driven against a stubbed
 * store the way `test-alerts-window-sync.mjs` drives a real screen. The test
 * asks three questions:
 *
 *   1. does the "Expiring" chip count only the food that has NOT gone off?
 *   2. when the chip is tapped, is the food that has gone off left out?
 *   3. is the food that HAS gone off still findable?
 *
 * WHY THE APP'S OWN expiryBucket IS THE ORACLE: the test asks the app's own
 * `expiryBucket` (from `src/utils/date.ts`) which items are 'soon' and which
 * are 'expired', and demands that the screen agree with it. A restated rule
 * would only prove that the restatement agrees with itself.
 *
 * WHY THE CHIP IS TAPPED AND NOT ONLY READ: the chip's number and the list
 * behind it are two different things. A screen can number a chip honestly
 * and still list the wrong food when the chip is tapped, so the test drives
 * the chip's own handler and looks at the list the handler produced.
 *
 * Run with:  node scripts/test-stock-expiry-filters.mjs
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

const { expiryBucket } = await import(
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
/* Days, on the local calendar, the way the app writes them                     */
/* -------------------------------------------------------------------------- */
//
// WHY LOCAL: `src/utils/date.ts` counts with `differenceInCalendarDays` and
// writes with `format(d, 'yyyy-MM-dd')`, both local. A fixture built on UTC
// days would be a day the app would never write.
const localDay = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dayMs = 86_400_000;

/** The local calendar day, `n` days from today. */
const inDays = (n) => localDay(new Date(Date.now() + n * dayMs));

/* -------------------------------------------------------------------------- */
/* The stock under test                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One item of kitchen stock.
 *
 * @param {string} id the item's id
 * @param {string} name the item's name
 * @param {string} expiryDate the item's expiry day
 * @returns {object} a stock item
 */
function stockItem(id, name, expiryDate) {
  return {
    id,
    name,
    quantity: 2,
    unit: 'pcs',
    category: 'dairy',
    expiryDate,
    location: 'fridge',
    lowStockThreshold: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

// A kitchen with one item that went off three days ago and two things that
// are still good for a week.
const STOCK = [
  stockItem('a', 'Curdshelf', inDays(2)),
  stockItem('b', 'Milkpast', inDays(-3)),
  stockItem('c', 'Cheesefar', inDays(5)),
];
const SETTINGS = {
  userName: '',
  expiringSoonDays: 7,
  dietaryPreference: 'no-preference',
  allergies: [],
};

// The oracle: the app's own answer to "which items are expiring, and which
// have gone off". The screen has to agree with it.
const soonIds = STOCK.filter(
  (it) => expiryBucket(it.expiryDate, SETTINGS.expiringSoonDays) === 'soon',
).map((it) => it.id);
const expiredIds = STOCK.filter(
  (it) => expiryBucket(it.expiryDate, SETTINGS.expiringSoonDays) === 'expired',
).map((it) => it.id);

/* -------------------------------------------------------------------------- */
/* The store and the router, as stubs                                          */
/* -------------------------------------------------------------------------- */

/**
 * The store, as a stub the Stock screen can be handed.
 *
 * WHY A STUB: the real store's SERVER snapshot is frozen seed state, so the
 * household under test could never reach the screen through it.
 *
 * @returns {Promise<string>} the path of the stub module
 */
async function stubStore() {
  const file = tmpStubFile('hh-stock-store.mjs');
  await writeFile(
    file,
    `export function useStore() {
  return {
    stock: ${JSON.stringify(STOCK)},
    grocery: [],
    mealLogs: [],
    recipes: [],
    settings: ${JSON.stringify(SETTINGS)},
    toast() {},
    incrementStock() {},
    decrementStock() {},
    removeStock() {},
    addGrocery() {},
    toggleGroceryPurchased() {},
    removeGrocery() {},
    addStock() {},
    updateStock() {},
    updateSettings() {},
  };
}
`,
  );
  return file;
}

/**
 * The router, as a stub.
 *
 * WHY A STUB AND NOT MemoryRouter: the router has no bearing on what the
 * Stock screen's chips say, and a real one warns about every link.
 *
 * @param {string} dir a directory that can resolve `react`
 * @returns {Promise<string>} the path of the stub module
 */
async function stubRouter(dir) {
  const file = path.join(dir, 'router-stub.mjs');
  await writeFile(
    file,
    `import { createElement } from 'react';
export function Link({ to, children, ...rest }) {
  return createElement('a', { href: typeof to === 'string' ? to : '#', ...rest }, children);
}
export function NavLink({ to, children, ...rest }) {
  return createElement('a', { href: typeof to === 'string' ? to : '#', ...rest }, children);
}
export function useNavigate() { return () => {}; }
export function useLocation() { return { pathname: '/', search: '', hash: '', state: null, key: 'default' }; }
export function Route() { return null; }
export function Routes({ children }) { return children; }
export function BrowserRouter({ children }) { return children; }
`,
  );
  return file;
}

/* -------------------------------------------------------------------------- */
/* The real Stock screen, with the store and the router replaced by stubs      */
/* -------------------------------------------------------------------------- */

const tapShim = path.join(REPO, 'scripts/lib/react-tap-state.mjs');
const storeStub = await stubStore();
const work = tmpWorkDir('hh-stock-filters-');
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');
const routerStub = await stubRouter(work);

const bundle = await build({
  entryPoints: [path.join(REPO, 'src/pages/Stock.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  jsx: 'automatic',
  external: [
    'react/jsx-runtime',
    'react-dom',
    'react-dom/server',
    'lucide-react',
    'clsx',
    'date-fns',
  ],
  plugins: [
    {
      // WHY THE STORE AND THE ROUTER ARE PULLED OUT OF THE BUNDLE: a bundle
      // that carried its own copy of the store would have its own copy of the
      // household, and the chips would be asked about a household this test is
      // not driving.
      name: 'stub-the-store-and-router',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, (args) => {
          // The tap must keep the REAL react external, or esbuild inlines a
          // second copy of React and every hook in the screen breaks.
          if (args.importer === tapShim) return { path: 'react', external: true };
          // The tap must not be bundled in either. A copy inside the bundle
          // would keep its own state, and this test drives that state
          // directly — it would be reading a different screen from the one it
          // renders.
          return { path: tapShim, external: true };
        });
        b.onResolve({ filter: /store\/useStore$/ }, () => ({
          path: pathToFileURL(storeStub).href,
          external: true,
        }));
        b.onResolve({ filter: /^react-router-dom$/ }, () => ({
          path: pathToFileURL(routerStub).href,
          external: true,
        }));
      },
    },
  ],
});

const screenFile = path.join(work, 'Stock.mjs');
await writeFile(screenFile, bundle.outputFiles[0].text);
const { StockPage } = await import(pathToFileURL(screenFile).href);
const tap = await import(pathToFileURL(tapShim).href);

/* -------------------------------------------------------------------------- */
/* Driving the screen                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One render of the screen.
 *
 * WHY THE RENDER IS REPEATED BY HAND: the tap keeps the state slots between
 * renders, so calling the screen again is the same mounted screen being
 * re-rendered — which is what happens when a chip is tapped.
 *
 * @returns {object} the element tree
 */
const render = () => {
  tap.beginRender();
  return StockPage();
};

/** Every element in the tree. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  visit(node);
  walk(node.props?.children, visit);
}

/** The visible text of a tree of elements. */
function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

/**
 * The status chip with the given label.
 *
 * @param {object} tree the rendered screen
 * @param {string} label the label the chip carries
 * @returns {object|null} the chip's element
 */
function chipWith(tree, label) {
  let found = null;
  walk(tree, (el) => {
    if (!found && el.type === 'button' && textOf(el).trim().startsWith(label)) {
      found = el;
    }
  });
  return found;
}

/**
 * The names of the stock rows on the screen.
 *
 * WHY THE ROW IS FOUND BY ITS ITEM AND NOT BY ITS COMPONENT NAME: a stock
 * row is the one thing on this screen that is handed an item, and asking for
 * the item does not depend on what the bundler called the component.
 *
 * @param {object} tree the rendered screen
 * @returns {string[]} the names, in the order they are shown
 */
function rowNames(tree) {
  const names = [];
  walk(tree, (el) => {
    const item = el.props?.item;
    if (item && typeof item.name === 'string') names.push(item.name);
  });
  return names;
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

console.log('\nthe "Expiring" chip counts only what has NOT gone off');
{
  tap.resetState();
  const tree = render();
  const chip = chipWith(tree, 'Expiring');

  ok(chip !== null, 'the screen has an "Expiring" chip');
  const label = chip ? textOf(chip).trim() : '(none)';
  ok(
    label === `Expiring (${soonIds.length})`,
    'and it counts only the food that has NOT gone off',
    `the chip reads "${label}", the app's own answer is ${soonIds.length}`,
  );

  console.log('\ntapping it leaves the food that has gone off out of the list');
  if (chip) {
    chip.props.onClick();
    const names = rowNames(render());

    ok(
      !names.includes('Milkpast'),
      'the food that has gone off is NOT in the list',
      names.includes('Milkpast')
        ? 'the list names it'
        : `the list holds: ${names.join(', ')}`,
    );
    ok(
      names.includes('Curdshelf') && names.includes('Cheesefar'),
      'and the food that is still good is',
      `the list holds: ${names.join(', ')}`,
    );
  }

  console.log('\nthe food that HAS gone off is still findable');
  {
    const expiredChip = chipWith(render(), 'Expired');
    ok(expiredChip !== null, 'the screen has an "Expired" chip');
    if (expiredChip) {
      const expiredLabel = textOf(expiredChip).trim();
      ok(
        expiredLabel === `Expired (${expiredIds.length})`,
        'and it counts the food that has gone off',
        `the chip reads "${expiredLabel}", the app's own answer is ${expiredIds.length}`,
      );

      expiredChip.props.onClick();
      const names = rowNames(render());
      ok(
        names.length === 1 && names[0] === 'Milkpast',
        'and tapping it lists exactly that food',
        `the list holds: ${names.join(', ')}`,
      );
    }
  }
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
