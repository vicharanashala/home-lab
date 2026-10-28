/**
 * The Dashboard's "Expiring soon" card must mean what it says.
 *
 * THE BUG
 *
 * The card is headed "Expiring soon" and, when it has nothing to show, says
 * "No items expiring in the next 7 days". It then listed items whose date
 * had ALREADY PASSED:
 *
 *     src/pages/Dashboard.tsx
 *       const bucket = expiryBucket(it.expiryDate, settings.expiringSoonDays);
 *       return bucket === 'expired' || bucket === 'soon';   // <- expired, too
 *
 * So a household with one mango that went off three days ago and two things
 * that are still good for a week was told:
 *
 *     the Dashboard's card    "3 items need attention"   (under "Expiring soon")
 *     the Alerts screen       "Expired (1)" and "Within 7 days (2)"
 *     House Bot's context    "EXPIRING SOON (within 7 days): ..."  (not the mango)
 *
 * Three screens, three answers to one question. The bridge was fixed for
 * exactly this on 2026-10-28 — commit 3bec8ed, "Read the expiry window from
 * the household" — and it left the Dashboard contradicting it. The Alerts
 * screen can carry an expired item inside an "Expiring soon" heading because
 * it splits the list into an "Expired (n)" group and a "Within 7 days (n)"
 * group; the Dashboard has no such split, so an expired item in that list is
 * simply an expired item under a heading that says it is not one.
 *
 * WHAT IS TESTED HERE
 *
 * The REAL component — `Dashboard.tsx` bundled with esbuild, the same way
 * `test-stock-row-expiry-window.mjs` bundles a `.tsx` — rendered with a
 * stubbed store and a stubbed router, and the answer is read out of the
 * rendered HTML.
 *
 * WHY THE EXPECTED ANSWER IS NOT RESTATED: the test asks the app's own
 * `expiryBucket` (from `src/utils/date.ts`) which items are 'soon' and which
 * are 'expired', and demands that the card contain exactly the 'soon' ones.
 * A restated rule would only prove that the restatement agrees with itself.
 *
 * WHY THE ALERTS TILE IS CHECKED TOO: an expired item is still an ALERT, so
 * it must keep counting towards the tile that links to the Alerts screen.
 * The fix narrows the CARD; it must not narrow the tile. A test that only
 * checked the card would happily pass a fix that silently hid expired food
 * from the household altogether.
 *
 * Run with:  node scripts/test-dashboard-expiring-section.mjs
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
const { renderToString } = require('react-dom/server');

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
/* The store and the router, as stubs                                          */
/* -------------------------------------------------------------------------- */

/**
 * The store, as a stub the Dashboard can be handed.
 *
 * WHY A STUB: `renderToString` reads the store's SERVER snapshot, which is
 * frozen seed state, so the household under test could never reach the
 * component through the real store.
 *
 * @param {object[]} stock the kitchen stock under test
 * @param {object} settings the household's settings
 * @returns {Promise<string>} the path of the stub module
 */
async function stubStore(stock, settings) {
  const file = path.join(tmpdir(), `hh-dash-store-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(
    file,
    `export function useStore() {
  return {
    stock: ${JSON.stringify(stock)},
    grocery: [],
    mealLogs: [],
    recipes: [],
    settings: ${JSON.stringify(settings)},
    toast() {},
    removeMealLog() {},
    incrementStock() {},
    removeStock() {},
    addGrocery() {},
    toggleGroceryPurchased() {},
    removeGrocery() {},
    addStock() {},
    addMealLog() {},
    logMealFromRecipe() {},
    logMealFromRecipes() {},
  };
}
`,
  );
  return file;
}

/**
 * The router, as a stub.
 *
 * WHY A STUB AND NOT MemoryRouter: `react-router-dom`'s `Link` uses
 * `useLayoutEffect`, which React's server renderer warns about on every
 * single link — a wall of noise that hides a real failure. The router has
 * no bearing on what the Dashboard's card contains.
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
`,
  );
  return file;
}

/**
 * The real `Dashboard`, with the store and the router replaced by stubs.
 *
 * @param {object[]} stock the kitchen stock under test
 * @param {object} settings the household's settings
 * @returns {Promise<Function>} the component
 */
async function dashboardFor(stock, settings) {
  const storeStub = await stubStore(stock, settings);
  // The bundle lives outside the checkout, so it cannot find the packages the
  // Dashboard imports on its own. The router stub is written HERE, beside the
  // symlinked node_modules, so its own `import 'react'` resolves too.
  const dir = await mkdtemp(path.join(tmpdir(), 'hh-dashboard-'));
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  const routerStub = await stubRouter(dir);

  const bundle = await build({
    entryPoints: [path.join(REPO, 'src/pages/Dashboard.tsx')],
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
      'date-fns',
    ],
    plugins: [
      {
        // WHY THE STORE AND THE ROUTER ARE PULLED OUT OF THE BUNDLE: a bundle
        // that carried its own copy of the store would have its own copy of
        // the household, and the card would be asked about a household this
        // test is not driving.
        name: 'stub-the-store-and-router',
        setup(b) {
          b.onResolve({ filter: /^(?:\.\.\/|\.\/)store\/useStore$/ }, () => ({
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
  const file = path.join(dir, 'Dashboard.mjs');
  await writeFile(file, bundle.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return mod.Dashboard;
}

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

/* -------------------------------------------------------------------------- */
/* Reading the card out of the rendered HTML                                   */
/* -------------------------------------------------------------------------- */

/**
 * The "Expiring soon" card, as rendered.
 *
 * The card is the part of the page from its heading to the next heading, so
 * a count read from it is the card's own count and not the Alerts tile's.
 *
 * @param {string} html the rendered page
 * @returns {string} the card's markup
 */
function cardOf(html) {
  const start = html.indexOf('Expiring soon');
  if (start === -1) return '';
  // The card ends where the next section begins. The stat tiles come BEFORE
  // the card, so nothing before this point can be mistaken for the card.
  const end = html.indexOf('Nearby stores', start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

/**
 * The number the "Alerts" stat tile shows.
 *
 * The tile renders its number and then its label, so the number is the text
 * immediately before the label.
 *
 * @param {string} html the rendered page
 * @returns {string} the number, or '(none)'
 */
function alertsTileOf(html) {
  const label = html.indexOf('Alerts</div>');
  if (label === -1) return '(none)';
  const before = html.slice(Math.max(0, label - 200), label);
  const match = before.match(/>(-?\d+)</);
  return match ? match[1] : '(none)';
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

const SOON_2 = inDays(2);
const SOON_5 = inDays(5);
const PAST_3 = inDays(-3);

console.log('\nan item that has already gone off is not "expiring soon"');
{
  const Dashboard = await dashboardFor(
    [
      stockItem('a', 'Curdshelf', SOON_2),
      stockItem('b', 'Milkpast', PAST_3),
      stockItem('c', 'Cheesefar', SOON_5),
    ],
    { userName: '', expiringSoonDays: 7, dietaryPreference: 'no-preference', allergies: [] },
  );
  const html = renderToString(createElement(Dashboard));
  const card = cardOf(html);

  ok(
    !card.includes('Milkpast'),
    'the expired item is not in the card',
    card.includes('Milkpast') ? 'the card names it' : 'the card does not name it',
  );
  ok(
    card.includes('Curdshelf') && card.includes('Cheesefar'),
    'the items that ARE in the window are still in the card',
  );

  // The count, read the way the app writes it.
  const soonCount = card.match(/(\d+) item/);
  ok(
    soonCount !== null && soonCount[1] === '2',
    'the card counts only the items in the window',
    soonCount ? `the card says "${soonCount[1]} item(s) need attention"` : 'no count in the card',
  );
}

console.log('\nwith only an expired item, the card says so');
{
  const Dashboard = await dashboardFor(
    [stockItem('b', 'Milkpast', PAST_3)],
    { userName: '', expiringSoonDays: 7, dietaryPreference: 'no-preference', allergies: [] },
  );
  const html = renderToString(createElement(Dashboard));
  const card = cardOf(html);

  ok(
    card.includes('No items expiring in the next 7 days'),
    'the empty state is the one it promises',
    card.includes('No items expiring in the next 7 days') ? 'the card promises it' : 'the card does not',
  );
  ok(!card.includes('Milkpast'), 'and the expired item is not listed');
}

console.log('\nan expired item is still an ALERT');
{
  const Dashboard = await dashboardFor(
    [
      stockItem('b', 'Milkpast', PAST_3),
      stockItem('a', 'Curdshelf', SOON_2),
    ],
    { userName: '', expiringSoonDays: 7, dietaryPreference: 'no-preference', allergies: [] },
  );
  const html = renderToString(createElement(Dashboard));

  ok(
    alertsTileOf(html) === '2',
    'the Alerts tile still counts the expired item',
    `the tile shows ${alertsTileOf(html)}`,
  );
}

console.log('\nthe household\'s window decides what is in the card');
{
  const stock = [
    stockItem('c', 'Cheesefar', SOON_5),
    stockItem('b', 'Milkpast', PAST_3),
  ];

  const wide = await dashboardFor(stock, {
    userName: '', expiringSoonDays: 7, dietaryPreference: 'no-preference', allergies: [],
  });
  const wideCard = cardOf(renderToString(createElement(wide)));
  ok(
    wideCard.includes('Cheesefar'),
    'at a 7-day window the item that is 5 days out is in the card',
  );

  const narrow = await dashboardFor(stock, {
    userName: '', expiringSoonDays: 1, dietaryPreference: 'no-preference', allergies: [],
  });
  const narrowCard = cardOf(renderToString(createElement(narrow)));
  ok(
    !narrowCard.includes('Cheesefar'),
    'at a 1-day window it is not',
    narrowCard.includes('Cheesefar') ? 'the card still names it' : 'the card does not name it',
  );
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
