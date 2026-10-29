/**
 * Regression test: the stores screen must not claim the store's tab opened
 * when the browser refused to open it.
 *
 * THE BUG
 *
 * The stores screen says one thing about the store's tab, and it says it
 * whatever the browser actually did:
 *
 *     src/pages/DigitalStores.tsx
 *
 *         {share.state.error} The store still opened.
 *
 * The browser's popup blocker decides that sentence's truth, and the app
 * never asked it:
 *
 *     the person pressed the store    the gesture starts
 *     the person picks a window       ... five seconds, or ten, or a minute
 *     the browser answers             the gesture is gone
 *     the store's tab opens           the browser stops it
 *
 * A pop-up is only allowed while the page still holds the person's gesture —
 * about five seconds in Chrome, about one in Safari. The store's tab is
 * opened AFTER the capture picker has been answered, because the tab has to
 * open after the ask (opening it first hid this page and the picker never
 * appeared). So the tab the person pressed the store for is the tab the
 * browser takes away, and the screen says it opened.
 *
 * And `window.open` cannot report it: this app passes `noopener`, so the
 * browser returns null whether the tab opened or not. The one thing that
 * does report it is the activation itself — `navigator.userActivation`.
 *
 * THE FIX
 *
 * - `popUpAllowedNow()` asks the browser whether the gesture is still live.
 * - `openStoreTab()` asks BEFORE opening, because `window.open` CONSUMES the
 *   activation — asking afterwards would say "blocked" every time.
 * - The page records a refused tab and `StoreTabNotice` says so, and offers
 *   the store as a LINK: a link the person clicks is a navigation the browser
 *   always allows, so the store is one click away even when the automatic tab
 *   was refused.
 *
 * WHAT IS TESTED HERE
 *
 *   - the REAL rule, asked whether a pop-up may open;
 *   - the REAL opener, asked whether it opened the tab and what it says;
 *   - the REAL notice, rendered, so the words the person reads are the ones
 *     this test checks;
 *   - the REAL page, read, so the sentence that could not be true is gone.
 *
 * Run with:  node scripts/test-store-tab-notice.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpWorkDir } from './lib/tmp-work.mjs';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const screenWatch = await import(pathToFileURL(path.join(REPO, 'src/utils/screenWatch.ts')).href);

// WHY THE NAMESPACE AND NOT THE NAMES: this test has to be runnable against
// code that does not have the fix yet, and a rule that is not there has to
// come back as a FAILURE and not as a crash — otherwise "the test is red
// before the fix" cannot be shown at all.
const popUpAllowedNow = screenWatch.popUpAllowedNow;
const openStoreTab = screenWatch.openStoreTab;
const STORE_TAB_OPENED_TEXT = screenWatch.STORE_TAB_OPENED_TEXT ?? 'The store opened in a new tab.';
const STORE_TAB_BLOCKED_TEXT = screenWatch.STORE_TAB_BLOCKED_TEXT ?? 'Your browser blocked the store tab.';

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

/**
 * Give the app a browser with a gesture that is alive, or one that is spent.
 *
 * @param {boolean | null} isActive the gesture, or null for a browser that
 *   has no user-activation API at all
 * @param {boolean} openThrows whether the browser refuses the pop-up by
 *   throwing rather than by blocking it
 */
function fakeBrowser(isActive, openThrows = false) {
  const opened = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value:
      isActive === null
        ? {}
        : { userActivation: { isActive, hasBeenActive: true } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      open(url) {
        if (openThrows) throw new Error('SecurityError: the popup was refused');
        opened.push(url);
        return null;
      },
    },
  });
  return opened;
}

/**
 * The real `StoreTabNotice`, bundled so it can be rendered.
 *
 * @returns {Promise<Function>} the component
 */
async function noticeComponent() {
  const bundle = await build({
    entryPoints: [path.join(REPO, 'src/components/StoreTabNotice.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
  });
  const dir = tmpWorkDir('hh-store-tab-notice-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  const file = path.join(dir, 'StoreTabNotice.mjs');
  await writeFile(file, bundle.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return mod.StoreTabNotice;
}

console.log('\nthe browser decides whether a pop-up may open');

fakeBrowser(true);
ok(
  typeof popUpAllowedNow === 'function' && popUpAllowedNow() === true,
  'a live gesture lets the pop-up open',
);

fakeBrowser(false);
ok(
  typeof popUpAllowedNow === 'function' && popUpAllowedNow() === false,
  'a spent gesture means the browser stops it',
);

fakeBrowser(null);
ok(
  typeof popUpAllowedNow === 'function' && popUpAllowedNow() === true,
  'a browser with no user-activation API is not told otherwise',
);

console.log('\nand the store tab is opened, and reported');

{
  const opened = fakeBrowser(true);
  const allowed = typeof openStoreTab === 'function' ? openStoreTab('https://example.test/store') : false;
  ok(opened.length === 1 && opened[0] === 'https://example.test/store', 'the tab is opened');
  ok(allowed === true, 'and the app may say it opened');
}

{
  // WHY THE TAB IS OPENED ANYWAY: some browsers do not block at all, and a
  // tab that opens is what the person asked for. The answer is about what to
  // SAY, not about whether to try.
  const opened = fakeBrowser(false);
  const allowed = typeof openStoreTab === 'function' ? openStoreTab('https://example.test/store') : true;
  ok(opened.length === 1, 'the tab is opened even when the browser will stop it');
  ok(allowed === false, 'and the app knows not to say it opened');
}

{
  // WHY A POP-UP THE BROWSER THREW ON IS A REFUSED TAB: a browser that
  // refuses a pop-up does not always do it by blocking it — a sandboxed
  // frame, a policy — and then it throws. The app cannot open the tab
  // another way, so the tab did not open, and the person is owed the truth.
  //
  // The exception used to escape `openStoreTab` and be swallowed by the
  // share hook, whose own comment says "the popup was blocked". Nothing was
  // recorded, so the screen fell back to the other sentence:
  //
  //     window.open   threw
  //     the tab       did not open
  //     the screen    "The store opened in a new tab."
  //
  // The gesture being live does not make it true — the opener asked the
  // browser, and the browser said no.
  fakeBrowser(true, true);
  let allowed = 'THREW';
  try {
    allowed =
      typeof openStoreTab === 'function'
        ? openStoreTab('https://example.test/store')
        : true;
  } catch {
    allowed = 'THREW';
  }
  ok(
    allowed === false,
    'a pop-up the browser refused by throwing is reported as not opened',
    `got ${allowed}`,
  );
}

console.log('\nand the page says what actually happened');

let StoreTabNotice = null;
try {
  StoreTabNotice = await noticeComponent();
} catch {
  StoreTabNotice = null;
}
ok(
  typeof StoreTabNotice === 'function',
  'the notice the page shows exists',
);
const page = await readFile(path.join(REPO, 'src/pages/DigitalStores.tsx'), 'utf8');

ok(
  !page.includes('The store still opened.'),
  'the sentence the app could not stand behind is gone from the page',
);
ok(
  page.includes('StoreTabNotice'),
  'and the page shows the notice that can',
);

if (StoreTabNotice) {
  {
    const markup = renderToStaticMarkup(
      createElement(StoreTabNotice, {
        error: 'Screen sharing was not allowed.',
        blockedStore: null,
      }),
    );
    ok(markup.includes('Screen sharing was not allowed.'), 'the share error is still shown');
    ok(
      markup.includes(STORE_TAB_OPENED_TEXT),
      'and a tab that opened is said to have opened',
    );
    ok(
      !markup.toLowerCase().includes('blocked'),
      'and nothing is claimed about a tab that did not',
    );
  }

  {
    const markup = renderToStaticMarkup(
      createElement(StoreTabNotice, {
        error: 'Screen sharing was not allowed.',
        blockedStore: { name: 'BigBasket', url: 'https://example.test/store' },
      }),
    );
    ok(markup.includes('Screen sharing was not allowed.'), 'the share error is still shown');
    ok(markup.includes(STORE_TAB_BLOCKED_TEXT), 'and the blocked tab is named as blocked');
    ok(
      !markup.includes(STORE_TAB_OPENED_TEXT),
      'and the page does not claim the tab opened',
    );
    ok(
      markup.includes('href="https://example.test/store"'),
      'and the store is one click away',
    );
    ok(markup.includes('BigBasket'), 'and the link says which store it is');
  }

  {
    // The blocked case with NO error is the common one: the share worked, and
    // the store's tab is the thing that did not open.
    const markup = renderToStaticMarkup(
      createElement(StoreTabNotice, {
        error: null,
        blockedStore: { name: 'BigBasket', url: 'https://example.test/store' },
      }),
    );
    ok(markup.includes(STORE_TAB_BLOCKED_TEXT), 'a blocked tab is said so even without an error');
    ok(markup.includes('href="https://example.test/store"'), 'and the store is one click away');
  }

  {
    const markup = renderToStaticMarkup(
      createElement(StoreTabNotice, { error: null, blockedStore: null }),
    );
    ok(markup === '', 'and nothing is said when nothing went wrong');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
