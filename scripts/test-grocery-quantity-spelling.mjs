/**
 * Regression test: the grocery list spells a quantity the way the app spells
 * it everywhere else.
 *
 * THE BUG
 *
 * The app has one rule for writing a quantity — `formatQuantity` in
 * src/utils/date.ts. The Stock screen, the Alerts screen, the Meal Plan, the
 * automatic grocery list and the toasts all call it, and the shopping list
 * they write onto is spelled by that rule:
 *
 *     the Stock row          "1 pc"
 *     the Alerts screen      "1 pc"
 *     the Meal Plan          "1 pc"
 *
 * The House Bot writes onto the SAME list, and the parser that reads its reply
 * built the quantity out of a template of its own:
 *
 *     src/utils/groceryListParser.ts   `${qty} ${unitWord.toLowerCase()}`
 *
 * so a bullet the bot writes as "- 1 pcs of eggs" went onto the list as
 *
 *     "1 pcs"
 *
 * beside the Stock row's "1 pc" — the same quantity, one number, two
 * spellings, on one list. "pcs" is the default unit for a new item, so a
 * quantity of one is the commonest quantity in the kitchen and this was the
 * commonest way for the list to contradict itself.
 *
 * The House Bot's own ACTION writes onto the list too, and put the model's
 * free text there untouched — so "1 pcs" from the action landed on the same
 * list as "1 pc" from the Stock row.
 *
 * The parser also LOST the unit's plural, because the unit list put the "s?"
 * outside the group that captures the word:
 *
 *     "- 2 cloves of garlic"   ->  "2 clove"
 *     "- 200 grams of rice"    ->  "200 gram"
 *
 * so the plural the kitchen wrote was gone, and the list carried a word the
 * app never writes.
 *
 * AND THE UNIT ENDED UP IN THE ITEM'S NAME
 *
 * The parser only lifted the quantity off the front of a bullet when the
 * ingredient that followed was written in lower case:
 *
 *     if (rest.length >= 2 && /^[a-z]/.test(rest)) {
 *
 * The kitchen writes its ingredients in capitals — the catalogue's own strings
 * are "Onion - sliced", "Fresh coconut - grated", "Green Chillies - slit" —
 * and so does the House Bot. So the rule did not fire, the bullet fell
 * through to the bare-number rule, and the unit stayed in the name:
 *
 *     "- 1 kg Rice"    ->  an item called "kg Rice", quantity "1"
 *
 * The shopping list showed "kg Rice · 1" instead of "Rice · 1 kg", and the
 * item could never match the kitchen's "Rice" — stock matching is exact.
 *
 * WHAT IS TESTED HERE
 *
 *   - the REAL rule, asked what a quantity should read as, so a restated rule
 *     cannot make the test agree with itself;
 *   - the REAL parser, asked what a bullet becomes;
 *   - the REAL agent-action writer, asked what it writes;
 *   - the REAL Stock-row writer, asked what the same quantity reads as;
 *   - the REAL grocery row, rendered, so the two spellings are seen on the
 *     one screen the household shops from.
 *
 * Run with:  node scripts/test-grocery-quantity-spelling.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpWorkDir, tmpStubFile } from './lib/tmp-work.mjs';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { formatQuantity } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/date.ts')).href
);
const { parseGroceryList } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/groceryListParser.ts')).href
);
const { groceryQuantityForStock } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/groceryQuantity.ts')).href
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

/** The one item the parser makes of a single bullet. */
const parseOne = (bullet) => {
  const items = parseGroceryList(bullet);
  return items[0];
};

/* -------------------------------------------------------------------------- */
/* The rule, and the parser, and the Stock row's writer                        */
/* -------------------------------------------------------------------------- */

console.log('\nthe House Bot writes the quantity the way the app writes it');

/**
 * The bullets the House Bot actually writes, and what the app's own rule says
 * each one should read as.
 *
 * WHY THE EXPECTED ANSWER IS ASKED OF THE RULE AND NOT WRITTEN HERE: a
 * restated rule would only prove that the restatement agrees with itself.
 * The rule is the one the Stock screen, the Alerts screen and the Meal Plan
 * already use, so asking it is asking the app what it says everywhere else.
 */
const BULLETS = [
  { bullet: '- 1 kg of rice', quantity: '1 kg', unit: 'kg' },
  { bullet: '- 2 kg of rice', quantity: '2 kg', unit: 'kg' },
  { bullet: '- 500 g of sugar', quantity: '500 g', unit: 'g' },
  { bullet: '- 1 pcs of eggs', quantity: '1 pc', unit: 'pcs' },
  { bullet: '- 2 pcs of eggs', quantity: '2 pcs', unit: 'pcs' },
  { bullet: '- 1 kg of Rice', quantity: '1 kg', unit: 'kg' },
  { bullet: '- 2 pcs of Eggs', quantity: '2 pcs', unit: 'pcs' },
  { bullet: '- 2 cloves of garlic', quantity: '2 cloves', unit: 'cloves' },
  { bullet: '- 200 grams of rice', quantity: '200 grams', unit: 'grams' },
  // THE UNITS WHOSE PLURAL IS NOT THE STEM PLUS AN "s": a bunch is
  // "bunches", a dash is "dashes" and a pinch is "pinches". Each of them has
  // to be recognised in BOTH forms, or the singular falls out of the parser
  // and the unit ends up in the item's name again.
  { bullet: '- 1 pinch of salt', quantity: '1 pinch', unit: 'pinch' },
  { bullet: '- 2 pinches of salt', quantity: '2 pinches', unit: 'pinches' },
  { bullet: '- 1 bunch of coriander', quantity: '1 bunch', unit: 'bunch' },
  { bullet: '- 2 bunches of coriander', quantity: '2 bunches', unit: 'bunches' },
  { bullet: '- 1 dash of salt', quantity: '1 dash', unit: 'dash' },
  { bullet: '- 2 dashes of salt', quantity: '2 dashes', unit: 'dashes' },
  { bullet: '- 2 packs of biscuits', quantity: '2 packs', unit: 'packs' },
];

for (const c of BULLETS) {
  const item = parseOne(c.bullet);
  const wanted = formatQuantity(Number(c.quantity.split(' ')[0]), c.unit);
  ok(
    wanted === c.quantity,
    `the rule says "${c.bullet}" should read "${c.quantity}"`,
    `it says "${wanted}"`,
  );
  ok(
    item?.quantity === c.quantity,
    `the parser writes "${c.bullet}" as "${c.quantity}"`,
    `it wrote ${JSON.stringify(item?.quantity)}`,
  );
}

console.log('\nand the unit comes off the name');

for (const c of BULLETS) {
  const item = parseOne(c.bullet);
  const name = item?.name ?? '';
  ok(
    !/^(kg|g|ml|l|pcs|clove|cloves|piece|pieces|cup|cups|tbsp|tsp|gram|grams|pinch|pinches|dash|dashes|bunch|bunches|pack|packs)\b/i.test(
      name,
    ),
    `the item for "${c.bullet}" is not called "${name}"`,
  );
}

console.log('\nthe name is the ingredient the kitchen knows');

{
  const item = parseOne('- 1 kg of Rice');
  ok(item?.name === 'Rice', 'the rice is called "Rice"', JSON.stringify(item?.name));
}

console.log('\nthe House Bot\'s own action writes it the same way');

/**
 * The quantities the House Bot's action put on the shopping list.
 *
 * WHY IT IS OUT HERE AND NOT INSIDE THE BLOCK BELOW: the row at the end of
 * this file is rendered with the quantity the action actually wrote, so the
 * screen can be checked against the writer rather than against a literal.
 */
const written = [];

{
  // The third writer of the shopping list: the House Bot's ACTION, which puts
  // the quantity in as one string — the bridge tells the model it may write
  // free text — and which used to put that string on the list untouched.
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src/utils/agentActions.ts')).href
  );

  const store = {
    grocery: [],
    stock: [],
    addGrocery(input) {
      written.push(input.quantity);
      return { id: 'gro_1', ...input };
    },
  };

  const ACTIONS = [
    { type: 'add_grocery', name: 'Eggs', quantity: '1 pcs', category: 'other' },
    { type: 'add_grocery', name: 'Rice', quantity: '2 kg', category: 'grains' },
    { type: 'add_grocery', name: 'Salt', quantity: 'a pinch of salt', category: 'other' },
    { type: 'add_grocery', name: 'Biscuits', quantity: '2 big packets', category: 'snacks' },
    { type: 'add_grocery', name: 'Milk', quantity: '1/2 litre', category: 'dairy' },
    // WHY THESE TWO AND NOT JUST THE ONE ABOVE: "2 big packets" kept its
    // words because a quantity of two is never made singular, so it never
    // reached the part of the rule that could touch a word. A quantity of ONE
    // does, and the bridge tells the model the quantity is free text — so
    // the model may write a quantity that carries a phrase.
    { type: 'add_grocery', name: 'Groceries', quantity: '1 bag of groceries', category: 'other' },
    { type: 'add_grocery', name: 'Spices', quantity: '1 packet of spices', category: 'condiments' },
  ];

  const result = applyAgentActions(ACTIONS, store);

  ok(result.applied === 7, 'every action was applied', String(result.applied));
  ok(written[0] === '1 pc', 'the action writes "1 pc"', written[0]);
  ok(written[1] === '2 kg', 'the action leaves "2 kg" alone', written[1]);
  ok(
    written[2] === 'a pinch of salt',
    'free text that is not a number is left exactly as it was written',
    written[2],
  );
  ok(
    written[3] === '2 big packets',
    'free text with a number keeps its words',
    written[3],
  );
  ok(written[4] === '1/2 litre', 'a fraction is left as it was written', written[4]);
  ok(
    written[5] === '1 bag of groceries',
    'a quantity of one keeps the phrase the model wrote',
    written[5],
  );
  ok(
    written[6] === '1 packet of spices',
    'a quantity of one keeps the phrase the model wrote',
    written[6],
  );
}

/**
 * The REAL store, bundled so it can be driven outside a browser.
 *
 * WHY THE REAL STORE AND NOT A STUB: the manual add is the writer under test,
 * and what it writes is decided by the store — the one place every writer of
 * the shopping list goes through. A stub would agree with this test by
 * construction and prove nothing about the app.
 *
 * WHY IT IS BUNDLED: `useStore` is a React hook, and a node test has no DOM to
 * mount it in. The bundle swaps React for the house's own tap shim, whose
 * `useSyncExternalStore` reads the snapshot and keeps it — which is all the
 * store's hook asks of React.
 *
 * WHY REACT STAYS EXTERNAL FOR THE SHIM ITSELF: the shim imports the real
 * React, and a second copy of React inside the bundle would mean the hook ran
 * against hooks the shim does not have.
 *
 * @returns {Promise<Object>} the store, as the app's own hook returns it
 */
async function realStore() {
  const tapShim = path.join(REPO, 'scripts/lib/react-tap-state.mjs');
  const bundle = await build({
    entryPoints: [path.join(REPO, 'src/store/useStore.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [
      {
        name: 'tap-the-store',
        setup(b) {
          b.onResolve({ filter: /^react$/ }, (args) => {
            if (args.importer === tapShim) return { path: 'react', external: true };
            return { path: tapShim, external: true };
          });
        },
      },
    ],
  });
  const dir = tmpWorkDir('hh-grocery-quantity-store-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  const file = path.join(dir, 'useStore.mjs');
  await writeFile(file, bundle.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return mod.useStore();
}

/**
 * The line the household typed for themselves.
 *
 * WHY IT IS HELD HERE AND NOT IN THE BLOCK BELOW: the list at the end of this
 * file is rendered with the quantity the store really wrote, so the screen can
 * be checked against the writer rather than against a literal.
 */
let byHand = null;

console.log("\nthe household's own Add to shopping list writes it the same way");

/**
 * What the household typed, and what the shopping list ended up carrying.
 *
 * WHY THE HOUSEHOLD'S OWN TYPING IS THE CASE: the Add to shopping list form
 * takes the quantity as free text — its own placeholder says "e.g. 2 packets,
 * 1 kg" — and it is the one writer of the shopping list that never went
 * through the app's rule. So the one input the app knows the most about, the
 * one a person typed for themselves, was the one that could put a second
 * spelling on the list.
 */
{
  const store = await realStore();

  const typed = [
    { typed: '1 pcs', expected: '1 pc' },
    { typed: '2 kg', expected: '2 kg' },
    { typed: '1 bag of groceries', expected: '1 bag of groceries' },
    { typed: 'a pinch of salt', expected: 'a pinch of salt' },
    { typed: '1/2 litre', expected: '1/2 litre' },
  ];

  for (const t of typed) {
    const written = store.addGrocery({
      name: 'Eggs',
      quantity: t.typed,
      category: 'other',
    });
    ok(
      written.quantity === t.expected,
      `the household's "${t.typed}" is written "${t.expected}"`,
      written.quantity,
    );
    // The line the household typed for themselves, kept so the list below can
    // be rendered with the quantity the store really wrote.
    if (t.typed === '1 pcs') byHand = written;
  }
}

console.log('\nthree writers, one list, one spelling');

{
  // The same thing, written by the Stock row and by the House Bot.
  const fromStockRow = groceryQuantityForStock({ lowStockThreshold: 1, unit: 'pcs' });
  const fromHouseBot = parseOne('- 1 pcs of eggs')?.quantity;
  ok(fromStockRow === '1 pc', 'the Stock row writes "1 pc"', fromStockRow);
  ok(
    fromHouseBot === fromStockRow,
    'the House Bot writes the same thing the same way',
    `the Stock row says "${fromStockRow}", the House Bot says "${fromHouseBot}"`,
  );
}

/* -------------------------------------------------------------------------- */
/* The row, built from the real component                                       */
/* -------------------------------------------------------------------------- */

/**
 * The store, as a stub the component can be handed.
 *
 * WHY THE STORE IS A STUB AND NOT THE REAL ONE: `renderToStaticMarkup` reads
 * the store's SERVER snapshot, which is frozen seed state, so a household
 * could never reach the component through it. The stub stands in for the
 * store and hands the component the household under test.
 *
 * @returns {Promise<string>} the path of the stub module
 */
async function stubStore() {
  const file = tmpStubFile('hh-grocery-quantity-store.mjs');
  await writeFile(
    file,
    `export function useStore() {
  return {
    grocery: [],
    stock: [],
    settings: {
      expiringSoonDays: 3,
      userName: '',
      dietaryPreference: 'no-preference',
      allergies: [],
    },
    toggleGroceryPurchased() {},
    removeGrocery() {},
    toast(msg) { globalThis.__hh_toasts.push(msg); },
  };
}
`,
  );
  return file;
}

/**
 * The real `GroceryRow`, with the store replaced by the stub.
 *
 * @returns {Promise<Function>} the component
 */
async function groceryRow() {
  const storeStub = await stubStore();
  const bundle = await build({
    entryPoints: [path.join(REPO, 'src/components/GroceryRow.tsx')],
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
        // own copy of the store would have its own copy of the household, and
        // the row would be asked about a household this test is not driving.
        name: 'stub-the-store',
        setup(b) {
          b.onResolve({ filter: /^\.\.\/store\/useStore$/ }, () => ({
            path: pathToFileURL(storeStub).href,
            external: true,
          }));
        },
      },
    ],
  });
  // The bundle lives outside the checkout, so it cannot find the packages the
  // row imports on its own.
  const dir = tmpWorkDir('hh-grocery-quantity-');
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  const file = path.join(dir, 'GroceryRow.mjs');
  await writeFile(file, bundle.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return mod.GroceryRow;
}

console.log('\nthe list the household shops from shows one spelling');

{
  const GroceryRow = await groceryRow();

  const item = (name, quantity) => ({
    id: `gro_${name}`,
    name,
    quantity,
    category: 'other',
    purchased: false,
    createdAt: 1,
  });

  const fromHouseBot = parseOne('- 1 pcs of eggs');
  const markup = renderToStaticMarkup(
    createElement('div', null, [
      createElement(GroceryRow, {
        key: 'stock',
        item: item('Eggs', groceryQuantityForStock({ lowStockThreshold: 1, unit: 'pcs' })),
      }),
      createElement(GroceryRow, {
        key: 'bot',
        item: item(fromHouseBot?.name ?? 'eggs', fromHouseBot?.quantity ?? ''),
      }),
      // The House Bot's own action, with the quantity it wrote for the
      // household. The row prints the quantity as it was written, so this is
      // exactly what the household reads — and the quantity is the one the
      // action really wrote, not a literal typed here.
      createElement(GroceryRow, {
        key: 'phrase',
        item: item('Groceries', written[5] ?? ''),
      }),
      // The line the household typed for themselves, with the quantity the
      // store really wrote for it — so the list is checked against the writer
      // and not against a literal.
      createElement(GroceryRow, {
        key: 'by-hand',
        item: item(byHand?.name ?? 'Eggs', byHand?.quantity ?? ''),
      }),
    ]),
  );

  // WHAT THE HOUSEHOLD READS: the markup with the tags taken out, so the
  // check is about the words on the screen and not about the code that wrote
  // them.
  const shown = markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  ok(shown.includes('1 pc'), 'the list shows "1 pc"', shown);
  ok(!shown.includes('1 pcs'), 'the list does not show "1 pcs" anywhere', shown);
  ok(
    (shown.match(/1 pc\b/g) ?? []).length === 3,
    'every row on the list reads the same way',
    shown,
  );
  ok(
    shown.includes('1 bag of groceries'),
    'the list shows the phrase the House Bot wrote',
    shown,
  );
  ok(
    !shown.includes('grocerie '),
    'the list does not cut the last letter off a word the House Bot wrote',
    shown,
  );
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
