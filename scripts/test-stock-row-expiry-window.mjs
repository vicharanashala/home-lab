/**
 * Regression test: a stock row's expiry badge must follow the household's
 * expiry window.
 *
 * THE BUG
 *
 * `settings.expiringSoonDays` is the ONE setting that answers "what is about to
 * go off". The Alerts screen uses it to decide what to flag, the Dashboard uses
 * it to count and list, the Stock screen uses it to build its "Expiring" filter,
 * House Bot's context block uses it, and the Meal Plan's rescue strip uses it.
 *
 * The stock row itself did not. It asked for the bucket with no window at all:
 *
 *     const bucket = expiryBucket(item.expiryDate);   // <- the default: 3 days
 *
 * `expiryBucket` takes the window as its second argument and defaults it to
 * three. So the row's badge was computed against three days no matter what the
 * household had set — and the row is what the Stock screen and the Dashboard
 * draw.
 *
 * WHAT IT LOOKS LIKE TO THE USER
 *
 * A household that widens the window to a week (the Alerts screen has a slider
 * from 1 to 14, and the Settings screen writes the same number):
 *
 *     the Alerts screen says   "5 items expiring within 7 days"
 *     the Dashboard lists the five under "Expiring soon"
 *     the Stock screen's "Expiring" filter keeps all five
 *
 * and then the row for the item that is five days from going off says
 *
 *     Nov 2, 2026        <- the plain date, because three days is what the
 *                          row asked about
 *
 * The item is expiring soon on every screen around it and the row beside it
 * says nothing is. The same item, the same household, two answers — which is
 * the failure the app's own `src/utils/expiryRecipes.ts` warns about.
 *
 * The other direction is the same bug: a household that NARROWS the window to
 * one day would have rows shouting "2 days" at items the Alerts screen has
 * already decided are not expiring.
 *
 * WHAT IS TESTED HERE
 *
 * The rule: the row's badge is computed with the household's window, so it
 * agrees with the Alerts screen about the same item.
 *
 * The test drives the REAL component — `StockRow.tsx` bundled with esbuild,
 * the same way `test-storage-failure.mjs` bundles a `.tsx` — and reads the
 * badge out of the rendered HTML.
 *
 * WHY THE STORE IS A STUB AND NOT THE REAL ONE: `renderToString` reads the
 * store's SERVER snapshot, which is frozen seed state, so a household's
 * setting can never reach a component through it. The stub stands in for the
 * store and hands the component the household under test. The component, its
 * `expiryBucket` call and the badge it draws are all the real ones.
 *
 * WHY THE EXPECTED ANSWER IS NOT RESTATED: the test asks the app's own
 * `expiryBucket` (from `src/utils/date.ts`) what the row should say, and
 * demands that the row says that. A restated rule would only prove that the
 * restatement agrees with itself.
 *
 * Run with:  node scripts/test-stock-row-expiry-window.mjs
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
const { renderToString } = require('react-dom/server');

const { expiryBucket, daysUntil } = await import(
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

const IN_TWO_DAYS = localDay(new Date(Date.now() + 2 * dayMs));
const IN_FIVE_DAYS = localDay(new Date(Date.now() + 5 * dayMs));

/* -------------------------------------------------------------------------- */
/* The row, built from the real component                                       */
/* -------------------------------------------------------------------------- */

/**
 * The store, as a stub the component can be handed.
 *
 * WHY A STUB: `renderToString` reads the store's SERVER snapshot, which is
 * frozen seed state, so the household under test could never reach the
 * component through the real store.
 *
 * @param {number} windowDays the household's expiry window
 * @returns {string} the path of the stub module
 */
async function stubStore(windowDays) {
  const file = tmpStubFile('hh-stockrow-store.mjs');
  await writeFile(
    file,
    `export function useStore() {
  return {
    stock: [],
    grocery: [],
    settings: {
      expiringSoonDays: ${windowDays},
      userName: '',
      dietaryPreference: 'no-preference',
      allergies: [],
    },
    incrementStock() {},
    removeStock() {},
    toast() {},
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
 * @param {number} windowDays the household's expiry window
 * @returns {Promise<Function>} the component
 */
async function stockRowFor(windowDays) {
  const storeStub = await stubStore(windowDays);
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
  const dir = tmpWorkDir('hh-stockrow-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  const file = path.join(dir, 'StockRow.mjs');
  await writeFile(file, bundle.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return mod.StockRow;
}

/** A row of kitchen stock, expiring on the given day. */
function stockItem(expiryDate) {
  return {
    id: 'stk_1',
    name: 'Mango',
    quantity: 3,
    unit: 'pcs',
    category: 'fruits',
    expiryDate,
    location: 'fridge',
    lowStockThreshold: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

/**
 * The badge the row drew, read out of the rendered HTML.
 *
 * The row draws one of four things: "Expired", the number of days left
 * ("Today", "Tomorrow", "5 days"), or the plain expiry date when the item is
 * not expiring soon. The plain date is the one that gives the bug away: an
 * item inside the household's window must never read as a plain date.
 *
 * @param {string} html the rendered row
 * @returns {string} the badge
 */
function badgeOf(html) {
  const match = html.match(/(Expired|\d+ days?|Today|Tomorrow|[A-Z][a-z]{2} \d{1,2}, \d{4})/);
  return match ? match[0] : '(none)';
}

/**
 * What the badge SHOULD be, according to the app's own rule.
 *
 * The app's own `expiryBucket` decides it, so this is not a restatement of
 * the rule — it is the rule.
 *
 * @param {string} expiryDate the item's expiry day
 * @param {number} windowDays the household's expiry window
 * @returns {string} the badge the row should draw
 */
function expectedBadge(expiryDate, windowDays) {
  const bucket = expiryBucket(expiryDate, windowDays);
  const days = daysUntil(expiryDate) ?? 0;
  if (bucket === 'expired') return 'Expired';
  if (bucket === 'soon') {
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days} days`;
  }
  // "ok" — the row shows the plain date.
  const d = new Date(`${expiryDate}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

console.log('\na household that widened its window to a week');
{
  const StockRow = await stockRowFor(7);

  const five = renderToString(
    createElement(StockRow, { item: stockItem(IN_FIVE_DAYS), compact: true, showActions: false }),
  );
  const want = expectedBadge(IN_FIVE_DAYS, 7);
  const got = badgeOf(five);
  ok(
    got === want,
    'a row five days from expiring says so, as the Alerts screen would',
    `row says "${got}", the app's own rule says "${want}"`,
  );
  ok(
    !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(got),
    'and it does not fall back to the plain date',
    got,
  );

  // An item inside every window the household can set is unchanged.
  const two = renderToString(
    createElement(StockRow, { item: stockItem(IN_TWO_DAYS), compact: true, showActions: false }),
  );
  ok(
    badgeOf(two) === expectedBadge(IN_TWO_DAYS, 7),
    'a row two days from expiring is unchanged',
    `row says "${badgeOf(two)}"`,
  );
}

console.log('\na household that narrowed its window to one day');
{
  const StockRow = await stockRowFor(1);

  // An item two days out is NOT expiring soon at a one-day window, so the row
  // must not shout "2 days" at it.
  const two = renderToString(
    createElement(StockRow, { item: stockItem(IN_TWO_DAYS), compact: true, showActions: false }),
  );
  const want = expectedBadge(IN_TWO_DAYS, 1);
  ok(
    badgeOf(two) === want,
    'a row two days from expiring does not shout at a one-day window',
    `row says "${badgeOf(two)}", the app's own rule says "${want}"`,
  );
  ok(
    !badgeOf(two).includes('2 days'),
    'and it does not claim the item is expiring soon',
    badgeOf(two),
  );
}

console.log('\nthe default window is unchanged');
{
  const StockRow = await stockRowFor(3);

  const two = renderToString(
    createElement(StockRow, { item: stockItem(IN_TWO_DAYS), compact: true, showActions: false }),
  );
  ok(
    badgeOf(two) === expectedBadge(IN_TWO_DAYS, 3),
    'a row two days from expiring still says "2 days" at the default window',
    `row says "${badgeOf(two)}"`,
  );

  const five = renderToString(
    createElement(StockRow, { item: stockItem(IN_FIVE_DAYS), compact: true, showActions: false }),
  );
  ok(
    badgeOf(five) === expectedBadge(IN_FIVE_DAYS, 3),
    'a row five days from expiring still shows the plain date at the default window',
    `row says "${badgeOf(five)}"`,
  );
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
