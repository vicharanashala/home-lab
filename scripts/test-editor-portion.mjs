/**
 * Tests that a dish the user picks is planned for the portion the DAY wants.
 *
 * WHY THIS MATTERS
 * The shopping list is built from the servings on each planned dish, so the
 * number a dish is written with IS the number of food that gets bought. Every
 * other path that fills a slot uses one rule — `suggestedServingsForDay` — and
 * the day states that number everywhere else: the "cooking for 4" line, the
 * "4pax" on the suggestion sheet, the guest scaling.
 *
 * The "use these before they go" strip was the one path that did not. It opened
 * the inline editor on the RECIPE's own size, and every recipe in the catalogue
 * is written for two people — so picking a dish from that strip planned it for
 * two, however many people the day was cooking for. The shopping list then
 * bought half of what the screen said: two adults and two children, the day
 * said 4 servings, and the dish went on the plan for 2.
 *
 * WHY THE REAL PAGE IS RENDERED AND CLICKED
 * The number lives in a click handler inside the meal-plan page, so reading
 * the page's arithmetic would not catch it — the same mistake
 * scripts/test-suggest-pax.mjs was written to avoid. Here the real page is
 * bundled with esbuild, rendered, and the real rescue card is clicked; the
 * portion the editor starts on is read out of the state that click produced.
 *
 * Run with:  node scripts/test-editor-portion.mjs
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
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');

// The app's own portion rule — the one the plan is written with.
const { suggestedServingsForDay } = await import('../src/utils/portions.ts');

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

function eq(got, want, label) {
  ok(got === want, label, got === want ? String(got) : `got ${got}, expected ${want}`);
}

/* -------------------------------------------------------------------------- */
/* The household, the stock and the day                                         */
/* -------------------------------------------------------------------------- */

/** Two adults and two children — a household the portion rule sizes at 4. */
const HOUSEHOLD = {
  adults: 2, teens: 0, children: 2, toddlers: 0, completed: true,
};

/** A day with nothing planned and no guests. */
const DAY = { breakfast: null, lunch: null, dinner: null, guests: 0 };

const DAY_PORTION = suggestedServingsForDay(DAY, HOUSEHOLD);

// The store hydrates from localStorage, so the page needs a window to read it
// from. The kitchen holds paneer that expires tomorrow, which is what puts a
// dish in the "use these before they go" strip.
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const storage = {
  'homehub.v1': JSON.stringify({
    grocery: [],
    mealLogs: [],
    recipes: [],
    stock: [
      {
        id: 'stk-paneer', name: 'Paneer', quantity: 200, unit: 'g',
        category: 'dairy', location: 'fridge', expiryDate: tomorrow,
        lowStockThreshold: 0, createdAt: Date.now(), updatedAt: Date.now(),
      },
    ],
    settings: {
      household: HOUSEHOLD,
      expiringSoonDays: 3, hasSeenWelcome: true, userName: '',
      dietaryPreference: 'no-preference', allergies: [], theme: 'system',
      showChainHq: false, microphoneEnabled: false,
    },
    mealPlan: {},
  }),
};

globalThis.window = {
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = v; },
    removeItem: (k) => { delete storage[k]; },
  },
  matchMedia: () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  }),
};

// The page focuses the dish input on the next frame after the editor opens.
// There is no frame in node, and the input is not mounted anyway.
globalThis.requestAnimationFrame = (fn) => { fn(); };

/* -------------------------------------------------------------------------- */
/* Render the real page                                                         */
/* -------------------------------------------------------------------------- */

const work = await mkdtemp(path.join(tmpdir(), 'hh-editor-portion-'));
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

const tapShim = path.join(REPO, 'scripts/lib/react-tap.mjs');

const bundle = await build({
  entryPoints: [path.join(REPO, 'src/pages/MealPlan.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  jsx: 'automatic',
  external: [
    'react/jsx-runtime', 'react-dom', 'react-dom/server',
    'lucide-react', 'clsx', 'react-router-dom',
  ],
  plugins: [
    {
      name: 'tap-react',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, (args) => {
          // The tap must keep the REAL react external, or esbuild inlines a
          // second copy of React and every hook in the page breaks.
          if (args.importer === tapShim) return { path: 'react', external: true };
          return { path: tapShim };
        });
      },
    },
  ],
});

// The server renderer always reads the frozen SSR snapshot, which is built
// from seedState() once and never changes — so the page would render an empty
// kitchen no matter what the store held. Point it at the live state instead.
const source = bundle.outputFiles[0].text;
const patched = source.replace('return SERVER_SNAPSHOT;', 'return getState();');
if (patched === source) {
  console.error(
    'harness: the store\'s server snapshot hook moved — this test needs updating',
  );
  process.exit(1);
}

const pageFile = path.join(work, 'MealPlan.mjs');
await writeFile(pageFile, patched);
const { default: MealPlanPage } = await import(pathToFileURL(pageFile).href);

/* -------------------------------------------------------------------------- */
/* Capture the page and click the rescue card                                  */
/* -------------------------------------------------------------------------- */

/**
 * Render the page and keep its element tree.
 *
 * The tree is needed because a server render produces markup, not something
 * that can be clicked. Calling the page component directly inside a render
 * hands back the tree it built, with the real handlers still on it.
 */
let tree = null;
function Capture() {
  tree = MealPlanPage();
  return null;
}

// The server renderer warns about useLayoutEffect, which the page's own
// components use for a scroll fade. It says nothing about what is tested.
const realError = console.error;
console.error = (...args) => {
  if (String(args[0] ?? '').includes('useLayoutEffect does nothing on the server')) return;
  realError(...args);
};
try {
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Capture)));
} finally {
  console.error = realError;
}

/** Every element in the tree that has a click handler. */
function clickables(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) clickables(child, out);
    return out;
  }
  if (node.props?.onClick) out.push(node);
  clickables(node.props?.children, out);
  return out;
}

/** The visible text of a tree of elements. */
function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

// The rescue cards announce how urgent they are, so that is how they are found.
const rescueCard = clickables(tree).find((el) =>
  /expires (today|tomorrow|in \d+ days?)/.test(textOf(el.props.children)),
);

console.log('\na dish the user picks is planned for the portion the day wants');

if (!rescueCard) {
  ok(false, 'the "use these before they go" strip rendered a rescue card');
} else {
  ok(true, 'the "use these before they go" strip rendered a rescue card');

  // The click writes the editor's portion into state. The tap records it.
  globalThis.__hh_state_writes = [];
  rescueCard.props.onClick();

  const writes = globalThis.__hh_state_writes ?? [];
  const numbers = writes.filter((w) => typeof w === 'number');

  eq(numbers.length, 1, 'the click wrote exactly one number into state');
  eq(numbers[0], DAY_PORTION, 'the editor starts on the portion the day wants');
  ok(
    numbers[0] !== 2,
    'the editor does not start on the recipe\'s own size',
    `editor ${numbers[0]}, recipe size 2`,
  );
}

console.log('\nthe rule itself still sizes a household of two the same way');

{
  eq(
    suggestedServingsForDay(DAY, { adults: 2, teens: 0, children: 0, toddlers: 0, completed: true }),
    2,
    'two adults and no guests still get 2 servings',
  );
}

console.log(
  failed === 0
    ? `\n${passed} passed, ${failed} failed`
    : `\n${passed} passed, ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
