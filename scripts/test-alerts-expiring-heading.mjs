/**
 * The Alerts screen's "Expiring soon" heading must mean what the Dashboard's
 * "Expiring soon" card means.
 *
 * THE BUG
 *
 * The Alerts screen's section is headed "Expiring soon", and the sentence
 * under that heading counted the SECTION's total — the food that has gone off
 * AND the food that is about to:
 *
 *     src/pages/Alerts.tsx
 *       const expiring = stock.filter((it) => {
 *         const b = expiryBucket(it.expiryDate, settings.expiringSoonDays);
 *         return b === 'expired' || b === 'soon';      // <- expired, too
 *       });
 *       ...
 *       {expiring.length === 0
 *         ? `Nothing expiring in the next ${settings.expiringSoonDays} days`
 *         : `${expiring.length} item${expiring.length === 1 ? '' : 's'} need attention`}
 *
 * So a kitchen with one mango that went off three days ago and two things
 * still good for a week was told:
 *
 *     the Dashboard's card    "2 items need attention"   (under "Expiring soon")
 *     this screen's heading   "3 items need attention"   (under "Expiring soon")
 *
 * The same heading, the same sentence, two numbers, one kitchen. The
 * Dashboard counts only the food whose date has NOT passed and is inside the
 * window; this screen counted the mango that went off three days ago as
 * "expiring soon".
 *
 * WHY THIS IS A REAL DEFECT AND NOT A DIFFERENT QUESTION: the two screens
 * are asked the same question — "how many things are about to go off?" — and
 * the repo has already settled it. Commit 892ffce, "Do not call food that
 * has gone off 'expiring soon'", fixed this exact count on the Dashboard.
 * Commit cd689e6 fixed the same thing on the Stock screen by giving the two
 * sets their OWN counts ("Expiring (n)" and "Expired (n)") instead of
 * mixing them into one number. Commit aef0cde, "Count the household's
 * expiring food", put the shared rule in `itemsExpiringSoon` and made the
 * Dashboard and the Meal Plan call it — and left this one sentence behind.
 *
 * WHAT IS TESTED HERE
 *
 * The REAL components — `Alerts.tsx` and `Dashboard.tsx`, both bundled with
 * esbuild the way `test-dashboard-expiring-section.mjs` bundles one — each
 * rendered against a stubbed store and a stubbed router, with the SAME
 * household in both. The two screens are then asked the same question and
 * their answers compared.
 *
 * WHY THE EXPECTED ANSWER IS NOT RESTATED: the test asks the app's own
 * `expiryBucket` (from `src/utils/date.ts`) which items are 'soon' and which
 * are 'expired', and asks the screens for THAT count. A restated rule would
 * only prove that the restatement agrees with itself.
 *
 * WHY THE EXPIRED FOOD MUST STILL BE VISIBLE: the fix narrows the COUNT.
 * It must not hide the food that has gone off — the Alerts screen is the one
 * place in the app where it is shown, in its own "Expired (n)" group, and
 * the screen's own total still counts it. A test that only checked the count
 * would happily pass a fix that silently hid expired food from the
 * household altogether.
 *
 * Run with:  node scripts/test-alerts-expiring-heading.mjs
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
 * The store, as a stub the screens can be handed.
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
  const file = tmpStubFile('hh-alerts-store.mjs');
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
    updateSettings() {},
    addGrocery() {},
    removeMealLog() {},
    incrementStock() {},
    removeStock() {},
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
 * no bearing on what either screen says about expiry.
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
 * A real screen, with the store and the router replaced by stubs.
 *
 * @param {string} entry the page, relative to the repository root
 * @param {string} exportName the component the page exports
 * @param {object[]} stock the kitchen stock under test
 * @param {object} settings the household's settings
 * @param {string} dir a directory that can resolve `react`
 * @returns {Promise<Function>} the component
 */
async function screenFor(entry, exportName, stock, settings, dir) {
  const storeStub = await stubStore(stock, settings);
  // The bundle lives outside the checkout, so it cannot find the packages the
  // page imports on its own. The router stub is written HERE, beside the
  // symlinked node_modules, so its own `import 'react'` resolves too.
  const routerStub = await stubRouter(dir);

  const bundle = await build({
    entryPoints: [path.join(REPO, entry)],
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
        // the household, and the screen would be asked about a household this
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
  const file = path.join(dir, `${path.basename(entry, '.tsx')}.mjs`);
  await writeFile(file, bundle.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return mod[exportName];
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
/* Reading the two screens out of their rendered HTML                          */
/* -------------------------------------------------------------------------- */

/**
 * The sentence under a screen's "Expiring soon" heading.
 *
 * Both screens put that heading and its sentence in the same shape — a
 * heading and a small paragraph under it — so one reader serves both.
 *
 * WHY THE COMMENTS ARE STRIPPED: React's server renderer puts `<!-- -->`
 * between adjacent text nodes, so a sentence built from an expression and a
 * literal arrives as `2<!-- --> items`. Left in, the number and the word are
 * two separate strings and no sentence can be read out of the page.
 *
 * @param {string} html the rendered page
 * @returns {string} the sentence, without its markup
 */
function expiringSentence(html) {
  const flat = html.replace(/<!-- -->/g, '');
  const heading = flat.indexOf('Expiring soon');
  if (heading === -1) return '(no Expiring soon heading)';
  const paragraph = flat.slice(heading).match(/<p[^>]*>([\s\S]*?)<\/p>/);
  if (!paragraph) return '(no sentence under the heading)';
  return paragraph[1].replace(/<[^>]*>/g, '').trim();
}

/**
 * The number of items the sentence claims are expiring.
 *
 * WHY THE WORD AFTER THE NUMBER MATTERS: the sentence under the heading also
 * carries the size of the window — "No items expiring in the next 7 days" —
 * and a 7 there is the window, not a count of food. So the count is the
 * number that stands in front of the noun it counts: "2 items", "2 things",
 * "2 expiring". A sentence that names no count says nothing is expiring.
 *
 * @param {string} sentence the sentence under the heading
 * @returns {number} the count, 0 when the sentence names none
 */
function expiringCountOf(sentence) {
  const match = sentence.match(/(\d+)\s+(?:item|thing|expiring)/);
  return match ? Number(match[1]) : 0;
}

/**
 * The screen's own total — the number in the bar at the top.
 *
 * This is the whole screen's alerts: food that is running low, food that
 * has gone off and food that is about to. It is the same number as the
 * Dashboard's Alerts tile.
 *
 * @param {string} html the rendered page
 * @returns {string} the number, or '(none)'
 */
function screenTotalOf(html) {
  const flat = html.replace(/<!-- -->/g, '');
  // WHY THE VERB IS OPTIONAL: the sentence agrees with its count — one thing
  // to attend to reads "1 item needs attention" and more than one reads "2
  // items need attention". The reader takes both forms so it still finds the
  // number for a household that has exactly one thing to attend to.
  const match = flat.match(/(\d+) items? needs? attention/);
  return match ? match[1] : '(none)';
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

const SOON_TODAY = inDays(0);
const SOON_5 = inDays(5);
const PAST_3 = inDays(-3);
const PAST_1 = inDays(-1);

const settings = {
  userName: '',
  expiringSoonDays: 7,
  dietaryPreference: 'no-preference',
  allergies: [],
};

console.log('\nthe two screens answer the same question the same way');

{
  // WHY THIS HOUSEHOLD: the mango went off three days ago, the curd goes off
  // today and the milk in five days. The Dashboard's card counts the curd and
  // the milk; the Alerts screen's heading used to count the mango as well.
  const stock = [
    stockItem('a', 'Curdshelf', SOON_TODAY),
    stockItem('b', 'Milkpast', SOON_5),
    stockItem('c', 'Cheesefar', PAST_3),
  ];

  const soonCount = stock.filter(
    (it) => expiryBucket(it.expiryDate, settings.expiringSoonDays) === 'soon',
  ).length;
  const expiredCount = stock.filter(
    (it) => expiryBucket(it.expiryDate, settings.expiringSoonDays) === 'expired',
  ).length;

  const dir = tmpWorkDir('hh-alerts-heading-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));

  const AlertsPage = await screenFor(
    'src/pages/Alerts.tsx',
    'AlertsPage',
    stock,
    settings,
    dir,
  );
  const Dashboard = await screenFor(
    'src/pages/Dashboard.tsx',
    'Dashboard',
    stock,
    settings,
    dir,
  );

  const alertsHtml = renderToString(createElement(AlertsPage));
  const dashboardHtml = renderToString(createElement(Dashboard));

  const alertsSentence = expiringSentence(alertsHtml);
  const dashboardSentence = expiringSentence(dashboardHtml);

  ok(
    expiringCountOf(dashboardSentence) === soonCount,
    'the Dashboard counts only the food in the window',
    `the card says "${dashboardSentence}", the window holds ${soonCount}`,
  );
  ok(
    expiringCountOf(alertsSentence) === soonCount,
    'the Alerts screen counts the same food',
    `the heading says "${alertsSentence}", the window holds ${soonCount}`,
  );
  ok(
    expiringCountOf(alertsSentence) === expiringCountOf(dashboardSentence),
    'the two screens say the same number for the same heading',
    `the Dashboard says "${dashboardSentence}", the Alerts screen says "${alertsSentence}"`,
  );
  ok(
    !alertsSentence.includes(`${soonCount + expiredCount} items need attention`),
    'the food that has gone off is not counted as expiring',
    `the heading says "${alertsSentence}"`,
  );

  // The food that has gone off must still be VISIBLE and still counted.
  ok(
    alertsHtml.includes('Cheesefar'),
    'the food that has gone off is still listed on the Alerts screen',
  );
  ok(
    /Expired \(1\)/.test(alertsHtml.replace(/<!-- -->/g, '')),
    'and it is still counted in its own Expired group',
  );
  ok(
    screenTotalOf(alertsHtml) === String(soonCount + expiredCount),
    'and the screen\'s own total still counts it',
    `the screen's total is ${screenTotalOf(alertsHtml)}`,
  );
}

console.log('\na kitchen with nothing in the window is not told everything is fine');

{
  // Nothing is expiring inside the window, and two things have already gone
  // off. The screen still holds them, so it must not describe itself as
  // holding nothing.
  const stock = [
    stockItem('d', 'Milkpast', PAST_3),
    stockItem('e', 'Cheesefar', PAST_1),
  ];

  const dir = tmpWorkDir('hh-alerts-heading-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));

  const AlertsPage = await screenFor(
    'src/pages/Alerts.tsx',
    'AlertsPage',
    stock,
    settings,
    dir,
  );
  const Dashboard = await screenFor(
    'src/pages/Dashboard.tsx',
    'Dashboard',
    stock,
    settings,
    dir,
  );

  const alertsHtml = renderToString(createElement(AlertsPage));
  const dashboardHtml = renderToString(createElement(Dashboard));

  const alertsSentence = expiringSentence(alertsHtml);
  const dashboardSentence = expiringSentence(dashboardHtml);

  ok(
    expiringCountOf(alertsSentence) === expiringCountOf(dashboardSentence),
    'the two screens still say the same number',
    `the Dashboard says "${dashboardSentence}", the Alerts screen says "${alertsSentence}"`,
  );
  ok(
    !/^Nothing expiring in the next 7 days$/.test(alertsSentence),
    'the heading does not describe the screen as holding nothing',
    `the heading says "${alertsSentence}"`,
  );
  ok(
    alertsSentence.includes('2 already gone off'),
    'and it names the food that has gone off',
    `the heading says "${alertsSentence}"`,
  );
  ok(
    !/0 items need attention/.test(alertsSentence),
    'and it does not claim there is nothing to attend to',
    `the heading says "${alertsSentence}"`,
  );
  ok(
    screenTotalOf(alertsHtml) === '2',
    'the screen\'s own total still counts the food that has gone off',
    `the screen's total is ${screenTotalOf(alertsHtml)}`,
  );
}

console.log('\na kitchen with only food in the window');

{
  const stock = [
    stockItem('a', 'Curdshelf', SOON_TODAY),
    stockItem('b', 'Milkpast', SOON_5),
    stockItem('f', 'Paneerbox', SOON_5),
  ];

  const dir = tmpWorkDir('hh-alerts-heading-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));

  const AlertsPage = await screenFor(
    'src/pages/Alerts.tsx',
    'AlertsPage',
    stock,
    settings,
    dir,
  );
  const Dashboard = await screenFor(
    'src/pages/Dashboard.tsx',
    'Dashboard',
    stock,
    settings,
    dir,
  );

  const alertsSentence = expiringSentence(renderToString(createElement(AlertsPage)));
  const dashboardSentence = expiringSentence(renderToString(createElement(Dashboard)));

  ok(
    expiringCountOf(alertsSentence) === 3,
    'the Alerts screen counts the three things in the window',
    `the heading says "${alertsSentence}"`,
  );
  ok(
    expiringCountOf(alertsSentence) === expiringCountOf(dashboardSentence),
    'and it is the number the Dashboard gives',
    `the Dashboard says "${dashboardSentence}", the Alerts screen says "${alertsSentence}"`,
  );
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
