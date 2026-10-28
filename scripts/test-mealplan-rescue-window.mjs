/**
 * The Meal Plan's rescue strip must describe the household's expiry window.
 *
 * THE BUG
 *
 * `settings.expiringSoonDays` is the ONE number that decides what the whole
 * app calls "expiring soon". The Alerts screen reads it, the Dashboard reads
 * it, the Stock screen reads it, the stock rows read it, House Bot's context
 * block is sent it, and the Meal Plan's "Use these before they go" strip is
 * built from it.
 *
 * The strip's CAPTION did not. It was a fixed string:
 *
 *     You have {something|things} expiring in the next 3 days.
 *
 * so the strip listed the household's food while the line under its heading
 * described three days of it. The count and the sentence were two answers to
 * the same question, and they disagreed:
 *
 *     a household that widened the window to a week
 *       the strip offers dishes that rescue food expiring in the next 7 days
 *       the line under the heading says "expiring in the next 3 days"
 *
 *     a household that narrowed the window to a day
 *       the strip offers dishes that rescue food expiring in the next 1 day
 *       the line under the heading says "expiring in the next 3 days"
 *
 * That is the exact failure commit 3bec8ed set out to kill — "the same item
 * reads 'expiring soon' on one screen and is missing from the other" — left
 * standing in the one sentence that describes the strip.
 *
 * WHAT IS TESTED HERE
 *
 * The REAL component, bundled with esbuild and driven against a stubbed
 * store, the same way `test-alerts-window-sync.mjs` drives the real Alerts
 * screen. Two things are asked of the strip:
 *
 *   1. does the sentence under the heading name the household's window?
 *   2. does the strip's CONTENTS follow the same window?
 *
 * The second one is the control. It is what says the strip is really the
 * household's, so the first one has something to be wrong about — a caption
 * that names 3 days over a strip that rescues 7 days of food is wrong, and a
 * caption that names 3 days over an empty strip is not.
 *
 * Run with:  node scripts/test-mealplan-rescue-window.mjs
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
/* The days and the dates                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A day, in the app's own local calendar.
 *
 * WHY LOCAL AND NOT UTC: `src/utils/date.ts` counts with date-fns
 * `differenceInCalendarDays`, and the Alerts screen and the Stock rows both
 * go through it. A date built in UTC would be a different day in IST after
 * half past four in the afternoon, and the strip would then be answering a
 * question about a different day than the screen beside it.
 */
function localDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Five days out — inside a seven-day window, outside a three-day one. */
const IN_FIVE_DAYS = localDay(5);
/** Today — inside every window, including a one-day one. */
const TODAY = localDay(0);

/* -------------------------------------------------------------------------- */
/* The store, as a stub the screen can be handed                                */
/* -------------------------------------------------------------------------- */

/**
 * WHY A STUB: `renderToString` reads the store's SERVER snapshot, which is
 * frozen seed state, so the household under test could never reach the
 * screen through the real store. The stub stands in for the store and hands
 * the screen the household under test.
 */
const stubFile = path.join(tmpdir(), 'hh-mealplan-window-store.mjs');
await writeFile(
  stubFile,
  `let windowDays = 3;

/** The household changed the window. */
export function setWindow(days) {
  windowDays = days;
}

export const MEAL_PLAN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const MEAL_PLAN_DAY_LABELS = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const RECIPE = {
  id: 'r-milk',
  name: 'Milk Pongal',
  emoji: '🥛',
  mealType: 'dinner',
  baseServings: 2,
  builtIn: true,
  ingredients: [
    { name: 'Milk', quantity: 200, unit: 'ml', category: 'dairy' },
  ],
};

/**
 * A second dish, on food that goes off TODAY.
 *
 * WHY IT IS HERE: the strip only exists when something is in the window, so
 * a household that has narrowed the window to a day would have no strip at
 * all and nothing to read. This dish keeps the strip there at every window,
 * so the caption can be asked the same question at one day, three days,
 * seven days and fourteen.
 */
const RECIPE_TODAY = {
  id: 'r-curd',
  name: 'Curd Rice',
  emoji: '🍚',
  mealType: 'dinner',
  baseServings: 2,
  builtIn: true,
  ingredients: [
    { name: 'Curd', quantity: 100, unit: 'g', category: 'dairy' },
  ],
};

const STOCK = [
  {
    id: 's-milk',
    name: 'Milk',
    quantity: 1,
    unit: 'L',
    category: 'dairy',
    location: 'fridge',
    expiryDate: ${JSON.stringify(IN_FIVE_DAYS)},
    lowStockThreshold: 0,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 's-curd',
    name: 'Curd',
    quantity: 1,
    unit: 'kg',
    category: 'dairy',
    location: 'fridge',
    expiryDate: ${JSON.stringify(TODAY)},
    lowStockThreshold: 0,
    createdAt: 1,
    updatedAt: 1,
  },
];

export function useStore() {
  return {
    recipes: [RECIPE, RECIPE_TODAY],
    stock: STOCK,
    grocery: [],
    mealPlan: {},
    mealLogs: [],
    settings: {
      userName: '',
      dietaryPreference: 'no-preference',
      allergies: [],
      expiringSoonDays: windowDays,
      household: { adults: 2, teens: 0, children: 0, toddlers: 0 },
    },
    setMealPlanSlot() {},
    clearMealPlanDay() {},
    copyMealPlanDay() {},
    clearMealPlan() {},
    addGrocery() { return {}; },
    toast() {},
    setDayMode() {},
    setDayGuests() {},
    setDayNote() {},
  };
}
`,
);

const store = await import(pathToFileURL(stubFile).href);

/* -------------------------------------------------------------------------- */
/* The screen, built from the real component                                    */
/* -------------------------------------------------------------------------- */

const work = await mkdtemp(path.join(tmpdir(), 'hh-mealplan-window-'));
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

const tapShim = path.join(REPO, 'scripts/lib/react-tap-state.mjs');

/**
 * WHY THE TWO DATA FILES ARE REPLACED: the screen loads the 5,894-recipe
 * catalogue and the 384-dim embeddings in effects, and neither is needed to
 * ask this question — the strip is built from the store's own recipes. A test
 * must not download 19 MB of JSON to read one sentence, and the effect that
 * loads them never runs in a node render anyway.
 */
const emptyData = path.join(work, 'empty-data.mjs');
await writeFile(emptyData, 'export default {};\n');

const bundle = await build({
  entryPoints: [path.join(REPO, 'src/pages/MealPlan.tsx')],
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
      name: 'mealplan-harness',
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
        b.onResolve({ filter: /data\/(csvRecipes|recipeEmbeddings)\.json$/ }, () => ({
          path: emptyData,
        }));
      },
    },
  ],
});

const screenFile = path.join(work, 'MealPlan.mjs');
await writeFile(screenFile, bundle.outputFiles[0].text);
const { default: MealPlanPage } = await import(pathToFileURL(screenFile).href);
const tap = await import(pathToFileURL(tapShim).href);

/* -------------------------------------------------------------------------- */
/* Driving the screen                                                          */
/* -------------------------------------------------------------------------- */

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

/** Every piece of text on the screen. */
function allText(tree) {
  let out = '';
  walk(tree, (el) => {
    const text = textOf(el.props?.children);
    if (text) out += ' ' + text;
  });
  return out;
}

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
  return MealPlanPage();
}

/**
 * The rescue strip's heading, and the sentence under it.
 *
 * WHY THE STRIP IS FOUND BY ITS HEADING: the strip is one section among many
 * on the screen, and what this test is about is the sentence UNDER the
 * strip's own heading — a sentence that describes the window the strip was
 * built from.
 */
function hasStrip(tree) {
  let found = false;
  walk(tree, (el) => {
    if (!found && textOf(el.props?.children).trim() === 'Use these before they go') {
      found = true;
    }
  });
  return found;
}

/**
 * The sentence under the strip's heading.
 *
 * WHY THE WHITESPACE IS SQUASHED: the sentence is built from several text
 * nodes, and this test joins a node's children with a space. That space is
 * an artefact of the reading, not something the browser renders, so the
 * whitespace is squashed before the sentence is matched against.
 */
function rescueCaption(tree) {
  let caption = null;
  walk(tree, (el) => {
    if (!caption && el.type === 'p' && /expiring in the next/.test(textOf(el.props?.children))) {
      caption = textOf(el.props?.children).replace(/\s+/g, ' ').trim();
    }
  });
  return caption;
}

/** The dishes the strip is offering. */
function rescueDishes(tree) {
  const found = new Set();
  walk(tree, (el) => {
    if (el.type === 'button') {
      const text = textOf(el.props?.children);
      for (const dish of ['Milk Pongal', 'Curd Rice']) {
        if (text.includes(dish)) found.add(dish);
      }
    }
  });
  return found;
}

/* -------------------------------------------------------------------------- */
/* The strip's CONTENTS follow the household's window                           */
/* -------------------------------------------------------------------------- */

console.log("\nthe strip's contents follow the household's window");

{
  tap.resetState();
  store.setWindow(3);
  const tree = render();
  const dishes = rescueDishes(tree);
  ok(hasStrip(tree), 'the strip is there at a three-day window');
  ok(
    dishes.has('Curd Rice'),
    'at a three-day window the strip offers the food that goes off today',
    `dishes=${[...dishes].join(', ')}`,
  );
  ok(
    !dishes.has('Milk Pongal'),
    'at a three-day window the strip does NOT offer milk that goes off in five days',
    `dishes=${[...dishes].join(', ')}`,
  );
}

{
  tap.resetState();
  store.setWindow(7);
  const tree = render();
  const dishes = rescueDishes(tree);
  ok(hasStrip(tree), 'the strip is there at a seven-day window');
  ok(
    dishes.has('Milk Pongal'),
    'at a seven-day window the strip DOES offer milk that goes off in five days',
    `dishes=${[...dishes].join(', ')}`,
  );
}

/* -------------------------------------------------------------------------- */
/* The caption follows the household's window                                   */
/* -------------------------------------------------------------------------- */

console.log("\nthe caption names the household's window");

{
  tap.resetState();
  store.setWindow(3);
  const tree = render();
  const caption = rescueCaption(tree);
  ok(
    caption !== null && /in the next 3 days/.test(caption),
    'a three-day household is told "the next 3 days"',
    `caption=${JSON.stringify(caption)}`,
  );
}

{
  tap.resetState();
  store.setWindow(7);
  const tree = render();
  const caption = rescueCaption(tree);
  ok(
    caption !== null && /in the next 7 days/.test(caption),
    'a seven-day household is told "the next 7 days"',
    `caption=${JSON.stringify(caption)}`,
  );
  ok(
    caption !== null && !/in the next 3 days/.test(caption),
    'a seven-day household is not told "the next 3 days"',
    `caption=${JSON.stringify(caption)}`,
  );
}

{
  tap.resetState();
  store.setWindow(1);
  const tree = render();
  const caption = rescueCaption(tree);
  ok(
    caption !== null && /in the next 1 day/.test(caption),
    'a one-day household is told "the next 1 day"',
    `caption=${JSON.stringify(caption)}`,
  );
  ok(
    caption !== null && !/in the next 3 days/.test(caption),
    'a one-day household is not told "the next 3 days"',
    `caption=${JSON.stringify(caption)}`,
  );
}

{
  tap.resetState();
  store.setWindow(14);
  const tree = render();
  const caption = rescueCaption(tree);
  ok(
    caption !== null && /in the next 14 days/.test(caption),
    'a fourteen-day household is told "the next 14 days"',
    `caption=${JSON.stringify(caption)}`,
  );
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
