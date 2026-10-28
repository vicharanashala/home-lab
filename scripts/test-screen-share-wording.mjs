/**
 * The words the person reads must describe what the browser is actually asked.
 *
 * THE BUG
 *
 * Commit 8f89da9 ("Ask for the whole window, not one tab") changed the
 * surface the app asks the browser for:
 *
 *     src/utils/screenWatch.ts
 *       export const SHARE_SURFACE = 'window';   // was 'browser'
 *
 * The hint the person reads while the picker is open was changed with it:
 *
 *     'Chrome will ask whether you want to share your entire window. …'
 *
 * But the OTHER promises the app makes were not changed. The stores screen
 * still said:
 *
 *     "asks whether HomeHub may share the tab"      (the consent paragraph)
 *     "HomeHub will then be able to answer questions about what is on that tab."
 *     "Sharing the {store} tab"                     (the running-share line)
 *
 * and House Bot's chip still said:
 *
 *     "I can see your {store} tab"
 *
 * So the person was told, in four places, that the app shares a TAB — and
 * then Chrome asked them to share an entire WINDOW. The consent paragraph is
 * the worst of them: it is the sentence that says what is about to be shared,
 * and it understated what the browser was about to capture. A window holds
 * every tab in it, including the person's banking and their messages.
 *
 * WHY A WINDOW IS NOT THE SAME WORD AS A TAB: the whole point of the change
 * was that the store's page and House Bot's own tab sit side by side, so the
 * question can be asked while the thing being asked about is still in view.
 * The capture is of the WINDOW. "Tab" is simply a different, smaller thing,
 * and saying it is a promise the app does not keep.
 *
 * WHAT IS TESTED HERE
 *
 * The REAL `DigitalStores.tsx`, bundled with esbuild and driven against a
 * stubbed store, a stubbed router and a stubbed share hook — the same way
 * `test-stock-expiry-filters.mjs` drives the real Stock screen. The test
 * renders the screen in the three states a person sees the share in:
 *
 *   1. nothing is shared yet — the consent paragraph;
 *   2. the picker is open — the hint;
 *   3. the share is running — the line that names what is being shared;
 *
 * and asks each one the same question: does it describe a WINDOW?
 *
 * It also asks the app's OWN `SHARE_SURFACE` what the app asks the browser
 * for, and demands the words agree with it. A restated rule would only prove
 * that the restatement agrees with itself — so the rule comes from the same
 * constant the app hands to `getDisplayMedia`.
 *
 * AND THE HOUSE BOT CHIP: House Bot is far too large to render in a node
 * test, so its wording is checked through the shared helper it renders, and
 * a source guard makes sure neither screen has grown a copy of the wording
 * of its own — a copy is how the two drifted apart in the first place.
 *
 * Run with:  node scripts/test-screen-share-wording.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');

const { SHARE_SURFACE } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/screenWatch.ts')).href
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
/* The stubs                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The store, as a stub the stores screen can be handed.
 *
 * WHY A STUB: the real store's SERVER snapshot is frozen seed state, so the
 * household under test could never reach the screen through it.
 *
 * @param {string} file where to write the stub
 */
async function stubStore(file) {
  await writeFile(
    file,
    `export function useStore() {
  return {
    grocery: [],
    stock: [],
    mealLogs: [],
    recipes: [],
    settings: { userName: '', expiringSoonDays: 3, dietaryPreference: 'no-preference', allergies: [] },
    toast() {},
    addGrocery() {},
    toggleGroceryPurchased() {},
    removeGrocery() {},
    clearPurchased() {},
    addStock() {},
    updateStock() {},
    updateSettings() {},
  };
}
`,
  );
}

/**
 * The router, as a stub.
 *
 * @param {string} file where to write the stub
 */
async function stubRouter(file) {
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
export function useParams() { return {}; }
export function Route() { return null; }
export function Routes({ children }) { return children; }
export function BrowserRouter({ children }) { return children; }
`,
  );
}

/**
 * The share hook, as a stub the test can put into any state.
 *
 * WHY A STUB AND NOT THE REAL HOOK: the real hook asks the browser for a
 * capture, and this test is about the WORDS the app shows around that
 * question, not about the asking. The real hook is tested by
 * `test-screen-share.mjs`, which asks the browser the question the browser
 * answers.
 *
 * @param {string} file where to write the stub
 */
async function stubScreenWatch(file) {
  await writeFile(
    file,
    `export const shareState = {
  watching: false,
  label: null,
  error: null,
  asking: false,
  sentFrame: false,
};
export function __setShareState(next) { Object.assign(shareState, next); }
export function useScreenSharer() {
  return {
    state: shareState,
    start: async () => false,
    stop: () => {},
  };
}
`,
  );
}

/* -------------------------------------------------------------------------- */
/* The real stores screen                                                      */
/* -------------------------------------------------------------------------- */

const tapShim = path.join(REPO, 'scripts/lib/react-tap-state.mjs');
const work = await mkdtemp(path.join(tmpdir(), 'hh-share-wording-'));
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

const storeStub = path.join(work, 'store-stub.mjs');
const routerStub = path.join(work, 'router-stub.mjs');
const watchStub = path.join(work, 'watch-stub.mjs');
await stubStore(storeStub);
await stubRouter(routerStub);
await stubScreenWatch(watchStub);

const bundle = await build({
  entryPoints: [path.join(REPO, 'src/pages/DigitalStores.tsx')],
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
      // WHY THE STORE, THE ROUTER AND THE SHARE HOOK ARE PULLED OUT OF THE
      // BUNDLE: a bundle that carried its own copy of the store would have
      // its own copy of the household, and the words on the screen would be
      // asked about a household this test is not driving.
      name: 'stub-the-store-router-and-share-hook',
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
        b.onResolve({ filter: /hooks\/useScreenWatch$/ }, () => ({
          path: pathToFileURL(watchStub).href,
          external: true,
        }));
      },
    },
  ],
});

const screenFile = path.join(work, 'DigitalStores.mjs');
await writeFile(screenFile, bundle.outputFiles[0].text);
const { DigitalStoresPage } = await import(pathToFileURL(screenFile).href);
const tap = await import(pathToFileURL(tapShim).href);
const watch = await import(pathToFileURL(watchStub).href);

/* -------------------------------------------------------------------------- */
/* Driving the screen                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One render of the screen.
 *
 * @returns {object} the element tree
 */
const render = () => {
  tap.beginRender();
  return DigitalStoresPage();
};

/**
 * The visible text of a tree of elements.
 *
 * @param {object} node a node of the tree
 * @returns {string} the text the person reads
 */
function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

/**
 * The words on the screen that say a TAB is what is being shared.
 *
 * WHY THESE PATTERNS AND NOT "does the word tab appear": the word "tab" is
 * CORRECT in two places on this screen — "Open House Bot in a tab of its own"
 * and "Open House Bot in a new tab" — because House Bot really does live in
 * a tab of its own. What is wrong is a sentence that says the SHARE is a
 * tab, and that is what these patterns look for.
 *
 * WHY THE PATTERNS ARE WRITTEN OUT RATHER THAN GUESSED: "shares the tab",
 * "Sharing the {store} tab" and "I can see your {store} tab" are three
 * different sentences about the same false promise, and the fix had to
 * cover all three.
 *
 * @param {string} text the visible text
 * @returns {string[]} the claims, each a short piece of the text
 */
const TAB_CLAIM_PATTERNS = [
  /share the tab\b/i,
  /\bsharing\b[^]{0,40}?\btab\b/i,
  /\bsee\s+(?:your|the)\b[^]{0,60}?\btab\b/i,
  /\bon that tab\b/i,
];

function tabClaims(text) {
  const claims = [];
  for (const pattern of TAB_CLAIM_PATTERNS) {
    const m = pattern.exec(text);
    if (m) claims.push(text.slice(Math.max(0, m.index - 10), m.index + m[0].length + 10).replace(/\s+/g, ' '));
  }
  return claims;
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

console.log('\nwhat the app asks the browser for');
{
  ok(
    SHARE_SURFACE === 'window',
    'the app asks the browser for a WINDOW',
    `SHARE_SURFACE is "${String(SHARE_SURFACE)}"`,
  );
}

console.log('\nthe stores screen before anything is shared');
{
  tap.resetState();
  watch.__setShareState({
    watching: false,
    label: null,
    error: null,
    asking: false,
    sentFrame: false,
  });
  const text = textOf(render());

  const claims = tabClaims(text);
  ok(
    claims.length === 0,
    'the consent paragraph does not say a TAB is being shared',
    claims.length ? `it says: ${claims.join(' / ')}` : 'it names a window',
  );
  ok(
    /window/i.test(text),
    'and it names a WINDOW',
    'the paragraph says what the browser is about to be asked for',
  );
}

console.log('\nthe stores screen while the browser picker is open');
{
  tap.resetState();
  watch.__setShareState({
    watching: false,
    label: 'Amazon Fresh',
    error: null,
    asking: true,
    sentFrame: false,
  });
  const text = textOf(render());

  const claims = tabClaims(text);
  ok(
    claims.length === 0,
    'the hint does not say a TAB is being shared',
    claims.length ? `it says: ${claims.join(' / ')}` : 'it names a window',
  );
  ok(
    /window/i.test(text),
    'and it names a WINDOW',
  );
}

console.log('\nthe stores screen while the share is running');
{
  tap.resetState();
  watch.__setShareState({
    watching: true,
    label: 'Amazon Fresh',
    error: null,
    asking: false,
    sentFrame: true,
  });
  const text = textOf(render());

  const claims = tabClaims(text);
  ok(
    claims.length === 0,
    'the running-share line does not say a TAB is being shared',
    claims.length ? `it says: ${claims.join(' / ')}` : 'it names a window',
  );
  ok(
    /window/i.test(text),
    'and it names a WINDOW',
  );
}

console.log('\nthe House Bot chip, through the wording it renders');
{
  // House Bot is far too large to render in a node test, so its chip is
  // checked through the helper it renders — and the source guard below makes
  // sure the chip really does render that helper rather than a copy of it.
  const helper = await import(
    pathToFileURL(path.join(REPO, 'src/utils/screenWatch.ts')).href
  );
  const visible = helper.shareVisibleText
    ? helper.shareVisibleText('Amazon Fresh')
    : '';
  ok(
    visible !== '',
    'House Bot has ONE piece of wording for what it can see',
    'src/utils/screenWatch.ts exports shareVisibleText',
  );
  ok(
    visible !== '' && !/tab/i.test(visible),
    'and it does not tell the person it can see a TAB',
    visible ? `it says: "${visible}"` : 'no wording to check',
  );
  ok(
    visible !== '' && /window/i.test(visible),
    'it names a WINDOW',
    visible ? `it says: "${visible}"` : 'no wording to check',
  );
}

console.log('\nneither screen has grown a copy of the wording');
{
  // WHY THIS IS A SOURCE GUARD AND NOT A RENDER: a copy of the wording is
  // exactly how the two drifted apart. The person reads one sentence here
  // and another there, and one of them is about the wrong thing.
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  // House Bot is too large to render in a node test, but it has exactly ONE
  // non-comment use of the word "tab" — the chip that was wrong. There must
  // not be another one, and the chip must come from the shared wording.
  const houseBot = stripComments(await readFile(path.join(REPO, 'src/pages/HouseBot.tsx'), 'utf8'));
  const houseBotTabs = (houseBot.match(/\btabs?\b/gi) ?? []).length;
  ok(
    houseBotTabs === 0,
    'House Bot never tells the person it can see a TAB',
    `House Bot says "${houseBotTabs === 0 ? 'a window' : houseBotTabs + ' times it says tab'}"`,
  );
  ok(
    /shareVisibleText\(/.test(houseBot),
    'and its chip comes from the shared wording, not a copy of its own',
  );

  // The stores screen keeps TWO correct uses of the word "tab" — House Bot
  // really does live in a tab of its own — so there the guard is that the
  // three promises it makes come from the shared wording.
  const stores = stripComments(await readFile(path.join(REPO, 'src/pages/DigitalStores.tsx'), 'utf8'));
  for (const helper of ['SHARE_ASKING_TEXT', 'SHARE_CONSENT_TEXT', 'shareRunningText']) {
    ok(
      new RegExp('\\b' + helper + '\\b').test(stores),
      `the stores screen renders ${helper} rather than a copy of the wording`,
    );
  }
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
