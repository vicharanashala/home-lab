/**
 * Tests that the suggestion sheet tells the truth about how many people a
 * dish is cooked for.
 *
 * WHY THIS MATTERS: the sheet prints "N pax" next to every dish it offers,
 * and picking one plans that dish for the servings the day wants. The sheet
 * used to be handed the household's portion while the plan got the day's
 * larger number — so with two guests over the screen said "2pax" and the
 * shopping list bought food for 4. Two screens, one dish, two answers.
 *
 * WHY THE SHEET IS RENDERED RATHER THAN READ: the number used to be a prop,
 * so a test that only checked the page's arithmetic would still pass while
 * the sheet printed the wrong figure. Here the component itself is rendered
 * — esbuild turns the .tsx into a module, react-dom/server turns it into
 * HTML — and the pax is read out of the markup. The component and the app's
 * own portion rule do the work; nothing is re-implemented here.
 *
 * Run with:  node scripts/test-suggest-pax.mjs
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

// Resolved from the repo so the test works the same whether it is run from
// the working tree or from the quality gate's exported copy of the index.
const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { renderToStaticMarkup } = require('react-dom/server');

// The app's own portion rule — the one the plan is written with.
const { suggestedServingsForDay, suggestedServings } = await import(
  '../src/utils/portions.ts'
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

function eq(got, want, label) {
  ok(got === want, label, got === want ? String(got) : `got ${got}, expected ${want}`);
}

/* -------------------------------------------------------------------------- */
/* Render the sheet for real                                                    */
/* -------------------------------------------------------------------------- */

const work = await mkdtemp(path.join(tmpdir(), 'hh-suggest-pax-'));
// The bundled module imports react and lucide-react by name, and react-dom
// has to be the SAME react copy as the one that built the elements. Pointing
// node_modules at the repo's copy gives both the same instance.
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

const bundle = await build({
  entryPoints: [path.join(REPO, 'src/components/SuggestSheet.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react', 'clsx'],
});

const sheetFile = path.join(work, 'SuggestSheet.mjs');
await writeFile(sheetFile, bundle.outputFiles[0].text);
const { SuggestSheet } = await import(pathToFileURL(sheetFile).href);

const SUGGESTION = {
  recipe: {
    id: 'r1',
    name: 'Dal Rice',
    emoji: '🍛',
    baseServings: 2,
    ingredients: [],
  },
  score: 1,
  reason: 'stock',
  why: 'You already have most of it',
  taste: null,
  coverage: 0.5,
  have: 3,
  total: 5,
};

/** The pax the sheet prints for one dish, or null when it prints none. */
function paxShown(dayPlan, household) {
  const element = SuggestSheet({
    slot: 'dinner',
    dayLabel: 'Mon',
    suggestions: [SUGGESTION],
    hasTasteProfile: false,
    dayPlan,
    household,
    onPick: () => {},
    onShuffle: () => {},
    onClose: () => {},
  });
  const html = renderToStaticMarkup(element);
  const match = html.match(/(\d+)pax/);
  return match ? Number(match[1]) : null;
}

/* -------------------------------------------------------------------------- */
/* The cases                                                                    */
/* -------------------------------------------------------------------------- */

const TWO_ADULTS = { adults: 2, teens: 0, children: 0, toddlers: 0, completed: true };
const TWO_ADULTS_TWO_KIDS = {
  adults: 2,
  teens: 0,
  children: 2,
  toddlers: 0,
  completed: true,
};

/** A day with nothing planned on it and no guests. */
const emptyDay = { breakfast: null, lunch: null, dinner: null };

console.log('\nthe suggestion sheet shows the portion the day wants');

{
  const day = { ...emptyDay, guests: 2 };
  eq(paxShown(day, TWO_ADULTS), 4, 'two guests over: the sheet says 4pax');
}

{
  const day = { ...emptyDay };
  eq(paxShown(day, TWO_ADULTS), 2, 'no guests: the sheet says the household 2pax');
}

{
  const day = { ...emptyDay };
  eq(paxShown(day, TWO_ADULTS_TWO_KIDS), 4, 'two kids and no guests: 4pax');
}

{
  const day = { ...emptyDay, guests: 2 };
  eq(paxShown(day, TWO_ADULTS_TWO_KIDS), 6, 'two kids and two guests: 6pax');
}

console.log('\nthe sheet and the plan agree on the number');

{
  // The whole point: what the sheet prints and what the plan is written with
  // are the same number, on the same day, for the same household.
  for (const household of [TWO_ADULTS, TWO_ADULTS_TWO_KIDS]) {
    for (const guests of [0, 1, 2, 5]) {
      const day = { ...emptyDay, guests };
      const shown = paxShown(day, household);
      const written = suggestedServingsForDay(day, household);
      eq(shown, written, `guests=${guests} adults=${household.adults} kids=${household.children}`);
    }
  }
}

console.log('\nthe sheet is not the household alone');
{
  // Guards the exact mistake: the sheet showing the household's portion on a
  // day that wants more, which is what the old `servings` prop allowed.
  const day = { ...emptyDay, guests: 2 };
  const shown = paxShown(day, TWO_ADULTS);
  const householdOnly = suggestedServings(TWO_ADULTS);
  ok(
    shown !== householdOnly,
    'a day with guests does not show the household-only portion',
    `sheet ${shown}pax, household alone ${householdOnly}pax`,
  );
}

console.log(
  failed === 0
    ? `\n${passed} passed, ${failed} failed`
    : `\n${passed} passed, ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
