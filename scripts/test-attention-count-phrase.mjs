/**
 * The count of things that need attention, written the same way on every
 * screen that shows it.
 *
 * THE BUG
 *
 * Two screens tell the household how many things need their attention, and
 * both of them wrote the count and the plural noun but left the VERB
 * agreeing with the plural:
 *
 *     src/pages/Alerts.tsx
 *       : `${totalAlerts} item${totalAlerts === 1 ? '' : 's'} need attention`
 *
 *     src/pages/Dashboard.tsx
 *       : `${expiringSoonCount} item${expiringSoonCount === 1 ? '' : 's'} need attention`}
 *
 * So a household with exactly ONE thing to attend to — the most common
 * situation there is — was told:
 *
 *     the Alerts screen's bar     "1 item need attention"
 *     the Dashboard's card        "1 item need attention"
 *
 * "1 item need attention" is not a sentence anyone wrote on purpose, and it
 * is the sentence the household reads at the exact moment the app is telling
 * them to do something.
 *
 * WHY IT IS WORTH A RULE AND NOT A TYPO FIX: the repo has already settled
 * that these are ONE question about one kitchen, answered by one rule.
 * Commit aef0cde ("Count the household's expiring food, not one dish's
 * ingredients") put the shared rule in `itemsExpiringSoon` so the Dashboard
 * and the Meal Plan would call it. Commit e9876dd ("Give the Alerts screen
 * the household's expiring count, not the section's") made the Alerts screen
 * answer the same question the same way. Both fixed the NUMBER. The VERB was
 * left agreeing with a plural in the two places the sentence is written, and
 * it is wrong in exactly the case that is hardest to notice — one item.
 *
 * WHAT IS TESTED HERE
 *
 * The REAL screens — `Alerts.tsx` and `Dashboard.tsx` — bundled with esbuild
 * and rendered against a stubbed store and a stubbed router, exactly the way
 * `test-alerts-expiring-heading.mjs` renders the Alerts screen. Each is
 * asked the same question with ONE thing to attend to and with TWO, and the
 * sentence is read out of the rendered page.
 *
 * WHY THE ANSWER IS READ OUT OF THE RENDERED PAGE AND NOT OUT OF THE
 * SOURCE: the test is about what the person READS. A rule that renders the
 * right words is a pass, however it is written. The source guard at the end
 * is a separate, smaller claim: that the two places are not two copies.
 *
 * Run with:  node scripts/test-attention-count-phrase.mjs
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
  const file = path.join(tmpdir(), `hh-attention-store-${Math.random().toString(36).slice(2)}.mjs`);
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
    stock: ${JSON.stringify(stock)},
    grocery: [],
    mealLogs: [],
    recipes: [],
    mealPlan: undefined,
    settings: ${JSON.stringify(settings)},
    toast() {},
    updateSettings() {},
    addGrocery() {},
    removeGrocery() {},
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
 * no bearing on what a screen says about how many things need attention.
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
  // WHY THE FILE NAME IS RANDOM: node caches a module by its URL, so a
  // second bundle written to the same path would be served from the cache —
  // and the screen would still be the household from the FIRST render.
  const file = path.join(dir, `${path.basename(entry, '.tsx')}-${Math.random().toString(36).slice(2)}.mjs`);
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
    // The quantity is ABOVE the threshold on purpose: a household with one
    // thing about to go off and nothing running low is the household whose
    // every "needs attention" count is exactly one.
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
/* Reading the sentence out of the rendered page                               */
/* -------------------------------------------------------------------------- */

/**
 * The "N item(s) need(s) attention" sentence, as rendered.
 *
 * WHY THE COMMENTS ARE STRIPPED: React's server renderer puts `<!-- -->`
 * between adjacent text nodes, so a sentence built from an expression and a
 * literal arrives as `1<!-- --> item`. Left in, the number and the word are
 * two separate strings and no sentence can be read out of the page.
 *
 * WHY THE VERB IS PART OF THE MATCH: the point of this test is the verb. A
 * reader that only looked for the number would pass the broken sentence.
 *
 * @param {string} html the rendered page
 * @returns {string} the sentence, or '(none)'
 */
function attentionSentence(html) {
  const flat = html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, '');
  const match = flat.match(/(\d+ items? needs? attention)/);
  return match ? match[1] : '(none)';
}

/* -------------------------------------------------------------------------- */
/* The screens, and the households they are asked about                         */
/* -------------------------------------------------------------------------- */

const SCREENS = [
  { entry: 'src/pages/Alerts.tsx', exportName: 'AlertsPage', label: 'the Alerts screen' },
  { entry: 'src/pages/Dashboard.tsx', exportName: 'Dashboard', label: 'the Dashboard' },
];

const settings = {
  userName: 'Test',
  expiringSoonDays: 7,
  dietaryPreference: 'no-preference',
  allergies: [],
  household: { adults: 2, teens: 0, children: 0, toddlers: 0 },
  theme: 'light',
  consents: {},
};

const work = await mkdtemp(path.join(tmpdir(), 'hh-attention-'));
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

console.log('\nONE thing to attend to');
for (const screen of SCREENS) {
  const Component = await screenFor(
    screen.entry,
    screen.exportName,
    [stockItem('a', 'Curdshelf', inDays(2))],
    settings,
    work,
  );
  const sentence = attentionSentence(renderToString(createElement(Component)));

  ok(
    sentence === '1 item needs attention',
    `${screen.label} says "1 item needs attention"`,
    `it says "${sentence}"`,
  );
  ok(
    !sentence.includes('1 item need attention'),
    `${screen.label} does not say "1 item need attention"`,
    `it says "${sentence}"`,
  );
}

console.log('\nTWO things to attend to');
for (const screen of SCREENS) {
  const Component = await screenFor(
    screen.entry,
    screen.exportName,
    [stockItem('a', 'Curdshelf', inDays(2)), stockItem('b', 'Milkpast', inDays(5))],
    settings,
    work,
  );
  const sentence = attentionSentence(renderToString(createElement(Component)));

  ok(
    sentence === '2 items need attention',
    `${screen.label} says "2 items need attention"`,
    `it says "${sentence}"`,
  );
}

console.log('\nONE RULE, NOT TWO COPIES');
{
  // WHY THIS GUARD EXISTS AND WHY IT IS NOT THE MAIN TEST: the assertions
  // above are about the WORDS the person reads, and they pass however the
  // words are produced. This one is about the shape of the fix: the two
  // places that write the sentence must call ONE rule, because two copies
  // of a rule is how the two of them came to disagree in the first place.
  //
  // WHY IT IS A SOURCE GUARD AND NOT A RENDERED ONE: the rule is a
  // sentence, not a number — there is no number to ask the app about. The
  // source is the honest place to make this claim.
  const { readFile } = await import('node:fs/promises');
  for (const file of ['src/pages/Alerts.tsx', 'src/pages/Dashboard.tsx']) {
    const source = await readFile(path.join(REPO, file), 'utf8');
    ok(
      /import \{[^}]*\bformatAttentionCount\b[^}]*\} from '\.\.\/utils\/attention'/.test(source),
      `${file} calls the shared rule`,
      source.includes('formatAttentionCount') ? '' : 'it writes the sentence in its own words',
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
