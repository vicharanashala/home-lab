/**
 * The Alerts screen's expiry window must follow the household, even when the
 * household changes it from somewhere else.
 *
 * THE BUG
 *
 * The Alerts screen is where the household sets the expiry window: the
 * slider at the top of the screen writes `settings.expiringSoonDays`. The
 * list UNDER that same slider reads `settings.expiringSoonDays` to decide
 * what to flag and what to write in its heading ("Nothing expiring in the
 * next 7 days").
 *
 * But the slider's own value did not come from the setting. It came from a
 * local copy that was never brought back in step with it:
 *
 *     const [soonDays, setSoonDays] = useState(settings.expiringSoonDays);
 *
 * The Settings screen has exactly the same draft, and it does keep it in
 * step — with a comment naming the case:
 *
 *     // If external settings change (e.g. another tab), keep draft in sync.
 *     useEffect(() => { setExpiringSoonDays(settings.expiringSoonDays); }, [...]);
 *
 * The Alerts screen has no such effect. So the moment the setting changes
 * underneath a mounted Alerts screen the screen contradicts itself. The
 * household can change it from another tab — the store adopts the whole
 * state another tab wrote — and the Alerts screen in the first tab never
 * hears about it:
 *
 *     the slider reads      3 days
 *     the heading reads    Nothing expiring in the next 7 days
 *
 * and, worse, the screen WRITES the stale number back. The slider's release
 * and blur handlers both write `soonDays`, so the blur that follows any
 * click elsewhere on the screen writes 3 over the household's 7. The
 * household's window is silently reverted, and nothing says so.
 *
 * WHY THIS MATTERS MORE THAN A COSMETIC SLIP: `settings.expiringSoonDays`
 * is the ONE number that decides what the whole app calls "expiring soon".
 * The Alerts screen, the Dashboard, the Stock screen, the stock rows, the
 * Meal Plan's rescue strip and House Bot's context block all read it. A
 * slider that writes back a number the household no longer has is a
 * household-wide setting being undone by a screen that was only supposed to
 * be showing it.
 *
 * WHAT IS TESTED HERE
 *
 * The REAL component, bundled with esbuild and driven against a stubbed
 * store, the same way `test-spoken-plan-edit.mjs` drives a real component.
 * The stub's setting is changed between renders the way another tab changes
 * it, and the test then asks two questions:
 *
 *   1. does the slider show the window the household now has?
 *   2. does the screen ever write back a window the household no longer has?
 *
 * WHY THE DRAG IS TESTED TOO: the fix must not break the way the household
 * actually sets the window. A person's own drag has to reach the setting,
 * or the screen would have been "fixed" by making the slider inert.
 *
 * Run with:  node scripts/test-alerts-window-sync.mjs
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
/* The store, as a stub the screen can be handed                                */
/* -------------------------------------------------------------------------- */

/**
 * WHY A STUB: `renderToString` reads the store's SERVER snapshot, which is
 * frozen seed state, so the household under test could never reach the
 * screen through the real store. The stub stands in for the store and hands
 * the screen the household under test.
 *
 * WHY THE STUB IS WRITABLE FROM THE TEST: another tab's write reaches this
 * tab through the store, which is exactly what `setWindow` stands for. The
 * stub's `updateSettings` writes back the way the real store does, so the
 * screen sees its own write on the next render.
 */
const stubFile = tmpStubFile('hh-alerts-window-store.mjs');
await writeFile(
  stubFile,
  `let windowDays = 3;

/** Another tab wrote the window. */
export function setWindow(days) {
  windowDays = days;
}

/** Every patch the screen has written. */
export const writes = [];

export function useStore() {
  return {
    stock: [],
    grocery: [],
    settings: {
      expiringSoonDays: windowDays,
      userName: '',
      dietaryPreference: 'no-preference',
      allergies: [],
    },
    updateSettings(patch) {
      writes.push(patch);
      if (typeof patch.expiringSoonDays === 'number') {
        windowDays = patch.expiringSoonDays;
      }
    },
    addGrocery() {
      return {};
    },
    toast() {},
  };
}
`,
);

const store = await import(pathToFileURL(stubFile).href);

/* -------------------------------------------------------------------------- */
/* The screen, built from the real component                                    */
/* -------------------------------------------------------------------------- */

const work = tmpWorkDir('hh-alerts-window-');
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

const tapShim = path.join(REPO, 'scripts/lib/react-tap-state.mjs');

const bundle = await build({
  entryPoints: [path.join(REPO, 'src/pages/Alerts.tsx')],
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
    'react-router-dom',
  ],
  plugins: [
    {
      name: 'alerts-harness',
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
          path: pathToFileURL(stubFile).href,
          external: true,
        }));
      },
    },
  ],
});

const screenFile = path.join(work, 'Alerts.mjs');
await writeFile(screenFile, bundle.outputFiles[0].text);
const { AlertsPage } = await import(pathToFileURL(screenFile).href);
const tap = await import(pathToFileURL(tapShim).href);

/* -------------------------------------------------------------------------- */
/* Driving the screen                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One render of the screen.
 *
 * WHY THE RENDER IS REPEATED BY HAND: the tap keeps the state slots between
 * renders, so calling the screen again is the same mounted screen being
 * re-rendered — which is what happens when the household's setting changes
 * underneath it. A fresh screen would read the new setting into its state
 * and the bug would never show.
 */
const render = () => {
  tap.beginRender();
  return AlertsPage();
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

/** The expiry window slider. */
function sliderIn(tree) {
  let found = null;
  walk(tree, (el) => {
    if (!found && el.type === 'input' && el.props?.type === 'range') found = el;
  });
  return found;
}

/** Whether any element in the tree shows text matching. */
function hasText(tree, re) {
  let found = false;
  walk(tree, (el) => {
    if (!found && re.test(textOf(el.props?.children))) found = true;
  });
  return found;
}

/* -------------------------------------------------------------------------- */
/* The screen opens on the household's window                                   */
/* -------------------------------------------------------------------------- */

console.log('\nthe screen opens on the household window');

{
  tap.resetState();
  store.setWindow(3);
  store.writes.length = 0;

  const tree = render();
  const slider = sliderIn(tree);
  ok(slider !== null, 'the expiry window slider is there');
  ok(slider?.props?.value === 3, 'the slider shows the household window', `value=${slider?.props?.value}`);
  ok(
    hasText(tree, /in the next 3 days/),
    'the heading reads the same window the slider shows',
  );
}

/* -------------------------------------------------------------------------- */
/* Another tab changes the window                                               */
/* -------------------------------------------------------------------------- */

console.log('\nanother tab changes the window under the open screen');

{
  tap.resetState();
  store.setWindow(3);
  store.writes.length = 0;

  render();

  // Another tab of the app writes the window. The store adopts the whole
  // state another tab wrote, so this screen is re-rendered with the new
  // number.
  store.setWindow(7);
  const tree = render();

  const slider = sliderIn(tree);
  ok(
    slider?.props?.value === 7,
    'the slider follows the household when the window changes elsewhere',
    `value=${slider?.props?.value}`,
  );
  ok(
    hasText(tree, /in the next 7 days/),
    'the heading under the slider reads the same window',
  );
}

/* -------------------------------------------------------------------------- */
/* The screen must not write back a window the household no longer has         */
/* -------------------------------------------------------------------------- */

console.log('\nthe screen never writes back a window the household no longer has');

{
  tap.resetState();
  store.setWindow(3);
  store.writes.length = 0;

  render();
  store.setWindow(7);
  const tree = render();

  // The slider loses focus — which is what happens when the person taps
  // anything else on the screen.
  sliderIn(tree)?.props?.onBlur?.();

  const stale = store.writes.filter((w) => w.expiringSoonDays === 3);
  ok(
    stale.length === 0,
    'losing focus does not put the old window back',
    `writes=${JSON.stringify(store.writes)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* The household's own drag still reaches the setting                           */
/* -------------------------------------------------------------------------- */

console.log("\nthe household's own drag still reaches the setting");

{
  tap.resetState();
  store.setWindow(3);
  store.writes.length = 0;

  let tree = render();
  sliderIn(tree)?.props?.onChange?.({ target: { value: '5' } });

  tree = render();
  const slider = sliderIn(tree);
  ok(slider?.props?.value === 5, 'the slider follows the drag', `value=${slider?.props?.value}`);

  slider?.props?.onMouseUp?.({ target: { value: '5' } });
  const wrote = store.writes.filter((w) => w.expiringSoonDays === 5);
  ok(wrote.length === 1, 'releasing the slider writes the window', `writes=${JSON.stringify(store.writes)}`);

  // And the screen now shows what it wrote.
  store.writes.length = 0;
  const after = render();
  ok(
    sliderIn(after)?.props?.value === 5,
    'the slider shows the window it just wrote',
    `value=${sliderIn(after)?.props?.value}`,
  );
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
