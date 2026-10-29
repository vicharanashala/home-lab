/**
 * The expiry window, written the same way on every screen that shows it.
 *
 * THE BUG
 *
 * The household's expiry window is a number of days, and the household can
 * set it to ONE day — the slider on the Alerts screen and the slider on the
 * Settings screen both start at 1, and "1" is the first notch on both.
 *
 * The Meal Plan got that right. Its strip says:
 *
 *     "You have 3 things expiring in the next 1 day."
 *
 * and the commit that wrote that sentence says why, in as many words:
 *
 *     WHY "day" IS SINGULAR AT ONE: the household can narrow the
 *     window to a single day, and "the next 1 days" is not a
 *     sentence anyone wrote on purpose.
 *
 * But the OTHER places that write the window wrote it without the singular:
 *
 *     src/pages/Alerts.tsx
 *       `Nothing expiring in the next ${days} days`
 *       `${soonCount} expiring in the next ${days} days`
 *       {soonDays} days
 *       Within {settings.expiringSoonDays} days ({soon.length})
 *
 *     src/pages/Dashboard.tsx
 *       `No items expiring in the next ${settings.expiringSoonDays} days`
 *
 *     src/pages/Settings.tsx
 *       {expiringSoonDays} days
 *
 * So a household that narrowed its window to a single day was told, on four
 * screens:
 *
 *     the Meal Plan's strip     "in the next 1 day"
 *     the Alerts screen          "Within 1 days (2)"   and   "1 days"
 *     the Dashboard's card       "No items expiring in the next 1 days"
 *     the Settings screen        "1 days"
 *
 * The same number, written four ways, about one kitchen.
 *
 * WHY IT IS WORTH A RULE AND NOT A TYPO FIX: the repo has already settled
 * that this window is ONE number, asked by every screen, answered the same
 * way. Commit 3bec8ed ("Read the expiry window from the household") is
 * about the number. Commit 12aaa79 ("Name the household's expiry window in
 * the Meal Plan's rescue strip") is about the WORD the number is written
 * with — and it fixed that word in exactly one of the seven places it
 * appears. The rule was written, and then not finished.
 *
 * WHY IT MATTERED ENOUGH TO WRITE DOWN: "1 days" is the sentence a person
 * reads when they have just chosen the narrowest window the app offers. It
 * is the first thing they see after making the setting, and it is wrong in
 * the four places they are most likely to look.
 *
 * WHAT IS TESTED HERE
 *
 * The REAL screens — `Alerts.tsx`, `Dashboard.tsx` and `Settings.tsx` —
 * bundled with esbuild and rendered against a stubbed store and a stubbed
 * router, exactly the way `test-alerts-expiring-heading.mjs` renders the
 * Alerts screen. Each is asked the same question at a one-day window and at
 * a three-day window: what does it call the window?
 *
 * WHY THE ANSWER IS READ OUT OF THE RENDERED PAGE AND NOT OUT OF THE
 * SOURCE: the test is about what the person READS. A rule that renders the
 * right words is a pass, however it is written. The source guard at the end
 * is a separate, smaller claim: that the seven copies are not seven copies.
 *
 * Run with:  node scripts/test-expiry-window-days.mjs
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
/* The store and the router, as stubs                                          */
/* -------------------------------------------------------------------------- */

/**
 * The store, as a stub the screens can be handed.
 *
 * WHY A STUB: `renderToString` reads the store's SERVER snapshot, which is
 * frozen seed state, so the household under test could never reach the
 * component through the real store.
 *
 * WHY IT ALSO EXPORTS THE STORE'S CONSTANTS: the stub replaces the whole
 * `store/useStore` module, and the components the Settings screen draws
 * import three things from it besides the hook — `BACKUP_VERSION`,
 * `MEAL_PLAN_DAYS` and `MEAL_PLAN_DAY_LABELS`. Without them the bundle
 * would not even link, and the screen under test would never render. Their
 * values are the real ones, copied out of `src/store/useStore.ts`.
 *
 * @param {object} settings the household's settings
 * @returns {Promise<string>} the path of the stub module
 */
async function stubStore(settings) {
  const file = tmpStubFile('hh-window-store.mjs');
  await writeFile(
    file,
    `export const BACKUP_VERSION = 1;
export const MEAL_PLAN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const MEAL_PLAN_DAY_LABELS = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
export function exportAppData() { return '{}'; }
export function useStore() {
  return {
    stock: [],
    grocery: [],
    mealLogs: [],
    recipes: [],
    mealPlan: undefined,
    settings: ${JSON.stringify(settings)},
    toast() {},
    updateSettings() {},
    setConsents() {},
    clearAllData() {},
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
 * no bearing on what a screen calls the expiry window.
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
 * @param {object} settings the household's settings
 * @param {string} dir a directory that can resolve `react`
 * @returns {Promise<Function>} the component
 */
async function screenFor(entry, exportName, settings, dir) {
  const storeStub = await stubStore(settings);
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
  // WHY THE FILE NAME IS RANDOM: node caches a module by its URL, so a
  // second bundle written to the same path would be served from the cache —
  // and the screen would still be the household from the FIRST render. The
  // windows are rendered one after another, so the name has to change.
  const file = path.join(dir, `${path.basename(entry, '.tsx')}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, bundle.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return mod[exportName];
}

/* -------------------------------------------------------------------------- */
/* Reading the window out of a rendered screen                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every "<number> day(s)" the screen shows the person.
 *
 * WHY THE COMMENTS ARE STRIPPED: React's server renderer puts `<!-- -->`
 * between adjacent text nodes, so a phrase built from an expression and a
 * literal arrives as `1<!-- --> days`. Left in, the number and the word are
 * two separate strings and no phrase can be read out of the page.
 *
 * @param {string} html the rendered page
 * @returns {string[]} the phrases, in the order they appear
 */
function dayPhrases(html) {
  const flat = html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ');
  return [...flat.matchAll(/(\d+)\s+(day|days)\b/g)].map((m) => m[0]);
}

/* -------------------------------------------------------------------------- */
/* The screens, and the windows they are asked about                            */
/* -------------------------------------------------------------------------- */

const SCREENS = [
  { entry: 'src/pages/Alerts.tsx', exportName: 'AlertsPage', label: 'the Alerts screen' },
  { entry: 'src/pages/Dashboard.tsx', exportName: 'Dashboard', label: 'the Dashboard' },
  { entry: 'src/pages/Settings.tsx', exportName: 'SettingsPage', label: 'the Settings screen' },
];

/**
 * The household under test.
 *
 * @param {number} window the expiry window, in days
 * @returns {object} the settings
 */
function household(window) {
  return {
    userName: 'Test',
    dietaryPreference: 'no-preference',
    allergies: [],
    expiringSoonDays: window,
    household: { adults: 2, teens: 0, children: 0, toddlers: 0 },
    theme: 'light',
    consents: {},
  };
}

const work = tmpWorkDir('hh-window-days-');
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

console.log('\nat a one-day window, no screen says "1 days"');
for (const screen of SCREENS) {
  const Component = await screenFor(screen.entry, screen.exportName, household(1), work);
  const html = renderToString(createElement(Component));
  const phrases = dayPhrases(html);

  ok(
    !phrases.includes('1 days'),
    `${screen.label} does not say "1 days"`,
    phrases.length ? `it says: ${phrases.join(' | ')}` : 'it says no day phrase at all',
  );
  ok(
    phrases.includes('1 day'),
    `${screen.label} says "1 day"`,
    phrases.length ? `it says: ${phrases.join(' | ')}` : 'it says no day phrase at all',
  );
}

console.log('\nat a three-day window, the plural is still there');
for (const screen of SCREENS) {
  const Component = await screenFor(screen.entry, screen.exportName, household(3), work);
  const html = renderToString(createElement(Component));
  const phrases = dayPhrases(html);

  ok(
    phrases.includes('3 days'),
    `${screen.label} says "3 days"`,
    phrases.length ? `it says: ${phrases.join(' | ')}` : 'it says no day phrase at all',
  );
  ok(
    !phrases.some((p) => p === '1 days'),
    `${screen.label} does not say "1 days"`,
    phrases.length ? `it says: ${phrases.join(' | ')}` : 'it says no day phrase at all',
  );
}

console.log('\nONE RULE, NOT SEVEN COPIES');
{
  // WHY THIS GUARD EXISTS AND WHY IT IS NOT THE MAIN TEST: the three
  // assertions above are about the WORDS the person reads, and they pass
  // however the words are produced. This one is about the shape of the fix:
  // the seven places that write the window must call ONE rule, because seven
  // copies of a rule is how the seven of them came to disagree in the first
  // place — commit 12aaa79 fixed one of the seven and left the other six.
  //
  // WHY IT IS A SOURCE GUARD AND NOT A RENDERED ONE: the Meal Plan's strip
  // only renders when the kitchen has food to rescue, so a rendered check
  // cannot cover it without building a whole kitchen. The source is the
  // honest place to make the claim.
  const { readFile } = await import('node:fs/promises');
  const FILES = [
    'src/pages/Alerts.tsx',
    'src/pages/Dashboard.tsx',
    'src/pages/Settings.tsx',
    'src/pages/MealPlan.tsx',
  ];
  for (const file of FILES) {
    const source = await readFile(path.join(REPO, file), 'utf8');
    ok(
      /import \{[^}]*\bformatDays\b[^}]*\} from '\.\.\/utils\/date'/.test(source),
      `${file} calls the shared rule`,
      source.includes('formatDays') ? '' : 'it writes the window in its own words',
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
