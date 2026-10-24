/**
 * Tests that editing the spoken plan keeps the dish and its recipe together.
 *
 * WHY THIS MATTERS
 * The spoken-plan sheet shows what was heard and what it was taken to mean,
 * and it lets the user change that: type over a slot, or tap one of the
 * dishes that were offered. The shopping list is built from the RECIPE the
 * plan entry points at, not from the name on the entry — so the moment the
 * slot says one dish and the resolution still describes another, the list
 * buys the wrong food. The plan reads "Paneer Tikka Masala" and the list
 * carries paneer tikka's ingredients.
 *
 * The two halves of the sheet are written by two different `useState` calls,
 * and only one of them used to follow the user's edit. The resolution is
 * what says which recipe a slot is; when it stops moving with the slot, the
 * two disagree and the shopping list is built from the wrong one.
 *
 * WHY THE REAL SHEET IS DRIVEN
 * The handlers live in the component, so reading the utilities would not
 * catch it — the same mistake scripts/test-editor-portion.mjs was written to
 * avoid. Here the real component is bundled, the real input is changed and
 * the real chip is clicked, and the plan entry that comes out the other side
 * is checked against the shopping list it produces.
 *
 * Run with:  node scripts/test-spoken-plan-edit.mjs
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

const { spokenPlanEntries } = await import('../src/utils/spokenPlanEntries.ts');
const { buildShoppingList } = await import('../src/utils/portions.ts');

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
/* A small catalogue                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Each recipe carries a DIFFERENT ingredient, so the shopping list says
 * plainly which recipe the plan pointed at. A list that says "paneer" when
 * the plan says "Paneer Tikka Masala" is the bug, in the words the user
 * would use to describe it.
 */
const catalogue = [
  {
    id: 'r-tikka',
    name: 'Paneer Tikka',
    emoji: '🍛',
    mealType: 'dinner',
    baseServings: 2,
    ingredients: [{ name: 'Paneer Cubes', quantity: 200, unit: 'g', category: 'dairy' }],
  },
  {
    id: 'r-tikka-masala',
    name: 'Paneer Tikka Masala',
    emoji: '🍛',
    mealType: 'dinner',
    baseServings: 2,
    ingredients: [{ name: 'Cashew Paste', quantity: 50, unit: 'g', category: 'other' }],
  },
  {
    id: 'r-tikka-curry',
    name: 'Paneer Tikka Curry',
    emoji: '🍛',
    mealType: 'dinner',
    baseServings: 2,
    ingredients: [{ name: 'Tomato Puree', quantity: 120, unit: 'g', category: 'other' }],
  },
  {
    id: 'r-vada',
    name: 'Medu Vada',
    emoji: '🥟',
    mealType: 'breakfast',
    baseServings: 2,
    ingredients: [{ name: 'Urad Dal', quantity: 100, unit: 'g', category: 'other' }],
  },
];

const preferredIds = new Set(catalogue.map((r) => r.id));

/* -------------------------------------------------------------------------- */
/* Bundle the real sheet                                                        */
/* -------------------------------------------------------------------------- */

const work = await mkdtemp(path.join(tmpdir(), 'hh-spoken-edit-'));
await symlink(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');

const tapShim = path.join(REPO, 'scripts/lib/react-tap-state.mjs');

const bundle = await build({
  entryPoints: [path.join(REPO, 'src/components/SpeakYourPlan.tsx')],
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
          // second copy of React and every hook in the sheet breaks.
          if (args.importer === tapShim) return { path: 'react', external: true };
          // The tap must not be bundled in either. A copy inside the bundle
          // would keep its own state, and this test drives that state
          // directly — it would be reading a different component from the one
          // it renders.
          return { path: tapShim, external: true };
        });
      },
    },
  ],
});

const sheetFile = path.join(work, 'SpeakYourPlan.mjs');
await writeFile(sheetFile, bundle.outputFiles[0].text);
const { SpeakYourPlan } = await import(pathToFileURL(sheetFile).href);
const tap = await import(pathToFileURL(tapShim).href);

/* -------------------------------------------------------------------------- */
/* Drive the sheet                                                              */
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

/** The button whose label matches. */
function buttonWithText(tree, re) {
  let found = null;
  walk(tree, (el) => {
    if (found) return;
    if (el.type === 'button' && re.test(textOf(el.props?.children))) found = el;
  });
  return found;
}

/** The field with this aria-label. */
function fieldWithLabel(tree, label) {
  let found = null;
  walk(tree, (el) => {
    if (found) return;
    if (el.props?.['aria-label'] === label) found = el;
  });
  return found;
}

/**
 * Whether any element in the tree shows text matching.
 *
 * Used for the notes the sheet puts under a slot — "heard … → matched …" and
 * "heard … — did you mean" — which are plain text rather than fields or
 * buttons, so the two helpers above cannot reach them.
 */
function hasText(tree, re) {
  let found = false;
  walk(tree, (el) => {
    if (!found && re.test(textOf(el.props?.children))) found = true;
  });
  return found;
}

/**
 * Speak a day into the sheet and open the review.
 *
 * The sheet only shows its slots once it has something to show, and the way
 * it gets there is the way a user without a microphone gets there: type the
 * day into the dictation box and press "Fill the day".
 */
function openSheet(spoken) {
  tap.resetState();
  const applied = [];
  const props = {
    catalogue,
    preferredIds,
    onApply: (plan, resolutions) => applied.push({ plan, resolutions }),
  };

  // Every render starts from the first hook again — that is what tells the
  // tap which state slots belong to this component.
  const render = () => {
    tap.beginRender();
    return SpeakYourPlan(props);
  };

  let tree = render();

  const box = fieldWithLabel(tree, 'Type or dictate the meals for this day');
  if (!box) throw new Error('the sheet has no dictation box');
  box.props.onChange({ target: { value: spoken } });

  tree = render();

  const fill = buttonWithText(tree, /Fill the day/);
  if (!fill) throw new Error('the sheet has no "Fill the day" button');
  fill.props.onClick();

  return { props, applied, tree: render(), render };
}

/** The plan entry the sheet produced, and what it puts on the shopping list. */
function planAndList(applied) {
  if (!applied.length) return null;
  const { plan, resolutions } = applied[0];
  const entries = spokenPlanEntries(plan, resolutions, undefined, undefined);
  const list = buildShoppingList(
    { '2026-10-23': { breakfast: null, lunch: null, dinner: entries[0]?.entry, guests: 0 } },
    catalogue,
    [],
  );
  return {
    entry: entries[0]?.entry,
    ingredients: list.map((n) => n.name),
  };
}

/* -------------------------------------------------------------------------- */
/* The sheet opens at all                                                       */
/* -------------------------------------------------------------------------- */

console.log('\nthe sheet opens on what it heard');
{
  const { applied, render } = openSheet('dinner paneer tikkaa');
  const sheet = render();
  const slot = fieldWithLabel(sheet, 'dinner from speech');
  ok(slot !== null, 'the dinner slot is shown');
  const chip = buttonWithText(sheet, /Paneer Tikka Masala/);
  ok(chip !== null, 'the dishes that were offered are shown as choices');
  ok(applied.length === 0, 'nothing is written to the plan until the user says so');
}

/* -------------------------------------------------------------------------- */
/* The user taps a different dish                                               */
/* -------------------------------------------------------------------------- */

console.log('\nthe user taps one of the dishes that were offered');
{
  const { applied, render } = openSheet('dinner paneer tikkaa');

  let sheet = render();
  const chip = buttonWithText(sheet, /Paneer Tikka Masala/);
  if (!chip) {
    ok(false, 'the chip for the dish the user wants is there');
  } else {
    chip.props.onClick({ preventDefault() {} });
    sheet = render();
    const slot = fieldWithLabel(sheet, 'dinner from speech');
    ok(slot.props.value === 'Paneer Tikka Masala', 'the slot now holds the dish that was tapped',
      slot.props.value);

    const yes = buttonWithText(sheet, /Yes, add these/);
    yes.props.onClick();

    const out = planAndList(applied);
    ok(out.entry?.name === 'Paneer Tikka Masala', 'the plan holds the dish that was tapped',
      out.entry?.name);
    ok(out.entry?.recipeId === 'r-tikka-masala', 'the plan points at that dish\'s own recipe',
      String(out.entry?.recipeId));
    ok(out.ingredients.includes('Cashew Paste'), 'the shopping list buys that dish\'s ingredients',
      out.ingredients.join(', '));
    ok(!out.ingredients.includes('Paneer Cubes'), 'the shopping list does NOT buy the dish that was heard',
      out.ingredients.join(', '));
  }
}

/* -------------------------------------------------------------------------- */
/* The user types over the slot                                                 */
/* -------------------------------------------------------------------------- */

console.log('\nthe user types a different dish over the slot');
{
  const { applied, render } = openSheet('dinner paneer tikkaa');

  let sheet = render();
  const slot = fieldWithLabel(sheet, 'dinner from speech');
  slot.props.onChange({ target: { value: 'Medu Vada' } });
  sheet = render();

  const yes = buttonWithText(sheet, /Yes, add these/);
  yes.props.onClick();

  const out = planAndList(applied);
  ok(out.entry?.name === 'Medu Vada', 'the plan holds the dish that was typed', out.entry?.name);
  ok(out.entry?.recipeId === 'r-vada', 'the plan points at that dish\'s own recipe',
    String(out.entry?.recipeId));
  ok(out.ingredients.includes('Urad Dal'), 'the shopping list buys that dish\'s ingredients',
    out.ingredients.join(', '));
  ok(!out.ingredients.includes('Paneer Cubes'), 'the shopping list does NOT buy the dish that was heard',
    out.ingredients.join(', '));
}

/* --------------------------------------------------------------------------
 * A dish typed in lower case still gets an answer
 * -------------------------------------------------------------------------- */

console.log('\na dish typed in lower case still gets an answer from the sheet');
{
  const { applied, render } = openSheet('dinner paneer tikkaa');

  let sheet = render();
  const slot = fieldWithLabel(sheet, 'dinner from speech');
  // The same dish the catalogue calls "Paneer Tikka", typed the way a person
  // types on a phone: in lower case. The sheet used to compare what the slot
  // held with what the matcher found by EXACT string equality, so the two
  // disagreed the moment the case differed — and the sheet was the one that
  // was wrong: it showed nothing at all, while the plan was written
  // correctly and linked to the right recipe.
  slot.props.onChange({ target: { value: 'paneer tikka' } });
  sheet = render();

  ok(
    hasText(sheet, /matched/),
    'the sheet still says what it matched the typed dish to',
    hasText(sheet, /matched/) ? '' : 'the review panel went silent',
  );

  // The chips under a slot are the OTHER dishes. The slot holds
  // "paneer tikka" and the match is "Paneer Tikka" — one dish, two
  // spellings — so offering "Paneer Tikka" back as an alternative to itself
  // is the sheet asking the same question two ways: the note above says the
  // dish IS Paneer Tikka, and the chip below says "maybe Paneer Tikka?".
  ok(
    buttonWithText(sheet, /^Paneer Tikka$/) === null,
    'the sheet does not offer the slot\'s own dish back as an alternative',
    buttonWithText(sheet, /^Paneer Tikka$/) ? 'the chip "Paneer Tikka" was offered again' : '',
  );

  const yes = buttonWithText(sheet, /Yes, add these/);
  yes.props.onClick();

  const out = planAndList(applied);
  ok(out.entry?.recipeId === 'r-tikka', 'the plan still points at that dish\'s own recipe',
    String(out.entry?.recipeId));
  ok(out.ingredients.includes('Paneer Cubes'), 'the shopping list still buys that dish\'s ingredients',
    out.ingredients.join(', '));
}

/* -------------------------------------------------------------------------- */
/* An untouched slot still links                                                 */
/* -------------------------------------------------------------------------- */

console.log('\na slot nobody touched still links to the dish that was heard');
{
  const { applied, render } = openSheet('dinner paneer tikkaa');
  const sheet = render();
  const yes = buttonWithText(sheet, /Yes, add these/);
  yes.props.onClick();

  const out = planAndList(applied);
  ok(out.entry?.name === 'Paneer Tikka', 'the plan holds the dish that was heard', out.entry?.name);
  ok(out.entry?.recipeId === 'r-tikka', 'and it points at that dish\'s recipe',
    String(out.entry?.recipeId));
  ok(out.ingredients.includes('Paneer Cubes'), 'the shopping list buys that dish\'s ingredients',
    out.ingredients.join(', '));
}

console.log(
  failed === 0
    ? `\n${passed} passed, ${failed} failed\n`
    : `\n${passed} passed, ${failed} FAILED\n`,
);
process.exit(failed === 0 ? 0 : 1);
