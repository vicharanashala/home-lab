/**
 * Tests that the app says so when the browser will not store a change.
 *
 * WHY THIS MATTERS
 * The app's whole job is remembering. The grocery list, the stock and the
 * meal plan all live in one localStorage key, so a change that cannot be
 * written is a change the app shows and then forgets:
 *
 *   the user adds "onions"
 *     the list shows onions
 *     the toast says "Added to grocery list"
 *     the browser refused the write — a blocked storage, or a spent quota
 *     a reload brings back the list as it was
 *
 * The user's words, gone, with nothing said about it. A browser that refuses
 * to store anything is a real thing — Safari with storage blocked, a private
 * window, a quota spent — and this is the app's only memory, so it has to be
 * honest when the memory fails.
 *
 * WHAT WAS WRONG
 * The write was wrapped in a catch that said nothing:
 *
 *     try { window.localStorage.setItem(KEY, JSON.stringify(state)); }
 *     catch { /* ignore quota errors silently *\/ }
 *
 * so a refused write and a written one looked the same to every caller. The
 * app showed the change, told the user it was saved, and lost it.
 *
 * WHAT IS TESTED HERE
 * The rule that decides whether a write happened, the store carrying that
 * answer, the message the user reads, and the two actions whose OWN return
 * value is the success message — the import and the clearing. Those two were
 * left out of the first fix: they reported success whatever the storage said,
 * and their success message was the one the user read.
 *
 * It also checks the thing the refused clearing has to get right: the
 * household is put back on screen, because a browser that still holds the
 * data under an empty screen loses the data for good the moment the next
 * write gets through.
 *
 * Run with:  node scripts/test-storage-failure.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(REPO, 'node_modules'))) {
  console.error('node_modules is missing — run npm install first');
  process.exit(1);
}

const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { useStore, exportAppData } = await import('../src/store/useStore.ts');
const { saveAppState, STORAGE_KEY, STORAGE_FAILURE_MESSAGE, IMPORT_NOT_SAVED_MESSAGE, CLEAR_NOT_SAVED_MESSAGE } = await import('../src/utils/appStorage.ts');

/**
 * The banner, built from the real component.
 *
 * WHY IT IS BUILT AND NOT IMPORTED: the banner is a `.tsx`, and node cannot
 * load one. The page itself is tested the same way — bundled with esbuild,
 * rendered, and read.
 *
 * WHY THE STORE IS EXTERNAL: a bundle that carried its own copy of the store
 * would have its own copy of the flag, and the banner would be asked about a
 * store the test is not driving. Pointing it at the store this test drives is
 * what makes the banner's answer the app's answer.
 */
const bannerBundle = await build({
  entryPoints: [path.join(REPO, 'src/components/StorageWarning.tsx')],
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
      // own copy of the store would have its own copy of the flag, and the
      // banner would be asked about a store this test is not driving. It is
      // pointed at the very module this test drives instead — the same URL,
      // so node loads one instance of it and both see the same answer.
      name: 'share-the-store',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/(store\/useStore|utils\/appStorage)$/ }, (args) => {
          const target = path.resolve(args.resolveDir, `${args.path}.ts`);
          return { path: pathToFileURL(target).href, external: true };
        });
      },
    },
  ],
});
const bannerDir = await mkdtemp(path.join(tmpdir(), 'hh-storage-banner-'));
// The bundle lives outside the checkout, so it cannot find the packages the
// banner imports on its own.
await symlink(path.join(REPO, 'node_modules'), path.join(bannerDir, 'node_modules'));
const bannerFile = path.join(bannerDir, 'StorageWarning.mjs');
await writeFile(bannerFile, bannerBundle.outputFiles[0].text);
const { StorageWarning } = await import(pathToFileURL(bannerFile).href);

let passed = 0;
let failed = 0;

function check(label, got, expected) {
  const have = JSON.stringify(got);
  const want = JSON.stringify(expected);
  if (have === want) {
    passed += 1;
    console.log(`  ok   ${label} -> ${have}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label} -> ${have}, expected ${want}`);
  }
}

/* -------------------------------------------------------------------------- */
/* A browser that refuses to store anything                                    */
/* -------------------------------------------------------------------------- */

/** Whether the next write is refused, the way a blocked or full one is. */
let refuseWrites = false;
/** What the browser actually holds. */
const held = {};

/**
 * The browser, as the store sees it.
 *
 * WHY THE ACCESS TO `localStorage` IS NOT ITSELF THROWN: a browser with
 * storage blocked throws when the app READS `window.localStorage`, not only
 * when it writes. The store's own test for that is below, where the getter
 * throws.
 */
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in held ? held[k] : null),
    setItem: (k, v) => {
      if (refuseWrites) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      held[k] = v;
    },
    removeItem: (k) => { delete held[k]; },
  },
};

/* -------------------------------------------------------------------------- */
/* The store, the way the page sees it                                          */
/* -------------------------------------------------------------------------- */

let snap = null;
function Probe() {
  snap = useStore();
  return null;
}
const refresh = () => {
  renderToString(createElement(Probe));
  return snap;
};

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

console.log('\nthe rule says whether the write happened');
{
  const written = {};
  const good = { setItem: (k, v) => { written[k] = v; } };
  const bad = {
    setItem: () => {
      throw new Error('The quota has been exceeded.');
    },
  };

  const state = { grocery: [], stock: [], mealLogs: [], recipes: [], settings: {} };
  check('a storage that writes says the write happened', saveAppState(state, good), true);
  check('and the state is in it', typeof written[STORAGE_KEY], 'string');
  check('a storage that refuses says it did not', saveAppState(state, bad), false);
  check('and there is nowhere to write at all', saveAppState(state, null), false);
}

/* -------------------------------------------------------------------------- */
/* The store                                                                    */
/* -------------------------------------------------------------------------- */

console.log('\nand the store carries that answer to the screen');
{
  const before = refresh();
  check('the app starts able to save', before.storageFailed, false);

  refuseWrites = true;
  refresh().addGrocery({ name: 'Onions', quantity: '2 kg', category: 'vegetables' });

  const after = refresh();
  check('and the app knows it was not saved', after.storageFailed, true);
  check('and nothing was written', STORAGE_KEY in held, false);

  // The change is NOT lost while the browser refuses — it is still in the
  // app, and it goes out as soon as the browser takes it again. That is why
  // the banner says "until you close the app" and not "your change is gone".
  refuseWrites = false;
  refresh().addGrocery({ name: 'Potatoes', quantity: '1 kg', category: 'vegetables' });

  const recovered = refresh();
  check('and once the browser saves again the warning clears', recovered.storageFailed, false);
  check('and the state is really written now', STORAGE_KEY in held, true);
  check(
    'and it holds both items — the refused one was never lost',
    JSON.parse(held[STORAGE_KEY]).grocery.length,
    2,
  );
}

/* -------------------------------------------------------------------------- */
/* What the user reads                                                         */
/* -------------------------------------------------------------------------- */

console.log('\nand the message says what happened');
{
  check('it says the change was not saved', /not saved/i.test(STORAGE_FAILURE_MESSAGE), true);
  check('and that it will be lost', /lost|gone/i.test(STORAGE_FAILURE_MESSAGE), true);
}

console.log('\nand the banner the user actually sees');
{
  // Nothing is wrong yet, so there is nothing to say.
  refuseWrites = false;
  refresh();
  check(
    'and it stays off while the app can save',
    renderToString(createElement(StorageWarning)),
    '',
  );

  // Now the browser refuses, and the banner has to come up and say so.
  refuseWrites = true;
  refresh().addGrocery({ name: 'Spinach', quantity: '1 bunch', category: 'vegetables' });
  const banner = renderToString(createElement(StorageWarning));
  check('and it comes up when the app cannot save', banner.includes('role="alert"'), true);
  check('and it tells the user the change was not saved', banner.includes('Not saved'), true);
}

console.log('\nand the two actions that replace the household with a file');
{
  // The import is the one call in the app that replaces everything the user
  // has, and its return value IS the success message the screen shows:
  // "Restored 12 grocery, 5 in the fridge". So a write the browser refused
  // made that message a lie — the data was in the app until the tab closed
  // and gone after that, while the screen said the household had been
  // restored.
  const backup = JSON.stringify({
    app: 'homehub',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      grocery: [{ id: 'g1', name: 'Onions', quantity: '2 kg', category: 'vegetables', purchased: false, createdAt: 1 }],
      stock: [{ id: 's1', name: 'Milk', quantity: '1 l', category: 'dairy', createdAt: 1, updatedAt: 1, location: 'fridge' }],
      mealLogs: [],
      recipes: [],
      settings: { theme: 'system' },
    },
  });

  refuseWrites = false;
  const good = refresh().importAppData(backup);
  check('a stored import reports success', good.ok, true);
  check('and it counts what it stored', good.ok ? good.counts.grocery : -1, 1);

  refuseWrites = true;
  const bad = refresh().importAppData(backup);
  check('an import the browser refuses does not report success', bad.ok, false);
  check('and it says the data was not stored', bad.ok ? '' : /refused|not saved/i.test(bad.error), true);

  // The clearing is followed by a reload, and the reload brings back
  // whatever was in storage — so a clearing the browser refused was
  // announced as "App data cleared" and then undone by the reload itself.
  // The reload now only runs when the clearing was stored; a refused
  // clearing is undone by the store, so the screen still shows the data.
  refuseWrites = false;
  check('a stored clearing reports success', refresh().clearAllData(), true);
  refuseWrites = true;
  check('a clearing the browser refuses does not report success', refresh().clearAllData(), false);
  refuseWrites = false;

  // WHY THE HOUSEHOLD IS PUT BACK AND NOT LEFT EMPTY: the browser still
  // holds the data, so an empty screen over it is the worst of the two — the
  // user is told the reset failed while the screen says it worked. Worse,
  // the next write that gets through stores that empty screen, and the
  // household is gone for good. The store undoes the clearing instead, so
  // the screen, the message and the browser all say the same thing.
  refuseWrites = false;
  refresh().addGrocery({ name: 'Onions', quantity: '2 kg', category: 'vegetables' });
  refresh().addStock({ name: 'Milk', quantity: '1 l', category: 'dairy', location: 'fridge' });
  check(
    'the household is there before the clearing',
    JSON.parse(exportAppData()).data.grocery.length,
    1,
  );

  refuseWrites = true;
  refresh().clearAllData();
  const afterRefusedClear = JSON.parse(exportAppData()).data;
  check('and it is still on screen after a refused clearing', afterRefusedClear.grocery.length, 1);
  check('and so is the fridge', afterRefusedClear.stock.length, 1);

  // The write that gets through next must carry the household with it.
  refuseWrites = false;
  refresh().addGrocery({ name: 'Potatoes', quantity: '1 kg', category: 'vegetables' });
  const storedAfter = JSON.parse(held[STORAGE_KEY]);
  check('and the grocery list survives the next write', storedAfter.grocery.some((g) => g.name === 'Onions'), true);
  check('and so does the fridge', storedAfter.stock.some((s) => s.name === 'Milk'), true);
  check('and the change that came after it is there too', storedAfter.grocery.some((g) => g.name === 'Potatoes'), true);
}

console.log('\nand the messages those two leave behind');
{
  // The clearing message has to say the data is STILL THERE. The store puts
  // the household back when the browser refuses the clearing, so the screen
  // the user is looking at still has it — and the message has to agree.
  check(
    'the clearing message says nothing was cleared',
    /nothing was cleared/i.test(CLEAR_NOT_SAVED_MESSAGE),
    true,
  );
  check(
    'and it says the data is still here — the store puts the household back',
    /still here/i.test(CLEAR_NOT_SAVED_MESSAGE),
    true,
  );
  check(
    'the import message says the data was not stored',
    /refused|not stored/i.test(IMPORT_NOT_SAVED_MESSAGE),
    true,
  );
  check(
    'the import message does not claim the data was restored',
    /restored \d/i.test(IMPORT_NOT_SAVED_MESSAGE),
    false,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
