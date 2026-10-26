/**
 * The store viewer shows the shopping list beside the store.
 *
 * THE DEFECT THIS IS ABOUT
 * The Digital stores page says: "Tap a store to open it inside HomeHub, with
 * your list beside you." The store viewer is the screen that sentence is
 * about — tapping a store takes the owner there. The viewer had no shopping
 * list in it at all, so the promise was false on the one screen it was made
 * for: the owner tapped a store and the list they were reading vanished.
 *
 * The commit that brought the viewer in said the same thing about the intent:
 * "a frame puts it beside the shopping list". The frame was beside nothing.
 *
 * WHY THIS TEST RENDERS THE REAL COMPONENTS
 * A test that only read the source would pass on a component that renders the
 * list somewhere the user cannot see it. So the two real screens are rendered
 * with react-dom/server and the MARKUP is read — the frame and the list have
 * to be in the same render, and the list has to be the same list on both
 * screens.
 *
 * WHY THE STORE IS PATCHED
 * The store's server snapshot is the seed state, whose grocery list is empty,
 * so an unpatched render can only prove the empty-state message is there. The
 * snapshot is patched to carry one real item, so the test can prove the item
 * the owner sees on the stores page is the item the owner sees with the store
 * open. If the marker moves, this test fails loudly rather than quietly
 * testing nothing.
 *
 * Run with:  node scripts/test-store-viewer-list.mjs
 */
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter, Route, Routes } = await import('react-router-dom');

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

/** The item the owner has on their list, as the store's snapshot carries it. */
const GROCERY_ITEM = {
  id: 'g-test-paneer',
  name: 'Paneer',
  quantity: '200 g',
  category: 'dairy',
  purchased: false,
  createdAt: 1,
};

const work = await mkdtemp(path.join(tmpdir(), 'hh-store-viewer-list-'));
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'));

const entry = path.join(work, 'entry.ts');
await writeFile(
  entry,
  [
    `export { StoreViewer } from ${JSON.stringify(path.join(REPO, 'src/components/StoreViewer.tsx'))};`,
    `export { DigitalStoresPage } from ${JSON.stringify(path.join(REPO, 'src/pages/DigitalStores.tsx'))};`,
  ].join('\n'),
);

const bundled = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  jsx: 'automatic',
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom/server',
    'lucide-react',
    'clsx',
    'react-router-dom',
  ],
});

const bundleText = bundled.outputFiles[0].text;

// WHY THE SNAPSHOT IS PATCHED RATHER THAN THE LIST SEEDED: the store's server
// snapshot is frozen at module load, and it is the seed state — whose grocery
// list is empty. Seeding the live store would not reach a server render.
const marker = 'app: seedState(),';
const patched = bundleText.replace(
  marker,
  `app: { ...seedState(), grocery: [${JSON.stringify(GROCERY_ITEM)}] },`,
);
if (patched === bundleText) {
  console.error(
    "harness: the store's server snapshot moved — this test needs updating",
  );
  process.exit(1);
}

const bundleFile = path.join(work, 'bundle.mjs');
await writeFile(bundleFile, patched);
const { StoreViewer, DigitalStoresPage } = await import(pathToFileURL(bundleFile).href);

/** The store viewer, as the owner sees it after tapping a store. */
function renderViewer() {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: ['/digital-stores/jiomart'] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/digital-stores/:storeId',
          element: createElement(StoreViewer),
        }),
      ),
    ),
  );
}

/** The stores page, which the promise is written on. */
function renderStoresPage() {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: ['/digital-stores'] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/digital-stores',
          element: createElement(DigitalStoresPage),
        }),
      ),
    ),
  );
}

// The server renderer warns about useLayoutEffect, which the router and the
// top bar use. It says nothing about what is tested here.
const realError = console.error;
console.error = (...args) => {
  if (String(args[0] ?? '').includes('useLayoutEffect does nothing on the server')) return;
  realError(...args);
};

console.log('\nthe store viewer shows the store');
{
  const html = renderViewer();
  ok(
    html.includes('/store-viewer/www.jiomart.com'),
    'the store is framed inside HomeHub',
    html.includes('/store-viewer/www.jiomart.com') ? 'src="/store-viewer/www.jiomart.com/"' : 'no viewer src',
  );
}

console.log('\nthe store viewer shows the shopping list beside it');
{
  const html = renderViewer();
  ok(
    html.includes('Shopping list'),
    'the shopping list panel is on the screen',
  );
  ok(
    html.includes(GROCERY_ITEM.name),
    'the list carries the item the owner has',
    GROCERY_ITEM.name,
  );
  // WHY THE PHRASE AND NOT THE COUNT: the count and the word are separate
  // text nodes, and the server renderer puts a comment between them. The
  // phrase is only there when the list HAS something to buy, which is what
  // makes this a check on a populated list rather than an empty one.
  ok(
    html.includes('to buy'),
    'the list counts what is still to buy, so it is the populated list',
  );
  // The frame and the list have to be in the SAME render: a list on the
  // screen behind the store is not beside it.
  ok(
    html.indexOf('/store-viewer/www.jiomart.com') !== -1 &&
      html.indexOf(GROCERY_ITEM.name) !== -1 &&
      html.indexOf('/store-viewer/www.jiomart.com') < html.indexOf(GROCERY_ITEM.name),
    'the store comes first and the list follows it, side by side',
  );
}

console.log('\nboth screens show the same list');
{
  const viewer = renderViewer();
  const page = renderStoresPage();
  ok(
    page.includes(GROCERY_ITEM.name),
    'the stores page carries the same item',
  );
  ok(
    page.includes(GROCERY_ITEM.quantity),
    'and the same quantity',
    GROCERY_ITEM.quantity,
  );
  ok(
    viewer.includes(GROCERY_ITEM.quantity),
    'the viewer carries the same quantity too',
  );
}

console.log('\nthe promise on the stores page is backed by the screen it points at');
{
  const page = renderStoresPage();
  ok(
    page.includes('with your list beside you'),
    'the stores page still says the list is beside you',
  );
  const viewer = renderViewer();
  ok(
    viewer.includes(GROCERY_ITEM.name),
    'and the screen it points at really has the list',
  );
}

await rm(work, { recursive: true, force: true });
console.error = realError;
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
