/**
 * House Bot has to be in a WINDOW OF ITS OWN, and that window has to be
 * placed where it cannot stop the share.
 *
 * THE BUG THIS GUARDS
 *
 * The share is of a WINDOW, and a window shows ONE tab at a time. House Bot
 * used to be opened as a tab of that same window:
 *
 *     src/pages/DigitalStores.tsx
 *       window.open('/house-bot', '_blank');
 *
 * So the person had to click the House Bot tab to ask it anything — and the
 * moment they did, the shared window was showing House Bot. The bot was
 * handed a picture of ITSELF and asked what was on the screen:
 *
 *     the person asks "what is in my basket?"
 *     the bot is sent a picture of the chat window
 *     the bot cannot see the store
 *
 * The feature could not work. The store opened, Chrome's picker came up, the
 * share ran, the frames arrived — and the frames were of the wrong thing.
 *
 * WHY A WINDOW ELSEWHERE FIXES IT: a window of its own means the shared
 * window keeps showing the store for as long as the person is shopping, and
 * the person talks to House Bot without changing what the shared window
 * shows.
 *
 * WHY THE PLACEMENT MATTERS TOO: the app's window is the one being shared.
 * The browser refuses a capture from a window it cannot see, and a window
 * completely covered by another one is hidden. So the House Bot window is
 * put BESIDE the app's window where there is room, and made small enough
 * that it cannot cover the app's window completely where there is not.
 *
 * WHAT IS TESTED HERE
 *
 *   - the REAL planner, over the geometries a person actually has: a window
 *     at the left of the screen, a maximized window, a window in the middle,
 *     a small window;
 *   - that the bot window never covers the app's window completely, in any
 *     of those;
 *   - that it never falls off the screen;
 *   - the REAL opener, asked whether it opened a window with those features;
 *   - a source guard on the stores screen, so it cannot go back to opening
 *     House Bot as a tab of the shared window.
 *
 * Run with:  node scripts/test-house-bot-window.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpWorkDir } from './lib/tmp-work.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

register('./lib/ts-resolve.mjs', import.meta.url);

const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');

const houseBotWindow = await import(
  pathToFileURL(path.join(REPO, 'src/utils/houseBotWindow.ts')).href
);

const planHouseBotWindow = houseBotWindow.planHouseBotWindow;
const openHouseBotWindow = houseBotWindow.openHouseBotWindow;

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
 * Does the bot window leave any of the app's window showing?
 *
 * WHY THIS IS THE RULE AND NOT "does it fit": the browser refuses a
 * capture from a window that is completely hidden, and a window is hidden
 * when another window covers ALL of it. So the question is not whether the
 * bot window fits on the screen — it is whether the app's window keeps at
 * least a strip of itself uncovered.
 */
function leavesAppVisible(plan, g) {
  const overlapsHorizontally =
    plan.left < g.screenX + g.outerWidth && plan.left + plan.width > g.screenX;
  const overlapsVertically =
    plan.top < g.screenY + g.outerHeight && plan.top + plan.height > g.screenY;
  if (!overlapsHorizontally || !overlapsVertically) return true;
  // It overlaps, so it must not cover the lot of it.
  const coveredWidth = Math.min(plan.left + plan.width, g.screenX + g.outerWidth) - plan.left;
  const coveredHeight = Math.min(plan.top + plan.height, g.screenY + g.outerHeight) - plan.top;
  return coveredWidth < g.outerWidth || coveredHeight < g.outerHeight;
}

const GEOMETRIES = [
  {
    name: 'a window at the left of a big screen',
    g: { screenX: 0, screenY: 30, outerWidth: 1280, outerHeight: 860, availWidth: 2240, availHeight: 1140 },
  },
  {
    name: 'a maximized window',
    g: { screenX: 0, screenY: 0, outerWidth: 2240, outerHeight: 1140, availWidth: 2240, availHeight: 1140 },
  },
  {
    name: 'a window in the middle of the screen',
    g: { screenX: 480, screenY: 120, outerWidth: 1280, outerHeight: 860, availWidth: 2240, availHeight: 1140 },
  },
  {
    name: 'a small window',
    g: { screenX: 100, screenY: 100, outerWidth: 640, outerHeight: 480, availWidth: 1440, availHeight: 900 },
  },
  {
    name: 'a window on the right of the screen',
    g: { screenX: 1500, screenY: 60, outerWidth: 700, outerHeight: 900, availWidth: 2240, availHeight: 1140 },
  },
  {
    name: 'a laptop screen',
    g: { screenX: 0, screenY: 25, outerWidth: 1440, outerHeight: 875, availWidth: 1440, availHeight: 875 },
  },
];

console.log('\nthe House Bot window never hides the window being shared');
for (const { name, g } of GEOMETRIES) {
  const plan = planHouseBotWindow(g);
  ok(
    leavesAppVisible(plan, g),
    `the app's window stays visible on ${name}`,
    `bot window at ${plan.left},${plan.top} ${plan.width}x${plan.height}`,
  );
}

console.log('\nthe House Bot window stays on the screen');
for (const { name, g } of GEOMETRIES) {
  const plan = planHouseBotWindow(g);
  ok(
    plan.left >= 0 &&
      plan.top >= 0 &&
      plan.left + plan.width <= g.availWidth + 1 &&
      plan.top + plan.height <= g.availHeight + 1,
    `the bot window fits on ${name}`,
    `${plan.left},${plan.top} ${plan.width}x${plan.height} on ${g.availWidth}x${g.availHeight}`,
  );
}

console.log('\nthere is room beside the app\'s window when the screen has it');
{
  // A window at the left of a wide screen: the bot goes to the right of it,
  // where it cannot touch it at all.
  const g = { screenX: 0, screenY: 30, outerWidth: 1280, outerHeight: 860, availWidth: 2240, availHeight: 1140 };
  const plan = planHouseBotWindow(g);
  ok(plan.beside, 'the bot window is placed beside the app window');
  ok(
    plan.left >= g.screenX + g.outerWidth,
    'and it does not overlap the app window at all',
    `left ${plan.left} vs app right ${g.screenX + g.outerWidth}`,
  );
  ok(plan.width >= 420, 'and it is wide enough to chat in', `${plan.width}`);
}

console.log('\nwhen the app\'s window fills the screen, the bot window is made smaller');
{
  const g = { screenX: 0, screenY: 0, outerWidth: 2240, outerHeight: 1140, availWidth: 2240, availHeight: 1140 };
  const plan = planHouseBotWindow(g);
  ok(!plan.beside, 'there is no room beside it, so it is not placed beside it');
  ok(
    plan.width < g.outerWidth,
    'the bot window is narrower than the app window',
    `${plan.width} vs ${g.outerWidth}`,
  );
}

console.log('\nthe bot window is opened with a size and a position');
{
  const g = { screenX: 0, screenY: 30, outerWidth: 1280, outerHeight: 860, availWidth: 2240, availHeight: 1140 };
  const plan = planHouseBotWindow(g);
  ok(/^noopener,/.test(plan.features), 'it asks for no opener', plan.features);
  ok(/width=\d+/.test(plan.features), 'it asks for a width', plan.features);
  ok(/height=\d+/.test(plan.features), 'it asks for a height', plan.features);
  ok(/left=-?\d+/.test(plan.features), 'it asks for a position', plan.features);
  ok(/top=-?\d+/.test(plan.features), 'it asks for a position', plan.features);
}

console.log('\nthe opener opens House Bot in that window');
{
  const calls = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      screenX: 0,
      screenY: 30,
      outerWidth: 1280,
      outerHeight: 860,
      screen: { availWidth: 2240, availHeight: 1140 },
      open(url, target, features) {
        calls.push({ url, target, features });
        return null;
      },
    },
  });
  const opened = openHouseBotWindow('/house-bot');
  ok(opened, 'the browser was asked to open it');
  ok(calls.length === 1, 'and it was asked exactly once', `${calls.length}`);
  ok(calls[0]?.url === '/house-bot', 'it opens House Bot', calls[0]?.url);
  ok(calls[0]?.target === '_blank', 'in a window of its own', calls[0]?.target);
  ok(
    /width=\d+/.test(calls[0]?.features ?? '') && /height=\d+/.test(calls[0]?.features ?? ''),
    'with a size, so it is a window and not a tab',
    calls[0]?.features,
  );
}

console.log('\nthe opener says so when the browser refuses');
{
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      screenX: 0,
      screenY: 30,
      outerWidth: 1280,
      outerHeight: 860,
      screen: { availWidth: 2240, availHeight: 1140 },
      open() {
        throw new Error('SecurityError: the popup was refused');
      },
    },
  });
  let threw = false;
  try {
    const r = openHouseBotWindow('/house-bot');
    threw = r === false;
  } catch {
    threw = false;
  }
  ok(threw, 'a browser that throws is not reported as a success');
}

console.log('\na window opened without a live gesture is not even asked for');
{
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { userActivation: { isActive: false, hasBeenActive: true } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      screenX: 0,
      screenY: 30,
      outerWidth: 1280,
      outerHeight: 860,
      screen: { availWidth: 2240, availHeight: 1140 },
      open(url, target, features) {
        calls.push({ url, target, features });
        return null;
      },
    },
  });
  const r = openHouseBotWindow('/house-bot');
  ok(r === false, 'it says the window did not open');
  ok(calls.length === 0, 'and the browser was not asked at all', `${calls.length} calls`);

  // A live gesture: the window is asked for.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { userActivation: { isActive: true, hasBeenActive: true } },
  });
  const r2 = openHouseBotWindow('/house-bot');
  ok(r2 === true, 'with a live gesture it opens');
  ok(calls.length === 1, 'and the browser is asked once', `${calls.length} calls`);
}

console.log('\nthe stores screen does not go back to opening House Bot as a tab');
{
  const source = await readFile(path.join(REPO, 'src/pages/DigitalStores.tsx'), 'utf8');
  ok(
    source.includes('openHouseBotWindow'),
    'the stores screen opens House Bot through the window planner',
  );
  ok(
    !/window\.open\(\s*'\/house-bot'/.test(source),
    'and it does not open House Bot as a plain tab of the shared window',
  );
  ok(
    source.includes('Open House Bot in a window of its own'),
    'and the button says what it does',
  );
}

console.log('\nHouse Bot shows the picture of what it can see');
{
  const source = await readFile(path.join(REPO, 'src/pages/HouseBot.tsx'), 'utf8');
  ok(
    /screen\.frame\.data/.test(source),
    'the chip renders the frame it was given',
  );
  ok(
    /data:\$\{screen\.frame\.mediaType\};base64,/.test(source),
    'as an image the person can look at',
  );
}

/* -------------------------------------------------------------------------- */
/* The REAL stores screen, and the button the person actually presses          */
/* -------------------------------------------------------------------------- */

console.log('\nthe button the person presses opens a window and not a tab');
{
  const tapShim = path.join(REPO, 'scripts/lib/react-tap-state.mjs');
  const work = tmpWorkDir('hh-house-bot-window-');
  await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

  const storeStub = path.join(work, 'store-stub.mjs');
  const routerStub = path.join(work, 'router-stub.mjs');
  const watchStub = path.join(work, 'watch-stub.mjs');

  await writeFile(
    storeStub,
    `export function useStore() {
  return {
    grocery: [], stock: [], mealLogs: [], recipes: [], mealPlan: {},
    settings: { userName: '', expiringSoonDays: 3, dietaryPreference: 'no-preference', allergies: [] },
    toast() {}, addGrocery() {}, toggleGroceryPurchased() {}, removeGrocery() {},
    clearPurchased() {}, addStock() {}, updateStock() {}, updateSettings() {},
  };
}
`,
  );
  await writeFile(
    routerStub,
    `import { createElement } from 'react';
export function Link({ to, children, ...rest }) { return createElement('a', { href: typeof to === 'string' ? to : '#', ...rest }, children); }
export function NavLink({ to, children, ...rest }) { return createElement('a', { href: typeof to === 'string' ? to : '#', ...rest }, children); }
export function useNavigate() { return () => {}; }
export function useLocation() { return { pathname: '/', search: '', hash: '', state: null, key: 'default' }; }
export function useParams() { return {}; }
export function Route() { return null; }
export function Routes({ children }) { return children; }
export function BrowserRouter({ children }) { return children; }
`,
  );
  await writeFile(
    watchStub,
    `export const shareState = { watching: false, label: null, error: null, asking: false, sentFrame: false };
export function __setShareState(next) { Object.assign(shareState, next); }
export function useScreenSharer() { return { state: shareState, start: async () => false, stop: () => {} }; }
`,
  );

  const bundle = await build({
    entryPoints: [path.join(REPO, 'src/pages/DigitalStores.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    external: ['react/jsx-runtime', 'react-dom', 'react-dom/server', 'lucide-react', 'clsx', 'date-fns'],
    plugins: [
      {
        name: 'stub-the-store-router-and-share-hook',
        setup(b) {
          b.onResolve({ filter: /^react$/ }, (args) => {
            if (args.importer === tapShim) return { path: 'react', external: true };
            return { path: tapShim, external: true };
          });
          b.onResolve({ filter: /store\/useStore$/ }, () => ({ path: pathToFileURL(storeStub).href, external: true }));
          b.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: pathToFileURL(routerStub).href, external: true }));
          b.onResolve({ filter: /hooks\/useScreenWatch$/ }, () => ({ path: pathToFileURL(watchStub).href, external: true }));
        },
      },
    ],
  });

  const screenFile = path.join(work, 'DigitalStores.mjs');
  await writeFile(screenFile, bundle.outputFiles[0].text);
  const { DigitalStoresPage } = await import(pathToFileURL(screenFile).href);
  const tap = await import(pathToFileURL(tapShim).href);
  const watch = await import(pathToFileURL(watchStub).href);

  /** The visible text of a tree of elements. */
  function textOf(node) {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    if (node.props) return textOf(node.props.children);
    return '';
  }

  /** The first button whose text matches, and its press handler. */
  function findButton(node, pattern) {
    if (node === null || node === undefined) return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findButton(child, pattern);
        if (found) return found;
      }
      return null;
    }
    if (node.props) {
      if (node.props.onClick && pattern.test(textOf(node))) return node.props.onClick;
      return findButton(node.props.children, pattern);
    }
    return null;
  }

  // The share is running and a picture has arrived — the state the person
  // is in when the button appears.
  tap.resetState();
  watch.__setShareState({
    watching: true,
    label: 'Amazon Fresh',
    error: null,
    asking: false,
    sentFrame: true,
  });

  const opened = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      screenX: 0,
      screenY: 30,
      outerWidth: 1280,
      outerHeight: 860,
      screen: { availWidth: 2240, availHeight: 1140 },
      open(url, target, features) {
        opened.push({ url, target, features });
        return null;
      },
    },
  });

  /** A browser whose gesture is alive, or one whose gesture is spent. */
  const gesture = (isActive) =>
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: { userActivation: { isActive, hasBeenActive: true } },
    });

  gesture(true);
  tap.beginRender();
  const tree = DigitalStoresPage();
  const text = textOf(tree);

  ok(
    /Open House Bot in a window of its own/.test(text),
    'the button says it opens a window of its own',
  );

  const press = findButton(tree, /Open House Bot/);
  ok(!!press, 'the button is there to press');

  if (press) {
    press();
    ok(opened.length === 1, 'pressing it opens House Bot once', `${opened.length}`);
    ok(opened[0]?.url === '/house-bot', 'and it opens House Bot', opened[0]?.url);
    ok(
      /width=\d+/.test(opened[0]?.features ?? '') && /height=\d+/.test(opened[0]?.features ?? ''),
      'with a size, so the browser makes a window and not a tab',
      opened[0]?.features,
    );
  }

  ok(
    /click the store/.test(text),
    'and the screen says what the person has to do to let the bot see the store',
  );

  console.log('\nthe screen says so when the browser blocks the window');
  {
    gesture(false);
    tap.beginRender();
    const blockedTree = DigitalStoresPage();
    const blockedPress = findButton(blockedTree, /Open House Bot/);
    blockedPress?.();
    ok(opened.length === 1, 'the browser was not asked again', `${opened.length} calls`);

    tap.beginRender();
    const after = DigitalStoresPage();
    ok(
      /blocked the new window/.test(textOf(after)),
      'and the person is told the window did not open',
      textOf(after).replace(/\s+/g, ' ').slice(0, 120),
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
